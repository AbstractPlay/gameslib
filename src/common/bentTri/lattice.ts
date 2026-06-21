/**
 * Flat equilateral-triangle lattice math for the bent-tri board.
 *
 * Each board has frequency n: rows 0..n, row r has columns 0..r.
 *   - Apex at row 0, col 0 (placed at the origin).
 *   - Right side (meets the apex): col 0.
 *   - Left side (meets the apex):  col = row.
 */

export type Point = { x: number; y: number };

export type LatticeRef = { copy: number; row: number; col: number };

export const refKey = (ref: LatticeRef): string =>
    `${ref.copy},${ref.row},${ref.col}`;

/**
 * Number of rows in the overlap cap.
 *   freq 2 → 2 rows, 3–4 → 3, 5–6 → 4, 7–8 → 5, …
 */
export const overlapRowsFor = (n: number): number =>
    Math.ceil(n / 2) + 1;

/**
 * Barycentric position inside a flat equilateral triangle with apex at (0, 0).
 * The triangle grows downward; the bottom edge is horizontal.
 */
export const latticePoint = (
    n: number,
    row: number,
    col: number,
    scale: number,
): Point => {
    const height = (scale * Math.sqrt(3)) / 2;
    const apex = { x: 0, y: 0 };
    const bottomLeft = { x: -scale / 2, y: height };
    const bottomRight = { x: scale / 2, y: height };

    const u = (n - row) / n;
    const v = col / n;
    const w = (row - col) / n;

    return {
        x: u * apex.x + v * bottomLeft.x + w * bottomRight.x,
        y: u * apex.y + v * bottomLeft.y + w * bottomRight.y,
    };
};

/**
 * Place one lattice point from one of the three overlapped copies.
 *
 *   copy 0 – original triangle (apex at origin).
 *   copy 1 – right wing, translated so its (k,k) anchor meets the base apex.
 *   copy 2 – left wing,  translated so its (k,0) anchor meets the base apex.
 *
 * Steps 4–5 of the build algorithm (rotate ±120° then translate so the caps
 * overlap) collapse, for this lattice, to these two translations: the wing
 * copies share the base apex and fan out by 120° because (k,k) and (k,0) are
 * the wing attachment points on the base triangle at row k = floor(n/2).
 */
export const placeCopy = (
    copy: number,
    row: number,
    col: number,
    n: number,
    scale: number,
): Point => {
    const local = latticePoint(n, row, col, scale);
    if (copy === 0) {
        return local;
    }

    const k = Math.floor(n / 2);
    const anchorRight = latticePoint(n, k, k, scale);
    const anchorLeft = latticePoint(n, k, 0, scale);

    if (copy === 1) {
        return {
            x: local.x - anchorRight.x,
            y: local.y - anchorRight.y,
        };
    }

    return {
        x: local.x - anchorLeft.x,
        y: local.y - anchorLeft.y,
    };
};

export const midpoint = (a: Point, b: Point): Point => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
});

/** Push a point outward from the hub along the ray hub → point. */
export const pushFromHub = (pt: Point, hub: Point, distance: number): Point => {
    const dx = pt.x - hub.x;
    const dy = pt.y - hub.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9 || distance === 0) {
        return { x: pt.x, y: pt.y };
    }
    return {
        x: pt.x + (dx / len) * distance,
        y: pt.y + (dy / len) * distance,
    };
};

/** Pull a point inward toward `center` along the ray center → point. */
export const pullToward = (pt: Point, center: Point, distance: number): Point => {
    const dx = pt.x - center.x;
    const dy = pt.y - center.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9 || distance === 0) {
        return { x: pt.x, y: pt.y };
    }
    const move = Math.min(distance, len);
    return {
        x: pt.x - (dx / len) * move,
        y: pt.y - (dy / len) * move,
    };
};

/** Scale a point radially toward `center` by factor `t` in 0..1. */
export const compressToward = (pt: Point, center: Point, t: number): Point => {
    if (t <= 0) {
        return { x: pt.x, y: pt.y };
    }
    const s = Math.min(t, 1);
    return {
        x: center.x + (pt.x - center.x) * (1 - s),
        y: center.y + (pt.y - center.y) * (1 - s),
    };
};

/**
 * Evenly space seam anchors along a fixed axis from `start` to `axisEnd`.
 *
 * Given strict midpoints ordered outward from `start`, adds `seamSpread` per
 * anchor and distributes the total extra length as equal gaps (start→p₁, …).
 */
export const spreadSeamAxis = (
    start: Point,
    axisEnd: Point,
    midpoints: Point[],
    seamSpread: number,
): Point[] => {
    const n = midpoints.length;
    if (n === 0) {
        return [];
    }
    if (seamSpread === 0) {
        return midpoints.map(p => ({ x: p.x, y: p.y }));
    }

    const dx = axisEnd.x - start.x;
    const dy = axisEnd.y - start.y;
    const axisLen = Math.hypot(dx, dy);
    if (axisLen < 1e-9) {
        return midpoints.map(p => ({ x: p.x, y: p.y }));
    }

    const dir = { x: dx / axisLen, y: dy / axisLen };
    const last = midpoints[n - 1];
    const outerDist =
        (last.x - start.x) * dir.x + (last.y - start.y) * dir.y;
    if (outerDist < 1e-9) {
        return midpoints.map(p => ({ x: p.x, y: p.y }));
    }

    const gap = (outerDist + n * seamSpread) / n;
    return midpoints.map((_, i) => ({
        x: start.x + dir.x * gap * (i + 1),
        y: start.y + dir.y * gap * (i + 1),
    }));
};

export const lerp = (a: Point, b: Point, t: number): Point => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
});

export const positionKey = (p: Point): string =>
    `${Math.round(p.x * 1e6)}:${Math.round(p.y * 1e6)}`;

/** True when a lattice ref lies inside the overlap cap on its copy. */
export const isCapRef = (ref: LatticeRef, overlapRows: number): boolean =>
    ref.row < overlapRows;
