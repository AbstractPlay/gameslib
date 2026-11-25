export type playerid = 1 | 2;
export type PieceKind = "basic" | "gipf";

export interface CellPiece {
    owner: playerid;
    kind: PieceKind;
}

export type RulesVariant = "basic" | "standard" | "tournament";

export interface CapturableRow {
    id: string;
    lineKey: string;
    owner: playerid;
    /** Cells removed when this row is captured (core + extensions). */
    cells: string[];
    /** Spots forming the triggering four-plus same-colour run. */
    core: string[];
}

export type CapturePhase =
    | { type: "choose-row"; actor: playerid; options: CapturableRow[] }
    | {
          type: "confirm";
          actor: playerid;
          row: CapturableRow;
          /** Gipf cells the actor may leave on the board (Standard/Tournament). */
          optionalGipf: string[];
          /** Cells currently selected for removal (mandatory + chosen gipf). */
          take: Set<string>;
          /** Bit mask over sorted `optionalGipf` for the current UI selection. */
          selectionMask: number;
      };

export interface CapturePending {
    /** Who made the play that triggered this sequence (for mover-first). */
    causedBy: playerid;
    /** Remaining capture obligations. */
    pending: Array<{ actor: playerid; rows: CapturableRow[] }>;
    phase?: CapturePhase;
    /** Row ids presented together in the current choose-row (mutually exclusive). */
    chooseRowPeers?: string[];
}

/** Theme player 1 red (`#e31a1c`). */
export const GIPF_P1 = "#e31a1c";
/** Theme player 2 blue (`#1f78b4`). */
export const GIPF_P2 = "#1f78b4";

/** Default outline on basic (single) pieces for both players. */
export const GIPF_PIECE_BORDER = "#000000";

/** Default chariot outer ring for both players. */
export const GIPF_CHARIOT_BORDER = "#000000";
/** Default chariot inner rings on player 1 GIPF-pieces. */
export const GIPF_P1_CHARIOT_INNER = "#000000";
/** Default chariot inner rings on player 2 GIPF-pieces. */
export const GIPF_P2_CHARIOT_INNER = "#000000";