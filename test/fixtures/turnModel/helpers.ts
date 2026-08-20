import fs from "fs";
import path from "path";
import { GameFactory } from "../../../src";
import { GameBase, IAPGameState } from "../../../src/games/_base";
import type { IGameRound, IGameRoundSlot } from "../../../src/games/_turn-model";
import { replacer, reviver } from "../../../src/common";
import type { APGameRecord } from "@abstractplay/recranks";
import type { IRecordDetails } from "../../../src/games/_base";

/** Gitignored root — see test/fixtures/turnModel/README.md */
export const TURN_MODEL_FIXTURES_DIR = path.join(__dirname, "../../fixtures-local/turnModel");

export type TurnModelFixtureCategory = "tier1" | "pattern" | "solo";

export interface TurnModelManifestEntry {
    id: string;
    category: TurnModelFixtureCategory;
    metaGame: string;
    subtype: string;
    gameid: string;
    recordUid: string;
    numplayers: number;
    displayName: string;
}

export interface TurnModelManifest {
    generatedAt: string;
    fixtures: TurnModelManifestEntry[];
}

export interface TurnModelGolden {
    moveHistory: string[][];
    chatLog: string[][];
    stateNormalized: unknown;
    genRecordMoves: APGameRecord["moves"];
}

export interface TurnModelLocalFixture {
    id: string;
    category: TurnModelFixtureCategory;
    metaGame: string;
    subtype: string;
    gameid: string;
    recordUid: string;
    numplayers: number;
    displayName: string;
    state: IAPGameState;
    publishedRecord: APGameRecord;
    golden: TurnModelGolden;
}

export function turnModelFixturesAvailable(): boolean {
    return fs.existsSync(path.join(TURN_MODEL_FIXTURES_DIR, "manifest.json"));
}

export function loadTurnModelManifest(): TurnModelManifest | undefined {
    const manifestPath = path.join(TURN_MODEL_FIXTURES_DIR, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
        return undefined;
    }
    return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as TurnModelManifest;
}

export function loadTurnModelFixture(id: string): TurnModelLocalFixture | undefined {
    const fixturePath = path.join(TURN_MODEL_FIXTURES_DIR, `${id}.json`);
    if (!fs.existsSync(fixturePath)) {
        return undefined;
    }
    return JSON.parse(fs.readFileSync(fixturePath, "utf8"), reviver) as TurnModelLocalFixture;
}

/** Strip volatile stack timestamps; canonicalize Maps/Sets via gameslib replacer/reviver. */
export function normalizeGameState(state: IAPGameState): unknown {
    const canonical = JSON.parse(JSON.stringify(state, replacer), reviver) as IAPGameState;
    return {
        ...canonical,
        stack: canonical.stack.map((entry) => {
            const stripped = { ...entry };
            Reflect.deleteProperty(stripped, "_timestamp");
            return stripped;
        }),
    };
}

export function normalizeSerializedState(serialized: string): unknown {
    return normalizeGameState(JSON.parse(serialized, reviver) as IAPGameState);
}

export function gameFromTurnModelFixture(fixture: TurnModelLocalFixture): GameBase {
    const engine = GameFactory(fixture.metaGame, JSON.stringify(fixture.state, replacer));
    if (engine === undefined) {
        throw new Error(`GameFactory failed for ${fixture.metaGame} fixture ${fixture.id}`);
    }
    return engine;
}

export function reviveFixtureState(raw: IAPGameState): IAPGameState {
    const revived = JSON.parse(JSON.stringify(raw, replacer), reviver) as IAPGameState;
    for (const entry of revived.stack) {
        if (entry._timestamp !== undefined && typeof entry._timestamp === "string") {
            entry._timestamp = new Date(entry._timestamp);
        }
    }
    return revived;
}

