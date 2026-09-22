import { GameBase, IAPGameState, IClickResult, ICustomButton, IIndividualState, IStatus, IValidationResult, type ChatLogCollectContext, type ChatLogLine } from "./_base.js";
import type { APGamesInformation } from "../schemas/gameinfo.js";
import type { APRenderRep, RowCol } from "@abstractplay/renderer/build/schemas/schema";
import type { APMoveResult } from "../schemas/moveresults.js";
import { algebraic2coords, coords2algebraic, reviver, UserFacingError } from "../common/index.js";
import i18next from "i18next";

/**
 * Kill-All Go.
 *
 * Board colours: RED (1) is the Attacker, who starts with stones on the board and must kill
 * everything; BLUE (2) is the Defender, who wins by making one string that can never be captured.
 * Seats are not colours: `redSeat` records which seat plays Red once the opening protocol has
 * decided it. User-facing strings say "Attacker" and "Defender", never a colour.
 */
export type playerid = 1 | 2;

// ---------------------------------------------------------------------------
// Board helpers
// ---------------------------------------------------------------------------

export type Stone = 1 | 2;
export const RED: Stone = 1;
export const BLUE: Stone = 2;

export type Board = Map<string, Stone>;

export interface Geometry {
    size: number;
    /** All cells, row by row from the top of the board. */
    cells: string[];
    neighbours: Map<string, string[]>;
    coords2algebraic: (x: number, y: number) => string;
    algebraic2coords: (cell: string) => [number, number];
}

export interface StringInfo {
    stones: string[];
    liberties: Set<string>;
}

export interface PlacementOutcome {
    /** Each captured opponent string, in the order they were removed. */
    captured: string[][];
    /** The mover's own stones removed by suicide (Tromp-Taylor clearing), if any. */
    suicided: string[];
}

const geometryCache = new Map<number, Geometry>();

export const makeGeometry = (size: number): Geometry => {
    const cached = geometryCache.get(size);
    if (cached !== undefined) {
        return cached;
    }
    const c2a = (x: number, y: number): string => coords2algebraic(x, y, size);
    const a2c = (cell: string): [number, number] => algebraic2coords(cell, size);
    const cells: string[] = [];
    const neighbours = new Map<string, string[]>();
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const cell = c2a(x, y);
            cells.push(cell);
            const adj: string[] = [];
            if (x > 0) { adj.push(c2a(x - 1, y)); }
            if (x < size - 1) { adj.push(c2a(x + 1, y)); }
            if (y > 0) { adj.push(c2a(x, y - 1)); }
            if (y < size - 1) { adj.push(c2a(x, y + 1)); }
            neighbours.set(cell, adj);
        }
    }
    const geo: Geometry = { size, cells, neighbours, coords2algebraic: c2a, algebraic2coords: a2c };
    geometryCache.set(size, geo);
    return geo;
};

export const otherColour = (colour: Stone): Stone => (colour === RED ? BLUE : RED);

/** The string containing `cell` (which must hold a stone) and its liberties. */
export const stringAt = (board: Board, geo: Geometry, cell: string): StringInfo => {
    const colour = board.get(cell);
    if (colour === undefined) {
        throw new Error(`No stone at ${cell}.`);
    }
    const stones: string[] = [];
    const liberties = new Set<string>();
    const seen = new Set<string>([cell]);
    const todo = [cell];
    while (todo.length > 0) {
        const cur = todo.pop()!;
        stones.push(cur);
        for (const n of geo.neighbours.get(cur)!) {
            const occupant = board.get(n);
            if (occupant === undefined) {
                liberties.add(n);
            } else if (occupant === colour && !seen.has(n)) {
                seen.add(n);
                todo.push(n);
            }
        }
    }
    return { stones, liberties };
};

/**
 * Place a stone and apply Tromp-Taylor clearing: opponent strings left without liberties are
 * removed first, then the mover's own string if it has none (multi-stone suicide is legal;
 * a single-stone suicide is left to the superko check, which always rejects it).
 * Mutates `board`.
 */
export const applyPlacement = (board: Board, geo: Geometry, cell: string, colour: Stone): PlacementOutcome => {
    if (board.has(cell)) {
        throw new Error(`Cell ${cell} is occupied.`);
    }
    board.set(cell, colour);
    const opp = otherColour(colour);
    const captured: string[][] = [];
    const removed = new Set<string>();
    for (const n of geo.neighbours.get(cell)!) {
        if (board.get(n) !== opp || removed.has(n)) {
            continue;
        }
        const info = stringAt(board, geo, n);
        if (info.liberties.size === 0) {
            for (const s of info.stones) {
                board.delete(s);
                removed.add(s);
            }
            captured.push(info.stones);
        }
    }
    let suicided: string[] = [];
    const own = stringAt(board, geo, cell);
    if (own.liberties.size === 0) {
        for (const s of own.stones) {
            board.delete(s);
        }
        suicided = own.stones;
    }
    return { captured, suicided };
};

/** Canonical string for a board position (used for positional superko). */
export const signature = (board: Board, geo: Geometry): string => {
    let sig = "";
    for (const cell of geo.cells) {
        const s = board.get(cell);
        sig += s === undefined ? "-" : s === RED ? "r" : "b";
    }
    return sig;
};

// ---------------------------------------------------------------------------
// Benson's algorithm for unconditional life ("pass-alive" strings)
// ---------------------------------------------------------------------------

/**
 * Benson's algorithm for unconditional life ("pass-alive" strings).
 *
 * A chain of the given colour is pass-alive when it belongs to a set X of chains such that every
 * chain in X has at least two vital regions enclosed by X. A region is a maximal connected set
 * of points not holding the colour; it is vital to a chain when every point of the region that
 * could ever become empty is adjacent to the chain.
 *
 * With classic (no-suicide) rules only the empty points of a region need to touch the chain.
 * When multi-stone suicide is legal (Tromp-Taylor), the opponent can clear its own stones out of a
 * region and refill it leaving a hole that is not a liberty of the chain, so every point of the
 * region, occupied or not, must touch the chain. `suicideAllowed` selects the strict test.
 */

export interface PassAliveOptions {
    suicideAllowed?: boolean;
}

interface Region {
    points: string[];
    adjacentChains: Set<number>;
    vitalTo: Set<number>;
}

