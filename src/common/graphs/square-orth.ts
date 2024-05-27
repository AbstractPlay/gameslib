import { UndirectedGraph } from "graphology";
import { bidirectional } from 'graphology-shortest-path/unweighted';
import {connectedComponents} from 'graphology-components';
import { Directions } from "..";
import { IGraph } from "./IGraph";

const columnLabels = "abcdefghijklmnopqrstuvwxyz".split("");

export class SquareOrthGraph implements IGraph {
    public readonly width: number;
    public readonly height: number;
    public graph: UndirectedGraph

    constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        this.graph = this.buildGraph();
    }

    public coords2algebraic(x: number, y: number): string {
        return columnLabels[x] + (this.height - y).toString();
    }

    public algebraic2coords(cell: string): [number, number] {
        const pair: string[] = cell.split("");
        const num = (pair.slice(1)).join("");
        const x = columnLabels.indexOf(pair[0]);
        if ( (x === undefined) || (x < 0) ) {
            throw new Error(`The column label is invalid: ${pair[0]}`);
        }
        const y = Number(num);
        if ( (y === undefined) || (isNaN(y)) || num === "" ) {
            throw new Error(`The row label is invalid: ${pair[1]}`);
        }
        return [x, this.height - y];
    }

    private buildGraph(): UndirectedGraph {
        // Build the graph
        // Orthogonal connections only
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
                // Connect to the right
                if (col < this.width - 1) {
                    graph.addEdge(fromCell, this.coords2algebraic(col + 1, row));
                }
                // Connect up
                if (row > 0) {
                    graph.addEdge(fromCell, this.coords2algebraic(col, row - 1));
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

    public path(from: string, to: string, drop: string[] = []): string[] | null {
        drop.forEach(n => this.graph.dropNode(n));
        return bidirectional(this.graph, from, to);
    }

    public bearing(from: string, to: string): Directions | undefined {
        const [xFrom, yFrom] = this.algebraic2coords(from);
        const [xTo, yTo] = this.algebraic2coords(to);
        let dstr = "";
        if (yTo > yFrom) {
            dstr += "S";
        } else if (yTo < yFrom) {
            dstr += "N";
        }
        if (xTo > xFrom) {
            dstr += "E";
        } else if (xTo < xFrom) {
            dstr += "W";
        }
        if (dstr === "") {
            return undefined;
        }
        return dstr as Directions;
    }

    public isConnected(): boolean {
        const connected = connectedComponents(this.graph);
        return connected.length === 1;
    }

    public move(x: number, y: number, dir: "N"|"E"|"S"|"W", dist = 1): [number, number] | undefined {
        let xNew = x;
        let yNew = y;
        for (let i = 0; i < dist; i++) {
            switch (dir) {
                case "N":
                    yNew--;
                    break;
                case "E":
                    xNew++;
                    break;
                case "S":
                    yNew++;
                    break;
                case "W":
                    xNew--;
                    break;
                default:
                    throw new Error("Invalid direction requested.");
            }
            if ((yNew < 0) || (yNew >= this.height)) {
                return undefined;
            }
            if ((xNew < 0) || (xNew >= this.width)) {
                return undefined;
            }
        }
        return [xNew, yNew];
    }

    public ray(x: number, y: number, dir: "N"|"E"|"S"|"W"): [number, number][] {
        const cells: [number, number][] = [];
        let next = this.move(x, y, dir);
        while (next !== undefined) {
            cells.push(next);
            next = this.move(...next, dir);
        }
        return cells;
    }
}
