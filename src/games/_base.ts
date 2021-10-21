import { APGamesInformation } from '../schemas/gameinfo';
import { APRenderRep } from "@abstractplay/renderer/src/schema";
import { APMoveResult } from '../schemas/moveresults';

const columnLabels = "abcdefghijklmnopqrstuvwxyz".split("");

/**
 * The minimum requirements of the individual game states.
 *   - Must include the version ID of when it was generated
 *   - A structured description of what changed in the game state
 *
 * @export
 * @interface IIndividualState
 */
export interface IIndividualState {
    _version: string;
    _results: APMoveResult[];
    [key: string]: any;
}

/**
 * All game states must have the same basic shape:
 *   - The name of the game the state represents (the UID from APGamesInformation)
 *   - The number of players
 *   - Any variants
 *   - And an indication of whether the game is over and who won
 *   - A stack of individual states after each turn (free form, but must include the version identifier of when it was generated)
 *
 * @export
 * @interface IBaseGameState
 */
export interface IAPGameState {
    game: string;
    numplayers: number;
    variants?: string[];
    gameover: boolean;
    winner: number[];
    stack: Array<IIndividualState>;
}

export abstract class GameBase  {
    public static readonly gameinfo: APGamesInformation;
    public static info(): string {
        return JSON.stringify(this.gameinfo)
    }
    public static coords2algebraic(x: number, y: number, height: number): string {
        return columnLabels[x] + (height - y).toString();
    }

    public static algebraic2coords(cell: string, height: number): [number, number] {
        const pair: string[] = cell.split("");
        const num = (pair.slice(1)).join("");
        const x = columnLabels.indexOf(pair[0]);
        if ( (x === undefined) || (x < 0) ) {
            throw new Error(`The column label is invalid: ${pair[0]}`);
        }
        const y = parseInt(num, 10);
        if ( (y === undefined) || (isNaN(y)) ) {
            throw new Error(`The row label is invalid: ${pair[1]}`);
        }
        return [x, height - y];
    }

    public status(): string {
        return "";
    }

    public abstract stack: Array<IIndividualState>;
    public abstract gameover: boolean;
    public abstract numplayers: number;
    public abstract winner?: any[];
    public abstract results: Array<APMoveResult>;

    public abstract move(move: string): GameBase;
    public abstract render(): APRenderRep;
    public abstract state(): IAPGameState;
    public abstract load(idx: number): GameBase;
    public abstract resign(player: number): GameBase;
    protected abstract moveState(): any;

    protected saveState(): void {
        this.stack.push(this.moveState());
    }

    public undo(): GameBase {
        if (this.stack.length < 1) {
            throw new Error("You can't undo the initial game state");
        }
        this.stack.pop();
        return this;
    }

    public moveHistory(): string[][] {
        const moves: string[][] = [];
        for (let i = 1; i < this.stack.length; i += this.numplayers) {
            const round: string[] = [];
            for (let j = 0; j < this.numplayers; j++) {
                const idx = i + j;
                if (idx >= this.stack.length) {
                    break;
                }
                const state = this.stack[idx];
                if (! state.hasOwnProperty("lastmove")) {
                    throw new Error("No `lastmove` property found.");
                }
                round.push(state.lastmove);
            }
            moves.push(round);
        }
        return moves;
    }

    public resultsHistory(): APMoveResult[][] {
        const hist: APMoveResult[][] = [];
        for (const state of this.stack) {
            if ( (state._results !== undefined) && (state._results.length > 0) ) {
                hist.push([...state._results]);
            }
        }
        return hist;
    }
}
