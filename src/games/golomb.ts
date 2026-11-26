import { GameBase, IAPGameState, IClickResult, ICustomButton, IIndividualState, IRenderOpts, IValidationResult, type ChatLogCollectContext, type ChatLogLine, type FlagContext, type GameFlag } from "./_base.js";
import type { APGamesInformation } from "../schemas/gameinfo.js";
import type { AnnotationBasic, APRenderRep, AreaPieces, MarkerFenceData, MarkerFence, MarkerFlood, RowCol } from "@abstractplay/renderer/build/schemas/schema";
import type { APMoveResult } from "../schemas/moveresults.js";
import { reviver, shuffle, UserFacingError } from "../common/index.js";
import i18next from "i18next";

export const gameApgamesEn = {
    validation: {
        INITIAL_INSTRUCTIONS: "Click the empty squares your pentomino will cover. Once only one placement fits, click any other empty square to confirm, or click another piece to start over.",
        INITIAL_INSTRUCTIONS_CAPTURE: "Click the empty squares your pentomino will cover. Before that, you may click pieces you have captured to remove them from the board; they return to the pool after your move. Once only one placement fits, click any other empty square to confirm.",
        INITIAL_INSTRUCTIONS_CHOOSE: "Click a pentomino in the pool to add it to your hand.",
        INITIAL_INSTRUCTIONS_SWAP: "Place a pentomino to keep your hand, or press the button to pass and swap hands with your opponent.",
        INITIAL_INSTRUCTIONS_SWAP_CHOOSE: "Choose a pentomino to keep your hand, or press the button to pass and swap hands with your opponent.",
        PARTIAL: "Keep clicking squares the pentomino will cover until only one placement fits.",
        UNIQUE: "Only one placement fits. Click any other empty square to confirm, or click another piece to start over.",
        BAD_TOKEN: "\"{{token}}\" is not a square, a removal, or a pentomino.",
        OFF_BOARD: "{{cell}} is not a square on this board.",
        OCCUPIED: "{{cell}} is already occupied.",
        DUPLICATE: "{{cell}} was selected more than once.",
        NO_PLACEMENT: "None of your available pentominoes can cover all of the selected squares.",
        NO_REMOVAL: "Pieces can only be removed in the Capture variant.",
        NOT_CAPTURED: "You can only remove pieces you have captured, and the piece at {{cell}} is not one of them.",
        DUPLICATE_REMOVAL: "The piece at {{cell}} is already being removed.",
        MUST_CHOOSE: "You must choose a pentomino from the pool before play begins.",
        NOT_CHOOSING: "Pentominoes can only be chosen before play begins.",
        UNAVAILABLE: "That pentomino is not in the pool.",
        NO_SWAP: "You can only pass to swap hands right after your opponent's first move.",
        LABEL_HAND: "{{player}}'s hand",
        LABEL_POOL: "Pool",
        LABEL_UNSEEN: "Unseen pieces",
    },
    variants: {
        "size-7x7": {
            name: "7x7",
            description: "Recommended for the Capture variant.",
        },
        "size-8x7": {
            name: "8x7",
        },
        "#board": {
            name: "8x8",
        },
        "center-blocked": {
            name: "8x8 (center blocked)",
            description: "An 8x8 board missing its 4 center squares.",
        },
        "size-10x6": {
            name: "10x6",
        },
        "#blockers": {
            name: "No blockers",
        },
        "random-blockers": {
            name: "Random blockers",
            description: "Before the game starts, blockers are placed on random squares: one for each square beyond 60, and at least one.",
        },
        "#distribution": {
            name: "Shared pool",
            description: "Players place pentominoes from a shared pool.",
        },
        "random-hands": {
            name: "Random distribution",
            description: "The 12 pentominoes are dealt evenly among the players before the game starts.",
        },
        "choose-up": {
            name: "Choose up",
            description: "Before the game starts, players take turns choosing their pentominoes.",
        },
        concealed: {
            name: "Concealed hands",
            description: "Players can only see their own pentominoes. In 2-player games, 2 pentominoes are set aside unseen and not used.",
        },
        capture: {
            name: "Capture",
            description: "A placement that shares 3 or more edges with a previously placed piece captures that piece, which takes the capturing player's colour. Captured pieces can be recaptured. Before placing, you may remove any pieces you have captured; they return to the pool after your move. A position that occurs for the fifth time with the same player to move is a draw.",
        },
        misere: {
            name: "Misère",
            description: "The last player to move loses: the first player with no legal move wins.",
        },
        "simple-pie": {
            name: "Simple pie",
            description: "2-player games only. After the first pentomino is chosen or placed, the second player may pass to swap hands instead of moving.",
        },
    },
};

export const gameApresultsEn = {
    SELECT: {
        default: "{{player}} chose the {{what}} pentomino.",
    },
    PLACE: {
        default: "{{player}} placed the {{what}} pentomino on {{where}}.",
    },
    REMOVE: {
        default: "{{player}} removed the {{what}} pentomino from the board.",
    },
    CAPTURE: {
        default: "{{player}} captured the {{what}} pentomino.",
    },
    SWAP: {
        default: "{{player}} passed and swapped hands.",
    },
    EOG: {
        repetition: "The game has ended in a draw because the same position occurred five times with the same player to move.",
    },
};

export type playerid = 1 | 2 | 3 | 4;
export type Pentomino = "F" | "I" | "L" | "N" | "P" | "T" | "U" | "V" | "W" | "X" | "Y" | "Z";
export const PENTOMINOES: readonly Pentomino[] = ["F", "I", "L", "N", "P", "T", "U", "V", "W", "X", "Y", "Z"];

