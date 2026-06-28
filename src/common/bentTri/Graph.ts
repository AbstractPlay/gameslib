import { Edge } from "./Edge";
import { Vertex } from "./Vertex";
import { buildGridLayers } from "./gridLayers";
import {
    type LatticeRef,
    type Point,
    midpoint,
    overlapRowsFor,
    placeCopy,
    positionKey,
    refKey,
} from "./lattice";

export type BentTriOptions = {
    scale?: number;
    /** Collapse exposed wing seam pairs onto straight radial axes (default true). */
    joinSeams?: boolean;
};

/**
 * Merged topology of three overlapped triangular-lattice copies.
 *
 * Build pipeline (see user spec):
 *   1. Lay out three rotated copies with the overlap cap aligned.
 *   2. Weld coincident cap vertices (fixed forever).
 *   3. Collapse exposed wing seam pairs to strict midpoints.
 *   4. Wire edges / outer flags / grid rings for play.
 *
 * Seam spacing and display bowing are applied later in bendGeometry.ts.
 */
export class Graph {
    public vertices: Vertex[] = [];
    public edges: Edge[] = [];
    /** Copy-0 row slices (pre-bow flat coordinates). */
    public layers: Vertex[][] = [];
    /** Playable rings outside-in: north apex, then clockwise. */
    public gridLayers: Vertex[][] = [];
    /** Lattice ref string → compact vertex id. */
    public refToVid = new Map<string, number>();
    /** Board frequency (n). */
    public readonly frequency: number;
    /** Rows in the overlap cap. */
    public readonly overlapRows: number;
    /** Lattice scale used when the graph was built. */
    public readonly scale: number;
    /** Whether exposed wing seams were collapsed during the build. */
    public readonly joinSeams: boolean;

    constructor(frequency: number, opts?: BentTriOptions) {
        this.frequency = frequency;
        this.overlapRows = overlapRowsFor(frequency);
        this.scale = opts?.scale ?? frequency * 50;
        this.joinSeams = opts?.joinSeams !== false;
        this.buildMergedGraph(frequency);
    }

    private buildMergedGraph(n: number): void {
        const scale = this.scale;
        const overlapRows = this.overlapRows;
        const posByRef = new Map<string, Point>();

        const place = (copy: number, row: number, col: number): Point => {
            const key = refKey({ copy, row, col });
            const cached = posByRef.get(key);
            if (cached !== undefined) {
                return cached;
            }
            const pos = placeCopy(copy, row, col, n, scale);
            posByRef.set(key, pos);
            return pos;
        };

        const vertexByPos = new Map<string, number>();
        const refToVid = this.refToVid;
        refToVid.clear();

        const getOrCreateVertex = (ref: LatticeRef): number => {
            const key = refKey(ref);
            const existing = refToVid.get(key);
            if (existing !== undefined) {
                return existing;
            }

            const pos = place(ref.copy, ref.row, ref.col);
            const pkey = positionKey(pos);
            const welded = vertexByPos.get(pkey);

            // Step 5: merge overlapped cap vertices that land on the same point.
            if (welded !== undefined) {
                refToVid.set(key, welded);
                return welded;
            }

            const vid = this.vertices.length;
            this.vertices.push(new Vertex(vid, false));
            this.vertices[vid].setPoint(pos.x, pos.y);
            vertexByPos.set(pkey, vid);
            refToVid.set(key, vid);
            return vid;
        };

        const edgeKeys = new Set<string>();
        const addEdge = (vidA: number, vidB: number): void => {
            if (vidA === vidB) {
                return;
            }
            const lo = Math.min(vidA, vidB);
            const hi = Math.max(vidA, vidB);
            const key = `${lo}:${hi}`;
            if (edgeKeys.has(key)) {
                return;
            }
            edgeKeys.add(key);
            this.edges.push(new Edge(this.edges.length, lo, hi));
        };

        // Steps 1–5: three copies, each with full triangular-lattice edges.
        const addCopyEdges = (copy: number): void => {
            for (let row = 0; row <= n; row++) {
                for (let col = 0; col <= row; col++) {
                    const vidA = getOrCreateVertex({ copy, row, col });
                    if (col < row) {
                        addEdge(vidA, getOrCreateVertex({ copy, row, col: col + 1 }));
                    }
                    if (row < n) {
                        addEdge(vidA, getOrCreateVertex({ copy, row: row + 1, col }));
                        addEdge(
                            vidA,
                            getOrCreateVertex({ copy, row: row + 1, col: col + 1 }),
                        );
                    }
                }
            }
        };

        for (let copy = 0; copy < 3; copy++) {
            addCopyEdges(copy);
        }

        // Steps 7–8: wing seam midpoints (optional but default on).
        if (this.joinSeams) {
            this.joinExposedSeams(n, overlapRows, refToVid);
        }

        this.wireAdjacency();
        this.remarkOuterVertices();
        this.buildLayersFromBaseCopy(n, refToVid);
        this.gridLayers = buildGridLayers(this);
    }

