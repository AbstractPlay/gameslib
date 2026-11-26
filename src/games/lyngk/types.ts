import type { IIndividualState } from "../_base.js";
import type { IAPGameState } from "../_base.js";

export type playerid = 1 | 2;

/** Active palette colours 1–5; 6 = joker. */
export type PieceColour = 1 | 2 | 3 | 4 | 5 | 6;

export type ActiveColour = 1 | 2 | 3 | 4 | 5;

export type Board = Map<string, PieceColour[]>;

export interface ClaimState {
    /** Seat that claimed colour `c`, or undefined if still neutral on the board. */
    owner: [playerid | undefined, playerid | undefined, playerid | undefined, playerid | undefined, playerid | undefined];
    /** Reserve tokens not yet claimed (one per colour still in the pool). */
    inReserve: Set<ActiveColour>;
}

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Board;
    claims: ClaimState;
    captured: [number, number];
    /** Per-seat colours claimed (max 2 each). */
    claimed: [ActiveColour[], ActiveColour[]];
    lastmove?: string;
    rngCounter?: number;
}

export interface ILyngkState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
}

export const COLOURS_PER_ACTIVE = 8;
export const JOKER_COUNT = 3;