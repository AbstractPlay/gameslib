import type { APMoveResult } from "../schemas/moveresults";

export type TurnModel = "sequential" | "simultaneous" | "sequenced" | "skip-turn";

export interface IGamePly {
    actor: number;
    move: string;
    results: APMoveResult[];
    stackIndex: number;
    /** 0-based logical round */
    round: number;
    /** 1-based chronological order within the round */
    playOrder: number;
}

export interface IGameRoundSlot {
    move: string;
    sequence?: number;
    result?: APMoveResult[];
}

/** Seating-indexed round row (`length === numplayers` unless sparse override in later phases). */
export type IGameRound = (string | IGameRoundSlot | null)[];
