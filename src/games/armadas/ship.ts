/* eslint-disable @typescript-eslint/no-loss-of-precision */
import { Size, playerid } from "../armadas";
import { projectPoint, IPoint, smallestDegreeDiff, ptDistance } from "../../common";
<<<<<<< HEAD
import { polygon as turfPoly } from "@turf/helpers";
=======
import { polygon as turfPoly, lineString as turfLine } from "@turf/helpers";
>>>>>>> develop
import turfIntersects from "@turf/boolean-intersects";

// ship sizes at default rendering size
export const heights = [27.777786254882812, 38.1944274902344, 48.61114501953125];
export const widths = [15.60546875, 21.701393127441435, 27.777786254882812];

export interface IShipOpts {
    id: string;
    size: Size;
    owner: playerid;
    cx: number;
    cy: number;
    facing: number;
    dmg?: number;
}

export interface IMovementArc {
    leftx: number;
    lefty: number;
    rightx: number;
    righty: number;
    radius: number;
}

type CircularForm = [number,number][][];

export class Ship {
    public readonly id: string;
    public readonly owner: playerid;
    public readonly size: Size;
    private _dmg = 0;
    get dmg(): number { return this._dmg; }
    get sunk(): boolean { return this._dmg >= this.size; }
    private _cx!: number;
    get cx(): number { return this._cx; }
    private _cy!: number;
    get cy(): number { return this._cy; }
    private _facing!: number;
    get facing(): number { return this._facing; }
    get height(): number { return heights[this.size - 1]; }
    get width(): number { return widths[this.size - 1]; }
    get tx(): number {
        const [x,] = projectPoint(this.cx, this.cy, this.height / 2, this.facing);
        return x;
    }
    get ty(): number {
        const [,y] = projectPoint(this.cx, this.cy, this.height / 2, this.facing);
        return y;
    }
    get movementArc(): IMovementArc {
        const radius = this.height;
        const [leftx, lefty] = projectPoint(this.tx, this.ty, radius, this.facing - 75);
        const [rightx, righty] = projectPoint(this.tx, this.ty, radius, this.facing + 75);
        return {radius, leftx, lefty, rightx, righty};
    }
    get sideLen(): number {
        return Math.sqrt(this.height**2 + (this.width / 2)**2);
    }
    get polygon(): IPoint[] {
        const pts = [{x: this.tx, y: this.ty}];
        const [leftx,lefty] = projectPoint(this.tx, this.ty, this.sideLen, this.facing - 165);
        pts.push({x: leftx, y: lefty});
        const [rightx,righty] = projectPoint(this.tx, this.ty, this.sideLen, this.facing + 165);
        pts.push({x: rightx, y: righty});
        return pts;
    }
    get centroid(): IPoint {
        let totalx = 0;
        let totaly = 0;
        let count = 0;
        for (const {x, y} of this.polygon) {
            totalx += x;
            totaly += y;
            count++;
        }
        return {x: totalx / count, y: totaly / count};
    }
    get firingArcs(): [IPoint[], IPoint[]] {
        const leftArc = [{x: this.tx, y: this.ty}];
        const rightArc = [{x: this.tx, y: this.ty}];
        const largeSideLen = Math.sqrt(heights[2]**2 + (widths[2] / 2)**2);
        const [rightTopX, rightTopY] = projectPoint(this.tx, this.ty, largeSideLen, this.facing + 90);
        const [leftTopX, leftTopY] = projectPoint(this.tx, this.ty, largeSideLen, this.facing - 90);
        leftArc.push({x: leftTopX, y: leftTopY});
        rightArc.push({x: rightTopX, y: rightTopY});
        const [rightBaseX, rightBaseY] = projectPoint(this.tx, this.ty, this.sideLen, this.facing + 165);
        const [leftBaseX, leftBaseY] = projectPoint(this.tx, this.ty, this.sideLen, this.facing - 165);
        const [rightBotX, rightBotY] = projectPoint(rightBaseX, rightBaseY, largeSideLen, this.facing + 60);
        const [leftBotX, leftBotY] = projectPoint(leftBaseX, leftBaseY, largeSideLen, this.facing - 60);
        leftArc.push({x: leftBotX, y: leftBotY});
        leftArc.push({x: leftBaseX, y: leftBaseY});
        rightArc.push({x: rightBotX, y: rightBotY});
        rightArc.push({x: rightBaseX, y: rightBaseY});
        return [leftArc, rightArc];
    }
    get circularForm(): CircularForm {
        return [[...this.polygon.map(p => [p.x, p.y] as [number,number]), [this.polygon[0].x, this.polygon[0].y]]];
    }

