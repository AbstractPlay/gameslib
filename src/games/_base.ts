/* eslint-disable max-classes-per-file */
import { APGamesInformation, AlternativeDisplay, Variant } from '../schemas/gameinfo';
import { APRenderRep, Glyph } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from '../schemas/moveresults';
import { APGameRecord } from "@abstractplay/recranks/src";
import { algebraic2coords, coords2algebraic, replacer, sortingReplacer, UserFacingError } from '../common';
import { omit } from "lodash";
import i18next from "i18next";
import JSDstringify from 'json-stringify-deterministic';

/**
 * The minimum requirements of the individual game states.
 * - Must include the version ID of the code that generated the state
 * - A structured description of what changed in the game state
 * - A timestamp of when the move was made (server time)
 *
 * @export
 * @interface IIndividualState
 */
export interface IIndividualState {
    _version: string;
    _results: APMoveResult[];
    _timestamp: Date;
    [key: string]: any;
}

/**
 * Key value pair for the UI to display arbitrary status information
 *
 * @export
 * @interface IStatus
 */
export interface IStatus {
    key: string;
    value: (string | Glyph)[];
}

/**
 * Represents an entry in a player (or shared) stash of player pieces.
 *
 * @export
 * @interface IStashEntry
 */
export interface IStashEntry {
    count: number,
    glyph: Glyph,
    movePart: string
}

/**
 * Represents a set of scores for the players.
 *
 * @export
 * @interface IScores
 */
 export interface IScores {
    name: string;
    scores: (number | string)[];
    spoiler?: boolean;
}

/**
 * For use with games flagged as `custom-buttons`.
 * The `getButtons()` function returns a list of this type.
 *
 * @export
 * @interface ICustomButton
 */
export interface ICustomButton {
    // key to translatable string (translation lives in front end)
    label: string;
    // the string to pass to the game engine as a move
    move: string;
}

/**
 * All game states must have the same basic shape:
 * - The name of the game the state represents (the UID from APGamesInformation)
 * - The number of players
 * - Any variants
 * - And an indication of whether the game is over and who won
 * - A stack of individual states after each turn (free form, but must include the version identifier of when it was generated)
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

/**
 * Describes the options that can be passed to the `render()` function.
 * Sometimes, you need to explicitly pass options to this function because
 * you can't pass an object affected by a partial move (e.g., scrollBar feature).
 *
 * @export
 * @interface IAPRenderOpts
 */
export interface IRenderOpts {
    perspective?: number;
    altDisplay?: string;
    hideLayer?: number;
}

/**
 * valid: A simple boolean that tells you whether the move to this point is valid, even if only partially so.
 * See `message` for details.
 * message: A localized message that explains the state of the move at this point.
 * complete?: This describes how the game engine currently views the returned move's completeness:
 * It is only present if `valid` is true.
 * - 1 means the move is recognized as wholly complete. No further interaction by the user could
 * reasonably be expected (other than starting over). Implies `canrender`.
 * - -1 means the move is definitively incomplete and would be rejected if submitted as is.
 * - 0 is in between. It signals that the move *could* be processed as is, but it indicates that
 * other moves may still be possible.
 * canrender?: A simple boolean that will only ever be present if `valid` is true. It asserts that
 * the move to this point would be accepted by the game engine as partial and would result in an
 * updated `APRenderRep` that may be helpful to the user.
 *
 * @export
 * @interface IValidationResult
 */
 export interface IValidationResult {
    valid: boolean;
    message: string;
    complete?: -1|0|1;   // implies canrender
    canrender?: boolean; // implies valid
}

/**
 * Superset of IValidationResult. Used to pass information when you can't trust that the
 * receiver will pass the resulting object itself. Used by the scrollBar feature and likely
 * other future needs.
 *
 * move: The new result that should be placed in the move entry area
 * opts: Container object that can be passed directly to the `render()` function.
 *
 * @export
 * @interface IClickResult
 */
export interface IClickResult extends IValidationResult {
    move: string;
    opts?: IRenderOpts;
}

interface IPlayerDetails {
    name: string;
    uid: string;
    isai?: boolean;
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
    dateStart?: Date;           // Date the game started
    dateEnd?: Date;             // Date the game ended
    unrated?: boolean;          // Whether or not the game is explicitly flagged as unrated
    event?: string;             // Optional event name this game is part of
    round?: string;             // Optional round identifier within the event
    pied?: boolean;             // Optional indicator of whether the pie rule was invoked
}

export interface IMoveOptions {partial?: boolean; trusted?: boolean};

