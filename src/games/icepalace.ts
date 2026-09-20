import { IAPGameState, IClickResult, IIndividualState, IRenderOpts, IScores, IStatus, IValidationResult } from "./_base.js";
import { GameBaseSequenced } from "./_turn-sequenced.js";
import type { APGamesInformation } from "../schemas/gameinfo.js";
import { APRenderRep, AreaPieces, Glyph } from "@abstractplay/renderer/build/schemas/schema";
import type { APMoveResult } from "../schemas/moveresults.js";
import { reviver, UserFacingError } from "../common/index.js";
import i18next from "i18next";

/* ------------------------------------------------- rules and legality */

/**
 * Shared vocabulary and legality checks for Ice Palace.
 *
 * Both structures (the Yard and the Ice Palace) are built on imaginary grids that
 * stretch to infinity, so cells are stored as `"x,y"` keys rather than on a fixed
 * board. `y` is positive upwards, matching `UnboundedSquareBoard.abs2notation`.
 */

/** 1 = small, 2 = medium, 3 = large. */
export type Size = 1 | 2 | 3;

/** Black is Null: it matches no colour, not even itself. */
export const NULL_COLOUR = "B";
/** White is Wild: it matches every colour except Black. */
export const WILD_COLOUR = "W";

/** A colour char followed by a size char, e.g. `"3L"`, `"BS"`, `"WM"`. */
export type PieceId = string;

export const SIZE_CHARS = ["S", "M", "L"] as const;
export type SizeChar = (typeof SIZE_CHARS)[number];

export type Cell = string;
/** Cell key to the pyramids sitting there, ordered bottom to top. */
export type Structure = Map<Cell, PieceId[]>;

export const colourOf = (piece: PieceId): string => piece.substring(0, piece.length - 1);

export const sizeOf = (piece: PieceId): Size => {
    const idx = SIZE_CHARS.indexOf(piece[piece.length - 1] as SizeChar);
    if (idx < 0) {
        throw new Error(`Could not read a pyramid size from "${piece}".`);
    }
    return (idx + 1) as Size;
};

export const makePiece = (colour: string, size: Size): PieceId => `${colour}${SIZE_CHARS[size - 1]}`;

export const cellOf = (x: number, y: number): Cell => `${x},${y}`;

export const coordsOf = (cell: Cell): [number, number] => {
    const parts = cell.split(",");
    return [Number(parts[0]), Number(parts[1])];
};

/** Adjacency is side-by-side only; the four diagonals are not adjacent. */
export const neighbours = (cell: Cell): Cell[] => {
    const [x, y] = coordsOf(cell);
    return [cellOf(x + 1, y), cellOf(x - 1, y), cellOf(x, y + 1), cellOf(x, y - 1)];
};

export const topOf = (struct: Structure, cell: Cell): PieceId | undefined => {
    const stack = struct.get(cell);
    if (stack === undefined || stack.length === 0) {
        return undefined;
    }
    return stack[stack.length - 1];
};

/** Yard matching, where Black is Null and White is Wild. */
export const coloursMatch = (a: string, b: string): boolean => {
    if (a === NULL_COLOUR || b === NULL_COLOUR) {
        return false;
    }
    if (a === WILD_COLOUR || b === WILD_COLOUR) {
        return true;
    }
    return a === b;
};

/** Every empty cell touching the structure. */
export const frontier = (struct: Structure): Cell[] => {
    const cells = new Set<Cell>();
    for (const cell of struct.keys()) {
        for (const n of neighbours(cell)) {
            if (!struct.has(n)) {
                cells.add(n);
            }
        }
    }
    return [...cells];
};

/**
 * The empty cells connected to the infinite outside, computed over the bounding box
 * grown by one ring. Enclosed pockets are excluded: a stack that touches only a pocket
 * cannot be grown away from indefinitely, which the build solver relies on.
 */
