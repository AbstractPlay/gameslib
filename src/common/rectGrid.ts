import { Directions } from ".";

export class RectGrid {
    public readonly width: number;
    public readonly height: number;

    constructor (w: number, h: number) {
        this.width = w;
        this.height = h;
    }

    /**
     * Static method for simply moving a point a certain direction and distance.
     *
     * @param {number} x Starting column
     * @param {number} y Starting row
     * @param {Directions} dir Direction to move in
     * @param {number} dist Distance to travel
     * @returns {[number, number]} Represents the new point
     */
    public static move(x: number, y: number, dir: Directions, dist: number = 1): [number, number] {
        switch (dir) {
            case "N":
                return [x, y - dist];
            case "NE":
                return [x + dist, y - dist];
            case "E":
                return [x + dist, y];
            case "SE":
                return [x + dist, y + dist];
            case "S":
                return [x, y + dist];
            case "SW":
                return [x - dist, y + dist];
            case "W":
                return [x - dist, y];
            case "NW":
                return [x - dist, y - dist];
            default:
                throw new Error(`Unrecognized direction given (${dir}). This should never happen.`);
        }
    }

    /**
     * Tells you the general direction one point is relative to another.
     * Undefined if the two points are the same.
     *
     * @param {number} x1
     * @param {number} y1
     * @param {number} x2
     * @param {number} y2
     * @returns {(Directions|undefined)}
     * @memberof RectGrid
     */
     public static bearing(x1: number, y1: number, x2: number, y2: number): Directions|undefined {
        if ( (x1 === x2) && (y1 === y2) ) {
            return undefined;
        }

        let dir = "";
        if (y2 < y1) {
            dir = "N";
        } else if (y2 > y1) {
            dir = "S"
        }
        if (x2 < x1) {
            dir += "W";
        } else if (x2 > x1) {
            dir += "E";
        }
        return dir as Directions;
    }

    /**
     * Only works when the two points are exactly orthogonal or diagonal to each other.
     * Returns the list of points between them. Excludes the starting and ending points.
     *
     * This function ignores "in bounds."
     *
     * @param {number} x1
     * @param {number} y1
     * @param {number} x2
     * @param {number} y2
     * @returns {Array<[number, number]>}
     * @memberof RectGrid
     */
    public static between(x1: number, y1: number, x2: number, y2: number): Array<[number, number]> {
        if ( (! RectGrid.isOrth(x1, y1, x2, y2)) && (! RectGrid.isDiag(x1, y1, x2, y2)) ) {
            throw new Error(`This function can only process coordinates that are directly orthogonal or diagonal to each other.`);
        }
        const dir = RectGrid.bearing(x1, y1, x2, y2);
        if (dir === undefined) {
            return [];
        }

        const between: Array<[number, number]> = [];
        let pt: [number, number] = RectGrid.move(x1, y1, dir);
        while ( (pt[0] !== x2) || (pt[1] !== y2) ) {
            between.push(pt);
            pt = RectGrid.move(...pt, dir);
        }
        return between;
    }

    /**
     * Tells you if two points are orthogonal to each other
     *
     * @param {number} x1
     * @param {number} y1
     * @param {number} x2
     * @param {number} y2
     * @returns {boolean}
     * @memberof RectGrid
     */
     public static isOrth(x1: number, y1: number, x2: number, y2: number): boolean {
        if ( (x1 === x2) || (y1 === y2) ) {
            return true;
        }
        return false;
    }

    /**
     * Tells you if two points are diagonal to each other
     *
     * @param {number} x1
     * @param {number} y1
     * @param {number} x2
     * @param {number} y2
     * @returns {boolean}
     * @memberof RectGrid
     */
    public static isDiag(x1: number, y1: number, x2: number, y2: number): boolean {
        if (Math.abs(x2 - x1) === Math.abs(y2 - y1)) {
            return true;
        }
        return false;
    }

    /**
     * Tells you if a given point is within the bounds of the grid.
     *
     * @param {number} x A value of 0 is the left-most column
     * @param {number} y A value of 0 is the top-most row
     * @returns {boolean}
     * @memberof RectGrid
     */
    public inBounds(x: number, y: number): boolean {
        if ( (x >= 0) && (x < this.width) && (y >= 0) && (y < this.height) ) {
            return true;
        }
        return false;
    }

    /**
     * Returns the cells adjacent to {x} and {y}
     *
     * @param {number} x A value of 0 is the left-most column
     * @param {number} y A value of 0 is the top-most row
     * @param {boolean} diag Tells the function whether to calculate diagonal adjacencies
     * @returns {Array<[number, number]>}
     * @memberof RectGrid
     */
    public adjacencies(x: number, y: number, diag: boolean = true): Array<[number, number]> {
        const adj: Array<[number, number]> = [];
        const dirs: Directions[] = ["N", "E", "S", "W"];
        if (diag) {
            dirs.push("NE");
            dirs.push("SE");
            dirs.push("SW");
            dirs.push("NW");
        }
        dirs.forEach((d) => {
            const [xNext, yNext] = RectGrid.move(x, y, d);
            if (this.inBounds(xNext, yNext)) {
                adj.push([xNext, yNext]);
            }
        });
        return adj;
    }

    /**
     * A helper for finding valid Chess knight moves from a given cell
     *
     * @param {number} x
     * @param {number} y
     * @returns {Array<[number, number]>}
     * @memberof RectGrid
     */
    public knights(x: number, y: number): Array<[number, number]> {
        const moves: Array<[number, number]> = [];

        for (const matrix of [[1, -2], [-1, -2], [1, 2], [-1, 2], [2, -1], [2, 1], [-2, -1], [-2, 1]]) {
            const newcell: [number, number] = [x + matrix[0], y + matrix[1]];
            if (this.inBounds(...newcell)) {
                moves.push(newcell);
            }
        }

        return moves;
    }

    /**
     * Returns an array of cells between the starting cell and the edge of the board in the given direction.
     * Does not include the starting cell.
     *
     * @param {number} x
     * @param {number} y
     * @param {Directions} dir
     * @returns {Array<[number, number]>} Does not include the starting cell.
     * @memberof RectGrid
     */
    public ray(x: number, y: number, dir: Directions): Array<[number, number]> {
        const ray: Array<[number, number]> = [];
        let [xNext, yNext] = RectGrid.move(x, y, dir);
        while (this.inBounds(xNext, yNext)) {
            ray.push([xNext, yNext]);
            [xNext, yNext] = RectGrid.move(xNext, yNext, dir);
        }
        return ray;
    }
}