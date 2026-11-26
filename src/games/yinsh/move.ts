import type { YinshGraph } from "./graph.js";
import type { HexDir } from "../../common/graphs/hextri.js";
import type { playerid } from "./types.js";

export interface RingMoveResult {
    ok: true;
    flipped: string[];
}

export type RingMoveFail = { ok: false; reason: "bad-line" | "bad-dest" | "no-ring" | "not-owner" | "no-pool" };

function ringAt(rings: Map<string, playerid>, cell: string): boolean {
    return rings.has(cell);
}

function vacantForRing(rings: Map<string, playerid>, cell: string, graph: YinshGraph): boolean {
    return graph.isPlayable(cell) && !ringAt(rings, cell);
}

/** Legal ring destinations from `from` for `owner` (does not mutate). */
export function legalRingDestinations(
    from: string,
    owner: playerid,
    rings: Map<string, playerid>,
    markers: Map<string, playerid>,
    graph: YinshGraph,
): string[] {
    if (rings.get(from) !== owner) {
        return [];
    }
    const dests: string[] = [];
    const [x, y] = graph.algebraic2coords(from);
    for (const dir of ["NE", "E", "SE", "SW", "W", "NW"] as const) {
        const line = graph.traceLine(from, dir);
        const idx = line.indexOf(from);
        if (idx === -1) {
            continue;
        }
        let i = idx + 1;
        while (i < line.length) {
            const cell = line[i]!;
            if (ringAt(rings, cell)) {
                break;
            }
            if (markers.has(cell)) {
                let j = i;
                while (j < line.length && markers.has(line[j]!) && !ringAt(rings, line[j]!)) {
                    j++;
                }
                if (j >= line.length || ringAt(rings, line[j]!)) {
                    break;
                }
                const land = line[j]!;
                if (vacantForRing(rings, land, graph)) {
                    dests.push(land);
                }
                break;
            }
            if (vacantForRing(rings, cell, graph)) {
                dests.push(cell);
            }
            i++;
        }
    }
    void x;
    void y;
    return [...new Set(dests)].sort();
}

function cellsBetween(line: string[], from: string, to: string): string[] {
    const i = line.indexOf(from);
    const j = line.indexOf(to);
    if (i === -1 || j === -1) {
        return [];
    }
    if (i < j) {
        return line.slice(i + 1, j);
    }
    return line.slice(j + 1, i);
}

export function simulateRingMove(
    from: string,
    to: string,
    owner: playerid,
    rings: Map<string, playerid>,
    markers: Map<string, playerid>,
    graph: YinshGraph,
): RingMoveResult | RingMoveFail {
    if (rings.get(from) !== owner) {
        return { ok: false, reason: "not-owner" };
    }
    if (!vacantForRing(rings, to, graph)) {
        return { ok: false, reason: "bad-dest" };
    }
    const dir = graph.bearing(from, to);
    if (dir === undefined) {
        return { ok: false, reason: "bad-line" };
    }
    const line = graph.traceLine(from, dir);
    if (!line.includes(to)) {
        return { ok: false, reason: "bad-line" };
    }
    const legal = legalRingDestinations(from, owner, rings, markers, graph);
    if (!legal.includes(to)) {
        return { ok: false, reason: "bad-dest" };
    }
    const between = cellsBetween(line, from, to);
    const flipped = between.filter((c) => markers.has(c));
    return { ok: true, flipped };
}

export function applyRingMove(
    from: string,
    to: string,
    owner: playerid,
    rings: Map<string, playerid>,
    markers: Map<string, playerid>,
    graph: YinshGraph,
): RingMoveResult | RingMoveFail {
    const sim = simulateRingMove(from, to, owner, rings, markers, graph);
    if (!sim.ok) {
        return sim;
    }
    rings.delete(from);
    rings.set(to, owner);
    markers.set(from, owner);
    for (const c of sim.flipped) {
        const m = markers.get(c);
        if (m !== undefined) {
            markers.set(c, m === 1 ? 2 : 1);
        }
    }
    return sim;
}

export function directionOnLine(graph: YinshGraph, from: string, to: string): HexDir | undefined {
    return graph.bearing(from, to);
}