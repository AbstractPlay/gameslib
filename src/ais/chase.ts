import { ChaseGame, IChaseState } from "../games";
import {minmax} from 'minmax-wt-alpha-beta-pruning';
import { AIBase } from "./_base";
import { IAIResult } from ".";
import { shuffle } from "../common";

const gameRules = {
    listMoves: (state: IChaseState): string[] => {
        const g = new ChaseGame(state);
        return shuffle(g.moves()) as string[];
    },
    nextState: (state: IChaseState, move: string): IChaseState => {
        const g = new ChaseGame(state);
        g.move(move);
        return g.state();
    },
    terminalStateEval: (state: IChaseState): number|null => {
        const g = new ChaseGame(state);
        if (g.moves().length > 0) {
            return null;
        } else {
            return -Infinity;
        }
    }
}

const evaluate = (state: IChaseState): number => {
    // Value smaller pieces over larger
    const g = new ChaseGame(state);
    return [...g.board.values()].filter(p => p[0] === g.currplayer).map(p => 7 - p[1]).reduce((a, b) => a + b);
}

export class ChaseAI extends AIBase {
    public static findmove(state: IChaseState, plies: number): string {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const result: IAIResult =  minmax(state, gameRules, evaluate, plies);
        if ( (result === undefined) || (! result.hasOwnProperty("bestMove")) || (result.bestMove === undefined) || (result.bestMove === null) ) {
            throw new Error("No best move found. This should never happen.");
        }
        return result.bestMove;
    }
}