import type { GameBase } from "./_base";
import type { IGamePly } from "./_turn-model";

/**
 * Frozen legacy stride — matches {@link GameBase.moveHistory} / {@link GameBase.moveHistoryWithSequence}
 * grouping (`i += numplayers`). Tier 1 replay surfaces stay on this shape; do not use for export.
 */
export function getPliesSequential(game: GameBase): IGamePly[] {
    const plies: IGamePly[] = [];
    for (let i = 1; i < game.stack.length; i += game.numplayers) {
        const round = Math.floor((i - 1) / game.numplayers);
        let playOrderInRound = 0;
        for (let j = 0; j < game.numplayers; j++) {
            const idx = i + j;
            if (idx >= game.stack.length) {
                break;
            }
            const state = game.stack[idx];
            if (!("lastmove" in state)) {
                throw new Error("No `lastmove` property found.");
            }
            const prevState = game.stack[idx - 1];
            if (!("currplayer" in prevState)) {
                throw new Error("You can't produce a move list with sequence numbers unless `currplayer` is defined in the move's state.");
            }
            playOrderInRound += 1;
            plies.push({
                actor: prevState.currplayer as number,
                move: state.lastmove as string,
                results: state._results !== undefined ? [...state._results] : [],
                stackIndex: idx,
                round,
                playOrder: playOrderInRound,
            });
        }
    }
    return plies;
}

/** Flatten stride-grouped plies to the same move list as {@link GameBase.moveHistory}. */
export function moveHistoryFromSequentialPlies(game: GameBase): string[][] {
    const moves: string[][] = [];
    for (let i = 1; i < game.stack.length; i += game.numplayers) {
        const round: string[] = [];
        for (let j = 0; j < game.numplayers; j++) {
            const idx = i + j;
            if (idx >= game.stack.length) {
                break;
            }
            const state = game.stack[idx];
            if (!("lastmove" in state)) {
                throw new Error("No `lastmove` property found.");
            }
            round.push(state.lastmove as string);
        }
        moves.push(round);
    }
    return moves;
}
