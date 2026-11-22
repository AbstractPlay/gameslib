import {
    GameBase,
    IAPGameState,
    IClickResult,
    IIndividualState,
    IValidationResult,
    chatPlayerToken,
    type ChatLogCollectContext,
    type ChatLogLine,
} from "./_base.js";
import type { APGamesInformation } from "../schemas/gameinfo.js";
import type { APRenderRep, AreaPieces, Glyph } from "@abstractplay/renderer/build/schemas/schema";
import type { APMoveResult } from "../schemas/moveresults.js";
import { reviver, UserFacingError } from "../common/index.js";
import i18next from "i18next";
import type { HexTriGraph } from "../common/graphs/hextri.js";
import {
    type MarbleColour,
    type MarbleCounts,
    type playerid,
    MARBLE_COLOURS,
    ZERTZ_RING_FILL,
    ZERTZ_RING_BORDER,
    marblePaint,
    emptyMarbleCounts,
    standardPool,
} from "./zertz/types.js";
import {
    assertValidVariants,
    blitzFromVariants,
    boardVariantFromVariants,
    initialRingCells,
    layoutFor,
    type ZertzBoardLayout,
} from "./zertz/graph.js";
import { anyJumpExists, enumerateJumpChains, cellBetween, type JumpStep } from "./zertz/jumps.js";
import { isolationCaptures, isRingSlidable, removableRingsAfterPlacement } from "./zertz/rings.js";
import {
    formatJumpMove,
    formatPlacementMove,
    parseMove,
    resolveJumpOvers,
    type PlacementMove,
} from "./zertz/notation.js";
import {
    captureWinReason,
    captureWinThreshold,
    decrementCapture,
    incrementCapture,
    playerWins,
    type CaptureWinReason,
} from "./zertz/win.js";

export const gameApgamesEn = {
    validation: {
        INITIAL_INSTRUCTIONS_POOL: "Choose a marble from the pool.",
        INITIAL_INSTRUCTIONS_CAPTURED: "Choose a marble from your captured area.",
        INITIAL_INSTRUCTIONS_CAPTURE: "Make a capture.",
        MUST_JUMP: "Make a capture.",
        BAD_JUMP: "That jump sequence is not legal.",
        BAD_PLACE: "There is no vacant ring at {{where}}.",
        NO_MARBLE: "You do not have a {{colour}} marble available to play.",
        REMOVE_SAME_AS_PLACE: "You cannot remove the ring you just placed on.",
        REMOVE_OCCUPIED: "The ring at {{where}} is not vacant.",
        RING_NOT_FREE: "The ring at {{where}} cannot be removed without disturbing other rings.",
        MUST_CHOOSE_REMOVE: "You must remove a free ring after placing the marble.",
        PARTIAL_PLACE: "Select a vacant ring for the marble.",
        PARTIAL_REMOVE: "Select a ring to remove.",
        POOL_LABEL: "Pool",
        CAPTURED_LABEL: "{{player}}'s captured marbles",
    },
    variants: {
        "#board": {
            name: "Hexhex 4 board (37 rings)"
        },
        tournament: {
            name: "Tournament board",
            description: "Larger alternating hex-of-tri board (48 rings)",
        },
        oversize: {
            name: "Oversize board",
            description: "Hexhex 5 board (61 rings)",
        },
        blitz: {
            name: "Blitz",
            description: "Fewer marbles and lower capture targets; default board only.",
        },
    },
};

export const gameApresultsEn = {
    MOVE: {
        place: "{{player}} placed {{colour}} at {{where}}.",
        remove: "{{player}} removed the ring at {{where}}.",
        jump: "{{player}} jumped from {{from}} to {{to}}.",
    },
    CAPTURE: {
        jump: "{{player}} captured a {{colour}} marble at {{where}}.",
        isolation: "{{player}} isolated and captured {{colour}} at {{where}}.",
    },
    EOG: {
        each: "{{player}} wins by capturing {{count}} of each colour.",
        white: "{{player}} wins by capturing {{count}} white marbles.",
        grey: "{{player}} wins by capturing {{count}} grey marbles.",
        black: "{{player}} wins by capturing {{count}} black marbles.",
        full: "{{player}} wins — the board is full.",
        repetition: "The game is drawn by repetition.",
    },
};

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    rings: Set<string>;
    marbles: Map<string, MarbleColour>;
    pool: MarbleCounts;
    captured: [MarbleCounts, MarbleCounts];
    lastmove?: string;
    repetition?: Map<string, number>;
}