export const exteriorCells = (struct: Structure): Set<Cell> => {
    const exterior = new Set<Cell>();
    if (struct.size === 0) {
        return exterior;
    }
    const coords = [...struct.keys()].map(coordsOf);
    const minX = Math.min(...coords.map(c => c[0])) - 1;
    const maxX = Math.max(...coords.map(c => c[0])) + 1;
    const minY = Math.min(...coords.map(c => c[1])) - 1;
    const maxY = Math.max(...coords.map(c => c[1])) + 1;

    const queue: Cell[] = [cellOf(minX, minY)];
    while (queue.length > 0) {
        const cell = queue.pop()!;
        if (exterior.has(cell) || struct.has(cell)) {
            continue;
        }
        const [x, y] = coordsOf(cell);
        if (x < minX || x > maxX || y < minY || y > maxY) {
            continue;
        }
        exterior.add(cell);
        queue.push(...neighbours(cell));
    }
    return exterior;
};

const canFound = (
    struct: Structure,
    piece: PieceId,
    cell: Cell,
    match: (a: string, b: string) => boolean,
): boolean => {
    for (const n of neighbours(cell)) {
        const top = topOf(struct, n);
        if (top !== undefined && match(colourOf(piece), colourOf(top))) {
            return true;
        }
    }
    return false;
};

/**
 * Yard building code: any colour may be added to a stack if it is bigger than the
 * current top pyramid, and a new stack may be started next to any existing stack whose
 * top pyramid matches its colour. The lead may go anywhere.
 */
export const legalYardPlacement = (struct: Structure, piece: PieceId, cell: Cell): boolean => {
    if (struct.size === 0) {
        return true;
    }
    const top = topOf(struct, cell);
    if (top !== undefined) {
        return sizeOf(piece) > sizeOf(top);
    }
    return canFound(struct, piece, cell, coloursMatch);
};

/**
 * Ice Palace building code: the size rule is reversed, and a new stack must exactly match
 * the colour of an adjacent top pyramid. Black and White never reach the Palace, so Wild
 * and Null have no role here. The rules never say how the first pyramid is placed into an
 * empty Palace, so it goes anywhere.
 */
export const legalPalacePlacement = (struct: Structure, piece: PieceId, cell: Cell): boolean => {
    if (struct.size === 0) {
        return true;
    }
    const top = topOf(struct, cell);
    if (top !== undefined) {
        return sizeOf(piece) < sizeOf(top);
    }
    return canFound(struct, piece, cell, (a, b) => a === b);
};

export const placeInto = (struct: Structure, piece: PieceId, cell: Cell): void => {
    const stack = struct.get(cell);
    if (stack === undefined) {
        struct.set(cell, [piece]);
    } else {
        stack.push(piece);
    }
};

export const cloneStructure = (struct: Structure): Structure => {
    const copy: Structure = new Map();
    for (const [cell, stack] of struct.entries()) {
        copy.set(cell, [...stack]);
    }
    return copy;
};

/** Every cell a piece could legally go, for either building code. */
export const legalCellsFor = (
    struct: Structure,
    piece: PieceId,
    legal: (struct: Structure, piece: PieceId, cell: Cell) => boolean,
): Cell[] => {
    if (struct.size === 0) {
        return [cellOf(0, 0)];
    }
    const cells: Cell[] = [];
    for (const cell of struct.keys()) {
        if (legal(struct, piece, cell)) {
            cells.push(cell);
        }
    }
    for (const cell of frontier(struct)) {
        if (legal(struct, piece, cell)) {
            cells.push(cell);
        }
    }
    return cells;
};

/* ------------------------------------------------------ build solver */

/**
 * Works out the maximum number of Yard pyramids that can be built into the Ice Palace.
 *
 * Over the board this number is agreed by the players, because nobody wants to search the
 * possibilities by hand. It is cheap to compute exactly, because of one observation:
 * founding is unbounded. A new stack founded next to a stack of colour `c` is itself
 * topped by `c` and sits on the frontier, so it can be chained outwards forever. Once a
 * colour tops any outward-facing stack, every pyramid of that colour can be placed.
 *
 * So the only question is which colours can be got onto an outward-facing top, and that
 * reduces to a small resource count. A colour is enabled if it already tops such a stack,
 * or if one of its pyramids can be stacked onto an open top strictly larger than it, which
 * spends that top. Every pyramid of an enabled colour, once founded, yields a fresh open
 * top of its own size, so enabled colours holding larges regenerate the scarce resource.
 * Larges can never be stacked onto anything, so a colour whose only Yard pyramids are
 * large is placeable only if it already tops an open stack.
 *
 * The search over (enabled colours, open large tops, open medium tops) is tiny. The plan
 * it produces is then played out against the real building code, and the length of the
 * sequence actually achieved is what gets reported. That direction matters: the number is
 * always one the builder can reach, never an over-estimate that would wedge the build.
 */


