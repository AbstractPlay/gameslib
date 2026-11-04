import { reviver } from "../common/index.js";
import type { APMoveResult } from "../schemas/moveresults.js";
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

export type TableroStackDiagnosis = {
    verifyOk: boolean;
    verifyReason?: string;
    playableMismatch: string[];
    storedTipPieces: [number, number];
    replayTipPieces: [number, number];
    storedBoardCells: number;
    replayBoardCells: number;
    storedStackLen: number;
    replayStackLen: number;
    replaySelfVerifyOk: boolean;
    legacyDuplicatePassFrames: number;
    firstBoardDiff?: string;
    /** Replay is self-consistent but saved tip board/pieces differ — stack can be replaced safely. */
    tipSnapshotRepairCandidate: boolean;
};

function cloneBoard(board: unknown): Map<string, playerid[]> {
    return TableroGame.normalizeBoard(board);
}

const PLAYABLE_TIP_FIELDS = ["board", "pieces"] as const;

function normalizeStackBoards(state: ITableroState): ITableroState {
    return {
        ...state,
        stack: state.stack.map((frame) => ({
            ...frame,
            board: cloneBoard(frame.board),
        })),
    };
}

/** All tip fields that differ after replay (diagnostics). */
export function tableroTipMismatchFields(original: ITableroState, rebuilt: ITableroState): string[] {
    const origTip = original.stack[original.stack.length - 1]!;
    const newTip = rebuilt.stack[rebuilt.stack.length - 1]!;
    const fields: string[] = [];
    if (!boardsEqual(origTip.board, newTip.board)) {
        fields.push("board");
    }
    if (origTip.pieces[0] !== newTip.pieces[0] || origTip.pieces[1] !== newTip.pieces[1]) {
        fields.push("pieces");
    }
    if (!rollsEqual(origTip.roll, newTip.roll)) {
        fields.push("roll");
    }
    if (origTip.bumped !== newTip.bumped) {
        fields.push("bumped");
    }
    if (origTip.currplayer !== newTip.currplayer) {
        fields.push("currplayer");
    }
    return fields;
}

/** Tip fields that differ on board or piece counts (verify / audit contract). */
export function tableroPlayableTipMismatchFields(original: ITableroState, rebuilt: ITableroState): string[] {
    return tableroTipMismatchFields(original, rebuilt).filter((f) =>
        (PLAYABLE_TIP_FIELDS as readonly string[]).includes(f),
    );
}

function rollOverrideForFrame(frame: IMoveState): [number, number] | [number] {
    const fromResults = frame._results?.find(
        (r): r is Extract<APMoveResult, {type: "roll"}> => r.type === "roll",
    );
    if (fromResults !== undefined) {
        const v = fromResults.values;
        if (v.length === 1) {
            return [v[0]!];
        }
        return [v[0]!, v[1]!];
    }
    return [...frame.roll] as [number, number] | [number];
}

function isWithdrawalLastmove(lastmove: string): boolean {
    const m = lastmove.toLowerCase().replace(/\s+/g, "");
    return m === "resign" || m === "timeout" || m === "abandoned" || m === "draw";
}

function withdrawingPlayer(frame: IMoveState): playerid {
    for (const r of frame._results ?? []) {
        if (r.type === "resigned" || r.type === "timeout") {
            return r.player as playerid;
        }
    }
    return frame.currplayer;
}

