import {
    GameBase,
    IAPGameState,
    IClickResult,
    ICustomButton,
    IMoveOptions,
    IScores,
    IStatus,
    IValidationResult,
    type ChatLogCollectContext,
    type ChatLogLine,
} from "./_base.js";
import { GameBaseSequenced, sequencedShouldCloseRound } from "./_turn-sequenced.js";
import type { APGamesInformation } from "../schemas/gameinfo.js";
import {
    APRenderRep,
    AreaKey,
    AreaPieces,
    BoardBasic,
    Glyph,
    type PiecesAreaLabeledPiece,
} from "@abstractplay/renderer/build/schemas/schema";
import type { APMoveResult } from "../schemas/moveresults.js";
import {
    reviver,
    UserFacingError,
    cloneState,
    shuffle,
    SquareOrthGraph,
} from "../common/index.js";
import i18next from "i18next";
import type { IGamePly } from "./_turn-model.js";
import {
    activeColours,
    buildDrawPoolFromBoard,
    objectiveColourSizeForSeat,
    setupBlackSizeForSeat,
    type PoolPiece,
} from "./agofmars/bag.js";
import { scoreGame } from "./agofmars/scoring.js";
import type { CellContents, Colour, IMoveState, Phase, playerid, Size } from "./agofmars/types.js";

export type { CellContents, Colour, IMoveState, Phase, playerid, Size } from "./agofmars/types.js";

export interface IAgofmarsState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
}

interface ILegendObj {
    [key: string]: Glyph | [Glyph, ...Glyph[]];
}

/** Active stash colours → renderer palette slot (same convention as Mega-Volcano). */
const RENDER_PALETTE_COLOURS: Colour[] = ["RD", "BU", "GN", "YE", "VT"];

function glyphFor(colour: Colour, size: Size): Glyph {
    const names = ["pyramid-up-small-upscaled", "pyramid-up-medium-upscaled", "pyramid-up-large-upscaled"];
    const i = RENDER_PALETTE_COLOURS.indexOf(colour);
    const paletteColour = colour === "BK" ? "#000" : i >= 0 ? i + 1 : 1;
    return { name: names[size - 1]!, colour: paletteColour };
}

function legendKey(colour: Colour, size: Size): string {
    return `${colour}${size}`;
}

function boardSignature(board: Map<string, CellContents>): string {
    const entries = [...board.entries()].sort(([a], [b]) => a.localeCompare(b));
    return entries.map(([k, [c, s]]) => `${k}:${c}${s}`).join("|");
}

export class AgofmarsGame extends GameBaseSequenced {
    /** Shown in stripped state / move tree for hidden setup commits until game over. */
    public static readonly REDACTED_SETUP_LASTMOVE = "\u2014";

