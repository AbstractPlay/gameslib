import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, RowCol } from "@abstractplay/renderer/build/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";

export type playerid = 1|2;

type LocalCoord = [number, number];

export interface GlyphDef {
    name: string;
    cells: LocalCoord[];
    value: number;
}

/** Canonical 3×3 dot patterns from the Scribe reference chart (col, row). */
export const SCRIBE_GLYPHS: GlyphDef[] = [
    { name: "Single", cells: [[0, 0]], value: 1 },
    { name: "Double", cells: [[0, 0], [1, 0]], value: 2 },
    { name: "Line", cells: [[0, 0], [1, 0], [2, 0]], value: 3 },
    { name: "Pipe", cells: [[2, 0], [0, 1], [1, 1], [2, 1]], value: 4 },
    { name: "Squat-T", cells: [[0, 0], [1, 0], [2, 0], [1, 1]], value: 4 },
    { name: "4-block", cells: [[0, 0], [1, 0], [0, 1], [1, 1]], value: 4 },
    { name: "T", cells: [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2]], value: 5 },
    { name: "Cross", cells: [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]], value: 5 },
    { name: "6-block", cells: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]], value: 6 },
    { name: "Bomber", cells: [[0, 0], [1, 0], [2, 0], [1, 1], [2, 1], [2, 2]], value: 6 },
    { name: "Chair", cells: [[2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [2, 2]], value: 6 },
    { name: "J", cells: [[2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]], value: 6 },
    { name: "Earring", cells: [[1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]], value: 7 },
    { name: "House", cells: [[1, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]], value: 7 },
    { name: "H", cells: [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [2, 2]], value: 7 },
    { name: "U", cells: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]], value: 7 },
    { name: "Ottoman", cells: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [0, 2], [1, 2], [2, 2]], value: 8 },
    { name: "O", cells: [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]], value: 8 },
    { name: "9-block", cells: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]], value: 9 },
];

export interface GlyphMatch {
    glyph: GlyphDef;
    cells: LocalCoord[];
}

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    last: [string|undefined, string|undefined];
    miniwinners: Map<string, playerid>;
    lastmove?: string;
};

export interface IScribeState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

const BOARD_SIZE = 9;
const MINI_SIZE = 3;

function localKey(c: LocalCoord): string {
    return `${c[0]},${c[1]}`;
}

function normalizeCells(cells: LocalCoord[]): LocalCoord[] {
    return [...cells].sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
    if (a.size !== b.size) { return false; }
    for (const key of a) {
        if (!b.has(key)) { return false; }
    }
    return true;
}

function rotateCW(cells: LocalCoord[]): LocalCoord[] {
    return cells.map(([c, r]) => [MINI_SIZE - 1 - r, c] as LocalCoord);
}

function reflectH(cells: LocalCoord[]): LocalCoord[] {
    return cells.map(([c, r]) => [MINI_SIZE - 1 - c, r] as LocalCoord);
}

function uniqueTransforms(cells: LocalCoord[]): LocalCoord[][] {
    const seen = new Set<string>();
    const out: LocalCoord[][] = [];
    let current = normalizeCells(cells);
    for (let rot = 0; rot < 4; rot++) {
        for (const variant of [current, reflectH(current)]) {
            const norm = normalizeCells(variant);
            const key = norm.map(localKey).join("|");
            if (! seen.has(key)) {
                seen.add(key);
                out.push(norm);
            }
        }
        current = rotateCW(current);
    }
    return out;
}

function translateCells(cells: LocalCoord[], dc: number, dr: number): LocalCoord[]|undefined {
    const shifted = cells.map(([c, r]) => [c + dc, r + dr] as LocalCoord);
    if (shifted.some(([c, r]) => c < 0 || r < 0 || c >= MINI_SIZE || r >= MINI_SIZE)) {
        return undefined;
    }
    return shifted;
}

function matchKey(cells: LocalCoord[]): string {
    return normalizeCells(cells).map(localKey).join("|");
}

export function findGlyphMatches(playerCells: Set<string>, gridSize = MINI_SIZE): GlyphMatch[] {
    const matches: GlyphMatch[] = [];
    const seen = new Set<string>();
    const occupied = new Set(playerCells);

    for (const glyph of SCRIBE_GLYPHS) {
        for (const transformed of uniqueTransforms(glyph.cells)) {
            for (let dc = 0; dc < gridSize; dc++) {
                for (let dr = 0; dr < gridSize; dr++) {
                    const placed = translateCells(transformed, dc, dr);
                    if (placed === undefined) { continue; }
                    if (! placed.every(c => occupied.has(localKey(c)))) { continue; }
                    const key = matchKey(placed);
                    if (seen.has(key)) { continue; }
                    seen.add(key);
                    matches.push({ glyph, cells: placed });
                }
            }
        }
    }

    return matches;
}

