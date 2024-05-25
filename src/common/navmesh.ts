// Inspired by https://catjam.fi/articles/2d-navmeshes-javascript
/* eslint-disable @typescript-eslint/naming-convention */
import earcut from "earcut";
import { partitionArray, ptDistance } from ".";
import { UndirectedGraph } from "graphology";
import { ShortestPath, bidirectional } from "graphology-shortest-path/unweighted";
import { Combination } from "js-combinatorics";
import turfPip from "@turf/boolean-point-in-polygon";
import { polygon as turfPoly, point as turfPoint } from "@turf/helpers";

type Vertex = [number,number];
type Triangle = [number,number,number];
type Side = [Vertex,Vertex];

type TriParams = {id: string, A: number, B: number, C: number, a: [number,number], b: [number,number], c: [number,number], constrained: boolean /* whether side c is constrained */};
type MiniTriParams = {id: string, A?: number, B?: number, C?: number, a?: [number,number], b?: [number,number], c?: [number,number], constrained: boolean /* whether side c is constrained */};

export interface INavmeshOpts {
    container: Vertex[]
    obstacles: Vertex[][]
    minEdgeLength?: number;
}

interface EdgeData {
    pt1: number;
    pt2: number;
}

interface WidthData {
    // the maximum width of the path
    width: number;
    // the triangle this edge represents (for two-step edges)
    triangle?: string;
}

const twoLineAngle = (side1: Side, side2: Side): number => {
    const m1 = (side1[1][1] - side1[0][1]) / (side1[1][0] - side1[0][0]);
    const m2 = (side2[1][1] - side2[0][1]) / (side2[1][0] - side2[0][0]);
    return Math.atan((m2 - m1) / (1 + (m1 * m2))) * (180 / Math.PI);
}

const distanceBetween = (side: Side, C: Vertex): number => {
    const [A, B] = [...side];
    if (A[0] === B[0]) {
        return Math.abs(A[0] - C[0]);
    }
    const rise = B[1] - A[1];
    const run = B[0] - A[0];
    const intercept = A[1] - ((rise / run) * A[0]);
    const [a, b, c] = [rise, run, run * intercept];
    return Math.abs((a * C[0]) + (b * C[1]) + c) / Math.sqrt(a**2 + b**2);
}

export class Navmesh {
    public readonly minEdgeLength: number;
    private readonly container: Vertex[];
    private readonly obstacles: Vertex[][];
    private readonly allVerts: Vertex[];
    private readonly triangles: Triangle[];
    private readonly constrainedEdges: string[];
    private readonly graphBase: UndirectedGraph;
    private readonly graphTraversal: UndirectedGraph;
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
        this.triangles = partitionArray(indices, 3) as Triangle[];
        this.triangles.map(tri => tri.sort((a,b) => a - b))

        // now build the graph of triangles
        const g = new UndirectedGraph();
        // add all nodes first
        for (const tri of this.triangles) {
            const idTri = tri.join(",");
            g.addNode(idTri)
        }
        // now add all edges
        // a "constrained" edge is an edge attached to only a single triangle
        // (i.e., it abuts an obstacle and cannot be crossed)
        this.constrainedEdges = [];
        for (const tri of this.triangles) {
            const idTri = tri.join(",");
            const it = new Combination(tri, 2);
            for (const pair of it) {
                const n = this.triangles.find(pts => pts.includes(pair[0]) && pts.includes(pair[1]) && pts.join(",") !== idTri);
                if (n !== undefined) {
                    const idNeighbour = n.join(",");
                    if (! g.hasEdge(idTri, idNeighbour)) {
                        g.addEdge(idTri, idNeighbour, {pt1: pair[0], pt2: pair[1]} as EdgeData)
                    }
                } else {
                    this.constrainedEdges.push(pair.join(","));
                }
            }
        }
        this.graphBase = g;

        // now do width calculations (results in a new graph)
        // https://skatgame.net/mburo/ps/thesis_demyen_2006.pdf
        // For every triangle, get a list of neighbours
        // Add each triangle as a node
        // Add an edge with a `width` attribute giving the width of the adjoining edge
        // (I'm not sure this is wholly correct, but we need to account for moving between adjacent triangles.)
        // For every triangle, get a list of triangles that can be reached in two steps.
        // Ignore pairs that have already been calculated
        // Determine the intermediate triangle and edges the piece would have to traverse.
        // Calculate the maximum width
        // Add an undirected edge between them with `triangle` and `width` attributes
        // Now drop all edges that don't meet the minimum width requirements
        const gt = new UndirectedGraph();
        for (const edge of g.edges()) {
            const [left, right] = g.extremities(edge);
            const attr = g.getEdgeAttributes(edge) as EdgeData;
            const realEdge = [this.allVerts[attr.pt1], this.allVerts[attr.pt2]] as Side;
            const width = ptDistance(...realEdge[0], ...realEdge[1]);
            if (! gt.hasNode(left)) {
                gt.addNode(left);
            }
            if (! gt.hasNode(right)) {
                gt.addNode(right);
            }
            gt.addEdge(left, right, {width} as WidthData);
        }
        for (const edge1 of g.edges()) {
            const [left, mid] = g.extremities(edge1);
            const attr1 = g.getEdgeAttributes(edge1) as EdgeData;
            const sideA = [attr1.pt1, attr1.pt2] as [number,number];
            for (const edge2 of g.edges(mid)) {
                if (edge2 === edge1) {
                    continue;
                }
                const right = g.extremities(edge2).filter(n => n !== mid)[0];
                if (gt.hasEdge(left, right)) {
                    continue;
                }
                const attr2 = g.getEdgeAttributes(edge2) as EdgeData;
                const iC = [attr1.pt1, attr1.pt2].find(n => [attr2.pt1, attr2.pt2].includes(n))!;
                const iA = [attr1.pt1, attr1.pt2].find(n => n !== iC)!;
                const iB = [attr2.pt1, attr2.pt2].find(n => n !== iC)!;
                const sideB = [attr2.pt1, attr2.pt2] as [number,number];
                let sideC: [number,number]|undefined;
                const it = new Combination(mid.split(",").map(n => parseInt(n, 10)), 2);
                for (const pair of it) {
                    if ( (pair[0] === attr1.pt1 && pair[1] === attr1.pt2) ||
                         (pair[0] === attr2.pt1 && pair[1] === attr2.pt2)
                       ) {
                        continue;
                    }
                    sideC = [...pair] as [number,number];
                    break;
                }
                if (sideC === undefined) {
                    throw new Error("Could not find the triangle's third side.");
                }
                const width = this.calculateWidth({id: mid, A: iA, B: iB, C: iC, a: sideA, b: sideB, c: sideC, constrained: this.constrainedEdges.includes(sideC.join(","))});
                gt.addEdge(left, right, {width, triangle: mid} as WidthData)
            }
        }

