import { UndirectedGraph } from "graphology";
import { bidirectional } from 'graphology-shortest-path/unweighted';
import { IGraph } from "./IGraph";

const columnLabels = "abcdefghijklmnopqrstuvwxyz".split("");

export class HexTriGraph implements IGraph {
    public readonly minwidth: number;
    public readonly maxwidth: number;
    public readonly height: number;
    public readonly perimeter: number;
    public graph: UndirectedGraph

    constructor(minwidth: number, maxwidth: number) {
        if (minwidth >= maxwidth) {
            throw new Error("The minimum width must be strictly less than the maximum width.");
        }
        this.minwidth = minwidth;
        this.perimeter = (minwidth * 6) - 6;
        this.maxwidth = maxwidth;
        this.height = ((maxwidth - minwidth) * 2) + 1;
        this.graph = this.buildGraph();
    }

    public static directions: ("NE"|"E"|"SE"|"SW"|"W"|"NW")[] = ["NE","E","SE","SW","W","NW"];

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

        const midrow = Math.floor(this.height / 2);
        const delta = this.maxwidth - this.minwidth;
        const rowWidth = this.minwidth + (midrow - Math.abs(delta - y));
        if ( (x < 0) || (x > rowWidth) ) {
            throw new Error(`The column label is invalid: ${num}`);
        }

        return [x - 1, this.height - y - 1];
    }

    private buildGraph(): UndirectedGraph {
        // Build the graph
        const graph = new UndirectedGraph();
        // Nodes
        const midrow = Math.floor(this.height / 2);
        const delta = this.maxwidth - this.minwidth;
        for (let row = 0; row < this.height; row++) {
            const rowWidth = this.minwidth + (midrow - Math.abs(delta - row));
            for (let col = 0; col < rowWidth; col++) {
                graph.addNode(this.coords2algebraic(col, row));
            }
        }
        // Edges
        for (let row = 0; row < this.height; row++) {
            const rowWidth = this.minwidth + (midrow - Math.abs(delta - row));
            const prevWidth = this.minwidth + (midrow - Math.abs(delta - (row - 1)));
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
                    if ( (row <= midrow) && (col > 0) ) {
                        graph.addEdge(curr, this.coords2algebraic(col - 1, row - 1));
                    }
                    // after the midline, connect to the above-next cell instead
                    if (row > midrow) {
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
            const midrow = Math.floor(this.height / 2);
            const delta = this.maxwidth - this.minwidth;
            for (let row = 0; row < this.height; row++) {
                const node: string[] = [];
                const rowWidth = this.minwidth + (midrow - Math.abs(delta - row));
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

    public move(x: number, y: number, dir: "NE"|"E"|"SE"|"SW"|"W"|"NW", dist = 1): [number, number] | undefined {
        const midrow = Math.floor(this.height / 2);
        let xNew = x;
        let yNew = y;
        for (let i = 0; i < dist; i++) {
            switch (dir) {
                case "NE":
                    if (yNew <= midrow) {
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
                    if (yNew >= midrow) {
                        yNew++;
                    } else {
                        yNew++;
                        xNew++;
                    }
                    break;
                case "SW":
                    if (yNew < midrow) {
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
                    if (yNew <= midrow) {
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
            const rowWidth = this.minwidth + (midrow - Math.abs(delta - yNew));
            if ( (xNew < 0) || (xNew >= rowWidth) ) {
                return undefined;
            }
        }
        return [xNew, yNew];
    }

    public ray(x: number, y: number, dir: "NE"|"E"|"SE"|"SW"|"W"|"NW"): [number, number][] {
        const cells: [number, number][] = [];
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
