import { GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IScores, IValidationResult, type ChatLogCollectContext, type ChatLogLine } from "./_base.js";
import { APGamesInformation } from "../schemas/gameinfo.js";
import { APRenderRep, AnnotationFreespace, Colourfuncs, MarkerFreespaceLabel, MarkerPath } from "@abstractplay/renderer/build/schemas/schema";
import { APMoveResult } from "../schemas/moveresults.js";
import { reviver, UserFacingError } from "../common/index.js";
import i18next from "i18next";

export const gameApgamesEn = {
    validation: {
        INITIAL_INSTRUCTIONS: "Click near the middle of a segment to draw it. A black dotted line marks a segment you must not draw.",
        CONNECTOR_INSTRUCTIONS: "Click near the middle of a segment to draw it, or click a dot to form the connector at that dot. Black dotted marks show what you must not draw.",
        INVALID_SEGMENT: "{{move}} is not a segment of this board. A segment is written as the names of the two dots it connects, for example {{example}}.",
        ALREADY_DRAWN: "The segment {{where}} has already been drawn.",
        SUBDIVIDE: "You must not draw the segment {{where}}. It would subdivide an enclosed region.",
        EQUAL_REGION: "You must not draw the segment {{where}}. It would form an enclosure bordered by {{num}} red segments and {{num}} blue segments - an equal number.",
        EQUAL_VOLUME: "You must not draw the segment {{where}}. It would enclose a volume with {{num}} red segments and {{num}} blue segments - an equal number.",
        NO_PASS: "Passing is not allowed. You have an available move.",
        MUST_PASS: "You have no available move. Your turn is skipped.",
        LABEL_BOARD: "Board {{num}}",
    },
    variants: {
        "#board": {
            name: "2D: 6x6",
            description: "A 6x6 grid of dots outlining 25 squares.",
        },
        "size-8": {
            name: "2D: 8x8",
            description: "An 8x8 grid of dots outlining 49 squares.",
        },
        "size-10": {
            name: "2D: 10x10",
            description: "A 10x10 grid of dots outlining 81 squares.",
        },
        "size-12": {
            name: "2D: 12x12",
            description: "A 12x12 grid of dots outlining 121 squares.",
        },
        "3d-4x4x2": {
            name: "3D: 4x4x2",
            description: "A 4x4 front grid and a 4x4 back grid outlining 9 cubes.",
        },
        "3d-6x6x2": {
            name: "3D: 6x6x2",
            description: "A 6x6 front grid and a 6x6 back grid outlining 25 cubes.",
        },
        "4d-4x4x2x2": {
            name: "4D: 4x4x2x2",
            description: "Two 4x4x2 boards side by side, together outlining 9 units.",
        },
    },
    displays: {
        stacked: {
            name: "4D boards stacked",
            description: "On the 4D board, show Board 2 below Board 1 instead of beside it. This suits a narrow screen.",
        },
    },
};

export const gameApresultsEn = {
    PLACE: {
        segment: "{{player}} drew the segment {{where}}.",
        connector: "{{player}} formed the connector {{where}}.",
    },
    CLAIM: {
        region_one: "{{player}} claimed a region of {{count}} square, bordered by {{red}} red segments and {{blue}} blue segments.",
        region_other: "{{player}} claimed a region of {{count}} squares, bordered by {{red}} red segments and {{blue}} blue segments.",
        cubes_one: "{{player}} claimed a volume of {{count}} cube with {{red}} red segments to {{blue}} blue.",
        cubes_other: "{{player}} claimed a volume of {{count}} cubes with {{red}} red segments to {{blue}} blue.",
        units_one: "{{player}} claimed a volume of {{count}} unit with {{red}} red segments to {{blue}} blue.",
        units_other: "{{player}} claimed a volume of {{count}} units with {{red}} red segments to {{blue}} blue.",
    },
    PASS: {
        skipped: "{{player}} had no available move, so the turn was skipped.",
    },
    EOG: {
        squares: "{{player}} owns more than half of the squares.",
        cubes: "{{player}} owns more than half of the cubes.",
        units: "{{player}} owns more than half of the units.",
    },
};

export type playerid = 1 | 2;

/** 0 for a segment that is not drawn or a unit that is not owned, otherwise the player. */
export type CfMark = 0 | playerid;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    /** One character per segment of the grid: 0 = not drawn, 1 = red, 2 = blue. */
    segments: string;
    /** One character per unit of the grid: 0 = not owned, 1 = red, 2 = blue. */
    owners: string;
    lastmove?: string;
}

export interface IColorfieldState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
}

/*
 * Rule helpers.
 *
 * Colorfield is played on a grid of dots.  A segment connects two
 * orthogonally adjacent dots.  The grid outlines units: the squares of a 2D
 * grid, the cubes of a 3D grid, the unit hypercubes of a 4D grid.  The grids
 * used here are two dots deep in the third and fourth dimension, so the
 * units always form a flat array of (columns - 1) x (rows - 1).  Two units
 * side by side share a wall: a side in 2D, a face in 3D, a cube in 4D.
 *
 * A set of units connected through shared walls is a region (2D) or a volume
 * (3D, 4D).  Its bordering segments are the edges of its units, leaving out
 * the edges of any wall shared by two units of the set.  The set is enclosed
 * when all of its bordering segments have been drawn.
 *
 * After a segment is drawn, every maximal enclosed set of units that are not
 * owned yet is claimed by the player with more bordering segments.  The
 * segment must not be drawn if the two numbers are equal.  In 2D a segment
 * must also not subdivide an enclosed region.  In 3D and 4D a segment may be
 * drawn anywhere inside an enclosed volume, and the whole volume keeps its
 * owner.
 */

export interface ICfSegment {
    /** 0: along a row.  1: along a column.  2: from a front dot to the dot behind it.  3: from a dot of Board 1 to the same dot of Board 2. */
    axis: number;
    /** The two dots the segment connects, the one with the smaller coordinate first. */
    ends: [number, number];
}

export interface ICfGrid {
    /** The number of dots along a row, along a column, from front to back, and from Board 1 to Board 2. */
    size: [number, number, number, number];
    /** 2, 3 or 4 */
    dimensions: number;
    /** The coordinates [x, y, z, w] of every dot.  y counts the rows from the bottom. */
    dots: [number, number, number, number][];
    /** All segments, ordered by axis and then by their first dot.  The game state stores one character per segment in this order. */
    segments: ICfSegment[];
    /** The number of units.  Units are numbered row by row from the bottom left. */
    units: number;
    /** The edges of every unit: 4 segments in 2D, 12 in 3D, 32 in 4D. */
    unitSegments: number[][];
    /** For every unit, the units it shares a wall with. */
    neighbours: number[][];
    /** For every segment, the pairs of units whose shared wall has the segment as one of its edges. */
    walls: [number, number][][];
    /** For every segment, the units it is an edge of. */
    segmentUnits: number[][];
}

export interface ICfPosition {
    /** For every segment, who drew it. */
    drawn: CfMark[];
    /** For every unit, who owns it. */
    owner: CfMark[];
}

