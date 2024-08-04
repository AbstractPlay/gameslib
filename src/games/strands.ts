import { GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, MarkerGlyph, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { HexTriGraph, reviver, UserFacingError } from "../common";
import i18next from "i18next";
import _ from "lodash";

type playerid = 1 | 2;
type Direction = "NE" | "E" | "SE" | "SW" | "W" | "NW";

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    sizes: number[][];
    lastmove?: string;
}

export interface IStrandsState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
    setup: Map<string, number>;
};

export class StrandsGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Strands",
        uid: "strands",
        playercounts: [2],
        version: "20240714",
        dateAdded: "2024-08-02",
        // i18next.t("apgames:descriptions.strands")
        description: "apgames:descriptions.strands",
        urls: ["https://boardgamegeek.com/boardgame/364343/strands"],
        people: [
            {
                type: "designer",
                name: "Nick Bentley",
                urls: ["https://boardgamegeek.com/boardgamedesigner/7958/nick-bentley"],
            }
        ],
        variants: [
            { uid: "size-6-random", group: "board" },
            { uid: "size-5-fixed", group: "board" },
            { uid: "size-6-fixed", group: "board" },
            { uid: "size-6-fixed-lownumbers", group: "board" },
            { uid: "size-7-fixed", group: "board" },
        ],
        categories: ["goal>majority", "mechanic>place", "board>shape>hex", "board>connect>hex", "components>simple>1per"],
        flags: ["scores", "no-moves", "random-start", "custom-randomization"],
        displays: [{ uid: "always-show-numbers" }],
    };

    public coords2algebraic(x: number, y: number): string {
        return this.graph.coords2algebraic(x, y);
    }

    public algebraic2coords(cell: string): [number, number] {
        return this.graph.algebraic2coords(cell);
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, playerid>;
    public sizes: number[][] = [[], []];
    public graph: HexTriGraph = new HexTriGraph(7, 13);
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private boardSize: number;
    private setup: Map<string, number>;
    private selected: string[] = [];

    constructor(state?: IStrandsState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            this.boardSize = this.getBoardSize();
            this.buildGraph();
            const fresh: IMoveState = {
                _version: StrandsGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                sizes: [[], []],
            };
            this.stack = [fresh];
            this.setup = this.buildSetup();
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IStrandsState;
            }
            if (state.game !== StrandsGame.gameinfo.uid) {
                throw new Error(`The Strands game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
            this.setup = state.setup;
            this.boardSize = this.getBoardSize();
            this.buildGraph();
        }
        this.load();
    }

    public load(idx = -1): StrandsGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if (idx < 0 || idx >= this.stack.length) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        if (state === undefined) {
            throw new Error(`Could not load state index ${idx}`);
        }
        this.results = [...state._results];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.sizes = [[...state.sizes[0]], [...state.sizes[1]]];
        this.lastmove = state.lastmove;
        return this;
    }

    private getBoardSize(): number {
        // Get board size from variants.
        if (this.variants !== undefined && this.variants.length > 0 && this.variants[0] !== undefined && this.variants[0].length > 0) {
            const sizeVariants = this.variants.filter(v => v.includes("size"))
            if (sizeVariants.length > 0) {
                const size = sizeVariants[0].match(/\d+/);
                return parseInt(size![0], 10);
            }
            if (isNaN(this.boardSize)) {
                throw new Error(`Could not determine the board size from variant "${this.variants[0]}"`);
            }
        }
        return 7;
    }

    private getGraph(): HexTriGraph {
        return new HexTriGraph(this.boardSize, (this.boardSize * 2) - 1);
    }

    private buildGraph(): StrandsGame {
        this.graph = this.getGraph();
        return this;
    }

    private buildSetup(): Map<string, number> {
        // Set up the initial board state.
        // For random setups.
        if (this.variants === undefined || this.variants.length === 0 || this.variants.includes("") || this.variants.some((x) => x.endsWith("random"))) {
            return this.getRandomSetup();
        }
        // For fixed setups.
        const setup = this.setupString();
        const board = new Map<string, number>();
        for (const row of this.graph.listCells(true) as string[][]) {
            for (const cell of row) {
                const [x, y] = this.algebraic2coords(cell);
                board.set(cell, parseInt(setup[y][x], 10));
            }
        }
        return board;
    }

    private getRing(ring: number): [string[], string[]] {
        // Get the cells for each ring. Centre is indexed by 0.
        // Returns the elements of the corners of the ring, and the edges of the ring.
        const centreCoords: [number, number] = [this.boardSize - 1, this.boardSize - 1]
        const centre = this.graph.coords2algebraic(...centreCoords);
        if (ring === 0) { return [[centre], []]; }
        const corners: string[] = [];
        for (const dir of ["NE", "E", "SE", "SW", "W", "NW"] as Direction[]) {
            corners.push(this.coords2algebraic(...this.graph.move(...centreCoords, dir, ring)!));
        }
        const edges: string[] = [];
        const clockwiseCheck: Direction[] = ["SE", "SW", "W", "NW", "NE", "E"];
        for (const [i, corner] of corners.entries()) {
            const ray = this.graph.ray(...this.algebraic2coords(corner), clockwiseCheck[i]);
            for (const cell of ray.map(c => this.coords2algebraic(...c))) {
                if (corners.includes(cell)) { break; }
                edges.push(cell);
            }
        }
        return [corners, edges];
    }

    private distributionToMap(distribution: number[][]): Map<string, number> {
        // Get the map given the config.
        const board = new Map<string, number>();
        for (const [i, ring] of distribution.entries()) {
            const upTo = ring.length;
            const [corners, edges] = this.getRing(i);
            for (const [j, n] of ring.reverse().entries()) {
                for (let k = 0; k < n; k++) {
                    // We use lodash to pop a random element in the respective array.
                    if (corners.length > 0) {
                        board.set(_.pullAt(corners, _.random(corners.length - 1))[0], upTo - j);
                    } else {
                        board.set(_.pullAt(edges, _.random(edges.length - 1))[0], upTo - j);
                    }
                }
            }
        }
        return board;
    }

    private getRandomSetup(): Map<string, number> {
        // Set up the random initial board state using a config for each board size.
        if (this.boardSize === 6) {
            return this.distributionToMap([
                [1, 0, 0, 0, 0, 0],
                [2, 4, 0, 0, 0, 0],
                [0, 11, 1, 0, 0, 0],
                [0, 12, 6, 0, 0, 0],
                [0, 0, 22, 2, 0, 0],
                [0, 0, 0, 10, 20, 0],
            ]);
        } else {
            return this.distributionToMap([
                [1, 0, 0, 0, 0, 0],
                [3, 3, 0, 0, 0, 0],
                [5, 7, 0, 0, 0, 0],
                [1, 17, 0, 0, 0, 0],
                [0, 15, 9, 0, 0, 0],
                [0, 0, 28, 2, 0, 0],
                [0, 0, 0, 8, 28, 0],
            ]);
        }
    }

    private setupString(): string[] {
        // Setup strings for fixed boards.
        const variant = this.variants[0];
        switch (variant) {
            case "size-5-fixed":
                return [
                    "     6 4 4 4 6     ",
                    "    4 3 3 3 3 4    ",
                    "   4 2 2 2 2 2 4   ",
                    "  4 3 2 2 2 2 3 4  ",
                    " 6 3 2 2 1 2 2 3 6 ",
                    "  4 3 2 2 2 2 3 4  ",
                    "   4 2 2 2 2 2 4   ",
                    "    4 3 3 3 3 4    ",
                    "     6 4 4 4 6     ",
                ].map((x) => x.replace(/ /g, ""));
            case "size-6-fixed":
                return [
                    "     6 4 4 4 4 6     ",
                    "    4 3 3 3 3 3 4    ",
                    "   4 3 2 2 2 2 3 4   ",
                    "  4 3 2 2 2 2 2 3 4  ",
                    " 4 3 2 2 2 2 2 2 3 4 ",
                    "6 3 2 2 2 1 2 2 2 3 6",
                    " 4 3 2 2 2 2 2 2 3 4 ",
                    "  4 3 2 2 2 2 2 3 4  ",
                    "   4 3 2 2 2 2 3 4   ",
                    "    4 3 3 3 3 3 4    ",
                    "     6 4 4 4 4 6     ",
                ].map((x) => x.replace(/ /g, ""));
            case "size-6-fixed-lownumbers":
                return [
                    "     3 3 3 3 3 3     ",
                    "    3 2 2 2 2 2 3    ",
                    "   3 2 2 2 2 2 2 3   ",
                    "  3 2 2 2 2 2 2 2 3  ",
                    " 3 2 2 2 2 2 2 2 2 3 ",
                    "3 2 2 2 2 1 2 2 2 2 3",
                    " 3 2 2 2 2 2 2 2 2 3 ",
                    "  3 2 2 2 2 2 2 2 3  ",
                    "   3 2 2 2 2 2 2 3   ",
                    "    3 2 2 2 2 2 3    ",
                    "     3 3 3 3 3 3     ",
                ].map((x) => x.replace(/ /g, ""));
            case "size-7-fixed":
                return [
                    "      6 6 5 5 5 6 6      ",
                    "     6 4 3 3 3 3 4 6     ",
                    "    5 3 3 2 2 2 3 3 5    ",
                    "   5 3 2 2 2 2 2 2 3 5   ",
                    "  5 3 2 2 2 2 2 2 2 3 5  ",
                    " 6 3 2 2 2 2 1 2 2 2 4 6 ",
                    "6 4 3 2 2 1 1 1 2 2 3 4 6",
                    " 6 4 2 2 2 1 2 2 2 2 3 6 ",
                    "  5 3 2 2 2 2 2 2 2 3 5  ",
                    "   5 3 2 2 2 2 2 2 3 5   ",
                    "    5 3 3 2 2 2 3 3 5    ",
                    "     6 4 3 3 3 3 4 6     ",
                    "      6 6 5 5 5 6 6      ",
                ].map((x) => x.replace(/ /g, ""));
        }
        throw new Error("Could not determine the setup string.");
    }

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }
        const moves: string[] = [];
        // We do not support move generation because the multi-placement can blow up quite quickly.
        // It's probably feasible for the smaller boards and when there are fewer high numbers,
        // but in the general case, it can get quite bad, so perhaps we should just save ourselves the trouble.
        return moves;
    }

    public randomMove(): string {
        // This randomisation does not reflect the distribution if we were to sample from a full move list.
        // Instead, it randomly selects a space on the board that has no piece on it and uses that number.
        // Then select that number of empty spaces with that number.
        if (this.stack.length === 1) {
            // For first move, we place one piece on a cell numbered 2.
            return _.sample([...this.setup.entries()].filter(e => e[1] === 2 && !this.board.has(e[0])).map(e => e[0]))!;
        }
        const num = _.sample([...this.setup].filter(e => !this.board.has(e[0])).map(e => e[1]))!;
        const spaces = [...this.setup.entries()].filter(e => e[1] === num && !this.board.has(e[0])).map(e => e[0]);
        const toPlaceCount = Math.min(num, this.unplacedNumCount(num));
        return this.normaliseMove(_.sampleSize(spaces, toPlaceCount).join(","));
    }

    private sort(a: string, b: string): number {
        // Sort two cells. This is necessary because "a10" should come after "a9".
        const [ax, ay] = this.graph.algebraic2coords(a);
        const [bx, by] = this.graph.algebraic2coords(b);
        if (ay < by) { return 1; }
        if (ay > by) { return -1; }
        if (ax < bx) { return -1; }
        if (ax > bx) { return 1; }
        return 0;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = "";
            const cell = this.graph.coords2algebraic(col, row);
            if (move === "") {
                newmove = cell;
            } else {
                const moves = move.split(",");
                if (moves.includes(cell)) {
                    newmove = moves.filter(m => m !== cell).sort((a, b) => this.sort(a, b)).join(",");
                } else {
                    newmove = [...moves, cell].sort((a, b) => this.sort(a, b)).join(",");
                }
            }
            const result = this.validateMove(newmove) as IClickResult;
            if (!result.valid) {
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

    private normaliseMove(move: string): string {
        // Sort the move list so that there is a unique representation.
        move = move.toLowerCase();
        move = move.replace(/\s+/g, "");
        return move.split(",").sort((a, b) => this.sort(a, b)).join(",");
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            if (this.stack.length === 1) {
                result.message = i18next.t("apgames:validation.strands.INITIAL_INSTRUCTIONS_FIRST");
            } else {
                result.message = i18next.t("apgames:validation.strands.INITIAL_INSTRUCTIONS");
            }
            return result;
        }
        const moves = m.split(",");
        // Valid cell
        let currentMove;
        try {
            for (const move of moves) {
                currentMove = move;
                const [, y] = this.graph.algebraic2coords(move);
                // `algebraic2coords` does not check if the cell is on the board fully.
                if (y < 0) { throw new Error("Invalid cell."); }
            }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: currentMove });
            return result;
        }

        if (this.stack.length === 1 && moves.length > 1) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.strands.INITIAL_SINGLE");
            return result;
        }

        // Cell is empty
        let notEmpty;
        for (const move of moves) {
            if (this.board.has(move)) { notEmpty = move; break; }
        }
        if (notEmpty) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", { where: notEmpty });
            return result;
        }

        // Regex validator.
        const regex = /^[a-z]\d+(,[a-z]\d+)*$/;
        if (!regex.test(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.strands.INVALID_PLACEMENT", { move: m });
            return result;
        }

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
            result.message = i18next.t("apgames:validation.strands.DUPLICATE", { where: [...duplicates].join(", ") });
            return result;
        }

        // All nums the same.
        let num: number | undefined;
        for (const move of moves) {
            const n = this.setup.get(move);
            if (num === undefined) {
                num = n;
            } else if (num !== n) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.strands.DIFFERENT_NUMS");
                return result;
            }
        }

        // Normalised move
        const normalised = this.normaliseMove(m);
        if (m !== normalised) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.strands.NORMALISE", { normalised });
            return result;
        }

        if (this.stack.length === 1) {
            // First move must be on a 2.
            if (num !== 2) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.strands.INITIAL_TWO");
                return result;
            }
        } else {
            // Partial move.
            const toPlaceCount = Math.min(num!, this.unplacedNumCount(num!));
            if (moves.length < toPlaceCount) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.strands.PLACE_MORE", { num: num!, count: toPlaceCount - moves.length });
                return result;
            }

            // Too many placements.
            if (moves.length > toPlaceCount) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.strands.TOO_MANY", { count: num! });
                return result;
            }
        }

        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private unplacedNumCount(num: number): number {
        // Get the number of spaces with num that have no piece on it.
        return [...this.setup.entries()].filter(e => e[1] === num && !this.board.has(e[0])).length;
    }

    private getGroupSizes(player: playerid, board: Map<string, playerid>): number[] {
        // Get the sizes of all groups of pieces for `player`.
        board ??= this.board;
        const groups: Set<string>[] = [];
        const pieces = [...board.entries()].filter(e => e[1] === player).map(e => e[0]);
        const seen: Set<string> = new Set();
        for (const piece of pieces) {
            if (seen.has(piece)) {
                continue;
            }
            const group: Set<string> = new Set();
            const todo: string[] = [piece];
            while (todo.length > 0) {
                const cell = todo.pop()!;
                if (seen.has(cell)) {
                    continue;
                }
                group.add(cell);
                seen.add(cell);
                const neighbours = this.graph.neighbours(cell);
                for (const n of neighbours) {
                    if (pieces.includes(n)) {
                        todo.push(n);
                    }
                }
            }
            groups.push(group);
        }
        return groups.map(g => g.size).sort((a, b) => b - a);
    }

    private newSizes(board?: Map<string, playerid>): [number[], number[]] {
        // Get the sizes of all groups of pieces for both players.
        board ??= this.board;
        const sizes: [number[], number[]] = [[], []];
        for (let i = 1; i <= this.numplayers; i++) {
            sizes[i - 1] = this.getGroupSizes(i as playerid, board);
        }
        return sizes;
    }

    public move(m: string, {partial = false, trusted = false} = {}): StrandsGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        let result;
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (!trusted) {
            result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
            // This game does not generate moves.
            // if (!partial && !this.moves().includes(m)) {
            //     throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", { move: m }));
            // }
        }
        if (m.length === 0) { return this; }
        const moves = m.split(",");
        this.results = [];
        this.selected = [];
        for (const move of moves) {
            this.board.set(move, this.currplayer);
            this.selected.push(move);
            this.sizes = this.newSizes();
        }
        const num = this.setup.get(moves[0])!;
        this.results.push({ type: "place", where: moves.join(","), count: moves.length, what: num.toString() });
        if (partial) { return this; }
        this.selected = [];
        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    private spacesLeft(): number {
        // Count the number of empty cells.
        return this.graph.listCells().length - this.board.size;
    }

    private getWinner(): playerid | undefined {
        // Get the winning player.
        const player1 = this.sizes[0];
        const player2 = this.sizes[1];
        // Loop through the shorter array
        const minLen = Math.min(player1.length, player2.length);
        for (let i = 0; i < minLen; i++) {
            if (player1[i] > player2[i]) {
                return 1;
            } else if (player1[i] < player2[i]) {
                return 2;
            }
        }
        // If the loop ends, compare the lengths of the arrays
        if (player1.length > player2.length) {
            return 1;
        } else if (player1.length < player2.length) {
            return 2;
        } else {
            return undefined;
        }
    }

    protected checkEOG(): StrandsGame {
        if (this.spacesLeft() === 0) {
            this.gameover = true;
            const winner = this.getWinner();
            // Ties are not possible on an odd board, but just for completion.
            this.winner = winner === undefined ? [1, 2] : [winner];
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }

        return this;
    }

    public state(): IStrandsState {
        return {
            game: StrandsGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
            setup: this.setup,
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: StrandsGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            sizes: [[...this.sizes[0]], [...this.sizes[1]]],
        };
    }

    public render(opts?: IRenderOpts): APRenderRep {
        let altDisplay: string | undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }
        let numberAnnotations = false;
        if (altDisplay !== undefined) {
            if (altDisplay === "always-show-numbers") {
                numberAnnotations = true;
            }
        }
        // Build piece string
        const pstr: string[][] = [];
        const cells = this.graph.listCells(true);
        for (const row of cells) {
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const owner = this.board.get(cell)!;
                    if (owner === 1) {
                        if (this.selected.includes(cell)) {
                            pieces.push("C");
                        } else {
                            pieces.push("A")
                        }
                    } else {
                        if (this.selected.includes(cell)) {
                            pieces.push("D");
                        } else {
                            pieces.push("B");
                        }
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr.push(pieces);
        }

        const numCellMap: Map<number, RowCol[]> = new Map([
            [1, []], [2, []], [3, []], [4, []], [5, []], [6, []]
        ]);
        for (const [cell, num] of this.setup) {
            const [x, y] = this.algebraic2coords(cell);
            numCellMap.get(num)!.push({row: y, col: x});
        }
        const markers: Array<MarkerGlyph> = [];
        for (const [num, points] of numCellMap) {
            if (points.length === 0) { continue; }
            markers.push({ type: "glyph", glyph: `M${num}`, points: points as [RowCol, ...RowCol[]] })
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "hex-of-hex",
                minWidth: this.boardSize,
                maxWidth: (this.boardSize * 2) - 1,
                strokeOpacity: 0,
                markers,
            },
            legend: {
                A: [{ name: "hex-pointy", colour: 1, scale: 1.3 }],
                B: [{ name: "hex-pointy", colour: 2, scale: 1.3 }],
                C: [{ name: "hex-pointy", opacity: 0.8, colour: "#FFF", scale: 1.3 }, { name: "hex-pointy", colour: 1, opacity: 0.5, scale: 1.3 }],
                D: [{ name: "hex-pointy", opacity: 0.8, colour: "#FFF", scale: 1.3 }, { name: "hex-pointy", colour: 2, opacity: 0.5, scale: 1.3 }],
                M1: [{ text: "1", colour: "#83A598" }],
                M2: [{ text: "2", colour: "#D79921" }],
                M3: [{ text: "3", colour: "#98971A" }],
                M4: [{ text: "4", colour: "#D3869B" }],
                M5: [{ text: "5", colour: "#FE8019" }],
                M6: [{ text: "6", colour: "#BDAE93" }],
            },
            pieces: pstr.map(p => p.join("")).join("\n"),
        };

        // Add annotations
        rep.annotations = [];
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
                    for (const cell of move.where!.split(",")) {
                        const [x, y] = this.graph.algebraic2coords(cell);
                        rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }]});
                    }
                }
            }
        }
        if (numberAnnotations) {
            for (const [num, points] of numCellMap) {
                if (points.length === 0) { continue; }
                rep.annotations.push({ type: "glyph", glyph: `M${num}`, targets: points as [RowCol, ...RowCol[]] });
            }
        }
        return rep;
    }

    public getPlayerScore(player: playerid): number {
        // Ideally it should return the entire group size string.
        // return scores.join("-");
        // But because this method has to return a number, we just take the
        // effective group as score, which may be harder to interpret.
        const scores = this.sizes[player - 1];
        if (scores.length === 0) { return 0; }
        const scoresOther = this.sizes[player % 2];
        if (scoresOther.length > scores.length) {
            return 0;
        }
        if (scoresOther.length < scores.length) {
            return scores[scoresOther.length];
        }
        for (let i = 0; i < scores.length; i++) {
            if (scores[i] !== scoresOther[i]) {
                return scores[i];
            }
        }
        return 0;
    }

    public getPlayersScores(): IScores[] {
        return [{ name: i18next.t("apgames:status.GROUPSIZES"), scores: [this.sizes[0].join(","), this.sizes[1].join(",")] }];
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Sizes**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const pieces = this.sizes[n - 1].join(",");
            status += `Player ${n}: ${pieces}\n\n`;
        }

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                if (r.what === "2" && r.count === 1) {
                    node.push(i18next.t("apresults:PLACE.strands_initial", { player, where: r.where }));
                } else {
                    node.push(i18next.t("apresults:PLACE.strands", { player, where: r.where!.split(",").join(", "), count: r.count }));
                }
                resolved = true;
                break;
        }
        return resolved;
    }

    public getStartingPosition(): string {
        const start: string[] = [];
        for (const row of this.graph.listCells(true) as string[][]) {
            const rowNums: number[] = [];
            for (const cell of row) {
                rowNums.push(this.setup.get(cell)!);
            }
            start.push(rowNums.join(""));
        }
        return start.join("\n");
    }

    public clone(): StrandsGame {
        return new StrandsGame(this.serialize());
    }
}
