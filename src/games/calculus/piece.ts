import { IPoint, calcBearing, circle2poly, ptDistance } from "../../common";
import { playerid } from "../calculus";
import { polygon as turfPoly } from "@turf/helpers";
import turfWithin from "@turf/boolean-within";
import turfIntersects from "@turf/boolean-intersects";

export interface IPieceOpts {
    owner: playerid;
    cx: number;
    cy: number;
}

type Vertex = [number,number];
type CircularForm = Vertex[][];
export type Quadrant = "NE"|"SE"|"SW"|"NW";
export type RelativePos = {
    d: number;
    bearing: number;
    quadrant: Quadrant;
    pt: Vertex;
};

export class Piece {
    public readonly owner: playerid;
    public cx: number;
    public cy: number;
    public readonly r = 10;
    public readonly steps = 64

    get polygon(): IPoint[] {
        return circle2poly(this.cx, this.cy, this.r).map(([x,y]) => { return {x,y}; });
    }
    get circularForm(): CircularForm {
        const poly = this.polygon;
        return [[...poly.map(p => [p.x, p.y] as Vertex), [poly[0].x, poly[0].y]]];
    }
    get verts(): Vertex[] {
        return this.polygon.map(pt => [pt.x,pt.y] as Vertex);
    }
    get centre(): Vertex {
        return [this.cx, this.cy];
    }
    get id(): string {
        return `${this.cx},${this.cy}`;
    }

    constructor(opts: IPieceOpts) {
        this.cx = opts.cx;
        this.cy = opts.cy;
        this.owner = opts.owner;
    }

    public within(p: CircularForm): boolean {
        return turfWithin(turfPoly(this.circularForm), turfPoly(p));
    }

    public overlaps(polys: CircularForm[]): boolean {
        const mypoly = turfPoly(this.circularForm);
        for (const poly of polys) {
            const otherpoly = turfPoly(poly);
            if (turfIntersects(mypoly, otherpoly)) {
                return true;
            }
        }
        return false;
    }

    public distanceFrom(pt: Vertex): number {
        return ptDistance(this.cx, this.cy, ...pt);
    }

    public relativePosition(pt: Vertex): RelativePos {
        const d = ptDistance(...pt, ...this.centre);
        const bearing = calcBearing(...pt, ...this.centre);
        let quadrant: Quadrant;
        if (bearing >= 0 && bearing < 90) {
            quadrant = "NE";
        } else if (bearing >= 90 && bearing < 180) {
            quadrant = "SE";
        } else if (bearing >= 180 && bearing < 270) {
            quadrant = "SW";
        } else {
            quadrant = "NW";
        }
        return {d, bearing, quadrant, pt: this.centre};
    }

    public clone(): Piece {
        return new Piece({owner: this.owner, cx: this.cx, cy: this.cy});
    }

    public static deserialize(pc: Piece): Piece {
        return new Piece({owner: pc.owner, cx: pc.cx, cy: pc.cy});
    }
}