import { UndirectedGraph } from "graphology";
import { bidirectional } from 'graphology-shortest-path/unweighted';
import { IGraph } from "./IGraph";

const columnLabels = "abcdefghijklmnopqrstuvwxyz".split("");
type directions = "NE"|"E"|"SE"|"SW"|"W"|"NW";

export class HexConeGraph implements IGraph {
    // Ensure that `options: ["reverse-letters"]` is set in the renderer.
    public readonly size: number;
    public readonly coneType: "wide" | "narrow";
    public graph: UndirectedGraph
    public static allDirections: directions[] = ["NE","E","SE","SW","W","NW"];

    constructor(size: number, coneType: "wide" | "narrow") {
        this.size = size;
        this.coneType = coneType;
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
        const y = Number(num);
        if (y === undefined || isNaN(y) || num === "") {
            throw new Error(`The row label is invalid: ${pair[1]}`);
        }
        return [x, y - 1];
    }

    private buildGraph(): UndirectedGraph {
        // Build the graph
        const graph = new UndirectedGraph();
        // Nodes
        for (let row = 0; row < this.size; row++) {
            for (let col = this.coneType === "wide" ? 1 : 0; col < (this.coneType === "narrow" ? this.size - 1 : this.size); col++) {
                graph.addNode(this.coords2algebraic(col, row));
            }
        }
        // Edges
        for (let row = 0; row < this.size; row++) {
            for (let col = this.coneType === "wide" ? 1 : 0; col < (this.coneType === "narrow" ? this.size - 1 : this.size); col++) {
                const fromCell = this.coords2algebraic(col, row);
                // Connect to the left
                if (this.coneType === "wide" && col === 1) {
                    if (row < this.size - 2) {
                        graph.addEdge(fromCell, this.coords2algebraic(this.size - 1 - row, this.size - 1));
                    }
                } else if (col > 0) {
                    graph.addEdge(fromCell, this.coords2algebraic(col - 1, row));
                }
                // Connect down
                if (row < this.size - 1) {
                    graph.addEdge(fromCell, this.coords2algebraic(col, row + 1));
                }
                // Down left
                if (this.coneType === "wide" && col === 1) {
                    if (row < this.size - 2) {
                        graph.addEdge(fromCell, this.coords2algebraic(this.size - 2 - row, this.size - 1));
                    }
                } else if (row < this.size - 1 && col > 0) {
                    graph.addEdge(fromCell, this.coords2algebraic(col - 1, row + 1));
                }
                if (this.coneType === "narrow" && col === this.size - 2) {
                    // On the right-most edge, connect to bottom row horizontally...
                    if (row < this.size - 2) {
                        graph.addEdge(fromCell, this.coords2algebraic(row, this.size - 1));
                    }
                    // and also to the top right.
                    if (row > 0 && row < this.size - 2) {
                        graph.addEdge(fromCell, this.coords2algebraic(row - 1, this.size - 1));
                    }
                }
            }
        }
        if (this.coneType === "wide") {
            // Add the centre and the connections to the centre for wide cone.
            const centre = this.coords2algebraic(0, this.size - 1);
            graph.addNode(centre);
            graph.addEdge(centre, this.coords2algebraic(1, this.size - 1));
            graph.addEdge(centre, this.coords2algebraic(1, this.size - 2));
        }
        return graph;
    }

    public listCells(ordered = false): string[] | string[][] {
        if (! ordered) {
            return this.graph.nodes();
        } else {
            const result: string[][] = [];
            for (let row = 0; row < this.size; row++) {
                const node: string[] = [];
                for (let col = this.coneType === "wide" ? 1 : 0; col < (this.coneType === "narrow" ? this.size - 1 : this.size); col++) {
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

    public centre(): string {
        if (this.coneType === "wide") {
            return this.coords2algebraic(0, this.size - 1);
        }
        return this.coords2algebraic(this.size - 2, this.size - 1);
    }

    public path(from: string, to: string): string[] | null {
        return bidirectional(this.graph, from, to);
    }

    public normaliseCell(cell: string): string {
        // On the cone, there are some cells that are equivalent.
        // Because of how the board is set up in the renderer,
        // For wide cones, the western border is the same as the southern border and
        // for narrow cones, the eastern border is the same as the southern border.
        return this.coords2algebraic(...this.normaliseCoordinates(...this.algebraic2coords(cell)));
    }

    public normaliseCoordinates(x: number, y: number): [number, number] {
        // On the cone, there are some cells that are equivalent.
        // Because of how the board is set up in the renderer,
        // For wide cones, the western border is the same as the southern border and
        // for narrow cones, the eastern border is the same as the southern border.
        if (this.coneType === "narrow") {
            if (x === this.size - 1) {
                return [y, this.size - 1];
            }
        } else {
            if (x === 0) {
                return [this.size - 1 - y, this.size - 1];
            }
        }
        return [x, y];
    }

    public repeatedCell(cell: string): string | undefined {
        // If relevant, return the equivalent cell on the other side of the board.
        const coords = this.algebraic2coords(cell);
        const otherCoords = this.repeatedCoords(...coords);
        if (otherCoords === undefined) { return undefined; }
        return this.coords2algebraic(...otherCoords);
    }


    public repeatedCoords(x: number, y: number): [number, number] | undefined {
        // If relevant, return the equivalent cell on the other side of the board.
        if (y !== this.size - 1) { return undefined; }
        if (this.coneType === "narrow") {
            return [this.size - 1, x];
        } else {
            return [0, this.size - 1 - x];
        }
    }

    public otherCell(cell: string): string | undefined {
        // If relevant, return the equivalent cell on the other side of the board.
        const [x, y] = this.algebraic2coords(cell);
        if (this.coneType === "narrow") {
            if (x === this.size - 1) {
                return this.coords2algebraic(y, this.size - 1);
            } else if (y === this.size - 1) {
                return this.coords2algebraic(this.size - 1, x);
            }
        } else {
            if (x === 0) {
                return this.coords2algebraic(this.size - 1 - y, this.size - 1);
            } else if (y === this.size - 1) {
                return this.coords2algebraic(0, this.size - 1 - x);
            }
        }
        throw new Error("The cell does not have an equivalent cell on the other side of the board.");
    }

    public move(x: number, y: number, direction: directions, dist = 1): [number, number] | undefined {
        let xNew = x;
        let yNew = y;
        for (let i = 0; i < dist; i++) {
            switch (direction) {
                case "NE":
                    yNew--
                    break;
                case "E":
                    xNew++;
                    break;
                case "SE":
                    yNew++;
                    break;
                case "SW":
                    yNew++;
                    xNew--;
                    break;
                case "W":
                    xNew--;
                    break;
                case "NW":
                    yNew--;
                    xNew--;
                    break;
                default:
                    throw new Error("Invalid direction requested.");
            }
            [xNew, yNew] = this.normaliseCoordinates(xNew, yNew);
            if (xNew < 0 || xNew >= this.size || yNew < 0 || yNew >= this.size) {
                return undefined;
            }
        }
        return [xNew, yNew];
    }

    // Ray casting may be less relevant on a cone.
    // public ray(x: number, y: number, dir: directions): [number, number][] {
    //     const cells: [number, number][] = [];
    //     let next = this.move(x, y, dir);
    //     while (next !== undefined) {
    //         cells.push(next);
    //         next = this.move(...next, dir);
    //     }
    //     return cells;
    // }
}
