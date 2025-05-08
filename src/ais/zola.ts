import { ZolaGame, IZolaState } from "../games";
import {minmax} from 'minmax-wt-alpha-beta-pruning';
import { AIBase } from "./_base";
import { IAIResult } from ".";
import { shuffle } from "../common";

const gameRules = {
    listMoves: (state: IZolaState): string[] => {
        const g = new ZolaGame(state);
        return shuffle(g.moves()) as string[];
    },
    nextState: (state: IZolaState, move: string): IZolaState => {
        const g = new ZolaGame(state);
        g.move(move);
        return g.state();
    },
    terminalStateEval: (state: IZolaState): number|null => {
        const g = new ZolaGame(state);
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
 * Just count the number of your pieces.
 *
 */
const evaluate = (state: IZolaState): number => {
    const g = new ZolaGame(state);
    const pieces = [...g.board.entries()].filter(e => e[1] === g.currplayer);
    return pieces.length;
}

export class ZolaAI extends AIBase {
    public static findmove(state: IZolaState, plies: number): string {
                const result: IAIResult =  minmax(state, gameRules, evaluate, plies);
        if ( (result === undefined) || (! result.hasOwnProperty("bestMove")) || (result.bestMove === undefined) || (result.bestMove === null) ) {
            throw new Error("No best move found. This should never happen.");
        }
        return result.bestMove;
    }
}