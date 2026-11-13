import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult, type ChatLogCollectContext, type ChatLogLine } from "./_base.js";
import { APGamesInformation } from "../schemas/gameinfo.js";
import { APRenderRep, AnnotationBasic, BoardBasic, Colourfuncs, Glyph, MarkerFenceData, RowCol } from "@abstractplay/renderer/build/schemas/schema";
import { APMoveResult } from "../schemas/moveresults.js";
import { reviver, UserFacingError } from "../common/index.js";
import i18next from "i18next";

export const gameApgamesEn = {
    validation: {
        INITIAL_INSTRUCTIONS: "Select one of your checkers. A green dot marks every checker that has a legal move. The squares the selected checker may move to are then marked in green.",
        PARTIAL: "Select the square to move the checker to, or select another of your checkers instead.",
        DIRECTION: "The checker on {{from}} cannot move to {{to}}. A checker moves like a non-capturing Chess queen, directly forward, diagonally forward, or sideways.",
        BLOCKED: "The checker on {{from}} cannot reach {{to}}. A checker moves over consecutive unoccupied squares only.",
        WALL: "The checker on {{from}} may not move to {{to}}, because the move would complete a wall. You must not complete a wall except when your move wins the game, the wall is in your far row, or there is another wall of your colour in the next row ahead of the wall.",
        SIDEWAYS: "The checker on {{from}} may not move sideways to {{to}}. A sideways move is legal only if the shortest distance after the move is shorter than the shortest distance before the move, or the move wins the game.",
        SIDEWAYS_ZERO: "The checker on {{from}} may not move sideways to {{to}}. The shortest distance is 0, so no sideways move is legal, except for a winning sideways move.",
        NO_PASS: "You may not pass while you have an available move.",
        MUST_PASS: "You have no available move. Your turn is skipped.",
    },
    variants: {
        "#board": {
            name: "7x7 board",
        },
        "size-5": {
            name: "5x5 board",
        },
        "size-9": {
            name: "9x9 board",
        },
        "size-11": {
            name: "11x11 board",
        },
    },
};

export const gameApresultsEn = {
    PASS: {
        skipped: "{{player}} had no available move, so the turn was skipped.",
    },
    EOG: {
        groups: "All of {{player}}'s groups have at least one checker in the far row.",
    },
};

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
}

export interface ICounterflowState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
}

/*
 * Rule helpers.
 *
 * The helpers work on a board of `width` columns and `height` rows with the
 * squares indexed row by row from the top left, index = row * width + col.
 * Red (player 1) starts in the bottom rows and moves up the board, so Red's
 * far row is the top row.  Blue (player 2) starts in the top rows and moves
 * down, so Blue's far row is the bottom row.  The game itself is played on
 * odd-sided square boards; the helpers take any width so that the rules can
 * be checked exhaustively on small boards.
 *
 * A checker moves like a non-capturing chess queen, directly forward,
 * diagonally forward, or sideways, over any number of consecutive unoccupied
 * squares.  Two rules restrict the moves:
 *
 * Walls.  A wall is a row filled with same-coloured checkers.  A move must
 * not complete a wall except when 1) the move wins the game, 2) the wall is
 * in the mover's far row, or 3) there is another wall of the mover's colour
 * in the next row ahead of the wall.
 *
 * Sideways moves.  An opening of a checker is an unoccupied square in the
 * next row ahead of it, except a square on which a checker of that colour
 * would complete a wall that meets neither exception 2 nor exception 3.  The
 * distance of a checker is the number of columns from its column to the
 * column of its nearest opening.  A sideways move is legal only if the
 * shortest distance of all checkers of both colours is shorter after the
 * move than before it, or the move wins the game.
 *
 * A player wins when all of that player's groups (orthogonally connected
 * same-coloured checkers) have at least one checker in the player's far row.
 * Under these rules at least one player always has a legal move and no
 * position can repeat.
 */

/** A board with one entry per square, undefined for an unoccupied square. */
export type CfBoard = (playerid | undefined)[];

