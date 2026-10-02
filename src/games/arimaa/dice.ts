/**
 * Dicey Moves, an official Arimaa variant: a die cast before each move caps
 * the steps that turn may take.
 *
 * The engine stores each turn's die on the state that turn starts from, so
 * loading or undoing to a position shows the same roll again. The rolls
 * cannot be recovered from the moves, but each one also heads its turn's
 * results as a `roll` result, which is how it reaches the move log and the
 * game record. Apart from the roll itself, everything here is a pure
 * function of the position.
 */
import { randomInt } from "../../common/index.js";
import { sqIndex, sqName, TRAPS, type CellContents } from "./turns.js";

/** The die cast for one turn. */
export interface IDie {
    /** the most steps the mover may take this turn, from 1 to 4 */
    steps: number;
    /** where the die is shown: a square empty as the turn began, which a piece moving there covers */
    square: string;
}

/**
 * Cast the die for a turn starting from `board`. A normal turn rolls a d6
 * capped at four, so one, two and three steps each come up a sixth of the
 * time and four the other half. The opening move of Endless endgame is half
 * a turn, so its die shows one or two, evenly, which halves both the maximum
 * and the mean.
 */
export function castDie(board: Map<string, CellContents>, turn: "normal" | "opening" = "normal"): IDie {
    const steps = turn === "opening" ? randomInt(2, 1) : Math.min(4, randomInt(6, 1));
    return { steps, square: dieSquare(board) };
}

/**
 * Where the die is shown for a turn starting from `board`: the unoccupied
 * square with the highest openness, and among equals the first reading from
 * rank 8 down and from a to h. Only a free setup can fill every square; the
 * die then goes on d4, under a piece.
 */
export function dieSquare(board: Map<string, CellContents>): string {
    const occupied = new Set([...board.keys()].map(sqIndex));
    // what openness counts as full: occupied squares, traps, and anything off the board
    const full = (file: number, rank: number): boolean =>
        file < 0 || file > 7 || rank < 0 || rank > 7 || occupied.has(rank * 8 + file) || TRAPS.includes(rank * 8 + file);
    let best: string | undefined;
    let bestOpenness = -Infinity;
    for (let rank = 7; rank >= 0; rank--) {
        for (let file = 0; file < 8; file++) {
            // an empty trap can take the die, though it scores nothing for itself
            if (occupied.has(rank * 8 + file)) {
                continue;
            }
            const value = openness(full, file, rank);
            if (value > bestOpenness) {
                bestOpenness = value;
                best = sqName(rank * 8 + file);
            }
        }
    }
    return best ?? "d4";
}

/**
 * The openness of the square at `file` and `rank`, both counted from 0: the
 * sum of f(a) = SE(a) * (5 - a) / S(a) for a from 0 to 4. SE(a) counts the
 * squares exactly a steps away by Manhattan distance that `full` does not
 * report, the square itself for a = 0, and S(a) counts every square that
 * far. An empty trap counts as full for its own term too, which puts it 5
 * behind any other empty square.
 *
 * The result is in 48ths. As 48 is the least common multiple of S(0) to
 * S(4), every term is a whole number, so equal openness compares as equal.
 */
function openness(full: (file: number, rank: number) => boolean, file: number, rank: number): number {
    let sum = 0;
    for (let a = 0; a < 5; a++) {
        // SE(a), walking the ring of squares exactly a steps away
        let emptyInRing = 0;
        for (let dx = -a; dx <= a; dx++) {
            const dy = a - Math.abs(dx);
            if (!full(file + dx, rank + dy)) {
                emptyInRing++;
            }
            if (dy > 0 && !full(file + dx, rank - dy)) {
                emptyInRing++;
            }
        }
        sum += emptyInRing * (5 - a) * 48 / ringSize(a);
    }
    return sum;
}

/** S(a): how many squares lie exactly a steps from any square, counting those off the board. */
function ringSize(a: number): number {
    return a === 0 ? 1 : 4 * a;
}
