import { SquareOrthGraph } from "../common/graphs/index.js";
import type { UndirectedGraph } from "graphology";
import { connectedComponents } from "graphology-components";
import { bidirectional } from "graphology-shortest-path/unweighted.js";

const GRID_W = 8;
const GRID_H = 10;

let roadTemplate: UndirectedGraph | undefined;

/** Shared full grid; callers must not mutate it. */
function baseGraph(): UndirectedGraph {
    if (roadTemplate === undefined) {
        roadTemplate = new SquareOrthGraph(GRID_W, GRID_H).graph;
    }
    return roadTemplate;
}

function templateGraph(): UndirectedGraph {
    return baseGraph().copy();
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

export interface StructuralConstraints {
    /** Empty lots where any placement leaves the road network not a single component. */
    roadBreaking: Set<string>;
    /** Empty lots where any placement leaves some building with no adjacent road. */
    isolating: Set<string>;
}

/**
 * Same answers as calling {@link roadNetworkAfterPlacement} on every empty
 * lot (the piece doesn't matter), but in one pass: road-breaking lots are the
 * cut vertices of the empty-lot graph, found with Tarjan's algorithm.
 */
export function structuralConstraints(board: ReadonlyMap<string, string>): StructuralConstraints {
    const grid = baseGraph();
    const emptyNbrs = new Map<string, string[]>();
    for (const c of grid.nodes()) {
        emptyNbrs.set(c, grid.neighbors(c).filter((n) => ! board.has(n)));
    }
    const empties = grid.nodes().filter((c) => ! board.has(c));

    // A building's road neighbours are exactly its empty neighbours, so a
    // placement strands a building iff it fills that building's last empty
    // neighbour (or the new building itself has none).
    const isolating = new Set<string>();
    let alreadyStranded = false;
    for (const c of board.keys()) {
        const open = emptyNbrs.get(c)!;
        if (open.length === 0) {
            alreadyStranded = true;
        } else if (open.length === 1) {
            isolating.add(open[0]);
        }
    }
    for (const c of empties) {
        if (alreadyStranded || emptyNbrs.get(c)!.length === 0) {
            isolating.add(c);
        }
    }

    const disc = new Map<string, number>();
    const low = new Map<string, number>();
    const cutVertices = new Set<string>();
    const componentOf = new Map<string, number>();
    const componentSizes: number[] = [];
    let timer = 0;
    const visit = (u: string, parent: string | null, comp: number): void => {
        disc.set(u, timer);
        low.set(u, timer);
        timer++;
        componentOf.set(u, comp);
        componentSizes[comp]++;
        let children = 0;
        for (const v of emptyNbrs.get(u)!) {
            if (v === parent) { continue; }
            if (! disc.has(v)) {
                children++;
                visit(v, u, comp);
                low.set(u, Math.min(low.get(u)!, low.get(v)!));
                if ( (parent !== null) && (low.get(v)! >= disc.get(u)!) ) {
                    cutVertices.add(u);
                }
            } else {
                low.set(u, Math.min(low.get(u)!, disc.get(v)!));
            }
        }
        if ( (parent === null) && (children > 1) ) {
            cutVertices.add(u);
        }
    };
    for (const c of empties) {
        if (! disc.has(c)) {
            componentSizes.push(0);
            visit(c, null, componentSizes.length - 1);
        }
    }

    // Legal play always has one component of two or more lots, where only
    // cut vertices break the road. The other cases only arise on hand-built
    // boards, but are handled so the result always matches the reference.
    const components = componentSizes.length;
    const roadBreaking = new Set<string>();
    for (const c of empties) {
        let remaining: number;
        if (componentSizes[componentOf.get(c)!] === 1) {
            remaining = components - 1;
        } else {
            remaining = components + (cutVertices.has(c) ? 1 : 0);
        }
        if (remaining !== 1) {
            roadBreaking.add(c);
        }
    }

    return { roadBreaking, isolating };
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
