import { LinesOfActionGame, ILinesOfActionState } from "../games";
import {minmax} from 'minmax-wt-alpha-beta-pruning';
import { AIBase } from "./_base";
import { IAIResult } from ".";

const gameRules = {
    listMoves: (state: ILinesOfActionState): string[] => {
        const g = new LinesOfActionGame(state);
        return g.moves();
    },
    nextState: (state: ILinesOfActionState, move: string): ILinesOfActionState => {
        const g = new LinesOfActionGame(state);
        g.move(move);
        return g.state();
    },
    terminalStateEval: (state: ILinesOfActionState): number|null => {
        const g = new LinesOfActionGame(state);
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
                return 500;
            }
        } else {
            return -Infinity;
        }
    }
}

/**
 * Minimize each piece's distance from its nearest neighbour
 *
 */
const evaluate = (state: ILinesOfActionState): number => {
    const g = new LinesOfActionGame(state);
    const maxscore = 9 * 14;
    let score = 0;
    const pieces = [...g.board.entries()].filter(e => e[1] === g.currplayer).map(e => LinesOfActionGame.algebraic2coords(e[0], g.boardsize));
    for (let i = 0; i < pieces.length; i++) {
        const cell = pieces[i];
        const rest = [...pieces];
        rest.splice(i, 1);
        const distances: number[] = [];
        for (const rCell of rest) {
            distances.push(Math.max(Math.abs(cell[0] - rCell[0]), Math.abs(cell[1] - rCell[1])));
        }
        score += Math.min(...distances);
    }
    return maxscore - score;
}

export class LinesOfActionAI extends AIBase {
    public static findmove(state: ILinesOfActionState, plies: number): string {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const result: IAIResult =  minmax(state, gameRules, evaluate, plies);
        if ( (result === undefined) || (! result.hasOwnProperty("bestMove")) || (result.bestMove === undefined) || (result.bestMove === null) ) {
            throw new Error("No best move found. This should never happen.");
        }
        return result.bestMove;
    }
}