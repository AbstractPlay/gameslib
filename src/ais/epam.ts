import { EpamGame, IEpamState } from "../games";
import {minmax} from 'minmax-wt-alpha-beta-pruning';
import { AIBase } from "./_base";
import { IAIResult } from ".";
import { shuffle } from "../common";

const gameRules = {
    listMoves: (state: IEpamState): string[] => {
        const g = new EpamGame(state);
        return shuffle(g.moves()) as string[];
    },
    nextState: (state: IEpamState, move: string): IEpamState => {
        const g = new EpamGame(state);
        g.move(move);
        return g.state();
    },
    terminalStateEval: (state: IEpamState): number|null => {
        const g = new EpamGame(state);
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
 * Minimize your average distance to the target row
 *
 */
const evaluate = (state: IEpamState): number => {
    const g = new EpamGame(state);
    const targets = [0, 11];
    const target = targets[g.currplayer - 1];
    const maxscore = 11;
    let score = 0;
    const pieces = [...g.board.entries()].filter(e => e[1] === g.currplayer).map(e => EpamGame.algebraic2coords(e[0]));
    if (pieces.length < 1) { return -Infinity; }
    for (const piece of pieces) {
        score += Math.abs(piece[1] - target)
    }
    score = score / pieces.length;
    return maxscore - score;
}

export class EpamAI extends AIBase {
    public static findmove(state: IEpamState, plies: number): string {
                const result: IAIResult =  minmax(state, gameRules, evaluate, plies);
        if ( (result === undefined) || (! result.hasOwnProperty("bestMove")) || (result.bestMove === undefined) || (result.bestMove === null) ) {
            throw new Error("No best move found. This should never happen.");
        }
        return result.bestMove;
    }
}