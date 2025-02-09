/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { IPoint, Direction } from ".";

export const deg2dir = new Map<number, Direction>([
    [0, "N"],
    [45, "NE"],
    [90, "E"],
    [135, "SE"],
    [180, "S"],
    [225, "SW"],
    [270, "W"],
    [315, "NW"],
]);

export const dir2deg = new Map<Direction, number>([
    ["N", 0],
    ["NE", 45],
    ["E", 90],
    ["SE", 135],
    ["S", 180],
    ["SW", 225],
    ["W", 270],
    ["NW", 315],
]);

/**
 * Ensures a degree measurement lies [0, 360)
 */
export const normDeg = (deg: number): number => {
    while (deg < 0) {
        deg += 360;
    }
    return deg % 360;
}

/**
 * Converts degrees to radians
 */
export const deg2rad = (deg: number): number => {
    return deg * (Math.PI / 180);
}

/**
 * Converts radians to degrees
 */
export const rad2deg = (rad: number): number => {
    return rad * (180 / Math.PI);
}

/**
 * Converts a "table facing" (0 degrees due north, increases clockwise)
 * to a proper planar value (0 degrees due east, increases counterclockwise)
 * and vice-versa. It's the same process.
 */
export const toggleFacing = (n: number): number => {
    return (360 - n + 90) % 360;
}

/**
 * Given a starting x,y coordinate, a distance, and a facing, return a new x,y coordinate.
 * "Facing" is table facing, meaning 0 is due north and increases clockwise.
 */
export const projectPoint = (x: number, y: number, dist: number, deg: number): [number,number] => {

    const truncNum = (n: number): number => {
        return Math.trunc(n * 100000) / 100000;
    }
    deg = normDeg(deg);
    const facing = normDeg(toggleFacing(deg));
    const m = Math.tan(deg2rad(facing));
    const deltax = dist / (Math.sqrt(1 + m**2));
    let newx: number;
    if (deg > 180) {
        newx = x - deltax;
    } else {
        newx = x + deltax;
    }
    const deltay = Math.sqrt(truncNum(dist**2 - (newx - x)**2));
    let newy: number;
    if (facing > 180) {
        newy = y + deltay;
    } else {
        newy = y - deltay;
    }
    newx = truncNum(newx); newy = truncNum(newy);
    return [newx, newy];
}

export const ptDistance = (x1: number, y1: number, x2: number, y2: number): number => {
    return Math.sqrt(((x1 - x2)**2) + ((y1 - y2)**2));
}

export const midpoint = (x1: number, y1: number, x2: number, y2: number): [number,number] => {
    return [(x1 + x2) / 2, (y1 + y2) / 2];
}

export const smallestDegreeDiff = (deg1: number, deg2: number): number => {
    let diff = deg1 - deg2;
    while (diff > 180) {
        diff -= 360;
    }
    while (diff < -180) {
        diff += 360;
    }
    return diff;
}

/**
 * Returns the orientation of point2 in relation to point1 in "table facing"
 * (0 degrees due north, increases clockwise)
 */
export const calcBearing = (x1: number, y1: number, x2: number, y2: number): number => {
    const dx = x2 - x1;
    // flipped because our y axis is mirrored
    const dy = y1 - y2;
    const rad = Math.atan2(dy, dx);
    const deg = rad2deg(rad);
    return toggleFacing(deg);
}

// Assumes each row is the same width
export const transposeRect = (lst: any[][]): any[][] => {
    if (lst.length === 0) {
        return [];
    }
    const newWidth = lst.length;
    const newHeight = lst[0].length;
    const transposed: any[][] = Array.from({length: newHeight}, () => Array(newWidth));

    for (let i = 0; i < lst.length; i++) {
        for (let j = 0; j < lst[i].length; j++) {
            transposed[j][i] = lst[i][j];
        }
    }
    return transposed;
}

/**
 * To rotate -90, reverse rows then transpose
 * Assumes the matrix is square
 */
export const matrixRectRotN90 = (lst: any[][]): any[][] => {
    const reversed = lst.map(l => [...l].reverse());
    return transposeRect(reversed);
}

/**
 * To rotate +90, transpose then reverse rows
 * Assumes the matrix is square
 */
export const matrixRectRot90 = (lst: any[][]): any[][] => {
    const transposed: any[][] = transposeRect(lst);
    return transposed.map(row => [...row].reverse());
}

// Builds a circle as a polygon of `steps` sides
export const circle2poly = (cx: number, cy: number, r: number, steps = 64): [number,number][] => {
    const coordinates: [number,number][] = [];
    for (let i = 0; i < steps; i++) {
        coordinates.push(projectPoint(cx, cy, r, (i * 360) / steps));
    }
    return coordinates;
}

// shortest distance from point to circle
export const distFromCircle = (circle: {cx: number, cy: number, r: number}, point: IPoint): number => {
    return Math.abs(Math.sqrt((point.x - circle.cx)**2 + (point.y - circle.cy)**2) - circle.r);
}

// determines if point q lies on the segment pr
export const pointOnSegment = (p: IPoint, q: IPoint, r: IPoint): boolean => {
    if (q.x <= Math.max(p.x, r.x) &&
        q.x >= Math.min(p.x, r.x) &&
        q.y <= Math.max(p.y, r.y) &&
        q.y >= Math.min(p.y, r.y))  {
            return true;
    }
    return false;
}

// To find orientation of ordered triplet (p, q, r).
// The function returns following values
// 0 --> p, q and r are collinear
// 1 --> Clockwise
// 2 --> Counterclockwise
export const pointOrientation = (p: IPoint, q: IPoint, r: IPoint) : 0|1|2 => {
    // See https://www.geeksforgeeks.org/orientation-3-ordered-points/
    // for details of below formula.
    const val = (q.y - p.y) * (r.x - q.x) -
                (q.x - p.x) * (r.y - q.y);

    if (val === 0) return 0; // collinear
    return (val > 0)? 1 : 2; // clock or counterclock wise
}

// The main function that returns true if line segment 'p1q1'
// and 'p2q2' intersect.
export const linesIntersect = (p1: IPoint, q1: IPoint, p2: IPoint, q2: IPoint): boolean => {
    // Find the four orientations needed for general and
    // special cases
    const o1 = pointOrientation(p1, q1, p2);
    const o2 = pointOrientation(p1, q1, q2);
    const o3 = pointOrientation(p2, q2, p1);
    const o4 = pointOrientation(p2, q2, q1);

    // General case
    if (o1 !== o2 && o3 !== o4)
        return true;

    // Special Cases
    // p1, q1 and p2 are collinear and p2 lies on segment p1q1
    if (o1 === 0 && pointOnSegment(p1, p2, q1)) return true;

    // p1, q1 and q2 are collinear and q2 lies on segment p1q1
    if (o2 === 0 && pointOnSegment(p1, q2, q1)) return true;

    // p2, q2 and p1 are collinear and p1 lies on segment p2q2
    if (o3 === 0 && pointOnSegment(p2, p1, q2)) return true;

    // p2, q2 and q1 are collinear and q1 lies on segment p2q2
    if (o4 === 0 && pointOnSegment(p2, q1, q2)) return true;

    return false; // Doesn't fall in any of the above cases
}
