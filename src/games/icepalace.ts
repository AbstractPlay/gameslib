import { IAPGameState, IClickResult, IIndividualState, IRenderOpts, IScores, IStashEntry, IStatus, IValidationResult } from "./_base.js";
import { GameBaseSequenced } from "./_turn-sequenced.js";
import type { APGamesInformation } from "../schemas/gameinfo.js";
import { APRenderRep, Freepiece, Glyph, MarkerFreespaceLabel } from "@abstractplay/renderer/build/schemas/schema";
import type { APMoveResult } from "../schemas/moveresults.js";
import { reviver, UserFacingError } from "../common/index.js";
import i18next from "i18next";
import {
    Cell,
    NULL_COLOUR,
    PieceId,
    Size,
    Structure,
    WILD_COLOUR,
    cellOf,
    cloneStructure,
    colourOf,
    coordsOf,
    legalCellsFor,
    legalPalacePlacement,
    legalYardPlacement,
    makePiece,
    placeInto,
    sizeOf,
    topOf,
} from "./icepalace/rules.js";
import { maximumBuild } from "./icepalace/solver.js";

/** A hand is being played into the Yard, or its winner is building the Palace. */
export type Phase = "hand" | "build";

/** One cell of freespace canvas, in renderer units; freespace scales pieces to `cellsize`. */
const UNIT = 50;
/** How far each pyramid in a stack rises above the one below it. */
const RISER = UNIT * 0.34;
/**
 * Rows are pitched further apart than columns so that a full three-pyramid stack, which
 * rises two risers above its cell, cannot collide with whatever sits in the row above.
 */
const ROW_PITCH = UNIT + 2 * RISER;
/** Blank space between the two structures. */
const GAP = UNIT * 2;
/** Rings of empty cells kept around each structure, to click into when founding. */
const PADDING = 1;

interface IStructureExtent {
    originX: number;
    minX: number;
    minY: number;
    cols: number;
    rows: number;
    width: number;
    height: number;
}

interface ILayout {
    palace: IStructureExtent;
    yard: IStructureExtent;
    width: number;
    height: number;
}

const SIZES: Size[] = [1, 2, 3];
const SIZE_NAMES = ["small", "medium", "large"];
/** Every Icehouse stash holds five pyramids of each size. */
const PER_SIZE_IN_STASH = 5;
/** Hands are replenished to two of each size. */
const HAND_PER_SIZE = 2;

export interface IMoveState extends IIndividualState {
    currplayer: number;
    yard: Structure;
    palace: Structure;
    hands: PieceId[][];
    pool: PieceId[];
    phase: Phase;
    /** Consecutive passes; the hand ends when every player has passed in a row. */
    passes: number;
    /** Seat holding the Turn Token, who leads the current hand. */
    lead: number;
    /** Seat that played the most recent pyramid into the Yard, so wins the hand. */
    lastPlacer?: number;
    /** Coloured Yard pyramids the hand winner is building with. */
    stock: PieceId[];
    /** How many of `stock` the builder must use, per the maximum-pyramids rule. */
    buildMin: number;
    /** Set when the Pool could not replenish every hand, which ends the game. */
    exhausted: boolean;
    lastmove?: string;
}

export interface IIcePalaceState extends IAPGameState {
    winner: number[];
    stack: Array<IMoveState>;
}

const pieceSort = (a: PieceId, b: PieceId): number => {
    if (colourOf(a) !== colourOf(b)) {
        return colourOf(a) < colourOf(b) ? -1 : 1;
    }
    return sizeOf(a) - sizeOf(b);
};

export class IcePalaceGame extends GameBaseSequenced {
    public static readonly gameinfo: APGamesInformation = {
        name: "Ice Palace",
        uid: "icepalace",
        playercounts: [3, 4, 5, 6],
        version: "20260918",
        dateAdded: "2026-09-18",
        // i18next.t("apgames:descriptions.icepalace")
        description: "apgames:descriptions.icepalace",
        urls: ["https://icehousegames.org/wiki/index.php?title=Ice_Palace"],
        people: [
            {
                type: "designer",
                name: "Geoff Hanna",
            },
        ],
        categories: [
            "goal>score>eog",
            "mechanic>place",
            "mechanic>stack",
            "mechanic>share",
            "mechanic>random>setup",
            "mechanic>random>play",
            "board>shape>rect",
            "board>connect>rect",
            "components>pyramids",
            "other>2+players",
        ],
        flags: ["experimental", "scores", "player-stashes", "no-moves"],
    };

