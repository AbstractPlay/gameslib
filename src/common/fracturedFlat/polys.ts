import { calcBearing } from "../plotting.js";

export type Point = { x: number; y: number };

export type Poly = {
    type: "poly";
    points: Point[];
};

export const FRACTURED_FLAT_PADDING = 8;

export type FracturedFlatSweepKey = {
    minBearing: number;
    minDist: number;
    maxBearing: number;
};

const RAW_FRACTURED_FLAT_POLYS = JSON.parse(`[{"type":"poly","points":[{"x":674.01,"y":164.72},{"x":784.32,"y":164.72},{"x":758.49,"y":257.09}]},{"type":"poly","points":[{"x":674.01,"y":164.72},{"x":758.49,"y":257.09},{"x":674.01,"y":272.58}]},{"type":"poly","points":[{"x":784.32,"y":164.72},{"x":758.49,"y":257.09},{"x":847.93,"y":261.02},{"x":848.18,"y":164.72}]},{"type":"poly","points":[{"x":847.93,"y":261.02},{"x":848.18,"y":164.72},{"x":938.33,"y":238.74},{"x":910.89,"y":334.07}]},{"type":"poly","points":[{"x":848.18,"y":164.72},{"x":1138.12,"y":164.72},{"x":1007.12,"y":240.21},{"x":938.33,"y":238.74}]},{"type":"poly","points":[{"x":1007.12,"y":240.21},{"x":1138.12,"y":164.72},{"x":1155.45,"y":297.43}]},{"type":"poly","points":[{"x":1138.12,"y":164.72},{"x":1155.45,"y":297.43},{"x":1245.12,"y":164.72}]},{"type":"poly","points":[{"x":1155.45,"y":297.43},{"x":1245.12,"y":346.88},{"x":1245.12,"y":164.72}]},{"type":"poly","points":[{"x":1245.12,"y":346.88},{"x":1155.45,"y":297.43},{"x":1170.73,"y":430.48}]},{"type":"poly","points":[{"x":1155.45,"y":297.43},{"x":1170.73,"y":430.48},{"x":1091.6,"y":353.72}]},{"type":"poly","points":[{"x":1155.45,"y":297.43},{"x":1091.6,"y":353.72},{"x":1014.76,"y":335.41},{"x":1007.12,"y":240.21}]},{"type":"poly","points":[{"x":938.33,"y":238.74},{"x":1007.12,"y":240.21},{"x":1014.76,"y":335.41},{"x":971.46,"y":406.94},{"x":910.89,"y":334.07}]},{"type":"poly","points":[{"x":834.65,"y":345.07},{"x":847.93,"y":261.02},{"x":910.89,"y":334.07}]},{"type":"poly","points":[{"x":834.65,"y":345.07},{"x":847.93,"y":261.02},{"x":758.49,"y":257.09},{"x":745.86,"y":315.47}]},{"type":"poly","points":[{"x":758.49,"y":257.09},{"x":745.86,"y":315.47},{"x":674.01,"y":392.11},{"x":674.01,"y":272.58}]},{"type":"poly","points":[{"x":745.86,"y":315.47},{"x":674.01,"y":392.11},{"x":794.88,"y":392.42},{"x":834.65,"y":345.07}]},{"type":"poly","points":[{"x":794.88,"y":392.42},{"x":834.65,"y":345.07},{"x":910.89,"y":334.07},{"x":971.46,"y":406.94},{"x":892.52,"y":448.61}]},{"type":"poly","points":[{"x":971.46,"y":406.94},{"x":1014.76,"y":335.41},{"x":1091.6,"y":353.72},{"x":1089.77,"y":430.51},{"x":1041.58,"y":454.07}]},{"type":"poly","points":[{"x":1091.6,"y":353.72},{"x":1170.73,"y":430.48},{"x":1118.67,"y":546.54},{"x":1089.77,"y":430.51}]},{"type":"poly","points":[{"x":1170.73,"y":430.48},{"x":1245.12,"y":346.88},{"x":1245.12,"y":578.56}]},{"type":"poly","points":[{"x":1170.73,"y":430.48},{"x":1118.67,"y":546.54},{"x":1245.12,"y":578.56}]},{"type":"poly","points":[{"x":1089.77,"y":430.51},{"x":1118.67,"y":546.54},{"x":1048.9,"y":538.25},{"x":1041.58,"y":454.07}]},{"type":"poly","points":[{"x":971.46,"y":406.94},{"x":1041.58,"y":454.07},{"x":1048.9,"y":538.25},{"x":971.9,"y":583.67},{"x":890.72,"y":537.18},{"x":892.52,"y":448.61}]},{"type":"poly","points":[{"x":892.52,"y":448.61},{"x":890.72,"y":537.18},{"x":821.05,"y":476.72},{"x":794.88,"y":392.42}]},{"type":"poly","points":[{"x":821.05,"y":476.72},{"x":890.72,"y":537.18},{"x":820.32,"y":577.12}]},{"type":"poly","points":[{"x":820.32,"y":577.12},{"x":734.78,"y":550.47},{"x":794.88,"y":392.42},{"x":821.05,"y":476.72}]},{"type":"poly","points":[{"x":794.88,"y":392.42},{"x":734.78,"y":550.47},{"x":674.01,"y":392.11}]},{"type":"poly","points":[{"x":674.01,"y":392.11},{"x":734.78,"y":550.47},{"x":674.01,"y":703.58}]},{"type":"poly","points":[{"x":674.01,"y":703.58},{"x":762.71,"y":651.56},{"x":734.78,"y":550.47}]},{"type":"poly","points":[{"x":762.71,"y":651.56},{"x":734.78,"y":550.47},{"x":820.32,"y":577.12},{"x":836.21,"y":660.31}]},{"type":"poly","points":[{"x":836.21,"y":660.31},{"x":820.32,"y":577.12},{"x":890.72,"y":537.18},{"x":971.9,"y":583.67},{"x":979.62,"y":669.31}]},{"type":"poly","points":[{"x":979.62,"y":669.31},{"x":971.9,"y":583.67},{"x":1048.9,"y":538.25},{"x":1118.67,"y":546.54},{"x":1111.38,"y":652.03}]},{"type":"poly","points":[{"x":1118.67,"y":546.54},{"x":1111.38,"y":652.03},{"x":1245.12,"y":578.56}]},{"type":"poly","points":[{"x":1245.12,"y":578.56},{"x":1165.77,"y":728.01},{"x":1245.12,"y":844.43}]},{"type":"poly","points":[{"x":1245.12,"y":578.56},{"x":1165.77,"y":728.01},{"x":1111.38,"y":652.03}]},{"type":"poly","points":[{"x":1165.77,"y":728.01},{"x":1245.12,"y":844.43},{"x":1074.37,"y":844.43}]},{"type":"poly","points":[{"x":1165.77,"y":728.01},{"x":1074.37,"y":844.43},{"x":1043.36,"y":735.38}]},{"type":"poly","points":[{"x":979.62,"y":669.31},{"x":1111.38,"y":652.03},{"x":1165.77,"y":728.01},{"x":1043.36,"y":735.38}]},{"type":"poly","points":[{"x":1043.36,"y":735.38},{"x":1074.37,"y":844.43},{"x":903.32,"y":775.61}]},{"type":"poly","points":[{"x":979.62,"y":669.31},{"x":1043.36,"y":735.38},{"x":903.32,"y":775.61}]},{"type":"poly","points":[{"x":979.62,"y":669.31},{"x":903.32,"y":775.61},{"x":845.86,"y":737.34},{"x":836.21,"y":660.31}]},{"type":"poly","points":[{"x":903.32,"y":775.61},{"x":1074.37,"y":844.43},{"x":674.01,"y":844.43}]},{"type":"poly","points":[{"x":845.86,"y":737.34},{"x":903.32,"y":775.61},{"x":674.01,"y":844.43}]},{"type":"poly","points":[{"x":836.21,"y":660.31},{"x":845.86,"y":737.34},{"x":674.01,"y":844.43}]},{"type":"poly","points":[{"x":836.21,"y":660.31},{"x":762.71,"y":651.56},{"x":674.01,"y":703.58},{"x":674.01,"y":844.43}]}]`) as Poly[];

