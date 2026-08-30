import type { IGamePly } from "./_turn-model.js";

export interface ISkipTurnHost {
    readonly stack: Array<Record<string, unknown>>;
    readonly numplayers: number;
}

/** Close when the next player to act completes a full active-player cycle. */
export function skipTurnShouldCloseRound(
    game: ISkipTurnHost,
    roundPlies: IGamePly[],
    stackIndex: number,
): boolean {
    if (roundPlies.length === 0) {
        return false;
    }
    const state = game.stack[stackIndex];
    if (!("currplayer" in state)) {
        return false;
    }
    const nextPlayer = state.currplayer as number;
    const roundOpener = roundPlies[0]!.actor;
    return nextPlayer === roundOpener;
}
