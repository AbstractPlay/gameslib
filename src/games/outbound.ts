import { GameBase, IAPGameState, IClickResult, ICustomButton, IIndividualState, IRenderOpts, IStatus, IValidationResult, type ChatLogCollectContext, type ChatLogLine } from "./_base.js";
import type { APGamesInformation } from "../schemas/gameinfo.js";
import type { APRenderRep, Colourfuncs, RowCol } from "@abstractplay/renderer/build/schemas/schema";
import type { APMoveResult } from "../schemas/moveresults.js";
import { reviver, UserFacingError } from "../common/index.js";
import i18next from "i18next";

export const gameApgamesEn = {
    validation: {
        INSTRUCTIONS_AUCTION: "Place a Hunter stone on the perimeter of the board. If you think the Hunter can stop the Defender from this setup, instead move a Hunter stone: you then play as the Hunter and have made the first Hunter move.",
        INSTRUCTIONS_WHITE: "Select a Hunter stone to move.",
        INSTRUCTIONS_WHITE_TO: "Select an empty space in a straight line from the stone to move it there.",
        INSTRUCTIONS_WHITE_PASS: "You have no legal move, so you must pass.",
        INSTRUCTIONS_BLACK: "Place stones next to your groups. Every group that has liberties must grow exactly once.",
        BLACK_MORE_one: "One group can still grow. Place a stone next to it.",
        BLACK_MORE_other: "{{count}} groups can still grow. Place a stone next to one of them.",
        NOT_PERIMETER: "{{where}} is not on the perimeter of the board.",
        OCCUPIED: "{{where}} is not empty.",
        NOT_WHITE: "{{where}} does not hold a Hunter stone.",
        BAD_LINE: "A Hunter stone must move in a straight line, orthogonally or diagonally.",
        BLOCKED: "The path from {{from}} to {{to}} is blocked.",
        NOT_GROWABLE: "{{where}} is not next to a Defender group that can still grow this turn.",
    },
    status: {
        WHITE: "Hunter",
        BLACK: "Defender",
        UNDECIDED: "Not yet chosen",
        PHASE_AUCTION: "{{player}} places a Hunter stone or moves one to play as the Hunter",
    },
};
export const gameApresultsEn = {
    CAPTURE: {
        flip_one: "{{player}} flipped the Defender stone at {{where}}.",
        flip_other: "{{player}} flipped {{count}} Defender stones: {{where}}.",
    },
    CLAIM: {
        white: "{{player}} declared that the Hunter can stop the Defender, and plays as the Hunter.",
    },
    EOG: {
        edge: "The game has ended because the king reached the edge of the board.",
        trapped: "The game has ended because the king has no liberties and cannot grow.",
    },
};

export type playerid = 1 | 2;
export type Stone = "W" | "B";
export type Board = Map<string, Stone>;
type Phase = "auction" | "white" | "black";

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Board;
    lastmove?: string;
    /** Cell of the stone carrying the crown. */
    crown: string;
    /** Set once a player declares in the auction. */
    whiteSeat?: playerid;
}

export interface IOutboundState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
}

interface IBlackSim {
    error?: { key: string; params: Record<string, string> };
    board: Board;
    crown: string;
    /** Number of groups that still have liberties and have not grown. */
    remaining: number;
    /** Indices of placements that touched two or more distinct groups. */
    mergers: number[];
}

const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const ORTH: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const CELL_RE = /^[a-z]+\d+$/;
const MOVE_RE = /^([a-z]+\d+)-([a-z]+\d+)$/;
const UNDECIDED_COLOUR = "#999999";

const stonePaint = (fill: number | string): { fill: number | string; border: Colourfuncs } => ({
    fill,
    border: { func: "bestContrast", bg: fill, fg: ["#000", "#fff"] },
});