    /**
     * Step 7–8: for every row below the cap, merge each exposed wing edge
     * vertex with its partner on the adjacent copy's bottom row, at the
     * midpoint of the two pre-merge positions. Seam spacing is applied later
     * in bendGeometry.ts (`applySeamSpread`).
     */
    private joinExposedSeams(
        n: number,
        overlapRows: number,
        refToVid: Map<string, number>,
    ): void {
        const k = Math.floor(n / 2);
        // First exposed row below the overlap cap — same rule for all n.
        const wingStart = overlapRows;

        const vid = (copy: number, row: number, col: number): number => {
            const id = refToVid.get(refKey({ copy, row, col }));
            if (id === undefined) {
                throw new Error(`Missing vertex for copy ${copy} at (${row}, ${col})`);
            }
            return id;
        };

        const parent = new Map<number, number>();
        const find = (v: number): number => {
            let root = v;
            while (parent.has(root)) {
                root = parent.get(root)!;
            }
            let cur = v;
            while (cur !== root) {
                const next = parent.get(cur)!;
                parent.set(cur, root);
                cur = next;
            }
            return root;
        };

        const remapRefs = (dropRoot: number, keepRoot: number): void => {
            const rootKeep = find(keepRoot);
            for (const [ref, id] of refToVid) {
                if (ref.startsWith("0,")) {
                    continue;
                }
                if (find(id) === dropRoot) {
                    refToVid.set(ref, rootKeep);
                }
            }
        };

        const pt = (v: number): Point => {
            const p = this.vertices[find(v)].pt!;
            return { x: p.x, y: p.y };
        };

        const union = (keep: number, drop: number, pos: Point): void => {
            const rootKeep = find(keep);
            const rootDrop = find(drop);
            if (rootKeep === rootDrop) {
                this.vertices[rootKeep].setPoint(pos.x, pos.y);
                return;
            }
            parent.set(rootDrop, rootKeep);
            this.vertices[rootKeep].setPoint(pos.x, pos.y);
            remapRefs(rootDrop, rootKeep);
        };

        const weldAxis = (
            welds: { keep: number; drop: number }[],
        ): void => {
            for (const w of welds) {
                union(w.keep, w.drop, midpoint(pt(w.keep), pt(w.drop)));
            }
        };

        const weldWing = (welds: { keep: number; drop: number }[]): void => {
            for (const w of welds) {
                union(w.keep, w.drop, midpoint(pt(w.keep), pt(w.drop)));
            }
        };

        // Interior top seam: hub-outward order (cap-adjacent first).
        const topWelds: { keep: number; drop: number }[] = [];
        for (let i = 1; i <= k; i++) {
            const row = k - i;
            topWelds.push({
                keep: vid(1, row, row),
                drop: vid(2, row, 0),
            });
        }
        weldAxis(topWelds);

        // Left wing: strict midpoint of each pair.
        const leftWelds: { keep: number; drop: number }[] = [];
        for (let row = wingStart; row <= n; row++) {
            leftWelds.push({
                keep: vid(0, row, row),
                drop: vid(2, n, row),
            });
        }
        weldWing(leftWelds);

        // Right wing: strict midpoint of each pair.
        const rightWelds: { keep: number; drop: number }[] = [];
        for (let row = wingStart; row <= n; row++) {
            rightWelds.push({
                keep: vid(0, row, 0),
                drop: vid(1, n, n - row),
            });
        }
        weldWing(rightWelds);

        this.compactVertices(parent, refToVid);
    }

