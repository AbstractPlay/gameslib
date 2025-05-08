import { CephalopodGame, ICephalopodState } from "../games";
import {minmax} from 'minmax-wt-alpha-beta-pruning';
import { AIBase } from "./_base";
import { IAIResult } from ".";

const gameRules = {
    listMoves: (state: ICephalopodState): string[] => {
        const g = new CephalopodGame(state);
        return g.moves();
    },
    nextState: (state: ICephalopodState, move: string): ICephalopodState => {
        const g = new CephalopodGame(state);
        g.move(move);
        return g.state();
    },
    terminalStateEval: (state: ICephalopodState): number|null => {
        const g = new CephalopodGame(state);
        // g.checkEOG();
        if (! g.gameover) {
            return null;
        }
        if (g.winner.includes(g.currplayer)) {
            return Infinity;
        } else {
            return -Infinity;
        }
    }
}

/**
 * Purely score.
 *
 */
const evaluate = (state: ICephalopodState): number => {
    const g = new CephalopodGame(state);
    return g.getPlayerScore(g.currplayer)
}

export class CephalopodAI extends AIBase {
    public static findmove(state: ICephalopodState, plies: number): string {
                const result: IAIResult =  minmax(state, gameRules, evaluate, plies);
        if ( (result === undefined) || (! result.hasOwnProperty("bestMove")) || (result.bestMove === undefined) || (result.bestMove === null) ) {
            throw new Error("No best move found. This should never happen.");
        }
        return result.bestMove;
    }
}