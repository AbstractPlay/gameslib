import type { DvonnGraph } from "../../common/graphs/dvonn.js";
import { allLegalMoves } from "./move.js";
import type { CellStack, playerid } from "./types.js";

export function controlledPieceCount(board: Map<string, CellStack>, player: playerid): number {
  let n = 0;
  for (const stack of board.values()) {
    if (stack.owner === player) {
      n += stack.pieces.length;
    }
  }
  return n;
}

export function anyLegalMove(graph: DvonnGraph, board: Map<string, CellStack>, player: playerid): boolean {
  return allLegalMoves(graph, board, player).length > 0;
}

export function bothImmobilized(graph: DvonnGraph, board: Map<string, CellStack>): boolean {
  return !anyLegalMove(graph, board, 1) && !anyLegalMove(graph, board, 2);
}

export function resolveWinner(board: Map<string, CellStack>): playerid[] {
  const s1 = controlledPieceCount(board, 1);
  const s2 = controlledPieceCount(board, 2);
  if (s1 > s2) {
    return [1];
  }
  if (s2 > s1) {
    return [2];
  }
  return [1, 2];
}