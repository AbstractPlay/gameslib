import { CannonGame, ICannonState } from "../games";
import {minmax} from 'minmax-wt-alpha-beta-pruning';
import { AIBase } from "./_base";
import { IAIResult } from ".";

const gameRules = {
    listMoves (state: ICannonState): string[] {
        const g = new CannonGame(state);
        return g.moves();
    },
    nextState (state: ICannonState, move: string): ICannonState {
        const g = new CannonGame(state);
        g.move(move);
        return g.state();
    },
    terminalStateEval (state: ICannonState): number|null {
        const g = new CannonGame(state);
        g.checkEOG();
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

export class CannonAI extends AIBase {

    /**
     * Criteria:
     *   - Minimize distance to the enemy town.
     *   - Maximize piece advantage
     */
    public static evaluate(state: ICannonState): number {
        const wtDistAvg = 1;        // Relative weight of distance
        const wtDistClosest = 3;    // Relative weight of closest piece
        const wtPieces = 1;         // Relative weight of piece advantage
        const g = new CannonGame(state);

        // Have no opinion about town placement
        if (! g.placed) {
            return 1;
        }

        let score = 0;
        // Get useful board information
        const myPieces: string[] = [];
        const theirPieces: string[] = [];
        let town: string = "";
        g.board.forEach((v, k) => {
            if (v[0] === g.currplayer) {
                if (v[1] === "s") {
                    myPieces.push(k);
                }
            } else {
                if (v[1] === "t") {
                    town = k;
                } else {
                    theirPieces.push(k);
                }
            }
        });

        // Calculate average distance
        const target = CannonGame.algebraic2coords(town);
        const coords = myPieces.map((cell) => { return CannonGame.algebraic2coords(cell); });
        const dists = coords.map((xy) => { return Math.abs(xy[0] - target[0]) + Math.abs(xy[1] - target[1]); });
        const distTotal = dists.reduce((a, b) => {return a + b;});
        const distAvg = distTotal / myPieces.length;
        score += distAvg * wtDistAvg;

        // Add the single closest piece
        // 18 is the furthest possible distance (opposite corners)
        score += (18 / Math.min(...dists)) * wtDistClosest;

        // Calculate piece advantage
        score += (myPieces.length - theirPieces.length) * wtPieces;

        return score;
    }

    public static findmove(state: ICannonState, plies: number): string {
        const result: IAIResult =  minmax(state, gameRules, CannonAI.evaluate, plies);
        if ( (result === undefined) || (! result.hasOwnProperty("bestMove")) || (result.bestMove === undefined) || (result.bestMove === null) ) {
            throw new Error("No best move found. This should never happen.");
        }
        return result.bestMove;
    }
}