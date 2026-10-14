import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult, type ChatLogCollectContext, type ChatLogLine } from "./_base.js";
import type { APGamesInformation } from "../schemas/gameinfo.js";
import { APRenderRep } from "@abstractplay/renderer/build/schemas/schema";
import type { APMoveResult } from "../schemas/moveresults.js";
import { HexTriGraph, reviver, UserFacingError, cloneState } from "../common/index.js";
import i18next from "i18next";

export const gameApgamesEn = {
    validation: {
        ENCLOSURE: "In this game you may not enclose an opposing piece, unless the move wins the game.",
        INITIAL_INSTRUCTIONS: "Click one of your pieces to select it.",
        INITIAL_INSTRUCTIONS_PIE: "Click one of your pieces to select it, or use the pie rule to swap sides.",
        NOT_ADJACENT: "A piece can only move to an adjacent empty cell.",
        NO_PASS: "You cannot pass in this game. Swapping sides (the pie rule) is only available to the second player, right after the first move.",
        PARTIAL: "Click an adjacent empty cell to move the selected piece there.",
        PIE: "Use the pie rule and swap sides.",
        PIE_UNAVAILABLE: "The pie rule can only be used by the second player right after the first move.",
    },
    variants: {
        "#board": {
            name: "Radius-3 board, 9 pieces each",
        },
        r2f5: {
            name: "Radius-2 board, 5 pieces each",
        },
        r4f12: {
            name: "Radius-4 board, 12 pieces each",
        },
        r5f20: {
            name: "Radius-5 board, 20 pieces each",
        },
        "no-enclosure": {
            name: "No enclosure",
            description: "A move that would enclose an opposing piece is not allowed, unless it wins the game outright.",
        },
    },
};
export const gameApresultsEn = {
    EOG: {
        mutual_enclosure: "The game has ended in a draw because both players have enclosed pieces and neither can ever connect.",
    },
};


export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface ISelfoState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

type Board = Map<string, playerid>;

/** Board radius (cells from the centre to an edge) and pieces per player for each size variant. */
const SIZES = new Map<string, {radius: number; pieces: number}>([
    ["r2f5", {radius: 2, pieces: 5}],
    ["#board", {radius: 3, pieces: 9}],
    ["r4f12", {radius: 4, pieces: 12}],
    ["r5f20", {radius: 5, pieces: 20}],
]);

const other = (p: playerid): playerid => (p === 1 ? 2 : 1);

/** Cells holding a piece of `player`. */
const piecesOf = (board: Board, player: playerid): string[] =>
    [...board.entries()].filter(([, p]) => p === player).map(([c]) => c);

/** True if all of `player`'s pieces form one group of mutually adjacent pieces. */
const isConnected = (graph: HexTriGraph, board: Board, player: playerid): boolean => {
    const own = piecesOf(board, player);
    if (own.length === 0) { return false; }
    const seen = new Set<string>([own[0]]);
    const stack = [own[0]];
    while (stack.length > 0) {
        const cell = stack.pop()!;
        for (const n of graph.neighbours(cell)) {
            if (!seen.has(n) && board.get(n) === player) {
                seen.add(n);
                stack.push(n);
            }
        }
    }
    return seen.size === own.length;
};

/**
 * A player has an enclosed piece when their pieces cannot all reach each other
 * through cells not occupied by the opponent: some piece is boxed in directly
 * or sealed in a pocket of empty cells and/or its own pieces, walled off by
 * enemy pieces and the board edge.
 */
const hasEnclosedPiece = (graph: HexTriGraph, board: Board, player: playerid): boolean => {
    const own = piecesOf(board, player);
    if (own.length < 2) { return false; }
    const foe = other(player);
    const seen = new Set<string>([own[0]]);
    const stack = [own[0]];
    while (stack.length > 0) {
        const cell = stack.pop()!;
        for (const n of graph.neighbours(cell)) {
            if (!seen.has(n) && board.get(n) !== foe) {
                seen.add(n);
                stack.push(n);
            }
        }
    }
    return own.some(c => !seen.has(c));
};

/** The board after `player` moves a piece from `from` to `to` (the input is not modified). */
const after = (board: Board, from: string, to: string): Board => {
    const next = new Map(board);
    const player = next.get(from)!;
    next.delete(from);
    next.set(to, player);
    return next;
};

/** Whether `player` could connect all their pieces with a single move (if it were their turn). */
const canWinInOne = (graph: HexTriGraph, board: Board, player: playerid): boolean =>
    piecesOf(board, player).some(from =>
        graph.neighbours(from).some(to => !board.has(to) && isConnected(graph, after(board, from, to), player))
    );

