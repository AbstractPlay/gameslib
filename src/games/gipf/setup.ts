import type { CellPiece, RulesVariant, playerid } from "./types.js";

/** Diagram 1: first spot from each angular dot; owners alternate clockwise from e8. */
export const STANDARD_START_SPOTS: Array<[playerid, string, "basic" | "gipf"]> = [
    [2, "e8", "gipf"],
    [1, "h5", "gipf"],
    [2, "h2", "gipf"],
    [1, "e2", "gipf"],
    [2, "b2", "gipf"],
    [1, "b5", "gipf"],
];

export function initialReserve(variant: RulesVariant): [number, number] {
    switch (variant) {
        case "basic":
        case "standard":
            return [12, 12];
        case "tournament":
            return [18, 18];
    }
}

export function buildInitialBoard(
    variant: RulesVariant,
): Map<string, CellPiece> {
    const board = new Map<string, CellPiece>();
    if (variant === "tournament") {
        return board;
    }
    const kind = variant === "basic" ? "basic" : "gipf";
    for (const [owner, cell, k] of STANDARD_START_SPOTS) {
        board.set(cell, { owner, kind: variant === "standard" ? k : kind });
    }
    return board;
}