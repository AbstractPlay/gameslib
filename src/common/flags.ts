import type { APGamesInformation } from "../schemas/gameinfo.js";

/** A game capability flag from `APGamesInformation.flags`. */
export type GameFlag = NonNullable<APGamesInformation["flags"]>[number];

/** Inputs for resolving effective flags before or during a session. */
export interface FlagContext {
    variants?: string[];
    numplayers?: number;
}
