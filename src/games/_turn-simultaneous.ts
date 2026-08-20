import type { GameBaseSimultaneous } from "./_base";
import type { APMoveResult } from "../schemas/moveresults";
import type { IGamePly, IGameRound, IGameRoundSlot } from "./_turn-model";

/** Eliminated-seat sentinel in pigs simultaneous move strings. */
export const SIMULTANEOUS_ELIM_TOKEN = "\u0091";

export interface ISimultaneousTurnHost {
    readonly stack: GameBaseSimultaneous["stack"];
    readonly numplayers: number;
}

/** Per-seat move tokens from `stack[stackIndex].lastmove` (array or comma string). */
export function simultaneousMoveTokens(
    lastmove: unknown,
    numplayers: number,
): string[] {
    if (Array.isArray(lastmove)) {
        if (lastmove.length !== numplayers) {
            throw new Error(
                `Simultaneous lastmove has ${lastmove.length} parts, expected ${numplayers}.`,
            );
        }
        return lastmove.map((part) => String(part));
    }
    if (typeof lastmove === "string") {
        const parts = lastmove.split(/\s*,\s*/);
        if (parts.length !== numplayers) {
            throw new Error(
                `Simultaneous lastmove has ${parts.length} parts, expected ${numplayers}.`,
            );
        }
        return parts;
    }
    throw new Error("Simultaneous stack entry is missing `lastmove`.");
}

/** Whether a seating slot is inactive for export (eliminated / pass-through). */
export function isNullSimultaneousMoveToken(token: string): boolean {
    return token === SIMULTANEOUS_ELIM_TOKEN || token === "";
}

function buildSimultaneousSlot(
    move: string,
    results: APMoveResult[],
): string | IGameRoundSlot {
    if (results.length > 0) {
        return { move, result: [...results] };
    }
    return move;
}

/** Nested `_group` (pigs) or flat per-seat results (entropy). */
export function resultsForSimultaneousSeat(
    stackResults: APMoveResult[] | undefined,
    seat: number,
): APMoveResult[] {
    if (stackResults === undefined || stackResults.length === 0) {
        return [];
    }
    for (const entry of stackResults) {
        if (entry.type === "_group" && entry.who === seat && entry.results !== undefined) {
            return [...entry.results];
        }
    }
    if (!stackResults.some((r) => r.type === "_group")) {
        const actionable = stackResults.filter(
            (r) => r.type !== "eog" && r.type !== "winners",
        );
        const idx = seat - 1;
        if (idx >= 0 && idx < actionable.length) {
            return [actionable[idx]];
        }
    }
    return [];
}

/** One stack entry → seating-indexed round row (null for eliminated seats). */
export function buildSimultaneousRoundRow(
    game: ISimultaneousTurnHost,
    stackIndex: number,
): IGameRound {
    const state = game.stack[stackIndex];
    if (!Object.prototype.hasOwnProperty.call(state, "lastmove")) {
        throw new Error("No `lastmove` property found.");
    }
    const tokens = simultaneousMoveTokens(state.lastmove, game.numplayers);
    const stackResults = state._results;
    const row: IGameRound = new Array(game.numplayers).fill(null);
    for (let seat = 0; seat < game.numplayers; seat++) {
        const token = tokens[seat]!;
        if (isNullSimultaneousMoveToken(token)) {
            row[seat] = null;
            continue;
        }
        row[seat] = buildSimultaneousSlot(
            token,
            resultsForSimultaneousSeat(stackResults, seat + 1),
        );
    }
    return row;
}

/** One stack entry = one logical round; one ply per active seat. */
export function buildSimultaneousPlies(game: ISimultaneousTurnHost): IGamePly[] {
    const plies: IGamePly[] = [];
    for (let stackIndex = 1; stackIndex < game.stack.length; stackIndex++) {
        const state = game.stack[stackIndex];
        if (!Object.prototype.hasOwnProperty.call(state, "lastmove")) {
            throw new Error("No `lastmove` property found.");
        }
        const tokens = simultaneousMoveTokens(state.lastmove, game.numplayers);
        const stackResults = state._results;
        const round = stackIndex - 1;
        let playOrder = 0;
        for (let seat = 0; seat < game.numplayers; seat++) {
            const token = tokens[seat]!;
            if (isNullSimultaneousMoveToken(token)) {
                continue;
            }
            playOrder += 1;
            plies.push({
                actor: seat + 1,
                move: token,
                results: resultsForSimultaneousSeat(stackResults, seat + 1),
                stackIndex,
                round,
                playOrder,
            });
        }
    }
    return plies;
}

export function buildSimultaneousRounds(game: ISimultaneousTurnHost): IGameRound[] {
    const rounds: IGameRound[] = [];
    for (let stackIndex = 1; stackIndex < game.stack.length; stackIndex++) {
        rounds.push(buildSimultaneousRoundRow(game, stackIndex));
    }
    return rounds;
}
