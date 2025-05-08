import { TaijiGame, ITaijiState } from "../games";
import {minmax} from 'minmax-wt-alpha-beta-pruning';
import { AIBase } from "./_base";
import { IAIResult } from ".";
import { shuffle } from "../common";

const gameRules = {
    listMoves: (state: ITaijiState): string[] => {
        const g = new TaijiGame(state);
        return shuffle(g.moves()) as string[];
    },
    nextState: (state: ITaijiState, move: string): ITaijiState => {
        const g = new TaijiGame(state);
        g.move(move);
        return g.state();
    },
    terminalStateEval: (state: ITaijiState): number|null => {
        const g = new TaijiGame(state);
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
const evaluate = (state: ITaijiState): number => {
    const g = new TaijiGame(state);
    return g.getPlayerScore(g.currplayer)
}

export class TaijiAI extends AIBase {
    public static findmove(state: ITaijiState, plies: number): string {
                const result: IAIResult =  minmax(state, gameRules, evaluate, plies);
        if ( (result === undefined) || (! result.hasOwnProperty("bestMove")) || (result.bestMove === undefined) || (result.bestMove === null) ) {
            throw new Error("No best move found. This should never happen.");
        }
        return result.bestMove;
    }
}