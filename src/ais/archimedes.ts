import { ArchimedesGame, IArchimedesState } from "../games";
import {minmax} from 'minmax-wt-alpha-beta-pruning';
import { AIBase } from "./_base";
import { IAIResult } from ".";
import { shuffle } from "../common";

const gameRules = {
    listMoves: (state: IArchimedesState): string[] => {
        const g = new ArchimedesGame(state);
        return shuffle(g.moves()) as string[];
    },
    nextState: (state: IArchimedesState, move: string): IArchimedesState => {
        const g = new ArchimedesGame(state);
        g.move(move);
        return g.state();
    },
    terminalStateEval: (state: IArchimedesState): number|null => {
        const g = new ArchimedesGame(state);
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
 * Minimize your average distance to the home port
 * Also prefer having more pieces than your opponent
 */
const evaluate = (state: IArchimedesState): number => {
    const g = new ArchimedesGame(state);
    const targets = [[0,7], [7,0]];
    const target = targets[g.currplayer - 1];
    const maxscore = 7;
    let score = 0;
    const pieces = [...g.board.entries()].filter(e => e[1] === g.currplayer).map(e => g.algebraic2coords(e[0]));
    for (const piece of pieces) {
        score += Math.sqrt(Math.pow(target[0] - piece[0], 2) + Math.pow(target[1] - piece[1], 2));
    }
    score = score / pieces.length;
    return (maxscore - score) + (pieces.length * 0.5);
}

export class ArchimedesAI extends AIBase {
    public static findmove(state: IArchimedesState, plies: number): string {
                const result: IAIResult =  minmax(state, gameRules, evaluate, plies);
        if ( (result === undefined) || (! result.hasOwnProperty("bestMove")) || (result.bestMove === undefined) || (result.bestMove === null) ) {
            throw new Error("No best move found. This should never happen.");
        }
        return result.bestMove;
    }
}