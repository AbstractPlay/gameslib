import { reviver } from "../common/index.js";
import { TableroGame, type IMoveState, type ITableroState, type playerid } from "./tablero.js";

export type TableroStackRepairResult = {
    state: ITableroState;
    repaired: boolean;
    reason?: string;
};

export type TableroStackVerifyResult = {
    ok: boolean;
    firstBadIndex?: number;
    reason?: string;
};

function cloneBoard(board: Map<string, playerid[]>): Map<string, playerid[]> {
    return new Map([...board].map(([k, v]) => [k, [...v]]));
}

function cloneMoveState(entry: IMoveState): IMoveState {
    const copy: IMoveState = {
        _version: entry._version,
        _results: entry._results !== undefined ? [...entry._results] : [],
        _timestamp: entry._timestamp,
        currplayer: entry.currplayer,
        board: cloneBoard(entry.board),
        roll: [...entry.roll],
        pieces: [...entry.pieces],
        bumped: entry.bumped,
    };
    if (entry.lastmove !== undefined) {
        copy.lastmove = entry.lastmove;
    }
    return copy;
}

export function isLegacyDuplicatePassFrame(stack: IMoveState[], index: number): boolean {
    if (index <= 0) {
        return false;
    }
    const state = stack[index];
    if (state.lastmove !== "pass") {
        return false;
    }
    const prev = stack[index - 1];
    if (prev._results === undefined || state._results === undefined) {
        return false;
    }
    return JSON.stringify(prev._results) === JSON.stringify(state._results);
}

function boardsEqual(a: Map<string, playerid[]>, b: Map<string, playerid[]>): boolean {
    if (a.size !== b.size) {
        return false;
    }
    for (const [key, stackA] of a) {
        const stackB = b.get(key);
        if (stackB === undefined || stackA.length !== stackB.length) {
            return false;
        }
        for (let i = 0; i < stackA.length; i++) {
            if (stackA[i] !== stackB[i]) {
                return false;
            }
        }
    }
    return true;
}

function framePlayfieldsEqual(a: IMoveState, b: IMoveState): boolean {
    return (
        boardsEqual(a.board, b.board)
        && a.currplayer === b.currplayer
        && a.pieces[0] === b.pieces[0]
        && a.pieces[1] === b.pieces[1]
        && a.roll[0] === b.roll[0]
        && (a.roll.length === b.roll.length && (a.roll.length === 1 || a.roll[1] === b.roll[1]))
        && a.bumped === b.bumped
    );
}

function rollsEqual(a: IMoveState["roll"], b: IMoveState["roll"]): boolean {
    if (a.length !== b.length) {
        return false;
    }
    if (a.length === 1) {
        return a[0] === b[0];
    }
    return a[0] === b[0] && a[1] === b[1];
}

/** Legacy take/pass rows may keep stale `currplayer`; board state must still match. */
function tipsCompatible(original: ITableroState, rebuilt: ITableroState): boolean {
    const origTip = original.stack[original.stack.length - 1]!;
    const newTip = rebuilt.stack[rebuilt.stack.length - 1]!;
    if (!boardsEqual(origTip.board, newTip.board)) {
        return false;
    }
    if (origTip.pieces[0] !== newTip.pieces[0] || origTip.pieces[1] !== newTip.pieces[1]) {
        return false;
    }
    if (!rollsEqual(origTip.roll, newTip.roll)) {
        return false;
    }
    if (origTip.bumped !== newTip.bumped) {
        return false;
    }
    if (origTip.currplayer === newTip.currplayer) {
        return true;
    }
    const n = original.stack.length;
    if (n >= 2 && isLegacyDuplicatePassFrame(original.stack, n - 1)) {
        return true;
    }
    if (origTip.lastmove !== undefined && origTip.lastmove.startsWith("-")) {
        return true;
    }
    return false;
}

function replayPrefixState(state: ITableroState): ITableroState {
    return {
        game: state.game,
        numplayers: state.numplayers,
        variants: [...state.variants],
        gameover: false,
        winner: [],
        stack: [cloneMoveState(state.stack[0]!)],
        ...(state.spaceScores !== undefined ? {spaceScores: [...state.spaceScores]} : {}),
    };
}

