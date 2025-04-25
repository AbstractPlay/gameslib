import { DirectedGraph } from "graphology";
import { bidirectional } from 'graphology-shortest-path/unweighted';
import { IGraph } from "./IGraph";
import { Direction as Direction } from "..";
import { Attributes } from "graphology-types";
import { coords2algebraic } from "..";

export type EdgeData = {
    type: "orth"|"diag";
    direction: Direction;
};

export type NodeData = {
    col: number;
    row: number;
}

/**
 * This graph is useful when you have a game where you want to allow ingress
 * to a cell but not egress.
 */

export class SquareDiamondsDirectedGraph implements IGraph {
    public readonly width: number;
    public readonly height: number;
    public readonly sdStart: "S"|"D";
    public graph: DirectedGraph<NodeData,EdgeData,Attributes>;

    constructor(width: number, height: number, sdStart: "S"|"D" = "S") {
        this.width = width;
        this.height = height;
        this.sdStart = sdStart;
        this.graph = this.buildGraph();
    }

    public coords2algebraic(x: number, y: number): string {
        const node = [...this.graph.nodeEntries()].find(({attributes: attr}) => attr.col === x && attr.row === y)?.node;
        if (node !== undefined) {
            return node;
        }
        throw new Error(`Could not find a node at ${x},${y}`);
    }

    public algebraic2coords(cell: string): [number, number] {
        if (this.graph.hasNode(cell)) {
            const {col, row} = this.graph.getNodeAttributes(cell);
            return [col, row];
        }
        throw new Error(`Could not find a node labelled ${cell}`);
    }

    public static allDirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

