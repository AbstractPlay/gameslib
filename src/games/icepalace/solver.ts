/**
 * Works out the maximum number of Yard pyramids that can be built into the Ice Palace.
 *
 * Over the board this number is agreed by the players, because nobody wants to search the
 * possibilities by hand. It is cheap to compute exactly, because of one observation:
 * founding is unbounded. A new stack founded next to a stack of colour `c` is itself
 * topped by `c` and sits on the frontier, so it can be chained outwards forever. Once a
 * colour tops any outward-facing stack, every pyramid of that colour can be placed.
 *
 * So the only question is which colours can be got onto an outward-facing top, and that
 * reduces to a small resource count. A colour is enabled if it already tops such a stack,
 * or if one of its pyramids can be stacked onto an open top strictly larger than it, which
 * spends that top. Every pyramid of an enabled colour, once founded, yields a fresh open
 * top of its own size, so enabled colours holding larges regenerate the scarce resource.
 * Larges can never be stacked onto anything, so a colour whose only Yard pyramids are
 * large is placeable only if it already tops an open stack.
 *
 * The search over (enabled colours, open large tops, open medium tops) is tiny. The plan
 * it produces is then played out against the real building code, and the length of the
 * sequence actually achieved is what gets reported. That direction matters: the number is
 * always one the builder can reach, never an over-estimate that would wedge the build.
 */

import {
    Cell,
    PieceId,
    Size,
    Structure,
    cellOf,
    cloneStructure,
    colourOf,
    exteriorCells,
    legalCellsFor,
    legalPalacePlacement,
    neighbours,
    placeInto,
    sizeOf,
    topOf,
} from "./rules.js";

export interface Placement {
    piece: PieceId;
    cell: Cell;
}

export interface BuildPlan {
    /** How many Yard pyramids the builder must use. */
    max: number;
    /** One legal way to reach that number, in order. */
    sequence: Placement[];
}

interface ColourCounts {
    S: number;
    M: number;
    L: number;
    total: number;
}

/** Stack a `size` pyramid of `colour` onto an open top of size `consume`, enabling it. */
interface EnableStep {
    colour: string;
    size: Size;
    consume: Size;
}

const tally = (pieces: PieceId[]): Map<string, ColourCounts> => {
    const counts = new Map<string, ColourCounts>();
    for (const piece of pieces) {
        const colour = colourOf(piece);
        let entry = counts.get(colour);
        if (entry === undefined) {
            entry = { S: 0, M: 0, L: 0, total: 0 };
            counts.set(colour, entry);
        }
        const size = sizeOf(piece);
        if (size === 1) {
            entry.S++;
        } else if (size === 2) {
            entry.M++;
        } else {
            entry.L++;
        }
        entry.total++;
    }
    return counts;
};

/** Occupied cells that touch the infinite outside, with the colour and size on top. */
const openTops = (struct: Structure): { cell: Cell; colour: string; size: Size }[] => {
    const exterior = exteriorCells(struct);
    const tops: { cell: Cell; colour: string; size: Size }[] = [];
    for (const cell of struct.keys()) {
        const top = topOf(struct, cell);
        if (top === undefined) {
            continue;
        }
        if (neighbours(cell).some(n => exterior.has(n))) {
            tops.push({ cell, colour: colourOf(top), size: sizeOf(top) });
        }
    }
    return tops;
};

const planEnablements = (
    pending: string[],
    counts: Map<string, ColourCounts>,
    openL: number,
    openM: number,
): { gain: number; steps: EnableStep[] } => {
    const memo = new Map<string, { gain: number; steps: EnableStep[] }>();

    const search = (mask: number, nL: number, nM: number): { gain: number; steps: EnableStep[] } => {
        const key = `${mask},${nL},${nM}`;
        const cached = memo.get(key);
        if (cached !== undefined) {
            return cached;
        }
        let best: { gain: number; steps: EnableStep[] } = { gain: 0, steps: [] };
        for (let i = 0; i < pending.length; i++) {
            if ((mask & (1 << i)) !== 0) {
                continue;
            }
            const colour = pending[i];
            const cc = counts.get(colour)!;
            const options: { size: Size; consume: Size; nL: number; nM: number }[] = [];
            // A medium can only go under a large. The covered cell keeps its outward face,
            // so it becomes an open medium top.
            if (cc.M > 0 && nL >= 1) {
                options.push({ size: 2, consume: 3, nL: nL - 1 + cc.L, nM: nM + cc.M });
            }
            // A small can go under either, and leaves a small top behind, which is spent.
            if (cc.S > 0 && nM >= 1) {
                options.push({ size: 1, consume: 2, nL: nL + cc.L, nM: nM - 1 + cc.M });
            }
            if (cc.S > 0 && nL >= 1) {
                options.push({ size: 1, consume: 3, nL: nL - 1 + cc.L, nM: nM + cc.M });
            }
            for (const option of options) {
                const sub = search(mask | (1 << i), option.nL, option.nM);
                const gain = cc.total + sub.gain;
                if (gain > best.gain) {
                    best = {
                        gain,
                        steps: [{ colour, size: option.size, consume: option.consume }, ...sub.steps],
                    };
                }
            }
        }
        memo.set(key, best);
        return best;
    };

    return search(0, openL, openM);
};

