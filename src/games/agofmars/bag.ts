import type { Colour, Size } from "./types.js";

/** One pyramid token in the draw pool. */
export type PoolPiece = readonly [Colour, Size];

/** Five trios per stash → five pyramids of each size (large, medium, small). */
const TRIO_COUNT = 5;

/** Active play colours (no black). */
export function activeColours(variants: string[]): Colour[] {
    if (variants.includes("five-colour-plus3") || variants.includes("five-colour-minus2")) {
        return ["RD", "BU", "GN", "YE", "VT"];
    }
    return ["RD", "BU", "GN", "YE"];
}

/** Coloured objective pyramid size placed during setup (P1 medium, P2 small). */
export function objectiveColourSizeForSeat(seat: number): Size {
    return (seat === 0 ? 2 : 1) as Size;
}

/** Black cover pyramid size during setup (P1 large, P2 medium). */
export function setupBlackSizeForSeat(seat: number): Size {
    return (seat === 0 ? 3 : 2) as Size;
}

/** Chromatic stashes plus the black stash (75 pyramids in the default four-colour game). */
export function stashColours(variants: string[]): Colour[] {
    return [...activeColours(variants), "BK"];
}

/** Full house inventory before objectives are removed (includes black blockers). */
export function startingMultiset(variants: string[]): PoolPiece[] {
    const pool: PoolPiece[] = [];
    for (const c of stashColours(variants)) {
        for (let s = 1 as Size; s <= 3; s++) {
            for (let n = 0; n < TRIO_COUNT; n++) {
                pool.push([c, s]);
            }
        }
    }
    return pool;
}

export function removeFromMultiset(pool: PoolPiece[], piece: PoolPiece): PoolPiece[] {
    const out = [...pool];
    const idx = out.findIndex(([c, s]) => c === piece[0] && s === piece[1]);
    if (idx >= 0) {
        out.splice(idx, 1);
    }
    return out;
}

/** `BK` in an objectives row is a hidden-info placeholder, not a black objective pyramid. */
function isHiddenObjectivePlaceholder(colour: Colour | undefined): boolean {
    return colour === "BK";
}

function isAssignedObjectiveColour(colour: Colour | undefined, variants: string[]): boolean {
    return colour !== undefined && colour !== "BK" && activeColours(variants).includes(colour);
}

/**
 * Pyramids removed at setup: per seat, one coloured pyramid of the seat's size per column
 * plus one black cover pyramid per column (large for P1, medium for P2).
 *
 * Viewer-redacted state uses `BK` per hidden column; those slots still consumed one chromatic
 * pyramid each at setup (a permutation of active colours), which we infer when building the bag.
 */
export function subtractSetupPyramids(
    pool: PoolPiece[],
    objectives: Colour[][],
    variants: string[] = [],
): PoolPiece[] {
    const chromatic = activeColours(variants);
    let out = pool;
    for (let seat = 0; seat < objectives.length; seat++) {
        const row = objectives[seat];
        if (row === undefined || row.length === 0) {
            continue;
        }
        const colourSize = objectiveColourSizeForSeat(seat);
        const blackSize = setupBlackSizeForSeat(seat);
        const explicit: Colour[] = [];
        let hiddenColumns = 0;
        for (const colour of row) {
            out = removeFromMultiset(out, ["BK", blackSize]);
            if (isAssignedObjectiveColour(colour, variants)) {
                explicit.push(colour);
                out = removeFromMultiset(out, [colour, colourSize]);
            } else if (isHiddenObjectivePlaceholder(colour)) {
                hiddenColumns++;
            }
        }
        if (hiddenColumns > 0) {
            const inferredHidden = chromatic.filter(c => !explicit.includes(c));
            if (inferredHidden.length === hiddenColumns) {
                for (const c of inferredHidden) {
                    out = removeFromMultiset(out, [c, colourSize]);
                }
            }
        }
    }
    return out;
}

