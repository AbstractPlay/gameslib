import {
    IAPGameState,
    IClickResult,
    IIndividualState,
    IScores,
    IStatus,
    IValidationResult,
    type ChatLogCollectContext,
    type ChatLogLine,
    IRenderOpts,
} from "./_base.js";
import { GameBaseSequenced, sequencedShouldCloseRound } from "./_turn-sequenced.js";
import { SIMULTANEOUS_ELIM_TOKEN } from "./_turn-simultaneous.js";
import type { IGamePly } from "./_turn-model.js";
import type { APGamesInformation } from "../schemas/gameinfo.js";
import { APRenderRep, AreaPieces, Glyph, RowCol } from "@abstractplay/renderer/build/schemas/schema";
import type { APMoveResult } from "../schemas/moveresults.js";
import { reviver, UserFacingError, cloneState } from "../common/index.js";
import i18next from "i18next";
import { Card, Deck, cardSortAsc, cardsBasic } from "../common/decktet/index.js";
import { QuincunxBoard } from "./quincunx/board.js";
import { QuincunxCard } from "./quincunx/card.js";
import { scorePlacement } from "./thricewise/scoring.js";

export type playerid = 1|2|3|4|5;
type Phase = "select" | "place";

export interface IMoveState extends IIndividualState {
    currplayer: number;
    scores: number[];
    board: QuincunxBoard;
    hands: string[][];
    deferred: string[][];
    phase: Phase;
    playQueue: number[];
    trickCard: (string | undefined)[];
    round: number;
    lastmove?: string;
}

export interface IThricewiseState extends IAPGameState {
    winner: number[];
    stack: Array<IMoveState>;
}

interface ILegendObj {
    [key: string]: Glyph|[Glyph, ...Glyph[]];
}

interface ParsedSegment {
    uid: string;
    x: number;
    y: number;
}

const MAX_GRID = 6;

function withinGridCap(board: QuincunxBoard, x: number, y: number): boolean {
    return withinGridCapCoords(board, [[x, y]]);
}

function withinGridCapCoords(board: QuincunxBoard, coords: [number, number][]): boolean {
    if (coords.length === 0) {
        return true;
    }
    const xs = board.cards.map(c => c.x);
    const ys = board.cards.map(c => c.y);
    for (const [x, y] of coords) {
        xs.push(x);
        ys.push(y);
    }
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return maxX - minX + 1 <= MAX_GRID && maxY - minY + 1 <= MAX_GRID;
}

function orthAdjacentToPlaced(
    board: QuincunxBoard,
    x: number,
    y: number,
    pending: [number, number][],
): boolean {
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as [number, number][]) {
        const nx = x + dx;
        const ny = y + dy;
        if (board.getCardAt(nx, ny) !== undefined) {
            return true;
        }
        if (pending.some(([px, py]) => px === nx && py === ny)) {
            return true;
        }
    }
    return false;
}

function parseSegments(token: string): ParsedSegment[] {
    const segments: ParsedSegment[] = [];
    if (token === "" || token === SIMULTANEOUS_ELIM_TOKEN) {
        return segments;
    }
    for (const part of token.split(";")) {
        const trimmed = part.trim();
        if (trimmed === "") {
            continue;
        }
        const at = trimmed.indexOf("@");
        if (at < 0) {
            continue;
        }
        const uid = trimmed.substring(0, at).toUpperCase();
        const coords = trimmed.substring(at + 1);
        const [xs, ys] = coords.split(".");
        if (xs === undefined || ys === undefined) {
            continue;
        }
        const x = parseInt(xs, 10);
        const y = parseInt(ys, 10);
        if (Number.isNaN(x) || Number.isNaN(y)) {
            continue;
        }
        segments.push({ uid, x, y });
    }
    return segments;
}

function setupOpeningGrid(board: QuincunxBoard, deck: Deck, numplayers: number): void {
    const cols = numplayers === 2 || numplayers === 4 ? 2 : 3;
    const rows = 2;
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const card = deck.draw()[0];
            board.add(new QuincunxCard({ x: col, y: -row, card }));
        }
    }
}

