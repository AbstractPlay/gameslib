/**
 * Download turn-model golden fixtures from records.abstractplay.com and live DynamoDB.
 *
 * Usage:
 *   ABSTRACT_PLAY_TABLE=abstract-play-prod npm run fetch-turnModel-fixtures
 *   ABSTRACT_PLAY_TABLE=abstract-play-prod npm run fetch-chat-golden-fixtures
 */
/* eslint-disable no-console */
import fs from "fs";
import path from "path";
import { gunzipSync } from "node:zlib";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import type { APGameRecord } from "@abstractplay/recranks";
import {
    GameFactory,
    gameinfoSorted,
    addResource,
    type IAPGameState,
} from "../src";
import { replacer, reviver } from "../src/common";
import type { GameBase } from "../src/games/_base";
import type { IRecordDetails } from "../src/games/_base";
import type {
    TurnModelFixtureCategory,
    TurnModelGolden,
    TurnModelLocalFixture,
    TurnModelManifest,
    TurnModelManifestEntry,
} from "../test/fixtures/turnModel/helpers";
import {
    normalizeGameState,
    TURN_MODEL_FIXTURES_DIR,
    lielowHasCrossPlayerPromote,
} from "../test/fixtures/turnModel/helpers";
import { parseSiteGameId } from "../test/fixtures/turnModel/siteGameId";

const RECORDS_BASE = "https://records.abstractplay.com";
const REGION = "us-east-1";
const DEFAULT_TABLE = "abstract-play-prod";

type RecordSubtype = "normal" | "timeout" | "resign" | "abandoned";

type Tier1Spec = {
    displayName: string;
    subtypes: RecordSubtype[];
};

type PatternSpec = {
    key: string;
    displayName: string;
    category: TurnModelFixtureCategory;
    subtype: string;
    recordFilter: (rec: APGameRecord) => boolean;
    verifyEngine: (engine: GameBase) => boolean;
    /** Try these game ids first (from probe-chat-fixture-candidates). */
    preferredGameIds?: string[];
};

const TIER1_SPECS: Tier1Spec[] = [
    { displayName: "Amazons", subtypes: ["normal", "timeout", "resign"] },
    { displayName: "Hex", subtypes: ["normal", "timeout", "resign"] },
    { displayName: "Lines of Action", subtypes: ["normal", "timeout", "resign"] },
    { displayName: "King's Valley", subtypes: ["normal", "timeout", "resign"] },
    { displayName: "Tintas", subtypes: ["normal", "timeout", "resign"] },
    { displayName: "Adere", subtypes: ["normal", "timeout", "resign"] },
    { displayName: "Hnefatafl", subtypes: ["normal", "timeout", "resign"] },
    { displayName: "Dameo", subtypes: ["normal", "timeout", "resign"] },
    { displayName: "Lielow", subtypes: ["normal", "timeout", "resign"] },
    { displayName: "ConHex", subtypes: ["normal", "timeout", "resign"] },
];

function uidForDisplayName(displayName: string): string {
    const info = gameinfoSorted.find((g) => g.name === displayName);
    if (info === undefined) {
        throw new Error(`No gameinfo uid for display name "${displayName}"`);
    }
    return info.uid;
}

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

function slotMoveText(slot: APGameRecord["moves"][number][number]): string | undefined {
    if (slot === null) {
        return undefined;
    }
    if (typeof slot === "string") {
        return slot;
    }
    return slot.move;
}

function classifyRecord(rec: APGameRecord): RecordSubtype {
    for (const round of rec.moves) {
        for (const slot of round) {
            const move = slotMoveText(slot);
            if (move === "timeout") {
                return "timeout";
            }
            if (move === "resign") {
                return "resign";
            }
            if (move === "abandoned") {
                return "abandoned";
            }
        }
    }
    return "normal";
}

function recordHasSentinel(rec: APGameRecord, sentinel: string): boolean {
    for (const round of rec.moves) {
        for (const slot of round) {
            const move = slotMoveText(slot);
            if (move !== undefined && move.includes(sentinel)) {
                return true;
            }
        }
    }
    return false;
}