/** An enclosed set of units with the number of red and blue segments bordering it. */
export interface ICfEnclosure {
    units: number[];
    red: number;
    blue: number;
}

export type CfVerdict =
    | {legal: true; enclosures: ICfEnclosure[]}
    | {legal: false; reason: "drawn" | "subdivide"}
    | {legal: false; reason: "equal"; count: number};

const COLUMNS = "abcdefghijklmnopqrstuvwxy";
const grids = new Map<string, ICfGrid>();

/**
 * The grid with `nx` dots along a row and `ny` dots along a column.  `nz` is
 * 2 for a 3D grid (a front grid and a back grid), `nw` is 2 for a 4D grid
 * (two 3D boards).
 */
export function cfGrid(nx: number, ny: number, nz = 1, nw = 1): ICfGrid {
    const key = [nx, ny, nz, nw].join("x");
    const cached = grids.get(key);
    if (cached !== undefined) {
        return cached;
    }
    if (nx < 2 || ny < 2 || nx > COLUMNS.length || (nz !== 1 && nz !== 2) || (nw !== 1 && nw !== 2) || (nw === 2 && nz !== 2)) {
        throw new Error(`Colorfield cannot be played on a ${key} grid.`);
    }
    const size: [number, number, number, number] = [nx, ny, nz, nw];
    const stride = [1, nx, nx * ny, nx * ny * nz];
    const dots: [number, number, number, number][] = [];
    for (let w = 0; w < nw; w++) {
        for (let z = 0; z < nz; z++) {
            for (let y = 0; y < ny; y++) {
                for (let x = 0; x < nx; x++) {
                    dots.push([x, y, z, w]);
                }
            }
        }
    }
    const segments: ICfSegment[] = [];
    // the segment that starts at a dot and runs along an axis
    const from2segment = new Map<number, number>();
    for (let axis = 0; axis < 4; axis++) {
        for (let dot = 0; dot < dots.length; dot++) {
            if (dots[dot][axis] + 1 < size[axis]) {
                from2segment.set(dot * 4 + axis, segments.length);
                segments.push({axis, ends: [dot, dot + stride[axis]]});
            }
        }
    }
    const axes = [0, 1, 2, 3].filter(a => size[a] > 1);
    const columns = nx - 1;
    const rows = ny - 1;
    const unitSegments: number[][] = [];
    for (let j = 0; j < rows; j++) {
        for (let i = 0; i < columns; i++) {
            // the edges along each axis start at the corners of the unit that have the smaller coordinate on that axis
            const edges: number[] = [];
            for (const axis of axes) {
                const others = axes.filter(a => a !== axis);
                for (let bits = 0; bits < (1 << others.length); bits++) {
                    const c = [i, j, 0, 0];
                    others.forEach((a, k) => {
                        if ((bits & (1 << k)) !== 0) {
                            c[a]++;
                        }
                    });
                    const dot = c[0] * stride[0] + c[1] * stride[1] + c[2] * stride[2] + c[3] * stride[3];
                    edges.push(from2segment.get(dot * 4 + axis)!);
                }
            }
            unitSegments.push(edges);
        }
    }
    const units = columns * rows;
    const neighbours: number[][] = [];
    const walls: [number, number][][] = segments.map(() => []);
    for (let u = 0; u < units; u++) {
        const i = u % columns;
        const j = Math.floor(u / columns);
        const list: number[] = [];
        if (j > 0) { list.push(u - columns); }
        if (i > 0) { list.push(u - 1); }
        if (i < columns - 1) { list.push(u + 1); }
        if (j < rows - 1) { list.push(u + columns); }
        neighbours.push(list);
        for (const v of list) {
            if (v > u) {
                // the edges of the wall between two units are the edges the units have in common
                const mine = new Set(unitSegments[u]);
                for (const s of unitSegments[v]) {
                    if (mine.has(s)) {
                        walls[s].push([u, v]);
                    }
                }
            }
        }
    }
    const segmentUnits: number[][] = segments.map(() => []);
    unitSegments.forEach((edges, u) => edges.forEach(s => segmentUnits[s].push(u)));
    const grid: ICfGrid = {size, dimensions: axes.length, dots, segments, units, unitSegments, neighbours, walls, segmentUnits};
    grids.set(key, grid);
    return grid;
}

/** A position in which nothing has been drawn. */
export function cfEmpty(grid: ICfGrid): ICfPosition {
    return {
        drawn: new Array<CfMark>(grid.segments.length).fill(0),
        owner: new Array<CfMark>(grid.units).fill(0),
    };
}

/**
 * The name of a dot: its column letter and its row number, counted from the
 * bottom.  The name of a dot of the back grid ends in "z", and the name of a
 * dot of Board 2 ends in "w".
 */
export function cfDotName(grid: ICfGrid, dot: number): string {
    const [x, y, z, w] = grid.dots[dot];
    return COLUMNS[x] + (y + 1).toString() + (z === 1 ? "z" : "") + (w === 1 ? "w" : "");
}

/** The name of a segment: the names of its two dots, e.g. "a1-b1". */
export function cfSegmentName(grid: ICfGrid, segment: number): string {
    const [from, to] = grid.segments[segment].ends;
    return `${cfDotName(grid, from)}-${cfDotName(grid, to)}`;
}

/** The dot with the given name, or undefined if the grid has no such dot. */
export function cfFindDot(grid: ICfGrid, name: string): number | undefined {
    const match = /^([a-y])([1-9][0-9]?)(z?)(w?)$/.exec(name);
    if (match === null) {
        return undefined;
    }
    const [nx, ny, nz, nw] = grid.size;
    const x = COLUMNS.indexOf(match[1]);
    const y = parseInt(match[2], 10) - 1;
    const z = match[3] === "z" ? 1 : 0;
    const w = match[4] === "w" ? 1 : 0;
    if (x >= nx || y >= ny || z >= nz || w >= nw) {
        return undefined;
    }
    return x + nx * (y + ny * (z + nz * w));
}

/** The segment with the given name, its dots in either order, or undefined if the grid has no such segment. */
export function cfFindSegment(grid: ICfGrid, name: string): number | undefined {
    const parts = name.split("-");
    if (parts.length !== 2) {
        return undefined;
    }
    const a = cfFindDot(grid, parts[0]);
    const b = cfFindDot(grid, parts[1]);
    if (a === undefined || b === undefined) {
        return undefined;
    }
    const from = Math.min(a, b);
    const to = Math.max(a, b);
    const found = grid.segments.findIndex(s => s.ends[0] === from && s.ends[1] === to);
    return found === -1 ? undefined : found;
}

/**
 * The bordering segments of a set of units: the edges of its units, leaving
 * out the edges of any wall shared by two units of the set.
 */