function replayStackMove(g: TableroGame, frame: IMoveState, lastmove: string): void {
    const normalized = lastmove.toLowerCase().replace(/\s+/g, "");
    if (g.gameover && normalized === "pass") {
        return;
    }
    if (normalized === "pass") {
        g.move("pass", {trusted: true});
        return;
    }
    if (normalized === "resign") {
        g.resign(withdrawingPlayer(frame));
        return;
    }
    if (normalized === "timeout") {
        g.timeout(withdrawingPlayer(frame));
        return;
    }
    if (normalized === "abandoned") {
        g.abandoned();
        return;
    }
    if (normalized === "draw") {
        g.draw();
        return;
    }
    g.move(lastmove, {trusted: true, rollOverride: rollOverrideForFrame(frame)});
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
        boardsEqual(cloneBoard(a.board), cloneBoard(b.board))
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

/** Playable position match; roll/currplayer/bumped may differ on legacy rows. */
function tipsCompatible(original: ITableroState, rebuilt: ITableroState): boolean {
    const origTip = original.stack[original.stack.length - 1]!;
    const newTip = rebuilt.stack[rebuilt.stack.length - 1]!;
    if (!boardsEqual(origTip.board, newTip.board)) {
        return false;
    }
    if (origTip.pieces[0] !== newTip.pieces[0] || origTip.pieces[1] !== newTip.pieces[1]) {
        return false;
    }
    return true;
}

function tipMismatchReason(original: ITableroState, rebuilt: ITableroState): string {
    const fields = tableroPlayableTipMismatchFields(original, rebuilt);
    if (fields.length === 0) {
        return "tip playfields mismatch after replay";
    }
    return `tip playfields mismatch after replay (${fields.join(", ")})`;
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
        if (g.gameover && !isWithdrawalLastmove(lastmove)) {
            continue;
        }
        replayStackMove(g, frame, lastmove);
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

function boardCellCount(board: Map<string, playerid[]>): number {
    return board.size;
}

function firstBoardCellDiff(a: Map<string, playerid[]>, b: Map<string, playerid[]>): string | undefined {
    const keys = new Set([...a.keys(), ...b.keys()]);
    for (const key of keys) {
        const stackA = a.get(key);
        const stackB = b.get(key);
        if (stackA === undefined && stackB === undefined) {
            continue;
        }
        if (stackA === undefined || stackB === undefined || stackA.length !== stackB.length) {
            return key;
        }
        for (let i = 0; i < stackA.length; i++) {
            if (stackA[i] !== stackB[i]) {
                return key;
            }
        }
    }
    return undefined;
}

function countLegacyDuplicatePassFrames(stack: IMoveState[]): number {
    let n = 0;
    for (let i = 1; i < stack.length; i++) {
        if (isLegacyDuplicatePassFrame(stack, i)) {
            n += 1;
        }
    }
    return n;
}

function rebuildStoredState(state: ITableroState): TableroGame {
    return rebuildTableroStack(state);
}

function analyzeReplay(state: ITableroState): {
    rebuilt: ITableroState;
    playableMismatch: string[];
    replaySelfVerifyOk: boolean;
    firstBoardDiff?: string;
    tipSnapshotRepairCandidate: boolean;
} {
    const engine = rebuildStoredState(state);
    const rebuilt = engine.state();
    const playableMismatch = tableroPlayableTipMismatchFields(state, rebuilt);
    const origTip = state.stack[state.stack.length - 1]!;
    const newTip = rebuilt.stack[rebuilt.stack.length - 1]!;
    const firstBoardDiff = boardsEqual(origTip.board, newTip.board)
        ? undefined
        : firstBoardCellDiff(origTip.board, newTip.board);
    const replaySelfVerifyOk = verifyTableroStackIntegrity(rebuilt).ok;
    const tipSnapshotRepairCandidate = playableMismatch.length > 0 && replaySelfVerifyOk;
    return {
        rebuilt,
        playableMismatch,
        replaySelfVerifyOk,
        firstBoardDiff,
        tipSnapshotRepairCandidate,
    };
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

export function diagnoseTableroStackIntegrity(input: ITableroState | string): TableroStackDiagnosis {
    let state: ITableroState;
    if (typeof input === "string") {
        state = JSON.parse(input, reviver) as ITableroState;
    } else {
        state = input;
    }
    if (state.game !== TableroGame.gameinfo.uid || state.stack.length === 0) {
        const verify = verifyTableroStackIntegrity(input);
        return {
            verifyOk: verify.ok,
            verifyReason: verify.reason,
            playableMismatch: [],
            storedTipPieces: [0, 0],
            replayTipPieces: [0, 0],
            storedBoardCells: 0,
            replayBoardCells: 0,
            storedStackLen: state.stack?.length ?? 0,
            replayStackLen: 0,
            replaySelfVerifyOk: false,
            legacyDuplicatePassFrames: 0,
            tipSnapshotRepairCandidate: false,
        };
    }
    state = normalizeStackBoards(state);
    const verify = verifyTableroStackIntegrity(state);
    const origTip = state.stack[state.stack.length - 1]!;
    try {
        const analysis = analyzeReplay(state);
        const newTip = analysis.rebuilt.stack[analysis.rebuilt.stack.length - 1]!;
        return {
            verifyOk: verify.ok,
            verifyReason: verify.reason,
            playableMismatch: analysis.playableMismatch,
            storedTipPieces: [...origTip.pieces],
            replayTipPieces: [...newTip.pieces],
            storedBoardCells: boardCellCount(origTip.board),
            replayBoardCells: boardCellCount(newTip.board),
            storedStackLen: state.stack.length,
            replayStackLen: analysis.rebuilt.stack.length,
            replaySelfVerifyOk: analysis.replaySelfVerifyOk,
            legacyDuplicatePassFrames: countLegacyDuplicatePassFrames(state.stack),
            firstBoardDiff: analysis.firstBoardDiff,
            tipSnapshotRepairCandidate: analysis.tipSnapshotRepairCandidate,
        };
    } catch (e) {
        return {
            verifyOk: false,
            verifyReason: (e as Error).message,
            playableMismatch: tableroPlayableTipMismatchFields(state, state),
            storedTipPieces: [...origTip.pieces],
            replayTipPieces: [...origTip.pieces],
            storedBoardCells: boardCellCount(origTip.board),
            replayBoardCells: boardCellCount(origTip.board),
            storedStackLen: state.stack.length,
            replayStackLen: 0,
            replaySelfVerifyOk: false,
            legacyDuplicatePassFrames: countLegacyDuplicatePassFrames(state.stack),
            tipSnapshotRepairCandidate: false,
        };
    }
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
    state = normalizeStackBoards(state);
    try {
        const engine = rebuildTableroStack(state);
        const rebuilt = engine.state();
        if (!tipsCompatible(state, rebuilt)) {
            return {ok: false, reason: tipMismatchReason(state, rebuilt)};
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
    state = normalizeStackBoards(state);
    try {
        const engine = rebuildTableroStack(state);
        const rebuilt = engine.state();
        if (!tipsCompatible(state, rebuilt)) {
            if (verifyTableroStackIntegrity(rebuilt).ok) {
                if (state.gameover && JSON.stringify(rebuilt.winner) !== JSON.stringify(state.winner)) {
                    return {state, repaired: false, reason: "winner mismatch"};
                }
                return {state: rebuilt, repaired: true, reason: "corrected playable tip from replay"};
            }
            return {state, repaired: false, reason: tipMismatchReason(state, rebuilt)};
        }
        if (stacksMatchCanonical(state, rebuilt)) {
            return {state, repaired: false};
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
