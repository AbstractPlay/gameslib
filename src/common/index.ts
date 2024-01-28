import { RectGrid } from "./rectGrid";
import { reviver, replacer, sortingReplacer } from "./serialization";
import { shuffle } from "./shuffle";
import { UserFacingError } from "./errors";
import { HexTriGraph, SnubSquareGraph, SquareOrthGraph, SquareDiagGraph, SquareGraph, SquareFanoronaGraph, BaoGraph, SowingNoEndsGraph } from "./graphs";
import { wng } from "./namegenerator";
import { projectPoint, ptDistance, smallestDegreeDiff, normDeg, deg2rad, rad2deg, toggleFacing, calcBearing } from "./plotting";
import { hexhexAi2Ap, hexhexAp2Ai, triAi2Ap, triAp2Ai } from "./aiai";

export { RectGrid, reviver, replacer, sortingReplacer, shuffle, UserFacingError, HexTriGraph, SnubSquareGraph, SquareOrthGraph, SquareDiagGraph, SquareGraph, SquareFanoronaGraph, BaoGraph, SowingNoEndsGraph, wng, projectPoint, ptDistance, smallestDegreeDiff, normDeg, deg2rad, rad2deg, toggleFacing, calcBearing, hexhexAi2Ap, hexhexAp2Ai, triAi2Ap, triAp2Ai };

export type DirectionsCardinal = "N" | "E" | "S" | "W";
export type DirectionsDiagonal = "NE" | "SE" | "SW" | "NW";
export type Directions = DirectionsCardinal | DirectionsDiagonal;

export const allDirections: Directions[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export const oppositeDirections: Map<Directions, Directions> = new Map([
    ["N", "S"], ["NE", "SW"], ["E", "W"], ["SE", "NW"],
    ["S", "N"], ["SW", "NE"], ["W", "E"], ["NW", "SE"]
]);

export interface IPoint {
    x: number;
    y: number;
}

export const intersects = (left: any[], right: any[]): boolean => {
    for (const l of left) {
        if (right.includes(l)) {
            return true;
        }
    }
    return false;
}

export const randomInt = (max: number, min = 1): number => {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
