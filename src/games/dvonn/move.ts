import type { DvonnGraph } from "../../common/graphs/dvonn.js";
import type { HexDir } from "../../common/graphs/hextri.js";
import type { CellStack, playerid, StackDisc } from "./types.js";

const DIRS: HexDir[] = ["NE", "E", "SE", "SW", "W", "NW"];

export function ownerFromPieces(pieces: StackDisc[]): playerid | undefined {
  for (let i = pieces.length - 1; i >= 0; i--) {
    const p = pieces[i]!;
    if (p.kind === "basic") {
      return p.owner;
    }
  }
  return undefined;
}

export function normalizeStack(stack: CellStack): CellStack {
  return { owner: ownerFromPieces(stack.pieces), pieces: stack.pieces };
}

export function stackHeight(stack: CellStack | undefined): number {
  return stack === undefined ? 0 : stack.pieces.length;
}

export function stackHasDvonn(stack: CellStack): boolean {
  return stack.pieces.some((p) => p.kind === "dvonn");
}

export function isBareDvonn(stack: CellStack): boolean {
  return stack.pieces.length === 1 && stack.pieces[0]!.kind === "dvonn";
}

export function isSurrounded(graph: DvonnGraph, board: Map<string, CellStack>, cell: string): boolean {
  const neighbours = graph.neighbours(cell);
  if (neighbours.length < 6) {
    return false;
  }
  return neighbours.every((nb) => board.has(nb));
}

export function landingAtDistance(
  graph: DvonnGraph,
  from: string,
  dir: HexDir,
  steps: number,
): string | undefined {
  const line = graph.traceLine(from, dir);
  const i = line.indexOf(from);
  if (i === -1) {
    return undefined;
  }
  const j = i + steps;
  if (j < 0 || j >= line.length) {
    return undefined;
  }
  return line[j];
}

export function legalDestinations(
  graph: DvonnGraph,
  board: Map<string, CellStack>,
  from: string,
  player: playerid,
): string[] {
  const stack = board.get(from);
  if (stack === undefined || stack.owner !== player) {
    return [];
  }
  if (isBareDvonn(stack) || isSurrounded(graph, board, from)) {
    return [];
  }
  const height = stack.pieces.length;
  const dests: string[] = [];
  for (const dir of DIRS) {
    const land = landingAtDistance(graph, from, dir, height);
    if (land === undefined || land === from || !board.has(land)) {
      continue;
    }
    dests.push(land);
  }
  return [...new Set(dests)].sort();
}

export function allLegalMoves(
  graph: DvonnGraph,
  board: Map<string, CellStack>,
  player: playerid,
): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  for (const [from, stack] of board) {
    if (stack.owner !== player) {
      continue;
    }
    for (const to of legalDestinations(graph, board, from, player)) {
      out.push({ from, to });
    }
  }
  return out;
}

export function applyStackMove(board: Map<string, CellStack>, from: string, to: string): void {
  const mover = board.get(from);
  const target = board.get(to);
  if (mover === undefined || target === undefined) {
    throw new Error(`Invalid stack move ${from}-${to}`);
  }
  board.delete(from);
  const pieces = [...target.pieces, ...mover.pieces];
  board.set(to, normalizeStack({
    owner: mover.owner,
    pieces,
  }));
}

/** Occupied cells reachable from any stack containing a DVONN disc. */
export function dvonnLinkedCells(graph: DvonnGraph, board: Map<string, CellStack>): Set<string> {
  const seeds: string[] = [];
  for (const [cell, stack] of board) {
    if (stackHasDvonn(stack)) {
      seeds.push(cell);
    }
  }
  const linked = new Set<string>();
  const q = [...seeds];
  for (const s of seeds) {
    linked.add(s);
  }
  while (q.length > 0) {
    const cur = q.shift()!;
    for (const nb of graph.neighbours(cur)) {
      if (!board.has(nb) || linked.has(nb)) {
        continue;
      }
      linked.add(nb);
      q.push(nb);
    }
  }
  return linked;
}

export function removeIsolated(graph: DvonnGraph, board: Map<string, CellStack>): string[] {
  const linked = dvonnLinkedCells(graph, board);
  const removed: string[] = [];
  for (const cell of [...board.keys()]) {
    if (!linked.has(cell)) {
      board.delete(cell);
      removed.push(cell);
    }
  }
  removed.sort();
  return removed;
}

export function cloneBoard(board: Map<string, CellStack>): Map<string, CellStack> {
  const next = new Map<string, CellStack>();
  for (const [cell, stack] of board) {
    next.set(cell, normalizeStack({ pieces: [...stack.pieces] }));
  }
  return next;
}