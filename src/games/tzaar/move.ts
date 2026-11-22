import type { TzaarGraph } from "../../common/graphs/tzaar.js";
import type { HexDir } from "../../common/graphs/hextri.js";
import type { CellStack, playerid, SlideMode } from "./types.js";

export function stackHeight(stack: CellStack | undefined): number {
    return stack === undefined ? 0 : stack.pieces.length;
}

export function stackOwner(board: Map<string, CellStack>, cell: string): playerid | undefined {
    return board.get(cell)?.owner;
}

export function topKind(stack: CellStack): string {
    return stack.pieces[stack.pieces.length - 1]!;
}

const DIRS: HexDir[] = ["NE", "E", "SE", "SW", "W", "NW"];

function landTarget(
    graph: TzaarGraph,
    board: Map<string, CellStack>,
    from: string,
    dir: HexDir,
): string | undefined {
    const line = graph.traceLine(from, dir);
    const start = line.indexOf(from);
    if (start === -1) {
        return undefined;
    }
    for (let i = start + 1; i < line.length; i++) {
        const cell = line[i]!;
        if (board.has(cell)) {
            return cell;
        }
    }
    return undefined;
}

export function legalSlideDestinations(
    graph: TzaarGraph,
    board: Map<string, CellStack>,
    from: string,
    player: playerid,
    mode: SlideMode,
): string[] {
    const stack = board.get(from);
    if (stack === undefined || stack.owner !== player) {
        return [];
    }
    const height = stack.pieces.length;
    const dests: string[] = [];
    for (const dir of DIRS) {
        const to = landTarget(graph, board, from, dir);
        if (to === undefined) {
            continue;
        }
        const target = board.get(to)!;
        if (target.owner === player) {
            if (mode === "capture-only") {
                continue;
            }
            dests.push(to);
        } else if (height >= target.pieces.length) {
            if (mode === "strengthen") {
                continue;
            }
            dests.push(to);
        }
    }
    return [...new Set(dests)].sort();
}

export function allCaptureMoves(
    graph: TzaarGraph,
    board: Map<string, CellStack>,
    player: playerid,
): Array<{ from: string; to: string }> {
    const out: Array<{ from: string; to: string }> = [];
    for (const [from, stack] of board) {
        if (stack.owner !== player) {
            continue;
        }
        for (const to of legalSlideDestinations(graph, board, from, player, "capture-only")) {
            out.push({ from, to });
        }
    }
    return out;
}

export function hasForcedCapture(
    graph: TzaarGraph,
    board: Map<string, CellStack>,
    player: playerid,
): boolean {
    return allCaptureMoves(graph, board, player).length > 0;
}

export function applyCapture(
    board: Map<string, CellStack>,
    from: string,
    to: string,
): void {
    const mover = board.get(from);
    if (mover === undefined) {
        throw new Error(`No stack at ${from}`);
    }
    board.delete(from);
    board.set(to, { owner: mover.owner, pieces: [...mover.pieces] });
}

export function applyStrengthen(
    board: Map<string, CellStack>,
    from: string,
    to: string,
): void {
    const mover = board.get(from);
    const target = board.get(to);
    if (mover === undefined || target === undefined) {
        throw new Error(`Invalid strengthen ${from}-${to}`);
    }
    board.delete(from);
    board.set(to, {
        owner: target.owner,
        pieces: [...target.pieces, ...mover.pieces],
    });
}

export function cloneBoardForSim(board: Map<string, CellStack>): Map<string, CellStack> {
    const next = new Map<string, CellStack>();
    for (const [c, s] of board) {
        next.set(c, { owner: s.owner, pieces: [...s.pieces] });
    }
    return next;
}