import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult, type ChatLogCollectContext, type ChatLogLine } from "./_base.js";
import { APGamesInformation } from "../schemas/gameinfo.js";
import { APRenderRep, AnnotationBasic, Colourfuncs, Glyph, RowCol } from "@abstractplay/renderer/build/schemas/schema";
import { APMoveResult } from "../schemas/moveresults.js";
import { reviver, UserFacingError } from "../common/index.js";
import i18next from "i18next";

export const gameApgamesEn = {
    validation: {
        INITIAL_INSTRUCTIONS_ROOT: "Select any square for the root, a stack of two red checkers.",
        INITIAL_INSTRUCTIONS: "Select an unoccupied square that is orthogonally adjacent to exactly one checker. The squares you may play are marked in green.",
        NOT_ADJACENT: "{{where}} is not orthogonally adjacent to any checker. A placed checker must be orthogonally adjacent to exactly one checker.",
        TOO_MANY: "{{where}} is orthogonally adjacent to more than one checker. A placed checker must be orthogonally adjacent to exactly one checker.",
    },
    variants: {
        "#board": {
            name: "9x9 board",
        },
        "size-7": {
            name: "7x7 board",
        },
        "size-11": {
            name: "11x11 board",
        },
        "size-13": {
            name: "13x13 board",
        },
    },
};

export const gameApresultsEn = {
    PLACE: {
        root: "{{player}} placed the root on {{where}}.",
    },
    EOG: {
        root: "{{player}} claims the root.",
        settled: "The owner of the root could no longer change. {{player}} claims the root.",
    },
};

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    root?: string;
    lastmove?: string;
}

export interface IQBFState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
}

/*
 * Rule helpers.
 *
 * The checkers form a tree.  Red's first checker, the root, may go on any
 * square.  Every later checker goes on an unoccupied square orthogonally
 * adjacent to exactly one checker, which is its parent.  Diagonal contact
 * does not count.  The tree is recovered from the position alone: every
 * placement adds exactly one orthogonal contact, so the contact graph of the
 * checkers is the tree and the parent of a checker is its neighbour on the
 * side of the root.
 *
 * When the game ends the checkers are claimed from the leaves inward.  A
 * checker belongs to its own colour if all of its children belong to its own
 * colour, otherwise to the other colour.  A childless checker belongs to its
 * own colour.  Whoever owns the root wins.
 *
 * The helpers work on a square board of `size` squares a side with the
 * squares indexed row by row from the top left, index = row * size + col.
 */

/** Indices of the orthogonal neighbours of a square. */
export function qbfNeighbours(idx: number, size: number): number[] {
    const row = Math.floor(idx / size);
    const col = idx % size;
    const out: number[] = [];
    if (row > 0) { out.push(idx - size); }
    if (row < size - 1) { out.push(idx + size); }
    if (col > 0) { out.push(idx - 1); }
    if (col < size - 1) { out.push(idx + 1); }
    return out;
}

/**
 * The squares a checker may be placed on: every square when the board is
 * empty, otherwise every unoccupied square orthogonally adjacent to exactly
 * one checker.  `occupied` has one entry per square.
 */
export function qbfLegalSquares(occupied: boolean[], size: number): number[] {
    const out: number[] = [];
    if (!occupied.some(o => o)) {
        for (let i = 0; i < size * size; i++) {
            out.push(i);
        }
        return out;
    }
    for (let i = 0; i < size * size; i++) {
        if (occupied[i]) {
            continue;
        }
        let count = 0;
        for (const n of qbfNeighbours(i, size)) {
            if (occupied[n]) {
                count++;
            }
        }
        if (count === 1) {
            out.push(i);
        }
    }
    return out;
}

/**
 * The tree, as the squares in breadth-first order from the root and the
 * parent of each square (-1 for the root, undefined for unoccupied squares).
 */
function qbfTree(colours: (playerid | undefined)[], root: number, size: number): {order: number[]; parent: (number | undefined)[]} {
    const parent: (number | undefined)[] = new Array<number | undefined>(size * size).fill(undefined);
    const order: number[] = [root];
    parent[root] = -1;
    for (let i = 0; i < order.length; i++) {
        const v = order[i];
        for (const u of qbfNeighbours(v, size)) {
            if (colours[u] !== undefined && parent[u] === undefined) {
                parent[u] = v;
                order.push(u);
            }
        }
    }
    return {order, parent};
}

