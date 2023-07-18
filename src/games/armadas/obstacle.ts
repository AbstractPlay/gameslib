import { IPoint, projectPoint } from "../../common";

export interface IObstacleOpts {
    vertices?: number;
    minDistance?: number;
    maxDistance?: number;
    cx?: number;
    cy?: number;
    pts?: IPoint[];
}

type CircularForm = [number,number][][];

export class Obstacle {
    private readonly _pts: IPoint[];
    get polygon() { return this._pts; }
    get circularForm(): CircularForm {
        return [[...this.polygon.map(p => [p.x, p.y] as [number,number]), [this.polygon[0].x, this.polygon[0].y]]];
    }
    get svgPath(): string {
        let path = "";
        for (let i = 0; i < this.polygon.length; i++) {
            const pt = this.polygon[i];
            if (i === 0) {
                path += `M${pt.x},${pt.y}`;
            } else {
                path += `L${pt.x},${pt.y}`;
            }
        }
        path += "Z";
        return path;
    }

    constructor(opts: IObstacleOpts) {
        if (opts.pts !== undefined) {
            this._pts = opts.pts;
        } else if ( (opts.cx !== undefined) && (opts.cy !== undefined) ) {
            this._pts = [];
            const {cx, cy} = opts;
            let verts = 10;
            let minDist = 40;
            let maxDist = 80;
            if (opts.vertices !== undefined) {
                verts = opts.vertices;
            }
            if (opts.maxDistance !== undefined) {
                maxDist = opts.maxDistance;
            }
            if (opts.minDistance !== undefined) {
                minDist = opts.minDistance;
            }
            const inc = 360 / verts;
            for (let i = 0; i < verts; i++) {
                const dist = (Math.random() * (maxDist - minDist)) + minDist;
                const [x, y] = projectPoint(cx, cy, dist, i * inc).map(n => Math.round(n));
                this._pts.push({x, y});
            }
        } else {
            throw new Error("Must provide either a set of points or a cx and cy to generate.");
        }
    }
    public clone(): Obstacle {
        return new Obstacle({pts: this.polygon});
    }

    public static deserialize(ob: Obstacle): Obstacle {
        // {"_dmg":0,"id":"Esneaxoh","owner":1,"size":2,"_cx":449.6606139662123,"_cy":662.7283337140459,"_facing":0}
        return new Obstacle({pts: ob._pts});
    }
}
