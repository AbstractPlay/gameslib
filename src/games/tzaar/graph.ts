import type { HexDir } from "../../common/graphs/hextri.js";
import { HexTriGraph } from "../../common/graphs/hextri.js";

export const TZAAR_MIN_WIDTH = 5;
export const TZAAR_MAX_WIDTH = 9;

/** Renderer `blocked` point — no central space on the TZAAR board. */
export const TZAAR_BLOCKED_RENDER: Array<{ row: number; col: number }> = [
    { row: 4, col: 4 },
];

function lineKey(line: string[]): string {
    return [...line].sort().join("|");
}

/**
 * TZAAR board: hex-of-tri 5×9 with the centre intersection removed from play.
 */
export class TzaarGraph extends HexTriGraph {
    public readonly blocked: Set<string>;
    public readonly blockedCell: string;
    private _lines: string[][] | undefined;
    constructor() {
        super(TZAAR_MIN_WIDTH, TZAAR_MAX_WIDTH, false, true);
        const blocked = new Set<string>();
        const cells = this.listCells(true) as string[][];
        for (const pt of TZAAR_BLOCKED_RENDER) {
            const cell = cells[pt.row]?.[pt.col];
            if (cell !== undefined) {
                blocked.add(cell);
            }
        }
        this.blocked = blocked;
        const [only] = blocked;
        if (only === undefined) {
            throw new Error("TZAAR blocked cell not found on grid.");
        }
        this.blockedCell = only;
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
        const i = line.indexOf(from);
        const j = line.indexOf(to);
        if (i === -1 || j === -1) {
            return undefined;
        }
        const lo = Math.min(i, j);
        const hi = Math.max(i, j);
        return line.slice(lo, hi + 1);
    }

    /** Unique playable intersection lines (deduped). */
    public allLines(): string[][] {
        if (this._lines !== undefined) {
            return this._lines;
        }
        const seen = new Set<string>();
        const lines: string[][] = [];
        for (const node of this.graph.nodes()) {
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

    /** BFS distance from the blocked centre hole (ring 1 = cells touching the hole). */
    public ringDistance(cell: string): number | undefined {
        if (!this.isPlayable(cell)) {
            return undefined;
        }
        const inner = new HexTriGraph(TZAAR_MIN_WIDTH, TZAAR_MAX_WIDTH, false, true).neighbours(this.blockedCell);
        const dist = new Map<string, number>();
        const q: string[] = [];
        for (const c of inner) {
            if (!this.isPlayable(c)) {
                continue;
            }
            dist.set(c, 1);
            q.push(c);
        }
        while (q.length > 0) {
            const cur = q.shift()!;
            const d = dist.get(cur)!;
            for (const nb of this.neighbours(cur)) {
                if (!dist.has(nb)) {
                    dist.set(nb, d + 1);
                    q.push(nb);
                }
            }
        }
        return dist.get(cell);
    }

    public playableCells(): string[] {
        return [...this.graph.nodes()].filter((c) => this.isPlayable(c)).sort();
    }
}