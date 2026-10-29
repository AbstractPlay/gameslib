import { GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IValidationResult, type ChatLogCollectContext, type ChatLogLine } from "./_base.js";
import { APGamesInformation } from "../schemas/gameinfo.js";
import { APRenderRep, AnnotationBasic, Colourfuncs, Gradient, MarkerFlood, MarkerLine, RowCol } from "@abstractplay/renderer/build/schemas/schema";
import { APMoveResult } from "../schemas/moveresults.js";
import { reviver, UserFacingError } from "../common/index.js";
import i18next from "i18next";

export const gameApgamesEn = {
    validation: {
        INITIAL_INSTRUCTIONS: "Select one of your checkers. The squares it may move to are then marked in green.",
        PARTIAL: "Select the square to move the checker to, or select your other checker instead.",
        NOT_DIAGONAL: "The checker on {{from}} cannot reach {{to}}. A checker moves any number of squares along a diagonal, as a bishop moves in chess, and cannot pass through another checker.",
        DISTANCE: "The checker on {{from}} may not move to {{to}}. A move must bring the checker closer to the two enemy checkers, so that the sum of its distances to them decreases, or keep that sum and take the checker farther from your other checker.",
        NO_PASS: "You may not pass while you have a legal move.",
        MUST_PASS: "You have no legal move. Your turn is skipped.",
    },
    variants: {
        "#board": {
            name: "10x10 board",
        },
        "size-12": {
            name: "12x12 board",
        },
    },
    displays: {
        "#style": {
            name: "Felt board",
            description: "A felt board in an oak frame with glazed ceramic checkers, as in the designer's own app.",
        },
        plain: {
            name: "Plain board",
            description: "The standard Abstract Play checkered board and flat pieces.",
        },
    },
};

export const gameApresultsEn = {
    EOG: {
        crosscut: "{{player}} completed a crosscut and loses the game.",
    },
};

export type playerid = 1|2;

/** A square as [column, row], both 0-based, row 0 being the bottom row (rank 1). */
export type Pos = [number, number];

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
}

export interface IYonkomaState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
}

/*
 * Rule helpers.
 *
 * Each player has exactly two checkers.  A checker moves along a diagonal,
 * any distance, through empty squares only.  The distance between two
 * squares is the king-move distance (the larger of the row difference and
 * the column difference).  A move is legal when it lowers the sum of the
 * moved checker's distances to the two enemy checkers, or keeps that sum
 * and raises the checker's distance to its partner.  A crosscut is a 2x2
 * block of squares holding all four checkers, and whoever completes a
 * crosscut loses.
 */

export function ykDistance(a: Pos, b: Pos): number {
    return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
}

const DIAGONALS: Pos[] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

/**
 * The squares the checker `mine[idx]` may move to, given the two enemy
 * checkers `theirs`, on a square board of the given size.
 */
export function ykDestinations(mine: [Pos, Pos], theirs: [Pos, Pos], idx: 0|1, size: number): Pos[] {
    const src = mine[idx];
    const partner = mine[1 - idx];
    const occupied = [...mine, ...theirs];
    const sumNow = ykDistance(src, theirs[0]) + ykDistance(src, theirs[1]);
    const partnerNow = ykDistance(src, partner);
    const out: Pos[] = [];
    for (const [dc, dr] of DIAGONALS) {
        let c = src[0] + dc;
        let r = src[1] + dr;
        while (c >= 0 && c < size && r >= 0 && r < size) {
            if (occupied.some(p => p[0] === c && p[1] === r)) {
                break;
            }
            const dest: Pos = [c, r];
            const sumNew = ykDistance(dest, theirs[0]) + ykDistance(dest, theirs[1]);
            const partnerNew = ykDistance(dest, partner);
            if (sumNew < sumNow || (sumNew === sumNow && partnerNew > partnerNow)) {
                out.push(dest);
            }
            c += dc;
            r += dr;
        }
    }
    return out;
}

