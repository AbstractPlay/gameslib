import { BlamGame, IBlamState } from "../games";
import {minmax} from 'minmax-wt-alpha-beta-pruning';
import { AIBase } from "./_base";
import { IAIResult } from ".";

const gameRules = {
    listMoves (state: IBlamState): string[] {
        const g = new BlamGame(state);
        return g.moves();
    },
    nextState (state: IBlamState, move: string): IBlamState {
        const g = new BlamGame(state);
        g.move(move);
        return g.state();
    },
    terminalStateEval (state: IBlamState): number|null {
        const g = new BlamGame(state);
        g.checkEOG();
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

export class BlamAI extends AIBase {
    /**
     * The Blam AI prefers first of all having more players than anybody else.
     * After that, it values score, then number of captured pieces.
     */
    public static evaluate(state: IBlamState): number {
        let score = 0;
        const wtPieces = 5; // The number of points extra pieces are worth
        const wtScore = 1;  // The weighting you give the score
        const wtCaps = 0.5; // The weighting you give the number of capped pieces

        const g = new BlamGame(state);
        // Get stash counts for each player
        const stashcounts: number[] = [];
        g.stashes.forEach((v, k) => {
            stashcounts[k - 1] = v.reduce((a, b) => {return a + b;});
        });

        // Calculate piece advantage compared with highest (or next highest) player
        const mystash = stashcounts[g.currplayer - 1];
        delete stashcounts[g.currplayer - 1];
        const maxstash = Math.max(...stashcounts);
        const diff = mystash - maxstash;
        if (Math.abs(diff) > 1) {
            score += (diff * wtPieces)
        }

        score += g.scores[g.currplayer - 1] * wtScore;
        score += g.caps[g.currplayer - 1] * wtCaps;

        return score;
    }

    public static findmove(state: IBlamState, plies: number): string {
        const result: IAIResult =  minmax(state, gameRules, BlamAI.evaluate, plies);
        if ( (result === undefined) || (! result.hasOwnProperty("bestMove")) || (result.bestMove === undefined) || (result.bestMove === null) ) {
            throw new Error("No best move found. This should never happen.");
        }
        return result.bestMove;
    }
}