async function fetchMetaRecords(metaUid: string): Promise<APGameRecord[]> {
    const url = `${RECORDS_BASE}/meta/${metaUid}.json`;
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as APGameRecord[];
}

function armadasHasElimination(engine: GameBase): boolean {
    const ships = (engine as { ships?: { owner: number }[] }).ships;
    if (ships === undefined) {
        return false;
    }
    for (let p = 1; p <= engine.numplayers; p++) {
        if (ships.find((s) => s.owner === p) === undefined) {
            return true;
        }
    }
    return false;
}

function homeworldsHasElimination(engine: GameBase): boolean {
    for (const state of engine.stack) {
        const results = state._results;
        if (results !== undefined && results.some((r) => r.type === "eliminated")) {
            return true;
        }
    }
    return false;
}

function pigsHasElimination(engine: GameBase): boolean {
    const sim = engine as GameBase & { isEliminated?: (id: number) => boolean };
    if (typeof sim.isEliminated === "function") {
        for (let p = 1; p <= engine.numplayers; p++) {
            if (sim.isEliminated(p)) {
                return true;
            }
        }
    }
    return false;
}

function froggerHasSkipto(engine: GameBase): boolean {
    for (const state of engine.stack) {
        if ("skipto" in state && state.skipto !== undefined) {
            return true;
        }
    }
    return false;
}

function froggerHasRefillsVariant(engine: GameBase): boolean {
    return engine.getVariants().includes("refills");
}

function stackResultsIncludeType(engine: GameBase, type: string): boolean {
    return engine.stack.some(
        (state) => state._results !== undefined && state._results.some((r) => r.type === type),
    );
}

function stackFrameHasMinResults(engine: GameBase, min: number): boolean {
    return engine.stack.some(
        (state) => state._results !== undefined && state._results.length >= min,
    );
}

function stackFrameHasMinResultType(engine: GameBase, type: string, min: number): boolean {
    return engine.stack.some((state) => {
        if (state._results === undefined) {
            return false;
        }
        return state._results.filter((r) => r.type === type).length >= min;
    });
}

function stackResultsIncludeWhoZero(engine: GameBase): boolean {
    return engine.stack.some(
        (state) => state._results !== undefined && state._results.some((r) => (r as { who?: number }).who === 0),
    );
}

function breakthroughHasDetonateOrDestroyBatch(engine: GameBase): boolean {
    if (stackResultsIncludeType(engine, "detonate")) {
        return true;
    }
    return engine.stack.some((state) => {
        if (state._results === undefined) {
            return false;
        }
        return state._results.filter((r) => r.type === "destroy").length >= 2;
    });
}

function completedNormal2p(rec: APGameRecord): boolean {
    return rec.header.players.length === 2 && classifyRecord(rec) === "normal" && rec.moves.length > 0;
}

