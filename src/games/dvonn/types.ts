import { GIPF_P1, GIPF_P2, GIPF_PIECE_BORDER } from "../gipf/types.js";

export type playerid = 1 | 2;
export type Phase = "setup" | "play";

export type StackDisc = { kind: "dvonn" } | { kind: "basic"; owner: playerid };

export interface CellStack {
  /** Controller from the top disc (undefined when top is a lone DVONN piece). */
  owner?: playerid;
  pieces: StackDisc[];
}

export interface SeatReserves {
  dvonn: number;
  basic: number;
}

export type Reserves = [SeatReserves, SeatReserves];

export const PIECES_PER_PLAYER = 23;
export const DVONN_PIECES = 3;
export const SETUP_PLIES = DVONN_PIECES + PIECES_PER_PLAYER * 2;

/** Theme palette-1 default red (customization slot 5 fall-back). */
export const DVONN_FILL = "#CC0000";

export { GIPF_P1, GIPF_P2, GIPF_PIECE_BORDER };