export class OutboundGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Outbound",
        uid: "outbound",
        playercounts: [2],
        version: "20261104",
        dateAdded: "2026-11-04",
        description: "An asymmetric game on a Go board. The Defender grows groups of stones, one stone per group per turn, and wins by bringing the crowned group to the edge; the Hunter slides stones around the board and flips lone Defender stones to trap it.",
        notes: "The Defender starts with one stone in the centre, holding the crown. The king is the Defender group containing the crown. The Hunter starts with stones placed along the perimeter: players take turns adding Hunter stones until one of them, instead of placing, declares that they can stop the Defender and makes the first Hunter move.\n\nOn the Hunter's turn, one Hunter stone slides in a straight line, orthogonally or diagonally, over empty or Hunter spaces onto an empty space. If the moved stone and another Hunter stone flank a single Defender stone, orthogonally or diagonally, that stone changes sides. One move can flip several stones, but the stone carrying the crown is never flipped. The Hunter must pass if there is no legal move.\n\nOn the Defender's turn, each Defender group with liberties must grow once by a stone placed orthogonally next to it. A placement uses up the growth of every group it touches, so growing another group may merge groups that have already grown. At the end of the turn the crown moves to the most recently placed stone in the king.\n\nThe Defender wins if the king reaches the edge. The Hunter wins if the king has no liberties.",
        people: [
            {
                type: "designer",
                name: "Alek Erickson",
                urls: ["https://boardgamegeek.com/boardgamedesigner/101050/alek-erickson"],
                apid: "e98f96b2-5dbb-492c-bf46-85207bd29242",
            },
            {
                type: "coder",
                name: "ManaT",
                urls: [],
                apid: "a82c4aa8-7d43-4661-b027-17afd1d1586f",
            }
        ],
        categories: ["goal>breakthrough", "goal>immobilize", "mechanic>place", "mechanic>move", "mechanic>convert", "mechanic>asymmetry", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["experimental", "custom-colours", "custom-buttons", "no-moves"],
        customizations: [
            {
                num: 1,
                default: 1,
                explanation: "Colour of the Hunter's stones",
            },
            {
                num: 2,
                default: 2,
                explanation: "Colour of the Defender's stones",
            },
        ],
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Board;
    public crown!: string;
    public whiteSeat?: playerid;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private readonly boardSize = 19;
    /** A White stone picked up by a partial move; never saved. */
    private selected?: string;

    constructor(state?: IOutboundState | string) {
        super();
        if (state === undefined) {
            const mid = (this.boardSize - 1) / 2;
            const centre = GameBase.coords2algebraic(mid, mid, this.boardSize);
            const fresh: IMoveState = {
                _version: OutboundGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map<string, Stone>([[centre, "B"]]),
                crown: centre,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IOutboundState;
            }
            if (state.game !== OutboundGame.gameinfo.uid) {
                throw new Error(`The Outbound engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): OutboundGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if (idx < 0 || idx >= this.stack.length) {
            throw new Error("Could not load the requested state from the stack.");
        }
        const state = this.stack[idx];
        this.results = [...state._results];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.lastmove = state.lastmove;
        this.crown = state.crown;
        this.whiteSeat = state.whiteSeat;
        this.selected = undefined;
        return this;
    }

    private get phase(): Phase {
        if (this.whiteSeat === undefined) { return "auction"; }
        return this.currplayer === this.whiteSeat ? "white" : "black";
    }

    private otherSeat(seat: playerid): playerid {
        return seat === 1 ? 2 : 1;
    }

    private toCell(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardSize);
    }

    private toXY(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardSize);
    }

    private isValidCell(cell: string): boolean {
        if (!CELL_RE.test(cell)) { return false; }
        try {
            const [x, y] = this.toXY(cell);
            return this.inBounds(x, y) && this.toCell(x, y) === cell;
        } catch {
            return false;
        }
    }

    private inBounds(x: number, y: number): boolean {
        return x >= 0 && y >= 0 && x < this.boardSize && y < this.boardSize;
    }

    private isEdge(cell: string): boolean {
        const [x, y] = this.toXY(cell);
        const last = this.boardSize - 1;
        return x === 0 || y === 0 || x === last || y === last;
    }

    private orth(cell: string): string[] {
        const [x, y] = this.toXY(cell);
        return ORTH.filter(([dx, dy]) => this.inBounds(x + dx, y + dy)).map(([dx, dy]) => this.toCell(x + dx, y + dy));
    }

    /** The orthogonally connected Black group containing `cell`. */
    private group(board: Board, cell: string): string[] {
        const seen = new Set<string>([cell]);
        const queue = [cell];
        while (queue.length > 0) {
            const next = queue.pop()!;
            for (const n of this.orth(next)) {
                if (board.get(n) === "B" && !seen.has(n)) {
                    seen.add(n);
                    queue.push(n);
                }
            }
        }
        return [...seen];
    }

    private hasLiberty(board: Board, group: string[]): boolean {
        return group.some((c) => this.orth(c).some((n) => !board.has(n)));
    }

    /** Cells a White stone at `from` can slide to: straight lines over empty or White spaces. */
    private slides(from: string, board: Board = this.board): string[] {
        const [x, y] = this.toXY(from);
        const targets: string[] = [];
        for (const [dx, dy] of DIRS) {
            let cx = x + dx;
            let cy = y + dy;
            while (this.inBounds(cx, cy)) {
                const cell = this.toCell(cx, cy);
                const contents = board.get(cell);
                if (contents === "B") { break; }
                if (contents === undefined) { targets.push(cell); }
                cx += dx;
                cy += dy;
            }
        }
        return targets;
    }

    private whiteMoves(): string[] {
        const moves: string[] = [];
        for (const [cell, stone] of this.board) {
            if (stone === "W") {
                for (const to of this.slides(cell)) {
                    moves.push(`${cell}-${to}`);
                }
            }
        }
        return moves;
    }

    private perimeterCells(): string[] {
        const cells: string[] = [];
        for (let y = 0; y < this.boardSize; y++) {
            for (let x = 0; x < this.boardSize; x++) {
                const cell = this.toCell(x, y);
                if (this.isEdge(cell) && !this.board.has(cell)) {
                    cells.push(cell);
                }
            }
        }
        return cells;
    }

    /** Replay a Black turn placement by placement, reporting the first illegal one. */
    private simulateBlack(cells: string[]): IBlackSim {
        const board = new Map(this.board);
        const grown = new Set<string>();
        const mergers: number[] = [];
        const fail = (key: string, params: Record<string, string>): IBlackSim =>
            ({ error: { key, params }, board, crown: this.crown, remaining: 0, mergers });
        for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            if (!this.isValidCell(cell)) {
                return fail("apgames:validation._general.INVALID_MOVE", { move: cell });
            }
            if (board.has(cell)) {
                return fail("apgames:validation.outbound.OCCUPIED", { where: cell });
            }
            const groups: string[][] = [];
            const seen = new Set<string>();
            for (const n of this.orth(cell)) {
                if (board.get(n) === "B" && !seen.has(n)) {
                    const g = this.group(board, n);
                    g.forEach((s) => seen.add(s));
                    groups.push(g);
                }
            }
            if (!groups.some((g) => !grown.has(g[0]))) {
                return fail("apgames:validation.outbound.NOT_GROWABLE", { where: cell });
            }
            if (groups.length >= 2) { mergers.push(i); }
            board.set(cell, "B");
            grown.add(cell);
            groups.forEach((g) => g.forEach((s) => grown.add(s)));
        }
        let remaining = 0;
        const counted = new Set<string>();
        for (const [cell, stone] of board) {
            if (stone === "B" && !counted.has(cell)) {
                const g = this.group(board, cell);
                g.forEach((s) => counted.add(s));
                if (!grown.has(cell) && this.hasLiberty(board, g)) { remaining++; }
            }
        }
        const king = new Set(this.group(board, this.crown));
        let crown = this.crown;
        for (let i = cells.length - 1; i >= 0; i--) {
            if (king.has(cells[i])) {
                crown = cells[i];
                break;
            }
        }
        return { board, crown, remaining, mergers };
    }

    public moves(): string[] {
        if (this.gameover) { return []; }
        switch (this.phase) {
            case "auction":
                return [...this.perimeterCells(), ...this.whiteMoves()];
            case "white": {
                const moves = this.whiteMoves();
                return moves.length > 0 ? moves : ["pass"];
            }
            default:
                // Black's turns are ordered sequences of placements; they are not enumerated.
                return [];
        }
    }

    public getButtons(): ICustomButton[] {
        if (this.gameover || this.phase !== "white" || this.whiteMoves().length > 0) {
            return [];
        }
        return [{ label: "apgames:buttons.pass", move: "pass" }];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.toCell(col, row);
            const newmove = this.phase === "black" ? this.clickBlack(move, cell) : this.clickWhite(move, cell);
            const result = this.validateMove(newmove) as IClickResult;
            result.move = result.valid ? newmove : move;
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", { move, row, col, piece, emessage: (e as Error).message }),
            };
        }
    }

    /** Auction placements, stone selections and slides all start from a click on a cell. */
    private clickWhite(move: string, cell: string): string {
        if (!CELL_RE.test(move) || this.board.get(move) !== "W") {
            return cell;
        }
        if (cell === move) { return ""; }
        if (this.board.get(cell) === "W") { return cell; }
        return `${move}-${cell}`;
    }

    private clickBlack(move: string, cell: string): string {
        const list = move === "" ? [] : move.split(",");
        if (list.length > 0 && list[list.length - 1] === cell) {
            return list.slice(0, -1).join(",");
        }
        const appended = [...list, cell];
        if (this.simulateBlack(appended).error === undefined) {
            return appended.join(",");
        }
        // The clicked stone may only be legal if a placement that merged groups comes after it.
        const sim = this.simulateBlack(list);
        if (sim.error === undefined) {
            for (const idx of [...sim.mergers].reverse()) {
                const alt = [...list.slice(0, idx), ...list.slice(idx + 1), cell, list[idx]];
                if (this.simulateBlack(alt).error === undefined) {
                    return alt.join(",");
                }
            }
        }
        return appended.join(",");
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = { valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER") };
        m = m.toLowerCase().replace(/\s+/g, "");
        switch (this.phase) {
            case "auction":
                return this.validateWhitePhase(m, true);
            case "white":
                return this.validateWhitePhase(m, false);
            case "black":
                return this.validateBlack(m);
            default:
                return result;
        }
    }

    private validateWhitePhase(m: string, auction: boolean): IValidationResult {
        const invalid = (key: string, params: Record<string, string> = {}): IValidationResult =>
            ({ valid: false, message: i18next.t(key, params) });
        if (m === "") {
            const noMoves = !auction && this.whiteMoves().length === 0;
            return {
                valid: true,
                complete: -1,
                message: i18next.t(auction ? "apgames:validation.outbound.INSTRUCTIONS_AUCTION" : noMoves ? "apgames:validation.outbound.INSTRUCTIONS_WHITE_PASS" : "apgames:validation.outbound.INSTRUCTIONS_WHITE"),
            };
        }
        if (m === "pass") {
            if (auction || this.whiteMoves().length > 0) {
                return invalid("apgames:validation._general.INVALID_PASS");
            }
            return { valid: true, complete: 1, message: i18next.t("apgames:validation._general.VALID_MOVE") };
        }
        if (CELL_RE.test(m)) {
            if (!this.isValidCell(m)) {
                return invalid("apgames:validation._general.INVALID_MOVE", { move: m });
            }
            const contents = this.board.get(m);
            if (contents === "W") {
                if (this.slides(m).length === 0) {
                    return invalid("apgames:validation._general.NO_MOVES", { where: m });
                }
                return { valid: true, complete: -1, canrender: true, message: i18next.t("apgames:validation.outbound.INSTRUCTIONS_WHITE_TO") };
            }
            if (!auction) {
                return invalid("apgames:validation.outbound.NOT_WHITE", { where: m });
            }
            if (contents !== undefined) {
                return invalid("apgames:validation.outbound.OCCUPIED", { where: m });
            }
            if (!this.isEdge(m)) {
                return invalid("apgames:validation.outbound.NOT_PERIMETER", { where: m });
            }
            return { valid: true, complete: 1, message: i18next.t("apgames:validation._general.VALID_MOVE") };
        }
        const match = MOVE_RE.exec(m);
        if (match === null) {
            return invalid("apgames:validation._general.INVALID_MOVE", { move: m });
        }
        const [, from, to] = match;
        if (!this.isValidCell(from)) { return invalid("apgames:validation._general.INVALID_MOVE", { move: from }); }
        if (!this.isValidCell(to)) { return invalid("apgames:validation._general.INVALID_MOVE", { move: to }); }
        if (this.board.get(from) !== "W") {
            return invalid("apgames:validation.outbound.NOT_WHITE", { where: from });
        }
        if (this.board.has(to)) {
            return invalid("apgames:validation.outbound.OCCUPIED", { where: to });
        }
        if (!this.slides(from).includes(to)) {
            const [fx, fy] = this.toXY(from);
            const [tx, ty] = this.toXY(to);
            const dx = Math.abs(tx - fx);
            const dy = Math.abs(ty - fy);
            if (dx !== 0 && dy !== 0 && dx !== dy) {
                return invalid("apgames:validation.outbound.BAD_LINE");
            }
            return invalid("apgames:validation.outbound.BLOCKED", { from, to });
        }
        return { valid: true, complete: 1, message: i18next.t("apgames:validation._general.VALID_MOVE") };
    }

    private validateBlack(m: string): IValidationResult {
        if (m === "") {
            return { valid: true, complete: -1, message: i18next.t("apgames:validation.outbound.INSTRUCTIONS_BLACK") };
        }
        const sim = this.simulateBlack(m.split(","));
        if (sim.error !== undefined) {
            return { valid: false, message: i18next.t(sim.error.key, sim.error.params) };
        }
        if (sim.remaining > 0) {
            return {
                valid: true,
                complete: -1,
                canrender: true,
                message: i18next.t("apgames:validation.outbound.BLACK_MORE", { count: sim.remaining }),
            };
        }
        return { valid: true, complete: 1, canrender: true, message: i18next.t("apgames:validation._general.VALID_MOVE") };
    }

    public move(m: string, { partial = false, trusted = false } = {}): OutboundGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:validation._general.MOVES_GAMEOVER"));
        }
        m = m.toLowerCase().replace(/\s+/g, "");
        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
            if (!partial && result.complete === -1) {
                throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation._general.INCOMPLETE_MOVE"));
            }
            if (!partial && this.phase !== "black" && !this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", { move: m }));
            }
        }
        this.results = [];
        this.selected = undefined;
        if (m.length === 0) { return this; }

        const phase = this.phase;
        if (phase === "black") {
            const cells = m.split(",");
            const sim = this.simulateBlack(cells);
            for (const cell of cells) {
                this.results.push({ type: "place", where: cell });
            }
            this.board = sim.board;
            this.crown = sim.crown;
        } else if (m === "pass") {
            this.results.push({ type: "pass" });
        } else if (CELL_RE.test(m)) {
            if (this.board.get(m) === "W") {
                // Partial move: a stone has been picked up.
                this.selected = m;
                return this;
            }
            this.board.set(m, "W");
            this.results.push({ type: "place", where: m });
        } else {
            const [from, to] = m.split("-");
            if (phase === "auction") {
                this.whiteSeat = this.currplayer;
                this.results.push({ type: "claim", how: "white" });
            }
            this.slideWhite(from, to);
        }

        if (partial) { return this; }

        this.lastmove = m;
        this.currplayer = this.otherSeat(this.currplayer);
        this.checkEOG();
        this.saveState();
        return this;
    }

    private slideWhite(from: string, to: string): void {
        this.board.delete(from);
        this.board.set(to, "W");
        this.results.push({ type: "move", from, to });
        const [x, y] = this.toXY(to);
        const flipped: string[] = [];
        for (const [dx, dy] of DIRS) {
            if (!this.inBounds(x + 2 * dx, y + 2 * dy)) { continue; }
            const between = this.toCell(x + dx, y + dy);
            const far = this.toCell(x + 2 * dx, y + 2 * dy);
            if (this.board.get(between) === "B" && between !== this.crown && this.board.get(far) === "W") {
                flipped.push(between);
            }
        }
        for (const cell of flipped) {
            this.board.set(cell, "W");
        }
        if (flipped.length > 0) {
            this.results.push({ type: "capture", where: flipped.join(","), count: flipped.length, how: "flip" });
        }
    }

    protected checkEOG(): OutboundGame {
        if (this.whiteSeat === undefined) { return this; }
        const king = this.group(this.board, this.crown);
        let reason: string | undefined;
        if (king.some((c) => this.isEdge(c))) {
            reason = "edge";
            this.winner = [this.otherSeat(this.whiteSeat)];
        } else if (!this.hasLiberty(this.board, king)) {
            reason = "trapped";
            this.winner = [this.whiteSeat];
        }
        if (reason !== undefined) {
            this.gameover = true;
            this.results.push(
                { type: "eog", reason },
                { type: "winners", players: [...this.winner] },
            );
        }
        return this;
    }

    public state(): IOutboundState {
        return {
            game: OutboundGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    public moveState(): IMoveState {
        const state: IMoveState = {
            _version: OutboundGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            crown: this.crown,
        };
        if (this.whiteSeat !== undefined) { state.whiteSeat = this.whiteSeat; }
        return state;
    }

    public getPlayerColour(p: playerid): number | string {
        if (this.whiteSeat === undefined) {
            return UNDECIDED_COLOUR;
        }
        return p === this.whiteSeat ? 1 : 2;
    }

    public render(opts?: IRenderOpts): APRenderRep {
        void opts;
        const legend: NonNullable<APRenderRep["legend"]> = {
            W: [{ name: "piece", paint: stonePaint(1) }],
            B: [{ name: "piece", paint: stonePaint(2) }],
            K: [
                { name: "piece", paint: stonePaint(2) },
                { name: "chess-king-solid-millenia", colour: { func: "bestContrast", bg: 2, fg: ["#000", "#fff"] }, scale: 0.6 },
            ],
        };
        let pstr = "";
        for (let y = 0; y < this.boardSize; y++) {
            if (pstr.length > 0) { pstr += "\n"; }
            for (let x = 0; x < this.boardSize; x++) {
                const cell = this.toCell(x, y);
                const stone = this.board.get(cell);
                pstr += stone === undefined ? "-" : cell === this.crown ? "K" : stone;
            }
        }
        pstr = pstr.replace(new RegExp(`-{${this.boardSize}}`, "g"), "_");

        const rep: APRenderRep = {
            board: {
                style: "vertex",
                width: this.boardSize,
                height: this.boardSize,
            },
            legend,
            pieces: pstr,
        };

        const toRowCol = (cell: string): RowCol => {
            const [x, y] = this.toXY(cell);
            return { row: y, col: x };
        };
        const annotations: NonNullable<APRenderRep["annotations"]> = [];
        for (const r of this.results) {
            if (r.type === "place") {
                annotations.push({ type: "enter", targets: [toRowCol(r.where!)] });
            } else if (r.type === "move") {
                annotations.push({ type: "move", targets: [toRowCol(r.from), toRowCol(r.to)] });
            } else if (r.type === "capture" && r.how === "flip") {
                annotations.push({ type: "enter", targets: r.where!.split(",").map(toRowCol) as [RowCol, ...RowCol[]] });
            }
        }
        if (this.selected !== undefined) {
            annotations.push({ type: "enter", targets: [toRowCol(this.selected)] });
            const targets = this.slides(this.selected).map(toRowCol);
            if (targets.length > 0) {
                annotations.push({ type: "dots", targets: targets as [RowCol, ...RowCol[]] });
            }
        }
        if (annotations.length > 0) {
            rep.annotations = annotations;
        }
        return rep;
    }

    public sidebarStatuses(): IStatus[] {
        const undecided = this.neutralAreaLabel("apgames:status.outbound.UNDECIDED");
        const statuses: IStatus[] = [
            {
                key: this.neutralAreaLabel("apgames:status.outbound.WHITE"),
                value: [this.whiteSeat === undefined ? undecided : this.seatStatusValue(this.whiteSeat)],
            },
            {
                key: this.neutralAreaLabel("apgames:status.outbound.BLACK"),
                value: [this.whiteSeat === undefined ? undecided : this.seatStatusValue(this.otherSeat(this.whiteSeat))],
            },
        ];
        if (this.phase === "auction" && !this.gameover) {
            statuses.push({
                key: this.neutralAreaLabel("apgames:status.PHASE"),
                value: [this.seatAreaLabel(this.currplayer, "apgames:status.outbound.PHASE_AUCTION")],
            });
        }
        return statuses;
    }

    public collectChatLogLine(lines: ChatLogLine[], r: APMoveResult, ctx: ChatLogCollectContext): boolean {
        switch (r.type) {
            case "claim":
                if (r.how === "white") {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:outbound.CLAIM.white");
                    return true;
                }
                return super.collectChatLogLine(lines, r, ctx);
            case "capture":
                if (r.how === "flip") {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:outbound.CAPTURE.flip", { count: r.count!, where: r.where! });
                    return true;
                }
                return super.collectChatLogLine(lines, r, ctx);
            default:
                return super.collectChatLogLine(lines, r, ctx);
        }
    }

    public clone(): OutboundGame {
        return new OutboundGame(this.serialize());
    }
}