/**
 * True when the four checkers form a crosscut: all four within a 2x2 block
 * of squares, the two red checkers on one diagonal of the block and the two
 * blue checkers on the other.
 */
export function ykIsCrosscut(red: [Pos, Pos], blue: [Pos, Pos]): boolean {
    const all = [...red, ...blue];
    const cols = all.map(p => p[0]);
    const rows = all.map(p => p[1]);
    if (Math.max(...cols) - Math.min(...cols) !== 1 || Math.max(...rows) - Math.min(...rows) !== 1) {
        return false;
    }
    // Within the block, each pair of checkers of one colour must sit on a diagonal
    const diagonal = (a: Pos, b: Pos): boolean => Math.abs(a[0] - b[0]) === 1 && Math.abs(a[1] - b[1]) === 1;
    return diagonal(red[0], red[1]) && diagonal(blue[0], blue[1]);
}

/**
 * The SVG markup of the glazed ceramic checker used by the default display.
 * The checker is a flat cylinder seen slightly from above: a shadow, the
 * darker side of the cylinder, the top face, a mottled glaze made of faint
 * translucent spots, a rolled rim that is lit at the top left and shaded at
 * the bottom right, and a thin highlight along the top edge.  The top face
 * and the side are paint slots, so the player colours are applied by the
 * legend.  The spots are placed by a small deterministic generator so that
 * the markup is the same on every render.
 */
export function ykCheckerMarkup(): string {
    const R = 41;
    const cx = 50;
    const cy = 48;
    const parts: string[] = [];
    parts.push(`<ellipse cx="${cx}" cy="57" rx="46" ry="44" fill="#000000" fill-opacity="0.10"/>`);
    parts.push(`<ellipse cx="${cx}" cy="55" rx="43" ry="42" fill="#000000" fill-opacity="0.20"/>`);
    parts.push(`<circle cx="${cx}" cy="53" r="${R}" data-slot-fill="side" fill="#8a1114"/>`);
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${R}" data-slot-fill="fill" fill="#e6504a"/>`);
    // mottled glaze: faint spots inside the top face (linear congruential generator, fixed seed)
    let seed = 31;
    const rnd = (): number => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
    };
    for (let i = 0; i < 40; i++) {
        const rr = 5 + rnd() * 7;
        let x = 0;
        let y = 0;
        for (;;) {
            x = (rnd() * 2 - 1) * R;
            y = (rnd() * 2 - 1) * R;
            if (Math.hypot(x, y) + rr <= R - 1) {
                break;
            }
        }
        const light = rnd() < 0.5;
        const colour = light ? "#ffffff" : "#000000";
        const opacity = light ? "0.06" : "0.045";
        parts.push(`<circle cx="${(cx + x).toFixed(1)}" cy="${(cy + y).toFixed(1)}" r="${rr.toFixed(1)}" fill="${colour}" fill-opacity="${opacity}"/>`);
    }
    // rolled rim, lit at the top left and shaded at the bottom right
    const arc = (a0: number, a1: number, r: number): string => {
        const x0 = cx + r * Math.cos(a0);
        const y0 = cy + r * Math.sin(a0);
        const x1 = cx + r * Math.cos(a1);
        const y1 = cy + r * Math.sin(a1);
        const large = (a1 - a0) > Math.PI ? 1 : 0;
        return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
    };
    const rim = R - 3.2;
    parts.push(`<path d="${arc(0.95 * Math.PI, 1.85 * Math.PI, rim)}" fill="none" stroke="#ffffff" stroke-opacity="0.30" stroke-width="6" stroke-linecap="round"/>`);
    parts.push(`<path d="${arc(-0.05 * Math.PI, 0.85 * Math.PI, rim)}" fill="none" stroke="#000000" stroke-opacity="0.22" stroke-width="6" stroke-linecap="round"/>`);
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${R - 6.5}" fill="none" stroke="#000000" stroke-opacity="0.07" stroke-width="2"/>`);
    parts.push(`<path d="${arc(1.08 * Math.PI, 1.72 * Math.PI, R - 1.8)}" fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="1.3" stroke-linecap="round"/>`);
    return parts.join("");
}

