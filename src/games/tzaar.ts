import {
    GameBase,
    IAPGameState,
    IClickResult,
    ICustomButton,
    IIndividualState,
    IRenderOpts,
    IValidationResult,
    chatPlayerToken,
    type ChatLogCollectContext,
    type ChatLogLine,
    type FlagContext,
    type GameFlag,
    type IScores,
} from "./_base.js";
import type { APGamesInformation } from "../schemas/gameinfo.js";
import type { APRenderRep, Colourfuncs, Glyph, RowCol } from "@abstractplay/renderer/build/schemas/schema";

type FlatLegend = NonNullable<APRenderRep["legend"]>;
import type { APMoveResult } from "../schemas/moveresults.js";
import { cloneState, reviver, UserFacingError } from "../common/index.js";
import i18next from "i18next";
import { TzaarGraph, TZAAR_BLOCKED_RENDER } from "./tzaar/graph.js";
import {
    GIPF_CHARIOT_BORDER,
    GIPF_P1,
    GIPF_P1_CHARIOT_INNER,
    GIPF_P2,
    GIPF_P2_CHARIOT_INNER,
    GIPF_PIECE_BORDER,
} from "./gipf/types.js";
import type { GameRng } from "../common/rng.js";
import {
    applyCapture,
    applyStrengthen,
    topKind,
    allCaptureMoves,
    cloneBoardForSim,
    hasForcedCapture,
    legalSlideDestinations,
} from "./tzaar/move.js";
import {
    formatPlayLeg,
    formatSetupPlace,
    nextSetupKind,
    parsePlayLeg,
    parsePlayMove,
    parseSetupPlace,
    type PlayLeg,
} from "./tzaar/notation.js";
import {
    buildFixedBoard,
    buildRandomBoard,
    cloneBoard,
    cloneReserves,
    decrementReserve,
    emptyBoard,
    serializeBoard,
    tournamentReserves,
    availablePieceCounts,
    formatPieceCountLine,
} from "./tzaar/setup.js";
import {
    PIECE_KIND_LABEL,
    type CellStack,
    type PendingSetup,
    type Phase,
    type PieceKind,
    type playerid,
    type Reserves,
    type SlideMode,
} from "./tzaar/types.js";
import { lacksTrinity, visiblePieceCounts, type WinReason } from "./tzaar/win.js";

const BASIC_OVERLAY_SCALE = 0.85;
const FLAT_HEIGHT_TEXT_SCALE = 0.75;

const TOTT_BORDER_DEFAULT = "#33a02c";
const TZARRA_BORDER_DEFAULT = "#1f78b4";
const TZAAR_BORDER_DEFAULT = "#e31a1c";

const P1_TZARRA_BORDER: Colourfuncs = { func: "custom", default: GIPF_CHARIOT_BORDER, palette: 5 };
const P1_TZARRA_INNER: Colourfuncs = { func: "custom", default: GIPF_P1_CHARIOT_INNER, palette: 6 };
const P2_TZARRA_BORDER: Colourfuncs = { func: "custom", default: GIPF_CHARIOT_BORDER, palette: 7 };
const P2_TZARRA_INNER: Colourfuncs = { func: "custom", default: GIPF_P2_CHARIOT_INNER, palette: 8 };
const P1_TZAAR_BORDER: Colourfuncs = { func: "custom", default: GIPF_CHARIOT_BORDER, palette: 9 };
const P1_TZAAR_INNER: Colourfuncs = { func: "custom", default: GIPF_P1_CHARIOT_INNER, palette: 10 };
const P2_TZAAR_BORDER: Colourfuncs = { func: "custom", default: GIPF_CHARIOT_BORDER, palette: 11 };
const P2_TZAAR_INNER: Colourfuncs = { func: "custom", default: GIPF_P2_CHARIOT_INNER, palette: 12 };

function contrastBorder(fill: Colourfuncs, palette: 3 | 4): Colourfuncs {
    return {
        func: "custom",
        default: { func: "bestContrast", bg: fill, fg: ["#000000", "#ffffff"] },
        palette,
    };
}

function basicPieceLegend(fill: Colourfuncs, borderPalette: 3 | 4): [Glyph, Glyph] {
    const border: Colourfuncs = { func: "custom", default: GIPF_PIECE_BORDER, palette: borderPalette };
    return [
        { name: "piece", paint: { fill, border } },
        {
            name: "piece",
            scale: BASIC_OVERLAY_SCALE,
            paint: { fill, border: contrastBorder(fill, borderPalette) },
        },
    ];
}

/** Stacking-offset overlay reuses Tzarra border/inner — not Tott palette 3/4 (that painted a green rim on horses). */
function tzarraPieceLegend(fill: Colourfuncs, border: Colourfuncs, inner: Colourfuncs): [Glyph, Glyph] {
    const paint = { fill, border, inner };
    return [
        { name: "piece-horse", paint },
        { name: "piece-horse", scale: BASIC_OVERLAY_SCALE, paint },
    ];
}

function p1TzarraLegend(fill: Colourfuncs): [Glyph, Glyph] {
    return tzarraPieceLegend(fill, P1_TZARRA_BORDER, P1_TZARRA_INNER);
}

function p2TzarraLegend(fill: Colourfuncs): [Glyph, Glyph] {
    return tzarraPieceLegend(fill, P2_TZARRA_BORDER, P2_TZARRA_INNER);
}

function flatTypeBorder(owner: playerid, kind: PieceKind): Colourfuncs {
    const defaultByKind: Record<PieceKind, string> = {
        tott: TOTT_BORDER_DEFAULT,
        tzarra: TZARRA_BORDER_DEFAULT,
        tzaar: TZAAR_BORDER_DEFAULT,
    };
    const paletteByKind: Record<PieceKind, Record<playerid, 3 | 4 | 5 | 7 | 9 | 11>> = {
        tott: { 1: 3, 2: 4 },
        tzarra: { 1: 5, 2: 7 },
        tzaar: { 1: 9, 2: 11 },
    };
    return { func: "custom", default: defaultByKind[kind], palette: paletteByKind[kind][owner] };
}

