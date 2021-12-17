import { DipoleGame, IDipoleState } from "../games";
import {minmax} from 'minmax-wt-alpha-beta-pruning';
import { AIBase } from "./_base";
import { IAIResult } from ".";
import { shuffle } from "../common";
import { playerid } from "../games/dipole";

const gameRules = {
    listMoves: (state: IDipoleState): string[] => {
        const g = new DipoleGame(state);
        return shuffle(g.moves()) as string[];
    },
    nextState: (state: IDipoleState, move: string): IDipoleState => {
        const g = new DipoleGame(state);
        g.move(move);
        return g.state();
    },
    terminalStateEval: (state: IDipoleState): number|null => {
        const g = new DipoleGame(state);
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
 * Simply maximize your distance
 *
 */
const evaluate = (state: IDipoleState): number => {
    const g = new DipoleGame(state);
    let other = 2;
    if (g.currplayer === 2) {
        other = 1;
    }
    const mydist = g.totalDist(g.currplayer);
    const otherdist = g.totalDist(other as playerid);
    return mydist - otherdist;
}

export class DipoleAI extends AIBase {
    public static findmove(state: IDipoleState, plies: number): string {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const result: IAIResult =  minmax(state, gameRules, evaluate, plies);
        if ( (result === undefined) || (! result.hasOwnProperty("bestMove")) || (result.bestMove === undefined) || (result.bestMove === null) ) {
            throw new Error("No best move found. This should never happen.");
        }
        return result.bestMove;
    }
}