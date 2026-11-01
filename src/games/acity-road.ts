import { SquareOrthGraph } from "../common/graphs/index.js";
import type { UndirectedGraph } from "graphology";
import { connectedComponents } from "graphology-components";
import { bidirectional } from "graphology-shortest-path/unweighted.js";

const GRID_W = 8;
const GRID_H = 10;

let roadTemplate: UndirectedGraph | undefined;

function templateGraph(): UndirectedGraph {
    if (roadTemplate === undefined) {
        roadTemplate = new SquareOrthGraph(GRID_W, GRID_H).graph;
    }
    return roadTemplate.copy();
}

/** Road adjacency graph: orthogonal edges minus edges between adjacent occupied lots. */
export function buildRoadGraphFromBoard(board: ReadonlyMap<string, string>): UndirectedGraph {
    const graph = templateGraph();
    for (const cell of board.keys()) {
        for (const n of graph.neighbors(cell)) {
            if (board.has(n) && graph.hasEdge(cell, n)) {
                graph.dropEdge(cell, n);
            }
        }
    }
    return graph;
}

export interface RoadPlacementCheck {
    roadOk: boolean;
    isolated: boolean;
}

/** Hypothetically place `piece` on `cell` and evaluate road-network rules. */
export function roadNetworkAfterPlacement(
    board: ReadonlyMap<string, string>,
    piece: string,
    cell: string,
): RoadPlacementCheck {
    const next = new Map(board);
    next.set(cell, piece);
    const graph = buildRoadGraphFromBoard(next);

    let isolated = false;
    for (const c of next.keys()) {
        if (graph.neighbors(c).length === 0) {
            isolated = true;
            break;
        }
    }

    const roadOnly = graph.copy();
    for (const c of next.keys()) {
        roadOnly.dropNode(c);
    }
    const roadOk = connectedComponents(roadOnly).length === 1;

    return { roadOk, isolated };
}

/** Whether the road network (buildings removed) is a single component. */
export function isRoadNetworkConnected(board: ReadonlyMap<string, string>): boolean {
    const graph = buildRoadGraphFromBoard(board);
    for (const cell of board.keys()) {
        graph.dropNode(cell);
    }
    return connectedComponents(graph).length === 1;
}

/** Road distance with building lots removed except endpoints (matches legacy getRealDistance). */
export function realDistanceOnBoard(board: ReadonlyMap<string, string>, from: string, to: string): number {
    const graph = buildRoadGraphFromBoard(board);
    const drop = [...board.keys()].filter((c) => c !== from && c !== to);
    for (const n of drop) {
        graph.dropNode(n);
    }
    const path = bidirectional(graph, from, to);
    if (path === undefined || path === null) {
        throw new Error(`No road path from ${from} to ${to}`);
    }
    return path.length - 2;
}