const TURN_MODEL_PATTERN_SPECS: PatternSpec[] = [
    {
        key: "armadas3pElimination",
        displayName: "Armadas",
        category: "pattern",
        subtype: "armadas3pElimination",
        recordFilter: (rec) => rec.header.players.length === 3,
        verifyEngine: (engine) => engine.numplayers === 3 && armadasHasElimination(engine),
    },
    {
        key: "armadas4pElimination",
        displayName: "Armadas",
        category: "pattern",
        subtype: "armadas4pElimination",
        recordFilter: (rec) => rec.header.players.length === 4,
        verifyEngine: (engine) => engine.numplayers === 4 && armadasHasElimination(engine),
    },
    {
        key: "homeworlds3pElimination",
        displayName: "Homeworlds",
        category: "pattern",
        subtype: "homeworlds3pElimination",
        recordFilter: (rec) => rec.header.players.length >= 3,
        verifyEngine: (engine) => engine.numplayers >= 3 && homeworldsHasElimination(engine),
    },
    {
        key: "pigs4pElimination",
        displayName: "Robo Battle Pigs",
        category: "pattern",
        subtype: "pigs4pElimination",
        recordFilter: (rec) =>
            rec.header.players.length >= 4 &&
            (recordHasSentinel(rec, "\u0091") || classifyRecord(rec) === "normal"),
        verifyEngine: (engine) => engine.numplayers >= 4 && pigsHasElimination(engine),
    },
    {
        key: "pigs2Elimination",
        displayName: "Robo Battle Pigs (Continuous)",
        category: "pattern",
        subtype: "pigs2Elimination",
        recordFilter: (rec) => rec.header.players.length >= 2,
        verifyEngine: (engine) => pigsHasElimination(engine),
    },
    {
        key: "entropyBaseline",
        displayName: "Entropy",
        category: "pattern",
        subtype: "entropyBaseline",
        recordFilter: (rec) => rec.header.players.length === 2,
        verifyEngine: (engine) => engine.numplayers === 2 && !pigsHasElimination(engine),
    },
    {
        key: "frogger2pBaseline",
        displayName: "Frogger",
        category: "pattern",
        subtype: "frogger2pBaseline",
        recordFilter: (rec) =>
            rec.header.players.length === 2 && classifyRecord(rec) === "normal",
        verifyEngine: (engine) => engine.numplayers === 2,
    },
    {
        key: "frogger2pRefillsSkipto",
        displayName: "Frogger",
        category: "pattern",
        subtype: "frogger2pRefillsSkipto",
        recordFilter: (rec) => rec.header.players.length === 2,
        verifyEngine: (engine) =>
            engine.numplayers === 2
            && froggerHasRefillsVariant(engine)
            && froggerHasSkipto(engine),
    },
];

