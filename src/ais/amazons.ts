import { AmazonsGame, IAmazonsState } from "../games";
import {minmax} from 'minmax-wt-alpha-beta-pruning';
import { AIBase } from "./_base";
import { IAIResult } from ".";

const gameRules = {
    listMoves: (state: IAmazonsState): string[] => {
        const g = new AmazonsGame(state);
        return g.moves();
    },
    nextState: (state: IAmazonsState, move: string): IAmazonsState => {
        const g = new AmazonsGame(state);
        g.move(move);
        return g.state();
    },
    terminalStateEval: (state: IAmazonsState): number|null => {
        const g = new AmazonsGame(state);
        if (g.moves().length > 0) {
            return null;
        } else {
            return -Infinity;
        }
    }
}

const evaluate = (state: IAmazonsState): number => {
    const g = new AmazonsGame(state);
    if (g.currplayer === 1) {
        return g.moves(1).length;
    } else {
        return g.moves(2).length;
    }
}

export class AmazonsAI extends AIBase {
    public static findmove(state: IAmazonsState, plies: number): string {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const result: IAIResult =  minmax(state, gameRules, evaluate, plies);
        if ( (result === undefined) || (! result.hasOwnProperty("bestMove")) || (result.bestMove === undefined) || (result.bestMove === null) ) {
            throw new Error("No best move found. This should never happen.");
        }
        return result.bestMove;
    }
}