/**
 * The owner of every checker, claimed from the leaves inward.  `colours` has
 * one entry per square, undefined for an unoccupied square.  The result has
 * the same shape.
 */
export function qbfOwners(colours: (playerid | undefined)[], root: number, size: number): (playerid | undefined)[] {
    const {order, parent} = qbfTree(colours, root, size);
    const owner: (playerid | undefined)[] = new Array<playerid | undefined>(size * size).fill(undefined);
    for (let i = order.length - 1; i >= 0; i--) {
        const v = order[i];
        const c = colours[v]!;
        let res: playerid = c;
        for (const u of qbfNeighbours(v, size)) {
            if (parent[u] === v && owner[u] !== c) {
                res = c === 1 ? 2 : 1;
                break;
            }
        }
        owner[v] = res;
    }
    return owner;
}

/**
 * The owner of the root when no continuation of the game can change it, or
 * undefined when it still can.  A checker is settled when it has a settled
 * child belonging to the other colour (then it belongs to the other colour
 * for good), or when it is closed, that is when no square beside it can ever
 * take a checker, and all of its children are settled and belong to its own
 * colour.  A square beside a checker can take a checker only while it is
 * unoccupied and adjacent to exactly one checker, and the number of adjacent
 * checkers never goes down, so a closed checker stays closed.
 */
export function qbfSettled(colours: (playerid | undefined)[], root: number, size: number): playerid | undefined {
    const {order, parent} = qbfTree(colours, root, size);
    const owner: (playerid | undefined)[] = new Array<playerid | undefined>(size * size).fill(undefined);
    const settled: boolean[] = new Array<boolean>(size * size).fill(false);
    for (let i = order.length - 1; i >= 0; i--) {
        const v = order[i];
        const c = colours[v]!;
        let res: playerid = c;
        let settledOther = false;
        let allSettledOwn = true;
        let closed = true;
        for (const u of qbfNeighbours(v, size)) {
            if (colours[u] !== undefined) {
                if (parent[u] === v) {
                    if (owner[u] !== c) {
                        res = c === 1 ? 2 : 1;
                        if (settled[u]) {
                            settledOther = true;
                        }
                    }
                    if (!settled[u] || owner[u] !== c) {
                        allSettledOwn = false;
                    }
                }
            } else {
                let count = 0;
                for (const n of qbfNeighbours(u, size)) {
                    if (colours[n] !== undefined) {
                        count++;
                    }
                }
                if (count === 1) {
                    closed = false;
                }
            }
        }
        owner[v] = res;
        settled[v] = settledOther || (closed && allSettledOwn);
    }
    return settled[root] ? owner[root] : undefined;
}

const LEGAL_GREEN = "#28b446";
const LEGAL_OPACITY = 0.45;
const LEGAL_SCALE = 0.94;   // a little smaller than the square, so that the grid lines stay visible
const LEGAL_COLOUR: Colourfuncs = {func: "custom", default: LEGAL_GREEN, palette: 5};
const LAST_WHITE = "#ffffff";
const LAST_OPACITY = 0.9;
const LAST_COLOUR: Colourfuncs = {func: "custom", default: LAST_WHITE, palette: 6};
const MARK_BLACK = "#000000";
const MARK_SILVER = "#c0c0c0";

// the board of the designer's own app: one tan felt, grid lines in a darker tan, an oak frame
const FELT = "#e8d6b2";
const GRID = "#b08e60";
const OAK = "#c48f4f";
const FELT_COLOUR: Colourfuncs = {func: "custom", default: FELT, palette: 3};
const GRID_COLOUR: Colourfuncs = {func: "custom", default: GRID, palette: 4};

// Every checker carries an owner mark: a small black ring holding a disc of
// the colour of the player who owns the checker.  On a checker too dark for
// a black ring to show (a custom colour), the ring is silver instead: black
// wins the contrast test against every default colour.  The checker placed
// last carries a white ring around its mark.  The root is a stack of two red
// checkers, drawn as two checkers slightly offset up and down.  A nudge is
// measured in 1/500 of a cell and is applied before the layer's scale, so a
// scaled layer divides the wanted offset by its scale.  The face of the
// marbled checker sits 2% of a cell above the centre of the cell.
const MARK_RING = 0.3;
const MARK_DISC = 0.22;
const LAST_SCALE = 0.78;
const MARK_DY = -10;
const STACK_DY = 30;