/** Returns every pass-alive chain of `colour`, each as its list of stones. */
export const passAliveStrings = (board: Board, geo: Geometry, colour: Stone, opts: PassAliveOptions = {}): string[][] => {
    const suicideAllowed = opts.suicideAllowed ?? true;

    // Chains of `colour`.
    const chainOf = new Map<string, number>();
    const chains: string[][] = [];
    for (const cell of geo.cells) {
        if (board.get(cell) !== colour || chainOf.has(cell)) {
            continue;
        }
        const id = chains.length;
        const stones: string[] = [];
        const todo = [cell];
        chainOf.set(cell, id);
        while (todo.length > 0) {
            const cur = todo.pop()!;
            stones.push(cur);
            for (const n of geo.neighbours.get(cur)!) {
                if (board.get(n) === colour && !chainOf.has(n)) {
                    chainOf.set(n, id);
                    todo.push(n);
                }
            }
        }
        chains.push(stones);
    }
    if (chains.length === 0) {
        return [];
    }

    // Regions: maximal connected sets of points not holding `colour`.
    const regionOf = new Map<string, number>();
    const regions: Region[] = [];
    for (const cell of geo.cells) {
        if (board.get(cell) === colour || regionOf.has(cell)) {
            continue;
        }
        const id = regions.length;
        const points: string[] = [];
        const todo = [cell];
        regionOf.set(cell, id);
        while (todo.length > 0) {
            const cur = todo.pop()!;
            points.push(cur);
            for (const n of geo.neighbours.get(cur)!) {
                if (board.get(n) !== colour && !regionOf.has(n)) {
                    regionOf.set(n, id);
                    todo.push(n);
                }
            }
        }
        regions.push({ points, adjacentChains: new Set(), vitalTo: new Set() });
    }

    // Which chains touch each region, and to which chains the region is vital.
    for (const region of regions) {
        const touches = new Map<number, number>();
        let mustTouch = 0;
        for (const p of region.points) {
            const counts = suicideAllowed || !board.has(p);
            if (counts) {
                mustTouch++;
            }
            const seenHere = new Set<number>();
            for (const n of geo.neighbours.get(p)!) {
                const chain = chainOf.get(n);
                if (chain === undefined || seenHere.has(chain)) {
                    continue;
                }
                seenHere.add(chain);
                region.adjacentChains.add(chain);
                if (counts) {
                    touches.set(chain, (touches.get(chain) ?? 0) + 1);
                }
            }
        }
        for (const [chain, n] of touches) {
            if (n === mustTouch) {
                region.vitalTo.add(chain);
            }
        }
    }

    // Benson iteration.
    const X = new Set<number>(chains.map((_, i) => i));
    const R = new Set<number>(regions.map((_, i) => i));
    let changed = true;
    while (changed) {
        changed = false;
        for (const chain of [...X]) {
            let vital = 0;
            for (const rid of R) {
                if (regions[rid].vitalTo.has(chain)) {
                    vital++;
                }
            }
            if (vital < 2) {
                X.delete(chain);
                changed = true;
            }
        }
        for (const rid of [...R]) {
            for (const chain of regions[rid].adjacentChains) {
                if (!X.has(chain)) {
                    R.delete(rid);
                    changed = true;
                    break;
                }
            }
        }
    }
    return chains.filter((_, i) => X.has(i));
};

// ---------------------------------------------------------------------------
// The game
// ---------------------------------------------------------------------------

type Opening = "alt" | "handicap" | "classic" | "pie" | "hoctaph";

type Phase =
    | "hand-n"        // handicap opening: Player 1 types the number of handicap stones
    | "alt-place"     // alternating placement of Red stones until someone takes Red
    | "pie-slice"     // simple pie: Player 1 places any number of Red stones
    | "pie-choose"    // simple pie: Player 2 chooses a side
    | "hoc-slice"     // Hoctaph: Player 1 types the two batch sizes
    | "hoc-option"    // Hoctaph: Player 2 chooses who places the first batch
    | "hoc-batch-a"   // Hoctaph: Player 1 places the first batch (Player 2 chose "youplace")
    | "hoc-choose"    // Hoctaph: the other player chooses a side
    | "hoc-batch-b"   // Hoctaph: Red places the second batch (the chooser took Blue)
    | "play"          // normal alternation, Blue always moved first
    | "refute";       // Red must answer a pending life claim

interface ISetup {
    a?: number;
    b?: number;
    batchSize?: number;
    handicap?: number;
}

interface IClaim {
    stone: string;
    stones: string[];
    marks: string[];
}

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Board;
    lastmove?: string;
    phase: Phase;
    redSeat?: playerid;
    setup?: ISetup;
    claim?: IClaim;
    /** Board signatures of the intermediate positions inside this ply (positional superko). */
    interim: string[];
    /** Stones of the strings judged alive when the Defender won. */
    alive?: string[];
}

export interface IKillAllGoState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
}

// The traditional 17-stone starting position (Sensei's Library, "The Killing Game"), 19x19 only.
const CLASSIC_SETUP = ["j18", "c17", "q17", "d16", "j16", "p16", "b10", "d10", "j10", "p10", "r10", "d4", "j4", "p4", "c3", "q3", "j2"];
const UNDECIDED_COLOUR = "#999999";
const CELL_RE = /^[a-z]+\d+$/;

