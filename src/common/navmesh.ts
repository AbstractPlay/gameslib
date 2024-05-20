// Inspired by https://catjam.fi/articles/2d-navmeshes-javascript
/* eslint-disable @typescript-eslint/naming-convention */
import earcut from "earcut";
import { partitionArray, ptDistance } from ".";
import { UndirectedGraph } from "graphology";
import { ShortestPath, bidirectional } from "graphology-shortest-path/unweighted";
// import { edgePathFromNodePath } from "graphology-shortest-path";
import { Combination } from "js-combinatorics";
import turfPip from "@turf/boolean-point-in-polygon";
import { polygon as turfPoly, point as turfPoint } from "@turf/helpers";

type Vertex = [number,number];

export interface INavmeshOpts {
    container: Vertex[]
    obstacles: Vertex[][]
    minEdgeLength?: number;
}

interface EdgeData {
    verts: [number,number];
}

export class Navmesh {
    public readonly minEdgeLength: number;
    private readonly container: Vertex[];
    private readonly obstacles: Vertex[][];
    private readonly allVerts: Vertex[];
    private readonly triangles: [number,number,number][];
    private readonly graph: UndirectedGraph;
    get numTriangles(): number {
        return this.triangles.length;
    }
    get triangleVerts(): Vertex[][] {
        return this.triangles.map(tri => tri.map(idx => this.allVerts[idx]))
    }

    constructor(opts: INavmeshOpts) {
        if (opts.minEdgeLength !== undefined) {
            this.minEdgeLength = opts.minEdgeLength;
        } else {
            this.minEdgeLength = 20;
        }
        this.container = [...opts.container];
        this.obstacles = [...opts.obstacles.map(v => [...v])];
        // obstacle widths must be identical
        for (const lst of this.obstacles) {
            if (lst.length !== this.obstacles[0].length) {
                throw new Error(`All obstacles must have the same number of vertices.`);
            }
        }
        this.allVerts = [...this.container, ...this.obstacles.flat()];
        const holeIndices = new Array(this.obstacles.length).fill(0).map((_, i) => this.container.length + (i * this.obstacles[0].length));
        const indices = earcut(this.allVerts.flat(), holeIndices);
        this.triangles = partitionArray(indices, 3) as [number,number,number][];

        // now build the graph of triangles
        const g = new UndirectedGraph();
        // add all nodes first
        for (const tri of this.triangles) {
            const idTri = tri.join(",");
            g.addNode(idTri)
        }
        // now add edges that are long enough
        for (const tri of this.triangles) {
            const idTri = tri.join(",");
            const it = new Combination(tri, 2);
            for (const pair of it) {
                pair.sort();
                const n = this.triangles.find(pts => pts.includes(pair[0]) && pts.includes(pair[1]) && pts.join(",") !== idTri);
                if (n !== undefined) {
                    const idNeighbour = n.join(",");
                    if (ptDistance(...this.allVerts[pair[0]], ...this.allVerts[pair[1]]) >= this.minEdgeLength) {
                        if (! g.hasEdge(idTri, idNeighbour)) {
                            g.addEdge(idTri, idNeighbour, {verts: pair} as EdgeData)
                        }
                    }
                }
            }
        }
        this.graph = g;
    }

    private tri2CircularPath(tri: [number,number,number]): Vertex[][] {
        const coords: Vertex[] = [];
        for (const idx of [...tri, tri[0]]) {
            coords.push(this.allVerts[idx])
        }
        return [coords];
    }

    private findContainingTriangle(x: number, y: number): [number,number,number]|null {
        const pt = turfPoint([x,y]);
        for (const tri of this.triangles) {
            const poly = turfPoly(this.tri2CircularPath(tri));
            if (turfPip(pt, poly)) {
                return tri;
            }
        }
        return null;
    }

    public findPath(start: Vertex, end: Vertex): ShortestPath|null {
        const tStart = this.findContainingTriangle(...start);
        const tEnd = this.findContainingTriangle(...end);
        if (tStart === null || tEnd === null) {
            return null;
        }
        const idStart = tStart.join(",");
        const idEnd = tEnd.join(",");
        const path = bidirectional(this.graph, idStart, idEnd);
        if (path === null) {
            return null;
        }
        return path;
        // Don't try to draw the path. It's too complicated to make it rational.
        // const edges = edgePathFromNodePath(this.graph, path).map(eid => this.graph.getEdgeAttribute(eid, "verts") as [number,number]);
        // const edgeVertices = edges.map(idxs => idxs.map(i => this.allVerts[i]) as [Vertex,Vertex]);
        // const pathPoints: Vertex[] = [start];
        // for (const [[v1x, v1y], [v2x, v2y]] of edgeVertices) {
        //     let [shortestDist, shortestVert] = [Infinity, null as (null|Vertex)];
        //     for (let w = 0; w <= 1; w += 0.01) {
        //         const newv = [v1x + (v2x - v1x) * w, v1y + (v2y - v1y) * w] as Vertex;
        //         const dist = ptDistance(...pathPoints[pathPoints.length - 1], ...newv);
        //         if (dist < shortestDist) {
        //             shortestDist = dist;
        //             shortestVert = newv;
        //         }
        //     }
        //     pathPoints.push(shortestVert!);
        // }
        // return [...pathPoints, end]
    }
}