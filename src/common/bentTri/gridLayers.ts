import { Graph } from "./Graph";
import { Vertex } from "./Vertex";
import { refKey } from "./lattice";

/** North apex of the board (copy-1 wing tip). */
export const northApexId = (graph: Graph): number => {
    const apex = graph.refToVid.get(refKey({ copy: 1, row: 0, col: 0 }));
    if (apex === undefined) {
        throw new Error("Could not find the north apex vertex");
    }
    return apex;
};

const rotateToApex = (ids: number[], graph: Graph): number[] => {
    const apex = northApexId(graph);
    if (!ids.includes(apex)) {
        return ids;
    }
    const apexIdx = ids.indexOf(apex);
    if (apexIdx <= 0) {
        return ids;
    }
    return [...ids.slice(apexIdx), ...ids.slice(0, apexIdx)];
};

const pushUnique = (ring: Vertex[], seen: Set<number>, vertex: Vertex | undefined): void => {
    if (vertex === undefined || seen.has(vertex.id)) {
        return;
    }
    seen.add(vertex.id);
    ring.push(vertex);
};

/** Copy-0 vertices on the cap triangle at row rings (hub shell). */
const isHubShellVertex = (
    graph: Graph,
    id: number,
    rings: number,
): boolean => {
    for (const [ref, vid] of graph.refToVid) {
        if (vid !== id) {
            continue;
        }
        const [copy, row, col] = ref.split(",").map(Number);
        if (copy !== 0) {
            continue;
        }
        if (row === 0 && col === 0) {
            return true;
        }
        if (col === 0 && row <= rings) {
            return true;
        }
        if (row === rings) {
            return true;
        }
        if (col === row && row > 0 && row <= rings) {
            return true;
        }
    }
    return false;
};

const pushUniquePerimeter = (
    ring: Vertex[],
    seen: Set<number>,
    vertex: Vertex | undefined,
    graph: Graph,
    rings: number,
): void => {
    if (vertex === undefined || seen.has(vertex.id)) {
        return;
    }
    if (isHubShellVertex(graph, vertex.id, rings)) {
        return;
    }
    pushUnique(ring, seen, vertex);
};

/**
 * Concentric playable rings outside-in, each ordered clockwise from the north apex.
 * Every vertex appears in exactly one ring.
 */
export const buildGridLayers = (graph: Graph): Vertex[][] => {
    const n = graph.frequency;
    const overlapRows = graph.overlapRows;
    const refToVid = graph.refToVid;
    const vid = (copy: number, row: number, col: number): number | undefined =>
        refToVid.get(refKey({ copy, row, col }));

    const rings = Math.ceil(n / 2);
    const assigned = new Set<number>();
    const layers: Vertex[][] = [];

    const commitRing = (ids: number[]): void => {
        const fresh = ids.filter(id => !assigned.has(id));
        if (fresh.length === 0) {
            return;
        }
        const ordered = rotateToApex(fresh, graph);
        for (const id of ordered) {
            assigned.add(id);
        }
        layers.push(ordered.map(id => graph.vertices[id]!));
    };

    // Perimeter rings: copy-1 spine → copy-0 base → copy-2 hypotenuse.
    for (let gr = 0; gr < rings; gr++) {
        const seen = new Set<number>();
        const ring: Vertex[] = [];

        for (let row = gr; row <= n - 1; row++) {
            pushUniquePerimeter(ring, seen, graph.vertices[vid(1, row, gr)!], graph, rings);
        }

        const baseRow = n - gr;
        if (baseRow >= overlapRows) {
            for (let col = 0; col <= baseRow; col++) {
                pushUniquePerimeter(ring, seen, graph.vertices[vid(0, baseRow, col)!], graph, rings);
            }
        }

        for (let row = n - 1; row >= gr + 1; row--) {
            pushUniquePerimeter(ring, seen, graph.vertices[vid(2, row, row - gr)!], graph, rings);
        }

        commitRing(ring.map(vertex => vertex.id));
    }

    // Outermost cap ring (hub shell).
    {
        const seen = new Set<number>();
        const ring: Vertex[] = [];
        pushUnique(ring, seen, graph.vertices[vid(0, 0, 0)!]);
        for (let row = 1; row < rings; row++) {
            pushUnique(ring, seen, graph.vertices[vid(0, row, 0)!]);
        }
        for (let col = 0; col <= rings; col++) {
            pushUnique(ring, seen, graph.vertices[vid(0, rings, col)!]);
        }
        for (let row = rings - 1; row >= 1; row--) {
            pushUnique(ring, seen, graph.vertices[vid(0, row, row)!]);
        }
        commitRing(ring.map(vertex => vertex.id));
    }

    // Interior hub rings inside the overlap cap.
    let spineCol = 1;
    let bottomRow = overlapRows - 2;

    while (true) {
        const topRow = 2 * spineCol;
        if (topRow >= bottomRow) {
            break;
        }

        const seen = new Set<number>();
        const ring: Vertex[] = [];

        for (let row = topRow; row <= bottomRow; row++) {
            pushUnique(ring, seen, graph.vertices[vid(0, row, spineCol)!]);
        }
        for (let col = spineCol; col <= bottomRow - spineCol; col++) {
            pushUnique(ring, seen, graph.vertices[vid(0, bottomRow, col)!]);
        }
        const diagSteps = bottomRow - topRow;
        for (let i = diagSteps; i >= 0; i--) {
            pushUnique(ring, seen, graph.vertices[vid(0, topRow + i, spineCol + i)!]);
        }

        commitRing(ring.map(vertex => vertex.id));

        spineCol++;
        bottomRow--;
    }

    const centerRow = 2 * spineCol;
    if (centerRow >= bottomRow) {
        const centerId = vid(0, centerRow, spineCol);
        if (centerId !== undefined && !assigned.has(centerId)) {
            commitRing([centerId]);
        }
    }

    const missing = graph.vertices
        .map(vertex => vertex.id)
        .filter(id => !assigned.has(id));
    if (missing.length > 0) {
        commitRing(missing);
    }

    return layers;
};
