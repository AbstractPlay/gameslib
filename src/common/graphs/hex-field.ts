import { DirectedGraph } from "graphology";
import { bidirectional } from 'graphology-shortest-path/unweighted';
import { IGraph } from "./IGraph";
import { Orientation, Hex, Direction, HexOffset, defineHex, Grid, rectangle } from "honeycomb-grid";

export type NodeData = {
    row: number;
    col: number;
};
export type EdgeData = {
    direction: Direction;
};

const dirs = new Map<Orientation, Direction[]>([
    [Orientation.POINTY, [Direction.NE, Direction.E, Direction.SE, Direction.SW, Direction.W, Direction.NW]],
    [Orientation.FLAT, [Direction.N, Direction.NE, Direction.SE, Direction.S, Direction.SW, Direction.NW]],
]);

export class HexFieldGraph implements IGraph {
    public readonly width: number;
    public readonly height: number;
    public readonly orientation: Orientation;
    public readonly offset: HexOffset;
    public graph: DirectedGraph<NodeData, EdgeData>;

    constructor(width: number, height: number, orientation: Orientation = Orientation.POINTY, offset: HexOffset = 1) {
        this.width = width;
        this.height = height;
        this.orientation = orientation;
        this.offset = offset;
        this.graph = this.buildGraph();
    }

    public get allDirs(): Direction[] {
        return dirs.get(this.orientation)!;
    }

    public coords2algebraic(x: number, y: number): string {
        return [x,y].join(",");
    }

    public algebraic2coords(cell: string): [number, number] {
        return cell.split(",").map(n => parseInt(n, 10)) as [number,number];
    }

    private buildGraph(): DirectedGraph<NodeData, EdgeData> {
        // Build the graph
        const graph = new DirectedGraph<NodeData, EdgeData>();

        // Nodes
        for (let row = 0; row < this.height; row++) {
            for (let col = 0; col < this.width; col++) {
                graph.addNode(this.coords2algebraic(col, row), {row, col});
            }
        }

        // Edges
        const myHex = defineHex({
            offset: this.offset,
            orientation: this.orientation,
        });
        const hexGrid = new Grid(myHex, rectangle({width: this.width, height: this.height}));
        for (let row = 0; row < this.height; row++) {
            for (let col = 0; col < this.width; col++) {
                const currCell = this.coords2algebraic(col, row);
                const currHex = hexGrid.getHex({row, col});
                if (currHex === undefined) {
                    throw new Error(`Could not find a hex at ${col},${row}`);
                }
                for (const dir of dirs.get(this.orientation)!) {
                    const neighbour: Hex|undefined = hexGrid.neighborOf(currHex, dir, { allowOutside: false });
                    if (neighbour !== undefined) {
                        const nextCell = this.coords2algebraic(neighbour.col, neighbour.row);
                        if (!graph.hasDirectedEdge(currCell, nextCell)) {
                            graph.addDirectedEdge(currCell, nextCell, {direction: dir});
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

    // Returns the direction from one cell to another
    public bearing(from: string, to: string): Direction|undefined {
        if (!this.graph.hasNode(from) || !this.graph.hasNode(to)) {
            return undefined;
        }
        for (const dir of [Direction.N, Direction.NE, Direction.E, Direction.SE, Direction.S, Direction.SW, Direction.W, Direction.NW]) {
            const ray = this.ray(from, dir);
            if (ray.includes(to)) { return dir; }
        }
        return undefined;
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
