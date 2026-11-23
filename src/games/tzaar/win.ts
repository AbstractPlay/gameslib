import type { TzaarGraph } from "./graph.js";
import type { CellStack, PieceCounts, PieceKind, playerid } from "./types.js";
import { hasForcedCapture } from "./move.js";

export type WinReason = "types" | "immobilize";

export function typesPresent(board: Map<string, CellStack>, owner: playerid): Set<PieceKind> {
    const kinds = new Set<PieceKind>();
    for (const stack of board.values()) {
        if (stack.owner !== owner) {
            continue;
        }
        const top = stack.pieces[stack.pieces.length - 1];
        if (top !== undefined) {
            kinds.add(top);
        }
    }
    return kinds;
}

/** Count stacks by visible (top) piece — buried types are out of play, same as capture. */
export function visiblePieceCounts(board: Map<string, CellStack>, owner: playerid): PieceCounts {
    const counts: PieceCounts = { tott: 0, tzarra: 0, tzaar: 0 };
    for (const stack of board.values()) {
        if (stack.owner !== owner) {
            continue;
        }
        const top = stack.pieces[stack.pieces.length - 1];
        if (top !== undefined) {
            counts[top]++;
        }
    }
    return counts;
}

export function lacksTrinity(board: Map<string, CellStack>, owner: playerid): boolean {
    const kinds = typesPresent(board, owner);
    return kinds.size < 3;
}

export function checkWinAfterMove(
    graph: TzaarGraph,
    board: Map<string, CellStack>,
    mover: playerid,
    nextPlayer: playerid,
): { winner: playerid; reason: WinReason } | undefined {
    const opponent = mover === 1 ? 2 : 1;
    if (lacksTrinity(board, opponent)) {
        return { winner: mover, reason: "types" };
    }
    if (!hasForcedCapture(graph, board, nextPlayer)) {
        return { winner: mover, reason: "immobilize" };
    }
    return undefined;
}