function checkerGlyph(colour: playerid, dy = 0): Glyph {
    const g: Glyph = {name: "piece-marbled", paint: {fill: colour}};
    if (dy !== 0) {
        g.nudge = {dy};
    }
    return g;
}

/** The owner mark on a checker of `checkerColour`: the ring, then the owner's disc. */
function markGlyphs(owner: playerid, checkerColour: playerid, dy = 0): Glyph[] {
    const ring: Colourfuncs = {func: "bestContrast", bg: checkerColour, fg: [MARK_BLACK, MARK_SILVER]};
    return [
        {name: "piece-borderless", paint: {fill: ring}, scale: MARK_RING, nudge: {dx: 0, dy: (MARK_DY + dy) / MARK_RING}},
        {name: "piece-borderless", paint: {fill: owner}, scale: MARK_DISC, nudge: {dx: 0, dy: (MARK_DY + dy) / MARK_DISC}},
    ];
}

/** A checker of `colour` owned by `owner`. */
function pieceGlyph(colour: playerid, owner: playerid): [Glyph, ...Glyph[]] {
    return [checkerGlyph(colour), ...markGlyphs(owner, colour)];
}

/** The root, a stack of two red checkers, owned by `owner`. */
function rootGlyph(owner: playerid): [Glyph, ...Glyph[]] {
    return [checkerGlyph(1, STACK_DY), checkerGlyph(1, -STACK_DY), ...markGlyphs(owner, 1, -STACK_DY)];
}

/** The ring marking the checker placed last, drawn over the checker by a glyph annotation. */
function lastGlyph(dy = 0): Glyph {
    return {
        name: "ring-02",
        paint: {fill: {colour: LAST_WHITE, opacity: 0}, border: LAST_COLOUR},
        opacity: LAST_OPACITY,
        scale: LAST_SCALE,
        nudge: {dx: 0, dy: (MARK_DY + dy) / LAST_SCALE},
    };
}