export interface ICfMove {
    from: number;
    to: number;
    /** A move along the row; all other moves are forward moves. */
    sideways: boolean;
    /** The move wins the game for the mover. */
    wins: boolean;
}

/** The far row of a player: the top row for Red, the bottom row for Blue. */
export function cfFarRow(player: playerid, height: number): number {
    return player === 1 ? 0 : height - 1;
}

/** The change in row index of one step forward. */
function cfForward(player: playerid): number {
    return player === 1 ? -1 : 1;
}

/**
 * The starting position.  The middle row is empty (the two middle rows when
 * the height is even), blue checkers fill the rows above it and red checkers
 * the rows below it.
 */
export function cfStart(width: number, height: number): CfBoard {
    const filled = Math.floor((height - 1) / 2);
    const board: CfBoard = new Array<playerid | undefined>(width * height).fill(undefined);
    for (let row = 0; row < filled; row++) {
        for (let col = 0; col < width; col++) {
            board[row * width + col] = 2;
            board[(height - 1 - row) * width + col] = 1;
        }
    }
    return board;
}

function cfNeighbours(sq: number, width: number, height: number): number[] {
    const row = Math.floor(sq / width);
    const col = sq % width;
    const out: number[] = [];
    if (row > 0) { out.push(sq - width); }
    if (row < height - 1) { out.push(sq + width); }
    if (col > 0) { out.push(sq - 1); }
    if (col < width - 1) { out.push(sq + 1); }
    return out;
}

/** The groups of a player: the sets of that player's checkers that are orthogonally interconnected. */
export function cfGroups(board: CfBoard, player: playerid, width: number, height: number): number[][] {
    const seen = new Array<boolean>(board.length).fill(false);
    const groups: number[][] = [];
    for (let start = 0; start < board.length; start++) {
        if (board[start] !== player || seen[start]) {
            continue;
        }
        const group = [start];
        seen[start] = true;
        for (let i = 0; i < group.length; i++) {
            for (const n of cfNeighbours(group[i], width, height)) {
                if (board[n] === player && !seen[n]) {
                    seen[n] = true;
                    group.push(n);
                }
            }
        }
        groups.push(group);
    }
    return groups;
}

/** True when all of the player's groups have at least one checker in the player's far row. */
export function cfHasWon(board: CfBoard, player: playerid, width: number, height: number): boolean {
    // every checker must be reachable from a checker of its colour in the far row
    const far = cfFarRow(player, height);
    const seen = new Array<boolean>(board.length).fill(false);
    const todo: number[] = [];
    for (let col = 0; col < width; col++) {
        const sq = far * width + col;
        if (board[sq] === player) {
            seen[sq] = true;
            todo.push(sq);
        }
    }
    let reached = todo.length;
    while (todo.length > 0) {
        for (const n of cfNeighbours(todo.pop()!, width, height)) {
            if (board[n] === player && !seen[n]) {
                seen[n] = true;
                reached++;
                todo.push(n);
            }
        }
    }
    let total = 0;
    for (const who of board) {
        if (who === player) {
            total++;
        }
    }
    return reached === total;
}

/** For every row, the number of unoccupied squares [0], red checkers [1] and blue checkers [2]. */
function cfRowCounts(board: CfBoard, width: number, height: number): [number, number, number][] {
    const counts: [number, number, number][] = [];
    for (let row = 0; row < height; row++) {
        const c: [number, number, number] = [0, 0, 0];
        for (let col = 0; col < width; col++) {
            c[board[row * width + col] ?? 0]++;
        }
        counts.push(c);
    }
    return counts;
}

/** True when the row is a wall of the player: every square of it holds one of the player's checkers. */
export function cfIsWall(board: CfBoard, player: playerid, row: number, width: number): boolean {
    for (let col = 0; col < width; col++) {
        if (board[row * width + col] !== player) {
            return false;
        }
    }
    return true;
}

/**
 * True when the row is closed to the player: one more checker of the player
 * in the row would complete a wall, the row is not the player's far row, and
 * the next row ahead of it is not a wall of the player.  The player may not
 * move into a closed row unless the move wins the game, and the unoccupied
 * square of a closed row is not an opening of any of the player's checkers.
 */