    public static nameValid(name: string): boolean {
        if ( (name.length < 1) || (name.length > 25) ) {
            return false;
        }
        if (! name.match(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)) {
            return false;
        }
        return true;
    }

    constructor(opts: IShipOpts) {
        if (! Ship.nameValid(opts.id)) {
            throw new Error("Invalid ship ID");
        }
        this.id = opts.id;
        this.owner = opts.owner;
        this.size = opts.size;
        this._cx = opts.cx;
        this._cy = opts.cy;
        this._facing = opts.facing;
        if (opts.dmg !== undefined) {
            this._dmg = opts.dmg;
        }
    }

    public move(newFacing: number): Ship {
        const delta = Math.abs(Math.trunc(smallestDegreeDiff(this.facing, newFacing) * 100) / 100);
        if (delta > 75.00) {
            throw new Error(`Ships may not rotate more than 75 degrees in a single step (current facing: ${this.facing}, proposed facing: ${newFacing})`);
        }
        const [x,y] = projectPoint(this.tx, this.ty, this.height / 2, newFacing);
        this._cx = x;
        this._cy = y;
        this._facing = newFacing;
        return this;
    }

<<<<<<< HEAD
=======
    public canSee(ship: Ship, obstacles: CircularForm[]) {
        // To have line of sight, we must be able to draw a line from at least one of your corners to at least one of the other corners, without intersecting any obstacles.
        for (const myPt of this.polygon) {
            for (const theirPt of ship.polygon) {
                const line = turfLine([[myPt.x, myPt.y], [theirPt.x, theirPt.y]]);
                for (const ob of obstacles) {
                    const poly = turfPoly(ob);
                    if (! turfIntersects(line, poly)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

>>>>>>> develop
    public canHit(ship: Ship): boolean {
        for (const arc of this.firingArcs) {
            const arcpoly = turfPoly([[...arc.map(p => [p.x,p.y]), [arc[0].x,arc[0].y]]]);
            const otherpoly = turfPoly(ship.circularForm);
            if (turfIntersects(arcpoly, otherpoly)) {
                return true;
            }
        }
        return false;
    }

    public collidingWith(polys: CircularForm[]): boolean {
        const mypoly = turfPoly(this.circularForm);
        for (const poly of polys) {
            const otherpoly = turfPoly(poly);
            if (turfIntersects(mypoly, otherpoly)) {
                return true;
            }
        }
        return false;
    }

    public distanceFrom(ship: Ship): number {
        return ptDistance(this.cx, this.cy, ship.cx, ship.cy);
    }

    public closest(ships: Ship[]): Ship|undefined {
        let closestShip: Ship|undefined;
        let closestDist = Infinity;
        for (const ship of ships) {
            const dist = this.distanceFrom(ship);
            if (dist < closestDist) {
                closestDist = dist;
                closestShip = ship;
            }
        }
        return closestShip;
    }

    public takeDamage(num = 1): void {
        this._dmg += num;
    }

    public clone(): Ship {
        return new Ship({id: this.id, owner: this.owner, size: this.size, cx: this.cx, cy: this.cy, facing: this.facing});
    }

    public static deserialize(ship: Ship): Ship {
        // {"_dmg":0,"id":"Esneaxoh","owner":1,"size":2,"_cx":449.6606139662123,"_cy":662.7283337140459,"_facing":0}
        return new Ship({id: ship.id, dmg: ship._dmg, owner: ship.owner, size: ship.size, cx: ship._cx, cy: ship._cy, facing: ship._facing});
    }
}