/** Flat display: plain discs; rim colour encodes piece type (palette slots unchanged for customize). */
function buildFlatBaseLegend(p1: Colourfuncs, p2: Colourfuncs): FlatLegend {
    const flatPiece = (fill: Colourfuncs, owner: playerid, kind: PieceKind): Glyph => ({
        name: "piece",
        paint: { fill, border: flatTypeBorder(owner, kind) },
    });
    return {
        A: flatPiece(p1, 1, "tott"),
        B: flatPiece(p1, 1, "tzarra"),
        C: flatPiece(p1, 1, "tzaar"),
        X: flatPiece(p2, 2, "tott"),
        Y: flatPiece(p2, 2, "tzarra"),
        Z: flatPiece(p2, 2, "tzaar"),
    };
}

function pieceGlyph(owner: playerid, kind: PieceKind): string {
    if (owner === 1) {
        return kind === "tott" ? "A" : kind === "tzarra" ? "B" : "C";
    }
    return kind === "tott" ? "X" : kind === "tzarra" ? "Y" : "Z";
}

const SETUP_KIND_ORDER: readonly PieceKind[] = ["tott", "tzarra", "tzaar"];

function firstSetupKindWithReserve(reserves: Reserves, player: playerid): PieceKind | undefined {
    const seat = reserves[player - 1]!;
    for (const kind of SETUP_KIND_ORDER) {
        if (seat[kind] > 0) {
            return kind;
        }
    }
    return undefined;
}

/** Next tournament-setup notation when clicking the same empty cell again (move box is the source of truth). */
function advanceTournamentSetupClick(
    move: string,
    cell: string,
    reserves: Reserves,
    player: playerid,
): string | undefined {
    const seat = reserves[player - 1]!;
    const first = (): string | undefined => {
        const kind = firstSetupKindWithReserve(reserves, player);
        return kind === undefined ? undefined : formatSetupPlace(cell, kind);
    };
    if (move.length === 0) {
        return first();
    }
    const place = parseSetupPlace(move);
    if (place === undefined || place.cell !== cell) {
        return first();
    }
    if (move.startsWith("!")) {
        return first();
    }
    let current = place.kind;
    for (let step = 0; step < SETUP_KIND_ORDER.length; step++) {
        const next = nextSetupKind(current);
        if (next === undefined) {
            return `!${cell}`;
        }
        if (seat[next] > 0) {
            return formatSetupPlace(cell, next);
        }
        current = next;
    }
    return `!${cell}`;
}

/** Buried discs use plain Tott glyphs so stack height reads cleanly. */
function stackGlyphs(owner: playerid, pieces: PieceKind[]): string[] {
    const buried = owner === 1 ? "A" : "X";
    return pieces.map((kind, i) =>
        i === pieces.length - 1 ? pieceGlyph(owner, kind) : buried,
    );
}

export const gameApgamesEn = {
    validation: {
        INITIAL_INSTRUCTIONS: "Capture an opponent's piece by sliding one of your stacks onto it.",
        INITIAL_INSTRUCTIONS_SECOND:
            "Make a second capture, strengthen a stack, or press Pass.",
        INITIAL_INSTRUCTIONS_OPENING: "White's opening move: make one capture.",
        INITIAL_INSTRUCTIONS_SETUP:
            "Click an empty intersection to choose a piece type, then click again to place it.",
        BLOCKED: "That intersection is not on the board.",
        OCCUPIED: "That intersection is already occupied.",
        MUST_CAPTURE_FIRST: "The first action of your turn must be a capture.",
        MUST_CAPTURE_OPENING: "The opening move must be a capture.",
        INVALID_LEG: "That slide is not legal.",
        NO_RESERVE: "You do not have that piece type left in your reserve.",
        NO_CAPTURES_FROM: "There are no valid captures for the stack at {{where}}.",
        NO_SECOND_ACTION_FROM:
            "There are no valid captures or strengthen moves for the stack at {{where}}.",
    },
    displays: {
        "#projection": {
            name: "Flat view",
            description: "Top piece only on each stack, with height shown as a numeral when greater than one.",
        },
        stacked: {
            name: "Stacked view",
            description: "Offset stacks showing every disc in the pile.",
        },
    },
    variants: {
        "#setup": {
            name: "Fixed setup",
        },
        random: {
            name: "Random setup",
            description: "All pieces are placed on the board at random.",
        },
        tournament: {
            name: "Tournament setup",
            description: "Players alternate placing pieces from their reserve before play.",
        },
    },
    status: {
        PIECES: "Pieces (Tott/Tzarra/Tzaar)",
    },
};

export const gameApresultsEn = {
    PLACE: {
        default: "{{player}} placed a {{piece}} at {{where}}.",
    },
    MOVE: {
        capture: "{{player}} moved from {{from}} to {{to}}, capturing a {{piece}}.",
        strengthen: "{{player}} strengthened from {{from}} to {{to}}.",
        pass: "{{player}} passed the second action.",
    },
    EOG: {
        types: "{{player}} wins — the opponent no longer has all three piece types on the board.",
        immobilize: "{{player}} wins — the opponent cannot make a forced capture.",
    },
};

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    phase: Phase;
    board: Map<string, CellStack>;
    reserves?: Reserves;
    pendingSetup?: PendingSetup;
    pendingFirst?: PlayLeg;
    lastmove?: string;
}

export interface ITzaarState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
}

export function playStartStackIndex(stack: Array<{ phase: Phase }>): number {
    for (let i = 0; i < stack.length; i++) {
        if (stack[i]!.phase === "play") {
            if (i === 0) {
                return 0;
            }
            if (stack[i - 1]!.phase === "setup") {
                return i;
            }
        }
    }
    return 0;
}