function cfRowClosed(counts: [number, number, number][], player: playerid, row: number, width: number, height: number): boolean {
    if (counts[row][0] !== 1 || counts[row][player] !== width - 1) {
        return false;
    }
    if (row === cfFarRow(player, height)) {
        return false;
    }
    return counts[row + cfForward(player)][player] !== width;
}

/**
 * The distance of every checker: the number of columns from the checker's
 * column to the column of its nearest opening.  The entry is undefined for a
 * checker with no opening, and for an unoccupied square.
 */
export function cfDistances(board: CfBoard, width: number, height: number): (number | undefined)[] {
    const counts = cfRowCounts(board, width, height);
    const out = new Array<number | undefined>(board.length).fill(undefined);
    for (let sq = 0; sq < board.length; sq++) {
        const player = board[sq];
        if (player === undefined) {
            continue;
        }
        const col = sq % width;
        const ahead = Math.floor(sq / width) + cfForward(player);
        if (ahead < 0 || ahead >= height || cfRowClosed(counts, player, ahead, width, height)) {
            continue;
        }
        let best: number | undefined;
        for (let c = 0; c < width; c++) {
            if (board[ahead * width + c] === undefined) {
                const d = Math.abs(c - col);
                if (best === undefined || d < best) {
                    best = d;
                }
            }
        }
        out[sq] = best;
    }
    return out;
}

/** The shortest distance of all checkers of both colours, or undefined when no checker has an opening. */
export function cfShortestDistance(board: CfBoard, width: number, height: number): number | undefined {
    let best: number | undefined;
    for (const d of cfDistances(board, width, height)) {
        if (d !== undefined && (best === undefined || d < best)) {
            best = d;
        }
    }
    return best;
}

/** The legal moves of a player. */
export function cfMoves(board: CfBoard, player: playerid, width: number, height: number): ICfMove[] {
    const counts = cfRowCounts(board, width, height);
    const before = cfShortestDistance(board, width, height);
    const dir = cfForward(player);
    const trial = [...board];
    const moves: ICfMove[] = [];
    for (let from = 0; from < board.length; from++) {
        if (board[from] !== player) {
            continue;
        }
        const row = Math.floor(from / width);
        const col = from % width;
        // directly forward and diagonally forward
        for (const dc of [-1, 0, 1]) {
            let r = row + dir;
            let c = col + dc;
            while (r >= 0 && r < height && c >= 0 && c < width && board[r * width + c] === undefined) {
                const to = r * width + c;
                trial[from] = undefined;
                trial[to] = player;
                const wins = cfHasWon(trial, player, width, height);
                trial[to] = undefined;
                trial[from] = player;
                // the wall rule
                if (wins || !cfRowClosed(counts, player, r, width, height)) {
                    moves.push({from, to, sideways: false, wins});
                }
                r += dir;
                c += dc;
            }
        }
        // sideways
        for (const dc of [-1, 1]) {
            let c = col + dc;
            while (c >= 0 && c < width && board[row * width + c] === undefined) {
                const to = row * width + c;
                trial[from] = undefined;
                trial[to] = player;
                const wins = cfHasWon(trial, player, width, height);
                let legal = wins;
                if (!legal && before !== undefined && before > 0) {
                    // the sideways move restriction
                    const after = cfShortestDistance(trial, width, height);
                    legal = after !== undefined && after < before;
                }
                trial[to] = undefined;
                trial[from] = player;
                if (legal) {
                    moves.push({from, to, sideways: true, wins});
                }
                c += dc;
            }
        }
    }
    return moves;
}

const LEGAL_GREEN = "#28b446";
const LEGAL_OPACITY = 0.45;
const LEGAL_SCALE = 0.94;   // a little smaller than the square, so that the grid lines stay visible
const LEGAL_COLOUR: Colourfuncs = {func: "custom", default: LEGAL_GREEN, palette: 5};
const LAST_WHITE = "#ffffff";
const LAST_COLOUR: Colourfuncs = {func: "custom", default: LAST_WHITE, palette: 6};
const GOLD = "#f5c542";
const GOLD_COLOUR: Colourfuncs = {func: "custom", default: GOLD, palette: 7};
// the outline around the winner's groups: gold fences over slightly wider dark ones, in multiples of the grid's stroke
const OUTLINE_WIDTH = 2.8;
const OUTLINE_EDGE_WIDTH = 4;
const OUTLINE_EDGE = "#2e1c08";

