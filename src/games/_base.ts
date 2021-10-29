import { APGamesInformation } from '../schemas/gameinfo';
import { APRenderRep } from "@abstractplay/renderer/src/schema";
import { APMoveResult } from '../schemas/moveresults';
import { APGameRecord } from "@abstractplay/recranks/src";
import { replacer } from '../common/serialization';

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
    variants: string[];
    gameover: boolean;
    winner: number[];
    stack: Array<IIndividualState>;
}

interface IPlayerDetails {
    name: string;
    uid: string;
    isai: boolean;
}

/**
 * To generate a game record, the game needs certain details from the API server.
 * This interface defines what that data is.
 *
 * @export
 * @interface IRecordDetails
 */
export interface IRecordDetails {
    uid: string;                // The game's unique ID
    players: IPlayerDetails[];  // Information about each player, in play order
    dateStart: Date;            // Date the game started
    dateEnd: Date;              // Date the game ended
    unrated: boolean;           // Whether or not the game is explicitly flagged as unrated
    event?: string;             // Optional event name this game is part of
    round?: string;             // Optional round identifier within the event
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

    public abstract stack: Array<IIndividualState>;
    public abstract gameover: boolean;
    public abstract numplayers: number;
    public abstract winner: any[];
    public abstract results: Array<APMoveResult>;
    public abstract variants: string[];

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

    public status(): string {
        if (this.gameover) {
            return `**GAME OVER**\n\nWinner: ${this.winner}\n\n`;
        }
        return "";
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

    public moveHistoryWithSequence(): [number, string][][] {
        const moves: [number, string][][] = [];
        for (let i = 1; i < this.stack.length; i += this.numplayers) {
            const round: [number, string][] = [];
            for (let j = 0; j < this.numplayers; j++) {
                const idx = i + j;
                if (idx >= this.stack.length) {
                    break;
                }
                const state = this.stack[idx];
                if (! state.hasOwnProperty("lastmove")) {
                    throw new Error("No `lastmove` property found.");
                }
                const prevState = this.stack[idx - 1];
                if (! prevState.hasOwnProperty("currplayer")) {
                    throw new Error("You can't produce a move list with sequence numbers unless `currplayer` is defined in the move's state.");
                }
                round.push([prevState.currplayer, state.lastmove]);
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

    protected getVariants(): string[] | undefined {
        return undefined;
    }

    protected getPlayerScore(player: number): number | undefined {
        return undefined;
    }

    protected getPlayerResult(player: number): number | undefined {
        if (! this.gameover) {
            return undefined;
        }
        if (this.winner!.includes(player)) {
            return 1;
        } else {
            return 0;
        }
    }

    protected getMoveList(): any[] {
        return this.moveHistory();
    }

    protected getMovesAndResults(exclude?: string[]): any[] {
        if (exclude === undefined) {
            exclude = [];
        }
        const moves = this.moveHistory();
        const moveCount = moves.map((x) => { return x.length; }).reduce((a, b) => { return a + b; });
        const results = this.resultsHistory();
        if (moveCount !== results.length) {
            throw new Error(`The list of moves and list of results are not the correct length.\nMoves: ${moveCount}, Results: ${results.length}\First move: ${moves[0]}, First result: ${JSON.stringify(results[0])}\nLast move: ${moves[moves.length - 1]}, Last result: ${JSON.stringify(results[results.length - 1])}`);
        }
        const combined = [];
        for (let i = 0; i < moves.length; i++) {
            const node = [];
            for (let j = 0; j < this.numplayers; j++) {
                if (moves[i].length >= j + 1) {
                    const move = moves[i][j];
                    const result = results[(i * this.numplayers) + j];
                    const filtered = result.filter((obj) => {
                        return ! exclude!.includes(obj.type);
                    });
                    if (filtered.length > 0) {
                        node.push({
                            move,
                            result: filtered
                        });
                    } else {
                        node.push(move);
                    }
                }
            }
            combined.push(node);
        }
        return combined;
    }

    protected getMovesAndResultsWithSequence(exclude?: string[]): any[] {
        if (exclude === undefined) {
            exclude = [];
        }
        const moves = this.moveHistoryWithSequence();
        const moveCount = moves.map((x) => { return x.length; }).reduce((a, b) => { return a + b; });
        const results = this.resultsHistory();
        if (moveCount !== results.length) {
            throw new Error(`The list of moves and list of results are not the correct length.\nMoves: ${moveCount}, Results: ${results.length}\First move: ${moves[0]}, First result: ${JSON.stringify(results[0])}\nLast move: ${moves[moves.length - 1]}, Last result: ${JSON.stringify(results[results.length - 1])}`);
        }
        const combined = [];
        for (let i = 0; i < moves.length; i++) {
            const node = [];
            for (let j = 0; j < this.numplayers; j++) {
                if (moves[i].length >= j + 1) {
                    const move = moves[i][j];
                    const result = results[(i * this.numplayers) + j];
                    const filtered = result.filter((obj) => {
                        return ! exclude!.includes(obj.type);
                    });
                    if (filtered.length > 0) {
                        node.push({
                            sequence: move[0],
                            move: move[1],
                            result: filtered
                        });
                    } else {
                        node.push({
                            sequence: move[0],
                            move: move[1]
                        });
                    }
                }
            }
            combined.push(node);
        }
        return combined;
    }

    public genRecord(data: IRecordDetails): APGameRecord | undefined {
        if (! this.gameover) {
            return undefined;
        }

        const gameinfo = Object.getPrototypeOf(this).constructor.gameinfo as APGamesInformation;
        const rec: APGameRecord = {
            header: {
                game: {
                    name: gameinfo.name,
                    variants: this.getVariants()
                },
                event: data.event,
                round: data.round,
                site: {
                    name: "Abstract Play",
                    gameid: data.uid
                },
                "date-start": data.dateStart.toISOString(),
                "date-end": data.dateEnd.toISOString(),
                "date-generated": new Date().toISOString(),
                unrated: data.unrated,
                // @ts-ignore
                players: []
            },
            moves: this.getMoveList()
        };

        for (let i = 0; i < data.players.length; i++) {
            rec.header.players.push({
                name: data.players[i].name,
                userid: data.players[i].uid,
                is_ai: data.players[i].isai,
                score: this.getPlayerScore(i + 1),
                result: this.getPlayerResult(i + 1)!
            });
        }

        return rec;
    }

    public serialize(): string {
        return JSON.stringify(this.state(), replacer);
    }
}