        // now drop all edges that aren't wide enough
        const tooSmall = gt.filterEdges((_, attr) => attr.width < this.minEdgeLength);
        for (const edge of tooSmall) {
            gt.dropEdge(edge);
        }

        // All Done!
        this.graphTraversal = gt;
    }

    // everything is passed in as indices so we can search properly
    private calculateWidth(tri: TriParams): number {
        // const A = this.allVerts[tri.A];
        // const B = this.allVerts[tri.B];
        const C = this.allVerts[tri.C];
        const a = tri.a.map(n => this.allVerts[n]) as Side;
        const b = tri.b.map(n => this.allVerts[n]) as Side;
        const c = tri.c.map(n => this.allVerts[n]) as Side;
        // case 1
        const d = Math.min(ptDistance(...a[0], ...a[1]), ptDistance(...b[0], ...b[1]));
        const theta1 = twoLineAngle(a, c);
        const theta2 = twoLineAngle(b, c);
        if ( (!isNaN(theta1) && theta1 < 0) || (!isNaN(theta2) && theta2 < 0) ) {
            return d;
        }

        // case 2
        if (tri.constrained) {
            return distanceBetween(c, C);
        }

        // case 3 (the complex one)
        return this.searchWidth(tri, C, tri.c, d);
    }

    private searchWidth(tri: MiniTriParams, C: Vertex, e: [number,number], d: number): number {
        const [U, V] = e.map(i => this.allVerts[i]);
        const theta1 = twoLineAngle([C, U], [U, V]);
        const theta2 = twoLineAngle([C, V], [V, U]);
        if ( (!isNaN(theta1) && theta1 < 0) || (!isNaN(theta2) && theta2 < 0) ) {
            return d;
        }
        let dNew = distanceBetween([U,V], C);
        if (dNew > d) {
            return d;
        }
        if (tri.constrained) {
            return dNew;
        }
        const connEdge = this.graphBase.findEdge(tri.id, (_,attr) => attr.pt1 === e[0] && attr.pt2 === e[1]);
        if (connEdge === undefined) {
            throw new Error(`Could not find triangle opposite to ${tri.id}]] across from side ${JSON.stringify(e)}`);
        }
        const oppNode = this.graphBase.extremities(connEdge).find(s => s !== tri.id)!;
        const idxs = oppNode.split(",").map(n => parseInt(n, 10));
        const otherSides: [number,number][] = [];
        const it = new Combination(idxs, 2);
        for (const pair of it) {
            if (pair[0] === e[0] && pair[1] === e[1]) {
                continue;
            }
            otherSides.push(pair as [number,number]);
        }
        const triNew: MiniTriParams = {
            id: oppNode,
            constrained: this.constrainedEdges.includes(otherSides[0].join(",")),
        };
        dNew = this.searchWidth(triNew, C, otherSides[0], d);
        triNew.constrained = this.constrainedEdges.includes(otherSides[1].join(","));
        return this.searchWidth(triNew, C, otherSides[1], dNew);
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
        const path = bidirectional(this.graphTraversal, idStart, idEnd);
        if (path === null) {
            return null;
        }
        if (path.length === 1) {
            return path;
        }
        // expand the path to include the intermediate triangles
        const expanded: string[] = [path[0]];
        for (let i = 0; i < path.length - 1; i++) {
            const left = path[i];
            const right = path[i+1];
            const edge = this.graphTraversal.edge(left, right);
            if (edge === undefined) {
                throw new Error(`Could not find a path between ${left} and ${right} in the traversal graph.`);
            }
            const attr = this.graphTraversal.getEdgeAttributes(edge) as WidthData;
            if ( ("triangle" in attr) && (attr.triangle !== undefined) ) {
                expanded.push(attr.triangle);
            }
            expanded.push(right);
        }
        return expanded;
        // Don't try to draw the path. It's too complicated to make it rational.
    }
}
