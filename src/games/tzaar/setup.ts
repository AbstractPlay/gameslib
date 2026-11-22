import { shuffle } from "../../common/shuffle.js";
import type { GameRng } from "../../common/rng.js";
import type { TzaarGraph } from "../../common/graphs/tzaar.js";
import type { CellStack, PieceCounts, PieceKind, playerid, Reserves } from "./types.js";
import { PIECE_COUNTS_PER_PLAYER, PLAYABLE_INTERSECTIONS } from "./types.js";
import { visiblePieceCounts } from "./win.js";

function emptyReserves(): Reserves {
    return [
        { ...PIECE_COUNTS_PER_PLAYER },
        { ...PIECE_COUNTS_PER_PLAYER },
    ];
}

function ringBlockSize(ring: number): number {
    return ring;
}

function ownerAtRingIndex(ring: number, indexInRing: number): playerid {
    const block = ringBlockSize(ring);
    return Math.floor(indexInRing / block) % 2 === 0 ? 1 : 2;
}

function sortRingByAngle(graph: TzaarGraph, cells: string[]): string[] {
    const [cx, cy] = graph.algebraic2coords(graph.blockedCell);
    return [...cells].sort((a, b) => {
        const [ax, ay] = graph.algebraic2coords(a);
        const [bx, by] = graph.algebraic2coords(b);
        return Math.atan2(ay - cy, ax - cx) - Math.atan2(by - cy, bx - cx);
    });
}

function kindForRing(ring: number): PieceKind {
    switch (ring) {
        case 1:
            return "tott";
        case 2:
            return "tzaar";
        case 3:
            return "tzarra";
        case 4:
            return "tott";
        default:
            throw new Error(`Unknown ring: ${ring}`);
    }
}

export function buildFixedBoard(graph: TzaarGraph): Map<string, CellStack> {
    const byRing = new Map<number, string[]>();
    for (const cell of graph.playableCells()) {
        const ring = graph.ringDistance(cell);
        if (ring === undefined) {
            continue;
        }
        if (!byRing.has(ring)) {
            byRing.set(ring, []);
        }
        byRing.get(ring)!.push(cell);
    }
    const board = new Map<string, CellStack>();
    for (const ring of [1, 2, 3, 4] as const) {
        const cells = sortRingByAngle(graph, byRing.get(ring) ?? []);
        const kind = kindForRing(ring);
        cells.forEach((cell, idx) => {
            const owner = ownerAtRingIndex(ring, idx);
            board.set(cell, { owner, pieces: [kind] });
        });
    }
    return board;
}

function allPiecesForPlayer(): PieceKind[] {
    const pieces: PieceKind[] = [];
    for (let i = 0; i < PIECE_COUNTS_PER_PLAYER.tzaar; i++) {
        pieces.push("tzaar");
    }
    for (let i = 0; i < PIECE_COUNTS_PER_PLAYER.tzarra; i++) {
        pieces.push("tzarra");
    }
    for (let i = 0; i < PIECE_COUNTS_PER_PLAYER.tott; i++) {
        pieces.push("tott");
    }
    return pieces;
}

/** Random fill: 30 pieces per colour on all intersections (order shuffled). */
export function buildRandomBoard(graph: TzaarGraph, rng?: GameRng): Map<string, CellStack> {
    const cells = graph.playableCells();
    if (cells.length !== PLAYABLE_INTERSECTIONS) {
        throw new Error(`Expected ${PLAYABLE_INTERSECTIONS} cells, got ${cells.length}`);
    }
    const p1Pieces = shuffle(allPiecesForPlayer(), rng);
    const p2Pieces = shuffle(allPiecesForPlayer(), rng);
    const assignment: Array<[playerid, PieceKind]> = [
        ...p1Pieces.map((k) => [1, k] as [playerid, PieceKind]),
        ...p2Pieces.map((k) => [2, k] as [playerid, PieceKind]),
    ];
    const shuffledCells = shuffle([...cells], rng);
    const shuffledAssignment = shuffle(assignment, rng);
    const board = new Map<string, CellStack>();
    for (let i = 0; i < shuffledCells.length; i++) {
        const [owner, kind] = shuffledAssignment[i]!;
        board.set(shuffledCells[i]!, { owner, pieces: [kind] });
    }
    return board;
}

export function emptyBoard(): Map<string, CellStack> {
    return new Map();
}

export function tournamentReserves(): Reserves {
    return emptyReserves();
}

export function decrementReserve(reserves: Reserves, player: playerid, kind: PieceKind): boolean {
    const seat = reserves[player - 1];
    if (seat[kind] <= 0) {
        return false;
    }
    seat[kind]--;
    return true;
}

export function cloneReserves(reserves: Reserves): Reserves {
    return [
        { ...reserves[0] },
        { ...reserves[1] },
    ];
}

export function cloneBoard(board: Map<string, CellStack>): Map<string, CellStack> {
    const next = new Map<string, CellStack>();
    for (const [cell, stack] of board) {
        next.set(cell, { owner: stack.owner, pieces: [...stack.pieces] });
    }
    return next;
}

export function serializeBoard(board: Map<string, CellStack>): string {
    const cells = [...board.keys()].sort();
    return cells
        .map((c) => {
            const s = board.get(c)!;
            const kinds = s.pieces
                .map((k) => (k === "tott" ? "T" : k === "tzarra" ? "R" : "Z"))
                .join("");
            return `${c}:${s.owner}${kinds}`;
        })
        .join(";");
}

/** Visible stack tops on the board plus tournament reserve still unplaced. */
export function availablePieceCounts(
    board: Map<string, CellStack>,
    reserves: Reserves | undefined,
    owner: playerid,
): PieceCounts {
    const counts = visiblePieceCounts(board, owner);
    if (reserves !== undefined) {
        const r = reserves[owner - 1]!;
        counts.tott += r.tott;
        counts.tzarra += r.tzarra;
        counts.tzaar += r.tzaar;
    }
    return counts;
}

export function formatPieceCountLine(counts: PieceCounts): string {
    return `${counts.tott}/${counts.tzarra}/${counts.tzaar}`;
}