/** Chat-log override games — golden baselines for migration (category `chat`). */
const CHAT_PATTERN_SPECS: PatternSpec[] = [
    {
        key: "byteBaseline",
        displayName: "Byte",
        category: "chat",
        subtype: "byteBaseline",
        recordFilter: completedNormal2p,
        verifyEngine: (engine) =>
            stackResultsIncludeType(engine, "deltaScore")
            || stackFrameHasMinResultType(engine, "move", 2),
    },
    {
        key: "breakthroughBaseline",
        displayName: "Breakthrough",
        category: "chat",
        subtype: "breakthroughBaseline",
        recordFilter: completedNormal2p,
        verifyEngine: breakthroughHasDetonateOrDestroyBatch,
        preferredGameIds: ["c2572c14-04ed-477a-b9a9-ca4c66dce615"],
    },
    {
        key: "bukuBaseline",
        displayName: "Buku",
        category: "chat",
        subtype: "bukuBaseline",
        recordFilter: completedNormal2p,
        verifyEngine: (engine) =>
            stackResultsIncludeType(engine, "claim")
            || stackResultsIncludeType(engine, "sow"),
    },
    {
        key: "chaseBaseline",
        displayName: "Chase",
        category: "chat",
        subtype: "chaseBaseline",
        recordFilter: completedNormal2p,
        verifyEngine: (engine) => stackFrameHasMinResultType(engine, "move", 2),
    },
    {
        key: "epamBaseline",
        displayName: "Epaminondas",
        category: "chat",
        subtype: "epamBaseline",
        recordFilter: completedNormal2p,
        verifyEngine: (engine) => stackFrameHasMinResultType(engine, "capture", 2),
    },
    {
        key: "fendoBaseline",
        displayName: "Fendo",
        category: "chat",
        subtype: "fendoBaseline",
        recordFilter: completedNormal2p,
        verifyEngine: (engine) => stackFrameHasMinResultType(engine, "move", 2),
    },
    {
        key: "fanoronaBaseline",
        displayName: "Fanorona",
        category: "chat",
        subtype: "fanoronaBaseline",
        recordFilter: completedNormal2p,
        verifyEngine: (engine) => stackFrameHasMinResultType(engine, "move", 2),
    },
    {
        key: "fnapBaseline",
        displayName: "FNAP",
        category: "chat",
        subtype: "fnapBaseline",
        recordFilter: completedNormal2p,
        verifyEngine: (engine) =>
            stackResultsIncludeType(engine, "select")
            || stackResultsIncludeType(engine, "claim"),
    },
    {
        key: "focusBaseline",
        displayName: "Focus",
        category: "chat",
        subtype: "focusBaseline",
        recordFilter: completedNormal2p,
        verifyEngine: (engine) =>
            stackFrameHasMinResultType(engine, "capture", 2)
            || stackResultsIncludeType(engine, "reclaim"),
    },
    {
        key: "framesBaseline",
        displayName: "Frames",
        category: "chat",
        subtype: "framesBaseline",
        recordFilter: completedNormal2p,
        verifyEngine: (engine) =>
            stackResultsIncludeWhoZero(engine)
            || stackResultsIncludeType(engine, "deltaScore"),
    },
    {
        key: "magnateBaseline",
        displayName: "Magnate",
        category: "chat",
        subtype: "magnateBaseline",
        recordFilter: completedNormal2p,
        verifyEngine: (engine) =>
            stackResultsIncludeType(engine, "roll")
            && stackResultsIncludeType(engine, "claim"),
    },
    {
        key: "mvolcanoBaseline",
        displayName: "Mega-Volcano",
        category: "chat",
        subtype: "mvolcanoBaseline",
        recordFilter: completedNormal2p,
        verifyEngine: (engine) =>
            stackResultsIncludeType(engine, "eject")
            || stackFrameHasMinResultType(engine, "move", 2),
    },
    {
        key: "stringsBaseline",
        displayName: "Pulling Strings",
        category: "chat",
        subtype: "stringsBaseline",
        recordFilter: completedNormal2p,
        verifyEngine: (engine) => stackResultsIncludeType(engine, "pull"),
    },
    {
        key: "tumbleweedBaseline",
        displayName: "Tumbleweed",
        category: "chat",
        subtype: "tumbleweedBaseline",
        recordFilter: completedNormal2p,
        verifyEngine: (engine) => stackResultsIncludeType(engine, "capture"),
    },
    {
        key: "upperhandBaseline",
        displayName: "Upper Hand",
        category: "chat",
        subtype: "upperhandBaseline",
        recordFilter: completedNormal2p,
        verifyEngine: (engine) =>
            stackResultsIncludeType(engine, "place")
            && stackFrameHasMinResults(engine, 2),
    },
    {
        key: "veletasBaseline",
        displayName: "Veletas",
        category: "chat",
        subtype: "veletasBaseline",
        recordFilter: completedNormal2p,
        verifyEngine: (engine) => stackResultsIncludeType(engine, "claim"),
    },
    {
        key: "volcanoBaseline",
        displayName: "Volcano",
        category: "chat",
        subtype: "volcanoBaseline",
        recordFilter: completedNormal2p,
        verifyEngine: (engine) =>
            stackResultsIncludeType(engine, "eject")
            || stackFrameHasMinResultType(engine, "move", 2),
    },
];

/** Extra chat scenarios (gap-fill) — merged with --extra-chat. */
const EXTENDED_CHAT_SPECS: PatternSpec[] = [
    {
        key: "breakthroughDetonate",
        displayName: "Breakthrough",
        category: "chat",
        subtype: "breakthroughDetonate",
        recordFilter: completedNormal2p,
        verifyEngine: (engine) => stackResultsIncludeType(engine, "detonate"),
        preferredGameIds: ["c2572c14-04ed-477a-b9a9-ca4c66dce615"],
    },
    {
        key: "bukuRepetition",
        displayName: "Buku",
        category: "chat",
        subtype: "bukuRepetition",
        recordFilter: completedNormal2p,
        verifyEngine: (engine) =>
            engine.stack.some((s) =>
                s._results?.some(
                    (r) => r.type === "claim" && (r as { how?: string }).how === "repetition",
                ),
            ),
        preferredGameIds: ["f405dc71-6a94-4ca5-9aa9-2492854727ab"],
    },
    {
        key: "lielowPromoteSwap",
        displayName: "Lielow",
        category: "chat",
        subtype: "lielowPromoteSwap",
        recordFilter: completedNormal2p,
        verifyEngine: lielowHasCrossPlayerPromote,
    },
    {
        key: "magnateEconomy",
        displayName: "Magnate",
        category: "chat",
        subtype: "magnateEconomy",
        recordFilter: completedNormal2p,
        verifyEngine: (engine) => {
            const types = new Set<string>();
            for (const s of engine.stack) {
                for (const r of s._results ?? []) {
                    types.add(r.type);
                }
            }
            return types.has("roll") && types.has("claim") && types.has("capture");
        },
        preferredGameIds: ["e7c6ea98-62e0-48b0-9d5f-5a305baae3ab"],
    },
];

