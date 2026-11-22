import type { HexTriGraph } from "../../common/graphs/hextri.js";
import type { HexDir } from "../../common/graphs/hextri.js";
import type { MarbleColour } from "./types.js";

const DIRS: HexDir[] = ["NE", "E", "SE", "SW", "W", "NW"];

export interface JumpStep {
    from: string;
    over: string;
    to: string;
    overColour: MarbleColour;
}

export function cellBetween(graph: HexTriGraph, from: string, to: string): string | undefined {
    const bearing = graph.bearing(from, to);
    if (bearing === undefined) {
        return undefined;
    }
    const [x, y] = graph.algebraic2coords(from);
    const mid = graph.move(x, y, bearing);
    if (mid === undefined) {
        return undefined;
    }
    return graph.coords2algebraic(mid[0], mid[1]);
}

export function jumpStepsFromStart(
    graph: HexTriGraph,
    rings: Set<string>,
    marbles: Map<string, MarbleColour>,
    start: string,
): JumpStep[] {
    const steps: JumpStep[] = [];
    if (!marbles.has(start)) {
        return steps;
    }
    const [x, y] = graph.algebraic2coords(start);
    for (const dir of DIRS) {
        const overCoords = graph.move(x, y, dir);
        if (overCoords === undefined) {
            continue;
        }
        const over = graph.coords2algebraic(overCoords[0], overCoords[1]);
        if (!rings.has(over) || !marbles.has(over)) {
            continue;
        }
        const landCoords = graph.move(overCoords[0], overCoords[1], dir);
        if (landCoords === undefined) {
            continue;
        }
        const land = graph.coords2algebraic(landCoords[0], landCoords[1]);
        if (!rings.has(land) || marbles.has(land)) {
            continue;
        }
        steps.push({
            from: start,
            over,
            to: land,
            overColour: marbles.get(over)!,
        });
    }
    return steps;
}

export function anyJumpExists(
    graph: HexTriGraph,
    rings: Set<string>,
    marbles: Map<string, MarbleColour>,
): boolean {
    for (const cell of marbles.keys()) {
        if (!rings.has(cell)) {
            continue;
        }
        const [x, y] = graph.algebraic2coords(cell);
        for (const dir of DIRS) {
            const overCoords = graph.move(x, y, dir);
            if (overCoords === undefined) {
                continue;
            }
            const over = graph.coords2algebraic(overCoords[0], overCoords[1]);
            if (!rings.has(over) || !marbles.has(over)) {
                continue;
            }
            const landCoords = graph.move(overCoords[0], overCoords[1], dir);
            if (landCoords === undefined) {
                continue;
            }
            const land = graph.coords2algebraic(landCoords[0], landCoords[1]);
            if (rings.has(land) && !marbles.has(land)) {
                return true;
            }
        }
    }
    return false;
}

function stepKey(step: JumpStep): string {
    return `${step.from}|${step.over}|${step.to}`;
}

/** All complete jump chains as ordered step lists. */
export function enumerateJumpChains(
    graph: HexTriGraph,
    rings: Set<string>,
    marbles: Map<string, MarbleColour>,
): JumpStep[][] {
    const complete: JumpStep[][] = [];
    const stubs: Array<{ steps: JumpStep[]; jumped: Set<string> }> = [];

    for (const cell of [...marbles.keys()].sort()) {
        if (!rings.has(cell)) {
            continue;
        }
        for (const step of jumpStepsFromStart(graph, rings, marbles, cell)) {
            stubs.push({ steps: [step], jumped: new Set([step.over]) });
        }
    }

    while (stubs.length > 0) {
        const { steps, jumped } = stubs.shift()!;
        const last = steps[steps.length - 1]!;
        const movingColour = marbles.get(steps[0]!.from)!;
        const simRings = new Set(rings);
        const simMarbles = new Map(marbles);
        for (const s of steps) {
            simMarbles.delete(s.over);
            simMarbles.delete(s.from);
            simMarbles.set(s.to, movingColour);
        }
        const continuations = jumpStepsFromStart(graph, simRings, simMarbles, last.to).filter(
            (c) => !jumped.has(c.over),
        );
        if (continuations.length === 0) {
            complete.push(steps);
            continue;
        }
        for (const c of continuations) {
            const nextJumped = new Set(jumped);
            nextJumped.add(c.over);
            stubs.push({ steps: [...steps, c], jumped: nextJumped });
        }
    }

    const unique = new Map<string, JumpStep[]>();
    for (const chain of complete) {
        const key = chain.map((s) => stepKey(s)).join(";");
        unique.set(key, chain);
    }
    return [...unique.values()];
}