export class QBFGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "QBF",
        uid: "qbf",
        playercounts: [2],
        version: "20261103",
        dateAdded: "2026-11-03",
        description: "Red and Blue grow a tree of checkers from Red's first checker, the root. Every checker must be placed orthogonally adjacent to exactly one checker. When no such square is left, the checkers are claimed from the leaves inward: a checker belongs to its own colour if all of its children belong to its own colour, and otherwise to the other colour. Whoever claims the root wins.",
        notes: "QBF, which stands for Quantified Boolean Formula, was designed by Mark Steere in November 2026, in collaboration with Claude, an AI model made by Anthropic.\n\nRed begins by placing the root, a stack of two red checkers, on any square. QBF uses the pie rule: Blue, for his first turn, can choose to switch colours with Red instead of placing a checker. If he does, the root remains red, but the player who placed the root is now Blue, and places a blue checker. Thereafter, players take turns placing one checker per turn.\n\nAfter the root, every checker must be placed on an unoccupied square orthogonally adjacent to exactly one checker, of either colour. Diagonal adjacencies are irrelevant. The checker it is placed next to is its parent, and the placed checker is a child of that parent. The squares a checker may be placed on are marked in green. The game ends when no such square is left.\n\nWhen the game ends, the players claim the checkers on the board. A player can claim ownership of checkers of either or both colours. Start with the checkers that have no children and work inward toward the root: a checker belongs to its own colour if all of its children belong to its own colour. Otherwise it belongs to the other colour. Childless checkers belong to their own colour. You win if you claim the root.\n\nThe owner of every checker is shown throughout the game by the mark on the checker: a black ring holding a disc of the owner's colour (the ring is silver on a checker too dark for black to show). The marks on the board show who would own each checker if the game ended at once. The checker placed last carries a white ring. The game ends as soon as no placement could change the owner of the root any more, which can be before the open squares run out.",
        urls: [
            "https://www.marksteeregames.com/QBF_rules.pdf",
            "https://www.marksteeregames.com",
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
            { uid: "size-7", group: "board" },
            { uid: "#board" },
            { uid: "size-11", group: "board" },
            { uid: "size-13", group: "board" },
        ],
        categories: ["goal>royal-capture", "mechanic>place", "mechanic>convert", "mechanic>network", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["experimental", "pie"],
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
                explanation: "Colour of the felt board",
            },
            {
                num: 4,
                default: GRID,
                explanation: "Colour of the grid lines",
            },
            {
                num: 5,
                default: LEGAL_GREEN,
                explanation: "Colour of the squares marking where a checker may be placed",
            },
            {
                num: 6,
                default: LAST_WHITE,
                explanation: "Colour of the ring on the last placed checker",
            },
        ],
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public root?: string;
    public boardsize = 9;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IQBFState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = this.applyVariantConstraints(variants);
            }
            const fresh: IMoveState = {
                _version: QBFGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map<string, playerid>(),
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IQBFState;
            }
            if (state.game !== QBFGame.gameinfo.uid) {
                throw new Error(`The QBF engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): QBFGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.root = state.root;
        this.lastmove = state.lastmove;
        this.results = [...state._results];
        this.boardsize = this.getBoardSize();
        return this;
    }

    /** Pie rule: Blue may swap seats on the turn immediately after the root is placed. */
    public isPieTurn(): boolean {
        return !this.gameover && this.stack.length === 2 && this.currplayer === 2;
    }

    private getBoardSize(): number {
        for (const size of [7, 11, 13]) {
            if (this.variants.includes(`size-${size}`)) {
                return size;
            }
        }
        return 9;
    }

    // x is the column, y the row counted from the top (as the renderer counts rows)
    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardsize);
    }
    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardsize);
    }
    // the rule helpers index the squares row by row from the top left
    private cell2idx(cell: string): number {
        const [x, y] = this.algebraic2coords(cell);
        return y * this.boardsize + x;
    }
    private idx2cell(idx: number): string {
        return this.coords2algebraic(idx % this.boardsize, Math.floor(idx / this.boardsize));
    }

    /** The colour of the checker on every square, undefined where there is none. */
    private colours(): (playerid | undefined)[] {
        const out: (playerid | undefined)[] = new Array<playerid | undefined>(this.boardsize * this.boardsize).fill(undefined);
        for (const [cell, who] of this.board) {
            out[this.cell2idx(cell)] = who;
        }
        return out;
    }

    /** The squares a checker may be placed on, in algebraic notation. */
    public legalSquares(): string[] {
        const occupied = this.colours().map(c => c !== undefined);
        return qbfLegalSquares(occupied, this.boardsize).map(i => this.idx2cell(i));
    }

    /** The owner of every checker on the board. */
    public owners(): Map<string, playerid> {
        const out = new Map<string, playerid>();
        if (this.root === undefined) {
            return out;
        }
        const owner = qbfOwners(this.colours(), this.cell2idx(this.root), this.boardsize);
        for (let i = 0; i < owner.length; i++) {
            if (owner[i] !== undefined) {
                out.set(this.idx2cell(i), owner[i]!);
            }
        }
        return out;
    }

    /** The owner of the root, or undefined before the root is placed. */
    public rootOwner(): playerid | undefined {
        if (this.root === undefined) {
            return undefined;
        }
        return this.owners().get(this.root);
    }

    /** The owner of the root when no placement could change it any more. */
    public settledOwner(): playerid | undefined {
        if (this.root === undefined) {
            return undefined;
        }
        return qbfSettled(this.colours(), this.cell2idx(this.root), this.boardsize);
    }

    // the legal squares do not depend on whose turn it is
    public moves(): string[] {
        if (this.gameover) { return []; }
        return this.legalSquares();
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            const result = this.validateMove(cell) as IClickResult;
            // an illegal square leaves nothing entered, so that the player can try another
            result.move = result.valid ? cell : "";
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
            result.message = i18next.t(this.root === undefined ? "apgames:validation.qbf.INITIAL_INSTRUCTIONS_ROOT" : "apgames:validation.qbf.INITIAL_INSTRUCTIONS");
            return result;
        }

        let idx: number;
        try {
            const [x, y] = this.algebraic2coords(m);
            if (x < 0 || x >= this.boardsize || y < 0 || y >= this.boardsize) {
                throw new Error("off the board");
            }
            idx = y * this.boardsize + x;
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: m});
            return result;
        }
        if (this.board.has(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: m});
            return result;
        }
        if (this.root !== undefined) {
            const colours = this.colours();
            let count = 0;
            for (const n of qbfNeighbours(idx, this.boardsize)) {
                if (colours[n] !== undefined) {
                    count++;
                }
            }
            if (count === 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.qbf.NOT_ADJACENT", {where: m});
                return result;
            }
            if (count > 1) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.qbf.TOO_MANY", {where: m});
                return result;
            }
        }

        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {partial = false, trusted = false} = {}): QBFGame {
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
        this.board.set(m, this.currplayer);
        if (this.root === undefined) {
            this.root = m;
            this.results.push({type: "place", where: m, what: "root"});
        } else {
            this.results.push({type: "place", where: m});
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

    protected checkEOG(): QBFGame {
        if (this.legalSquares().length === 0) {
            // no square can take a checker: the checkers are claimed
            this.gameover = true;
            this.winner = [this.rootOwner()!];
            this.results.push({type: "eog", reason: "root"});
        } else {
            // the owner of the root may already be beyond change
            const settled = this.settledOwner();
            if (settled !== undefined) {
                this.gameover = true;
                this.winner = [settled];
                this.results.push({type: "eog", reason: "settled"});
            }
        }
        if (this.gameover) {
            this.results.push({type: "winners", players: [...this.winner]});
        }
        return this;
    }

    public collectChatLogLine(lines: ChatLogLine[], r: APMoveResult, ctx: ChatLogCollectContext): boolean {
        if (r.type === "place" && r.what === "root") {
            this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:qbf.PLACE.root", {where: r.where});
            return true;
        }
        return super.collectChatLogLine(lines, r, ctx);
    }

    protected eogChatLineOverride(r: Extract<APMoveResult, { type: "eog" }>, ctx: ChatLogCollectContext): ChatLogLine | undefined {
        if (r.reason === "root" || r.reason === "settled") {
            const winner = this.resolveChatPlayerName(this.winner[0], ctx.players);
            return {
                actor: { kind: "none" },
                textKey: `apresults:qbf.EOG.${r.reason}`,
                textParams: { player: winner },
            };
        }
        return undefined;
    }

    public state(): IQBFState {
        return {
            game: QBFGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: QBFGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            root: this.root,
        };
    }

    private rowCol(cell: string): RowCol {
        const [x, y] = this.algebraic2coords(cell);
        return {row: y, col: x};
    }

    public render(): APRenderRep {
        const size = this.boardsize;
        const owners = this.owners();

        // Build piece string: A red owned by Red, B red owned by Blue, C blue
        // owned by Blue, D blue owned by Red, E the root owned by Red, F the
        // root owned by Blue
        let pstr = "";
        for (let row = 0; row < size; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            for (let col = 0; col < size; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const colour = this.board.get(cell)!;
                    const owner = owners.get(cell)!;
                    if (cell === this.root) {
                        pstr += owner === 1 ? "E" : "F";
                    } else if (colour === 1) {
                        pstr += owner === 1 ? "A" : "B";
                    } else {
                        pstr += owner === 2 ? "C" : "D";
                    }
                } else {
                    pstr += "-";
                }
            }
        }
        pstr = pstr.replace(new RegExp(`-{${size}}`, "g"), "_");

        const rep: APRenderRep = {
            board: {
                // one felt colour on both kinds of square, as in the app
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
            },
            legend: {
                A: pieceGlyph(1, 1),
                B: pieceGlyph(1, 2),
                C: pieceGlyph(2, 2),
                D: pieceGlyph(2, 1),
                E: rootGlyph(1),
                F: rootGlyph(2),
                H: {name: "piece-square-borderless", colour: LEGAL_COLOUR, opacity: LEGAL_OPACITY, scale: LEGAL_SCALE},
                L: lastGlyph(),
                M: lastGlyph(-STACK_DY),
            },
            pieces: pstr,
        };

        // Add annotations
        const annotations: AnnotationBasic[] = [];
        if (!this.gameover && this.root !== undefined) {
            const targets = this.legalSquares().map(cell => this.rowCol(cell));
            if (targets.length > 0) {
                annotations.push({type: "glyph", glyph: "H", targets: targets as [RowCol, ...RowCol[]]});
            }
        }
        if (!this.gameover) {
            // the white ring on the checker placed last
            for (const r of this.results) {
                if (r.type === "place") {
                    annotations.push({type: "glyph", glyph: r.where === this.root ? "M" : "L", targets: [this.rowCol(r.where!)]});
                }
            }
        }
        if (annotations.length > 0) {
            rep.annotations = annotations;
        }

        return rep;
    }

    public clone(): QBFGame {
        return new QBFGame(this.serialize());
    }
}
