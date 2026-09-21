/**
 * Benson's algorithm for unconditional life ("pass-alive" strings).
 *
 * A chain of the given colour is pass-alive when it belongs to a set X of chains such that every
 * chain in X has at least two vital regions enclosed by X. A region is a maximal connected set
 * of points not holding the colour; it is vital to a chain when every point of the region that
 * could ever become empty is adjacent to the chain.
 *
 * With classic (no-suicide) rules only the empty points of a region need to touch the chain.
 * When multi-stone suicide is legal (Tromp-Taylor), the opponent can clear its own stones out of a
 * region and refill it leaving a hole that is not a liberty of the chain, so every point of the
 * region, occupied or not, must touch the chain. `suicideAllowed` selects the strict test.
 */
import type { Board, Geometry, Stone } from "./board.js";

export interface PassAliveOptions {
    suicideAllowed?: boolean;
}

interface Region {
    points: string[];
    adjacentChains: Set<number>;
    vitalTo: Set<number>;
}

/** Returns every pass-alive chain of `colour`, each as its list of stones. */
export const passAliveStrings = (board: Board, geo: Geometry, colour: Stone, opts: PassAliveOptions = {}): string[][] => {
    const suicideAllowed = opts.suicideAllowed ?? true;

    // Chains of `colour`.
    const chainOf = new Map<string, number>();
    const chains: string[][] = [];
    for (const cell of geo.cells) {
        if (board.get(cell) !== colour || chainOf.has(cell)) {
            continue;
        }
        const id = chains.length;
        const stones: string[] = [];
        const todo = [cell];
        chainOf.set(cell, id);
        while (todo.length > 0) {
            const cur = todo.pop()!;
            stones.push(cur);
            for (const n of geo.neighbours.get(cur)!) {
                if (board.get(n) === colour && !chainOf.has(n)) {
                    chainOf.set(n, id);
                    todo.push(n);
                }
            }
        }
        chains.push(stones);
    }
    if (chains.length === 0) {
        return [];
    }

    // Regions: maximal connected sets of points not holding `colour`.
    const regionOf = new Map<string, number>();
    const regions: Region[] = [];
    for (const cell of geo.cells) {
        if (board.get(cell) === colour || regionOf.has(cell)) {
            continue;
        }
        const id = regions.length;
        const points: string[] = [];
        const todo = [cell];
        regionOf.set(cell, id);
        while (todo.length > 0) {
            const cur = todo.pop()!;
            points.push(cur);
            for (const n of geo.neighbours.get(cur)!) {
                if (board.get(n) !== colour && !regionOf.has(n)) {
                    regionOf.set(n, id);
                    todo.push(n);
                }
            }
        }
        regions.push({ points, adjacentChains: new Set(), vitalTo: new Set() });
    }

    // Which chains touch each region, and to which chains the region is vital.
    for (const region of regions) {
        const touches = new Map<number, number>();
        let mustTouch = 0;
        for (const p of region.points) {
            const counts = suicideAllowed || !board.has(p);
            if (counts) {
                mustTouch++;
            }
            const seenHere = new Set<number>();
            for (const n of geo.neighbours.get(p)!) {
                const chain = chainOf.get(n);
                if (chain === undefined || seenHere.has(chain)) {
                    continue;
                }
                seenHere.add(chain);
                region.adjacentChains.add(chain);
                if (counts) {
                    touches.set(chain, (touches.get(chain) ?? 0) + 1);
                }
            }
        }
        for (const [chain, n] of touches) {
            if (n === mustTouch) {
                region.vitalTo.add(chain);
            }
        }
    }

    // Benson iteration.
    const X = new Set<number>(chains.map((_, i) => i));
    const R = new Set<number>(regions.map((_, i) => i));
    let changed = true;
    while (changed) {
        changed = false;
        for (const chain of [...X]) {
            let vital = 0;
            for (const rid of R) {
                if (regions[rid].vitalTo.has(chain)) {
                    vital++;
                }
            }
            if (vital < 2) {
                X.delete(chain);
                changed = true;
            }
        }
        for (const rid of [...R]) {
            for (const chain of regions[rid].adjacentChains) {
                if (!X.has(chain)) {
                    R.delete(rid);
                    changed = true;
                    break;
                }
            }
        }
    }
    return chains.filter((_, i) => X.has(i));
};
