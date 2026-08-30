/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-prototype-builtins */

import { APGamesInformation, AlternativeDisplay, Variant } from '../schemas/gameinfo.js';
import { APRenderRep, Glyph } from "@abstractplay/renderer/build/schemas/schema";
import type { APMoveResult } from '../schemas/moveresults.js';
import { APGameRecord } from "@abstractplay/recranks";
import { algebraic2coords, coords2algebraic, replacer, sortingReplacer, UserFacingError } from '../common/index.js';
import { omit } from "lodash";
import i18next from "i18next";
import JSDstringify from 'json-stringify-deterministic';
import type { IGamePly, IGameRound, IGameRoundSlot, TurnModel } from "./_turn-model.js";
import {
    defaultPlyActor,
    defaultShouldCloseRound,
    walkStackPlies,
} from "./_turn-plies.js";
import {
    buildSimultaneousPlies,
    buildSimultaneousRounds,
} from "./_turn-simultaneous.js";
import { skipTurnShouldCloseRound } from "./_turn-skip.js";
import { APGAMES_PRODUCTION } from "./_build-flags.generated.js";
import { allowedChallengeVariantUids } from "./_gameinfo-filter.js";
import { GameRng } from "../common/rng.js";
import type { ChatActorRef, ChatLogCollectContext, ChatLogEntry, ChatLogLine, ChatLogTextParamsInput } from "../common/chat-log.js";
export type { ChatActorRef, ChatLogLine, ChatLogEntry, ChatLogTranslate, ChatLogCollectContext, ChatLogTextParamsInput } from "../common/chat-log.js";
export { formatChatLogEntries, formatChatLogEntryNodes, chatPlayerToken, applyChatPlayerNames } from "../common/chat-log.js";
import { chatPlayerToken, formatChatLogEntryNodes } from "../common/chat-log.js";
import type { RenderLabel, StructuredRenderLabel } from "../common/render-label.js";
export type { RenderLabel, StructuredRenderLabel } from "../common/render-label.js";
export { resolveRenderLabel, isStructuredRenderLabel } from "../common/render-label.js";
import {
    computeElapsedMs,
    evaluateGrade,
    type IGradeTier,
    type ISoloOutcomeMeta,
    soloScoreDirection,
} from "./_solo-outcome.js";

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
    key: RenderLabel;
    value: StatusValue[];
}

