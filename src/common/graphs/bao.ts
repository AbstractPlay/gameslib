import { DirectedGraph } from "graphology";
import { IGraph } from "./IGraph";

const columnLabels = "abcdefghijklmnopqrstuvwxyz".split("");

export type PitType = "nyumba"|"kichwa1L"|"kichwa1R"|"kimbi1L"|"kimbi1R"|"kichwa2L"|"kichwa2R"|"kimbi2L"|"kimbi2R"|"pit";
type NodeData = {
    type: PitType;
};
type EdgeData = {
    direction: "CW"|"CCW";
};

export class BaoGraph implements IGraph {
    public readonly width: number;
    public readonly height: number;
    public graph: DirectedGraph;
    public houses: [string|undefined,string|undefined];

    constructor(houses: [string|undefined,string|undefined] = ["e2", "d3"]) {
        this.width = 8;
        this.height = 4;
        this.houses = [...houses];
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
        const y = parseInt(num, 10);
        if ( (y === undefined) || (isNaN(y)) ) {
            throw new Error(`The row label is invalid: ${pair[1]}`);
        }
        return [x, this.height - y];
    }

    private buildGraph(): DirectedGraph {
        // Build the graph
        const graph = new DirectedGraph();
        // Nodes
        for (let row = 0; row < this.height; row++) {
            for (let col = 0; col < this.width; col++) {
                const cell = this.coords2algebraic(col, row);
                let data: NodeData = {type: "pit"};
                if (this.houses.includes(cell)) {
                    data = {type: "nyumba"};
                } else {
                    switch (cell) {
                        case "a2":
                            data = {type: "kichwa1L"};
                            break;
                        case "h3":
                            data = {type: "kichwa2L"};
                            break;
                        case "b2":
                            data = {type: "kimbi1L"};
                            break;
                        case "g3":
                            data = {type: "kimbi2L"};
                            break;
                        case "a3":
                            data = {type: "kichwa2R"};
                            break;
                        case "h2":
                            data = {type: "kichwa1R"};
                            break;
                        case "b3":
                            data = {type: "kimbi2R"};
                            break;
                        case "g2":
                            data = {type: "kimbi1R"};
                            break;
                    }
                }
                graph.addNode(cell, data);
            }
        }
        // Edges
        for (let row = 0; row < this.height; row++) {
            for (let col = 0; col < this.width; col++) {
                const fromCell = this.coords2algebraic(col, row);
                let toCell: string;
                // CW (remember that directions are flipped for p2)
                if (row === 0 || row === 1) {
                    if (row === 1 && col === 0) {
                        toCell = this.coords2algebraic(0, 0);
                    } else if (row === 0 && col === 7) {
                        toCell = this.coords2algebraic(7, 1);
                    } else if (row === 0) {
                        toCell = this.coords2algebraic(col + 1, row);
                    } else {
                        toCell = this.coords2algebraic(col - 1, row);
                    }
                } else {
                    if (row === 3 && col === 0) {
                        toCell = this.coords2algebraic(0, 2);
                    } else if (row === 2 && col === 7) {
                        toCell = this.coords2algebraic(7, 3);
                    } else if (row === 2) {
                        toCell = this.coords2algebraic(col + 1, row);
                    } else {
                        toCell = this.coords2algebraic(col - 1, row);
                    }
                }
                graph.addDirectedEdge(fromCell, toCell, {direction: "CW"} as EdgeData)

                // CCW (remember that directions are flipped for p2)
                if (row === 0 || row === 1) {
                    if (row === 0 && col === 0) {
                        toCell = this.coords2algebraic(0, 1);
                    } else if (row === 1 && col === 7) {
                        toCell = this.coords2algebraic(7, 0);
                    } else if (row === 0) {
                        toCell = this.coords2algebraic(col - 1, row);
                    } else {
                        toCell = this.coords2algebraic(col + 1, row);
                    }
                } else {
                    if (row === 2 && col === 0) {
                        toCell = this.coords2algebraic(0, 3);
                    } else if (row === 3 && col === 7) {
                        toCell = this.coords2algebraic(7, 2);
                    } else if (row === 2) {
                        toCell = this.coords2algebraic(col - 1, row);
                    } else {
                        toCell = this.coords2algebraic(col + 1, row);
                    }
                }
                graph.addDirectedEdge(fromCell, toCell, {direction: "CCW"} as EdgeData)
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

    public path(): string[] | null {
        return null
    }

    public sow(start: string, direction: "CW"|"CCW", distance: number): string[] {
        const nodes: string[] = [];
        if (! this.graph.hasNode(start)) {
            throw new Error(`Starting node ${start} could not be found on the graph.`);
        }
        if (distance < 0) {
            if (direction === "CW") {
                direction = "CCW"
            } else {
                direction = "CW";
            }
            distance = Math.abs(distance);
        }
        let curr = start;
        for (let i = 0; i < distance; i++) {
            // find edge that matches direction
            const edge = this.graph.findOutboundEdge(curr, (key, attr) => attr.direction === direction);
            if (edge === undefined) {
                throw new Error(`Could not find an outbound edge from ${curr} moving in the ${direction} direction.`);
            }
            // find node it's attached to
            const next = this.graph.extremities(edge).filter(n => n !== curr);
            if (next.length !== 1) {
                throw new Error(`Did not get sensible results looking for the extremities of edge "${edge}": ${JSON.stringify(next)}`);
            }
            nodes.push(next[0]);
            curr = next[0];
        }
        return nodes;
    }

    public getDir(from: string, to: string): "CW"|"CCW"|undefined {
        if ( (! this.graph.hasNode(from)) || (! this.graph.hasNode(to)) ) {
            return undefined;
        }
        const neighbours = this.graph.neighbors(from);
        if (! neighbours.includes(to)) {
            return undefined;
        }
        const edge = this.graph.findOutboundEdge(from, to, () => true);
        if (edge === undefined) {
            return undefined;
        }
        return this.graph.getEdgeAttribute(edge, "direction") as "CW"|"CCW";
    }

    public getType(from: string): PitType|undefined {
        if (! this.graph.hasNode(from)) {
            return undefined;
        }
        return this.graph.getNodeAttribute(from, "type") as PitType|undefined;
    }

    public findType(type: PitType): string|undefined {
        for (const node of this.graph.nodes()) {
            if (this.getType(node) === type) {
                return node;
            }
        }
        return;
    }
}
