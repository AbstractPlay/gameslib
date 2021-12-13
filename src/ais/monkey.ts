import { MonkeyQueenGame, IMonkeyQueenState } from "../games";
import {minmax} from 'minmax-wt-alpha-beta-pruning';
import { AIBase } from "./_base";
import { IAIResult } from ".";
import { shuffle } from "../common";

const gameRules = {
    listMoves: (state: IMonkeyQueenState): string[] => {
        const g = new MonkeyQueenGame(state);
        return shuffle(g.moves()) as string[];
    },
    nextState: (state: IMonkeyQueenState, move: string): IMonkeyQueenState => {
        const g = new MonkeyQueenGame(state);
        g.move(move);
        return g.state();
    },
    terminalStateEval: (state: IMonkeyQueenState): number|null => {
        const g = new MonkeyQueenGame(state);
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

const evaluate = (state: IMonkeyQueenState): number => {
    // Simply value having more moves
    const g = new MonkeyQueenGame(state);
    return g.moves().length;
}

export class MonkeyQueenAI extends AIBase {
    public static findmove(state: IMonkeyQueenState, plies: number): string {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const result: IAIResult =  minmax(state, gameRules, evaluate, plies);
        if ( (result === undefined) || (! result.hasOwnProperty("bestMove")) || (result.bestMove === undefined) || (result.bestMove === null) ) {
            throw new Error("No best move found. This should never happen.");
        }
        return result.bestMove;
    }
}