/* eslint-disable */
/**
 * This file was automatically generated by json-schema-to-typescript.
 * DO NOT MODIFY IT BY HAND. Instead, modify the source JSONSchema file,
 * and run json-schema-to-typescript to regenerate this file.
 */

/**
 * List of URLs related to the game
 */
export type Urllist = string[];

/**
 * When requested, the games library will produce the following information about Tafl rulesets
 */
export interface Ruleset {
  /**
   * The name of the ruleset
   */
  name: string;
  /**
   * The unique code by which this game is referred to by the system. It's typically lowercase and devoid of whitespace and special characters. It should mirror the game name as much as possible.
   */
  uid: string;
  /**
   * A Markdown-formatted description of the game, which can include a rules summary
   */
  description?: string;
  /**
   * Markdown-formatted implementation notes. There is where we can explain implementation-specific details about how the game works on Abstract Play specifically. This should help keep the game descriptions clean.
   */
  notes?: string;
  urls?: Urllist;
  /**
   * The type of escape for defenders
   */
  escapeType?: "edge" | "corner";
  /**
   * The pieces in the game
   */
  pieces?: {
    king?: {
      /**
       * How the piece can be captured
       */
      strength?: "strong-near-throne" | "strong" | "weak";
      /**
       * How the piece can take part in custodian capture. Piercing hammers can capture strong pieces with a piercing anvil.
       */
      power?: "armed" | "anvil-only" | "hammer-only" | "unarmed" | "piercing";
      /**
       * The type of jump a piece can make
       */
      jump?:
        | "no-jump"
        | "jump-taflmen"
        | "jump-enemy-taflmen"
        | "jump-capture-enemy-taflmen"
        | "jump-enemy-taflmen-to-from-restricted";
      /**
       * The type of movement a piece can make
       */
      movement?: "rook" | "rook-1";
      /**
       * Whether the king can escape from a berserk. Note that in current implementation, this can only be enabled if the game has berserk capture.
       */
      berserkEscape?: boolean;
    };
    /**
     * Regular piece
     */
    taflman?: {
      /**
       * How the piece can be captured
       */
      strength?: "strong-near-throne" | "strong" | "weak";
      /**
       * How the piece can take part in custodian capture. Piercing hammers can capture strong pieces with a piercing anvil.
       */
      power?: "armed" | "anvil-only" | "hammer-only" | "unarmed" | "piercing";
      /**
       * The type of jump a piece can make
       */
      jump?:
        | "no-jump"
        | "jump-taflmen"
        | "jump-enemy-taflmen"
        | "jump-capture-enemy-taflmen"
        | "jump-enemy-taflmen-to-from-restricted";
      /**
       * The type of movement a piece can make
       */
      movement?: "rook" | "rook-1";
    };
    /**
     * The knight piece
     */
    knight?: {
      /**
       * How the piece can be captured
       */
      strength?: "strong-near-throne" | "strong" | "weak";
      /**
       * How the piece can take part in custodian capture. Piercing hammers can capture strong pieces with a piercing anvil.
       */
      power?: "armed" | "anvil-only" | "hammer-only" | "unarmed" | "piercing";
      /**
       * The type of jump a piece can make
       */
      jump?:
        | "no-jump"
        | "jump-taflmen"
        | "jump-enemy-taflmen"
        | "jump-capture-enemy-taflmen"
        | "jump-enemy-taflmen-to-from-restricted";
      /**
       * The type of movement a piece can make
       */
      movement?: "rook" | "rook-1";
    };
    /**
     * The commander piece
     */
    commander?: {
      /**
       * How the piece can be captured
       */
      strength?: "strong-near-throne" | "strong" | "weak";
      /**
       * How the piece can take part in custodian capture. Piercing hammers can capture strong pieces with a piercing anvil.
       */
      power?: "armed" | "anvil-only" | "hammer-only" | "unarmed" | "piercing";
      /**
       * The type of jump a piece can make
       */
      jump?:
        | "no-jump"
        | "jump-taflmen"
        | "jump-enemy-taflmen"
        | "jump-capture-enemy-taflmen"
        | "jump-enemy-taflmen-to-from-restricted";
      /**
       * The type of movement a piece can make
       */
      movement?: "rook" | "rook-1";
    };
    [k: string]: unknown;
  };
  /**
   * The type of throne
   */
  throne?: {
    /**
     * The type of throne
     */
    type?: "no-throne" | "centre";
    /**
     * The type of piece that a space is restricted to. If 'all', then all pieces can enter the space. If 'none', then no piece can enter the space. If 'king-only', then only the king can re-enter the space once it leaves.
     */
    emptyRestrictedTo?: "all" | "none" | "king-only";
    /**
     * The type of piece that a space is hostile to.
     */
    emptyAnvilTo?: "all" | "none" | "men-only" | "king-only" | "men-only-piercing" | "all-piercing";
    /**
     * The type of piece that a space is passable by
     */
    emptyPassableBy?: "all" | "none" | "king-only";
    /**
     * Whether the Linnean capture rule is in effect, where a piece next to the king when the king is on the throne and surrounded on the other three sides by attackers may be captured against the throne. Note that this is not currently implemented.
     */
    linnaeanCapture?: boolean;
    additionalProperties?: false;
    [k: string]: unknown;
  };
  /**
   * The type of corner
   */
  corner?: {
    /**
     * The type of corner
     */
    type?: "no-corner" | "corner";
    /**
     * The type of piece that a space is restricted to. If 'all', then all pieces can enter the space. If 'none', then no piece can enter the space. If 'king-only', then only the king can re-enter the space once it leaves.
     */
    restrictedTo?: "all" | "none" | "king-only";
    /**
     * The type of piece that a space is hostile to.
     */
    anvilTo?: "all" | "none" | "men-only" | "king-only" | "men-only-piercing" | "all-piercing";
  };
  /**
   * The type of edge
   */
  edge?: {
    /**
     * The type of piece that a space is hostile to.
     */
    anvilTo?: "all" | "none" | "men-only" | "king-only" | "men-only-piercing" | "all-piercing";
  };
  /**
   * Whether the game has shield walls
   */
  hasShieldWalls?: boolean;
  /**
   * Whether the game has exit forts
   */
  hasExitForts?: boolean;
  /**
   * Whether the game has an enclosure win condition
   */
  enclosureWin?: boolean;
  /**
   * Whether the game has a berserk capture rule
   */
  berserkCapture?: boolean;
  [k: string]: unknown;
}