export const centroid = (pts: Point[]): Point | undefined => {
    if (pts.length === 0) {
        return undefined;
    }
    const cx = pts.reduce((prev, curr) => prev + curr.x, 0) / pts.length;
    const cy = pts.reduce((prev, curr) => prev + curr.y, 0) / pts.length;
    return { x: cx, y: cy };
};

export function translateFracturedFlatPolys(raw: Poly[], padding = FRACTURED_FLAT_PADDING): Poly[] {
    const all = raw.flatMap((p) => p.points);
    const minX = Math.min(...all.map((pt) => pt.x));
    const minY = Math.min(...all.map((pt) => pt.y));
    const dx = minX - padding;
    const dy = minY - padding;
    return raw.map((poly) => ({
        type: "poly",
        points: poly.points.map((pt) => ({ x: pt.x - dx, y: pt.y - dy })),
    }));
}

export function fracturedFlatBoardCenter(polys: Poly[]): Point {
    const all = polys.flatMap((p) => p.points);
    return centroid(all)!;
}

export function fracturedFlatSweepKey(poly: Poly, center: Point): FracturedFlatSweepKey {
    let minBearing = Infinity;
    let minDist = Infinity;
    let maxBearing = -Infinity;
    for (const pt of poly.points) {
        const bearing = calcBearing(center.x, center.y, pt.x, pt.y);
        const dist = Math.hypot(pt.x - center.x, pt.y - center.y);
        maxBearing = Math.max(maxBearing, bearing);
        if (bearing < minBearing) {
            minBearing = bearing;
            minDist = dist;
        } else if (bearing === minBearing) {
            minDist = Math.min(minDist, dist);
        }
    }
    return { minBearing, minDist, maxBearing };
}

