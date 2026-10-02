import { GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IScores, IValidationResult, type ChatLogCollectContext, type ChatLogLine, type FlagContext, type GameFlag } from "./_base.js";
import type { APGamesInformation } from "../schemas/gameinfo.js";
import { APRenderRep, Glyph, RowCol } from "@abstractplay/renderer/build/schemas/schema";
import type { APMoveResult } from "../schemas/moveresults.js";
import { hexhexAi2Ap, hexhexAp2Ai, reviver, UserFacingError } from "../common/index.js";
import i18next from "i18next";
import { HexTriGraph } from "../common/graphs/index.js";
import _ from "lodash";

export type playerid = 1|2|3;  // 3 is used for neutral player.
type directions = "NE"|"E"|"SE"|"SW"|"W"|"NW";
const allDirections: directions[] = ["NE","E","SE","SW","W","NW"];

/** Last-seen cell snapshot for fog; `null` means seen empty. */
export type FogCellSnapshot = [playerid, number] | null;
export type FogMemoryPair = [Map<string, FogCellSnapshot>, Map<string, FogCellSnapshot>];

const FOG_STALE_OPACITY = 0.35;

interface ILegendObj {
    [key: string]: Glyph|[Glyph, ...Glyph[]];
}

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, [playerid, number]>;
    lastmove?: string;
    scores: [number, number];
    fogMemory?: FogMemoryPair;
};

export interface ITumbleweedState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class TumbleweedGame extends GameBase {
    /** Shown in stripped state / move tree for hidden plies until game over. */
    public static readonly REDACTED_FOG_LASTMOVE = "\u2014";

