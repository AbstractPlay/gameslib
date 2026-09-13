/**
 * Download legacy Storisende game states from records.abstractplay.com + DynamoDB
 * for storage regression fixtures (one good-sized game per board variant).
 *
 *   ABSTRACT_PLAY_TABLE=abstract-play-prod npm run fetch-storisende-storage-fixtures
 */
/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import type { APGameRecord } from "@abstractplay/recranks";
import { reviver } from "../src/common/index.js";
import { StorisendeGame, type IStorisendeState } from "../src/games/storisende.js";
import { parseSiteGameId } from "../test/fixtures/turnModel/siteGameId.js";

const RECORDS_BASE = "https://records.abstractplay.com";
const META_UID = "storisende";
const REGION = "us-east-1";
const DEFAULT_TABLE = "abstract-play-prod";

const OUT_DIR = path.join("test", "fixtures", "storisende", "storage", "records");

/** Board variant keys we want one fixture each for (hex5 = default / no variant tag). */
const VARIANT_TARGETS = [
    "board-hex5",
    "board-hex4",
    "board-hex6",
    "board-hex7",
    "board-modular-13",
    "board-modular-18",
] as const;

type VariantKey = (typeof VARIANT_TARGETS)[number];

const MIN_STACK_FRAMES = 18;
const TAIL_FRAMES = 36;

import type { StorisendeRecordManifest } from "../test/fixtures/storisende/storage/records/manifest.types.js";

function decompressGameState(state: string): string {
    if (!state || state.startsWith("{") || state.startsWith("[")) {
        return state;
    }
    const COMPRESSED_PREFIX = "gz:";
    if (state.startsWith(COMPRESSED_PREFIX)) {
        return gunzipSync(Buffer.from(state.slice(COMPRESSED_PREFIX.length), "base64")).toString("utf8");
    }
    try {
        const buf = Buffer.from(state, "base64");
        if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
            return gunzipSync(buf).toString("utf8");
        }
    } catch {
        // fall through
    }
    return state;
}

function variantKeyFromRecord(rec: APGameRecord): VariantKey {
    const siteId = rec.header.site.gameid as string;
    const { variants } = parseSiteGameId(siteId, META_UID);
    if (variants.length === 0) {
        return "board-hex5";
    }
    const key = variants[0] as VariantKey;
    if (!VARIANT_TARGETS.includes(key)) {
        throw new Error(`Unexpected variant ${variants.join("|")} in ${siteId}`);
    }
    return key;
}

function trimStackForFixture(state: IStorisendeState): IStorisendeState {
    const n = state.stack.length;
    if (n <= TAIL_FRAMES + 3) {
        return state;
    }
    const indices = [0, 1, 2];
    for (let i = n - TAIL_FRAMES; i < n; i++) {
        indices.push(i);
    }
    return {
        ...state,
        stack: indices.map(idx => state.stack[idx]!),
    };
}

async function loadStateFromDynamo(
    ddb: DynamoDBDocumentClient,
    tableName: string,
    gameid: string,
): Promise<IStorisendeState> {
    const data = await ddb.send(
        new GetCommand({
            TableName: tableName,
            Key: {
                pk: "GAME",
                sk: `${META_UID}#1#${gameid}`,
            },
        }),
    );
    if (data.Item === undefined) {
        throw new Error(`No GAME item for ${META_UID}#1#${gameid}`);
    }
    const rawState = data.Item.state as string;
    if (rawState === undefined) {
        throw new Error(`GAME item missing state for ${META_UID}#1#${gameid}`);
    }
    const json = decompressGameState(rawState);
    const engine = new StorisendeGame(json);
    if (!engine.gameover) {
        throw new Error(`Expected completed game ${gameid}`);
    }
    const state = JSON.parse(json, reviver) as IStorisendeState;
    if (state.game !== META_UID) {
        throw new Error(`Wrong game uid ${state.game}`);
    }
    for (const frame of state.stack) {
        if (!Array.isArray(frame.board)) {
            throw new Error(`Expected legacy board arrays in archive ${gameid}`);
        }
    }
    return state;
}

async function main(): Promise<void> {
    const tableName = process.env.ABSTRACT_PLAY_TABLE ?? DEFAULT_TABLE;
    const res = await fetch(`${RECORDS_BASE}/meta/${META_UID}.json`);
    if (!res.ok) {
        throw new Error(`Failed to fetch meta: ${res.status}`);
    }
    const records = await res.json() as APGameRecord[];

    const byVariant = new Map<VariantKey, APGameRecord[]>();
    for (const rec of records) {
        if (!rec.moves?.length) {
            continue;
        }
        const key = variantKeyFromRecord(rec);
        const list = byVariant.get(key) ?? [];
        list.push(rec);
        byVariant.set(key, list);
    }

    for (const list of byVariant.values()) {
        list.sort((a, b) => b.moves.length - a.moves.length);
    }

    const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
    fs.mkdirSync(OUT_DIR, { recursive: true });

    const manifest: StorisendeRecordManifest = {
        generated: new Date().toISOString(),
        fixtures: [],
        skipped: [],
    };

    for (const variant of VARIANT_TARGETS) {
        const candidates = byVariant.get(variant) ?? [];
        if (candidates.length === 0) {
            manifest.skipped.push({ variant, reason: "no published record in meta JSON" });
            console.warn(`skip ${variant}: no records`);
            continue;
        }

        let picked: { state: IStorisendeState; rec: APGameRecord; gameid: string } | undefined;
        for (const rec of candidates) {
            const siteId = rec.header.site.gameid as string;
            const { id: gameid } = parseSiteGameId(siteId, META_UID);
            try {
                const state = await loadStateFromDynamo(ddb, tableName, gameid);
                if (state.stack.length < MIN_STACK_FRAMES) {
                    continue;
                }
                picked = { state, rec, gameid };
                break;
            } catch (err) {
                console.warn(`  candidate ${gameid} failed:`, (err as Error).message);
            }
        }

        if (picked === undefined) {
            manifest.skipped.push({
                variant,
                reason: `no Dynamo state with stack.length >= ${MIN_STACK_FRAMES}`,
            });
            console.warn(`skip ${variant}: no suitable Dynamo game`);
            continue;
        }

        const sourceFrames = picked.state.stack.length;
        const trimmed = trimStackForFixture(picked.state);
        const file = `record-${variant}.json`;
        const outPath = path.join(OUT_DIR, file);
        fs.writeFileSync(outPath, `${JSON.stringify(trimmed, null, 2)}\n`);
        manifest.fixtures.push({
            variant,
            file,
            gameid: picked.gameid,
            siteGameId: picked.rec.header.site.gameid as string,
            stackFrames: trimmed.stack.length,
            sourceStackFrames: sourceFrames,
            moveRounds: picked.rec.moves.length,
        });
        console.log(
            `wrote ${file} (${trimmed.stack.length} frames from ${sourceFrames}, ${picked.rec.moves.length} rounds)`,
        );
    }

    fs.writeFileSync(
        path.join(OUT_DIR, "manifest.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
    );
    console.log(`manifest: ${manifest.fixtures.length} fixtures, ${manifest.skipped.length} skipped`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