export function cfBorder(grid: ICfGrid, units: number[]): number[] {
    const inside = new Array<boolean>(grid.units).fill(false);
    for (const u of units) {
        inside[u] = true;
    }
    const seen = new Set<number>();
    const border: number[] = [];
    for (const u of units) {
        for (const s of grid.unitSegments[u]) {
            if (seen.has(s)) {
                continue;
            }
            seen.add(s);
            if (!grid.walls[s].some(([a, b]) => inside[a] && inside[b])) {
                border.push(s);
            }
        }
    }
    return border.sort((a, b) => a - b);
}

/**
 * The maximal enclosed sets of units that are not owned.  In a position
 * reached by legal play there are none, because an enclosed set is claimed
 * at once.  Right after a segment has been drawn, these are the regions or
 * maximal volumes that the segment has enclosed.
 */
export function cfEnclosed(grid: ICfGrid, position: ICfPosition): ICfEnclosure[] {
    const {drawn, owner} = position;
    const open = owner.map(o => o === 0);
    // A unit cannot be part of an enclosed set if one of its edges is not
    // drawn and does not lie on a wall between the unit and another unit that
    // is still a candidate.  Removing such units until none is left leaves
    // exactly the units of the enclosed sets.
    let changed = true;
    while (changed) {
        changed = false;
        for (let u = 0; u < grid.units; u++) {
            if (!open[u]) {
                continue;
            }
            for (const s of grid.unitSegments[u]) {
                if (drawn[s] === 0 && !grid.walls[s].some(([a, b]) => (a === u && open[b]) || (b === u && open[a]))) {
                    open[u] = false;
                    changed = true;
                    break;
                }
            }
        }
    }
    const enclosures: ICfEnclosure[] = [];
    const seen = new Array<boolean>(grid.units).fill(false);
    for (let start = 0; start < grid.units; start++) {
        if (!open[start] || seen[start]) {
            continue;
        }
        const units = [start];
        seen[start] = true;
        for (let k = 0; k < units.length; k++) {
            for (const v of grid.neighbours[units[k]]) {
                if (open[v] && !seen[v]) {
                    seen[v] = true;
                    units.push(v);
                }
            }
        }
        units.sort((a, b) => a - b);
        let red = 0;
        let blue = 0;
        for (const s of cfBorder(grid, units)) {
            if (drawn[s] === 1) {
                red++;
            } else if (drawn[s] === 2) {
                blue++;
            }
        }
        enclosures.push({units, red, blue});
    }
    return enclosures;
}

/**
 * 2D only: true when the segment would subdivide an enclosed region.  That
 * is the case when the squares on both sides of the segment are owned and
 * the segment would cut the last open way between them.  (Every bordering
 * segment of an enclosed region is drawn, so two squares joined by an undrawn
 * segment always belong to the same region.)
 */
export function cfSubdivides(grid: ICfGrid, position: ICfPosition, segment: number): boolean {
    if (grid.dimensions !== 2 || grid.segmentUnits[segment].length !== 2) {
        return false;
    }
    const {drawn, owner} = position;
    const [start, goal] = grid.segmentUnits[segment];
    if (owner[start] === 0 || owner[goal] === 0) {
        return false;
    }
    const seen = new Array<boolean>(grid.units).fill(false);
    const todo = [start];
    seen[start] = true;
    while (todo.length > 0) {
        const u = todo.pop()!;
        for (const s of grid.unitSegments[u]) {
            if (s === segment || drawn[s] !== 0) {
                continue;
            }
            for (const v of grid.segmentUnits[s]) {
                if (v === goal) {
                    return false;
                }
                if (!seen[v]) {
                    seen[v] = true;
                    todo.push(v);
                }
            }
        }
    }
    return true;
}

/** Whether a player may draw a segment, and what the segment would enclose. */
export function cfCheck(grid: ICfGrid, position: ICfPosition, segment: number, player: playerid): CfVerdict {
    if (position.drawn[segment] !== 0) {
        return {legal: false, reason: "drawn"};
    }
    if (cfSubdivides(grid, position, segment)) {
        return {legal: false, reason: "subdivide"};
    }
    position.drawn[segment] = player;
    const enclosures = cfEnclosed(grid, position);
    position.drawn[segment] = 0;
    for (const e of enclosures) {
        if (e.red === e.blue) {
            return {legal: false, reason: "equal", count: e.red};
        }
    }
    return {legal: true, enclosures};
}

/** Draws a legal segment and gives every newly enclosed set of units to its owner.  Returns what was enclosed. */
export function cfDraw(grid: ICfGrid, position: ICfPosition, segment: number, player: playerid): ICfEnclosure[] {
    const verdict = cfCheck(grid, position, segment, player);
    if (!verdict.legal) {
        throw new Error(`The segment ${cfSegmentName(grid, segment)} cannot be drawn (${verdict.reason}).`);
    }
    position.drawn[segment] = player;
    for (const e of verdict.enclosures) {
        for (const u of e.units) {
            position.owner[u] = e.red > e.blue ? 1 : 2;
        }
    }
    return verdict.enclosures;
}

/** The segments a player may draw. */
export function cfLegalSegments(grid: ICfGrid, position: ICfPosition, player: playerid): number[] {
    const legal: number[] = [];
    for (let s = 0; s < grid.segments.length; s++) {
        if (position.drawn[s] === 0 && cfCheck(grid, position, s, player).legal) {
            legal.push(s);
        }
    }
    return legal;
}

/** True when the player may draw at least one segment. */
export function cfCanMove(grid: ICfGrid, position: ICfPosition, player: playerid): boolean {
    for (let s = 0; s < grid.segments.length; s++) {
        if (position.drawn[s] === 0 && cfCheck(grid, position, s, player).legal) {
            return true;
        }
    }
    return false;
}

/** The number of units a player owns. */
export function cfScore(position: ICfPosition, player: playerid): number {
    return position.owner.filter(o => o === player).length;
}

/*
 * The drawing.
 *
 * The board is drawn like the designer's own app: dots on a sheet of paper,
 * segments as bars in the players' colours, enclosed regions in a lighter
 * shade of the owner's colour.  On a 3D board the back grid is drawn half a
 * step up and to the right of the front grid, and the segments between the
 * two grids are drawn diagonally.  A cube is filled as the hexagon it covers
 * in the drawing, so a red and a blue cube look purple where they overlap.
 * A 4D board is two 3D boards side by side.  Its connectors are drawn as
 * coloured dots in the same place on both boards.
 *
 * All measures below are in units of the distance between two dots.
 */

const SPACING = 50;
const BAR = 0.145;               // width of a segment
const DOT_RADIUS = 0.105;
const DEPTH = 0.5;               // offset of the back grid
const FELT_MARGIN = 0.3;         // felt around a sheet of paper
const PAPER_GAP = 0.3;           // felt between the two boards of a 4D grid
const PAPER_CORNER = 0.2;
const LABEL_OFFSET = 0.5;        // from a dot to the label of its row or column
const LABEL_SIZE = 0.3;
const CLICK_REACH = 0.42;        // a click this far from a segment still selects it
const CLICK_NEAR = 0.1;          // this close, a segment in front wins over a nearer one behind it
const CLICK_DOT = 0.22;          // a click this close to a dot means the dot