    /** Renumber vertices / edges after union-find seam collapse. */
    private compactVertices(
        parent: Map<number, number>,
        refToVid: Map<string, number>,
    ): void {
        const canonical = (v: number): number => {
            let root = v;
            while (parent.has(root)) {
                root = parent.get(root)!;
            }
            return root;
        };

        const oldToNew = new Map<number, number>();
        const newVertices: Vertex[] = [];
        for (const vertex of this.vertices) {
            const root = canonical(vertex.id);
            if (oldToNew.has(root)) {
                oldToNew.set(vertex.id, oldToNew.get(root)!);
                continue;
            }
            const newId = newVertices.length;
            oldToNew.set(root, newId);
            oldToNew.set(vertex.id, newId);
            const src = this.vertices[root];
            const v = new Vertex(newId, src.isOuter);
            if (src.pt !== undefined) {
                v.setPoint(src.pt.x, src.pt.y);
            }
            newVertices.push(v);
        }

        const edgeKeys = new Set<string>();
        const newEdges: Edge[] = [];
        for (const edge of this.edges) {
            const a = oldToNew.get(canonical(edge.vidA));
            const b = oldToNew.get(canonical(edge.vidB));
            if (a === undefined || b === undefined || a === b) {
                continue;
            }
            const lo = Math.min(a, b);
            const hi = Math.max(a, b);
            const key = `${lo}:${hi}`;
            if (edgeKeys.has(key)) {
                continue;
            }
            edgeKeys.add(key);
            newEdges.push(new Edge(newEdges.length, lo, hi));
        }

        this.vertices = newVertices;
        this.edges = newEdges;

        for (const [ref, oldId] of refToVid) {
            const mapped = oldToNew.get(oldId);
            if (mapped === undefined) {
                throw new Error(`Could not remap lattice ref ${ref} from vertex ${oldId}`);
            }
            refToVid.set(ref, mapped);
        }
    }

    private wireAdjacency(): void {
        for (const edge of this.edges) {
            this.vertices[edge.vidA].addEdge(edge.id);
            this.vertices[edge.vidB].addEdge(edge.id);
            this.vertices[edge.vidA].addNbor(this.vertices[edge.vidB].id);
            this.vertices[edge.vidB].addNbor(this.vertices[edge.vidA].id);
        }
    }

    /** Boundary vertices with fewer than four neighbours become outer corners/edges. */
    private remarkOuterVertices(): void {
        const edgeCount = new Map<string, number>();
        for (const edge of this.edges) {
            const lo = Math.min(edge.vidA, edge.vidB);
            const hi = Math.max(edge.vidA, edge.vidB);
            const key = `${lo}:${hi}`;
            edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
        }

        for (const vertex of this.vertices) {
            vertex.setOuter(false);
        }

        const boundaryVerts = new Set<number>();
        for (const edge of this.edges) {
            const lo = Math.min(edge.vidA, edge.vidB);
            const hi = Math.max(edge.vidA, edge.vidB);
            if ((edgeCount.get(`${lo}:${hi}`) ?? 0) === 1) {
                boundaryVerts.add(lo);
                boundaryVerts.add(hi);
            }
        }

        for (const vid of boundaryVerts) {
            if (this.vertices[vid].nbors.length < 4) {
                this.vertices[vid].setOuter(true);
            }
        }

        for (const edge of this.edges) {
            edge.isOuter = false;
            if (this.vertices[edge.vidA].isOuter && this.vertices[edge.vidB].isOuter) {
                edge.isOuter = true;
            }
        }
    }

    private buildLayersFromBaseCopy(n: number, refToVid: Map<string, number>): void {
        this.layers = [];
        for (let row = 0; row <= n; row++) {
            const layer: Vertex[] = [];
            for (let col = 0; col <= row; col++) {
                const vid = refToVid.get(refKey({ copy: 0, row, col }));
                if (vid === undefined) {
                    throw new Error(`Missing base copy vertex at (${row}, ${col})`);
                }
                layer.push(this.vertices[vid]);
            }
            this.layers.push(layer);
        }
    }

    public toString = (): string => {
        let str = `${this.vertices.length} vertices:\n`;
        for (const vertex of this.vertices) {
            str += `- ${vertex}\n`;
        }
        str += `${this.edges.length} edges:\n`;
        for (const edge of this.edges) {
            str += `- ${edge}\n`;
        }
        return str;
    };
}