/** A pentomino on the board. `owner` is 0 until the piece is captured (Capture variant). */
export interface IPlacedPiece {
    piece: Pentomino;
    /** sorted lexicographically */
    cells: string[];
    owner: number;
}

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    placed: IPlacedPiece[];
    blockers: string[];
    pool: Pentomino[];
    hands: Pentomino[][];
    kitty: Pentomino[];
    lastmove?: string;
}

export interface IGolombState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
}

interface IPlacement {
    piece: Pentomino;
    /** sorted lexicographically */
    cells: string[];
}

interface IGeometry {
    width: number;
    height: number;
    cells: string[];
    cellSet: Set<string>;
    placements: IPlacement[];
}

interface IParsed {
    removals: string[];
    cells: string[];
}

interface IAnalysis {
    result: IValidationResult;
    parsed?: IParsed;
    removed?: number[];
    compatible?: IPlacement[];
}

// The display orientation of each pentomino, top row first.
const SHAPES: Record<Pentomino, number[][]> = {
    F: [[0, 1, 1], [1, 1, 0], [0, 1, 0]],
    I: [[1, 1, 1, 1, 1]],
    L: [[1, 1, 1, 1], [1, 0, 0, 0]],
    N: [[1, 1, 0, 0], [0, 1, 1, 1]],
    P: [[1, 1, 1], [1, 1, 0]],
    T: [[1, 1, 1], [0, 1, 0], [0, 1, 0]],
    U: [[1, 0, 1], [1, 1, 1]],
    V: [[1, 0, 0], [1, 0, 0], [1, 1, 1]],
    W: [[1, 0, 0], [1, 1, 0], [0, 1, 1]],
    X: [[0, 1, 0], [1, 1, 1], [0, 1, 0]],
    Y: [[0, 1, 0, 0], [1, 1, 1, 1]],
    Z: [[1, 1, 0], [0, 1, 0], [0, 1, 1]],
};

const BOARDS: Record<string, { width: number; height: number; holes: string[] }> = {
    "size-7x7": { width: 7, height: 7, holes: [] },
    "size-8x7": { width: 8, height: 7, holes: [] },
    "#board": { width: 8, height: 8, holes: [] },
    "center-blocked": { width: 8, height: 8, holes: ["d4", "d5", "e4", "e5"] },
    "size-10x6": { width: 10, height: 6, holes: [] },
};

type Offset = [number, number];

const normaliseOffsets = (offsets: Offset[]): Offset[] => {
    const minX = Math.min(...offsets.map(([x]) => x));
    const minY = Math.min(...offsets.map(([, y]) => y));
    return offsets.map(([x, y]) => [x - minX, y - minY] as Offset).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
};

const offsetsKey = (offsets: Offset[]): string => offsets.map(([x, y]) => `${x},${y}`).join(";");

/** Every distinct rotation and reflection of each pentomino. */
const ORIENTATIONS: Map<Pentomino, Offset[][]> = new Map(PENTOMINOES.map(pc => {
    const base: Offset[] = [];
    SHAPES[pc].forEach((row, y) => row.forEach((v, x) => { if (v === 1) { base.push([x, y]); } }));
    const transforms: ((o: Offset) => Offset)[] = [
        ([x, y]) => [x, y], ([x, y]) => [-y, x], ([x, y]) => [-x, -y], ([x, y]) => [y, -x],
        ([x, y]) => [-x, y], ([x, y]) => [y, x], ([x, y]) => [x, -y], ([x, y]) => [-y, -x],
    ];
    const seen = new Map<string, Offset[]>();
    for (const t of transforms) {
        const o = normaliseOffsets(base.map(t));
        seen.set(offsetsKey(o), o);
    }
    return [pc, [...seen.values()]];
}));

const geometryCache = new Map<string, IGeometry>();