const FELT = "#efe0c3";
const PAPER = "#ffffff";
const PAPER_EDGE = "#b9a67f";
const DOT = "#231f20";
const GUIDE = "#c9c9c9";
const LAST = "#ffd400";
const ILLEGAL = "#000000";
const OUTLINE = "#000000";
const FILL_OPACITY = 0.32;

const FELT_COLOUR: Colourfuncs = {func: "custom", default: FELT, palette: "_context_background"};
const PAPER_COLOUR: Colourfuncs = {func: "custom", default: PAPER, palette: 3};
const DOT_COLOUR: Colourfuncs = {func: "custom", default: DOT, palette: 4};
const GUIDE_COLOUR: Colourfuncs = {func: "custom", default: GUIDE, palette: 5};
const LAST_COLOUR: Colourfuncs = {func: "custom", default: LAST, palette: 6};
const ILLEGAL_COLOUR: Colourfuncs = {func: "custom", default: ILLEGAL, palette: 7};
// the labels stay readable when the colour of the paper is changed
const LABEL_COLOUR: Colourfuncs = {func: "bestContrast", bg: PAPER_COLOUR, fg: ["#6b6257", "#d8d0c4"]};

type Point = [number, number];

export interface ICfLayout {
    /** The size of the whole drawing. */
    width: number;
    height: number;
    /** The centre of every dot. */
    dots: Point[];
    /** The sheets of paper, one per 3D board: left, top, width, height. */
    papers: [number, number, number, number][];
    labels: {text: string; at: Point}[];
    /** Where the name of each board goes (4D only). */
    captions: Point[];
}

const layouts = new Map<string, ICfLayout>();

/**
 * Where everything is drawn, in the coordinates of the drawing (x to the
 * right, y down).  The two boards of a 4D grid are side by side, or with
 * `stacked` Board 2 is below Board 1.  Board 1 is in the same place either
 * way.
 */
export function cfLayout(grid: ICfGrid, stacked = false): ICfLayout {
    stacked = stacked && grid.size[3] === 2;
    const key = grid.size.join("x") + (stacked ? " stacked" : "");
    const cached = layouts.get(key);
    if (cached !== undefined) {
        return cached;
    }
    const [nx, ny, nz, nw] = grid.size;
    const depth = nz === 2 ? DEPTH : 0;
    // room inside the paper around the outermost dots
    const left = LABEL_OFFSET + 0.35;
    const bottom = LABEL_OFFSET + 0.35 + (nw === 2 ? 0.45 : 0);
    const top = nz === 2 ? LABEL_OFFSET + 0.3 : 0.5;
    const right = nz === 2 ? LABEL_OFFSET + (nw === 2 ? 0.55 : 0.45) : 0.5;
    const paperWidth = left + (nx - 1) + depth + right;
    const paperHeight = top + depth + (ny - 1) + bottom;
    const px = (v: number): number => Math.round(v * SPACING * 100) / 100;

    const dots: Point[] = [];
    const papers: [number, number, number, number][] = [];
    const labels: {text: string; at: Point}[] = [];
    const captions: Point[] = [];
    // the top left corner of the sheet of paper of a board
    const corner = (w: number): Point => stacked
        ? [FELT_MARGIN, FELT_MARGIN + w * (paperHeight + PAPER_GAP)]
        : [FELT_MARGIN + w * (paperWidth + PAPER_GAP), FELT_MARGIN];
    for (let w = 0; w < nw; w++) {
        const [paperX, paperY] = corner(w);
        papers.push([px(paperX), px(paperY), px(paperWidth), px(paperHeight)]);
        // the top left dot of the front grid
        const x0 = paperX + left;
        const y0 = paperY + top + depth;
        const board = w === 1 ? "w" : "";
        for (let x = 0; x < nx; x++) {
            labels.push({text: COLUMNS[x], at: [px(x0 + x), px(y0 + (ny - 1) + LABEL_OFFSET)]});
            if (nz === 2) {
                labels.push({text: COLUMNS[x], at: [px(x0 + x + depth), px(y0 - depth - LABEL_OFFSET)]});
            }
        }
        for (let y = 0; y < ny; y++) {
            labels.push({text: (y + 1).toString() + board, at: [px(x0 - LABEL_OFFSET), px(y0 + (ny - 1 - y))]});
            if (nz === 2) {
                labels.push({text: (y + 1).toString() + "z" + board, at: [px(x0 + (nx - 1) + depth + LABEL_OFFSET + (nw === 2 ? 0.08 : 0)), px(y0 + (ny - 1 - y) - depth)]});
            }
        }
        if (nw === 2) {
            captions.push([px(paperX + paperWidth / 2), px(paperY + paperHeight - 0.32)]);
        }
    }
    for (const [x, y, z, w] of grid.dots) {
        const [paperX, paperY] = corner(w);
        const x0 = paperX + left;
        const y0 = paperY + top + depth;
        dots.push([px(x0 + x + depth * z), px(y0 + (ny - 1 - y) - depth * z)]);
    }
    const across = stacked ? 1 : nw;
    const down = stacked ? nw : 1;
    const layout: ICfLayout = {
        width: px(2 * FELT_MARGIN + across * paperWidth + (across - 1) * PAPER_GAP),
        height: px(2 * FELT_MARGIN + down * paperHeight + (down - 1) * PAPER_GAP),
        dots,
        papers,
        labels,
        captions,
    };
    layouts.set(key, layout);
    return layout;
}

function num(v: number): string {
    return (Math.round(v * 100) / 100).toString();
}

function circlePath([x, y]: Point, r: number): string {
    return `M${num(x - r)},${num(y)}a${num(r)},${num(r)} 0 1,0 ${num(2 * r)},0a${num(r)},${num(r)} 0 1,0 ${num(-2 * r)},0Z`;
}

function linePath(p: Point, q: Point): string {
    return `M${num(p[0])},${num(p[1])}L${num(q[0])},${num(q[1])}`;
}

function polygonPath(points: Point[]): string {
    return "M" + points.map(p => `${num(p[0])},${num(p[1])}`).join("L") + "Z";
}

/** A bar with round ends from p to q. */
function barPath(p: Point, q: Point, half: number): string {
    const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const nx = -(q[1] - p[1]) / length * half;
    const ny = (q[0] - p[0]) / length * half;
    const r = num(half);
    return `M${num(p[0] + nx)},${num(p[1] + ny)}L${num(q[0] + nx)},${num(q[1] + ny)}A${r},${r} 0 0,0 ${num(q[0] - nx)},${num(q[1] - ny)}L${num(p[0] - nx)},${num(p[1] - ny)}A${r},${r} 0 0,0 ${num(p[0] + nx)},${num(p[1] + ny)}Z`;
}

function roundedRectPath(x: number, y: number, w: number, h: number, r: number): string {
    const a = `a${num(r)},${num(r)} 0 0,1 `;
    return `M${num(x + r)},${num(y)}h${num(w - 2 * r)}${a}${num(r)},${num(r)}v${num(h - 2 * r)}${a}${num(-r)},${num(r)}h${num(-(w - 2 * r))}${a}${num(-r)},${num(-r)}v${num(-(h - 2 * r))}${a}${num(r)},${num(-r)}Z`;
}

