import { HomeworldsGame, IHomeworldsState } from "../games";
import {minmax} from 'minmax-wt-alpha-beta-pruning';
import { AIBase } from "./_base";
import { IAIResult } from ".";

const gameRules = {
    listMoves: (state: IHomeworldsState): string[] => {
        const g = new HomeworldsGame(state);
        return g.moves();
    },
    nextState: (state: IHomeworldsState, move: string): IHomeworldsState => {
        const g = new HomeworldsGame(state);
        g.move(move);
        return g.state();
    },
    terminalStateEval: (state: IHomeworldsState): number|null => {
        const g = new HomeworldsGame(state);
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
 * The only thing the AI cares about is piece superiority.
 * Larger pieces are preferred over smaller ones.
 */
const evaluate = (state: IHomeworldsState): number => {
    let score = 0;
    const wtLge = 2;
    const wtMed = 1.5;
    const wtSm = 1;

    const g = new HomeworldsGame(state);
    // Find all ships you own and add their value to your score
    const myseat = g.player2seat();
    for (const sys of g.systems) {
        for (const ship of sys.ships) {
            if (ship.owner === myseat) {
                switch (ship.size) {
                    case 1:
                        score += ship.size * wtSm;
                        break;
                    case 2:
                        score += ship.size * wtMed;
                        break;
                    case 3:
                        score += ship.size * wtLge;
                        break;
                    default:
                        throw new Error("Unrecognized ship size. This should never happen.");
                }
            }
        }
    }

    return score;
}

export class HomeworldsAI extends AIBase {
    public static findmove(state: IHomeworldsState, plies: number): string {
                const result: IAIResult =  minmax(state, gameRules, evaluate, plies);
        if ( (result === undefined) || (! result.hasOwnProperty("bestMove")) || (result.bestMove === undefined) || (result.bestMove === null) ) {
            throw new Error("No best move found. This should never happen.");
        }
        return result.bestMove;
    }
}