export interface IZertzState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
}

function cloneMarbleCounts(c: MarbleCounts): MarbleCounts {
    return { W: c.W, G: c.G, B: c.B };
}

function ringGlyph(): Glyph {
    return {
        name: "ring-23",
        scale: 1.1,
        paint: {
            fill: ZERTZ_RING_FILL,
            border: ZERTZ_RING_BORDER,
        },
    };
}

function marbleGlyph(colour: MarbleColour): Glyph {
    const orb = colour === "G" ? "orb3" : colour === "W" ? "orb1" : "orb";
    return {
        name: orb,
        scale: 0.8,
        paint: { fill: marblePaint(colour) },
    };
}

/** Pool/captured areas — same orb, no scale (board W/G/B composites are scaled). */
function areaMarbleGlyph(colour: MarbleColour): Glyph {
    const orb = colour === "G" ? "orb3" : colour === "W" ? "orb1" : "orb";
    return {
        name: orb,
        paint: { fill: marblePaint(colour) },
    };
}

export class ZertzGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "ZERTZ",
        uid: "zertz",
        playercounts: [2],
        version: "20261122",
        dateAdded: "2026-11-22",
        description:
            "Players share a pool of marbles on a shrinking hex board. Capture sets by jumping or isolating groups, or by collecting enough marbles of one colour.",
        urls: [
            "https://www.gipf.com/zertz/rules/rules.html",
            "https://www.gipf.com/zertz/notations/notation.html",
            "https://boardgamegeek.com/boardgame/528/zertz",
        ],
        bggid: "528",
        people: [
            {
                type: "designer",
                name: "Kris Burm",
                urls: ["https://www.gipf.com/"],
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        variants: [
            { uid: "tournament", group: "board" },
            { uid: "oversize", group: "board" },
            { uid: "blitz" },
        ],
        customizations: [
            { num: 1, default: "#E6E6E6", explanation: "White marble fill" },
            { num: 2, default: "#888888", explanation: "Grey marble fill" },
            { num: 3, default: "#333333", explanation: "Black marble fill" },
            { num: 4, default: "_context_board", explanation: "Ring fill" },
            { num: 5, default: "_context_strokes", explanation: "Ring border" },
        ],
        categories: [
            "family>gipf",
            "goal>set",
            "mechanic>place",
            "mechanic>move",
            "mechanic>capture",
            "board>shape>hex",
            "board>connect>hex",
            "board>dynamic",
            "components>special",
        ],
        flags: ["shared-pieces", "automove", "experimental"],
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public rings!: Set<string>;
    public marbles!: Map<string, MarbleColour>;
    public pool!: MarbleCounts;
    public captured!: [MarbleCounts, MarbleCounts];
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public repetition: Map<string, number> = new Map();
    private _layout?: ZertzBoardLayout;
    /** Invalidated when board / pool / capture state changes (playground calls `moves()` often). */
    private _legalMovesCache: string[] | undefined;

    constructor(state?: IZertzState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            this.variants = variants === undefined ? [] : [...variants];
            assertValidVariants(this.variants);
            const layout = this.getLayout();
            const fresh: IMoveState = {
                _version: ZertzGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                rings: initialRingCells(layout),
                marbles: new Map(),
                pool: standardPool(this.isBlitz),
                captured: [emptyMarbleCounts(), emptyMarbleCounts()],
                repetition: new Map(),
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IZertzState;
            }
            if (state.game !== ZertzGame.gameinfo.uid) {
                throw new Error(`The ZERTZ engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public get isBlitz(): boolean {
        return blitzFromVariants(this.variants);
    }

    public getLayout(): ZertzBoardLayout {
        if (this._layout === undefined) {
            this._layout = layoutFor(boardVariantFromVariants(this.variants));
        }
        return this._layout;
    }

    public get graph(): HexTriGraph {
        return this.getLayout().graph;
    }

    public load(idx = -1): ZertzGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if (idx < 0 || idx >= this.stack.length) {
            throw new Error("Could not load the requested state from the stack.");
        }
        const s = this.stack[idx]!;
        this.currplayer = s.currplayer;
        this.rings = new Set(s.rings);
        this.marbles = new Map(s.marbles);
        this.pool = cloneMarbleCounts(s.pool);
        this.captured = [cloneMarbleCounts(s.captured[0]), cloneMarbleCounts(s.captured[1])];
        this.lastmove = s.lastmove;
        this.repetition = s.repetition === undefined ? new Map() : new Map(s.repetition);
        this.results = [...s._results];
        this.invalidateLegalMovesCache();
        return this;
    }

    private invalidateLegalMovesCache(): void {
        this._legalMovesCache = undefined;
    }

    private marbleAvailable(colour: MarbleColour): boolean {
        if (this.pool[colour] > 0) {
            return true;
        }
        return this.captured[this.currplayer - 1][colour] > 0;
    }

    private jumpCaptureRequired(): boolean {
        return anyJumpExists(this.graph, this.rings, this.marbles);
    }

    private poolHasMarbles(): boolean {
        return MARBLE_COLOURS.some((c) => this.pool[c] > 0);
    }

    private turnPromptMessage(): string {
        if (this.jumpCaptureRequired()) {
            return i18next.t("apgames:validation.zertz.INITIAL_INSTRUCTIONS_CAPTURE");
        }
        if (this.poolHasMarbles()) {
            return i18next.t("apgames:validation.zertz.INITIAL_INSTRUCTIONS_POOL");
        }
        return i18next.t("apgames:validation.zertz.INITIAL_INSTRUCTIONS_CAPTURED");
    }

    private partialPromptMessage(m: string): string {
        if (m.startsWith("x")) {
            return i18next.t("apgames:validation.zertz.INITIAL_INSTRUCTIONS_CAPTURE");
        }
        if (/^[wgb]$/.test(m)) {
            return i18next.t("apgames:validation.zertz.PARTIAL_PLACE");
        }
        if (/^[wgb][a-z]+\d+$/.test(m) && !m.includes(",")) {
            return i18next.t("apgames:validation.zertz.PARTIAL_REMOVE");
        }
        if (/^[wgb][a-z]+\d+,/.test(m)) {
            return i18next.t("apgames:validation.zertz.PARTIAL_REMOVE");
        }
        return this.turnPromptMessage();
    }

    private takeMarbleForPlacement(colour: MarbleColour): "pool" | "captured" | undefined {
        if (this.pool[colour] > 0) {
            return "pool";
        }
        if (this.captured[this.currplayer - 1][colour] > 0) {
            return "captured";
        }
        return undefined;
    }

    private vacantRings(): string[] {
        const out: string[] = [];
        for (const cell of this.rings) {
            if (!this.marbles.has(cell)) {
                out.push(cell);
            }
        }
        return out.sort((a, b) => a.localeCompare(b));
    }

    private buildPlacementMove(
        colour: MarbleColour,
        cell: string,
        remove: string | undefined,
    ): PlacementMove {
        const newRings = new Set(this.rings);
        const newMarbles = new Map(this.marbles);
        newMarbles.set(cell, colour);
        if (remove !== undefined) {
            newRings.delete(remove);
        }
        const iso = isolationCaptures(this.graph, newRings, newMarbles, cell);
        return {
            kind: "place",
            colour,
            cell,
            remove,
            isolation:
                iso.length > 0
                    ? iso.map((x) => ({ colour: x.colour, cell: x.cell }))
                    : undefined,
        };
    }

    private removablesAfterPlacement(cell: string, colour: MarbleColour): string[] {
        return removableRingsAfterPlacement(this.graph, this.rings, this.marbles, cell, colour);
    }

    private legalPlacementStrings(): string[] {
        const moves: string[] = [];
        const vacant = this.vacantRings();
        for (const colour of MARBLE_COLOURS) {
            if (!this.marbleAvailable(colour)) {
                continue;
            }
            for (const cell of vacant) {
                const remAfter = this.removablesAfterPlacement(cell, colour);
                if (remAfter.length === 0) {
                    moves.push(formatPlacementMove(this.buildPlacementMove(colour, cell, undefined)));
                } else {
                    for (const remove of remAfter) {
                        moves.push(formatPlacementMove(this.buildPlacementMove(colour, cell, remove)));
                    }
                }
            }
        }
        return moves.sort((a, b) => a.localeCompare(b));
    }

    private legalJumpStrings(): string[] {
        return enumerateJumpChains(this.graph, this.rings, this.marbles)
            .map((steps) => formatJumpMove(steps))
            .sort((a, b) => a.localeCompare(b));
    }

    private computeLegalMoves(): string[] {
        if (this.gameover) {
            return [];
        }
        if (this.jumpCaptureRequired()) {
            return this.legalJumpStrings();
        }
        return this.legalPlacementStrings();
    }

    public moves(): string[] {
        if (this._legalMovesCache === undefined) {
            this._legalMovesCache = this.computeLegalMoves();
        }
        return this._legalMovesCache;
    }

    private resolveJumpSteps(parsed: JumpStep[]): JumpStep[] | undefined {
        return resolveJumpOvers(parsed, (from, to) => cellBetween(this.graph, from, to));
    }

    private validateJumpSteps(steps: JumpStep[]): boolean {
        const rings = new Set(this.rings);
        const marbles = new Map(this.marbles);
        for (const step of steps) {
            if (!rings.has(step.from) || !marbles.has(step.from)) {
                return false;
            }
            if (!rings.has(step.over) || !marbles.has(step.over)) {
                return false;
            }
            if (marbles.get(step.over) !== step.overColour) {
                return false;
            }
            if (!rings.has(step.to) || marbles.has(step.to)) {
                return false;
            }
            if (cellBetween(this.graph, step.from, step.to) !== step.over) {
                return false;
            }
            const moving = marbles.get(step.from)!;
            marbles.delete(step.over);
            marbles.delete(step.from);
            marbles.set(step.to, moving);
        }
        return true;
    }

    /** Placement colour + cell only (ring removal still to come). */
    private validatePlacementPendingRemove(move: PlacementMove): boolean {
        if (!this.rings.has(move.cell) || this.marbles.has(move.cell)) {
            return false;
        }
        return this.takeMarbleForPlacement(move.colour) !== undefined;
    }

    private validatePlacement(move: PlacementMove): boolean {
        if (!this.rings.has(move.cell) || this.marbles.has(move.cell)) {
            return false;
        }
        if (this.takeMarbleForPlacement(move.colour) === undefined) {
            return false;
        }
        const remAfter = this.removablesAfterPlacement(move.cell, move.colour);
        if (move.remove !== undefined) {
            if (move.remove === move.cell) {
                return false;
            }
            if (!remAfter.includes(move.remove)) {
                return false;
            }
        } else if (remAfter.length > 0) {
            return false;
        }
        const built = this.buildPlacementMove(move.colour, move.cell, move.remove);
        if (move.isolation !== undefined) {
            const want = [...move.isolation].sort((a, b) => a.cell.localeCompare(b.cell));
            const got = [...(built.isolation ?? [])].sort((a, b) => a.cell.localeCompare(b.cell));
            if (want.length !== got.length) {
                return false;
            }
            for (let i = 0; i < want.length; i++) {
                if (want[i]!.cell !== got[i]!.cell || want[i]!.colour !== got[i]!.colour) {
                    return false;
                }
            }
        }
        return true;
    }

    private marbleColourWord(colour: MarbleColour): string {
        switch (colour) {
            case "W":
                return "white";
            case "G":
                return "grey";
            case "B":
                return "black";
        }
    }

    /** Specific validation message when a parsed placement is not legal (before generic invalid move). */
    private placementRejectionMessage(move: PlacementMove): string | undefined {
        if (this.jumpCaptureRequired()) {
            return i18next.t("apgames:validation.zertz.MUST_JUMP");
        }
        if (!this.rings.has(move.cell)) {
            return i18next.t("apgames:validation.zertz.BAD_PLACE", { where: move.cell });
        }
        if (this.marbles.has(move.cell)) {
            return i18next.t("apgames:validation.zertz.BAD_PLACE", { where: move.cell });
        }
        if (this.takeMarbleForPlacement(move.colour) === undefined) {
            return i18next.t("apgames:validation.zertz.NO_MARBLE", {
                colour: this.marbleColourWord(move.colour),
            });
        }
        const remAfter = this.removablesAfterPlacement(move.cell, move.colour);
        if (move.remove === undefined) {
            if (remAfter.length > 0) {
                return i18next.t("apgames:validation.zertz.MUST_CHOOSE_REMOVE");
            }
            if (!this.validatePlacement(move)) {
                return i18next.t("apgames:validation._general.INVALID_MOVE", { move: formatPlacementMove(move) });
            }
            return undefined;
        }
        if (move.remove === move.cell) {
            return i18next.t("apgames:validation.zertz.REMOVE_SAME_AS_PLACE");
        }
        if (!this.rings.has(move.remove)) {
            return i18next.t("apgames:validation.zertz.BAD_PLACE", { where: move.remove });
        }
        const afterPlace = new Map(this.marbles);
        afterPlace.set(move.cell, move.colour);
        if (afterPlace.has(move.remove)) {
            return i18next.t("apgames:validation.zertz.REMOVE_OCCUPIED", { where: move.remove });
        }
        if (!remAfter.includes(move.remove)) {
            if (!isRingSlidable(this.graph, this.rings, move.remove)) {
                return i18next.t("apgames:validation.zertz.RING_NOT_FREE", { where: move.remove });
            }
            return i18next.t("apgames:validation.zertz.RING_NOT_FREE", { where: move.remove });
        }
        if (!this.validatePlacement(move)) {
            return i18next.t("apgames:validation._general.INVALID_MOVE", { move: formatPlacementMove(move) });
        }
        return undefined;
    }

    private suggestAutocomplete(m: string, legal: string[]): string | undefined {
        if (m.length === 0) {
            if (legal.length === 1) {
                return legal[0];
            }
            return undefined;
        }
        const matches = legal.filter((mv) => mv.toLowerCase().startsWith(m.toLowerCase()));
        if (matches.length === 1 && matches[0]!.toLowerCase() !== m.toLowerCase()) {
            return matches[0];
        }
        return undefined;
    }

    private static moveKey(m: string): string {
        return m.toLowerCase().replace(/\s+/g, "");
    }

    public validateMove(m: string, { legal: legalIn }: { legal?: string[] } = {}): IValidationResult {
        const result: IValidationResult = {
            valid: false,
            complete: -1,
            message: i18next.t("apgames:validation._general.DEFAULT_HANDLER"),
        };

        m = m.toLowerCase().replace(/\s+/g, "");

        const legal = legalIn ?? this.moves();

        if (m.length === 0) {
            result.valid = true;
            result.message = this.turnPromptMessage();
            const suggested = this.suggestAutocomplete(m, legal);
            if (suggested !== undefined) {
                result.autocomplete = suggested;
                result.complete = 1;
                result.canrender = true;
            }
            return result;
        }

        const suggested = this.suggestAutocomplete(m, legal);
        if (suggested !== undefined) {
            result.autocomplete = suggested;
            if (legal.length === 1 && suggested === legal[0]) {
                result.complete = 1;
            }
        }

        if (legal.some((mv) => ZertzGame.moveKey(mv) === m)) {
            result.valid = true;
            result.complete = 1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        const prefixes = legal.filter((mv) => ZertzGame.moveKey(mv).startsWith(m));
        if (prefixes.length > 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = this.partialPromptMessage(m);
            return result;
        }

        if (this.jumpCaptureRequired() && !m.startsWith("x")) {
            result.message = i18next.t("apgames:validation.zertz.MUST_JUMP");
            return result;
        }

        const parsed = parseMove(m);
        if (parsed?.kind === "place") {
            const placementMsg = this.placementRejectionMessage(parsed);
            if (placementMsg !== undefined) {
                result.message = placementMsg;
                return result;
            }
        } else if (parsed?.kind === "jump") {
            const resolved = this.resolveJumpSteps(parsed.steps);
            if (resolved === undefined || !this.validateJumpSteps(resolved)) {
                result.message = i18next.t("apgames:validation.zertz.BAD_JUMP");
                return result;
            }
        }

        result.message = i18next.t("apgames:validation._general.INVALID_MOVE", { move: m });
        return result;
    }

    private jumperAtPartial(m: string): string | undefined {
        if (!m.startsWith("x")) {
            return undefined;
        }
        const body = m.slice(1);
        const start = body.match(/^([a-z]+\d+)/);
        if (start === null) {
            return undefined;
        }
        let at = start[1]!;
        const rest = body.slice(at.length);
        const stepRe = /[wgb]([a-z]+\d+)/gi;
        let sm: RegExpExecArray | null;
        while ((sm = stepRe.exec(rest)) !== null) {
            at = sm[1]!;
        }
        return at;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = move.toLowerCase().replace(/\s+/g, "");
            const jumping = this.jumpCaptureRequired();

            if (row < 0 || col < 0) {
                if (jumping) {
                    return {
                        move,
                        valid: false,
                        message: i18next.t("apgames:validation.zertz.MUST_JUMP"),
                    };
                }
                if (piece === undefined) {
                    return { move, valid: false, message: "" };
                }
                const c = ZertzGame.marbleFromAreaPiece(piece);
                if (c === undefined) {
                    return { move, valid: false, message: "" };
                }
                newmove = c.toLowerCase();
            } else {
                const cell = this.graph.coords2algebraic(col, row);
                if (jumping && /^[wgb]/.test(newmove)) {
                    return {
                        move,
                        valid: false,
                        message: i18next.t("apgames:validation.zertz.MUST_JUMP"),
                    };
                }
                if (jumping) {
                    if (newmove.length === 0) {
                        if (this.marbles.has(cell)) {
                            newmove = `x${cell}`;
                        }
                    } else if (newmove.startsWith("x")) {
                        const from = this.jumperAtPartial(newmove);
                        if (from !== undefined) {
                            const over = cellBetween(this.graph, from, cell);
                            if (
                                over !== undefined &&
                                this.marbles.has(over) &&
                                this.rings.has(cell) &&
                                !this.marbles.has(cell)
                            ) {
                                const oc = this.marbles.get(over)!;
                                newmove += `${oc.toLowerCase()}${cell}`;
                            } else if (this.marbles.has(cell) && newmove === "x") {
                                newmove = `x${cell}`;
                            }
                        }
                    }
                } else {
                    if (/^[wgb]$/.test(newmove)) {
                        newmove = `${newmove}${cell}`;
                    } else if (/^[wgb][a-z]+\d+$/.test(newmove) && !newmove.includes(",")) {
                        newmove = `${newmove},${cell}`;
                    }
                }
            }

            const legal = this.moves();
            const matches = legal.filter((mv) => mv.toLowerCase().startsWith(newmove));
            if (matches.length === 1) {
                newmove = matches[0]!.toLowerCase();
            }

            const result = this.validateMove(newmove, { legal }) as IClickResult;
            if (!result.valid) {
                result.move = move;
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

    private applyIsolation(
        iso: Array<{ colour: MarbleColour; cell: string }>,
        actor: playerid,
    ): void {
        for (const entry of iso) {
            this.rings.delete(entry.cell);
            this.marbles.delete(entry.cell);
            this.captured[actor - 1] = incrementCapture(this.captured[actor - 1], entry.colour);
            this.results.push({ type: "remove", where: entry.cell });
            this.results.push({
                type: "capture",
                where: entry.cell,
                what: entry.colour,
            });
        }
    }

    public move(m: string, { trusted = false, partial = false } = {}): ZertzGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:validation._general.MOVES_GAMEOVER"));
        }

        m = m.toLowerCase().replace(/\s+/g, "");
        if (m.length === 0) {
            return this;
        }

        const validation = this.validateMove(m);
        if (!trusted) {
            if (!validation.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", validation.message);
            }
            if (!partial && validation.complete !== 1) {
                throw new UserFacingError("VALIDATION_GENERAL", validation.message);
            }
        }
        const actor = this.currplayer;
        this.results = [];
        const parsed = parseMove(m);
        if (parsed === undefined) {
            if (partial) {
                return this;
            }
            throw new UserFacingError("VALIDATION_GENERAL", validation.message);
        }

        if (partial && validation.complete !== 1) {
            if (
                parsed.kind === "place" &&
                parsed.remove === undefined &&
                this.removablesAfterPlacement(parsed.cell, parsed.colour).length > 0 &&
                this.validatePlacementPendingRemove(parsed)
            ) {
                const source = this.takeMarbleForPlacement(parsed.colour);
                if (source === "pool") {
                    this.pool[parsed.colour]--;
                } else if (source === "captured") {
                    decrementCapture(this.captured[actor - 1], parsed.colour);
                }
                this.marbles.set(parsed.cell, parsed.colour);
                this.results.push({ type: "place", what: parsed.colour, where: parsed.cell });
                this.invalidateLegalMovesCache();
            }
            return this;
        }

        if (parsed.kind === "jump") {
            if (this.jumpCaptureRequired() === false) {
                throw new UserFacingError("VALIDATION_GENERAL", validation.message);
            }
            const resolved = this.resolveJumpSteps(parsed.steps);
            if (resolved === undefined || !this.validateJumpSteps(resolved)) {
                throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation.zertz.BAD_JUMP"));
            }
            for (const step of resolved) {
                const moving = this.marbles.get(step.from)!;
                this.marbles.delete(step.over);
                this.marbles.delete(step.from);
                this.marbles.set(step.to, moving);
                this.captured[actor - 1] = incrementCapture(
                    this.captured[actor - 1],
                    step.overColour,
                );
                this.results.push({ type: "move", from: step.from, to: step.to });
                this.results.push({
                    type: "capture",
                    where: step.over,
                    what: step.overColour,
                });
            }
        } else {
            if (this.jumpCaptureRequired()) {
                throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation.zertz.MUST_JUMP"));
            }
            if (!this.validatePlacement(parsed)) {
                throw new UserFacingError("VALIDATION_GENERAL", validation.message);
            }
            const source = this.takeMarbleForPlacement(parsed.colour);
            if (source === "pool") {
                this.pool[parsed.colour]--;
            } else if (source === "captured") {
                decrementCapture(this.captured[actor - 1], parsed.colour);
            }
            this.marbles.set(parsed.cell, parsed.colour);
            this.results.push({ type: "place", what: parsed.colour, where: parsed.cell });
            if (parsed.remove !== undefined) {
                this.rings.delete(parsed.remove);
                this.results.push({ type: "remove", where: parsed.remove });
            }
            const built = this.buildPlacementMove(parsed.colour, parsed.cell, parsed.remove);
            if (built.isolation !== undefined) {
                this.applyIsolation(built.isolation, actor);
            }
        }

        this.invalidateLegalMovesCache();

        if (partial) {
            return this;
        }

        this.lastmove = m;
        this.currplayer = this.currplayer === 1 ? 2 : 1;
        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): ZertzGame {
        const blitz = this.isBlitz;
        const w1 = playerWins(this.captured[0], blitz);
        const w2 = playerWins(this.captured[1], blitz);
        let eogReason: string | undefined;
        if (w1 || w2) {
            this.gameover = true;
            if (w1 && w2) {
                this.winner = [1, 2];
            } else if (w1) {
                this.winner = [1];
            } else {
                this.winner = [2];
            }
            const seat = this.winner[0]!;
            eogReason = captureWinReason(this.captured[seat - 1], blitz);
        } else if (this.vacantRings().length === 0 && this.rings.size > 0) {
            this.gameover = true;
            const last = this.currplayer === 1 ? 2 : 1;
            this.winner = [last];
            eogReason = "full";
        }

        if (this.gameover) {
            this.results.push(
                { type: "eog", reason: eogReason },
                { type: "winners", players: [...this.winner] },
            );
        }
        return this;
    }

    protected zertzEogWinnerSeat(ctx: ChatLogCollectContext): number {
        const winResult = ctx.results.find((x) => x.type === "winners");
        if (winResult?.type === "winners" && winResult.players.length > 0) {
            return winResult.players[0]!;
        }
        if (this.winner.length > 0) {
            return this.winner[0]!;
        }
        return ctx.defaultSeat;
    }

    protected eogChatLineOverride(
        r: Extract<APMoveResult, { type: "eog" }>,
        ctx: ChatLogCollectContext,
    ): ChatLogLine | undefined {
        if (r.reason === "repetition") {
            return {
                actor: { kind: "none" },
                textKey: "apresults:zertz.EOG.repetition",
            };
        }
        const winnerSeat = this.zertzEogWinnerSeat(ctx);
        const params: Record<string, string | number> = {
            player: chatPlayerToken(winnerSeat),
        };
        if (r.reason === "each" || r.reason === "white" || r.reason === "grey" || r.reason === "black") {
            params.count = captureWinThreshold(r.reason as CaptureWinReason, this.isBlitz);
        }
        return {
            actor: this.getChatActorRef(winnerSeat),
            textKey: `apresults:zertz.EOG.${r.reason ?? "full"}`,
            textParams: params,
        };
    }

    public eogSubjectSeat(): number | undefined {
        return this.winner.length > 0 ? this.winner[0] : undefined;
    }

    public moveState(): IMoveState {
        return {
            _version: ZertzGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            rings: new Set(this.rings),
            marbles: new Map(this.marbles),
            pool: cloneMarbleCounts(this.pool),
            captured: [cloneMarbleCounts(this.captured[0]), cloneMarbleCounts(this.captured[1])],
            repetition: new Map(this.repetition),
        };
    }

    public state(): IZertzState {
        return {
            game: ZertzGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    /**
     * Area piece legend keys (marble only). Must differ from board keys {@link MARBLE_COLOURS}
     * by more than case — legend keys become SVG element ids for `<use href="#…">`.
     */
    private static areaMarbleKey(colour: MarbleColour): string {
        return `a${colour}`;
    }

    /** Map a pool/captured area piece key to a marble colour for move building. */
    private static marbleFromAreaPiece(piece: string): MarbleColour | undefined {
        if (piece.length === 2 && piece.startsWith("a")) {
            const c = piece[1]!.toUpperCase();
            if (c === "W" || c === "G" || c === "B") {
                return c;
            }
        }
        return undefined;
    }

    private areaPiecesFromCounts(counts: MarbleCounts): string[] {
        const pieces: string[] = [];
        for (const c of MARBLE_COLOURS) {
            for (let i = 0; i < counts[c]; i++) {
                pieces.push(ZertzGame.areaMarbleKey(c));
            }
        }
        return pieces;
    }

    public render(): APRenderRep {
        const layout = this.getLayout();
        const graph = layout.graph;
        let pstr = "";
        for (const row of graph.listCells(true) as string[][]) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const cells: string[] = [];
            for (const cell of row) {
                if (!this.rings.has(cell)) {
                    cells.push("-");
                } else if (this.marbles.has(cell)) {
                    cells.push(this.marbles.get(cell)!);
                } else {
                    cells.push("R");
                }
            }
            pstr += cells.join(",");
        }

        const ring = ringGlyph();
        const legend: APRenderRep["legend"] = {
            R: ring,
            W: [ring, marbleGlyph("W")],
            G: [ring, marbleGlyph("G")],
            B: [ring, marbleGlyph("B")],
            aW: areaMarbleGlyph("W"),
            aG: areaMarbleGlyph("G"),
            aB: areaMarbleGlyph("B"),
        };

        const options: NonNullable<APRenderRep["options"]> = [];
        if (layout.reverseNumbers) {
            options.push("reverse-numbers");
        }
        if (layout.reverseLetters) {
            options.push("reverse-letters");
        }

        const areas: AreaPieces[] = [];
        const poolPieces = this.areaPiecesFromCounts(this.pool);
        if (poolPieces.length > 0) {
            areas.push({
                type: "pieces",
                pieces: poolPieces as [string, ...string[]],
                label: this.neutralAreaLabel("apgames:validation.zertz.POOL_LABEL"),
            });
        }
        for (const seat of [1, 2] as playerid[]) {
            const cap = this.areaPiecesFromCounts(this.captured[seat - 1]);
            if (cap.length > 0) {
                areas.push({
                    type: "pieces",
                    pieces: cap as [string, ...string[]],
                    label: this.seatAreaLabel(seat, "apgames:validation.zertz.CAPTURED_LABEL"),
                });
            }
        }

        const rep: APRenderRep = {
            options: options.length > 0 ? options : undefined,
            board: {
                style: "hex-of-tri",
                minWidth: layout.minWidth,
                maxWidth: layout.maxWidth,
                rotate: layout.rotate,
                alternatingSymmetry: layout.alternatingSymmetry,
                strokeOpacity: 0,
            },
            legend,
            pieces: pstr,
            areas: areas.length > 0 ? areas : undefined,
        };

        rep.annotations = [];
        for (const r of this.results) {
            if (r.type === "place" && r.where) {
                const [x, y] = graph.algebraic2coords(r.where);
                rep.annotations!.push({
                    type: "enter",
                    shape: "circle",
                    targets: [{ row: y, col: x }],
                });
            } else if (r.type === "move" && r.from && r.to) {
                const [fx, fy] = graph.algebraic2coords(r.from);
                const [tx, ty] = graph.algebraic2coords(r.to);
                rep.annotations!.push({
                    type: "move",
                    targets: [
                        { row: fy, col: fx },
                        { row: ty, col: tx },
                    ],
                });
            } else if (r.type === "remove" && r.where) {
                const [x, y] = graph.algebraic2coords(r.where);
                rep.annotations!.push({
                    type: "exit",
                    shape: "circle",
                    targets: [{ row: y, col: x }],
                });
            } else if (r.type === "capture" && r.where) {
                const [x, y] = graph.algebraic2coords(r.where);
                rep.annotations!.push({
                    type: "exit",
                    shape: "circle",
                    targets: [{ row: y, col: x }],
                });
            }
        }

        return rep;
    }

    public clone(): ZertzGame {
        return new ZertzGame(this.state());
    }

    public randomMove(): string {
        const mv = this.moves();
        if (mv.length === 0) {
            return "";
        }
        return mv[Math.floor(Math.random() * mv.length)]!;
    }
}