function rebuildTableroStack(state: ITableroState): TableroGame {
    const prefix = replayPrefixState(state);
    const g = new TableroGame(prefix);
    for (let i = 1; i < state.stack.length; i++) {
        if (isLegacyDuplicatePassFrame(state.stack, i)) {
            continue;
        }
        const frame = state.stack[i]!;
        const lastmove = frame.lastmove;
        if (lastmove === undefined || lastmove.length === 0) {
            throw new Error(`missing lastmove at stack index ${i}`);
        }
        if (lastmove === "pass") {
            g.move("pass", {trusted: true});
        } else {
            g.move(lastmove, {trusted: true, rollOverride: [...frame.roll] as [number, number] | [number]});
        }
    }
    g.gameover = state.gameover;
    g.winner = [...state.winner];
    return g;
}

function stacksMatchCanonical(original: ITableroState, rebuilt: ITableroState): boolean {
    if (original.stack.length !== rebuilt.stack.length) {
        return false;
    }
    for (let i = 0; i < original.stack.length; i++) {
        if (!framePlayfieldsEqual(original.stack[i]!, rebuilt.stack[i]!)) {
            return false;
        }
    }
    return true;
}

function findFirstFrameMismatch(original: ITableroState, rebuilt: ITableroState): number | undefined {
    let rebuiltIndex = 0;
    for (let i = 0; i < original.stack.length; i++) {
        if (isLegacyDuplicatePassFrame(original.stack, i)) {
            continue;
        }
        rebuiltIndex += 1;
        if (rebuiltIndex >= rebuilt.stack.length) {
            return i;
        }
        if (!framePlayfieldsEqual(original.stack[i]!, rebuilt.stack[rebuiltIndex]!)) {
            return i;
        }
    }
    if (rebuiltIndex + 1 !== rebuilt.stack.length) {
        return original.stack.length - 1;
    }
    return undefined;
}

export function verifyTableroStackIntegrity(input: ITableroState | string): TableroStackVerifyResult {
    let state: ITableroState;
    if (typeof input === "string") {
        state = JSON.parse(input, reviver) as ITableroState;
    } else {
        state = input;
    }
    if (state.game !== TableroGame.gameinfo.uid) {
        return {ok: false, reason: "not tablero"};
    }
    if (state.stack.length === 0) {
        return {ok: false, reason: "empty stack"};
    }
    try {
        const engine = rebuildTableroStack(state);
        const rebuilt = engine.state();
        if (!tipsCompatible(state, rebuilt)) {
            return {ok: false, reason: "tip playfields mismatch after replay"};
        }
        if (stacksMatchCanonical(state, rebuilt)) {
            return {ok: true};
        }
        const bad = findFirstFrameMismatch(state, rebuilt);
        return {ok: false, firstBadIndex: bad, reason: "stack frame mismatch vs replay"};
    } catch (e) {
        return {ok: false, reason: (e as Error).message};
    }
}

export function repairTableroStack(input: ITableroState | string): TableroStackRepairResult {
    let state: ITableroState;
    if (typeof input === "string") {
        state = JSON.parse(input, reviver) as ITableroState;
    } else {
        state = input;
    }
    if (state.game !== TableroGame.gameinfo.uid) {
        return {state, repaired: false, reason: "not tablero"};
    }
    const verifyBefore = verifyTableroStackIntegrity(state);
    if (verifyBefore.ok) {
        return {state, repaired: false};
    }
    try {
        const engine = rebuildTableroStack(state);
        const rebuilt = engine.state();
        if (!tipsCompatible(state, rebuilt)) {
            return {state, repaired: false, reason: "tip playfields mismatch after replay"};
        }
        if (state.gameover) {
            const origTip = state.stack[state.stack.length - 1]!;
            const newTip = rebuilt.stack[rebuilt.stack.length - 1]!;
            if (!boardsEqual(origTip.board, newTip.board)) {
                return {state, repaired: false, reason: "terminal board mismatch"};
            }
            if (JSON.stringify(rebuilt.winner) !== JSON.stringify(state.winner)) {
                return {state, repaired: false, reason: "winner mismatch"};
            }
        }
        return {state: rebuilt, repaired: true};
    } catch (e) {
        return {state, repaired: false, reason: (e as Error).message};
    }
}

export function repairTableroStackJson(stateJson: string): {
    stateJson: string;
    repaired: boolean;
    reason?: string;
} {
    const {state, repaired, reason} = repairTableroStack(stateJson);
    if (!repaired) {
        return {stateJson, repaired: false, reason};
    }
    const engine = new TableroGame(state);
    return {stateJson: engine.serialize(), repaired: true};
}
