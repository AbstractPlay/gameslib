import type { UndirectedGraph } from "graphology";
import { bidirectional } from "graphology-shortest-path/unweighted.js";
import type { StarGraph, StarNodeData } from "../graphs/star.js";

const SIDE_COUNT = 5;

export const starSidesAdjacent = (a: number, b: number): boolean => {
    const d = Math.abs(a - b);
    return d === 1 || d === SIDE_COUNT - 1;
};

export const isStarYTripleValid = (a: number, b: number, c: number): boolean => {
    const sides = [a, b, c];
    return sides.some((x) => {
        const others = sides.filter((s) => s !== x);
        return !starSidesAdjacent(x, others[0]!) && !starSidesAdjacent(x, others[1]!);
    });
};

export const starHasYWin = (touchedSideIndices: number[]): boolean => {
    if (touchedSideIndices.length > 3) {
        return true;
    }
    if (touchedSideIndices.length < 3) {
        return false;
    }
    const [a, b, c] = touchedSideIndices;
    return isStarYTripleValid(a, b, c);
};

/** Five outer-side cell lists (side 0 from top quark clockwise). Quarks appear on two lists. */
export const starOuterSides = (graph: StarGraph): string[][] => {
    const outer = (graph.listCells(true) as string[][])[0]!;
    const quarks = outer.filter((cell: string) => (graph.graph.getNodeAttributes(cell) as StarNodeData).isQuark);
    if (quarks.length !== SIDE_COUNT) {
        throw new Error(`Expected ${SIDE_COUNT} quarks on outer ring, got ${quarks.length}.`);
    }
    const sides: string[][] = [];
    for (let i = 0; i < SIDE_COUNT; i++) {
        const start = quarks[i]!;
        const end = quarks[(i + 1) % SIDE_COUNT]!;
        const side: string[] = [];
        let idx = outer.indexOf(start);
        if (idx < 0) {
            throw new Error(`Quark ${start} not found on outer ring.`);
        }
        for (;;) {
            const cell = outer[idx]!;
            side.push(cell);
            if (cell === end) {
                break;
            }
            idx = (idx + 1) % outer.length;
        }
        sides.push(side);
    }
    return sides;
};

export const starSidesForCell = (graph: StarGraph, cell: string, sides?: string[][]): number[] => {
    const outerSides = sides ?? starOuterSides(graph);
    const indices: number[] = [];
    for (let i = 0; i < outerSides.length; i++) {
        if (outerSides[i]!.includes(cell)) {
            indices.push(i);
        }
    }
    return indices;
};

export const starTouchedSides = (group: string[], sides: string[][]): number[] => {
    const touched = new Set<number>();
    for (const cell of group) {
        for (let i = 0; i < sides.length; i++) {
            if (sides[i]!.includes(cell)) {
                touched.add(i);
            }
        }
    }
    return [...touched].sort((a, b) => a - b);
};

export const starPickWitnessTriple = (touchedSideIndices: number[]): [number, number, number] | null => {
    const unique = [...new Set(touchedSideIndices)].sort((a, b) => a - b);
    if (unique.length === 3 && isStarYTripleValid(unique[0]!, unique[1]!, unique[2]!)) {
        return [unique[0]!, unique[1]!, unique[2]!];
    }
    if (unique.length < 3) {
        return null;
    }
    for (let i = 0; i < unique.length; i++) {
        for (let j = i + 1; j < unique.length; j++) {
            for (let k = j + 1; k < unique.length; k++) {
                const triple: [number, number, number] = [unique[i]!, unique[j]!, unique[k]!];
                if (isStarYTripleValid(...triple)) {
                    return triple;
                }
            }
        }
    }
    return null;
};

const pickOnGroupCell = (group: Set<string>, sideCells: string[]): string | undefined => {
    for (const cell of sideCells) {
        if (group.has(cell)) {
            return cell;
        }
    }
    return undefined;
};

/** Stitch shortest paths on `g` through three sides; returns null if no path can be built. */
export const starBuildConnPath = (
    g: UndirectedGraph,
    group: string[],
    sides: string[][],
    triple: [number, number, number],
): string[] | null => {
    const grp = new Set(group);
    const cells = triple.map((si) => pickOnGroupCell(grp, sides[si]!));
    if (cells.some((c) => c === undefined)) {
        return null;
    }
    const [a, b, c] = cells as [string, string, string];
    const ab = g.hasNode(a) && g.hasNode(b) ? bidirectional(g, a, b) : null;
    const bc = g.hasNode(b) && g.hasNode(c) ? bidirectional(g, b, c) : null;
    if (ab === null || bc === null) {
        return null;
    }
    return [...ab.slice(0, -1), ...bc];
};

export const starBuildConnPathForWin = (
    g: UndirectedGraph,
    group: string[],
    sides: string[][],
    touchedSideIndices: number[],
): string[] | null => {
    const triple = starPickWitnessTriple(touchedSideIndices);
    if (triple === null) {
        return null;
    }
    const path = starBuildConnPath(g, group, sides, triple);
    if (path !== null) {
        return path;
    }
    const grp = new Set(group);
    const tripleSides = triple.map((si) => sides[si]!);
    const choices: string[][] = tripleSides.map((sideCells) => sideCells.filter((cell) => grp.has(cell)));
    const tryCombo = (idx: number, picked: string[]): string[] | null => {
        if (idx === 3) {
            const ab = bidirectional(g, picked[0]!, picked[1]!);
            const bc = bidirectional(g, picked[1]!, picked[2]!);
            if (ab === null || bc === null) {
                return null;
            }
            return [...ab.slice(0, -1), ...bc];
        }
        for (const cell of choices[idx]!) {
            const rest = tryCombo(idx + 1, [...picked, cell]);
            if (rest !== null) {
                return rest;
            }
        }
        return null;
    };
    return tryCombo(0, []);
};