function exactGlyphInComponent(component: Set<string>, gridSize = MINI_SIZE): GlyphMatch|undefined {
    if (component.size === 0) { return undefined; }
    let found: GlyphMatch|undefined;
    for (const glyph of SCRIBE_GLYPHS) {
        if (glyph.cells.length !== component.size) { continue; }
        for (const transformed of uniqueTransforms(glyph.cells)) {
            for (let dc = 0; dc < gridSize; dc++) {
                for (let dr = 0; dr < gridSize; dr++) {
                    const placed = translateCells(transformed, dc, dr);
                    if (placed === undefined) { continue; }
                    if (!setsEqual(component, new Set(placed.map(localKey)))) { continue; }
                    const match: GlyphMatch = {glyph, cells: placed};
                    if (found === undefined || glyph.name.localeCompare(found.glyph.name) < 0) {
                        found = match;
                    }
                }
            }
        }
    }
    return found;
}

function parseLocalKey(key: string): LocalCoord {
    const [c, r] = key.split(",").map(Number);
    return [c!, r!];
}

function connectedComponents(playerCells: Set<string>): Set<string>[] {
    const remaining = new Set(playerCells);
    const components: Set<string>[] = [];
    while (remaining.size > 0) {
        const start = remaining.values().next().value!;
        const component = new Set<string>();
        const queue = [start];
        remaining.delete(start);
        component.add(start);
        while (queue.length > 0) {
            const key = queue.pop()!;
            const [c, r] = parseLocalKey(key);
            for (const [dc, dr] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
                const nk = localKey([c + dc, r + dr]);
                if (remaining.has(nk)) {
                    remaining.delete(nk);
                    component.add(nk);
                    queue.push(nk);
                }
            }
        }
        components.push(component);
    }
    return components;
}

/** One exact glyph match per orthogonally connected group; non-matching groups score nothing. */
export function scoringGlyphMatches(playerCells: Set<string>, gridSize = MINI_SIZE): GlyphMatch[] {
    const matches: GlyphMatch[] = [];
    for (const component of connectedComponents(playerCells)) {
        const exact = exactGlyphInComponent(component, gridSize);
        if (exact !== undefined) { matches.push(exact); }
    }
    matches.sort((a, b) => matchKey(a.cells).localeCompare(matchKey(b.cells)));
    return matches;
}

export function glyphScore(playerCells: Set<string>, gridSize = MINI_SIZE): number {
    return scoringGlyphMatches(playerCells, gridSize).reduce((sum, m) => sum + m.glyph.value, 0);
}

export function bestGlyphValue(playerCells: Set<string>, gridSize = MINI_SIZE): number {
    const scored = scoringGlyphMatches(playerCells, gridSize);
    return scored.length === 0 ? 0 : Math.max(...scored.map(m => m.glyph.value));
}

const GLYPH_NAME_TO_LOCALE: Record<string, string> = {
    "Single": "single",
    "Double": "double",
    "Line": "line",
    "Pipe": "pipe",
    "Squat-T": "squat_t",
    "4-block": "four_block",
    "T": "t",
    "Cross": "cross",
    "6-block": "six_block",
    "Bomber": "bomber",
    "Chair": "chair",
    "J": "j",
    "Earring": "earring",
    "House": "house",
    "H": "h",
    "U": "u",
    "Ottoman": "ottoman",
    "O": "o",
    "9-block": "nine_block",
};

export function formationWhat(matches: GlyphMatch[]): string {
    return matches.map(m => m.glyph.name).join("|");
}

export function formatFormationWhat(what: string | undefined): string {
    if (!what || what.length === 0) {
        return i18next.t("apresults:SCRIBE.no_formation");
    }
    return what.split("|").map(name => {
        const key = GLYPH_NAME_TO_LOCALE[name];
        return key === undefined
            ? name
            : i18next.t(`apresults:SCRIBE.glyphs.${key}`);
    }).join(", ");
}

