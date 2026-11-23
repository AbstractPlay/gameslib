import { stackController } from "./colours.js";
import type { Board, ClaimState, playerid } from "./types.js";

export function countCaptures(captured: [number, number], player: playerid): number {
    return captured[player - 1];
}

/** Stacks a player controls on the board, grouped by height (top-disc ownership). */
export function stacksByHeightForPlayer(
    board: Board,
    claims: ClaimState,
    player: playerid,
): Map<number, number> {
    const counts = new Map<number, number>();
    for (const stack of board.values()) {
        if (stackController(claims, stack) !== player) {
            continue;
        }
        const h = stack.length;
        counts.set(h, (counts.get(h) ?? 0) + 1);
    }
    return counts;
}

export function tiebreakCompare(
    board: Board,
    claims: ClaimState,
    p1: playerid,
    p2: playerid,
): playerid[] {
    for (const h of [4, 3, 2, 1]) {
        const c1 = stacksByHeightForPlayer(board, claims, p1).get(h) ?? 0;
        const c2 = stacksByHeightForPlayer(board, claims, p2).get(h) ?? 0;
        if (c1 > c2) {
            return [p1];
        }
        if (c2 > c1) {
            return [p2];
        }
    }
    return [1, 2];
}

export function resolveWinner(
    board: Board,
    claims: ClaimState,
    captured: [number, number],
): playerid[] {
    const c1 = captured[0];
    const c2 = captured[1];
    if (c1 > c2) {
        return [1];
    }
    if (c2 > c1) {
        return [2];
    }
    return tiebreakCompare(board, claims, 1, 2);
}