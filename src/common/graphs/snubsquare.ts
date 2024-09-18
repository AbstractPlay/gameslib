import { UndirectedGraph } from "graphology";
import { bidirectional } from 'graphology-shortest-path/unweighted';
import { IGraph } from "./IGraph";
import { algebraic2coords, coords2algebraic } from "..";

export type SnubStart = "S"|"T";

export class SnubSquareGraph implements IGraph {
    public readonly width: number;
    public readonly height: number;
    public readonly start: SnubStart;
    public graph: UndirectedGraph

    constructor(width: number, height: number, start: SnubStart = "S") {
        this.width = width;
        this.height = height;
        this.start = start;
        this.graph = this.buildGraph();
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
                const curr = this.coords2algebraic(col, row);
                // always connect to previous cell
                if (col > 0) {
                    graph.addEdge(curr, this.coords2algebraic(col - 1, row));
                }

                if (row > 0) {
                    // always connect to cell directly above
                    graph.addEdge(curr, this.coords2algebraic(col, row - 1));
                    if (this.start === "S") {
                        // even row, odd columns connect as well to previous-above cell
                        if ( ( (row % 2) === 0) && ( (col % 2) !== 0) ) {
                            graph.addEdge(curr, this.coords2algebraic(col - 1, row - 1));
                        // odd row, odd columns connect to previous-next cell
                        } else if ( ((row % 2) !== 0) && ((col % 2) !== 0) && (col < (this.width - 1)) ) {
                            graph.addEdge(curr, this.coords2algebraic(col + 1, row - 1));
                        }
                    } else {
                        // even row, even columns > 0 connect as well to previous-above cell
                        if ( ( (row % 2) === 0) && ( (col % 2) === 0) && col > 0) {
                            graph.addEdge(curr, this.coords2algebraic(col - 1, row - 1));
                        // odd row, even columns connect to previous-next cell
                        } else if ( ((row % 2) !== 0) && ((col % 2) === 0) && (col < (this.width - 1)) ) {
                            graph.addEdge(curr, this.coords2algebraic(col + 1, row - 1));
                        }
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
