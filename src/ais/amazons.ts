import { AmazonsGame, IAmazonsState } from "../games";
import {minmax} from 'minmax-wt-alpha-beta-pruning';
import { AIBase } from "./_base";

const gameRules = {
    listMoves (state: IAmazonsState): string[] {
        const g = new AmazonsGame(state);
        return g.moves();
    },
    nextState (state: IAmazonsState, move: string): IAmazonsState {
        const g = new AmazonsGame(state);
        g.move(move);
        return g.state();
    },
    terminalStateEval (state: IAmazonsState): number|null {
        const g = new AmazonsGame(state);
        if (g.moves().length > 0) {
            return null;
        } else {
            return -Infinity;
        }
    }
}

interface IAIResult {
    bestMove: string|null;
    evaluation: number;
}

export class AmazonsAI extends AIBase {
    public static evaluate(state: IAmazonsState): number {
        const g = new AmazonsGame(state);
        const m1 = g.moves(1);
        const m2 = g.moves(2);
        if (g.currplayer === 1) {
            return m1.length - m2.length;
        } else {
            return m2.length - m1.length;
        }
    }

    public static findmove(state: IAmazonsState, plies: number): string {
        const result: IAIResult =  minmax(state, gameRules, AmazonsAI.evaluate, plies);
        if ( (result === undefined) || (! result.hasOwnProperty("bestMove")) || (result.bestMove === undefined) || (result.bestMove === null) ) {
            throw new Error("No best move found. This should never happen.");
        }
        return result.bestMove;
    }
}