export abstract class GameBase  {
    public static readonly gameinfo: APGamesInformation;
    public description(): string {
        const ctor = this.constructor as typeof GameBase;
        return i18next.t(ctor.gameinfo.description!);
    }
    public notes(): string|undefined {
        const ctor = this.constructor as typeof GameBase;
        if (ctor.gameinfo.notes !== undefined) {
            return i18next.t(ctor.gameinfo.notes);
        }
        return undefined;
    }
    public allvariants(): Variant[] | undefined {
        const ctor = this.constructor as typeof GameBase;
        return ctor.gameinfo.variants?.map(v => {return {
            "uid": v.uid,
            "name": i18next.t(`apgames:variants.${ctor.gameinfo.uid}.${v.uid}.name`),
            "description": i18next.exists(`apgames:variants.${ctor.gameinfo.uid}.${v.uid}.description`) ? i18next.t(`apgames:variants.${ctor.gameinfo.uid}.${v.uid}.description`) : undefined,
            "group": v.group,
            "experimental": v.experimental,
        }});
    }
    public describeVariantGroupDefaults(grp: string): {name?: string; description?: string} {
        const ctor = this.constructor as typeof GameBase;
        const nameStr = `variantGroups.${ctor.gameinfo.uid}.${grp}.name`;
        let name: string|undefined = i18next.t(`apgames:${nameStr}`);
        if (name === nameStr) {
            name = undefined;
        }
        const descStr = `variantGroups.${ctor.gameinfo.uid}.${grp}.description`;
        let description: string|undefined = i18next.t(`apgames:${descStr}`);
        if (description === descStr) {
            description = undefined;
        }
        return {
            name,
            description,
        }
    }
    public alternativeDisplays(): AlternativeDisplay[] | undefined {
        const ctor = this.constructor as typeof GameBase;
        return ctor.gameinfo.displays?.map(v => {return {
            "uid": v.uid,
            "name": i18next.t(`apgames:displays.${ctor.gameinfo.uid}.${v.uid}.name`),
            "description": i18next.t(`apgames:displays.${ctor.gameinfo.uid}.${v.uid}.description`)
        }});
    }
    public static info(): string {
        return JSON.stringify(this.gameinfo);
    }
    public static coords2algebraic(x: number, y: number, height: number): string {
        return coords2algebraic(x, y, height);
    }

    public static algebraic2coords(cell: string, height: number): [number, number] {
        return algebraic2coords(cell, height);
    }

    public abstract stack: Array<IIndividualState>;
    public lastmove?: string;
    public abstract gameover: boolean;
    public abstract numplayers: number;
    public abstract winner: number[];
    public abstract results: Array<APMoveResult>;
    public abstract variants: string[];
    public abstract currplayer: number|undefined;

    public abstract move(move: string, opts?: IMoveOptions): GameBase;
    public abstract render(opts: IRenderOpts): APRenderRep;
    public abstract state(): IAPGameState;
    public abstract load(idx: number): GameBase;
    public abstract clone(): GameBase;
    protected abstract moveState(): any;

    public resign(player: number): GameBase {
        return this.eog(player, "resign", {type: "resigned", player});
    }

    public timeout(player: number): GameBase {
        return this.eog(player, "timeout", {type: "timeout", player});
    }

    public draw(): GameBase {
        return this.eog(-1, "draw", {type: "drawagreed"});
    }

    public abandoned(): GameBase {
        return this.eog(-1, "abandoned", {type: "gameabandoned"});
    }

    protected specialMove(move: string): boolean {
        return move === "resign" || move === "draw" || move === "timeout" || move === "abandoned";
    }

    private eog(player: number, move: string, result: APMoveResult): GameBase {
        this.results = [result]
        // If one person resigns, the others win together
        this.gameover = true;
        this.lastmove = move;
        this.results.push({type: "eog"});
        const winners: number[] = [];
        const resigner: string[] = [];
        let found = false;
        const ctor = this.constructor as typeof GameBase;
        for (let n = 1; n <= this.numplayers; n++) {
            if (n !== player) {
                if (result.type !== "gameabandoned")
                    winners.push(n);
                resigner.push('');
            } else {
                found = true;
                resigner.push(move);
            }
        }
        if (!found && player !== -1) {
            throw new Error("eog: No such player");
        }
        if (ctor.gameinfo.flags !== undefined && ctor.gameinfo.flags.includes('simultaneous')) {
            this.lastmove = resigner.join(',');
        } else {
            this.lastmove = move;
        }
        this.winner = [...winners];
        this.results.push({type: "winners", players: [...this.winner]});
        this.saveState();
        return this;
    }