export function buildDrawPoolFromBoard(
    variants: string[],
    board: Map<string, PoolPiece>,
    objectives: Colour[][],
    pendingDraw?: PoolPiece,
): PoolPiece[] {
    let pool = subtractSetupPyramids(startingMultiset(variants), objectives, variants);
    for (const [, piece] of board) {
        pool = removeFromMultiset(pool, piece);
    }
    if (pendingDraw !== undefined) {
        pool = removeFromMultiset(pool, pendingDraw);
    }
    return pool;
}

/** @deprecated Use {@link subtractSetupPyramids}. */
export const subtractObjectivePyramids = subtractSetupPyramids;

export interface OrganizedPoolPieces {
    triosMono: PoolPiece[][];
    partialsMono: PoolPiece[][];
    triosMixed: PoolPiece[][];
    partialsMixed: PoolPiece[][];
    miscellaneous: PoolPiece[];
}

/** Group loose pool pyramids into stacks (mono trios first), like Volcano captured-piece areas. */
export function organizePoolPieces(pool: PoolPiece[]): OrganizedPoolPieces {
    const org: OrganizedPoolPieces = {
        triosMono: [],
        partialsMono: [],
        triosMixed: [],
        partialsMixed: [],
        miscellaneous: [],
    };

    const pile = [...pool];
    const stacks: PoolPiece[][] = [];

    const lgs = pile.filter(x => x[1] === 3);
    const mds = pile.filter(x => x[1] === 2);
    const sms = pile.filter(x => x[1] === 1);

    while (lgs.length > 0) {
        const stack: PoolPiece[] = [];
        const next = lgs.pop()!;
        stack.push(next);
        const mdIdx = mds.findIndex(x => x[0] === next[0]);
        if (mdIdx >= 0) {
            stack.push(mds[mdIdx]!);
            mds.splice(mdIdx, 1);
            const smIdx = sms.findIndex(x => x[0] === next[0]);
            if (smIdx >= 0) {
                stack.push(sms[smIdx]!);
                sms.splice(smIdx, 1);
            }
        }
        stacks.push(stack);
    }
    for (const stack of stacks) {
        if (stack.length === 1) {
            const mdIdx = mds.findIndex(x => x[1] === 2);
            if (mdIdx >= 0) {
                stack.push(mds[mdIdx]!);
                mds.splice(mdIdx, 1);
            }
        }
    }
    for (const stack of stacks) {
        if (stack.length === 2) {
            const smIdx = sms.findIndex(x => x[1] === 1);
            if (smIdx >= 0) {
                stack.push(sms[smIdx]!);
                sms.splice(smIdx, 1);
            }
        }
    }
    while (mds.length > 0) {
        const stack: PoolPiece[] = [];
        const next = mds.pop()!;
        stack.push(next);
        const smIdx = sms.findIndex(x => x[0] === next[0]);
        if (smIdx >= 0) {
            stack.push(sms[smIdx]!);
            sms.splice(smIdx, 1);
        }
        stacks.push(stack);
    }
    for (const stack of stacks) {
        if (stack.length === 1 && stack[0]![1] === 2) {
            const smIdx = sms.findIndex(x => x[1] === 1);
            if (smIdx >= 0) {
                stack.push(sms[smIdx]!);
                sms.splice(smIdx, 1);
            }
        }
    }
    stacks.push(...sms.map(x => [x]));

    const pieces = stacks.reduce<PoolPiece[]>((acc, stack) => acc.concat(stack), []);
    if (pieces.length !== pool.length) {
        throw new Error("Pool stack lengths don't match.");
    }

    for (const stack of stacks) {
        if (stack.length === 3) {
            if (new Set(stack.map(c => c[0])).size === 1) {
                org.triosMono.push(stack);
            } else {
                org.triosMixed.push(stack);
            }
        } else if (stack.length === 2) {
            if (new Set(stack.map(c => c[0])).size === 1) {
                org.partialsMono.push(stack);
            } else {
                org.partialsMixed.push(stack);
            }
        } else {
            org.miscellaneous.push(...stack);
        }
    }

    return org;
}
