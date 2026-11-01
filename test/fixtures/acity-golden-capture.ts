/**
 * Build oracle payloads for Alien City golden tests.
 * Regenerate committed JSON with UPDATE_ACITY_GOLDEN=1 (see acity-golden.test.ts).
 */
import type { ACityGame } from "../../src/games/acity";
import type { IValidationResult } from "../../src/games/_base";
import { ACityGame as ACityGameClass } from "../../src/games/acity";
import { ACITY_ALL_PIECES, ACITY_GOLDEN_FIXTURES, gameFromGoldenFixture, type ACityGoldenFixtureSpec } from "./acity-golden";

export interface ACityGoldenValidationSnapshot {
    valid: boolean;
    complete?: number;
    canrender?: boolean;
    message: string;
}

export interface ACityGoldenFixtureOracle {
    isConnected: boolean;
    pass: ACityGoldenValidationSnapshot;
    moves1: string[];
    moves2: string[];
    placementGrid: Record<string, ACityGoldenValidationSnapshot>;
    placementResults: Record<string, string>;
    scores: [number, number];
    distances: Record<string, number>;
    extraValidations: Record<string, ACityGoldenValidationSnapshot>;
}

export interface ACityGoldenOracleFile {
    version: 1;
    fixtures: Record<string, ACityGoldenFixtureOracle>;
}

function snapValidation(r: IValidationResult): ACityGoldenValidationSnapshot {
    const out: ACityGoldenValidationSnapshot = {
        valid: r.valid,
        message: r.message,
    };
    if (r.complete !== undefined) {
        out.complete = r.complete;
    }
    if (r.canrender !== undefined) {
        out.canrender = r.canrender;
    }
    return out;
}

function emptyCells(g: ACityGame): string[] {
    return (g.graph.listCells() as string[]).filter((c) => !g.board.has(c));
}

function captureMovesForSeat(g: ACityGame, seat: 1 | 2): string[] {
    const saved = g.currplayer;
    g.currplayer = seat;
    const moves = g.moves().slice().sort();
    g.currplayer = saved;
    return moves;
}

export function captureFixtureOracle(spec: ACityGoldenFixtureSpec): ACityGoldenFixtureOracle {
    const g = gameFromGoldenFixture(spec);
    const placementGrid: Record<string, ACityGoldenValidationSnapshot> = {};
    const placementResults: Record<string, string> = {};
    for (const piece of ACITY_ALL_PIECES) {
        for (const cell of emptyCells(g)) {
            const key = `${piece}-${cell}`;
            placementGrid[key] = snapValidation(g.validateMove(key));
            placementResults[key] = g.goldenPlacementResult(piece, cell);
        }
    }

    const extraValidations: Record<string, ACityGoldenValidationSnapshot> = {};
    for (const move of spec.extraValidations ?? []) {
        extraValidations[move] = snapValidation(g.validateMove(move));
    }

    const distances: Record<string, number> = {};
    for (const [from, to] of spec.distancePairs ?? []) {
        distances[`${from}|${to}`] = g.goldenRealDistance(from, to);
    }

    return {
        isConnected: g.isConnected(),
        pass: snapValidation(g.validateMove("pass")),
        moves1: captureMovesForSeat(g, 1),
        moves2: captureMovesForSeat(g, 2),
        placementGrid,
        placementResults,
        scores: [g.getPlayerScore(1), g.getPlayerScore(2)],
        distances,
        extraValidations,
    };
}

export function captureFullOracle(): ACityGoldenOracleFile {
    const fixtures: Record<string, ACityGoldenFixtureOracle> = {};
    for (const spec of ACITY_GOLDEN_FIXTURES) {
        fixtures[spec.id] = captureFixtureOracle(spec);
    }
    return { version: 1, fixtures };
}

/** Sanity check that capture uses the expected game uid. */
export function assertGoldenHarnessGame(): void {
    if (ACityGameClass.gameinfo.uid !== "acity") {
        throw new Error("Unexpected ACityGame uid during golden capture.");
    }
}
