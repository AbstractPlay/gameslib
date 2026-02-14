import { DirectedGraph } from "graphology";
import { bidirectional } from 'graphology-shortest-path/unweighted';
import { IGraph } from "./IGraph";
import { algebraic2coords, coords2algebraic } from "..";
import { Direction as Direction } from "..";

export type EdgeData = {
    type: "orth"|"diag";
    direction: Direction;
};

export type ConstructorOpts = {
    width: number;
    height: number;
    start?: "W"|"N";
    reverseNumbers?: boolean;
    edgeConnections?: boolean;
}

/**
 * Using directed graphs for this one because it is not at all intuitive
 * how to calculate the next cell in a given direction mathematically.
 */

export class RectTriGraph implements IGraph {
    public readonly width: number;
    public readonly height: number;
    public readonly start: "W"|"N";
    public readonly edgeConnections: boolean;
    public graph: DirectedGraph;
    private _reverseNumbers = false;

    constructor(opts: ConstructorOpts) {
        const {width, height, start, reverseNumbers, edgeConnections} = opts;
        this.start = start ?? "W";
        this.reverseNumbers = reverseNumbers ?? false;
        this.edgeConnections = edgeConnections ?? true;
        this.width = width;
        this.height = height;
        this.graph = this.buildGraph();
    }

    public coords2algebraic(x: number, y: number): string {
        const isWide = (this.start === "W") ? (y % 2 === 0) : (y % 2 === 1);
        if (isWide) {
            x = x * 2;
        } else {
            x = (x * 2) + 1;
        }
        return coords2algebraic(x, y, this.height, this.reverseNumbers);
    }

    public algebraic2coords(cell: string): [number, number] {
        // eslint-disable-next-line prefer-const
        let [x, y] = algebraic2coords(cell, this.height, this.reverseNumbers);
        const isWide = (this.start === "W") ? (y % 2 === 0) : (y % 2 === 1);
        if (isWide) {
            x = x / 2;
        } else {
            x = (x - 1) / 2;
        }
        return [x, y];
    }

    public set reverseNumbers(val: boolean) {
        this._reverseNumbers = val;
    }

    public get reverseNumbers(): boolean {
        return this._reverseNumbers;
    }

    public static allDirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

    private buildGraph(): DirectedGraph {
        // Build the graph
        const graph = new DirectedGraph();
        // Nodes
        for (let row = 0; row < this.height; row++) {
            const isWide = (this.start === "W") ? (row % 2 === 0) : (row % 2 === 1);
            for (let col = 0; col < (isWide ? this.width : this.width - 1); col++) {
                graph.addNode(this.coords2algebraic(col, row));
            }
        }

        // Edges
        // const toCell = this.coords2algebraic(col + 1, row)
        // graph.addEdgeWithKey(`${fromCell}>${toCell}`, fromCell, toCell, {type: "orth", direction: "E"} as EdgeData);
        // graph.addEdgeWithKey(`${toCell}>${fromCell}`, toCell, fromCell, {type: "orth", direction: "W"} as EdgeData);
        for (let row = 0; row < this.height; row++) {
            const isWide = (this.start === "W") ? (row % 2 === 0) : (row % 2 === 1);
            for (let col = 0; col < (isWide ? this.width : this.width - 1); col++) {
                const fromCell = this.coords2algebraic(col, row);

                // always connect to cell to the left
                if (col > 0) {
                    const toCell = this.coords2algebraic(col - 1, row);
                    graph.addEdgeWithKey(`${fromCell}>${toCell}`, fromCell, toCell, {type: "orth", direction: "W"} as EdgeData);
                    graph.addEdgeWithKey(`${toCell}>${fromCell}`, toCell, fromCell, {type: "orth", direction: "E"} as EdgeData);
                }

                // connections are built upward, so only continue with rows after the first
                if (row > 0) {
                    // wide rows connect directly above and one to the left if possible
                    // wide rows also connect to the outer point two rows up, if possible
                    if (isWide) {
                        // directly above possible for every point except the last
                        if (col < this.width - 1) {
                            const toCell = this.coords2algebraic(col, row - 1);
                            graph.addEdgeWithKey(`${fromCell}>${toCell}`, fromCell, toCell, {type: "diag", direction: "NE"} as EdgeData);
                            graph.addEdgeWithKey(`${toCell}>${fromCell}`, toCell, fromCell, {type: "diag", direction: "SW"} as EdgeData);
                        }
                        // above and to the left good for all but the first
                        if (col > 0) {
                            const toCell = this.coords2algebraic(col - 1, row - 1);
                            graph.addEdgeWithKey(`${fromCell}>${toCell}`, fromCell, toCell, {type: "diag", direction: "NW"} as EdgeData);
                            graph.addEdgeWithKey(`${toCell}>${fromCell}`, toCell, fromCell, {type: "diag", direction: "SE"} as EdgeData);
                        }
                        // two above if outer point and possible
                        // but ignore if edgeConnections is false
                        if (this.edgeConnections) {
                            if ( (col === 0 || col === this.width - 1) && (row > 1)) {
                                const toCell = this.coords2algebraic(col, row - 2);
                                graph.addEdgeWithKey(`${fromCell}>${toCell}`, fromCell, toCell, {type: "orth", direction: "N"} as EdgeData);
                                graph.addEdgeWithKey(`${toCell}>${fromCell}`, toCell, fromCell, {type: "orth", direction: "S"} as EdgeData);
                            }
                        }
                    }
                    // narrow rows connect directly above and one to the right
                    else {
                        // directly above always possible
                        let toCell = this.coords2algebraic(col, row - 1);
                        graph.addEdgeWithKey(`${fromCell}>${toCell}`, fromCell, toCell, {type: "diag", direction: "NW"} as EdgeData);
                        graph.addEdgeWithKey(`${toCell}>${fromCell}`, toCell, fromCell, {type: "diag", direction: "SE"} as EdgeData);
                        // above and to the right always possible
                        toCell = this.coords2algebraic(col + 1, row - 1);
                        graph.addEdgeWithKey(`${fromCell}>${toCell}`, fromCell, toCell, {type: "diag", direction: "NE"} as EdgeData);
                        graph.addEdgeWithKey(`${toCell}>${fromCell}`, toCell, fromCell, {type: "diag", direction: "SW"} as EdgeData);
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
                const isWide = (this.start === "W") ? (row % 2 === 0) : (row % 2 === 1);
                const node: string[] = [];
                for (let col = 0; col < (isWide? this.width : this.width - 1); col++) {
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
