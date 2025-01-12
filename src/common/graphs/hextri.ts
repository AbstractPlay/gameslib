import { UndirectedGraph } from "graphology";
import { bidirectional } from 'graphology-shortest-path/unweighted';
import { IGraph } from "./IGraph";

const columnLabels = "abcdefghijklmnopqrstuvwxyz".split("");
export type Edge = "N"|"NE"|"SE"|"S"|"SW"|"NW";
export type HexDir = "NE"|"E"|"SE"|"SW"|"W"|"NW";

export class HexTriGraph implements IGraph {
    public readonly minwidth: number;
    public readonly maxwidth: number;
    public readonly height: number;
    public readonly midrow: number; // zero-based index of widest row
    public readonly alternating: boolean;
    public readonly perimeter: number;
    public graph: UndirectedGraph

    constructor(minwidth: number, maxwidth: number, alternating = false) {
        if (minwidth >= maxwidth) {
            throw new Error("The minimum width must be strictly less than the maximum width.");
        }
        this.alternating = alternating;
        this.minwidth = minwidth;
        this.maxwidth = maxwidth;
        if (!alternating) {
            this.height = ((maxwidth - minwidth) * 2) + 1;
            this.midrow = Math.floor(this.height / 2);
            // this.perimeter = (minwidth * 6) - 6;
            this.perimeter = (minwidth * 2) + ((this.height - 2) * 2);
        } else {
            const numTop = maxwidth - minwidth + 1
            const numBottom = maxwidth - numTop;
            this.height = numTop + numBottom;
            this.midrow = maxwidth - minwidth;
            const widthBottom = maxwidth - numBottom;
            this.perimeter = minwidth + widthBottom + ((this.height - 2) * 2);
        }
        this.graph = this.buildGraph();
    }

    public static directions: HexDir[] = ["NE","E","SE","SW","W","NW"];

    public coords2algebraic(x: number, y: number): string {
        return columnLabels[this.height - y - 1] + (x + 1).toString();
    }

    public algebraic2coords(cell: string): [number, number] {
        const pair: string[] = cell.split("");
        const num = (pair.slice(1)).join("");
        const x = Number(num);
        if ( (x === undefined) || (isNaN(x)) || num === "" ) {
            throw new Error(`The column label is invalid: ${num}`);
        }
        const y = columnLabels.indexOf(pair[0]);
        if ( (y === undefined) || (y < 0) ) {
            throw new Error(`The row label is invalid: ${pair[0]}`);
        }

        const realY = this.height - y - 1;
        const delta = Math.abs(realY - this.midrow);
        const rowWidth = this.maxwidth - delta;
        if ( (x < 0) || (x > rowWidth) ) {
            throw new Error(`The column label is invalid: ${num}`);
        }

        return [x - 1, realY];
    }

    private buildGraph(): UndirectedGraph {
        // Build the graph
        const graph = new UndirectedGraph();

        // Nodes
        const delta = this.maxwidth - this.minwidth;
        for (let row = 0; row < this.height; row++) {
            const rowWidth = this.minwidth + (this.midrow - Math.abs(delta - row));
            for (let col = 0; col < rowWidth; col++) {
                graph.addNode(this.coords2algebraic(col, row));
            }
        }

        // Edges
        for (let row = 0; row < this.height; row++) {
            const rowWidth = this.minwidth + (this.midrow - Math.abs(delta - row));
            const prevWidth = this.minwidth + (this.midrow - Math.abs(delta - (row - 1)));
            for (let col = 0; col < rowWidth; col++) {
                const curr = this.coords2algebraic(col, row);

                // always connect to cell to the left
                if (col > 0) {
                    graph.addEdge(curr, this.coords2algebraic(col - 1, row));
                }

                // connections are built upward, so only continue with rows after the first
                if (row > 0) {
                    // always connect to the cell directly above, if one exists
                    if (col < prevWidth) {
                        graph.addEdge(curr, this.coords2algebraic(col, row - 1));
                    }
                    // up to and including the midline, connect to the above-previous cell if there is one
                    if ( (row <= this.midrow) && (col > 0) ) {
                        graph.addEdge(curr, this.coords2algebraic(col - 1, row - 1));
                    }
                    // after the midline, connect to the above-next cell instead
                    if (row > this.midrow) {
                        graph.addEdge(curr, this.coords2algebraic(col + 1, row - 1));
                    }
                }
            }
        }
        return graph;
    }

