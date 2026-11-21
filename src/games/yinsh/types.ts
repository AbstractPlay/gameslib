import type { IIndividualState } from "../_base.js";

export type playerid = 1 | 2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    phase: "setup" | "play";
    rings: Map<string, playerid>;
    markers: Map<string, playerid>;
    ringsReserve: [number, number];
    markersInPool: number;
    score: [number, number];
    rowPending?: RowPending;
    lastmove?: string;
}

export interface IYinshState {
    game: string;
    numplayers: number;
    variants: string[];
    gameover: boolean;
    winner: playerid[];
    stack: Array<IMoveState>;
}

export interface CapturableRow {
    id: string;
    lineKey: string;
    owner: playerid;
    /** All markers that may be part of a removal (full run on the line). */
    cells: string[];
    /** Contiguous same-colour marker run that triggered capture (length ≥ 5). */
    core: string[];
    /** Legal choices of exactly five markers when `core.length > 5`. */
    segments: string[][];
}

export type RowPhase =
    | { type: "choose-row"; actor: playerid; options: CapturableRow[] }
    | { type: "confirm-markers"; actor: playerid; row: CapturableRow; take: Set<string> }
    | { type: "remove-ring"; actor: playerid };

export interface RowPending {
    /** Who made the play that triggered this sequence (mover resolves own rows first). */
    causedBy: playerid;
    pending: Array<{ actor: playerid; rows: CapturableRow[] }>;
    phase?: RowPhase;
    /** Row ids presented together in choose-row (mutually exclusive). */
    chooseRowPeers?: string[];
}

export const YINSH_P1 = "#ffffff";
export const YINSH_P2 = "#000000";
export const YINSH_BORDER = "#000000";

export const MARKERS_PER_PLAYER = 51;
export const RINGS_PER_PLAYER = 5;
export const STANDARD_SCORE_GOAL = 3;