import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult, type ChatLogCollectContext, type ChatLogEntry, type ChatLogLine } from "./_base.js";
import type { APGamesInformation } from "../schemas/gameinfo.js";
import { APRenderRep, BoardBasic, MarkerFence, MarkerShading } from "@abstractplay/renderer/build/schemas/schema";
import type { APMoveResult } from "../schemas/moveresults.js";
import { Direction, oppositeDirections, RectGrid, reviver, UserFacingError } from "../common/index.js";
import i18next from "i18next";
import { SquareOrthGraph } from "../common/graphs/index.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const clonelst = (items: Array<any>): Array<any> => items.map((item: any) => Array.isArray(item) ? clonelst(item) : item);

export type playerid = 1|2;

export interface IAreas {
    open: Set<string>[];
    closed: Set<string>[];
    empty: Set<string>[];
}

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
    pieces: [number, number];
    fences: [string, string][];
};

export interface IFendoState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class FendoGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Fendo",
        uid: "fendo",
        playercounts: [2],
        version: "20211119",
        dateAdded: "2023-05-01",
        // i18next.t("apgames:descriptions.fendo")
        description: "apgames:descriptions.fendo",
        urls: ["https://spielstein.com/games/fendo", "https://boardgamegeek.com/boardgame/159333/fendo"],
        bggid: "159333",
        people: [
            {
                type: "designer",
                name: "Dieter Stein",
                apid: "e7f53920-5be9-406a-9d5c-baa0316ab4f4",
                urls: ["https://spielstein.com/"]
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        variants: [
            { uid: "#board", group: "board"},
            { uid: "size-9", group: "board"},
            { uid: "size-11", group: "board"},
        ],
        categories: ["goal>area", "mechanic>block", "mechanic>move", "mechanic>enclose", "mechanic>place", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["scores", "automove", "perspective"]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public pieces!: [number, number];
    public fences!: [string, string][];
    public graph!: SquareOrthGraph;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    private static readonly BOARD_VARIANT_ALIASES: Record<string, string> = {
        "board-9": "size-9",
        "board-11": "size-11",
    };

    private static normalizeVariants(variants: string[]): string[] {
        return variants.map(v => FendoGame.BOARD_VARIANT_ALIASES[v] ?? v);
    }

    private static boardSizeFromVariants(variants: string[]): number | undefined {
        const normalized = FendoGame.normalizeVariants(variants);
        if (normalized.includes("size-9")) {
            return 9;
        }
        if (normalized.includes("size-11")) {
            return 11;
        }
        if (normalized.includes("#board")) {
            return 7;
        }
        return undefined;
    }

    private static inferBoardSizeFromStack(stack: Array<IMoveState>): number {
        let max = 7;
        const visit = (cell: string) => {
            const match = /^([a-z])(\d+)$/i.exec(cell);
            if (match === null) {
                return;
            }
            const col = match[1].toLowerCase().charCodeAt(0) - 97 + 1;
            const row = parseInt(match[2], 10);
            max = Math.max(max, col, row);
        };
        for (const moveState of stack) {
            for (const cell of moveState.board.keys()) {
                visit(cell);
            }
            for (const fence of moveState.fences) {
                visit(fence[0]);
                visit(fence[1]);
            }
        }
        return max;
    }

    private static resolveBoardSize(variants: string[], stack?: Array<IMoveState>): number {
        const fromVariants = FendoGame.boardSizeFromVariants(variants);
        if (fromVariants !== undefined) {
            return fromVariants;
        }
        if (stack !== undefined && stack.length > 0) {
            return FendoGame.inferBoardSizeFromStack(stack);
        }
        return 7;
    }

    constructor(state?: IFendoState | string, variants?: string[]) {
        super();
        if (variants !== undefined && Array.isArray(variants)) {
            this.variants = FendoGame.normalizeVariants(variants);
        }
        const boardSize = FendoGame.resolveBoardSize(this.variants);
        if (state === undefined) {
            const fresh: IMoveState = {
                _version: FendoGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map([[`a${Math.ceil(boardSize / 2)}`, 1], [`${boardSize === 7 ? "g" : boardSize === 9 ? "i" : "k"}${Math.ceil(boardSize / 2)}`, 2]]),
                pieces: [6, 6],
                fences: []
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IFendoState;
            }
            if (state.game !== FendoGame.gameinfo.uid) {
                throw new Error(`The Fendo engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = FendoGame.normalizeVariants(state.variants);
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): FendoGame {
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
        this.pieces = [...state.pieces];
        this.fences = clonelst(state.fences) as [string, string][];
        this.results = [...state._results];
        this.buildGraph();
        return this;
    }

    public get boardSize(): number {
        return FendoGame.resolveBoardSize(this.variants, this.stack);
    }

    private buildGraph(): FendoGame {
        this.graph = new SquareOrthGraph(this.boardSize, this.boardSize);
        for (const fence of this.fences) {
            this.graph.graph.dropEdge(...fence);
        }
        return this;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];
        const areas = this.getAreas();
        if (areas.open.length > 1) {
            throw new Error("There should never be more than one open area.");
        }

        const validTargets = this.genTargets(player, areas.open[0]);
        const uniqueTargets: Set<string> = new Set([...validTargets.values()].flat(1));

        // You can enter a piece into the open area within one move of a friendly piece
        if (this.pieces[player - 1] > 0) {
            moves.push(...[...uniqueTargets].filter(cell => ! this.board.has(cell)));
        }

        // You can move a piece then place a fence
        const open = areas.open[0];
        for (const [from, targets] of validTargets.entries()) {
            for (const target of targets) {
                const boardAfterMove = new Map(this.board);
                if (from !== target) {
                    boardAfterMove.delete(from);
                    boardAfterMove.set(target, player);
                }
                const neighbours = this.graph.neighbours(target);
                for (const n of neighbours) {
                    if (this.isFenceValidAfterMove(boardAfterMove, open, target, n)) {
                        const bearing = this.graph.bearing(target, n)!;
                        if (from !== target) {
                            moves.push(`${from}-${target}${bearing.toString()}`)
                        } else {
                            moves.push(`${from}${bearing.toString()}`)
                        }
                    }
                }
            }
        }

        if (moves.length === 0) {
            moves.push("pass");
        }

        return moves;
    }

    private genTargets(player: playerid, open: Set<string>): Map<string, string[]> {
        // Get a list of valid moves for all your pieces in the open area
        // We will use this list for both move types
        const mypieces = [...this.board.entries()].filter(e => (e[1] === player) && (open.has(e[0]))).map(e => e[0]);
        const validTargets: Map<string, string[]> = new Map();
        const dirs = ["N", "E", "S", "W"] as const;
        for (const piece of mypieces) {
            const reachable = new Set<string>([piece]);
            for (const dir1 of dirs) {
                const ray1 = this.walkRay(piece, dir1, open, this.board);
                for (const cell of ray1) {
                    reachable.add(cell);
                }
                for (const seed of ray1) {
                    for (const dir2 of this.perpendicularDirs(dir1)) {
                        const ray2 = this.walkRay(seed, dir2, open, this.board);
                        for (const cell of ray2) {
                            reachable.add(cell);
                        }
                    }
                }
            }
            validTargets.set(piece, [...reachable]);
        }

        return validTargets;
    }

    private perpendicularDirs(dir: "N" | "E" | "S" | "W"): ("N" | "E" | "S" | "W")[] {
        if (dir === "N" || dir === "S") {
            return ["E", "W"];
        }
        return ["N", "S"];
    }

    private walkRay(from: string, dir: "N" | "E" | "S" | "W", open: Set<string>, board: Map<string, playerid>): string[] {
        const cells: string[] = [];
        let [cx, cy] = this.graph.algebraic2coords(from);
        while (true) {
            const next = this.graph.move(cx, cy, dir);
            if (next === undefined) {
                break;
            }
            const fromCell = this.graph.coords2algebraic(cx, cy);
            const cell = this.graph.coords2algebraic(...next);
            if (! open.has(cell)) {
                break;
            }
            if (! this.graph.graph.hasEdge(fromCell, cell)) {
                break;
            }
            if (board.has(cell)) {
                break;
            }
            cells.push(cell);
            [cx, cy] = next;
        }
        return cells;
    }

    private isBlockedEdge(a: string, b: string, blocked: [string, string]): boolean {
        return (a === blocked[0] && b === blocked[1]) || (a === blocked[1] && b === blocked[0]);
    }

    private collectOpenComponent(
        open: Set<string>,
        start: string,
        blocked: [string, string],
    ): Set<string> {
        const seen = new Set<string>();
        const stack = [start];
        while (stack.length > 0) {
            const cell = stack.pop()!;
            if (seen.has(cell) || ! open.has(cell)) {
                continue;
            }
            seen.add(cell);
            for (const nb of this.graph.neighbours(cell)) {
                if (this.isBlockedEdge(cell, nb, blocked)) {
                    continue;
                }
                if (! seen.has(nb)) {
                    stack.push(nb);
                }
            }
        }
        return seen;
    }

    private isFenceValidAfterMove(
        board: Map<string, playerid>,
        open: Set<string>,
        target: string,
        n: string,
    ): boolean {
        const blocked: [string, string] = [target, n];
        const sideA = this.collectOpenComponent(open, target, blocked);
        if (sideA.has(n)) {
            return true;
        }
        let piecesA = 0;
        let piecesB = 0;
        for (const cell of open) {
            if (! board.has(cell)) {
                continue;
            }
            if (sideA.has(cell)) {
                piecesA++;
            } else {
                piecesB++;
            }
        }
        if (piecesA === 0 || piecesB === 0) {
            return false;
        }
        if (piecesA >= 2 && piecesB >= 2) {
            return false;
        }
        return true;
    }

    /**
     * Just tries the two possible T-shape moves.
     * This is necessary because the shortest path in a wide-open map may have more turns than strictly necessary.
     * And the `allSimplePaths` method takes *far* too long with a large area early in the game.
     *
     * @private
     * @param {string} from
     * @param {string} to
     * @returns {(string[] | null)}
     * @memberof FendoGame
     */
    public naivePath(from: string, to: string): string[] | null {
        const grid = new RectGrid(this.boardSize, this.boardSize);
        const dirs: Direction[] = [];
        const [xFrom, yFrom] = this.graph.algebraic2coords(from);
        const [xTo, yTo] = this.graph.algebraic2coords(to);
        if (xTo > xFrom) {
            dirs.push("E");
        } else if (xTo < xFrom) {
            dirs.push("W");
        }
        if (yTo > yFrom) {
            dirs.push("S");
        } else if (yTo < yFrom) {
            dirs.push("N");
        }
        // If you passed the same cell as from and to, return null
        if (dirs.length === 0) {
            return null;
        }
        // If we're on a straight line, just cast a ray and test the edges
        if (dirs.length === 1) {
            const ray = grid.ray(xFrom, yFrom, dirs[0]).map(pt => this.graph.coords2algebraic(...pt));
            const toidx = ray.findIndex(cell => cell === to);
            if (toidx < 0) {
                throw new Error("Could not find the target cell when ray casting.");
            }
            const path = [from, ...ray.slice(0, toidx + 1)];
            for (let i = 0; i < path.length - 1; i++) {
                if (! this.graph.graph.hasEdge(path[i], path[i+1]) || (this.board.has(path[i+1]))) {
                    return null;
                }
            }
            return path;
        }
        // Otherwise, test both combinations of dirs to build a path and test it
        const reversed = [...dirs].reverse();
        for (const pair of [dirs, reversed]) {
            // Cast a ray from `from` in the first direction
            const ray1 = grid.ray(xFrom, yFrom, pair[0]).map(pt => this.graph.coords2algebraic(...pt));
            // Cast a ray from to in the opposite of the second direction
            const opposite = oppositeDirections.get(pair[1])!;
            const ray2 = grid.ray(xTo, yTo, opposite).map(pt => this.graph.coords2algebraic(...pt));
            // Find the intersection point
            const intersection = ray1.filter(cell => ray2.includes(cell));
            if (intersection.length !== 1) {
                throw new Error("Rays did not intersect.");
            }
            // Merge the paths
            const idx1 = ray1.findIndex(cell => cell === intersection[0]);
            const idx2 = ray2.findIndex(cell => cell === intersection[0]);
            const path = [from, ...ray1.slice(0, idx1), intersection[0], ...ray2.slice(0, idx2).reverse(), to];
            // Test
            let valid = true;
            for (let i = 0; i < path.length - 1; i++) {
                if ( (! this.graph.graph.hasEdge(path[i], path[i+1])) || (this.board.has(path[i+1])) ) {
                    valid = false;
                    break;
                }
            }
            if (valid) {
                return path;
            }
        }

        return null;
    }

    public getAreas(): IAreas {
        const areas: IAreas = {
            open: [],
            closed: [],
            empty: []
        };
        const seen: Set<string> = new Set();
        let remainingCells = this.graph.listCells(false) as string[];
        while (remainingCells.length > 0) {
            const start = remainingCells.pop()!;
            const area: Set<string> = new Set();
            const todo = [start];
            while (todo.length > 0) {
                const next = todo.pop()!;
                if (seen.has(next)) {
                    continue;
                }
                seen.add(next);
                area.add(next);
                todo.push(...this.graph.neighbours(next));
            }
            // At this point, we have an area based on `start`
            // Classify it
            const pieces = [...this.board.entries()].filter(e => area.has(e[0]));
            if (pieces.length === 0) {
                areas.empty.push(area);
            } else if (pieces.length === 1) {
                areas.closed.push(area);
            } else {
                areas.open.push(area);
            }
            // Remove all these cells from consideration in future areas
            remainingCells = remainingCells.filter(cell => ! area.has(cell));
        }
        return areas;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.graph.coords2algebraic(col, row);
            const openArea = this.getAreas().open[0];
            let newmove = "";
            if (move === "") {
                // clicking on an empty space must be a placement
                if (! this.board.has(cell)) {
                    // must be in the open area
                    if (openArea.has(cell)) {
                        newmove = cell;
                    } else {
                        // otherwise do nothing
                        return {move: "", message: ""} as IClickResult;
                    }
                // otherwise it must be a move
                } else {
                    if ( (this.board.get(cell)! === this.currplayer) && (openArea.has(cell)) ) {
                        newmove = cell;
                    } else {
                        // otherwise do nothing
                        return {move: "", message: ""} as IClickResult;
                    }
                }
            } else {
                // Already moved; need to place fence
                if (move.includes("-")) {
                    // assume bearing of cell they clicked on relative to target
                    const [from, target] = move.split("-");
                    let to = target;
                    if (/[NESW]$/.test(to)) {
                        to = to.slice(0, to.length - 1);
                    }
                    const bearing = this.graph.bearing(to, cell);
                    if (bearing !== undefined) {
                        // bearing = bearing.toString().slice(0, 1) as Directions;
                        if (from === to) {
                            newmove = `${to}${bearing}`;
                        } else {
                            newmove = `${from}-${to}${bearing}`;
                        }
                    } else {
                        newmove = `${from}-${to}`;
                    }
                // otherwise looking for destination
                } else {
                    // Only checking that destination is empty and in open area
                    if ( ( (! this.board.has(cell)) && (openArea.has(cell)) ) || (move === cell) ) {
                        newmove = `${move}-${cell}`;
                    } else {
                        newmove = move;
                    }
                }
            }
            const result = this.validateMove(newmove) as IClickResult;
            if (! result.valid) {
                result.move = "";
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

    private parseStationaryFence(m: string): { cell: string; dir: Direction } | null {
        if (m.includes("-") || ! /[NESW]$/.test(m)) {
            return null;
        }
        const dir = m[m.length - 1] as Direction;
        if (! ["N", "E", "S", "W"].includes(dir)) {
            return null;
        }
        const cell = m.substring(0, m.length - 1);
        if (! /^[a-z]+\d+$/i.test(cell)) {
            return null;
        }
        return { cell, dir };
    }

    private parseMoveWithOptionalFence(m: string): { from: string; to?: string; dir?: Direction } {
        const dash = m.indexOf("-");
        if (dash < 0) {
            return { from: m };
        }
        const from = m.substring(0, dash);
        const rest = m.substring(dash + 1);
        if (/[NESW]$/.test(rest)) {
            return {
                from,
                to: rest.substring(0, rest.length - 1),
                dir: rest[rest.length - 1] as Direction,
            };
        }
        return { from, to: rest };
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.fendo.INITIAL_INSTRUCTIONS");
            return result;
        }

        if (m === "pass") {
            if (this.moves().includes("pass")) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.fendo.INVALID_PASS");
                return result;
            }
        }

        const stationary = this.parseStationaryFence(m);
        if (stationary !== null) {
            const { cell, dir } = stationary;

            const allcells = this.graph.listCells(false) as string[];

            // cell is valid
            if (! allcells.includes(cell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                return result;
            }
            // `dir` is valid value
            if (! ["N", "E", "S", "W"].includes(dir)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.fendo.INVALID_DIRECTION", {dir});
                return result;
            }
            // fence is between two cells
            const grid = new RectGrid(this.boardSize, this.boardSize);
            const [x, y] = this.graph.algebraic2coords(cell);
            const ray = grid.ray(x, y, dir).map(pt => this.graph.coords2algebraic(...pt));
            if (ray.length === 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.fendo.NO_EDGE_FENCES");
                return result;
            }
            // fence doesn't already exist
            const next = ray[0];
            const fence = this.fences.find(pair => pair.includes(cell) && pair.includes(next));
            if (fence !== undefined) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.fendo.DUPLICATE_FENCE");
                return result;
            }
            // placing the fence doesn't violate any rules
            const areas = this.getAreas();
            const open = areas.open[0];
            if (! this.isFenceValidAfterMove(this.board, open, cell, next)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.fendo.INVALID_FENCE");
                return result;
            }

            // valid move
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        const { from, to, dir } = this.parseMoveWithOptionalFence(m);
        const allcells = this.graph.listCells(false) as string[];

        if (from !== undefined) {
            const areas = this.getAreas();
            const open = areas.open[0];
            const allTargets = this.genTargets(this.currplayer, open);
            const uniqueTargets = new Set([...allTargets.values()].flat(1));
            // cell is valid
            if (! allcells.includes(from)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: from});
                return result;
            }

            // if cell is empty, assume placement
            if (! this.board.has(from)) {
                // if `to` is defined, then we have a problem
                if (to !== undefined) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: from});
                    return result;
                }
                // in the open area
                if (! open.has(from)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.fendo.PLACE_IN_OPEN");
                    return result;
                }
                // placement in range
                if (! uniqueTargets.has(from)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.fendo.PLACE_IN_RANGE");
                    return result;
                }
                // The player has pieces to place
                if (this.pieces[this.currplayer - 1] === 0) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.NOPIECES");
                    return result;
                }

                // we're good
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;

            // otherwise, it has to be movement
            } else {
                // in the open area
                if (! open.has(from)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.fendo.ONLY_MOVE_OPEN");
                    return result;
                }
                if (to !== undefined) {
                    // target is valid
                    const targets = allTargets.get(from);
                    if ( (from !== to) && ( (targets === undefined) || (! targets.includes(to)) ) ) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.fendo.INVALID_DESTINATION", {from, to});
                        return result;
                    }
                    if (dir !== undefined) {
                        // `dir` is valid value
                        if (! ["N", "E", "S", "W"].includes(dir)) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.fendo.INVALID_DIRECTION", {dir});
                            return result;
                        }
                        // fence is between two cells
                        const grid = new RectGrid(this.boardSize, this.boardSize);
                        const [x, y] = this.graph.algebraic2coords(to);
                        const ray = grid.ray(x, y, dir).map(pt => this.graph.coords2algebraic(...pt));
                        if (ray.length === 0) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.fendo.NO_EDGE_FENCES");
                            return result;
                        }
                        // fence doesn't already exist
                        const next = ray[0];
                        const fence = this.fences.find(pair => pair.includes(to) && pair.includes(next));
                        if (fence !== undefined) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.fendo.DUPLICATE_FENCE");
                            return result;
                        }
                        // placing the fence doesn't violate any rules
                        const boardAfterMove = new Map(this.board);
                        boardAfterMove.delete(from);
                        boardAfterMove.set(to, this.currplayer);
                        if (! this.isFenceValidAfterMove(boardAfterMove, open, to, next)) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.fendo.INVALID_FENCE");
                            return result;
                        }

                        // valid move
                        result.valid = true;
                        result.complete = 1;
                        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                        return result;
                    } else {
                        // good enough for a partial success
                        result.valid = true;
                        result.complete = -1;
                        result.canrender = true;
                        result.message = i18next.t("apgames:validation.fendo.PARTIAL_FENCE");
                        return result;
                    }
                } else {
                    // good enough for a partial success
                    result.valid = true;
                    result.complete = -1;
                    result.message = i18next.t("apgames:validation.fendo.PARTIAL_MOVE");
                    return result;
                }
            }
        }

        return result;
    }

    public move(m: string, {partial = false, trusted = false} = {}): FendoGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (m !== "pass") {
            m = m.replace(/[a-z]+$/, (match) => {return match.toUpperCase();});
        }
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if ( (! partial) && (! this.moves().includes(m)) ) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
            /*
            // this doesn't work, because sometimes the move is legal, but there are no available fence placements. We want to show the
            // move so that you can get reasons for each fence placement being impossible.
            else if ( (partial) && (this.moves().filter(x => x.startsWith(m)).length < 1) ) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
            */
        }

        this.results = [];
        // Always check for a pass
        if (m === "pass") {
            this.results.push({type: "pass"});
        // Now look for movement
        } else if (m.includes("-")) {
            const { from, to, dir } = this.parseMoveWithOptionalFence(m);
            let path = this.naivePath(from, to!);
            if (path === null) {
                path = this.graph.path(from, to!);
            }
            this.board.delete(from);
            this.board.set(to!, this.currplayer);
            for (let i = 0; i < path!.length - 1; i++) {
                this.results.push({type: "move", from: path![i], to: path![i+1]});
            }
            if (dir !== undefined) {
                const neighbour = this.graph.coords2algebraic(...RectGrid.move(...this.graph.algebraic2coords(to!), dir));
                this.fences.push([to!, neighbour]);
                this.graph.graph.dropEdge(to!, neighbour);
                this.results.push({type: "block", between: [to!, neighbour]});
            }
        // Check for stationary fence placement
        } else {
            const stationary = this.parseStationaryFence(m);
            if (stationary !== null) {
                const { cell, dir } = stationary;
                const neighbour = this.graph.coords2algebraic(...RectGrid.move(...this.graph.algebraic2coords(cell), dir));
                this.fences.push([cell, neighbour]);
                this.graph.graph.dropEdge(cell, neighbour);
                this.results.push({type: "block", between: [cell, neighbour]});
            } else {
                this.board.set(m, this.currplayer);
                this.pieces[this.currplayer - 1]--;
                this.results.push({type: "place", where: m})
            }
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

    protected checkEOG(): FendoGame {
        // If two passes in a row, we need to end
        let passedout = false;
        if ( (this.lastmove === "pass") && (this.stack[this.stack.length - 1].lastmove === "pass") ) {
            passedout = true;
        }
        const areas = this.getAreas();
        const score1 = this.getPlayerScore(1);
        const score2 = this.getPlayerScore(2);
        const majorityThreshold = Math.floor((this.boardSize ** 2) / 2);
        const majorityClaimed = (score1 > majorityThreshold) || (score2 > majorityThreshold);
        if ( (areas.open.length === 0) || passedout || majorityClaimed) {
            this.gameover = true;
            if (score1 > score2) {
                this.winner = [1];
            } else if (score1 < score2) {
                this.winner = [2];
            } else {
                this.winner = [1, 2];
            }
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }

        return this;
    }

    public state(): IFendoState {
        return {
            game: FendoGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: FendoGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            pieces: [...this.pieces],
            fences: clonelst(this.fences) as [string, string][],
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        const cells = this.graph.listCells(true);
        for (const row of cells) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    if (contents === 1) {
                        pieces.push("A");
                    } else {
                        pieces.push("B")
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join("");
        }

        // Build rep
        const markers: (MarkerFence|MarkerShading)[] = [];
        // First add fences
        for (const fence of this.fences) {
            const dir = this.graph.bearing(fence[0], fence[1])!;
            const [x, y] = this.graph.algebraic2coords(fence[0]);
            markers.push({type: "fence", cell: {row: y, col: x}, side: dir});
        }
        // Now shade in closed areas
        const areas = this.getAreas();
        for (const area of areas.closed) {
            const owner = [...this.board.entries()].filter(e => area.has(e[0])).map(e => e[1])[0];
            for (const cell of area) {
                const [x, y] = this.graph.algebraic2coords(cell);
                markers.push({type: "shading", points: [{col: x, row: y}, {col: x+1, row: y}, {col: x+1, row: y+1}, {col: x, row: y+1}], colour: owner})
            }
        }

        const board: BoardBasic = {
            style: "squares-beveled",
            width: this.boardSize,
            height: this.boardSize,
            markers,
        }
        const rep: APRenderRep =  {
            board,
            legend: {
                A: {
                    name: "piece",
                    colour: 1
                },
                B: {
                    name: "piece",
                    colour: 2
                }
            },
            pieces: pstr
        };

        // Add annotations
        if (this.results.length > 0) {
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "move") {
                    const [fromX, fromY] = this.graph.algebraic2coords(move.from);
                    const [toX, toY] = this.graph.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "place") {
                    const [x, y] = this.graph.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
            if (rep.annotations.length === 0) {
                delete rep.annotations;
            }
        }

        return rep;
    }

    public sidebarScores(): IScores[] {
        return [
            { name: this.neutralAreaLabel("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] },
            { name: this.neutralAreaLabel("apgames:status.PIECESINHAND"), scores: this.pieces }
        ]
    }

    public getPlayerScore(player: number): number {
        let score = 0;

        const areas = this.getAreas();
        for (const area of areas.closed) {
            const pieces = [...this.board.entries()].filter(e => (area.has(e[0]) && (e[1] === player)));
            if (pieces.length > 0) {
                score += area.size;
            }
        }

        return score;
    }



    protected frameChatActorSeat(currplayer: number): number {
        let seat = currplayer + 1;
        if (seat > this.numplayers) {
            seat = 1;
        }
        return seat;
    }

    public chatLogEntries(players: string[] = []): ChatLogEntry[] {
        const entries: ChatLogEntry[] = [];
        for (const state of this.stack) {
            if (state._results === undefined || state._results.length === 0) {
                continue;
            }
            const lines: ChatLogLine[] = [];
            const currplayer = state.currplayer as number;
            const seat = this.frameChatActorSeat(currplayer);
            const moves = state._results.filter((r) => r.type === "move") as { type: "move"; from: string; to: string }[];
            if (moves.length > 0) {
                const first = moves[0];
                const last = moves[moves.length - 1];
                const rest = moves.slice(0, moves.length - 1);
                if (moves.length > 2) {
                    this.pushSeatChatLine(lines, seat, "apresults:MOVE.chase", {
                        from: first.from,
                        to: last.to,
                        through: rest.map((m) => m.to).join(", "),
                    });
                } else {
                    this.pushSeatChatLine(lines, seat, "apresults:MOVE.nowhat", {
                        from: first.from,
                        to: last.to,
                    });
                }
            }
            for (const r of state._results) {
                switch (r.type) {
                    case "place":
                        this.pushSeatChatLine(lines, seat, "apresults:PLACE.nowhat", { where: r.where });
                        break;
                    case "block":
                        this.pushSeatChatLine(lines, seat, "apresults:BLOCK.between", {
                            cell1: r.between![0],
                            cell2: r.between![1],
                        });
                        break;
                    case "pass":
                        this.pushSeatChatLine(lines, seat, "apresults:PASS.simple");
                        break;
                }
            }
            const ctx: ChatLogCollectContext = {
                results: state._results,
                currplayer,
                defaultSeat: seat,
                players,
            };
            for (const r of state._results) {
                if (r.type === "eog" || r.type === "resigned" || r.type === "winners") {
                    this.collectChatLogLine(lines, r, ctx);
                }
            }
            entries.push({
                timestamp: (state._timestamp && new Date(state._timestamp).toISOString()) || "unknown",
                lines,
            });
        }
        return entries;
    }

    public clone(): FendoGame {
        return new FendoGame(this.serialize());
    }
}