export class TzaarGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "TZAAR",
        uid: "tzaar",
        playercounts: [2],
        version: "20261122",
        dateAdded: "2026-11-22",
        description:
            "Stack and capture on a hex board. Keep at least one Tzaar, Tzarra, and Tott on top, or trap the opponent with no legal capture.",
        urls: [
            "https://www.gipf.com/tzaar/rules/rules.html",
            "https://boardgamegeek.com/boardgame/31999/tzaar",
        ],
        bggid: "31999",
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
            { uid: "random", group: "setup" },
            { uid: "tournament", group: "setup" },
        ],
        displays: [{ uid: "stacked", group: "projection" }],
        customizations: [
            { num: 1, default: GIPF_P1, explanation: "Player 1 piece fill", player: 1 },
            { num: 2, default: GIPF_P2, explanation: "Player 2 piece fill", player: 2 },
            { num: 3, default: TOTT_BORDER_DEFAULT, explanation: "Player 1 Tott border", player: 1 },
            { num: 4, default: TOTT_BORDER_DEFAULT, explanation: "Player 2 Tott border", player: 2 },
            { num: 5, default: TZARRA_BORDER_DEFAULT, explanation: "Player 1 Tzarra border", player: 1 },
            { num: 6, default: GIPF_P1_CHARIOT_INNER, explanation: "Player 1 Tzarra inner", player: 1 },
            { num: 7, default: TZARRA_BORDER_DEFAULT, explanation: "Player 2 Tzarra border", player: 2 },
            { num: 8, default: GIPF_P2_CHARIOT_INNER, explanation: "Player 2 Tzarra inner", player: 2 },
            { num: 9, default: TZAAR_BORDER_DEFAULT, explanation: "Player 1 Tzaar border", player: 1 },
            { num: 10, default: GIPF_P1_CHARIOT_INNER, explanation: "Player 1 Tzaar inner", player: 1 },
            { num: 11, default: TZAAR_BORDER_DEFAULT, explanation: "Player 2 Tzaar border", player: 2 },
            { num: 12, default: GIPF_P2_CHARIOT_INNER, explanation: "Player 2 Tzaar inner", player: 2 },
        ],
        categories: [
            "goal>eliminate",
            "goal>immobilize",
            "mechanic>move",
            "mechanic>capture",
            "mechanic>stack",
            "board>shape>hex",
            "board>connect>hex",
            "components>special",
            "family>gipf",
        ],
        flags: ["custom-colours", "automove", "custom-buttons", "experimental"],
    };

    public static resolveFlags(context: FlagContext = {}): readonly GameFlag[] {
        const flags: GameFlag[] = [...(this.gameinfo.flags ?? [])];
        if (context.variants?.includes("random")) {
            flags.push("random-start");
        }
        return flags;
    }

    public readonly graph = new TzaarGraph();
    public numplayers = 2;
    public currplayer: playerid = 1;
    public phase: Phase = "play";
    public board!: Map<string, CellStack>;
    public reserves?: Reserves;
    public pendingSetup?: PendingSetup;
    public pendingFirst?: PlayLeg;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    /** Ephemeral UI: legal landing cells while a slide is in progress (not serialized). */
    private moveHighlights: string[] = [];
    /** Ephemeral UI: completed legs in the current move box (arrows during entry). */
    private movePreviewLegs: PlayLeg[] = [];

    constructor(state?: ITzaarState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            this.variants = variants === undefined ? [] : [...variants];
            const graph = this.graph;
            let board: Map<string, CellStack>;
            let phase: Phase = "play";
            let reserves: Reserves | undefined;
            const rng: GameRng | undefined = this.rng;
            if (this.isTournament()) {
                board = emptyBoard();
                phase = "setup";
                reserves = tournamentReserves();
            } else if (this.isRandom()) {
                board = buildRandomBoard(graph, rng);
            } else {
                board = buildFixedBoard(graph);
            }
            const fresh: IMoveState = {
                _version: TzaarGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                phase,
                board,
                reserves,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ITzaarState;
            }
            if (state.game !== TzaarGame.gameinfo.uid) {
                throw new Error(`The TZAAR engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public isTournament(): boolean {
        return this.variants.includes("tournament");
    }

    public isRandom(): boolean {
        return this.variants.includes("random");
    }

    public isWhiteOpeningPly(): boolean {
        return (
            this.phase === "play"
            && this.currplayer === 1
            && this.stack.length - 1 === playStartStackIndex(this.stack)
        );
    }

    public load(idx = -1): TzaarGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if (idx < 0 || idx >= this.stack.length) {
            throw new Error("Could not load the requested state from the stack.");
        }
        const s = this.stack[idx]!;
        this.currplayer = s.currplayer;
        this.phase = s.phase;
        this.board = cloneBoard(s.board);
        this.reserves = s.reserves === undefined ? undefined : cloneReserves(s.reserves);
        this.pendingSetup = s.pendingSetup === undefined ? undefined : { ...s.pendingSetup };
        this.pendingFirst = s.pendingFirst === undefined ? undefined : { ...s.pendingFirst };
        this.lastmove = s.lastmove;
        this.results = [...s._results];
        this.moveHighlights = [];
        this.movePreviewLegs = [];
        return this;
    }

    private rowCol(cell: string): RowCol {
        const [col, row] = this.graph.algebraic2coords(cell);
        return { row, col };
    }

    private clearMoveAnnotations(): void {
        this.moveHighlights = [];
        this.movePreviewLegs = [];
    }

    /** Committed position (stack tip); not a partial-preview {@link board}. */
    private boardBeforeComposition(): Map<string, CellStack> {
        return cloneBoardForSim(this.stack[this.stack.length - 1]!.board);
    }

    private completedFirstLegInBox(m: string): PlayLeg | undefined {
        const parsed = parsePlayMove(m);
        if (
            parsed === undefined
            || "partial" in parsed
            || parsed.first === undefined
            || parsed.second !== undefined
            || this.isWhiteOpeningPly()
        ) {
            return undefined;
        }
        const leg = parsed.first;
        if (!this.validatePlayLeg(leg, this.currplayer, "capture")) {
            return undefined;
        }
        return leg;
    }

    /** Dots/lines while the move box holds a partial or complete uncommitted play. */
    private syncMoveAnnotations(m: string): void {
        this.clearMoveAnnotations();
        if (this.phase !== "play" || this.gameover) {
            return;
        }
        const p = this.currplayer;
        let board = this.boardBeforeComposition();
        const parts = m.split(",").filter((s) => s.length > 0);
        const legs: PlayLeg[] = [];
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i]!;
            const leg = parsePlayLeg(part);
            if (leg !== undefined && this.validatePlayLeg(leg, p, "capture", board)) {
                legs.push(leg);
                if (i < parts.length - 1 || !part.endsWith("-")) {
                    const sim = cloneBoardForSim(board);
                    if (this.legIsCapture(leg, p, board)) {
                        applyCapture(sim, leg.from, leg.to);
                    } else if (this.legIsStrengthen(leg, p, board)) {
                        applyStrengthen(sim, leg.from, leg.to);
                    }
                    board = sim;
                }
            }
        }
        this.movePreviewLegs = legs;

        const tail = parts[parts.length - 1] ?? "";
        const inc = /^([a-z]+\d+)-$/i.exec(tail);
        const from = inc?.[1]?.toLowerCase();
        if (from !== undefined && board.get(from)?.owner === p) {
            let mode: SlideMode = "capture-only";
            if (parts.length > 1 || (!this.isWhiteOpeningPly() && legs.length > 0)) {
                mode = "capture";
            } else if (!this.isWhiteOpeningPly()) {
                mode = "capture-only";
            }
            this.moveHighlights = legalSlideDestinations(this.graph, board, from, p, mode);
        }
    }

    private instructionsKey(): string {
        if (this.phase === "setup") {
            return "apgames:validation.tzaar.INITIAL_INSTRUCTIONS_SETUP";
        }
        if (this.isWhiteOpeningPly()) {
            return "apgames:validation.tzaar.INITIAL_INSTRUCTIONS_OPENING";
        }
        if (this.pendingFirst !== undefined) {
            return "apgames:validation.tzaar.INITIAL_INSTRUCTIONS_SECOND";
        }
        return "apgames:validation.tzaar.INITIAL_INSTRUCTIONS";
    }

    private legIsCapture(leg: PlayLeg, player: playerid, board = this.board): boolean {
        const dests = legalSlideDestinations(this.graph, board, leg.from, player, "capture-only");
        if (!dests.includes(leg.to)) {
            return false;
        }
        const target = board.get(leg.to);
        return target !== undefined && target.owner !== player;
    }

    private legIsStrengthen(leg: PlayLeg, player: playerid, board = this.board): boolean {
        const dests = legalSlideDestinations(this.graph, board, leg.from, player, "strengthen");
        if (!dests.includes(leg.to)) {
            return false;
        }
        const target = board.get(leg.to);
        return target !== undefined && target.owner === player;
    }

    private validatePlayLeg(
        leg: PlayLeg,
        player: playerid,
        mode: "capture" | "strengthen" | "either",
        board = this.board,
    ): boolean {
        if (!this.graph.isPlayable(leg.from) || !this.graph.isPlayable(leg.to)) {
            return false;
        }
        if (mode === "capture") {
            return this.legIsCapture(leg, player, board);
        }
        if (mode === "strengthen") {
            return this.legIsStrengthen(leg, player, board);
        }
        return this.legIsCapture(leg, player, board) || this.legIsStrengthen(leg, player, board);
    }

  private enumeratePlayMoves(player = this.currplayer): string[] {
        if (this.phase !== "play") {
            return [];
        }
        const captures = allCaptureMoves(this.graph, this.board, player);
        if (captures.length === 0) {
            return [];
        }
        if (this.isWhiteOpeningPly()) {
            return captures.map((c) => formatPlayLeg(c)).sort();
        }
        const out: string[] = [];
        for (const first of captures) {
            const sim = cloneBoardForSim(this.board);
            applyCapture(sim, first.from, first.to);
            const firstStr = formatPlayLeg(first);
            out.push(`${firstStr},pass`);
            const secondCaptures = allCaptureMoves(this.graph, sim, player);
            for (const sc of secondCaptures) {
                out.push(`${firstStr},${formatPlayLeg(sc)}`);
            }
            for (const [from, stack] of sim) {
                if (stack.owner !== player) {
                    continue;
                }
                for (const to of legalSlideDestinations(this.graph, sim, from, player, "strengthen")) {
                    out.push(`${firstStr},${from}-${to}`);
                }
            }
        }
        return [...new Set(out)].sort();
    }

    private enumerateSetupMoves(): string[] {
        const p = this.currplayer;
        const reserves = this.reserves;
        if (reserves === undefined) {
            return [];
        }
        const moves: string[] = [];
        for (const cell of this.graph.playableCells()) {
            if (this.board.has(cell)) {
                continue;
            }
            for (const kind of ["tott", "tzarra", "tzaar"] as const) {
                if (reserves[p - 1][kind] > 0) {
                    moves.push(formatSetupPlace(cell, kind));
                }
            }
        }
        return moves.sort();
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) {
            return [];
        }
        const p = player ?? this.currplayer;
        if (p !== this.currplayer) {
            return [];
        }
        if (this.phase === "setup") {
            return this.enumerateSetupMoves();
        }
        if (!hasForcedCapture(this.graph, this.board, p)) {
            return [];
        }
        return this.enumeratePlayMoves(p);
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {
            valid: false,
            complete: 0,
            message: i18next.t("apgames:validation._general.INVALID_MOVE", { move: m }),
        };
        if (this.gameover) {
            result.message = i18next.t("apgames:validation._general.MOVES_GAMEOVER");
            return result;
        }
        m = m.toLowerCase().replace(/\s+/g, "");
        if (m.length === 0) {
            this.pendingFirst = undefined;
            this.clearMoveAnnotations();
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t(this.instructionsKey());
            return result;
        }
        const p = this.currplayer;

        if (this.phase === "setup") {
            const place = parseSetupPlace(m);
            if (place === undefined) {
                return result;
            }
            if (!this.graph.isPlayable(place.cell)) {
                result.message = i18next.t("apgames:validation.tzaar.BLOCKED");
                return result;
            }
            if (m.startsWith("!")) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t(this.instructionsKey());
                return result;
            }
            if (place.kind === undefined) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t(this.instructionsKey());
                return result;
            }
            if (this.board.has(place.cell)) {
                result.message = i18next.t("apgames:validation.tzaar.OCCUPIED");
                return result;
            }
            const reserves = this.reserves;
            if (reserves === undefined || reserves[p - 1][place.kind] <= 0) {
                result.message = i18next.t("apgames:validation.tzaar.NO_RESERVE");
                return result;
            }
            result.valid = true;
            result.complete = 0;
            result.canrender = true;
            result.message = i18next.t(this.instructionsKey());
            this.clearMoveAnnotations();
            return result;
        }

        const parsed = parsePlayMove(m);
        if (parsed === undefined) {
            return result;
        }
        if ("partial" in parsed) {
            const from = parsed.partial.split("-")[0]?.toLowerCase();
            if (from === undefined) {
                this.clearMoveAnnotations();
                return result;
            }
            let board = this.board;
            let slideMode: SlideMode = "capture-only";
            if (parsed.first !== undefined) {
                if (!this.validatePlayLeg(parsed.first, p, "capture")) {
                    result.message = i18next.t("apgames:validation.tzaar.MUST_CAPTURE_FIRST");
                    this.clearMoveAnnotations();
                    return result;
                }
                slideMode = "capture";
                const sim = cloneBoardForSim(this.board);
                applyCapture(sim, parsed.first.from, parsed.first.to);
                board = sim;
                this.pendingFirst = parsed.first;
            }
            if (legalSlideDestinations(this.graph, board, from, p, slideMode).length > 0) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t(
                    parsed.first !== undefined
                        ? "apgames:validation.tzaar.INITIAL_INSTRUCTIONS_SECOND"
                        : this.instructionsKey(),
                );
                this.syncMoveAnnotations(m);
            } else {
                if (this.board.get(from)?.owner !== p) {
                    result.message = i18next.t("apgames:validation._general.INVALID_MOVE", { move: m });
                } else if (slideMode === "capture-only") {
                    result.message = i18next.t("apgames:validation.tzaar.NO_CAPTURES_FROM", { where: from });
                } else {
                    result.message = i18next.t("apgames:validation.tzaar.NO_SECOND_ACTION_FROM", { where: from });
                }
                this.clearMoveAnnotations();
            }
            return result;
        }

        const { first, second } = parsed;
        if (!this.validatePlayLeg(first, p, "capture")) {
            result.message = this.isWhiteOpeningPly()
                ? i18next.t("apgames:validation.tzaar.MUST_CAPTURE_OPENING")
                : i18next.t("apgames:validation.tzaar.MUST_CAPTURE_FIRST");
            return result;
        }

        if (this.isWhiteOpeningPly()) {
            if (second !== undefined) {
                return result;
            }
            result.valid = true;
            result.complete = 1;
            result.canrender = true;
            result.message = i18next.t(this.instructionsKey());
            this.syncMoveAnnotations(m);
            return result;
        }

        if (second === undefined) {
            this.pendingFirst = first;
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.tzaar.INITIAL_INSTRUCTIONS_SECOND");
            this.syncMoveAnnotations(m);
            return result;
        }
        this.pendingFirst = undefined;

        const sim = cloneBoardForSim(this.board);
        applyCapture(sim, first.from, first.to);
        if (second === "pass") {
            result.valid = true;
            result.complete = 1;
            result.canrender = true;
            result.message = i18next.t(this.instructionsKey());
            this.syncMoveAnnotations(m);
            return result;
        }
        if (!this.validatePlayLeg(second, p, "either", sim)) {
            result.message = i18next.t("apgames:validation.tzaar.INVALID_LEG");
            this.clearMoveAnnotations();
            return result;
        }
        result.valid = true;
        result.complete = 1;
        result.canrender = true;
        result.message = i18next.t(this.instructionsKey());
        this.syncMoveAnnotations(m);
        return result;
    }

    public getButtons(): ICustomButton[] {
        if (this.gameover || this.phase !== "play" || this.isWhiteOpeningPly()) {
            return [];
        }
        if (this.pendingFirst === undefined) {
            return [];
        }
        const leg = formatPlayLeg(this.pendingFirst);
        return [{ label: "apgames:buttons.pass", move: `${leg},pass` }];
    }

    private applyPlayLeg(
        leg: PlayLeg,
        player: playerid,
        board: Map<string, CellStack>,
        results: APMoveResult[],
    ): "capture" | "strengthen" {
        if (this.legIsCapture(leg, player, board)) {
            const captured = topKind(board.get(leg.to)!);
            applyCapture(board, leg.from, leg.to);
            results.push({
                type: "capture",
                where: leg.to,
                how: leg.from,
                what: captured,
            });
            return "capture";
        }
        applyStrengthen(board, leg.from, leg.to);
        results.push({
            type: "move",
            from: leg.from,
            to: leg.to,
        });
        return "strengthen";
    }

    private endIfNoForcedCapture(player: playerid): boolean {
        if (hasForcedCapture(this.graph, this.board, player)) {
            return false;
        }
        const winner = player === 1 ? 2 : 1;
        this.gameover = true;
        this.winner = [winner];
        this.results.push({ type: "eog", reason: "immobilize" });
        this.results.push({ type: "winners", players: [winner] });
        return true;
    }

    private checkTrinityWin(player: playerid): boolean {
        const opponent = player === 1 ? 2 : 1;
        if (!lacksTrinity(this.board, opponent)) {
            return false;
        }
        this.gameover = true;
        this.winner = [player];
        this.results.push({ type: "eog", reason: "types" });
        this.results.push({ type: "winners", players: [player] });
        return true;
    }

    /**
     * Playground interim preview: mutate the clone for render without advancing the stack
     * (see {@link applyInterimPartialRender} — always uses `partial: true, trusted: true`).
     */
    private applyPartialMove(m: string): TzaarGame {
        if (this.phase === "setup") {
            const place = parseSetupPlace(m);
            if (place === undefined) {
                return this;
            }
            if (m.startsWith("!")) {
                this.pendingSetup = { cell: place.cell };
                return this;
            }
            const kind = place.kind;
            if (kind === undefined) {
                return this;
            }
            const reserves = this.reserves;
            if (reserves !== undefined && reserves[this.currplayer - 1]![kind] <= 0) {
                return this;
            }
            this.pendingSetup = { cell: place.cell, kind };
            if (!this.board.has(place.cell)) {
                this.board.set(place.cell, { owner: this.currplayer, pieces: [kind] });
            }
            return this;
        }

        this.results = [];
        const player = this.currplayer;
        const parsed = parsePlayMove(m);
        if (parsed === undefined) {
            return this;
        }
        if ("partial" in parsed) {
            if (parsed.first !== undefined) {
                if (!this.validatePlayLeg(parsed.first, player, "capture")) {
                    return this;
                }
                this.applyPlayLeg(parsed.first, player, this.board, this.results);
                this.pendingFirst = parsed.first;
            }
            this.syncMoveAnnotations(m);
            return this;
        }
        const { first, second } = parsed;
        if (!this.validatePlayLeg(first, player, "capture")) {
            return this;
        }
        this.applyPlayLeg(first, player, this.board, this.results);
        if (this.isWhiteOpeningPly() || second !== undefined) {
            this.pendingFirst = undefined;
        } else {
            this.pendingFirst = first;
        }
        if (second === "pass") {
            this.results.push({ type: "pass" });
            return this;
        }
        if (second !== undefined) {
            if (!this.validatePlayLeg(second, player, "either", this.board)) {
                return this;
            }
            this.applyPlayLeg(second, player, this.board, this.results);
        }
        this.syncMoveAnnotations(m);
        return this;
    }

    public move(m: string, { trusted = false, partial = false } = {}): TzaarGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:validation._general.MOVES_GAMEOVER"));
        }
        m = m.toLowerCase().replace(/\s+/g, "");
        if (m.length === 0) {
            return this;
        }
        if (!trusted) {
            const v = this.validateMove(m);
            if (!v.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", v.message);
            }
            if (!partial) {
                const requiredComplete = this.phase === "setup" ? 0 : 1;
                if (v.complete !== requiredComplete) {
                    throw new UserFacingError("VALIDATION_GENERAL", v.message);
                }
            }
        }

        if (partial) {
            return this.applyPartialMove(m);
        }

        this.results = [];
        const player = this.currplayer;
        this.pendingFirst = undefined;
        this.clearMoveAnnotations();

        if (this.phase === "setup") {
            const place = parseSetupPlace(m)!;
            if (m.startsWith("!")) {
                this.pendingSetup = { cell: place.cell };
                this.saveState();
                return this;
            }
            let kind = place.kind;
            if (kind === undefined && this.pendingSetup?.cell === place.cell && this.pendingSetup.kind !== undefined) {
                kind = this.pendingSetup.kind;
            }
            if (kind === undefined) {
                throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation._general.INVALID_MOVE", { move: m }));
            }
            if (!decrementReserve(this.reserves!, player, kind)) {
                throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation.tzaar.NO_RESERVE"));
            }
            this.board.set(place.cell, { owner: player, pieces: [kind] });
            this.pendingSetup = undefined;
            this.results.push({
                type: "place",
                who: player,
                where: place.cell,
                what: kind,
            });
            this.lastmove = formatSetupPlace(place.cell, kind);
            if (this.board.size >= 60) {
                this.phase = "play";
                this.currplayer = 1;
            } else {
                this.currplayer = player === 1 ? 2 : 1;
            }
            if (this.phase === "play" && this.endIfNoForcedCapture(this.currplayer)) {
                this.saveState();
                return this;
            }
            this.saveState();
            return this;
        }

        const parsed = parsePlayMove(m);
        if (parsed === undefined || "partial" in parsed || parsed.first === undefined) {
            throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation._general.INVALID_MOVE", { move: m }));
        }
        const { first, second } = parsed;
        this.applyPlayLeg(first, player, this.board, this.results);
        if (this.checkTrinityWin(player)) {
            this.saveState();
            return this;
        }

        if (!this.isWhiteOpeningPly()) {
            if (second === "pass") {
                this.results.push({ type: "pass" });
            } else if (second !== undefined) {
                const kind = this.applyPlayLeg(second, player, this.board, this.results);
                void kind;
                if (this.checkTrinityWin(player)) {
                    this.saveState();
                    return this;
                }
            }
        }

        this.currplayer = player === 1 ? 2 : 1;
        if (this.endIfNoForcedCapture(this.currplayer)) {
            this.lastmove = m;
            this.saveState();
            return this;
        }

        this.lastmove = m;
        this.saveState();
        return this;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            if (piece !== undefined && piece.startsWith("_btn_")) {
                const value = piece.substring("_btn_".length);
                const newmove = value === "pass" ? move.includes(",") ? move : `${move},pass` : value;
                const result = this.validateMove(newmove) as IClickResult;
                result.move = result.valid ? newmove : move;
                return result;
            }
            if (row < 0 || col < 0) {
                return { move, valid: false, message: i18next.t("apgames:validation._general.UNKNOWN_CLICK") };
            }
            const grid = this.graph.listCells(true) as string[][];
            const cell = grid[row]?.[col];
            if (cell === undefined) {
                return { move, valid: false, message: i18next.t("apgames:validation.tzaar.BLOCKED") };
            }

            let newmove = move.toLowerCase().replace(/\s+/g, "");

            if (this.phase === "setup" && this.isTournament() && !this.board.has(cell)) {
                const reserves = this.reserves;
                if (reserves === undefined) {
                    return { move, valid: false, message: i18next.t("apgames:validation._general.INVALID_MOVE", { move }) };
                }
                const advanced = advanceTournamentSetupClick(newmove, cell, reserves, this.currplayer);
                if (advanced === undefined) {
                    return {
                        move,
                        valid: false,
                        message: i18next.t("apgames:validation.tzaar.NO_RESERVE"),
                    };
                }
                newmove = advanced;
            } else if (this.phase === "play") {
                const p = this.currplayer;
                let pendingFrom: string | undefined;
                const incompleteLeg = /^([a-z]+\d+)-$/i.exec(newmove);
                if (incompleteLeg !== null) {
                    pendingFrom = incompleteLeg[1]!.toLowerCase();
                } else if (newmove.includes(",")) {
                    const tail = newmove.split(",").pop() ?? "";
                    const inc2 = /^([a-z]+\d+)-$/i.exec(tail);
                    if (inc2 !== null) {
                        pendingFrom = inc2[1]!.toLowerCase();
                    } else {
                        const leg = parsePlayLeg(tail);
                        pendingFrom = leg?.from;
                    }
                } else {
                    const parsed = parsePlayMove(newmove);
                    // A complete first leg only (e.g. d5-d6) waits for a new `from-`; do not reuse first.from.
                    if (
                        parsed !== undefined
                        && !("partial" in parsed)
                        && parsed.second === undefined
                        && parsePlayLeg(newmove)?.to !== undefined
                    ) {
                        pendingFrom = undefined;
                    } else {
                        pendingFrom = parsePlayLeg(newmove)?.from;
                    }
                }

                const completedFirst = this.completedFirstLegInBox(newmove);
                const awaitingSecondLeg = completedFirst !== undefined;
                const ownsStackForNewLeg = (c: string): boolean => {
                    if (this.board.get(c)?.owner === p) {
                        return true;
                    }
                    return awaitingSecondLeg && completedFirst!.to === c;
                };

                if (pendingFrom === undefined) {
                    if (ownsStackForNewLeg(cell)) {
                        if (awaitingSecondLeg || newmove.includes(",")) {
                            newmove = `${newmove},${cell}-`;
                        } else {
                            newmove = `${cell}-`;
                        }
                    }
                } else {
                    const leg = parsePlayLeg(`${pendingFrom}-${cell}`);
                    if (leg !== undefined) {
                        if (newmove.includes(",")) {
                            const head = newmove.includes("-")
                                ? newmove.replace(/,[a-z]+\d+-$/i, "")
                                : newmove.split(",")[0]!;
                            newmove = `${head},${pendingFrom}-${cell}`;
                        } else {
                            newmove = `${pendingFrom}-${cell}`;
                        }
                    }
                }
            }

            const result = this.validateMove(newmove) as IClickResult;
            result.move = result.valid ? newmove : move;
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

    public getStartingPosition(): string {
        return serializeBoard(this.stack[0]!.board);
    }

    public getPlayerColour(p: playerid): Colourfuncs {
        if (p === 1) {
            return { func: "custom", default: GIPF_P1, palette: 1 };
        }
        return { func: "custom", default: GIPF_P2, palette: 2 };
    }

    public sidebarScores(): IScores[] {
        const line = (p: playerid) => {
            if (this.phase === "setup" && this.isTournament()) {
                return formatPieceCountLine(visiblePieceCounts(this.board, p));
            }
            return formatPieceCountLine(availablePieceCounts(this.board, this.reserves, p));
        };
        return [
            {
                name: this.neutralAreaLabel("apgames:status.tzaar.PIECES"),
                scores: [line(1), line(2)],
            },
        ];
    }

    public stackKey(cell: string): string {
        const stack = this.board.get(cell);
        if (stack === undefined) {
            return "-";
        }
        return stackGlyphs(stack.owner, stack.pieces).join("");
    }

    private flatStackLegendKey(legend: FlatLegend, owner: playerid, kind: PieceKind, height: number): string {
        const base = pieceGlyph(owner, kind);
        if (height === 1) {
            return base;
        }
        const key = `${base}h${height}`;
        if (legend[key] !== undefined) {
            return key;
        }
        const piece = legend[base] as Glyph;
        legend[key] = [piece, { text: height.toString(), scale: FLAT_HEIGHT_TEXT_SCALE }];
        return key;
    }

    private flatCellKey(cell: string, legend: FlatLegend): string {
        const stack = this.board.get(cell);
        if (stack === undefined) {
            return "-";
        }
        const top = stack.pieces[stack.pieces.length - 1];
        if (top === undefined) {
            return "-";
        }
        return this.flatStackLegendKey(legend, stack.owner, top, stack.pieces.length);
    }

    private appendTzaarAnnotations(rep: APRenderRep): void {
        rep.annotations = [];
        const addMoveArrow = (from: string, to: string) => {
            const [fx, fy] = this.graph.algebraic2coords(from);
            const [tx, ty] = this.graph.algebraic2coords(to);
            rep.annotations!.push({
                type: "move",
                targets: [
                    { row: fy, col: fx },
                    { row: ty, col: tx },
                ],
            });
        };
        if (this.movePreviewLegs.length > 0) {
            for (const leg of this.movePreviewLegs) {
                addMoveArrow(leg.from, leg.to);
            }
        } else {
            for (const res of this.results) {
                if (res.type === "move" && res.from && res.to) {
                    addMoveArrow(res.from, res.to);
                }
            }
        }
        if (this.moveHighlights.length > 0) {
            rep.annotations!.push({
                type: "enter",
                shape: "circle",
                targets: this.moveHighlights.map((c) => this.rowCol(c)) as [RowCol, ...RowCol[]],
            });
        }
        if (this.movePreviewLegs.length === 0 && this.pendingFirst === undefined && this.lastmove !== undefined) {
            const done = parsePlayMove(this.lastmove);
            if (done !== undefined && !("partial" in done)) {
                if (done.first !== undefined) {
                    addMoveArrow(done.first.from, done.first.to);
                }
                if (done.second !== undefined && done.second !== "pass") {
                    addMoveArrow(done.second.from, done.second.to);
                }
            }
        }
        if (rep.annotations.length === 0) {
            delete rep.annotations;
        }
    }

    private renderFlat(p1: Colourfuncs, p2: Colourfuncs): APRenderRep {
        const legend = buildFlatBaseLegend(p1, p2);
        const cells = this.graph.listCells(true) as string[][];
        let pieces = "";
        for (let row = 0; row < cells.length; row++) {
            if (row > 0) {
                pieces += "\n";
            }
            const rowCells = cells[row]!;
            const keys: string[] = [];
            for (let col = 0; col < rowCells.length; col++) {
                const cell = rowCells[col];
                if (cell === undefined) {
                    keys.push("-");
                } else {
                    keys.push(this.flatCellKey(cell, legend));
                }
            }
            pieces += keys.join(",");
        }
        const rep: APRenderRep = {
            options: ["reverse-numbers"],
            board: {
                style: "hex-of-tri",
                minWidth: 5,
                maxWidth: 9,
                rotate: 90,
                blocked: TZAAR_BLOCKED_RENDER as [RowCol, ...RowCol[]],
            },
            legend,
            pieces,
        };
        this.appendTzaarAnnotations(rep);
        return rep;
    }

    private renderStacked(p1: Colourfuncs, p2: Colourfuncs): APRenderRep {
        const cells = this.graph.listCells(true) as string[][];
        const pstr: string[][][] = [];
        for (const row of cells) {
            const line: string[][] = [];
            for (const cell of row) {
                const stack = this.board.get(cell);
                if (stack === undefined) {
                    line.push([]);
                } else {
                    line.push(stackGlyphs(stack.owner, stack.pieces));
                }
            }
            pstr.push(line);
        }

        const rep: APRenderRep = {
            options: ["reverse-numbers"],
            renderer: "stacking-offset",
            board: {
                style: "hex-of-tri",
                minWidth: 5,
                maxWidth: 9,
                rotate: 90,
                blocked: TZAAR_BLOCKED_RENDER as [RowCol, ...RowCol[]],
            },
            legend: {
                A: basicPieceLegend(p1, 3),
                B: p1TzarraLegend(p1),
                C: {
                    name: "piece-chariot",
                    paint: { fill: p1, border: P1_TZAAR_BORDER, inner: P1_TZAAR_INNER },
                },
                X: basicPieceLegend(p2, 4),
                Y: p2TzarraLegend(p2),
                Z: {
                    name: "piece-chariot",
                    paint: { fill: p2, border: P2_TZAAR_BORDER, inner: P2_TZAAR_INNER },
                },
            },
            pieces: pstr as [string[][], ...string[][][]],
        };
        this.appendTzaarAnnotations(rep);
        return rep;
    }

    public render(opts: IRenderOpts = {}): APRenderRep {
        const p1 = this.getPlayerColour(1);
        const p2 = this.getPlayerColour(2);
        if (this.hasDisplay(opts, "stacked")) {
            return this.renderStacked(p1, p2);
        }
        return this.renderFlat(p1, p2);
    }

    public collectChatLogLine(lines: ChatLogLine[], r: APMoveResult, ctx: ChatLogCollectContext): boolean {
        switch (r.type) {
            case "place": {
                const seat = (r.who ?? ctx.defaultSeat) as playerid;
                const kind = r.what as PieceKind | undefined;
                const piece =
                    kind !== undefined && kind in PIECE_KIND_LABEL
                        ? PIECE_KIND_LABEL[kind]
                        : "piece";
                this.pushSeatChatLine(lines, seat, "apresults:tzaar.PLACE.default", {
                    player: chatPlayerToken(seat),
                    where: r.where!,
                    piece,
                });
                return true;
            }
            case "move":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:tzaar.MOVE.strengthen", {
                    player: chatPlayerToken(ctx.defaultSeat),
                    from: r.from!,
                    to: r.to!,
                });
                return true;
            case "capture": {
                const kind = r.what as PieceKind | undefined;
                const piece =
                    kind !== undefined && kind in PIECE_KIND_LABEL
                        ? PIECE_KIND_LABEL[kind]
                        : "piece";
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:tzaar.MOVE.capture", {
                    player: chatPlayerToken(ctx.defaultSeat),
                    from: r.how!,
                    to: r.where!,
                    piece,
                });
                return true;
            }
            case "pass":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:tzaar.MOVE.pass", {
                    player: chatPlayerToken(ctx.defaultSeat),
                });
                return true;
            case "eog":
                return this.collectEogChatLogLine(lines, r, ctx);
            default:
                return super.collectChatLogLine(lines, r, ctx);
        }
    }

    protected eogChatLineOverride(r: Extract<APMoveResult, { type: "eog" }>, ctx: ChatLogCollectContext): ChatLogLine | undefined {
        const winResult = ctx.results.find((x) => x.type === "winners");
        const winnerSeat =
            winResult?.type === "winners" && winResult.players.length > 0
                ? winResult.players[0]!
                : this.winner[0] ?? ctx.defaultSeat;
        const reason = r.reason as WinReason | undefined;
        const textKey =
            reason === "types"
                ? "apresults:tzaar.EOG.types"
                : "apresults:tzaar.EOG.immobilize";
        return {
            actor: this.getChatActorRef(winnerSeat),
            textKey,
            textParams: { player: chatPlayerToken(winnerSeat) },
        };
    }

    public moveState(): IMoveState {
        return {
            _version: TzaarGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            phase: this.phase,
            board: cloneBoard(this.board),
            reserves: this.reserves === undefined ? undefined : cloneReserves(this.reserves),
            pendingSetup: this.pendingSetup === undefined ? undefined : { ...this.pendingSetup },
            pendingFirst: this.pendingFirst === undefined ? undefined : { ...this.pendingFirst },
            lastmove: this.lastmove,
        };
    }

    public state(): ITzaarState {
        return {
            game: TzaarGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    public clone(): TzaarGame {
        return Object.assign(new TzaarGame(), cloneState(this) as TzaarGame);
    }
}