/**
 * An empty cell next to a stack of `colour` that will still touch the outside once filled,
 * so the chain can keep growing from there.
 */
const pickFoundingCell = (struct: Structure, colour: string): Cell | undefined => {
    const exterior = exteriorCells(struct);
    let fallback: Cell | undefined;
    for (const cell of struct.keys()) {
        const top = topOf(struct, cell);
        if (top === undefined || colourOf(top) !== colour) {
            continue;
        }
        for (const n of neighbours(cell)) {
            if (!exterior.has(n)) {
                if (fallback === undefined && !struct.has(n)) {
                    fallback = n;
                }
                continue;
            }
            if (neighbours(n).some(nn => exterior.has(nn))) {
                return n;
            }
            if (fallback === undefined) {
                fallback = n;
            }
        }
    }
    return fallback;
};

const foundAll = (
    struct: Structure,
    remaining: PieceId[],
    sequence: Placement[],
    colour: string,
): void => {
    for (;;) {
        const idx = remaining.findIndex(p => colourOf(p) === colour);
        if (idx < 0) {
            return;
        }
        const cell = pickFoundingCell(struct, colour);
        if (cell === undefined) {
            return;
        }
        const [piece] = remaining.splice(idx, 1);
        placeInto(struct, piece, cell);
        sequence.push({ piece, cell });
    }
};

const enableColour = (
    struct: Structure,
    remaining: PieceId[],
    sequence: Placement[],
    step: EnableStep,
): boolean => {
    const idx = remaining.findIndex(p => colourOf(p) === step.colour && sizeOf(p) === step.size);
    if (idx < 0) {
        return false;
    }
    const exterior = exteriorCells(struct);
    let target: Cell | undefined;
    for (const cell of struct.keys()) {
        const top = topOf(struct, cell);
        if (top === undefined || sizeOf(top) !== step.consume) {
            continue;
        }
        if (neighbours(cell).some(n => exterior.has(n))) {
            target = cell;
            break;
        }
    }
    if (target === undefined) {
        return false;
    }
    const [piece] = remaining.splice(idx, 1);
    placeInto(struct, piece, target);
    sequence.push({ piece, cell: target });
    return true;
};

/**
 * Mops up anything the plan left behind, which is how pyramids of unreachable colours find
 * their way onto enclosed stacks that the resource count deliberately ignores. This can only
 * add placements.
 */
const sweep = (struct: Structure, remaining: PieceId[], sequence: Placement[]): void => {
    let progressed = true;
    while (progressed && remaining.length > 0) {
        progressed = false;
        const order = remaining
            .map((piece, idx) => ({ piece, idx }))
            .sort((a, b) => sizeOf(b.piece) - sizeOf(a.piece));
        for (const { piece, idx } of order) {
            const cells = legalCellsFor(struct, piece, legalPalacePlacement);
            if (cells.length === 0) {
                continue;
            }
            remaining.splice(idx, 1);
            placeInto(struct, piece, cells[0]);
            sequence.push({ piece, cell: cells[0] });
            progressed = true;
            break;
        }
    }
};

const buildOnto = (palace: Structure, pieces: PieceId[]): BuildPlan => {
    const struct = cloneStructure(palace);
    const remaining = [...pieces];
    const sequence: Placement[] = [];

    const counts = tally(pieces);
    const tops = openTops(struct);
    const enabled = new Set(tops.map(t => t.colour));

    let openL = tops.filter(t => t.size === 3).length;
    let openM = tops.filter(t => t.size === 2).length;
    for (const [colour, cc] of counts.entries()) {
        if (enabled.has(colour)) {
            openL += cc.L;
            openM += cc.M;
        }
    }

    for (const colour of enabled) {
        foundAll(struct, remaining, sequence, colour);
    }

    const pending = [...counts.keys()].filter(c => !enabled.has(c));
    const plan = planEnablements(pending, counts, openL, openM);
    for (const step of plan.steps) {
        if (!enableColour(struct, remaining, sequence, step)) {
            break;
        }
        foundAll(struct, remaining, sequence, step.colour);
    }

    sweep(struct, remaining, sequence);
    return { max: sequence.length, sequence };
};

/**
 * The most pyramids the builder can work into the Palace, with one sequence that gets there.
 * `pieces` should already have had Black and White discarded.
 */
export const maximumBuild = (palace: Structure, pieces: PieceId[]): BuildPlan => {
    if (pieces.length === 0) {
        return { max: 0, sequence: [] };
    }
    if (palace.size > 0) {
        return buildOnto(palace, pieces);
    }

    // An empty Palace takes its first pyramid anywhere, and which one it is matters a great
    // deal, so try each distinct choice.
    let best: BuildPlan = { max: 0, sequence: [] };
    const origin = cellOf(0, 0);
    for (const seed of new Set(pieces)) {
        const struct: Structure = new Map([[origin, [seed]]]);
        const rest = [...pieces];
        rest.splice(rest.indexOf(seed), 1);
        const sub = buildOnto(struct, rest);
        if (sub.max + 1 > best.max) {
            best = {
                max: sub.max + 1,
                sequence: [{ piece: seed, cell: origin }, ...sub.sequence],
            };
        }
    }
    return best;
};