/** Whether the move would enclose an opposing piece without winning the game outright. */
const wouldEnclose = (graph: HexTriGraph, board: Board, from: string, to: string): boolean => {
    const player = board.get(from)!;
    const next = after(board, from, to);
    if (isConnected(graph, next, player)) { return false; }
    return hasEnclosedPiece(graph, next, other(player));
};

/** All legal moves of `player` as `from-to` strings, sorted. */
const legalMoves = (graph: HexTriGraph, board: Board, player: playerid, noEnclosure: boolean): string[] => {
    const moves: string[] = [];
    for (const from of piecesOf(board, player)) {
        for (const to of graph.neighbours(from)) {
            if (board.has(to)) { continue; }
            if (noEnclosure && wouldEnclose(graph, board, from, to)) { continue; }
            moves.push(`${from}-${to}`);
        }
    }
    return moves.sort((a, b) => a.localeCompare(b));
};

/** Size of the group the cell `cell` would belong to if it were added to `chosen`. */
const groupSizeIfAdded = (graph: HexTriGraph, cell: string, chosen: Set<string>): number => {
    const seen = new Set<string>([cell]);
    const stack = [cell];
    while (stack.length > 0) {
        const c = stack.pop()!;
        for (const n of graph.neighbours(c)) {
            if (chosen.has(n) && !seen.has(n)) {
                seen.add(n);
                stack.push(n);
            }
        }
    }
    return seen.size;
};

const shuffled = <T>(items: T[]): T[] => {
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
};

/**
 * Picks `count` cells for one colour so that no connected group of chosen
 * cells exceeds `maxGroup`. The biased pass makes joining a group less likely
 * the bigger it is (a varied mix of singles, pairs and the odd larger cluster);
 * a second unbiased pass fills up whatever is missing.
 */
const placeColour = (graph: HexTriGraph, available: string[], count: number, maxGroup: number): string[] => {
    let best: string[] = [];
    for (let attempt = 0; attempt < 25 && best.length < count; attempt++) {
        const order = shuffled(available);
        const chosen: string[] = [];
        const set = new Set<string>();
        for (const cell of order) {
            if (chosen.length >= count) { break; }
            const size = groupSizeIfAdded(graph, cell, set);
            if (size > maxGroup) { continue; }
            if (Math.random() < (size <= 1 ? 1 : 1 / size)) {
                chosen.push(cell);
                set.add(cell);
            }
        }
        if (chosen.length < count) {
            for (const cell of order) {
                if (chosen.length >= count) { break; }
                if (set.has(cell)) { continue; }
                if (groupSizeIfAdded(graph, cell, set) <= maxGroup) {
                    chosen.push(cell);
                    set.add(cell);
                }
            }
        }
        if (chosen.length > best.length) { best = chosen; }
    }
    return best;
};

