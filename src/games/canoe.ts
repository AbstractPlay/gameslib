import { GameBase, IAPGameState, IClickResult, ICustomButton, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, MarkerDots, MarkerFlood, MarkerLabel, MarkerLine, RowCol } from "@abstractplay/renderer/build/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { randomInt, reviver, UserFacingError, SquareOrthGraph } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const deepclone = require("rfdc/default");

export type playerid = 1|2;
export type CubeFace = 1|8|16|24|32|40;
export type Phase = "setup-1"|"setup-2"|"play";

export const CUBE_FACES: CubeFace[] = [1, 8, 16, 24, 32, 40];
export const BOARD_SIZE = 7;

export interface CellStack {
    owner: playerid;
    face: CubeFace;
    set: boolean;
}

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    phase: Phase;
    board: Map<string, CellStack>;
    roll?: [number, number] | [number];
    setupRoll?: CubeFace[];
    gridCubes: [CubeFace, CubeFace];
    pocket: [number, number];
    canoeDone: boolean;
    firstPlayer?: playerid;
    lastmove?: string;
}

export interface ICanoeState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
}

interface IMoveContext {
    player: playerid;
    freshFromBank: Set<string>;
    usedDice: number[];
    blockedFrom: Set<string>;
    isFirstGameMove: boolean;
    isPlayerFirstTurn: boolean;
}