const PATTERN_SPECS: PatternSpec[] = [...TURN_MODEL_PATTERN_SPECS, ...CHAT_PATTERN_SPECS];

function recordDetailsFromPublished(rec: APGameRecord): IRecordDetails {
    const siteId = rec.header.site.gameid as string;
    return {
        uid: siteId,
        players: rec.header.players.map((p) => ({
            uid: p.userid as string,
            name: p.name,
            isai: p.is_ai === true ? true : undefined,
        })),
        dateStart: new Date(rec.header["date-start"]),
        dateEnd: new Date(rec.header["date-end"]),
        event: rec.header.event,
        round: rec.header.round,
        unrated: rec.header.unrated === true ? true : undefined,
        pied: rec.header["pie-invoked"] === true || rec.header.pied === true ? true : undefined,
    };
}

function computeGolden(engine: GameBase, rec: APGameRecord): TurnModelGolden {
    const playerNames = rec.header.players.map((p) => p.name);
    const genRec = engine.genRecord(recordDetailsFromPublished(rec));
    if (genRec === undefined) {
        throw new Error("genRecord returned undefined for completed fixture");
    }
    return {
        moveHistory: engine.moveHistory(),
        chatLog: engine.chatLog(playerNames),
        chatLogEntries: engine.chatLogEntries(playerNames),
        stateNormalized: normalizeGameState(engine.state() as IAPGameState),
        genRecordMoves: genRec.moves,
    };
}

function shortId(uuid: string): string {
    return uuid.slice(0, 8);
}

function buildFixtureId(
    category: TurnModelFixtureCategory,
    metaGame: string,
    subtype: string,
    gameid: string,
): string {
    return `${category}-${metaGame}-${subtype}-${shortId(gameid)}`;
}

async function loadGameFromDynamo(
    ddb: DynamoDBDocumentClient,
    tableName: string,
    metaGame: string,
    gameid: string,
): Promise<{ state: IAPGameState; engine: GameBase }> {
    const data = await ddb.send(
        new GetCommand({
            TableName: tableName,
            Key: {
                pk: "GAME",
                sk: `${metaGame}#1#${gameid}`,
            },
        }),
    );
    if (data.Item === undefined) {
        throw new Error(`No GAME item for ${metaGame}#1#${gameid}`);
    }
    const rawState = data.Item.state as string;
    if (rawState === undefined) {
        throw new Error(`GAME item missing state for ${metaGame}#1#${gameid}`);
    }
    const json = decompressGameState(rawState);
    const engine = GameFactory(metaGame, json);
    if (engine === undefined) {
        throw new Error(`GameFactory failed for ${metaGame}`);
    }
    if (!engine.gameover) {
        throw new Error(`Expected completed game ${metaGame}#${gameid} but gameover is false`);
    }
    return { state: JSON.parse(json, reviver) as IAPGameState, engine };
}

