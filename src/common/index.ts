import { RectGrid } from "./rectGrid";
import { reviver, replacer } from "./serialization";
import { shuffle } from "./shuffle";
import { UserFacingError } from "./errors";
import { HexTriGraph, SnubSquareGraph, SquareOrthGraph, SquareGraph } from "./graphs";
import { wng } from "./namegenerator";

export { RectGrid, reviver, replacer, shuffle, UserFacingError, HexTriGraph, SnubSquareGraph, SquareOrthGraph, SquareGraph, wng };

export type DirectionsCardinal = "N" | "E" | "S" | "W";
export type DirectionsDiagonal = "NE" | "SE" | "SW" | "NW";
export type Directions = DirectionsCardinal | DirectionsDiagonal;

export const allDirections: Directions[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export const oppositeDirections: Map<Directions, Directions> = new Map([
    ["N", "S"], ["NE", "SW"], ["E", "W"], ["SE", "NW"],
    ["S", "N"], ["SW", "NE"], ["W", "E"], ["NW", "SE"]
]);