/** Sidebar status value: plain text, piece glyph, or structured label. */
export type StatusValue = string | Glyph | RenderLabel;

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
    name: RenderLabel;
    scores: (number | string | RenderLabel)[];
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
    /** Seeded solo: challenge id assigned before first random event. */
    challengeSeed?: string;
    /** Seeded solo: RNG stream position at top of stack (mirrors stack entry when present). */
    rngCounter?: number;
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
 * - 1 means the move is a fully legal finished move with no meaningful extension; the frontend
 * typically auto-commits. Implies `canrender`.
 * - -1 means the move is definitively incomplete and would be rejected if submitted as is.
 * - 0 means the move string is itself a fully legal finished move (would be accepted by `move()`
 * without partial mode), but the frontend should not treat it as final — either because optional
 * in-game extension remains (e.g. Jacynth influence after placement), or because auto-commit
 * should be deferred (e.g. Canoe setup rearrangement). Do not use 0 for prefixes that would be
 * rejected as finished moves.
 * canrender?: A simple boolean that will only ever be present if `valid` is true. It asserts that
 * the move to this point would be accepted by the game engine as partial and would result in an
 * updated `APRenderRep` that may be helpful to the user. Game logic must not rely on this flag.
 *
 * @export
 * @interface IValidationResult
 */
 export interface IValidationResult {
    valid: boolean;
    message: string;
    complete?: -1|0|1;   // 0 or 1 implies canrender
    canrender?: boolean; // implies valid
    // in some cases it's the validator that can autocomplete a move
    // if present, the caller can safely replace the validated move
    // with the value of this property
    autocomplete?: string;
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

export interface IMoveOptions {partial?: boolean; trusted?: boolean, emulation?: boolean};

export abstract class GameBase  {
    public static readonly gameinfo: APGamesInformation;

    /** Seeded solo (`numplayers === 1`): challenge id and PRNG stream. */
    protected challengeSeed?: string;
    protected rng?: GameRng;

    public static create(...args: unknown[]): GameBase {
        return new (this as any)(...args);
    }

    public description(): string {
        const ctor = this.constructor as typeof GameBase;
        return i18next.t(ctor.gameinfo.description!);
    }
    public get metaGame(): string {
        const ctor = this.constructor as typeof GameBase;
        return ctor.gameinfo.uid;
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
        const variants: Variant[]|undefined = ctor.gameinfo.variants?.map(v => {return {
            "uid": v.uid,
            "name": i18next.t(`apgames:variants.${ctor.gameinfo.uid}.${v.uid}.name`),
            "description": i18next.exists(`apgames:variants.${ctor.gameinfo.uid}.${v.uid}.description`) ? i18next.t(`apgames:variants.${ctor.gameinfo.uid}.${v.uid}.description`) : undefined,
            "group": v.group,
            "experimental": v.experimental,
            "default": v.default,
        }});
        // add a `#` entry for each group, if not already present
        if (variants !== undefined) {
            const groups = new Set<string>();
            variants.forEach(v => {
                if (v.group !== undefined) {
                    groups.add(v.group);
                }
            });
            [...groups].forEach(g => {
                if (variants.find(v => v.uid === `#${g}`) === undefined) {
                    variants.unshift({
                        "uid": `#${g}`,
                        "name": i18next.exists(`apgames:variants.${ctor.gameinfo.uid}.${`#${g}`}.name`) ? i18next.t(`apgames:variants.${ctor.gameinfo.uid}.${`#${g}`}.name`) : undefined,
                        "description": i18next.exists(`apgames:variants.${ctor.gameinfo.uid}.${`#${g}`}.description`) ? i18next.t(`apgames:variants.${ctor.gameinfo.uid}.${`#${g}`}.description`) : undefined,
                        "group": g,
                    });
                }
                // but if it is present, make sure it's populated correctly
                else {
                    const idx = variants.findIndex(v => v.uid === `#${g}`);
                    variants[idx].name = i18next.exists(`apgames:variants.${ctor.gameinfo.uid}.${`#${g}`}.name`) ? i18next.t(`apgames:variants.${ctor.gameinfo.uid}.${`#${g}`}.name`) : undefined;
                    variants[idx].description = i18next.exists(`apgames:variants.${ctor.gameinfo.uid}.${`#${g}`}.description`) ? i18next.t(`apgames:variants.${ctor.gameinfo.uid}.${`#${g}`}.description`) : undefined;
                    variants[idx].group = g;
                }
            });
        }
        return variants;
    }

    /**
     * Variants available for new challenges and tournaments (production-filtered).
     * Use allvariants() for historical games and in-game display.
     */
    public challengeVariants(): Variant[] | undefined {
        const all = this.allvariants();
        if (!all || !APGAMES_PRODUCTION) {
            return all;
        }
        const ctor = this.constructor as typeof GameBase;
        const allowed = allowedChallengeVariantUids(ctor.gameinfo);
        return all.filter((v) => allowed.has(v.uid));
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
    public static coords2algebraic(x: number, y: number, height: number, reverseNumbers = false): string {
        return coords2algebraic(x, y, height, reverseNumbers);
    }

    public static algebraic2coords(cell: string, height: number, reverseNumbers = false): [number, number] {
        return algebraic2coords(cell, height, reverseNumbers);
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
    public abstract render(opts: IRenderOpts): APRenderRep|APRenderRep[];
    public abstract state(opts?: {strip?: boolean, player?: number}): IAPGameState;
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
        const state = this.moveState();
        this.attachSoloStateFields(state);
        this.stack.push(state);
    }

    /** Solo seeded play: persist challenge seed and RNG counter on stack entries. */
    protected attachSoloStateFields(state: IIndividualState): void {
        if (this.numplayers !== 1) {
            return;
        }
        if (this.challengeSeed !== undefined) {
            state.challengeSeed = this.challengeSeed;
        }
        if (this.rng !== undefined) {
            state.rngCounter = this.rng.getCounter();
        }
    }

    /**
     * Solo seeded play: restore RNG stream from a stack entry after `load(idx)`.
     * Call from game `load()` once board/hand state is copied from `stack[idx]`.
     */
    protected restoreSoloRngFromEntry(entry: IIndividualState): void {
        if (this.numplayers !== 1 || this.challengeSeed === undefined) {
            return;
        }
        const counter = typeof entry.rngCounter === "number" ? entry.rngCounter : 0;
        if (this.rng === undefined) {
            this.rng = new GameRng(this.challengeSeed, counter);
        } else {
            this.rng.restore(this.challengeSeed, counter);
        }
    }

    /** Solo seeded play: initialise PRNG before any random setup when `numplayers === 1`. */
    public initRng(seed: string, counter = 0): void {
        if (this.numplayers !== 1) {
            return;
        }
        this.challengeSeed = seed;
        this.rng = new GameRng(seed, counter);
    }

    /** Challenge seed for archive / replay; undefined when solo RNG is not in use. */
    public getChallengeSeed(): string | undefined {
        return this.challengeSeed;
    }

    /** Solo outcome model; override in solo titles. Multiplayer: leave undefined. */
    public getSoloOutcomeMeta(): ISoloOutcomeMeta | undefined {
        return undefined;
    }

    /** Graded solo: tier definitions. */
    public getGradeTiers(): IGradeTier[] | undefined {
        return undefined;
    }

    /** Graded solo: best tier id for final score. */
    public getPlayerGrade(player: number): string | undefined {
        const solo = this.getSoloOutcomeMeta();
        if (solo?.outcomeType !== "graded" || player !== 1) {
            return undefined;
        }
        const score = this.getPlayerScore(player);
        const tiers = this.getGradeTiers();
        if (score === undefined || tiers === undefined) {
            return undefined;
        }
        return evaluateGrade(score, tiers, soloScoreDirection(solo))?.id;
    }

    /** Binary solo: pass/fail at EOG. */
    public getBinaryPassed(player: number): boolean | undefined {
        void player;
        return undefined;
    }

    /** Timed solo: elapsed ms from stack timestamps (override only for pause variants). */
    public getPlayerElapsedMs(): number | undefined {
        const solo = this.getSoloOutcomeMeta();
        if (solo?.outcomeType !== "timed") {
            return undefined;
        }
        return computeElapsedMs(this.stack);
    }

    private getSoloArchiveScore(player: number): number | undefined {
        const solo = this.getSoloOutcomeMeta();
        if (solo === undefined || this.numplayers !== 1 || player !== 1) {
            return undefined;
        }
        if (solo.outcomeType === "timed") {
            return this.getPlayerElapsedMs();
        }
        return this.getPlayerScore(player);
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

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public sidebarStatuses(isPartial: boolean, partialMove: string): IStatus[] {
        return [] as IStatus[];
    }

    public sidebarScores(): IScores[] {
        return [] as IScores[];
    }

    public turnModel(): TurnModel {
        return "sequential";
    }

    /** Who made the move that produced `stack[stackIndex]`? */
    protected plyActor(stackIndex: number): number {
        return defaultPlyActor(this, stackIndex);
    }

    protected plyFromStack(stackIndex: number): IGamePly {
        const state = this.stack[stackIndex];
        if (!state.hasOwnProperty("lastmove")) {
            throw new Error("No `lastmove` property found.");
        }
        return {
            actor: this.plyActor(stackIndex),
            move: state.lastmove as string,
            results: state._results !== undefined ? [...state._results] : [],
            stackIndex,
            round: 0,
            playOrder: 0,
        };
    }

    protected shouldCloseRound(roundPlies: IGamePly[], stackIndex: number): boolean {
        void stackIndex;
        return defaultShouldCloseRound(this, roundPlies);
    }

    public getPlies(): IGamePly[] {
        return walkStackPlies({
            stack: this.stack,
            numplayers: this.numplayers,
            plyFromStack: (stackIndex) => this.plyFromStack(stackIndex),
            shouldCloseRound: (roundPlies, stackIndex) => this.shouldCloseRound(roundPlies, stackIndex),
        });
    }

    protected buildRoundRow(roundPlies: IGamePly[]): IGameRound {
        const row: IGameRound = new Array(this.numplayers).fill(null);
        for (const ply of roundPlies) {
            const seatIdx = ply.actor - 1;
            if (seatIdx < 0 || seatIdx >= this.numplayers) {
                throw new Error(`Ply actor ${ply.actor} is out of range for ${this.numplayers} players.`);
            }
            const results = ply.results;
            let slot: string | IGameRoundSlot;
            if (ply.playOrder !== ply.actor) {
                slot = results.length > 0
                    ? { move: ply.move, sequence: ply.playOrder, result: [...results] }
                    : { move: ply.move, sequence: ply.playOrder };
            } else if (results.length > 0) {
                slot = { move: ply.move, result: [...results] };
            } else {
                slot = ply.move;
            }
            row[seatIdx] = slot;
        }
        return row;
    }

    public getRounds(): IGameRound[] {
        const plies = this.getPlies();
        const rounds: IGameRound[] = [];
        let currentRound = -1;
        let roundPlies: IGamePly[] = [];
        for (const ply of plies) {
            if (ply.round !== currentRound) {
                if (roundPlies.length > 0) {
                    rounds.push(this.buildRoundRow(roundPlies));
                }
                currentRound = ply.round;
                roundPlies = [];
            }
            roundPlies.push(ply);
        }
        if (roundPlies.length > 0) {
            rounds.push(this.buildRoundRow(roundPlies));
        }
        return rounds;
    }

    /**
     * Result `type` values omitted from published gamerecord move-slot `result` arrays.
     * Default: `eog` and `winners` (header already carries outcome). Override when more types should be omitted.
     */
    protected recordExportExclude(): string[] {
        return ["eog", "winners"];
    }

    /** Strip excluded result types from round slots (does not change round count or seating). */
    protected filterRoundsForRecord(rounds: IGameRound[], exclude: string[]): IGameRound[] {
        return rounds.map((row) => row.map((slot) => {
            if (slot === null) {
                return null;
            }
            if (typeof slot === "string") {
                return slot;
            }
            const filtered = slot.result !== undefined
                ? slot.result.filter((obj) => !exclude.includes(obj.type))
                : [];
            if (slot.sequence !== undefined) {
                if (filtered.length > 0) {
                    return { move: slot.move, sequence: slot.sequence, result: filtered };
                }
                return { move: slot.move, sequence: slot.sequence };
            }
            if (filtered.length > 0) {
                return { move: slot.move, result: filtered };
            }
            return slot.move;
        }));
    }

    /** Drop trailing `null` seats — stride-shaped {@link getMoveList} rows omit them today. */
    protected compactExportRounds(rounds: IGameRound[]): IGameRound[] {
        return rounds.map((row) => {
            const copy: IGameRound = [...row];
            while (copy.length > 0 && copy[copy.length - 1] === null) {
                copy.pop();
            }
            return copy;
        });
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

    private defaultVariantLabel(group: string | undefined): string {
        if (group === undefined) {
            return "";
        }
        const key = `apgames:variants._default.${group}.name`;
        return i18next.exists(key) ? i18next.t(key) : `Default ${group}`;
    }

    public getVariants(): string[] {
        // if ( (this.variants === undefined) || (this.variants.length === 0) ) {
        //     return undefined;
        // }
        const vars: string[] = [];
        const possibleVariants = this.allvariants();
        if (possibleVariants !== undefined) {
            const grpNames = possibleVariants.map(v => v.group).filter(g => g !== undefined) as string[];
            const groups = new Set<string>(grpNames);
            for (const v of this.variants) {
                const rec = possibleVariants.find(x => x.uid === v)!;
                if (rec !== undefined) {
                    // remove from the list of groups, if defined
                    if (rec.group !== undefined) {
                        groups.delete(rec.group);
                    }
                    if (rec.name !== undefined) {
                        vars.push(rec.name);
                    } else {
                        if (rec.uid.startsWith("#")) {
                            vars.push(this.defaultVariantLabel(rec.group));
                        } else {
                            vars.push(v);
                        }
                    }
                }
            }
            // Any groups that are not represented, insert the default
            groups.forEach(g => {
                const found = possibleVariants.find(v => v.uid === `#${g}`);
                if (found !== undefined) {
                    if (found.name !== undefined) {
                        vars.push(found.name);
                    } else {
                        vars.push(this.defaultVariantLabel(g));
                    }
                }
            });
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
        const solo = this.getSoloOutcomeMeta();
        if (solo !== undefined && this.numplayers === 1 && player === 1) {
            switch (solo.outcomeType) {
                case "binary": {
                    const passed = this.getBinaryPassed(player);
                    return passed ? 1 : 0;
                }
                case "graded": {
                    const gradeId = this.getPlayerGrade(player);
                    const tiers = this.getGradeTiers() ?? [];
                    const idx = tiers.findIndex((t) => t.id === gradeId);
                    return idx >= 0 ? idx : 0;
                }
                case "score":
                case "timed":
                    return this.getSoloArchiveScore(player);
            }
        }
        if (this.winner.includes(player)) {
            return 1;
        } else {
            return 0;
        }
    }

    protected getMoveList(): any[] {
        return this.compactExportRounds(
            this.filterRoundsForRecord(this.getRounds(), this.recordExportExclude()),
        );
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

    public randomMove(): string {
        const myself = this as unknown as { moves: () => string[] };
        if (typeof myself.moves !== "function") {
            throw new Error("This game does not support random moves because it does not implement the `moves()` method.");
        }
        const moves = myself.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    /** Structured chat: map a game seat to an actor ref (override for automated opponents). */
    public getChatActorRef(seat: number): ChatActorRef {
        return { kind: "seat", seat };
    }

    /**
     * Seat attributed to player-facing lines in a stack frame.
     * Override when results use `r.who` or simultaneous indexing instead of `currplayer - 1`.
     */
    public resolveChatSeat(r: APMoveResult, currplayer: number): number {
        void r;
        let seat = currplayer - 1;
        if (seat < 1) {
            seat = this.numplayers;
        }
        return seat;
    }

    /** Structured area/board label for a seat; resolved to a display string in front. */
    protected seatAreaLabel(
        seat: number,
        textKey: string,
        textParams?: ChatLogTextParamsInput,
    ): StructuredRenderLabel {
        const cleaned = textParams === undefined
            ? undefined
            : Object.fromEntries(
                Object.entries(textParams).filter((entry): entry is [string, string | number] => entry[1] !== undefined),
            );
        const label: StructuredRenderLabel = {
            textKey,
            actor: { kind: "seat", seat },
        };
        if (cleaned !== undefined && Object.keys(cleaned).length > 0) {
            label.textParams = cleaned;
        }
        return label;
    }

    /** Structured area/board label with no seat actor; resolved in front via i18n only. */
    protected neutralAreaLabel(
        textKey: string,
        textParams?: ChatLogTextParamsInput,
    ): StructuredRenderLabel {
        const cleaned = textParams === undefined
            ? undefined
            : Object.fromEntries(
                Object.entries(textParams).filter((entry): entry is [string, string | number] => entry[1] !== undefined),
            );
        const label: StructuredRenderLabel = {
            textKey,
            actor: { kind: "none" },
        };
        if (cleaned !== undefined && Object.keys(cleaned).length > 0) {
            label.textParams = cleaned;
        }
        return label;
    }

    /** Structured sidebar status value for a seat (display name only). */
    protected seatStatusValue(seat: number): StructuredRenderLabel {
        return this.seatAreaLabel(seat, "apgames:status._player");
    }

    protected pushSeatChatLine(
        lines: ChatLogLine[],
        seat: number,
        textKey: string,
        textParams: ChatLogTextParamsInput = {},
    ): void {
        const merged: ChatLogTextParamsInput = { ...textParams, player: chatPlayerToken(seat) };
        const cleaned = Object.fromEntries(
            Object.entries(merged).filter((entry): entry is [string, string | number] => entry[1] !== undefined),
        );
        lines.push({
            actor: this.getChatActorRef(seat),
            textKey,
            textParams: cleaned,
        });
    }

    protected pushNeutralChatLine(
        lines: ChatLogLine[],
        textKey: string,
        textParams?: ChatLogTextParamsInput,
    ): void {
        const line: ChatLogLine = {
            actor: { kind: "none" },
            textKey,
        };
        if (textParams !== undefined) {
            const cleaned = Object.fromEntries(
                Object.entries(textParams).filter((entry): entry is [string, string | number] => entry[1] !== undefined),
            );
            if (Object.keys(cleaned).length > 0) {
                line.textParams = cleaned;
            }
        }
        lines.push(line);
    }

    /**
     * Emit structured chat for one result. Return true when handled.
     * Games override alongside or instead of legacy {@link chat}.
     */
    public collectChatLogLine(lines: ChatLogLine[], r: APMoveResult, ctx: ChatLogCollectContext): boolean {
        const seat = ctx.defaultSeat;
        switch (r.type) {
            case "move":
                if (r.what === undefined) {
                    this.pushSeatChatLine(lines, seat, "apresults:MOVE.nowhat", { from: r.from, to: r.to });
                } else {
                    this.pushSeatChatLine(lines, seat, "apresults:MOVE.complete_what", {
                        what: r.what, from: r.from, to: r.to,
                    });
                }
                return true;
            case "place":
                if (r.what === undefined) {
                    this.pushSeatChatLine(lines, seat, "apresults:PLACE.nowhat", { where: r.where });
                } else {
                    this.pushSeatChatLine(lines, seat, "apresults:PLACE.complete", {
                        what: r.what, where: r.where,
                    });
                }
                return true;
            case "pass":
                this.pushSeatChatLine(lines, seat, "apresults:PASS.simple", {});
                return true;
            case "button":
            case "take-button":
                this.pushSeatChatLine(lines, seat, "apresults:BUTTON", {});
                return true;
            case "play-second":
                this.pushSeatChatLine(lines, seat, "apresults:PLAYSECOND", {});
                return true;
            case "komi":
                this.pushSeatChatLine(lines, seat, "apresults:KOMI", { value: r.value });
                return true;
            case "flip":
                this.pushSeatChatLine(lines, seat, "apresults:FLIP", { where: r.where, revealed: r.revealed });
                return true;
            case "reclaim":
                this.pushNeutralChatLine(lines, "apresults:RECLAIM.noperson", { what: r.what });
                return true;
            case "capture":
                if (r.where === undefined) {
                    if (r.what === undefined) {
                        this.pushNeutralChatLine(lines, "apresults:CAPTURE.minimal");
                    } else {
                        this.pushNeutralChatLine(lines, "apresults:CAPTURE.noperson.nowhere_what", { what: r.what });
                    }
                } else if (r.what === undefined) {
                    this.pushNeutralChatLine(lines, "apresults:CAPTURE.noperson.nowhat", { where: r.where });
                } else {
                    this.pushNeutralChatLine(lines, "apresults:CAPTURE.noperson.simple", {
                        what: r.what, where: r.where,
                    });
                }
                return true;
            case "bearoff":
                this.pushSeatChatLine(lines, seat, "apresults:BEAROFF.complete", {
                    count: parseInt(r.what!, 10), from: r.from,
                });
                return true;
            case "promote":
                this.pushNeutralChatLine(lines, "apresults:PROMOTE.mchess", { into: r.to });
                return true;
            case "orient":
                this.pushSeatChatLine(lines, seat, "apresults:ORIENT.nowhat", {
                    facing: r.facing, where: r.where,
                });
                return true;
            case "add":
                if (r.num === undefined) {
                    this.pushSeatChatLine(lines, seat, "apresults:ADD.nonum", { where: r.where });
                } else {
                    this.pushSeatChatLine(lines, seat, "apresults:ADD.add", { count: r.num, where: r.where });
                }
                return true;
            case "remove":
                if (r.num === undefined) {
                    this.pushSeatChatLine(lines, seat, "apresults:REMOVE.nonum", { count: r.num, where: r.where });
                } else {
                    this.pushSeatChatLine(lines, seat, "apresults:REMOVE.remove", { count: r.num, where: r.where });
                }
                return true;
            case "claim":
                this.pushSeatChatLine(lines, seat, "apresults:CLAIM.default", { where: r.where });
                return true;
            case "eog":
                this.pushNeutralChatLine(lines, "apresults:EOG.default");
                return true;
            case "resigned": {
                const rname = this.resolveChatPlayerName(r.player, ctx.players);
                this.pushNeutralChatLine(lines, "apresults:RESIGN", { player: rname });
                return true;
            }
            case "timeout": {
                const tname = this.resolveChatPlayerName(r.player, ctx.players);
                this.pushNeutralChatLine(lines, "apresults:TIMEOUT", { player: tname });
                return true;
            }
            case "drawagreed":
                this.pushNeutralChatLine(lines, "apresults:DRAWAGREED");
                return true;
            case "gameabandoned":
                this.pushNeutralChatLine(lines, "apresults:ABANDONED");
                return true;
            case "winners": {
                const names: string[] = [];
                for (const w of r.players) {
                    names.push(this.resolveChatPlayerName(w, ctx.players));
                }
                if (r.players.length === 0) {
                    this.pushNeutralChatLine(lines, "apresults:WINNERSNONE");
                } else {
                    this.pushNeutralChatLine(lines, "apresults:WINNERS", {
                        count: r.players.length,
                        winners: names.join(", "),
                    });
                }
                return true;
            }
            default:
                return false;
        }
    }

    protected resolveChatPlayerName(seat: number, players: string[]): string {
        if (seat <= players.length && players[seat - 1] !== undefined && players[seat - 1].length > 0) {
            return players[seat - 1];
        }
        return chatPlayerToken(seat);
    }

    public chatLogEntries(players: string[] = []): ChatLogEntry[] {
        const entries: ChatLogEntry[] = [];
        for (const state of this.stack) {
            if (state._results !== undefined && state._results.length > 0) {
                const lines: ChatLogLine[] = [];
                const currplayer = state.currplayer as number;
                const defaultSeat = this.resolveChatSeat(state._results[0], currplayer);
                const ctx: ChatLogCollectContext = {
                    results: state._results,
                    currplayer,
                    defaultSeat,
                    players,
                };
                for (const r of state._results) {
                    this.collectChatLogLine(lines, r, ctx);
                }
                if (state._results.find((res) => res.type === "deltaScore") !== undefined) {
                    const thisInfo = Object.getPrototypeOf(this).constructor.gameinfo as APGamesInformation;
                    if ("scores" in state && (thisInfo.flags === undefined || !thisInfo.flags.includes("simultaneous"))) {
                        this.pushSeatChatLine(lines, defaultSeat, "apresults:SCORE_REPORT", {
                            score: (state.scores as number[])[defaultSeat - 1],
                        });
                    }
                }
                entries.push({
                    timestamp: (state._timestamp && new Date(state._timestamp).toISOString()) || "unknown",
                    lines,
                });
            }
        }
        return entries;
    }

    /**
     * @deprecated Legacy per-result hook; no longer used — implement {@link collectChatLogLine} instead.
     */
    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult, players: string[] = []): boolean {
        void node;
        void player;
        void results;
        void r;
        void players;
        return false;
    }

    public chatLog(players: string[]): string[][] {
        return formatChatLogEntryNodes(
            this.chatLogEntries(players),
            players,
            (key, params) => i18next.t(key, params),
        );
    }

    /** Frozen stride shim — zips {@link moveHistory} with {@link resultsHistory}. Prefer {@link recordExportExclude} + default {@link getMoveList}. */
    protected getMovesAndResults(exclude: string[] = []): any[] {
        const moves = this.moveHistory();
        const moveCount = moves.map((x) => { return x.length; }).reduce((a, b) => { return a + b; });
        const results = this.resultsHistory();
        if (moveCount !== results.length) {
            throw new Error(`The list of moves and list of results are not the correct length.\nMoves: ${moveCount}, Results: ${results.length}\nFirst move: ${moves[0].join("|")}, First result: ${JSON.stringify(results[0])}\nLast move: ${moves[moves.length - 1].join("|")}, Last result: ${JSON.stringify(results[results.length - 1])}`);
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

    /** Frozen stride shim — zips {@link moveHistoryWithSequence} with {@link resultsHistory}. */
    protected getMovesAndResultsWithSequence(exclude: string[] = []): any[] {
        const moves = this.moveHistoryWithSequence();
        const moveCount = moves.map((x) => { return x.length; }).reduce((a, b) => { return a + b; });
        const results = this.resultsHistory();
        if (moveCount !== results.length) {
            throw new Error(`The list of moves and list of results are not the correct length.\nMoves: ${moveCount}, Results: ${results.length}\nFirst move: ${moves[0].join("|")}, First result: ${JSON.stringify(results[0])}\nLast move: ${moves[moves.length - 1].join("|")}, Last result: ${JSON.stringify(results[results.length - 1])}`);
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
                players: []
            },
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

        const solo = this.getSoloOutcomeMeta();
        if (solo !== undefined && this.numplayers === 1) {
            const direction = soloScoreDirection(solo);
            rec.header["outcome-type"] = solo.outcomeType;
            rec.header["score-direction"] = direction;
            if (solo.scoreLabel !== undefined) {
                rec.header["score-label"] = solo.scoreLabel;
            }
            const challengeSeed = this.getChallengeSeed();
            if (challengeSeed !== undefined) {
                rec.header["challenge-seed"] = challengeSeed;
            }
        }

        for (let i = 0; i < data.players.length; i++) {
            let result = this.getPlayerResult(i + 1);
            if (result === undefined) {
                result = -Infinity;
            }
            const playerEntry: Record<string, unknown> = {
                name: data.players[i].name,
                userid: data.players[i].uid,
                is_ai: data.players[i].isai,
                score: this.getSoloArchiveScore(i + 1) ?? this.getPlayerScore(i + 1),
                result,
            };
            if (solo !== undefined && this.numplayers === 1 && i === 0) {
                if (solo.outcomeType === "binary") {
                    const passed = this.getBinaryPassed(i + 1);
                    if (passed !== undefined) {
                        playerEntry.passed = passed;
                    }
                }
                if (solo.outcomeType === "graded") {
                    const grade = this.getPlayerGrade(i + 1);
                    if (grade !== undefined) {
                        playerEntry.grade = grade;
                    }
                }
            }
            rec.header.players.push(playerEntry as (typeof rec.header.players)[number]);
        }

        rec.header["turn-model"] = this.turnModel();

        return rec;
    }

    // This method is just to help generate the move list when serialize is overwritten and expensive
    public cheapSerialize(opts?: {strip?: boolean, player?: number}): string {
        return JSON.stringify(this.state(opts), replacer);
    }

    public serialize(opts?: {strip?: boolean, player?: number}): string {
        return this.cheapSerialize(opts);
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

    public botContext(): null|Record<string, any> {
        return null;
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

    public turnModel(): TurnModel {
        return "simultaneous";
    }

    public getPlies(): IGamePly[] {
        return buildSimultaneousPlies(this);
    }

    public getRounds(): IGameRound[] {
        return buildSimultaneousRounds(this);
    }

    /** Keep full seating width — trailing nulls are eliminated seats, not padding. */
    protected compactExportRounds(rounds: IGameRound[]): IGameRound[] {
        return rounds;
    }
}

export abstract class GameBaseSkipTurn extends GameBase {
    public turnModel(): TurnModel {
        return "skip-turn";
    }

    /** Whether `seat` (1-based) may act at the pre-move state for `stack[stackIndex]`. */
    protected abstract isSeatActive(seat: number, stackIndex: number): boolean;

    protected shouldCloseRound(roundPlies: IGamePly[], stackIndex: number): boolean {
        return skipTurnShouldCloseRound(this, roundPlies, stackIndex);
    }

    protected buildRoundRow(roundPlies: IGamePly[]): IGameRound {
        const row = super.buildRoundRow(roundPlies);
        if (roundPlies.length === 0) {
            return row;
        }
        const stackIndex = roundPlies[roundPlies.length - 1]!.stackIndex;
        const actorsInRound = new Set(roundPlies.map((ply) => ply.actor));
        for (let seat = 1; seat <= this.numplayers; seat++) {
            if (actorsInRound.has(seat)) {
                continue;
            }
            if (!this.isSeatActive(seat, stackIndex)) {
                row[seat - 1] = null;
            }
        }
        return row;
    }

    /** Keep full seating width — trailing nulls are inactive seats, not padding. */
    protected compactExportRounds(rounds: IGameRound[]): IGameRound[] {
        return rounds;
    }
}