async function pickTier1Fixture(
    ddb: DynamoDBDocumentClient,
    tableName: string,
    displayName: string,
    subtype: RecordSubtype,
    records: APGameRecord[],
    usedIds: Set<string>,
): Promise<TurnModelLocalFixture | undefined> {
    const metaUid = uidForDisplayName(displayName);
    const candidates = records.filter((rec) => {
        const siteId = rec.header.site.gameid as string;
        const { id } = parseSiteGameId(siteId, metaUid);
        if (usedIds.has(id)) {
            return false;
        }
        if (classifyRecord(rec) !== subtype) {
            return false;
        }
        if (rec.moves.length === 0) {
            return false;
        }
        if (rec.moves.length === 1 && rec.moves[0][0] === "") {
            return false;
        }
        return true;
    });
    // Prefer longer games for richer history (still Tier 1 stride games)
    candidates.sort((a, b) => b.moves.length - a.moves.length);

    for (const rec of candidates) {
        const siteId = rec.header.site.gameid as string;
        let metaGame: string;
        let id: string;
        try {
            ({ metaGame, id } = parseSiteGameId(siteId, metaUid));
        } catch (err) {
            console.warn(`Skipping ${siteId} (${subtype}): ${err}`);
            continue;
        }
        try {
            const { state, engine } = await loadGameFromDynamo(ddb, tableName, metaGame, id);
            usedIds.add(id);
            const golden = computeGolden(engine, rec);
            const fixtureId = buildFixtureId("tier1", metaGame, subtype, id);
            return {
                id: fixtureId,
                category: "tier1",
                metaGame,
                subtype,
                gameid: id,
                recordUid: siteId,
                numplayers: rec.header.players.length,
                displayName,
                state,
                publishedRecord: rec,
                golden,
            };
        } catch (err) {
            console.warn(`Skipping ${siteId} (${subtype}): ${err}`);
        }
    }
    console.warn(`No tier1 fixture for ${displayName} subtype ${subtype}`);
    return undefined;
}

async function pickPatternFixture(
    ddb: DynamoDBDocumentClient,
    tableName: string,
    spec: PatternSpec,
    records: APGameRecord[],
    usedIds: Set<string>,
): Promise<TurnModelLocalFixture | undefined> {
    const metaUid = uidForDisplayName(spec.displayName);

    const tryRecord = async (rec: APGameRecord): Promise<TurnModelLocalFixture | undefined> => {
        const siteId = rec.header.site.gameid as string;
        let metaGame: string;
        let id: string;
        try {
            ({ metaGame, id } = parseSiteGameId(siteId, metaUid));
        } catch {
            return undefined;
        }
        if (usedIds.has(id)) {
            return undefined;
        }
        try {
            const { state, engine } = await loadGameFromDynamo(ddb, tableName, metaGame, id);
            if (!spec.verifyEngine(engine)) {
                return undefined;
            }
            usedIds.add(id);
            const golden = computeGolden(engine, rec);
            const fixtureId = buildFixtureId(spec.category, metaGame, spec.subtype, id);
            return {
                id: fixtureId,
                category: spec.category,
                metaGame,
                subtype: spec.subtype,
                gameid: id,
                recordUid: siteId,
                numplayers: rec.header.players.length,
                displayName: spec.displayName,
                state,
                publishedRecord: rec,
                golden,
            };
        } catch (err) {
            console.warn(`Skipping pattern candidate ${siteId}: ${err}`);
            return undefined;
        }
    };

    if (spec.preferredGameIds !== undefined) {
        for (const prefId of spec.preferredGameIds) {
            const rec = records.find((r) => {
                try {
                    return parseSiteGameId(r.header.site.gameid as string, metaUid).id === prefId;
                } catch {
                    return false;
                }
            });
            if (rec !== undefined) {
                const fixture = await tryRecord(rec);
                if (fixture !== undefined) {
                    return fixture;
                }
            }
        }
    }

    const candidates = records
        .filter((rec) => spec.recordFilter(rec))
        .sort((a, b) => b.moves.length - a.moves.length);

    for (const rec of candidates) {
        const fixture = await tryRecord(rec);
        if (fixture !== undefined) {
            return fixture;
        }
    }
    console.warn(`No pattern fixture for ${spec.key}`);
    return undefined;
}

function writeFixture(fixture: TurnModelLocalFixture): void {
    const outPath = path.join(TURN_MODEL_FIXTURES_DIR, `${fixture.id}.json`);
    fs.writeFileSync(outPath, JSON.stringify(fixture, replacer));
    console.log(`Wrote ${outPath}`);
}

