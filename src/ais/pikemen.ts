import { PikemenGame, IPikemenState } from "../games";
import {minmax} from 'minmax-wt-alpha-beta-pruning';
import { AIBase } from "./_base";
import { IAIResult } from ".";
import { shuffle } from "../common";

const gameRules = {
    listMoves: (state: IPikemenState): string[] => {
        const g = new PikemenGame(state);
        return shuffle(g.moves()) as string[];
    },
    nextState: (state: IPikemenState, move: string): IPikemenState => {
        const g = new PikemenGame(state);
        g.move(move);
        return g.state();
    },
    terminalStateEval: (state: IPikemenState): number|null => {
        const g = new PikemenGame(state);
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
const evaluate = (state: IPikemenState): number => {
    const g = new PikemenGame(state);
    return g.getPlayerScore(g.currplayer)
}

export class PikemenAI extends AIBase {
    public static findmove(state: IPikemenState, plies: number): string {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const result: IAIResult =  minmax(state, gameRules, evaluate, plies);
        if ( (result === undefined) || (! result.hasOwnProperty("bestMove")) || (result.bestMove === undefined) || (result.bestMove === null) ) {
            throw new Error("No best move found. This should never happen.");
        }
        return result.bestMove;
    }
}