import type { HexDir } from "../../common/graphs/hextri.js";
import { HexTriGraph } from "../../common/graphs/hextri.js";

export const YINSH_MIN_WIDTH = 6;
export const YINSH_MAX_WIDTH = 11;

/** Renderer `blocked` points for the Yinsh board (corner cuts). */
export const YINSH_BLOCKED_RENDER: Array<{ row: number; col: number }> = [
    { row: 0, col: 0 },
    { row: 0, col: 5 },
    { row: 5, col: 0 },
    { row: 5, col: 10 },
    { row: 10, col: 0 },
    { row: 10, col: 5 },
];

function lineKey(line: string[]): string {
    return [...line].sort().join("|");
}

/**
 * Yinsh board: hex-of-tri 6×11 with six corner intersections removed from play.
 */
export class YinshGraph extends HexTriGraph {
    public readonly blocked: Set<string>;
    private _lines: string[][] | undefined;
    constructor() {
        super(YINSH_MIN_WIDTH, YINSH_MAX_WIDTH, false, true);
        const blocked = new Set<string>();
        const cells = this.listCells(true) as string[][];
        for (const pt of YINSH_BLOCKED_RENDER) {
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

    /** Algebraic cells on one line through `from` in direction `dir`, including `from`. */
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
        return line;
    }

    /** Unique playable intersection lines (deduped). */
    public allLines(): string[][] {
        if (this._lines !== undefined) {
            return this._lines;
        }
        const seen = new Set<string>();
        const lines: string[][] = [];
        const nodes = this.graph.nodes();
        for (const node of nodes) {
            for (const nb of this.neighbours(node)) {
                const dir = this.bearing(node, nb);
                if (dir === undefined) {
                    continue;
                }
                const line = this.traceLine(node, dir);
                if (line.length < 2) {
                    continue;
                }
                const key = lineKey(line);
                if (seen.has(key)) {
                    continue;
                }
                seen.add(key);
                lines.push(line);
            }
        }
        this._lines = lines;
        return lines;
    }

}