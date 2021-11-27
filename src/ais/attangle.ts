import { AttangleGame, IAttangleState } from "../games";
import {minmax} from 'minmax-wt-alpha-beta-pruning';
import { AIBase } from "./_base";
import { IAIResult } from ".";
import { shuffle } from "../common";

const gameRules = {
    listMoves: (state: IAttangleState): string[] => {
        const g = new AttangleGame(state);
        return shuffle(g.moves()) as string[];
    },
    nextState: (state: IAttangleState, move: string): IAttangleState => {
        const g = new AttangleGame(state);
        g.move(move);
        return g.state();
    },
    terminalStateEval: (state: IAttangleState): number|null => {
        const g = new AttangleGame(state);
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
 * Double stacks + triples * 5
 *
 */
const evaluate = (state: IAttangleState): number => {
    const g = new AttangleGame(state);
    const doubles = [...g.board.entries()].filter(e => (e[1].length === 2) && (e[1][e[1].length - 1] === g.currplayer));
    const triples = [...g.board.entries()].filter(e => (e[1].length === 3) && (e[1][e[1].length - 1] === g.currplayer));
    return doubles.length + (triples.length * 5);
}

export class AttangleAI extends AIBase {
    public static findmove(state: IAttangleState, plies: number): string {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const result: IAIResult =  minmax(state, gameRules, evaluate, plies);
        if ( (result === undefined) || (! result.hasOwnProperty("bestMove")) || (result.bestMove === undefined) || (result.bestMove === null) ) {
            throw new Error("No best move found. This should never happen.");
        }
        return result.bestMove;
    }
}