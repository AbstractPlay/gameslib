/**
 * Pure board helpers for Kill-All Go.
 *
 * Colours: 1 = Red (the Attacker, trying to kill everything), 2 = Blue (the Defender, trying to
 * make one unconditionally alive string). These are board colours, not seats; which seat plays
 * Red is decided by the opening protocol and lives in the game state.
 */
import { algebraic2coords, coords2algebraic } from "../../common/index.js";

export type Stone = 1 | 2;
export const RED: Stone = 1;
export const BLUE: Stone = 2;

export type Board = Map<string, Stone>;

export interface Geometry {
    size: number;
    /** All cells, row by row from the top of the board. */
    cells: string[];
    neighbours: Map<string, string[]>;
    coords2algebraic: (x: number, y: number) => string;
    algebraic2coords: (cell: string) => [number, number];
}

export interface StringInfo {
    stones: string[];
    liberties: Set<string>;
}

export interface PlacementOutcome {
    /** Each captured opponent string, in the order they were removed. */
    captured: string[][];
    /** The mover's own stones removed by suicide (Tromp-Taylor clearing), if any. */
    suicided: string[];
}

const geometryCache = new Map<number, Geometry>();

export const makeGeometry = (size: number): Geometry => {
    const cached = geometryCache.get(size);
    if (cached !== undefined) {
        return cached;
    }
    const c2a = (x: number, y: number): string => coords2algebraic(x, y, size);
    const a2c = (cell: string): [number, number] => algebraic2coords(cell, size);
    const cells: string[] = [];
    const neighbours = new Map<string, string[]>();
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const cell = c2a(x, y);
            cells.push(cell);
            const adj: string[] = [];
            if (x > 0) { adj.push(c2a(x - 1, y)); }
            if (x < size - 1) { adj.push(c2a(x + 1, y)); }
            if (y > 0) { adj.push(c2a(x, y - 1)); }
            if (y < size - 1) { adj.push(c2a(x, y + 1)); }
            neighbours.set(cell, adj);
        }
    }
    const geo: Geometry = { size, cells, neighbours, coords2algebraic: c2a, algebraic2coords: a2c };
    geometryCache.set(size, geo);
    return geo;
};

export const otherColour = (colour: Stone): Stone => (colour === RED ? BLUE : RED);

/** The string containing `cell` (which must hold a stone) and its liberties. */
export const stringAt = (board: Board, geo: Geometry, cell: string): StringInfo => {
    const colour = board.get(cell);
    if (colour === undefined) {
        throw new Error(`No stone at ${cell}.`);
    }
    const stones: string[] = [];
    const liberties = new Set<string>();
    const seen = new Set<string>([cell]);
    const todo = [cell];
    while (todo.length > 0) {
        const cur = todo.pop()!;
        stones.push(cur);
        for (const n of geo.neighbours.get(cur)!) {
            const occupant = board.get(n);
            if (occupant === undefined) {
                liberties.add(n);
            } else if (occupant === colour && !seen.has(n)) {
                seen.add(n);
                todo.push(n);
            }
        }
    }
    return { stones, liberties };
};

/** Every string of the given colour, each listed once. */
export const stringsOf = (board: Board, geo: Geometry, colour: Stone): StringInfo[] => {
    const seen = new Set<string>();
    const result: StringInfo[] = [];
    for (const cell of geo.cells) {
        if (board.get(cell) !== colour || seen.has(cell)) {
            continue;
        }
        const info = stringAt(board, geo, cell);
        for (const s of info.stones) {
            seen.add(s);
        }
        result.push(info);
    }
    return result;
};

/**
 * Place a stone and apply Tromp-Taylor clearing: opponent strings left without liberties are
 * removed first, then the mover's own string if it has none (multi-stone suicide is legal;
 * a single-stone suicide is left to the superko check, which always rejects it).
 * Mutates `board`.
 */
export const applyPlacement = (board: Board, geo: Geometry, cell: string, colour: Stone): PlacementOutcome => {
    if (board.has(cell)) {
        throw new Error(`Cell ${cell} is occupied.`);
    }
    board.set(cell, colour);
    const opp = otherColour(colour);
    const captured: string[][] = [];
    const removed = new Set<string>();
    for (const n of geo.neighbours.get(cell)!) {
        if (board.get(n) !== opp || removed.has(n)) {
            continue;
        }
        const info = stringAt(board, geo, n);
        if (info.liberties.size === 0) {
            for (const s of info.stones) {
                board.delete(s);
                removed.add(s);
            }
            captured.push(info.stones);
        }
    }
    let suicided: string[] = [];
    const own = stringAt(board, geo, cell);
    if (own.liberties.size === 0) {
        for (const s of own.stones) {
            board.delete(s);
        }
        suicided = own.stones;
    }
    return { captured, suicided };
};

/** Canonical string for a board position (used for positional superko). */
export const signature = (board: Board, geo: Geometry): string => {
    let sig = "";
    for (const cell of geo.cells) {
        const s = board.get(cell);
        sig += s === undefined ? "-" : s === RED ? "r" : "b";
    }
    return sig;
};