export class SelfoGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Selfo",
        uid: "selfo",
        playercounts: [2],
        version: "20261011",
        dateAdded: "2026-10-11",
        description:
            "A connection game on a hexagonal board. Each player starts with the same number of pieces scattered at random, and on your turn you slide one piece to an adjacent empty cell. The first player to bring all of their own pieces together into a single group wins.",
        notes:
            "The starting position is random: both players' pieces are scattered over the board, with no piece already enclosed, no player already connected, and no immediate win for the first player.\n\nOn your turn, move one of your pieces to an adjacent empty cell. You win by moving so that all of your pieces form one group of mutually adjacent pieces; only the player who has just moved can win this way. A player who has no legal move loses.\n\nA piece is _enclosed_ when your pieces cannot all reach each other through cells not occupied by your opponent, because opposing pieces and the board edge wall some of them off. If, after a move, both players have enclosed pieces, neither can ever connect and the game is a draw. With the **No enclosure** variant, a move that would enclose an opposing piece is not allowed, unless that move wins the game outright.\n\nThe second player may use the pie rule to swap sides after the first move.",
        urls: ["https://en.wikipedia.org/wiki/Selfo"],
        people: [
            {
                type: "designer",
                name: "fjvico",
                urls: [],
            },
        ],
        categories: ["goal>connect", "mechanic>move", "mechanic>random>setup", "board>shape>hex", "board>connect>hex", "components>simple>1per"],
        flags: ["experimental", "random-start"],
        variants: [
            { uid: "r2f5", group: "board" },
            { uid: "#board" },
            { uid: "r4f12", group: "board" },
            { uid: "r5f20", group: "board" },
            { uid: "no-enclosure" },
        ],
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Board;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private radius = 3;
    private pieces = 9;
    private noEnclosure = false;
    private graph!: HexTriGraph;

    constructor(state?: ISelfoState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined && variants.length > 0) {
                this.variants = this.applyVariantConstraints(variants);
            }
            this.configure();
            const fresh: IMoveState = {
                _version: SelfoGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: this.randomStart(),
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ISelfoState;
            }
            if (state.game !== SelfoGame.gameinfo.uid) {
                throw new Error(`The Selfo engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
            this.configure();
        }
        this.load();
    }

    /** Reads board size and rule options from the variants. */
    private configure(): void {
        const size = this.variants.find(v => SIZES.has(v)) ?? "#board";
        const {radius, pieces} = SIZES.get(size)!;
        this.radius = radius;
        this.pieces = pieces;
        this.noEnclosure = this.variants.includes("no-enclosure");
        this.graph = new HexTriGraph(radius + 1, radius * 2 + 1);
    }

    /**
     * Random starting position: both colours scattered with no group larger
     * than the board radius (and never one big enough to be connected), no
     * piece already enclosed, and no colour one move away from winning (and,
     * with `no-enclosure`, at least one legal move for both).
     */
    private randomStart(): Board {
        const cells = this.graph.listCells() as string[];
        const maxGroup = Math.min(this.radius, this.pieces - 1);
        let fallback: Board | undefined;
        for (let attempt = 0; attempt < 1000; attempt++) {
            const first = placeColour(this.graph, cells, this.pieces, maxGroup);
            const taken = new Set(first);
            const second = placeColour(this.graph, cells.filter(c => !taken.has(c)), this.pieces, maxGroup);
            if (first.length < this.pieces || second.length < this.pieces) { continue; }
            const board: Board = new Map();
            for (const c of first) { board.set(c, 1); }
            for (const c of second) { board.set(c, 2); }
            if (hasEnclosedPiece(this.graph, board, 1) || hasEnclosedPiece(this.graph, board, 2)) { continue; }
            // neither colour may be one move away from winning (the second player
            // could otherwise win at once, or take that colour with the pie rule)
            if (canWinInOne(this.graph, board, 1) || canWinInOne(this.graph, board, 2)) { continue; }
            fallback = board;
            if (!this.noEnclosure) { return board; }
            if (legalMoves(this.graph, board, 1, true).length > 0 && legalMoves(this.graph, board, 2, true).length > 0) {
                return board;
            }
        }
        if (fallback === undefined) {
            throw new Error("Could not generate a valid starting position for Selfo.");
        }
        return fallback;
    }

    public load(idx = -1): SelfoGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = cloneState(state.board) as Board;
        this.lastmove = state.lastmove;
        return this;
    }

    /**
     * Pie rule: the second player may choose to take the first player's side,
     * but only right after the first move.
     */
    public isPieTurn(): boolean {
        return !this.gameover && this.stack.length === 2 && this.currplayer === 2;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves = legalMoves(this.graph, this.board, player, this.noEnclosure);
        if (player === 2 && this.isPieTurn()) {
            moves.push("pie");
        }
        return moves;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            if (piece === "_btn_pass") {
                // the pie button: on the pie turn this plays the pie rule
                const pie = this.validateMove("pass") as IClickResult;
                pie.move = pie.valid ? "pie" : "";
                return pie;
            }
            const cell = this.graph.coords2algebraic(col, row);
            let newmove: string;
            const [from, to] = move.split("-");
            if (move === "" || from === undefined || from === "") {
                newmove = cell;
            } else if (to !== undefined && to !== "") {
                // a complete move is already entered: start over from the clicked cell
                newmove = cell;
            } else if (cell === from) {
                // clicking the selected piece again deselects it
                newmove = "";
            } else if (this.board.get(cell) === this.currplayer) {
                // clicking another of your own pieces switches the selection
                newmove = cell;
            } else {
                newmove = `${from}-${cell}`;
            }

            const result = this.validateMove(newmove) as IClickResult;
            if (! result.valid) {
                result.move = "";
            } else {
                result.move = newmove;
            }
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", {move, row, col, piece, emessage: (e as Error).message})
            }
        }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t(this.isPieTurn()
                ? "apgames:validation.selfo.INITIAL_INSTRUCTIONS_PIE"
                : "apgames:validation.selfo.INITIAL_INSTRUCTIONS");
            return result;
        }

        if (m === "pass" && this.isPieTurn()) { m = "pie"; }
        if (m === "pass") {
            // the playground has a generic Pass button; there is no passing in Selfo
            result.valid = false;
            result.message = i18next.t("apgames:validation.selfo.NO_PASS");
            return result;
        }
        if (m === "pie") {
            if (!this.isPieTurn()) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.selfo.PIE_UNAVAILABLE");
                return result;
            }
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation.selfo.PIE");
            return result;
        }

        const [from, to] = m.split("-");

        // from must be a cell
        if (!this.graph.graph.hasNode(from)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: from});
            return result;
        }
        // it must hold one of your pieces
        if (!this.board.has(from)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: from});
            return result;
        }
        if (this.board.get(from) !== this.currplayer) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
            return result;
        }
        // and that piece must be able to move
        const mine = this.moves().filter(mv => mv.startsWith(`${from}-`));
        if (mine.length === 0) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NO_MOVES", {where: from});
            return result;
        }

        if (to === undefined || to === "") {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.selfo.PARTIAL");
            return result;
        }

        if (!this.graph.graph.hasNode(to)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: to});
            return result;
        }
        if (to === from) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.SAME_FROM_TO");
            return result;
        }
        if (this.board.has(to)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: to});
            return result;
        }
        if (!this.graph.neighbours(from).includes(to)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.selfo.NOT_ADJACENT");
            return result;
        }
        if (!mine.includes(`${from}-${to}`)) {
            // adjacent and empty, so the only way to be missing is the enclosure rule
            result.valid = false;
            result.message = i18next.t("apgames:validation.selfo.ENCLOSURE");
            return result;
        }

        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {trusted = false} = {}): SelfoGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:validation._general.MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (m === "pass" && this.isPieTurn()) { m = "pie"; }
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (! this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];
        if (m === "pie") {
            // The second player takes the first player's side: every piece changes
            // colour, so they now own the position the first player just moved into
            // and the first player moves again from the old second-player position.
            const swapped: Board = new Map();
            for (const [cell, owner] of this.board) {
                swapped.set(cell, other(owner));
            }
            this.board = swapped;
            this.results.push({type: "pie"});
        } else {
            const [from, to] = m.split("-");
            this.board.delete(from);
            this.board.set(to, this.currplayer);
            this.results.push({type: "move", from, to});
        }

        // update currplayer
        this.lastmove = m;
        this.currplayer = other(this.currplayer);

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): SelfoGame {
        const prev = other(this.currplayer);

        if (isConnected(this.graph, this.board, prev)) {
            // only the player who just moved can have connected their pieces
            this.gameover = true;
            this.winner = [prev];
            this.results.push({type: "eog"});
        } else if (!this.noEnclosure && hasEnclosedPiece(this.graph, this.board, 1) && hasEnclosedPiece(this.graph, this.board, 2)) {
            // both sides are cut up for good: nobody can ever connect
            this.gameover = true;
            this.winner = [1, 2];
            this.results.push({type: "eog", reason: "mutual-enclosure"});
        } else if (this.moves().length === 0) {
            this.gameover = true;
            this.winner = [prev];
            this.results.push({type: "eog", reason: "stalemate"});
        }

        if (this.gameover) {
            this.results.push({type: "winners", players: [...this.winner]});
        }
        return this;
    }

    public state(): ISelfoState {
        return {
            game: SelfoGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: SelfoGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: cloneState(this.board) as Board,
        };
    }

    /** Starting position for the game record: first player's cells, `|`, second player's cells. */
    public getStartingPosition(): string {
        const board = this.stack[0].board;
        return `${piecesOf(board, 1).sort().join(",")}|${piecesOf(board, 2).sort().join(",")}`;
    }

    public render(): APRenderRep {
        // Build piece string
        const pstr: string[][] = [];
        for (const row of this.graph.listCells(true) as string[][]) {
            const pieces: string[] = [];
            for (const cell of row) {
                const owner = this.board.get(cell);
                if (owner === undefined) {
                    pieces.push("-");
                } else {
                    pieces.push(owner === 1 ? "A" : "B");
                }
            }
            pstr.push(pieces);
        }

        const rep: APRenderRep =  {
            board: {
                style: "hex-of-hex",
                minWidth: this.radius + 1,
                maxWidth: this.radius * 2 + 1,
            },
            legend: {
                A: {
                    name: "piece",
                    colour: 1
                },
                B: {
                    name: "piece",
                    colour: 2
                },
            },
            pieces: pstr.map(p => p.join("")).join("\n"),
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = this.graph.algebraic2coords(move.from);
                    const [toX, toY] = this.graph.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                }
            }
            if (rep.annotations.length === 0) {
                delete rep.annotations;
            }
        }

        return rep;
    }

    public collectChatLogLine(lines: ChatLogLine[], r: APMoveResult, ctx: ChatLogCollectContext): boolean {
        if (r.type === "eog" && r.reason === "mutual-enclosure") {
            this.pushNeutralChatLine(lines, "apresults:selfo.EOG.mutual_enclosure");
            return true;
        }
        if (r.type === "eog" && r.reason === "stalemate") {
            this.pushNeutralChatLine(lines, "apresults:_general.EOG.stalemate");
            return true;
        }
        return super.collectChatLogLine(lines, r, ctx);
    }

    public clone(): SelfoGame {
        return new SelfoGame(this.serialize());
    }
}