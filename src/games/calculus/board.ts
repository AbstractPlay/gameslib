import { IPoint, calcBearing, circle2poly, projectPoint, ptDistance } from "../../common";
import { polygon as turfPoly } from "@turf/helpers";
import turfContans from "@turf/boolean-contains";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";

type Vertex = [number,number];
type CircularForm = Vertex[][];

export class Board {
    public readonly r: number;
    public readonly points: IPoint[];
    public readonly steps = 72;

    get circularForm(): CircularForm {
        return [[...this.points.map(p => [p.x, p.y] as Vertex), [this.points[0].x, this.points[0].y]]];
    }
    get verts(): Vertex[] {
        return this.points.map(pt => [pt.x,pt.y] as Vertex);
    }
    get transitionVerts(): Vertex[] {
        const verts = this.verts;
        return [verts[0], verts[18], verts[36], verts[54]];
    }
    get width(): number {
        return (this.r * 2) + 1;
    }
    get height(): number {
        return this.width;
    }

    constructor(r: number) {
        this.r = r;
        this.points = circle2poly(this.r, this.r, this.r, this.steps).map(([x,y]) => {return {x,y}});
    }

    public contains(p: CircularForm|Vertex): boolean {
        if (Array.isArray(p[0])) {
            return turfContans(turfPoly(this.circularForm), turfPoly(p as CircularForm));
        } else {
            return booleanPointInPolygon(p as Vertex, turfPoly(this.circularForm));
        }
    }
    public ownedVerts(p: 1|2): Vertex[] {
        const allVerts = [...this.verts, this.verts[0]];
        let [aStart, aEnd] = [0, 19];
        let [bStart, bEnd] = [36, 55 as number|undefined];
        if (p === 2) {
            [aStart, aEnd] = [18, 37];
            [bStart, bEnd] = [54, undefined];
        }
        return [...allVerts.slice(aStart, aEnd), ...allVerts.slice(bStart, bEnd)];
    }
    public ownedQuadrants(p: 1|2): [Vertex[], Vertex[]] {
        const allVerts = [...this.verts, this.verts[0]];
        let [aStart, aEnd] = [0, 19];
        let [bStart, bEnd] = [36, 55 as number|undefined];
        if (p === 2) {
            [aStart, aEnd] = [18, 37];
            [bStart, bEnd] = [54, undefined];
        }
        return [allVerts.slice(aStart, aEnd), allVerts.slice(bStart, bEnd)];
    }
    public closestTo(pt: Vertex): {distance: number, closest: Vertex} {
        let [smallestDist, closestVert] = [Infinity, null as null|Vertex];
        for (const v of this.verts) {
            const dist = ptDistance(...v, ...pt);
            if (dist < smallestDist) {
                smallestDist = dist;
                closestVert = v;
            }
        }
        return {distance: smallestDist, closest: closestVert!};
    }

    /**
     * Given a point, return the the bearing relatie to the centre point, table facing
     *
     * @param pt Vertex
     * @returns Vertex
     */
    public bearing(pt: Vertex): number {
        return calcBearing(this.r, this.r, ...pt);
    }

    /**
     * Given an angle, return the point on the perimeter of the board.
     *
     * @param theta angle in degrees in table facing
     * @returns Vertex
     */
    public perimeterPoint(theta: number): Vertex {
        return projectPoint(this.r, this.r, this.r, theta);
    }

    /**
     * Calculates the distance from the perimeter of the board of a given point.
     * Negative values lie outside of the perimeter
     *
     * @param pt Vertex
     * @returns number
     */
    public edgeDistance(pt: Vertex): number {
        const bearing = this.bearing(pt);
        const perimeter = this.perimeterPoint(bearing);
        const distCentre = ptDistance(this.r, this.r, ...pt);
        let distPerimeter = ptDistance(...pt, ...perimeter);
        if (distCentre > this.r) {
            distPerimeter *= -1;
        }
        return distPerimeter;
    }
}