import { GameBase, IAPGameState, IClickResult, ICustomButton, IIndividualState, IRenderOpts, IStatus, IValidationResult, type ChatLogCollectContext, type ChatLogLine } from "./_base.js";
import type { APGamesInformation } from "../schemas/gameinfo.js";
import type { APRenderRep, Colourfuncs, Glyph, RowCol } from "@abstractplay/renderer/build/schemas/schema";
import type { APMoveResult } from "../schemas/moveresults.js";
import { algebraic2coords, coords2algebraic, reviver, UserFacingError } from "../common/index.js";
import i18next from "i18next";
import { gameApgamesUidKey } from "../common/game-apgames-t.js";

/** Variant and display labels are resolved in {@link GameBase}; anchors for strict apgames key coverage. */
void gameApgamesUidKey("killallgo", "variants", "size-9", "name");
void gameApgamesUidKey("killallgo", "variants", "size-13", "name");
void gameApgamesUidKey("killallgo", "variants", "#board", "name");
void gameApgamesUidKey("killallgo", "variants", "#opening", "name");
void gameApgamesUidKey("killallgo", "variants", "#opening", "description");
void gameApgamesUidKey("killallgo", "variants", "handicap", "name");
void gameApgamesUidKey("killallgo", "variants", "handicap", "description");
void gameApgamesUidKey("killallgo", "variants", "classic", "name");
void gameApgamesUidKey("killallgo", "variants", "classic", "description");
void gameApgamesUidKey("killallgo", "variants", "pie", "name");
void gameApgamesUidKey("killallgo", "variants", "pie", "description");
void gameApgamesUidKey("killallgo", "variants", "hoctaph", "name");
void gameApgamesUidKey("killallgo", "variants", "hoctaph", "description");
void gameApgamesUidKey("killallgo", "displays", "pass-alive-throughout", "name");
void gameApgamesUidKey("killallgo", "displays", "pass-alive-throughout", "description");

