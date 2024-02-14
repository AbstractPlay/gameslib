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
 * Converts degrees to radians
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

/**
 * To rotate -90, reverse rows then transpose
 * Assumes the matrix is square
 */
export const matrixSquareRotN90 = (lst: any[][]): any[][] => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment
    const reversed = lst.map(l => [...l].reverse());
    const transposed: any[][] = [];
    for (let y = 0; y < reversed.length; y++) {
        const row: any[] = [];
        for (let x = 0; x < reversed[y].length; x++) {
            // intentionally wrong order
            row.push(reversed[x][y]);
        }
        transposed.push(row)
    }
    return transposed;
}

/**
 * To rotate +90, transpose then reverse rows
 * Assumes the matrix is square
 */
export const matrixSquareRot90 = (lst: any[][]): any[][] => {
    const transposed: any[][] = [];
    for (let y = 0; y < lst.length; y++) {
        const row: any[] = [];
        for (let x = 0; x < lst[y].length; x++) {
            // intentionally wrong order
            row.push(lst[x][y]);
        }
        transposed.push(row.reverse())
    }
    return transposed;
}