    public numplayers = 3;
    public currplayer = 1;
    public yard: Structure = new Map();
    public palace: Structure = new Map();
    public hands: PieceId[][] = [];
    public pool: PieceId[] = [];
    public phase: Phase = "hand";
    public passes = 0;
    public lead = 1;
    public lastPlacer?: number;
    public stock: PieceId[] = [];
    public buildMin = 0;
    public exhausted = false;
    public gameover = false;
    public winner: number[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state: number | IIcePalaceState | string, variants?: string[]) {
        super();
        if (typeof state === "number") {
            if (!IcePalaceGame.gameinfo.playercounts.includes(state)) {
                throw new Error(`Ice Palace does not support ${state} players.`);
            }
            this.numplayers = state;
            if (variants !== undefined && variants.length > 0) {
                this.variants = this.applyVariantConstraints(variants);
            }
            const { hands, pool } = IcePalaceGame.deal(this.numplayers);
            const fresh: IMoveState = {
                _version: IcePalaceGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                yard: new Map(),
                palace: new Map(),
                hands,
                pool,
                phase: "hand",
                passes: 0,
                lead: 1,
                stock: [],
                buildMin: 0,
                exhausted: false,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IIcePalaceState;
            }
            if (state.game !== IcePalaceGame.gameinfo.uid) {
                throw new Error(`The Ice Palace engine cannot process a game of '${state.game}'.`);
            }
            this.numplayers = state.numplayers;
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    /**
     * Everyone keeps one pyramid of each size in their own colour; the rest of every stash,
     * plus a full Black and White stash, go into the Pool. Each player then blindly draws
     * one more of each size.
     */
    private static deal(numplayers: number): { hands: PieceId[][]; pool: PieceId[] } {
        const pool: PieceId[] = [];
        const hands: PieceId[][] = [];
        for (let p = 1; p <= numplayers; p++) {
            const hand: PieceId[] = [];
            for (const size of SIZES) {
                hand.push(makePiece(p.toString(), size));
                for (let i = 0; i < PER_SIZE_IN_STASH - 1; i++) {
                    pool.push(makePiece(p.toString(), size));
                }
            }
            hands.push(hand);
        }
        for (const colour of [NULL_COLOUR, WILD_COLOUR]) {
            for (const size of SIZES) {
                for (let i = 0; i < PER_SIZE_IN_STASH; i++) {
                    pool.push(makePiece(colour, size));
                }
            }
        }
        for (const hand of hands) {
            for (const size of SIZES) {
                const drawn = IcePalaceGame.drawSize(pool, size);
                if (drawn !== undefined) {
                    hand.push(drawn);
                }
            }
            hand.sort(pieceSort);
        }
        return { hands, pool };
    }

    /** Draws are made by size, so the Pool behaves as three separate bags. */
    private static drawSize(pool: PieceId[], size: Size): PieceId | undefined {
        const candidates: number[] = [];
        for (let i = 0; i < pool.length; i++) {
            if (sizeOf(pool[i]) === size) {
                candidates.push(i);
            }
        }
        if (candidates.length === 0) {
            return undefined;
        }
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        return pool.splice(pick, 1)[0];
    }

    public load(idx = -1): IcePalaceGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if (idx < 0 || idx >= this.stack.length) {
            throw new Error("Could not load the requested state from the stack.");
        }
        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.yard = cloneStructure(state.yard);
        this.palace = cloneStructure(state.palace);
        this.hands = state.hands.map(h => [...h]);
        this.pool = [...state.pool];
        this.phase = state.phase;
        this.passes = state.passes;
        this.lead = state.lead;
        this.lastPlacer = state.lastPlacer;
        this.stock = [...state.stock];
        this.buildMin = state.buildMin;
        this.exhausted = state.exhausted;
        this.lastmove = state.lastmove;
        this.results = [...state._results];
        return this;
    }

    public moveState(): IMoveState {
        return {
            _version: IcePalaceGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            yard: cloneStructure(this.yard),
            palace: cloneStructure(this.palace),
            hands: this.hands.map(h => [...h]),
            pool: [...this.pool],
            phase: this.phase,
            passes: this.passes,
            lead: this.lead,
            lastPlacer: this.lastPlacer,
            stock: [...this.stock],
            buildMin: this.buildMin,
            exhausted: this.exhausted,
        };
    }

    public state(): IIcePalaceState {
        return {
            game: IcePalaceGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    public clone(): IcePalaceGame {
        return new IcePalaceGame(this.serialize());
    }

    /* ------------------------------------------------------------------ rules */

    /** Whether this seat is leading the hand, which may not be passed. */
    private isLead(): boolean {
        return this.yard.size === 0;
    }

    private handOf(player: number): PieceId[] {
        return this.hands[player - 1];
    }

    /** Every placement this seat could make into the Yard. */
    public yardPlacements(player: number): string[] {
        const moves: string[] = [];
        for (const piece of new Set(this.handOf(player))) {
            for (const cell of legalCellsFor(this.yard, piece, legalYardPlacement)) {
                moves.push(`${piece}@${cell}`);
            }
        }
        return moves;
    }

    /** Every placement the builder could make next, given what is already placed. */
    public buildPlacements(palace: Structure, stock: PieceId[]): string[] {
        const moves: string[] = [];
        for (const piece of new Set(stock)) {
            for (const cell of legalCellsFor(palace, piece, legalPalacePlacement)) {
                moves.push(`${piece}@${cell}`);
            }
        }
        return moves;
    }

    /**
     * The move list is not exhaustive for the build phase, where the number of legal
     * orderings and positions is astronomical; that is what the `no-moves` flag declares.
     * The hand phase is enumerated in full, and the build phase offers one worked example.
     */
    public moves(player?: number): string[] {
        if (this.gameover) {
            return [];
        }
        const seat = player ?? this.currplayer;
        if (this.phase === "build") {
            if (this.buildMin === 0) {
                return ["pass"];
            }
            const plan = maximumBuild(this.palace, this.stock);
            return [plan.sequence.map(p => `${p.piece}@${p.cell}`).join(";")];
        }
        const moves = this.yardPlacements(seat);
        if (!this.isLead()) {
            moves.push("pass");
        }
        return moves;
    }

    private static normalise(m: string): string {
        const cleaned = m.replace(/\s+/g, "");
        if (cleaned.toLowerCase() === "pass") {
            return "pass";
        }
        return cleaned.toUpperCase();
    }

    /** Splits a placement into its pyramid and its cell. */
    private static parsePlacement(token: string): { piece: PieceId; cell: Cell } | undefined {
        const at = token.indexOf("@");
        if (at < 1 || at === token.length - 1) {
            return undefined;
        }
        const piece = token.substring(0, at);
        const cell = token.substring(at + 1);
        if (!/^[1-6BW][SML]$/.test(piece) || !/^-?\d+,-?\d+$/.test(cell)) {
            return undefined;
        }
        return { piece, cell };
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = { valid: false, message: "" };
        if (this.gameover) {
            result.message = i18next.t("apgames:MOVES_GAMEOVER");
            return result;
        }
        const move = IcePalaceGame.normalise(m);
        if (move === "") {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message =
                this.phase === "build"
                    ? i18next.t("apgames:validation.icepalace.INITIAL_BUILD", { count: this.buildMin })
                    : i18next.t("apgames:validation.icepalace.INITIAL_HAND");
            return result;
        }
        return this.phase === "build" ? this.validateBuild(move) : this.validateHand(move);
    }

    private validateHand(move: string): IValidationResult {
        const result: IValidationResult = { valid: false, message: "" };
        if (move === "pass") {
            if (this.isLead()) {
                result.message = i18next.t("apgames:validation.icepalace.LEAD_CANNOT_PASS");
                return result;
            }
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
        const parsed = IcePalaceGame.parsePlacement(move);
        if (parsed === undefined) {
            result.message = i18next.t("apgames:validation.icepalace.BAD_PLACEMENT", { move });
            return result;
        }
        const { piece, cell } = parsed;
        if (!this.handOf(this.currplayer).includes(piece)) {
            result.message = i18next.t("apgames:validation.icepalace.NOT_IN_HAND", { piece });
            return result;
        }
        if (!legalYardPlacement(this.yard, piece, cell)) {
            result.message = i18next.t("apgames:validation.icepalace.ILLEGAL_YARD", { piece, cell });
            return result;
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private validateBuild(move: string): IValidationResult {
        const result: IValidationResult = { valid: false, message: "" };
        if (move === "pass") {
            if (this.buildMin > 0) {
                result.message = i18next.t("apgames:validation.icepalace.MUST_BUILD", {
                    count: this.buildMin,
                });
                return result;
            }
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        const palace = cloneStructure(this.palace);
        const stock = [...this.stock];
        for (const token of move.split(";")) {
            const parsed = IcePalaceGame.parsePlacement(token);
            if (parsed === undefined) {
                result.message = i18next.t("apgames:validation.icepalace.BAD_PLACEMENT", { move: token });
                return result;
            }
            const { piece, cell } = parsed;
            const idx = stock.indexOf(piece);
            if (idx < 0) {
                result.message = i18next.t("apgames:validation.icepalace.NOT_IN_STOCK", { piece });
                return result;
            }
            if (!legalPalacePlacement(palace, piece, cell)) {
                result.message = i18next.t("apgames:validation.icepalace.ILLEGAL_PALACE", { piece, cell });
                return result;
            }
            stock.splice(idx, 1);
            placeInto(palace, piece, cell);
        }

        const placed = move.split(";").length;
        result.valid = true;
        result.canrender = true;
        if (placed < this.buildMin) {
            result.complete = -1;
            result.message = i18next.t("apgames:validation.icepalace.BUILD_MORE", {
                count: this.buildMin - placed,
            });
            return result;
        }
        // Never auto-commit a build. The builder decides who scores what, and wants the
        // chance to rearrange before the arrangement becomes permanent.
        result.complete = 0;
        result.message =
            stock.length === 0
                ? i18next.t("apgames:validation.icepalace.BUILD_COMPLETE")
                : i18next.t("apgames:validation.icepalace.BUILD_ENOUGH", { count: stock.length });
        return result;
    }

    public move(m: string, { partial = false, trusted = false } = {}): IcePalaceGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        const move = IcePalaceGame.normalise(m);
        if (!trusted) {
            const result = this.validateMove(move);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
        }

        this.results = [];
        if (this.phase === "build") {
            this.applyBuild(move, partial);
        } else {
            this.applyHand(move, partial);
        }
        if (partial) {
            return this;
        }

        this.lastmove = move;
        this.checkEOG();
        this.saveState();
        return this;
    }

    private applyHand(move: string, partial: boolean): void {
        if (move === "pass") {
            this.passes++;
            this.results.push({ type: "pass" });
        } else {
            const parsed = IcePalaceGame.parsePlacement(move)!;
            const hand = this.handOf(this.currplayer);
            hand.splice(hand.indexOf(parsed.piece), 1);
            placeInto(this.yard, parsed.piece, parsed.cell);
            this.passes = 0;
            this.lastPlacer = this.currplayer;
            this.results.push({ type: "place", what: parsed.piece, where: parsed.cell });
        }
        if (partial) {
            return;
        }
        if (this.passes >= this.numplayers && this.lastPlacer !== undefined) {
            this.endHand();
        } else {
            this.currplayer = (this.currplayer % this.numplayers) + 1;
        }
    }

    /** The hand winner takes the Yard; Black and White are discarded on the way. */
    private endHand(): void {
        const stock: PieceId[] = [];
        for (const [cell, stack] of this.yard.entries()) {
            for (const piece of stack) {
                const colour = colourOf(piece);
                if (colour === NULL_COLOUR || colour === WILD_COLOUR) {
                    this.results.push({ type: "remove", where: cell, what: piece });
                } else {
                    stock.push(piece);
                }
            }
        }
        this.yard = new Map();
        this.stock = stock.sort(pieceSort);
        this.buildMin = maximumBuild(this.palace, this.stock).max;
        this.phase = "build";
        this.currplayer = this.lastPlacer!;
        this.passes = 0;
    }

    private applyBuild(move: string, partial: boolean): void {
        if (move !== "pass") {
            for (const token of move.split(";")) {
                const parsed = IcePalaceGame.parsePlacement(token);
                if (parsed === undefined) {
                    continue;
                }
                const idx = this.stock.indexOf(parsed.piece);
                if (idx < 0) {
                    continue;
                }
                this.stock.splice(idx, 1);
                placeInto(this.palace, parsed.piece, parsed.cell);
                this.results.push({ type: "place", what: parsed.piece, where: parsed.cell });
            }
        }
        if (partial) {
            return;
        }
        for (const piece of this.stock) {
            this.results.push({ type: "remove", where: "stock", what: piece });
        }
        this.stock = [];
        this.buildMin = 0;
        this.exhausted = !this.replenish();
        if (!this.exhausted) {
            this.startHand();
        }
    }

    private startHand(): void {
        this.lead = (this.lead % this.numplayers) + 1;
        this.currplayer = this.lead;
        this.phase = "hand";
        this.passes = 0;
        this.lastPlacer = undefined;
    }

    /**
     * Replenishes every hand to two pyramids of each size. Returns false when the Pool
     * cannot do so, which ends the game. Because the Pool is shared and every player needs
     * the same two of each size, "one player cannot draw back up" and "the Pool cannot
     * refill everyone" are the same test. Hands never score, so a partial refill could not
     * change the outcome and is not attempted.
     */
    private replenish(): boolean {
        for (const size of SIZES) {
            let needed = 0;
            for (const hand of this.hands) {
                needed += HAND_PER_SIZE - hand.filter(p => sizeOf(p) === size).length;
            }
            const available = this.pool.filter(p => sizeOf(p) === size).length;
            if (needed > available) {
                return false;
            }
        }
        for (let p = 0; p < this.numplayers; p++) {
            for (const size of SIZES) {
                while (this.hands[p].filter(x => sizeOf(x) === size).length < HAND_PER_SIZE) {
                    const drawn = IcePalaceGame.drawSize(this.pool, size);
                    if (drawn === undefined) {
                        return false;
                    }
                    this.hands[p].push(drawn);
                }
            }
            this.hands[p].sort(pieceSort);
        }
        return true;
    }

    protected checkEOG(): IcePalaceGame {
        if (!this.exhausted) {
            return this;
        }
        this.gameover = true;
        const scores: number[] = [];
        for (let p = 1; p <= this.numplayers; p++) {
            scores.push(this.getPlayerScore(p));
        }
        const best = Math.max(...scores);
        this.winner = [];
        for (let p = 1; p <= this.numplayers; p++) {
            if (scores[p - 1] === best) {
                this.winner.push(p);
            }
        }
        this.results.push({ type: "eog" }, { type: "winners", players: [...this.winner] });
        return this;
    }

    /** Each stack scores its height for whoever owns the pyramid on top. */
    public getPlayerScore(player: number): number {
        let score = 0;
        for (const stack of this.palace.values()) {
            if (stack.length === 0) {
                continue;
            }
            if (colourOf(stack[stack.length - 1]) === player.toString()) {
                score += stack.length;
            }
        }
        return score;
    }

    public getPlayerStash(player: number): IStashEntry[] | undefined {
        const hand = this.hands[player - 1];
        if (hand === undefined) {
            return undefined;
        }
        const counts = new Map<PieceId, number>();
        for (const piece of hand) {
            counts.set(piece, (counts.get(piece) ?? 0) + 1);
        }
        return [...counts.entries()]
            .sort((a, b) => pieceSort(a[0], b[0]))
            .map(([piece, count]) => ({
                count,
                glyph: this.glyphFor(piece),
                movePart: piece,
            }));
    }

    public sidebarScores(): IScores[] {
        const scores: number[] = [];
        for (let p = 1; p <= this.numplayers; p++) {
            scores.push(this.getPlayerScore(p));
        }
        return [{ name: this.neutralAreaLabel("apgames:status.SCORES"), scores }];
    }

    public sidebarStatuses(): IStatus[] {
        const statuses: IStatus[] = [
            {
                key: this.neutralAreaLabel("apgames:status.icepalace.POOL"),
                value: [this.pool.length.toString()],
            },
        ];
        if (this.phase === "build") {
            statuses.push({
                key: this.neutralAreaLabel("apgames:status.icepalace.MUST_USE"),
                value: [`${this.buildMin} / ${this.stock.length}`],
            });
        }
        return statuses;
    }

    /* --------------------------------------------------------------- rendering */

    private glyphFor(piece: PieceId): Glyph {
        const name = `pyramid-up-${SIZE_NAMES[sizeOf(piece) - 1]}`;
        const colour = colourOf(piece);
        if (colour === NULL_COLOUR) {
            return { name, colour: "#000000" };
        }
        if (colour === WILD_COLOUR) {
            return { name, colour: "#ffffff" };
        }
        return { name, colour: Number(colour) };
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        const result: IClickResult = { move, valid: false, message: "" };
        try {
            const current = IcePalaceGame.normalise(move);
            let newmove: string;
            if (piece !== undefined && /^[1-6BW][SML]$/.test(piece.toUpperCase())) {
                // A stash entry hands back the pyramid it represents.
                newmove = this.appendToken(current, piece.toUpperCase());
            } else if (piece !== undefined && /^[yp]:-?\d+,-?\d+$/.test(piece)) {
                // A pyramid already in play hands back the cell it stands on.
                newmove = this.appendToken(current, `@${piece.substring(2)}`);
            } else {
                // Empty freespace hands back continuous coordinates, which have to be
                // mapped back through the layout this game renders with.
                const cell = this.cellAt(col, row);
                if (cell === undefined) {
                    result.move = current;
                    result.message = i18next.t("apgames:validation.icepalace.OFF_STRUCTURE");
                    return result;
                }
                newmove = this.appendToken(current, `@${cell}`);
            }
            const validated = this.validateMove(newmove);
            if (!validated.valid) {
                result.move = current === "" ? "" : current;
                result.message = validated.message;
                return result;
            }
            result.move = newmove;
            result.valid = true;
            result.complete = validated.complete;
            result.canrender = validated.canrender;
            result.message = validated.message;
            return result;
        } catch (e) {
            result.message = i18next.t("apgames:validation._general.GENERIC", { move, row, col, piece, emessage: (e as Error).message });
            return result;
        }
    }

    /** Builds up a move string click by click, starting a new placement when one is full. */
    private appendToken(current: string, token: string): string {
        if (token.startsWith("@")) {
            if (current === "") {
                return current;
            }
            const parts = current.split(";");
            const last = parts[parts.length - 1];
            if (last.includes("@")) {
                return current;
            }
            parts[parts.length - 1] = last + token;
            return parts.join(";");
        }
        if (current === "") {
            return token;
        }
        const parts = current.split(";");
        const last = parts[parts.length - 1];
        if (last.includes("@")) {
            return this.phase === "build" ? `${current};${token}` : token;
        }
        parts[parts.length - 1] = token;
        return parts.join(";");
    }

    /**
     * Both structures grow on unbounded grids and have to be shown at once, so this uses the
     * freespace renderer and lays them out side by side rather than trying to fit two boards
     * into one bounded board. Stacks are drawn bottom to top with a rising offset, which reads
     * correctly for the Palace and the Yard even though their size rules run opposite ways.
     */
    public render(opts?: IRenderOpts): APRenderRep {
        void opts;
        const layout = this.layout();
        const legend: { [k: string]: Glyph } = {};
        const pieces: Freepiece[] = [];
        const markers: MarkerFreespaceLabel[] = [];

        const draw = (struct: Structure, extent: IStructureExtent, tag: string): void => {
            for (const [cell, stack] of struct.entries()) {
                const [x, y] = coordsOf(cell);
                const baseX = extent.originX + (x - extent.minX + 0.5) * UNIT;
                const baseY = layout.height - (y - extent.minY + 0.5) * ROW_PITCH;
                for (let i = 0; i < stack.length; i++) {
                    const key = `p${stack[i]}`;
                    if (!(key in legend)) {
                        legend[key] = this.glyphFor(stack[i]);
                    }
                    // Each pyramid in a stack rises a little above the one below, so the
                    // whole stack stays readable and its true order is visible. That matters
                    // because the Yard and the Palace stack in opposite size orders.
                    pieces.push({
                        glyph: key,
                        x: baseX,
                        y: baseY - i * RISER,
                        id: `${tag}:${cell}`,
                    });
                }
            }
        };

        draw(this.palace, layout.palace, "p");
        draw(this.yard, layout.yard, "y");

        const label = (text: MarkerFreespaceLabel["label"], extent: IStructureExtent): void => {
            markers.push({
                type: "label",
                label: text,
                points: [
                    { x: extent.originX, y: layout.height + UNIT / 2 },
                    { x: extent.originX + extent.width, y: layout.height + UNIT / 2 },
                ],
            });
        };
        // Structured labels, resolved by the front end, rather than English baked in here.
        // i18next.t("apgames:icepalace.PALACE")
        label(this.neutralAreaLabel("apgames:icepalace.PALACE"), layout.palace);
        // i18next.t("apgames:icepalace.YARD")
        // i18next.t("apgames:icepalace.YARD_BUILDING")
        label(
            this.neutralAreaLabel(
                this.phase === "build" ? "apgames:icepalace.YARD_BUILDING" : "apgames:icepalace.YARD",
            ),
            layout.yard,
        );

        const rep: APRenderRep = {
            renderer: "freespace",
            board: {
                width: layout.width,
                height: layout.height + UNIT,
                markers: markers.length > 0 ? markers : undefined,
            },
            legend,
            pieces,
        };
        return rep;
    }

    /**
     * Where each structure sits on the freespace canvas. Both grids are unbounded, so each
     * is padded by a ring of empty cells; without it there would be nowhere to click to
     * found a stack on the frontier.
     */
    private layout(): ILayout {
        const extentOf = (struct: Structure, originX: number): IStructureExtent => {
            if (struct.size === 0) {
                return { originX, minX: 0, minY: 0, cols: 1, rows: 1, width: UNIT, height: ROW_PITCH };
            }
            const coords = [...struct.keys()].map(coordsOf);
            const minX = Math.min(...coords.map(c => c[0])) - PADDING;
            const maxX = Math.max(...coords.map(c => c[0])) + PADDING;
            const minY = Math.min(...coords.map(c => c[1])) - PADDING;
            const maxY = Math.max(...coords.map(c => c[1])) + PADDING;
            const cols = maxX - minX + 1;
            const rows = maxY - minY + 1;
            return {
                originX, minX, minY, cols, rows,
                width: cols * UNIT,
                height: rows * ROW_PITCH,
            };
        };

        const palace = extentOf(this.palace, 0);
        const yard = extentOf(this.yard, palace.width + GAP);
        return {
            palace,
            yard,
            width: palace.width + GAP + yard.width,
            height: Math.max(palace.height, yard.height),
        };
    }

    /**
     * Turns a click on empty freespace back into a cell of whichever structure is in play
     * this phase. Returns undefined when the click landed in the gutter or the wrong half.
     */
    private cellAt(x: number, y: number): Cell | undefined {
        const layout = this.layout();
        const extent = this.phase === "build" ? layout.palace : layout.yard;
        const localX = x - extent.originX;
        if (localX < 0 || localX >= extent.width) {
            return undefined;
        }
        const localY = layout.height - y;
        if (localY < 0 || localY >= extent.height) {
            return undefined;
        }
        return cellOf(
            extent.minX + Math.floor(localX / UNIT),
            extent.minY + Math.floor(localY / ROW_PITCH),
        );
    }

    public getPlayerColour(player: number): number {
        return player;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.icepalace", { player, what: r.what, where: r.where }));
                resolved = true;
                break;
            case "remove":
                node.push(i18next.t("apresults:REMOVE.icepalace", { player, what: r.what }));
                resolved = true;
                break;
        }
        void results;
        return resolved;
    }

    /** Exposed for tests: the pyramid currently on top of a cell. */
    public topOfCell(struct: "yard" | "palace", cell: Cell): PieceId | undefined {
        return topOf(struct === "yard" ? this.yard : this.palace, cell);
    }
}
