import { AccastaGame, IAccastaState } from "../games";
import {minmax} from 'minmax-wt-alpha-beta-pruning';
import { AIBase } from "./_base";
import { IAIResult } from ".";
import { shuffle } from "../common";

const gameRules = {
    listMoves (state: IAccastaState): string[] {
        const g = new AccastaGame(state);
        return shuffle(g.moves());
    },
    nextState (state: IAccastaState, move: string): IAccastaState {
        const g = new AccastaGame(state);
        g.move(move);
        return g.state();
    },
    terminalStateEval (state: IAccastaState): number|null {
        const g = new AccastaGame(state);
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

const castles = [["a1", "a2", "a3", "a4", "b2", "b3", "b4", "c3", "c4"], ["g1", "g2", "g3", "g4", "f2", "f3", "f4", "e3", "e4"]];

export class AccastaAI extends AIBase {
    /**
     * Maximize moves, and highly value castles in enemy territory
     *
     */
    public static evaluate(state: IAccastaState): number {
        const g = new AccastaGame(state);
        let score = 0;
        score += g.moves().length;
        let otherPlayer = 1;
        if (g.currplayer === 1) {
            otherPlayer = 2;
        }
        let count = 0;
        for (const cell of castles[otherPlayer - 1]) {
            const contents = g.board.get(cell);
            if ( (contents !== undefined) && (contents[contents.length - 1][1] === g.currplayer) ) {
                count++;
            }
        }
        score += count * 100;
        return score;
    }

    public static findmove(state: IAccastaState, plies: number): string {
        const result: IAIResult =  minmax(state, gameRules, AccastaAI.evaluate, plies);
        if ( (result === undefined) || (! result.hasOwnProperty("bestMove")) || (result.bestMove === undefined) || (result.bestMove === null) ) {
            throw new Error("No best move found. This should never happen.");
        }
        return result.bestMove;
    }
}