    private buildGraph(): DirectedGraph<NodeData,EdgeData,Attributes> {
        // Build the graph
        const graph = new DirectedGraph<NodeData,EdgeData,Attributes>();
        // squares first
        // Nodes
        for (let row = 0; row < this.height; row++) {
            for (let col = 0; col < this.width; col++) {
                graph.addNode(coords2algebraic(col, row, this.height), {col, row: (row * 2) + (this.sdStart === "S" ? 0 : 1)});
            }
        }
        // Edges (orth only for the squares)
        for (let row = 0; row < this.height; row++) {
            for (let col = 0; col < this.width; col++) {
                const fromCell = coords2algebraic(col, row, this.height);
                // Connect to the right
                if (col < this.width - 1) {
                    const toCell = coords2algebraic(col + 1, row, this.height)
                    graph.addEdgeWithKey(`${fromCell}>${toCell}`, fromCell, toCell, {type: "orth", direction: "E"} as EdgeData);
                    graph.addEdgeWithKey(`${toCell}>${fromCell}`, toCell, fromCell, {type: "orth", direction: "W"} as EdgeData);
                }
                // Connect up
                if (row > 0) {
                    const toCell = coords2algebraic(col, row - 1, this.height);
                    graph.addEdgeWithKey(`${fromCell}>${toCell}`, fromCell, toCell, {type: "orth", direction: "N"} as EdgeData);
                    graph.addEdgeWithKey(`${toCell}>${fromCell}`, toCell, fromCell, {type: "orth", direction: "S"} as EdgeData);
                }
            }
        }

        // now add the diamonds and associated edges
        // the internal diamonds are the same regardless of sdStart,
        // so do those first
        for (let row = 0; row < this.height - 1; row++) {
            for (let col = 0; col < this.width - 1; col++) {
                const tl = coords2algebraic(col, row, this.height);
                const tr = coords2algebraic(col + 1, row, this.height);
                const bl = coords2algebraic(col, row + 1, this.height);
                const br = coords2algebraic(col + 1, row + 1, this.height);
                const nodeId = `${tl}|${br}`;
                graph.addNode(nodeId, {col: col + (this.sdStart === "S" ? 0 : 1), row: 1 + (row * 2) + (this.sdStart === "S" ? 0 : 1)});
                graph.addEdgeWithKey(`${nodeId}>${tl}`, nodeId, tl, {type: "diag", direction: "NW"} as EdgeData);
                graph.addEdgeWithKey(`${tl}>${nodeId}`, tl, nodeId, {type: "diag", direction: "SE"} as EdgeData);
                graph.addEdgeWithKey(`${nodeId}>${tr}`, nodeId, tr, {type: "diag", direction: "NE"} as EdgeData);
                graph.addEdgeWithKey(`${tr}>${nodeId}`, tr, nodeId, {type: "diag", direction: "SW"} as EdgeData);
                graph.addEdgeWithKey(`${nodeId}>${bl}`, nodeId, bl, {type: "diag", direction: "SW"} as EdgeData);
                graph.addEdgeWithKey(`${bl}>${nodeId}`, bl, nodeId, {type: "diag", direction: "NE"} as EdgeData);
                graph.addEdgeWithKey(`${nodeId}>${br}`, nodeId, br, {type: "diag", direction: "SE"} as EdgeData);
                graph.addEdgeWithKey(`${br}>${nodeId}`, br, nodeId, {type: "diag", direction: "NW"} as EdgeData);
            }
        }

        // now add external diamonds if necessary
        if (this.sdStart === "D") {
            // top and bottom rows
            for (const row of [0, this.height - 1]) {
                for (let col = 0; col < this.width; col++) {
                    const rSquare = coords2algebraic(col, row, this.height);
                    // left corner
                    if (col === 0) {
                        const nodeId = `|${rSquare}`;
                        // top
                        if (row === 0) {
                            graph.addNode(nodeId, {col: 0, row: 0});
                            graph.addEdgeWithKey(`${nodeId}>${rSquare}`, nodeId, rSquare, {type: "diag", direction: "SE"} as EdgeData);
                            graph.addEdgeWithKey(`${rSquare}>${nodeId}`, rSquare, nodeId, {type: "diag", direction: "NW"} as EdgeData);
                        }
                        // bottom
                        else {
                            graph.addNode(nodeId, {col: 0, row: this.height * 2});
                            graph.addEdgeWithKey(`${nodeId}>${rSquare}`, nodeId, rSquare, {type: "diag", direction: "NE"} as EdgeData);
                            graph.addEdgeWithKey(`${rSquare}>${nodeId}`, rSquare, nodeId, {type: "diag", direction: "SW"} as EdgeData);
                        }
                    }
                    // right corner
                    else if (col === this.width - 1) {
                        const nodeId = `${rSquare}|`;
                        // top
                        if (row === 0) {
                            graph.addNode(nodeId, {col: this.width, row: 0});
                            graph.addEdgeWithKey(`${nodeId}>${rSquare}`, nodeId, rSquare, {type: "diag", direction: "SW"} as EdgeData);
                            graph.addEdgeWithKey(`${rSquare}>${nodeId}`, rSquare, nodeId, {type: "diag", direction: "NE"} as EdgeData);
                        }
                        // bottom
                        else {
                            graph.addNode(nodeId, {col: this.width, row: this.height * 2});
                            graph.addEdgeWithKey(`${nodeId}>${rSquare}`, nodeId, rSquare, {type: "diag", direction: "NW"} as EdgeData);
                            graph.addEdgeWithKey(`${rSquare}>${nodeId}`, rSquare, nodeId, {type: "diag", direction: "SE"} as EdgeData);
                        }
                    }

                    // internal (not an `else`)
                    if (col > 0) {
                        const lSquare = coords2algebraic(col - 1, row, this.height);
                        const nodeId = `${lSquare}|${rSquare}`;
                        // top
                        if (row === 0) {
                            graph.addNode(nodeId, {col, row: 0});
                            graph.addEdgeWithKey(`${nodeId}>${lSquare}`, nodeId, lSquare, {type: "diag", direction: "SW"} as EdgeData);
                            graph.addEdgeWithKey(`${lSquare}>${nodeId}`, lSquare, nodeId, {type: "diag", direction: "NE"} as EdgeData);
                            graph.addEdgeWithKey(`${nodeId}>${rSquare}`, nodeId, rSquare, {type: "diag", direction: "SE"} as EdgeData);
                            graph.addEdgeWithKey(`${rSquare}>${nodeId}`, rSquare, nodeId, {type: "diag", direction: "NW"} as EdgeData);
                        }
                        // bottom
                        else {
                            graph.addNode(nodeId, {col, row: this.height * 2});
                            graph.addEdgeWithKey(`${nodeId}>${lSquare}`, nodeId, lSquare, {type: "diag", direction: "NW"} as EdgeData);
                            graph.addEdgeWithKey(`${lSquare}>${nodeId}`, lSquare, nodeId, {type: "diag", direction: "SE"} as EdgeData);
                            graph.addEdgeWithKey(`${nodeId}>${rSquare}`, nodeId, rSquare, {type: "diag", direction: "NE"} as EdgeData);
                            graph.addEdgeWithKey(`${rSquare}>${nodeId}`, rSquare, nodeId, {type: "diag", direction: "SW"} as EdgeData);
                        }
                    }
                }
            }

            // left and right (excluding corners)
            for (const col of [0, this.width - 1]) {
                for (let row = 1; row < this.height; row++) {
                    const tSquare = coords2algebraic(col, row - 1, this.height);
                    const bSquare = coords2algebraic(col, row, this.height);
                    const nodeId = `${tSquare}|${bSquare}`;
                    // left
                    if (col === 0) {
                        graph.addNode(nodeId, {col: 0, row: ((row - 1) * 2) + 2});
                        graph.addEdgeWithKey(`${nodeId}>${tSquare}`, nodeId, tSquare, {type: "diag", direction: "NE"} as EdgeData);
                        graph.addEdgeWithKey(`${tSquare}>${nodeId}`, tSquare, nodeId, {type: "diag", direction: "SW"} as EdgeData);
                        graph.addEdgeWithKey(`${nodeId}>${bSquare}`, nodeId, bSquare, {type: "diag", direction: "SE"} as EdgeData);
                        graph.addEdgeWithKey(`${bSquare}>${nodeId}`, bSquare, nodeId, {type: "diag", direction: "NW"} as EdgeData);
                    }
                    // right
                    else {
                        graph.addNode(nodeId, {col: this.width, row: ((row - 1) * 2) + 2});
                        graph.addEdgeWithKey(`${nodeId}>${tSquare}`, nodeId, tSquare, {type: "diag", direction: "NW"} as EdgeData);
                        graph.addEdgeWithKey(`${tSquare}>${nodeId}`, tSquare, nodeId, {type: "diag", direction: "SE"} as EdgeData);
                        graph.addEdgeWithKey(`${nodeId}>${bSquare}`, nodeId, bSquare, {type: "diag", direction: "SW"} as EdgeData);
                        graph.addEdgeWithKey(`${bSquare}>${nodeId}`, bSquare, nodeId, {type: "diag", direction: "NE"} as EdgeData);
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
            const nodes = [...this.graph.nodeEntries()].map(entry => {
                return {
                    node: entry.node,
                    col: entry.attributes.col,
                    row: entry.attributes.row,
                }
            });
            const setRows = new Set<number>(nodes.map(e => e.row));
            const result: string[][] = [];
            for (const row of [...setRows].sort((a,b) => a - b)) {
                const sorted = nodes.filter(e => e.row === row).sort((a,b) => a.col - b.col);
                result.push(sorted.map(e => e.node));
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