function distanceToSegment(x: number, y: number, p: Point, q: Point): number {
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const t = Math.max(0, Math.min(1, ((x - p[0]) * dx + (y - p[1]) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - (p[0] + t * dx), y - (p[1] + t * dy));
}

export class ColorfieldGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Colorfield",
        uid: "colorfield",
        playercounts: [2],
        version: "20261127",
        dateAdded: "2026-11-27",
        description: "A dot connection and enclosure game with two colours of line segments. Red and Blue take turns drawing unit length segments of their own colour on a grid of dots. When a region is enclosed, it is owned by whoever has more segments bordering the enclosure, and an enclosure bordered by an equal number of red and blue segments must not be formed. Whoever owns the most territory wins. Colorfield can also be played on 3D and 4D grids.",
        notes: "Colorfield was designed by Mark Steere in August 2026. The 2D game is entirely his own design. The rule set of the 3D game was derived in collaboration with Claude, an AI model made by Anthropic, and Claude worked out the 4D game.\n\n"
            + "**The 2D game.** Colorfield is played on an even sided, rectangular grid of dots. Two players, Red and Blue, take turns drawing unit length line segments of their own colour, one segment per turn, starting with Red. Passing is not allowed, but if you don't have an available move, your turn is skipped. Colorfield uses the pie rule. Blue, on his first turn, has the option of switching colours and becoming Red, claiming the first segment as his own, instead of drawing a blue segment.\n\n"
            + "On your turn, draw a segment connecting two orthogonally adjacent dots. If a new enclosure is formed, the enclosed region is owned by whoever has more segments bordering the enclosure. The enclosed region is then coloured in the owner's colour.\n\n"
            + "You must not form an enclosure bordered by an equal number of red and blue segments. Once an enclosure is formed, the enclosed region cannot then be subdivided. Segments can be drawn inside an enclosed region, as long as they don't subdivide the region.\n\n"
            + "Once an enclosed region is claimed and coloured, it cannot later be reclaimed and recoloured. If a newly enclosed region itself encloses a previously enclosed region, the previously enclosed region retains its ownership and its colour. In determining the ownership of the outer region, all of the segments bordering the outer region are considered - not just the outermost segments.\n\n"
            + "When the entire grid has been partitioned into enclosed regions, whoever owns the most territory wins.\n\n"
            + "**The 3D game.** 3D Colorfield is played on an even sided cuboid grid of dots, such as a 4x4x2 grid, made up of a 4x4 front grid and a 4x4 back grid, one unit apart. Each front dot is paired with the dot directly behind it. Nine unit cubes are outlined. On your turn, draw a segment of your colour connecting two orthogonally adjacent dots of either grid, or a segment of your colour connecting a front dot to the dot behind it. The back grid is drawn half a step up and to the right of the front grid, and the segments between the two grids are drawn diagonally.\n\n"
            + "A volume is a set of one or more unit cubes connected through shared faces. Two cubes that touch only along an edge, or only at a corner, don't form a combined volume. The bordering segments of a volume are the edges of its cubes, leaving out the edges of any face shared by two cubes of the volume. A volume is enclosed when all of its bordering segments have been drawn. Segments that aren't bordering segments don't count.\n\n"
            + "Your segment may complete the enclosure of several intersecting volumes at once. The maximal volume your segment encloses is the union of them, and it includes only cubes that are not part of an already enclosed volume. Whoever has more segments bordering the maximal volume claims it, and it is coloured in the owner's colour. If your segment completes the enclosure of two volumes that share no cube, both are enclosed, each with its own owner.\n\n"
            + "The maximal volume your segment encloses must not have an equal number of red and blue bordering segments. If your segment encloses two non-intersecting maximal volumes, both must be legally enclosed.\n\n"
            + "Unlike in 2D, an enclosed volume can be subdivided. Segments can be drawn inside and around an already enclosed volume. If the volume is divided into parts, the whole volume keeps its original owner and colour.\n\n"
            + "When every cube has been enclosed, whoever owns the most cubes wins.\n\n"
            + "**The 4D game.** 4D Colorfield is played on two 3D boards side by side, Board 1 and Board 2. Each dot of Board 1 is paired with the dot in the same position on Board 2, and the pair of boards combined is one 4D board. The 4D board outlines nine unit hypercubes, called units. A unit is shown as a cube in the same position on both 3D boards.\n\n"
            + "A segment between the two boards is called a connector. It is shown as a coloured dot in the same place on both boards. On your turn, draw a segment of your colour on either board, or form a connector by drawing a dot of your colour in the same place on each of the two boards. The segments on Board 1 and on Board 2 are drawn independently. Only the connectors appear on both boards.\n\n"
            + "A unit has 32 edges: the 12 edges of its cube on Board 1, the 12 edges of its cube on Board 2, and the 8 connectors between the two cubes at their corresponding corners. In 3D, two cubes side by side share a face. In 4D, two units side by side share a cube. The shared cube has 12 edges: the 4 edges of the shared face on Board 1, the 4 edges of the shared face on Board 2, and the 4 connectors between the two shared faces at their corresponding corners. Those 12 edges count toward both units.\n\n"
            + "In 4D, a volume is a set of one or more units connected through shared cubes. The bordering segments of a volume are the edges of its units, leaving out the 12 edges of any cube shared by two units of the volume. Connectors count as bordering segments like any other segments. A volume is enclosed when all of its bordering segments have been drawn.\n\n"
            + "Enclosing works as in 3D. Your segment may complete the enclosure of several intersecting volumes at once. The maximal volume your segment encloses is the union of them, and it includes only units that are not part of an already enclosed volume. Whoever has more segments bordering the maximal volume claims it, and it is coloured in the owner's colour on both boards. If your segment completes the enclosure of two volumes that share no unit, both are enclosed, each with its own owner.\n\n"
            + "The maximal volume your segment encloses must not have an equal number of red and blue bordering segments. If your segment encloses two non-intersecting maximal volumes, both must be legally enclosed. As in 3D, an enclosed volume can be subdivided, and the whole volume keeps its original owner and colour.\n\n"
            + "When every unit has been enclosed, whoever owns the most units wins.\n\n"
            + "**On Abstract Play.** Click near the middle of a segment to draw it. On the 4D board, click a dot to form the connector at that dot. A black dotted line marks a segment that the player to move must not draw. The segment drawn last carries two yellow dots. On the 3D and 4D boards, thin grey lines show the segments that have not been drawn yet, and the drawing looks purple where a red cube and a blue cube overlap. The display option \"4D boards stacked\" shows Board 2 below Board 1 instead of beside it, which suits a narrow screen.\n\n"
            + "A dot is named by its column letter and its row number, like c3. On the 3D and 4D boards, the name of a dot of the back grid ends in z, so c3z is the dot behind c3. On the 4D board, the name of a dot of Board 2 ends in w. A segment is written as the two dots it connects: a1-b1 is a segment of the front grid, c3z-c4z a segment of the back grid, c3-c3z a diagonal segment, and c3-c3w a connector.\n\n"
            + "The game ends as soon as one player owns more than half of the squares, cubes, or units, because the rest of the grid can no longer change the result. A skipped turn is entered automatically and is recorded as a pass.",
        urls: [
            "https://www.marksteeregames.com/Colorfield_rules.pdf",
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
            { uid: "#board" },
            { uid: "size-8", group: "board" },
            { uid: "size-10", group: "board" },
            { uid: "size-12", group: "board" },
            { uid: "3d-4x4x2", group: "board" },
            { uid: "3d-6x6x2", group: "board" },
            { uid: "4d-4x4x2x2", group: "board" },
        ],
        categories: ["goal>area", "mechanic>place", "mechanic>enclose", "board>shape>rect", "board>connect>rect", "board>3d", "components>simple>pnp"],
        flags: ["experimental", "pie", "autopass", "scores"],
        displays: [{uid: "stacked"}],
        customizations: [
            {
                num: 1,
                default: 1,
                explanation: "Colour of Red's segments and territory (player 1)",
                player: 1,
            },
            {
                num: 2,
                default: 2,
                explanation: "Colour of Blue's segments and territory (player 2)",
                player: 2,
            },
            {
                num: 3,
                default: PAPER,
                explanation: "Colour of the paper",
            },
            {
                num: 4,
                default: DOT,
                explanation: "Colour of the dots",
            },
            {
                num: 5,
                default: GUIDE,
                explanation: "Colour of the thin lines that show the undrawn segments of the 3D and 4D boards",
            },
            {
                num: 6,
                default: LAST,
                explanation: "Colour of the marks on the segment drawn last",
            },
            {
                num: 7,
                default: ILLEGAL,
                explanation: "Colour of the dotted marks on the segments the player to move must not draw",
            },
            {
                name: "background",
                default: FELT,
                explanation: "Colour of the surface around the paper",
            },
        ],
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public position!: ICfPosition;
    public grid!: ICfGrid;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    // true while a move that has not been submitted yet is being shown
    private pending = false;

    constructor(state?: IColorfieldState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = this.applyVariantConstraints(variants);
            }
            const grid = this.getGrid();
            const fresh: IMoveState = {
                _version: ColorfieldGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                segments: "0".repeat(grid.segments.length),
                owners: "0".repeat(grid.units),
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IColorfieldState;
            }
            if (state.game !== ColorfieldGame.gameinfo.uid) {
                throw new Error(`The Colorfield engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): ColorfieldGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.grid = this.getGrid();
        if (state.segments.length !== this.grid.segments.length || state.owners.length !== this.grid.units) {
            throw new Error("The saved position does not fit the board of this game.");
        }
        this.currplayer = state.currplayer;
        this.position = {
            drawn: state.segments.split("").map(c => parseInt(c, 10) as CfMark),
            owner: state.owners.split("").map(c => parseInt(c, 10) as CfMark),
        };
        this.lastmove = state.lastmove;
        this.results = [...state._results];
        this.pending = false;
        return this;
    }

    private getGrid(): ICfGrid {
        if (this.variants.includes("size-8")) { return cfGrid(8, 8); }
        if (this.variants.includes("size-10")) { return cfGrid(10, 10); }
        if (this.variants.includes("size-12")) { return cfGrid(12, 12); }
        if (this.variants.includes("3d-4x4x2")) { return cfGrid(4, 4, 2); }
        if (this.variants.includes("3d-6x6x2")) { return cfGrid(6, 6, 2); }
        if (this.variants.includes("4d-4x4x2x2")) { return cfGrid(4, 4, 2, 2); }
        return cfGrid(6, 6);
    }

    /** Pie rule: Blue may switch colours on the turn right after the first segment is drawn. */
    public isPieTurn(): boolean {
        return !this.gameover && this.stack.length === 2 && this.currplayer === 2;
    }

    /** The segments a player has drawn, by name. */
    public segmentsOf(player: playerid): string[] {
        const names: string[] = [];
        this.position.drawn.forEach((who, s) => {
            if (who === player) {
                names.push(cfSegmentName(this.grid, s));
            }
        });
        return names;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const legal = cfLegalSegments(this.grid, this.position, player);
        if (legal.length === 0) {
            // A player with no available move has his turn skipped.  The
            // `autopass` flag makes the front end submit this pass
            // automatically.
            return ["pass"];
        }
        return legal.map(s => cfSegmentName(this.grid, s));
    }

    /**
     * The segment a click at (x, y) of the drawing means, whether it has been
     * drawn or not, or undefined when the click is not near any segment.
     */
    public segmentAt(x: number, y: number): number | undefined {
        const found = this.segmentIn(cfLayout(this.grid), x, y);
        if (found !== undefined || this.grid.dimensions !== 4) {
            return found;
        }
        // The click may come from the drawing with the boards stacked.  Board 1
        // is in the same place in both drawings, and Board 2 is either beside
        // it or below it, so a click can only mean something in one of them.
        return this.segmentIn(cfLayout(this.grid, true), x, y);
    }

    private segmentIn(layout: ICfLayout, x: number, y: number): number | undefined {
        const grid = this.grid;
        let nearestDot: number | undefined;
        let nearestDistance = Infinity;
        layout.dots.forEach((at, dot) => {
            const d = Math.hypot(at[0] - x, at[1] - y);
            if (d < nearestDistance) {
                nearestDistance = d;
                nearestDot = dot;
            }
        });
        if (nearestDot === undefined) {
            return undefined;
        }
        if (grid.dimensions === 4) {
            // a dot of a 4D board is the connector at that dot
            if (nearestDistance <= CLICK_DOT * SPACING) {
                return grid.segments.findIndex(s => s.axis === 3 && s.ends.includes(nearestDot!));
            }
        } else if (nearestDistance <= DOT_RADIUS * 1.5 * SPACING) {
            // on a dot, where segments meet, a click means none of them
            return undefined;
        }
        let best: number | undefined;
        let bestScore = Infinity;
        grid.segments.forEach((segment, s) => {
            if (segment.axis === 3) {
                return;
            }
            const d = distanceToSegment(x, y, layout.dots[segment.ends[0]], layout.dots[segment.ends[1]]) / SPACING;
            if (d > CLICK_REACH) {
                return;
            }
            // Where segments cross in the drawing of a 3D board, the one in
            // front is meant: the front grid, then the diagonal segments,
            // then the back grid.
            let score = d;
            if (d < CLICK_NEAR) {
                const layer = segment.axis === 2 ? 1 : grid.dots[segment.ends[0]][2] === 0 ? 2 : 0;
                score = d - 1 - layer;
            }
            if (score < bestScore) {
                bestScore = score;
                best = s;
            }
        });
        return best;
    }

    private instructions(): string {
        if (this.grid.dimensions === 4) {
            return i18next.t("apgames:validation.colorfield.CONNECTOR_INSTRUCTIONS");
        }
        return i18next.t("apgames:validation.colorfield.INITIAL_INSTRUCTIONS");
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            // the freespace renderer reports a click as its y (row) and x (col) in the drawing
            const segment = this.segmentAt(col, row);
            if (segment === undefined || this.position.drawn[segment] !== 0) {
                // a click away from the segments, or on a segment that has already been drawn,
                // takes back a segment that has not been submitted yet
                return {move: "", valid: true, complete: -1, message: this.instructions()};
            }
            const newmove = cfSegmentName(this.grid, segment);
            const result = this.validateMove(newmove) as IClickResult;
            result.move = result.valid ? newmove : "";
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
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = this.instructions();
            return result;
        }

        if (m === "pass") {
            if (cfCanMove(this.grid, this.position, this.currplayer)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.colorfield.NO_PASS");
                return result;
            }
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation.colorfield.MUST_PASS");
            return result;
        }

        const segment = cfFindSegment(this.grid, m);
        if (segment === undefined) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.colorfield.INVALID_SEGMENT", {move: m, example: cfSegmentName(this.grid, 0)});
            return result;
        }
        const where = cfSegmentName(this.grid, segment);
        const verdict = cfCheck(this.grid, this.position, segment, this.currplayer);
        if (!verdict.legal) {
            result.valid = false;
            if (verdict.reason === "equal") {
                if (this.grid.dimensions === 2) {
                    result.message = i18next.t("apgames:validation.colorfield.EQUAL_REGION", {where, num: verdict.count});
                } else {
                    result.message = i18next.t("apgames:validation.colorfield.EQUAL_VOLUME", {where, num: verdict.count});
                }
            } else if (verdict.reason === "drawn") {
                result.message = i18next.t("apgames:validation.colorfield.ALREADY_DRAWN", {where});
            } else {
                result.message = i18next.t("apgames:validation.colorfield.SUBDIVIDE", {where});
            }
            return result;
        }

        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {partial = false, trusted = false} = {}): ColorfieldGame {
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
        }
        this.pending = false;
        if (m.length === 0) {
            if (partial) {
                return this;
            }
            throw new UserFacingError("VALIDATION_GENERAL", this.instructions());
        }

        this.results = [];
        if (m === "pass") {
            this.results.push({type: "pass"});
        } else {
            const segment = cfFindSegment(this.grid, m);
            if (segment === undefined) {
                throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation.colorfield.INVALID_SEGMENT", {move: m, example: cfSegmentName(this.grid, 0)}));
            }
            // the dots of a segment may be given in either order
            m = cfSegmentName(this.grid, segment);
            const enclosures = cfDraw(this.grid, this.position, segment, this.currplayer);
            this.results.push({type: "place", where: m, what: this.grid.segments[segment].axis === 3 ? "connector" : "segment"});
            for (const e of enclosures) {
                this.results.push({type: "claim", who: e.red > e.blue ? 1 : 2, count: e.units.length, how: `${e.red},${e.blue}`});
            }
        }

        if (partial) {
            this.pending = true;
            return this;
        }

        // update currplayer
        this.lastmove = m;
        this.currplayer = this.currplayer === 1 ? 2 : 1;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): ColorfieldGame {
        const red = cfScore(this.position, 1);
        const blue = cfScore(this.position, 2);
        if (2 * red > this.grid.units || 2 * blue > this.grid.units) {
            // The rest of the grid can no longer change the result.  The
            // number of units is odd, so a completely enclosed grid always
            // has an owner of more than half of it.
            this.gameover = true;
            this.winner = [red > blue ? 1 : 2];
            if (this.grid.dimensions === 2) {
                this.results.push({type: "eog", reason: "squares"});
            } else if (this.grid.dimensions === 3) {
                this.results.push({type: "eog", reason: "cubes"});
            } else {
                this.results.push({type: "eog", reason: "units"});
            }
        } else if (!cfCanMove(this.grid, this.position, 1) && !cfCanMove(this.grid, this.position, 2)) {
            // This is not expected to happen.  The game must still be able to
            // finish if it ever did, so whoever owns more wins.
            this.gameover = true;
            this.winner = red > blue ? [1] : blue > red ? [2] : [1, 2];
            this.results.push({type: "eog"});
        }
        if (this.gameover) {
            this.results.push({type: "winners", players: [...this.winner]});
        }
        return this;
    }

    public sidebarScores(): IScores[] {
        return [
            { name: this.neutralAreaLabel("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] },
        ];
    }

    public getPlayerScore(player: number): number {
        return cfScore(this.position, player as playerid);
    }

    public collectChatLogLine(lines: ChatLogLine[], r: APMoveResult, ctx: ChatLogCollectContext): boolean {
        switch (r.type) {
            case "place":
                if (r.what === "connector") {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:colorfield.PLACE.connector", {where: r.where});
                } else {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:colorfield.PLACE.segment", {where: r.where});
                }
                return true;
            case "claim": {
                // the owner of an enclosure is not always the player who completed it
                const [red, blue] = (r.how ?? "0,0").split(",");
                const params = {player: this.resolveChatPlayerName(r.who ?? 1, ctx.players), count: r.count ?? 1, red, blue};
                if (this.grid.dimensions === 2) {
                    this.pushNeutralChatLine(lines, "apresults:colorfield.CLAIM.region", params);
                } else if (this.grid.dimensions === 3) {
                    this.pushNeutralChatLine(lines, "apresults:colorfield.CLAIM.cubes", params);
                } else {
                    this.pushNeutralChatLine(lines, "apresults:colorfield.CLAIM.units", params);
                }
                return true;
            }
            case "pass":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:colorfield.PASS.skipped");
                return true;
            default:
                return super.collectChatLogLine(lines, r, ctx);
        }
    }

    protected eogChatLineOverride(r: Extract<APMoveResult, { type: "eog" }>, ctx: ChatLogCollectContext): ChatLogLine | undefined {
        const player = this.resolveChatPlayerName(this.winner[0], ctx.players);
        if (r.reason === "squares") {
            return {actor: { kind: "none" }, textKey: "apresults:colorfield.EOG.squares", textParams: { player }};
        }
        if (r.reason === "cubes") {
            return {actor: { kind: "none" }, textKey: "apresults:colorfield.EOG.cubes", textParams: { player }};
        }
        if (r.reason === "units") {
            return {actor: { kind: "none" }, textKey: "apresults:colorfield.EOG.units", textParams: { player }};
        }
        return undefined;
    }

    public state(): IColorfieldState {
        return {
            game: ColorfieldGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: ColorfieldGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            segments: this.position.drawn.join(""),
            owners: this.position.owner.join(""),
        };
    }

    /** The outline of a unit in the drawing of one board: a square in 2D, the hexagon a cube covers in 3D and 4D. */
    private unitOutline(layout: ICfLayout, unit: number, board: number): Point[] {
        const [nx, ny, nz] = this.grid.size;
        const i = unit % (nx - 1);
        const j = Math.floor(unit / (nx - 1));
        const at = (x: number, y: number, z: number): Point => layout.dots[x + nx * (y + ny * (z + nz * board))];
        if (nz === 1) {
            return [at(i, j, 0), at(i + 1, j, 0), at(i + 1, j + 1, 0), at(i, j + 1, 0)];
        }
        return [at(i, j, 0), at(i + 1, j, 0), at(i + 1, j, 1), at(i + 1, j + 1, 1), at(i, j + 1, 1), at(i, j + 1, 0)];
    }

    public render(opts: IRenderOpts = {}): APRenderRep {
        const grid = this.grid;
        const layout = cfLayout(grid, this.hasDisplay(opts, "stacked"));
        const {drawn, owner} = this.position;
        const boards = grid.size[3];
        const solid = grid.dimensions > 2;
        const markers: (MarkerPath | MarkerFreespaceLabel)[] = [];
        const hidden = {strokeOpacity: 0, strokeWidth: 0.1};

        // the felt, and a sheet of paper for every board
        markers.push({type: "path", path: `M0,0H${num(layout.width)}V${num(layout.height)}H0Z`, fill: FELT_COLOUR, ...hidden});
        for (const [x, y, w, h] of layout.papers) {
            markers.push({type: "path", path: roundedRectPath(x, y, w, h, PAPER_CORNER * SPACING), fill: PAPER_COLOUR, stroke: PAPER_EDGE, strokeWidth: 1});
        }
        for (const label of layout.labels) {
            const [x, y] = label.at;
            markers.push({type: "label", label: label.text, points: [{x: x - SPACING, y}, {x: x + SPACING, y}], colour: LABEL_COLOUR, size: LABEL_SIZE * SPACING});
        }
        layout.captions.forEach(([x, y], board) => {
            markers.push({type: "label", label: this.neutralAreaLabel("apgames:validation.colorfield.LABEL_BOARD", {num: board + 1}), points: [{x: x - 2 * SPACING, y}, {x: x + 2 * SPACING, y}], colour: LABEL_COLOUR, size: LABEL_SIZE * SPACING});
        });

        // the territory of each player, one path per player so that the fill is even where cubes overlap
        for (const player of [1, 2] as playerid[]) {
            const outlines: string[] = [];
            for (let board = 0; board < boards; board++) {
                for (let u = 0; u < grid.units; u++) {
                    if (owner[u] === player) {
                        outlines.push(polygonPath(this.unitOutline(layout, u, board)));
                    }
                }
            }
            if (outlines.length > 0) {
                markers.push({type: "path", path: outlines.join(""), fill: player, fillOpacity: FILL_OPACITY, ...hidden});
            }
        }

        // the segments the player to move must not draw, marked while the game runs and no move is being entered
        const illegal = new Set<number>();
        if (!this.gameover && !this.pending) {
            for (let s = 0; s < grid.segments.length; s++) {
                if (drawn[s] === 0 && !cfCheck(grid, this.position, s, this.currplayer).legal) {
                    illegal.add(s);
                }
            }
        }

        // the segments, from the back of the drawing to the front: back grid, diagonal segments, front grid
        const layerOf = (s: number): number => {
            const segment = grid.segments[s];
            if (!solid) { return 0; }
            return segment.axis === 2 ? 1 : grid.dots[segment.ends[0]][2] === 1 ? 0 : 2;
        };
        for (const layer of solid ? [0, 1, 2] : [0]) {
            const bars: MarkerPath[] = [];
            grid.segments.forEach((segment, s) => {
                if (segment.axis === 3 || layerOf(s) !== layer) {
                    return;
                }
                const p = layout.dots[segment.ends[0]];
                const q = layout.dots[segment.ends[1]];
                if (drawn[s] !== 0) {
                    bars.push({type: "path", path: barPath(p, q, BAR * SPACING / 2), fill: drawn[s], ...(solid ? {stroke: OUTLINE, strokeWidth: 1} : hidden)});
                } else if (illegal.has(s)) {
                    markers.push({type: "path", path: linePath(p, q), fillOpacity: 0, stroke: ILLEGAL_COLOUR, strokeWidth: BAR * SPACING * 0.45, dashed: [BAR * SPACING * 0.6, BAR * SPACING * 0.5]});
                } else if (solid) {
                    markers.push({type: "path", path: linePath(p, q), fillOpacity: 0, stroke: GUIDE_COLOUR, strokeWidth: 1.5});
                }
            });
            markers.push(...bars);
        }

        // the dots; on a 4D board a dot also shows the connector at that dot
        const radius = DOT_RADIUS * SPACING * (grid.dimensions === 4 ? 1.25 : 1);
        const connectorAt = new Map<number, number>();
        grid.segments.forEach((segment, s) => {
            if (segment.axis === 3) {
                connectorAt.set(segment.ends[0], s);
                connectorAt.set(segment.ends[1], s);
            }
        });
        layout.dots.forEach((at, dot) => {
            const connector = connectorAt.get(dot);
            if (connector !== undefined && drawn[connector] !== 0) {
                markers.push({type: "path", path: circlePath(at, radius * 1.35), fill: drawn[connector], stroke: OUTLINE, strokeWidth: 1.5});
                return;
            }
            markers.push({type: "path", path: circlePath(at, radius), fill: DOT_COLOUR, ...hidden});
            if (connector !== undefined && illegal.has(connector)) {
                markers.push({type: "path", path: circlePath(at, radius * 1.7), fillOpacity: 0, stroke: ILLEGAL_COLOUR, strokeWidth: 1.5, dashed: [3, 3]});
            }
        });

        // Build rep
        const rep: APRenderRep = {
            renderer: "freespace",
            board: {
                width: layout.width,
                height: layout.height,
                markers,
            },
            legend: {},
            pieces: null,
        };

        // Add annotations: the segment drawn last carries two yellow dots, a connector one on each board
        const annotations: AnnotationFreespace[] = [];
        for (const r of this.results) {
            if (r.type !== "place" || r.where === undefined) {
                continue;
            }
            const s = cfFindSegment(grid, r.where);
            if (s === undefined) {
                continue;
            }
            const p = layout.dots[grid.segments[s].ends[0]];
            const q = layout.dots[grid.segments[s].ends[1]];
            const spots: Point[] = grid.segments[s].axis === 3
                ? [p, q]
                : [-1, 1].map(sign => [(p[0] + q[0]) / 2 + sign * 0.17 * (q[0] - p[0]), (p[1] + q[1]) / 2 + sign * 0.17 * (q[1] - p[1])] as Point);
            const size = grid.segments[s].axis === 3 ? radius * 0.5 : BAR * SPACING * 0.3;
            for (const spot of spots) {
                annotations.push({type: "path", path: circlePath(spot, size), fill: LAST_COLOUR, strokeOpacity: 0, strokeWidth: 0.1});
            }
        }
        if (annotations.length > 0) {
            rep.annotations = annotations;
        }

        return rep;
    }

    public clone(): ColorfieldGame {
        return new ColorfieldGame(this.serialize());
    }
}
