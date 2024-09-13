import { UndirectedGraph } from "graphology";
import { bidirectional } from 'graphology-shortest-path/unweighted';
import { IGraph } from "./IGraph";

const columnLabels = "abcdefghijklmnopqrstuvwxyz".split("");

type Edge = "N"|"NE"|"SE"|"S"|"SW"|"NW";

export class HexMoonGraph implements IGraph {
    public readonly minwidth = 5;
    public readonly maxwidth = 9;
    public readonly height: number;
    public readonly perimeter: number;
    public graph: UndirectedGraph

    constructor() {
        this.perimeter = (this.minwidth * 6) - 6;
        this.height = ((this.maxwidth - this.minwidth) * 2) + 1;
        this.graph = this.buildGraph();
    }

    public coords2algebraic(x: number, y: number, override = false): string {
        if (y === 4 && !override) {
            if (x >= 4) {
                if (x === 4) {
                    return "e5a";
                } else if (x === 5) {
                    return "e5b";
                } else if (x === 6) {
                    return "e5c";
                } else {
                    return `e${x - 1}`;
                }
            } else {
                return `e${x + 1}`;
            }
        } else {
            return columnLabels[this.height - y - 1] + (x + 1).toString();
        }
    }

    public algebraic2coords(cell: string): [number, number] {
        const pair: string[] = cell.split("");
        if (pair.length === 3) {
            const suffix = pair[2].toLowerCase();
            if (suffix === "a") {
                return [4, 4];
            } else if (suffix === "b") {
                return [5, 4];
            } else if (suffix === "c") {
                return [6, 4];
            } else {
                throw new Error("Unrecognized cell suffix.");
            }
        } else {
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

            if (pair[0] === "e" && x > 5) {
                return [x + 1, this.height - y - 1];
            } else {
                return [x - 1, this.height - y - 1];
            }
        }
    }

    private buildGraph(): UndirectedGraph {
        // Build the graph
        // start with a standard hexhex then adjust
        const graph = new UndirectedGraph();
        // Nodes
        const midrow = Math.floor(this.height / 2);
        const delta = this.maxwidth - this.minwidth;
        for (let row = 0; row < this.height; row++) {
            const rowWidth = this.minwidth + (midrow - Math.abs(delta - row));
            for (let col = 0; col < rowWidth; col++) {
                graph.addNode(this.coords2algebraic(col, row, true));
            }
        }
        // Edges
        for (let row = 0; row < this.height; row++) {
            const rowWidth = this.minwidth + (midrow - Math.abs(delta - row));
            const prevWidth = this.minwidth + (midrow - Math.abs(delta - (row - 1)));
            for (let col = 0; col < rowWidth; col++) {
                const curr = this.coords2algebraic(col, row, true);

                // always connect to cell to the left
                if (col > 0) {
                    graph.addEdge(curr, this.coords2algebraic(col - 1, row, true));
                }

                // connections are built upward, so only continue with rows after the first
                if (row > 0) {
                    // always connect to the cell directly above, if one exists
                    if (col < prevWidth) {
                        graph.addEdge(curr, this.coords2algebraic(col, row - 1, true));
                    }
                    // up to and including the midline, connect to the above-previous cell if there is one
                    if ( (row <= midrow) && (col > 0) ) {
                        graph.addEdge(curr, this.coords2algebraic(col - 1, row - 1, true));
                    }
                    // after the midline, connect to the above-next cell instead
                    if (row > midrow) {
                        graph.addEdge(curr, this.coords2algebraic(col + 1, row - 1, true));
                    }
                }
            }
        }

        // adjust for moon board
        graph.dropNode("e5");
        graph.addNode("e5a");
        graph.addNode("e5b");
        graph.addNode("e5c");

        graph.addEdge("e5a", "e5b");
        graph.addEdge("e5a", "e5c");
        graph.addEdge("e5a", "e4");
        graph.addEdge("e5a", "f4");
        graph.addEdge("e5a", "f5");

        graph.addEdge("e5b", "e5c");
        graph.addEdge("e5b", "f5");
        graph.addEdge("e5b", "e6");
        graph.addEdge("e5b", "d5");

        graph.addEdge("e5c", "e4");
        graph.addEdge("e5c", "d4");
        graph.addEdge("e5c", "d5");

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

    public getEdges(): Map<Edge, string[]> {
        const edges = new Map<Edge, string[]>();
        for (const dir of ["N","NE","SE","S","SW","NW"] as const) {
            edges.set(dir, []);
        }
        const midrow = Math.floor(this.height / 2);
        const ordered = this.listCells(true) as string[][];
        for (let y = 0; y < ordered.length; y++) {
            if (y === 0) {
                edges.set("N", [...ordered[y]]);
            }
            if (y === ordered.length - 1) {
                edges.set("S", [...ordered[y]])
            }
            if (y <= midrow) {
                const currNW = edges.get("NW")!;
                edges.set("NW", [...currNW, ordered[y][0]]);
                const currNE = edges.get("NE")!;
                edges.set("NE", [...currNE, ordered[y][ordered[y].length - 1]]);
            }
            if (y >= midrow) {
                const currSW = edges.get("SW")!;
                edges.set("SW", [...currSW, ordered[y][0]]);
                const currSE = edges.get("SE")!;
                edges.set("SE", [...currSE, ordered[y][ordered[y].length - 1]]);
            }
        }
        return edges;
    }

    public distFromEdge(cell: string): number {
        let min = Infinity;
        const edges = this.getEdges();
        for (const dir of ["N","NE","SE","S","SW","NW"] as const) {
            for (const edge of edges.get(dir)!) {
                const path = this.path(cell, edge);
                if (path !== null) {
                    min = Math.min(min, path.length);
                }
                if (min === 0) { return 0; }
            }
        }
        return min;
    }
}