export class ThricewiseGame extends GameBaseSequenced {
    public static readonly gameinfo: APGamesInformation = {
        name: "Thricewise",
        uid: "thricewise",
        playercounts: [2, 3, 4, 5],
        version: "20260925",
        dateAdded: "2026-09-25",
        description: "apgames:descriptions.thricewise",
        notes: "apgames:notes.thricewise",
        urls: [
            "https://decktet.wikidot.com/game:thricewise",
            "https://boardgamegeek.com/boardgame/42900/thricewise",
        ],
        bggid: "42900",
        people: [
            {
                type: "designer",
                name: "P.D. Magnus",
                urls: ["https://decktet.wikidot.com/designer:p-d-magnus"],
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        categories: [
            "goal>score>eog",
            "mechanic>place",
            "mechanic>hidden",
            "mechanic>simultaneous",
            "mechanic>random>setup",
            "mechanic>random>play",
            "board>dynamic",
            "board>connect>rect",
            "components>decktet",
            "other>2+players",
        ],
        flags: ["experimental", "scores", "simultaneous", "shared-pieces", "automove", "no-explore"],
    };

    public numplayers = 2;
    public currplayer = 1;
    public board!: QuincunxBoard;
    public hands: string[][] = [];
    public deferred: string[][] = [];
    public scores!: number[];
    public phase: Phase = "select";
    public playQueue: number[] = [];
    public trickCard: (string | undefined)[] = [];
    public gameover = false;
    public winner: number[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public round = 1;
    private deck!: Deck;
    private selected: string | undefined;
    /** Cards placed during an in-progress compound placement (input only). */
    private placedThisActivation: string[] = [];

    constructor(state: number | IThricewiseState | string, variants?: string[]) {
        super();
        if (typeof state === "number") {
            this.numplayers = ThricewiseGame.gameinfo.playercounts.includes(state)
                ? state
                : ThricewiseGame.gameinfo.playercounts[0];
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const deck = new Deck([...cardsBasic]);
            deck.shuffle();
            const board = new QuincunxBoard(MAX_GRID);
            setupOpeningGrid(board, deck, this.numplayers);
            const hands: string[][] = [];
            const deferred: string[][] = [];
            const scores: number[] = [];
            const trickCard: (string | undefined)[] = [];
            for (let i = 0; i < this.numplayers; i++) {
                hands.push(deck.draw(3).map(c => c.uid));
                deferred.push([]);
                scores.push(0);
                trickCard.push(undefined);
            }
            const fresh: IMoveState = {
                _version: ThricewiseGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                phase: "select",
                board,
                hands,
                deferred,
                scores,
                playQueue: [],
                trickCard,
                round: 1,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IThricewiseState;
            }
            if (state.game !== ThricewiseGame.gameinfo.uid) {
                throw new Error(`The Thricewise engine cannot process a game of '${state.game}'.`);
            }
            this.numplayers = state.numplayers;
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): ThricewiseGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if (idx < 0 || idx >= this.stack.length) {
            throw new Error("Could not load the requested state from the stack.");
        }
        const state = this.stack[idx];
        this.results = [...state._results];
        this.currplayer = state.currplayer;
        this.scores = [...state.scores];
        this.round = state.round;
        this.phase = state.phase;
        this.board = QuincunxBoard.deserialize(state.board, MAX_GRID);
        this.hands = cloneState(state.hands) as string[][];
        this.deferred = cloneState(state.deferred) as string[][];
        this.playQueue = [...state.playQueue];
        this.trickCard = state.trickCard.map(t => (t == null ? undefined : t));
        this.lastmove = state.lastmove;
        this.selected = undefined;
        this.placedThisActivation = [];

        const deck = new Deck([...cardsBasic]);
        for (const c of this.board.cards) {
            deck.remove(c.card.uid);
        }
        for (const hand of this.hands) {
            for (const uid of hand) {
                if (uid !== "") {
                    deck.remove(uid);
                }
            }
        }
        for (const pile of this.deferred) {
            for (const uid of pile) {
                deck.remove(uid);
            }
        }
        for (const uid of this.trickCard) {
            if (uid != null) {
                deck.remove(uid);
            }
        }
        deck.shuffle();
        this.deck = deck;
        return this;
    }

    protected obligationFor(seat: number): string[] {
        const cards = [...this.deferred[seat - 1]];
        const trick = this.trickCard[seat - 1];
        if (trick != null && !cards.includes(trick)) {
            cards.push(trick);
        }
        return cards;
    }

    protected legalEmpties(): [number, number][] {
        return this.board.empties.filter(([x, y]) => withinGridCap(this.board, x, y));
    }

    /** Whether a hand card is shown face-up (and thus not in the deck area) for this observer. */
    protected handUidVisibleToObserver(seat: number, uid: string, perspective?: number): boolean {
        if (this.phase === "place") {
            return this.obligationFor(seat).includes(uid);
        }
        if (perspective === undefined) {
            return true;
        }
        return seat === perspective;
    }

    /** Card uids the observer can see (board, public deferred, and face-up hand cards). */
    protected visibleCardUids(perspective?: number): Set<string> {
        const visible = new Set<string>();
        for (const c of this.board.cards) {
            visible.add(c.card.uid);
        }
        for (const pile of this.deferred) {
            for (const uid of pile) {
                if (uid != null && uid !== "") {
                    visible.add(uid);
                }
            }
        }
        for (let p = 1; p <= this.numplayers; p++) {
            const obligation = new Set(this.obligationFor(p));
            const trick = this.trickCard[p - 1];
            if (trick != null && obligation.has(trick) && !this.deferred[p - 1].includes(trick)) {
                visible.add(trick);
            }
            for (const uid of this.hands[p - 1]) {
                if (uid == null || uid === "") {
                    continue;
                }
                if (this.handUidVisibleToObserver(p, uid, perspective)) {
                    visible.add(uid);
                }
            }
        }
        return visible;
    }

    protected splitSimultaneous(m: string): string[] {
        const parts = m.replace(/\s+/g, "").split(",");
        if (parts.length !== this.numplayers) {
            throw new UserFacingError(
                "MOVES_SIMULTANEOUS_PARTIAL",
                i18next.t("apgames:MOVES_SIMULTANEOUS_PARTIAL"),
            );
        }
        return parts;
    }

    public moves(p?: number): string[] {
        if (this.gameover) {
            return [];
        }
        const player = p ?? this.currplayer;
        if (this.phase === "select") {
            const hand = this.hands[player - 1];
            if (hand.length === 0) {
                return [SIMULTANEOUS_ELIM_TOKEN];
            }
            return hand.map(uid => uid.toUpperCase());
        }
        if (this.phase === "place") {
            if (player !== this.currplayer) {
                return [SIMULTANEOUS_ELIM_TOKEN];
            }
            const obligation = this.obligationFor(player).filter(
                uid => !this.placedThisActivation.includes(uid),
            );
            if (obligation.length === 0) {
                return [];
            }
            const moves: string[] = [];
            const empties = this.legalEmpties();
            if (obligation.length === 1) {
                for (const [x, y] of empties) {
                    if (orthAdjacentToPlaced(this.board, x, y, [])) {
                        moves.push(`${obligation[0].toUpperCase()}@${x}.${y}`);
                    }
                }
                return moves.sort((a, b) => a.localeCompare(b));
            }
            for (const uid of obligation) {
                moves.push(uid.toUpperCase());
            }
            return [...new Set(moves)].sort((a, b) => a.localeCompare(b));
        }
        return [];
    }

    /** All legal complete compound placements for the active seat (adjacency + grid cap). */
    private enumerateCompletePlacements(player: number): string[] {
        const obligation = this.obligationFor(player).filter(
            uid => !this.placedThisActivation.includes(uid),
        );
        if (obligation.length === 0) {
            return [];
        }
        const tokens: string[] = [];
        const tryPlace = (
            idx: number,
            segments: ParsedSegment[],
            pending: [number, number][],
            used: Set<string>,
        ): void => {
            if (idx === obligation.length) {
                const token = segments.map(s => `${s.uid}@${s.x}.${s.y}`).join(";");
                const v = this.validatePlaceToken(token, player);
                if (v.valid && v.complete === 1) {
                    tokens.push(token);
                }
                return;
            }
            const uid = obligation[idx]!.toUpperCase();
            for (const [x, y] of this.legalEmpties()) {
                const key = `${x},${y}`;
                if (used.has(key) || this.board.getCardAt(x, y) !== undefined) {
                    continue;
                }
                const nextPending = pending.concat([[x, y]]);
                if (!withinGridCapCoords(this.board, nextPending)) {
                    continue;
                }
                if (!orthAdjacentToPlaced(this.board, x, y, pending)) {
                    continue;
                }
                used.add(key);
                tryPlace(idx + 1, segments.concat({ uid, x, y }), nextPending, used);
                used.delete(key);
            }
        };
        tryPlace(0, [], [], new Set());
        return tokens;
    }

    /** Complete placement token for automove / random playouts (not partial card picks). */
    private randomPlaceToken(player: number): string {
        const tokens = this.enumerateCompletePlacements(player);
        if (tokens.length === 0) {
            return SIMULTANEOUS_ELIM_TOKEN;
        }
        return tokens[Math.floor(Math.random() * tokens.length)]!;
    }

    public randomMove(): string {
        if (this.isTableauFull() || this.stockExhausted()) {
            this.checkEOG();
        }
        if (this.gameover) {
            return Array(this.numplayers).fill(SIMULTANEOUS_ELIM_TOKEN).join(",");
        }
        const parts: string[] = [];
        for (let p = 1; p <= this.numplayers; p++) {
            if (this.phase === "place" && p === this.currplayer) {
                parts.push(this.randomPlaceToken(p));
            } else {
                const legal = this.moves(p);
                parts.push(legal[Math.floor(Math.random() * legal.length)] ?? SIMULTANEOUS_ELIM_TOKEN);
            }
        }
        return parts.join(",");
    }

    public validateMove(m: string, player?: number): IValidationResult {
        const result: IValidationResult = {
            valid: false,
            message: i18next.t("apgames:validation._general.DEFAULT_HANDLER"),
        };
        m = m.replace(/\s+/g, "");

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.thricewise.INITIAL_INSTRUCTIONS", {
                context: this.phase,
            });
            return result;
        }

        if (m === SIMULTANEOUS_ELIM_TOKEN) {
            if (this.phase === "place" && player !== undefined && player !== this.currplayer) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
            if (
                this.phase === "select" &&
                player !== undefined &&
                this.hands[player - 1].length === 0
            ) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
            result.valid = false;
            result.message = i18next.t("apgames:validation.thricewise.BAD_PASS");
            return result;
        }

        if (this.phase === "select") {
            if (player === undefined) {
                return result;
            }
            const card = m.toUpperCase();
            if (!this.hands[player - 1].includes(card)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.thricewise.BAD_CARD", { card });
                return result;
            }
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        if (this.phase === "place" && player !== undefined) {
            return this.validatePlaceToken(m, player);
        }

        return result;
    }

    private validatePlaceToken(token: string, player: number): IValidationResult {
        const result: IValidationResult = {
            valid: false,
            message: i18next.t("apgames:validation._general.DEFAULT_HANDLER"),
        };
        if (player !== this.currplayer) {
            result.message = i18next.t("apgames:validation.thricewise.NOT_YOUR_TURN");
            return result;
        }

        const obligation = this.obligationFor(player);
        const remaining = obligation.filter(uid => !this.placedThisActivation.includes(uid));

        if (!token.includes("@")) {
            const card = token.toUpperCase();
            if (!remaining.includes(card)) {
                result.message = i18next.t("apgames:validation.thricewise.BAD_CARD", { card });
                return result;
            }
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.thricewise.VALID_PARTIAL_CELL");
            return result;
        }

        const segments = parseSegments(token);
        const placedUids = segments.map(s => s.uid);
        const pending: [number, number][] = [];
        for (const seg of segments) {
            if (!obligation.includes(seg.uid)) {
                result.message = i18next.t("apgames:validation.thricewise.BAD_CARD", { card: seg.uid });
                return result;
            }
            const existing = this.board.getCardAt(seg.x, seg.y);
            if (existing !== undefined) {
                if (
                    this.placedThisActivation.includes(seg.uid) &&
                    existing.card.uid === seg.uid
                ) {
                    continue;
                }
                result.message = i18next.t("apgames:validation._general.OCCUPIED", {
                    where: `${seg.x},${seg.y}`,
                });
                return result;
            }
            if (!withinGridCapCoords(this.board, pending.concat([[seg.x, seg.y]]))) {
                result.message = i18next.t("apgames:validation.thricewise.GRID_CAP");
                return result;
            }
            if (!orthAdjacentToPlaced(this.board, seg.x, seg.y, pending)) {
                result.message = i18next.t("apgames:validation.thricewise.NOT_ADJACENT");
                return result;
            }
            pending.push([seg.x, seg.y]);
        }
        const unique = new Set(placedUids);
        if (unique.size !== placedUids.length) {
            result.message = i18next.t("apgames:validation.thricewise.DUPLICATE_CARD");
            return result;
        }

        const lastPart = token.split(";").pop() ?? "";
        const lastComplete = lastPart.includes("@") && lastPart.split("@")[1]?.includes(".");

        if (!lastComplete && token.includes("@")) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.thricewise.VALID_PARTIAL_CELL");
            return result;
        }

        const allPlaced = [...this.placedThisActivation, ...placedUids];
        const allSet = new Set(allPlaced);
        if (allSet.size === obligation.length && obligation.every(uid => allSet.has(uid))) {
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        if (segments.length > 0 && lastComplete) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.thricewise.VALID_PARTIAL_MORE");
            return result;
        }

        result.valid = true;
        result.complete = -1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation.thricewise.VALID_PARTIAL_CELL");
        return result;
    }

