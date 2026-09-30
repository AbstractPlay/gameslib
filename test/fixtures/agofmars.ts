import { AgofmarsGame, type IAgofmarsState, type IMoveState } from "../../src/games/agofmars.js";
import type { Colour } from "../../src/games/agofmars/types.js";

const V = AgofmarsGame.gameinfo.version;
const COLOURS: Colour[] = ["RD", "BU", "GN", "YE"];
const COLOURS5: Colour[] = ["RD", "BU", "GN", "YE", "VT"];

/** Colour→multiplier setup wire for defaultObjectives() perms [2,1,0,3] and [3,0,1,2]. */
export const SETUP_MOVE_P1 = "RD0,BU1,GN2,YE-1";
export const SETUP_MOVE_P2 = "RD-1,BU2,GN1,YE0";

export function defaultObjectives(colourCount: 4 | 5 = 4): Colour[][] {
    if (colourCount === 5) {
        return [
            AgofmarsGame.objectivesFromPerm([2, 1, 0, 3, 4], COLOURS5),
            AgofmarsGame.objectivesFromPerm([3, 0, 1, 2, 4], COLOURS5),
        ];
    }
    return [
        AgofmarsGame.objectivesFromPerm([2, 1, 0, 3], COLOURS),
        AgofmarsGame.objectivesFromPerm([3, 0, 1, 2], COLOURS),
    ];
}

/** Play phase, P1 to act, empty board, default objective rows. */
export function freshPlayState(): IAgofmarsState {
    const base: IMoveState = {
        _version: V,
        _results: [],
        _timestamp: new Date(),
        currplayer: 1,
        phase: "play",
        objectives: defaultObjectives(),
        objectivesRevealed: [Array(4).fill(false), Array(4).fill(false)],
        board: new Map(),
    };
    return {
        game: "agofmars",
        numplayers: 2,
        variants: [],
        gameover: false,
        winner: [],
        stack: [base],
    };
}

/** Ko fixture: P2 just moved a1→a2; P1 must not undo with a2→a1. */
export function koUndoBlockedState(): IAgofmarsState {
    const objectives = defaultObjectives();
    const boardBefore = new Map([
        ["a1", ["RD", 2] as const],
        ["c1", ["BU", 2] as const],
    ]);
    const boardAfter = new Map([
        ["a2", ["RD", 2] as const],
        ["c1", ["BU", 2] as const],
    ]);
    const stack: IMoveState[] = [
        {
            _version: V,
            _results: [],
            _timestamp: new Date(),
            currplayer: 2,
            phase: "play",
            objectives,
            objectivesRevealed: [Array(4).fill(false), Array(4).fill(false)],
            board: boardBefore,
        },
        {
            _version: V,
            _results: [{ type: "button", who: 2 }],
            _timestamp: new Date(),
            currplayer: 2,
            lastmove: "noObjSwap",
            phase: "play",
            objectives,
            objectivesRevealed: [Array(4).fill(false), Array(4).fill(false)],
            board: boardBefore,
            awaitingMainAction: true,
        },
        {
            _version: V,
            _results: [{ type: "move", from: "a1", to: "a2" }],
            _timestamp: new Date(),
            currplayer: 1,
            lastmove: "RD2@a1-a2",
            phase: "play",
            objectives,
            objectivesRevealed: [Array(4).fill(false), Array(4).fill(false)],
            board: boardAfter,
            awaitingMainAction: false,
        },
        {
            _version: V,
            _results: [{ type: "button", who: 1 }],
            _timestamp: new Date(),
            currplayer: 1,
            lastmove: "noObjSwap",
            phase: "play",
            objectives,
            objectivesRevealed: [Array(4).fill(false), Array(4).fill(false)],
            board: boardAfter,
            awaitingMainAction: true,
        },
    ];
    return {
        game: "agofmars",
        numplayers: 2,
        variants: [],
        gameover: false,
        winner: [],
        stack,
    };
}

/** Terminal stack frame from scratch `final.json` (five-colour-plus3, two pyramids on board). */
export function fiveColourScratchFinalState(): IAgofmarsState {
    const objectives: Colour[][] = [
        ["VT", "BU", "YE", "GN", "RD"],
        ["BU", "VT", "GN", "RD", "YE"],
    ];
    const board = new Map([
        ["f2", ["VT", 1] as const],
        ["e4", ["VT", 2] as const],
    ]);
    const base: IMoveState = {
        _version: V,
        _results: [],
        _timestamp: new Date(),
        currplayer: 2,
        phase: "play",
        objectives,
        objectivesRevealed: [Array(5).fill(false), Array(5).fill(false)],
        board,
    };
    return {
        game: "agofmars",
        numplayers: 2,
        variants: ["five-colour-plus3"],
        gameover: false,
        winner: [],
        stack: [base],
    };
}

export function gameFrom(state: IAgofmarsState): AgofmarsGame {
    return new AgofmarsGame(state);
}
