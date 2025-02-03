import { RectGrid } from "./rectGrid";
import { StackSet} from "./stackset";
import { reviver, replacer, sortingReplacer } from "./serialization";
import { shuffle } from "./shuffle";
import { UserFacingError } from "./errors";
import { HexTriGraph, SnubSquareGraph, SquareOrthGraph, SquareDiagGraph, SquareGraph, Square3DGraph, SquareDirectedGraph, SquareFanoronaGraph, BaoGraph, SowingNoEndsGraph } from "./graphs";
import { wng } from "./namegenerator";
import { projectPoint, ptDistance, smallestDegreeDiff, normDeg, deg2rad, rad2deg, toggleFacing, calcBearing, matrixRectRot90, matrixRectRotN90, transposeRect, circle2poly, midpoint, distFromCircle } from "./plotting";
import { hexhexAi2Ap, hexhexAp2Ai, triAi2Ap, triAp2Ai } from "./aiai";
import stringify from "json-stringify-deterministic";
import fnv from "fnv-plus";

export { RectGrid, StackSet, reviver, replacer, sortingReplacer, shuffle, UserFacingError, HexTriGraph, SnubSquareGraph, SquareOrthGraph, SquareDiagGraph, SquareGraph, Square3DGraph, SquareDirectedGraph, SquareFanoronaGraph, BaoGraph, SowingNoEndsGraph, wng, projectPoint, ptDistance, smallestDegreeDiff, normDeg, deg2rad, rad2deg, toggleFacing, calcBearing, matrixRectRot90, matrixRectRotN90, transposeRect, hexhexAi2Ap, hexhexAp2Ai, triAi2Ap, triAp2Ai, circle2poly, midpoint, distFromCircle };

export type DirectionCardinal = "N" | "E" | "S" | "W";
export type DirectionDiagonal = "NE" | "SE" | "SW" | "NW";
export type Direction = DirectionCardinal | DirectionDiagonal;

export const allDirections: Direction[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export const diagDirections: DirectionDiagonal[] = ["NE", "SE", "SW", "NW"];
export const orthDirections: DirectionCardinal[] = ["N", "E", "S", "W"]
export const oppositeDirections: Map<Direction, Direction> = new Map([
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

export const x2uid = (x: any): string => {
    fnv.seed("apgames");
    const hash = fnv.hash(stringify(x));
    return hash.hex();
}

export const partitionArray = (a: any[], size: number): any[][] =>
    Array.from(
        new Array(Math.ceil(a.length / size)),
        // eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-unsafe-return
        (_, i) => a.slice(i * size, i * size + size)
    );

export const columnLabels = "abcdefghijklmnopqrstuvwxyz".split("");

export const coords2algebraic = (x: number, y: number, height: number, reverseNumbers = false): string => {
    let length = 1;
    if (x >= columnLabels.length) {
        length = Math.floor(Math.log(x) / Math.log(columnLabels.length)) + 1;
    }
    let label = "";
    let counter = x;
    for (let i = length; i > 0; i--) {
        const base = columnLabels.length ** (i - 1);
        let idx = Math.floor(counter / base);
        if (i > 1) {
            idx--;
        }
        const char = columnLabels[idx];
        if (char === undefined) {
            throw new Error(`Could not find a character at index ${idx}\n${x},${y}, length: ${length}, base: ${base}`);
        }
        label += char;
        counter = counter % base;
    }
    if (reverseNumbers) { return label + (y + 1).toString(); }
    return label + (height - y).toString();
}

export const algebraic2coords = (cell: string, height: number, reverseNumbers = false): [number, number] => {
    const match = cell.match(/^([a-z]+)(\d+)$/);
    if (match === null) {
        throw new Error(`The algebraic notation is invalid: ${cell}`);
    }
    const lets = match[1]; const nums = match[2];
    const reversed = [...lets.split("").reverse()];
    let x = 0
    for (let exp = 0; exp < reversed.length; exp++) {
        const idx = columnLabels.indexOf(reversed[exp]);
        if (idx < 0) {
            throw new Error(`The column label is invalid: ${reversed[exp]}`);
        }
        if (exp > 0) {
            x += (idx + 1) * (columnLabels.length ** exp);
        } else {
            x += (idx) * (columnLabels.length ** exp);
        }
    }
    const y = parseInt(nums, 10);
    if ( (y === undefined) || (isNaN(y)) || nums === "" ) {
        throw new Error(`The row label is invalid: ${nums}`);
    }
    if (reverseNumbers) { return [x, y - 1]; }
    return [x, height - y];
}
