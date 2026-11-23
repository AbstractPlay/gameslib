import type { Board, playerid } from "./types.js";

export function countCaptures(captured: [number, number], player: playerid): number {
    return captured[player - 1];
}

/** Stacks on board grouped by height (for tiebreak). */
export function stacksByHeight(board: Board): Map<number, number> {
    const counts = new Map<number, number>();
    for (const stack of board.values()) {
        const h = stack.length;
        counts.set(h, (counts.get(h) ?? 0) + 1);
    }
    return counts;
}

export function tiebreakCompare(board: Board, p1: playerid, p2: playerid): playerid[] {
    for (const h of [4, 3, 2, 1]) {
        const counts = stacksByHeight(board);
        const s1 = counts.get(h) ?? 0;
        const s2 = counts.get(h) ?? 0;
        if (s1 > s2) {
            return [p1];
        }
        if (s2 > s1) {
            return [p2];
        }
    }
    return [1, 2];
}

export function resolveWinner(
    board: Board,
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
    return tiebreakCompare(board, 1, 2);
}