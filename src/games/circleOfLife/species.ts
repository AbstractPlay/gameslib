import { HexTriGraph, HexDir } from "../../common/graphs/hextri.js";

export const SPECIES_COUNT = 12;
export const CAPTURE_THRESHOLD = 20;

const BEARING_DELTA: Record<HexDir, [number, number]> = {
    NE: [1, -1],
    E: [1, 0],
    SE: [0, 1],
    SW: [-1, 1],
    W: [-1, 0],
    NW: [0, -1],
};

const axialMapCache = new WeakMap<HexTriGraph, Map<string, [number, number]>>();

function buildAxialMap(graph: HexTriGraph): Map<string, [number, number]> {
    const cached = axialMapCache.get(graph);
    if (cached) { return cached; }

    const axial = new Map<string, [number, number]>();
    const ordered = graph.listCells(true) as string[][];
    const midrow = Math.floor(ordered.length / 2);
    const root = ordered[midrow]![Math.floor(ordered[midrow]!.length / 2)]!;
    axial.set(root, [0, 0]);

    for (const cell of graph.listCells(false) as string[]) {
        if (axial.has(cell)) { continue; }
        const path = graph.path(root, cell);
        if (path === null) {
            throw new Error(`Could not path from ${root} to ${cell}`);
        }
        let [aq, ar] = [0, 0];
        for (let i = 1; i < path.length; i++) {
            const bearing = graph.bearing(path[i - 1]!, path[i]!);
            if (bearing === undefined) {
                throw new Error(`Could not determine bearing from ${path[i - 1]} to ${path[i]}`);
            }
            const [dq, dr] = BEARING_DELTA[bearing];
            aq += dq;
            ar += dr;
        }
        axial.set(cell, [aq, ar]);
    }

    axialMapCache.set(graph, axial);
    return axial;
}

function axialToCube(q: number, r: number): [number, number, number] {
    return [q, r, -q - r];
}

function cubeToAxial(q: number, r: number): [number, number] {
    return [q, r];
}

function rotateCube(q: number, r: number, s: number): [number, number, number] {
    return [-r, -s, -q];
}

function reflectCube(q: number, r: number, s: number): [number, number, number] {
    return [s, r, q];
}

export function canonicalAxialKey(coords: [number, number][]): string {
    const keys: string[] = [];
    for (let rot = 0; rot < 6; rot++) {
        for (const flip of [false, true]) {
            let cubes = coords.map(([q, r]) => axialToCube(q, r));
            if (flip) {
                cubes = cubes.map(([q, r, s]) => reflectCube(q, r, s));
            }
            for (let i = 0; i < rot; i++) {
                cubes = cubes.map(([q, r, s]) => rotateCube(q, r, s));
            }
            const minQ = Math.min(...cubes.map(([q]) => q));
            const minR = Math.min(...cubes.map(([, r]) => r));
            const norm = cubes.map(([q, r]) => {
                const [nq, nr] = cubeToAxial(q - minQ, r - minR);
                return `${nq},${nr}`;
            }).sort().join("|");
            keys.push(norm);
        }
    }
    return keys.sort()[0];
}

export function speciesKey(cells: string[], graph: HexTriGraph): string {
    if (cells.length === 0) {
        throw new Error("Cannot classify an empty species group.");
    }
    const axial = buildAxialMap(graph);
    const keys = cells.map(root => {
        const [rq, rr] = axial.get(root)!;
        const coords = cells.map(c => {
            const [q, r] = axial.get(c)!;
            return [q - rq, r - rr] as [number, number];
        });
        return canonicalAxialKey(coords);
    });
    return keys.sort()[0];
}

// Indices match circle-of-life-ring slots species-0 … species-11 (CCW from singleton at top).
// Key order is fixed to the reference overlay embedding (not sorted canonical keys within each size).
const RING_SPECIES_KEYS: readonly string[] = [
    "0,0",
    "0,0|0,1",
    "0,0|0,1|1,1",
    "0,0|0,1|0,2",
    "0,0|0,1|1,0",
    "0,0|0,1|0,2|1,0",
    "0,0|0,1|0,2|1,2",
    "0,0|0,1|1,1|2,0",
    "0,0|0,1|1,1|1,2",
    "0,0|0,1|1,0|1,1",
    "0,1|1,1|1,2|2,0",
    "0,0|0,1|0,2|0,3",
];

function enumerateSpeciesKeys(): string[] {
    if (RING_SPECIES_KEYS.length !== SPECIES_COUNT) {
        throw new Error(`Expected ${SPECIES_COUNT} Circle of Life ring species keys`);
    }
    if (new Set(RING_SPECIES_KEYS).size !== SPECIES_COUNT) {
        throw new Error("Circle of Life ring species keys are not distinct");
    }
    return [...RING_SPECIES_KEYS];
}

let speciesKeyTable: string[] | undefined;
let keyToSpecies: Map<string, number> | undefined;

function ensureCatalog(): void {
    if (speciesKeyTable !== undefined) { return; }
    speciesKeyTable = enumerateSpeciesKeys();
    keyToSpecies = new Map(speciesKeyTable.map((key, index) => [key, index]));
}

export function speciesIndex(cells: string[], graph: HexTriGraph): number {
    ensureCatalog();
    const key = speciesKey(cells, graph);
    const index = keyToSpecies!.get(key);
    if (index === undefined) {
        throw new Error(`Unrecognized species shape: ${key}`);
    }
    return index;
}

export function preyIndex(species: number): number {
    return (species - 1 + SPECIES_COUNT) % SPECIES_COUNT;
}

export function speciesKeys(): readonly string[] {
    ensureCatalog();
    return speciesKeyTable!;
}