    protected saveState(): void {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        this.stack.push(this.moveState());
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        return {
            move,
            valid: false,
            message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")
        };
    }

    public undo(): GameBase {
        if (this.stack.length < 1) {
            throw new UserFacingError("INITIAL_UNDO", i18next.t("apgames:INITIAL_UNDO"));
        }
        this.stack.pop();
        return this;
    }

    public status(): string {
        if (this.gameover) {
            return `**GAME OVER**\n\nWinner: ${this.winner.join(", ")}\n\n`;
        }
        return "";
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public statuses(isPartial: boolean, partialMove: string): IStatus[] {
        return [] as IStatus[];
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
                round.push(state.lastmove as string);
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
                round.push([prevState.currplayer as number, state.lastmove as string]);
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

    public getVariants(): string[] | undefined {
        if ( (this.variants === undefined) || (this.variants.length === 0) ) {
            return undefined;
        }
        const vars: string[] = [];
        const possibleVariants = this.allvariants();
        if (possibleVariants !== undefined) {
            for (const v of this.variants) {
                for (const rec of possibleVariants) {
                    if (v === rec.uid) {
                        vars.push(rec.name ?? v);
                        break;
                    }
                }
            }
        }
        return vars;
    }

    public getStartingPosition(): string {
        return "";
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public getPlayerScore(player: number): number | undefined {
        return undefined;
    }

    protected getPlayerResult(player: number): number | undefined {
        if (! this.gameover) {
            return undefined;
        }
        if (this.winner.includes(player)) {
            return 1;
        } else {
            return 0;
        }
    }

    protected getMoveList(): any[] {
        return this.moveHistory();
    }

    // Check whether two moves with potentially different string representations are actually the same move.
    // For many games you can override this with just: return move1.toLowerCase().replace(/\s+/g, "") === move2.toLowerCase().replace(/\s+/g, "");
    protected sameMove(move1: string, move2: string): boolean {
        move1 = move1.toLowerCase().replace(/\s+/g, "");
        if (move1 === move2.toLowerCase().replace(/\s+/g, ""))
            return true;
        if (this.specialMove(move1) || this.specialMove(move2))
            return false;
        if (this.lastmove?.toLowerCase().replace(/\s+/g, "") !== move1) {
            throw new Error(`To compare moves the current state must be the one after move1 was made ${move1} !== ${this.lastmove}`);
        }
        const cloned: GameBase = this.clone();
        cloned.stack.pop();
        cloned.load(-1);
        cloned.gameover = false;
        cloned.winner = [];
        cloned.move(move2, {trusted: true});
        const currPosition1 = omit(this.moveState(), ["lastmove", "_version", "_results", "_timestamp"]);
        const currPosition2 = omit(cloned.moveState(), ["lastmove", "_version", "_results", "_timestamp"]);
        const s1 = JSON.stringify(currPosition1, sortingReplacer);
        const s2 = JSON.stringify(currPosition2, sortingReplacer);
        return s1 === s2;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        return false;
    }

    public chatLog(players: string[]): string[][] {
        const result: string[][] = [];
        for (const state of this.stack) {
            if ( (state._results !== undefined) && (state._results.length > 0) ) {
                const node: string[] = [(state._timestamp && new Date(state._timestamp).toISOString()) || "unknown"];
                let otherPlayer = state.currplayer as number - 1;
                if (otherPlayer < 1) {
                    otherPlayer = this.numplayers;
                }
                let name = `Player ${otherPlayer}`;
                if (otherPlayer <= players.length) {
                    name = players[otherPlayer - 1];
                }
                for (const r of state._results) {
                    if (!this.chat(node, name, state._results, r)) {
                        switch (r.type) {
                            case "move":
                                if (r.what === undefined) {
                                    node.push(i18next.t("apresults:MOVE.nowhat", {player: name, from: r.from, to: r.to}));
                                } else {
                                    node.push(i18next.t("apresults:MOVE.complete", {player: name, what: r.what, from: r.from, to: r.to}));
                                }
                                break;
                            case "place":
                                if (r.what === undefined) {
                                    node.push(i18next.t("apresults:PLACE.nowhat", {player: name, where: r.where}));
                                } else {
                                    node.push(i18next.t("apresults:PLACE.complete", {player: name, what: r.what, where: r.where}));
                                }
                                break;
                            case "pass":
                                node.push(i18next.t("apresults:PASS.simple", {player: name}));
                                break;
                            case "button":
                                node.push(i18next.t("apresults:BUTTON", {player: name}));
                                break;
                            case "komi":
                                node.push(i18next.t("apresults:KOMI", {player: name, value: r.value}));
                                break;
                            case "flip":
                                node.push(i18next.t("apresults:FLIP", {player: name, where: r.where, revealed: r.revealed}));
                                break;
                            case "reclaim":
                                node.push(i18next.t("apresults:RECLAIM.noperson", {what: r.what}));
                                break;
                            case "capture":
                                if (r.where === undefined) {
                                    if (r.what === undefined) {
                                        node.push(i18next.t("apresults:CAPTURE.minimal"));
                                    } else {
                                        node.push(i18next.t("apresults:CAPTURE.noperson.nowhere", {what: r.what}));
                                    }
                                } else {
                                    if (r.what === undefined) {
                                        node.push(i18next.t("apresults:CAPTURE.noperson.nowhat", {where: r.where}));
                                    } else {
                                        node.push(i18next.t("apresults:CAPTURE.noperson.simple", {what: r.what, where: r.where}));
                                    }
                                }
                                break;
                            case "bearoff":
                                node.push(i18next.t("apresults:BEAROFF.complete", {count: parseInt(r.what!, 10), player: name, from: r.from}));
                                break;
                            case "promote":
                                node.push(i18next.t("apresults:PROMOTE.mchess", {into: r.to}));
                                break;
                            case "orient":
                                node.push(i18next.t("apresults:ORIENT.nowhat", {player: name, facing: r.facing, where: r.where}));
                                break;
                            case "add":
                                if (r.num === undefined) {
                                    node.push(i18next.t("apresults:ADD.nonum", { player: name, where: r.where }));
                                } else {
                                    node.push(i18next.t("apresults:ADD.add", { count: r.num , player: name, where: r.where }));
                                }
                                break;
                            case "remove":
                                if (r.num === undefined) {
                                    node.push(i18next.t("apresults:REMOVE.nonum", { count: r.num , player: name, where: r.where }));
                                } else {
                                    node.push(i18next.t("apresults:REMOVE.remove", { count: r.num , player: name, where: r.where }));
                                }
                                break;
                            case "claim":
                                node.push(i18next.t("apresults:CLAIM.default", {player: name, where: r.where }));
                                break;
                            case "eog":
                                node.push(i18next.t("apresults:EOG.default"));
                                break;
                            case "resigned":
                                let rname = `Player ${r.player}`;
                                if (r.player <= players.length) {
                                    rname = players[r.player - 1]
                                }
                                node.push(i18next.t("apresults:RESIGN", {player: rname}));
                                break;
                            case "timeout":
                                let tname = `Player ${r.player}`;
                                if (r.player <= players.length) {
                                    tname = players[r.player - 1]
                                }
                                node.push(i18next.t("apresults:TIMEOUT", {player: tname}));
                                break;
                            case "drawagreed":
                                node.push(i18next.t("apresults:DRAWAGREED"));
                                break;
                            case "gameabandoned":
                                node.push(i18next.t("apresults:ABANDONED"));
                                break;
                            case "winners":
                                const names: string[] = [];
                                for (const w of r.players) {
                                    if (w <= players.length) {
                                        names.push(players[w - 1]);
                                    } else {
                                        names.push(`Player ${w}`);
                                    }
                                }
                                if (r.players.length === 0)
                                    node.push(i18next.t("apresults:WINNERSNONE"));
                                else
                                    node.push(i18next.t("apresults:WINNERS", {count: r.players.length, winners: names.join(", ")}));
                            break;
                        }
                    }
                }
                if (state._results.find(r => r.type === "deltaScore") !== undefined) {
                    if ("scores" in state) {
                        node.push(i18next.t("apresults:SCORE_REPORT", {player: name, score: (state.scores as number[])[otherPlayer - 1]}));
                    }
                }
                result.push(node);
            }
        }
        return result;
    }

    protected getMovesAndResults(exclude: string[] = []): any[] {
        const moves = this.moveHistory();
        const moveCount = moves.map((x) => { return x.length; }).reduce((a, b) => { return a + b; });
        const results = this.resultsHistory();
        if (moveCount !== results.length) {
            throw new Error(`The list of moves and list of results are not the correct length.\nMoves: ${moveCount}, Results: ${results.length}\First move: ${moves[0].join("|")}, First result: ${JSON.stringify(results[0])}\nLast move: ${moves[moves.length - 1].join("|")}, Last result: ${JSON.stringify(results[results.length - 1])}`);
        }
        const combined = [];
        for (let i = 0; i < moves.length; i++) {
            const node = [];
            for (let j = 0; j < this.numplayers; j++) {
                if (moves[i].length >= j + 1) {
                    const move = moves[i][j];
                    const result = results[(i * this.numplayers) + j];
                    const filtered = result.filter((obj) => {
                        return ! exclude.includes(obj.type);
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

    protected getMovesAndResultsWithSequence(exclude: string[] = []): any[] {
        const moves = this.moveHistoryWithSequence();
        const moveCount = moves.map((x) => { return x.length; }).reduce((a, b) => { return a + b; });
        const results = this.resultsHistory();
        if (moveCount !== results.length) {
            throw new Error(`The list of moves and list of results are not the correct length.\nMoves: ${moveCount}, Results: ${results.length}\First move: ${moves[0].join("|")}, First result: ${JSON.stringify(results[0])}\nLast move: ${moves[moves.length - 1].join("|")}, Last result: ${JSON.stringify(results[results.length - 1])}`);
        }
        const combined = [];
        for (let i = 0; i < moves.length; i++) {
            const node = [];
            for (let j = 0; j < this.numplayers; j++) {
                if (moves[i].length >= j + 1) {
                    const move = moves[i][j];
                    const result = results[(i * this.numplayers) + j];
                    const filtered = result.filter((obj) => {
                        return ! exclude.includes(obj.type);
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

        let startDate = new Date(this.stack[0]._timestamp);
        let endDate = new Date(this.stack[this.stack.length - 1]._timestamp);
        if (data.dateStart !== undefined) {
            startDate = data.dateStart;
        }
        if (data.dateEnd !== undefined) {
            endDate = data.dateEnd;
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
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
                "date-start": startDate.toISOString(),
                "date-end": endDate.toISOString(),
                "date-generated": new Date().toISOString(),
                // This exception is here because the type requires 1+ entries
                // but here at initialization, we can't.
                // @ts-ignore
                players: []
            },
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            moves: this.getMoveList()
        };
        if ( (data.unrated !== undefined) && (data.unrated) ) {
            rec.header.unrated = data.unrated;
        }
        if ( (data.pied !== undefined) && (data.pied) ) {
            rec.header["pie-invoked"] = true;
        }

        if (gameinfo.flags?.includes("random-start")) {
            rec.header.startingPosition = this.getStartingPosition();
        }

        if (gameinfo.flags?.includes("random-start")) {
            rec.header.startingPosition = this.getStartingPosition();
        }

        for (let i = 0; i < data.players.length; i++) {
            let result = this.getPlayerResult(i + 1);
            if (result === undefined) {
                result = -Infinity;
            }
            rec.header.players.push({
                name: data.players[i].name,
                userid: data.players[i].uid,
                // eslint-disable-next-line @typescript-eslint/naming-convention
                is_ai: data.players[i].isai,
                score: this.getPlayerScore(i + 1),
                result,
            });
        }

        return rec;
    }

    public serialize(): string {
        return JSON.stringify(this.state(), replacer);
    }

    public state2aiai(): string[] {
        const moves = this.moveHistory();
        const lst: string[] = [];
        for (const round of moves) {
            for (const move of round) {
                lst.push(move);
            }
        }
        return lst;
    }

    public translateAiai(move: string): string {
        return move;
    }

    public aiaiMgl(): string {
        const ctor = this.constructor as typeof GameBase;
        return ctor.gameinfo.uid;
    }

    public getButtons(): ICustomButton[] {
        return [];
    }

    public getCustomRotation(): number|undefined {
        return undefined;
    }

    // compares the most recent state to all previous states and returns
    // the number of times the state has been repeated
    // Provide a dictionary of the properties to check in the state, and the
    // instances of that property to check for occurence in the stack.
    public stateCount(toCheck: Map<string, any>): number {
        const stack = [...this.stack];
        let count = 0;
        // If any of the keys of toCheck does not exist in the state, throw an error
        for (const key of toCheck.keys()) {
            if (!stack[0].hasOwnProperty(key)) {
                throw new Error(`The key ${key} does not exist in the state.`);
            }
        }
        const srcStr = JSDstringify(toCheck, { replacer: sortingReplacer });
        for (const state of stack) {
            const test = new Map<string, any>();
            for (const key of toCheck.keys()) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                test.set(key, state[key]);
            }
            const otherStr = JSDstringify(test, { replacer: sortingReplacer });
            if (srcStr === otherStr) {
                count++;
            }
        }
        return count;
    }
}

export abstract class GameBaseSimultaneous extends GameBase {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public isEliminated(id: number): boolean {
        return false;
    }

    public currplayer = undefined;
}