const CHECKER_MARKUP = ykCheckerMarkup();
const TARGET_MARKUP = `<rect x="5" y="5" width="90" height="90" rx="5" ry="5" fill="#28b446" fill-opacity="0.45"/>`;

// the colours of the designer's own app: red and blue checkers on tan felt squares in an oak frame
const RED = "#e65049";
const BLUE = "#5c6fb7";
const FELT_DARK = "#b08e60";
const FELT_LIGHT = "#e8d6b2";
const OAK = "#c48f4f";
const OAK_INK = "#3b2410";
const OAK_EDGE = "#2a1708";

export class YonkomaGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Yonkoma",
        uid: "yonkoma",
        playercounts: [2],
        version: "20261029",
        dateAdded: "2026-10-29",
        description: "Two red and two blue checkers on a checkerboard. A checker moves along a diagonal like a bishop, and every move must bring the moved checker closer to the two enemy checkers, or else keep that distance and take it farther from its partner. Whoever completes a crosscut, a 2x2 block holding all four checkers, loses.",
        notes: "Yonkoma was designed by Mark Steere in October 2026, in collaboration with Claude, an AI model made by Anthropic.\n\nThe distance between two squares is the number of king moves between them, which is the larger of the number of rows apart and the number of columns apart. A move must either bring the moved checker closer to the two enemy checkers, so that the sum of its distances to them decreases, or keep that sum unchanged and take the checker farther from its partner. Select a checker and the squares it may move to are marked in green.\n\nA crosscut is a 2x2 block of squares holding all four checkers, with the two red checkers on one diagonal of the block and the two blue checkers on the other. Whoever completes a crosscut loses. Every move lowers the total of the four red-blue distances, or keeps that total and raises the distance between two checkers of one colour, so the game always ends, and it always ends in a crosscut that one player is eventually forced to complete.\n\nPassing is not allowed, but if a player has no legal move, that turn is skipped. The pass is submitted automatically.",
        urls: [
            "https://www.marksteeregames.com/Yonkoma_rules.pdf",
            "https://www.marksteeregames.com",
            "https://boardgamegeek.com/boardgame/482183/yonkoma",
        ],
        people: [
            {
                type: "designer",
                name: "Mark Steere",
                urls: ["https://www.marksteeregames.com"],
            },
            {
                type: "coder",
                name: "Claude Fable 5.1 (Anthropic)",
            },
        ],
        variants: [
            { uid: "#board" },
            { uid: "size-12", group: "board" },
        ],
        displays: [
            { uid: "plain", group: "style" },
        ],
        categories: ["goal>arrange", "mechanic>move", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["experimental", "autopass", "custom-colours"],
        customizations: [
            {
                num: 1,
                default: RED,
                explanation: "Colour of Red's checkers (player 1)",
                player: 1,
            },
            {
                num: 2,
                default: BLUE,
                explanation: "Colour of Blue's checkers (player 2)",
                player: 2,
            },
        ],
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public boardsize = 10;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    // the destinations of a selected checker, shown while a move is being entered; not part of the state
    private highlights: string[] = [];
    private selected?: string;

    constructor(state?: IYonkomaState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = this.applyVariantConstraints(variants);
            }
            const size = this.getBoardSize();
            this.boardsize = size;
            const board = new Map<string, playerid>();
            // Red's checkers start on dark squares in two diagonally opposite
            // corners, Blue's on light squares in the other two.  The bottom
            // left corner (a1) is dark.
            board.set(this.coords2algebraic(0, size - 1), 1);
            board.set(this.coords2algebraic(size - 1, 0), 1);
            board.set(this.coords2algebraic(0, 0), 2);
            board.set(this.coords2algebraic(size - 1, size - 1), 2);
            const fresh: IMoveState = {
                _version: YonkomaGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IYonkomaState;
            }
            if (state.game !== YonkomaGame.gameinfo.uid) {
                throw new Error(`The Yonkoma engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): YonkomaGame {
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
        return this;
    }

    private getBoardSize(): number {
        if (this.variants.includes("size-12")) {
            return 12;
        }
        return 10;
    }

    // x is the column, y the row counted from the top (as the renderer counts rows)
    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardsize);
    }
    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardsize);
    }
    // the rule helpers count rows from the bottom
    private cell2pos(cell: string): Pos {
        const [x, y] = this.algebraic2coords(cell);
        return [x, this.boardsize - 1 - y];
    }
    private pos2cell(p: Pos): string {
        return this.coords2algebraic(p[0], this.boardsize - 1 - p[1]);
    }

    /** The two checkers of a player, in algebraic order. */
    public checkers(player: playerid): string[] {
        return [...this.board.entries()].filter(([, who]) => who === player).map(([cell]) => cell).sort();
    }

    private pair(player: playerid): [Pos, Pos] {
        const cells = this.checkers(player);
        if (cells.length !== 2) {
            throw new Error(`Player ${player} does not have exactly two checkers.`);
        }
        return [this.cell2pos(cells[0]), this.cell2pos(cells[1])];
    }

    /** The squares the checker on `cell` may move to, in algebraic notation. */
    public destinations(cell: string, player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        const mine = this.checkers(player);
        const idx = mine.indexOf(cell);
        if (idx < 0) {
            return [];
        }
        const pairMine = this.pair(player);
        const pairTheirs = this.pair(player === 1 ? 2 : 1);
        return ykDestinations(pairMine, pairTheirs, idx as 0|1, this.boardsize).map(p => this.pos2cell(p)).sort();
    }

    private legalMoves(player: playerid): string[] {
        const moves: string[] = [];
        for (const from of this.checkers(player)) {
            for (const to of this.destinations(from, player)) {
                moves.push(`${from}-${to}`);
            }
        }
        return moves;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves = this.legalMoves(player);
        if (moves.length === 0) {
            // Passing is not allowed, but a player with no legal move has
            // their turn skipped.  The `autopass` flag makes the front end
            // submit this pass automatically.
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
                    return {move: "", valid: false, message: i18next.t("apgames:validation.yonkoma.INITIAL_INSTRUCTIONS")};
                }
            } else {
                const [from, to] = move.split("-");
                if (to === undefined) {
                    if (cell === from) {
                        // clicking the selected checker again deselects it
                        return {move: "", valid: true, complete: -1, message: i18next.t("apgames:validation.yonkoma.INITIAL_INSTRUCTIONS")};
                    } else if (mine) {
                        // switching to the other checker
                        newmove = cell;
                    } else {
                        newmove = `${from}-${cell}`;
                    }
                } else {
                    // a complete move is already entered; start over from this click
                    if (mine) {
                        newmove = cell;
                    } else {
                        newmove = `${from}-${cell}`;
                    }
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
            result.message = i18next.t("apgames:validation.yonkoma.INITIAL_INSTRUCTIONS");
            return result;
        }

        if (m === "pass") {
            if (this.legalMoves(this.currplayer).length > 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.yonkoma.NO_PASS");
                return result;
            }
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation.yonkoma.MUST_PASS");
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
        const dests = this.destinations(from);
        if (dests.length === 0) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NO_MOVES", {where: from});
            return result;
        }
        if (to === undefined) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.yonkoma.PARTIAL");
            return result;
        }
        if (! dests.includes(to)) {
            result.valid = false;
            if (this.board.has(to)) {
                result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: to});
            } else if (! this.onOpenDiagonal(from, to)) {
                result.message = i18next.t("apgames:validation.yonkoma.NOT_DIAGONAL", {from, to});
            } else {
                result.message = i18next.t("apgames:validation.yonkoma.DISTANCE", {from, to});
            }
            return result;
        }

        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    /** True when `to` lies on a diagonal from `from` with only empty squares in between. */
    private onOpenDiagonal(from: string, to: string): boolean {
        const a = this.cell2pos(from);
        const b = this.cell2pos(to);
        const dc = b[0] - a[0];
        const dr = b[1] - a[1];
        if (dc === 0 || Math.abs(dc) !== Math.abs(dr)) {
            return false;
        }
        const sc = Math.sign(dc);
        const sr = Math.sign(dr);
        for (let k = 1; k < Math.abs(dc); k++) {
            if (this.board.has(this.pos2cell([a[0] + sc * k, a[1] + sr * k]))) {
                return false;
            }
        }
        return true;
    }

    public move(m: string, {partial = false, trusted = false} = {}): YonkomaGame {
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

        this.results = [];
        this.highlights = [];
        this.selected = undefined;
        if (m === "pass") {
            this.results.push({type: "pass"});
        } else {
            const [from, to] = m.split("-");
            if (to === undefined) {
                // a checker has been selected: show where it may go and wait for the destination
                if (partial) {
                    this.selected = from;
                    this.highlights = this.destinations(from);
                    return this;
                }
                throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation.yonkoma.PARTIAL"));
            }
            this.board.delete(from);
            this.board.set(to, this.currplayer);
            this.results.push({type: "move", from, to});
        }

        if (partial) { return this; }

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

    /** The four squares of the crosscut on the board, or an empty list when there is none. */
    public crosscut(): string[] {
        const red = this.pair(1);
        const blue = this.pair(2);
        if (! ykIsCrosscut(red, blue)) {
            return [];
        }
        return [...red, ...blue].map(p => this.pos2cell(p)).sort();
    }

    protected checkEOG(): YonkomaGame {
        // the player who just moved
        const prev: playerid = this.currplayer === 1 ? 2 : 1;
        if (this.crosscut().length > 0) {
            // whoever completes a crosscut loses
            this.gameover = true;
            this.winner = [this.currplayer];
            this.results.push({type: "eog", reason: "crosscut"});
        } else if (this.legalMoves(this.currplayer).length === 0 && this.legalMoves(prev).length === 0) {
            // Under the rules this cannot happen (checked exhaustively on
            // every board size offered), but the game must still be able to
            // finish if it ever did.  As in the designer's own engine, the
            // player to move loses.
            this.gameover = true;
            this.winner = [prev];
        }
        if (this.gameover) {
            if (!this.results.some(r => r.type === "eog")) {
                this.results.push({type: "eog"});
            }
            this.results.push({type: "winners", players: [...this.winner]});
        }
        return this;
    }

    public collectChatLogLine(lines: ChatLogLine[], r: APMoveResult, ctx: ChatLogCollectContext): boolean {
        if (r.type === "eog" && r.reason === "crosscut") {
            // the player who made the final move completed the crosscut
            const loser = this.resolveChatPlayerName(ctx.defaultSeat, ctx.players);
            this.pushNeutralChatLine(lines, "apresults:yonkoma.EOG.crosscut", {player: loser});
            return true;
        }
        return super.collectChatLogLine(lines, r, ctx);
    }

    public getPlayerColour(p: playerid): Colourfuncs {
        return {
            func: "custom",
            default: p === 1 ? RED : BLUE,
            palette: p,
        };
    }

    public state(): IYonkomaState {
        return {
            game: YonkomaGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: YonkomaGame.gameinfo.version,
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

    public render(opts?: IRenderOpts): APRenderRep {
        const size = this.boardsize;
        const plain = this.hasDisplay(opts, "plain");

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

        const red = this.getPlayerColour(1);
        const blue = this.getPlayerColour(2);

        let rep: APRenderRep;
        if (plain) {
            rep = {
                board: {
                    style: "squares-checkered",
                    width: size,
                    height: size,
                },
                legend: {
                    A: {name: "piece", colour: red},
                    B: {name: "piece", colour: blue},
                },
                pieces: pstr,
            };
        } else {
            // the felt board: tan felt squares, an oak frame carrying the
            // coordinates, a dark edge where the felt meets the frame, and
            // glazed checkers whose top face catches the light
            const dark: RowCol[] = [];
            const light: RowCol[] = [];
            for (let row = 0; row < size; row++) {
                for (let col = 0; col < size; col++) {
                    // a1 (bottom left) is dark
                    if ((col + (size - 1 - row)) % 2 === 0) {
                        dark.push({row, col});
                    } else {
                        light.push({row, col});
                    }
                }
            }
            const edge = (a: RowCol, b: RowCol): MarkerLine => ({type: "line", points: [a, b], colour: OAK_EDGE, opacity: 0.7, width: 3});
            const markers: (MarkerFlood | MarkerLine)[] = [
                {type: "flood", colour: FELT_DARK, opacity: 1, points: dark as [RowCol, ...RowCol[]]},
                {type: "flood", colour: FELT_LIGHT, opacity: 1, points: light as [RowCol, ...RowCol[]]},
                edge({row: 0, col: 0}, {row: 0, col: size}),
                edge({row: 0, col: size}, {row: size, col: size}),
                edge({row: size, col: size}, {row: size, col: 0}),
                edge({row: size, col: 0}, {row: 0, col: 0}),
            ];
            const glaze = (colour: Colourfuncs): Gradient => ({
                x1: 0, y1: 0, x2: 0.75, y2: 1,
                stops: [
                    {offset: 0, colour: {func: "lighten", colour, ds: 0, dl: 0.45}},
                    {offset: 0.5, colour},
                    {offset: 1, colour: {func: "lighten", colour, ds: 0, dl: -0.25}},
                ],
            });
            const side = (colour: Colourfuncs): Colourfuncs => ({func: "lighten", colour, ds: 0.1, dl: -0.9});
            rep = {
                board: {
                    style: "squares",
                    width: size,
                    height: size,
                    backFill: {
                        type: "full",
                        colour: {func: "custom", default: OAK, palette: "_context_board"},
                    },
                    labelColour: OAK_INK,
                    strokeColour: OAK_INK,
                    strokeOpacity: 0.35,
                    strokeWeight: 1,
                    markers,
                },
                glyphDefs: {
                    checker: {viewBox: [0, 0, 100, 100], markup: CHECKER_MARKUP},
                    target: {viewBox: [0, 0, 100, 100], markup: TARGET_MARKUP},
                },
                legend: {
                    A: {def: "checker", paint: {fill: glaze(red), side: side(red)}},
                    B: {def: "checker", paint: {fill: glaze(blue), side: side(blue)}},
                    H: {def: "target"},
                },
                pieces: pstr,
            };
        }

        // Add annotations
        const annotations: AnnotationBasic[] = [];
        if (this.selected !== undefined) {
            annotations.push({type: "enter", targets: [this.rowCol(this.selected)], colour: "#f5c542", occlude: false});
        }
        if (this.highlights.length > 0) {
            const targets = this.highlights.map(cell => this.rowCol(cell)) as [RowCol, ...RowCol[]];
            if (plain) {
                annotations.push({type: "dots", targets, colour: "#28b446"});
            } else {
                annotations.push({type: "glyph", glyph: "H", targets});
            }
        }
        for (const r of this.results) {
            if (r.type === "move") {
                annotations.push({type: "move", targets: [this.rowCol(r.from), this.rowCol(r.to)]});
            }
        }
        if (this.gameover) {
            const block = this.crosscut();
            if (block.length > 0) {
                annotations.push({type: "enter", targets: block.map(cell => this.rowCol(cell)) as [RowCol, ...RowCol[]], colour: "#f5c542", occlude: false});
            }
        }
        if (annotations.length > 0) {
            rep.annotations = annotations;
        }

        return rep;
    }

    public clone(): YonkomaGame {
        return new YonkomaGame(this.serialize());
    }
}