export const gameApgamesEn = {
    validation: {
        INSTRUCTIONS_HANDICAP: "You are giving the handicap. Click a numbered stone, or enter a number from 1 to {{max}} manually, to set how many extra Attacker stones your opponent will place if they take the Attacker side.",
        HANDICAP_INVALID: "The handicap must be a whole number.",
        HANDICAP_RANGE: "The handicap must be between 1 and {{max}} stones.",
        HANDICAP_OK_one: "Handicap of one stone. Submit, or choose a different handicap.",
        HANDICAP_OK_other: "Handicap of {{count}} stones. Submit, or choose a different handicap.",
        NOT_A_NUMBERED_STONE: "{{where}} is not one of the numbered stones.",
        INSTRUCTIONS_ALT: "Place an Attacker stone to continue the opening, or choose to play as the Attacker. If you choose the Attacker, your opponent moves first as the Defender.",
        INSTRUCTIONS_ALT_HANDICAP_one: "Place an Attacker stone to continue the opening, or choose to play as the Attacker. If you choose the Attacker, place one extra stone; your opponent then moves first as the Defender.",
        INSTRUCTIONS_ALT_HANDICAP_other: "Place an Attacker stone to continue the opening, or choose to play as the Attacker. If you choose the Attacker, place {{count}} extra stones; your opponent then moves first as the Defender.",
        SETUP_FULL: "The board already holds the maximum number of setup stones this phase allows ({{max}}); take the Attacker side instead of placing another.",
        ATTACKER_NO_STONES: "Taking the Attacker side does not involve placing stones now.",
        DEFENDER_NO_STONES: "Choosing the Defender side does not involve placing stones now.",
        STONES_LEFT_one: "Place one more Attacker stone.",
        STONES_LEFT_other: "Place {{count}} more Attacker stones.",
        BATCH_TOO_MANY_one: "This batch must contain exactly one stone.",
        BATCH_TOO_MANY_other: "This batch must contain exactly {{count}} stones.",
        BATCH_MORE_OR_SUBMIT: "Add more Attacker stones, or submit.",
        DUPLICATE_CELL: "The cell {{where}} is listed twice.",
        INVALID_PASS: "You cannot pass now.",
        INSTRUCTIONS_PIE_SLICE: "Place any number of Attacker stones up to {{max}} (or pass to place none); your opponent will then choose a side.",
        PIE_SLICE_MAX: "You may place at most {{max}} Attacker stones this way.",
        INSTRUCTIONS_PIE_CHOOSE: "Choose a side: take the Attacker stones, or place your first stone as the Defender.",
        INSTRUCTIONS_PIE_DEFENDER_STONE: "Place your first Defender stone.",
        INSTRUCTIONS_HOC_SLICE: "Choose the sizes of two batches of Attacker stones: the first batch will be placed before sides are chosen, and the Attacker will then place the second. Click a numbered stone in the upper block for the first batch and one in the lower block for the second, or enter both sizes manually in that order, separated by a comma.",
        SLICE_FORMAT: "Manually entered batch sizes must be two whole numbers separated by a comma, for example 20,15.",
        SLICE_MIN: "Each batch must hold at least one stone.",
        SLICE_SUM: "Together the two batches may hold at most {{max}} stones.",
        SLICE_RATIO: "Neither batch may be more than twice the size of the other.",
        SLICE_A_ONLY_one: "First batch of one stone. Now choose the size of the second batch.",
        SLICE_A_ONLY_other: "First batch of {{count}} stones. Now choose the size of the second batch.",
        SLICE_B_ONLY_one: "Second batch of one stone. Now choose the size of the first batch.",
        SLICE_B_ONLY_other: "Second batch of {{count}} stones. Now choose the size of the first batch.",
        SLICE_OK: "Batches of {{a}} and {{b}} stones. Submit, or choose different sizes.",
        INSTRUCTIONS_HOC_OPTION_one: "Decide who places the first batch of one Attacker stone: place it yourself (your opponent then chooses a side), or let your opponent place it (you then choose a side).",
        INSTRUCTIONS_HOC_OPTION_other: "Decide who places the first batch of {{count}} Attacker stones: place them yourself (your opponent then chooses a side), or let your opponent place them (you then choose a side).",
        INSTRUCTIONS_HOC_BATCH_one: "Place one Attacker stone.",
        INSTRUCTIONS_HOC_BATCH_other: "Place {{count}} Attacker stones.",
        INSTRUCTIONS_HOC_CHOOSE_one: "Choose a side. Taking the Attacker side means placing the second batch of one stone now; choosing the Defender side means your opponent places it and you then move first.",
        INSTRUCTIONS_HOC_CHOOSE_other: "Choose a side. Taking the Attacker side means placing the second batch of {{count}} stones now; choosing the Defender side means your opponent places them and you then move first.",
        INSTRUCTIONS_PLAY_ATTACKER: "Place a stone. You win by preventing the Defender from forming an unconditionally alive string.",
        INSTRUCTIONS_PLAY_DEFENDER: "Place a stone. You win by forming one unconditionally alive string.",
        KO_PSK: "That placement would recreate an earlier position of the board (positional superko).",
    },
    variants: {
        "size-9": {
            name: "9x9 board",
        },
        "size-13": {
            name: "13x13 board",
        },
        "#board": {
            name: "19x19 board",
        },
        "#opening": {
            name: "Pieboxing",
            description: "Players take turns placing Attacker stones until one of them takes the Attacker side; the other player then moves first as the Defender. Pieboxing, devised by MXHero.",
        },
        handicap: {
            name: "Handicap",
            description: "Pieboxing with a handicap. Player 1, the stronger player, sets the number of extra Attacker stones, then Player 2 starts placing. If Player 2 chooses to play as the Attacker, they place the extra stones immediately. Devised by MXHero.",
        },
        classic: {
            name: "Classic 17-stone setup",
            description: "The traditional 17-stone starting position; the Defender (Player 1) moves first. 19x19 only.",
        },
        pie: {
            name: "Simple pie",
            description: "Player 1 places any number of Attacker stones, then Player 2 chooses a side. The usual pie rule.",
        },
        hoctaph: {
            name: "Generalized Hoctaph's pie",
            description: "Player 1 chooses two batch sizes, and Player 2 decides who places the first batch. The player who did not place that batch then chooses a side, and the Attacker places the second batch. Hoctaph's pie (OGS forums), generalized to every board size by Samraku.",
        },
    },
    displays: {
        "pass-alive-throughout": {
            name: "Mark pass-alive stones throughout the game",
            description: "Mark unconditionally alive (pass-alive) stones in every position, not only once the game has ended.",
        },
    },
    buttons: {
        attacker: "Play as the Attacker",
        defender: "Play as the Defender",
        youplace: "Let the opponent place the first batch",
    },
    status: {
        ATTACKER: "Attacker",
        DEFENDER: "Defender",
        UNDECIDED: "Not yet chosen",
        HANDICAP: "Handicap stones",
        BATCHES: "Batch sizes",
        BATCHES_VALUE: "{{a}} then {{b}}",
        PHASE_HAND_N: "{{player}} sets the number of handicap stones",
        PHASE_ALT_PLACE: "{{player}} places an Attacker stone or takes the Attacker side",
        PHASE_PIE_SLICE: "{{player}} places the opening Attacker stones",
        PHASE_PIE_CHOOSE: "{{player}} chooses a side",
        PHASE_HOC_SLICE: "{{player}} sets the two batch sizes",
        PHASE_HOC_OPTION: "{{player}} decides who places the first batch",
        PHASE_HOC_BATCH_A: "{{player}} places the first batch of Attacker stones",
        PHASE_HOC_CHOOSE: "{{player}} chooses a side",
        PHASE_HOC_BATCH_B: "{{player}} places the second batch of Attacker stones",
    },
};
export const gameApresultsEn = {
    ANNOUNCE: {
        slice: "{{player}} set the batch sizes to {{a}} and {{b}} stones.",
    },
    CAPTURE: {
        suicide_one: "{{player}} removed their own stone by suicide.",
        suicide_other: "{{player}} removed {{count}} of their own stones by suicide.",
    },
    CLAIM: {
        attacker: "{{player}} chose to play as the Attacker.",
        defender: "{{player}} chose to play as the Defender.",
    },
    DECLARE: {
        handicap_one: "{{player}} set the handicap to one stone.",
        handicap_other: "{{player}} set the handicap to {{count}} stones.",
    },
    EOG: {
        double_pass: "The game has ended because both players passed consecutively without the Defender establishing unconditional life.",
        no_moves: "The game has ended because the player to move has no legal placement.",
        no_room: "The game has ended because the Attacker's unconditionally alive stones leave the Defender no room to form an unconditionally alive string.",
        pass_alive: "The game has ended because the Defender formed an unconditionally alive string.",
    },
    PLACE: {
        setup: "{{player}} placed an Attacker stone at {{where}}.",
    },
    SELECT: {
        iplace: "{{player}} chose to place the first batch.",
        youplace: "{{player}} chose to let their opponent place the first batch.",
    },
};



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

