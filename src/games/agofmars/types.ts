import type { IIndividualState } from "../_base.js";

export type playerid = 1 | 2;
export type Size = 1 | 2 | 3;
export type Colour = "RD" | "BU" | "GN" | "YE" | "VT" | "BK";
export type Phase = "setup-1" | "setup-2" | "play";
export type CellContents = readonly [Colour, Size];

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    lastmove?: string;
    phase: Phase;
    /** Column index → colour assigned there for each seat. */
    objectives: Colour[][];
    objectivesRevealed: boolean[][];
    board: Map<string, CellContents>;
    pendingDraw?: CellContents;
    awaitingMainAction?: boolean;
    /** Armed by the Move / Swap buttons until a board action is submitted. */
    boardActionMode?: "move" | "swap";
    /** First cell selected during an in-progress move or swap (move field `move;a1`). */
    boardActionFrom?: string;
}