    public static readonly gameinfo: APGamesInformation = {
        name: "Tumbleweed",
        uid: "tumbleweed",
        playercounts: [2],
        // version: "20231229",
        // Adding a "x" when a move is a capture and "+" when there is a reinforcement.
        version: "20240825",
        dateAdded: "2024-01-03",
        // i18next.t("apgames:descriptions.tumbleweed")
        description: "apgames:descriptions.tumbleweed",
        // i18next.t("apgames:notes.tumbleweed")
        notes: "apgames:notes.tumbleweed",
        urls: ["https://boardgamegeek.com/boardgame/318702/tumbleweed"],
        bggid: "318702",
        people: [
            {
                type: "designer",
                name: "Mike Zapawa",
                urls: ["https://boardgamegeek.com/boardgamedesigner/126470/mike-zapawa"],
            },
            {
                type: "coder",
                name: "ypaul",
                urls: [],
                apid: "46f6da78-be02-4469-94cb-52f17078e9c1",
            },
        ],
        categories: ["goal>area", "mechanic>place",  "mechanic>capture", "board>shape>hex", "board>connect>hex", "components>simple>3c"],
        flags: ["pie-even", "scores", "aiai", "custom-randomization"],
        variants: [
            { uid: "size-6", group: "board" },
            { uid: "#board", },
            { uid: "size-10", group: "board" },
            { uid: "capture-delay" },
            { uid: "free-neutral" },
            { uid: "fog", experimental: true },
        ],
        displays: [
            { uid: "hide-threatened" },
            { uid: "hide-influence" },
            { uid: "hide-both", implies: ["hide-threatened", "hide-influence"], impliesLock: true },
            { uid: "fog-unseen-clouds" },
        ],
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, [playerid, number]>;
    public graph?: HexTriGraph;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public scores: [number, number] = [0, 0];
    private boardSize = 0;
    private fogMemory: FogMemoryPair = [new Map(), new Map()];

    public static resolveFlags(context: FlagContext = {}): readonly GameFlag[] {
        const flags: GameFlag[] = [...(this.gameinfo.flags ?? [])];
        if (context.variants?.includes("fog")) {
            flags.push("no-explore");
        }
        return flags;
    }

    private static emptyFogMemory(): FogMemoryPair {
        return [new Map(), new Map()];
    }

    private static cloneFogPair(pair?: FogMemoryPair): FogMemoryPair {
        if (pair === undefined) {
            return TumbleweedGame.emptyFogMemory();
        }
        return [new Map(pair[0]), new Map(pair[1])];
    }

    /** HTML5-safe SVG ids; stale cells use `x` + live key. */
    private static staleLegendKey(liveKey: string): string {
        return `x${liveKey}`;
    }

    /** Legend key for never-explored fog cells (same `cloud` renderer glyph as Crosshairs). */
    private static readonly FOG_UNSEEN_LEGEND = "fogCloud";

    private fogEnabled(): boolean {
        return this.variants.includes("fog");
    }

    /** Standard setup only: centre cell when it holds the initial neutral stack. */
    private standardOpeningCentreCell(board: Map<string, [playerid, number]> = this.board): string | undefined {
        if (this.variants.includes("free-neutral")) {
            return undefined;
        }
        const centre = this.getCentre();
        const stack = board.get(centre);
        if (stack !== undefined && stack[0] === 3) {
            return centre;
        }
        return undefined;
    }

    /** Board still has only neutral piece(s) — before the committed opening placement. */
    private boardIsPrePlacementOpening(board: Map<string, [playerid, number]>): boolean {
        const centre = this.standardOpeningCentreCell(board);
        if (centre === undefined) {
            return false;
        }
        for (const [, [owner]] of board) {
            if (owner !== 3) {
                return false;
            }
        }
        return true;
    }

    private ensureOpeningCentreFogMemory(board: Map<string, [playerid, number]> = this.board): void {
        if (!this.fogEnabled()) {
            return;
        }
        const centre = this.standardOpeningCentreCell(board);
        if (centre === undefined) {
            return;
        }
        const snap: FogCellSnapshot = board.get(centre)!;
        for (const p of [0, 1] as const) {
            this.fogMemory[p].set(centre, snap);
        }
    }

    constructor(state?: ITumbleweedState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            // Graph and board size properties are assigned after because
            // they're common to both fresh and loaded games.
            const boardSize = this.getBoardSize();
            const board: Map<string, [playerid, number]> = new Map();
            if (!this.variants.includes("free-neutral")) {
                board.set(this.getCentre(boardSize), [3 as playerid, 2]);
            }
            let fogMemory: FogMemoryPair | undefined;
            if (this.fogEnabled()) {
                fogMemory = TumbleweedGame.emptyFogMemory();
                if (!this.variants.includes("free-neutral")) {
                    const centre = this.getCentre(boardSize);
                    if (board.has(centre)) {
                        const snap: FogCellSnapshot = board.get(centre)!;
                        fogMemory[0].set(centre, snap);
                        fogMemory[1].set(centre, snap);
                    }
                }
            }
            const fresh: IMoveState = {
                _version: TumbleweedGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                scores: [0, 0],
                ...(fogMemory !== undefined ? { fogMemory } : {}),
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ITumbleweedState;
            }
            if (state.game !== TumbleweedGame.gameinfo.uid) {
                throw new Error(`The Tumbleweed engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.boardSize = this.getBoardSize();
        this.load();
        this.buildGraph();
    }

    public load(idx = -1): TumbleweedGame {
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
        this.scores = [...state.scores];
        if (this.fogEnabled()) {
            this.fogMemory = TumbleweedGame.cloneFogPair(state.fogMemory);
            this.ensureOpeningCentreFogMemory(this.board);
        } else {
            this.fogMemory = TumbleweedGame.emptyFogMemory();
        }
        this.repairHistoricalOpeningLastmoves();
        return this;
    }

    private buildGraph(): HexTriGraph {
        this.graph = new HexTriGraph(this.boardSize, (this.boardSize * 2) - 1);
        return this.graph;
    }

    private getGraph(boardSize?: number): HexTriGraph {
        if (boardSize === undefined) {
            return (this.graph === undefined) ? this.buildGraph() : this.graph;
        } else {
            return new HexTriGraph(boardSize, (boardSize * 2) - 1);
        }
    }

    // Fixes known issue with some edge cases not calling load
    private listCells(ordered = false): string[] | string[][] {
        try {
            if (ordered === undefined) {
                return this.getGraph().listCells();
            } else {
                return this.getGraph().listCells(ordered);
            }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (e) {
            return this.buildGraph().listCells(ordered);
        }
    }

    private getBoardSize(): number {
        // Get board size from variants.
        if ( (this.variants !== undefined) && (this.variants.length > 0) && (this.variants[0] !== undefined) && (this.variants[0].length > 0) ) {
            const sizeVariants = this.variants.filter(v => v.includes("size"))
            if (sizeVariants.length > 0) {
                const size = sizeVariants[0].match(/\d+/);
                return parseInt(size![0], 10);
            }
            if (isNaN(this.boardSize)) {
                throw new Error(`Could not determine the board size from variant "${this.variants[0]}"`);
            }
        }
        return 8;
    }

    private getCentre(boardSize?: number): string {
        if (boardSize === undefined) {
            return this.getGraph().coords2algebraic(this.boardSize - 1, this.boardSize - 1);
        } else {
            return this.getGraph(boardSize).coords2algebraic(boardSize - 1, boardSize - 1);
        }
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves: string[] = [];
        if (this.stack.length === 1) {
            if (this.variants.includes("free-neutral")) {
                return ["No movelist in opening"];
            } else {
                // On first move, first player places two stones.
                const centre = this.getCentre();
                const cells = this.listCells() as string[];
                const playableCells = cells.filter(c => c !== centre);
                for (let i = 0; i < playableCells.length; i++) {
                    for (let j = 0; j < playableCells.length; j++) {
                        if (i === j) {
                            continue;
                        }
                        moves.push(`${playableCells[i]},${playableCells[j]}`);
                    }
                }
                return moves;
            }
        } else if (this.stack.length === 2 && player === 2) {
            return ["pass"];
        }
        const lm = this.lastmove!
        const suffixLastMove: string | undefined = lm[lm.length - 1] === "+" || lm[lm.length - 1] === "x" ? lm[lm.length - 1] : undefined;
        const withoutSuffixLastMave = suffixLastMove !== undefined ? lm.slice(0, lm.length - 1) : lm;
        const captureDelay = this.variants.includes("capture-delay");
        const useSuffixNotation = this.stack[0]._version !== "20231229";
        const losMap = this.computeLosForPlayer(player);
        const candidates = new Set<string>([...losMap.keys(), ...this.board.keys()]);
        for (const cell of candidates) {
            const losCount = losMap.get(cell) ?? 0;
            if (losCount === 0 || this.board.has(cell) && this.board.get(cell)![1] >= losCount) {
                continue;
            }
            if (captureDelay && withoutSuffixLastMave === cell) { continue;}
            if (useSuffixNotation) {
                // Games started after 20231229 have "x" and "+" in the notation.
                if (this.board.has(cell)) {
                    if (this.board.get(cell)![0] === player) {
                        moves.push(cell + "+");
                    } else {
                        moves.push(cell + "x");
                    }
                } else {
                    moves.push(cell);
                }
            } else {
                moves.push(cell);
            }
        }
        // forbidding pass on ply 3 because it's almost never wanted
        // https://discord.com/channels/526483743180062720/1204190463234412594
        if (this.stack.length !== 3) {
            moves.push("pass");
        }
        return moves;
    }

    public randomMove(): string {
        if (this.stack.length === 1 && this.variants.includes("free-neutral")) {
            return _.sampleSize(this.listCells() as string[], 3).join(",")
        }
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = "";
            const cell = this.getGraph().coords2algebraic(col, row);
            if (move === "") {
                if (this.stack[0]._version !== "20231229" && this.stack.length > 1 && this.board.has(cell)) {
                    if (this.board.get(cell)![0] === this.currplayer) {
                        newmove = cell + "+";
                    } else {
                        newmove = cell + "x";
                    }
                } else {
                    newmove = cell;
                }
            } else {
                const split = move.split(",");
                const last = split[split.length - 1];
                if (last === cell) {
                    newmove = split.slice(0, split.length - 1).join(",");
                } else {
                    newmove = `${move},${cell}`;
                }
            }

            const result = this.validateMove(newmove) as IClickResult;
            if (! result.valid) {
                result.move = move;
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

    private getLosCount(cell: string, player: playerid, board: Map<string, [playerid, number]> = this.board): number {
        let losCount = 0;
        const graph = this.getGraph();
        const [x, y] = graph.algebraic2coords(cell);
        for (const dir of allDirections) {
            for (const [cx, cy] of graph.ray(x, y, dir)) {
                const c = graph.coords2algebraic(cx, cy);
                if (board.has(c)) {
                    if (board.get(c)![0] === player) {
                        losCount++;
                    }
                    break;
                }
            }
        }
        return losCount;
    }

    private computeLosForPlayer(player: playerid, board: Map<string, [playerid, number]> = this.board): Map<string, number> {
        const los = new Map<string, number>();
        const graph = this.getGraph();
        for (const [cell, [owner]] of board) {
            if (owner !== player) {
                continue;
            }
            const [x, y] = graph.algebraic2coords(cell);
            for (const dir of allDirections) {
                for (const [cx, cy] of graph.ray(x, y, dir)) {
                    const target = graph.coords2algebraic(cx, cy);
                    los.set(target, (los.get(target) ?? 0) + 1);
                    if (board.has(target)) {
                        break;
                    }
                }
            }
        }
        return los;
    }

    private liveVisibleOnBoard(board: Map<string, [playerid, number]>, player: playerid): Set<string> {
        const live = new Set(this.computeLosForPlayer(player, board).keys());
        for (const [cell, [owner]] of board) {
            if (owner === player) {
                live.add(cell);
            }
        }
        return live;
    }

    private liveVisible(player: playerid): Set<string> {
        return this.liveVisibleOnBoard(this.board, player);
    }

    /**
     * Stripped seat state omits `fogMemory` on the stack entry; `board` is already the viewer projection.
     * Render only classifies live vs stale from that board (no memory replay).
     */
    private fogViewUsesBoardOnly(): boolean {
        if (!this.fogEnabled() || this.gameover || this.stack.length === 0) {
            return false;
        }
        return this.stack[this.stack.length - 1].fogMemory === undefined;
    }

    private refreshFogMemory(): void {
        if (!this.fogEnabled()) {
            return;
        }
        for (const p of [1 as playerid, 2 as playerid]) {
            const memory = this.fogMemory[p - 1];
            for (const cell of this.liveVisible(p)) {
                if (this.board.has(cell)) {
                    const [owner, size] = this.board.get(cell)!;
                    memory.set(cell, [owner, size]);
                } else {
                    memory.set(cell, null);
                }
            }
        }
        this.seedOpeningPlacementMemory();
    }

    private cellsFromOpeningWire(wire: string): Set<string> {
        const cells = new Set<string>();
        const norm = wire.toLowerCase().replace(/\s+/g, "");
        if (norm === "pass") {
            return cells;
        }
        for (const part of norm.split(",")) {
            const cell = part.replace(/[+x]$/i, "");
            if (cell.length > 0) {
                cells.add(cell);
            }
        }
        return cells;
    }

    /** After the opening ply, both seats remember both setup stones (stale when off line of sight). */
    private seedOpeningPlacementMemory(): void {
        const cells = new Set<string>(this.openingPlacementCells());
        if (this.stack.length === 1 && this.lastmove !== undefined) {
            for (const cell of this.cellsFromOpeningWire(this.lastmove)) {
                cells.add(cell);
            }
        }
        if (cells.size === 0) {
            return;
        }
        for (const cell of cells) {
            if (!this.board.has(cell)) {
                continue;
            }
            const snap: FogCellSnapshot = this.board.get(cell)!;
            for (const p of [0, 1] as const) {
                this.fogMemory[p].set(cell, snap);
            }
        }
    }

    private projectedBoardForExport(
        board: Map<string, [playerid, number]>,
        fogMemory: FogMemoryPair | undefined,
        viewer?: number,
    ): Map<string, [playerid, number]> {
        const out = new Map<string, [playerid, number]>();
        if (this.boardIsPrePlacementOpening(board)) {
            const centre = this.standardOpeningCentreCell(board)!;
            out.set(centre, board.get(centre)!);
            return out;
        }
        const live1 = this.liveVisibleOnBoard(board, 1);
        const live2 = this.liveVisibleOnBoard(board, 2);
        if (viewer === undefined) {
            for (const cell of live1) {
                if (live2.has(cell) && board.has(cell)) {
                    out.set(cell, board.get(cell)!);
                }
            }
            return out;
        }
        const seat = viewer as playerid;
        const live = seat === 1 ? live1 : live2;
        const memory = fogMemory?.[seat - 1];
        const cells = new Set<string>([...live, ...(memory !== undefined ? memory.keys() : [])]);
        for (const cell of cells) {
            if (live.has(cell)) {
                if (board.has(cell)) {
                    out.set(cell, board.get(cell)!);
                }
            } else if (memory !== undefined && memory.has(cell)) {
                const snap = memory.get(cell)!;
                if (snap !== null) {
                    out.set(cell, snap);
                }
            }
        }
        return out;
    }

    /** Cells from the committed opening ply (`stack[1]`, wire or place results). */
    private openingPlacementCells(): Set<string> {
        if (this.stack.length < 2) {
            return new Set<string>();
        }
        const state = this.stack[1];
        if (state === undefined) {
            return new Set<string>();
        }
        return this.cellsFromOpeningWire(this.openingWireForStackIndex(1));
    }

    private isOpeningSetupResults(results: APMoveResult[]): boolean {
        const places = results.filter((r) => r.type === "place");
        if (this.variants.includes("free-neutral")) {
            return places.length >= 1;
        }
        return places.length >= 1;
    }

    private openingWireLooksComplete(wire: string): boolean {
        const parts = wire.split(",").filter((p) => p.length > 0);
        if (this.variants.includes("free-neutral")) {
            return parts.length >= 3;
        }
        return parts.length >= 2;
    }

    /** Canonical setup wire: `p1,p2` or free-neutral `n,p1,p2` from place results. */
    private openingSetupWireFromResults(results: APMoveResult[]): string | undefined {
        const places = results.filter(
            (r): r is APMoveResult & { type: "place"; where: string; who?: number } =>
                r.type === "place" && r.where !== undefined,
        );
        if (places.length === 0) {
            return undefined;
        }
        const withWho = places.every((p) => p.who !== undefined);
        if (withWho) {
            const order: playerid[] = this.variants.includes("free-neutral") ? [3, 1, 2] : [1, 2];
            const cells: string[] = [];
            for (const who of order) {
                const hit = places.find((p) => p.who === who);
                if (hit !== undefined) {
                    cells.push(hit.where);
                }
            }
            return cells.length > 0 ? cells.join(",") : undefined;
        }
        if (!this.variants.includes("free-neutral") && places.length >= 2) {
            return places.map((p) => p.where).join(",");
        }
        if (this.variants.includes("free-neutral") && places.length >= 3) {
            return places.map((p) => p.where).join(",");
        }
        return undefined;
    }

    private openingWireFromBoardDelta(
        prevBoard: Map<string, [playerid, number]>,
        nextBoard: Map<string, [playerid, number]>,
    ): string | undefined {
        const byWho = new Map<playerid, string>();
        for (const [cell, snap] of nextBoard) {
            const prev = prevBoard.get(cell);
            if (prev !== undefined && prev[0] === snap[0] && prev[1] === snap[1]) {
                continue;
            }
            const who = snap[0];
            if (who === 1 || who === 2) {
                byWho.set(who, cell);
            } else if (who === 3 && this.variants.includes("free-neutral")) {
                byWho.set(3, cell);
            }
        }
        const order: playerid[] = this.variants.includes("free-neutral") ? [3, 1, 2] : [1, 2];
        const cells: string[] = [];
        for (const who of order) {
            const hit = byWho.get(who);
            if (hit !== undefined) {
                cells.push(hit);
            }
        }
        if (cells.length === 0) {
            return undefined;
        }
        return cells.join(",");
    }

    private openingWireForStackIndex(stackIndex: number): string {
        const state = this.stack[stackIndex];
        if (state === undefined) {
            return "";
        }
        return this.openingWireForStackEntry(stackIndex, state);
    }

    private openingWireForStackEntry(stackIndex: number, state: IMoveState): string {
        const results = state._results ?? [];
        if (this.isOpeningSetupResults(results)) {
            const fromResults = this.openingSetupWireFromResults(results);
            if (fromResults !== undefined && this.openingWireLooksComplete(fromResults)) {
                return fromResults;
            }
        }
        const prev = this.stack[stackIndex - 1];
        if (prev !== undefined) {
            const fromBoard = this.openingWireFromBoardDelta(prev.board, state.board);
            if (fromBoard !== undefined && this.openingWireLooksComplete(fromBoard)) {
                return fromBoard;
            }
            if (fromBoard !== undefined) {
                return fromBoard;
            }
        }
        if (this.isOpeningSetupResults(results)) {
            const fromResults = this.openingSetupWireFromResults(results);
            if (fromResults !== undefined) {
                return fromResults;
            }
        }
        return state.lastmove as string;
    }

    /** Fix legacy games whose `stack[1].lastmove` only recorded P1's cell. */
    private repairHistoricalOpeningLastmoves(): void {
        if (this.stack.length < 2) {
            return;
        }
        const state = this.stack[1];
        const wire = this.openingWireForStackEntry(1, state);
        if (wire.length > 0 && state.lastmove !== wire) {
            state.lastmove = wire;
        }
    }

    /** Seat who committed the ply recorded at `stackIndex` (from prior frame `currplayer`). */
    private moverAtStackIndex(stackIndex: number): playerid | undefined {
        if (stackIndex < 1) {
            return undefined;
        }
        return this.stack[stackIndex - 1].currplayer;
    }

    /** P1 dual-placement opening (or free-neutral setup) — visible in the move tree for all viewers. */
    private isPublicOpeningStackIndex(stackIndex: number): boolean {
        return stackIndex === 1;
    }

    private redactFogLastmove(stackIndex: number, lastmove: string, viewer?: number): string {
        if (this.isPublicOpeningStackIndex(stackIndex)) {
            return lastmove;
        }
        if (lastmove.toLowerCase().replace(/\s+/g, "") === "pass") {
            return lastmove;
        }
        const mover = this.moverAtStackIndex(stackIndex);
        if (viewer === mover) {
            return lastmove;
        }
        return TumbleweedGame.REDACTED_FOG_LASTMOVE;
    }

    private stackEntryForExport(entry: IMoveState, strip: boolean, player?: number, stackIndex?: number): IMoveState {
        const exported: IMoveState = {
            ...entry,
            board: new Map(entry.board),
            scores: [...entry.scores],
            _results: [...entry._results],
        };
        if (!this.fogEnabled() || !strip || this.gameover) {
            if (entry.fogMemory !== undefined) {
                exported.fogMemory = TumbleweedGame.cloneFogPair(entry.fogMemory);
            }
            return exported;
        }
        if (stackIndex !== undefined && this.isPublicOpeningStackIndex(stackIndex)) {
            exported.lastmove = this.openingWireForStackEntry(stackIndex, entry);
            delete exported.fogMemory;
            return exported;
        }
        exported.board = this.projectedBoardForExport(entry.board, entry.fogMemory, player);
        delete exported.fogMemory;
        if (stackIndex !== undefined && entry.lastmove !== undefined) {
            const redacted = this.redactFogLastmove(stackIndex, entry.lastmove, player);
            exported.lastmove = redacted;
            if (redacted !== entry.lastmove) {
                exported._results = exported._results.filter(r => r.type === "pass");
            }
        }
        return exported;
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            if (this.stack.length === 1) {
                if (this.variants.includes("free-neutral")) {
                    result.message = i18next.t("apgames:validation.tumbleweed.INITIAL_INSTRUCTIONS_SETUP_FREENEUTRAL");
                } else {
                    result.message = i18next.t("apgames:validation.tumbleweed.INITIAL_INSTRUCTIONS_SETUP");
                }
            } else if (this.stack.length === 2) {
                result.message = i18next.t("apgames:validation.tumbleweed.INITIAL_INSTRUCTIONS_PASS");
            } else {
                result.message = i18next.t("apgames:validation.tumbleweed.INITIAL_INSTRUCTIONS");
            }
            result.canrender = true;
            return result;
        }
        if (m === "No movelist in opening") {
            result.valid = false;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.tumbleweed.NO_MOVELIST");
            return result;
        }
        if (m === "pass") {
            if (this.stack.length === 3) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.tumbleweed.PASS_3RD");
                return result;
            }
            if (this.stack.length === 1) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.tumbleweed.PASS_1ST");
                return result;
            }
            result.valid = true;
            result.complete = 1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
        if (this.stack.length === 2 && this.currplayer === 2) {
            if (m !== "pass") {
                result.valid = false;
                result.message = i18next.t("apgames:validation.tumbleweed.PASS_2ND");
                return result;
            }
        }

        const suffix: string | undefined = this.stack[0]._version !== "20231229" && this.stack.length > 1 && (m[m.length - 1] === "+" || m[m.length - 1] === "x") ? m[m.length - 1] : undefined;
        const withoutSuffix = suffix !== undefined ? m.slice(0, m.length - 1) : m;
        const moves = withoutSuffix.split(",");
        // valid cell
        let currentMove;
        try {
            for (const move of moves) {
                currentMove = move;
                this.getGraph().algebraic2coords(move);
            }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: currentMove});
            return result;
        }
        // Special case where first player places two stones.
        if (this.stack.length === 1) {
            // No duplicate cells.
            const seen: Set<string> = new Set();
            const duplicates: Set<string> = new Set();
            for (const move of moves) {
                if (seen.has(move)) {
                    duplicates.add(move);
                }
                seen.add(move);
            }
            if (duplicates.size > 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.tumbleweed.DUPLICATE", {where: [...duplicates].join(", ")});
                return result;
            }
            for (const cell of moves) {
                if (this.board.has(cell)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: cell});
                    return result;
                }
            }
            if (this.variants.includes("free-neutral")) {
                if (moves.length === 1) {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.tumbleweed.FREENEUTRAL1");
                    return result;
                }
                if (moves.length === 2) {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.tumbleweed.FREENEUTRAL2");
                    return result;
                }
                if (moves.length > 3) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.tumbleweed.TOO_MANY_OPENING_FREENEUTRAL");
                    return result;
                }
            } else {
                if (moves.length === 1) {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.tumbleweed.ONE_MORE");
                    return result;
                }
                if (moves.length > 2) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.tumbleweed.TOO_MANY_OPENING_FREENEUTRAL");
                    return result;
                }
            }
        } else {
            if (moves.length > 1) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.tumbleweed.TOO_MANY");
                return result;
            }
            if (this.variants.includes("capture-delay")) {
                const lm = this.lastmove!
                const suffixLastMove: string | undefined = lm[lm.length - 1] === "+" || lm[lm.length - 1] === "x" ? lm[lm.length - 1] : undefined;
                const withoutSuffixLastMave = suffixLastMove !== undefined ? lm.slice(0, lm.length - 1) : lm;
                if (withoutSuffix === withoutSuffixLastMave) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.tumbleweed.NO_REPLACE", {where: withoutSuffix});
                    return result;
                }
            }
            const losCount = this.getLosCount(withoutSuffix, this.currplayer);
            if (losCount === 0 || this.board.has(withoutSuffix) && this.board.get(withoutSuffix)![1] >= losCount) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.tumbleweed.INSUFFICIENT_LOS", {cell: withoutSuffix});
                return result;
            }
            if (this.board.has(withoutSuffix)) {
                if (this.stack[0]._version !== "20231229") {
                    // Games started after 20231229 have "x" and "+" in the notation.
                    if (this.board.get(withoutSuffix)![0] === this.currplayer) {
                        if (suffix !== "+") {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.tumbleweed.REINFORCE_NOTATION", {move: withoutSuffix + "+"});
                            return result;
                        }
                    } else {
                        if (suffix !== "x") {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.tumbleweed.CAPTURE_NOTATION", {move: withoutSuffix + "x"});
                            return result;
                        }
                    }
                }
            }
        }

        // we're good
        result.valid = true;
        result.complete = 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");

        return result;
    }

    public move(m: string, { partial = false, trusted = false } = {}): TumbleweedGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        let result;
        if (m === "No movelist in opening") {
            result = {valid: false, message: i18next.t("apgames:validation._inarow.NO_MOVELIST")};
            throw new UserFacingError("VALIDATION_GENERAL", result.message);
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (! trusted) {
            result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (!partial && !this.moves().includes(m) && !(this.stack.length === 1 && this.variants.includes("free-neutral"))) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }
        if (m === "") { return this; }
        if (this.stack.length === 1) {
            const moves = m.split(",");
            if (this.variants.includes("free-neutral")) {
                this.board.set(moves[0], [3, 2]);
                this.results.push({type: "place", who: 3, where: moves[0], count: 2});
                if (moves.length > 1) {
                    this.board.set(moves[1], [1, 1]);
                    this.results.push({type: "place", who: 1, where: moves[1], count: 1});
                }
                if (moves.length > 2){
                    this.board.set(moves[2], [2, 1]);
                    this.results.push({type: "place", who: 2, where: moves[2], count: 1});
                }
            } else {
                this.board.set(moves[0], [1, 1]);
                this.results.push({type: "place", who: 1, where: moves[0], count: 1});
                if (moves.length > 1) {
                    this.board.set(moves[1], [2, 1]);
                    this.results.push({type: "place", who: 2, where: moves[1], count: 1});
                }
            }
        } else {
            this.results = [];
            if (m === "pass") {
                this.results.push({type: "pass"});
            } else {
                const suffix: string | undefined = this.stack.length > 1 && (m[m.length - 1] === "+" || m[m.length - 1] === "x") ? m[m.length - 1] : undefined;
                const withoutSuffix = suffix !== undefined ? m.slice(0, m.length - 1) : m;
                const losCount = this.getLosCount(withoutSuffix, this.currplayer);
                this.results.push({type: "place", where: withoutSuffix, count: losCount});
                if (this.board.has(withoutSuffix)) {
                    const captureType = suffix === "+" ? "reinforce" : suffix === "x" ? "capture" : undefined;
                    const [player, size] = this.board.get(withoutSuffix)!;
                    this.results.push({type: "capture", where: withoutSuffix, count: size, whose: player, how: captureType});
                }
                this.board.set(withoutSuffix, [this.currplayer, losCount]);
            }
        }
        if (this.stack.length === 1) {
            if (!partial && this.isOpeningSetupResults(this.results)) {
                const wire = this.openingSetupWireFromResults(this.results);
                if (wire !== undefined && this.openingWireLooksComplete(wire)) {
                    this.lastmove = wire;
                } else {
                    this.lastmove = m;
                }
            } else {
                this.lastmove = m;
            }
        } else {
            this.lastmove = m;
        }
        if (partial) {
            return this;
        }

        let newplayer = (this.currplayer as number) + 1;
        if (newplayer > this.numplayers) {
            newplayer = 1;
        }
        this.currplayer = newplayer as playerid;

        this.updateScores();
        this.refreshFogMemory();
        this.checkEOG();
        this.saveState();
        return this;
    }

    private cellOwner(cell: string): playerid | undefined {
        // A cell is owned by a player if they have a stack on it
        // or if they have the highest LOS to it.
        if (this.board.has(cell)) {
            const [player, ] = this.board.get(cell)!;
            if (player === 3) { return undefined; }
            return player;
        }
        const player1Los = this.getLosCount(cell, 1);
        const player2Los = this.getLosCount(cell, 2);
        if (player1Los > player2Los) {
            return 1;
        } else if (player2Los > player1Los) {
            return 2;
        }
        return undefined;
    }

    private updateScores(): void {
        // Updates `this.scores` with total influence for each player.
        this.scores = [0, 0];
        for (const cell of this.listCells() as string[]) {
            const owner = this.cellOwner(cell);
            if (owner !== undefined) {
                this.scores[owner - 1]++;
            }
        }
    }

    private pieceCount(player: playerid): number {
        // Get number of piece on board for `player`.
        return [...this.board.values()].filter(v => v[0] === player).length;
    }

    protected checkEOG(): TumbleweedGame {
        // Making it impossible to end the game by passing before four plys have been played (stack length 5, was 3)
        // https://discord.com/channels/526483743180062720/1204190463234412594
        if (this.lastmove === "pass" && this.stack[this.stack.length - 1].lastmove === "pass" && this.stack.length >= 5) {
            this.gameover = true;
            const p1Score = this.getPlayerScore(1);
            const p2Score = this.getPlayerScore(2);
            this.winner = p1Score > p2Score ? [1] : p1Score < p2Score ? [2] : [1, 2];
        }
        // If there are no score changes for both players for `plyCount` plys, the game is over.
        const plyCount = 20;
        if (this.stack.length > plyCount) {
            const lastPlies = this.stack.slice(this.stack.length - plyCount).map(s => s.scores);
            if (lastPlies.every(s => s[0] === lastPlies[0][0]) && lastPlies.every(s => s[1] === lastPlies[0][1])) {
                this.gameover = true;
                const p1Score = this.getPlayerScore(1);
                const p2Score = this.getPlayerScore(2);
                this.winner = p1Score > p2Score ? [1] : p1Score < p2Score ? [2] : [1, 2];
            }
        }
        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public getPlayerScore(player: playerid): number {
        return this.scores[player - 1];
    }

    public sidebarScores(): IScores[] {
        if (this.fogEnabled()) {
            return [];
        }
        const score1 = this.getPlayerScore(1 as playerid);
        const pieces1 = this.pieceCount(1 as playerid);
        const influence1 = score1 - pieces1;
        const score2 = this.getPlayerScore(2 as playerid);
        const pieces2 = this.pieceCount(2 as playerid);
        const influence2 = score2 - pieces2;
        return [
            { name: this.neutralAreaLabel("apgames:status.tumbleweed"), scores: [`${score1} (${pieces1} + ${influence1})`, `${score2} (${pieces2} + ${influence2})`] },
        ]
    }

    public state(opts?: { strip?: boolean; player?: number }): ITumbleweedState {
        const strip = opts?.strip === true && this.fogEnabled() && !this.gameover;
        const stack = strip
            ? this.stack.map((entry, idx) => this.stackEntryForExport(entry, true, opts?.player, idx))
            : this.stack.map((entry, idx) => this.stackEntryForExport(entry, false, undefined, idx));
        return {
            game: TumbleweedGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack,
        };
    }

    public moveState(): IMoveState {
        const state: IMoveState = {
            _version: TumbleweedGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            scores: [...this.scores],
        };
        if (this.fogEnabled()) {
            state.fogMemory = TumbleweedGame.cloneFogPair(this.fogMemory);
        }
        return state;
    }

    private threatenedPiecesOnBoard(board: Map<string, [playerid, number]>): Set<string> {
        const threatenedPieces = new Set<string>();
        for (const cell of this.listCells() as string[]) {
            if (board.has(cell)) {
                const [player, size] = board.get(cell)!;
                const otherPlayer = player === 1 ? 2 : 1;
                const losCount = this.getLosCount(cell, player as playerid, board);
                const otherPlayerLosCount = this.getLosCount(cell, otherPlayer as playerid, board);
                if (otherPlayerLosCount >= losCount && otherPlayerLosCount > size) {
                    threatenedPieces.add(cell);
                }
            }
        }
        return threatenedPieces;
    }

    private livePieceLegendKey(
        player: playerid,
        size: number,
        cell: string,
        threatenedPieces: Set<string>,
        showThreatened: boolean,
        board: Map<string, [playerid, number]>,
    ): string {
        if (player === 1) {
            if (showThreatened && threatenedPieces.has(cell)) {
                return `C${size.toString()}`;
            }
            return `A${size.toString()}`;
        }
        if (player === 2) {
            if (showThreatened && threatenedPieces.has(cell)) {
                return `D${size.toString()}`;
            }
            return `B${size.toString()}`;
        }
        if (showThreatened) {
            const player1Los = this.getLosCount(cell, 1, board);
            const player2Los = this.getLosCount(cell, 2, board);
            if (player1Los > player2Los && player1Los > size) {
                return `F${size.toString()}`;
            }
            if (player2Los > player1Los && player2Los > size) {
                return `G${size.toString()}`;
            }
            if (player1Los === player2Los && player1Los > size) {
                return `H${size.toString()}`;
            }
        }
        return `E${size.toString()}`;
    }

    private dimGlyphStack(glyph: Glyph | [Glyph, ...Glyph[]]): Glyph | [Glyph, ...Glyph[]] {
        if (!Array.isArray(glyph)) {
            return {
                ...glyph,
                opacity: glyph.opacity === undefined ? FOG_STALE_OPACITY : glyph.opacity * FOG_STALE_OPACITY,
            };
        }
        return glyph.map(g => ({
            ...g,
            opacity: g.opacity === undefined ? FOG_STALE_OPACITY : g.opacity * FOG_STALE_OPACITY,
        })) as [Glyph, ...Glyph[]];
    }

    private fogCellView(
        cell: string,
        viewSeat: playerid | undefined,
    ): { kind: "hidden" | "live" | "stale"; stack?: [playerid, number] } {
        if (this.boardIsPrePlacementOpening(this.board)) {
            const centre = this.standardOpeningCentreCell(this.board);
            if (cell === centre && this.board.has(cell)) {
                return { kind: "live", stack: this.board.get(cell)! };
            }
        }
        if (this.stack.length === 1 && this.board.has(cell)) {
            return { kind: "live", stack: this.board.get(cell)! };
        }
        const live1 = this.liveVisible(1);
        const live2 = this.liveVisible(2);
        if (viewSeat === undefined) {
            if (!live1.has(cell) || !live2.has(cell)) {
                return { kind: "hidden" };
            }
            if (this.board.has(cell)) {
                return { kind: "live", stack: this.board.get(cell)! };
            }
            return { kind: "live" };
        }
        const live = viewSeat === 1 ? live1 : live2;
        if (this.fogViewUsesBoardOnly()) {
            if (live.has(cell)) {
                if (this.board.has(cell)) {
                    return { kind: "live", stack: this.board.get(cell)! };
                }
                return { kind: "live" };
            }
            if (this.board.has(cell)) {
                return { kind: "stale", stack: this.board.get(cell)! };
            }
            return { kind: "hidden" };
        }
        const memory = this.fogMemory[viewSeat - 1];
        if (live.has(cell)) {
            if (this.board.has(cell)) {
                return { kind: "live", stack: this.board.get(cell)! };
            }
            return { kind: "live" };
        }
        if (memory.has(cell)) {
            const snap = memory.get(cell)!;
            if (snap === null) {
                return { kind: "stale" };
            }
            return { kind: "stale", stack: snap };
        }
        return { kind: "hidden" };
    }

    protected plyFromStack(stackIndex: number) {
        const ply = super.plyFromStack(stackIndex);
        if (this.isPublicOpeningStackIndex(stackIndex)) {
            return {
                ...ply,
                move: this.openingWireForStackIndex(stackIndex),
            };
        }
        return ply;
    }

    public moveHistory(): string[][] {
        const moves = super.moveHistory();
        if (this.stack.length > 1 && moves.length > 0 && moves[0].length > 0 && this.isPublicOpeningStackIndex(1)) {
            moves[0][0] = this.openingWireForStackIndex(1);
        }
        return moves;
    }

    public moveHistoryWithSequence(): [number, string][][] {
        const moves = super.moveHistoryWithSequence();
        if (this.stack.length > 1 && moves.length > 0 && moves[0].length > 0 && this.isPublicOpeningStackIndex(1)) {
            const [seat, ] = moves[0][0];
            moves[0][0] = [seat, this.openingWireForStackIndex(1)];
        }
        return moves;
    }

    private viewSeatFromPerspective(perspective?: number): playerid | undefined {
        if (perspective === 1 || perspective === 2) {
            return perspective as playerid;
        }
        return undefined;
    }

    private cellVisibleToViewer(cell: string, viewSeat: playerid | undefined): boolean {
        return this.fogCellView(cell, viewSeat).kind !== "hidden";
    }

    public render(opts?: IRenderOpts): APRenderRep {
        const fog = this.fogEnabled() && !this.gameover && opts?.omniscient !== true;
        const viewSeat = fog ? this.viewSeatFromPerspective(opts?.perspective) : undefined;
        const showThreatened = !fog && !this.hasDisplay(opts, "hide-threatened");
        const showInfluence = !fog && !this.hasDisplay(opts, "hide-influence");
        const showUnseenClouds = fog && this.hasDisplay(opts, "fog-unseen-clouds");

        // Build piece string
        const legendNames: Set<string> = new Set();
        // A - player1 normal
        // B - player2 normal
        // C - player1 threatened
        // D - player2 threatened
        // E - neutral
        // F - neutral threatened by player1
        // G - neutral threatened by player2
        // H - neutral threatened by both
        let pstr = "";
        const threatenedPieces: Set<string> = showThreatened ? this.threatenedPiecesOnBoard(this.board) : new Set();
        for (const row of this.listCells(true)) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            let pieces: string[] = [];
            for (const cell of row) {
                if (fog) {
                    const view = this.fogCellView(cell, viewSeat);
                    if (view.kind === "hidden") {
                        if (showUnseenClouds) {
                            legendNames.add(TumbleweedGame.FOG_UNSEEN_LEGEND);
                            pieces.push(TumbleweedGame.FOG_UNSEEN_LEGEND);
                        } else {
                            pieces.push("-");
                        }
                        continue;
                    }
                    if (view.stack === undefined) {
                        pieces.push("-");
                        continue;
                    }
                    const [player, size] = view.stack;
                    const liveKey = this.livePieceLegendKey(player, size, cell, threatenedPieces, false, this.board);
                    const key = view.kind === "stale" ? TumbleweedGame.staleLegendKey(liveKey) : liveKey;
                    legendNames.add(key);
                    pieces.push(key);
                    continue;
                }
                if (this.board.has(cell)) {
                    const [player, size] = this.board.get(cell)!;
                    const key = this.livePieceLegendKey(player, size, cell, threatenedPieces, showThreatened, this.board);
                    legendNames.add(key);
                    pieces.push(key);
                } else {
                    pieces.push("-");
                }

            }
            // If all elements are "-", replace with "_"
            if (pieces.every(p => p === "-")) {
                pieces = ["_"];
            }
            pstr += pieces.join(",");
        }

        // build legend based on stack sizes
        const legend: ILegendObj = {};
        if (legendNames.has(TumbleweedGame.FOG_UNSEEN_LEGEND)) {
            legend[TumbleweedGame.FOG_UNSEEN_LEGEND] = {
                name: "cloud",
                colour: "#e8e8e8",
                opacity: 0.65,
                scale: 1.4,
                orientation: "vertical",
            };
        }
        for (const name of legendNames) {
            if (name === TumbleweedGame.FOG_UNSEEN_LEGEND) {
                continue;
            }
            const stale = name.startsWith("x");
            const liveName = stale ? name.slice(1) : name;
            const [piece, ...size] = liveName;
            const player = piece === "A" || piece === "C" ? 1 : piece === "B" || piece === "D" ? 2 : 3;
            const sizeStr = size.join("");
            let glyph: Glyph | [Glyph, ...Glyph[]];
            if (piece === "A" || piece === "B" || piece === "E") {
                glyph = [
                    { name: "piece", colour: player },
                    { text: sizeStr, scale: 0.75 },
                ];
            } else if (piece === "C" || piece === "D") {
                glyph = [
                    { name: "piece-borderless", scale: 1.1, colour: player % 2 + 1 },
                    { name: "piece", colour: player },
                    { text: sizeStr, scale: 0.75 },
                ];
            } else if (piece === "F") {
                glyph = [
                    { name: "piece-borderless", scale: 1.1, colour: 1 },
                    { name: "piece", colour: player },
                    { text: sizeStr, scale: 0.75 },
                ];
            } else if (piece === "G") {
                glyph = [
                    { name: "piece-borderless", scale: 1.1, colour: 2 },
                    { name: "piece", colour: player },
                    { text: sizeStr, scale: 0.75 },
                ];
            } else {
                glyph = [
                    { name: "piece-borderless", scale: 1.1, colour: 1 },
                    { name: "piece-borderless", scale: 1.1, colour: 2 },
                    { name: "piece", colour: player },
                    { text: sizeStr, scale: 0.75 },
                ];
            }
            legend[name] = stale ? this.dimGlyphStack(glyph) : glyph;
        }

        let points1: {row: number, col: number}[] = [];
        let points2: {row: number, col: number}[] = [];
        if (showInfluence) {
            const points = this.influenceMarkers();
            points1 = points.get(1)!;
            points2 = points.get(2)!;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let markers: Array<any> | undefined = []
        if (points1.length > 0) {
            markers.push({ type: "flood", colour: 1, opacity: 0.2, points: points1 as [RowCol, ...RowCol[]] });
        }
        if (points2.length > 0) {
            markers.push({ type: "flood", colour: 2, opacity: 0.2, points: points2 as [RowCol, ...RowCol[]] });
        }
        if (markers.length === 0) {
            markers = undefined;
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "hex-of-hex",
                minWidth: this.boardSize,
                maxWidth: this.boardSize * 2 - 1,
                markers,
            },
            legend,
            pieces: pstr,
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
                    const where = move.where!;
                    if (fog && !this.cellVisibleToViewer(where, viewSeat)) {
                        continue;
                    }
                    const [x, y] = this.getGraph().algebraic2coords(where);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }
        return rep;
    }

    private influenceMarkers(): Map<playerid, {row: number, col: number}[]> {
        // Get cells that are occupied by each player or have equal or greater LOS by each player.
        // Unoccupied cells with equal LOS will be in both groups.
        const markers = new Map<playerid, {row: number, col: number}[]>([
            [1, []],
            [2, []],
        ]);
        for (const cell of this.listCells() as string[]) {
            if (this.board.has(cell)) {
                const [player, ] = this.board.get(cell)!;
                if (player === 3) { continue; }
                const [x, y] = this.getGraph().algebraic2coords(cell);
                const cellCoords = {row: y, col: x};
                markers.get(player)!.push(cellCoords);
            } else {
                const player1Los = this.getLosCount(cell, 1);
                const player2Los = this.getLosCount(cell, 2);
                if (player1Los === 0 && player2Los === 0) { continue; }
                const [x, y] = this.getGraph().algebraic2coords(cell);
                const cellCoords = {row: y, col: x};
                if (player1Los >= player2Los) {
                    markers.get(1)!.push(cellCoords);
                }
                if (player2Los >= player1Los) {
                    markers.get(2)!.push(cellCoords);
                }
            }
        }
        return markers;
    }

    public collectChatLogLine(lines: ChatLogLine[], r: APMoveResult, ctx: ChatLogCollectContext): boolean {
        switch (r.type) {
            case "place": {
                const placeResults = ctx.results.filter((res) => res.type === "place");
                if (this.isOpeningSetupResults(ctx.results)) {
                    const firstPlace = placeResults[0];
                    if (r !== firstPlace) {
                        return true;
                    }
                    const wire = this.openingSetupWireFromResults(ctx.results)!;
                    this.pushSeatChatLine(lines, 1, "apresults:PLACE.tumbleweed", {
                        where: wire,
                        count: (firstPlace as { count?: number }).count!,
                    });
                    return true;
                }
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:PLACE.tumbleweed", {
                    where: r.where!, count: r.count!,
                });
                return true;
            }
            case "capture": {
                const selfCapture = (r as { whose?: number }).whose === ctx.defaultSeat;
                this.pushSeatChatLine(
                    lines,
                    ctx.defaultSeat,
                    selfCapture ? "apresults:CAPTURE.tumbleweed_self" : "apresults:CAPTURE.tumbleweed",
                    { where: r.where!, count: r.count! },
                );
                return true;
            }
            default:
                return super.collectChatLogLine(lines, r, ctx);
        }
    }

    public clone(): TumbleweedGame {
        return new TumbleweedGame(this.serialize());
    }

    public state2aiai(): string[] {
        let width = 8;
        if (this.variants.includes("size-6")) {
            width = 6;
        } else if (this.variants.includes("size-10")) {
            width = 10;
        }
        const moves = this.moveHistory();
        const lst: string[] = [];
        for (let i = 0; i < moves.length; i++) {
            const round = moves[i];
            for (const move of round) {
                // special notation for first turn
                // doesn't matter which special you choose (black or white)
                if ((i === 0) && (move === "pass")) {
                    lst.push("Play White (first)")
                }
                // all other passes
                else if (move === "pass") {
                    lst.push("Pass");
                }
                // regular placements
                else {
                    const withoutSuffix = move[move.length - 1] === "+" || move[move.length - 1] === "x" ? move.slice(0, move.length - 1) : move;
                    const cells: string[] = withoutSuffix.split(",");
                    for (const cell of cells) {
                        lst.push(hexhexAp2Ai(cell, width))
                    }
                }
            }
        }
        return lst;
    }

    public translateAiai(move: string): string {
        let width = 8;
        if (this.variants.includes("size-6")) {
            width = 6;
        } else if (this.variants.includes("size-10")) {
            width = 10;
        }

        if (move === "Play White (first)") {
            return "Swap";
        } else if (move === "Play Black (second)") {
            return "pass";
        } else if (move === "Pass") {
            return "pass";
        } else {
            const cells = move.split("|");
            const translated = cells.map(cell => hexhexAi2Ap(cell, width));
            if (translated.length === 1) {
                if (this.board.has(translated[0])) {
                    if (this.board.get(translated[0])![0] === this.currplayer) {
                        return translated[0] + "+";
                    } else {
                        return translated[0] + "x";
                    }
                }
            }
            return translated.join(",");
        }
    }

    public aiaiMgl(): string {
        let mgl = "tumbleweed";
        if (this.variants.includes("size-6")) {
            mgl = "tumbleweed-6";
        } else if (this.variants.includes("size-10")) {
            mgl = "tumbleweed-10";
        }
        return mgl;
    }

}
