import { OrdoGame, IOrdoState } from "../games";
import {minmax} from 'minmax-wt-alpha-beta-pruning';
import { AIBase } from "./_base";
import { IAIResult } from ".";

const gameRules = {
    listMoves (state: IOrdoState): string[] {
        const g = new OrdoGame(state);
        return g.moves();
    },
    nextState (state: IOrdoState, move: string): IOrdoState {
        const g = new OrdoGame(state);
        g.move(move);
        return g.state();
    },
    terminalStateEval (state: IOrdoState): number|null {
        const g = new OrdoGame(state);
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

export class OrdoAI extends AIBase {
    /**
     * Minimize your average distance to the target row
     *
     */
    public static evaluate(state: IOrdoState): number {
        const g = new OrdoGame(state);
        const targets = [0, 7];
        const target = targets[g.currplayer - 1];
        const maxscore = 7;
        let score = 0;
        const pieces = [...g.board.entries()].filter(e => e[1] === g.currplayer).map(e => OrdoGame.algebraic2coords(e[0]));
        if (pieces.length < 1) { return -Infinity; }
        for (const piece of pieces) {
            score += Math.abs(piece[1] - target)
        }
        score = score / pieces.length;
        return maxscore - score;
    }

    public static findmove(state: IOrdoState, plies: number): string {
        const result: IAIResult =  minmax(state, gameRules, OrdoAI.evaluate, plies);
        if ( (result === undefined) || (! result.hasOwnProperty("bestMove")) || (result.bestMove === undefined) || (result.bestMove === null) ) {
            throw new Error("No best move found. This should never happen.");
        }
        return result.bestMove;
    }
}