/** Clockwise bearing from north for the first vertex encountered in a sweep from board center. */
export function minVertexBearing(poly: Poly, center: Point): number {
    return fracturedFlatSweepKey(poly, center).minBearing;
}

export function compareFracturedFlatPolys(a: Poly, b: Poly, center: Point): number {
    const va = a.points.length;
    const vb = b.points.length;
    if (va !== vb) {
        return va - vb;
    }
    const ka = fracturedFlatSweepKey(a, center);
    const kb = fracturedFlatSweepKey(b, center);
    if (ka.minBearing !== kb.minBearing) {
        return ka.minBearing - kb.minBearing;
    }
    if (ka.minDist !== kb.minDist) {
        return ka.minDist - kb.minDist;
    }
    return ka.maxBearing - kb.maxBearing;
}

export function orderFracturedFlatPolys(raw: Poly[]): Poly[][] {
    const center = fracturedFlatBoardCenter(raw);
    const sorted = [...raw].sort((a, b) => compareFracturedFlatPolys(a, b, center));
    const rows: Poly[][] = [];
    let row: Poly[] = [];
    let vertexCount = -1;
    for (const poly of sorted) {
        const count = poly.points.length;
        if (count !== vertexCount) {
            if (row.length > 0) {
                rows.push(row);
            }
            row = [poly];
            vertexCount = count;
        } else {
            row.push(poly);
        }
    }
    if (row.length > 0) {
        rows.push(row);
    }
    return rows;
}

export function prepareFracturedFlatPolys(): Poly[][] {
    return orderFracturedFlatPolys(translateFracturedFlatPolys(RAW_FRACTURED_FLAT_POLYS));
}
