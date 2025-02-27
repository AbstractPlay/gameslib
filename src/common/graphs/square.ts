import { UndirectedGraph } from "graphology";
import { bidirectional } from 'graphology-shortest-path/unweighted';
import { IGraph } from "./IGraph";
import { algebraic2coords, coords2algebraic } from "..";

export type EdgeData = {
    type: "orth"|"diag";
};

export class SquareGraph implements IGraph {
    public readonly width: number;
    public readonly height: number;
    public graph: UndirectedGraph

    constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        this.graph = this.buildGraph();
    }

    public coords2algebraic(x: number, y: number): string {
        return coords2algebraic(x, y, this.height);
    }

    public algebraic2coords(cell: string): [number, number] {
        return algebraic2coords(cell, this.height);
    }

    public static allDirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

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
                // Connect to the right
                if (col < this.width - 1) {
                    graph.addEdge(fromCell, this.coords2algebraic(col + 1, row), {type: "orth"} as EdgeData);
                }
                // Connect up
                if (row > 0) {
                    graph.addEdge(fromCell, this.coords2algebraic(col, row - 1), {type: "orth"} as EdgeData);
                }
                // Up right
                if ( (row > 0) && (col < this.width - 1) ) {
                    graph.addEdge(fromCell, this.coords2algebraic(col + 1, row - 1), {type: "diag"} as EdgeData);
                }
                // Up left
                if ( (row > 0) && (col > 0) ) {
                    graph.addEdge(fromCell, this.coords2algebraic(col - 1, row - 1), {type: "diag"} as EdgeData);
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
}
