import { MchessGame, IMchessState } from "../games";
import {minmax} from 'minmax-wt-alpha-beta-pruning';
import { AIBase } from "./_base";
import { IAIResult } from ".";

const gameRules = {
    listMoves: (state: IMchessState): string[] => {
        const g = new MchessGame(state);
        return g.moves();
    },
    nextState: (state: IMchessState, move: string): IMchessState => {
        if (move === undefined) {
            throw new Error("Minmax tried to pass an undefined move. This should never happen.");
        }
        const g = new MchessGame(state);
        g.move(move);
        return g.state();
    },
    terminalStateEval: (state: IMchessState): number|null => {
        const g = new MchessGame(state);
        // g.checkEOG();
        if (! g.gameover) {
            return null;
        } else {
            if (g.winner.includes(g.currplayer)) {
                return Infinity;
            } else {
                return -Infinity;
            }
        }
    }
}

/**
 * Criteria:
 * - Maximize score
 * - If ahead, prioritize shedding pieces, otherwise conserve
 */
const evaluate = (state: IMchessState): number => {
    const wtScore = 2;  // Relative weight of score
    const wtPieces = 1; // Relative weight of piece count
    let score = 0;

    const g = new MchessGame(state);
    let myscore: number;
    let theirscore: number;
    if (g.currplayer === 1) {
        myscore = g.scores[0];
        theirscore = g.scores[1];
    } else {
        myscore = g.scores[1];
        theirscore = g.scores[0];
    }
    score += myscore * wtScore;

    let myrows = ["1", "2", "3", "4"];
    if (g.currplayer === 2) {
        myrows = ["5", "6", "7", "8"];
    }
    let mypieces = 0;
    for (const cell in g.board.keys()) {
        if (myrows.includes(cell.slice(1))) {
            mypieces++;
        }
    }

    if (myscore > theirscore) {
        // Minimize pieces
        // Add total number of pieces divided by owned pieces (smaller percentage gives larger number)
        score += (g.board.size / mypieces) * wtPieces;
    // } else {
    //     // Conserve pieces
    //     // Add owned pieces divided by total pieces (larger percentage gives larger number)
    //     score += (mypieces / g.board.size) * wtPieces;
    }

    return score;
}

export class MchessAI extends AIBase {
    public static findmove(state: IMchessState, plies: number): string {
                const result: IAIResult =  minmax(state, gameRules, evaluate, plies);
        if ( (result === undefined) || (! result.hasOwnProperty("bestMove")) || (result.bestMove === undefined) || (result.bestMove === null) ) {
            throw new Error("No best move found. This should never happen.");
        }
        return result.bestMove;
    }
}