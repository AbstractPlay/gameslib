import { UndirectedGraph } from "graphology";
import bidirectional from 'graphology-shortest-path/unweighted';
import { IGraph } from "./IGraph";

const columnLabels = "abcdefghijklmnopqrstuvwxyz".split("");

export class HexTriGraph implements IGraph {
    public readonly minwidth: number;
    public readonly maxwidth: number;
    public readonly height: number;
    public graph: UndirectedGraph

    constructor(minwidth: number, maxwidth: number) {
        if (minwidth >= maxwidth) {
            throw new Error("The minimum width must be strictly less than the maximum width.");
        }
        this.minwidth = minwidth;
        this.maxwidth = maxwidth;
        this.height = ((maxwidth - minwidth) * 2) + 1;
        this.graph = this.buildGraph();
    }

    public coords2algebraic(x: number, y: number): string {
        return columnLabels[this.height - y - 1] + (x + 1).toString();
    }

    public algebraic2coords(cell: string): [number, number] {
        const pair: string[] = cell.split("");
        const num = (pair.slice(1)).join("");
        const x = parseInt(num, 10);
        if ( (x === undefined) || (isNaN(x)) ) {
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

                // connections are build upward, so only continue with rows after the first
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

    public move(x: number, y: number, dir: "NE"|"E"|"SE"|"SW"|"W"|"NW", dist = 1): [number, number] | undefined {
        const midrow = Math.floor(this.height / 2);
        let xNew = x;
        let yNew = y;
        switch (dir) {
            case "NE":
                if (y <= midrow) {
                    yNew -= dist;
                } else {
                    yNew -= dist;
                    xNew += dist
                }
                break;
            case "E":
                xNew += dist;
                break;
            case "SE":
                if (y >= midrow) {
                    yNew += dist;
                } else {
                    yNew += dist;
                    xNew += dist;
                }
                break;
            case "SW":
                if (y < midrow) {
                    yNew += dist;
                } else {
                    yNew += dist;
                    xNew -= dist;
                }
                break;
            case "W":
                xNew -= dist;
                break;
            case "NW":
                if (y <= midrow) {
                    yNew -= dist;
                    xNew -= dist;
                } else {
                    yNew -= dist
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
}
