import { reviver } from "../common/index.js";
import { TumbleweedGame, type FogMemoryPair, type IMoveState, type ITumbleweedState } from "./tumbleweed.js";

export interface TumbleweedFogStackRepairResult {
    state: ITumbleweedState;
    repaired: boolean;
    reason?: string;
}

function cloneFogPair(pair: FogMemoryPair | undefined): FogMemoryPair {
    if (pair === undefined) {
        return [new Map(), new Map()];
    }
    return [
        new Map(pair[0]),
        new Map(pair[1]),
    ];
}

function cloneMoveState(entry: IMoveState): IMoveState {
    return {
        ...entry,
        _results: [...entry._results],
        board: new Map(entry.board),
        scores: [...entry.scores],
        ...(entry.fogMemory !== undefined ? {fogMemory: cloneFogPair(entry.fogMemory)} : {}),
    };
}

function fogPairEquals(a: FogMemoryPair | undefined, b: FogMemoryPair | undefined): boolean {
    if (a === undefined && b === undefined) {
        return true;
    }
    if (a === undefined || b === undefined) {
        return false;
    }
    for (const seat of [0, 1] as const) {
        if (a[seat].size !== b[seat].size) {
            return false;
        }
        for (const [cell, snapA] of a[seat]) {
            const snapB = b[seat].get(cell);
            if (snapB === undefined) {
                return false;
            }
            if (snapA === null && snapB === null) {
                continue;
            }
            if (snapA === null || snapB === null) {
                return false;
            }
            if (snapA[0] !== snapB[0] || snapA[1] !== snapB[1]) {
                return false;
            }
        }
    }
    return true;
}

function replayPrefixState(state: ITumbleweedState): ITumbleweedState {
    const first = state.stack[0];
    if (first === undefined) {
        throw new Error("empty stack");
    }
    return {
        game: state.game,
        numplayers: state.numplayers,
        variants: [...state.variants],
        gameover: false,
        winner: [],
        stack: [cloneMoveState(first)],
    };
}

function stackPlayfieldEqual(a: IMoveState, b: IMoveState): boolean {
    if (a.currplayer !== b.currplayer || a.lastmove !== b.lastmove) {
        return false;
    }
    if (a.scores[0] !== b.scores[0] || a.scores[1] !== b.scores[1]) {
        return false;
    }
    if (a.board.size !== b.board.size) {
        return false;
    }
    for (const [cell, stack] of a.board) {
        const other = b.board.get(cell);
        if (other === undefined || other[0] !== stack[0] || other[1] !== stack[1]) {
            return false;
        }
    }
    return true;
}

function collectFogByReplay(state: ITumbleweedState): FogMemoryPair[] {
    const g = new TumbleweedGame(replayPrefixState(state));
    const fogByIndex: FogMemoryPair[] = [cloneFogPair(g.stack[0]!.fogMemory)];
    for (let i = 1; i < state.stack.length; i++) {
        const frame = state.stack[i]!;
        const lastmove = frame.lastmove;
        if (lastmove === undefined || lastmove.length === 0) {
            throw new Error(`missing lastmove at stack index ${i}`);
        }
        if (g.gameover) {
            break;
        }
        g.move(lastmove, {trusted: true});
        const tip = g.stack[g.stack.length - 1]!;
        if (!stackPlayfieldEqual(frame, tip)) {
            throw new Error(`stack playfield mismatch at index ${i} after replay`);
        }
        fogByIndex.push(cloneFogPair(g.stack[i]!.fogMemory));
    }
    return fogByIndex;
}

function fogMemoryNeedsRepair(state: ITumbleweedState, fogByIndex: FogMemoryPair[]): boolean {
    for (let i = 0; i < state.stack.length; i++) {
        if (!fogPairEquals(state.stack[i]?.fogMemory, fogByIndex[i])) {
            return true;
        }
    }
    return false;
}

/**
 * Trusted replay from stack[0]; refresh `fogMemory` on every ply while preserving other stack fields.
 */
export function rebuildTumbleweedFogStack(state: ITumbleweedState): ITumbleweedState {
    const fogByIndex = collectFogByReplay(state);
    const rebuilt: ITumbleweedState = {
        game: state.game,
        numplayers: state.numplayers,
        variants: [...state.variants],
        gameover: state.gameover,
        winner: [...state.winner],
        stack: state.stack.map((entry, i) => ({
            ...cloneMoveState(entry),
            fogMemory: cloneFogPair(fogByIndex[i]),
            _timestamp: entry._timestamp,
            _version: entry._version,
        })),
    };
    return rebuilt;
}

export function repairTumbleweedFogStack(input: ITumbleweedState | string): TumbleweedFogStackRepairResult {
    let state: ITumbleweedState;
    if (typeof input === "string") {
        state = JSON.parse(input, reviver) as ITumbleweedState;
    } else {
        state = input;
    }
    if (state.game !== TumbleweedGame.gameinfo.uid) {
        return {state, repaired: false, reason: "not tumbleweed"};
    }
    if (!state.variants.includes("fog")) {
        return {state, repaired: false, reason: "no fog variant"};
    }
    try {
        const fogByIndex = collectFogByReplay(state);
        if (!fogMemoryNeedsRepair(state, fogByIndex)) {
            return {state, repaired: false};
        }
        return {state: rebuildTumbleweedFogStack(state), repaired: true, reason: "fogMemory refreshed"};
    } catch (e) {
        return {state, repaired: false, reason: (e as Error).message};
    }
}

export function repairTumbleweedFogStackJson(stateJson: string): {
    stateJson: string;
    repaired: boolean;
    reason?: string;
} {
    const {state, repaired, reason} = repairTumbleweedFogStack(stateJson);
    if (!repaired) {
        return {stateJson, repaired: false, reason};
    }
    const engine = new TumbleweedGame(state);
    return {stateJson: engine.serialize(), repaired: true, reason};
}