export interface Placement {
    piece: PieceId;
    cell: Cell;
}

export interface BuildPlan {
    /** How many Yard pyramids the builder must use. */
    max: number;
    /** One legal way to reach that number, in order. */
    sequence: Placement[];
}

interface ColourCounts {
    S: number;
    M: number;
    L: number;
    total: number;
}

/** Stack a `size` pyramid of `colour` onto an open top of size `consume`, enabling it. */
interface EnableStep {
    colour: string;
    size: Size;
    consume: Size;
}

const tally = (pieces: PieceId[]): Map<string, ColourCounts> => {
    const counts = new Map<string, ColourCounts>();
    for (const piece of pieces) {
        const colour = colourOf(piece);
        let entry = counts.get(colour);
        if (entry === undefined) {
            entry = { S: 0, M: 0, L: 0, total: 0 };
            counts.set(colour, entry);
        }
        const size = sizeOf(piece);
        if (size === 1) {
            entry.S++;
        } else if (size === 2) {
            entry.M++;
        } else {
            entry.L++;
        }
        entry.total++;
    }
    return counts;
};

/** Occupied cells that touch the infinite outside, with the colour and size on top. */
const openTops = (struct: Structure): { cell: Cell; colour: string; size: Size }[] => {
    const exterior = exteriorCells(struct);
    const tops: { cell: Cell; colour: string; size: Size }[] = [];
    for (const cell of struct.keys()) {
        const top = topOf(struct, cell);
        if (top === undefined) {
            continue;
        }
        if (neighbours(cell).some(n => exterior.has(n))) {
            tops.push({ cell, colour: colourOf(top), size: sizeOf(top) });
        }
    }
    return tops;
};

const planEnablements = (
    pending: string[],
    counts: Map<string, ColourCounts>,
    openL: number,
    openM: number,
): { gain: number; steps: EnableStep[] } => {
    const memo = new Map<string, { gain: number; steps: EnableStep[] }>();

    const search = (mask: number, nL: number, nM: number): { gain: number; steps: EnableStep[] } => {
        const key = `${mask},${nL},${nM}`;
        const cached = memo.get(key);
        if (cached !== undefined) {
            return cached;
        }
        let best: { gain: number; steps: EnableStep[] } = { gain: 0, steps: [] };
        for (let i = 0; i < pending.length; i++) {
            if ((mask & (1 << i)) !== 0) {
                continue;
            }
            const colour = pending[i];
            const cc = counts.get(colour)!;
            const options: { size: Size; consume: Size; nL: number; nM: number }[] = [];
            // A medium can only go under a large. The covered cell keeps its outward face,
            // so it becomes an open medium top.
            if (cc.M > 0 && nL >= 1) {
                options.push({ size: 2, consume: 3, nL: nL - 1 + cc.L, nM: nM + cc.M });
            }
            // A small can go under either, and leaves a small top behind, which is spent.
            if (cc.S > 0 && nM >= 1) {
                options.push({ size: 1, consume: 2, nL: nL + cc.L, nM: nM - 1 + cc.M });
            }
            if (cc.S > 0 && nL >= 1) {
                options.push({ size: 1, consume: 3, nL: nL - 1 + cc.L, nM: nM + cc.M });
            }
            for (const option of options) {
                const sub = search(mask | (1 << i), option.nL, option.nM);
                const gain = cc.total + sub.gain;
                if (gain > best.gain) {
                    best = {
                        gain,
                        steps: [{ colour, size: option.size, consume: option.consume }, ...sub.steps],
                    };
                }
            }
        }
        memo.set(key, best);
        return best;
    };

    return search(0, openL, openM);
};

/**
 * An empty cell next to a stack of `colour` that will still touch the outside once filled,
 * so the chain can keep growing from there.
 */