function loadExistingManifest(): TurnModelManifestEntry[] {
    const manifestPath = path.join(TURN_MODEL_FIXTURES_DIR, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
        return [];
    }
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as TurnModelManifest;
    return parsed.fixtures;
}

async function fetchPatternSpecs(
    ddb: DynamoDBDocumentClient,
    tableName: string,
    specs: PatternSpec[],
    usedGameIds: Set<string>,
): Promise<TurnModelManifestEntry[]> {
    const entries: TurnModelManifestEntry[] = [];
    for (const patternSpec of specs) {
        const metaUid = uidForDisplayName(patternSpec.displayName);
        console.log(`Pattern ${patternSpec.key} (${metaUid})…`);
        const records = await fetchMetaRecords(metaUid);
        const fixture = await pickPatternFixture(ddb, tableName, patternSpec, records, usedGameIds);
        if (fixture !== undefined) {
            writeFixture(fixture);
            entries.push({
                id: fixture.id,
                category: fixture.category,
                metaGame: fixture.metaGame,
                subtype: fixture.subtype,
                gameid: fixture.gameid,
                recordUid: fixture.recordUid,
                numplayers: fixture.numplayers,
                displayName: fixture.displayName,
            });
        }
    }
    return entries;
}

async function main(): Promise<void> {
    const chatOnly = process.argv.includes("--chat-only");
    const extraChat = process.argv.includes("--extra-chat");
    addResource("en");

    const tableName = process.env.ABSTRACT_PLAY_TABLE ?? DEFAULT_TABLE;
    const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

    fs.mkdirSync(TURN_MODEL_FIXTURES_DIR, { recursive: true });

    const manifestEntries: TurnModelManifestEntry[] = [];
    const usedGameIds = new Set<string>();

    if (extraChat) {
        const preserved = loadExistingManifest();
        manifestEntries.push(...preserved);
        for (const entry of preserved) {
            usedGameIds.add(entry.gameid);
        }
        console.log(`Extra-chat fetch — preserving ${preserved.length} manifest entries`);
        const extraEntries = await fetchPatternSpecs(ddb, tableName, EXTENDED_CHAT_SPECS, usedGameIds);
        manifestEntries.push(...extraEntries);
    } else if (chatOnly) {
        const preserved = loadExistingManifest().filter((e) => e.category !== "chat");
        manifestEntries.push(...preserved);
        for (const entry of preserved) {
            usedGameIds.add(entry.gameid);
        }
        console.log(`Chat-only fetch — preserving ${preserved.length} non-chat manifest entries`);
        const chatEntries = await fetchPatternSpecs(ddb, tableName, CHAT_PATTERN_SPECS, usedGameIds);
        manifestEntries.push(...chatEntries);
    } else {
        for (const tierSpec of TIER1_SPECS) {
            const metaUid = uidForDisplayName(tierSpec.displayName);
            console.log(`Tier1 ${tierSpec.displayName} (${metaUid})…`);
            const records = await fetchMetaRecords(metaUid);

            for (const subtype of tierSpec.subtypes) {
                const fixture = await pickTier1Fixture(
                    ddb,
                    tableName,
                    tierSpec.displayName,
                    subtype,
                    records,
                    usedGameIds,
                );
                if (fixture !== undefined) {
                    writeFixture(fixture);
                    manifestEntries.push({
                        id: fixture.id,
                        category: fixture.category,
                        metaGame: fixture.metaGame,
                        subtype: fixture.subtype,
                        gameid: fixture.gameid,
                        recordUid: fixture.recordUid,
                        numplayers: fixture.numplayers,
                        displayName: fixture.displayName,
                    });
                }
            }
        }

        manifestEntries.push(...await fetchPatternSpecs(ddb, tableName, PATTERN_SPECS, usedGameIds));
    }

    const manifest: TurnModelManifest = {
        generatedAt: new Date().toISOString(),
        fixtures: manifestEntries,
    };
    const manifestPath = path.join(TURN_MODEL_FIXTURES_DIR, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`Manifest: ${manifestEntries.length} fixtures → ${manifestPath}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
