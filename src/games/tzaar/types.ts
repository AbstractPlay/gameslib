export type playerid = 1 | 2;
export type PieceKind = "tott" | "tzarra" | "tzaar";
export type Phase = "setup" | "play";

export interface PieceCounts {
    tzaar: number;
    tzarra: number;
    tott: number;
}

export interface CellStack {
    owner: playerid;
    pieces: PieceKind[];
}

export interface PendingSetup {
    cell: string;
    kind?: PieceKind;
}

export type Reserves = [PieceCounts, PieceCounts];

export const PIECE_COUNTS_PER_PLAYER: PieceCounts = {
    tzaar: 6,
    tzarra: 9,
    tott: 15,
};

export const PLAYABLE_INTERSECTIONS = 60;

export type SlideMode = "capture" | "strengthen" | "capture-only";

export const KIND_SUFFIX: Record<PieceKind, string> = {
    tott: "T",
    tzarra: "R",
    tzaar: "Z",
};

export const SUFFIX_KIND: Record<string, PieceKind> = {
    t: "tott",
    r: "tzarra",
    z: "tzaar",
};

/** Display names for chat and UI (always capitalized). */
export const PIECE_KIND_LABEL: Record<PieceKind, string> = {
    tott: "Tott",
    tzarra: "Tzarra",
    tzaar: "Tzaar",
};