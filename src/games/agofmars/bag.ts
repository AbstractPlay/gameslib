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