export interface PassAliveOptions {
    /** Tromp-Taylor rules; selects the strict vital-region test. Defaults to true. */
    suicideAllowed?: boolean;
    /**
     * Vital regions every chain in the set needs. Defaults to 2, Benson's condition; a game in
     * which the opponent can fill more than one liberty before any clearing needs more.
     */
    minVital?: number;
}

interface Region {
    points: string[];
    adjacentChains: Set<number>;
    vitalTo: Set<number>;
}

/**
 * Every pass-alive chain of `colour`, each as its list of stones.
 *
 * A chain is pass-alive when it belongs to a set X of chains such that every chain in X has at
 * least two vital regions enclosed by X (`minVital` raises that number). A region is a maximal
 * connected set of points not holding the colour; it is vital to a chain when every point of the
 * region that could ever become empty is adjacent to the chain.
 *
 * Under classic (no-suicide) rules only the empty points of a region need to touch the chain.
 * When multi-stone suicide is legal, the opponent can clear its own stones out of a region and
 * refill it leaving a hole that is not a liberty of the chain, so every point of the region,
 * occupied or not, must touch it.
 */
export const passAliveStrings = (board: Board, geo: Geometry, colour: Stone, opts: PassAliveOptions = {}): string[][] => {
    const suicideAllowed = opts.suicideAllowed ?? true;
    const minVital = opts.minVital ?? 2;

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
            if (vital < minVital) {
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

/**
 * Whether any part of the board still has room for the two eyes a pass-alive Defender string
 * needs, given the Attacker's pass-alive stones `permanent`.
 *
 * Those stones can never be captured, and a point next to one of them can never lie in a vital
 * region of a pass-alive Defender string (such a region would have to contain the stone, and a
 * pass-alive Attacker chain cannot sit inside one). So the two vital regions of any future living
 * Defender string lie among the points touching no permanent stone, in one component of the board
 * minus those stones, and are not adjacent to each other. When no component offers two such
 * points, the Defender can never live. The test is sound but not complete: it never gives up on
 * a Defender who could still live, but it does not recognise every hopeless position.
 */
export const roomForTwoEyes = (geo: Geometry, permanent: Set<string>): boolean => {
    if (permanent.size === 0) {
        return true;
    }
    const seen = new Set<string>();
    for (const start of geo.cells) {
        if (permanent.has(start) || seen.has(start)) {
            continue;
        }
        const eyePoints: string[] = [];
        const todo = [start];
        seen.add(start);
        while (todo.length > 0) {
            const cur = todo.pop()!;
            const adj = geo.neighbours.get(cur)!;
            if (!adj.some((n) => permanent.has(n))) {
                eyePoints.push(cur);
            }
            for (const n of adj) {
                if (!permanent.has(n) && !seen.has(n)) {
                    seen.add(n);
                    todo.push(n);
                }
            }
        }
        // The grid has no triangles, so any three points include two that are not adjacent.
        if (eyePoints.length >= 3) {
            return true;
        }
        if (eyePoints.length === 2 && !geo.neighbours.get(eyePoints[0])!.includes(eyePoints[1])) {
            return true;
        }
    }
    return false;
};

// ---------------------------------------------------------------------------
// The game
// ---------------------------------------------------------------------------

type Opening = "alt" | "handicap" | "classic" | "pie" | "hoctaph";

type Phase =
    | "hand-n"        // handicap opening: Player 1 types the number of handicap stones
    | "alt-place"     // Pieboxing: alternating placement of Red stones until someone takes Red
    | "pie-slice"     // simple pie: Player 1 places any number of Red stones
    | "pie-choose"    // simple pie: Player 2 chooses a side
    | "hoc-slice"     // Hoctaph: Player 1 chooses the two batch sizes
    | "hoc-option"    // Hoctaph: Player 2 chooses who places the first batch
    | "hoc-batch-a"   // Hoctaph: Player 1 places the first batch (Player 2 chose "youplace")
    | "hoc-choose"    // Hoctaph: the other player chooses a side
    | "hoc-batch-b"   // Hoctaph: Red places the second batch (the chooser took Blue)
    | "play";         // normal alternation, Blue always moved first

interface ISetup {
    a?: number;
    b?: number;
    batchSize?: number;
    handicap?: number;
}

interface ILegend {
    [key: string]: Glyph | [Glyph, ...Glyph[]];
}

/** One numbered stone of an on-board picker. */
interface IPickerButton {
    cell: string;
    value: number;
}

/** A picker as the current phase shows it. */
interface IPicker {
    buttons: IPickerButton[];
    /** The value currently chosen in this picker, if any. */
    chosen?: number;
    /** Whether a value fits with what is chosen elsewhere. */
    allowed: (value: number) => boolean;
}

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Board;
    lastmove?: string;
    phase: Phase;
    redSeat?: playerid;
    setup?: ISetup;
    /** Board signatures of the intermediate positions inside this ply (positional superko). */
    interim: string[];
    /** The stones that decided the game: the Defender's living strings, or the Attacker's that leave them no room. */
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

/** The paint of a stone in player colour `colour`: its border is black or white, whichever contrasts better with the fill. */
const stonePaint = (colour: 1 | 2): { fill: number; border: Colourfuncs } => ({
    fill: colour,
    border: { func: "bestContrast", bg: colour, fg: ["#000", "#fff"] },
});

export class KillAllGoGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Kill-All Go",
        uid: "killallgo",
        playercounts: [2],
        version: "20260921",
        dateAdded: "2026-09-21",
        description: "A Go variant with asymmetric goals: the Attacker starts with stones on the board and must prevent the Defender from establishing unconditional life. The Defender wins by forming just one unconditionally alive string.",
        notes: "The Defender must form an unconditionally alive string (pass-alive according to Benson's algorithm): one that can survive any sequence of opposing moves without responding. Life dependent on seki or ko does not count. The Attacker wins when their unconditionally alive stones leave no room for such a string. Passing is not allowed after the opening, and a player with no legal placement loses.\n\nStones are placed and captured as in Go with Tromp-Taylor clearing: after a placement, opponent strings without liberties are removed, then your own string if it has none. Multi-stone suicide is therefore legal. Positional superko applies: no placement may recreate an earlier board position.",
        urls: [
            "https://senseis.xmp.net/?KillAllGame",
            "https://senseis.xmp.net/?Pieboxing",
            "https://senseis.xmp.net/?ShapeGame",
        ],
        people: [
            {
                type: "designer",
                name: "Alexandre Dinerchtein",
                urls: ["https://senseis.xmp.net/?KillAllGame"],
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
            { uid: "size-13", group: "board", default: true },
            { uid: "#board" },
            {
                uid: "#opening",
                people: [
                    {
                        type: "designer",
                        name: "MXHero",
                        urls: ["https://senseis.xmp.net/?Pieboxing"],
                    },
                ],
            },
            {
                uid: "handicap",
                group: "opening",
                unrated: true,
                people: [
                    {
                        type: "designer",
                        name: "MXHero",
                        urls: ["https://senseis.xmp.net/?Pieboxing"],
                    },
                ],
            },
            { uid: "classic", group: "opening", enabledWhen: { board: ["#board"] } },
            { uid: "pie", group: "opening" },
            {
                uid: "hoctaph",
                group: "opening",
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
        categories: ["goal>cripple", "goal>arrange", "mechanic>place", "mechanic>capture", "mechanic>enclose", "mechanic>asymmetry", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["experimental", "custom-colours", "custom-buttons"],
        displays: [{ uid: "pass-alive-throughout" }],
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

    /**
     * The largest number of Attacker stones any one setup phase may contribute: half the board,
     * rounded down. Every supported board has an odd number of points, so two phases each staying
     * at or under this bound can never together reach the whole board, and a Red-only string can
     * only lose its last liberty by covering literally every point. This is what keeps setup
     * placements safe from positional superko without simulating them: the whole-board suicide
     * that would otherwise repeat an earlier position (the empty board, in the simplest case)
     * becomes impossible. Also the range offered for the handicap declared in `hand-n`.
     */
    private maxSetupStones(): number {
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

    /** The pass-alive chains of `colour` on the current board, under the game's Tromp-Taylor rules. */
    private passAlive(colour: Stone): string[][] {
        return passAliveStrings(this.board, this.geo, colour, { suicideAllowed: true });
    }

    /**
     * The picker offered during the Hoctaph slice: the values 1 to ceil(2p/25) for each batch, the
     * first batch above the centre point and the second mirrored below it, in a centred block nine
     * wide (or as wide as the values, when there are fewer). 1 to 9 run left to right along the
     * second row out from the centre point, leaving three empty rows between the blocks; from there
     * the values snake away from the centre, two stones out along the end column and then back
     * across the row, so 10 and 11 sit beyond 9, 12 to 19 run right to left from 11, 20 and 21 sit
     * beyond 19, and so on. Larger sizes are still entered manually.
     */
    private sliceLayout(): { a: IPickerButton[]; b: IPickerButton[] } {
        const max = Math.ceil((2 * this.points) / 25);
        const width = Math.min(9, max);
        const centre = Math.floor(this.boardSize / 2);
        const left = centre - Math.floor(width / 2);
        /** Where a value goes, as [rows out from the centre, column across the block]. */
        const place = (value: number): [number, number] => {
            if (value <= width) {
                return [2, value - 1];
            }
            // Each lap after the first row is a stone on the end column plus a row running back.
            const lap = Math.floor((value - width - 1) / (width + 1));
            const step = (value - width - 1) % (width + 1);
            const fromLeft = lap % 2 === 1;
            if (step === 0) {
                return [3 + 2 * lap, fromLeft ? 0 : width - 1];
            }
            return [4 + 2 * lap, fromLeft ? step - 1 : width - step];
        };
        const block = (direction: -1 | 1): IPickerButton[] => {
            const buttons: IPickerButton[] = [];
            for (let value = 1; value <= max; value++) {
                const [out, col] = place(value);
                buttons.push({ cell: this.coords2algebraic(left + col, centre + direction * out), value });
            }
            return buttons;
        };
        return { a: block(-1), b: block(1) };
    }

    /**
     * The picker offered while the handicap is set: the handicaps 1 to 18 in two centred rows of
     * nine, the odd values on the row just above the centre point and the even values on the row
     * just below it, so each column holds a consecutive pair. Larger handicaps are still entered
     * manually.
     */
    private handicapLayout(): IPickerButton[] {
        const centre = Math.floor(this.boardSize / 2);
        const left = centre - 4;
        const buttons: IPickerButton[] = [];
        for (let value = 1; value <= Math.min(18, this.maxSetupStones()); value++) {
            const row = value % 2 === 1 ? centre - 1 : centre + 1;
            buttons.push({ cell: this.coords2algebraic(left + Math.floor((value - 1) / 2), row), value });
        }
        return buttons;
    }

    /** The on-board pickers of the current phase: the handicap, or the two Hoctaph batch sizes. */
    private pickers(): IPicker[] {
        if (this.gameover) {
            return [];
        }
        if (this.phase === "hand-n") {
            return [{ buttons: this.handicapLayout(), chosen: this.setup?.handicap, allowed: () => true }];
        }
        if (this.phase === "hoc-slice") {
            const layout = this.sliceLayout();
            const a = this.setup?.a;
            const b = this.setup?.b;
            return [
                { buttons: layout.a, chosen: a, allowed: (v) => b === undefined || this.sliceAllowed(v, b) },
                { buttons: layout.b, chosen: b, allowed: (v) => a === undefined || this.sliceAllowed(a, v) },
            ];
        }
        return [];
    }

    /** The two batch sizes named by a complete or partial slice move. */
    private parseSlice(m: string): [number | undefined, number | undefined] {
        const parts = m.split(",");
        const num = (raw: string | undefined): number | undefined => (raw !== undefined && /^\d+$/.test(raw) ? parseInt(raw, 10) : undefined);
        return [num(parts[0]), num(parts[1])];
    }

    /** Whether two batch sizes may be chosen together. */
    private sliceAllowed(a: number, b: number): boolean {
        return a >= 1 && b >= 1 && a + b <= this.points - 2 && a <= 2 * b && b <= 2 * a;
    }

    private parseCells(list: string): string[] {
        return list.length === 0 ? [] : list.split(",");
    }

    /** Whether `moves()` lists every legal move of this shape in the current phase (used by the failsafe). */
    private isEnumerable(m: string): boolean {
        if (this.phase === "hoc-slice" || this.phase === "hoc-batch-a" || this.phase === "hoc-batch-b") {
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
                for (let n = 1; n <= this.maxSetupStones(); n++) {
                    moves.push(n.toString());
                }
                break;
            case "alt-place":
                if (this.board.size < this.maxSetupStones()) {
                    for (const cell of this.geo.cells) {
                        if (!this.board.has(cell)) {
                            moves.push(cell);
                        }
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
                const colour = this.colourOfSeat(this.currplayer)!;
                for (const cell of this.geo.cells) {
                    if (!this.board.has(cell) && this.simulate(this.board, cell, colour, seen) !== undefined) {
                        moves.push(cell);
                    }
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
                return [{ label: "apgames:buttons.killallgo.attacker", move: "attacker" }];
            case "hoc-option":
                return [{ label: "apgames:buttons.killallgo.youplace", move: "youplace" }];
            case "hoc-choose":
                return [{ label: "apgames:buttons.killallgo.defender", move: "defender" }];
            case "pie-slice":
                return [{ label: "apgames:buttons.pass", move: "pass" }];
            default:
                return [];
        }
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            const newmove = this.clickCell(move, cell);
            if (newmove === undefined) {
                // Only the two pickers ignore clicks, away from their numbered stones.
                return {
                    move,
                    valid: false,
                    message: i18next.t("apgames:validation.killallgo.NOT_A_NUMBERED_STONE", { where: cell }),
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
                return this.handicapLayout().find((btn) => btn.cell === cell)?.value.toString();
            case "hoc-slice": {
                const layout = this.sliceLayout();
                const hit = layout.a.find((btn) => btn.cell === cell) ?? layout.b.find((btn) => btn.cell === cell);
                if (hit === undefined) { return undefined; }
                const first = layout.a.some((btn) => btn.cell === cell);
                const [curA, curB] = this.parseSlice(move);
                // Picking a value the other batch size forbids drops that other choice.
                if (first) {
                    const keep = curB !== undefined && this.sliceAllowed(hit.value, curB) ? curB : undefined;
                    return keep === undefined ? `${hit.value}` : `${hit.value},${keep}`;
                }
                const keep = curA !== undefined && this.sliceAllowed(curA, hit.value) ? curA : undefined;
                return keep === undefined ? `,${hit.value}` : `${keep},${hit.value}`;
            }
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
            case "play":
                return cell;
        }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = { valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER") };
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (this.gameover) {
            result.message = i18next.t("apgames:validation._general.MOVES_GAMEOVER");
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
        }
    }

    private static batchTooManyMessage(count: number): string {
        if (count === 1) {
            return i18next.t("apgames:validation.killallgo.BATCH_TOO_MANY_one");
        }
        return i18next.t("apgames:validation.killallgo.BATCH_TOO_MANY_other", { count });
    }

    private static stonesLeftMessage(count: number): string {
        if (count === 1) {
            return i18next.t("apgames:validation.killallgo.STONES_LEFT_one");
        }
        return i18next.t("apgames:validation.killallgo.STONES_LEFT_other", { count });
    }

    private static handicapOkMessage(count: number): string {
        if (count === 1) {
            return i18next.t("apgames:validation.killallgo.HANDICAP_OK_one");
        }
        return i18next.t("apgames:validation.killallgo.HANDICAP_OK_other", { count });
    }

    private static instructionsAltHandicapMessage(count: number): string {
        if (count === 1) {
            return i18next.t("apgames:validation.killallgo.INSTRUCTIONS_ALT_HANDICAP_one");
        }
        return i18next.t("apgames:validation.killallgo.INSTRUCTIONS_ALT_HANDICAP_other", { count });
    }

    private static sliceAOnlyMessage(count: number): string {
        if (count === 1) {
            return i18next.t("apgames:validation.killallgo.SLICE_A_ONLY_one");
        }
        return i18next.t("apgames:validation.killallgo.SLICE_A_ONLY_other", { count });
    }

    private static sliceBOnlyMessage(count: number): string {
        if (count === 1) {
            return i18next.t("apgames:validation.killallgo.SLICE_B_ONLY_one");
        }
        return i18next.t("apgames:validation.killallgo.SLICE_B_ONLY_other", { count });
    }

    private static instructionsHocOptionMessage(count: number): string {
        if (count === 1) {
            return i18next.t("apgames:validation.killallgo.INSTRUCTIONS_HOC_OPTION_one");
        }
        return i18next.t("apgames:validation.killallgo.INSTRUCTIONS_HOC_OPTION_other", { count });
    }

    private static instructionsHocBatchMessage(count: number): string {
        if (count === 1) {
            return i18next.t("apgames:validation.killallgo.INSTRUCTIONS_HOC_BATCH_one");
        }
        return i18next.t("apgames:validation.killallgo.INSTRUCTIONS_HOC_BATCH_other", { count });
    }

    private static instructionsHocChooseMessage(count: number): string {
        if (count === 1) {
            return i18next.t("apgames:validation.killallgo.INSTRUCTIONS_HOC_CHOOSE_one");
        }
        return i18next.t("apgames:validation.killallgo.INSTRUCTIONS_HOC_CHOOSE_other", { count });
    }

    private static openingPhaseStatusKey(phase: Exclude<Phase, "play">): string {
        switch (phase) {
            case "hand-n":
                return "apgames:status.killallgo.PHASE_HAND_N";
            case "alt-place":
                return "apgames:status.killallgo.PHASE_ALT_PLACE";
            case "pie-slice":
                return "apgames:status.killallgo.PHASE_PIE_SLICE";
            case "pie-choose":
                return "apgames:status.killallgo.PHASE_PIE_CHOOSE";
            case "hoc-slice":
                return "apgames:status.killallgo.PHASE_HOC_SLICE";
            case "hoc-option":
                return "apgames:status.killallgo.PHASE_HOC_OPTION";
            case "hoc-batch-a":
                return "apgames:status.killallgo.PHASE_HOC_BATCH_A";
            case "hoc-choose":
                return "apgames:status.killallgo.PHASE_HOC_CHOOSE";
            case "hoc-batch-b":
                return "apgames:status.killallgo.PHASE_HOC_BATCH_B";
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

    /**
     * Checks a sequence of setup placements (always Red, one seat placing several stones in one
     * ply): known cells, empty, no duplicates. No superko check is needed for the sequence itself
     * (unlike an ordinary multi-stone ply): every setup phase separately caps its own contribution
     * at `maxSetupStones()`, and every supported board has an odd number of points, so two
     * independently capped contributions can never together cover the whole board. A Red-only
     * string can only lose its last liberty by covering literally every point, so a whole-board
     * self-capture during setup (which would otherwise repeat an earlier position, the empty
     * board in the simplest case) is impossible as long as every caller enforces its own cap.
     */
    private checkCells(cells: string[], result: IValidationResult): IValidationResult | undefined {
        const named = new Set<string>();
        for (const cell of cells) {
            if (!this.isValidCell(cell)) {
                return this.fail(result, i18next.t("apgames:validation._general.INVALIDCELL", { cell }));
            }
            if (this.board.has(cell)) {
                return this.fail(result, i18next.t("apgames:validation._general.OCCUPIED", { where: cell }));
            }
            if (named.has(cell)) {
                return this.fail(result, i18next.t("apgames:validation.killallgo.DUPLICATE_CELL", { where: cell }));
            }
            named.add(cell);
        }
        return undefined;
    }

    private checkBatch(cells: string[], needed: number, result: IValidationResult): IValidationResult {
        const err = this.checkCells(cells, result);
        if (err !== undefined) { return err; }
        if (cells.length > needed) {
            return this.fail(result, KillAllGoGame.batchTooManyMessage(needed));
        }
        if (cells.length < needed) {
            return this.ok(result, -1, KillAllGoGame.stonesLeftMessage(needed - cells.length), cells.length > 0);
        }
        return this.ok(result, 1, i18next.t("apgames:validation._general.VALID_MOVE"), true);
    }

    private validateHandicap(m: string, result: IValidationResult): IValidationResult {
        const max = this.maxSetupStones();
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
        return this.ok(result, 0, KillAllGoGame.handicapOkMessage(n), true);
    }

    private validateAltPlace(m: string, result: IValidationResult): IValidationResult {
        const owed = this.handicapOwed();
        if (m.length === 0) {
            if (owed > 0) {
                return this.ok(result, -1, KillAllGoGame.instructionsAltHandicapMessage(owed));
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
        if (this.board.size >= this.maxSetupStones()) {
            return this.fail(result, i18next.t("apgames:validation.killallgo.SETUP_FULL", { max: this.maxSetupStones() }));
        }
        const err = this.checkCells([m], result);
        if (err !== undefined) { return err; }
        return this.ok(result, 1, i18next.t("apgames:validation._general.VALID_MOVE"), true);
    }

    private validatePieSlice(m: string, result: IValidationResult): IValidationResult {
        const max = this.maxSetupStones();
        if (m.length === 0) {
            return this.ok(result, -1, i18next.t("apgames:validation.killallgo.INSTRUCTIONS_PIE_SLICE", { max }));
        }
        if (m === "pass") {
            return this.ok(result, 1, i18next.t("apgames:validation._general.VALID_MOVE"));
        }
        const cells = this.parseCells(m);
        if (cells.length > max) {
            return this.fail(result, i18next.t("apgames:validation.killallgo.PIE_SLICE_MAX", { max }));
        }
        const err = this.checkCells(cells, result);
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
            return this.ok(result, -1, i18next.t("apgames:validation.killallgo.INSTRUCTIONS_HOC_SLICE"), true);
        }
        if (!/^\d*,?\d*$/.test(m)) {
            return this.fail(result, i18next.t("apgames:validation.killallgo.SLICE_FORMAT"));
        }
        const [a, b] = this.parseSlice(m);
        if (a === undefined && b === undefined) {
            return this.ok(result, -1, i18next.t("apgames:validation.killallgo.INSTRUCTIONS_HOC_SLICE"), true);
        }
        if (b === undefined && a !== undefined) {
            return this.ok(result, -1, KillAllGoGame.sliceAOnlyMessage(a), true);
        }
        if (a === undefined && b !== undefined) {
            return this.ok(result, -1, KillAllGoGame.sliceBOnlyMessage(b), true);
        }
        if (a === undefined || b === undefined) {
            return this.ok(result, -1, i18next.t("apgames:validation.killallgo.INSTRUCTIONS_HOC_SLICE"), true);
        }
        if (a < 1 || b < 1) {
            return this.fail(result, i18next.t("apgames:validation.killallgo.SLICE_MIN"));
        }
        if (a + b > max) {
            return this.fail(result, i18next.t("apgames:validation.killallgo.SLICE_SUM", { max }));
        }
        if (a > 2 * b || b > 2 * a) {
            return this.fail(result, i18next.t("apgames:validation.killallgo.SLICE_RATIO"));
        }
        return this.ok(result, 0, i18next.t("apgames:validation.killallgo.SLICE_OK", { a, b }), true);
    }

    private validateHocOption(m: string, result: IValidationResult): IValidationResult {
        const a = this.setup?.a ?? 0;
        if (m.length === 0) {
            return this.ok(result, -1, KillAllGoGame.instructionsHocOptionMessage(a));
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
            return this.ok(result, -1, KillAllGoGame.instructionsHocBatchMessage(needed));
        }
        if (m === "pass") {
            return this.fail(result, i18next.t("apgames:validation.killallgo.INVALID_PASS"));
        }
        return this.checkBatch(this.parseCells(m), needed, result);
    }

    private validateHocChoose(m: string, result: IValidationResult): IValidationResult {
        const b = this.setup?.b ?? 0;
        if (m.length === 0) {
            return this.ok(result, -1, KillAllGoGame.instructionsHocChooseMessage(b));
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
            const message = colour === BLUE
                ? i18next.t("apgames:validation.killallgo.INSTRUCTIONS_PLAY_DEFENDER")
                : i18next.t("apgames:validation.killallgo.INSTRUCTIONS_PLAY_ATTACKER");
            return this.ok(result, -1, message);
        }
        if (m === "pass") {
            return this.fail(result, i18next.t("apgames:validation.killallgo.INVALID_PASS"));
        }
        return this.validatePlacement(m, colour, result);
    }

    public move(m: string, { partial = false, trusted = false } = {}): KillAllGoGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:validation._general.MOVES_GAMEOVER"));
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
                    this.currplayer = this.redSeat;
                }
                break;
            }
            case "hoc-slice": {
                const [a, b] = this.parseSlice(m);
                this.setup = { a, b };
                if (partial) { return this; }
                this.results.push({ type: "announce", payload: [a!, b!] });
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
                const colour = this.colourOfSeat(this.currplayer)!;
                this.placeStone(m, colour, seen);
                if (partial) { return this; }
                this.currplayer = this.otherSeat(this.currplayer);
                break;
            }
        }

        // Every ply that leaves the board in play may have settled the game, or left the next
        // player without a legal placement.
        this.checkLifeAndDeath();
        this.checkStalemate(seen);

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

    /**
     * The Defender wins once a Blue string is pass-alive. The Attacker wins once that can never
     * happen: the Attacker's pass-alive stones cannot be captured by the Defender, and they leave
     * no room for two eyes. The two outcomes cannot coincide, because a pass-alive Blue string
     * always has that room.
     */
    private checkLifeAndDeath(): void {
        if (this.gameover || this.phase !== "play") {
            return;
        }
        const alive = this.passAlive(BLUE);
        if (alive.length > 0) {
            this.endGame(this.blueSeat()!, "pass-alive", alive.flat());
            return;
        }
        const permanent = this.passAlive(RED).flat();
        if (!roomForTwoEyes(this.geo, new Set(permanent))) {
            this.endGame(this.redSeat!, "no-room", permanent);
        }
    }

    /**
     * Passing is not allowed during play, so a player with no legal placement loses. Short of a
     * superko repetition, that cannot happen before the life-and-death check has ended the game.
     */
    private checkStalemate(seen: Set<string>): void {
        if (this.gameover || this.phase !== "play") {
            return;
        }
        const colour = this.colourOfSeat(this.currplayer)!;
        if (this.geo.cells.some((cell) => !this.board.has(cell) && this.simulate(this.board, cell, colour, seen) !== undefined)) {
            return;
        }
        this.endGame(this.otherSeat(this.currplayer), "no-moves");
    }

    private endGame(winner: playerid, reason: string, alive?: string[]): void {
        this.gameover = true;
        this.winner = [winner];
        this.alive = alive;
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
        if (this.alive !== undefined) { state.alive = [...this.alive]; }
        return state;
    }

    public getPlayerColour(p: playerid): number | string {
        if (this.redSeat === undefined) {
            return UNDECIDED_COLOUR;
        }
        return p === this.redSeat ? 1 : 2;
    }

    /**
     * The numbered stones of the current pickers, added to `legend` and returned as a cell map,
     * along with the cells of the values chosen so far. In the Hoctaph slice, a value the batch
     * size already chosen on the other side would forbid is drawn at half opacity; it stays
     * clickable, and picking it drops that other choice.
     */
    private pickerOverlay(legend: ILegend): { overlay: Map<string, string>; chosen: string[] } {
        const overlay = new Map<string, string>();
        const chosen: string[] = [];
        const stone = (text: string, dimmed: boolean): [Glyph, ...Glyph[]] => {
            const piece: Glyph = { name: "piece", paint: stonePaint(1) };
            const label: Glyph = { text, scale: 0.75, rotate: null };
            if (dimmed) {
                piece.opacity = 0.5;
                label.opacity = 0.5;
            }
            return [piece, label];
        };
        for (const picker of this.pickers()) {
            for (const btn of picker.buttons) {
                const allowed = picker.allowed(btn.value);
                const key = `${allowed ? "n" : "d"}${btn.value}`;
                legend[key] = stone(btn.value.toString(), !allowed);
                overlay.set(btn.cell, key);
                if (btn.value === picker.chosen) {
                    chosen.push(btn.cell);
                }
            }
        }
        return { overlay, chosen };
    }

    public render(opts?: IRenderOpts): APRenderRep {
        const legend: ILegend = {
            A: [{ name: "piece", paint: stonePaint(1) }],
            B: [{ name: "piece", paint: stonePaint(2) }],
        };
        const { overlay, chosen } = this.pickerOverlay(legend);

        // Pass-alive stones are faded in the position that ended the game, or throughout on request.
        // The final position is recognised by its own `eog` result: `gameover` is game-wide, and
        // `load()` can render any earlier position of a finished game, while `alive` is unset when
        // the game ends by stalemate and the stones should fade at any end.
        const faded = new Map<string, string>();
        if (this.results.some((r) => r.type === "eog") || this.hasDisplay(opts, "pass-alive-throughout")) {
            for (const [colour, key, player] of [[RED, "C", 1], [BLUE, "D", 2]] as const) {
                const cells = this.passAlive(colour).flat();
                if (cells.length > 0) {
                    legend[key] = [{ name: "piece", paint: stonePaint(player), opacity: 0.75 }];
                    for (const cell of cells) {
                        faded.set(cell, key);
                    }
                }
            }
        }
        const stoneKey = (cell: string): string => {
            const contents = this.board.get(cell);
            return faded.get(cell) ?? (contents === RED ? "A" : contents === BLUE ? "B" : "-");
        };

        let pstr = "";
        if (overlay.size > 0) {
            // Multi-character keys need the comma-delimited form.
            const rows: string[] = [];
            for (let row = 0; row < this.boardSize; row++) {
                const cells: string[] = [];
                for (let col = 0; col < this.boardSize; col++) {
                    const cell = this.coords2algebraic(col, row);
                    cells.push(overlay.get(cell) ?? stoneKey(cell));
                }
                rows.push(cells.every((c) => c === "-") ? "_" : cells.join(","));
            }
            pstr = rows.join("\n");
        } else {
            for (let row = 0; row < this.boardSize; row++) {
                if (pstr.length > 0) {
                    pstr += "\n";
                }
                for (let col = 0; col < this.boardSize; col++) {
                    pstr += stoneKey(this.coords2algebraic(col, row));
                }
            }
            pstr = pstr.replace(new RegExp(`-{${this.boardSize}}`, "g"), "_");
        }

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
        for (const cell of chosen) {
            annotations.push({ type: "enter", targets: [toRowCol(cell)] });
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
            statuses.push({
                key: this.neutralAreaLabel("apgames:status.PHASE"),
                value: [this.seatAreaLabel(this.currplayer, KillAllGoGame.openingPhaseStatusKey(this.phase))],
            });
        }
        return statuses;
    }

    public collectChatLogLine(lines: ChatLogLine[], r: APMoveResult, ctx: ChatLogCollectContext): boolean {
        switch (r.type) {
            case "place":
                if (r.what === "setup") {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:killallgo.PLACE.setup", { where: r.where! });
                } else {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:_general.PLACE.nowhat", { where: r.where! });
                }
                return true;
            case "capture":
                if (r.how === "suicide") {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:killallgo.CAPTURE.suicide", { count: r.count! });
                } else {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:_general.CAPTURE.noperson.group_nowhere", { count: r.count! });
                }
                return true;
            case "claim":
                if (r.how === "attacker") {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:killallgo.CLAIM.attacker");
                } else if (r.how === "defender") {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:killallgo.CLAIM.defender");
                } else {
                    return super.collectChatLogLine(lines, r, ctx);
                }
                return true;
            case "declare":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:killallgo.DECLARE.handicap", { count: r.count! });
                return true;
            case "announce": {
                const [a, b] = r.payload as [number, number];
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:killallgo.ANNOUNCE.slice", { a, b });
                return true;
            }
            case "select":
                this.pushSeatChatLine(lines, ctx.defaultSeat, r.what === "iplace" ? "apresults:killallgo.SELECT.iplace" : "apresults:killallgo.SELECT.youplace");
                return true;
            case "eog":
                if (r.reason === "pass-alive") {
                    this.pushNeutralChatLine(lines, "apresults:killallgo.EOG.pass_alive");
                } else if (r.reason === "no-room") {
                    this.pushNeutralChatLine(lines, "apresults:killallgo.EOG.no_room");
                } else if (r.reason === "no-moves") {
                    this.pushNeutralChatLine(lines, "apresults:killallgo.EOG.no_moves");
                } else if (r.reason === "double-pass") {
                    // Preserve the move log for games completed before normal-play passes were removed.
                    this.pushNeutralChatLine(lines, "apresults:killallgo.EOG.double_pass");
                } else {
                    this.pushNeutralChatLine(lines, "apresults:_general.EOG.default");
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

