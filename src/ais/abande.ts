import { AbandeGame, IAbandeState } from "../games";
import {minmax} from 'minmax-wt-alpha-beta-pruning';
import { AIBase } from "./_base";
import { IAIResult } from ".";

const gameRules = {
    listMoves: (state: IAbandeState): string[] => {
        const g = new AbandeGame(state);
        return g.moves();
    },
    nextState: (state: IAbandeState, move: string): IAbandeState => {
        const g = new AbandeGame(state);
        g.move(move);
        return g.state();
    },
    terminalStateEval: (state: IAbandeState): number|null => {
        const g = new AbandeGame(state);
        // g.checkEOG();
        if (! g.gameover) {
            return null;
        }
        if (g.winner.includes(g.currplayer)) {
            // If you're the sole winner, then that's the best
            if (g.winner.length === 1) {
                return Infinity;
            // A draw is still better than a loss, but a win would be better if it's available
            } else {
                return 30;
            }
        } else {
            return -Infinity;
        }
    }
}

/**
 * Purely score.
 *
 */
const evaluate = (state: IAbandeState): number => {
    const g = new AbandeGame(state);
    return g.getPlayerScore(g.currplayer)
};

export class AbandeAI extends AIBase {
    public static findmove(state: IAbandeState, plies: number): string {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const result: IAIResult =  minmax(state, gameRules, evaluate, plies);
        if ( (result === undefined) || (! result.hasOwnProperty("bestMove")) || (result.bestMove === undefined) || (result.bestMove === null) ) {
            throw new Error("No best move found. This should never happen.");
        }
        return result.bestMove;
    }
}