    public listCells(ordered = false): string[] | string[][] {
        if (! ordered) {
            return this.graph.nodes();
        } else {
            const result: string[][] = [];
            const delta = this.maxwidth - this.minwidth;
            for (let row = 0; row < this.height; row++) {
                const node: string[] = [];
                const rowWidth = this.minwidth + (this.midrow - Math.abs(delta - row));
                for (let col = 0; col < rowWidth; col++) {
                    node.push(this.coords2algebraic(col, row));
                }
                result.push(node);
            }
            return result;
        }
    }

    public neighbours(node: string): string[] {
        return this.graph.neighbors(node);
    }

    public path(from: string, to: string): string[] | null {
        return bidirectional(this.graph, from, to);
    }

    public edgePath(from: string, to: string): string[] | null {
        const graph = this.buildGraph();
        for (const node of graph.nodes()) {
            if (this.distFromEdge(node) !== 0) {
                graph.dropNode(node);
            }
        }
        return bidirectional(graph, from, to);
    }

    public bearing(from: string, to: string): HexDir|undefined {
        // Returns the direction from one cell to another
        const coords = this.algebraic2coords(from);
        for (const dir of ["NE", "E", "SE", "SW", "W", "NW"] as const) {
            const ray = this.ray(...coords, dir).map(cell => this.coords2algebraic(...cell));
            if (ray.includes(to)) { return dir; }
        }
        return undefined;
    }

    public move(x: number, y: number, dir: HexDir, dist = 1): [number, number] | undefined {
        let xNew = x;
        let yNew = y;
        for (let i = 0; i < dist; i++) {
            switch (dir) {
                case "NE":
                    if (yNew <= this.midrow) {
                        yNew--;
                    } else {
                        yNew--;
                        xNew++;
                    }
                    break;
                case "E":
                    xNew++;
                    break;
                case "SE":
                    if (yNew >= this.midrow) {
                        yNew++;
                    } else {
                        yNew++;
                        xNew++;
                    }
                    break;
                case "SW":
                    if (yNew < this.midrow) {
                        yNew++;
                    } else {
                        yNew++;
                        xNew--;
                    }
                    break;
                case "W":
                    xNew--;
                    break;
                case "NW":
                    if (yNew <= this.midrow) {
                        yNew--;
                        xNew--;
                    } else {
                        yNew--;
                    }
                    break;
                default:
                    throw new Error("Invalid direction requested.");
            }
            if ( (yNew < 0) || (yNew >= this.height) ) {
                return undefined;
            }
            const delta = this.maxwidth - this.minwidth;
            const rowWidth = this.minwidth + (this.midrow - Math.abs(delta - yNew));
            if ( (xNew < 0) || (xNew >= rowWidth) ) {
                return undefined;
            }
        }
        return [xNew, yNew];
    }

    public ray(x: number, y: number, dir: HexDir, includeFirst = false): [number, number][] {
        const cells: [number, number][] = includeFirst ? [[x, y]] : [];
        let next = this.move(x, y, dir);
        while (next !== undefined) {
            cells.push(next);
            next = this.move(...next, dir);
        }
        return cells;
    }

    public distFromEdge(cell: string): number {
        let min = Infinity;
        for (const dir of ["NE","E","SE","SW","W","NW"] as const) {
            const ray = this.ray(...this.algebraic2coords(cell), dir);
            min = Math.min(min, ray.length);
            if (min === 0) { break; }
        }
        return min;
    }

    public getEdges(): Map<Edge, string[]> {
        const edges = new Map<Edge, string[]>();
        for (const dir of ["N","NE","SE","S","SW","NW"] as const) {
            edges.set(dir, []);
        }
        const ordered = this.listCells(true) as string[][];
        for (let y = 0; y < ordered.length; y++) {
            if (y === 0) {
                edges.set("N", [...ordered[y]]);
            }
            if (y === ordered.length - 1) {
                edges.set("S", [...ordered[y]])
            }
            if (y <= this.midrow) {
                const currNW = edges.get("NW")!;
                edges.set("NW", [...currNW, ordered[y][0]]);
                const currNE = edges.get("NE")!;
                edges.set("NE", [...currNE, ordered[y][ordered[y].length - 1]]);
            }
            if (y >= this.midrow) {
                const currSW = edges.get("SW")!;
                edges.set("SW", [...currSW, ordered[y][0]]);
                const currSE = edges.get("SE")!;
                edges.set("SE", [...currSE, ordered[y][ordered[y].length - 1]]);
            }
        }
        return edges;
    }

    public rot180(cell: string): string {
        const [x, y] = this.algebraic2coords(cell);
        const row = this.height - 1 - y;
        const midrow = Math.floor(this.height / 2);
        const delta = this.maxwidth - this.minwidth;
        const rowWidth = this.minwidth + (midrow - Math.abs(delta - row));
        const col = rowWidth - 1 - x;
        return this.coords2algebraic(col, row);
    }
}
