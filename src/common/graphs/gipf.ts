import { HexTriGraph, type HexDir } from "./hextri.js";

/**
 * GIPF board connectivity: same 5×9 hex-of-tri grid as {@link HexTriGraph}, but edges
 * between two perimeter dots are omitted (matches renderer `gipf` board / `gipfShouldOmitPerimeterChord`).
 */
export class GipfGraph extends HexTriGraph {
    private _lines: string[][] | undefined;

    constructor() {
        super(5, 9, false, true);
        const drop: Array<[string, string]> = [];
        this.graph.forEachEdge((_, __, source, target) => {
            if (this.isDot(source) && this.isDot(target)) {
                drop.push([source, target]);
            }
        });
        for (const [a, b] of drop) {
            if (this.graph.hasEdge(a, b)) {
                this.graph.dropEdge(a, b);
            }
        }
    }

    public isDot(cell: string): boolean {
        return this.distFromEdge(cell) === 0;
    }

    public isSpot(cell: string): boolean {
        return !this.isDot(cell);
    }

    /** Ordered cells from `dot` through opposite dot, including both endpoints. */
    public traceLine(dot: string, firstStep: string): string[] {
        if (!this.isDot(dot)) {
            throw new Error(`Expected a dot: ${dot}`);
        }
        const dir = this.bearing(dot, firstStep);
        if (dir === undefined) {
            return [dot, firstStep];
        }
        const [x, y] = this.algebraic2coords(dot);
        return this.ray(x, y, dir, true).map((c) => this.coords2algebraic(...c));
    }

    /** Neighbour spots/dots reachable from a dot along GIPF lines (one step inward). */
    public dotEntrySteps(dot: string): string[] {
        return this.neighbours(dot).filter((n) => this.graph.hasEdge(dot, n));
    }

    /** Unique GIPF lines (dot → spots → dot). */
    public allLines(): string[][] {
        if (this._lines !== undefined) {
            return this._lines;
        }
        const seen = new Set<string>();
        const lines: string[][] = [];
        for (const node of this.graph.nodes()) {
            if (!this.isDot(node)) {
                continue;
            }
            for (const step of this.dotEntrySteps(node)) {
                const line = this.traceLine(node, step);
                if (line.length < 2) {
                    continue;
                }
                const key = [...line].sort().join("|");
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

    /** Cells between two dots on the same line (spots only, in order from `fromDot`). */
    public lineBetweenDots(fromDot: string, toCell: string): string[] | undefined {
        for (const step of this.dotEntrySteps(fromDot)) {
            const line = this.traceLine(fromDot, step);
            const idx = line.indexOf(toCell);
            if (idx !== -1) {
                return line;
            }
        }
        return undefined;
    }

    public directionOnLine(from: string, to: string): HexDir | undefined {
        return this.bearing(from, to);
    }
}