/**
 * Download Frogger turn-model fixtures from abstract-play-dev by explicit game id.
 *
 * Usage:
 *   ABSTRACT_PLAY_TABLE=abstract-play-dev npm run fetch-frogger-dev-fixtures
 */
/* eslint-disable no-console */
import { gunzipSync } from "node:zlib";
import fs from "fs";
import path from "path";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import type { APGameRecord } from "@abstractplay/recranks";
import { GameFactory, addResource, type IAPGameState } from "../src";
import { replacer, reviver } from "../src/common";
import type { IRecordDetails } from "../src/games/_base";
import type {
    TurnModelLocalFixture,
    TurnModelManifest,
    TurnModelManifestEntry,
} from "../test/fixtures/turnModel/helpers";
import {
    normalizeGameState,
    TURN_MODEL_FIXTURES_DIR,
} from "../test/fixtures/turnModel/helpers";

const REGION = "us-east-1";
const DEFAULT_TABLE = "abstract-play-dev";

type DevPlayer = { name: string; id: string; time?: number };

type DevFroggerSpec = {
    gameid: string;
    subtype: string;
};

const DEV_FROGGER_FIXTURES: DevFroggerSpec[] = [
    { gameid: "016f65d1-5cbc-4eee-a457-74bf081b99d8", subtype: "frogger4pRefillsSkipto" },
    { gameid: "114c3677-5af3-44ce-879b-04862dad686f", subtype: "frogger4pNoRefills" },
    { gameid: "f3d2c334-1333-4630-86d9-2be1cadf6835", subtype: "frogger2pRefillsSkipto" },
    { gameid: "18cd5697-0413-4ee2-b958-154ae01e456e", subtype: "frogger2pContinuous" },
];

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

function shortId(uuid: string): string {
    return uuid.slice(0, 8);
}

function buildFixtureId(subtype: string, gameid: string): string {
    return `pattern-frogger-${subtype}-${shortId(gameid)}`;
}

function recordDetailsFromDevGame(
    metaGame: string,
    gameid: string,
    item: Record<string, unknown>,
    numplayers: number,
): IRecordDetails {
    const players = (item.players as DevPlayer[]).slice(0, numplayers).map((p) => ({
        uid: p.id,
        name: p.name,
    }));
    const dateStart = new Date((item.gameStarted as number | string | undefined) ?? Date.now());
    const dateEnd = new Date((item.lastMoveTime as number | string | undefined) ?? Date.now());
    return {
        uid: `${metaGame}#${gameid}`,
        players,
        dateStart,
        dateEnd,
        unrated: item.rated === false ? true : undefined,
    };
}

function publishedRecordFromGenRecord(rec: APGameRecord): APGameRecord {
    return JSON.parse(JSON.stringify(rec)) as APGameRecord;
}

async function loadDevFixture(
    ddb: DynamoDBDocumentClient,
    tableName: string,
    spec: DevFroggerSpec,
): Promise<TurnModelLocalFixture> {
    const metaGame = "frogger";
    const data = await ddb.send(new GetCommand({
        TableName: tableName,
        Key: { pk: "GAME", sk: `${metaGame}#1#${spec.gameid}` },
    }));
    if (data.Item === undefined) {
        throw new Error(`No GAME item for ${metaGame}#1#${spec.gameid}`);
    }
    const rawState = data.Item.state as string;
    const json = decompressGameState(rawState);
    const state = JSON.parse(json, reviver) as IAPGameState;
    const engine = GameFactory(metaGame, json);
    if (engine === undefined) {
        throw new Error(`GameFactory failed for ${spec.gameid}`);
    }
    if (!engine.gameover) {
        throw new Error(`Expected completed game ${spec.gameid}`);
    }

    const details = recordDetailsFromDevGame(metaGame, spec.gameid, data.Item, engine.numplayers);
    const genRec = engine.genRecord(details);
    if (genRec === undefined) {
        throw new Error(`genRecord returned undefined for ${spec.gameid}`);
    }
    const publishedRecord = publishedRecordFromGenRecord(genRec);
    const playerNames = details.players.map((p) => p.name);

    return {
        id: buildFixtureId(spec.subtype, spec.gameid),
        category: "pattern",
        metaGame,
        subtype: spec.subtype,
        gameid: spec.gameid,
        recordUid: details.uid,
        numplayers: engine.numplayers,
        displayName: "Frogger",
        state,
        publishedRecord,
        golden: {
            moveHistory: engine.moveHistory(),
            chatLog: engine.chatLog(playerNames),
            stateNormalized: normalizeGameState(engine.state() as IAPGameState),
            genRecordMoves: genRec.moves,
        },
    };
}

function loadManifest(): TurnModelManifest {
    const manifestPath = path.join(TURN_MODEL_FIXTURES_DIR, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
        return { generatedAt: new Date().toISOString(), fixtures: [] };
    }
    return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as TurnModelManifest;
}

function manifestEntryFromFixture(fixture: TurnModelLocalFixture): TurnModelManifestEntry {
    return {
        id: fixture.id,
        category: fixture.category,
        metaGame: fixture.metaGame,
        subtype: fixture.subtype,
        gameid: fixture.gameid,
        recordUid: fixture.recordUid,
        numplayers: fixture.numplayers,
        displayName: fixture.displayName,
    };
}

async function main(): Promise<void> {
    addResource("en");
    const tableName = process.env.ABSTRACT_PLAY_TABLE ?? DEFAULT_TABLE;
    const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
    fs.mkdirSync(TURN_MODEL_FIXTURES_DIR, { recursive: true });

    const manifest = loadManifest();
    const withoutDevFrogger = manifest.fixtures.filter(
        (entry) => !(entry.metaGame === "frogger" && DEV_FROGGER_FIXTURES.some((s) => s.subtype === entry.subtype)),
    );
    const newEntries: TurnModelManifestEntry[] = [];

    for (const spec of DEV_FROGGER_FIXTURES) {
        console.log(`Dev Frogger ${spec.subtype} (${spec.gameid})…`);
        const fixture = await loadDevFixture(ddb, tableName, spec);
        const outPath = path.join(TURN_MODEL_FIXTURES_DIR, `${fixture.id}.json`);
        fs.writeFileSync(outPath, JSON.stringify(fixture, replacer));
        console.log(`Wrote ${outPath}`);
        newEntries.push(manifestEntryFromFixture(fixture));
    }

    const merged: TurnModelManifest = {
        generatedAt: new Date().toISOString(),
        fixtures: [...withoutDevFrogger, ...newEntries],
    };
    const manifestPath = path.join(TURN_MODEL_FIXTURES_DIR, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(merged, null, 2));
    console.log(`Manifest: ${merged.fixtures.length} fixtures (${newEntries.length} dev frogger added/updated)`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