export class CanoeGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Canoe",
        uid: "canoe",
        playercounts: [2],
        version: "20260725",
        dateAdded: "2026-07-25",
        description: "apgames:descriptions.canoe",
        notes: "apgames:notes.canoe",
        urls: ["https://boardgamegeek.com/boardgame/18867/canoe"],
        bggid: "18867",
        people: [
            {
                type: "designer",
                name: "Bruce Alsip",
                urls: [],
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        categories: ["goal>score>eog", "mechanic>move", "mechanic>capture", "mechanic>random>setup", "mechanic>random>play", "board>shape>rect", "board>connect>rect", "components>special", "components>dice"],
        flags: ["experimental", "no-explore", "custom-buttons", "scores", "automove"],
        variants: [
            {
                uid: "no-canoe",
                group: "scoring",
            },
            {
                uid: "leaky-canoe",
                group: "scoring",
            },
        ],
    };

    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, BOARD_SIZE);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, BOARD_SIZE);
    }
    public static clone(obj: CanoeGame): CanoeGame {
        return Object.assign(new CanoeGame(), deepclone(obj) as CanoeGame);
    }
    private static cloneBoard(board: Map<string, CellStack>): Map<string, CellStack> {
        return new Map([...board.entries()].map(([cell, stack]) => [cell, {...stack}]));
    }
    private static cloneStackEntry(entry: IMoveState): IMoveState {
        return {
            ...entry,
            _results: [...entry._results],
            board: CanoeGame.cloneBoard(entry.board),
            roll: entry.roll === undefined ? undefined : [...entry.roll] as [number, number] | [number],
            setupRoll: entry.setupRoll === undefined ? undefined : [...entry.setupRoll],
            gridCubes: [...entry.gridCubes],
            pocket: [...entry.pocket],
        };
    }
    public static rotateFace(face: CubeFace, die: number): CubeFace {
        const idx = CUBE_FACES.indexOf(face);
        if (die % 2 === 0) {
            return CUBE_FACES[(idx + 1) % CUBE_FACES.length];
        }
        return CUBE_FACES[(idx + CUBE_FACES.length - 1) % CUBE_FACES.length];
    }
    public static rollCubeFace(): CubeFace {
        return CUBE_FACES[randomInt(CUBE_FACES.length) - 1];
    }
    public static scoreFace(face: CubeFace): number {
        return face === 1 ? 0 : face;
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public phase: Phase = "setup-1";
    public board!: Map<string, CellStack>;
    public roll?: [number, number] | [number];
    public setupRoll?: CubeFace[];
    public gridCubes: [CubeFace, CubeFace] = [1, 1];
    public pocket: [number, number] = [0, 0];
    public canoeDone = false;
    public firstPlayer?: playerid;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private highlights: string[] = [];
    private selectedCell?: string;
    private selectedSetupFace?: CubeFace;
    private partialMove?: string;
    private emulated = false;
    private freshFromBankThisTurn = new Set<string>();

    private static readonly graph = new SquareOrthGraph(BOARD_SIZE, BOARD_SIZE);
    private static readonly CANOE_CELLS = ["f2", "g2", "f1", "g1"];
    private static readonly DICE_CELLS = ["f2", "g1"];
    private static readonly P1_GRID_CUBE = "c7";
    private static readonly P2_GRID_CUBE = "a5";

    constructor(state?: ICanoeState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const board = new Map<string, CellStack>();
            const fresh: IMoveState = {
                _version: CanoeGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                phase: "setup-1",
                board,
                gridCubes: [1, 1],
                pocket: [0, 0],
                canoeDone: false,
                setupRoll: CanoeGame.rollSetup(),
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ICanoeState;
            }
            if (state.game !== CanoeGame.gameinfo.uid) {
                throw new Error(`The Canoe engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = state.stack.map(e => CanoeGame.cloneStackEntry(e));
        }
        this.load();
    }

    public syncFromStackEntry(entry: IMoveState | number): CanoeGame {
        if (typeof entry === "number") {
            let idx = entry;
            if (idx < 0) {
                idx += this.stack.length;
            }
            if (idx < 0 || idx >= this.stack.length) {
                throw new Error("Could not sync from the requested stack entry.");
            }
            entry = this.stack[idx];
        }
        this.currplayer = entry.currplayer;
        this.phase = entry.phase;
        this.board = CanoeGame.cloneBoard(entry.board);
        this.roll = entry.roll === undefined ? undefined : [...entry.roll] as [number, number] | [number];
        this.setupRoll = entry.setupRoll === undefined ? undefined : [...entry.setupRoll];
        this.gridCubes = [...entry.gridCubes];
        this.pocket = [...entry.pocket];
        const raw = entry.canoeDone as boolean | [boolean, boolean];
        this.canoeDone = typeof raw === "boolean" ? raw : (raw[0] || raw[1]);
        this.firstPlayer = entry.firstPlayer;
        this.lastmove = entry.lastmove;
        this.freshFromBankThisTurn = new Set();
        this.highlights = [];
        this.selectedCell = undefined;
        this.selectedSetupFace = undefined;
        this.partialMove = undefined;
        return this;
    }

    private static rollSetup(): CubeFace[] {
        const roll: CubeFace[] = [];
        for (let i = 0; i < 6; i++) {
            roll.push(CanoeGame.rollCubeFace());
        }
        return roll;
    }

    public load(idx = -1): CanoeGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if (idx < 0 || idx >= this.stack.length) {
            throw new Error("Could not load the requested state from the stack.");
        }
        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.phase = state.phase;
        this.board = CanoeGame.cloneBoard(state.board);
        this.roll = state.roll === undefined ? undefined : [...state.roll] as [number, number] | [number];
        this.setupRoll = state.setupRoll === undefined ? undefined : [...state.setupRoll];
        this.gridCubes = [...state.gridCubes];
        this.pocket = [...state.pocket];
        const raw = state.canoeDone as boolean | [boolean, boolean];
        this.canoeDone = typeof raw === "boolean" ? raw : (raw[0] || raw[1]);
        this.firstPlayer = state.firstPlayer;
        this.lastmove = state.lastmove;
        this.freshFromBankThisTurn = new Set();
        this.results = [...state._results];
        this.highlights = [];
        this.selectedCell = undefined;
        this.selectedSetupFace = undefined;
        this.partialMove = undefined;
        return this;
    }

    /** Start-of-turn snapshot from the saved stack (for partial-move simulation). */
    private turnBaseline(): CanoeGame {
        const g = CanoeGame.clone(this);
        g.syncFromStackEntry(this.stack[this.stack.length - 1]);
        return g;
    }

    // --- Board zones ---

    public static isBlocked(row: number, col: number): boolean {
        return row >= 5 && col >= 5;
    }
    public static isGrid(row: number, col: number): boolean {
        return row <= 4 && col <= 4;
    }
    public static isBank(player: playerid, row: number, col: number): boolean {
        if (player === 1) {
            return row >= 5 && col <= 4;
        }
        return row <= 4 && col >= 5;
    }
    public static isSetupCell(player: playerid, cell: string): boolean {
        const [col, row] = CanoeGame.algebraic2coords(cell);
        if (player === 1) {
            return row >= 5 && row <= 6 && col >= 1 && col <= 3;
        }
        return row >= 1 && row <= 3 && col >= 5 && col <= 6;
    }
    public static gridCubeCell(player: playerid): string {
        return player === 1 ? CanoeGame.P1_GRID_CUBE : CanoeGame.P2_GRID_CUBE;
    }
    public static distToPin(player: playerid, row: number, col: number): number {
        if (player === 1) {
            return col;
        }
        return row;
    }
    public static isOnGrid(cell: string): boolean {
        const [col, row] = CanoeGame.algebraic2coords(cell);
        return CanoeGame.isGrid(row, col);
    }
    public static isInBank(player: playerid, cell: string): boolean {
        const [col, row] = CanoeGame.algebraic2coords(cell);
        return CanoeGame.isBank(player, row, col);
    }
    public static isInAnyBank(cell: string): boolean {
        return CanoeGame.isInBank(1, cell) || CanoeGame.isInBank(2, cell);
    }
    public static crossesHomeBankThroughPin(player: playerid, from: string, to: string): boolean {
        if (!CanoeGame.isOnGrid(from) || !CanoeGame.isInBank(player, to)) {
            return false;
        }
        const [fc, fr] = CanoeGame.algebraic2coords(from);
        const [tc, tr] = CanoeGame.algebraic2coords(to);
        if (player === 1) {
            if (tc !== 0) {
                return false;
            }
            if (fc === 0 && fr === 4 && tr >= 5) {
                return true;
            }
            if (fc === 0 && fr < 4 && tr > fr) {
                return true;
            }
            if (fc > 0 && tr >= 5 && tr === fr + 1) {
                return true;
            }
            return false;
        }
        if (tr !== 0) {
            return false;
        }
        if (fr === 0 && fc === 4 && tc >= 5) {
            return true;
        }
        if (fr === 0 && fc < 4 && tc > fc) {
            return true;
        }
        if (fr > 0 && tc >= 5 && tc === fc + 1) {
            return true;
        }
        return false;
    }
    public static crossesStartingLine(player: playerid, from: string, to: string): boolean {
        const [fc, fr] = CanoeGame.algebraic2coords(from);
        const [tc, tr] = CanoeGame.algebraic2coords(to);
        if (player === 1) {
            return fr >= 5 && tr <= 4;
        }
        return fc >= 5 && tc <= 4;
    }
    public static isSetBearOffLaunchCell(player: playerid, col: number, row: number): boolean {
        if (player === 1) {
            return col === 4 && row === 6;
        }
        return col === 6 && row === 4;
    }
    public static setBearOffClickCell(player: playerid): string {
        return player === 1 ? "f1" : "g2";
    }

    private countOnBoard(player: playerid): number {
        let n = 0;
        for (const stack of this.board.values()) {
            if (stack.owner === player) {
                n += stack.set ? 2 : 1;
            }
        }
        return n;
    }

    private cubesOnBoard(player: playerid): string[] {
        const cells: string[] = [];
        for (const [cell, stack] of this.board.entries()) {
            if (stack.owner === player) {
                cells.push(cell);
            }
        }
        return cells;
    }

    private isSeventhCube(player: playerid): boolean {
        return this.countOnBoard(player) === 1;
    }

    private isClearingBearOffHalf(half: string): boolean {
        const bearOff = half.match(/^(\d+(?:\+\d+)?):([a-g][1-7])-off$/);
        if (bearOff === null) {
            return false;
        }
        const from = bearOff[2];
        const stack = this.board.get(from);
        if (stack === undefined || stack.owner !== this.currplayer) {
            return false;
        }
        const count = this.countOnBoard(this.currplayer);
        if (stack.set) {
            return count === 2 && this.cubesOnBoard(this.currplayer).length === 1;
        }
        return count === 1;
    }

    public isStymieEligible(player?: playerid): boolean {
        player = player ?? this.currplayer;
        const cells = this.cubesOnBoard(player);
        if (cells.length !== 2) {
            return false;
        }
        const a = this.board.get(cells[0])!;
        const b = this.board.get(cells[1])!;
        if (a.face !== b.face || a.set || b.set) {
            return false;
        }
        const [ac, ar] = CanoeGame.algebraic2coords(cells[0]);
        const [bc, br] = CanoeGame.algebraic2coords(cells[1]);
        if (ac === bc) {
            return Math.abs(ar - br) % 2 === 1;
        }
        if (ar === br) {
            return Math.abs(ac - bc) % 2 === 1;
        }
        return false;
    }

    private isFirstGameMove(): boolean {
        return this.phase === "play" && this.stack.length === 3;
    }

    private isPlayerFirstPlayTurn(player: playerid): boolean {
        for (let i = 1; i < this.stack.length; i++) {
            const s = this.stack[i];
            if (s.phase === "play" && s.currplayer === player && s.lastmove !== undefined) {
                return false;
            }
        }
        return true;
    }

    private hasNoCanoeVariant(): boolean {
        return this.variants.includes("no-canoe");
    }

    private hasLeakyCanoeVariant(): boolean {
        return this.variants.includes("leaky-canoe");
    }

    private parseSetupMove(m: string): Map<string, CubeFace> {
        const placements = new Map<string, CubeFace>();
        if (m.length === 0) {
            return placements;
        }
        for (const part of m.split(",")) {
            const match = part.match(/^(\d+)@([a-g][1-7])$/);
            if (match === null) {
                continue;
            }
            placements.set(match[2], parseInt(match[1], 10) as CubeFace);
        }
        return placements;
    }

    private currentSetupPlacements(m: string): Map<string, CubeFace> {
        const placements = this.parseSetupMove(m);
        for (const cell of [...placements.keys()]) {
            if (!CanoeGame.isSetupCell(this.currplayer, cell)) {
                placements.delete(cell);
            }
        }
        return placements;
    }

    private formatSetupMove(placements: Map<string, CubeFace>): string {
        const parts: string[] = [];
        for (const [cell, face] of placements) {
            parts.push(`${face}@${cell}`);
        }
        return parts.join(",");
    }

    private applySetupPlacements(placements: Map<string, CubeFace>): void {
        const base = this.stack[this.stack.length - 1];
        this.board = CanoeGame.cloneBoard(base.board);
        for (const cell of this.cubesOnBoard(this.currplayer)) {
            if (CanoeGame.isSetupCell(this.currplayer, cell) || CanoeGame.isInBank(this.currplayer, cell)) {
                this.board.delete(cell);
            }
        }
        for (const [cell, face] of placements.entries()) {
            this.board.set(cell, {owner: this.currplayer, face, set: false});
        }
    }

    private unplacedSetupFaces(placements: Map<string, CubeFace>): CubeFace[] {
        const pool = [...(this.setupRoll ?? [])];
        for (const face of placements.values()) {
            const idx = pool.indexOf(face);
            if (idx >= 0) {
                pool.splice(idx, 1);
            }
        }
        return pool;
    }

    private unplacedSetupDieIndices(placements: Map<string, CubeFace>): number[] {
        const used = new Array(this.setupRoll?.length ?? 0).fill(false);
        for (const face of placements.values()) {
            for (let i = 0; i < (this.setupRoll?.length ?? 0); i++) {
                if (!used[i] && this.setupRoll![i] === face) {
                    used[i] = true;
                    break;
                }
            }
        }
        const indices: number[] = [];
        for (let i = 0; i < used.length; i++) {
            if (!used[i]) {
                indices.push(i);
            }
        }
        return indices;
    }

    private static setupDieGlyph(index: number): string {
        return `S${index}`;
    }

    private static isCompleteHalf(half: string): boolean {
        return /^\d+(?:\+\d+)?:[a-g][1-7](-[a-g][1-7]|\+[a-g][1-7]|x[a-g][1-7]|-off)$/.test(half);
    }

    private static halfDiceSpec(half: string): string | undefined {
        const idx = half.indexOf(":");
        if (idx < 0) {
            return undefined;
        }
        return half.slice(0, idx);
    }

    private static halfDieDistance(half: string): number | undefined {
        const spec = CanoeGame.halfDiceSpec(half);
        if (spec === undefined) {
            return undefined;
        }
        if (spec.includes("+")) {
            return spec.split("+").reduce((sum, d) => sum + parseInt(d, 10), 0);
        }
        return parseInt(spec, 10);
    }

    private static isCombinedDiceSpec(spec: string): boolean {
        return spec.includes("+");
    }

    private static combinedSpecsEquivalent(a: string, b: string): boolean {
        if (a === b) {
            return true;
        }
        if (!CanoeGame.isCombinedDiceSpec(a) || !CanoeGame.isCombinedDiceSpec(b)) {
            return false;
        }
        const da = a.split("+").map(n => parseInt(n, 10)).sort((x, y) => x - y);
        const db = b.split("+").map(n => parseInt(n, 10)).sort((x, y) => x - y);
        return da.length === db.length && da.every((v, i) => v === db[i]);
    }

    private static halfMovesEquivalent(a: string, b: string): boolean {
        if (a === b) {
            return true;
        }
        const colonA = a.indexOf(":");
        const colonB = b.indexOf(":");
        if (colonA < 0 || colonB < 0) {
            return false;
        }
        if (!CanoeGame.combinedSpecsEquivalent(a.slice(0, colonA), b.slice(0, colonB))) {
            return false;
        }
        return a.slice(colonA) === b.slice(colonB);
    }

    private static moveStartsWithPrefix(move: string, prefix: string): boolean {
        if (move.startsWith(prefix)) {
            return true;
        }
        const colonP = prefix.indexOf(":");
        const colonM = move.indexOf(":");
        if (colonP < 0 || colonM < 0) {
            return false;
        }
        if (!CanoeGame.combinedSpecsEquivalent(move.slice(0, colonM), prefix.slice(0, colonP))) {
            return false;
        }
        return move.slice(colonM).startsWith(prefix.slice(colonP));
    }

    private static parsePartialDiceSpec(partial: string): string | undefined {
        const m = partial.match(/^(?:;)?(\d+(?:\+\d+)?):$/);
        return m?.[1];
    }

    private static dicePrefixBeforeColon(s: string): string | undefined {
        const m = s.match(/^(?:;)?(\d+(?:\+\d+)?):/);
        return m?.[1];
    }

    /** Die-only partial with optional slot-1 marker (`;3:` = die 3 from second slot). */
    private static parseDieOnlyPartial(partial: string): {die: number; slot: 0 | 1} | undefined {
        const slot1 = partial.match(/^;(\d+):$/);
        if (slot1 !== null) {
            return {die: parseInt(slot1[1], 10), slot: 1};
        }
        const slot0 = partial.match(/^(\d+):$/);
        if (slot0 !== null) {
            return {die: parseInt(slot0[1], 10), slot: 0};
        }
        return undefined;
    }

    /** Strip doubles slot-1 marker for legal-move matching (`;3:e5` → `3:e5`). */
    private static normalizePlayMove(m: string): string {
        const {prefix, partial} = CanoeGame.parseMoveSegments(m);
        if (!partial.startsWith(";")) {
            return m;
        }
        const stripped = partial.slice(1);
        if (prefix.length > 0) {
            return `${prefix},${stripped}`;
        }
        if (CanoeGame.parseDieOnlyPartial(partial) !== undefined) {
            return m;
        }
        return stripped;
    }

    private combinedDiceKey(d1: number, d2: number): string {
        return `${d1}+${d2}`;
    }

    private diceKeyForDistance(die: number): string {
        if (this.roll?.length === 2) {
            const [d1, d2] = this.roll;
            if (die === d1 + d2) {
                return this.combinedDiceKey(d1, d2);
            }
        }
        return die.toString();
    }

    private isValidDieOnlyPartial(spec: string): boolean {
        if (this.roll === undefined) {
            return false;
        }
        if (this.roll.length === 1) {
            return spec === this.roll[0].toString();
        }
        const [d1, d2] = this.roll;
        const canonical = this.combinedDiceKey(d1, d2);
        const all = this.phase === "play" ? this.turnBaseline().moves() : this.moves();
        if (CanoeGame.isCombinedDiceSpec(spec)) {
            if (spec !== canonical && spec !== this.combinedDiceKey(d2, d1)) {
                return false;
            }
            return all.some(m => m.startsWith(`${canonical}:`));
        }
        const die = parseInt(spec, 10);
        if (die !== d1 && die !== d2) {
            return false;
        }
        if (all.some(mv => mv.startsWith(`${die}:`))) {
            return true;
        }
        return all.some(mv => mv.startsWith(`${canonical}:`));
    }

  /** Cells that may not start another half-move this turn after `half` is played. */
    private static blockedFromAfterHalf(half: string): Set<string> {
        const blocked = new Set<string>();
        const bearOff = half.match(/^(\d+(?:\+\d+)?):([a-g][1-7])-off$/);
        if (bearOff !== null) {
            return blocked;
        }
        const pinch = half.match(/^(\d+(?:\+\d+)?):([a-g][1-7])x([a-g][1-7])$/);
        if (pinch !== null) {
            blocked.add(pinch[3]);
            return blocked;
        }
        const setForm = half.match(/^(\d+(?:\+\d+)?):([a-g][1-7])\+([a-g][1-7])$/);
        if (setForm !== null) {
            blocked.add(setForm[2]);
            return blocked;
        }
        const regular = half.match(/^(\d+(?:\+\d+)?):([a-g][1-7])-([a-g][1-7])$/);
        if (regular !== null) {
            blocked.add(regular[3]);
            return blocked;
        }
        return blocked;
    }

    private static blockedFromAfterHalves(halves: string[]): Set<string> {
        const blocked = new Set<string>();
        for (const half of halves) {
            if (!CanoeGame.isCompleteHalf(half)) {
                continue;
            }
            for (const cell of CanoeGame.blockedFromAfterHalf(half)) {
                blocked.add(cell);
            }
        }
        return blocked;
    }

    private static parseMoveSegments(m: string): {prefix: string; partial: string} {
        const segments = m.split(",").filter(s => s.length > 0);
        if (segments.length === 0) {
            return {prefix: "", partial: ""};
        }
        if (segments.length === 1) {
            if (CanoeGame.isCompleteHalf(segments[0])) {
                return {prefix: segments[0], partial: ""};
            }
            return {prefix: "", partial: segments[0]};
        }
        return {
            prefix: segments.slice(0, -1).join(","),
            partial: segments[segments.length - 1],
        };
    }

    private static usedDieIndicesFromMove(m: string, roll: number[]): Set<number> {
        const used = new Set<number>();
        const {prefix} = CanoeGame.parseMoveSegments(m);
        if (prefix.length === 0 || roll.length === 0) {
            return used;
        }
        for (const half of prefix.split(",")) {
            if (!CanoeGame.isCompleteHalf(half)) {
                continue;
            }
            const spec = CanoeGame.halfDiceSpec(half);
            if (spec === undefined) {
                continue;
            }
            const dice = CanoeGame.isCombinedDiceSpec(spec)
                ? spec.split("+").map(d => parseInt(d, 10))
                : [parseInt(spec, 10)];
            for (const dieVal of dice) {
                const idx = roll.findIndex((v, i) => v === dieVal && !used.has(i));
                if (idx >= 0) {
                    used.add(idx);
                }
            }
        }
        return used;
    }

    private static remainingDie(roll: [number, number], usedDie: number): number {
        const [d1, d2] = roll;
        return usedDie === d1 ? d2 : d1;
    }

    private static autocompleteAfterFirstHalf(m: string, roll: [number, number]): string | undefined {
        if (roll.length !== 2) {
            return undefined;
        }
        const halves = m.split(",").filter(s => s.length > 0);
        if (halves.length !== 1 || !CanoeGame.isCompleteHalf(halves[0])) {
            return undefined;
        }
        const usedSpec = CanoeGame.halfDiceSpec(halves[0]);
        if (usedSpec === undefined || CanoeGame.isCombinedDiceSpec(usedSpec)) {
            return undefined;
        }
        const usedDie = CanoeGame.halfDieDistance(halves[0])!;
        if (usedDie === roll[0] + roll[1]) {
            return undefined;
        }
        return `${m},${CanoeGame.remainingDie(roll, usedDie)}:`;
    }

    private static selectedDieFromPartial(partial: string): number | undefined {
        const spec = CanoeGame.dicePrefixBeforeColon(partial);
        if (spec === undefined) {
            return undefined;
        }
        if (CanoeGame.isCombinedDiceSpec(spec)) {
            return spec.split("+").reduce((sum, d) => sum + parseInt(d, 10), 0);
        }
        return parseInt(spec, 10);
    }

    private static playDieGlyph(slotIndex: number, used: boolean): string {
        const slot = slotIndex + 1;
        return used ? `U${slot}` : `D${slot}`;
    }

    private dieSlotIndex(cell?: string, piece?: string): number | undefined {
        if (this.roll === undefined) {
            return undefined;
        }
        if (cell !== undefined && CanoeGame.DICE_CELLS.includes(cell)) {
            const idx = CanoeGame.DICE_CELLS.indexOf(cell);
            if (idx < this.roll.length) {
                return idx;
            }
        }
        if (piece !== undefined) {
            const slotGlyph = piece.match(/^[DU]([12])$/);
            if (slotGlyph !== null) {
                const idx = parseInt(slotGlyph[1], 10) - 1;
                if (idx >= 0 && idx < this.roll.length) {
                    return idx;
                }
            }
        }
        return undefined;
    }

    private dieFromClick(cell?: string, piece?: string): number | undefined {
        const idx = this.dieSlotIndex(cell, piece);
        if (idx !== undefined) {
            return this.roll![idx];
        }
        if (this.roll === undefined || piece === undefined) {
            return undefined;
        }
        const glyph = piece.match(/^[DU](\d)$/);
        if (glyph !== null) {
            const value = parseInt(glyph[1], 10);
            if (this.roll.includes(value)) {
                return value;
            }
        }
        return undefined;
    }

    private highestUnplacedFace(placements: Map<string, CubeFace>): CubeFace | undefined {
        const pool = this.unplacedSetupFaces(placements);
        if (pool.length === 0) {
            return undefined;
        }
        return pool.reduce((a, b) => (a > b ? a : b));
    }

    private finishSetup(): void {
        if (this.emulated) {
            return;
        }
        const gridFace = CanoeGame.rollCubeFace();
        this.gridCubes[this.currplayer - 1] = gridFace;
        this.board.set(CanoeGame.gridCubeCell(this.currplayer), {
            owner: this.currplayer,
            face: gridFace,
            set: false,
        });
        this.results.push({type: "place", where: CanoeGame.gridCubeCell(this.currplayer)});

        if (this.phase === "setup-1") {
            this.phase = "setup-2";
            this.currplayer = 2;
            this.setupRoll = CanoeGame.rollSetup();
        } else {
            this.phase = "play";
            this.setupRoll = undefined;
            this.firstPlayer = this.gridCubes[0] >= this.gridCubes[1] ? 1 : 2;
            if (this.gridCubes[0] === this.gridCubes[1]) {
                this.firstPlayer = 1;
            }
            this.currplayer = this.firstPlayer;
            this.prepareNextTurnRoll();
        }
    }

    private prepareNextTurnRoll(): void {
        if (this.isStymieEligible(this.currplayer)) {
            this.roll = undefined;
            return;
        }
        const d1 = randomInt(6);
        const d2 = randomInt(6);
        this.roll = [d1, d2];
        this.results.push({type: "roll", values: [d1, d2]});
    }

    private addToPocket(player: playerid, face: CubeFace): void {
        this.addScore(player, CanoeGame.scoreFace(face));
    }

    private addScore(player: playerid, delta: number): void {
        if (delta === 0) {
            return;
        }
        this.pocket[player - 1] += delta;
        this.results.push({type: "deltaScore", delta, who: player});
    }

    private rotateAndConvert(cell: string, stack: CellStack, die: number): CubeFace {
        if (stack.set) {
            return stack.face;
        }
        const fromFace = stack.face;
        const intoFace = CanoeGame.rotateFace(fromFace, die);
        this.results.push({type: "convert", what: fromFace.toString(), into: intoFace.toString(), where: cell});
        stack.face = intoFace;
        return intoFace;
    }

    private pieceGlyph({owner, face, set}: CellStack): string {
        const p = owner === 1 ? "A" : "B";
        return `${p}${face}${set ? "s" : ""}`;
    }

    private getNeighbours(cell: string): string[] {
        return CanoeGame.graph.neighbours(cell).filter(c => {
            const [col, row] = CanoeGame.algebraic2coords(c);
            return !CanoeGame.isBlocked(row, col);
        });
    }

    private effectiveFace(stack: CellStack, die: number): CubeFace {
        if (stack.set) {
            return stack.face;
        }
        return CanoeGame.rotateFace(stack.face, die);
    }

    private opponent(player: playerid): playerid {
        return (player === 1 ? 2 : 1) as playerid;
    }

    private canOccupyBankCell(player: playerid, from: string, to: string, stack: CellStack): boolean {
        if (!CanoeGame.isInAnyBank(to)) {
            return true;
        }
        if (CanoeGame.isInBank(this.opponent(player), to)) {
            return false;
        }
        if (!stack.set) {
            if (CanoeGame.isInBank(player, from)) {
                return true;
            }
            if (this.isSeventhCube(player)) {
                return CanoeGame.crossesHomeBankThroughPin(player, from, to);
            }
            return false;
        }
        if (CanoeGame.isInBank(player, from)) {
            return true;
        }
        return CanoeGame.crossesHomeBankThroughPin(player, from, to);
    }

    private getSingleDestinations(from: string, die: number, ctx: IMoveContext): Map<string, "move"|"pinch"|"set"> {
        const dests = new Map<string, "move"|"pinch"|"set">();
        const stack = this.board.get(from);
        if (stack === undefined || stack.owner !== ctx.player || stack.set) {
            return dests;
        }
        if (this.isSeventhCube(ctx.player)) {
            return this.getSeventhCubeDestinations(from, die, ctx, stack);
        }
        const eff = this.effectiveFace(stack, die);
        const fromBank = CanoeGame.isInBank(ctx.player, from);

        const dfs = (cell: string, remaining: number, visited: Set<string>): void => {
            if (remaining === 0) {
                return;
            }
            for (const next of this.getNeighbours(cell)) {
                if (visited.has(next)) {
                    continue;
                }
                if (CanoeGame.isInBank(this.opponent(ctx.player), next)) {
                    continue;
                }
                const occ = this.board.get(next);
                if (remaining === 1) {
                    if (occ === undefined) {
                        if (fromBank && CanoeGame.isInBank(ctx.player, next) && CanoeGame.isOnGrid(cell)) {
                            continue;
                        }
                        if (!this.canOccupyBankCell(ctx.player, cell, next, stack)) {
                            continue;
                        }
                        if (!fromBank || CanoeGame.isOnGrid(next) || !this.canReachGridFromBank(from, die)) {
                            dests.set(next, "move");
                        }
                    } else if (occ.owner !== ctx.player && occ.face === eff && !occ.set) {
                        if (!ctx.isFirstGameMove || ctx.player !== this.firstPlayer) {
                            if (!fromBank
                                && !ctx.freshFromBank.has(from)
                                && !ctx.freshFromBank.has(next)
                                && !CanoeGame.isInAnyBank(next)) {
                                dests.set(next, "pinch");
                            }
                        }
                    } else if (occ.owner === ctx.player && occ.face === eff && !occ.set && !ctx.isPlayerFirstTurn) {
                        if (!fromBank
                            && !ctx.freshFromBank.has(from)
                            && !ctx.freshFromBank.has(next)
                            && !CanoeGame.isInBank(ctx.player, next)) {
                            dests.set(next, "set");
                        }
                    }
                } else if (occ === undefined) {
                    if (!this.canOccupyBankCell(ctx.player, cell, next, stack)) {
                        continue;
                    }
                    dfs(next, remaining - 1, new Set([...visited, next]));
                }
            }
        };
        dfs(from, die, new Set([from]));

        if (this.canBearOff(from, die, ctx, false)) {
            dests.set("off", "move");
        }

        return dests;
    }

    private getSeventhCubeDestinations(
        from: string,
        die: number,
        ctx: IMoveContext,
        stack: CellStack,
    ): Map<string, "move"|"pinch"|"set"> {
        const dests = new Map<string, "move"|"pinch"|"set">();
        const [sc, sr] = CanoeGame.algebraic2coords(from);

        const walk = (col: number, row: number, remaining: number, prev?: string): void => {
            if (remaining === 0) {
                const c = CanoeGame.coords2algebraic(col, row);
                if (prev === undefined || this.canOccupyBankCell(ctx.player, prev, c, stack)) {
                    dests.set(c, "move");
                }
                return;
            }
            if (remaining === 1 && CanoeGame.isSetBearOffLaunchCell(ctx.player, col, row)) {
                dests.set("off", "move");
            }
            const fromCell = CanoeGame.coords2algebraic(col, row);
            for (const land of this.bearOffStepLandings(ctx.player, stack, col, row, fromCell)) {
                const [lc, lr] = CanoeGame.algebraic2coords(land);
                walk(lc, lr, remaining - 1, fromCell);
            }
        };
        walk(sc, sr, die);

        if (this.canBearOff(from, die, ctx, false)) {
            dests.set("off", "move");
        }

        const cells = new Set([...dests.keys()]);
        this.filterDirectRouteDestinations(ctx.player, from, cells);
        for (const dest of [...dests.keys()]) {
            if (!cells.has(dest)) {
                dests.delete(dest);
            }
        }
        return dests;
    }

    private static setBearOffLaunchAlgebraic(player: playerid): string {
        if (player === 1) {
            return CanoeGame.coords2algebraic(4, 6);
        }
        return CanoeGame.coords2algebraic(6, 4);
    }

    private pathHow(path: string[] | undefined): string | undefined {
        if (path === undefined || path.length === 0) {
            return undefined;
        }
        return path.join(",");
    }

    private findSingleCubePath(
        from: string,
        to: string,
        die: number,
        ctx: IMoveContext,
        mode: "move"|"pinch"|"set",
    ): string[] | undefined {
        const stack = this.board.get(from);
        if (stack === undefined || stack.owner !== ctx.player || stack.set) {
            return undefined;
        }
        if (this.isSeventhCube(ctx.player) && mode === "move") {
            return this.findBearOffStylePath(from, to, die, ctx, stack);
        }
        const eff = this.effectiveFace(stack, die);
        const fromBank = CanoeGame.isInBank(ctx.player, from);

        type State = {cell: string; remaining: number; path: string[]};
        const queue: State[] = [{cell: from, remaining: die, path: [from]}];
        const seen = new Set<string>();

        while (queue.length > 0) {
            const {cell, remaining, path} = queue.shift()!;
            const visitKey = `${cell}:${remaining}`;
            if (seen.has(visitKey)) {
                continue;
            }
            seen.add(visitKey);

            if (remaining === 0) {
                continue;
            }
            for (const next of this.getNeighbours(cell)) {
                if (path.includes(next)) {
                    continue;
                }
                if (CanoeGame.isInBank(this.opponent(ctx.player), next)) {
                    continue;
                }
                const occ = this.board.get(next);
                if (remaining === 1) {
                    if (next !== to) {
                        continue;
                    }
                    if (mode === "move" && occ === undefined) {
                        if (fromBank && CanoeGame.isInBank(ctx.player, next) && CanoeGame.isOnGrid(cell)) {
                            continue;
                        }
                        if (!this.canOccupyBankCell(ctx.player, cell, next, stack)) {
                            continue;
                        }
                        if (fromBank && !CanoeGame.isOnGrid(next) && !this.canReachGridFromBank(from, die)) {
                            continue;
                        }
                        if (this.isSeventhCube(ctx.player)) {
                            const dests = this.getSingleDestinations(from, die, ctx);
                            if (!dests.has(to)) {
                                continue;
                            }
                        }
                        return [...path, next];
                    }
                    if (mode === "pinch"
                        && occ !== undefined
                        && occ.owner !== ctx.player
                        && occ.face === eff
                        && !occ.set
                        && (!ctx.isFirstGameMove || ctx.player !== this.firstPlayer)
                        && !fromBank
                        && !ctx.freshFromBank.has(from)
                        && !ctx.freshFromBank.has(next)
                        && !CanoeGame.isInAnyBank(next)) {
                        return [...path, next];
                    }
                    if (mode === "set"
                        && occ !== undefined
                        && occ.owner === ctx.player
                        && occ.face === eff
                        && !occ.set
                        && !ctx.isPlayerFirstTurn
                        && !fromBank
                        && !ctx.freshFromBank.has(from)
                        && !ctx.freshFromBank.has(next)
                        && !CanoeGame.isInBank(ctx.player, next)) {
                        return [...path, next];
                    }
                } else if (occ === undefined) {
                    if (!this.canOccupyBankCell(ctx.player, cell, next, stack)) {
                        continue;
                    }
                    queue.push({cell: next, remaining: remaining - 1, path: [...path, next]});
                }
            }
        }

        return undefined;
    }

    private findSetPath(from: string, to: string, distance: number, ctx: IMoveContext): string[] | undefined {
        const stack = this.board.get(from);
        if (stack === undefined || stack.owner !== ctx.player || !stack.set) {
            return undefined;
        }
        return this.findBearOffStylePath(from, to, distance, ctx, stack);
    }

    private findBearOffStylePath(
        from: string,
        to: string,
        distance: number,
        ctx: IMoveContext,
        stack: CellStack,
    ): string[] | undefined {
        const target = to === "off" ? CanoeGame.setBearOffLaunchAlgebraic(ctx.player) : to;
        const [sc, sr] = CanoeGame.algebraic2coords(from);

        type State = {col: number; row: number; remaining: number; path: string[]; prev?: string};
        const queue: State[] = [{col: sc, row: sr, remaining: distance, path: [from]}];
        const seen = new Set<string>();

        while (queue.length > 0) {
            const state = queue.shift()!;
            const visitKey = `${state.col},${state.row},${state.remaining}`;
            if (seen.has(visitKey)) {
                continue;
            }
            seen.add(visitKey);

            const {col, row, remaining, path, prev} = state;
            const fromCell = CanoeGame.coords2algebraic(col, row);

            if (remaining === 0) {
                if (fromCell === target
                    && (prev === undefined || this.canOccupyBankCell(ctx.player, prev, fromCell, stack))) {
                    return path;
                }
                continue;
            }
            if (remaining === 1 && to === "off" && CanoeGame.isSetBearOffLaunchCell(ctx.player, col, row)) {
                if (prev === undefined || this.canOccupyBankCell(ctx.player, prev, fromCell, stack)) {
                    return path;
                }
            }

            for (const land of this.bearOffStepLandings(ctx.player, stack, col, row, fromCell)) {
                const [lc, lr] = CanoeGame.algebraic2coords(land);
                queue.push({
                    col: lc,
                    row: lr,
                    remaining: remaining - 1,
                    path: [...path, land],
                    prev: fromCell,
                });
            }
        }

        return undefined;
    }

    private canReachGridFromBank(from: string, die: number): boolean {
        let foundGrid = false;
        const dfs = (cell: string, remaining: number, visited: Set<string>): void => {
            if (foundGrid || remaining === 0) {
                return;
            }
            for (const next of this.getNeighbours(cell)) {
                if (visited.has(next)) {
                    continue;
                }
                const occ = this.board.get(next);
                if (remaining === 1) {
                    if (occ === undefined && CanoeGame.isOnGrid(next)) {
                        foundGrid = true;
                    }
                } else if (occ === undefined) {
                    dfs(next, remaining - 1, new Set([...visited, next]));
                }
            }
        };
        dfs(from, die, new Set([from]));
        return foundGrid;
    }

    private directionsTowardBearOff(player: playerid, col: number, row: number): Array<[number, number]> {
        const dirs: Array<[number, number]> = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        return dirs.filter(([dc, dr]) => {
            const nc = col + dc;
            const nr = row + dr;
            return this.cellAt(nc, nr) !== undefined
                && this.setMoveTowardBearOff(player, col, row, nc, nr);
        });
    }

    private cellAt(col: number, row: number): string | undefined {
        if (col < 0 || row < 0 || col >= BOARD_SIZE || row >= BOARD_SIZE) {
            return undefined;
        }
        if (CanoeGame.isBlocked(row, col)) {
            return undefined;
        }
        return CanoeGame.coords2algebraic(col, row);
    }

    private pinThroughBankLanding(player: playerid, blockerCol: number, blockerRow: number): string | undefined {
        const blocker = this.cellAt(blockerCol, blockerRow);
        if (blocker === undefined || !this.board.has(blocker)) {
            return undefined;
        }
        if (player === 1) {
            if (blockerCol !== 0) {
                return undefined;
            }
            const land = this.cellAt(0, blockerRow + 1);
            if (land === undefined || this.board.has(land)) {
                return undefined;
            }
            return CanoeGame.isInBank(player, land) ? land : undefined;
        }
        if (blockerRow !== 0) {
            return undefined;
        }
        const land = this.cellAt(blockerCol + 1, 0);
        if (land === undefined || this.board.has(land)) {
            return undefined;
        }
        return CanoeGame.isInBank(player, land) ? land : undefined;
    }

    private scanStraightJumpLandings(
        player: playerid,
        stack: CellStack,
        fromCol: number,
        fromRow: number,
        dc: number,
        dr: number,
        fromCell: string,
    ): string[] {
        const landings: string[] = [];
        const nc = fromCol + dc;
        const nr = fromRow + dr;
        const adjacent = this.cellAt(nc, nr);
        if (adjacent === undefined) {
            return landings;
        }
        if (!this.board.has(adjacent)) {
            if (this.setMoveTowardBearOff(player, fromCol, fromRow, nc, nr)
                && this.canOccupyBankCell(player, fromCell, adjacent, stack)) {
                landings.push(adjacent);
            }
            return landings;
        }
        let jc = nc + dc;
        let jr = nr + dr;
        while (true) {
            const land = this.cellAt(jc, jr);
            if (land === undefined) {
                break;
            }
            if (!this.board.has(land)) {
                if (this.setMoveTowardBearOff(player, fromCol, fromRow, jc, jr)
                    && this.canOccupyBankCell(player, fromCell, land, stack)) {
                    landings.push(land);
                }
                break;
            }
            jc += dc;
            jr += dr;
        }
        const pinLand = this.pinThroughBankLanding(player, nc, nr);
        if (pinLand !== undefined
            && !landings.includes(pinLand)) {
            const [plc, plr] = CanoeGame.algebraic2coords(pinLand);
            if (this.setMoveTowardBearOff(player, fromCol, fromRow, plc, plr)
                && this.canOccupyBankCell(player, fromCell, pinLand, stack)) {
                landings.push(pinLand);
            }
        }
        return landings;
    }

    private bearOffStepLandings(
        player: playerid,
        stack: CellStack,
        col: number,
        row: number,
        fromCell: string,
    ): string[] {
        const landings: string[] = [];
        for (const [dc, dr] of this.directionsTowardBearOff(player, col, row)) {
            for (const land of this.scanStraightJumpLandings(player, stack, col, row, dc, dr, fromCell)) {
                if (!landings.includes(land)) {
                    landings.push(land);
                }
            }
        }
        return landings;
    }

    private getSetDestinations(from: string, distance: number, ctx: IMoveContext): Set<string> {
        const dests = new Set<string>();
        const stack = this.board.get(from);
        if (stack === undefined || stack.owner !== ctx.player || !stack.set) {
            return dests;
        }
        const [sc, sr] = CanoeGame.algebraic2coords(from);

        const walk = (col: number, row: number, remaining: number, prev?: string): void => {
            if (remaining === 0) {
                const c = CanoeGame.coords2algebraic(col, row);
                if (prev === undefined || this.canOccupyBankCell(ctx.player, prev, c, stack)) {
                    dests.add(c);
                }
                return;
            }
            if (remaining === 1 && CanoeGame.isSetBearOffLaunchCell(ctx.player, col, row)) {
                const c = CanoeGame.coords2algebraic(col, row);
                if (prev === undefined || this.canOccupyBankCell(ctx.player, prev, c, stack)) {
                    dests.add("off");
                }
            }
            const fromCell = CanoeGame.coords2algebraic(col, row);
            for (const land of this.bearOffStepLandings(ctx.player, stack, col, row, fromCell)) {
                const [lc, lr] = CanoeGame.algebraic2coords(land);
                walk(lc, lr, remaining - 1, fromCell);
            }
        };
        walk(sc, sr, distance);

        this.filterDirectRouteDestinations(ctx.player, from, dests);
        this.filterSetBankStallsWhenBearOffAvailable(ctx.player, dests);

        return dests;
    }

    private canBearOff(from: string, die: number, ctx: IMoveContext, isSet: boolean): boolean {
        const stack = this.board.get(from);
        if (stack === undefined || stack.owner !== ctx.player) {
            return false;
        }
        if (!stack.set && isSet) {
            return false;
        }
        if (stack.set && !isSet) {
            return false;
        }
        const count = this.countOnBoard(ctx.player);
        if (!stack.set && count > 1) {
            const others = this.cubesOnBoard(ctx.player).filter(c => c !== from);
            if (others.length > 0) {
                return false;
            }
        }
        if (stack.set) {
            return this.getSetDestinations(from, die, ctx).has("off")
                || this.bearingDistance(from, ctx.player) === die;
        }
        return this.bearingDistance(from, ctx.player) === die;
    }

    private setDistanceToBearOff(player: playerid, col: number, row: number): number {
        if (player === 1) {
            if (row <= 4 && col <= 4) {
                return col + (6 - row) + 4;
            }
            if (row >= 5 && col <= 4) {
                return (6 - row) + (4 - col);
            }
            return Number.MAX_SAFE_INTEGER;
        }
        if (row <= 4 && col <= 4) {
            return row + (6 - col) + 4;
        }
        if (col >= 5 && row <= 4) {
            return (6 - col) + (4 - row);
        }
        return Number.MAX_SAFE_INTEGER;
    }

    private setDistanceToBearOffFromCell(player: playerid, cell: string): number {
        const [col, row] = CanoeGame.algebraic2coords(cell);
        return this.setDistanceToBearOff(player, col, row);
    }

    private setMoveTowardBearOff(player: playerid, fromCol: number, fromRow: number, toCol: number, toRow: number): boolean {
        return this.setDistanceToBearOff(player, toCol, toRow)
            < this.setDistanceToBearOff(player, fromCol, fromRow);
    }

    private filterToMinimalBearOffDistance(player: playerid, dests: Set<string>): void {
        let minDist = Number.MAX_SAFE_INTEGER;
        for (const dest of dests) {
            if (dest === "off") {
                continue;
            }
            minDist = Math.min(minDist, this.setDistanceToBearOffFromCell(player, dest));
        }
        if (minDist === Number.MAX_SAFE_INTEGER) {
            return;
        }
        for (const dest of [...dests]) {
            if (dest === "off") {
                continue;
            }
            if (this.setDistanceToBearOffFromCell(player, dest) > minDist) {
                dests.delete(dest);
            }
        }
    }

    private filterDirectRouteDestinations(player: playerid, from: string, dests: Set<string>): void {
        const startDist = this.setDistanceToBearOffFromCell(player, from);
        for (const dest of [...dests]) {
            if (dest === "off") {
                continue;
            }
            if (this.setDistanceToBearOffFromCell(player, dest) >= startDist) {
                dests.delete(dest);
            }
        }
        this.filterToMinimalBearOffDistance(player, dests);
    }

    private filterSetBankStallsWhenBearOffAvailable(player: playerid, dests: Set<string>): void {
        if (!dests.has("off")) {
            return;
        }
        for (const dest of [...dests]) {
            if (dest !== "off" && CanoeGame.isInBank(player, dest)) {
                dests.delete(dest);
            }
        }
    }

    private bearingDistance(from: string, player: playerid): number {
        const [col, row] = CanoeGame.algebraic2coords(from);
        if (player === 1) {
            if (row <= 4) {
                return col + 1 + (5 - row);
            }
            return col + 1 + (row - 4);
        }
        if (col <= 4) {
            return row + 1 + (5 - col);
        }
        return row + 1 + (col - 4);
    }

    private getHalfMoves(die: number, ctx: IMoveContext): string[] {
        const moves: string[] = [];
        const seen = new Set<string>();
        const combined = this.roll !== undefined && this.roll.length === 2 && die === this.roll[0] + this.roll[1];
        for (const [from, stack] of this.board.entries()) {
            if (stack.owner !== ctx.player) {
                continue;
            }
            if (ctx.blockedFrom.has(from)) {
                continue;
            }
            if (combined && !stack.set) {
                continue;
            }
            if (stack.set) {
                for (const to of this.getSetDestinations(from, die, ctx)) {
                    const diceKey = this.diceKeyForDistance(die);
                    const key = to === "off" ? `${diceKey}:${from}-off` : `${diceKey}:${from}-${to}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        moves.push(key);
                    }
                }
            } else if (!combined) {
                const diceKey = this.diceKeyForDistance(die);
                for (const [to, kind] of this.getSingleDestinations(from, die, ctx)) {
                    let key: string;
                    if (kind === "pinch") {
                        key = `${diceKey}:${from}x${to}`;
                    } else if (kind === "set") {
                        key = `${diceKey}:${from}+${to}`;
                    } else if (to === "off") {
                        key = `${diceKey}:${from}-off`;
                    } else {
                        key = `${diceKey}:${from}-${to}`;
                    }
                    if (!seen.has(key)) {
                        seen.add(key);
                        moves.push(key);
                    }
                }
            }
        }
        return moves;
    }

    private buildContext(usedDice: number[] = [], completedHalves: string[] = []): IMoveContext {
        let blockedFrom: Set<string>;
        if (this.isSeventhCube(this.currplayer)) {
            blockedFrom = new Set<string>();
        } else {
            blockedFrom = CanoeGame.blockedFromAfterHalves(completedHalves);
            for (const cell of [...blockedFrom]) {
                if (this.board.get(cell)?.set) {
                    blockedFrom.delete(cell);
                }
            }
        }
        return {
            player: this.currplayer,
            freshFromBank: new Set(this.freshFromBankThisTurn),
            usedDice,
            blockedFrom,
            isFirstGameMove: this.isFirstGameMove(),
            isPlayerFirstTurn: this.isPlayerFirstPlayTurn(this.currplayer),
        };
    }

    public moves(): string[] {
        if (this.gameover || this.phase !== "play") {
            return [];
        }
        if (this.roll === undefined) {
            return [];
        }

        const moves: string[] = [];

        if (this.roll.length === 1) {
            const base = this.turnBaseline();
            const ctx = base.buildContext();
            moves.push(...base.getHalfMoves(this.roll[0], ctx));
            if (moves.length === 0) {
                moves.push("pass");
            }
            return moves;
        }

        const [d1, d2] = this.roll;

        if (this.partialMove !== undefined) {
            const segments = this.partialMove.split(",").filter(s => s.length > 0);
            const completedHalves = segments.filter(h => CanoeGame.isCompleteHalf(h));
            const diceUsed = new Set<number>();
            for (const half of completedHalves) {
                const spec = CanoeGame.halfDiceSpec(half);
                if (spec === undefined) {
                    continue;
                }
                if (CanoeGame.isCombinedDiceSpec(spec)) {
                    moves.push(this.partialMove);
                    return moves;
                }
                const dist = CanoeGame.halfDieDistance(half);
                if (dist !== undefined) {
                    diceUsed.add(dist);
                }
            }
            if (completedHalves.length > 0 && diceUsed.size < 2) {
                const cloned = this.turnBaseline();
                cloned.move(completedHalves.join(","), {partial: true, trusted: true});
                const usedDie = [...diceUsed][0]!;
                const remaining = CanoeGame.remainingDie(this.roll as [number, number], usedDie);
                const ctx2 = cloned.buildContext([usedDie], completedHalves);
                const prefix = completedHalves.join(",");
                for (const second of cloned.getHalfMoves(remaining, ctx2)) {
                    moves.push(`${prefix},${second}`);
                }
                if (moves.length === 0) {
                    moves.push("pass");
                }
                return [...new Set(moves)];
            }
        }

        const base = this.turnBaseline();
        const ctx = base.buildContext();
        const firstMoves: string[] = [];
        firstMoves.push(...base.getHalfMoves(d1, ctx));
        firstMoves.push(...base.getHalfMoves(d2, ctx));
        firstMoves.push(...base.getHalfMoves(d1 + d2, ctx));

        for (const first of firstMoves) {
            const diceSpec = CanoeGame.halfDiceSpec(first);
            const dieUsed = CanoeGame.halfDieDistance(first);
            if (dieUsed === undefined || diceSpec === undefined) {
                continue;
            }
            if (CanoeGame.isCombinedDiceSpec(diceSpec)) {
                moves.push(first);
                continue;
            }
            if (base.isClearingBearOffHalf(first)) {
                moves.push(first);
                continue;
            }
            const cloned = this.turnBaseline();
            cloned.move(first, {partial: true, trusted: true});
            const remaining = dieUsed === d1 ? d2 : d1;
            const ctx2 = cloned.buildContext([dieUsed], [first]);
            for (const second of cloned.getHalfMoves(remaining, ctx2)) {
                moves.push(`${first},${second}`);
            }
        }

        if (moves.length === 0) {
            moves.push("pass");
        }
        return [...new Set(moves)];
    }

    public getButtons(): ICustomButton[] {
        const buttons: ICustomButton[] = [];
        if (this.phase === "play" && this.roll === undefined && this.isStymieEligible()) {
            buttons.push({label: "roll1", move: "roll:1"}, {label: "roll2", move: "roll:2"});
        }
        if (this.phase === "play" && this.moves().includes("pass")) {
            buttons.push({label: "pass", move: "pass"});
        }
        return buttons;
    }

    private static hasLocalHalf(game: CanoeGame, die: number, ctx: IMoveContext, activePartial: string): boolean {
        const halves = game.getHalfMoves(die, ctx);
        const normalized = CanoeGame.normalizePlayMove(activePartial);
        const fromOnly = normalized.match(/^(\d+(?:\+\d+)?):([a-g][1-7])$/);
        if (fromOnly !== null) {
            const diePrefix = fromOnly[1];
            return halves.some(h => CanoeGame.moveStartsWithPrefix(h, `${diePrefix}:${fromOnly[2]}`));
        }
        if (CanoeGame.isCompleteHalf(activePartial)) {
            return halves.some(h => CanoeGame.halfMovesEquivalent(h, activePartial));
        }
        return false;
    }

    private isLocallyLegalPlayPartial(m: string): boolean {
        if (this.roll === undefined || this.roll.length !== 2) {
            return false;
        }
        const {prefix, partial: parsedPartial} = CanoeGame.parseMoveSegments(m);
        let activePartial: string;
        const completedHalves = prefix.split(",").filter(h => h.length > 0 && CanoeGame.isCompleteHalf(h));

        if (parsedPartial.length === 0) {
            if (!CanoeGame.isCompleteHalf(prefix)) {
                return false;
            }
            activePartial = prefix;
        } else {
            activePartial = parsedPartial;
            if (completedHalves.length > 0) {
                try {
                    const cloned = this.turnBaseline();
                    cloned.move(completedHalves.join(","), {partial: true, trusted: true});
                    const die = CanoeGame.selectedDieFromPartial(activePartial);
                    if (die === undefined) {
                        return false;
                    }
                    const ctx = cloned.buildContext(
                        completedHalves.map(h => CanoeGame.halfDieDistance(h)!),
                        completedHalves,
                    );
                    return CanoeGame.hasLocalHalf(cloned, die, ctx, activePartial);
                } catch {
                    return false;
                }
            }
        }

        const die = CanoeGame.selectedDieFromPartial(activePartial);
        if (die === undefined) {
            return false;
        }

        const baseline = this.turnBaseline();
        const ctx = baseline.buildContext(
            completedHalves.map(h => CanoeGame.halfDieDistance(h)!),
            completedHalves,
        );
        return CanoeGame.hasLocalHalf(baseline, die, ctx, activePartial);
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        m = m.toLowerCase().replace(/\s+/g, "");
        if (!this.phase.startsWith("setup")) {
            m = CanoeGame.normalizePlayMove(m);
        }

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            if (this.phase.startsWith("setup")) {
                result.message = i18next.t("apgames:validation.canoe.SETUP_INSTRUCTIONS");
            } else if (this.roll === undefined) {
                result.message = i18next.t("apgames:validation.canoe.STYMIE_ROLL");
            } else {
                result.message = i18next.t("apgames:validation.canoe.INITIAL_INSTRUCTIONS");
            }
            return result;
        }

        if (m === "pass") {
            const passMoves = this.phase === "play" ? this.turnBaseline().moves() : this.moves();
            if (this.phase !== "play" || !passMoves.includes("pass")) {
                result.message = i18next.t("apgames:validation.canoe.NO_PASS");
                return result;
            }
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        if (m.startsWith("roll:")) {
            if (!this.isStymieEligible() || this.roll !== undefined) {
                result.message = i18next.t("apgames:validation.canoe.BAD_ROLL");
                return result;
            }
            const n = parseInt(m.split(":")[1], 10);
            if (n !== 1 && n !== 2) {
                result.message = i18next.t("apgames:validation.canoe.BAD_ROLL");
                return result;
            }
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        if (this.phase.startsWith("setup")) {
            return this.validateSetupMove(m);
        }

        if (this.roll === undefined) {
            result.message = i18next.t("apgames:validation.canoe.STYMIE_ROLL");
            return result;
        }

        if (this.partialMove !== undefined && m === this.partialMove) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.canoe.VALID_PARTIAL");
            return result;
        }

        const all = this.turnBaseline().moves();
        if (all.includes(m)) {
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
        if (this.roll.length === 2) {
            const withSecondDie = CanoeGame.autocompleteAfterFirstHalf(m, this.roll as [number, number]);
            if (withSecondDie !== undefined) {
                const expandedPartials = all.filter(mv => CanoeGame.moveStartsWithPrefix(mv, withSecondDie));
                if (expandedPartials.length > 0) {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.autocomplete = withSecondDie;
                    result.message = i18next.t("apgames:validation.canoe.VALID_PARTIAL");
                    return result;
                }
            }
        }
        const partials = all.filter(mv => CanoeGame.moveStartsWithPrefix(mv, m));
        if (partials.length > 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            if (partials.length === 1 && partials[0] !== m) {
                result.autocomplete = partials[0];
            }
            result.message = i18next.t("apgames:validation.canoe.VALID_PARTIAL");
            return result;
        }
        const dieSpecPartial = CanoeGame.parsePartialDiceSpec(m);
        if (dieSpecPartial !== undefined && this.isValidDieOnlyPartial(dieSpecPartial)) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.canoe.VALID_PARTIAL");
            return result;
        }
        if (dieSpecPartial !== undefined && CanoeGame.isCombinedDiceSpec(dieSpecPartial) && this.roll.length === 2) {
            const [d1, d2] = this.roll;
            const canonical = this.combinedDiceKey(d1, d2);
            if (dieSpecPartial === canonical || dieSpecPartial === this.combinedDiceKey(d2, d1)) {
                result.message = i18next.t("apgames:validation.canoe.NO_COMBINED_MOVES", {die: dieSpecPartial});
                return result;
            }
        }
        if (this.roll.length === 2
            && !all.some(mv => CanoeGame.moveStartsWithPrefix(mv, m))
            && this.isLocallyLegalPlayPartial(m)) {
            result.message = i18next.t("apgames:validation.canoe.MUST_USE_BOTH_DICE");
            return result;
        }
        result.message = i18next.t("apgames:validation.canoe.INVALID_MOVE", {move: m});
        return result;
    }

    private validateSetupMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        const parts = m.split(",");
        const usedCells = new Set<string>();
        const usedFaces = new Map<CubeFace, number>();
        const pool = [...(this.setupRoll ?? [])];

        for (const part of parts) {
            const match = part.match(/^(\d+)@([a-g][1-7])$/);
            if (match === null) {
                result.message = i18next.t("apgames:validation.canoe.BAD_SETUP", {part});
                return result;
            }
            const face = parseInt(match[1], 10) as CubeFace;
            const cell = match[2];
            if (!CUBE_FACES.includes(face)) {
                result.message = i18next.t("apgames:validation.canoe.BAD_FACE", {face});
                return result;
            }
            if (!CanoeGame.isSetupCell(this.currplayer, cell)) {
                result.message = i18next.t("apgames:validation.canoe.BAD_SETUP_CELL", {cell});
                return result;
            }
            if (usedCells.has(cell)) {
                result.message = i18next.t("apgames:validation.canoe.DUP_CELL", {cell});
                return result;
            }
            usedCells.add(cell);
            usedFaces.set(face, (usedFaces.get(face) ?? 0) + 1);
        }

        for (const [face, count] of usedFaces) {
            const inPool = pool.filter(f => f === face).length;
            if (count > inPool) {
                result.message = i18next.t("apgames:validation.canoe.BAD_FACE_COUNT", {face});
                return result;
            }
        }

        if (parts.length < 6) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.canoe.SETUP_PARTIAL");
            return result;
        }
        if (parts.length === 6) {
            result.valid = true;
            result.complete = 0;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.canoe.SETUP_COMPLETE");
            return result;
        }
        result.message = i18next.t("apgames:validation.canoe.TOO_MANY_SETUP");
        return result;
    }

    private markCubeLeftBank(to: string): void {
        this.freshFromBankThisTurn.add(to);
    }

    private executeHalf(move: string): void {
        const ctx = this.buildContext();
        const bearOff = move.match(/^(\d+(?:\+\d+)?):([a-g][1-7])-off$/);
        if (bearOff !== null) {
            this.executeBearOff(CanoeGame.halfDieDistance(move)!, bearOff[2], ctx);
            return;
        }
        const pinch = move.match(/^(\d+(?:\+\d+)?):([a-g][1-7])x([a-g][1-7])$/);
        if (pinch !== null) {
            const die = CanoeGame.halfDieDistance(move)!;
            const from = pinch[2];
            const to = pinch[3];
            const stack = this.board.get(from)!;
            const how = this.pathHow(this.findSingleCubePath(from, to, die, ctx, "pinch"));
            const face = stack.set ? stack.face : this.rotateAndConvert(from, stack, die);
            const victimFace = this.board.get(to)!.face;
            this.board.delete(from);
            this.board.delete(to);
            this.board.set(to, stack);
            this.results.push({type: "move", from, to, what: face.toString(), how});
            this.results.push({type: "capture", where: to});
            this.addToPocket(this.currplayer, victimFace);
            return;
        }
        const setForm = move.match(/^(\d+(?:\+\d+)?):([a-g][1-7])\+([a-g][1-7])$/);
        if (setForm !== null) {
            const die = CanoeGame.halfDieDistance(move)!;
            const from = setForm[2];
            const to = setForm[3];
            const stack = this.board.get(from)!;
            const wasBank = CanoeGame.isInBank(stack.owner, from);
            const how = this.pathHow(this.findSingleCubePath(from, to, die, ctx, "set"));
            const face = stack.set ? stack.face : this.rotateAndConvert(from, stack, die);
            this.board.delete(from);
            this.board.delete(to);
            stack.set = true;
            this.board.set(to, stack);
            this.results.push({type: "move", from, to, what: face.toString(), how});
            this.results.push({type: "promote", where: to, from, to: "set"});
            if (wasBank && CanoeGame.crossesStartingLine(stack.owner, from, to)) {
                this.markCubeLeftBank(to);
            }
            return;
        }
        const regular = move.match(/^(\d+(?:\+\d+)?):([a-g][1-7])-([a-g][1-7])$/);
        if (regular !== null) {
            const die = CanoeGame.halfDieDistance(move)!;
            const from = regular[2];
            const to = regular[3];
            const stack = this.board.get(from)!;
            const wasBank = CanoeGame.isInBank(stack.owner, from);
            const how = stack.set
                ? this.pathHow(this.findSetPath(from, to, die, ctx))
                : this.pathHow(this.findSingleCubePath(from, to, die, ctx, "move"));
            const face = stack.set ? stack.face : this.rotateAndConvert(from, stack, die);
            this.board.delete(from);
            this.board.set(to, stack);
            this.results.push({type: "move", from, to, what: face.toString(), how});
            if (wasBank && CanoeGame.crossesStartingLine(stack.owner, from, to)) {
                this.markCubeLeftBank(to);
            }
            return;
        }
        throw new Error(`Invalid move segment: ${move}`);
    }

    private executeBearOff(die: number, from: string, ctx: IMoveContext): void {
        const stack = this.board.get(from)!;
        const how = stack.set
            ? this.pathHow(this.findSetPath(from, "off", die, ctx))
            : undefined;
        if (!stack.set) {
            this.rotateAndConvert(from, stack, die);
        }
        const player = stack.owner;
        if (how !== undefined && how.split(",").length > 1) {
            this.results.push({
                type: "move",
                from,
                to: CanoeGame.setBearOffLaunchAlgebraic(player),
                what: stack.face.toString(),
                how,
            });
        }
        if (!this.canoeDone) {
            if (this.hasLeakyCanoeVariant()) {
                this.addScore(player, Math.floor(CanoeGame.scoreFace(stack.face) / 2));
            } else {
                this.addToPocket(player, stack.face);
                if (stack.set && !this.hasNoCanoeVariant()) {
                    this.addToPocket(player, stack.face);
                }
            }
            this.canoeDone = true;
        } else {
            this.addToPocket(player, stack.face);
        }
        this.board.delete(from);
        this.results.push({type: "bearoff", from});

        if (this.countOnBoard(player) === 0 && this.countOnBoard(player === 1 ? 2 : 1) > 0) {
            this.sweepBoard(player);
        }
    }

    private sweepBoard(player: playerid): void {
        const other = (player === 1 ? 2 : 1) as playerid;
        for (const [cell, stack] of [...this.board.entries()]) {
            if (stack.owner === other) {
                this.addToPocket(player, stack.face);
                if (stack.set) {
                    this.addToPocket(player, stack.face);
                }
                this.board.delete(cell);
                this.results.push({type: "capture", where: cell});
            }
        }
    }

    public move(m: string, {trusted = false, partial = false, emulation = false} = {}): CanoeGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        this.emulated = emulation;
        m = m.toLowerCase().replace(/\s+/g, "");
        if (!trusted && m !== "pass") {
            const v = this.validateMove(m);
            if (!v.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", v.message);
            }
        }
        if (!trusted && !partial && !emulation && m !== "pass" && this.phase === "play" && !this.moves().includes(m)) {
            throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}));
        }

        this.results = [];
        this.highlights = [];
        this.selectedCell = undefined;
        if (!(partial && this.phase === "play")) {
            this.partialMove = undefined;
        }

        if (m.startsWith("roll:")) {
            const n = parseInt(m.split(":")[1], 10);
            const values: number[] = [];
            for (let i = 0; i < n; i++) {
                values.push(randomInt(6));
            }
            this.roll = values.length === 1 ? [values[0]] : [values[0], values[1]];
            this.results.push({type: "roll", values});
            if (!partial && !emulation) {
                this.lastmove = m;
                this.saveState();
            }
            return this;
        }

        if (this.phase.startsWith("setup")) {
            const placements = this.parseSetupMove(m);
            this.applySetupPlacements(placements);
            if (partial || emulation) {
                if (emulation) {
                    this.lastmove = m;
                }
                return this;
            }
            if (placements.size < 6) {
                throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation.canoe.SETUP_INCOMPLETE"));
            }
            this.finishSetup();
            this.lastmove = m;
            this.saveState();
            this.checkEOG();
            return this;
        }

        if (m === "pass") {
            this.results.push({type: "pass"});
            this.lastmove = m;
            if (!partial && !emulation) {
                this.endTurn();
            }
            return this;
        }

        const halves = m.split(",").filter(s => s.length > 0);

        if (partial && this.phase === "play") {
            this.syncFromStackEntry(this.stack[this.stack.length - 1]);
            const completeHalves = halves.filter(h => CanoeGame.isCompleteHalf(h));
            const hasIncomplete = halves.some(h => !CanoeGame.isCompleteHalf(h));
            for (const half of completeHalves) {
                this.executeHalf(half);
            }
            this.partialMove = m;
            if (hasIncomplete) {
                this.updatePlayHighlights(m);
                return this;
            }
            return this;
        }

        this.syncFromStackEntry(this.stack[this.stack.length - 1]);
        const legalBefore = this.turnBaseline().moves();
        for (const half of halves) {
            this.executeHalf(half);
        }

        this.lastmove = m;
        if (!partial && !emulation) {
            const withSecondDie = this.roll?.length === 2
                && halves.length === 1
                && CanoeGame.isCompleteHalf(halves[0])
                ? CanoeGame.autocompleteAfterFirstHalf(m, this.roll as [number, number])
                : undefined;
            if (withSecondDie !== undefined
                && legalBefore.some(mv => CanoeGame.moveStartsWithPrefix(mv, withSecondDie))) {
                return this;
            }
            this.endTurn();
        }
        return this;
    }

    private updatePlayHighlights(m: string): void {
        this.highlights = [];
        this.selectedCell = undefined;
        const {prefix, partial} = CanoeGame.parseMoveSegments(m);
        const normalizedPartial = CanoeGame.normalizePlayMove(partial);
        if (!normalizedPartial.match(/^\d+(?:\+\d+)?:[a-g][1-7]$/)) {
            return;
        }
        const die = CanoeGame.selectedDieFromPartial(normalizedPartial);
        if (die === undefined) {
            return;
        }
        const from = normalizedPartial.split(":")[1];
        const completedHalves = prefix.length > 0
            ? prefix.split(",").filter(h => CanoeGame.isCompleteHalf(h))
            : [];
        const usedDice: number[] = completedHalves.map(h => CanoeGame.halfDieDistance(h)!);
        const stack = this.board.get(from);
        if (stack === undefined) {
            return;
        }
        const ctx = this.buildContext(usedDice, completedHalves);
        const destList = stack.set
            ? [...this.getSetDestinations(from, die, ctx)]
            : [...this.getSingleDestinations(from, die, ctx).keys()];
        this.highlights = destList.filter(d => d !== from && d !== "off");
        if (destList.includes("off")) {
            this.highlights.push(CanoeGame.setBearOffClickCell(this.currplayer));
        }
        this.selectedCell = from;
        this.applyPartialRotation(from, die);
    }

    private applyPartialRotation(from: string, die: number): void {
        const stack = this.board.get(from);
        if (stack === undefined || stack.set) {
            return;
        }
        stack.face = CanoeGame.rotateFace(stack.face, die);
    }

    private endTurn(): void {
        this.freshFromBankThisTurn.clear();
        let newplayer = (this.currplayer + 1) as number;
        if (newplayer > this.numplayers) {
            newplayer = 1;
        }
        this.currplayer = newplayer as playerid;
        this.checkEOG();
        if (!this.gameover) {
            this.prepareNextTurnRoll();
        }
        this.saveState();
    }

    protected checkEOG(): CanoeGame {
        const p1 = this.countOnBoard(1);
        const p2 = this.countOnBoard(2);
        let passedOut = false;
        if ( (this.lastmove === "pass") && (this.stack[this.stack.length - 1].lastmove === "pass") ) {
            passedOut = true;
        }

        if ( passedOut ||((p1 === 0 || p2 === 0) && (this.stack.length > 3) ) ) {
            this.gameover = true;
            if (passedOut) {
                this.winner = [1, 2];
            } else {
                const s1 = this.pocket[0];
                const s2 = this.pocket[1];
                if (s1 > s2) {
                    this.winner = [1];
                } else if (s2 > s1) {
                    this.winner = [2];
                } else {
                    this.winner = [1, 2];
                }
            }
            this.results.push({type: "eog"}, {type: "winners", players: [...this.winner]});
        }
        return this;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            if (this.phase.startsWith("setup")) {
                return this.handleSetupClick(move, row, col, piece);
            }
            return this.handlePlayClick(move, row, col, piece);
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", {move, row, col, piece, emessage: (e as Error).message}),
            };
        }
    }

    private handleSetupClick(move: string, row: number, col: number, piece?: string): IClickResult {
        const cell = row >= 0 && col >= 0 ? CanoeGame.coords2algebraic(col, row) : undefined;
        const placements = this.currentSetupPlacements(move);
        move = this.formatSetupMove(placements);

        if (piece !== undefined && this.setupRoll !== undefined) {
            const indexed = piece.match(/^S(\d+)$/);
            if (indexed !== null) {
                const idx = parseInt(indexed[1], 10);
                if (this.setupRoll[idx] !== undefined) {
                    this.selectedSetupFace = this.setupRoll[idx];
                }
            } else {
                const faceMatch = piece.match(/^[AB](\d+)$/);
                if (faceMatch !== null) {
                    this.selectedSetupFace = parseInt(faceMatch[1], 10) as CubeFace;
                }
            }
        }

        if (cell !== undefined && CanoeGame.isSetupCell(this.currplayer, cell)) {
            if (placements.has(cell)) {
                placements.delete(cell);
                move = this.formatSetupMove(placements);
            } else {
                let face = this.selectedSetupFace;
                if (face === undefined) {
                    face = this.highestUnplacedFace(placements);
                }
                if (face !== undefined) {
                    placements.set(cell, face);
                    move = this.formatSetupMove(placements);
                }
            }
        }

        const result = this.validateMove(move) as IClickResult;
        result.move = result.valid ? move : move;
        if (!result.valid) {
            result.move = move;
        }
        return result;
    }

    private handlePlayClick(move: string, row: number, col: number, piece?: string): IClickResult {
        const cell = row >= 0 && col >= 0 ? CanoeGame.coords2algebraic(col, row) : undefined;
        const parsed = CanoeGame.parseMoveSegments(move);
        const {prefix} = parsed;
        let {partial} = parsed;

        const cloned = CanoeGame.clone(this);
        if (prefix.length > 0) {
            cloned.move(prefix, {partial: true, trusted: true});
        }

        const clickedDie = this.dieFromClick(cell, piece);
        const clickedSlot = this.dieSlotIndex(cell, piece);
        if (clickedDie !== undefined) {
            const dieOnly = CanoeGame.parseDieOnlyPartial(partial);
            const [d1, d2] = this.roll as [number, number];
            const partialForSlot = (die: number, slot?: number) => (
                slot === 1 ? `;${die}:` : `${die}:`
            );
            if (partial === "") {
                partial = partialForSlot(clickedDie, clickedSlot);
            } else if (dieOnly !== undefined) {
                if (this.roll!.length === 2
                    && clickedSlot !== undefined
                    && clickedSlot !== dieOnly.slot) {
                    if (d1 === d2) {
                        const spec = this.combinedDiceKey(d1, d2);
                        if (this.isValidDieOnlyPartial(spec)) {
                            partial = `${spec}:`;
                        } else {
                            partial = partialForSlot(dieOnly.die, dieOnly.slot);
                        }
                    } else if (dieOnly.die !== clickedDie) {
                        partial = `${dieOnly.die}+${clickedDie}:`;
                    } else {
                        partial = partialForSlot(clickedDie, clickedSlot);
                    }
                } else {
                    partial = partialForSlot(clickedDie, clickedSlot);
                }
            }
        } else {
            const die = CanoeGame.selectedDieFromPartial(partial);
            if (die !== undefined && cell !== undefined) {
                const completedHalves = prefix.length > 0
                    ? prefix.split(",").filter(h => CanoeGame.isCompleteHalf(h))
                    : [];
                const usedDice = completedHalves.map(h => CanoeGame.halfDieDistance(h)!);
                const ctx = cloned.buildContext(usedDice, completedHalves);
                const diePrefix = CanoeGame.dicePrefixBeforeColon(partial) ?? die.toString();
                const fromMatch = partial.match(/^(?:;)?(\d+(?:\+\d+)?):([a-g][1-7])$/);
                if (fromMatch !== null) {
                    const from = fromMatch[2];
                    if (cell === from) {
                        // keep selection
                    } else if (cloned.board.has(cell) && cloned.board.get(cell)!.owner === cloned.currplayer) {
                        const stack = cloned.board.get(from)!;
                        if (!stack.set) {
                            const dests = cloned.getSingleDestinations(from, die, ctx);
                            if (dests.get(cell) === "set") {
                                partial = `${diePrefix}:${from}+${cell}`;
                            } else {
                                partial = `${diePrefix}:${cell}`;
                            }
                        } else {
                            partial = `${diePrefix}:${cell}`;
                        }
                    } else if (cell === "off" || CanoeGame.CANOE_CELLS.includes(cell)) {
                        for (const [from] of cloned.board) {
                            const stack = cloned.board.get(from)!;
                            if (stack.owner !== cloned.currplayer) {
                                continue;
                            }
                            if (ctx.blockedFrom.has(from)) {
                                continue;
                            }
                            if (cloned.canBearOff(from, die, ctx, stack.set)) {
                                partial = `${diePrefix}:${from}-off`;
                                break;
                            }
                        }
                    } else {
                        const stack = cloned.board.get(from)!;
                        const dests = stack.set
                            ? cloned.getSetDestinations(from, die, ctx)
                            : cloned.getSingleDestinations(from, die, ctx);
                        if (dests.has(cell)) {
                            const kind = stack.set ? "-" : cloned.getSingleDestinations(from, die, ctx).get(cell);
                            if (kind === "pinch") {
                                partial = `${diePrefix}:${from}x${cell}`;
                            } else if (kind === "set") {
                                partial = `${diePrefix}:${from}+${cell}`;
                            } else {
                                partial = `${diePrefix}:${from}-${cell}`;
                            }
                        }
                    }
                } else if (partial.match(/^(?:;)?\d+(?:\+\d+)?:$/) && cloned.board.has(cell) && cloned.board.get(cell)!.owner === cloned.currplayer) {
                    partial = `${diePrefix}:${cell}`;
                }
            }
        }

        let combined: string;
        if (prefix.length > 0) {
            combined = partial.length > 0 ? `${prefix},${partial}` : prefix;
        } else {
            combined = partial;
        }

        let result = this.validateMove(combined) as IClickResult;
        if (result.autocomplete !== undefined) {
            combined = result.autocomplete;
            result = this.validateMove(combined) as IClickResult;
        }
        result.move = result.valid ? CanoeGame.normalizePlayMove(combined) : move;
        return result;
    }

    public getPlayerScore(player: playerid): number {
        return this.pocket[player - 1];
    }

    public sidebarScores(): IScores[] {
        return [{
            name: i18next.t("apgames:status.SCORES"),
            scores: [this.getPlayerScore(1), this.getPlayerScore(2)],
        }];
    }

    public render(): APRenderRep {
        const usedIndices = this.partialMove !== undefined && this.roll !== undefined
            ? CanoeGame.usedDieIndicesFromMove(this.partialMove, this.roll)
            : new Set<number>();

        const rows: string[][] = [];
        for (let row = 0; row < BOARD_SIZE; row++) {
            const line: string[] = [];
            for (let col = 0; col < BOARD_SIZE; col++) {
                const cell = CanoeGame.coords2algebraic(col, row);
                if (this.phase === "play" && CanoeGame.DICE_CELLS.includes(cell) && this.roll !== undefined) {
                    const idx = CanoeGame.DICE_CELLS.indexOf(cell);
                    if (idx < this.roll.length) {
                        line.push(CanoeGame.playDieGlyph(idx, usedIndices.has(idx)));
                        continue;
                    }
                }
                if (CanoeGame.isBlocked(row, col) && !CanoeGame.CANOE_CELLS.includes(cell)) {
                    line.push("-");
                    continue;
                }
                const stack = this.board.get(cell);
                if (stack !== undefined) {
                    line.push(this.pieceGlyph(stack));
                } else {
                    line.push("-");
                }
            }
            rows.push(line);
        }
        const pstr = rows.map(r => r.join(",")).join("\n");

        const legend: APRenderRep["legend"] = {};
        for (const face of CUBE_FACES) {
            legend[`A${face}`] = [
                {name: "piece-square", colour: 1},
                {text: face.toString()},
            ];
            legend[`B${face}`] = [
                {name: "piece-square", colour: 2},
                {text: face.toString()},
            ];
            legend[`A${face}s`] = [
                {name: "hex-flat", colour: 1},
                {text: face.toString(), scale: 0.85},
            ];
            legend[`B${face}s`] = [
                {name: "hex-flat", colour: 2},
                {text: face.toString(), scale: 0.85},
            ];
        }
        if (this.phase === "play" && this.roll !== undefined) {
            for (let idx = 0; idx < this.roll.length && idx < CanoeGame.DICE_CELLS.length; idx++) {
                const val = this.roll[idx];
                const slot = idx + 1;
                legend[`D${slot}`] = {name: `d6-${val}`, opacity: 1};
                legend[`U${slot}`] = {name: `d6-${val}`, opacity: 0.5};
            }
        }

        const markers: (MarkerLine | MarkerDots | MarkerLabel | MarkerFlood)[] = [
            {type: "line",colour:"_context_board",width:2,points: [{row:6,col:5}, {row:6,col:7}]},
            {type: "line",colour:"_context_board",width:2,points: [{row:5,col:6}, {row:7,col:6}]},
            {type: "line", points: [{row: 0, col: 5}, {row: 5, col: 5}], colour: 2, width: 2},
            {type: "line", points: [{row: 5, col: 0}, {row: 5, col: 5}], colour: 1, width: 2},
            {type: "line", points: [{row: 5, col: 6}, {row: 5, col: 7}], width: 3},
            {type: "line", points: [{row: 6, col: 5}, {row: 7, col: 5}], width: 3},
            {type: "line", points: [{row: 5, col: 7}, {row: 7, col: 7}]},
            {type: "line", points: [{row: 7, col: 5}, {row: 7, col: 7}]},
            {type: "dots", size: 0.25, points: [{row: 4.5, col: 0}, {row: 0, col: 4.5}]},
            {type: "label", label: "Canoe", points: [{row: 6.4, col: 5.4}, {row: 5.4, col: 6.4}]},
            {type: "flood", colour: 1, points: [{row: 5, col: 0}, {row: 5, col: 1}, {row: 5, col: 2}, {row: 5, col: 3}, {row: 5, col: 4}, {row: 6, col: 0}, {row: 6, col: 1}, {row: 6, col: 2}, {row: 6, col: 3}, {row: 6, col: 4}]},
            {type: "flood", colour: 2, points: [{row: 0, col: 5}, {row: 1, col: 5}, {row: 2, col: 5}, {row: 3, col: 5}, {row: 4, col: 5}, {row: 0, col: 6}, {row: 1, col: 6}, {row: 2, col: 6}, {row: 3, col: 6}, {row: 4, col: 6}]},
        ];

        const rep: APRenderRep = {
            board: {
                style: "squares",
                width: BOARD_SIZE,
                height: BOARD_SIZE,
                markers,
            },
            legend,
            pieces: pstr,
        };

        if (this.phase.startsWith("setup") && this.setupRoll !== undefined) {
            const placements = this.currentSetupPlacements(this.lastmove ?? "");
            const unplaced = this.unplacedSetupDieIndices(placements);
            for (const i of unplaced) {
                const face = this.setupRoll[i];
                legend[CanoeGame.setupDieGlyph(i)] = [
                    {name: "piece-square", colour: this.currplayer},
                    {text: face.toString()},
                ];
            }
            if (unplaced.length > 0) {
                rep.areas = [{
                    type: "pieces",
                    label: i18next.t("apgames:validation.canoe.SETUP_HAND"),
                    pieces: unplaced.map(i => CanoeGame.setupDieGlyph(i)) as [string, ...string[]],
                }];
            }
        }

        if (this.highlights.length > 0) {
            rep.annotations = [{
                type: "dots",
                targets: this.highlights.filter(h => h !== "off").map(h => {
                    const [col, row] = CanoeGame.algebraic2coords(h);
                    return {row, col};
                }) as [RowCol, ...RowCol[]],
            }];
        }

        if (this.selectedCell !== undefined) {
            const [col, row] = CanoeGame.algebraic2coords(this.selectedCell);
            rep.annotations = [...(rep.annotations ?? []), {type: "enter", targets: [{row, col}]}];
        }

        const resultAnnotations = this.buildResultAnnotations();
        if (resultAnnotations.length > 0) {
            rep.annotations = [...(rep.annotations ?? []), ...resultAnnotations];
        }

        return rep;
    }

    private buildResultAnnotations(): NonNullable<APRenderRep["annotations"]> {
        const annotations: NonNullable<APRenderRep["annotations"]> = [];
        // const mover = (this.currplayer % 2 + 1) as playerid;
        for (const r of this.results) {
            if (r.type === "move") {
                const how = (r as {how?: string}).how;
                if (how !== undefined && how.length > 0) {
                    const path = how.split(",");
                    for (let i = 1; i < path.length; i++) {
                        const [fromX, fromY] = CanoeGame.algebraic2coords(path[i - 1]);
                        const [toX, toY] = CanoeGame.algebraic2coords(path[i]);
                        annotations.push({
                            type: "move",
                            targets: [{row: fromY, col: fromX}, {row: toY, col: toX}],
                        });
                    }
                } else {
                    const [fromX, fromY] = CanoeGame.algebraic2coords(r.from);
                    const [toX, toY] = CanoeGame.algebraic2coords(r.to);
                    annotations.push({
                        type: "move",
                        targets: [{row: fromY, col: fromX}, {row: toY, col: toX}],
                    });
                }
            } else if (r.type === "capture") {
                const [x, y] = CanoeGame.algebraic2coords((r as {where: string}).where);
                annotations.push({type: "exit", targets: [{row: y, col: x}]});
            } else if (r.type === "bearoff") {
                const [x, y] = CanoeGame.algebraic2coords((r as {from: string}).from);
                annotations.push({type: "exit", targets: [{row: y, col: x}]});
            }
        }
        return annotations;
    }

    public state(): ICanoeState {
        return {
            game: CanoeGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    public moveState(): IMoveState {
        return {
            _version: CanoeGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            phase: this.phase,
            board: CanoeGame.cloneBoard(this.board),
            roll: this.roll === undefined ? undefined : [...this.roll] as [number, number] | [number],
            setupRoll: this.setupRoll === undefined ? undefined : [...this.setupRoll],
            gridCubes: [...this.gridCubes],
            pocket: [...this.pocket],
            canoeDone: this.canoeDone,
            firstPlayer: this.firstPlayer,
            lastmove: this.lastmove,
        };
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        switch (r.type) {
            case "roll":
                node.push(i18next.t("apresults:ROLL.canoe", {player, values: (r as {values: number[]}).values.join(",")}));
                return true;
            case "pass":
                node.push(i18next.t("apresults:PASS.canoe", {player}));
                return true;
            case "convert":
                node.push(i18next.t("apresults:CONVERT.canoe", {
                    player,
                    where: (r as {where: string}).where,
                    what: (r as {what: string}).what,
                    into: (r as {into: string}).into,
                }));
                return true;
            case "move":
                node.push(i18next.t("apresults:MOVE.complete_what", {
                    player,
                    what: (r as {what: string}).what,
                    from: (r as {from: string}).from,
                    to: (r as {to: string}).to,
                }));
                return true;
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.canoe", {player, where: (r as {where: string}).where}));
                return true;
            case "bearoff":
                node.push(i18next.t("apresults:BEAROFF.canoe", {player}));
                return true;
            case "promote":
                node.push(i18next.t("apresults:PROMOTE.canoe", {
                    player,
                    where: (r as {where: string}).where,
                    from: (r as {from: string}).from,
                }));
                return true;
            case "deltaScore":
                node.push(i18next.t("apresults:DELTA_SCORE_GAIN", {
                    player,
                    delta: (r as {delta: number}).delta,
                    count: (r as {delta: number}).delta,
                }));
                return true;
            default:
                return false;
        }
    }

    public clone(): CanoeGame {
        return new CanoeGame(this.serialize());
    }
}