    public static readonly gameinfo: APGamesInformation = {
        name: "Agents of M.A.R.S.",
        uid: "agofmars",
        playercounts: [2],
        version: "20260928",
        dateAdded: "2026-09-28",
        description: "apgames:descriptions.agofmars",
        notes: "apgames:notes.agofmars",
        urls: [
            "https://cityhare.studio/games/agents-of-mars/",
            "https://boardgamegeek.com/boardgame/378391/agents-of-mars",
            "https://looneypyramids.wiki/wiki/Agents_of_M.A.R.S.",
        ],
        bggid: "378391",
        people: [
            { type: "designer", name: "Niko Lepka" },
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
            "mechanic>displace",
            "mechanic>hidden",
            "mechanic>random>play",
            "board>shape>rect",
            "board>connect>rect",
            "components>pyramids",
        ],
        flags: ["scores", "shared-pieces", "custom-buttons", "no-moves", "custom-randomization", "no-explore"],
        variants: [
            { uid: "five-colour-plus3", group: "rules" },
            { uid: "five-colour-minus2", group: "rules" },
            { uid: "#rules" },
            { uid: "objective-initiative", conflictsWith: ["blind-agents"] },
            { uid: "blind-agents", conflictsWith: ["objective-initiative"] },
            { uid: "step-move" },
            { uid: "black-trio-swap", conflictsWith: ["five-colour-plus3", "five-colour-minus2"] },
            { uid: "biggest-group" },
            { uid: "group-size-scoring" },
        ],
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public phase: Phase = "setup-1";
    public objectives: Colour[][] = [[], []];
    public objectivesRevealed: boolean[][] = [[], []];
    public board: Map<string, CellContents> = new Map();
    public pendingDraw?: CellContents;
    public awaitingMainAction = false;
    public boardActionMode?: "move" | "swap";
    public boardActionFrom?: string;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    private graph?: SquareOrthGraph;
    private objSwapColumn?: number;

    public static coords2algebraic(x: number, y: number, height = 8): string {
        return GameBase.coords2algebraic(x, y, height);
    }

    public static algebraic2coords(cell: string, height = 8): [number, number] {
        return GameBase.algebraic2coords(cell, height);
    }

    /** Row-label height for algebraic notation (matches {@link SquareOrthGraph}). */
    private boardCoordHeight(): number {
        return this.phase === "play" ? this.boardHeight() : this.colourCount();
    }

    private static readonly WIRE_PIECE = "(RD|BU|GN|YE|VT|BK)([123])";

    public static formatPieceWire(colour: Colour, size: Size): string {
        return `${colour}${size}`;
    }

    public static parsePieceWire(token: string): { colour: Colour; size: Size } | undefined {
        const match = new RegExp(`^${AgofmarsGame.WIRE_PIECE}$`).exec(token);
        if (match === null) {
            return undefined;
        }
        return { colour: match[1] as Colour, size: parseInt(match[2]!, 10) as Size };
    }

    public static formatPlaceWire(colour: Colour, size: Size, cell: string): string {
        return `${AgofmarsGame.formatPieceWire(colour, size)}@${cell}`;
    }

    public static parsePlaceWire(m: string): { colour: Colour; size: Size; cell: string } | undefined {
        const match = new RegExp(`^${AgofmarsGame.WIRE_PIECE}@([a-z]+\\d+)$`).exec(m);
        if (match === null) {
            return undefined;
        }
        return {
            colour: match[1] as Colour,
            size: parseInt(match[2]!, 10) as Size,
            cell: match[3]!,
        };
    }

    public static formatBoardMoveWire(colour: Colour, size: Size, from: string, to: string): string {
        return `${AgofmarsGame.formatPieceWire(colour, size)}@${from}-${to}`;
    }

    public static formatBoardSwapWire(
        colourA: Colour,
        sizeA: Size,
        cellA: string,
        colourB: Colour,
        sizeB: Size,
        cellB: string,
    ): string {
        return `${AgofmarsGame.formatPieceWire(colourA, sizeA)}@${cellA}|${AgofmarsGame.formatPieceWire(colourB, sizeB)}@${cellB}`;
    }

    public static parseBoardMoveWire(
        m: string,
    ): { colour?: Colour; size?: Size; from: string; to: string } | undefined {
        const coloured = new RegExp(
            `^${AgofmarsGame.WIRE_PIECE}@([a-z]+\\d+)-([a-z]+\\d+)$`,
        ).exec(m);
        if (coloured !== null) {
            return {
                colour: coloured[1] as Colour,
                size: parseInt(coloured[2]!, 10) as Size,
                from: coloured[3]!,
                to: coloured[4]!,
            };
        }
        const plain = /^([a-z]+\d+)-([a-z]+\d+)$/.exec(m);
        if (plain !== null) {
            return { from: plain[1]!, to: plain[2]! };
        }
        return undefined;
    }

    public static parseBoardSwapWire(
        m: string,
    ): {
        colourA?: Colour;
        sizeA?: Size;
        cellA: string;
        colourB?: Colour;
        sizeB?: Size;
        cellB: string;
    } | undefined {
        const coloured = new RegExp(
            `^${AgofmarsGame.WIRE_PIECE}@([a-z]+\\d+)\\|${AgofmarsGame.WIRE_PIECE}@([a-z]+\\d+)$`,
        ).exec(m);
        if (coloured !== null) {
            return {
                colourA: coloured[1] as Colour,
                sizeA: parseInt(coloured[2]!, 10) as Size,
                cellA: coloured[3]!,
                colourB: coloured[4] as Colour,
                sizeB: parseInt(coloured[5]!, 10) as Size,
                cellB: coloured[6]!,
            };
        }
        if (!m.includes("|")) {
            return undefined;
        }
        const parts = m.split("|");
        if (parts.length !== 2 || parts[0] === "" || parts[1] === "") {
            return undefined;
        }
        const endA = AgofmarsGame.parsePlaceWire(parts[0]!);
        const endB = AgofmarsGame.parsePlaceWire(parts[1]!);
        if (endA !== undefined && endB !== undefined) {
            return {
                colourA: endA.colour,
                sizeA: endA.size,
                cellA: endA.cell,
                colourB: endB.colour,
                sizeB: endB.size,
                cellB: endB.cell,
            };
        }
        if (/^[a-z]+\d+$/.test(parts[0]!) && /^[a-z]+\d+$/.test(parts[1]!)) {
            return { cellA: parts[0]!, cellB: parts[1]! };
        }
        return undefined;
    }

    private boardPieceMatches(cell: string, colour?: Colour, size?: Size): boolean {
        const piece = this.board.get(cell);
        if (piece === undefined) {
            return false;
        }
        if (colour !== undefined && piece[0] !== colour) {
            return false;
        }
        if (size !== undefined && piece[1] !== size) {
            return false;
        }
        return true;
    }

    public colourCount(): number {
        return activeColours(this.variants).length;
    }

    public boardWidth(): number {
        return this.colourCount() === 5 ? 8 : 7;
    }

    public boardHeight(): number {
        return this.colourCount() === 5 ? 8 : 8;
    }

    public multiplierLabels(): string[] {
        let labels: string[];
        if (this.variants.includes("five-colour-plus3")) {
            labels = ["2", "1", "0", "-1", "+3"];
        } else if (this.variants.includes("five-colour-minus2")) {
            labels = ["2", "1", "0", "-1", "-2"];
        } else {
            labels = ["2", "1", "0", "-1"];
        }
        return labels.map(l => l.replace("-", "\u2212"));
    }

    public multiplierValues(): number[] {
        if (this.variants.includes("five-colour-plus3")) {
            return [2, 1, 0, -1, 3];
        }
        if (this.variants.includes("five-colour-minus2")) {
            return [2, 1, 0, -1, -2];
        }
        return [2, 1, 0, -1];
    }

    public buildDrawPool(): PoolPiece[] {
        return buildDrawPoolFromBoard(this.variants, this.board, this.objectives, this.pendingDraw);
    }

    public static objectiveSignature(permutation: number[]): string {
        return permutation.join(",");
    }

    /** `perm[i]` = column index for `colours[i]`. */
    public static objectivesFromPerm(perm: number[], colours: Colour[]): Colour[] {
        const row: Colour[] = [];
        for (let i = 0; i < colours.length; i++) {
            row[perm[i]!] = colours[i]!;
        }
        return row;
    }

    constructor(state?: IAgofmarsState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const n = this.colourCount();
            const fresh: IMoveState = {
                _version: AgofmarsGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                phase: "setup-1",
                objectives: [[], []],
                objectivesRevealed: [Array(n).fill(false), Array(n).fill(false)],
                board: new Map(),
            };
            if (this.variants.includes("objective-initiative")) {
                this.applyObjectiveInitiative(fresh);
            }
            this.stack = [fresh];
            this.load(0);
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IAgofmarsState;
            }
            if (state.game !== AgofmarsGame.gameinfo.uid) {
                throw new Error(`The Agents of M.A.R.S. engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = state.stack.map(s => ({
                ...s,
                board: new Map(s.board),
                objectives: cloneState(s.objectives) as Colour[][],
                objectivesRevealed: cloneState(s.objectivesRevealed) as boolean[][],
            }));
            this.load(this.stack.length - 1);
        }
    }

    public load(idx = -1): AgofmarsGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if (idx < 0 || idx >= this.stack.length) {
            throw new Error("Could not load the requested state from the stack.");
        }
        this.syncFromStack(idx);
        return this;
    }

    private syncFromStack(index: number): void {
        const s = this.stack[index];
        this.results = [...s._results];
        this.currplayer = s.currplayer;
        this.phase = s.phase;
        this.objectives = s.objectives.map(row => [...row]) as Colour[][];
        this.objectivesRevealed = s.objectivesRevealed.map(row => [...row]) as boolean[][];
        this.board = new Map(s.board);
        this.pendingDraw = s.pendingDraw !== undefined ? [...s.pendingDraw] as CellContents : undefined;
        this.awaitingMainAction = s.awaitingMainAction === true;
        this.boardActionMode = s.boardActionMode;
        this.boardActionFrom = s.boardActionFrom;
        this.lastmove = s.lastmove;
        this.graph = new SquareOrthGraph(this.boardWidth(), this.boardHeight());
    }

    private hasMovablePiece(): boolean {
        for (const [cell, piece] of this.board) {
            if (piece[0] !== "BK" && this.moveDestinations(cell).size > 0) {
                return true;
            }
        }
        return false;
    }

    private pyramidsDissimilar(a: CellContents, b: CellContents): boolean {
        return a[0] !== b[0] || a[1] !== b[1];
    }

    /**
     * Swap reach: full pip-count slide in one cardinal direction, intermediates empty,
     * destination may be occupied (unlike ordinary moves).
     */
    private swapReachable(from: string, to: string): boolean {
        if (from === to) {
            return false;
        }
        const piece = this.board.get(from);
        if (piece === undefined || piece[0] === "BK") {
            return false;
        }
        const steps = this.moveStepCount(piece);
        if (steps <= 0) {
            return false;
        }
        const g = this.graph!;
        const [fx, fy] = g.algebraic2coords(from);
        const [tx, ty] = g.algebraic2coords(to);
        const dx = tx - fx;
        const dy = ty - fy;
        if (dx !== 0 && dy !== 0) {
            return false;
        }
        const dist = Math.abs(dx) + Math.abs(dy);
        if (dist !== steps) {
            return false;
        }
        const stepX = dx === 0 ? 0 : dx / Math.abs(dx);
        const stepY = dy === 0 ? 0 : dy / Math.abs(dy);
        let cx = fx;
        let cy = fy;
        for (let s = 1; s <= steps; s++) {
            cx += stepX;
            cy += stepY;
            const cell = g.coords2algebraic(cx, cy);
            if (s < steps && this.board.has(cell)) {
                return false;
            }
            if (s === steps) {
                return cell === to;
            }
        }
        return false;
    }

    private canSwapCells(a: string, b: string): boolean {
        if (!this.board.has(a) || !this.board.has(b)) {
            return false;
        }
        const pa = this.board.get(a)!;
        const pb = this.board.get(b)!;
        if (pa[0] === "BK" || pb[0] === "BK") {
            return false;
        }
        if (!this.pyramidsDissimilar(pa, pb)) {
            return false;
        }
        return this.swapReachable(a, b) || this.swapReachable(b, a);
    }

    private hasSwappablePair(): boolean {
        const cells = [...this.board.keys()].filter(c => this.board.get(c)![0] !== "BK");
        if (cells.length < 2) {
            return false;
        }
        for (let i = 0; i < cells.length; i++) {
            for (let j = i + 1; j < cells.length; j++) {
                if (this.canSwapCells(cells[i]!, cells[j]!)) {
                    return true;
                }
            }
        }
        return false;
    }

    private setBoardActionMode(mode: "move" | "swap"): void {
        this.boardActionMode = mode;
        const top = this.stack[this.stack.length - 1] as IMoveState;
        top.boardActionMode = mode;
    }

    private setBoardActionFrom(cell: string): void {
        this.boardActionFrom = cell;
        const top = this.stack[this.stack.length - 1] as IMoveState;
        top.boardActionFrom = cell;
    }

    private clearBoardActionFrom(): void {
        this.boardActionFrom = undefined;
        const top = this.stack[this.stack.length - 1] as IMoveState;
        delete top.boardActionFrom;
    }

    private clearBoardActionMode(): void {
        this.boardActionMode = undefined;
        this.boardActionFrom = undefined;
        const top = this.stack[this.stack.length - 1] as IMoveState;
        delete top.boardActionMode;
        delete top.boardActionFrom;
    }

    private parseBoardActionMoveField(
        moveField: string,
    ): { mode: "move" | "swap"; from?: string } | undefined {
        const t = moveField.trim();
        const withFrom = /^(move|swap);([a-z]+\d+)$/.exec(t);
        if (withFrom !== null) {
            return { mode: withFrom[1] as "move" | "swap", from: withFrom[2] };
        }
        if (t === "move" || t === "swap") {
            return { mode: t };
        }
        return undefined;
    }

    private formatBoardActionMoveField(mode: "move" | "swap", from?: string): string {
        if (from !== undefined && from !== "") {
            return `${mode};${from}`;
        }
        return mode;
    }

    private resolvedBoardActionMode(moveField: string): "move" | "swap" | undefined {
        const parsed = this.parseBoardActionMoveField(moveField);
        if (parsed !== undefined) {
            const v = this.validateMainActionMode(parsed.mode);
            return v.valid ? parsed.mode : undefined;
        }
        if (this.boardActionMode !== undefined) {
            const v = this.validateMainActionMode(this.boardActionMode);
            return v.valid ? this.boardActionMode : undefined;
        }
        return undefined;
    }

    private resolvedBoardActionFrom(moveField: string): string | undefined {
        const parsed = this.parseBoardActionMoveField(moveField);
        if (parsed?.from !== undefined) {
            return parsed.from;
        }
        return this.boardActionFrom;
    }

    private validateMainActionMode(mode: "move" | "swap"): IValidationResult {
        if (!this.awaitingMainAction) {
            return {
                valid: false,
                complete: 0,
                message: i18next.t("apgames:validation.agofmars.TURN_START"),
            };
        }
        if (mode === "move" && !this.hasMovablePiece()) {
            return {
                valid: false,
                complete: 0,
                message: i18next.t("apgames:validation.agofmars.NO_PIECES_TO_MOVE"),
            };
        }
        if (mode === "swap" && !this.hasSwappablePair()) {
            return {
                valid: false,
                complete: 0,
                message: i18next.t("apgames:validation.agofmars.NO_PIECES_TO_SWAP"),
            };
        }
        return {
            valid: true,
            complete: -1,
            canrender: true,
            message: i18next.t("apgames:validation.agofmars.MAIN_ACTION_MODE", { context: mode }),
        };
    }

    private applyObjectiveInitiative(fresh: IMoveState): void {
        const colours = activeColours(this.variants);
        const n = colours.length;
        const permA = shuffle([...Array(n).keys()]) as number[];
        let permB = shuffle([...Array(n).keys()]) as number[];
        while (AgofmarsGame.objectiveSignature(permA) === AgofmarsGame.objectiveSignature(permB)) {
            permB = shuffle([...Array(n).keys()]) as number[];
        }
        fresh.objectives[0] = AgofmarsGame.objectivesFromPerm(permA, colours);
        fresh.objectives[1] = AgofmarsGame.objectivesFromPerm(permB, colours);
        fresh.objectivesRevealed = [Array(n).fill(false), Array(n).fill(false)];
        fresh.phase = "play";
        fresh.currplayer = 1;
        fresh.board = new Map();
    }

    /** Seat whose objective row is selected when swapping (yours, or opponent's in blind-agents). */
    private objectiveSwapTargetSeat(): number {
        const self = this.currplayer - 1;
        if (this.variants.includes("blind-agents")) {
            return 1 - self;
        }
        return self;
    }

    private objectiveDisplaySize(seat: number): Size {
        return objectiveColourSizeForSeat(seat);
    }

    private setupColourSize(seat: number): Size {
        return objectiveColourSizeForSeat(seat);
    }

    private setupBlackSize(seat: number): Size {
        return setupBlackSizeForSeat(seat);
    }

    private legendSizeForObjectiveDisplay(seat: number, col: number, viewer?: number): Size {
        const colour = this.objectives[seat]![col]!;
        const disp = this.displayColour(colour, seat, col, viewer);
        if (disp === "BK" && this.phase.startsWith("setup")) {
            return this.setupBlackSize(seat);
        }
        return this.objectiveDisplaySize(seat);
    }

    protected shouldCloseRound(roundPlies: IGamePly[], stackIndex: number): boolean {
        const after = this.stack[stackIndex] as IMoveState;
        if (after.awaitingMainAction === true || after.pendingDraw !== undefined) {
            return false;
        }
        return sequencedShouldCloseRound(this, roundPlies, stackIndex);
    }

    public moveState(): IMoveState {
        return {
            _version: AgofmarsGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            phase: this.phase,
            objectives: cloneState(this.objectives) as Colour[][],
            objectivesRevealed: cloneState(this.objectivesRevealed) as boolean[][],
            board: new Map(this.board),
            pendingDraw:
                this.pendingDraw !== undefined ? ([...this.pendingDraw] as CellContents) : undefined,
            awaitingMainAction: this.awaitingMainAction ? true : undefined,
            boardActionMode: this.boardActionMode,
            boardActionFrom: this.boardActionFrom,
        };
    }

    public saveState(): void {
        this.stack.push(this.moveState());
        this.load(this.stack.length - 1);
    }

    public clone(): AgofmarsGame {
        return new AgofmarsGame(this.state());
    }

    private advancePlayer(): void {
        this.currplayer = this.currplayer === 1 ? 2 : 1;
    }

    private blackCountOnBoard(): number {
        let n = 0;
        for (const [, [c]] of this.board) {
            if (c === "BK") {
                n++;
            }
        }
        if (this.pendingDraw?.[0] === "BK") {
            n++;
        }
        return n;
    }

    private blackTrioPresent(): boolean {
        const sizes = new Set<Size>();
        for (const [, [c, s]] of this.board) {
            if (c === "BK") {
                sizes.add(s);
            }
        }
        if (this.pendingDraw?.[0] === "BK") {
            sizes.add(this.pendingDraw[1]);
        }
        return sizes.has(1) && sizes.has(2) && sizes.has(3);
    }

    public canObjectiveSwap(seat: playerid): boolean {
        if (seat !== this.currplayer) {
            return false;
        }
        if (this.phase !== "play" || this.pendingDraw !== undefined || this.awaitingMainAction) {
            return false;
        }
        if (this.variants.includes("black-trio-swap")) {
            return !this.blackTrioPresent();
        }
        return this.blackCountOnBoard() < 4;
    }

    public static formatMultToken(mult: number): string {
        if (mult > 0 && mult !== 1 && mult !== 2) {
            return `+${mult}`;
        }
        return String(mult);
    }

    public static parseMultToken(token: string): number | undefined {
        if (token.startsWith("+")) {
            const n = parseInt(token.slice(1), 10);
            return Number.isNaN(n) ? undefined : n;
        }
        const n = parseInt(token, 10);
        return Number.isNaN(n) ? undefined : n;
    }

    public static formatSetupWire(map: Map<Colour, number>, colours: Colour[]): string {
        const parts: string[] = [];
        for (const c of colours) {
            const mult = map.get(c);
            if (mult !== undefined) {
                parts.push(`${c}${AgofmarsGame.formatMultToken(mult)}`);
            }
        }
        return parts.join(",");
    }

    /**
     * Comma-separated setup move; the last segment may be a colour code only (e.g. `RD1,BU,GN`)
     * while the player is choosing a multiplier column.
     */
    private parseSetupMoveField(move: string): { map: Map<Colour, number>; pending?: Colour } | undefined {
        const colours = activeColours(this.variants);
        const parts = move
            .split(",")
            .map(t => t.trim())
            .filter(t => t.length > 0);
        if (parts.length === 0) {
            return { map: new Map() };
        }
        const last = parts[parts.length - 1]!;
        if (/^[A-Z]{2}$/.test(last) && colours.includes(last as Colour)) {
            const wire = parts.slice(0, -1).join(",");
            if (wire.length === 0) {
                return { map: new Map(), pending: last as Colour };
            }
            const map = this.parseSetupWire(wire);
            if (map === undefined) {
                return undefined;
            }
            return { map, pending: last as Colour };
        }
        const map = this.parseSetupWire(move);
        if (map === undefined) {
            return undefined;
        }
        return { map };
    }

    private formatSetupMoveField(map: Map<Colour, number>, pending?: Colour): string {
        const wire = AgofmarsGame.formatSetupWire(map, activeColours(this.variants));
        if (pending === undefined) {
            return wire;
        }
        return wire.length > 0 ? `${wire},${pending}` : pending;
    }

    public parseSetupWire(move: string): Map<Colour, number> | undefined {
        const colours = activeColours(this.variants);
        const allowed = new Set(this.multiplierValues());
        const tokens = move
            .split(",")
            .map(t => t.trim())
            .filter(t => t.length > 0);
        if (tokens.length === 0) {
            return new Map();
        }
        const map = new Map<Colour, number>();
        for (const token of tokens) {
            const m = /^([A-Z]{2})([+-]?\d+)$/.exec(token);
            if (m === null) {
                return undefined;
            }
            const colour = m[1] as Colour;
            if (!colours.includes(colour)) {
                return undefined;
            }
            const mult = AgofmarsGame.parseMultToken(m[2]!);
            if (mult === undefined || !allowed.has(mult)) {
                return undefined;
            }
            if (map.has(colour)) {
                return undefined;
            }
            map.set(colour, mult);
        }
        const multsUsed = new Set(map.values());
        if (multsUsed.size !== map.size) {
            return undefined;
        }
        return map;
    }

    private applySetupFromMap(map: Map<Colour, number>): void {
        const mults = this.multiplierValues();
        const seat = this.currplayer - 1;
        const row: Colour[] = [];
        for (let col = 0; col < mults.length; col++) {
            row[col] = undefined as unknown as Colour;
        }
        for (const [colour, mult] of map) {
            const col = mults.indexOf(mult);
            if (col >= 0) {
                row[col] = colour;
            }
        }
        this.objectives[seat] = row;
    }

    private setupMapComplete(map: Map<Colour, number>): boolean {
        return map.size === this.colourCount();
    }

    private colourFromAreaPiece(piece: string): Colour | undefined {
        const m = /^([A-Z]{2})\d$/.exec(piece);
        if (m === null) {
            return undefined;
        }
        const colour = m[1] as Colour;
        return activeColours(this.variants).includes(colour) ? colour : undefined;
    }

    /** Area clicks pass legend keys (e.g. RD2); map to a column index on a seat's objective row. */
    private objectiveColumnFromAreaPiece(piece: string, seat: number, viewer?: number): number | undefined {
        const n = this.colourCount();
        for (let col = 0; col < n; col++) {
            const colour = this.objectives[seat]![col]!;
            const disp = this.displayColour(colour, seat, col, viewer);
            const size = this.legendSizeForObjectiveDisplay(seat, col, viewer);
            if (legendKey(disp, size) === piece) {
                return col;
            }
        }
        return undefined;
    }

    private validateSetupMove(m: string): IValidationResult {
        if (m.length === 0) {
            return this.emptyMoveStatus();
        }
        const parsed = this.parseSetupMoveField(m);
        if (parsed === undefined) {
            return {
                valid: false,
                complete: 0,
                message: i18next.t("apgames:validation.agofmars.SETUP_PERM"),
            };
        }
        const { map, pending } = parsed;
        if (pending !== undefined && map.size === 0) {
            return {
                valid: true,
                complete: -1,
                message: i18next.t("apgames:validation.agofmars.SETUP_PARTIAL"),
            };
        }
        if (!this.setupMapComplete(map)) {
            return {
                valid: true,
                complete: 0,
                canrender: true,
                message: i18next.t("apgames:validation.agofmars.SETUP_PARTIAL"),
            };
        }
        if (pending !== undefined) {
            return {
                valid: true,
                complete: 0,
                canrender: true,
                message: i18next.t("apgames:validation.agofmars.SETUP_PARTIAL"),
            };
        }
        return {
            valid: true,
            complete: 1,
            message: i18next.t("apgames:validation._general.VALID_MOVE"),
        };
    }

    private handleSetupClick(move: string, row: number, col: number, piece?: string): IClickResult {
        const mults = this.multiplierValues();
        const parsed = this.parseSetupMoveField(move) ?? { map: new Map<Colour, number>() };
        const map = parsed.map;
        let pending = parsed.pending;

        if (piece !== undefined) {
            const colour = this.colourFromAreaPiece(piece);
            if (colour !== undefined) {
                pending = colour;
            }
        }

        if (row >= 0 && col >= 0 && col < mults.length) {
            const mult = mults[col]!;
            let existingAtCol: Colour | undefined;
            for (const [c, m] of map) {
                if (m === mult) {
                    existingAtCol = c;
                    break;
                }
            }
            if (pending !== undefined) {
                for (const [c, m] of [...map.entries()]) {
                    if (c === pending || m === mult) {
                        map.delete(c);
                    }
                }
                map.set(pending, mult);
                pending = undefined;
            } else if (existingAtCol !== undefined) {
                pending = existingAtCol;
            }
        }

        const moveOut = this.formatSetupMoveField(map, pending);
        const result = this.validateSetupMove(moveOut) as IClickResult;
        result.move = moveOut;
        return result;
    }

    private finishSetupPhase(): void {
        if (this.phase === "setup-1") {
            this.phase = "setup-2";
            this.currplayer = 2;
        } else {
            this.phase = "play";
            this.currplayer = 1;
            this.board = new Map();
        }
    }

    private isCommittedSetupLastmove(lastmove: string): boolean {
        const map = this.parseSetupWire(lastmove);
        return map !== undefined && map.size === this.colourCount();
    }

    private redactSetupLastmove(lastmove?: string): string | undefined {
        if (lastmove === undefined || this.gameover) {
            return lastmove;
        }
        if (this.isCommittedSetupLastmove(lastmove)) {
            return AgofmarsGame.REDACTED_SETUP_LASTMOVE;
        }
        return lastmove;
    }

    private stackEntryForExport(entry: IMoveState, strip: boolean): IMoveState {
        const base: IMoveState = {
            ...entry,
            board: new Map(entry.board),
            objectives: cloneState(entry.objectives) as Colour[][],
            objectivesRevealed: cloneState(entry.objectivesRevealed) as boolean[][],
        };
        if (strip && !this.gameover && entry.lastmove !== undefined) {
            base.lastmove = this.redactSetupLastmove(entry.lastmove);
        }
        return base;
    }

    public moveHistory(): string[][] {
        const moves = super.moveHistory();
        if (this.gameover) {
            return moves;
        }
        return moves.map(round =>
            round.map(m => this.redactSetupLastmove(m) ?? m),
        );
    }

    public moveHistoryWithSequence(): [number, string][][] {
        const moves = super.moveHistoryWithSequence();
        if (this.gameover) {
            return moves;
        }
        return moves.map(round =>
            round.map(([seat, m]) => [seat, this.redactSetupLastmove(m) ?? m]),
        );
    }

    private columnForMultiplierToken(token: string): number | undefined {
        const mult = AgofmarsGame.parseMultToken(token);
        if (mult === undefined) {
            return undefined;
        }
        const idx = this.multiplierValues().indexOf(mult);
        return idx >= 0 ? idx : undefined;
    }

    private formatObjSwapWire(colA: number, colB: number): string {
        const mults = this.multiplierValues();
        return `objSwap;${AgofmarsGame.formatMultToken(mults[colA]!)}|${AgofmarsGame.formatMultToken(mults[colB]!)}`;
    }

    private parseObjSwapWire(move: string): [number, number] | undefined {
        const multWire = /^objSwap;([^|]+)\|([^|]+)$/.exec(move);
        if (multWire !== null) {
            const a = this.columnForMultiplierToken(multWire[1]!);
            const b = this.columnForMultiplierToken(multWire[2]!);
            if (a !== undefined && b !== undefined) {
                return [a, b];
            }
            return undefined;
        }
        const legacy = /^obj(\d+)-(\d+)$/.exec(move);
        if (legacy !== null) {
            return [parseInt(legacy[1], 10), parseInt(legacy[2], 10)];
        }
        return undefined;
    }

    private parseObjSwapPartialColumn(move: string): number | undefined {
        const multPartial = /^objSwap;([^|]+)\|$/.exec(move);
        if (multPartial !== null) {
            return this.columnForMultiplierToken(multPartial[1]!);
        }
        const legacy = /^obj(\d+)-$/.exec(move);
        if (legacy !== null) {
            return parseInt(legacy[1], 10);
        }
        return undefined;
    }

    private applyObjSwap(a: number, b: number): void {
        const seat = this.objectiveSwapTargetSeat();
        const n = this.colourCount();
        if (a < 0 || b < 0 || a >= n || b >= n || a === b) {
            throw new UserFacingError("VALIDATION_GENERAL", "Invalid objective swap.");
        }
        const row = [...this.objectives[seat]!];
        const tmp = row[a]!;
        row[a] = row[b]!;
        row[b] = tmp;
        this.objectives[seat] = row;
        this.objectivesRevealed[seat]![a] = true;
        this.objectivesRevealed[seat]![b] = true;
        this.awaitingMainAction = true;
        this.results.push({
            type: "button",
            who: this.currplayer,
            why: this.formatObjSwapWire(a, b),
        });
    }

    private objectiveColumnLabel(col: number): string {
        return this.multiplierLabels()[col] ?? String(col + 1);
    }

    /** Objective row for a seat's `pieces` area (pyramid + multiplier caption below). */
    private objectiveAreaPieces(seat: number): [PiecesAreaLabeledPiece, ...PiecesAreaLabeledPiece[]] {
        const mults = this.multiplierLabels();
        const entries: PiecesAreaLabeledPiece[] = [];
        for (let col = 0; col < this.colourCount(); col++) {
            const colour = this.objectives[seat]![col]!;
            const disp = this.displayColour(colour, seat, col);
            entries.push({
                piece: legendKey(disp, this.objectiveDisplaySize(seat)),
                text: mults[col],
                textPosition: "below",
            });
        }
        return entries as [PiecesAreaLabeledPiece, ...PiecesAreaLabeledPiece[]];
    }

    private objectiveColumnLabelFromMultToken(token: string): string {
        const col = this.columnForMultiplierToken(token);
        if (col !== undefined) {
            return this.objectiveColumnLabel(col);
        }
        return token.replace("-", "\u2212");
    }

    private appendBoardActionAnnotations(
        annotations: NonNullable<APRenderRep["annotations"]>,
        results: APMoveResult[],
    ): void {
        const g = this.graph!;
        for (const r of results) {
            if (r.type === "move" && r.from !== undefined && r.to !== undefined) {
                const [fx, fy] = g.algebraic2coords(r.from);
                const [tx, ty] = g.algebraic2coords(r.to);
                annotations.push({
                    type: "move",
                    targets: [{ row: fy, col: fx }, { row: ty, col: tx }],
                });
            } else if (r.type === "swap" && r.where !== undefined && r.with !== undefined) {
                const [fx, fy] = g.algebraic2coords(r.where);
                const [tx, ty] = g.algebraic2coords(r.with);
                annotations.push({
                    type: "move",
                    targets: [{ row: fy, col: fx }, { row: ty, col: tx }],
                });
            } else if (r.type === "place" && r.where !== undefined) {
                const [x, y] = g.algebraic2coords(r.where);
                annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
            }
        }
    }

    private moveStepCount(piece: CellContents): number {
        if (this.variants.includes("step-move")) {
            return 1;
        }
        return piece[1];
    }

    /**
     * Empty cells exactly `steps` away in a straight cardinal line, with every
     * intermediate cell empty (pyramids slide their full pip count).
     */
    private cardinalDestinations(from: string, steps: number): Set<string> {
        const out = new Set<string>();
        if (steps <= 0) {
            return out;
        }
        const g = this.graph!;
        const [fx, fy] = g.algebraic2coords(from);
        const directions = [
            [0, -1],
            [0, 1],
            [-1, 0],
            [1, 0],
        ] as const;
        for (const [dx, dy] of directions) {
            let cx = fx;
            let cy = fy;
            let blocked = false;
            for (let step = 0; step < steps; step++) {
                const nx = cx + dx;
                const ny = cy + dy;
                if (nx < 0 || nx >= this.boardWidth() || ny < 0 || ny >= this.boardHeight()) {
                    blocked = true;
                    break;
                }
                const cell = g.coords2algebraic(nx, ny);
                if (this.board.has(cell)) {
                    blocked = true;
                    break;
                }
                cx = nx;
                cy = ny;
            }
            if (!blocked) {
                out.add(g.coords2algebraic(cx, cy));
            }
        }
        return out;
    }

    private moveDestinations(from: string): Set<string> {
        const piece = this.board.get(from);
        if (piece === undefined || piece[0] === "BK") {
            return new Set();
        }
        return this.cardinalDestinations(from, this.moveStepCount(piece));
    }

    /** Occupied cells that can complete a legal board swap with `from`. */
    private swapPartners(from: string): Set<string> {
        const out = new Set<string>();
        if (!this.board.has(from)) {
            return out;
        }
        for (const cell of this.board.keys()) {
            if (cell !== from && this.canSwapCells(from, cell)) {
                out.add(cell);
            }
        }
        return out;
    }

    private koReferenceBoard(): Map<string, CellContents> | undefined {
        for (let i = this.stack.length - 1; i >= 1; i--) {
            const prev = this.stack[i - 1]!;
            const cur = this.stack[i]!;
            const lm = cur.lastmove;
            if (
                lm === undefined ||
                lm === "draw" ||
                lm === "noObjSwap" ||
                lm.startsWith("objSwap") ||
                lm.startsWith("obj")
            ) {
                continue;
            }
            if (
                AgofmarsGame.parseBoardMoveWire(lm) === undefined &&
                AgofmarsGame.parseBoardSwapWire(lm) === undefined
            ) {
                continue;
            }
            if (cur.currplayer !== this.currplayer) {
                continue;
            }
            const raw = prev.board;
            const prevBoard: Map<string, CellContents> =
                raw instanceof Map
                    ? raw
                    : new Map<string, CellContents>(raw as Iterable<[string, CellContents]>);
            return new Map(prevBoard);
        }
        return undefined;
    }

    private violatesKo(after: Map<string, CellContents>): boolean {
        const ref = this.koReferenceBoard();
        if (ref === undefined) {
            return false;
        }
        return boardSignature(after) === boardSignature(ref);
    }

    private applyBoardMove(from: string, to: string): void {
        const piece = this.board.get(from)!;
        if (piece[0] === "BK") {
            throw new UserFacingError("VALIDATION_GENERAL", "Black pyramids cannot move.");
        }
        const after = new Map(this.board);
        after.delete(from);
        after.set(to, piece);
        if (this.violatesKo(after)) {
            throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation.agofmars.KO"));
        }
        this.board = after;
        this.results.push({ type: "move", from, to });
    }

    private applyBoardSwap(a: string, b: string): void {
        const pa = this.board.get(a)!;
        const pb = this.board.get(b)!;
        if (pa[0] === "BK" || pb[0] === "BK") {
            throw new UserFacingError("VALIDATION_GENERAL", "Cannot swap black pyramids.");
        }
        if (!this.pyramidsDissimilar(pa, pb)) {
            throw new UserFacingError("VALIDATION_GENERAL", "Swap requires dissimilar pyramids.");
        }
        if (!this.swapReachable(a, b) && !this.swapReachable(b, a)) {
            throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation.agofmars.SWAP"));
        }
        const after = new Map(this.board);
        after.set(a, pb);
        after.set(b, pa);
        if (this.violatesKo(after)) {
            throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation.agofmars.KO"));
        }
        this.board = after;
        this.results.push({
            type: "swap",
            where: a,
            with: b,
            what: `${AgofmarsGame.formatPieceWire(pa[0], pa[1])}|${AgofmarsGame.formatPieceWire(pb[0], pb[1])}`,
            who: this.currplayer,
        });
    }

    private boardFull(): boolean {
        return this.board.size >= this.boardWidth() * this.boardHeight();
    }

    private endGameIfFull(): void {
        if (!this.boardFull()) {
            return;
        }
        this.gameover = true;
        const scores = scoreGame(this.board, this.boardWidth(), this.boardHeight(), {
            variants: this.variants,
            objectives: this.objectives,
            multipliers: this.multiplierValues(),
        });
        let winner: playerid[] = [];
        if (scores[0]! > scores[1]!) {
            winner = [1];
        } else if (scores[1]! > scores[0]!) {
            winner = [2];
        } else {
            winner = [1, 2];
        }
        this.winner = winner;
        this.results.push(
            { type: "eog" },
            { type: "winners", players: [...winner] },
            { type: "deltaScore", who: 1, delta: scores[0]! },
            { type: "deltaScore", who: 2, delta: scores[1]! },
        );
    }

    private validationFail(message: string): IValidationResult {
        return { valid: false, complete: 0, message };
    }

    private validationOk(complete: 0 | 1 | -1, message?: string): IValidationResult {
        return {
            valid: true,
            complete,
            message: message ?? i18next.t("apgames:validation._general.VALID_MOVE"),
        };
    }

    private validateBoardSwapCells(a: string, b: string): IValidationResult {
        if (!this.canSwapCells(a, b)) {
            return this.validationFail(i18next.t("apgames:validation.agofmars.SWAP"));
        }
        const pa = this.board.get(a)!;
        const pb = this.board.get(b)!;
        const after = new Map(this.board);
        after.set(a, pb);
        after.set(b, pa);
        if (this.violatesKo(after)) {
            return this.validationFail(i18next.t("apgames:validation.agofmars.KO"));
        }
        return this.validationOk(1);
    }

    private validateBoardSlideMove(from: string, to: string): IValidationResult {
        if (!this.board.has(from)) {
            return this.validationFail(i18next.t("apgames:validation.agofmars.MOVE_SELECT_PIECE"));
        }
        const piece = this.board.get(from)!;
        if (piece[0] === "BK") {
            return this.validationFail(i18next.t("apgames:validation.agofmars.MOVE_BLACK"));
        }
        if (this.board.has(to)) {
            return this.validationFail(i18next.t("apgames:validation.agofmars.MOVE_DEST_OCCUPIED"));
        }
        if (!this.moveDestinations(from).has(to)) {
            return this.validationFail(i18next.t("apgames:validation.agofmars.MOVE"));
        }
        const after = new Map(this.board);
        after.delete(from);
        after.set(to, piece);
        if (this.violatesKo(after)) {
            return this.validationFail(i18next.t("apgames:validation.agofmars.KO"));
        }
        return this.validationOk(1);
    }

    /** Resolves a placement move (plain cell or colour@cell) to the target cell. */
    private resolvePlaceCell(m: string): string | undefined {
        if (this.pendingDraw === undefined) {
            return undefined;
        }
        const wired = AgofmarsGame.parsePlaceWire(m);
        if (wired !== undefined) {
            if (
                wired.colour !== this.pendingDraw[0] ||
                wired.size !== this.pendingDraw[1] ||
                this.board.has(wired.cell)
            ) {
                return undefined;
            }
            return wired.cell;
        }
        if (/^[a-z]+\d+$/.test(m) && !this.board.has(m)) {
            return m;
        }
        return undefined;
    }

    private validateObjSwapMode(): IValidationResult {
        if (this.awaitingMainAction || !this.canObjectiveSwap(this.currplayer)) {
            return this.validationFail(i18next.t("apgames:validation.agofmars.OBJ_SWAP"));
        }
        return {
            valid: true,
            complete: -1,
            message: i18next.t("apgames:validation.agofmars.OBJ_SWAP_SELECT"),
        };
    }

    private validatePlaceMove(m: string): IValidationResult {
        if (this.resolvePlaceCell(m) === undefined) {
            const wired = AgofmarsGame.parsePlaceWire(m);
            if (
                wired !== undefined &&
                this.pendingDraw !== undefined &&
                (wired.colour !== this.pendingDraw[0] || wired.size !== this.pendingDraw[1])
            ) {
                return this.validationFail(i18next.t("apgames:validation.agofmars.PLACE_DRAWN"));
            }
            return this.validationFail(i18next.t("apgames:validation.agofmars.PLACE"));
        }
        return this.validationOk(1);
    }

    private validatePlayMove(m: string): IValidationResult {
        if (this.pendingDraw !== undefined) {
            return this.validatePlaceMove(m);
        }

        if (m === "noObjSwap") {
            if (this.phase !== "play" || this.awaitingMainAction) {
                return this.validationFail(i18next.t("apgames:validation.agofmars.TURN_START"));
            }
            return this.validationOk(1);
        }

        if (m === "objSwap") {
            return this.validateObjSwapMode();
        }

        const partialCol = this.parseObjSwapPartialColumn(m);
        if (
            partialCol !== undefined &&
            (/^objSwap;[^|]+\|$/.test(m) || /^obj(\d+)-$/.test(m))
        ) {
            if (this.awaitingMainAction || !this.canObjectiveSwap(this.currplayer)) {
                return this.validationFail(i18next.t("apgames:validation.agofmars.OBJ_SWAP"));
            }
            if (partialCol < 0 || partialCol >= this.colourCount()) {
                return this.validationFail(i18next.t("apgames:validation.agofmars.OBJ_SWAP"));
            }
            return {
                valid: true,
                complete: 0,
                message: i18next.t("apgames:validation.agofmars.OBJ_SWAP_SELECT_SECOND"),
            };
        }

        const obj = this.parseObjSwapWire(m);
        if (obj !== undefined) {
            if (this.awaitingMainAction || !this.canObjectiveSwap(this.currplayer)) {
                return this.validationFail(i18next.t("apgames:validation.agofmars.OBJ_SWAP"));
            }
            return this.validationOk(1);
        }

        if (!this.awaitingMainAction) {
            return this.validationFail(i18next.t("apgames:validation.agofmars.TURN_START"));
        }

        const boardActionPartial = /^(move|swap);([a-z]+\d+)$/.exec(m);
        if (boardActionPartial !== null) {
            const mode = boardActionPartial[1] as "move" | "swap";
            const modeV = this.validateMainActionMode(mode);
            if (!modeV.valid) {
                return modeV;
            }
            const from = boardActionPartial[2]!;
            if (!this.board.has(from)) {
                return this.validationFail(i18next.t("apgames:validation.agofmars.MOVE_SELECT_PIECE"));
            }
            const [c] = this.board.get(from)!;
            if (c === "BK") {
                return this.validationFail(
                    i18next.t(
                        mode === "move"
                            ? "apgames:validation.agofmars.MOVE_BLACK"
                            : "apgames:validation.agofmars.SWAP_BLACK",
                    ),
                );
            }
            const selectMessage =
                mode === "move"
                    ? i18next.t("apgames:validation.agofmars.MOVE_SELECT_DEST")
                    : i18next.t("apgames:validation.agofmars.SWAP_SELECT_SECOND");
            return {
                valid: true,
                complete: -1,
                canrender: true,
                message: selectMessage,
            };
        }

        if (m === "move" || m === "swap") {
            return this.validateMainActionMode(m);
        }

        if (m === "draw") {
            if (this.buildDrawPool().length === 0) {
                return this.validationFail(i18next.t("apgames:validation.agofmars.EMPTY_BAG"));
            }
            return this.validationOk(1);
        }

        const swapWire = AgofmarsGame.parseBoardSwapWire(m);
        if (swapWire !== undefined) {
            if (
                swapWire.colourA !== undefined &&
                !this.boardPieceMatches(swapWire.cellA, swapWire.colourA, swapWire.sizeA)
            ) {
                return this.validationFail(i18next.t("apgames:validation.agofmars.SWAP"));
            }
            if (
                swapWire.colourB !== undefined &&
                !this.boardPieceMatches(swapWire.cellB, swapWire.colourB, swapWire.sizeB)
            ) {
                return this.validationFail(i18next.t("apgames:validation.agofmars.SWAP"));
            }
            return this.validateBoardSwapCells(swapWire.cellA, swapWire.cellB);
        }

        const slideWire = AgofmarsGame.parseBoardMoveWire(m);
        if (slideWire !== undefined) {
            if (
                slideWire.colour !== undefined &&
                !this.boardPieceMatches(slideWire.from, slideWire.colour, slideWire.size)
            ) {
                return this.validationFail(i18next.t("apgames:validation.agofmars.MOVE"));
            }
            return this.validateBoardSlideMove(slideWire.from, slideWire.to);
        }

        return this.validationFail(i18next.t("apgames:validation._general.DEFAULT_HANDLER"));
    }

    private assertValidatedMove(move: string, partial: boolean): void {
        if (this.gameover) {
            throw new UserFacingError("GAME_OVER", i18next.t("apgames:GAME_OVER"));
        }
        const result = this.validateMove(move);
        if (!result.valid) {
            throw new UserFacingError("VALIDATION_GENERAL", result.message);
        }
        if (partial) {
            if (this.phase.startsWith("setup")) {
                if (result.complete !== 0 && result.complete !== 1 && result.complete !== -1) {
                    throw new UserFacingError(
                        "VALIDATION_FAILSAFE",
                        i18next.t("apgames:validation._general.FAILSAFE", { move }),
                    );
                }
                return;
            }
            return;
        }
        if (result.complete !== 1) {
            if (this.phase.startsWith("setup")) {
                throw new UserFacingError(
                    "VALIDATION_GENERAL",
                    i18next.t("apgames:validation.agofmars.SETUP_INCOMPLETE"),
                );
            }
            throw new UserFacingError("VALIDATION_GENERAL", result.message);
        }
    }

    public move(m: string, { partial = false, trusted = false } = {} as IMoveOptions): AgofmarsGame {
        this.results = [];
        const move = m.trim();
        if (!trusted) {
            this.assertValidatedMove(move, partial);
        } else if (this.gameover) {
            throw new UserFacingError("GAME_OVER", i18next.t("apgames:GAME_OVER"));
        }

        if (this.phase.startsWith("setup")) {
            const colours = activeColours(this.variants);
            const parsed = this.parseSetupMoveField(move)!;
            const { map } = parsed;
            this.applySetupFromMap(map);
            if (partial) {
                return this;
            }
            const committed = AgofmarsGame.formatSetupWire(map, colours);
            this.results.push({ type: "button", who: this.currplayer, why: "objectives" });
            this.lastmove = committed;
            this.finishSetupPhase();
            this.saveState();
            return this;
        }

        if (this.pendingDraw !== undefined) {
            const cell = this.resolvePlaceCell(move)!;
            const piece = this.pendingDraw;
            const committed = AgofmarsGame.formatPlaceWire(piece[0], piece[1], cell);
            this.board.set(cell, piece);
            this.pendingDraw = undefined;
            this.clearBoardActionMode();
            this.lastmove = committed;
            this.results.push({
                type: "place",
                where: cell,
                what: piece[0],
                count: piece[1],
            });
            this.endGameIfFull();
            if (!this.gameover) {
                this.advancePlayer();
            }
            this.saveState();
            return this;
        }

        if (move === "noObjSwap") {
            this.awaitingMainAction = true;
            this.clearBoardActionMode();
            this.objSwapColumn = undefined;
            this.lastmove = move;
            this.results.push({ type: "button", who: this.currplayer, why: "noObjSwap" });
            this.saveState();
            return this;
        }

        if (partial) {
            if (move === "objSwap") {
                this.objSwapColumn = undefined;
                return this;
            }
            const partialCol = this.parseObjSwapPartialColumn(move);
            if (partialCol !== undefined && (/^objSwap;[^|]+\|$/.test(move) || /^obj(\d+)-$/.test(move))) {
                this.objSwapColumn = partialCol;
                return this;
            }
            const boardActionPartial = /^(move|swap)(;([a-z]+\d+))?$/.exec(move);
            if (boardActionPartial !== null) {
                const mode = boardActionPartial[1] as "move" | "swap";
                this.setBoardActionMode(mode);
                const from = boardActionPartial[3];
                if (from !== undefined) {
                    this.setBoardActionFrom(from);
                } else {
                    this.clearBoardActionFrom();
                }
                return this;
            }
        }

        const obj = this.parseObjSwapWire(move);
        if (obj !== undefined) {
            this.applyObjSwap(obj[0], obj[1]);
            this.objSwapColumn = undefined;
            this.lastmove = this.formatObjSwapWire(obj[0], obj[1]);
            this.saveState();
            return this;
        }

        if (move === "draw") {
            const pool = this.buildDrawPool();
            const drawn = shuffle([...pool])[0]! as PoolPiece;
            this.pendingDraw = [drawn[0], drawn[1]];
            this.awaitingMainAction = false;
            this.clearBoardActionMode();
            this.lastmove = move;
            this.results.push({ type: "deckDraw", what: drawn[0], count: drawn[1] });
            this.saveState();
            return this;
        }

        const swapWire = AgofmarsGame.parseBoardSwapWire(move);
        if (swapWire !== undefined) {
            const pa = this.board.get(swapWire.cellA)!;
            const pb = this.board.get(swapWire.cellB)!;
            this.applyBoardSwap(swapWire.cellA, swapWire.cellB);
            this.awaitingMainAction = false;
            this.clearBoardActionMode();
            this.lastmove = AgofmarsGame.formatBoardSwapWire(
                pa[0],
                pa[1],
                swapWire.cellA,
                pb[0],
                pb[1],
                swapWire.cellB,
            );
            this.endGameIfFull();
            if (!this.gameover) {
                this.advancePlayer();
            }
            this.saveState();
            return this;
        }

        const slideWire = AgofmarsGame.parseBoardMoveWire(move);
        if (slideWire !== undefined) {
            const piece = this.board.get(slideWire.from)!;
            this.applyBoardMove(slideWire.from, slideWire.to);
            this.awaitingMainAction = false;
            this.clearBoardActionMode();
            this.lastmove = AgofmarsGame.formatBoardMoveWire(
                piece[0],
                piece[1],
                slideWire.from,
                slideWire.to,
            );
            this.endGameIfFull();
            if (!this.gameover) {
                this.advancePlayer();
            }
            this.saveState();
            return this;
        }

        throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation._general.DEFAULT_HANDLER"));
    }

    private emptyMoveStatus(): IValidationResult {
        if (this.phase === "setup-1") {
            return {
                valid: true,
                complete: -1,
                message: i18next.t("apgames:validation.agofmars.INITIAL_INSTRUCTIONS", { context: "setup1" }),
            };
        }
        if (this.phase === "setup-2") {
            return {
                valid: true,
                complete: -1,
                message: i18next.t("apgames:validation.agofmars.INITIAL_INSTRUCTIONS", { context: "setup2" }),
            };
        }
        if (this.pendingDraw !== undefined) {
            return {
                valid: true,
                complete: -1,
                message: i18next.t("apgames:validation.agofmars.PLACE"),
            };
        }
        if (!this.awaitingMainAction) {
            return {
                valid: true,
                complete: -1,
                message: i18next.t("apgames:validation.agofmars.TURN_START"),
            };
        }
        return {
            valid: true,
            complete: -1,
            message: i18next.t("apgames:validation.agofmars.INITIAL_INSTRUCTIONS", { context: "play" }),
        };
    }

    public validateMove(move: string): IValidationResult {
        const m = move.trim();
        if (this.gameover) {
            return this.validationFail(i18next.t("apgames:GAME_OVER"));
        }
        if (this.phase.startsWith("setup")) {
            return this.validateSetupMove(m);
        }
        if (m.length === 0) {
            return this.emptyMoveStatus();
        }
        return this.validatePlayMove(m);
    }

    public getButtons(): ICustomButton[] {
        const buttons: ICustomButton[] = [];
        if (this.phase.startsWith("setup")) {
            return buttons;
        }
        if (this.pendingDraw !== undefined) {
            return buttons;
        }
        if (!this.awaitingMainAction) {
            buttons.push({
                label: "apgames:buttons.agofmars.noObjSwap",
                move: "noObjSwap",
            });
            if (this.canObjectiveSwap(this.currplayer)) {
                buttons.push({
                    label: "apgames:buttons.agofmars.objSwap",
                    move: "objSwap",
                });
            }
            return buttons;
        }
        buttons.push({ label: "apgames:buttons.agofmars.draw", move: "draw" });
        buttons.push({ label: "apgames:buttons.agofmars.move", move: "move" });
        buttons.push({ label: "apgames:buttons.agofmars.swap", move: "swap" });
        return buttons;
    }

    private syncBoardActionModeFromField(moveField: string): IValidationResult | undefined {
        const parsed = this.parseBoardActionMoveField(moveField);
        if (parsed === undefined) {
            return undefined;
        }
        const v = this.validateMainActionMode(parsed.mode);
        if (v.valid) {
            this.setBoardActionMode(parsed.mode);
            if (parsed.from !== undefined) {
                this.setBoardActionFrom(parsed.from);
            }
        }
        return v;
    }

    private preserveBoardActionMoveField(
        moveField: string,
        mode: "move" | "swap" | undefined,
        from?: string,
        wire = "",
    ): string {
        if (wire !== "") {
            return wire;
        }
        if (mode !== undefined) {
            return this.formatBoardActionMoveField(mode, from);
        }
        const parsed = this.parseBoardActionMoveField(moveField);
        if (parsed !== undefined) {
            return this.formatBoardActionMoveField(parsed.mode, parsed.from);
        }
        return wire;
    }

    /** First selected column while arming an objective swap (move field `objSwap;{mult}|`). */
    private restoreObjSwapColumnFromField(trimmed: string): void {
        const col = this.parseObjSwapPartialColumn(trimmed);
        if (col !== undefined && (/^objSwap;[^|]+\|$/.test(trimmed) || /^obj(\d+)-$/.test(trimmed))) {
            this.objSwapColumn = col;
        } else if (trimmed === "objSwap") {
            this.objSwapColumn = undefined;
        }
    }

    private objectiveSwapPartialWire(col: number): string {
        const mult = AgofmarsGame.formatMultToken(this.multiplierValues()[col]!);
        return `objSwap;${mult}|`;
    }

    private objectiveSwapClickOnColumn(col: number): IClickResult {
        if (this.objSwapColumn === undefined) {
            this.objSwapColumn = col;
            const partial = this.objectiveSwapPartialWire(col);
            return {
                valid: true,
                complete: 0,
                move: partial,
                message: i18next.t("apgames:validation.agofmars.OBJ_SWAP_SELECT_SECOND"),
            };
        }
        const from = this.objSwapColumn;
        this.objSwapColumn = undefined;
        const wire = this.formatObjSwapWire(from, col);
        const v = this.validatePlayMove(wire);
        if (!v.valid) {
            return {
                valid: false,
                complete: v.complete,
                message: v.message,
                move: this.objectiveSwapPartialWire(from),
            };
        }
        return { valid: true, complete: 1, move: wire, message: "" };
    }

    private handleObjectiveSwapClick(
        moveField: string,
        row: number,
        col: number,
        piece?: string,
    ): IClickResult {
        const mode = this.validateObjSwapMode();
        const trimmed = moveField.trim();
        if (!mode.valid) {
            return { valid: false, complete: mode.complete, message: mode.message, move: trimmed };
        }
        this.restoreObjSwapColumnFromField(trimmed);
        let column: number | undefined;
        if (row < 0 && col >= 0 && col < this.colourCount()) {
            column = col;
        } else if (row < 0 && col < 0 && piece !== undefined && piece !== "") {
            const seat = this.objectiveSwapTargetSeat();
            column = this.objectiveColumnFromAreaPiece(piece, seat, this.currplayer);
            if (column === undefined) {
                return {
                    valid: false,
                    complete: 0,
                    message: i18next.t("apgames:validation.agofmars.OBJ_SWAP_SELECT"),
                    move: trimmed === "objSwap" ? "objSwap" : trimmed,
                };
            }
        }
        if (column !== undefined) {
            return this.objectiveSwapClickOnColumn(column);
        }
        if (trimmed === "objSwap") {
            return {
                valid: true,
                complete: -1,
                message: mode.message,
                move: "objSwap",
            };
        }
        if (/^objSwap;[^|]+\|$/.test(trimmed) || /^obj(\d+)-$/.test(trimmed)) {
            return {
                valid: true,
                complete: 0,
                message: i18next.t("apgames:validation.agofmars.OBJ_SWAP_SELECT_SECOND"),
                move: trimmed,
            };
        }
        const full = this.parseObjSwapWire(trimmed);
        if (full !== undefined) {
            const v = this.validatePlayMove(trimmed);
            return { ...v, move: trimmed };
        }
        return {
            valid: true,
            complete: -1,
            message: mode.message,
            move: "objSwap",
        };
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        if (this.phase.startsWith("setup")) {
            return this.handleSetupClick(move, row, col, piece);
        }
        if (
            this.phase === "play" &&
            !this.awaitingMainAction &&
            this.pendingDraw === undefined
        ) {
            const t = move.trim();
            if (t === "objSwap" || t.startsWith("objSwap;") || /^obj\d/.test(t)) {
                return this.handleObjectiveSwapClick(move, row, col, piece);
            }
        }
        const modeCheck = this.syncBoardActionModeFromField(move);
        if (modeCheck !== undefined && !modeCheck.valid) {
            return {
                valid: false,
                complete: modeCheck.complete,
                message: modeCheck.message,
                move: move.trim(),
            };
        }
        return this.clickResult(row, col, piece, move);
    }

    public handleClickResult(result: IClickResult): void {
        const m = result.move?.trim() ?? "";
        const boardAction = this.parseBoardActionMoveField(m);
        if (boardAction !== undefined && result.complete !== 1) {
            const v = this.validateMainActionMode(boardAction.mode);
            if (v.valid) {
                this.move(m, { partial: true });
            }
            return;
        }
        if (m !== "") {
            this.move(m);
        }
    }

    protected plyFromStack(stackIndex: number): IGamePly {
        const ply = super.plyFromStack(stackIndex);
        for (const r of ply.results) {
            if (r.type !== "place" || r.where === undefined || r.what === undefined) {
                continue;
            }
            const colour = r.what as Colour;
            if (AgofmarsGame.parsePlaceWire(ply.move)?.cell === r.where) {
                return ply;
            }
            if (/^[a-z]+\d+$/.test(ply.move) && ply.move === r.where) {
                const size = (r.count ?? 1) as Size;
                return { ...ply, move: AgofmarsGame.formatPlaceWire(colour, size, r.where) };
            }
        }
        return ply;
    }

    public collectChatLogLine(lines: ChatLogLine[], r: APMoveResult, ctx: ChatLogCollectContext): boolean {
        if (r.type === "button" && r.why === "objectives") {
            this.pushSeatChatLine(lines, r.who ?? ctx.defaultSeat, "apresults:OBJECTIVES.agofmars", {});
            return true;
        }
        if (r.type === "button" && r.why === "noObjSwap") {
            this.pushSeatChatLine(lines, r.who ?? ctx.defaultSeat, "apresults:PASS.agofmars_noObjSwap", {});
            return true;
        }
        if (r.type === "button" && r.why?.startsWith("objSwap;") === true) {
            const body = r.why.slice("objSwap;".length);
            const [tokenA, tokenB] = body.split("|");
            this.pushSeatChatLine(lines, r.who ?? ctx.defaultSeat, "apresults:OBJECTIVE_SWAP.agofmars", {
                columnA: this.objectiveColumnLabelFromMultToken(tokenA ?? ""),
                columnB: this.objectiveColumnLabelFromMultToken(tokenB ?? ""),
            });
            return true;
        }
        if (r.type === "move" && r.from !== undefined && r.to !== undefined) {
            this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:MOVE.agofmars", {
                from: r.from,
                to: r.to,
            });
            return true;
        }
        if (r.type === "swap" && r.where !== undefined && r.with !== undefined) {
            const seat = r.who ?? ctx.defaultSeat;
            const pieces = r.what?.split("|") ?? [];
            const p1 = AgofmarsGame.parsePieceWire(pieces[0] ?? "");
            const p2 = AgofmarsGame.parsePieceWire(pieces[1] ?? "");
            if (p1 !== undefined && p2 !== undefined) {
                this.pushSeatChatLine(lines, seat, "apresults:SWAP.agofmars_board", {
                    colour1: p1.colour,
                    size1: p1.size,
                    cell1: r.where,
                    colour2: p2.colour,
                    size2: p2.size,
                    cell2: r.with,
                });
                return true;
            }
            this.pushSeatChatLine(lines, seat, "apresults:SWAP.agofmars_board_cells", {
                cell1: r.where,
                cell2: r.with,
            });
            return true;
        }
        if (r.type === "place" && r.where !== undefined && r.what !== undefined) {
            this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:PLACE.agofmars", {
                colour: r.what,
                count: r.count ?? "",
                where: r.where,
            });
            return true;
        }
        if (r.type === "deckDraw" && r.what !== undefined && r.count !== undefined) {
            this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:DECKDRAW.agofmars", {
                colour: r.what,
                count: r.count,
            });
            return true;
        }
        return super.collectChatLogLine(lines, r, ctx);
    }

    public clickResult(row: number, col: number, _piece?: string, moveField = ""): IClickResult {
        const mode = this.resolvedBoardActionMode(moveField);
        const keepField = (from?: string, wire = ""): string =>
            this.preserveBoardActionMoveField(moveField, mode, from, wire);
        const invalid = (message: string, from?: string): IClickResult => ({
            valid: false,
            complete: 0,
            message,
            move: keepField(from),
            canrender: true,
        });
        const selecting = (
            from: string,
            message: string,
        ): IClickResult => ({
            valid: true,
            complete: -1,
            message,
            move: keepField(from),
            canrender: true,
        });

        if (this.gameover) {
            return invalid(i18next.t("apgames:GAME_OVER"));
        }
        const cell = AgofmarsGame.coords2algebraic(col, row, this.boardCoordHeight());

        if (this.pendingDraw !== undefined) {
            if (!this.board.has(cell)) {
                const [c, s] = this.pendingDraw;
                const wire = AgofmarsGame.formatPlaceWire(c, s, cell);
                const v = this.validatePlaceMove(wire);
                if (!v.valid) {
                    return { ...v, move: wire };
                }
                return { valid: true, complete: 1, move: wire, message: "" };
            }
            return invalid(i18next.t("apgames:validation.agofmars.PLACE"));
        }

        if (this.awaitingMainAction && mode !== undefined) {
            const fromCell = this.resolvedBoardActionFrom(moveField);
            if (fromCell === undefined) {
                if (!this.board.has(cell)) {
                    return invalid(
                        mode === "move"
                            ? i18next.t("apgames:validation.agofmars.MOVE_SELECT_PIECE")
                            : i18next.t("apgames:validation.agofmars.SWAP_SELECT_PIECE"),
                    );
                }
                const [c] = this.board.get(cell)!;
                if (c === "BK") {
                    return invalid(
                        mode === "move"
                            ? i18next.t("apgames:validation.agofmars.MOVE_BLACK")
                            : i18next.t("apgames:validation.agofmars.SWAP_BLACK"),
                    );
                }
                this.setBoardActionFrom(cell);
                return selecting(
                    cell,
                    mode === "move"
                        ? i18next.t("apgames:validation.agofmars.MOVE_SELECT_DEST")
                        : i18next.t("apgames:validation.agofmars.SWAP_SELECT_SECOND"),
                );
            }

            if (mode === "move") {
                if (this.board.has(cell)) {
                    const [c] = this.board.get(cell)!;
                    if (c === "BK") {
                        return invalid(
                            i18next.t("apgames:validation.agofmars.MOVE_BLACK"),
                            fromCell,
                        );
                    }
                    if (cell !== fromCell) {
                        this.setBoardActionFrom(cell);
                        return selecting(
                            cell,
                            i18next.t("apgames:validation.agofmars.MOVE_SELECT_DEST"),
                        );
                    }
                    return invalid(
                        i18next.t("apgames:validation.agofmars.MOVE_SELECT_DEST"),
                        fromCell,
                    );
                }
                const v = this.validateBoardSlideMove(fromCell, cell);
                if (v.valid) {
                    const [colour, size] = this.board.get(fromCell)!;
                    return {
                        valid: true,
                        complete: 1,
                        move: AgofmarsGame.formatBoardMoveWire(colour, size, fromCell, cell),
                        message: "",
                    };
                }
                return { ...v, move: keepField(fromCell), canrender: true };
            }

            if (mode === "swap") {
                if (!this.board.has(cell)) {
                    return invalid(
                        i18next.t("apgames:validation.agofmars.SWAP_SELECT_SECOND"),
                        fromCell,
                    );
                }
                const [c] = this.board.get(cell)!;
                if (c === "BK") {
                    return invalid(
                        i18next.t("apgames:validation.agofmars.SWAP_BLACK"),
                        fromCell,
                    );
                }
                if (cell === fromCell) {
                    return invalid(
                        i18next.t("apgames:validation.agofmars.SWAP_SELECT_SECOND"),
                        fromCell,
                    );
                }
                const v = this.validateBoardSwapCells(fromCell, cell);
                if (v.valid) {
                    const pa = this.board.get(fromCell)!;
                    const pb = this.board.get(cell)!;
                    return {
                        valid: true,
                        complete: 1,
                        move: AgofmarsGame.formatBoardSwapWire(
                            pa[0],
                            pa[1],
                            fromCell,
                            pb[0],
                            pb[1],
                            cell,
                        ),
                        message: "",
                    };
                }
                this.setBoardActionFrom(cell);
                return {
                    ...v,
                    move: keepField(cell),
                    canrender: true,
                };
            }
        }

        if (this.awaitingMainAction && mode === undefined) {
            return invalid(i18next.t("apgames:validation.agofmars.MAIN_ACTION_CHOICE"));
        }

        const idle = this.emptyMoveStatus();
        return {
            valid: idle.valid,
            complete: idle.complete ?? -1,
            message: idle.message,
            move: keepField(),
        };
    }

    private legalPlacementCells(): string[] {
        const out: string[] = [];
        for (let r = 0; r < this.boardHeight(); r++) {
            for (let c = 0; c < this.boardWidth(); c++) {
                const cell = AgofmarsGame.coords2algebraic(c, r, this.boardHeight());
                const v = this.validateMove(cell);
                if (v.valid && v.complete === 1) {
                    out.push(cell);
                }
            }
        }
        return out;
    }

    private legalMainActions(): string[] {
        const out: string[] = [];
        const drawV = this.validateMove("draw");
        if (drawV.valid && drawV.complete === 1) {
            out.push("draw");
        }
        const cells = [...this.board.keys()];
        for (const from of cells) {
            const piece = this.board.get(from)!;
            if (piece[0] === "BK") {
                continue;
            }
            for (const to of this.moveDestinations(from)) {
                if (this.board.has(to)) {
                    continue;
                }
                const wire = `${from}-${to}`;
                const v = this.validateMove(wire);
                if (v.valid && v.complete === 1) {
                    out.push(wire);
                }
            }
        }
        const swapSeen = new Set<string>();
        for (let i = 0; i < cells.length; i++) {
            for (let j = i + 1; j < cells.length; j++) {
                const a = cells[i]!;
                const b = cells[j]!;
                if (!this.canSwapCells(a, b)) {
                    continue;
                }
                const key = a < b ? `${a}|${b}` : `${b}|${a}`;
                if (swapSeen.has(key)) {
                    continue;
                }
                swapSeen.add(key);
                const v = this.validateMove(key);
                if (v.valid && v.complete === 1) {
                    out.push(key);
                }
            }
        }
        return out;
    }

    private randomMainAction(): string {
        const actions = this.legalMainActions();
        if (actions.length === 0) {
            return "";
        }
        const board = actions.filter(a => a !== "draw");
        const canDraw = actions.includes("draw");
        if (!canDraw) {
            return shuffle(board)[0]!;
        }
        if (board.length === 0) {
            return "draw";
        }
        if (Math.random() < 0.75) {
            return "draw";
        }
        return shuffle(board)[0]!;
    }

    public randomMove(): string {
        if (this.phase.startsWith("setup")) {
            const colours = activeColours(this.variants);
            const mults = shuffle([...this.multiplierValues()]);
            const map = new Map<Colour, number>();
            for (let i = 0; i < colours.length; i++) {
                map.set(colours[i]!, mults[i]!);
            }
            return AgofmarsGame.formatSetupWire(map, colours);
        }
        if (this.pendingDraw !== undefined) {
            const cells = this.legalPlacementCells();
            if (cells.length === 0) {
                return "";
            }
            return shuffle(cells)[0]!;
        }
        if (!this.awaitingMainAction) {
            return "noObjSwap";
        }
        return this.randomMainAction();
    }

    public sidebarStatuses(): IStatus[] {
        if (this.phase === "play") {
            return [
                {
                    key: this.neutralAreaLabel("apgames:status.agofmars.bagCount"),
                    value: [String(this.buildDrawPool().length)],
                },
            ];
        }
        return [];
    }

    public sidebarScores(): IScores[] {
        if (!this.gameover) {
            return [];
        }
        const scores = scoreGame(this.board, this.boardWidth(), this.boardHeight(), {
            variants: this.variants,
            objectives: this.objectives,
            multipliers: this.multiplierValues(),
        });
        return [
            {
                name: this.neutralAreaLabel("apgames:status.SCORES"),
                scores: [scores[0]!, scores[1]!],
            },
        ];
    }

    private displayColour(colour: Colour, seat: number, col: number, viewer?: number): Colour {
        if (this.gameover) {
            return colour;
        }
        if (this.phase.startsWith("setup")) {
            if (viewer === undefined) {
                return colour;
            }
            const ownerSeat = this.phase === "setup-1" ? 0 : 1;
            if (seat === ownerSeat && viewer === seat + 1) {
                return colour;
            }
            if (seat !== ownerSeat) {
                return "BK";
            }
            return "BK";
        }
        const rev = this.objectivesRevealed[seat]![col];
        if (rev) {
            return colour;
        }
        if (viewer === undefined) {
            return colour;
        }
        const v = viewer - 1;
        if (v !== seat) {
            return "BK";
        }
        if (this.variants.includes("blind-agents")) {
            return "BK";
        }
        return colour;
    }

    public state(opts?: { strip?: boolean; player?: number }): IAgofmarsState {
        const strip = opts?.strip === true;
        const player = opts?.player;
        const stack = this.stack.map((entry, idx) => {
            if (!strip || idx === 0) {
                return this.stackEntryForExport(entry, strip);
            }
            const e = this.stackEntryForExport(entry, strip);
            if (player !== undefined) {
                e.objectives = entry.objectives.map((row, seat) =>
                    row.map((col, ci) => this.displayColour(col, seat, ci, player)),
                ) as Colour[][];
            }
            return e;
        });
        return {
            game: AgofmarsGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack,
        };
    }

    public render(): APRenderRep {
        const legend: ILegendObj = {};
        for (const c of [...activeColours(this.variants), "BK" as Colour]) {
            for (let s = 1 as Size; s <= 3; s++) {
                legend[legendKey(c, s)] = glyphFor(c, s);
            }
        }

        if (this.phase.startsWith("setup")) {
            const w = this.colourCount();
            const row: string[] = [];
            const seat = this.phase === "setup-1" ? 0 : 1;
            for (let col = 0; col < w; col++) {
                const colour = this.objectives[seat]![col];
                if (colour !== undefined) {
                    const disp = this.displayColour(colour, seat, col);
                    const sz = disp === "BK" ? this.setupBlackSize(seat) : this.setupColourSize(seat);
                    row.push(legendKey(disp, sz));
                } else {
                    row.push("");
                }
            }
            const colours = activeColours(this.variants);
            const size = this.setupColourSize(seat);
            const unplaced = colours
                .filter(c => !this.objectives[seat]!.includes(c))
                .map(c => legendKey(c, size));
            const areas: AreaPieces[] =
                unplaced.length > 0
                    ? [
                          {
                              type: "pieces",
                              label: i18next.t("apgames:status.agofmars.setupPool"),
                              pieces: unplaced as [string, ...string[]],
                          },
                      ]
                    : [];
            return {
                board: {
                    style: "squares",
                    width: w,
                    height: 1,
                    rowLabels: [],
                    columnLabels: this.multiplierLabels(),
                },
                legend,
                pieces: row.join(","),
                areas,
            };
        }

        const pieceRows: string[] = [];
        for (let r = 0; r < this.boardHeight(); r++) {
            const row: string[] = [];
            for (let c = 0; c < this.boardWidth(); c++) {
                const cell = AgofmarsGame.coords2algebraic(c, r, this.boardHeight());
                const p = this.board.get(cell);
                row.push(p !== undefined ? legendKey(p[0], p[1]) : "");
            }
            pieceRows.push(row.join(","));
        }

        const areas: (AreaPieces | AreaKey)[] = [];
        for (let seat = 0; seat < 2; seat++) {
            areas.push({
                type: "pieces",
                label: this.seatAreaLabel(seat + 1, "apgames:status._player"),
                pieces: this.objectiveAreaPieces(seat),
            });
        }

        if (this.pendingDraw !== undefined) {
            const [c, s] = this.pendingDraw;
            const key: AreaKey = {
                type: "key",
                position: "left",
                height: 0.7,
                list: [{ piece: legendKey(c, s), name: "" }],
                clickable: false,
            };
            areas.unshift(key);
        }

        const annotations: NonNullable<APRenderRep["annotations"]> = [];
        this.appendBoardActionAnnotations(annotations, this.results);
        if (
            this.awaitingMainAction &&
            this.boardActionFrom !== undefined &&
            (this.boardActionMode === "move" || this.boardActionMode === "swap")
        ) {
            const targets: { row: number; col: number }[] = [];
            const graph = this.graph!;
            const dests =
                this.boardActionMode === "move"
                    ? this.moveDestinations(this.boardActionFrom)
                    : this.swapPartners(this.boardActionFrom);
            for (const dest of dests) {
                if (this.boardActionMode === "move" && this.board.has(dest)) {
                    continue;
                }
                const [x, y] = graph.algebraic2coords(dest);
                if (x >= 0 && x < this.boardWidth() && y >= 0 && y < this.boardHeight()) {
                    targets.push({ row: y, col: x });
                }
            }
            if (targets.length > 0) {
                annotations.push({
                    type: "dots",
                    targets: targets as [{ row: number; col: number }, ...{ row: number; col: number }[]],
                    opacity: 0.25,
                    colour: "_context_fill",
                });
            }
        }

        const rep: APRenderRep = {
            board: {
                style: "squares",
                width: this.boardWidth(),
                height: this.boardHeight(),
            },
            legend,
            pieces: pieceRows.join("\n"),
            areas,
            annotations: annotations.length > 0 ? annotations : undefined,
        };

        if (
            this.awaitingMainAction &&
            this.boardActionFrom !== undefined &&
            (this.boardActionMode === "move" || this.boardActionMode === "swap")
        ) {
            const [x, y] = this.graph!.algebraic2coords(this.boardActionFrom);
            (rep.board as BoardBasic).markers = [
                {
                    type: "flood",
                    colour: "_context_fill",
                    opacity: 0.25,
                    points: [{ row: y, col: x }],
                },
            ];
        }

        return rep;
    }
}
