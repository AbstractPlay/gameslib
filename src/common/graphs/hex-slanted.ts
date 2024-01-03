import { UndirectedGraph } from "graphology";
import { bidirectional } from 'graphology-shortest-path/unweighted';
import { IGraph } from "./IGraph";

const columnLabels = "abcdefghijklmnopqrstuvwxyz".split("");
type directions = "NE"|"E"|"SE"|"SW"|"W"|"NW";

export class HexSlantedGraph implements IGraph {
    // Ensure that `options: ["reverse-columns"]` is set in the renderer.
    public readonly width: number;
    public readonly height: number;
    public graph: UndirectedGraph
    public static allDirections: directions[] = ["NE","E","SE","SW","W","NW"];

    constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        this.graph = this.buildGraph();
    }

    public coords2algebraic(x: number, y: number): string {
        return columnLabels[x] + (y + 1).toString();
    }

    public algebraic2coords(cell: string): [number, number] {
        const pair: string[] = cell.split("");
        const num = pair.slice(1).join("");
        const x = columnLabels.indexOf(pair[0]);
        if (x === undefined || x < 0) {
            throw new Error(`The column label is invalid: ${pair[0]}`);
        }
        const y = parseInt(num, 10);
        if (y === undefined || isNaN(y)) {
            throw new Error(`The row label is invalid: ${pair[1]}`);
        }
        return [x, y - 1];
    }

    private buildGraph(): UndirectedGraph {
        // Build the graph
        const graph = new UndirectedGraph();
        // Nodes
        for (let row = 0; row < this.height; row++) {
            for (let col = 0; col < this.width; col++) {
                graph.addNode(this.coords2algebraic(col, row));
            }
        }
        // Edges
        for (let row = 0; row < this.height; row++) {
            for (let col = 0; col < this.width; col++) {
                const fromCell = this.coords2algebraic(col, row);
                // Connect to the left
                if (col > 0) {
                    graph.addEdge(fromCell, this.coords2algebraic(col - 1, row));
                }
                // Connect down
                if (row < this.height - 1) {
                    graph.addEdge(fromCell, this.coords2algebraic(col, row + 1));
                }
                // Down left
                if (row < this.height - 1 && col > 0) {
                    graph.addEdge(fromCell, this.coords2algebraic(col - 1, row + 1));
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
            for (let row = 0; row < this.height; row++) {
                const node: string[] = [];
                for (let col = 0; col < this.width; col++) {
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

    public move(x: number, y: number, direction: directions, dist = 1): [number, number] | undefined {
        let xNew = x;
        let yNew = y;
        switch (direction) {
            case "NE":
                yNew += dist;
                xNew += dist;
                break;
            case "E":
                xNew += dist;
                break;
            case "SE":
                yNew -= dist;
                xNew += dist;
                break;
            case "SW":
                yNew -= dist;
                break;
            case "W":
                xNew -= dist;
                break;
            case "NW":
                yNew += dist;
                break;
        }
        if (xNew < 0 || xNew >= this.width || yNew < 0 || yNew >= this.height) {
            return undefined;
        }
        return [xNew, yNew];
    }

    public ray(x: number, y: number, dir: directions): [number, number][] {
        const cells: [number, number][] = [];
        let next = this.move(x, y, dir);
        while (next !== undefined) {
            cells.push(next);
            next = this.move(...next, dir);
        }
        return cells;
    }
}
