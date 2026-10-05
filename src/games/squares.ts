import { GameBaseSequenced } from "./_turn-sequenced.js";
import { IAPGameState, IClickResult, ICustomButton, IIndividualState, IRenderOpts, IScores, IStatus, IValidationResult, StatusValue, type ChatLogCollectContext, type ChatLogLine } from "./_base.js";
import type { APGamesInformation } from "../schemas/gameinfo.js";
import type { APRenderRep, AreaReserves, Colourfuncs } from "@abstractplay/renderer/build/schemas/schema";
import type { APMoveResult } from "../schemas/moveresults.js";
import { reviver, UserFacingError } from "../common/index.js";
import i18next from "i18next";

/*
 * SQUARES - The Civil War Battle Game.
 *
 * The file runs: the board (cells, adjacency, distances); the state types; then the game class with
 * the rules (movement, attacks, retreats, combat, turns), the ply model (how a move string is read,
 * listed, validated, previewed and played), the interface (clicks, buttons, rendering, statuses),
 * and finally chat and serialisation.
 *
 * A ply is an action or a combat decision, followed by whatever further decisions the same player
 * must make before the opponent gets a say, joined by slashes: `IG1C+AG1CL>AB1C/option2/advance`.
 * Decisions that fall to the opponent are plies of their own. `walkPly` is the one routine that
 * reads such a string; validation, previews, clicks and play all go through it.
 */

/* ------------------------------------------------------------------ board */

export type playerid = 1 | 2;
export type UnitType = "I" | "A" | "C";

export const UNIT_TYPES: readonly UnitType[] = ["I", "A", "C"];
/** English words for the unit types, used as i18next `context` values in the move log. */
export const UNIT_NAMES: Readonly<Record<UnitType, string>> = { I: "infantry", A: "artillery", C: "cavalry" };
const TYPE_BY_NAME: Readonly<Record<string, UnitType>> = { infantry: "I", artillery: "A", cavalry: "C" };
const UNIT_COUNTS: Readonly<Record<UnitType, number>> = { I: 9, A: 3, C: 4 };
/** A unit may move (or attack) on at most this many consecutive turns. */
export const MAX_STREAK = 2;
/** Points needed for a win by elimination. */
export const WIN_POINTS = 10;

interface IRect { x1: number; y1: number; x2: number; y2: number; }

/**
 * The renderer's `dvgc` board is three rings of ten cells. The cells carry the DVGC
 * rulebook's identification codes: B = Blue (player 2, at the north), G = Gray (player 1,
 * at the south), the digit is the line number counting from the front, L/C/R are left,
 * centre and right from the owner's point of view, and the six forests are named by
 * compass direction. The rectangles are the renderer's own cell polygons, so adjacency
 * is computed from the drawn board rather than declared by hand.
 */
export const CELL_ROWS: readonly (readonly string[])[] = [
    ["B3R", "B3C", "B3L", "NEF", "SEF", "G3R", "G3C", "G3L", "SWF", "NWF"],
    ["B2R", "B2CR", "B2CL", "B2L", "EF", "G2R", "G2CR", "G2CL", "G2L", "WF"],
    ["B1R", "B1CR", "B1C", "B1CL", "B1L", "G1R", "G1CR", "G1C", "G1CL", "G1L"],
];
const RECT_ROWS: readonly (readonly IRect[])[] = [
    [
        { x1: 0, y1: 0, x2: 150, y2: 50 }, { x1: 150, y1: 0, x2: 300, y2: 50 }, { x1: 300, y1: 0, x2: 450, y2: 50 },
        { x1: 400, y1: 50, x2: 450, y2: 150 }, { x1: 400, y1: 150, x2: 450, y2: 250 },
        { x1: 300, y1: 250, x2: 450, y2: 300 }, { x1: 150, y1: 250, x2: 300, y2: 300 }, { x1: 0, y1: 250, x2: 150, y2: 300 },
        { x1: 0, y1: 150, x2: 50, y2: 250 }, { x1: 0, y1: 50, x2: 50, y2: 150 },
    ],
    [
        { x1: 50, y1: 50, x2: 125, y2: 100 }, { x1: 125, y1: 50, x2: 225, y2: 100 }, { x1: 225, y1: 50, x2: 325, y2: 100 }, { x1: 325, y1: 50, x2: 400, y2: 100 },
        { x1: 350, y1: 100, x2: 400, y2: 200 },
        { x1: 325, y1: 200, x2: 400, y2: 250 }, { x1: 225, y1: 200, x2: 325, y2: 250 }, { x1: 125, y1: 200, x2: 225, y2: 250 }, { x1: 50, y1: 200, x2: 125, y2: 250 },
        { x1: 50, y1: 100, x2: 100, y2: 200 },
    ],
    [
        { x1: 100, y1: 100, x2: 150, y2: 150 }, { x1: 150, y1: 100, x2: 200, y2: 150 }, { x1: 200, y1: 100, x2: 250, y2: 150 }, { x1: 250, y1: 100, x2: 300, y2: 150 }, { x1: 300, y1: 100, x2: 350, y2: 150 },
        { x1: 300, y1: 150, x2: 350, y2: 200 }, { x1: 250, y1: 150, x2: 300, y2: 200 }, { x1: 200, y1: 150, x2: 250, y2: 200 }, { x1: 150, y1: 150, x2: 200, y2: 200 }, { x1: 100, y1: 150, x2: 150, y2: 200 },
    ],
];
export const FORESTS: ReadonlySet<string> = new Set(["NWF", "NEF", "WF", "EF", "SWF", "SEF"]);
/** Blue's reserve lies beyond the north edge of the board, Gray's beyond the south edge. */
const NORTH_RESERVE = "BR";
const SOUTH_RESERVE = "GR";
/** Gray (the south) moves first, so that the board's natural orientation is the first player's. */
export const RESERVES: Readonly<Record<playerid, string>> = { 1: SOUTH_RESERVE, 2: NORTH_RESERVE };
const BOARD_HEIGHT = 300;
/** A piece that has just arrived in a reserve is drawn a little smaller inside a dashed frame. */
const FRAME_SCALE = 1.1;
const FRAMED_PIECE_SCALE = 0.9;

const rects = new Map<string, IRect>();
const cellCoords = new Map<string, [number, number]>();
CELL_ROWS.forEach((row, r) => {
    row.forEach((name, c) => {
        rects.set(name, RECT_ROWS[r][c]);
        cellCoords.set(name, [r, c]);
    });
});
export const BOARD_CELLS: readonly string[] = [...rects.keys()];
export const ALL_LOCS: readonly string[] = [...BOARD_CELLS, RESERVES[1], RESERVES[2]];

const connectedMap = new Map<string, string[]>();
const diagonalMap = new Map<string, string[]>();
for (const loc of ALL_LOCS) {
    connectedMap.set(loc, []);
    diagonalMap.set(loc, []);
}
const link = (map: Map<string, string[]>, a: string, b: string): void => {
    map.get(a)!.push(b);
    map.get(b)!.push(a);
};
for (let i = 0; i < BOARD_CELLS.length; i++) {
    for (let j = i + 1; j < BOARD_CELLS.length; j++) {
        const a = rects.get(BOARD_CELLS[i])!;
        const b = rects.get(BOARD_CELLS[j])!;
        const xTouch = a.x2 === b.x1 || b.x2 === a.x1;
        const yTouch = a.y2 === b.y1 || b.y2 === a.y1;
        const xOverlap = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
        const yOverlap = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
        if ((xTouch && yOverlap > 0) || (yTouch && xOverlap > 0)) {
            link(connectedMap, BOARD_CELLS[i], BOARD_CELLS[j]);
        } else if (xTouch && yTouch && xOverlap === 0 && yOverlap === 0) {
            link(diagonalMap, BOARD_CELLS[i], BOARD_CELLS[j]);
        }
    }
}
for (const cell of BOARD_CELLS) {
    const r = rects.get(cell)!;
    if (r.y1 === 0) {
        link(connectedMap, cell, NORTH_RESERVE);
    }
    if (r.y2 === BOARD_HEIGHT) {
        link(connectedMap, cell, SOUTH_RESERVE);
    }
}

/** Locations sharing an edge with `loc` ("adjacent connected" in the rules). Includes the reserves. */
export const connectedTo = (loc: string): readonly string[] => connectedMap.get(loc) ?? [];
/** Locations touching `loc` at a single point. These only exist between the two centre rows. */
export const diagonalTo = (loc: string): readonly string[] => diagonalMap.get(loc) ?? [];
/** Everything touching `loc`, by edge or by point. */
export const adjacentTo = (loc: string): string[] => [...connectedTo(loc), ...diagonalTo(loc)];
export const isReserve = (loc: string): boolean => loc === RESERVES[1] || loc === RESERVES[2];
export const isCell = (loc: string): boolean => rects.has(loc);
export const isLocation = (loc: string): boolean => isCell(loc) || isReserve(loc);

const centreY = (loc: string): number => {
    if (loc === NORTH_RESERVE) {
        return -25;
    }
    if (loc === SOUTH_RESERVE) {
        return BOARD_HEIGHT + 25;
    }
    const r = rects.get(loc);
    if (r === undefined) {
        throw new Error(`Unknown location "${loc}".`);
    }
    return (r.y1 + r.y2) / 2;
};
/** Distance of a location from `player`'s reserve, measured from the centre of the square. */
export const distance = (loc: string, player: playerid): number => player === 1 ? BOARD_HEIGHT - centreY(loc) : centreY(loc);
/** True when `a` is strictly closer to `player`'s reserve than `b`. */
export const isCloser = (a: string, b: string, player: playerid): boolean => distance(a, player) < distance(b, player);
export const otherPlayer = (player: playerid): playerid => player === 1 ? 2 : 1;

/* ------------------------------------------------------------------ state */

export interface IUnit {
    id: string;
    owner: playerid;
    type: UnitType;
    /** A cell, the owner's reserve, or "X" once eliminated. */
    loc: string;
    /** Consecutive completed turns (of the owner) ending with the latest, in which the unit moved. */
    moveStreak: number;
    attackStreak: number;
    movedNow: boolean;
    attackedNow: boolean;
    /** The owner's turn index during which the unit may not move, attack or support. */
    frozenTurn?: number;
}

export type CombatStage = "defend" | "resolve" | "second" | "advance" | "lose";

export interface ICombat {
    attacker: string;
    from: string;
    target: string;
    supporter?: string;
    supportFrom?: string;
    defender?: string;
    flank: boolean;
    stage: CombatStage;
}

export interface IStep {
    unit: string;
    type: UnitType;
    from: string;
    to: string;
}

/** Transient state used only to draw a partially entered move. */
interface IPreview {
    outline: string[];
    attack?: { from: string; target: string; support?: string };
    /** The ply as entered so far, once its head has been played out: buttons offered mid-entry build on it. */
    move?: string;
    /** Units the ply would eliminate, as they were before it, so that they can still be drawn (faded). */
    ghosts?: IUnit[];
}

/** One stop on the way through a ply: a decision its author has to make, and what was entered for it. */
interface IDecisionPoint {
    stage: CombatStage;
    legal: string[];
    /** The segment entered for this decision, if any. It may be unfinished (a retreat still needing its square) or no legal choice at all. */
    chosen?: string;
}

/** What `walkPly` found: the decision points visited, how many segments it played, and the unit whose move cost a whole double turn. */
interface IWalk {
    points: IDecisionPoint[];
    played: number;
    doubleUnit?: IUnit;
}

interface ICombatSquares {
    from: string;
    target: string;
    support?: string;
}

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    lastmove?: string;
    units: Map<string, IUnit>;
    turnOwner: playerid;
    actionsLeft: number;
    isDouble: boolean;
    pendingDouble: boolean[];
    turnNo: number[];
    combat?: ICombat;
}

export interface ISquaresState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
}

export const fmtSteps = (steps: IStep[]): string => steps.map(s => `${s.type}${s.from}-${s.to}`).join(",");

const cloneUnits = (units: Map<string, IUnit>): Map<string, IUnit> => new Map([...units].map(([k, u]) => [k, { ...u }]));

const STEP_RE = /^([IAC])([A-Z0-9]+)-([A-Z0-9]+)$/;
const ATTACK_RE = /^([IAC])([A-Z0-9]+)(?:\+([IAC])([A-Z0-9]+))?>(?:([IAC])([A-Z0-9]+)|(BR|GR))$/;
const SEGMENT_RE = /^([IAC])([A-Z0-9]+)((?:-[A-Z0-9]+)*)$/;

/* ------------------------------------------------------------------ game */

