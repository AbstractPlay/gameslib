import type { Colour, CellContents, Size } from "./types.js";
import { activeColours } from "./bag.js";
import { algebraic2coords, coords2algebraic } from "../../common/index.js";

export function pipValue(size: Size): number {
    if (size === 3) {
        return 3;
    }
    if (size === 2) {
        return 2;
    }
    return 1;
}

export interface ScoreOptions {
    variants: string[];
    objectives: Colour[][];
    multipliers: number[];
}

function neighbours(cell: string, width: number, height: number): string[] {
    const [col, row] = algebraic2coords(cell, height);
    const out: string[] = [];
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    for (const [dc, dr] of dirs) {
        const nc = col + dc;
        const nr = row + dr;
        if (nc >= 0 && nc < width && nr >= 0 && nr < height) {
            out.push(coords2algebraic(nc, nr, height));
        }
    }
    return out;
}

function componentsForColour(
    board: Map<string, CellContents>,
    colour: Colour,
    width: number,
    height: number,
): { cells: string[]; pipSum: number }[] {
    const visited = new Set<string>();
    const groups: { cells: string[]; pipSum: number }[] = [];
    for (const [cell, [c]] of board) {
        if (c !== colour || visited.has(cell)) {
            continue;
        }
        const stack = [cell];
        const cells: string[] = [];
        let pipSum = 0;
        visited.add(cell);
        while (stack.length > 0) {
            const cur = stack.pop()!;
            cells.push(cur);
            const piece = board.get(cur)!;
            pipSum += pipValue(piece[1]);
            for (const n of neighbours(cur, width, height)) {
                if (!visited.has(n) && board.get(n)?.[0] === colour) {
                    visited.add(n);
                    stack.push(n);
                }
            }
        }
        groups.push({ cells, pipSum });
    }
    return groups;
}

export function scoreGame(
    board: Map<string, CellContents>,
    width: number,
    height: number,
    opts: ScoreOptions,
): number[] {
    const colours = activeColours(opts.variants);
    const biggestOnly = opts.variants.includes("biggest-group");
    const groupSizeBonus = opts.variants.includes("group-size-scoring");
    const minSize = biggestOnly ? 1 : 4;
    const totals = [0, 0];

    for (let seat = 0; seat < 2; seat++) {
        const obj = opts.objectives[seat]!;
        for (const colour of colours) {
            let groups = componentsForColour(board, colour, width, height);
            if (biggestOnly && groups.length > 0) {
                groups.sort((a, b) => {
                    if (b.cells.length !== a.cells.length) {
                        return b.cells.length - a.cells.length;
                    }
                    return b.pipSum - a.pipSum;
                });
                groups = [groups[0]!];
            }
            for (const g of groups) {
                if (g.cells.length < minSize) {
                    continue;
                }
                let base = g.pipSum;
                if (groupSizeBonus) {
                    base += g.cells.length;
                }
                const col = obj.indexOf(colour);
                if (col < 0) {
                    continue;
                }
                const mult = opts.multipliers[col] ?? 0;
                totals[seat] += base * mult;
            }
        }
    }
    return totals;
}
