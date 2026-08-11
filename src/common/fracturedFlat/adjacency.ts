import { fracturedFlatCellLabel } from "./labels";
import { type Point, type Poly } from "./polys";

const pointKey = (p: Point): string =>
    `${Math.round(p.x * 100)}:${Math.round(p.y * 100)}`;

const edgeKey = (a: Point, b: Point): string => {
    const ka = pointKey(a);
    const kb = pointKey(b);
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
};

export const buildFracturedFlatAdjacency = (polys: Poly[][]): Map<string, Set<string>> => {
    const labelAt = (tier: number, col: number): string => fracturedFlatCellLabel(tier, col);

    const edgeToCells = new Map<string, string[]>();

    for (let tier = 0; tier < polys.length; tier++) {
        const row = polys[tier];
        for (let col = 0; col < row.length; col++) {
            const label = labelAt(tier, col);
            const pts = row[col].points;
            for (let i = 0; i < pts.length; i++) {
                const key = edgeKey(pts[i], pts[(i + 1) % pts.length]);
                const cells = edgeToCells.get(key);
                if (cells === undefined) {
                    edgeToCells.set(key, [label]);
                } else {
                    cells.push(label);
                }
            }
        }
    }

    for (const [, cells] of edgeToCells) {
        if (cells.length > 2) {
            throw new Error(
                `Polygon edge shared by more than two cells: ${cells.join(", ")}`,
            );
        }
    }

    const adjacency = new Map<string, Set<string>>();
    const ensure = (label: string): Set<string> => {
        let set = adjacency.get(label);
        if (set === undefined) {
            set = new Set<string>();
            adjacency.set(label, set);
        }
        return set;
    };

    for (let tier = 0; tier < polys.length; tier++) {
        for (let col = 0; col < polys[tier].length; col++) {
            ensure(labelAt(tier, col));
        }
    }

    for (const cells of edgeToCells.values()) {
        if (cells.length !== 2) {
            continue;
        }
        const [a, b] = cells;
        ensure(a).add(b);
        ensure(b).add(a);
    }

    return adjacency;
};
