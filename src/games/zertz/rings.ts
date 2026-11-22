import { connectedComponents } from "graphology-components";
import { UndirectedGraph } from "graphology";
import type { HexTriGraph } from "../../common/graphs/hextri.js";
import type { HexDir } from "../../common/graphs/hextri.js";
import type { MarbleColour } from "./types.js";

const DIRS: HexDir[] = ["NE", "E", "SE", "SW", "W", "NW"];

function ringSubgraph(graph: HexTriGraph, rings: Set<string>): UndirectedGraph {
    const sub = new UndirectedGraph();
    for (const cell of rings) {
        sub.addNode(cell);
    }
    for (const cell of rings) {
        for (const n of graph.neighbours(cell)) {
            if (rings.has(n)) {
                if (!sub.hasEdge(cell, n)) {
                    sub.addEdge(cell, n);
                }
            }
        }
    }
    return sub;
}

/** For each hex direction, whether a ring occupies the neighbouring cell (false = gap). */
function ringNeighbourSlots(graph: HexTriGraph, rings: Set<string>, cell: string): boolean[] {
    const [x, y] = graph.algebraic2coords(cell);
    return DIRS.map((dir) => {
        const next = graph.move(x, y, dir);
        if (next === undefined) {
            return false;
        }
        const algebraic = graph.coords2algebraic(next[0], next[1]);
        return rings.has(algebraic);
    });
}

/**
 * Vacant ring that can slide off without disturbing neighbours (rules Diagram 2).
 * Around the cell, in fixed hex order, two consecutive directions must lack a ring
 * (hole in the live board or off the original grid) — the exit gap discs need to slip through.
 */
export function isRingSlidable(graph: HexTriGraph, rings: Set<string>, cell: string): boolean {
    const slots = ringNeighbourSlots(graph, rings, cell);
    for (let i = 0; i < DIRS.length; i++) {
        const j = (i + 1) % DIRS.length;
        if (!slots[i]! && !slots[j]!) {
            return true;
        }
    }
    return false;
}

export function removableRings(
    graph: HexTriGraph,
    rings: Set<string>,
    marbles: Map<string, MarbleColour>,
): string[] {
    const rem: string[] = [];
    for (const cell of rings) {
        if (marbles.has(cell)) {
            continue;
        }
        if (!isRingSlidable(graph, rings, cell)) {
            continue;
        }
        rem.push(cell);
    }
    return rem.sort((a, b) => a.localeCompare(b));
}

/** Vacant perimeter rings that may be removed after a marble is placed at `cell`. */
export function removableRingsAfterPlacement(
    graph: HexTriGraph,
    rings: Set<string>,
    marbles: Map<string, MarbleColour>,
    cell: string,
    colour: MarbleColour,
): string[] {
    const placed = new Map(marbles);
    placed.set(cell, colour);
    return removableRings(graph, rings, placed);
}

function indexOfMainComponent(components: string[][], anchor?: string): number {
    let best = 0;
    for (let i = 0; i < components.length; i++) {
        const comp = components[i]!;
        const bestComp = components[best]!;
        if (comp.length > bestComp.length) {
            best = i;
            continue;
        }
        if (comp.length < bestComp.length) {
            continue;
        }
        const anchorHere = anchor !== undefined && comp.includes(anchor);
        const anchorBest = anchor !== undefined && bestComp.includes(anchor);
        if (anchorHere && !anchorBest) {
            best = i;
        }
    }
    return best;
}

/**
 * Marbles (and their rings) claimed when a non-main component is fully occupied.
 * `anchor` is usually the placement cell — the main board is the largest component, breaking ties
 * with the component that contains the anchor (rules §D).
 */
export function isolationCaptures(
    graph: HexTriGraph,
    rings: Set<string>,
    marbles: Map<string, MarbleColour>,
    anchor?: string,
): Array<{ cell: string; colour: MarbleColour }> {
    const sub = ringSubgraph(graph, rings);
    const components = connectedComponents(sub);
    if (components.length < 2) {
        return [];
    }
    const mainIdx = indexOfMainComponent(components, anchor);
    const result: Array<{ cell: string; colour: MarbleColour }> = [];
    for (let i = 0; i < components.length; i++) {
        if (i === mainIdx) {
            continue;
        }
        const comp = components[i]!;
        let hasVacant = false;
        for (const cell of comp) {
            if (!marbles.has(cell)) {
                hasVacant = true;
                break;
            }
        }
        if (hasVacant) {
            continue;
        }
        for (const cell of comp) {
            const colour = marbles.get(cell);
            if (colour !== undefined) {
                result.push({ cell, colour });
            }
        }
    }
    return result.sort((a, b) => a.cell.localeCompare(b.cell));
}