    /** Seat for hand-area clicks; during select `currplayer` is not the acting seat. */
    private clickSeatFromPiece(piece?: string): playerid {
        if (piece !== undefined && piece.length > 1) {
            const uid = piece.substring(1).toUpperCase();
            for (let p = 1; p <= this.numplayers; p++) {
                if (this.hands[p - 1].includes(uid) || this.deferred[p - 1].includes(uid)) {
                    return p as playerid;
                }
                const trick = this.trickCard[p - 1];
                if (trick != null && trick === uid) {
                    return p as playerid;
                }
            }
        }
        return this.currplayer as playerid;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        const player =
            this.phase === "select" && row === -1 && col === -1
                ? this.clickSeatFromPiece(piece)
                : (this.currplayer as playerid);
        return this.handleClickSimultaneous(move, row, col, player, piece);
    }

    public handleClickSimultaneous(
        move: string,
        row: number,
        col: number,
        player: playerid,
        piece?: string,
    ): IClickResult {
        try {
            let newmove: string;
            if (row === -1 || col === -1) {
                if (piece === undefined) {
                    throw new Error("Off-board click requires piece.");
                }
                const uid = piece.substring(1).toUpperCase();
                if (this.phase === "select") {
                    newmove = uid;
                } else {
                    if (move === "" || !move.includes("@")) {
                        newmove = uid;
                    } else if (move.includes(";")) {
                        const parts = move.split(";");
                        const last = parts[parts.length - 1]!;
                        if (last.includes("@")) {
                            parts.push(uid);
                            newmove = parts.join(";");
                        } else {
                            parts[parts.length - 1] = uid;
                            newmove = parts.join(";");
                        }
                    } else if (move.includes("@")) {
                        newmove = `${move};${uid}`;
                    } else {
                        newmove = uid;
                    }
                }
            } else {
                const [absx, absy] = this.board.rel2abs(col, row);
                if (this.phase === "select") {
                    return {
                        move: "",
                        valid: false,
                        message: i18next.t("apgames:validation.thricewise.SELECT_HAND"),
                    };
                }
                if (move === "" || !move.includes("@")) {
                    newmove = `${move}@${absx}.${absy}`;
                } else {
                    const segs = move.split(";");
                    const last = segs[segs.length - 1]!;
                    const cardPart = last.includes("@") ? last.split("@")[0]! : last;
                    segs[segs.length - 1] = `${cardPart}@${absx}.${absy}`;
                    newmove = segs.join(";");
                }
            }

            const result = this.validateMove(newmove, player) as IClickResult;
            if (!result.valid) {
                result.move = "";
            } else {
                result.move = newmove;
            }
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", {
                    move,
                    row,
                    col,
                    piece,
                    emessage: (e as Error).message,
                }),
            };
        }
    }

    private applySegment(seg: ParsedSegment, player: number): void {
        const card = Card.deserialize(seg.uid)!;
        const cardObj = new QuincunxCard({ x: seg.x, y: seg.y, card });
        this.board.add(cardObj);
        this.results.push({ type: "place", what: card.plain, where: `${seg.x},${seg.y}`, who: player });
        const delta = scorePlacement(this.board, cardObj);
        if (delta > 0) {
            this.scores[player - 1] += delta;
            this.results.push({ type: "deltaScore", delta, who: player });
        }
        this.hands[player - 1] = this.hands[player - 1].filter(uid => uid !== seg.uid);
        this.deferred[player - 1] = this.deferred[player - 1].filter(uid => uid !== seg.uid);
        if (this.trickCard[player - 1] === seg.uid) {
            this.trickCard[player - 1] = undefined;
        }
        this.placedThisActivation.push(seg.uid);
        if (this.isTableauFull()) {
            this.checkEOG();
            this.playQueue = [];
        }
    }

    /** True when the grid is 6×6 full or no card may legally be placed. */
    protected isTableauFull(): boolean {
        if (this.board.cards.length >= 36) {
            return true;
        }
        if (this.legalEmpties().length === 0) {
            return true;
        }
        if (this.phase === "place" && !this.gameover) {
            const remaining = this.obligationFor(this.currplayer).filter(
                uid => !this.placedThisActivation.includes(uid),
            );
            if (remaining.length > 0 && this.enumerateCompletePlacements(this.currplayer).length === 0) {
                return true;
            }
        }
        return false;
    }

    /** No cards left to deal into hands, or the deck is empty while a seat has no hand cards. */
    private stockExhausted(): boolean {
        if (this.deferred.some(d => d.length > 0)) {
            return false;
        }
        if (this.hands.every(h => h.length === 0)) {
            return true;
        }
        if (this.deck.size === 0) {
            return this.hands.some(h => h.length === 0);
        }
        return false;
    }

    private applyCompoundToken(token: string, player: number, partial: boolean): void {
        const segments = parseSegments(token);
        const already = new Set(this.placedThisActivation);
        for (const seg of segments) {
            if (already.has(seg.uid)) {
                continue;
            }
            this.applySegment(seg, player);
            already.add(seg.uid);
        }
        if (partial) {
            return;
        }
    }

    private resolveSelect(parts: string[]): void {
        const selections: string[] = [];
        for (let p = 0; p < this.numplayers; p++) {
            const raw = parts[p];
            if (raw === SIMULTANEOUS_ELIM_TOKEN || raw === "") {
                selections.push("");
                continue;
            }
            const card = raw.toUpperCase();
            selections.push(card);
            this.results.push({ type: "select", who: p + 1, what: card });
            this.hands[p] = this.hands[p].filter(uid => uid !== card);
        }
        const byRank = new Map<string, number[]>();
        for (let p = 0; p < selections.length; p++) {
            const card = selections[p];
            if (card === "") {
                continue;
            }
            const rank = Card.deserialize(card)!.rank.uid;
            const seats = byRank.get(rank) ?? [];
            seats.push(p + 1);
            byRank.set(rank, seats);
        }
        const deferredSeats = new Set<number>();
        for (const [, seats] of byRank) {
            if (seats.length >= 2) {
                for (const seat of seats) {
                    deferredSeats.add(seat);
                }
            }
        }
        const playQueue: number[] = [];
        for (let p = 0; p < selections.length; p++) {
            const seat = p + 1;
            const card = selections[p];
            if (card === "") {
                this.trickCard[p] = undefined;
                continue;
            }
            this.trickCard[p] = card;
            if (deferredSeats.has(seat)) {
                this.deferred[p].push(card);
                this.trickCard[p] = undefined;
            } else {
                playQueue.push(seat);
            }
        }
        playQueue.sort((a, b) => {
            const ra = Card.deserialize(selections[a - 1])!.rank.seq;
            const rb = Card.deserialize(selections[b - 1])!.rank.seq;
            return ra - rb;
        });
        this.playQueue = playQueue;
        this.phase = "place";
        this.placedThisActivation = [];
        if (this.playQueue.length === 0) {
            this.endTrick();
        } else {
            this.currplayer = this.playQueue[0]!;
        }
    }

    private finishPlacement(player: number): void {
        this.playQueue = this.playQueue.filter(s => s !== player);
        this.placedThisActivation = [];
        this.selected = undefined;
        if (this.gameover) {
            return;
        }
        if (this.isTableauFull()) {
            this.checkEOG();
            return;
        }
        if (this.playQueue.length === 0) {
            this.endTrick();
        } else {
            this.currplayer = this.playQueue[0]!;
        }
    }

    private endTrick(): void {
        if (this.isTableauFull() || this.stockExhausted()) {
            this.checkEOG();
            return;
        }
        if (this.deck.size >= this.numplayers) {
            for (let p = 0; p < this.numplayers; p++) {
                const drawn = this.deck.draw()[0];
                this.hands[p].push(drawn.uid);
                this.results.push({ type: "deckDraw", what: drawn.plain });
            }
        }
        this.phase = "select";
        this.playQueue = [];
        this.trickCard = this.trickCard.map(() => undefined);
        this.placedThisActivation = [];
        this.round++;
        this.currplayer = 1;
        this.checkEOG();
    }

    protected checkEOG(): ThricewiseGame {
        if (this.gameover) {
            return this;
        }
        if (this.isTableauFull() || this.stockExhausted()) {
            this.gameover = true;
            const max = Math.max(...this.scores);
            this.winner = [];
            for (let p = 1; p <= this.numplayers; p++) {
                if (this.scores[p - 1] === max) {
                    this.winner.push(p);
                }
            }
            this.results.push({ type: "eog" }, { type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public move(m: string, { partial = false, trusted = false } = {}): ThricewiseGame {
        if (this.isTableauFull() || this.stockExhausted()) {
            this.checkEOG();
            if (this.gameover) {
                return this;
            }
        }
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        m = m.replace(/\s+/g, "");
        const parts = this.splitSimultaneous(m);

        for (let i = 0; i < parts.length; i++) {
            const seat = (i + 1) as playerid;
            let part = parts[i];
            if (part === undefined || part === "") {
                if (partial) {
                    continue;
                }
                part = SIMULTANEOUS_ELIM_TOKEN;
            }
            if (!trusted) {
                const v = this.validateMove(part, seat);
                if (!v.valid) {
                    throw new UserFacingError("VALIDATION_GENERAL", v.message);
                }
                if (!partial) {
                    if (this.phase === "select" && v.complete !== 1) {
                        throw new UserFacingError(
                            "VALIDATION_FAILSAFE",
                            i18next.t("apgames:validation._general.FAILSAFE", { move: m }),
                        );
                    }
                    if (this.phase === "place") {
                        if (seat !== this.currplayer && part !== SIMULTANEOUS_ELIM_TOKEN) {
                            throw new UserFacingError("VALIDATION_GENERAL", v.message);
                        }
                        if (seat === this.currplayer && v.complete !== 1) {
                            throw new UserFacingError(
                                "VALIDATION_FAILSAFE",
                                i18next.t("apgames:validation._general.FAILSAFE", { move: m }),
                            );
                        }
                    }
                } else if (this.phase === "place" && seat === this.currplayer && v.complete === 0) {
                    throw new UserFacingError("VALIDATION_GENERAL", v.message);
                }
            }
        }

        this.results = [];

        if (this.phase === "select") {
            this.resolveSelect(parts.map(p => p.toUpperCase()));
            this.lastmove = parts.join(",");
            if (partial) {
                return this;
            }
            this.saveState();
            return this;
        }

        const active = this.currplayer;
        const activePart = parts[active - 1]!;
        this.applyCompoundToken(activePart, active, partial);
        if (partial) {
            return this;
        }

        this.finishPlacement(active);
        const simParts = parts.map((p, idx) =>
            idx + 1 === active ? activePart : SIMULTANEOUS_ELIM_TOKEN,
        );
        this.lastmove = simParts.join(",");
        this.saveState();
        return this;
    }

    protected shouldCloseRound(roundPlies: IGamePly[], stackIndex: number): boolean {
        const after = this.stack[stackIndex];
        if (after.phase === "place") {
            return false;
        }
        const before = this.stack[stackIndex - 1];
        if (before !== undefined && before.phase === "place" && after.phase === "select") {
            return true;
        }
        return sequencedShouldCloseRound(this, roundPlies, stackIndex);
    }

    public moveState(): IMoveState {
        return {
            _version: ThricewiseGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: cloneState(this.board) as QuincunxBoard,
            scores: [...this.scores],
            round: this.round,
            hands: cloneState(this.hands) as string[][],
            deferred: cloneState(this.deferred) as string[][],
            phase: this.phase,
            playQueue: [...this.playQueue],
            trickCard: [...this.trickCard],
        };
    }

    public state(opts?: { strip?: boolean; player?: number }): IThricewiseState {
        const state: IThricewiseState = {
            game: ThricewiseGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
        if (opts !== undefined && opts.strip) {
            state.stack = state.stack.map(mstate => {
                const copy = { ...mstate, hands: mstate.hands.map(h => [...h]) };
                for (let p = 1; p <= this.numplayers; p++) {
                    if (p === opts.player) {
                        continue;
                    }
                    copy.hands[p - 1] = copy.hands[p - 1].map(() => "");
                }
                return copy;
            });
        }
        return state;
    }

    public render({ perspective }: IRenderOpts = { perspective: undefined }): APRenderRep {
        const { height, width, minX, maxX, minY, maxY } = this.board.dimensions;
        const vp = this.board.viewportSize;
        const rowLabels: string[] = [];
        for (let y = (height < vp ? minY - 1 : minY); y <= (height < vp ? maxY + 1 : maxY); y++) {
            rowLabels.push(y.toString());
        }
        const columnLabels: string[] = [];
        for (let x = (width < vp ? minX - 1 : minX); x <= (width < vp ? maxX + 1 : maxX); x++) {
            columnLabels.push(x.toString());
        }

        const pieces: string[][] = [];
        const blocked: RowCol[] = [];
        for (let relRow = 0; relRow < (height < vp ? height + 2 : vp); relRow++) {
            const pcs: string[] = [];
            for (let relCol = 0; relCol < (width < vp ? width + 2 : vp); relCol++) {
                const [absx, absy] = this.board.rel2abs(relCol, relRow);
                const card = this.board.getCardAt(absx, absy);
                if (card === undefined) {
                    pcs.push("-");
                    blocked.push({ row: relRow, col: relCol });
                } else {
                    pcs.push(`c${card.card.uid}`);
                }
            }
            pieces.push(pcs);
        }
        const pstr = pieces.map(p => p.join(",")).join("\n");
        const g = this.board.graphOrth;
        for (const card of this.board.cards) {
            const [absx, absy] = [card.x, card.y];
            const rel = this.board.abs2rel(absx, absy);
            if (rel === undefined) {
                continue;
            }
            const node = g.coords2algebraic(...rel);
            for (const n of g.neighbours(node)) {
                const [nrelx, nrely] = g.algebraic2coords(n);
                const [nabsx, nabsy] = this.board.rel2abs(nrelx, nrely);
                if (this.board.getCardAt(nabsx, nabsy) === undefined) {
                    const idx = blocked.findIndex(({ row, col }) => row === nrely && col === nrelx);
                    if (idx >= 0) {
                        blocked.splice(idx, 1);
                    }
                }
            }
        }

        const legend: ILegendObj = {};
        for (const card of cardsBasic) {
            const glyph = card.toGlyph();
            if (this.selected === card.uid) {
                glyph.unshift({
                    name: "piece-square",
                    colour: {
                        func: "flatten",
                        fg: "_context_fill",
                        bg: "_context_background",
                        opacity: 0.2,
                    },
                });
            }
            legend["c" + card.uid] = glyph;
        }
        legend["cUNKNOWN"] = {
            name: "piece-square-borderless",
            colour: {
                func: "flatten",
                fg: "_context_fill",
                bg: "_context_background",
                opacity: 0.5,
            },
        };

        const areas: AreaPieces[] = [];
        for (let p = 1; p <= this.numplayers; p++) {
            const obligation = new Set(this.obligationFor(p));
            const handPieces: string[] = this.deferred[p - 1]
                .filter(uid => uid != null && uid !== "")
                .map(uid => "c" + uid);
            const trick = this.trickCard[p - 1];
            if (trick != null && obligation.has(trick) && !this.deferred[p - 1].includes(trick)) {
                handPieces.push("c" + trick);
            }
            for (const uid of this.hands[p - 1]) {
                if (uid == null || uid === "") {
                    continue;
                }
                if (this.handUidVisibleToObserver(p, uid, perspective)) {
                    handPieces.push("c" + uid);
                } else {
                    handPieces.push("cUNKNOWN");
                }
            }
            if (handPieces.length > 0) {
                areas.push({
                    type: "pieces",
                    pieces: handPieces as [string, ...string[]],
                    label: this.seatAreaLabel(p, "apgames:validation.thricewise.LABEL_HAND"),
                    spacing: 0.5,
                    width: width < 6 ? 6 : undefined,
                });
            }
        }

        const visible = this.visibleCardUids(perspective);
        const remaining = [...cardsBasic]
            .sort(cardSortAsc)
            .filter(c => !visible.has(c.uid))
            .map(c => "c" + c.uid);
        if (remaining.length > 0) {
            areas.push({
                type: "pieces",
                label: this.neutralAreaLabel("apgames:validation.thricewise.LABEL_DECK"),
                spacing: 0.25,
                pieces: remaining as [string, ...string[]],
                width: width < 6 ? 6 : undefined,
            });
        }

        const rep: APRenderRep = {
            board: {
                style: "squares-beveled",
                width: width < vp ? width + 2 : vp,
                height: height < vp ? height + 2 : vp,
                blocked: blocked.length > 0 ? (blocked as [RowCol, ...RowCol[]]) : undefined,
                rowLabels: rowLabels.map(l => l.replace("-", "\u2212")),
                columnLabels: columnLabels.map(l => l.replace("-", "\u2212")),
            },
            legend,
            pieces: pstr,
            areas,
        };

        if (this.results.length > 0) {
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "place") {
                    const [absx, absy] = move.where!.split(",").map(n => parseInt(n, 10));
                    const rel = this.board.abs2rel(absx, absy);
                    if (rel !== undefined) {
                        rep.annotations.push({
                            type: "enter",
                            occlude: false,
                            targets: [{ row: rel[1], col: rel[0] }],
                        });
                    }
                }
            }
            if (rep.annotations.length === 0) {
                delete rep.annotations;
            }
        }

        return rep;
    }

    public getPlayerScore(player: number): number {
        return this.scores[player - 1];
    }

    public sidebarScores(): IScores[] {
        const scores: number[] = [];
        for (let p = 1; p <= this.numplayers; p++) {
            scores.push(this.getPlayerScore(p));
        }
        return [{ name: this.neutralAreaLabel("apgames:status.SCORES"), scores }];
    }

    public sidebarStatuses(): IStatus[] {
        if (this.gameover) {
            return [];
        }
        const ctx = this.phase === "select" ? "select" : "place";
        return [{
            key: this.neutralAreaLabel("apgames:status.ROUND"),
            value: [
                i18next.t("apgames:validation.thricewise.STATUS", {
                    context: ctx,
                    round: this.round,
                }),
            ],
        }];
    }

    public collectChatLogLine(lines: ChatLogLine[], r: APMoveResult, ctx: ChatLogCollectContext): boolean {
        if (r.type === "deltaScore" && r.delta !== undefined) {
            const seat = r.who !== undefined ? r.who - 1 : ctx.defaultSeat;
            this.pushSeatChatLine(lines, seat, "apresults:DELTA_SCORE_GAIN", {
                count: r.delta,
                delta: r.delta,
            });
            return true;
        }
        return super.collectChatLogLine(lines, r, ctx);
    }

    public clone(): ThricewiseGame {
        return Object.assign(new ThricewiseGame(this.numplayers), cloneState(this) as ThricewiseGame);
    }
}