export class ScribeGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Scribe",
        uid: "scribe",
        playercounts: [2],
        version: "20260809",
        dateAdded: "2026-08-08",
        // i18next.t("apgames:descriptions.scribe")
        description: "apgames:descriptions.scribe",
        // i18next.t("apgames:notes.scribe")
        notes: "apgames:notes.scribe",
        urls: ["https://www.marksteeregames.com/Scribe_rules.html"],
        people: [
            {
                type: "designer",
                name: "Mark Steere",
                urls: ["https://www.marksteeregames.com/"],
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        variants: [
            {
                uid: "advanced",
            },
        ],
        categories: ["goal>area", "goal>arrange", "mechanic>place", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["experimental", "scores"],
    };

    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, BOARD_SIZE);
    }

    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, BOARD_SIZE);
    }

    public static miniOf(cell: string): [number, number] {
        const [x, y] = ScribeGame.algebraic2coords(cell);
        return [Math.floor(x / MINI_SIZE), Math.floor(y / MINI_SIZE)];
    }

    public static localInMini(cell: string): [number, number] {
        const [x, y] = ScribeGame.algebraic2coords(cell);
        return [x % MINI_SIZE, y % MINI_SIZE];
    }

    public static miniKey(mgx: number, mgy: number): string {
        return `${mgx},${mgy}`;
    }

    public static cellsInMini(mgx: number, mgy: number): string[] {
        const cells: string[] = [];
        for (let ly = 0; ly < MINI_SIZE; ly++) {
            for (let lx = 0; lx < MINI_SIZE; lx++) {
                cells.push(ScribeGame.coords2algebraic(mgx * MINI_SIZE + lx, mgy * MINI_SIZE + ly));
            }
        }
        return cells;
    }

    private static normalizeLast(last: readonly (string|null|undefined)[]): [string|undefined, string|undefined] {
        return [
            last[0] ?? undefined,
            last[1] ?? undefined,
        ];
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public last: [string|undefined, string|undefined] = [undefined, undefined];
    public miniwinners = new Map<string, playerid>();
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IScribeState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            const fresh: IMoveState = {
                _version: ScribeGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                last: [undefined, undefined],
                miniwinners: new Map(),
            };
            this.stack = [fresh];
            this.variants = variants ?? [];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IScribeState;
            }
            if (state.game !== ScribeGame.gameinfo.uid) {
                throw new Error(`The Scribe engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): ScribeGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.results = [...state._results];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.last = ScribeGame.normalizeLast(state.last);
        this.miniwinners = new Map(state.miniwinners);
        this.lastmove = state.lastmove;
        return this;
    }

    private targetMini(): [number, number]|undefined {
        const prior = this.last[this.currplayer - 1];
        if (prior === undefined) { return undefined; }
        return ScribeGame.localInMini(prior);
    }

    private miniIsFull(mgx: number, mgy: number): boolean {
        return ScribeGame.cellsInMini(mgx, mgy).every(c => this.board.has(c));
    }

    public moves(): string[] {
        if (this.gameover) { return []; }
        const moves: string[] = [];
        const target = this.targetMini();
        let cells: string[];
        if (target === undefined) {
            cells = [];
            for (let y = 0; y < BOARD_SIZE; y++) {
                for (let x = 0; x < BOARD_SIZE; x++) {
                    cells.push(ScribeGame.coords2algebraic(x, y));
                }
            }
        } else if (this.miniIsFull(target[0], target[1])) {
            cells = [];
            for (let y = 0; y < BOARD_SIZE; y++) {
                for (let x = 0; x < BOARD_SIZE; x++) {
                    cells.push(ScribeGame.coords2algebraic(x, y));
                }
            }
        } else {
            cells = ScribeGame.cellsInMini(target[0], target[1]);
        }
        for (const cell of cells) {
            if (! this.board.has(cell)) {
                moves.push(cell);
            }
        }
        return moves;
    }

    public handleClick(move: string, row: number, col: number): IClickResult {
        try {
            const cell = ScribeGame.coords2algebraic(col, row);
            const result = this.validateMove(cell) as IClickResult;
            result.move = result.valid ? cell : "";
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", {move, row, col, emessage: (e as Error).message}),
            };
        }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.scribe.INITIAL_INSTRUCTIONS");
            return result;
        }

        if (! /^[a-i][1-9]$/i.test(m)) {
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
            return result;
        }

        const cell = m.toLowerCase();
        if (this.board.has(cell)) {
            result.message = i18next.t("apgames:validation.scribe.OCCUPIED", {where: cell});
            return result;
        }

        const target = this.targetMini();
        if (target !== undefined) {
            const [mgx, mgy] = ScribeGame.miniOf(cell);
            if (! this.miniIsFull(target[0], target[1]) && (mgx !== target[0] || mgy !== target[1])) {
                result.message = i18next.t("apgames:validation.scribe.WRONG_MINI", {where: cell});
                return result;
            }
        }

        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private playerCellsInMini(mgx: number, mgy: number, player: playerid): Set<string> {
        const cells = new Set<string>();
        for (const cell of ScribeGame.cellsInMini(mgx, mgy)) {
            if (this.board.get(cell) === player) {
                const [lx, ly] = ScribeGame.localInMini(cell);
                cells.add(localKey([lx, ly]));
            }
        }
        return cells;
    }

    private miniGridLabel(key: string): string {
        return i18next.t(`apresults:SCRIBE.mini.${key.replace(",", "_")}`);
    }

    private winnerFormationsInMini(mgx: number, mgy: number, player: playerid): string {
        return formationWhat(scoringGlyphMatches(this.playerCellsInMini(mgx, mgy, player)));
    }

    private superFormations(player: playerid): string {
        const keys = new Set<string>();
        for (const [key, owner] of this.miniwinners.entries()) {
            if (owner === player) { keys.add(key); }
        }
        return formationWhat(scoringGlyphMatches(keys, MINI_SIZE));
    }

    private playerName(players: string[], who: number | undefined): string {
        if (who === undefined) { return "Player ?"; }
        return who <= players.length ? players[who - 1]! : `Player ${who}`;
    }

    private resolveMiniWinner(mgx: number, mgy: number, lastMover: playerid): playerid {
        const score1 = glyphScore(this.playerCellsInMini(mgx, mgy, 1));
        const score2 = glyphScore(this.playerCellsInMini(mgx, mgy, 2));
        if (score1 > score2) { return 1; }
        if (score2 > score1) { return 2; }
        return lastMover;
    }

    public move(m: string, {trusted = false} = {}): ScribeGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase().replace(/\s+/g, "");
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
            if (! this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}));
            }
        }

        this.results = [];
        this.board.set(m, this.currplayer);
        this.last[this.currplayer - 1] = m;
        this.results.push({type: "place", where: m});

        const [mgx, mgy] = ScribeGame.miniOf(m);
        const key = ScribeGame.miniKey(mgx, mgy);
        if (this.miniIsFull(mgx, mgy) && ! this.miniwinners.has(key)) {
            const miniWinner = this.resolveMiniWinner(mgx, mgy, this.currplayer);
            this.miniwinners.set(key, miniWinner);
            this.results.push({
                type: "claim",
                who: miniWinner,
                where: key,
                what: this.winnerFormationsInMini(mgx, mgy, miniWinner),
            });
        }

        this.lastmove = m;
        this.currplayer = this.currplayer === 1 ? 2 : 1;
        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): ScribeGame {
        if (this.board.size < BOARD_SIZE * BOARD_SIZE) { return this; }

        this.gameover = true;
        if (this.variants.includes("advanced")) {
            const super1 = new Set<string>();
            const super2 = new Set<string>();
            for (const [key, owner] of this.miniwinners.entries()) {
                if (owner === 1) { super1.add(key); }
                else { super2.add(key); }
            }
            this.results.push({
                type: "announce",
                payload: [
                    {player: 1, formations: this.superFormations(1)},
                    {player: 2, formations: this.superFormations(2)},
                ],
            });
            const best1 = bestGlyphValue(super1, MINI_SIZE);
            const best2 = bestGlyphValue(super2, MINI_SIZE);
            if (best1 > best2) {
                this.winner = [1];
            } else if (best2 > best1) {
                this.winner = [2];
            } else {
                const count1 = [...this.miniwinners.values()].filter(p => p === 1).length;
                const count2 = [...this.miniwinners.values()].filter(p => p === 2).length;
                if (count1 >= count2) {
                    this.winner = [1];
                } else {
                    this.winner = [2];
                }
            }
        } else {
            const count1 = [...this.miniwinners.values()].filter(p => p === 1).length;
            const count2 = [...this.miniwinners.values()].filter(p => p === 2).length;
            if (count1 > count2) {
                this.winner = [1];
            } else {
                this.winner = [2];
            }
        }

        this.results.push({type: "eog"}, {type: "winners", players: [...this.winner]});
        return this;
    }

    public miniGridCounts(): [number, number] {
        const count1 = [...this.miniwinners.values()].filter(p => p === 1).length;
        const count2 = [...this.miniwinners.values()].filter(p => p === 2).length;
        return [count1, count2];
    }

    public state(): IScribeState {
        return {
            game: ScribeGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    public moveState(): IMoveState {
        return {
            _version: ScribeGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            last: [...this.last] as [string|undefined, string|undefined],
            miniwinners: new Map(this.miniwinners),
        };
    }

    public sidebarScores(): IScores[] {
        const [count1, count2] = this.miniGridCounts();
        return [{
            name: i18next.t("apgames:status.scribe.MINI_GRIDS"),
            scores: [count1, count2],
        }];
    }

    public render(): APRenderRep {
        type FloodMarker = {
            type: "flood";
            colour: number;
            opacity?: number;
            points: [RowCol, ...RowCol[]];
        };
        type TileCorner = "nw" | "ne" | "sw" | "se";
        type TileCornerPoint = { tileRow: number; tileCol: number; corner: TileCorner };
        type LineMarker = {
            type: "line";
            colour: number;
            width?: number;
            points: [TileCornerPoint, TileCornerPoint];
        };

        const markers: Array<FloodMarker|LineMarker> = [];

        for (const [cell, owner] of this.board.entries()) {
            const [x, y] = ScribeGame.algebraic2coords(cell);
            markers.push({
                type: "flood",
                colour: owner,
                points: [{row: y, col: x}],
            });
        }

        for (let mgy = 0; mgy < MINI_SIZE; mgy++) {
            for (let mgx = 0; mgx < MINI_SIZE; mgx++) {
                const key = ScribeGame.miniKey(mgx, mgy);
                const owner = this.miniwinners.get(key);
                if (owner === undefined) { continue; }
                const border: LineMarker[] = [
                    {type: "line", colour: owner, width: 5, points: [
                        {tileRow: mgy, tileCol: mgx, corner: "nw"},
                        {tileRow: mgy, tileCol: mgx, corner: "ne"},
                    ]},
                    {type: "line", colour: owner, width: 5, points: [
                        {tileRow: mgy, tileCol: mgx, corner: "sw"},
                        {tileRow: mgy, tileCol: mgx, corner: "se"},
                    ]},
                    {type: "line", colour: owner, width: 5, points: [
                        {tileRow: mgy, tileCol: mgx, corner: "nw"},
                        {tileRow: mgy, tileCol: mgx, corner: "sw"},
                    ]},
                    {type: "line", colour: owner, width: 5, points: [
                        {tileRow: mgy, tileCol: mgx, corner: "ne"},
                        {tileRow: mgy, tileCol: mgx, corner: "se"},
                    ]},
                ];
                markers.push(...border);
            }
        }

        const rep: APRenderRep = {
            board: {
                style: "squares",
                width: BOARD_SIZE,
                height: BOARD_SIZE,
                tileWidth: MINI_SIZE,
                tileHeight: MINI_SIZE,
                tileSpacing: 1,
                markers,
                reference: {
                    layout: "sidebar",
                    sides: ["left", "right"],
                    source: ["scribe-chart-left", "scribe-chart-right"],                    rotateWithBoard: false,
                    gap: 1.25,
                    styles: {
                        glyphs: "_context_strokes",
                        background: "_context_background",
                        grid: "_context_strokes",
                        labels: "_context_labels",
                    },
                },
            },
            legend: {},
            pieces: Array.from({length: BOARD_SIZE}, () => "-".repeat(BOARD_SIZE)).join("\n"),
        };

        rep.annotations = [];
        for (const cell of this.last) {
            if (! cell) { continue; }
            const [x, y] = ScribeGame.algebraic2coords(cell);
            rep.annotations.push({type: "dots", targets: [{row: y, col: x}]});
        }

        if (this.stack[this.stack.length - 1]!._results.length > 0) {
            for (const r of this.stack[this.stack.length - 1]!._results) {
                if (r.type === "place" && r.where) {
                    const [x, y] = ScribeGame.algebraic2coords(r.where);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }

        return rep;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult, players: string[] = []): boolean {
        let resolved = false;
        switch (r.type) {
            case "claim":
                if (r.what === undefined || r.what.length === 0) {
                    node.push(i18next.t("apresults:CLAIM.scribe_mini_none", {
                        player: this.playerName(players, r.who),
                        where: this.miniGridLabel(r.where ?? ""),
                    }));
                } else {
                    node.push(i18next.t("apresults:CLAIM.scribe_mini", {
                        player: this.playerName(players, r.who),
                        where: this.miniGridLabel(r.where ?? ""),
                        formation: formatFormationWhat(r.what),
                    }));
                }
                resolved = true;
                break;
            case "announce":
                if (Array.isArray(r.payload)) {
                    for (const item of r.payload) {
                        if (item !== null && typeof item === "object" && "player" in item && "formations" in item) {
                            const entry = item as {player: number; formations: string};
                            node.push(i18next.t("apresults:ANNOUNCE.scribe_super", {
                                player: this.playerName(players, entry.player),
                                formation: formatFormationWhat(entry.formations),
                            }));
                        }
                    }
                }
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): ScribeGame {
        return new ScribeGame(this.serialize());
    }
}
