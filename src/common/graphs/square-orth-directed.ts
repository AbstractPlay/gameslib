import { DirectedGraph } from "graphology";
import { bidirectional } from 'graphology-shortest-path/unweighted';
import { IGraph } from "./IGraph";
import { algebraic2coords, coords2algebraic } from "..";
import { Direction as Direction } from "..";

export type EdgeData = {
    type: "orth",
    direction: Direction;
};

/**
 * This graph is useful when you have a game where you want to allow ingress
 * to a cell but not egress.
 */

export class SquareOrthDirectedGraph implements IGraph {
    public readonly width: number;
    public readonly height: number;
    public graph: DirectedGraph;

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

    public static allDirs = ["N", "E", "S", "W"];

    private buildGraph(): DirectedGraph {
        // Build the graph
        const graph = new DirectedGraph();
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
                    const toCell = this.coords2algebraic(col + 1, row)
                    graph.addEdgeWithKey(`${fromCell}>${toCell}`, fromCell, toCell, {type: "orth", direction: "E"} as EdgeData);
                    graph.addEdgeWithKey(`${toCell}>${fromCell}`, toCell, fromCell, {type: "orth", direction: "W"} as EdgeData);
                }
                // Connect up
                if (row > 0) {
                    const toCell = this.coords2algebraic(col, row - 1);
                    graph.addEdgeWithKey(`${fromCell}>${toCell}`, fromCell, toCell, {type: "orth", direction: "N"} as EdgeData);
                    graph.addEdgeWithKey(`${toCell}>${fromCell}`, toCell, fromCell, {type: "orth", direction: "S"} as EdgeData);
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

    public move(from: string, dir: Direction, dist = 1): string|undefined {
        let interim = from;
        for (let i = 0; i < dist; i++) {
            // find the edge going in the right direction
            const edge = this.graph.outEdges(interim).find(e => this.graph.getEdgeAttribute(e, "direction") === dir);
            // return the next cell or undefined
            if (edge === undefined) {
                return undefined;
            }
            const next = this.graph.extremities(edge).find(n => n !== from);
            if (next === undefined) {
                return undefined;
            }
            interim = next;
        }
        return interim;
    }

    public ray(start: string, dir: Direction, includeFirst = false): string[] {
        const cells: string[] = includeFirst ? [start] : [];
        let next = this.move(start, dir);
        while (next !== undefined) {
            cells.push(next);
            next = this.move(next, dir);
        }
        return cells;
    }
}
