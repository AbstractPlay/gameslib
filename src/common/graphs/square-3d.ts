import { UndirectedGraph } from "graphology";
import { bidirectional } from 'graphology-shortest-path/unweighted';
import { IGraph3D } from "./IGraph3D";
import { algebraic2coords, coords2algebraic } from "..";

export class Square3DGraph implements IGraph3D {
    public readonly width: number;
    public readonly height: number;
    public graph: UndirectedGraph

    constructor(width: number, height: number, heightmap: number[][]) {
        this.width = width;
        this.height = height;
        this.graph = this.buildGraph();
        // apply heightmap
        for (let row = 0; row < this.height; row++) {
            for (let col = 0; col < this.width; col++) {
                if (heightmap[row][col] === undefined) {
                    throw new Error("Heightmap does not match the graph dimensions");
                }
                if (typeof heightmap[row][col] !== 'number') {
                    throw new Error("Heightmap must be a 2D array of numbers");
                }
                const cell = this.coords2algebraic(col, row);
                this.graph.setNodeAttribute(cell, 'elevation', heightmap[row][col]);
            }
        }
    }

    public elevation(cell: string | [number, number]): number {
        let cellStr: string;
        if (typeof cell === 'string') {
            cellStr = cell;
        } else {
            cellStr = this.coords2algebraic(...cell);
        }
        return this.graph.getNodeAttribute(cellStr, 'elevation') as number;
    }

    public coords2algebraic(x: number, y: number): string {
        return coords2algebraic(x, y, this.height);
    }

    public algebraic2coords(cell: string): [number, number] {
        return algebraic2coords(cell, this.height);
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
                // Connect to the right
                if (col < this.width - 1) {
                    graph.addEdge(fromCell, this.coords2algebraic(col + 1, row));
                }
                // Connect up
                if (row > 0) {
                    graph.addEdge(fromCell, this.coords2algebraic(col, row - 1));
                }
                // Up right
                if ( (row > 0) && (col < this.width - 1) ) {
                    graph.addEdge(fromCell, this.coords2algebraic(col + 1, row - 1));
                }
                // Up left
                if ( (row > 0) && (col > 0) ) {
                    graph.addEdge(fromCell, this.coords2algebraic(col - 1, row - 1));
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
