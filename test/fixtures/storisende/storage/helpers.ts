import { expect } from "chai";
import { StorisendeGame, type IStorisendeState } from "../../../../src/games/storisende.js";
import { StorisendeBoard } from "../../../../src/games/storisende/board.js";
import type { StorisendeHex } from "../../../../src/games/storisende/hex.js";
import {
    COMPACT_BOARD_VERSION,
    decodeBoardAtIndex,
    encodeBoardWireForNewFrame,
    isBoardDeltaV1,
    isSparseBoardV1,
    modularStartingPositionFromLegacyStack,
    usesCompactWire,
    type BoardWire,
} from "../../../../src/games/storisende/boardCodec.js";

export function boardHexFingerprint(board: StorisendeBoard): string {
    const parts: string[] = [];
    for (const hex of board.hexes) {
        parts.push(`${hex.q},${hex.r}:${hex.tile ?? "virgin"}:${hex.stack.join("")}`);
    }
    parts.sort();
    return parts.join("|");
}

export function boardsEqual(a: StorisendeBoard, b: StorisendeBoard): boolean {
    return boardHexFingerprint(a) === boardHexFingerprint(b);
}

export function expectBoardsEqual(a: StorisendeBoard, b: StorisendeBoard, label?: string): void {
    expect(boardHexFingerprint(a), label).to.equal(boardHexFingerprint(b));
}

export function legacyBoardHexesAtIndex(g: StorisendeGame, idx: number): StorisendeHex[] {
    const wire = g.stack[idx]!.board;
    if (!Array.isArray(wire)) {
        throw new Error(`Expected legacy board array at index ${idx}`);
    }
    return wire.map(h => ({...h, stack: h.stack === undefined ? [] : [...h.stack]}));
}

export function expectLoadIdxMatchesLegacyOracle(g: StorisendeGame, idx: number): void {
    const oracle = StorisendeBoard.deserialize(legacyBoardHexesAtIndex(g, idx));
    const loaded = StorisendeGame.clone(g);
    loaded.load(idx);
    expectBoardsEqual(loaded.board, oracle, `load(${idx})`);
}

export function assertLegacyWireStack(stack: Array<{board: BoardWire}>): void {
    for (const frame of stack) {
        expect(Array.isArray(frame.board)).to.equal(true);
    }
}

export function assertCompactWireStack(stack: Array<{board: BoardWire}>): void {
    for (const frame of stack) {
        expect(Array.isArray(frame.board)).to.equal(false);
        expect(isSparseBoardV1(frame.board) || isBoardDeltaV1(frame.board)).to.equal(true);
    }
}

export function replayFromOpeningState(state: IStorisendeState): StorisendeGame {
    const opening: IStorisendeState = {
        ...state,
        stack: [state.stack[0]!],
    };
    let g = new StorisendeGame(opening);
    for (let i = 1; i < state.stack.length; i++) {
        const lastmove = state.stack[i]!.lastmove;
        expect(lastmove, `stack[${i}].lastmove`).to.not.equal(undefined);
        g = g.move(lastmove!, {trusted: true}) as StorisendeGame;
    }
    return g;
}

export function decodeBoardAtIndexForGame(g: StorisendeGame, idx: number): StorisendeBoard {
    const hexes = decodeBoardAtIndex(
        g.stack,
        idx,
        g.variants,
        usesCompactWire(g.stack),
        g.startingPosition,
    );
    return StorisendeBoard.deserialize(hexes);
}

/** Re-encode a legacy archive using production compact wire rules (sparse + delta + keyframes). */
export function reencodeStateAsCompact(legacyState: IStorisendeState): IStorisendeState {
    const variants = legacyState.variants;
    const startingPosition = legacyState.startingPosition
        ?? modularStartingPositionFromLegacyStack(legacyState.stack, variants)
        ?? "";
    const compactStack: IStorisendeState["stack"] = [];
    for (let i = 0; i < legacyState.stack.length; i++) {
        const hexes = decodeBoardAtIndex(legacyState.stack, i, variants, false);
        const board = StorisendeBoard.deserialize(hexes);
        const wire = encodeBoardWireForNewFrame(board, variants, compactStack, startingPosition);
        compactStack.push({
            ...legacyState.stack[i]!,
            _version: COMPACT_BOARD_VERSION,
            board: wire,
        });
    }
    compactStack[0] = {...compactStack[0]!, _version: COMPACT_BOARD_VERSION};
    return {
        ...legacyState,
        startingPosition,
        stack: compactStack,
    };
}

export function expectLegacyAndCompactBoardsMatchEveryIndex(legacyState: IStorisendeState, label: string): void {
    const legacyGame = new StorisendeGame(legacyState);
    assertLegacyWireStack(legacyGame.stack);
    expect(usesCompactWire(legacyGame.stack)).to.equal(false);

    const compactState = reencodeStateAsCompact(legacyState);
    const compactGame = new StorisendeGame(compactState);
    assertCompactWireStack(compactGame.stack);
    expect(usesCompactWire(compactGame.stack)).to.equal(true);

    for (let idx = 0; idx < legacyState.stack.length; idx++) {
        const legacyClone = StorisendeGame.clone(legacyGame);
        legacyClone.load(idx);
        const compactClone = StorisendeGame.clone(compactGame);
        compactClone.load(idx);
        expectBoardsEqual(legacyClone.board, compactClone.board, `${label} idx ${idx}`);
    }
}