export class GolombGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Golomb's Game",
        uid: "golomb",
        playercounts: [2, 3, 4],
        version: "20261125",
        dateAdded: "2026-11-25",
        description: "Players take turns placing pentominoes on the board. The last player able to place one wins.",
        notes: "To place a pentomino, click the empty squares it will cover. Once only one legal placement covers every selected square, the move is ready and the piece is shown as placed, along with anything it would capture: click any other empty square to confirm it, or click another piece to start over. In move notation, a placement lists all 5 covered squares, and a capture-variant removal is an `x` followed by the removed piece's first square, as in `xa1`. With 3 or 4 players, the game ends as soon as the player to move has no legal move: the last player who moved wins, or, in Misère, the player who cannot move wins. In Capture, pieces removed during the move being entered are crossed out in the pool, since they cannot be placed until the next turn, and a position that occurs for the fifth time with the same player to move ends the game in a draw. Simple pie only applies to 2-player games and is ignored in larger games.",
        urls: [
            "https://nrich.maths.org/content/01/10/game/game.html",
            "https://club.cc.cmu.edu/~ajo/free-software/pento/pento.html",
        ],
        people: [
            {
                type: "designer",
                name: "Solomon W. Golomb",
            },
            {
                type: "coder",
                name: "Samraku",
                urls: [],
                apid: "6ea91933-1262-41a5-b5f3-a6af70692296",
            },
        ],
        variants: [
            { uid: "size-7x7", group: "board" },
            { uid: "size-8x7", group: "board" },
            { uid: "#board" },
            { uid: "center-blocked", group: "board" },
            { uid: "size-10x6", group: "board" },
            { uid: "#blockers" },
            { uid: "random-blockers", group: "blockers" },
            { uid: "#distribution" },
            { uid: "random-hands", group: "distribution" },
            { uid: "choose-up", group: "distribution" },
            {
                uid: "concealed",
                enabledWhen: { distribution: ["random-hands"] },
                conflictsWith: ["simple-pie"],
            },
            {
                uid: "capture",
                enabledWhen: { distribution: ["#distribution"] },
                conflictsWith: ["misere"],
                fans: true,
                people: [
                    {
                        type: "designer",
                        name: "Arthur J. O'Dwyer",
                        urls: ["https://club.cc.cmu.edu/~ajo/free-software/pento/pento.html"],
                    },
                ],
            },
            { uid: "misere", conflictsWith: ["capture"] },
            {
                uid: "simple-pie",
                enabledWhen: { distribution: ["random-hands", "choose-up"] },
                conflictsWith: ["concealed"],
            },
        ],
        categories: ["goal>immobilize", "mechanic>place", "mechanic>block", "mechanic>share", "board>shape>rect", "board>connect>rect", "components>poly", "other>2+players"],
        flags: ["experimental", "custom-buttons", "random-start"],
    };

    public static resolveFlags(context: FlagContext = {}): readonly GameFlag[] {
        const flags: GameFlag[] = [...(this.gameinfo.flags ?? [])];
        // the client only holds its own hand, so it cannot look ahead
        if (context.variants?.includes("concealed")) {
            flags.push("no-explore");
        }
        return flags;
    }

    private static geometry(variants: string[]): IGeometry {
        const uid = Object.keys(BOARDS).find(k => variants.includes(k)) ?? "#board";
        const cached = geometryCache.get(uid);
        if (cached !== undefined) {
            return cached;
        }
        const { width, height, holes } = BOARDS[uid];
        const cells: string[] = [];
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const cell = GameBase.coords2algebraic(x, y, height);
                if (!holes.includes(cell)) {
                    cells.push(cell);
                }
            }
        }
        const cellSet = new Set(cells);
        const placements: IPlacement[] = [];
        for (const pc of PENTOMINOES) {
            for (const offsets of ORIENTATIONS.get(pc)!) {
                for (let y = 0; y < height; y++) {
                    for (let x = 0; x < width; x++) {
                        const covered = offsets.map(([dx, dy]) => (x + dx < width && y + dy < height) ? GameBase.coords2algebraic(x + dx, y + dy, height) : "");
                        if (covered.every(c => cellSet.has(c))) {
                            placements.push({ piece: pc, cells: covered.sort() });
                        }
                    }
                }
            }
        }
        const geo: IGeometry = { width, height, cells, cellSet, placements };
        geometryCache.set(uid, geo);
        return geo;
    }

    public numplayers!: number;
    public currplayer!: playerid;
    public placed!: IPlacedPiece[];
    public blockers!: string[];
    public pool!: Pentomino[];
    public hands!: Pentomino[][];
    public kitty!: Pentomino[];
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private geo!: IGeometry;
    // while a move is being entered: empty squares some fitting placement could cover, and the squares clicked so far
    private candidates: string[] = [];
    private selected: string[] = [];
    private previewing = false;
    // pieces removed by the move being entered: back in the pool, but not placeable yet
    private removing: Pentomino[] = [];

    constructor(state?: number | IGolombState | string, variants?: string[]) {
        super();
        if (state === undefined || typeof state === "number") {
            this.numplayers = state ?? 2;
            if (variants !== undefined && variants.length > 0) {
                this.variants = this.applyVariantConstraints(variants);
            }
            // Simple pie is a 2-player rule: larger games start without it.
            if (this.numplayers !== 2) {
                this.variants = this.variants.filter(v => v !== "simple-pie");
            }
            const geo = GolombGame.geometry(this.variants);
            let blockers: string[] = [];
            if (this.variants.includes("random-blockers")) {
                const count = Math.max(1, geo.cells.length - 60);
                blockers = shuffle([...geo.cells]).slice(0, count).sort();
            }
            const hands: Pentomino[][] = [];
            for (let p = 0; p < this.numplayers; p++) {
                hands.push([]);
            }
            let pool: Pentomino[] = [];
            let kitty: Pentomino[] = [];
            if (this.variants.includes("random-hands")) {
                const deck = shuffle([...PENTOMINOES]);
                if (this.variants.includes("concealed") && this.numplayers === 2) {
                    kitty = deck.splice(0, 2).sort();
                }
                const each = deck.length / this.numplayers;
                for (let p = 0; p < this.numplayers; p++) {
                    hands[p] = deck.slice(p * each, (p + 1) * each).sort();
                }
            } else {
                pool = [...PENTOMINOES];
            }
            const fresh: IMoveState = {
                _version: GolombGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                placed: [],
                blockers,
                pool,
                hands,
                kitty,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IGolombState;
            }
            if (state.game !== GolombGame.gameinfo.uid) {
                throw new Error(`The Golomb's Game engine cannot process a game of '${state.game}'.`);
            }
            this.numplayers = state.numplayers;
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): GolombGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if (idx < 0 || idx >= this.stack.length) {
            throw new Error("Could not load the requested state from the stack.");
        }
        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.placed = state.placed.map(p => ({ ...p, cells: [...p.cells] }));
        this.blockers = [...state.blockers];
        this.pool = [...state.pool];
        this.hands = state.hands.map(h => [...h]);
        this.kitty = [...state.kitty];
        this.lastmove = state.lastmove;
        this.results = [...state._results];
        this.geo = GolombGame.geometry(this.variants);
        this.candidates = [];
        this.selected = [];
        this.previewing = false;
        this.removing = [];
        return this;
    }

    private get usesHands(): boolean {
        return this.variants.includes("random-hands") || this.variants.includes("choose-up");
    }

    private isChoosing(): boolean {
        return this.variants.includes("choose-up") && this.pool.length > 0;
    }

    /** The second player's first turn of a Simple pie game, when passing swaps the hands. */
    private isSwapTurn(): boolean {
        return this.variants.includes("simple-pie") && this.numplayers === 2 && this.stack.length === 2 && !this.gameover;
    }

    private available(player: playerid): Pentomino[] {
        return this.usesHands ? this.hands[player - 1] : this.pool;
    }

    /** Maps each occupied cell to the index of its piece in `placed`, or -1 for a blocker. */
    private occupancy(): Map<string, number> {
        const occ = new Map<string, number>();
        for (const cell of this.blockers) {
            occ.set(cell, -1);
        }
        this.placed.forEach((p, i) => p.cells.forEach(c => occ.set(c, i)));
        return occ;
    }

    private ownCaptured(player: playerid): number[] {
        if (!this.variants.includes("capture")) {
            return [];
        }
        return this.placed.map((p, i) => p.owner === player ? i : -1).filter(i => i >= 0);
    }

    /**
     * For each placement of an available piece, the pieces that would have to be removed first.
     * Placements needing a blocker or a piece the player cannot remove are skipped.
     */
    private reachablePlacements(player: playerid): { placement: IPlacement; needs: number[] }[] {
        const avail = new Set(this.available(player));
        const occ = this.occupancy();
        const own = new Set(this.ownCaptured(player));
        const out: { placement: IPlacement; needs: number[] }[] = [];
        for (const placement of this.geo.placements) {
            if (!avail.has(placement.piece)) {
                continue;
            }
            const needs = new Set<number>();
            let ok = true;
            for (const cell of placement.cells) {
                const unit = occ.get(cell);
                if (unit === undefined) {
                    continue;
                }
                if (!own.has(unit)) {
                    ok = false;
                    break;
                }
                needs.add(unit);
            }
            if (ok) {
                out.push({ placement, needs: [...needs] });
            }
        }
        return out;
    }

    private hasAnyMove(player: playerid): boolean {
        if (this.isChoosing() || this.isSwapTurn()) {
            return true;
        }
        return this.reachablePlacements(player).length > 0;
    }

    /** A removal is written as `x` and the removed piece's first square. */
    private removalToken(i: number): string {
        return `x${this.placed[i].cells[0]}`;
    }

    private formatPlacement(removed: number[], cells: string[]): string {
        return [...removed.map(i => this.removalToken(i)).sort(), ...cells].join(" ");
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) {
            return [];
        }
        player ??= this.currplayer;
        const moves: string[] = [];
        if (this.isSwapTurn()) {
            moves.push("pass");
        }
        if (this.isChoosing()) {
            moves.push(...this.pool);
            return moves.sort();
        }
        const own = this.ownCaptured(player);
        for (const { placement, needs } of this.reachablePlacements(player)) {
            // any extra removals of the player's captured pieces are also legal
            const optional = own.filter(i => !needs.includes(i));
            for (let mask = 0; mask < (1 << optional.length); mask++) {
                const removed = [...needs, ...optional.filter((_, b) => (mask & (1 << b)) !== 0)];
                moves.push(this.formatPlacement(removed, placement.cells));
            }
        }
        return moves.sort();
    }

    /** Lowercases squares and removals, uppercases pentomino letters, and collapses whitespace. */
    private static cleanInput(m: string): string {
        return m.trim().split(/\s+/).filter(t => t.length > 0).map(t => t.length === 1 ? t.toUpperCase() : t.toLowerCase()).join(" ");
    }

    private analyse(m: string): IAnalysis {
        const result: IValidationResult = { valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER") };
        const fail = (message: string): IAnalysis => ({ result: { valid: false, message } });

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            if (this.isSwapTurn()) {
                result.message = this.isChoosing() ?
                    i18next.t("apgames:validation.golomb.INITIAL_INSTRUCTIONS_SWAP_CHOOSE") :
                    i18next.t("apgames:validation.golomb.INITIAL_INSTRUCTIONS_SWAP");
            } else if (this.isChoosing()) {
                result.message = i18next.t("apgames:validation.golomb.INITIAL_INSTRUCTIONS_CHOOSE");
            } else if (this.variants.includes("capture")) {
                result.message = i18next.t("apgames:validation.golomb.INITIAL_INSTRUCTIONS_CAPTURE");
            } else {
                result.message = i18next.t("apgames:validation.golomb.INITIAL_INSTRUCTIONS");
            }
            return { result };
        }

        if (m === "pass") {
            if (!this.isSwapTurn()) {
                return fail(i18next.t("apgames:validation.golomb.NO_SWAP"));
            }
            return { result: { valid: true, complete: 1, message: i18next.t("apgames:validation._general.VALID_MOVE") } };
        }

        if (/^[A-Z]$/.test(m)) {
            if (!this.isChoosing()) {
                return fail(i18next.t("apgames:validation.golomb.NOT_CHOOSING"));
            }
            if (!this.pool.includes(m as Pentomino)) {
                return fail(i18next.t("apgames:validation.golomb.UNAVAILABLE"));
            }
            return { result: { valid: true, complete: 1, message: i18next.t("apgames:validation._general.VALID_MOVE") } };
        }

        if (this.isChoosing()) {
            return fail(i18next.t("apgames:validation.golomb.MUST_CHOOSE"));
        }

        const parsed: IParsed = { removals: [], cells: [] };
        for (const token of m.split(" ")) {
            const match = token.match(/^(x?)([a-z]\d+)$/);
            if (match === null) {
                return fail(i18next.t("apgames:validation.golomb.BAD_TOKEN", { token }));
            }
            if (match[1] === "x") {
                parsed.removals.push(match[2]);
            } else {
                parsed.cells.push(match[2]);
            }
        }

        const occ = this.occupancy();
        const removed: number[] = [];
        for (const cell of parsed.removals) {
            if (!this.variants.includes("capture")) {
                return fail(i18next.t("apgames:validation.golomb.NO_REMOVAL"));
            }
            const unit = occ.get(cell);
            if (unit === undefined || unit < 0 || this.placed[unit].owner !== this.currplayer) {
                return fail(i18next.t("apgames:validation.golomb.NOT_CAPTURED", { cell }));
            }
            if (removed.includes(unit)) {
                return fail(i18next.t("apgames:validation.golomb.DUPLICATE_REMOVAL", { cell }));
            }
            removed.push(unit);
        }

        const isFree = (cell: string): boolean => {
            const unit = occ.get(cell);
            return unit === undefined || removed.includes(unit);
        };
        for (let i = 0; i < parsed.cells.length; i++) {
            const cell = parsed.cells[i];
            if (!this.geo.cellSet.has(cell)) {
                return fail(i18next.t("apgames:validation.golomb.OFF_BOARD", { cell }));
            }
            if (!isFree(cell)) {
                return fail(i18next.t("apgames:validation.golomb.OCCUPIED", { cell }));
            }
            if (parsed.cells.indexOf(cell) !== i) {
                return fail(i18next.t("apgames:validation.golomb.DUPLICATE", { cell }));
            }
        }

        const avail = new Set(this.available(this.currplayer));
        const compatible = this.geo.placements.filter(p =>
            avail.has(p.piece) &&
            parsed.cells.every(c => p.cells.includes(c)) &&
            p.cells.every(isFree)
        );

        result.valid = true;
        result.canrender = true;
        if (parsed.cells.length === 0) {
            result.complete = -1;
            result.message = i18next.t("apgames:validation.golomb.INITIAL_INSTRUCTIONS_CAPTURE");
        } else if (compatible.length === 0) {
            return fail(i18next.t("apgames:validation.golomb.NO_PLACEMENT"));
        } else if (compatible.length === 1) {
            // a complete placement is never auto-submitted
            result.complete = 0;
            result.message = i18next.t("apgames:validation.golomb.UNIQUE");
        } else {
            result.complete = -1;
            result.message = i18next.t("apgames:validation.golomb.PARTIAL");
        }
        return { result, parsed, removed, compatible };
    }

    public validateMove(m: string): IValidationResult {
        return this.analyse(GolombGame.cleanInput(m)).result;
    }

    /** The stored form of a move: removals, then all five covered squares, each sorted. */
    public normaliseMove(m: string): string {
        m = GolombGame.cleanInput(m);
        const { result, removed, compatible } = this.analyse(m);
        if (result.valid && result.complete === 0 && removed !== undefined && compatible !== undefined) {
            return this.formatPlacement(removed, compatible[0].cells);
        }
        return m;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            move = GolombGame.cleanInput(move);
            const keep = (): IClickResult => ({ ...this.validateMove(move), move });
            // the client sends the Swap button as a click on "_btn_pass"
            if (piece === "_btn_pass") {
                const result = this.validateMove("pass");
                return { ...result, move: result.valid ? "pass" : move };
            }
            if (row < 0 || col < 0) {
                if (this.isChoosing() && piece !== undefined && this.pool.includes(piece as Pentomino)) {
                    const result = this.validateMove(piece);
                    return { ...result, move: result.valid ? piece : move };
                }
                return keep();
            }
            if (this.isChoosing()) {
                return keep();
            }
            const cell = this.coords2algebraic(col, row);
            if (!this.geo.cellSet.has(cell)) {
                return keep();
            }
            const current = this.analyse(move);
            const parsed = current.parsed ?? { removals: [], cells: [] };
            const removed = current.removed ?? [];
            const removals = removed.map(i => this.removalToken(i));
            const reset = (): IClickResult => ({ ...this.validateMove(""), move: "" });

            const unit = this.occupancy().get(cell);
            if (unit !== undefined && !removed.includes(unit)) {
                // clicking your own captured piece removes it (and drops any partial placement)
                if (unit >= 0 && this.variants.includes("capture") && this.placed[unit].owner === this.currplayer) {
                    const newmove = [...removals, this.removalToken(unit)].join(" ");
                    return { ...this.validateMove(newmove), move: newmove };
                }
                // clicking any other piece or blocker cancels the move
                return reset();
            }

            if (current.result.valid && current.result.complete === 0 && current.compatible !== undefined) {
                if (current.compatible[0].cells.includes(cell)) {
                    // clicking the previewed piece changes nothing
                    return { ...current.result, move };
                }
                // clicking any other empty square confirms the placement
                return {
                    valid: true,
                    complete: 1,
                    canrender: true,
                    move: this.normaliseMove(move),
                    message: i18next.t("apgames:validation._general.VALID_MOVE"),
                };
            }

            // a square that is already selected changes nothing
            if (parsed.cells.includes(cell)) {
                return { ...current.result, move };
            }
            const newmove = [...removals, ...parsed.cells, cell].join(" ");
            const result = this.validateMove(newmove);
            if (result.valid) {
                return { ...result, move: newmove };
            }
            // an impossible square cancels the partial placement but keeps any removals
            const kept = removals.join(" ");
            return { ...this.validateMove(kept), move: kept, message: result.message };
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", { move, row, col, piece, emessage: (e as Error).message }),
            };
        }
    }

    public move(m: string, { partial = false, trusted = false } = {}): GolombGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:validation._general.MOVES_GAMEOVER"));
        }
        m = GolombGame.cleanInput(m);
        const analysis = this.analyse(m);
        if (!trusted || partial) {
            if (!analysis.result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", analysis.result.message);
            }
            if (!partial && analysis.result.complete === -1) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", { move: m }));
            }
        }

        this.results = [];
        this.candidates = [];
        this.selected = [];
        this.previewing = false;
        this.removing = [];

        if (partial) {
            if (analysis.parsed === undefined || analysis.removed === undefined) {
                return this;
            }
            this.previewing = true;
            // show removed pieces off the board and back in the pool
            this.removing = this.liftPieces(analysis.removed);
            this.pool = [...this.pool, ...this.removing].sort();
            if (analysis.parsed.cells.length > 0 && analysis.compatible?.length === 1) {
                // the squares are settled: show the piece, and any captures, as they will be
                this.placePiece(analysis.compatible[0]);
            } else {
                this.selected = [...analysis.parsed.cells];
                this.candidates = [...new Set((analysis.compatible ?? []).flatMap(p => p.cells))];
            }
            return this;
        }

        if (m === "pass") {
            [this.hands[0], this.hands[1]] = [this.hands[1], this.hands[0]];
            this.results.push({ type: "pie" });
        } else if (/^[A-Z]$/.test(m)) {
            const pc = m as Pentomino;
            this.pool = this.pool.filter(p => p !== pc);
            this.hands[this.currplayer - 1] = [...this.hands[this.currplayer - 1], pc].sort();
            this.results.push({ type: "select", what: pc });
        } else {
            const placement = analysis.compatible![0];
            m = this.formatPlacement(analysis.removed!, placement.cells);
            const returning = this.liftPieces(analysis.removed!);
            this.placePiece(placement);
            // removed pieces only return to the pool once the move is over
            this.pool = [...this.pool, ...returning].sort();
        }

        this.lastmove = m;
        this.currplayer = (this.currplayer % this.numplayers + 1) as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    /** Takes the given pieces off the board, recording each removal, and returns them. */
    private liftPieces(indices: number[]): Pentomino[] {
        const lifted = indices.map(i => this.placed[i]);
        for (const p of lifted) {
            this.results.push({ type: "remove", what: p.piece, where: p.cells.join(" ") });
        }
        this.placed = this.placed.filter((_, i) => !indices.includes(i));
        return lifted.map(p => p.piece);
    }

    /** Takes the piece from the mover's supply, places it, and captures what it touches enough. */
    private placePiece(placement: IPlacement): void {
        if (this.usesHands) {
            this.hands[this.currplayer - 1] = this.hands[this.currplayer - 1].filter(p => p !== placement.piece);
        } else {
            this.pool = this.pool.filter(p => p !== placement.piece);
        }
        this.results.push({ type: "place", what: placement.piece, where: placement.cells.join(" ") });
        if (this.variants.includes("capture")) {
            for (const other of this.placed) {
                if (this.sharedEdges(placement.cells, other.cells) >= 3 && other.owner !== this.currplayer) {
                    this.results.push({ type: "capture", what: other.piece, where: other.cells.join(" "), whose: other.owner });
                    other.owner = this.currplayer;
                }
            }
        }
        this.placed.push({ piece: placement.piece, cells: [...placement.cells], owner: 0 });
    }

    private sharedEdges(a: string[], b: string[]): number {
        const other = new Set(b);
        let count = 0;
        for (const cell of a) {
            const [x, y] = this.algebraic2coords(cell);
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx >= 0 && ny >= 0 && nx < this.geo.width && ny < this.geo.height && other.has(this.coords2algebraic(nx, ny))) {
                    count++;
                }
            }
        }
        return count;
    }

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.geo.height);
    }

    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.geo.height);
    }

    protected checkEOG(): GolombGame {
        if (!this.hasAnyMove(this.currplayer)) {
            this.gameover = true;
            const mover = ((this.currplayer + this.numplayers - 2) % this.numplayers + 1) as playerid;
            this.winner = this.variants.includes("misere") ? [this.currplayer] : [mover];
            this.results.push(
                { type: "eog", reason: "stalemate" },
                { type: "winners", players: [...this.winner] },
            );
        } else if (this.variants.includes("capture") && this.repetitions() >= 5) {
            this.gameover = true;
            this.winner = Array.from({ length: this.numplayers }, (_, i) => (i + 1) as playerid);
            this.results.push(
                { type: "eog", reason: "repetition" },
                { type: "winners", players: [...this.winner] },
            );
        }
        return this;
    }

    /** The board, captured colours and player to move; the shared pool follows from the board. */
    private static positionKey(state: { currplayer: playerid; placed: IPlacedPiece[] }): string {
        return `${state.currplayer}|${state.placed.map(p => `${p.owner}:${p.cells.join(".")}`).sort().join(",")}`;
    }

    /**
     * How many times the current, not yet saved, position has occurred, counting itself.
     * Only Capture games can repeat a position, since otherwise every move fills the board further.
     */
    private repetitions(): number {
        const seen = new Map<string, number>();
        for (const entry of this.stack) {
            const key = GolombGame.positionKey(entry);
            seen.set(key, (seen.get(key) ?? 0) + 1);
        }
        return (seen.get(GolombGame.positionKey(this)) ?? 0) + 1;
    }

    public getButtons(): ICustomButton[] {
        if (this.isSwapTurn()) {
            return [{ label: "apgames:buttons.swap", move: "pass" }];
        }
        return [];
    }

    public getStartingPosition(): string {
        const start = this.stack[0];
        const parts: string[] = [];
        if (start.blockers.length > 0) {
            parts.push(start.blockers.join(","));
        }
        if (this.variants.includes("random-hands")) {
            parts.push(...start.hands.map(h => h.join("")));
            if (start.kitty.length > 0) {
                parts.push(start.kitty.join(""));
            }
        }
        return parts.join(";");
    }

    public state(opts?: { strip?: boolean, player?: number }): IGolombState {
        const state: IGolombState = {
            game: GolombGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
        if (opts?.strip && this.variants.includes("concealed")) {
            state.stack = state.stack.map(entry => ({
                ...entry,
                hands: entry.hands.map((h, i) => i + 1 === opts.player ? [...h] : []),
                kitty: [],
            }));
        }
        return state;
    }

    protected moveState(): IMoveState {
        return {
            _version: GolombGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            placed: this.placed.map(p => ({ ...p, cells: [...p.cells] })),
            blockers: [...this.blockers],
            pool: [...this.pool],
            hands: this.hands.map(h => [...h]),
            kitty: [...this.kitty],
        };
    }

    public render(opts: IRenderOpts = {}): APRenderRep {
        const { width, height } = this.geo;
        const markers = this.boardMarkers();

        let pieces: string | null = null;
        if (this.selected.length > 0) {
            const selected = new Set(this.selected);
            const rows: string[] = [];
            for (let y = 0; y < height; y++) {
                const row: string[] = [];
                for (let x = 0; x < width; x++) {
                    row.push(selected.has(this.coords2algebraic(x, y)) ? "CAND" : "-");
                }
                rows.push(row.join(","));
            }
            pieces = rows.join("\n");
        }
        // before any input, every empty square some placement could cover gets a dot
        const dotted = this.previewing ? this.candidates : this.coverable();

        const legend: NonNullable<APRenderRep["legend"]> = {
            // marks a clicked square; 0.707 ≈ sqrt(0.5), so it covers about half the cell's area
            CAND: { name: "piece-square-borderless", colour: "_context_fill", scale: 0.707 },
        };
        // Hand and pool pentominoes are vector glyphs so they size like other pieces;
        // every shape is centred in the same 5x5 box to keep them proportional.
        const glyphDefs: NonNullable<APRenderRep["glyphDefs"]> = {};
        for (const pc of PENTOMINOES) {
            const shape = SHAPES[pc];
            const ox = (5 - shape[0].length) * 50;
            const oy = (5 - shape.length) * 50;
            const markup = shape.flatMap((row, y) => row.map((v, x) => v === 1 ?
                `<rect x="${ox + x * 100}" y="${oy + y * 100}" width="100" height="100" fill="#000" stroke="#000" stroke-width="2" data-slot-fill="fill" data-slot-stroke="fill"/>` : ""
            )).join("");
            glyphDefs[`golomb-${pc}`] = { viewBox: [0, 0, 500, 500], markup };
            legend[pc] = { def: `golomb-${pc}`, scale: 1.4, paint: { fill: "_context_fill" } };
        }
        // removed this turn, so not placeable until the move is over
        for (const pc of this.removing) {
            legend[`${pc}-removed`] = [
                { def: `golomb-${pc}`, scale: 1.4, paint: { fill: "_context_fill" } },
                // only the player to move can remove pieces, so the cross is theirs
                { name: "cross-diag", scale: 1.1, paint: { fill: this.currplayer } },
            ];
        }

        const areas = this.pieceAreas(opts);

        const blocked = this.holes().map(c => this.toRowCol(c));
        const rep: APRenderRep = {
            board: {
                style: "squares",
                width,
                height,
                ...(blocked.length > 0 ? { blocked: blocked as [RowCol, ...RowCol[]] } : {}),
                ...(markers.length > 0 ? { markers } : {}),
            },
            glyphDefs,
            legend,
            pieces,
            ...(areas.length > 0 ? { areas } : {}),
        };

        const annotations: AnnotationBasic[] = [];
        for (const r of this.results) {
            if (r.type === "place") {
                annotations.push({ type: "enter", targets: r.where!.split(" ").map(c => this.toRowCol(c)) as [RowCol, ...RowCol[]] });
            } else if (r.type === "remove") {
                annotations.push({ type: "exit", targets: r.where!.split(" ").map(c => this.toRowCol(c)) as [RowCol, ...RowCol[]] });
            }
        }
        const dots = dotted.filter(c => !this.selected.includes(c)).map(c => this.toRowCol(c));
        if (dots.length > 0) {
            annotations.push({ type: "dots", targets: dots as [RowCol, ...RowCol[]] });
        }
        if (annotations.length > 0) {
            rep.annotations = annotations;
        }
        return rep;
    }

    private toRowCol(cell: string): RowCol {
        const [col, row] = this.algebraic2coords(cell);
        return { row, col };
    }

    /** Fills pieces and blockers, and outlines their outside edges. */
    private boardMarkers(): (MarkerFlood | MarkerFence)[] {
        const { width, height } = this.geo;
        // pieces and blockers share the foreground colour unless captured
        const units: { cells: string[]; colour: string | number }[] = [
            ...this.placed.map(p => ({ cells: p.cells, colour: p.owner === 0 ? "_context_fill" : p.owner })),
            ...this.blockers.map(c => ({ cells: [c], colour: "_context_fill" })),
        ];
        const unitOf = new Map<string, number>();
        units.forEach((u, i) => u.cells.forEach(c => unitOf.set(c, i)));
        const floods = new Map<string | number, RowCol[]>();
        for (const u of units) {
            floods.set(u.colour, [...(floods.get(u.colour) ?? []), ...u.cells.map(c => this.toRowCol(c))]);
        }
        const markers: (MarkerFlood | MarkerFence)[] = [];
        for (const [colour, points] of floods.entries()) {
            // drawn over the grid so pieces show no internal lines
            markers.push({ type: "flood", colour, opacity: 1, belowGrid: false, points: points as [RowCol, ...RowCol[]] });
        }
        // outline every outside edge of each piece and blocker, but not the edges between its own squares
        const fences: MarkerFenceData[] = [];
        const sides: [number, number, "N" | "E" | "S" | "W"][] = [[0, -1, "N"], [1, 0, "E"], [0, 1, "S"], [-1, 0, "W"]];
        for (const [cell, u] of unitOf.entries()) {
            const [x, y] = this.algebraic2coords(cell);
            for (const [dx, dy, side] of sides) {
                const nx = x + dx;
                const ny = y + dy;
                const onBoard = nx >= 0 && ny >= 0 && nx < width && ny < height;
                const other = onBoard ? unitOf.get(this.coords2algebraic(nx, ny)) : undefined;
                if (other === u) {
                    continue;
                }
                // an edge shared by two pieces is drawn once, from its west or north side
                if (other !== undefined && (side === "N" || side === "W")) {
                    continue;
                }
                fences.push({ cell: { row: y, col: x }, side, colour: "_context_background", width: 3 });
            }
        }
        for (const f of fences) {
            markers.push({ type: "fence", ...f });
        }
        return markers;
    }

    /** Hands, the pool and (with Concealed hands) the unseen pieces, as this viewer may see them. */
    private pieceAreas(opts: IRenderOpts): AreaPieces[] {
        const areas: AreaPieces[] = [];
        const asPieces = (list: string[]) => list as AreaPieces["pieces"];
        const concealed = this.variants.includes("concealed");
        const reveal = !concealed || this.gameover || opts.omniscient === true;
        const seen = new Set<Pentomino>(this.placed.map(p => p.piece));
        if (this.usesHands) {
            for (let p = 1; p <= this.numplayers; p++) {
                if (!reveal && opts.perspective !== undefined && opts.perspective !== p) {
                    continue;
                }
                const hand = this.hands[p - 1];
                hand.forEach(pc => seen.add(pc));
                if (hand.length > 0) {
                    areas.push({
                        type: "pieces",
                        label: this.seatAreaLabel(p, "apgames:validation.golomb.LABEL_HAND"),
                        pieces: asPieces(hand),
                        ownerMark: p,
                        spacing: 0.3,
                    });
                }
            }
        }
        if (this.pool.length > 0) {
            areas.push({
                type: "pieces",
                label: this.neutralAreaLabel("apgames:validation.golomb.LABEL_POOL"),
                pieces: asPieces(this.pool.map(pc => this.removing.includes(pc) ? `${pc}-removed` : pc)),
                spacing: 0.3,
            });
        }
        if (concealed) {
            // only says which pieces are elsewhere, never whose they are
            const unseen = PENTOMINOES.filter(pc => !seen.has(pc));
            if (unseen.length > 0) {
                areas.push({
                    type: "pieces",
                    label: this.neutralAreaLabel("apgames:validation.golomb.LABEL_UNSEEN"),
                    pieces: asPieces(unseen),
                    spacing: 0.3,
                });
            }
        }
        return areas;
    }

    /** Empty squares the player to move could cover with some placement, without removing anything. */
    private coverable(): string[] {
        if (this.gameover || this.isChoosing()) {
            return [];
        }
        const free = this.reachablePlacements(this.currplayer).filter(r => r.needs.length === 0);
        return [...new Set(free.flatMap(r => r.placement.cells))];
    }

    private holes(): string[] {
        const all: string[] = [];
        for (let y = 0; y < this.geo.height; y++) {
            for (let x = 0; x < this.geo.width; x++) {
                const cell = this.coords2algebraic(x, y);
                if (!this.geo.cellSet.has(cell)) {
                    all.push(cell);
                }
            }
        }
        return all;
    }

    public collectChatLogLine(lines: ChatLogLine[], r: APMoveResult, ctx: ChatLogCollectContext): boolean {
        switch (r.type) {
            case "select":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:golomb.SELECT.default", { what: r.what! });
                return true;
            case "place":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:golomb.PLACE.default", { what: r.what!, where: r.where!.split(" ").join(", ") });
                return true;
            case "remove":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:golomb.REMOVE.default", { what: r.what! });
                return true;
            case "capture":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:golomb.CAPTURE.default", { what: r.what! });
                return true;
            case "pie":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:golomb.SWAP.default");
                return true;
            default:
                return super.collectChatLogLine(lines, r, ctx);
        }
    }

    public clone(): GolombGame {
        return new GolombGame(this.serialize());
    }
}