const pickFoundingCell = (struct: Structure, colour: string): Cell | undefined => {
    const exterior = exteriorCells(struct);
    let fallback: Cell | undefined;
    for (const cell of struct.keys()) {
        const top = topOf(struct, cell);
        if (top === undefined || colourOf(top) !== colour) {
            continue;
        }
        for (const n of neighbours(cell)) {
            if (!exterior.has(n)) {
                if (fallback === undefined && !struct.has(n)) {
                    fallback = n;
                }
                continue;
            }
            if (neighbours(n).some(nn => exterior.has(nn))) {
                return n;
            }
            if (fallback === undefined) {
                fallback = n;
            }
        }
    }
    return fallback;
};

const foundAll = (
    struct: Structure,
    remaining: PieceId[],
    sequence: Placement[],
    colour: string,
): void => {
    for (;;) {
        const idx = remaining.findIndex(p => colourOf(p) === colour);
        if (idx < 0) {
            return;
        }
        const cell = pickFoundingCell(struct, colour);
        if (cell === undefined) {
            return;
        }
        const [piece] = remaining.splice(idx, 1);
        placeInto(struct, piece, cell);
        sequence.push({ piece, cell });
    }
};

const enableColour = (
    struct: Structure,
    remaining: PieceId[],
    sequence: Placement[],
    step: EnableStep,
): boolean => {
    const idx = remaining.findIndex(p => colourOf(p) === step.colour && sizeOf(p) === step.size);
    if (idx < 0) {
        return false;
    }
    const exterior = exteriorCells(struct);
    let target: Cell | undefined;
    for (const cell of struct.keys()) {
        const top = topOf(struct, cell);
        if (top === undefined || sizeOf(top) !== step.consume) {
            continue;
        }
        if (neighbours(cell).some(n => exterior.has(n))) {
            target = cell;
            break;
        }
    }
    if (target === undefined) {
        return false;
    }
    const [piece] = remaining.splice(idx, 1);
    placeInto(struct, piece, target);
    sequence.push({ piece, cell: target });
    return true;
};

/**
 * Mops up anything the plan left behind, which is how pyramids of unreachable colours find
 * their way onto enclosed stacks that the resource count deliberately ignores. This can only
 * add placements.
 */
const sweep = (struct: Structure, remaining: PieceId[], sequence: Placement[]): void => {
    let progressed = true;
    while (progressed && remaining.length > 0) {
        progressed = false;
        const order = remaining
            .map((piece, idx) => ({ piece, idx }))
            .sort((a, b) => sizeOf(b.piece) - sizeOf(a.piece));
        for (const { piece, idx } of order) {
            const cells = legalCellsFor(struct, piece, legalPalacePlacement);
            if (cells.length === 0) {
                continue;
            }
            remaining.splice(idx, 1);
            placeInto(struct, piece, cells[0]);
            sequence.push({ piece, cell: cells[0] });
            progressed = true;
            break;
        }
    }
};

const buildOnto = (palace: Structure, pieces: PieceId[]): BuildPlan => {
    const struct = cloneStructure(palace);
    const remaining = [...pieces];
    const sequence: Placement[] = [];

    const counts = tally(pieces);
    const tops = openTops(struct);
    const enabled = new Set(tops.map(t => t.colour));

    let openL = tops.filter(t => t.size === 3).length;
    let openM = tops.filter(t => t.size === 2).length;
    for (const [colour, cc] of counts.entries()) {
        if (enabled.has(colour)) {
            openL += cc.L;
            openM += cc.M;
        }
    }

    for (const colour of enabled) {
        foundAll(struct, remaining, sequence, colour);
    }

    const pending = [...counts.keys()].filter(c => !enabled.has(c));
    const plan = planEnablements(pending, counts, openL, openM);
    for (const step of plan.steps) {
        if (!enableColour(struct, remaining, sequence, step)) {
            break;
        }
        foundAll(struct, remaining, sequence, step.colour);
    }

    sweep(struct, remaining, sequence);
    return { max: sequence.length, sequence };
};

/**
 * The most pyramids the builder can work into the Palace, with one sequence that gets there.
 * `pieces` should already have had Black and White discarded.
 */