export function recordDetailsFromFixture(fixture: TurnModelLocalFixture): IRecordDetails {
    return {
        uid: fixture.recordUid,
        players: fixture.publishedRecord.header.players.map((p) => ({
            uid: p.userid as string,
            name: p.name,
            isai: p.is_ai === true ? true : undefined,
        })),
        dateStart: new Date(fixture.publishedRecord.header["date-start"]),
        dateEnd: new Date(fixture.publishedRecord.header["date-end"]),
        event: fixture.publishedRecord.header.event,
        round: fixture.publishedRecord.header.round,
        unrated: fixture.publishedRecord.header.unrated === true ? true : undefined,
        pied: fixture.publishedRecord.header["pie-invoked"] === true
            || fixture.publishedRecord.header.pied === true
            ? true
            : undefined,
    };
}

/** Current {@link GameBase.getMoveList} export (protected) for golden comparison. */
export function getMoveListFromGame(game: GameBase): unknown[] {
    return Object.getPrototypeOf(game).getMoveList.call(game);
}

/** {@link GameBase.getMoveList} after Phase 1b export pipeline — same as {@link getMoveListFromGame}. */
export function getRoundsForRecordExport(game: GameBase): IGameRound[] {
    return getMoveListFromGame(game) as IGameRound[];
}

/** Move string from a gamerecord / {@link IGameRound} slot (string, object, or absent). */
export function moveStringFromRoundSlot(
    slot: string | IGameRoundSlot | null,
): string | null {
    if (slot === null) {
        return null;
    }
    if (typeof slot === "string") {
        return slot;
    }
    return slot.move;
}

/** Per-round seating grid of move strings (`null` where the seat has no ply). */
export function roundMoveStrings(rounds: IGameRound[]): (string | null)[][] {
    return rounds.map((row) => row.map((slot) => moveStringFromRoundSlot(slot)));
}

/** Match {@link GameBase.compactExportRounds} trailing-null trim on each row. */
export function compactTrailingNullRound(row: IGameRound): IGameRound {
    const copy: IGameRound = [...row];
    while (copy.length > 0 && copy[copy.length - 1] === null) {
        copy.pop();
    }
    return copy;
}

export function compactTrailingNullRounds(rounds: IGameRound[]): IGameRound[] {
    return rounds.map((row) => compactTrailingNullRound(row));
}

/** Non-null move strings in row-major seat order — matches ply list order for canonical rounds. */
export function plyOrderedMovesFromRounds(rounds: IGameRound[]): string[] {
    const moves: string[] = [];
    for (const row of rounds) {
        for (const slot of row) {
            if (slot !== null) {
                const move = moveStringFromRoundSlot(slot);
                if (move !== null) {
                    moves.push(move);
                }
            }
        }
    }
    return moves;
}

/** Strip volatile {@link APGameRecord} header fields before golden comparison. */
export function normalizeRecordHeaderForGolden(header: APGameRecord["header"]): unknown {
    const copy = JSON.parse(JSON.stringify(header)) as Record<string, unknown>;
    Reflect.deleteProperty(copy, "date-generated");
    // New records carry turn-model; historical published records do not (Phase 4).
    Reflect.deleteProperty(copy, "turn-model");
    // Published records use `pied`; {@link GameBase.genRecord} emits `pie-invoked`.
    if (copy["pie-invoked"] === true && copy.pied === undefined) {
        copy.pied = true;
        Reflect.deleteProperty(copy, "pie-invoked");
    }
    return copy;
}

/**
 * Games where {@link GameBase.genRecord} can be compared to fixture {@link publishedRecord}.
 */
export function genRecordGoldenSupported(metaGame: string): boolean {
    void metaGame;
    return true;
}

/**
 * Games where {@link getRoundsForRecordExport} move-string layout can be compared to golden baseline.
 * Skip-turn 3+ (Phase 3) still uses legacy stride export until migrated.
 */
export function getRoundsRecordExportSupported(_metaGame: string, _numplayers: number): boolean {
    void _metaGame;
    void _numplayers;
    return true;
}