export class SquaresGame extends GameBaseSequenced {
    public static readonly gameinfo: APGamesInformation = {
        name: "SQUARES - The Civil War Battle Game",
        uid: "squares",
        playercounts: [2],
        version: "20260924",
        dateAdded: "2026-09-24",
        // i18next.t("apgames:descriptions.squares")
        description: "apgames:descriptions.squares",
        // i18next.t("apgames:notes.squares")
        notes: "apgames:notes.squares",
        urls: [
            "https://www.dvgc.com/rules2.html",
            "https://www.dvgc.com/comments.html",
            "https://boardgamegeek.com/boardgame/3654/squares-the-civil-war-battle-game",
            "https://www.dvgc.com/order.html",
        ],
        bggid: "3654",
        people: [
            {
                type: "designer",
                name: "G. Myers",
            },
            {
                type: "publisher",
                name: "Deer Valley Game Company",
                urls: ["https://www.dvgc.com/"],
            },
            {
                type: "coder",
                name: "Samraku",
                urls: [],
                apid: "6ea91933-1262-41a5-b5f3-a6af70692296",
            },
        ],
        categories: [
            "goal>breakthrough",
            "goal>annihilate",
            "mechanic>move",
            "mechanic>capture",
            "mechanic>differentiate",
            "mechanic>displace",
            "board>shape>rect",
            "board>connect>rect",
            "components>simple>3c",
        ],
        flags: ["experimental", "custom-colours", "scores", "perspective", "custom-rotation", "custom-buttons"],
        customizations: [
            {
                num: 1,
                default: "#8c8c8c",
                explanation: "Colour of the first player (Gray)",
                player: 1,
            },
            {
                num: 2,
                default: "#1f78b4",
                explanation: "Colour of the second player (Blue)",
                player: 2,
            },
        ],
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public units!: Map<string, IUnit>;
    public turnOwner: playerid = 1;
    public actionsLeft = 1;
    public isDouble = false;
    public pendingDouble: boolean[] = [false, false];
    public turnNo: number[] = [0, 0];
    public combat?: ICombat;
    private preview?: IPreview;
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    public lastmove?: string;

    constructor(state?: ISquaresState | string) {
        super();
        if (state !== undefined) {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ISquaresState;
            }
            if (state.game !== SquaresGame.gameinfo.uid) {
                throw new Error(`The Squares game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        } else {
            const units = new Map<string, IUnit>();
            for (const p of [1, 2] as playerid[]) {
                for (const t of UNIT_TYPES) {
                    for (let i = 1; i <= UNIT_COUNTS[t]; i++) {
                        const id = `${p}${t}${i}`;
                        units.set(id, { id, owner: p, type: t, loc: RESERVES[p], moveStreak: 0, attackStreak: 0, movedNow: false, attackedNow: false });
                    }
                }
            }
            const fresh: IMoveState = {
                _version: SquaresGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                units,
                turnOwner: 1,
                actionsLeft: 1,
                isDouble: false,
                pendingDouble: [false, false],
                turnNo: [0, 0],
            };
            this.stack = [fresh];
        }
        this.load();
    }

    public load(idx = -1): SquaresGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if (idx < 0 || idx >= this.stack.length) {
            throw new Error("Could not load the requested state from the stack.");
        }
        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.lastmove = state.lastmove;
        this.units = cloneUnits(state.units);
        this.turnOwner = state.turnOwner;
        this.actionsLeft = state.actionsLeft;
        this.isDouble = state.isDouble;
        this.pendingDouble = [...state.pendingDouble];
        this.turnNo = [...state.turnNo];
        this.combat = state.combat === undefined ? undefined : { ...state.combat };
        this.preview = undefined;
        this.results = [...state._results];
        return this;
    }

    /* ---------------------------------------------------------- unit helpers */

    public unit(id: string): IUnit {
        const u = this.units.get(id);
        if (u === undefined) {
            throw new Error(`Unknown unit "${id}".`);
        }
        return u;
    }

    /** The unit standing on a board cell, if any. Reserves hold many units; see `reserveUnits`. */
    public unitAt(loc: string): IUnit | undefined {
        if (!isCell(loc)) {
            return undefined;
        }
        for (const u of this.units.values()) {
            if (u.loc === loc) {
                return u;
            }
        }
        return undefined;
    }

    /** A player's units that are still in play. */
    public unitsOf(player: playerid): IUnit[] {
        return [...this.units.values()].filter(u => u.owner === player && u.loc !== "X");
    }

    public reserveUnits(player: playerid): IUnit[] {
        return [...this.units.values()].filter(u => u.owner === player && u.loc === RESERVES[player]);
    }

    /** Neighbouring cells (edge or point) holding enemy artillery. Artillery in a reserve never pins. */
    private enemyArtilleryNear(loc: string, player: playerid): string[] {
        return adjacentTo(loc).filter(n => {
            const u = this.unitAt(n);
            return u !== undefined && u.owner !== player && u.type === "A";
        });
    }

    /** Whether the unit is frozen for its owner's turn `offset` turns from the current one. */
    private isFrozen(u: IUnit, offset = 0): boolean {
        return u.frozenTurn !== undefined && u.frozenTurn === this.turnNo[u.owner - 1] + offset;
    }

    public canMove(u: IUnit): boolean {
        return !this.isFrozen(u) && u.moveStreak < MAX_STREAK;
    }

    public canAttack(u: IUnit): boolean {
        return isCell(u.loc) && !this.isFrozen(u) && u.attackStreak < MAX_STREAK;
    }

    public canSupport(u: IUnit): boolean {
        return isCell(u.loc) && !this.isFrozen(u);
    }

    private pinAllows(u: IUnit, target: string): boolean {
        const pins = this.enemyArtilleryNear(u.loc, u.owner);
        return pins.length === 0 || (pins.length === 1 && pins[0] === target);
    }

    /** Run `fn` as if `u` were not on the board. */
    private without<T>(u: IUnit, fn: () => T): T {
        const saved = u.loc;
        u.loc = "X";
        try {
            return fn();
        } finally {
            u.loc = saved;
        }
    }

    /* ---------------------------------------------------------- movement */

    /** Destinations one step from `from` for a unit belonging to `player`. */
    private stepTargets(player: playerid, from: string, opts: { diagonal: boolean; forest: boolean }): string[] {
        const own = RESERVES[player];
        const enemy = RESERVES[otherPlayer(player)];
        const cands = opts.diagonal ? adjacentTo(from) : connectedTo(from);
        const out: string[] = [];
        for (const n of cands) {
            if (FORESTS.has(n)) {
                if (opts.forest && this.unitAt(n) === undefined) {
                    out.push(n);
                }
            } else if (n === own) {
                out.push(n);
            } else if (n === enemy) {
                if (this.reserveUnits(otherPlayer(player)).length === 0) {
                    out.push(n);
                }
            } else if (this.unitAt(n) === undefined) {
                out.push(n);
            }
        }
        return out;
    }

    /** True when a move of `u` to `to` needs the whole double turn (forest entry, or an infantry diagonal). */
    public isDoubleCost(u: IUnit, to: string): boolean {
        if (u.type === "C") {
            return false;
        }
        return FORESTS.has(to) || (u.type === "I" && diagonalTo(u.loc).includes(to));
    }

    /** Every legal single-action move for one unit, as move strings. */
    private unitMoves(u: IUnit, doubleAvailable: boolean): string[] {
        const out: string[] = [];
        const p = u.owner;
        const from = u.loc;
        const label = (to: string): string => `${u.type}${from}-${to}`;
        const canDouble = doubleAvailable && !this.isFrozen(u, 1);
        if (u.type === "I") {
            for (const n of this.stepTargets(p, from, { diagonal: false, forest: false })) {
                out.push(label(n));
            }
            if (canDouble) {
                for (const n of connectedTo(from)) {
                    if (FORESTS.has(n) && this.unitAt(n) === undefined) {
                        out.push(label(n));
                    }
                }
                for (const n of diagonalTo(from)) {
                    if (this.unitAt(n) === undefined) {
                        out.push(label(n));
                    }
                }
            }
        } else if (u.type === "A") {
            for (const n of this.stepTargets(p, from, { diagonal: true, forest: false })) {
                out.push(label(n));
            }
            if (canDouble) {
                for (const n of connectedTo(from)) {
                    if (FORESTS.has(n) && this.unitAt(n) === undefined) {
                        out.push(label(n));
                    }
                }
            }
        } else {
            for (const n of this.stepTargets(p, from, { diagonal: true, forest: true })) {
                out.push(label(n));
            }
            const own = RESERVES[p];
            const enemy = RESERVES[otherPlayer(p)];
            for (const n1 of adjacentTo(from)) {
                if (FORESTS.has(n1) || n1 === enemy) {
                    continue;
                }
                if (n1 !== own && this.unitAt(n1) !== undefined) {
                    continue;
                }
                for (const n2 of this.stepTargets(p, n1, { diagonal: true, forest: false })) {
                    if (n2 === from || n2 === n1) {
                        continue;
                    }
                    out.push(`${u.type}${from}-${n1}-${n2}`);
                }
            }
        }
        return out;
    }

    /** Moves of two cavalry units one square each. Independent pairs are listed once, lower id first. */
    private twoCavalryMoves(player: playerid): string[] {
        const cavs = this.unitsOf(player).filter(u => u.type === "C" && this.canMove(u));
        const out: string[] = [];
        for (const u1 of cavs) {
            for (const u2 of cavs) {
                if (u1.id === u2.id) {
                    continue;
                }
                const from1 = u1.loc;
                for (const s1 of this.stepTargets(player, from1, { diagonal: true, forest: false })) {
                    u1.loc = s1;
                    const seconds = this.stepTargets(player, u2.loc, { diagonal: true, forest: false });
                    u1.loc = from1;
                    for (const s2 of seconds) {
                        if (u1.id < u2.id || s2 === from1) {
                            out.push(`C${from1}-${s1},C${u2.loc}-${s2}`);
                        }
                    }
                }
            }
        }
        return [...new Set(out)];
    }

    /* ---------------------------------------------------------- attacks */

    /** Friendly units that could support an attack on `target`. */
    private supporters(attacker: IUnit, target: string): IUnit[] {
        return this.unitsOf(attacker.owner).filter(s =>
            s.id !== attacker.id && this.canSupport(s) && adjacentTo(s.loc).includes(target) && this.pinAllows(s, target));
    }

    /** Every legal attack declaration for one unit, supported and unsupported. */
    private unitAttacks(u: IUnit): string[] {
        const out: string[] = [];
        const p = u.owner;
        const enemyReserve = RESERVES[otherPlayer(p)];
        const pins = this.enemyArtilleryNear(u.loc, p);
        if (pins.length > 1) {
            return out;
        }
        for (const t of connectedTo(u.loc)) {
            if (t === RESERVES[p]) {
                continue;
            }
            if (pins.length === 1 && t !== pins[0]) {
                continue;
            }
            let targetLabel: string;
            let defender: IUnit | undefined;
            if (t === enemyReserve) {
                if (this.reserveUnits(otherPlayer(p)).length === 0) {
                    continue;
                }
                targetLabel = t;
            } else {
                defender = this.unitAt(t);
                if (defender === undefined || defender.owner === p) {
                    continue;
                }
                if (u.type === "A" && defender.type !== "A") {
                    continue;
                }
                targetLabel = `${defender.type}${t}`;
            }
            if (!(u.type === "C" && defender !== undefined && defender.type === "I")) {
                out.push(`${u.type}${u.loc}>${targetLabel}`);
            }
            for (const s of this.supporters(u, t)) {
                out.push(`${u.type}${u.loc}+${s.type}${s.loc}>${targetLabel}`);
            }
        }
        return out;
    }

    /* ---------------------------------------------------------- retreats */

    /** True if `u` has a clear path to its reserve: adjacent steps, each strictly closer, none enemy-occupied. */
    public hasClearPath(u: IUnit): boolean {
        const p = u.owner;
        const goal = RESERVES[p];
        const seen = new Set<string>();
        const visit = (loc: string): boolean => {
            if (loc === goal) {
                return true;
            }
            if (seen.has(loc)) {
                return false;
            }
            seen.add(loc);
            for (const n of adjacentTo(loc)) {
                if (!isCloser(n, loc, p)) {
                    continue;
                }
                if (n !== goal) {
                    const occ = this.unitAt(n);
                    if (occ !== undefined && occ.owner !== p) {
                        continue;
                    }
                }
                if (visit(n)) {
                    return true;
                }
            }
            return false;
        };
        return visit(u.loc);
    }

    /** Forest squares a unit attacked in a forest may retreat into. */
    private forestRetreats(u: IUnit): string[] {
        if (!FORESTS.has(u.loc)) {
            return [];
        }
        return connectedTo(u.loc).filter(n =>
            FORESTS.has(n) && this.unitAt(n) === undefined && isCloser(n, u.loc, u.owner) && this.enemyArtilleryNear(n, u.owner).length === 0);
    }

    /** Every legal retreat for a cavalry unit, each possibly a chain of displacements. */
    public cavalryRetreats(u: IUnit): IStep[][] {
        const p = u.owner;
        const own = RESERVES[p];
        const closer = adjacentTo(u.loc).filter(n => n !== RESERVES[otherPlayer(p)] && isCloser(n, u.loc, p));
        const vacant = closer.filter(n => n === own || this.unitAt(n) === undefined);
        const step = (to: string): IStep => ({ unit: u.id, type: u.type, from: u.loc, to });
        if (vacant.length > 0) {
            return vacant.map(n => [step(n)]);
        }
        const out: IStep[][] = [];
        for (const n of closer) {
            const occ = this.unitAt(n);
            if (occ === undefined || occ.owner !== p) {
                continue;
            }
            for (const tail of this.displacedRetreats(occ)) {
                out.push([step(n), ...tail]);
            }
        }
        return out;
    }

    /** Retreats available to a unit displaced by friendly cavalry: its own rules, but never forest to forest. */
    private displacedRetreats(u: IUnit): IStep[][] {
        if (u.type === "C") {
            return this.cavalryRetreats(u);
        }
        if (this.hasClearPath(u)) {
            return [[{ unit: u.id, type: u.type, from: u.loc, to: RESERVES[u.owner] }]];
        }
        return [];
    }

    /** Retreats for the unit under attack, for the first response and for the second chance. */
    private defenderRetreats(u: IUnit): IStep[][] {
        const single = (to: string): IStep[] => [{ unit: u.id, type: u.type, from: u.loc, to }];
        switch (u.type) {
            case "C":
                return this.cavalryRetreats(u);
            case "I": {
                const out: IStep[][] = [];
                if (this.hasClearPath(u)) {
                    out.push(single(RESERVES[u.owner]));
                }
                for (const f of this.forestRetreats(u)) {
                    out.push(single(f));
                }
                return out;
            }
            case "A":
                return this.forestRetreats(u).map(f => single(f));
        }
    }

    /** Retreats for an attacking or supporting unit: always back to the reserve, or the cavalry procedure. */
    private supporterRetreats(u: IUnit): IStep[][] {
        if (u.type === "C") {
            return this.cavalryRetreats(u);
        }
        if (this.hasClearPath(u)) {
            return [[{ unit: u.id, type: u.type, from: u.loc, to: RESERVES[u.owner] }]];
        }
        return [];
    }

    /** Resolve a retreat specification such as `CB1L-B2L,IB2L-BR` against the current board. */
    private parseSteps(spec: string): IStep[] | undefined {
        if (spec.length === 0) {
            return undefined;
        }
        const steps: IStep[] = [];
        for (const part of spec.split(",")) {
            const m = STEP_RE.exec(part);
            if (m === null) {
                return undefined;
            }
            const u = this.unitAt(m[2]);
            if (u === undefined || u.type !== m[1] || !isLocation(m[3])) {
                return undefined;
            }
            steps.push({ unit: u.id, type: u.type, from: m[2], to: m[3] });
        }
        return steps;
    }

    /* ---------------------------------------------------------- combat */

    private defendingPlayer(): playerid {
        return otherPlayer(this.unit(this.combat!.attacker).owner);
    }

    /** Legal plies for whoever must act in the pending combat. */
    private combatOptions(): string[] {
        const c = this.combat;
        if (c === undefined) {
            return [];
        }
        switch (c.stage) {
            case "defend":
            case "second":
                return this.defenderResponses();
            case "resolve":
                return this.attackerOptions();
            case "advance":
                return ["advance", "stay"];
            case "lose":
                return this.loseOptions();
        }
    }

    private defenderResponses(): string[] {
        const c = this.combat!;
        const d = this.unit(c.defender!);
        const a = this.unit(c.attacker);
        const retreats = this.defenderRetreats(d);
        const unsupportedCavalry = c.supporter === undefined && a.type === "C";
        let canStand: boolean;
        if (c.flank) {
            canStand = retreats.length === 0;
        } else if (d.type === "C") {
            canStand = retreats.length === 0 || unsupportedCavalry || FORESTS.has(d.loc);
        } else {
            canStand = true;
        }
        const out: string[] = [];
        if (canStand) {
            out.push("stand");
        }
        for (const r of retreats) {
            out.push(`retreat:${fmtSteps(r)}`);
        }
        return out;
    }

    private attackerOptions(): string[] {
        const c = this.combat!;
        const a = this.unit(c.attacker);
        const s = this.unit(c.supporter!);
        const d = this.unit(c.defender!);
        const out: string[] = [];
        // Option 1 eliminates the defender before anyone retreats (unless the support is artillery,
        // whose retreat comes first), so those retreats are judged with the defender gone.
        const attackerCanRetreatAfterKill = a.type === "I" && this.without(d, () => this.hasClearPath(a));
        const supporterNow = this.supporterRetreats(s);
        const supporterAfterKill = s.type === "A" ? supporterNow : this.without(d, () => this.supporterRetreats(s));
        const withSteps = (opt: string, steps: IStep[]): string => s.type === "C" ? `${opt}:${fmtSteps(steps)}` : opt;
        if (attackerCanRetreatAfterKill) {
            for (const r of supporterAfterKill) {
                out.push(withSteps("option1", r));
            }
        }
        out.push("option2", "option3");
        if (a.type === "I" && this.hasClearPath(a)) {
            out.push("option4");
        }
        for (const r of supporterNow) {
            out.push(withSteps("option5", r));
        }
        return out;
    }

    private loseOptions(): string[] {
        const p = this.defendingPlayer();
        const present = new Set(this.reserveUnits(p).map(u => u.type));
        return UNIT_TYPES.filter(t => present.has(t)).map(t => `lose:${t}`);
    }

    private freeze(u: IUnit): void {
        u.frozenTurn = this.turnNo[u.owner - 1] + (u.owner === this.turnOwner ? 1 : 0);
    }

    private eliminate(u: IUnit, how: string): void {
        const where = u.loc;
        u.loc = "X";
        this.results.push({ type: "capture", where, what: UNIT_NAMES[u.type], whose: u.owner, how });
    }

    private applyRetreat(steps: IStep[], how = "retreat"): void {
        steps.forEach((s, idx) => {
            const u = this.unit(s.unit);
            u.loc = s.to;
            this.results.push({ type: "move", from: s.from, to: s.to, what: UNIT_NAMES[u.type], how: idx === 0 ? how : "displaced", by: `${u.owner}` });
            if (u.type !== "C") {
                this.freeze(u);
            }
        });
    }

    private homeStep(u: IUnit): IStep {
        return { unit: u.id, type: u.type, from: u.loc, to: RESERVES[u.owner] };
    }

    /** Offer the attacker an advance into the vacated square, unless it is artillery. */
    private toAdvance(): void {
        const c = this.combat!;
        if (this.unit(c.attacker).type === "A") {
            this.combat = undefined;
        } else {
            c.stage = "advance";
        }
    }

    private declareAttack(a: IUnit, target: string, s?: IUnit): void {
        const enemy = otherPlayer(a.owner);
        a.attackedNow = true;
        const defender = this.unitAt(target);
        const flank = s !== undefined && defender !== undefined
            && (isCloser(a.loc, target, enemy) || isCloser(s.loc, target, enemy));
        this.combat = {
            attacker: a.id,
            from: a.loc,
            target,
            supporter: s?.id,
            supportFrom: s?.loc,
            defender: defender?.id,
            flank,
            stage: "defend",
        };
        this.results.push({ type: "move", from: a.loc, to: target, what: UNIT_NAMES[a.type], how: "attack", by: `${a.owner}` });
        if (s !== undefined) {
            this.results.push({ type: "select", what: "support", where: s.loc, how: UNIT_NAMES[s.type], who: a.owner });
        }
        if (flank) {
            this.results.push({ type: "announce", payload: ["flank"] });
        }
        if (defender === undefined) {
            this.combat.stage = "lose";
        } else if (s === undefined && FORESTS.has(target)) {
            // An unsupported attack on a forest just costs the attacker.
            this.eliminate(a, "forest");
            this.combat = undefined;
        } else if (s === undefined && defender.type === "A") {
            // Artillery cannot retreat when attacked, and only other artillery can hurt it unsupported.
            if (a.type === "A") {
                this.eliminate(defender, "attack");
            }
            this.eliminate(a, a.type === "A" ? "attack" : "artillery");
            this.combat = undefined;
        }
        this.runCombat();
    }

    /** Advance the combat through every stage that has a single legal outcome; stop where someone must choose. */
    private runCombat(): void {
        while (this.combat !== undefined && !this.gameover) {
            const c = this.combat;
            const actor = (c.stage === "resolve" || c.stage === "advance") ? this.unit(c.attacker).owner : this.defendingPlayer();
            this.currplayer = actor;
            const options = this.combatOptions();
            if (options.length !== 1) {
                return;
            }
            this.applyCombatMove(options[0], true);
        }
    }

    private applyCombatMove(m: string, auto: boolean): void {
        const c = this.combat!;
        switch (c.stage) {
            case "defend":
                this.applyDefence(m, auto);
                break;
            case "second":
                this.applySecondChance(m, auto);
                break;
            case "resolve":
                this.applyOption(m);
                break;
            case "advance":
                this.applyAdvance(m);
                break;
            case "lose":
                this.applyLoss(m);
                break;
        }
    }

    private applyDefence(m: string, auto: boolean): void {
        const c = this.combat!;
        const d = this.unit(c.defender!);
        const a = this.unit(c.attacker);
        if (m === "stand") {
            this.results.push({ type: "select", what: "stand", where: d.loc, how: auto ? "forced" : "chosen", who: d.owner });
            if (c.supporter === undefined) {
                this.eliminate(d, "attack");
                this.eliminate(a, "attack");
                this.combat = undefined;
            } else if (c.flank) {
                this.eliminate(d, "flank");
                this.toAdvance();
            } else {
                c.stage = "resolve";
            }
            return;
        }
        this.applyRetreat(this.parseSteps(m.slice("retreat:".length))!);
        if (c.supporter === undefined) {
            this.combat = undefined;
        } else {
            this.toAdvance();
        }
    }

    private applySecondChance(m: string, auto: boolean): void {
        const c = this.combat!;
        const d = this.unit(c.defender!);
        const a = this.unit(c.attacker);
        if (m === "stand") {
            this.results.push({ type: "select", what: "stand", where: d.loc, how: auto ? "forced" : "chosen", who: d.owner });
            this.eliminate(d, "attack");
            this.applyRetreat([this.homeStep(a)]);
            this.combat = undefined;
            return;
        }
        this.applyRetreat(this.parseSteps(m.slice("retreat:".length))!);
        c.stage = "advance";
    }

    private applyOption(m: string): void {
        const c = this.combat!;
        const a = this.unit(c.attacker);
        const s = this.unit(c.supporter!);
        const d = this.unit(c.defender!);
        const [opt, spec] = m.split(":");
        const supporterSteps = (): IStep[] => spec === undefined ? [this.homeStep(s)] : this.parseSteps(spec)!;
        this.results.push({ type: "select", what: opt, who: a.owner });
        switch (opt) {
            case "option1":
                if (s.type === "A") {
                    // The guns limber up first, and the defender may then think again.
                    this.applyRetreat(supporterSteps());
                    c.stage = "second";
                } else {
                    this.eliminate(d, "attack");
                    this.applyRetreat(supporterSteps());
                    this.applyRetreat([this.homeStep(a)]);
                    this.combat = undefined;
                }
                break;
            case "option2":
                this.eliminate(d, "attack");
                this.eliminate(s, "attack");
                this.toAdvance();
                break;
            case "option3":
                this.eliminate(d, "attack");
                this.eliminate(a, "attack");
                this.combat = undefined;
                break;
            case "option4":
                this.applyRetreat([this.homeStep(a)]);
                this.combat = undefined;
                break;
            case "option5":
                this.applyRetreat(supporterSteps());
                this.combat = undefined;
                break;
            default:
                throw new Error(`Unknown attacker option "${m}".`);
        }
    }

    private applyAdvance(m: string): void {
        const c = this.combat!;
        const a = this.unit(c.attacker);
        if (m === "advance") {
            a.loc = c.target;
            this.results.push({ type: "move", from: c.from, to: c.target, what: UNIT_NAMES[a.type], how: "advance", by: `${a.owner}` });
        } else {
            this.results.push({ type: "select", what: "stay", where: c.from, who: a.owner });
        }
        this.combat = undefined;
    }

    private applyLoss(m: string): void {
        const c = this.combat!;
        const p = this.defendingPlayer();
        const t = m.slice("lose:".length) as UnitType;
        const candidates = this.reserveUnits(p).filter(u => u.type === t);
        // The owner gives up the unit with the least left to give: frozen first, then the longest streak.
        candidates.sort((x, y) => (Number(this.isFrozen(y)) - Number(this.isFrozen(x))) || (y.moveStreak - x.moveStreak));
        this.eliminate(candidates[0], "reserve");
        if (this.reserveUnits(p).length === 0 && c.supporter !== undefined) {
            this.toAdvance();
        } else {
            this.combat = undefined;
        }
    }

    /* ---------------------------------------------------------- plies */

    /**
     * Every legal ply. A ply is an action or a combat decision, followed by whatever further decisions
     * the same player has to make before the opponent gets a say, separated by slashes.
     */
    public moves(player?: playerid): string[] {
        if (this.gameover) {
            return [];
        }
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.combat !== undefined && player !== this.currplayer) {
            return [];
        }
        const heads = this.combat !== undefined ? this.combatOptions() : this.actionMoves(player);
        if (player !== this.currplayer) {
            return heads;
        }
        return heads.flatMap(h => this.completions(h));
    }

    /** The full plies that begin with `head`: it is extended by every decision the same player would still have to make. */
    private completions(head: string): string[] {
        const actor = this.currplayer;
        return this.simulate(() => {
            this.applyHead(head);
            return this.continuations(head, actor);
        });
    }

    private continuations(prefix: string, actor: playerid): string[] {
        if (!this.pending(actor)) {
            return [prefix];
        }
        return this.combatOptions().flatMap(d => this.simulate(() => {
            this.applyDecision(d);
            return this.continuations(`${prefix}/${d}`, actor);
        }));
    }

    /** Whether the ply being built still needs a decision from the player who began it. */
    private pending(actor: playerid): boolean {
        return this.combat !== undefined && this.currplayer === actor;
    }

    /** Run `fn` on the live position, then put everything back the way it was. */
    private simulate<T>(fn: () => T): T {
        const saved = {
            units: this.units,
            combat: this.combat,
            currplayer: this.currplayer,
            turnOwner: this.turnOwner,
            actionsLeft: this.actionsLeft,
            isDouble: this.isDouble,
            pendingDouble: this.pendingDouble,
            turnNo: this.turnNo,
            results: this.results,
            gameover: this.gameover,
            winner: this.winner,
        };
        this.units = cloneUnits(this.units);
        this.combat = this.combat === undefined ? undefined : { ...this.combat };
        this.pendingDouble = [...this.pendingDouble];
        this.turnNo = [...this.turnNo];
        this.results = [];
        this.winner = [...this.winner];
        try {
            return fn();
        } finally {
            Object.assign(this, saved);
        }
    }

    /** Every action open to `player`, as if it were their turn to act. */
    private actionMoves(player: playerid): string[] {
        const mine = player === this.turnOwner;
        const out: string[] = [];
        if (!mine || !this.isDouble) {
            out.push("pass");
        }
        const doubleAvailable = mine && this.actionsLeft === 2;
        for (const u of this.unitsOf(player)) {
            if (this.canMove(u)) {
                out.push(...this.unitMoves(u, doubleAvailable));
            }
            if (this.canAttack(u)) {
                out.push(...this.unitAttacks(u));
            }
        }
        out.push(...this.twoCavalryMoves(player));
        return [...new Set(out)];
    }

    public static normalise(m: string): string {
        return m.replace(/\s+/g, "").split("/").map(seg => seg
            .toUpperCase()
            .replace(/^(PASS|STAND|ADVANCE|STAY)$/, s => s.toLowerCase())
            .replace(/^(RETREAT|LOSE|OPTION[1-5]?)(?=:|$)/, s => s.toLowerCase())).join("/");
    }

    /** The unit that leaves a reserve: the least restricted one of the requested type. */
    private pickFromReserve(player: playerid, type: UnitType, exclude?: string): IUnit | undefined {
        const candidates = this.reserveUnits(player).filter(u => u.type === type && u.id !== exclude);
        candidates.sort((x, y) => (Number(this.isFrozen(x)) - Number(this.isFrozen(y))) || (x.moveStreak - y.moveStreak));
        return candidates[0];
    }

    /** The unit named by a move segment such as `IB3L` or `CBR`, for the given player. */
    private unitFor(player: playerid, type: string, loc: string, exclude?: string): IUnit | undefined {
        if (loc === RESERVES[player]) {
            return this.pickFromReserve(player, type as UnitType, exclude);
        }
        const u = this.unitAt(loc);
        if (u === undefined || u.owner !== player || u.type !== type) {
            return undefined;
        }
        return u;
    }

    /** Relocate units for a validated move string. Returns the unit whose move cost the whole double turn, if any. */
    private applyMove(move: string): IUnit | undefined {
        let doubleUnit: IUnit | undefined;
        let first: IUnit | undefined;
        for (const seg of move.split(",")) {
            const m = SEGMENT_RE.exec(seg)!;
            const u = this.unitFor(this.turnOwner, m[1], m[2], first?.id)!;
            first = first ?? u;
            const path = m[3].slice(1).split("-");
            const to = path[path.length - 1];
            const double = this.isDoubleCost(u, to);
            u.loc = to;
            u.movedNow = true;
            this.results.push({ type: "move", from: m[2], to, what: UNIT_NAMES[u.type], how: double ? "double" : "move", by: `${u.owner}` });
            if (double) {
                doubleUnit = u;
            }
        }
        return doubleUnit;
    }

    public move(m: string, { partial = false, trusted = false } = {}): SquaresGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        const move = SquaresGame.normalise(m);
        if (!trusted) {
            const result = this.validateMove(move);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
            if (result.complete === -1 && !partial) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", { move: m }));
            }
        }
        this.results = [];
        this.preview = undefined;
        if (partial) {
            this.applyPreview(move);
            return this;
        }
        const [head, ...decisions] = move.split("/");
        const walk = this.walkPly(head, decisions);
        const open = walk.points[walk.played];
        if (open !== undefined && open.stage === "advance") {
            // A ply that ends without saying whether to advance stays put.
            this.applyDecision("stay");
        }
        if (this.combat === undefined) {
            this.finishAction(walk.doubleUnit);
        }
        if (!this.gameover && this.combat === undefined) {
            this.checkRepetition();
        }
        this.lastmove = move;
        this.saveState();
        return this;
    }

    /**
     * Read a ply from the current position. The head is played (when there is one: a ply entered while
     * a combat already waits for this player has none), then every decision that falls to the same
     * player is visited in turn, and the segment entered for it is played as long as it is a legal
     * choice. The walk stops at the first segment that is missing, unfinished or not a legal choice,
     * or when nothing more is this player's to decide. The callers decide what that means: `move`
     * plays on, the validator reports, the preview draws, and the clicks pick up where it stopped.
     */
    private walkPly(head: string | undefined, decisions: string[]): IWalk {
        const actor = this.currplayer;
        const doubleUnit = head === undefined ? undefined : this.applyHead(head);
        const points: IDecisionPoint[] = [];
        let played = 0;
        while (this.pending(actor)) {
            const point: IDecisionPoint = { stage: this.combat!.stage, legal: this.combatOptions(), chosen: decisions[played] };
            points.push(point);
            if (point.chosen === undefined || !point.legal.includes(point.chosen)) {
                break;
            }
            this.applyDecision(point.chosen);
            played += 1;
        }
        return { points, played, doubleUnit };
    }

    /** Play the first segment of a ply: an action, or the decision a pending combat is waiting for. */
    private applyHead(head: string): IUnit | undefined {
        if (this.combat !== undefined) {
            this.applyDecision(head);
        } else if (head === "pass") {
            this.results.push({ type: "pass", who: this.turnOwner });
            this.pendingDouble[this.turnOwner - 1] = true;
        } else if (head.includes(">")) {
            const parts = ATTACK_RE.exec(head)!;
            const attacker = this.unitFor(this.turnOwner, parts[1], parts[2])!;
            const supporter = parts[3] === undefined ? undefined : this.unitFor(this.turnOwner, parts[3], parts[4])!;
            this.declareAttack(attacker, parts[7] ?? parts[6], supporter);
        } else {
            return this.applyMove(head);
        }
        return undefined;
    }

    /** Play one combat decision, and everything it settles. */
    private applyDecision(decision: string): void {
        this.applyCombatMove(decision, false);
        this.runCombat();
    }

    /** Show a move that is still being entered: play out what is settled, and outline what is still being chosen. */
    private applyPreview(move: string): void {
        const [head, ...decisions] = move.split("/");
        const before = cloneUnits(this.units);
        const preview: IPreview = { outline: [] };
        this.preview = preview;
        const headResult = this.combat !== undefined ? this.validateCombatMove(head) : this.validateAction(head);
        if (headResult.valid && headResult.complete !== -1) {
            // A legal head is played out, with every finished decision after it, to show where the ply leads.
            const walk = this.walkPly(head, decisions);
            preview.move = [head, ...decisions.slice(0, walk.played)].join("/");
            preview.ghosts = [...this.units.values()]
                .filter(u => u.loc === "X" && before.get(u.id)!.loc !== "X")
                .map(u => ({ ...u, loc: before.get(u.id)!.loc }));
            const unfinished = decisions[walk.played];
            if (unfinished !== undefined) {
                this.previewUnfinished(unfinished);
            }
            return;
        }
        if (this.combat !== undefined) {
            this.previewUnfinished(head);
            return;
        }
        if (head.includes(">")) {
            const m = ATTACK_RE.exec(head);
            if (m !== null) {
                const target = m[7] ?? m[6];
                this.outlineCell(m[2]);
                this.outlineCell(m[4]);
                this.outlineCell(target);
                preview.attack = { from: m[2], target, support: m[4] };
            }
            return;
        }
        let first: IUnit | undefined;
        for (const seg of head.split(",")) {
            const m = SEGMENT_RE.exec(seg);
            if (m === null) {
                continue;
            }
            const u = this.unitFor(this.turnOwner, m[1], m[2], first?.id);
            if (u === undefined) {
                continue;
            }
            first = first ?? u;
            this.outlineCell(m[2]);
            const steps = m[3].length === 0 ? [] : m[3].slice(1).split("-");
            const to = steps[steps.length - 1];
            if (to !== undefined && isLocation(to)) {
                u.loc = to;
                this.outlineCell(to);
                this.results.push({ type: "move", from: m[2], to, what: UNIT_NAMES[u.type], how: "move", by: `${u.owner}` });
            }
        }
    }

    private outlineCell(loc: string | undefined): void {
        if (loc !== undefined && isCell(loc)) {
            this.preview!.outline.push(loc);
        }
    }

    /** Sketch a decision that is still being entered. */
    private previewUnfinished(decision: string): void {
        if (decision === "option" && this.combat?.stage === "resolve" && this.combat.defender !== undefined) {
            // The defender has been marked for elimination; how the attack ends is still to be chosen.
            const d = this.unit(this.combat.defender);
            this.preview!.ghosts = [...(this.preview!.ghosts ?? []), { ...d }];
            return;
        }
        this.previewSteps(decision);
    }

    /** Sketch a retreat that is still being entered: relocate the units named so far and outline the squares involved. */
    private previewSteps(decision: string): void {
        const colon = decision.indexOf(":");
        const steps = colon < 0 ? undefined : this.parseSteps(decision.slice(colon + 1));
        if (steps === undefined) {
            return;
        }
        for (const st of steps) {
            const u = this.unit(st.unit);
            u.loc = st.to;
            this.outlineCell(st.from);
            this.outlineCell(st.to);
            this.results.push({ type: "move", from: st.from, to: st.to, what: UNIT_NAMES[u.type], how: "retreat", by: `${u.owner}` });
        }
    }

    /** Position signature for the repetition rule: what stands where, whose action it is, and every restriction in force. */
    private static signature(state: IMoveState): string {
        const head = `${state.turnOwner}${state.isDouble ? "d" : "s"}${state.actionsLeft}${state.pendingDouble.map(b => (b ? "1" : "0")).join("")}`;
        const units = [...state.units.values()]
            .filter(u => u.loc !== "X")
            .map(u => {
                const frozen = u.frozenTurn === undefined ? -1 : u.frozenTurn - state.turnNo[u.owner - 1];
                return `${u.loc}:${u.owner}${u.type}${u.moveStreak}${u.attackStreak}${frozen >= 0 ? `f${frozen}` : ""}`;
            })
            .sort();
        return `${head}|${units.join("|")}`;
    }

    /** Chess's rule, since the published rules have none: the same position with the same player to act, three times, is a draw. */
    private checkRepetition(): void {
        const current = SquaresGame.signature(this.moveState());
        let seen = 0;
        for (const state of this.stack) {
            if (state.combat === undefined && SquaresGame.signature(state) === current) {
                seen += 1;
            }
        }
        if (seen >= 2) {
            this.gameover = true;
            this.winner = [1, 2];
            this.results.push({ type: "eog", reason: "repetition" }, { type: "winners", players: [1, 2] });
        }
    }

    /* ---------------------------------------------------------- turns and scoring */

    /** Wrap up a fully resolved action: score it, then spend the turn (or both halves for a double-cost move). */
    private finishAction(doubleUnit?: IUnit): void {
        this.checkEOG();
        if (this.gameover) {
            return;
        }
        this.endTurnUnit(doubleUnit !== undefined);
        if (doubleUnit !== undefined && !this.gameover) {
            doubleUnit.movedNow = true;
            this.endTurnUnit();
        }
    }

    /** Close one turn (or one half of a double turn) for the turn owner and hand play on. */
    private endTurnUnit(skipStuckCheck = false): void {
        const p = this.turnOwner;
        for (const u of this.unitsOf(p)) {
            u.moveStreak = u.movedNow ? u.moveStreak + 1 : 0;
            u.attackStreak = u.attackedNow ? u.attackStreak + 1 : 0;
            u.movedNow = false;
            u.attackedNow = false;
        }
        this.turnNo[p - 1] += 1;
        this.actionsLeft -= 1;
        if (this.actionsLeft > 0) {
            this.currplayer = p;
            if (!skipStuckCheck) {
                this.checkStuck();
            }
            return;
        }
        const q = otherPlayer(p);
        this.turnOwner = q;
        this.currplayer = q;
        this.isDouble = this.pendingDouble[q - 1];
        this.pendingDouble[q - 1] = false;
        this.actionsLeft = this.isDouble ? 2 : 1;
        if (this.isDouble) {
            this.checkStuck();
        }
    }

    /** A player who cannot complete the actions a turn demands loses (only possible in a double turn). */
    private checkStuck(): void {
        if (this.actionMoves(this.turnOwner).length === 0) {
            this.gameover = true;
            this.winner = [otherPlayer(this.turnOwner)];
            this.results.push({ type: "eog", reason: "stuck" }, { type: "winners", players: [...this.winner] });
        }
    }

    /** Units `player` has lost, by type. */
    public losses(player: playerid): Record<UnitType, number> {
        const out: Record<UnitType, number> = { I: 0, A: 0, C: 0 };
        for (const u of this.units.values()) {
            if (u.owner === player && u.loc === "X") {
                out[u.type] += 1;
            }
        }
        return out;
    }

    /** Elimination points scored by `player`: artillery counts double, cavalry doubles once three or more are lost. */
    public points(player: playerid): number {
        const lost = this.losses(otherPlayer(player));
        return lost.I + 2 * lost.A + (lost.C >= 3 ? 2 : 1) * lost.C;
    }

    protected checkEOG(): SquaresGame {
        if (this.gameover) {
            return this;
        }
        for (const p of [1, 2] as playerid[]) {
            if (this.unitsOf(p).some(u => u.loc === RESERVES[otherPlayer(p)])) {
                this.gameover = true;
                this.winner = [p];
                this.results.push({ type: "eog", reason: "reserve" }, { type: "winners", players: [p] });
                return this;
            }
        }
        const p1 = this.points(1);
        const p2 = this.points(2);
        if (p1 < WIN_POINTS && p2 < WIN_POINTS) {
            return this;
        }
        this.gameover = true;
        if (p1 >= WIN_POINTS && p2 >= WIN_POINTS) {
            const count = (p: playerid): number => Object.values(this.losses(otherPlayer(p))).reduce((a, b) => a + b, 0);
            if (p1 !== p2) {
                this.winner = [p1 > p2 ? 1 : 2];
            } else if (count(1) !== count(2)) {
                this.winner = [count(1) > count(2) ? 1 : 2];
            } else {
                this.winner = [1, 2];
            }
        } else {
            this.winner = [p1 >= WIN_POINTS ? 1 : 2];
        }
        this.results.push({ type: "eog", reason: "points" }, { type: "winners", players: [...this.winner] });
        return this;
    }

    /* ---------------------------------------------------------- validation */

    private instructions(): string {
        if (this.combat === undefined) {
            return i18next.t("apgames:validation.squares.INITIAL_ACTION", { context: this.isDouble ? "double" : "single", count: this.actionsLeft });
        }
        return i18next.t(`apgames:validation.squares.INITIAL_${this.combat.stage.toUpperCase()}`);
    }

    private static valid(complete: -1 | 0 | 1, message?: string): IValidationResult {
        return { valid: true, complete, message: message ?? i18next.t("apgames:validation._general.VALID_MOVE") };
    }

    private static invalid(key: string, params?: Record<string, string | number>): IValidationResult {
        return { valid: false, message: i18next.t(`apgames:validation.squares.${key}`, params) };
    }

    public validateMove(m: string): IValidationResult {
        const move = SquaresGame.normalise(m);
        if (this.gameover) {
            return { valid: false, message: i18next.t("apgames:MOVES_GAMEOVER") };
        }
        if (move === "") {
            return SquaresGame.valid(-1, this.instructions());
        }
        const [head, ...decisions] = move.split("/");
        const headResult = this.combat !== undefined ? this.validateCombatMove(head) : this.validateAction(head);
        if (!headResult.valid) {
            return headResult;
        }
        let result = headResult;
        if (headResult.complete === -1) {
            if (decisions.length > 0) {
                return SquaresGame.invalid("DECISION_EARLY", { decision: decisions[0] });
            }
        } else {
            result = this.validateDecisions(head, headResult, decisions);
        }
        if (result.valid) {
            result.canrender = true;
        }
        return result;
    }

    /** Play a legal head out and check the decisions that follow it, which must all fall to the same player. */
    private validateDecisions(head: string, headResult: IValidationResult, decisions: string[]): IValidationResult {
        return this.simulate(() => {
            const walk = this.walkPly(head, decisions);
            const chosen = decisions.slice(0, walk.played);
            const open = walk.points[walk.played];
            if (decisions.length > walk.played) {
                // The first segment the walk did not play: nothing was left to decide, or it is no legal choice as it stands.
                const d = decisions[walk.played];
                if (open === undefined) {
                    return SquaresGame.invalid("DECISION_EXTRA", { decision: d });
                }
                const r = this.validateCombatMove(d);
                if (!r.valid) {
                    return r;
                }
                // An unfinished decision (a retreat still needing its square): anything after it comes too early.
                const next = decisions[walk.played + 1];
                return next === undefined ? r : SquaresGame.invalid("DECISION_EARLY", { decision: next });
            }
            if (open !== undefined) {
                // An advance left undecided means staying put, so only the options themselves are still needed.
                return SquaresGame.valid(open.stage === "advance" ? 0 : -1, this.plyPrompt(chosen, open.stage));
            }
            // Decisions are confirmed rather than submitted on the spot, so that clicks can still change them.
            return chosen.length === 0 ? headResult : SquaresGame.valid(0, this.plyPrompt(chosen));
        });
    }

    /** Describe the decisions a ply has settled so far, and what its author still has to choose. */
    private plyPrompt(chosen: string[], pendingStage?: CombatStage): string {
        const t = (key: string, params?: Record<string, string>): string => i18next.t(`apgames:validation.squares.${key}`, params);
        const parts: string[] = [];
        const option = chosen.find(d => d.startsWith("option"));
        const advance = chosen.find(d => d === "advance" || d === "stay");
        if (option !== undefined) {
            parts.push(t("PLY_OPTION", { n: option[6], what: t(`OPTION_${option[6]}`) }));
        }
        if (pendingStage === "resolve") {
            parts.push(t("PLY_CHOOSE_OPTION"));
            return parts.join(" ");
        }
        if (pendingStage === "advance") {
            parts.push(t("PLY_CHOOSE_ADVANCE"));
        } else {
            if (advance === "advance") {
                parts.push(t("PLY_ADVANCED"));
            } else if (advance === "stay") {
                parts.push(t("PLY_STAYED"));
            }
            parts.push(t("PLY_COMPLETE"));
        }
        if (option !== undefined || advance !== undefined) {
            parts.push(t("PLY_AGAIN"));
        }
        return parts.join(" ");
    }

    private validateCombatMove(move: string): IValidationResult {
        const legal = this.combatOptions();
        if (legal.includes(move)) {
            return SquaresGame.valid(1);
        }
        if (move === "option" && this.combat!.stage === "resolve" && legal.some(l => /^option[123]/.test(l))) {
            // The defender has been clicked: it will be eliminated, one way or another.
            return SquaresGame.valid(-1, i18next.t("apgames:validation.squares.DECIDE_ELIMINATED"));
        }
        // A prefix of a legal choice: a bare option or `retreat:` still needing a square, or a chain still to be finished.
        const boundary = (l: string): boolean => move.endsWith(":") || l[move.length] === ":" || l[move.length] === ",";
        if (legal.some(l => l.startsWith(move) && boundary(l))) {
            let key = "CHAIN_CONTINUE";
            if (this.combat!.stage === "lose") {
                key = "CHOOSE_LOSS";
            } else if (!move.includes(":") || move.endsWith(":")) {
                key = "CHOOSE_RETREAT";
            }
            return SquaresGame.valid(-1, i18next.t(`apgames:validation.squares.${key}`));
        }
        return this.diagnoseCombatMove(move, legal);
    }

    /** Explain a rejected combat decision, in particular why a retreat square is not allowed. */
    private diagnoseCombatMove(move: string, legal: string[]): IValidationResult {
        const c = this.combat!;
        if (move === "stand" && (c.stage === "defend" || c.stage === "second")) {
            return SquaresGame.invalid(c.flank ? "STAND_FLANK" : "STAND_CAVALRY");
        }
        const m = /^(retreat|option1|option5):(.+)$/.exec(move);
        if (m !== null && c.stage !== "lose" && c.stage !== "advance") {
            const steps = this.parseSteps(m[2]);
            if (steps !== undefined) {
                let bad = steps.length - 1;
                for (let i = 0; i < steps.length; i++) {
                    const prefix = `${m[1]}:${fmtSteps(steps.slice(0, i + 1))}`;
                    if (!legal.some(l => l === prefix || l.startsWith(`${prefix},`))) {
                        bad = i;
                        break;
                    }
                }
                const role = bad > 0 ? "displaced" : (m[1] === "retreat" ? "defender" : "supporter");
                return this.diagnoseRetreat(this.unit(steps[bad].unit), steps[bad].to, role);
            }
        }
        if (c.stage === "resolve" && /^option[1-5]/.test(move)) {
            return SquaresGame.invalid("OPTION_UNAVAILABLE");
        }
        return SquaresGame.invalid("ILLEGAL_RESPONSE", { move });
    }

    private diagnoseRetreat(u: IUnit, to: string, role: "defender" | "supporter" | "displaced"): IValidationResult {
        const p = u.owner;
        const from = u.loc;
        if (!isLocation(to)) {
            return { valid: false, message: i18next.t("apgames:validation._general.INVALIDCELL", { cell: to }) };
        }
        if (to === from) {
            return { valid: false, message: i18next.t("apgames:validation._general.SAME_FROM_TO") };
        }
        if (to === RESERVES[otherPlayer(p)]) {
            return SquaresGame.invalid("RETREAT_ENEMY_RESERVE");
        }
        if (u.type === "C") {
            if (!adjacentTo(from).includes(to)) {
                return SquaresGame.invalid("RETREAT_NOT_ADJACENT", { from, to });
            }
            if (!isCloser(to, from, p)) {
                return SquaresGame.invalid("RETREAT_NOT_CLOSER", { from, to });
            }
            const occ = this.unitAt(to);
            if (occ !== undefined && occ.owner !== p) {
                return SquaresGame.invalid("RETREAT_ENEMY_OCCUPIED", { to });
            }
            if (occ !== undefined) {
                const vacant = adjacentTo(from).filter(n => n !== RESERVES[otherPlayer(p)] && isCloser(n, from, p) && (n === RESERVES[p] || this.unitAt(n) === undefined));
                if (vacant.length > 0) {
                    return SquaresGame.invalid("RETREAT_VACANT_FIRST", { to, vacant: vacant.join(", ") });
                }
                return SquaresGame.invalid("RETREAT_CHAIN_BLOCKED", { to });
            }
            return SquaresGame.invalid("ILLEGAL_RESPONSE", { move: `${u.type}${from}-${to}` });
        }
        if (isCell(to)) {
            if (!FORESTS.has(to)) {
                return SquaresGame.invalid("RETREAT_TO_RESERVE_ONLY");
            }
            if (role !== "defender") {
                return SquaresGame.invalid("RETREAT_FOREST_DISPLACED");
            }
            if (!FORESTS.has(from)) {
                return SquaresGame.invalid("RETREAT_FOREST_FROM_CLEAR");
            }
            if (!connectedTo(from).includes(to)) {
                return SquaresGame.invalid("RETREAT_FOREST_ADJACENT", { to });
            }
            if (!isCloser(to, from, p)) {
                return SquaresGame.invalid("RETREAT_NOT_CLOSER", { from, to });
            }
            if (this.unitAt(to) !== undefined) {
                return { valid: false, message: i18next.t("apgames:validation._general.OCCUPIED", { where: to }) };
            }
            if (this.enemyArtilleryNear(to, p).length > 0) {
                return SquaresGame.invalid("RETREAT_FOREST_GUNS", { to });
            }
            return SquaresGame.invalid("ILLEGAL_RESPONSE", { move: `${u.type}${from}-${to}` });
        }
        if (u.type === "A" && role === "defender") {
            return SquaresGame.invalid("RETREAT_ARTILLERY");
        }
        if (!this.hasClearPath(u)) {
            return SquaresGame.invalid("RETREAT_NO_PATH");
        }
        return SquaresGame.invalid("ILLEGAL_RESPONSE", { move: `${u.type}${from}-${to}` });
    }

    private validateAction(move: string): IValidationResult {
        const p = this.currplayer;
        if (move === "pass") {
            if (this.isDouble) {
                return SquaresGame.invalid("NO_PASS_DOUBLE");
            }
            return SquaresGame.valid(1);
        }
        if (move.includes(">")) {
            return this.validateAttack(move);
        }
        const segments = move.split(",");
        const parsed = segments.map(seg => SEGMENT_RE.exec(seg));
        if (segments.length > 2 || parsed.some(x => x === null)) {
            return { valid: false, message: i18next.t("apgames:validation._general.INVALID_MOVE", { move }) };
        }
        const t1 = parsed[0]![1] as UnitType;
        const from1 = parsed[0]![2];
        const steps1 = parsed[0]![3].length === 0 ? [] : parsed[0]![3].slice(1).split("-");
        if (!isLocation(from1)) {
            return { valid: false, message: i18next.t("apgames:validation._general.INVALIDCELL", { cell: from1 }) };
        }
        const u1 = this.unitFor(p, t1, from1);
        if (u1 === undefined) {
            return SquaresGame.invalid("NO_SUCH_UNIT", { what: UNIT_NAMES[t1], where: from1 });
        }
        if (steps1.length === 0) {
            if (segments.length > 1) {
                return { valid: false, message: i18next.t("apgames:validation._general.INVALID_MOVE", { move }) };
            }
            if (!this.canMove(u1) && !this.canAttack(u1)) {
                return this.isFrozen(u1) ? SquaresGame.invalid("FROZEN", { where: from1 }) : SquaresGame.invalid("EXHAUSTED", { where: from1 });
            }
            return SquaresGame.valid(-1, i18next.t("apgames:validation.squares.PARTIAL_UNIT", { context: UNIT_NAMES[t1] }));
        }
        if (segments.length === 1) {
            const legal = this.canMove(u1) ? this.unitMoves(u1, this.actionsLeft === 2) : [];
            if (legal.includes(move)) {
                if (u1.type === "C" && steps1.length === 1 && !FORESTS.has(steps1[0])) {
                    const extendable = legal.some(l => l.startsWith(`${move}-`))
                        || this.unitsOf(p).some(o => o.type === "C" && o.id !== u1.id && this.canMove(o));
                    return SquaresGame.valid(extendable ? 0 : 1, extendable ? i18next.t("apgames:validation.squares.PARTIAL_CAVALRY") : undefined);
                }
                return SquaresGame.valid(1);
            }
            return this.diagnoseMove(u1, steps1);
        }
        // two cavalry units, one square each, applied in order
        const t2 = parsed[1]![1] as UnitType;
        const from2 = parsed[1]![2];
        const steps2 = parsed[1]![3].length === 0 ? [] : parsed[1]![3].slice(1).split("-");
        if (t1 !== "C" || t2 !== "C") {
            return SquaresGame.invalid("TWO_CAVALRY_ONLY");
        }
        if (steps1.length !== 1 || FORESTS.has(steps1[0])) {
            return SquaresGame.invalid("TWO_CAVALRY_ONE_STEP");
        }
        if (!this.canMove(u1) || !this.stepTargets(p, from1, { diagonal: true, forest: false }).includes(steps1[0])) {
            return this.diagnoseMove(u1, steps1);
        }
        const saved = u1.loc;
        u1.loc = steps1[0];
        try {
            if (!isLocation(from2)) {
                return { valid: false, message: i18next.t("apgames:validation._general.INVALIDCELL", { cell: from2 }) };
            }
            const u2 = this.unitFor(p, t2, from2, u1.id);
            if (u2 === undefined) {
                return SquaresGame.invalid("NO_SUCH_UNIT", { what: UNIT_NAMES[t2], where: from2 });
            }
            if (u2.id === u1.id) {
                return SquaresGame.invalid("TWO_CAVALRY_SAME");
            }
            if (steps2.length === 0) {
                return SquaresGame.valid(-1, i18next.t("apgames:validation.squares.PARTIAL_UNIT", { context: UNIT_NAMES.C }));
            }
            if (steps2.length !== 1 || FORESTS.has(steps2[0])) {
                return SquaresGame.invalid("TWO_CAVALRY_ONE_STEP");
            }
            if (!this.canMove(u2) || !this.stepTargets(p, from2, { diagonal: true, forest: false }).includes(steps2[0])) {
                return this.diagnoseMove(u2, steps2);
            }
            return SquaresGame.valid(1);
        } finally {
            u1.loc = saved;
        }
    }

    /** Explain why a movement of `u` along `steps` is not legal. */
    private diagnoseMove(u: IUnit, steps: string[]): IValidationResult {
        const p = u.owner;
        const to = steps[steps.length - 1];
        for (const s of steps) {
            if (!isLocation(s)) {
                return { valid: false, message: i18next.t("apgames:validation._general.INVALIDCELL", { cell: s }) };
            }
        }
        if (this.isFrozen(u)) {
            return SquaresGame.invalid("FROZEN", { where: u.loc });
        }
        if (u.moveStreak >= MAX_STREAK) {
            return SquaresGame.invalid("MOVE_LIMIT", { where: u.loc });
        }
        if (steps.length > 2) {
            return SquaresGame.invalid("TOO_FAR");
        }
        if (steps.length === 2 && u.type !== "C") {
            return SquaresGame.invalid("TWO_STEPS_CAVALRY");
        }
        if (to === u.loc) {
            return { valid: false, message: i18next.t("apgames:validation._general.SAME_FROM_TO") };
        }
        if (to === RESERVES[otherPlayer(p)]) {
            if (this.reserveUnits(otherPlayer(p)).length > 0) {
                return SquaresGame.invalid("RESERVE_OCCUPIED");
            }
        } else if (to !== RESERVES[p] && this.unitAt(to) !== undefined) {
            return { valid: false, message: i18next.t("apgames:validation._general.OCCUPIED", { where: to }) };
        }
        if (steps.length === 1) {
            if (!adjacentTo(u.loc).includes(to)) {
                return SquaresGame.invalid("NOT_ADJACENT", { from: u.loc, to });
            }
            if (FORESTS.has(to)) {
                if (this.actionsLeft !== 2) {
                    return SquaresGame.invalid("FOREST_DOUBLE");
                }
                return SquaresGame.invalid("FROZEN", { where: u.loc });
            }
            if (u.type === "I" && diagonalTo(u.loc).includes(to)) {
                if (this.actionsLeft !== 2) {
                    return SquaresGame.invalid("DIAGONAL_DOUBLE");
                }
                return SquaresGame.invalid("FROZEN", { where: u.loc });
            }
            return SquaresGame.invalid("ILLEGAL_MOVE", { move: `${u.type}${u.loc}-${to}` });
        }
        const mid = steps[0];
        if (!adjacentTo(u.loc).includes(mid) || !adjacentTo(mid).includes(to)) {
            return SquaresGame.invalid("NOT_ADJACENT", { from: u.loc, to });
        }
        if (FORESTS.has(mid) || FORESTS.has(to)) {
            return SquaresGame.invalid("FOREST_TWO_STEPS");
        }
        if (mid === RESERVES[otherPlayer(p)]) {
            return SquaresGame.invalid("THROUGH_ENEMY_RESERVE");
        }
        if (mid !== RESERVES[p] && this.unitAt(mid) !== undefined) {
            return SquaresGame.invalid("PATH_BLOCKED", { where: mid });
        }
        return SquaresGame.invalid("ILLEGAL_MOVE", { move: `${u.type}${u.loc}-${steps.join("-")}` });
    }

    private validateAttack(move: string): IValidationResult {
        const p = this.currplayer;
        const m = ATTACK_RE.exec(move);
        if (m === null) {
            return { valid: false, message: i18next.t("apgames:validation._general.INVALID_MOVE", { move }) };
        }
        const [, ta, la, ts, ls, td, ld, reserve] = m;
        if (!isCell(la)) {
            return SquaresGame.invalid("ATTACK_FROM_RESERVE");
        }
        const a = this.unitFor(p, ta, la);
        if (a === undefined) {
            return SquaresGame.invalid("NO_SUCH_UNIT", { what: UNIT_NAMES[ta as UnitType], where: la });
        }
        if (this.isFrozen(a)) {
            return SquaresGame.invalid("FROZEN", { where: la });
        }
        if (a.attackStreak >= MAX_STREAK) {
            return SquaresGame.invalid("ATTACK_LIMIT", { where: la });
        }
        const target = reserve ?? ld;
        let defender: IUnit | undefined;
        if (reserve !== undefined) {
            if (reserve === RESERVES[p]) {
                return SquaresGame.invalid("OWN_RESERVE");
            }
            if (this.reserveUnits(otherPlayer(p)).length === 0) {
                return SquaresGame.invalid("RESERVE_EMPTY");
            }
        } else {
            if (!isCell(ld)) {
                return { valid: false, message: i18next.t("apgames:validation._general.INVALIDCELL", { cell: ld }) };
            }
            defender = this.unitAt(ld);
            if (defender === undefined || defender.owner === p) {
                return SquaresGame.invalid("NO_TARGET", { where: ld });
            }
            if (defender.type !== td) {
                return SquaresGame.invalid("WRONG_TYPE", { where: ld, what: UNIT_NAMES[defender.type] });
            }
        }
        if (!connectedTo(la).includes(target)) {
            return SquaresGame.invalid("NOT_CONNECTED", { from: la, to: target });
        }
        if (a.type === "A" && defender !== undefined && defender.type !== "A") {
            return SquaresGame.invalid("ARTILLERY_TARGET");
        }
        if (!this.pinAllows(a, target)) {
            return SquaresGame.invalid("PINNED", { where: la });
        }
        let s: IUnit | undefined;
        if (ts !== undefined) {
            if (!isCell(ls)) {
                return SquaresGame.invalid("SUPPORT_FROM_RESERVE");
            }
            s = this.unitFor(p, ts, ls);
            if (s === undefined) {
                return SquaresGame.invalid("NO_SUCH_UNIT", { what: UNIT_NAMES[ts as UnitType], where: ls });
            }
            if (s.id === a.id) {
                return SquaresGame.invalid("SUPPORT_SELF");
            }
            if (this.isFrozen(s)) {
                return SquaresGame.invalid("FROZEN", { where: ls });
            }
            if (!adjacentTo(ls).includes(target)) {
                return SquaresGame.invalid("SUPPORT_NOT_ADJACENT", { where: ls, target });
            }
            if (!this.pinAllows(s, target)) {
                return SquaresGame.invalid("PINNED", { where: ls });
            }
        } else if (a.type === "C" && defender !== undefined && defender.type === "I") {
            // Illegal on its own, but a legitimate step on the way to a supported attack.
            if (this.supporters(a, target).length > 0) {
                return SquaresGame.valid(-1, i18next.t("apgames:validation.squares.CAVALRY_NEEDS_SUPPORT"));
            }
            return SquaresGame.invalid("CAVALRY_NO_SUPPORT");
        }
        if (s === undefined && this.supporters(a, target).length > 0) {
            return SquaresGame.valid(0, i18next.t("apgames:validation.squares.PARTIAL_SUPPORT"));
        }
        return SquaresGame.valid(1);
    }

    /* ---------------------------------------------------------- clicks */

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let loc: string | undefined;
            let clickedType: UnitType | undefined;
            if (row >= 0 && col >= 0) {
                loc = CELL_ROWS[row]?.[col];
            } else if (piece === "_reserves_N") {
                loc = NORTH_RESERVE;
            } else if (piece === "_reserves_S") {
                loc = SOUTH_RESERVE;
            } else if (piece !== undefined && /^[BG][IAC]/.test(piece)) {
                // A piece in a strip, whether plain, framed as just arrived or faded as about to be lost.
                loc = piece[0] === "B" ? NORTH_RESERVE : SOUTH_RESERVE;
                clickedType = piece[1] as UnitType;
            }
            if (loc === undefined) {
                return { move, valid: false, message: i18next.t("apgames:validation._general.UNKNOWN_CLICK") };
            }
            const current = SquaresGame.normalise(move);
            const newmove = this.clickPly(current, loc, clickedType);
            const result = this.validateMove(newmove) as IClickResult;
            result.move = result.valid ? newmove : current;
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", { move, row, col, piece, emessage: (e as Error).message }),
            };
        }
    }

    /**
     * Route a click. While an action is being entered it goes to `clickAction`; while the defender is answering,
     * to `clickDefence`. Once the attacker has decisions to make (after an attack just entered, or in a combat
     * already waiting for them), it goes to `clickDecision`.
     */
    private clickPly(move: string, loc: string, clickedType?: UnitType): string {
        const segments = move === "" ? [] : move.split("/");
        let prefix: string[];
        let decisions: string[];
        let squares: ICombatSquares | undefined;
        if (this.combat === undefined) {
            const head = segments[0] ?? "";
            const headResult = head === "" ? undefined : this.validateAction(head);
            if (headResult === undefined || !headResult.valid || headResult.complete === -1) {
                return this.clickAction(head, loc, clickedType);
            }
            prefix = [head];
            decisions = segments.slice(1);
            squares = SquaresGame.attackSquares(head);
        } else if (this.combat.stage === "resolve" || this.combat.stage === "advance") {
            prefix = [];
            decisions = segments;
            squares = { from: this.combat.from, target: this.combat.target, support: this.combat.supportFrom };
        } else {
            return this.clickDefence(move, loc, clickedType);
        }
        if (squares === undefined) {
            return this.clickAction(prefix[0], loc, clickedType);
        }
        const walk = this.simulate(() => this.walkPly(prefix[0], decisions));
        if (walk.points.length === 0) {
            return this.clickAction(prefix[0] ?? "", loc, clickedType);
        }
        return this.clickDecision(move, prefix, decisions, walk.points, squares, loc);
    }

    private static attackSquares(head: string): ICombatSquares | undefined {
        const m = ATTACK_RE.exec(head);
        return m === null ? undefined : { from: m[2], target: m[7] ?? m[6], support: m[4] };
    }

    /**
     * The attacker's decisions, by clicking the units involved. Clicking the defender eliminates it; then clicking
     * it again withdraws both attacking units afterwards (option 1), clicking the support gives that up instead
     * (option 2), and clicking the attacker exchanges it (option 3). Clicking the attacker or the support
     * straight away withdraws that unit (options 4 and 5), with its retreat square clicked next if it has a
     * choice. Once the target square is empty, clicking it advances, and clicking the attacker's own square stays
     * put. A click on any other square starts the decision again.
     */
    private clickDecision(move: string, prefix: string[], decisions: string[], points: IDecisionPoint[], squares: ICombatSquares, loc: string): string {
        const level = points.length - 1;
        const last = points[level];
        const set = (at: number, decision?: string): string => [...prefix, ...decisions.slice(0, at), ...(decision === undefined ? [] : [decision])].join("/");
        const resolveAt = points.findIndex(p => p.stage === "resolve");
        const chosen = resolveAt < 0 ? undefined : points[resolveAt].chosen;
        const number = chosen === undefined ? undefined : /^option([1-5])/.exec(chosen)?.[1];
        const pick = (n: number): string => SquaresGame.optionEntry(points[resolveAt].legal, n);
        if (last.chosen !== undefined && !last.legal.includes(last.chosen)) {
            // A retreat under option 1 or 5 still needs its square, or the next link of a displacement chain.
            const extended = this.extendRetreat(last.chosen, squares, loc);
            if (extended !== undefined) {
                return set(level, extended);
            }
        }
        if (resolveAt < 0) {
            // Only the advance is left to decide.
            if (loc === squares.target) {
                return set(level, "advance");
            }
            if (loc === squares.from) {
                return set(level, "stay");
            }
            return decisions.length === 0 ? move : set(0);
        }
        if (loc === squares.target) {
            if (chosen === undefined) {
                return set(resolveAt, "option");
            }
            if (chosen === "option") {
                return set(resolveAt, pick(1));
            }
            return number === "2" ? set(resolveAt + 1, "advance") : set(resolveAt, "option");
        }
        if (loc === squares.from) {
            if (chosen === "option") {
                return set(resolveAt, pick(3));
            }
            return number === "2" ? set(resolveAt + 1, "stay") : set(resolveAt, pick(4));
        }
        if (loc === squares.support) {
            return set(resolveAt, pick(chosen === "option" ? 2 : 5));
        }
        return decisions.length === 0 ? move : set(0);
    }

    /** Extend a retreat still being entered for option 1 or 5 with the clicked square, when that is a plausible destination. */
    private extendRetreat(chosen: string, squares: ICombatSquares, loc: string): string | undefined {
        const m = /^(option[15])(?::(.*))?$/.exec(chosen);
        if (m === null || squares.support === undefined) {
            return undefined;
        }
        const plausible = (u: IUnit): boolean => loc === RESERVES[u.owner] || adjacentTo(u.loc).includes(loc);
        if (m[2] === undefined || m[2] === "") {
            const s = this.unitAt(squares.support);
            return s !== undefined && plausible(s) ? `${m[1]}:${s.type}${s.loc}-${loc}` : undefined;
        }
        const steps = this.parseSteps(m[2]);
        if (steps === undefined) {
            return undefined;
        }
        const lastTo = steps[steps.length - 1].to;
        const occ = this.unitAt(lastTo);
        if (occ !== undefined && occ.owner === this.currplayer && !steps.some(st => st.unit === occ.id) && plausible(occ)) {
            return `${chosen},${occ.type}${lastTo}-${loc}`;
        }
        return undefined;
    }

    private clickAction(move: string, loc: string, clickedType?: UnitType): string {
        const p = this.currplayer;
        const enemy = RESERVES[otherPlayer(p)];
        const clickedUnit = this.unitAt(loc);
        const ownLabel = (): string | undefined => {
            if (clickedUnit !== undefined && clickedUnit.owner === p) {
                return `${clickedUnit.type}${loc}`;
            }
            if (loc === RESERVES[p] && clickedType !== undefined && this.reserveUnits(p).some(u => u.type === clickedType)) {
                return `${clickedType}${loc}`;
            }
            return undefined;
        };
        if (move === "") {
            return ownLabel() ?? "";
        }
        if (move.includes(">")) {
            const m = ATTACK_RE.exec(move);
            if (m !== null && m[3] === undefined && clickedUnit !== undefined && clickedUnit.owner === p && loc !== m[2]) {
                return `${m[1]}${m[2]}+${clickedUnit.type}${loc}>${move.split(">")[1]}`;
            }
            return ownLabel() ?? "";
        }
        const segments = move.split(",");
        const last = segments[segments.length - 1];
        const parsed = SEGMENT_RE.exec(last);
        if (parsed === null) {
            return ownLabel() ?? "";
        }
        const selType = parsed[1] as UnitType;
        const selLoc = parsed[2];
        const steps = parsed[3].length === 0 ? [] : parsed[3].slice(1).split("-");
        const other = ownLabel();
        if (steps.length === 0) {
            if (loc === selLoc && (clickedType === undefined || clickedType === selType)) {
                return segments.length === 1 ? "" : segments[0];
            }
            if (other !== undefined) {
                return segments.length === 1 ? other : `${segments[0]},${other}`;
            }
            if (segments.length === 1 && isCell(selLoc)) {
                if (clickedUnit !== undefined && clickedUnit.owner !== p) {
                    return `${last}>${clickedUnit.type}${loc}`;
                }
                if (loc === enemy && this.reserveUnits(otherPlayer(p)).length > 0) {
                    return `${last}>${loc}`;
                }
            }
            if (segments.length === 1 && selType === "C") {
                // Cavalry may be sent straight to a square two steps away; the engine picks the path.
                const direct = `${last}-${loc}`;
                const unit = this.unitFor(p, selType, selLoc);
                if (unit !== undefined && this.canMove(unit)) {
                    const legal = this.unitMoves(unit, this.actionsLeft === 2);
                    if (!legal.includes(direct)) {
                        const twoStep = legal.find(m => m.startsWith(`${last}-`) && m.endsWith(`-${loc}`) && m.split("-").length === 3);
                        if (twoStep !== undefined) {
                            return twoStep;
                        }
                    }
                }
            }
            return `${move}-${loc}`;
        }
        if (loc === steps[steps.length - 1]) {
            // Clicking the square the piece has just been shown moving to changes nothing.
            return move;
        }
        if (other !== undefined) {
            if (other === `${selType}${selLoc}`) {
                // The moving unit's own origin: a second cavalry still in the reserve joins the move; otherwise clear.
                if (segments.length === 1 && selType === "C" && steps.length === 1 && isReserve(selLoc)
                    && this.reserveUnits(p).filter(u => u.type === "C").length > 1) {
                    return `${move},${other}`;
                }
                return "";
            }
            if (segments.length === 1 && selType === "C" && other.startsWith("C") && steps.length === 1) {
                return `${move},${other}`;
            }
            return other;
        }
        if (segments.length === 1 && selType === "C" && steps.length === 1) {
            return `${move}-${loc}`;
        }
        return `${selType}${selLoc}-${loc}`;
    }

    /** The defender's clicks: its own square to stand, a square or the reserve to retreat to (chains link on), or a piece in the strip to give up. */
    private clickDefence(move: string, loc: string, clickedType?: UnitType): string {
        const c = this.combat!;
        if (c.stage === "lose") {
            return clickedType !== undefined && loc === RESERVES[this.defendingPlayer()] ? `lose:${clickedType}` : move;
        }
        const d = this.unit(c.defender!);
        if (move.startsWith("retreat:")) {
            const steps = this.parseSteps(move.slice("retreat:".length));
            if (steps !== undefined) {
                const lastTo = steps[steps.length - 1].to;
                const occ = this.unitAt(lastTo);
                if (occ !== undefined && occ.owner === d.owner && !steps.some(st => st.unit === occ.id)) {
                    return `${move},${occ.type}${lastTo}-${loc}`;
                }
            }
        }
        return loc === d.loc ? "stand" : `retreat:${d.type}${d.loc}-${loc}`;
    }

    /**
     * How option `n` is entered, given the legal choices: its one legal form, `optionN:` when a retreat
     * square must still follow, or `optionN` alone when it is not available (the validator says why).
     */
    private static optionEntry(legal: string[], n: number): string {
        const matches = legal.filter(l => l === `option${n}` || l.startsWith(`option${n}:`));
        if (matches.length === 1) {
            return matches[0];
        }
        return matches.length === 0 ? `option${n}` : `option${n}:`;
    }

    /* ---------------------------------------------------------- buttons */

    /** Buttons for the decisions that clicks alone cannot express; each label is an i18n key under `apgames:buttons`. */
    public getButtons(): ICustomButton[] {
        if (this.gameover) {
            return [];
        }
        // Part-way through a ply (the front asks the previewed position), only the decisions its author
        // still has to make are offered, as continuations of what has been entered.
        const prefix = this.preview?.move;
        const c = this.combat;
        if (c === undefined) {
            return prefix === undefined && !this.isDouble ? [{ label: "apgames:buttons.pass", move: "pass" }] : [];
        }
        if (prefix !== undefined && this.currplayer !== this.stack[this.stack.length - 1].currplayer) {
            return [];
        }
        const legal = this.combatOptions();
        const buttons: ICustomButton[] = [];
        const add = (label: string, move: string): void => {
            buttons.push({ label: `apgames:buttons.squares.${label}`, move: prefix === undefined ? move : `${prefix}/${move}` });
        };
        switch (c.stage) {
            case "defend":
            case "second": {
                if (legal.includes("stand")) {
                    add("stand", "stand");
                }
                const home = legal.find(l => /^retreat:[IAC][A-Z0-9]+-(BR|GR)$/.test(l));
                if (home !== undefined) {
                    add("retreatReserve", home);
                }
                if (legal.some(l => l.startsWith("retreat:") && l !== home)) {
                    add("retreat", "retreat:");
                }
                break;
            }
            case "resolve":
                for (const n of [1, 2, 3, 4, 5]) {
                    if (legal.some(l => l.startsWith(`option${n}`))) {
                        add(`option${n}`, SquaresGame.optionEntry(legal, n));
                    }
                }
                break;
            case "advance":
                add("advance", "advance");
                add("stay", "stay");
                break;
            case "lose":
                for (const l of legal) {
                    add(`lose${l.slice("lose:".length)}`, l);
                }
                break;
        }
        return buttons;
    }

    /* ---------------------------------------------------------- rendering */

    public getPlayerColour(p: playerid): Colourfuncs {
        return { func: "custom", default: p === 1 ? "#8c8c8c" : "#1f78b4", palette: p };
    }

    /** The board is only ever shown the right way up or upside down. */
    public getCustomRotation(): number | undefined {
        return 180;
    }

    public render(opts?: IRenderOpts): APRenderRep {
        // Legend keys must not differ only by case: a page in quirks mode matches ids case-insensitively.
        const key = (p: playerid, t: UnitType): string => `${p === 1 ? "G" : "B"}${t}`;
        const legend: NonNullable<APRenderRep["legend"]> = {};
        // Each unit glyph has two paint slots: `fill` takes the owner's colour, `border` keeps the context colour.
        const unitGlyph = (p: playerid, t: UnitType) => ({ name: `nato-${UNIT_NAMES[t]}`, paint: { fill: this.getPlayerColour(p) } });
        for (const p of [1, 2] as playerid[]) {
            for (const t of UNIT_TYPES) {
                legend[key(p, t)] = unitGlyph(p, t);
            }
        }
        // A unit that the move being entered would eliminate is still drawn where it stood, the whole glyph at half opacity.
        const faded = (p: playerid, t: UnitType): string => {
            const k = `${key(p, t)}x`;
            legend[k] = { ...unitGlyph(p, t), opacity: 0.5 };
            return k;
        };
        const ghosts = this.preview?.ghosts ?? [];
        const pstr = CELL_ROWS.map(row => row.map(cell => {
            const u = this.unitAt(cell);
            const ghost = ghosts.find(x => x.loc === cell);
            if (u !== undefined && (ghost === undefined || ghost.id !== u.id)) {
                return key(u.owner, u.type);
            }
            return ghost === undefined ? "-" : faded(ghost.owner, ghost.type);
        }).join(",")).join("\n");
        // A unit that arrived in a reserve this ply is framed there, as the enter mark frames a square.
        const arrivals = new Map<string, number>();
        for (const r of this.results) {
            if (r.type === "move" && r.how !== "attack" && isReserve(r.to) && r.by !== undefined && r.what !== undefined) {
                const k = `${r.to}${r.by}${TYPE_BY_NAME[r.what]}`;
                arrivals.set(k, (arrivals.get(k) ?? 0) + 1);
            }
        }
        const framed = (p: playerid, t: UnitType): string => {
            const k = `${key(p, t)}e`;
            legend[k] = [
                // Only the dashed border shows: the frame's fill is fully transparent, so the strip's tint comes through.
                { name: "piece-square-dashed", paint: { fill: { colour: "_context_fill", opacity: 0 } }, scale: FRAME_SCALE },
                { ...unitGlyph(p, t), scale: FRAMED_PIECE_SCALE },
            ];
            return k;
        };
        const reserves = (p: playerid): AreaReserves => {
            const inside = [...this.units.values()].filter(u => u.loc === RESERVES[p]);
            const group = (units: IUnit[]): string[] => {
                const out = units.map(u => key(u.owner, u.type));
                for (let i = out.length - 1; i >= 0; i--) {
                    const k = `${RESERVES[p]}${units[i].owner}${units[i].type}`;
                    const n = arrivals.get(k) ?? 0;
                    if (n > 0) {
                        arrivals.set(k, n - 1);
                        out[i] = framed(units[i].owner, units[i].type);
                    }
                }
                return out;
            };
            const own = UNIT_TYPES.flatMap(t => group(inside.filter(u => u.owner === p && u.type === t)));
            // An enemy unit that has entered this reserve is shown in it: that is how the game was won.
            const intruders = group(inside.filter(u => u.owner !== p));
            const lost = ghosts.filter(u => u.loc === RESERVES[p]).map(u => faded(u.owner, u.type));
            return {
                type: "reserves",
                side: p === 1 ? "S" : "N",
                background: this.getPlayerColour(p),
                pieces: [...own, ...intruders, ...lost],
            };
        };
        const annotations: NonNullable<APRenderRep["annotations"]> = [];
        const edges = new Set<"N" | "S">();
        const at = (loc: string | undefined): { row: number; col: number } | undefined => {
            const rc = loc === undefined ? undefined : cellCoords.get(loc);
            return rc === undefined ? undefined : { row: rc[0], col: rc[1] };
        };
        const markEdge = (loc: string | undefined): void => {
            if (loc === NORTH_RESERVE) {
                edges.add("N");
            } else if (loc === SOUTH_RESERVE) {
                edges.add("S");
            }
        };
        const outline = (loc: string | undefined, type: "enter" | "exit"): void => {
            const cell = at(loc);
            if (cell !== undefined) {
                annotations.push({ type, targets: [cell] });
            }
        };
        // An arrow between two squares. The reserves have no position on the board, so an arrow into or
        // out of one runs to or from the back-line square nearest the way, and that edge is highlighted.
        const arrow = (from: string | undefined, to: string | undefined, style: "solid" | "dashed"): void => {
            if (from === undefined || to === undefined) {
                return;
            }
            let a = from;
            let b = to;
            if (from === RESERVES[1] || from === RESERVES[2]) {
                markEdge(from);
                a = SquaresGame.edgeCell(to, from === RESERVES[1] ? 1 : 2) ?? to;
            }
            if (to === RESERVES[1] || to === RESERVES[2]) {
                markEdge(to);
                b = SquaresGame.edgeCell(from, to === RESERVES[1] ? 1 : 2) ?? from;
            }
            const pa = at(a);
            const pb = at(b);
            if (pa !== undefined && pb !== undefined && a !== b) {
                annotations.push({ type: "move", targets: [pa, pb], style });
            } else if (isReserve(from)) {
                outline(to, "enter");
            }
        };
        const exits = new Set<string>();
        for (const r of this.results) {
            if (r.type === "move") {
                if (r.how === "attack") {
                    continue; // drawn below, together with its support
                }
                const retreat = r.how === "retreat" || r.how === "displaced";
                if (retreat && isReserve(r.to)) {
                    // A unit falling back to its reserve simply leaves the board: mark the square it left and the edge it went to.
                    exits.add(r.from);
                    markEdge(r.to);
                } else {
                    arrow(r.from, r.to, retreat ? "dashed" : "solid");
                }
            } else if (r.type === "capture") {
                if (r.how === "reserve") {
                    markEdge(r.where);
                } else if (r.where !== undefined) {
                    exits.add(r.where);
                }
            }
        }
        for (const ghost of ghosts) {
            exits.add(ghost.loc);
        }
        for (const cell of exits) {
            outline(cell, "exit");
        }
        // Attack arrows: solid for the attacker, dashed for the support. They follow a pending combat,
        // an attack still being entered, or this ply's results when the attack was settled on the spot.
        let attackFrom: string | undefined;
        let attackTo: string | undefined;
        let supportFrom: string | undefined;
        if (this.combat !== undefined) {
            attackFrom = this.combat.from;
            attackTo = this.combat.target;
            supportFrom = this.combat.supportFrom;
        } else if (this.preview?.attack !== undefined) {
            attackFrom = this.preview.attack.from;
            attackTo = this.preview.attack.target;
            supportFrom = this.preview.attack.support;
        } else {
            const attack = this.results.find(r => r.type === "move" && r.how === "attack");
            if (attack !== undefined && attack.type === "move") {
                attackFrom = attack.from;
                attackTo = attack.to;
            }
            const support = this.results.find(r => r.type === "select" && r.what === "support");
            if (support !== undefined && support.type === "select") {
                supportFrom = support.where;
            }
        }
        if (attackTo !== undefined) {
            arrow(attackFrom, attackTo, "solid");
            arrow(supportFrom, attackTo, "dashed");
            if (this.combat !== undefined) {
                outline(isCell(attackTo) ? attackTo : attackFrom, "enter");
            }
        }
        if (this.preview !== undefined) {
            for (const cell of new Set(this.preview.outline)) {
                outline(cell, "enter");
            }
        }

        // Gray (player 1) sits at the south, as in the rulebook's diagram; each player sees their own side at the bottom.
        const board: APRenderRep["board"] = opts?.perspective === 2 ? { style: "dvgc", rotate: 180 } : { style: "dvgc" };
        if (edges.size > 0) {
            board.markers = [...edges].map(edge => ({ type: "edge" as const, edge, colour: this.getPlayerColour(edge === "N" ? 2 : 1) }));
        }
        const rep: APRenderRep = {
            board,
            legend,
            pieces: pstr,
            areas: [reserves(1), reserves(2)],
        };
        if (annotations.length > 0) {
            rep.annotations = annotations;
        }
        return rep;
    }

    /** The back-line square on `player`'s side nearest to `from`: where an arrow to or from that reserve is anchored. */
    private static edgeCell(from: string, player: playerid): string | undefined {
        const r = rects.get(from);
        if (r === undefined) {
            return undefined;
        }
        const line = player === 1 ? CELL_ROWS[0].slice(5, 8) : CELL_ROWS[0].slice(0, 3);
        if (line.includes(from)) {
            return undefined;
        }
        const x = (r.x1 + r.x2) / 2;
        let best: string | undefined;
        let bestDistance = Infinity;
        for (const cell of line) {
            const c = rects.get(cell)!;
            const d = Math.abs((c.x1 + c.x2) / 2 - x);
            if (d < bestDistance) {
                bestDistance = d;
                best = cell;
            }
        }
        return best;
    }

    public sidebarStatuses(): IStatus[] {
        const out: IStatus[] = [];
        const turn = this.isDouble
            ? this.neutralAreaLabel("apgames:status.squares.DOUBLE", { count: this.actionsLeft })
            : this.neutralAreaLabel("apgames:status.squares.SINGLE");
        out.push({ key: this.neutralAreaLabel("apgames:status.squares.TURN"), value: [turn] });
        if (this.combat !== undefined) {
            out.push({
                key: this.neutralAreaLabel("apgames:status.squares.COMBAT"),
                value: [this.neutralAreaLabel(`apgames:status.squares.STAGE_${this.combat.stage.toUpperCase()}`)],
            });
        }
        for (const p of [1, 2] as playerid[]) {
            const lost = this.losses(p);
            const value: StatusValue[] = [];
            for (const t of UNIT_TYPES) {
                value.push(`${lost[t]} `, this.statusSheetGlyph(`nato-${UNIT_NAMES[t]}`, this.getPlayerColour(p)), " ");
            }
            out.push({ key: this.seatAreaLabel(p, "apgames:status.squares.LOSSES"), value });
        }
        return out;
    }

    /** Units of the opponent that `player` has eliminated, before any doubling. */
    public eliminated(player: playerid): number {
        const lost = this.losses(otherPlayer(player));
        return lost.I + lost.A + lost.C;
    }

    public sidebarScores(): IScores[] {
        return [{
            name: this.neutralAreaLabel("apgames:status.squares.POINTS"),
            scores: ([1, 2] as playerid[]).map(p => `${this.points(p)} (${this.eliminated(p)})`),
        }];
    }

    public getPlayerScore(player: number): number {
        return this.points(player as playerid);
    }

    /* ---------------------------------------------------------- chat */

    /** The seat a result names, when it names one. Every result this game records does. */
    private static seatOf(r: APMoveResult): number | undefined {
        if ("by" in r && typeof r.by === "string") {
            return parseInt(r.by, 10);
        }
        if ("who" in r && typeof r.who === "number") {
            return r.who;
        }
        if ("whose" in r && typeof r.whose === "number") {
            return r.whose;
        }
        return undefined;
    }

    /** Plies do not alternate strictly, so a ply's speaker is read from its own first result rather than inferred from whose turn comes next. */
    public resolveChatSeat(r: APMoveResult, currplayer: number): number {
        return SquaresGame.seatOf(r) ?? super.resolveChatSeat(r, currplayer);
    }

    public collectChatLogLine(lines: ChatLogLine[], r: APMoveResult, ctx: ChatLogCollectContext): boolean {
        const seat = SquaresGame.seatOf(r) ?? ctx.defaultSeat;
        switch (r.type) {
            case "pass":
                this.pushSeatChatLine(lines, seat, "apresults:PASS.squares");
                return true;
            case "move":
                if (r.how === "attack") {
                    this.pushSeatChatLine(lines, seat, "apresults:FIRE.squares", { from: r.from, to: r.to, context: r.what });
                } else {
                    this.pushSeatChatLine(lines, seat, `apresults:MOVE.squares_${r.how ?? "move"}`, { from: r.from, to: r.to, context: r.what });
                }
                return true;
            case "capture":
                this.pushSeatChatLine(lines, seat, r.how === "reserve" ? "apresults:CAPTURE.squares_reserve" : "apresults:CAPTURE.squares", { where: r.where, context: r.what });
                return true;
            case "select":
                if (r.what === "support") {
                    this.pushNeutralChatLine(lines, "apresults:SELECT.squares_support", { where: r.where, context: r.how });
                } else if (r.what === "stand") {
                    this.pushSeatChatLine(lines, seat, "apresults:SELECT.squares_stand", { where: r.where, context: r.how });
                } else {
                    this.pushSeatChatLine(lines, seat, `apresults:SELECT.squares_${r.what}`, { where: r.where });
                }
                return true;
            case "announce":
                this.pushNeutralChatLine(lines, "apresults:ANNOUNCE.squares_flank");
                return true;
            case "eog":
                if (r.reason === undefined) {
                    return super.collectChatLogLine(lines, r, ctx);
                }
                this.pushNeutralChatLine(lines, `apresults:EOG.squares_${r.reason}`);
                return true;
            default:
                return super.collectChatLogLine(lines, r, ctx);
        }
    }

    /* ---------------------------------------------------------- state */

    public state(): ISquaresState {
        return {
            game: SquaresGame.gameinfo.uid,
            numplayers: 2,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    public moveState(): IMoveState {
        const state: IMoveState = {
            _version: SquaresGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            units: cloneUnits(this.units),
            turnOwner: this.turnOwner,
            actionsLeft: this.actionsLeft,
            isDouble: this.isDouble,
            pendingDouble: [...this.pendingDouble],
            turnNo: [...this.turnNo],
        };
        if (this.combat !== undefined) {
            state.combat = { ...this.combat };
        }
        return state;
    }

    public clone(): SquaresGame {
        return new SquaresGame(this.serialize());
    }
}