export class KillAllGoGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Kill-All Go",
        uid: "killallgo",
        playercounts: [2],
        version: "20260921",
        dateAdded: "2026-09-21",
        // i18next.t("apgames:descriptions.killallgo")
        description: "apgames:descriptions.killallgo",
        // i18next.t("apgames:notes.killallgo")
        notes: "apgames:notes.killallgo",
        urls: [
            "https://senseis.xmp.net/?KillAllGame",
            "https://senseis.xmp.net/?ShapeGame",
        ],
        people: [
            {
                type: "designer",
                name: "Traditional",
            },
            {
                type: "coder",
                name: "Samraku",
                urls: [],
                apid: "6ea91933-1262-41a5-b5f3-a6af70692296",
            },
        ],
        variants: [
            { uid: "size-9", group: "board" },
            { uid: "size-13", group: "board" },
            { uid: "#board" },
            { uid: "#opening" },
            { uid: "handicap", group: "opening", fans: true },
            { uid: "classic", group: "opening", enabledWhen: { board: ["#board"] } },
            { uid: "pie", group: "opening", fans: true },
            {
                uid: "hoctaph",
                group: "opening",
                fans: true,
                people: [
                    {
                        type: "designer",
                        name: "Hoctaph",
                        urls: ["https://forums.online-go.com/t/kill-all-go/27365/70"],
                    },
                    {
                        type: "designer",
                        name: "Samraku",
                        urls: [],
                        apid: "6ea91933-1262-41a5-b5f3-a6af70692296",
                    },
                ],
            },
        ],
        categories: ["goal>annihilate", "mechanic>place", "mechanic>capture", "mechanic>enclose", "mechanic>asymmetry", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["experimental", "custom-colours", "custom-buttons"],
        customizations: [
            {
                num: 1,
                default: 1,
                explanation: "Colour of the Attacker's stones",
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
    public phase!: Phase;
    public redSeat?: playerid;
    public setup?: ISetup;
    public claim?: IClaim;
    public interim: string[] = [];
    public alive?: string[];
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private boardSize = 19;
    private geo!: Geometry;

    constructor(state?: IKillAllGoState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined && variants.length > 0) {
                this.variants = this.applyVariantConstraints(variants);
            }
            const size = KillAllGoGame.sizeFromVariants(this.variants);
            const opening = KillAllGoGame.openingFromVariants(this.variants);
            const board: Board = new Map();
            let phase: Phase = "alt-place";
            let redSeat: playerid | undefined;
            if (opening === "classic" && size === 19) {
                for (const cell of CLASSIC_SETUP) {
                    board.set(cell, RED);
                }
                phase = "play";
                redSeat = 2;
            } else if (opening === "handicap") {
                phase = "hand-n";
            } else if (opening === "pie") {
                phase = "pie-slice";
            } else if (opening === "hoctaph") {
                phase = "hoc-slice";
            }
            const fresh: IMoveState = {
                _version: KillAllGoGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                phase,
                redSeat,
                interim: [],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                if (!state.startsWith("{") && !state.startsWith("[")) {
                    throw new Error("Compressed game state must be decompressed before constructing the engine.");
                }
                state = JSON.parse(state, reviver) as IKillAllGoState;
            }
            if (state.game !== KillAllGoGame.gameinfo.uid) {
                throw new Error(`The Kill-All Go engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): KillAllGoGame {
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
        this.phase = state.phase;
        this.redSeat = state.redSeat;
        this.setup = state.setup === undefined ? undefined : { ...state.setup };
        this.claim = state.claim === undefined ? undefined : { stone: state.claim.stone, stones: [...state.claim.stones], marks: [...state.claim.marks] };
        this.interim = [...state.interim];
        this.alive = state.alive === undefined ? undefined : [...state.alive];
        this.boardSize = KillAllGoGame.sizeFromVariants(this.variants);
        this.geo = makeGeometry(this.boardSize);
        return this;
    }

    private static sizeFromVariants(variants: string[]): number {
        if (variants.includes("size-9")) { return 9; }
        if (variants.includes("size-13")) { return 13; }
        return 19;
    }

    private static openingFromVariants(variants: string[]): Opening {
        for (const uid of ["handicap", "classic", "pie", "hoctaph"] as const) {
            if (variants.includes(uid)) {
                return uid;
            }
        }
        return "alt";
    }

    private get opening(): Opening {
        return KillAllGoGame.openingFromVariants(this.variants);
    }

    public coords2algebraic(x: number, y: number): string {
        return this.geo.coords2algebraic(x, y);
    }

    public algebraic2coords(cell: string): [number, number] {
        return this.geo.algebraic2coords(cell);
    }

    private otherSeat(seat: playerid): playerid {
        return seat === 1 ? 2 : 1;
    }

    private blueSeat(): playerid | undefined {
        return this.redSeat === undefined ? undefined : this.otherSeat(this.redSeat);
    }

    private colourOfSeat(seat: playerid): Stone | undefined {
        if (this.redSeat === undefined) {
            return undefined;
        }
        return seat === this.redSeat ? RED : BLUE;
    }

    private get points(): number {
        return this.boardSize * this.boardSize;
    }

    private maxHandicap(): number {
        return Math.floor(this.points / 2);
    }

    private isValidCell(cell: string): boolean {
        if (!CELL_RE.test(cell)) {
            return false;
        }
        try {
            const [x, y] = this.geo.algebraic2coords(cell);
            return x >= 0 && y >= 0 && x < this.boardSize && y < this.boardSize;
        } catch {
            return false;
        }
    }

    /** Signatures of every position reached before the current ply (positional superko). */
    private positions(): Set<string> {
        const seen = new Set<string>();
        for (const state of this.stack) {
            seen.add(signature(state.board, this.geo));
            for (const sig of state.interim) {
                seen.add(sig);
            }
        }
        return seen;
    }

    /** Result of placing `colour` at `cell` on a copy of `board`, or undefined when the position would repeat. */
    private simulate(board: Board, cell: string, colour: Stone, seen: Set<string>): { board: Board; sig: string } | undefined {
        const copy = new Map(board);
        applyPlacement(copy, this.geo, cell, colour);
        const sig = signature(copy, this.geo);
        if (seen.has(sig)) {
            return undefined;
        }
        return { board: copy, sig };
    }

    private bluePassAlive(board: Board = this.board): string[][] {
        return passAliveStrings(board, this.geo, BLUE, { suicideAllowed: true });
    }

    private parseCells(list: string): string[] {
        return list.length === 0 ? [] : list.split(",");
    }

    /** Whether `moves()` lists every legal move of this shape in the current phase (used by the failsafe). */
    private isEnumerable(m: string): boolean {
        if (this.phase === "hoc-slice" || this.phase === "hoc-batch-a" || this.phase === "hoc-batch-b" || this.phase === "refute") {
            return false;
        }
        return /^([a-z]+\d+|\d+|pass|attacker|defender|youplace|defender:[a-z]+\d+)$/.test(m);
    }

    public moves(): string[] {
        if (this.gameover) { return []; }
        const moves: string[] = [];
        const seen = this.positions();
        switch (this.phase) {
            case "hand-n":
                for (let n = 1; n <= this.maxHandicap(); n++) {
                    moves.push(n.toString());
                }
                break;
            case "alt-place":
                for (const cell of this.geo.cells) {
                    if (!this.board.has(cell)) {
                        moves.push(cell);
                    }
                }
                if (this.handicapOwed() === 0) {
                    moves.push("attacker");
                }
                break;
            case "pie-slice":
                moves.push("pass");
                for (const cell of this.geo.cells) {
                    if (!this.board.has(cell)) {
                        moves.push(cell);
                    }
                }
                break;
            case "pie-choose":
                moves.push("attacker");
                for (const cell of this.geo.cells) {
                    if (!this.board.has(cell) && this.simulate(this.board, cell, BLUE, seen) !== undefined) {
                        moves.push(`defender:${cell}`);
                    }
                }
                break;
            case "hoc-option":
                moves.push("youplace");
                break;
            case "hoc-batch-a":
            case "hoc-batch-b":
                if (this.setup?.batchSize === 1) {
                    for (const cell of this.geo.cells) {
                        if (!this.board.has(cell)) {
                            moves.push(cell);
                        }
                    }
                }
                break;
            case "hoc-choose":
                moves.push("defender");
                break;
            case "play": {
                moves.push("pass");
                const colour = this.colourOfSeat(this.currplayer)!;
                for (const cell of this.geo.cells) {
                    if (!this.board.has(cell) && this.simulate(this.board, cell, colour, seen) !== undefined) {
                        moves.push(cell);
                    }
                }
                break;
            }
            case "refute": {
                // Every legal placement is a complete ply on its own: it either captures the
                // claimed string, lands on a protected point, or gives the claim up.
                for (const cell of this.geo.cells) {
                    if (this.board.has(cell)) { continue; }
                    if (this.simulate(this.board, cell, RED, seen) === undefined) { continue; }
                    moves.push(cell);
                }
                break;
            }
            default:
                // Typed numbers and multi-stone batches are not enumerable.
                break;
        }
        return moves;
    }

    /** Stones the current player must add when taking the Attacker side right now. */
    private handicapOwed(): number {
        if (this.phase === "alt-place" && this.opening === "handicap" && this.currplayer === 2) {
            return this.setup?.handicap ?? 0;
        }
        if (this.phase === "hoc-choose") {
            return this.setup?.b ?? 0;
        }
        return 0;
    }

    /**
     * Fixed choices are offered as buttons; everything else is built by clicking the board.
     * Taking the Attacker side while handicap or batch stones are owed leaves an incomplete
     * move in the box, which the following board clicks finish.
     */
    public getButtons(): ICustomButton[] {
        if (this.gameover) {
            return [];
        }
        switch (this.phase) {
            case "alt-place":
            case "pie-choose":
                return [{ label: "killallgo.attacker", move: "attacker" }];
            case "hoc-option":
                return [{ label: "killallgo.youplace", move: "youplace" }];
            case "hoc-choose":
                return [{ label: "killallgo.defender", move: "defender" }];
            case "pie-slice":
            case "play":
                return [{ label: "pass", move: "pass" }];
            default:
                return [];
        }
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            const newmove = this.clickCell(move, cell);
            if (newmove === undefined) {
                return {
                    move,
                    valid: false,
                    message: i18next.t("apgames:validation.killallgo.NO_CLICKS_NOW"),
                };
            }
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

    /** Extend `move` with a click on `cell`, or return undefined when board clicks mean nothing now. */
    private clickCell(move: string, cell: string): string | undefined {
        const toggle = (list: string): string => {
            const cells = this.parseCells(list);
            const next = cells.includes(cell) ? cells.filter((c) => c !== cell) : [...cells, cell];
            return next.join(",");
        };
        switch (this.phase) {
            case "hand-n":
            case "hoc-slice":
                return undefined;
            case "alt-place":
                if (move.startsWith("attacker")) {
                    return `attacker:${toggle(move.substring("attacker:".length))}`;
                }
                return cell;
            case "pie-slice":
            case "hoc-batch-a":
            case "hoc-batch-b":
                return toggle(move === "pass" ? "" : move);
            case "pie-choose":
                return `defender:${cell}`;
            case "hoc-option":
                if (move === "youplace") {
                    return move;
                }
                return `iplace:${toggle(move.startsWith("iplace:") ? move.substring("iplace:".length) : "")}`;
            case "hoc-choose":
                if (move === "defender") {
                    return move;
                }
                return `attacker:${toggle(move.startsWith("attacker:") ? move.substring("attacker:".length) : "")}`;
            case "play": {
                if (move.startsWith("claim:")) {
                    const [stone, marks] = this.parseClaim(move);
                    if (cell === stone) {
                        return "";
                    }
                    const next = marks.includes(cell) ? marks.filter((c) => c !== cell) : [...marks, cell];
                    return next.length === 0 ? `claim:${stone}` : `claim:${stone}:${next.join(",")}`;
                }
                if (this.board.get(cell) === BLUE && this.colourOfSeat(this.currplayer) === BLUE) {
                    return `claim:${cell}`;
                }
                return cell;
            }
            case "refute":
                return move.length === 0 ? cell : `${move},${cell}`;
        }
    }

    private parseClaim(m: string): [string, string[]] {
        const parts = m.split(":");
        const stone = parts[1] ?? "";
        const marks = parts.length > 2 ? this.parseCells(parts[2]) : [];
        return [stone, marks];
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = { valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER") };
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (this.gameover) {
            result.message = i18next.t("apgames:MOVES_GAMEOVER");
            return result;
        }
        switch (this.phase) {
            case "hand-n":
                return this.validateHandicap(m, result);
            case "alt-place":
                return this.validateAltPlace(m, result);
            case "pie-slice":
                return this.validatePieSlice(m, result);
            case "pie-choose":
                return this.validatePieChoose(m, result);
            case "hoc-slice":
                return this.validateSlice(m, result);
            case "hoc-option":
                return this.validateHocOption(m, result);
            case "hoc-batch-a":
            case "hoc-batch-b":
                return this.validateHocBatch(m, result);
            case "hoc-choose":
                return this.validateHocChoose(m, result);
            case "play":
                return this.validatePlay(m, result);
            case "refute":
                return this.validateRefute(m, result);
        }
    }

    private ok(result: IValidationResult, complete: -1 | 0 | 1, message: string, canrender = false): IValidationResult {
        result.valid = true;
        result.complete = complete;
        result.canrender = canrender;
        result.message = message;
        return result;
    }

    private fail(result: IValidationResult, message: string): IValidationResult {
        result.valid = false;
        result.message = message;
        return result;
    }

    /** Checks a list of setup placements: known cells, empty, no duplicates. Returns an error result or undefined. */
    private checkCells(cells: string[], result: IValidationResult): IValidationResult | undefined {
        const seen = new Set<string>();
        for (const cell of cells) {
            if (!this.isValidCell(cell)) {
                return this.fail(result, i18next.t("apgames:validation._general.INVALIDCELL", { cell }));
            }
            if (this.board.has(cell)) {
                return this.fail(result, i18next.t("apgames:validation._general.OCCUPIED", { where: cell }));
            }
            if (seen.has(cell)) {
                return this.fail(result, i18next.t("apgames:validation.killallgo.DUPLICATE_CELL", { where: cell }));
            }
            seen.add(cell);
        }
        return undefined;
    }

    /** Validation for "exactly `needed` stones" batches. */
    private checkBatch(cells: string[], needed: number, result: IValidationResult): IValidationResult {
        const err = this.checkCells(cells, result);
        if (err !== undefined) { return err; }
        if (cells.length > needed) {
            return this.fail(result, i18next.t("apgames:validation.killallgo.BATCH_TOO_MANY", { count: needed }));
        }
        if (cells.length < needed) {
            return this.ok(result, -1, i18next.t("apgames:validation.killallgo.STONES_LEFT", { count: needed - cells.length }), cells.length > 0);
        }
        return this.ok(result, 1, i18next.t("apgames:validation._general.VALID_MOVE"), true);
    }

    private validateHandicap(m: string, result: IValidationResult): IValidationResult {
        const max = this.maxHandicap();
        if (m.length === 0) {
            return this.ok(result, -1, i18next.t("apgames:validation.killallgo.INSTRUCTIONS_HANDICAP", { max }));
        }
        if (!/^\d+$/.test(m)) {
            return this.fail(result, i18next.t("apgames:validation.killallgo.HANDICAP_INVALID"));
        }
        const n = parseInt(m, 10);
        if (n < 1 || n > max) {
            return this.fail(result, i18next.t("apgames:validation.killallgo.HANDICAP_RANGE", { max }));
        }
        return this.ok(result, 0, i18next.t("apgames:validation.killallgo.HANDICAP_OK", { count: n }));
    }

    private validateAltPlace(m: string, result: IValidationResult): IValidationResult {
        const owed = this.handicapOwed();
        if (m.length === 0) {
            if (owed > 0) {
                return this.ok(result, -1, i18next.t("apgames:validation.killallgo.INSTRUCTIONS_ALT_HANDICAP", { count: owed }));
            }
            return this.ok(result, -1, i18next.t("apgames:validation.killallgo.INSTRUCTIONS_ALT"));
        }
        if (m === "attacker" || m.startsWith("attacker:")) {
            const cells = this.parseCells(m.substring("attacker:".length));
            if (owed === 0) {
                if (cells.length > 0) {
                    return this.fail(result, i18next.t("apgames:validation.killallgo.ATTACKER_NO_STONES"));
                }
                return this.ok(result, 1, i18next.t("apgames:validation._general.VALID_MOVE"));
            }
            return this.checkBatch(cells, owed, result);
        }
        if (m === "pass") {
            return this.fail(result, i18next.t("apgames:validation.killallgo.INVALID_PASS"));
        }
        const err = this.checkCells([m], result);
        if (err !== undefined) { return err; }
        return this.ok(result, 1, i18next.t("apgames:validation._general.VALID_MOVE"), true);
    }

    private validatePieSlice(m: string, result: IValidationResult): IValidationResult {
        if (m.length === 0) {
            return this.ok(result, -1, i18next.t("apgames:validation.killallgo.INSTRUCTIONS_PIE_SLICE"));
        }
        if (m === "pass") {
            return this.ok(result, 1, i18next.t("apgames:validation._general.VALID_MOVE"));
        }
        const err = this.checkCells(this.parseCells(m), result);
        if (err !== undefined) { return err; }
        return this.ok(result, 0, i18next.t("apgames:validation.killallgo.BATCH_MORE_OR_SUBMIT"), true);
    }

    private validatePieChoose(m: string, result: IValidationResult): IValidationResult {
        if (m.length === 0) {
            return this.ok(result, -1, i18next.t("apgames:validation.killallgo.INSTRUCTIONS_PIE_CHOOSE"));
        }
        if (m === "attacker") {
            return this.ok(result, 1, i18next.t("apgames:validation._general.VALID_MOVE"));
        }
        if (m.startsWith("attacker:")) {
            return this.fail(result, i18next.t("apgames:validation.killallgo.ATTACKER_NO_STONES"));
        }
        if (m === "defender") {
            return this.ok(result, -1, i18next.t("apgames:validation.killallgo.INSTRUCTIONS_PIE_DEFENDER_STONE"));
        }
        if (m.startsWith("defender:")) {
            const cell = m.substring("defender:".length);
            return this.validatePlacement(cell, BLUE, result);
        }
        return this.fail(result, i18next.t("apgames:validation._general.INVALID_MOVE", { move: m }));
    }

    private validateSlice(m: string, result: IValidationResult): IValidationResult {
        const max = this.points - 2;
        if (m.length === 0) {
            return this.ok(result, -1, i18next.t("apgames:validation.killallgo.INSTRUCTIONS_HOC_SLICE", { max }));
        }
        if (/^\d+,?$/.test(m)) {
            return this.ok(result, -1, i18next.t("apgames:validation.killallgo.INSTRUCTIONS_HOC_SLICE", { max }));
        }
        const match = m.match(/^(\d+),(\d+)$/);
        if (match === null) {
            return this.fail(result, i18next.t("apgames:validation.killallgo.SLICE_FORMAT"));
        }
        const a = parseInt(match[1], 10);
        const b = parseInt(match[2], 10);
        if (a < 1 || b < 1) {
            return this.fail(result, i18next.t("apgames:validation.killallgo.SLICE_MIN"));
        }
        if (a + b > max) {
            return this.fail(result, i18next.t("apgames:validation.killallgo.SLICE_SUM", { max }));
        }
        if (a > 2 * b || b > 2 * a) {
            return this.fail(result, i18next.t("apgames:validation.killallgo.SLICE_RATIO"));
        }
        return this.ok(result, 0, i18next.t("apgames:validation.killallgo.SLICE_OK", { a, b }));
    }

    private validateHocOption(m: string, result: IValidationResult): IValidationResult {
        const a = this.setup?.a ?? 0;
        if (m.length === 0) {
            return this.ok(result, -1, i18next.t("apgames:validation.killallgo.INSTRUCTIONS_HOC_OPTION", { count: a }));
        }
        if (m === "youplace") {
            return this.ok(result, 1, i18next.t("apgames:validation._general.VALID_MOVE"));
        }
        if (m === "iplace" || m.startsWith("iplace:")) {
            return this.checkBatch(this.parseCells(m.substring("iplace:".length)), a, result);
        }
        return this.fail(result, i18next.t("apgames:validation._general.INVALID_MOVE", { move: m }));
    }

    private validateHocBatch(m: string, result: IValidationResult): IValidationResult {
        const needed = this.setup?.batchSize ?? 0;
        if (m.length === 0) {
            return this.ok(result, -1, i18next.t("apgames:validation.killallgo.INSTRUCTIONS_HOC_BATCH", { count: needed }));
        }
        if (m === "pass") {
            return this.fail(result, i18next.t("apgames:validation.killallgo.INVALID_PASS"));
        }
        return this.checkBatch(this.parseCells(m), needed, result);
    }

    private validateHocChoose(m: string, result: IValidationResult): IValidationResult {
        const b = this.setup?.b ?? 0;
        if (m.length === 0) {
            return this.ok(result, -1, i18next.t("apgames:validation.killallgo.INSTRUCTIONS_HOC_CHOOSE", { count: b }));
        }
        if (m === "defender") {
            return this.ok(result, 1, i18next.t("apgames:validation._general.VALID_MOVE"));
        }
        if (m.startsWith("defender:")) {
            return this.fail(result, i18next.t("apgames:validation.killallgo.DEFENDER_NO_STONES"));
        }
        if (m === "attacker" || m.startsWith("attacker:")) {
            return this.checkBatch(this.parseCells(m.substring("attacker:".length)), b, result);
        }
        return this.fail(result, i18next.t("apgames:validation._general.INVALID_MOVE", { move: m }));
    }

    /** A single normal placement by `colour` on the current board (captures, suicide, superko). */
    private validatePlacement(cell: string, colour: Stone, result: IValidationResult): IValidationResult {
        if (!this.isValidCell(cell)) {
            return this.fail(result, i18next.t("apgames:validation._general.INVALIDCELL", { cell }));
        }
        if (this.board.has(cell)) {
            return this.fail(result, i18next.t("apgames:validation._general.OCCUPIED", { where: cell }));
        }
        if (this.simulate(this.board, cell, colour, this.positions()) === undefined) {
            return this.fail(result, i18next.t("apgames:validation.killallgo.KO_PSK"));
        }
        return this.ok(result, 1, i18next.t("apgames:validation._general.VALID_MOVE"), true);
    }

    private validatePlay(m: string, result: IValidationResult): IValidationResult {
        const colour = this.colourOfSeat(this.currplayer)!;
        if (m.length === 0) {
            const key = colour === BLUE ? "INSTRUCTIONS_PLAY_DEFENDER" : "INSTRUCTIONS_PLAY_ATTACKER";
            return this.ok(result, -1, i18next.t(`apgames:validation.killallgo.${key}`));
        }
        if (m === "pass") {
            if (colour === BLUE) {
                return this.ok(result, 1, i18next.t("apgames:validation.killallgo.PASS_WARNING"));
            }
            return this.ok(result, 1, i18next.t("apgames:validation._general.VALID_MOVE"));
        }
        if (m === "claim" || m.startsWith("claim:")) {
            if (colour !== BLUE) {
                return this.fail(result, i18next.t("apgames:validation.killallgo.CLAIM_ATTACKER"));
            }
            const [stone, marks] = this.parseClaim(m);
            if (!this.isValidCell(stone)) {
                return this.fail(result, i18next.t("apgames:validation._general.INVALIDCELL", { cell: stone }));
            }
            if (this.board.get(stone) !== BLUE) {
                return this.fail(result, i18next.t("apgames:validation.killallgo.CLAIM_NOT_OWN_STONE", { where: stone }));
            }
            const seen = new Set<string>();
            for (const mark of marks) {
                if (!this.isValidCell(mark)) {
                    return this.fail(result, i18next.t("apgames:validation._general.INVALIDCELL", { cell: mark }));
                }
                if (this.board.has(mark)) {
                    return this.fail(result, i18next.t("apgames:validation.killallgo.CLAIM_MARK_OCCUPIED", { where: mark }));
                }
                if (seen.has(mark)) {
                    return this.fail(result, i18next.t("apgames:validation.killallgo.DUPLICATE_CELL", { where: mark }));
                }
                seen.add(mark);
            }
            const key = marks.length === 0 ? "INSTRUCTIONS_CLAIM_NO_MARKS" : "INSTRUCTIONS_CLAIM";
            return this.ok(result, 0, i18next.t(`apgames:validation.killallgo.${key}`), true);
        }
        return this.validatePlacement(m, colour, result);
    }

    private validateRefute(m: string, result: IValidationResult): IValidationResult {
        if (m.length === 0) {
            return this.ok(result, -1, i18next.t("apgames:validation.killallgo.INSTRUCTIONS_REFUTE"));
        }
        const claim = this.claim!;
        const tokens = m.split(",");
        const seen = this.positions();
        let board = new Map(this.board);
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            const last = i === tokens.length - 1;
            if (token === "pass") {
                return this.fail(result, i18next.t("apgames:validation.killallgo.INVALID_PASS"));
            }
            if (!this.isValidCell(token)) {
                return this.fail(result, i18next.t("apgames:validation._general.INVALIDCELL", { cell: token }));
            }
            if (board.has(token)) {
                return this.fail(result, i18next.t("apgames:validation._general.OCCUPIED", { where: token }));
            }
            const protectedPoint = claim.marks.includes(token);
            if (protectedPoint && !last) {
                return this.fail(result, i18next.t("apgames:validation.killallgo.PROTECTED_POINT", { where: token }));
            }
            const sim = this.simulate(board, token, RED, seen);
            if (sim === undefined) {
                return this.fail(result, i18next.t("apgames:validation.killallgo.KO_PSK"));
            }
            board = sim.board;
            seen.add(sim.sig);
            const terminal = protectedPoint || !board.has(claim.stone) || this.bluePassAlive(board).length > 0;
            if (terminal) {
                if (!last) {
                    return this.fail(result, i18next.t("apgames:validation.killallgo.REFUTE_AFTER_END"));
                }
                return this.ok(result, 1, i18next.t("apgames:validation._general.VALID_MOVE"), true);
            }
        }
        // Neither a capture nor a protected point: submitting this gives the claim up.
        return this.ok(result, 0, i18next.t("apgames:validation.killallgo.REFUTE_GIVE_UP"), true);
    }

    public move(m: string, { partial = false, trusted = false } = {}): KillAllGoGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
            if (!partial && result.complete === -1) {
                throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation._general.INCOMPLETE_MOVE"));
            }
            if (!partial && this.isEnumerable(m) && !this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", { move: m }));
            }
        }
        if (m.length === 0) { return this; }

        this.results = [];
        this.interim = [];
        this.alive = undefined;
        const seen = this.positions();

        switch (this.phase) {
            case "hand-n": {
                const n = parseInt(m, 10);
                this.setup = { ...(this.setup ?? {}), handicap: n };
                this.results.push({ type: "declare", count: n });
                if (partial) { return this; }
                this.phase = "alt-place";
                this.currplayer = 2;
                break;
            }
            case "alt-place": {
                if (m === "attacker" || m.startsWith("attacker:")) {
                    const cells = this.parseCells(m.substring("attacker:".length));
                    this.results.push({ type: "claim", how: "attacker" });
                    this.placeSetupStones(cells, seen);
                    if (partial) { return this; }
                    this.redSeat = this.currplayer;
                    this.startPlay();
                } else {
                    this.placeSetupStones([m], seen);
                    if (partial) { return this; }
                    this.currplayer = this.otherSeat(this.currplayer);
                }
                break;
            }
            case "pie-slice": {
                if (m === "pass") {
                    this.results.push({ type: "pass" });
                } else {
                    this.placeSetupStones(this.parseCells(m), seen);
                }
                if (partial) { return this; }
                this.phase = "pie-choose";
                this.currplayer = 2;
                break;
            }
            case "pie-choose": {
                if (m === "attacker") {
                    this.results.push({ type: "claim", how: "attacker" });
                    if (partial) { return this; }
                    this.redSeat = this.currplayer;
                    this.startPlay();
                } else {
                    const cell = m.substring("defender:".length);
                    this.results.push({ type: "claim", how: "defender" });
                    this.redSeat = this.otherSeat(this.currplayer);
                    this.placeStone(cell, BLUE, seen);
                    if (partial) { return this; }
                    this.phase = "play";
                    this.setup = this.keptSetup();
                    this.checkBlueLife();
                    this.currplayer = this.redSeat;
                }
                break;
            }
            case "hoc-slice": {
                const [a, b] = m.split(",").map((s) => parseInt(s, 10));
                this.setup = { a, b };
                this.results.push({ type: "announce", payload: [a, b] });
                if (partial) { return this; }
                this.phase = "hoc-option";
                this.currplayer = 2;
                break;
            }
            case "hoc-option": {
                if (m === "youplace") {
                    this.results.push({ type: "select", what: "youplace" });
                    if (partial) { return this; }
                    this.setup = { ...this.setup, batchSize: this.setup!.a };
                    this.phase = "hoc-batch-a";
                    this.currplayer = 1;
                } else {
                    this.results.push({ type: "select", what: "iplace" });
                    this.placeSetupStones(this.parseCells(m.substring("iplace:".length)), seen);
                    if (partial) { return this; }
                    this.phase = "hoc-choose";
                    this.currplayer = 1;
                }
                break;
            }
            case "hoc-batch-a": {
                this.placeSetupStones(this.parseCells(m), seen);
                if (partial) { return this; }
                this.phase = "hoc-choose";
                this.currplayer = 2;
                break;
            }
            case "hoc-choose": {
                if (m === "defender") {
                    this.results.push({ type: "claim", how: "defender" });
                    if (partial) { return this; }
                    this.redSeat = this.otherSeat(this.currplayer);
                    this.setup = { ...this.setup, batchSize: this.setup!.b };
                    this.phase = "hoc-batch-b";
                    this.currplayer = this.redSeat;
                } else {
                    this.results.push({ type: "claim", how: "attacker" });
                    this.placeSetupStones(this.parseCells(m.substring("attacker:".length)), seen);
                    if (partial) { return this; }
                    this.redSeat = this.currplayer;
                    this.startPlay();
                }
                break;
            }
            case "hoc-batch-b": {
                this.placeSetupStones(this.parseCells(m), seen);
                if (partial) { return this; }
                this.startPlay();
                break;
            }
            case "play": {
                if (m === "pass") {
                    this.results.push({ type: "pass" });
                    if (partial) { return this; }
                    const previous = this.stack[this.stack.length - 1].lastmove;
                    if (previous === "pass") {
                        this.endGame(this.redSeat!, "double-pass");
                    }
                    this.currplayer = this.otherSeat(this.currplayer);
                } else if (m.startsWith("claim:")) {
                    const [stone, marks] = this.parseClaim(m);
                    const info = stringAt(this.board, this.geo, stone);
                    this.claim = { stone, stones: info.stones, marks };
                    this.results.push({ type: "claim", how: "life", where: stone, what: marks.join(",") });
                    if (partial) { return this; }
                    this.phase = "refute";
                    this.currplayer = this.otherSeat(this.currplayer);
                } else {
                    const colour = this.colourOfSeat(this.currplayer)!;
                    this.placeStone(m, colour, seen);
                    if (partial) { return this; }
                    this.checkBlueLife();
                    this.currplayer = this.otherSeat(this.currplayer);
                }
                break;
            }
            case "refute": {
                const claim = this.claim!;
                let outcome: "captured" | "protected" | "passalive" | undefined;
                for (const token of m.split(",")) {
                    this.placeStone(token, RED, seen);
                    if (!this.board.has(claim.stone)) {
                        outcome = "captured";
                        break;
                    }
                    if (this.bluePassAlive().length > 0) {
                        outcome = "passalive";
                        break;
                    }
                    if (claim.marks.includes(token)) {
                        outcome = "protected";
                        break;
                    }
                }
                if (partial) { return this; }
                if (outcome === "captured") {
                    this.endGame(this.currplayer, "claim-refuted");
                } else if (outcome === "passalive") {
                    this.checkBlueLife();
                } else if (outcome === "protected") {
                    this.claim = undefined;
                    this.phase = "play";
                } else {
                    // The Attacker stopped without capturing the string and without playing a
                    // protected point, so they have given the claim up.
                    this.endGame(this.otherSeat(this.currplayer), "claim-upheld", [...claim.stones]);
                }
                this.currplayer = this.otherSeat(this.currplayer);
                break;
            }
        }

        // The final position of the ply is the saved board; keep only the intermediate ones.
        this.interim.pop();
        this.lastmove = m;
        this.saveState();
        return this;
    }

    /** Opening stones for the Attacker (no captures are possible before the Defender has moved). */
    private placeSetupStones(cells: string[], seen: Set<string>): void {
        for (const cell of cells) {
            applyPlacement(this.board, this.geo, cell, RED);
            this.results.push({ type: "place", where: cell, what: "setup" });
            const sig = signature(this.board, this.geo);
            seen.add(sig);
            this.interim.push(sig);
        }
    }

    /** A normal placement with Tromp-Taylor clearing, recorded in results and the superko history. */
    private placeStone(cell: string, colour: Stone, seen: Set<string>): void {
        const outcome = applyPlacement(this.board, this.geo, cell, colour);
        this.results.push({ type: "place", where: cell });
        for (const group of outcome.captured) {
            this.results.push({ type: "capture", where: group.join(","), count: group.length });
        }
        if (outcome.suicided.length > 0) {
            this.results.push({ type: "capture", where: outcome.suicided.join(","), count: outcome.suicided.length, how: "suicide" });
        }
        const sig = signature(this.board, this.geo);
        seen.add(sig);
        this.interim.push(sig);
    }

    /** The opening protocol is over: normal play starts with the Defender to move. */
    private startPlay(): void {
        this.phase = "play";
        this.setup = this.keptSetup();
        this.currplayer = this.blueSeat()!;
    }

    /** The parts of the opening bookkeeping that stay visible in the sidebar during play. */
    private keptSetup(): ISetup | undefined {
        if (this.setup === undefined) {
            return undefined;
        }
        const kept: ISetup = {};
        if (this.setup.handicap !== undefined) { kept.handicap = this.setup.handicap; }
        if (this.setup.a !== undefined) { kept.a = this.setup.a; }
        if (this.setup.b !== undefined) { kept.b = this.setup.b; }
        return Object.keys(kept).length === 0 ? undefined : kept;
    }

    /** Ends the game for the Defender if any Blue string is pass-alive. */
    private checkBlueLife(): boolean {
        const alive = this.bluePassAlive();
        if (alive.length === 0) {
            return false;
        }
        this.endGame(this.blueSeat()!, "pass-alive", alive.flat());
        return true;
    }

    private endGame(winner: playerid, reason: string, alive?: string[]): void {
        this.gameover = true;
        this.winner = [winner];
        this.alive = alive;
        this.claim = undefined;
        this.results.push(
            { type: "eog", reason },
            { type: "winners", players: [winner] },
        );
    }

    public state(): IKillAllGoState {
        return {
            game: KillAllGoGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    public moveState(): IMoveState {
        const state: IMoveState = {
            _version: KillAllGoGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            phase: this.phase,
            interim: [...this.interim],
        };
        if (this.redSeat !== undefined) { state.redSeat = this.redSeat; }
        if (this.setup !== undefined) { state.setup = { ...this.setup }; }
        if (this.claim !== undefined) { state.claim = { stone: this.claim.stone, stones: [...this.claim.stones], marks: [...this.claim.marks] }; }
        if (this.alive !== undefined) { state.alive = [...this.alive]; }
        return state;
    }

    public getPlayerColour(p: playerid): number | string {
        if (this.redSeat === undefined) {
            return UNDECIDED_COLOUR;
        }
        return p === this.redSeat ? 1 : 2;
    }

    public render(): APRenderRep {
        let pstr = "";
        for (let row = 0; row < this.boardSize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                const contents = this.board.get(cell);
                if (contents === RED) {
                    pstr += "A";
                } else if (contents === BLUE) {
                    pstr += "B";
                } else {
                    pstr += "-";
                }
            }
        }
        pstr = pstr.replace(new RegExp(`-{${this.boardSize}}`, "g"), "_");

        const rep: APRenderRep = {
            board: {
                style: "vertex",
                width: this.boardSize,
                height: this.boardSize,
            },
            legend: {
                A: [{ name: "piece", colour: 1 }],
                B: [{ name: "piece", colour: 2 }],
            },
            pieces: pstr,
        };

        const toRowCol = (cell: string): RowCol => {
            const [x, y] = this.algebraic2coords(cell);
            return { row: y, col: x };
        };
        const annotations: NonNullable<APRenderRep["annotations"]> = [];
        for (const r of this.results) {
            if (r.type === "place") {
                annotations.push({ type: "enter", targets: [toRowCol(r.where!)] });
            } else if (r.type === "capture") {
                const targets = r.where!.split(",").map(toRowCol);
                annotations.push({ type: "exit", targets: targets as [RowCol, ...RowCol[]] });
            }
        }
        if (this.claim !== undefined) {
            annotations.push({ type: "enter", targets: this.claim.stones.map(toRowCol) as [RowCol, ...RowCol[]], colour: 2, style: "solid" });
            if (this.claim.marks.length > 0) {
                annotations.push({ type: "dots", targets: this.claim.marks.map(toRowCol) as [RowCol, ...RowCol[]], colour: 1 });
            }
        }
        if (this.gameover && this.alive !== undefined && this.alive.length > 0) {
            annotations.push({ type: "enter", targets: this.alive.map(toRowCol) as [RowCol, ...RowCol[]] });
        }
        if (annotations.length > 0) {
            rep.annotations = annotations;
        }

        return rep;
    }

    public sidebarStatuses(): IStatus[] {
        const statuses: IStatus[] = [];
        const undecided = this.neutralAreaLabel("apgames:status.killallgo.UNDECIDED");
        statuses.push({
            key: this.neutralAreaLabel("apgames:status.killallgo.ATTACKER"),
            value: [this.redSeat === undefined ? undecided : this.seatStatusValue(this.redSeat)],
        });
        statuses.push({
            key: this.neutralAreaLabel("apgames:status.killallgo.DEFENDER"),
            value: [this.redSeat === undefined ? undecided : this.seatStatusValue(this.otherSeat(this.redSeat))],
        });
        if (this.opening === "handicap" && this.setup?.handicap !== undefined) {
            statuses.push({
                key: this.neutralAreaLabel("apgames:status.killallgo.HANDICAP"),
                value: [this.setup.handicap.toString()],
            });
        }
        if (this.opening === "hoctaph" && this.setup?.a !== undefined && this.setup.b !== undefined) {
            statuses.push({
                key: this.neutralAreaLabel("apgames:status.killallgo.BATCHES"),
                value: [this.neutralAreaLabel("apgames:status.killallgo.BATCHES_VALUE", { a: this.setup.a, b: this.setup.b })],
            });
        }
        if (this.phase !== "play" && !this.gameover) {
            const phaseKey = this.phase.replace(/-/g, "_").toUpperCase();
            statuses.push({
                key: this.neutralAreaLabel("apgames:status.PHASE"),
                value: [this.seatAreaLabel(this.currplayer, `apgames:status.killallgo.PHASE_${phaseKey}`)],
            });
        }
        if (this.claim !== undefined) {
            const key = this.claim.marks.length === 0 ? "CLAIM_VALUE_NO_MARKS" : "CLAIM_VALUE";
            statuses.push({
                key: this.neutralAreaLabel("apgames:status.killallgo.CLAIM"),
                value: [this.neutralAreaLabel(`apgames:status.killallgo.${key}`, { where: this.claim.stone, marks: this.claim.marks.join(", ") })],
            });
        }
        return statuses;
    }

    public collectChatLogLine(lines: ChatLogLine[], r: APMoveResult, ctx: ChatLogCollectContext): boolean {
        switch (r.type) {
            case "place":
                if (r.what === "setup") {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:PLACE.killallgo_setup", { where: r.where! });
                } else {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:PLACE.nowhat", { where: r.where! });
                }
                return true;
            case "capture":
                if (r.how === "suicide") {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:CAPTURE.killallgo_suicide", { count: r.count! });
                } else {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:CAPTURE.noperson.group_nowhere", { count: r.count! });
                }
                return true;
            case "claim":
                if (r.how === "attacker") {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:CLAIM.killallgo_attacker");
                } else if (r.how === "defender") {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:CLAIM.killallgo_defender");
                } else if (r.how === "life") {
                    if (r.what === undefined || r.what.length === 0) {
                        this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:CLAIM.killallgo_life_nomarks", { where: r.where! });
                    } else {
                        this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:CLAIM.killallgo_life", { where: r.where!, marks: r.what.split(",").join(", ") });
                    }
                } else {
                    return super.collectChatLogLine(lines, r, ctx);
                }
                return true;
            case "declare":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:DECLARE.killallgo_handicap", { count: r.count! });
                return true;
            case "announce": {
                const [a, b] = r.payload as [number, number];
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:ANNOUNCE.killallgo_slice", { a, b });
                return true;
            }
            case "select":
                this.pushSeatChatLine(lines, ctx.defaultSeat, r.what === "iplace" ? "apresults:SELECT.killallgo_iplace" : "apresults:SELECT.killallgo_youplace");
                return true;
            case "eog":
                if (r.reason === "pass-alive") {
                    this.pushNeutralChatLine(lines, "apresults:EOG.killallgo_pass_alive");
                } else if (r.reason === "claim-upheld") {
                    this.pushNeutralChatLine(lines, "apresults:EOG.killallgo_claim_upheld");
                } else if (r.reason === "claim-refuted") {
                    this.pushNeutralChatLine(lines, "apresults:EOG.killallgo_claim_refuted");
                } else if (r.reason === "double-pass") {
                    this.pushNeutralChatLine(lines, "apresults:EOG.killallgo_double_pass");
                } else {
                    this.pushNeutralChatLine(lines, "apresults:EOG.default");
                }
                return true;
            default:
                return super.collectChatLogLine(lines, r, ctx);
        }
    }

    public clone(): KillAllGoGame {
        return new KillAllGoGame(this.serialize());
    }
}
