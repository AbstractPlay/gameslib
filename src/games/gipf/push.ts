import type { GipfGraph } from "./graph.js";
import type { CellPiece } from "./types.js";

export type PushResult =
    | { ok: true; board: Map<string, CellPiece> }
    | { ok: false; reason: "blocked" | "bad-line" | "bad-dest" };

/** First play spot on a GIPF line when the player indicates any cell along that ray from `dot`. */
export function pushEntrySpot(graph: GipfGraph, dot: string, along: string): string | undefined {
    if (!graph.isDot(dot)) {
        return undefined;
    }
    if (dot === along) {
        return undefined;
    }
    for (const step of graph.dotEntrySteps(dot)) {
        const line = graph.traceLine(dot, step);
        const idx = line.indexOf(along);
        if (idx >= 1) {
            return line[1];
        }
    }
    return undefined;
}

export function lineForPush(graph: GipfGraph, dot: string, dest: string): string[] | undefined {
    if (!graph.isDot(dot)) {
        return undefined;
    }
    const entry = pushEntrySpot(graph, dot, dest);
    if (entry === undefined) {
        return undefined;
    }
    for (const step of graph.dotEntrySteps(dot)) {
        const line = graph.traceLine(dot, step);
        if (line[1] === entry) {
            return line;
        }
    }
    return undefined;
}

/**
 * Make room at `line[fromIdx]` by shifting along the ray toward the far dot.
 * Only **contiguous** occupied spots from `fromIdx` move; an empty cell ends the chain.
 * Illegal if the next cell on the line is a dot (§D.3).
 */
function cascadeFromEntry(
    board: Map<string, CellPiece>,
    graph: GipfGraph,
    line: string[],
    fromIdx: number,
): boolean {
    if (fromIdx >= line.length - 1) {
        return false;
    }
    const cell = line[fromIdx]!;
    const target = line[fromIdx + 1]!;
    if (!board.has(cell)) {
        return true;
    }
    if (graph.isDot(target)) {
        return false;
    }
    if (board.has(target) && !cascadeFromEntry(board, graph, line, fromIdx + 1)) {
        return false;
    }
    const p = board.get(cell)!;
    board.delete(cell);
    board.set(target, p);
    return true;
}

export function simulatePush(
    board: Map<string, CellPiece>,
    graph: GipfGraph,
    dot: string,
    dest: string,
    piece: CellPiece,
): PushResult {
    const line = lineForPush(graph, dot, dest);
    if (line === undefined) {
        return { ok: false, reason: "bad-line" };
    }
    const entry = line[1]!;

    const next = new Map(board);
    if (next.has(entry) && !cascadeFromEntry(next, graph, line, 1)) {
        return { ok: false, reason: "blocked" };
    }
    next.delete(dot);
    next.set(entry, piece);
    return { ok: true, board: next };
}

export function legalPushDestinations(
    board: Map<string, CellPiece>,
    graph: GipfGraph,
    dot: string,
    piece: CellPiece,
): string[] {
    const dests: string[] = [];
    for (const step of graph.dotEntrySteps(dot)) {
        const line = graph.traceLine(dot, step);
        const dest = line[1];
        if (dest === undefined) {
            continue;
        }
        const sim = simulatePush(board, graph, dot, dest, piece);
        if (sim.ok) {
            dests.push(dest);
        }
    }
    return dests;
}