export const maximumBuild = (palace: Structure, pieces: PieceId[]): BuildPlan => {
    if (pieces.length === 0) {
        return { max: 0, sequence: [] };
    }
    if (palace.size > 0) {
        return buildOnto(palace, pieces);
    }

    // An empty Palace takes its first pyramid anywhere, and which one it is matters a great
    // deal, so try each distinct choice.
    let best: BuildPlan = { max: 0, sequence: [] };
    const origin = cellOf(0, 0);
    for (const seed of new Set(pieces)) {
        const struct: Structure = new Map([[origin, [seed]]]);
        const rest = [...pieces];
        rest.splice(rest.indexOf(seed), 1);
        const sub = buildOnto(struct, rest);
        if (sub.max + 1 > best.max) {
            best = {
                max: sub.max + 1,
                sequence: [{ piece: seed, cell: origin }, ...sub.sequence],
            };
        }
    }
    return best;
};

/** A hand is being played into the Yard, or its winner is building the Palace. */
export type Phase = "hand" | "build";

/** Empty cells kept around each structure, so there is somewhere to click when founding. */
const PADDING = 1;
/** Empty columns separating the Palace from the Yard when both are on the board. */
const GAP = 2;
/**
 * Each structure's region always covers at least the cells within this reach of the origin,
 * where the first pyramid goes. stacking-3D refits its perspective to the board size, so a
 * board that changed shape after every placement would lurch each turn; this lets a structure
 * grow in any direction for a while before the board has to change, and beyond that the
 * board grows only in the direction the structure did. A reach of 2 is a 5-cell span, or
 * 7 with padding. Set to 0 for a board that hugs the structures exactly.
 */
const MIN_REACH = 2;
/**
 * How far each array index rises above the last, as a fraction of the cell. It must stay at
 * the renderer's default, because `stackColumn` relies on one index being exactly one glyph
 * step: the `-3D` pyramids are drawn with a small's base at the cell centre, a medium's one
 * step lower and a large's two lower.
 */
const STACK_OFFSET = 0.15;

/** Where one structure sits on the shared board. */
interface IRegion {
    which: "palace" | "yard";
    col0: number;
    minX: number;
    minY: number;
    cols: number;
    rows: number;
}

interface ILayout {
    regions: IRegion[];
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
        flags: ["experimental", "scores", "autopass"],
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

    /** One legal way to build the whole Yard in, as a single compound move. */
    private suggestedBuild(): string {
        return maximumBuild(this.palace, this.stock)
            .sequence.map(p => `${p.piece}@${p.cell}`)
            .join(";");
    }

    /**
     * Hands are enumerated in full. That is what lets the front auto-pass a player with no
     * legal placement, and what puts a Pass button in front of everyone else, since both are
     * driven off this list.
     *
     * Builds are deliberately not enumerated. The number of legal orderings and positions is
     * astronomical, and putting a single worked build in the move dropdown would read as
     * though it were the only legal arrangement, when choosing the arrangement is the entire
     * point of the phase. So a build offers nothing to pick from unless nothing can be placed
     * at all, and is entered by clicking instead. `randomMove` still returns a real build.
     */
    public moves(player?: number): string[] {
        if (this.gameover) {
            return [];
        }
        if (this.phase === "build") {
            return this.buildMin === 0 ? ["pass"] : [];
        }
        const moves = this.yardPlacements(player ?? this.currplayer);
        if (!this.isLead()) {
            moves.push("pass");
        }
        return moves;
    }