// the board of the designer's own app: one tan felt, grid lines in a darker tan, an oak frame
const FELT = "#e8d6b2";
const GRID = "#b08e60";
const OAK = "#c48f4f";
const FELT_COLOUR: Colourfuncs = {func: "custom", default: FELT, palette: 3};
const GRID_COLOUR: Colourfuncs = {func: "custom", default: GRID, palette: 4};

// The rings drawn over a checker by a glyph annotation.  The ring glyph is
// 0.65 of a cell across at scale 1.  A nudge is measured in 1/500 of a cell
// and is applied before the layer's scale, and the face of the marbled
// checker sits 2% of a cell above the centre of the cell.
const FACE_DY = -10;
const LAST_SCALE = 0.62;
const SELECTED_SCALE = 0.7;

function ringGlyph(colour: Colourfuncs, scale: number, opacity: number): Glyph {
    return {
        name: "ring-02",
        paint: {fill: {colour: LAST_WHITE, opacity: 0}, border: colour},
        opacity,
        scale,
        nudge: {dx: 0, dy: FACE_DY / scale},
    };
}

export class CounterflowGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Counterflow",
        uid: "counterflow",
        playercounts: [2],
        version: "20261113",
        dateAdded: "2026-11-13",
        description: "A checker race game. Two armies of checkers flow through each other in opposite directions. Checkers move like non-capturing Chess queens, directly forward, diagonally forward, or sideways, with restrictions on completing walls and on sideways moves. You win if all of your groups have at least one checker in your far row. Cycles and deadlocks cannot occur.",
        notes: "Counterflow was designed by Mark Steere in November 2026, in collaboration with Claude, an AI model made by Anthropic.\n\nCounterflow is played on an odd-sided, square board. At the start the middle row is empty. Blue checkers fill the area above the middle row, and red checkers fill the area below it. Red and Blue take turns moving checkers of their own colour, one checker per turn, starting with Red. If you have an available move, you must make one. If not, your turn is skipped. At least one player will always have an available move. A skipped turn is entered automatically and is recorded as a pass.\n\nA group is an orthogonally interconnected group of one or more same-coloured checkers. You win if all of your groups have at least one checker in your far row.\n\nCheckers move like non-capturing Chess queens, directly forward, diagonally forward, or sideways, over any number of consecutive unoccupied squares. Sideways moves are subject to a restriction described below.\n\nA wall is a row filled with same-coloured checkers. You must not complete a wall except when: 1) your move wins the game, 2) the wall is in your far row, or 3) there is another wall of your colour in the next row ahead of the wall.\n\nAn opening of a checker is an unoccupied square in the next row ahead of it, with one exception. A square is not an opening of a checker if all three of the following are true: 1) a checker of that colour on the square would complete a wall, 2) the wall would not be in that colour's far row, and 3) there would not be a wall of the wall's colour in the next row ahead of the wall. An opening doesn't have to be in front of a square that the checker can move to.\n\nThe distance of a checker is the number of columns from the checker's column to the column of its nearest opening. An opening straight ahead of the checker is at a distance of 0. A checker with no opening has no distance.\n\nThe shortest distance is the shortest distance of all checkers of both colours on the board. A sideways move is legal only if 1) the shortest distance after the move is shorter than the shortest distance before the move, or 2) the move wins the game. If the shortest distance is 0, no sideways move is legal, except for a winning sideways move.\n\nA green dot marks every checker that has a legal move. Select a checker and the squares it may move to are marked in green. The checker moved last carries a white ring, and a white dot marks the square it came from. When the game is over, a gold outline surrounds every group of the winner's checkers.",
        urls: [
            "https://www.marksteeregames.com/Counterflow_rules.pdf",
            "https://www.marksteeregames.com",
        ],
        people: [
            {
                type: "designer",
                name: "Mark Steere",
                urls: ["https://www.marksteeregames.com"],
                apid: "e7a3ebf6-5b05-4548-ae95-299f75527b3f",
            },
            {
                type: "coder",
                name: "Claude Fable 5.2 (Anthropic)",
            },
        ],
        variants: [
            { uid: "size-5", group: "board" },
            { uid: "#board" },
            { uid: "size-9", group: "board" },
            { uid: "size-11", group: "board" },
        ],
        categories: ["goal>breakthrough", "mechanic>move", "mechanic>block", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["experimental", "autopass"],
        customizations: [
            {
                num: 1,
                default: 1,
                explanation: "Colour of Red's checkers (player 1)",
                player: 1,
            },
            {
                num: 2,
                default: 2,
                explanation: "Colour of Blue's checkers (player 2)",
                player: 2,
            },
            {
                num: 3,
                default: FELT,
                explanation: "Colour of the felt squares",
            },
            {
                num: 4,
                default: GRID,
                explanation: "Colour of the grid lines",
            },
            {
                num: 5,
                default: LEGAL_GREEN,
                explanation: "Colour of the dots on the checkers that have a legal move and of the squares a selected checker may move to",
            },
            {
                num: 6,
                default: LAST_WHITE,
                explanation: "Colour of the ring on the checker moved last and of the dot on the square it came from",
            },
            {
                num: 7,
                default: GOLD,
                explanation: "Colour of the ring on the selected checker and of the outline around the winner's groups",
            },
        ],
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public boardsize = 7;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    // the destinations of a selected checker, shown while a move is being entered; not part of the state
    private highlights: string[] = [];
    private selected?: string;
    // true while a complete move that has not been submitted yet is being shown
    private pending = false;

    constructor(state?: ICounterflowState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = this.applyVariantConstraints(variants);
            }
            const size = this.getBoardSize();
            this.boardsize = size;
            const board = new Map<string, playerid>();
            cfStart(size, size).forEach((who, sq) => {
                if (who !== undefined) {
                    board.set(this.coords2algebraic(sq % size, Math.floor(sq / size)), who);
                }
            });
            const fresh: IMoveState = {
                _version: CounterflowGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ICounterflowState;
            }
            if (state.game !== CounterflowGame.gameinfo.uid) {
                throw new Error(`The Counterflow engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): CounterflowGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.lastmove = state.lastmove;
        this.results = [...state._results];
        this.boardsize = this.getBoardSize();
        this.highlights = [];
        this.selected = undefined;
        this.pending = false;
        return this;
    }

    private getBoardSize(): number {
        for (const size of [5, 9, 11]) {
            if (this.variants.includes(`size-${size}`)) {
                return size;
            }
        }
        return 7;
    }

    // x is the column, y the row counted from the top (as the renderer counts rows)
    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardsize);
    }
    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardsize);
    }
    private cell2sq(cell: string): number {
        const [x, y] = this.algebraic2coords(cell);
        return y * this.boardsize + x;
    }
    private sq2cell(sq: number): string {
        return this.coords2algebraic(sq % this.boardsize, Math.floor(sq / this.boardsize));
    }

    /** The position as the rule helpers take it. */
    private squares(): CfBoard {
        const out: CfBoard = new Array<playerid | undefined>(this.boardsize * this.boardsize).fill(undefined);
        for (const [cell, who] of this.board.entries()) {
            out[this.cell2sq(cell)] = who;
        }
        return out;
    }

    /** The checkers of a player, row by row from the top. */
    public checkers(player: playerid): string[] {
        const out: string[] = [];
        this.squares().forEach((who, sq) => {
            if (who === player) {
                out.push(this.sq2cell(sq));
            }
        });
        return out;
    }

    /** The groups of a player's checkers, each as a list of squares. */
    public groups(player: playerid): string[][] {
        return cfGroups(this.squares(), player, this.boardsize, this.boardsize).map(g => g.map(sq => this.sq2cell(sq)));
    }

    /** The distance of the checker on `cell`, or undefined when it has no opening. */
    public distance(cell: string): number | undefined {
        return cfDistances(this.squares(), this.boardsize, this.boardsize)[this.cell2sq(cell)];
    }

    /** The shortest distance of all checkers of both colours on the board. */
    public shortestDistance(): number | undefined {
        return cfShortestDistance(this.squares(), this.boardsize, this.boardsize);
    }

    private legalMoves(player: playerid): {from: string; to: string}[] {
        return cfMoves(this.squares(), player, this.boardsize, this.boardsize).map(m => ({from: this.sq2cell(m.from), to: this.sq2cell(m.to)}));
    }

    /** The squares the checker on `cell` may move to. */
    public destinations(cell: string, player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        return this.legalMoves(player).filter(m => m.from === cell).map(m => m.to);
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves = this.legalMoves(player).map(m => `${m.from}-${m.to}`);
        if (moves.length === 0) {
            // A player with no available move has their turn skipped.  The
            // `autopass` flag makes the front end submit this pass
            // automatically.
            return ["pass"];
        }
        return moves;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = "";
            const cell = this.coords2algebraic(col, row);
            const mine = this.board.has(cell) && this.board.get(cell) === this.currplayer;
            if (move.length === 0) {
                // nothing selected yet: only a click on one of your own checkers does anything
                if (mine) {
                    newmove = cell;
                } else {
                    return {move: "", valid: false, message: i18next.t("apgames:validation.counterflow.INITIAL_INSTRUCTIONS")};
                }
            } else {
                const [from, to] = move.split("-");
                if (to === undefined && cell === from) {
                    // clicking the selected checker again deselects it
                    return {move: "", valid: true, complete: -1, message: i18next.t("apgames:validation.counterflow.INITIAL_INSTRUCTIONS")};
                } else if (mine) {
                    // switching to another checker
                    newmove = cell;
                } else {
                    newmove = `${from}-${cell}`;
                }
            }
            const result = this.validateMove(newmove) as IClickResult;
            if (! result.valid) {
                // keep the selection so that the player can try another square
                result.move = move.includes("-") ? "" : move;
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
            result.message = i18next.t("apgames:validation.counterflow.INITIAL_INSTRUCTIONS");
            return result;
        }

        const legal = this.legalMoves(this.currplayer);
        if (m === "pass") {
            if (legal.length > 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.counterflow.NO_PASS");
                return result;
            }
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation.counterflow.MUST_PASS");
            return result;
        }

        const [from, to, extra] = m.split("-");
        if (extra !== undefined) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
            return result;
        }
        for (const cell of [from, to]) {
            if (cell !== undefined) {
                try {
                    this.algebraic2coords(cell);
                } catch {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                    return result;
                }
            }
        }
        if (! this.board.has(from)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: from});
            return result;
        }
        if (this.board.get(from) !== this.currplayer) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
            return result;
        }
        const dests = legal.filter(mv => mv.from === from).map(mv => mv.to);
        if (to === undefined) {
            if (dests.length === 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NO_MOVES", {where: from});
                return result;
            }
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.counterflow.PARTIAL");
            return result;
        }
        if (! dests.includes(to)) {
            result.valid = false;
            result.message = this.explain(from, to);
            return result;
        }

        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    /** Why the current player's checker on `from` may not move to `to`. */
    private explain(from: string, to: string): string {
        const [fx, fy] = this.algebraic2coords(from);
        const [tx, ty] = this.algebraic2coords(to);
        const dx = tx - fx;
        const dy = ty - fy;
        const sideways = dy === 0 && dx !== 0;
        // Red moves up the board, toward smaller y
        const forward = (this.currplayer === 1 ? dy < 0 : dy > 0) && (dx === 0 || Math.abs(dx) === Math.abs(dy));
        if (!sideways && !forward) {
            return i18next.t("apgames:validation.counterflow.DIRECTION", {from, to});
        }
        if (this.board.has(to)) {
            return i18next.t("apgames:validation._general.OCCUPIED", {where: to});
        }
        const steps = Math.max(Math.abs(dx), Math.abs(dy));
        for (let k = 1; k < steps; k++) {
            if (this.board.has(this.coords2algebraic(fx + k * Math.sign(dx), fy + k * Math.sign(dy)))) {
                return i18next.t("apgames:validation.counterflow.BLOCKED", {from, to});
            }
        }
        if (forward) {
            return i18next.t("apgames:validation.counterflow.WALL", {from, to});
        }
        if (this.shortestDistance() === 0) {
            return i18next.t("apgames:validation.counterflow.SIDEWAYS_ZERO", {from, to});
        }
        return i18next.t("apgames:validation.counterflow.SIDEWAYS", {from, to});
    }

    public move(m: string, {partial = false, trusted = false} = {}): CounterflowGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:validation._general.MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if ( (! partial) && (! this.moves().includes(m)) ) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.highlights = [];
        this.selected = undefined;
        this.pending = false;
        const [from, to] = m.split("-");
        if (m !== "pass" && to === undefined) {
            // a checker has been selected: show where it may go and wait for the destination
            if (partial) {
                this.selected = from;
                this.highlights = this.destinations(from);
                return this;
            }
            throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation.counterflow.PARTIAL"));
        }

        this.results = [];
        if (m === "pass") {
            this.results.push({type: "pass"});
        } else {
            this.board.delete(from);
            this.board.set(to, this.currplayer);
            this.results.push({type: "move", from, to});
        }

        if (partial) {
            this.pending = true;
            return this;
        }

        // update currplayer
        this.lastmove = m;
        let newplayer = (this.currplayer as number) + 1;
        if (newplayer > this.numplayers) {
            newplayer = 1;
        }
        this.currplayer = newplayer as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): CounterflowGame {
        // the player who just moved
        const prev: playerid = this.currplayer === 1 ? 2 : 1;
        if (cfHasWon(this.squares(), prev, this.boardsize, this.boardsize)) {
            this.gameover = true;
            this.winner = [prev];
            this.results.push({type: "eog", reason: "groups"});
        } else if (this.legalMoves(this.currplayer).length === 0 && this.legalMoves(prev).length === 0) {
            // Under the rules this cannot happen: at least one player always
            // has an available move.  The game must still be able to finish
            // if it ever did, so it ends without a winner.
            this.gameover = true;
            this.winner = [1, 2];
            this.results.push({type: "eog"});
        }
        if (this.gameover) {
            this.results.push({type: "winners", players: [...this.winner]});
        }
        return this;
    }

    public collectChatLogLine(lines: ChatLogLine[], r: APMoveResult, ctx: ChatLogCollectContext): boolean {
        if (r.type === "pass") {
            this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:counterflow.PASS.skipped");
            return true;
        }
        return super.collectChatLogLine(lines, r, ctx);
    }

    protected eogChatLineOverride(r: Extract<APMoveResult, { type: "eog" }>, ctx: ChatLogCollectContext): ChatLogLine | undefined {
        if (r.reason === "groups") {
            const winner = this.resolveChatPlayerName(this.winner[0], ctx.players);
            return {
                actor: { kind: "none" },
                textKey: "apresults:counterflow.EOG.groups",
                textParams: { player: winner },
            };
        }
        return undefined;
    }

    public state(): ICounterflowState {
        return {
            game: CounterflowGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: CounterflowGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    private rowCol(cell: string): RowCol {
        const [x, y] = this.algebraic2coords(cell);
        return {row: y, col: x};
    }

    /**
     * The outline around the winner's groups: one fence on every side of a
     * winner's checker that does not face another of the winner's checkers.
     */
    private outline(player: playerid, colour: MarkerFenceData["colour"], width: number): MarkerFenceData[] {
        const size = this.boardsize;
        const squares = this.squares();
        const own = (row: number, col: number): boolean => row >= 0 && row < size && col >= 0 && col < size && squares[row * size + col] === player;
        const sides: MarkerFenceData[] = [];
        for (let row = 0; row < size; row++) {
            for (let col = 0; col < size; col++) {
                if (!own(row, col)) {
                    continue;
                }
                const edges: [MarkerFenceData["side"], number, number][] = [["N", row - 1, col], ["E", row, col + 1], ["S", row + 1, col], ["W", row, col - 1]];
                for (const [side, r, c] of edges) {
                    if (!own(r, c)) {
                        sides.push({cell: {row, col}, side, colour, width});
                    }
                }
            }
        }
        return sides;
    }

    public render(): APRenderRep {
        const size = this.boardsize;

        // Build piece string
        let pstr = "";
        for (let row = 0; row < size; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            for (let col = 0; col < size; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    pstr += this.board.get(cell) === 1 ? "A" : "B";
                } else {
                    pstr += "-";
                }
            }
        }
        pstr = pstr.replace(new RegExp(`-{${size}}`, "g"), "_");

        const board: BoardBasic = {
            // one felt colour on both kinds of square, as in the designer's app
            style: "squares-checkered",
            width: size,
            height: size,
            checkeredLight: FELT_COLOUR,
            checkeredDark: FELT_COLOUR,
            strokeColour: GRID_COLOUR,
            strokeOpacity: 0.9,
            strokeWeight: 1.25,
            backFill: {
                type: "full",
                colour: {func: "custom", default: OAK, palette: "_context_background"},
            },
        };
        const rep: APRenderRep = {
            board,
            legend: {
                A: {name: "piece-marbled", paint: {fill: 1}},
                B: {name: "piece-marbled", paint: {fill: 2}},
                H: {name: "piece-square-borderless", paint: {fill: LEGAL_COLOUR}, opacity: LEGAL_OPACITY, scale: LEGAL_SCALE},
                L: ringGlyph(LAST_COLOUR, LAST_SCALE, 0.9),
                S: ringGlyph(GOLD_COLOUR, SELECTED_SCALE, 1),
            },
            pieces: pstr,
        };

        // A position in which a player has reached the goal: the gold outline
        // around every group of that player's checkers, and no other marks.
        // A game that ended in any other way (resignation, timeout) shows none.
        const squares = this.squares();
        const finisher = ([1, 2] as playerid[]).find(p => cfHasWon(squares, p, size, size));
        if (finisher !== undefined) {
            board.markers = [
                {type: "fences", sides: this.outline(finisher, OUTLINE_EDGE, OUTLINE_EDGE_WIDTH) as [MarkerFenceData, ...MarkerFenceData[]]},
                {type: "fences", sides: this.outline(finisher, GOLD_COLOUR, OUTLINE_WIDTH) as [MarkerFenceData, ...MarkerFenceData[]]},
            ];
            return rep;
        }

        // Add annotations
        const annotations: AnnotationBasic[] = [];
        // the checker moved last: a white dot where it came from and a white ring on the checker
        for (const r of this.results) {
            if (r.type === "move") {
                annotations.push({type: "dots", targets: [this.rowCol(r.from)], colour: LAST_COLOUR, opacity: 0.8, size: 0.14});
                annotations.push({type: "glyph", glyph: "L", targets: [this.rowCol(r.to)]});
            }
        }
        if (this.selected !== undefined) {
            // a gold ring on the selected checker, and the squares it may move to in green
            annotations.push({type: "glyph", glyph: "S", targets: [this.rowCol(this.selected)]});
            if (this.highlights.length > 0) {
                annotations.push({type: "glyph", glyph: "H", targets: this.highlights.map(cell => this.rowCol(cell)) as [RowCol, ...RowCol[]]});
            }
        } else if (!this.pending && !this.gameover) {
            // a green dot on every checker that has a legal move
            const movable = [...new Set(this.legalMoves(this.currplayer).map(mv => mv.from))];
            if (movable.length > 0) {
                const targets = movable.map(cell => this.rowCol(cell)) as [RowCol, ...RowCol[]];
                annotations.push({type: "dots", targets, colour: LAST_COLOUR, opacity: 0.9, size: 0.21});
                annotations.push({type: "dots", targets, colour: LEGAL_COLOUR, size: 0.17});
            }
        }
        if (annotations.length > 0) {
            rep.annotations = annotations;
        }

        return rep;
    }

    public clone(): CounterflowGame {
        return new CounterflowGame(this.serialize());
    }
}
