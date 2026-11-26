import type { HexDir } from "../../common/graphs/hextri.js";
import { HexTriGraph } from "../../common/graphs/hextri.js";

export const LYNGK_MIN_WIDTH = 5;
export const LYNGK_MAX_WIDTH = 9;

/** Renderer `blocked` points — corner cuts on the LYNGK board (no rotation / reverse-numbers). */
export const LYNGK_BLOCKED_RENDER: Array<{ row: number; col: number }> = [
    { row: 0, col: 0 },
    { row: 0, col: 1 },
    { row: 0, col: 3 },
    { row: 0, col: 4 },
    { row: 1, col: 0 },
    { row: 4, col: 0 },
    { row: 3, col: 0 },
    { row: 1, col: 5 },
    { row: 3, col: 7 },
    { row: 4, col: 8 },
    { row: 5, col: 0 },
    { row: 5, col: 7 },
    { row: 8, col: 0 },
    { row: 8, col: 1 },
    { row: 8, col: 3 },
    { row: 8, col: 4 },
    { row: 7, col: 0 },
    { row: 7, col: 5 },
];

/** Playable intersections on the standard LYNGK board. */
export const LYNGK_INTERSECTIONS = 43;

/**
 * LYNGK board: hex-of-tri 5×9 with eighteen corner intersections removed.
 */
export class LyngkGraph extends HexTriGraph {
    public readonly blocked: Set<string>;

    constructor() {
        super(LYNGK_MIN_WIDTH, LYNGK_MAX_WIDTH, false, false);
        const blocked = new Set<string>();
        const cells = this.listCells(true) as string[][];
        for (const pt of LYNGK_BLOCKED_RENDER) {
            const cell = cells[pt.row]?.[pt.col];
            if (cell !== undefined) {
                blocked.add(cell);
            }
        }
        this.blocked = blocked;
        for (const cell of blocked) {
            if (this.graph.hasNode(cell)) {
                this.graph.dropNode(cell);
            }
        }
    }

    public isPlayable(cell: string): boolean {
        return this.graph.hasNode(cell) && !this.blocked.has(cell);
    }

    public traceLine(from: string, dir: HexDir): string[] {
        const [x, y] = this.algebraic2coords(from);
        const raw = this.ray(x, y, dir, true);
        const line: string[] = [];
        for (const c of raw) {
            const a = this.coords2algebraic(...c);
            if (!this.isPlayable(a)) {
                break;
            }
            line.push(a);
        }
        return line;
    }

    public lineBetween(from: string, to: string): string[] | undefined {
        const dir = this.bearing(from, to);
        if (dir === undefined) {
            return undefined;
        }
        const line = this.traceLine(from, dir);
        if (!line.includes(to)) {
            return undefined;
        }
        const i = line.indexOf(from);
        const j = line.indexOf(to);
        if (i === -1 || j === -1) {
            return undefined;
        }
        const lo = Math.min(i, j);
        const hi = Math.max(i, j);
        return line.slice(lo, hi + 1);
    }

    public playableCells(): string[] {
        return [...this.graph.nodes()].filter((c) => this.isPlayable(c)).sort();
    }
}