    /** Builds are not enumerated, so hand one over rather than sampling an empty list. */
    public randomMove(): string {
        if (!this.gameover && this.phase === "build") {
            return this.buildMin === 0 ? "pass" : this.suggestedBuild();
        }
        return super.randomMove();
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
        if (!move.includes("@")) {
            // A bare pyramid: picked from the hand, not yet placed.
            if (!this.handOf(this.currplayer).includes(move)) {
                result.message = i18next.t("apgames:validation.icepalace.NOT_IN_HAND", { piece: move });
                return result;
            }
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.icepalace.PARTIAL_PIECE", { piece: move });
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
        const tokens = move.split(";");
        // A trailing bare pyramid is one picked from the stock but not yet placed.
        const pending = tokens[tokens.length - 1].includes("@") ? undefined : tokens.pop();
        for (const token of tokens) {
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
        if (pending !== undefined) {
            if (!stock.includes(pending)) {
                result.message = i18next.t("apgames:validation.icepalace.NOT_IN_STOCK", { piece: pending });
                return result;
            }
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.icepalace.PARTIAL_PIECE", { piece: pending });
            return result;
        }

        const placed = tokens.length;
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
            const parsed = IcePalaceGame.parsePlacement(move);
            if (parsed === undefined) {
                // A bare pyramid, picked but not yet placed: nothing to apply.
                return;
            }
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

    public sidebarScores(): IScores[] {
        const scores: number[] = [];
        for (let p = 1; p <= this.numplayers; p++) {
            scores.push(this.getPlayerScore(p));
        }
        return [{ name: this.neutralAreaLabel("apgames:status.SCORES"), scores }];
    }

    /** Every hand, drawn as pyramids, plus the Pool and what the builder still has to use. */
    public sidebarStatuses(): IStatus[] {
        const statuses: IStatus[] = [];
        for (let p = 1; p <= this.numplayers; p++) {
            statuses.push({
                key: this.seatStatusValue(p),
                value: this.hands[p - 1].map(piece => this.glyphFor(piece)),
            });
        }
        statuses.push({
            key: this.neutralAreaLabel("apgames:status.icepalace.POOL"),
            value: [this.pool.length.toString()],
        });
        if (this.phase === "build") {
            statuses.push({
                key: this.neutralAreaLabel("apgames:status.icepalace.MUST_USE"),
                value: [`${this.buildMin} / ${this.stock.length}`],
            });
        }
        return statuses;
    }

    /* --------------------------------------------------------------- rendering */

    /**
     * Legend keys double as SVG element ids, and an id that starts with a digit is not a
     * valid selector in a real browser, so the pyramid id gets a letter in front.
     */
    private static legendKey(piece: PieceId): string {
        return `p${piece}`;
    }

    /**
     * Lays a stack out the way Volcano does: each pyramid sits one index above the last, and
     * "-" placeholders, which the renderer skips but still counts, are spent only to stop a
     * piece's base sinking below the ground. A small's base is on the ground at index 0, a
     * medium's at index 1 and a large's at index 2, so a lone large is `["-", "-", large]`
     * and a tower of large, medium, small is `["-", "-", large, medium, small]`.
     */
    private static stackColumn(stack: PieceId[]): string[] {
        const column: string[] = [];
        for (const piece of stack) {
            const ground = sizeOf(piece) - 1;
            while (column.length < ground) {
                column.push("-");
            }
            column.push(IcePalaceGame.legendKey(piece));
        }
        return column;
    }

    private glyphFor(piece: PieceId): Glyph {
        const name = `pyramid-up-${SIZE_NAMES[sizeOf(piece) - 1]}-3D`;
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
            const picked = piece === undefined ? undefined : /^P?([1-6BW][SML])$/.exec(piece.toUpperCase());
            if (picked !== null && picked !== undefined) {
                // The pieces area hands back the legend key, which names the pyramid.
                newmove = this.appendToken(current, picked[1]);
            } else {
                // Anything else is a board click: an empty cell, or a pyramid already in a
                // stack there, which arrives with its stack index in `piece`.
                const cell = this.cellAt(row, col);
                if (cell === undefined) {
                    result.move = current;
                    result.message = i18next.t("apgames:validation.icepalace.OFF_STRUCTURE");
                    return result;
                }
                newmove = this.appendToken(current, `@${cell}`);
            }
            const validated = this.validateMove(newmove);
            if (!validated.valid) {
                result.move = current;
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
     * One perspective board holds both structures: the Palace on the left and, while a hand
     * is being played, the Yard to its right. During the build the Yard has already been
     * taken up into the stock, which is offered in the pieces area instead. The pieces area
     * is where the current player picks a pyramid from; every hand is also listed in the
     * status panel.
     */
    public render(opts?: IRenderOpts): APRenderRep {
        void opts;
        const layout = this.layout();
        const legend: { [k: string]: Glyph } = {};
        const pieces: string[][][] = [];
        for (let row = 0; row < layout.height; row++) {
            const line: string[][] = [];
            for (let col = 0; col < layout.width; col++) {
                line.push([]);
            }
            pieces.push(line);
        }
        for (const region of layout.regions) {
            const struct = region.which === "palace" ? this.palace : this.yard;
            for (const [cell, stack] of struct.entries()) {
                const [x, y] = coordsOf(cell);
                const col = region.col0 + (x - region.minX);
                const row = layout.height - 1 - (y - region.minY);
                for (const piece of stack) {
                    const key = IcePalaceGame.legendKey(piece);
                    if (!(key in legend)) {
                        legend[key] = this.glyphFor(piece);
                    }
                }
                pieces[row][col] = IcePalaceGame.stackColumn(stack);
            }
        }

        const offered = this.phase === "build" ? this.stock : this.handOf(this.currplayer);
        for (const piece of offered) {
            const key = IcePalaceGame.legendKey(piece);
            if (!(key in legend)) {
                legend[key] = this.glyphFor(piece);
            }
        }
        const areas: AreaPieces[] = [];
        if (offered.length > 0) {
            areas.push({
                type: "pieces",
                pieces: offered.map(piece => IcePalaceGame.legendKey(piece)) as [string, ...string[]],
                // i18next.t("apgames:icepalace.STOCK")
                // i18next.t("apgames:icepalace.HAND")
                label: this.phase === "build"
                    ? this.neutralAreaLabel("apgames:icepalace.STOCK")
                    : this.seatAreaLabel(this.currplayer, "apgames:icepalace.HAND"),
                ownerMark: this.currplayer,
            });
        }

        const rep: APRenderRep = {
            renderer: "stacking-3D",
            options: ["hide-labels"],
            board: {
                style: "squares",
                width: layout.width,
                height: layout.height,
                stackOffset: STACK_OFFSET,
            },
            legend,
            pieces: pieces as [string[][], ...string[][][]],
            areas: areas.length > 0 ? areas : undefined,
        };
        return rep;
    }

    /**
     * The Yard is on the board while a hand is being played; the Palace whenever it holds
     * anything, and always during the build. Each region covers its structure and the
     * minimum box around the origin, padded by a ring of empty cells to click into.
     */
    private layout(): ILayout {
        const shown: ("palace" | "yard")[] = [];
        if (this.phase === "build" || this.palace.size > 0) {
            shown.push("palace");
        }
        if (this.phase === "hand") {
            shown.push("yard");
        }

        const regions: IRegion[] = [];
        let col0 = 0;
        let height = 0;
        for (const which of shown) {
            const struct = which === "palace" ? this.palace : this.yard;
            const coords = [...struct.keys()].map(coordsOf);
            const minX = Math.min(-MIN_REACH, ...coords.map(c => c[0])) - PADDING;
            const maxX = Math.max(MIN_REACH, ...coords.map(c => c[0])) + PADDING;
            const minY = Math.min(-MIN_REACH, ...coords.map(c => c[1])) - PADDING;
            const maxY = Math.max(MIN_REACH, ...coords.map(c => c[1])) + PADDING;
            const region: IRegion = { which, col0, minX, minY, cols: maxX - minX + 1, rows: maxY - minY + 1 };
            regions.push(region);
            col0 += region.cols + GAP;
            height = Math.max(height, region.rows);
        }
        return { regions, width: col0 - GAP, height };
    }

    /**
     * Which cell a board click landed on. Only the structure being built into this phase
     * takes placements, so a click on the other one, or in the gap, is undefined.
     */
    private cellAt(row: number, col: number): Cell | undefined {
        const layout = this.layout();
        const active = this.phase === "build" ? "palace" : "yard";
        for (const region of layout.regions) {
            if (col < region.col0 || col >= region.col0 + region.cols) {
                continue;
            }
            if (region.which !== active) {
                return undefined;
            }
            // The lead goes in the middle: a click anywhere in an empty region is the origin.
            if ((active === "palace" ? this.palace : this.yard).size === 0) {
                return cellOf(0, 0);
            }
            return cellOf(
                region.minX + (col - region.col0),
                region.minY + (layout.height - 1 - row),
            );
        }
        return undefined;
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
