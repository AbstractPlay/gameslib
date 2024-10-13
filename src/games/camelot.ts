import { GameBase, IAPGameState, IClickResult, ICustomButton, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, MarkerFlood, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { Directions, RectGrid, reviver, UserFacingError } from "../common";
import i18next from "i18next";

type playerid = 1 | 2;
// 1 = Men, 2 = Knight
type pieceid = 1 | 2;
const allDirections: Directions[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export type CellContents = [playerid, pieceid]

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    castleMoveCounts: [number, number];
    trees: string[];
    lastmove?: string;
    countdown: number;
}

export interface ICamelotState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class CamelotGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Camelot",
        uid: "camelot",
        playercounts: [2],
        // version: "20240817",
        // Initial implementation of forced jumps did not allow knight's charges.
        version: "20241012",
        dateAdded: "2024-08-26",
        // i18next.t("apgames:descriptions.camelot")
        description: "apgames:descriptions.camelot",
        urls: [
            "http://www.worldcamelotfederation.com",
            "https://boardgamegeek.com/boardgame/5251/camelot",
        ],
        people: [
            {
                type: "designer",
                name: "George S. Parker",
            }
        ],
        variants: [
            { uid: "camette", group: "board" },
            { uid: "cam", group: "board" },
            { uid: "chivalry", group: "board" },
            { uid: "river", group: "board" },
            { uid: "anti" },
        ],
        categories: ["goal>breakthrough", "goal>annihilate", "mechanic>capture", "mechanic>differentiate", "mechanic>move>group", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["perspective", "limited-pieces", "custom-buttons"],
    };

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.height);
    }

    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.height);
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, CellContents>;
    public castleMoveCounts: [number, number] = [0, 0];
    public trees: string[] = [];
    public countdown = 0;
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private width = 0;
    private height = 0;
    private dots: string[] = [];
    private blockedCells: string[] = [];
    private castleCells: [string[], string[]] = [[], []];
    private riverCells: string[] = [];
    private bridgeCells: string[] = [];
    private treePlaceableCells: [string[], string[]] = [[], []];
    private grid: RectGrid;

    constructor(state?: ICamelotState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const setupString = this.getSetupString();
            this.applyVariants(setupString)
            const board = this.getInitialBoard(setupString);
            const fresh: IMoveState = {
                _version: CamelotGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                castleMoveCounts: [0, 0],
                trees: [],
                countdown: 0,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ICamelotState;
            }
            if (state.game !== CamelotGame.gameinfo.uid) {
                throw new Error(`The Camelot game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
            this.applyVariants(this.getSetupString());
        }
        this.load();
        this.grid = new RectGrid(this.width, this.height);
    }

    public load(idx = -1): CamelotGame {
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
        this.board = [...state.board].reduce((m, [k, v]) => m.set(k, [v[0], v[1]]), new Map<string, CellContents>());
        this.castleMoveCounts = [state.castleMoveCounts[0], state.castleMoveCounts[1]];
        this.trees = [...state.trees];
        this.countdown = state.countdown;
        this.lastmove = state.lastmove;
        return this;
    }

    private applyVariants(setupString: string[][]): void {
        // Assign a bunch of the variant-specific fields based on the setupString.
        [this.width, this.height] = this.getBoardSize(setupString);
        this.blockedCells = this.getBlockedCells(setupString);
        this.castleCells = this.getCastleCells(setupString);
        this.riverCells = this.getRiverCells(setupString);
        this.bridgeCells = this.getBridgeCells(setupString);
        this.treePlaceableCells = this.getTreePlaceableCells(setupString);
    }

    private getBoardSize(setupString: string[][]): [number, number] {
        // Get width and height of board.
        return [setupString[0].length, setupString.length];
    }

    private getSetupString(): string[][] {
        // Get setup string.
        // Key:
        // * M: player 1 man
        // * K: player 1 knight
        // * m: player 2 man
        // * k: player 2 knight
        // * x: blocked cell
        // * 1: player 1 castle
        // * 2: player 2 castle
        // * r: river cell
        // * b: bridge cell
        // * v: tree placeable cell for player 1
        // * ^: tree placeable cell for player 2
        if (this.variants.includes("chivalry")) {
            return [
                "xxxxxx22xxxxxx",
                "xxx--------xxx",
                "xx----------xx",
                "x------------x",
                "--------------",
                "--kkmmmmmmkk--",
                "--kkmmmmmmkk--",
                "--------------",
                "--------------",
                "--KKMMMMMMKK--",
                "--KKMMMMMMKK--",
                "--------------",
                "x------------x",
                "xx----------xx",
                "xxx--------xxx",
                "xxxxxx11xxxxxx",
            ].map(x => x.split(""));
        } else if (this.variants.includes("cam")) {
            return [
                "xxx2xxx",
                "xx---xx",
                "x-----x",
                "--k-k--",
                "-mmmmm-",
                "-------",
                "-------",
                "-------",
                "-MMMMM-",
                "--K-K--",
                "x-----x",
                "xx---xx",
                "xxx1xxx",
            ].map(x => x.split(""));
        } else if (this.variants.includes("camette")) {
            return [
                "xx2xx",
                "x-k-x",
                "-mmm-",
                "-----",
                "-MMM-",
                "x-K-x",
                "xx1xx",
            ].map(x => x.split(""));
        } else if (this.variants.includes("river")) {
            return [
                "xxxxx22xxxxx",
                "xx^^----^^xx",
                "x^^^^^^^^^^x",
                "^^kmmmmmmk^^",
                "^^^kmmmmk^^r",
                "^^^^^^^--rrr",
                "^^^^^^^rbrrr",
                "^^---rrrbrvv",
                "^^rbrrr---vv",
                "rrrbrvvvvvvv",
                "rrr--vvvvvvv",
                "rvvKMMMMKvvv",
                "vvKMMMMMMKvv",
                "xvvvvvvvvvvx",
                "xxvv----vvxx",
                "xxxxx11xxxxx",
            ].map(x => x.split(""));
        } else {
            return [
                "xxxxx22xxxxx",
                "xx--------xx",
                "x----------x",
                "------------",
                "------------",
                "--kmmmmmmk--",
                "---kmmmmk---",
                "------------",
                "------------",
                "---KMMMMK---",
                "--KMMMMMMK--",
                "------------",
                "------------",
                "x----------x",
                "xx--------xx",
                "xxxxx11xxxxx",
            ].map(x => x.split(""));
        }
    }

    private getBlockedCells(setupString: string[][]): string[] {
        // Get blocked cells around the board.
        const blockedCells: string[] = [];
        for (const [j, row] of setupString.entries()) {
            for (const [i, char] of row.entries()) {
                if (char === "x") {
                    blockedCells.push(this.coords2algebraic(i, j));
                }
            }
        }
        return blockedCells
    }

    private getCastleCells(setupString: string[][]): [string[], string[]] {
        // Get castle cells for each player.
        const castleCells1: string[] = []
        const castleCells2: string[] = []
        for (const [j, row] of setupString.entries()) {
            for (const [i, char] of row.entries()) {
                if (char === "1") {
                    castleCells1.push(this.coords2algebraic(i, j));
                } else if (char === "2") {
                    castleCells2.push(this.coords2algebraic(i, j));
                }
            }
        }
        return [castleCells1, castleCells2];
    }

    private getInitialBoard(setupString: string[][]): Map<string, CellContents> {
        // Get initial board state.
        const board: Map<string, CellContents> = new Map();
        for (const [j, row] of setupString.entries()) {
            for (const [i, char] of row.entries()) {
                if (char === "M") {
                    board.set(this.coords2algebraic(i, j), [1, 1]);
                } else if (char === "K") {
                    board.set(this.coords2algebraic(i, j), [1, 2]);
                } else if (char === "m") {
                    board.set(this.coords2algebraic(i, j), [2, 1]);
                } else if (char === "k") {
                    board.set(this.coords2algebraic(i, j), [2, 2]);
                }
            }
        }
        return board;
    }

    private getRiverCells(setupString: string[][]): string[] {
        // Get river cells.
        const riverCells: string[] = [];
        for (const [j, row] of setupString.entries()) {
            for (const [i, char] of row.entries()) {
                if (char === "r") {
                    riverCells.push(this.coords2algebraic(i, j));
                }
            }
        }
        return riverCells;
    }

    private getBridgeCells(setupString: string[][]): string[] {
        // Get bridge cells.
        const bridgeCells: string[] = [];
        for (const [j, row] of setupString.entries()) {
            for (const [i, char] of row.entries()) {
                if (char === "b") {
                    bridgeCells.push(this.coords2algebraic(i, j));
                }
            }
        }
        return bridgeCells;
    }

    private getTreePlaceableCells(setupString: string[][]): [string[], string[]] {
        // Get cells where trees can be placed for each player.
        const treePlaceableCells1: string[] = [];
        const treePlaceableCells2: string[] = [];
        for (const [j, row] of setupString.entries()) {
            for (const [i, char] of row.entries()) {
                if (char === "v") {
                    treePlaceableCells1.push(this.coords2algebraic(i, j));
                } else if (char === "^") {
                    treePlaceableCells2.push(this.coords2algebraic(i, j));
                }
            }
        }
        return [treePlaceableCells1, treePlaceableCells2];
    }

    private getAllMoves(from: string, mustJump = false): string[] {
        // Get all possible sequences of moves from a given cell.
        // If mustJump is true, only return sequences that include a jump.
        // This value is usually decided before this function needs to be called.
        const moves: string[] = [];
        const [player, piece] = this.board.get(from)!;
        if (mustJump) {
            moves.push(...this.getAllJumps(from, [], [from], player).map(x => from + "x" + x.join("x")));
        } else {
            moves.push(...this.getPlain(from, player).map(x => from + "-" + x));
        }
        const [canters, chargeIndices] = this.getAllCanters(from, [], [from], player, piece === 2);
        const canterMoves: string[] = [];
        for (let i = 0; i < canters.length; i++) {
            if (chargeIndices[i] === 0) {
                canterMoves.push(from + "^" + canters[i].join("^"));
            } else {
                const canterPart = canters[i].slice(0, chargeIndices[i]);
                const chargePart = canters[i].slice(chargeIndices[i]);
                canterMoves.push(from + "^" + canterPart.join("^") + "x" + chargePart.join("x"));
            }
        }
        if (mustJump) {
            moves.push(...canterMoves.filter(m => m.includes("x")));
        } else {
            moves.push(...canterMoves);
        }
        return moves;
    }

    public getAllJumps(from: string, jumpSequence: string[], removed: string[], player: playerid): string[][] {
        // Get all possible sequences of jumps from a given cell.
        const jumpsMap = this.getJumps(from, removed, player);
        if (jumpsMap.size === 0) {
            if (jumpSequence.length === 0) { return []; }
            return [jumpSequence];
        }
        const tos: string[][] = [];
        for (const [to, captured] of jumpsMap) {
            tos.push(...this.getAllJumps(to, [...jumpSequence, to], [...removed, captured], player));
        }
        return tos;
    }

    public getAllCanters(from: string, canterSequence: string[], excluded: string[], player: playerid, charge: boolean): [string[][], number[]] {
        // Get all possible sequences of canters from a given cell.
        // If charge is true, the piece is a knight and can perform a knight's charge.
        // Returns a list of sequences, and a list of numbers corresponding to when the charge is activated.
        const tos: string[][] = [];
        const idx: number[] = [];
        if (canterSequence.length > 0) {
            if (charge) {
                const jumps = this.getAllJumps(from, [], [excluded[0]], player);
                if (jumps.length > 0) {
                    const charges: string[][] = [];
                    for (const jump of jumps) {
                        charges.push([...canterSequence, ...jump]);
                    }
                    return [charges, Array(charges.length).fill(canterSequence.length) as number[]];
                } else {
                    tos.push(canterSequence);
                    idx.push(0);
                }
            } else {
                tos.push(canterSequence);
                idx.push(0);
            }
        }
        const canters = this.getCanters(from, excluded, player);
        if (canters.length === 0) {
            if (canterSequence.length === 0) { return [[], []]; }
            return [tos, [0]];
        }
        for (const cell of canters) {
            const [tos2, idx2] = this.getAllCanters(cell, [...canterSequence, cell], [...excluded, cell], player, charge);
            tos.push(...tos2);
            idx.push(...idx2);
        }
        return [tos, idx];
    }

    private jumpPieces(player?: playerid, pieces?: string[]): string[] {
        // Get all pieces that have a forced jump.
        // If there are no pieces with forced jumps, return an empty list.
        player ??= this.currplayer;
        pieces ??= [...this.board].filter(([, v]) => v[0] === player).map(([k, ]) => k);
        const piecesToJump: string[] = [];
        for (const piece of pieces) {
            const jumpsMap = this.getJumps(piece, [], player);
            if (jumpsMap.size > 0) { piecesToJump.push(piece); }
        }
        return piecesToJump;
    }

    private inOwnCastlePieces(player?: playerid, pieces?: string[]): string[] {
        // Get all pieces that are in their own castle.
        player ??= this.currplayer;
        pieces ??= [...this.board].filter(([, v]) => v[0] === player).map(([k, ]) => k);
        return pieces.filter(p => this.castleCells[player! - 1].includes(p));
    }

    public moves(player?: playerid): string[] {
        player ??= this.currplayer;
        if (this.gameover) { return []; }
        const moves: string[] = [];
        if (this.isTreePlacingPhase()) {
            // Select three cells to place trees.
            const placeable = this.stack.length === 1 ? this.treePlaceableCells[0] : this.treePlaceableCells[1];
            for (let i = 0; i < placeable.length; i++) {
                for (let j = i + 1; j < placeable.length; j++) {
                    for (let k = j + 1; k < placeable.length; k++) {
                        // If we can figure out the correct order, we wouldn't need to sort, but oh well.
                        moves.push([placeable[i], placeable[j], placeable[k]].sort((a, b) => this.sort(a, b)).join(","));
                    }
                }
            }
        } else {
            const pieces = [...this.board].filter(([, v]) => v[0] === player).map(([k, ]) => k);
            // If a player has pieces in their own castle, they must move them.
            const jumpPieces = this.jumpPieces(player, pieces);
            const mustJump = jumpPieces.length > 0;
            const piecesInOwnCastle = this.inOwnCastlePieces(player, pieces);
            if (piecesInOwnCastle.length > 0) {
                for (const from of piecesInOwnCastle) {
                    if(jumpPieces.includes(from)) {
                        // Mandatory jump from castle.
                        moves.push(...this.getAllMoves(from, true));
                    } else {
                        moves.push(...this.getAllMoves(from, false));
                    }
                }
            } else {
                // If a player has pieces that can jump, they must jump.
                for (const from of pieces) {
                    moves.push(...this.getAllMoves(from, mustJump));
                }
            }
            // Check if the player can claim a draw.
            if (this.countdown >= 50 || this.stateCount(new Map<string, any>([["board", this.board], ["currplayer", this.currplayer]])) > 3) {
                moves.push("draw");
            }
        }
        return moves;
    }

    public getButtons(): ICustomButton[] {
        if (this.countdown >= 50 || this.stateCount(new Map<string, any>([["board", this.board], ["currplayer", this.currplayer]])) > 3) {
            return [{
                label: "draw",
                move: "draw"
            }];
        }
        return [];
    }

    private hasMoves(player?: playerid): boolean {
        // Check if a player has any moves.
        player ??= this.currplayer;
        if (this.gameover) { return false; }
        const pieces = [...this.board].filter(([, v]) => v[0] === player);
        for (const [from, ] of pieces) {
            if (this.getAllMoves(from).length > 0) { return true; }
        }
        return false;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    private isTreePlacingPhase(): boolean {
        // Check if the game is in the tree placing phase.
        return this.variants.includes("river") && this.stack.length < 3
    }

    private sort(a: string, b: string): number {
        // Sort two cells. This is necessary because "a10" should come after "a9".
        const [ax, ay] = this.algebraic2coords(a);
        const [bx, by] = this.algebraic2coords(b);
        if (ax < bx) { return -1; }
        if (ax > bx) { return 1; }
        if (ay < by) { return 1; }
        if (ay > by) { return -1; }
        return 0;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            let newmove = "";
            if (move === "") {
                newmove = cell;
            } else {
                if (move === cell) {
                    newmove = "";
                } else if (this.isTreePlacingPhase()) {
                    const moves = move.split(",");
                    if (moves.includes(cell)) {
                        newmove = moves.filter(m => m !== cell).sort((a, b) => this.sort(a, b)).join(",");
                    } else {
                        newmove = [...moves, cell].sort((a, b) => this.sort(a, b)).join(",");
                    }
                } else {
                    const split = move.split(/-|\^|x/);
                    const last = split[split.length - 1];
                    if (last === cell) {
                        // Remove the last action.
                        const lastSplitIndex = move.split('').reduceRight((acc, char, index) => acc === -1 && /[-^x]/.test(char) ? index : acc, -1);
                        newmove = move.slice(0, lastSplitIndex);
                    } else {
                        const others = split.slice(0, -1);
                        const canters = this.getCanters(last, others, this.currplayer);
                        const jumpsMap = this.getJumps(last, others, this.currplayer);
                        if (canters.includes(cell)) {
                            newmove = `${move}^${cell}`;
                        } else if (jumpsMap.has(cell)) {
                            newmove = `${move}x${cell}`;
                        } else {
                            newmove = `${move}-${cell}`;
                        }
                    }
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
                message: i18next.t("apgames:validation._general.GENERIC", { move, row, col, piece, emessage: (e as Error).message })
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
        const result: IValidationResult = { valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER") };
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            const pieces = [...this.board].filter(([, v]) => v[0] === this.currplayer).map(([k, ]) => k);
            if (this.isTreePlacingPhase()) {
                result.message = i18next.t("apgames:validation.camelot.INITIAL_INSTRUCTIONS_TREE");
            } else {
                const inOwnCastle = this.inOwnCastlePieces(this.currplayer, pieces);
                if (inOwnCastle.length > 0) {
                    result.message = i18next.t("apgames:validation.camelot.INITIAL_INSTRUCTIONS_OWN_CASTLE", { where: inOwnCastle[0] });
                } else if (this.jumpPieces(this.currplayer, pieces).length > 0) {
                    result.message = i18next.t("apgames:validation.camelot.INITIAL_INSTRUCTIONS_JUMP");
                } else {
                    result.message = i18next.t("apgames:validation.camelot.INITIAL_INSTRUCTIONS");
                }
            }
            return result;
        }
        if (this.isTreePlacingPhase()) {
            const split = m.split(",");
            if (split.length > 3) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.camelot.TREE_LIMIT");
                return result;
            }
            // Valid cell
            let currentMove;
            try {
                for (const p of split) {
                    currentMove = p;
                    const [x, y] = this.algebraic2coords(p);
                    // `algebraic2coords` does not check if the cell is on the board.
                    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
                        throw new Error("Invalid cell");
                    }
                }
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: currentMove });
                return result;
            }
            // Check if all trees are placed on cells that the player can place on.
            const treePlaceableCells = this.stack.length === 1 ? this.treePlaceableCells[0] : this.treePlaceableCells[1];
            for (const place of split) {
                if (!treePlaceableCells.includes(place)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.camelot.NOT_TREE_PLACEABLE", { where: place });
                    return result;
                }
            }
            // No duplicate cells.
            const seen: Set<string> = new Set();
            const duplicates: Set<string> = new Set();
            for (const move of split) {
                if (seen.has(move)) {
                    duplicates.add(move);
                }
                seen.add(move);
            }
            if (duplicates.size > 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.camelot.DUPLICATE_TREE", {where: [...duplicates].join(", ")});
                return result;
            }
            // Normalised move
            const normalised = this.normaliseMove(m);
            if (m !== normalised) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.camelot.NORMALISED", { normalised });
                return result;
            }
            // Place more trees.
            if (split.length < 3) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.camelot.TREE_CONTINUE", { count: 3 - split.length });
                return result;
            }
        } else if  (m === "draw") {
            // Check for claim draw.
            if (this.countdown < 50 && this.stateCount(new Map<string, any>([["board", this.board], ["currplayer", this.currplayer]])) <= 3) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.camelot.CANNOT_CLAIM_DRAW");
                return result;
            }
        } else {
            const split = m.split(/-|\^|x/);
            const moveTypes: ("-" | "x" | "^")[] = m.match(/-|\^|x/g) as ("-" | "x" | "^")[];
            // Valid cell
            let currentMove;
            try {
                for (const p of split) {
                    currentMove = p;
                    const [x, y] = this.algebraic2coords(p);
                    // `algebraic2coords` does not check if the cell is on the board.
                    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
                        throw new Error("Invalid cell");
                    }
                }
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: currentMove });
                return result;
            }
            const from = split[0];
            // The first piece selected exists.
            if (!this.board.has(from)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NONEXISTENT", { where: from });
                return result;
            }
            // The first piece selected is owned by the current player.
            if (this.board.get(from)![0] !== this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.UNCONTROLLED", { where: from });
                return result;
            }
            // Check if it's a castle move and if the player has already made castle moves twice.
            if (this.castleCells[this.currplayer % 1].includes(from) && this.castleMoveCounts[this.currplayer - 1] >= 2) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.camelot.CASTLE_LIMIT");
                return result;
            }
            // For jump check, we remove the cell that is being moved from.
            const allRemoved = [from];
            const pieces = [...this.board].filter(([, v]) => v[0] === this.currplayer).map(([k, ]) => k);
            // If a player has pieces in their own castle, they must move it now.
            const inOwnCastle = this.inOwnCastlePieces(this.currplayer, pieces);
            if (inOwnCastle.length > 0 && !inOwnCastle.includes(from)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.camelot.IN_CASTLE", { where: inOwnCastle.join(", ") });
                return result;
            }
            const jumpPieces = this.jumpPieces(this.currplayer, pieces);
            const mustJump = jumpPieces.length > 0;
            // Get all moves.
            // If the piece is not in the castle, then we just get all moves depending on whether there is a forced jump.
            // Otherwise, we only force the piece to jump if that piece in the castle has a mandatory jump.
            const allMoves = inOwnCastle.length === 0 ? this.getAllMoves(from, mustJump) : jumpPieces.includes(from) ? this.getAllMoves(from, true) : this.getAllMoves(from, false);
            // Check if the piece selected has any moves.
            if (allMoves.length === 0) {
                if (mustJump) {
                    // Special message if a piece has moves but cannot jump.
                    if (this.getAllMoves(from, false).length > 0) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.camelot.MUST_JUMP");
                        return result;
                    }
                }
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NO_MOVES", { where: from });
                return result;
            }
            const [, piece] = this.board.get(from)!;
            let hasPlained = false;
            let hasJumped = false;
            if (split.length > 1) {
                for (const [i, move] of split.entries()) {
                    if (i === 0) { continue; }
                    const prev = split[i - 1];
                    // Check if a move is a jump.
                    const jumpsMap = this.getJumps(prev, allRemoved, this.currplayer);
                    if (jumpsMap.size > 0 && (i === 1 || (piece === 2 || piece === 1 && hasJumped))) {
                        if (!jumpsMap.has(move)) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.camelot.MUST_JUMP_SELECTED", { where: prev });
                            return result;
                        } else if (moveTypes[i - 1] !== "x") {
                            // Check that the move is correctly represented by the notation.
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.camelot.JUMP_NOTATION", { from: prev, to: move });
                            return result;
                        }
                        allRemoved.push(jumpsMap.get(move)!);
                        hasJumped = true;
                    } else {
                        // Check if a move is a plain move.
                        const plain = this.getPlain(prev, this.currplayer);
                        if (plain.includes(move)) {
                            if (moveTypes[i - 1] !== "-") {
                                // Check that the move is correctly represented by the notation.
                                result.valid = false;
                                result.message = i18next.t("apgames:validation.camelot.PLAIN_NOTATION", { from: prev, to: move });
                                return result;
                            }
                            hasPlained = true;
                        } else {
                            // Check if a move is a canter.
                            const canters = this.getCanters(prev, split.slice(0, i), this.currplayer);
                            if (canters.includes(move)) {
                                if (moveTypes[i - 1] !== "^") {
                                    // Check that the move is correctly represented by the notation.
                                    result.valid = false;
                                    result.message = i18next.t("apgames:validation.camelot.CANTER_NOTATION", { from: prev, to: move });
                                    return result;
                                }
                            } else {
                                // If we reach this point, the move is neither a jump, a plain move, nor a canter.
                                result.valid = false;
                                result.message = i18next.t("apgames:validation.camelot.INVALID_TO", { from: prev, to: move });
                                return result;
                            }
                        }
                    }
                }
            }
            // A single selected piece.
            if (split.length === 1) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation._general.NEED_DESTINATION");
                return result;
            }
            // If a piece has a jump move, it must take it.
            if (!hasPlained && (piece === 2 || hasJumped)) {
                const jumpsMap = this.getJumps(split[split.length - 1], allRemoved, this.currplayer);
                if (jumpsMap.size > 0) {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.camelot.NEED_TO_JUMP");
                    return result;
                }
            }
            // If there is a forced jump, the sequence must eventually include a jump.
            if (mustJump) {
                let availableMoves = allMoves.map(x => x.split(/-|\^|x/));
                for (let i = 0; i < split.length; i++) {
                    availableMoves = availableMoves.filter(x => x[i] === split[i]);
                }
                if (availableMoves.length === 0) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.camelot.MUST_EVENTUALLY_JUMP");
                    return result;
                }
            }
            // If a piece does not have a jump move and it has canters, it may canter.
            if (!hasJumped && !hasPlained) {
                const canters = this.getCanters(split[split.length - 1], split, this.currplayer);
                if (canters.length > 0) {
                    if (mustJump) {
                        result.valid = true;
                        result.complete = -1;
                        result.canrender = true;
                        result.message = i18next.t("apgames:validation.camelot.MUST_CONTINUE_CANTER");
                        return result;
                    }
                    result.valid = true;
                    result.complete = 0;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.camelot.CAN_CANTER");
                    return result;
                }
            }
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private getPlain(from: string, player: playerid): string[] {
        // Get all plain moves.
        if (this.castleCells[player % 2].includes(from)) {
            // Castle moves are considered plain moves in this implementation.
            if (this.castleMoveCounts[player - 1] >= 2) { return []; }
            const otherCastle = this.castleCells[player % 2].find(c => c !== from);
            if (otherCastle === undefined) { return []; }
            if (this.board.has(otherCastle)) { return []; }
            return [otherCastle];
        }
        const tos: string[] = [];
        const neighbours = this.grid.adjacencies(...this.algebraic2coords(from)).map(c => this.coords2algebraic(...c));
        for (const to of neighbours) {
            if (this.board.has(to)) { continue; }
            if (this.castleCells[player - 1].includes(to)) { continue; }
            if (this.blockedCells.includes(to)) { continue; }
            if (this.riverCells.includes(to)) { continue; }
            if (this.trees.includes(to)) { continue; }
            tos.push(to);
        }
        return tos;
    }

    private getCanters(from: string, exclude: string[], player: playerid): string[] {
        // Get all canters.
        if (this.castleCells[player % 2].includes(from)) { return []; }
        const tos: string[] = [];
        const coordsFrom = this.algebraic2coords(from);
        for (const dir of allDirections) {
            const ray = this.grid.ray(...coordsFrom, dir).map(c => this.coords2algebraic(...c));
            if (ray.length < 2) { continue; }
            if (exclude.includes(ray[1])) { continue; }
            if (!this.board.has(ray[0])) { continue; }
            if (this.board.has(ray[1])) { continue; }
            if (this.blockedCells.includes(ray[1])) { continue; }
            if (this.riverCells.includes(ray[1])) { continue; }
            if (this.trees.includes(ray[1])) { continue; }
            if (this.board.get(ray[0])![0] !== player) { continue; }
            if (this.castleCells[player - 1].includes(ray[1])) { continue; }
            tos.push(ray[1]);
        }
        return tos;
    }

    private getJumps(from: string, removed: string[], player: playerid): Map<string, string> {
        // Get all jumps that capture.
        // Return a map of to with the corresponding captured cell.
        const toCaptures: Map<string, string> = new Map();
        if (this.castleCells[player % 2].includes(from)) { return toCaptures; }
        const coordsFrom = this.algebraic2coords(from);
        for (const dir of allDirections) {
            const ray = this.grid.ray(...coordsFrom, dir).map(c => this.coords2algebraic(...c));
            if (ray.length < 2) { continue; }
            if (removed.includes(ray[0])) { continue; }
            if (!this.board.has(ray[0])) { continue; }
            if (this.board.has(ray[1]) && !removed.includes(ray[1])) { continue; }
            if (this.blockedCells.includes(ray[1])) { continue; }
            if (this.riverCells.includes(ray[1])) { continue; }
            if (this.trees.includes(ray[1])) { continue; }
            if (this.board.get(ray[0])![0] === player) { continue; }
            toCaptures.set(ray[1], ray[0]);
        }
        return toCaptures;
    }

    public move(m: string, { partial = false, trusted = false } = {}): CamelotGame {
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
            if (!partial && !this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", { move: m }));
            }
        }
        if (m.length === 0) { return this; }
        this.dots = [];
        this.results = [];
        if (this.isTreePlacingPhase()) {
            const split = m.split(",");
            for (const cell of split) {
                this.trees.push(cell);
            }
            this.results.push({ type: "place", where: m, what: "tree"});
        } else if (m === "draw") {
            // Player has claimed a draw. We record the reason.
            if (this.countdown < 50) {
                this.results.push({ type: "claim", what: "draw", how: "repetition" });
            } else {
                this.results.push({ type: "claim", what: "draw", how: "progression" });
            }
        } else {
            const split = m.split(/-|\^|x/);
            const from = split[0];
            if (partial) {
                // Draw dots to indicate possible moves.
                const mustJump = this.jumpPieces(this.currplayer).length > 0;
                const moves = this.getAllMoves(from, mustJump).map(x => x.split(/-|\^|x/));
                let availableMoves = moves;
                for (let i = 0; i < split.length; i++) {
                    availableMoves = availableMoves.filter(x => x[i] === split[i]);
                }
                availableMoves = availableMoves.filter(x => x.length > split.length);
                this.dots.push(...availableMoves.map(x => x[split.length]));
            }
            // We determine move type based on the separator.
            const moveTypes: ("-" | "x" | "^")[] = m.match(/-|\^|x/g) as ("-" | "x" | "^")[];
            const [, piece] = this.board.get(from)!;
            const pieceStr = piece === 1 ? "man" : "knight";
            if (split.length > 1) {
                for (const [i, move] of split.entries()) {
                    if (i === 0) { continue; }
                    const prev = split[i - 1];
                    if (moveTypes[i - 1] === "-") {
                        // For plain moves.
                        this.board.delete(prev);
                        this.board.set(move, [this.currplayer, piece]);
                        if (this.castleCells[this.currplayer % 2].includes(from) && this.castleCells[this.currplayer % 2].includes(move)) {
                            // For castle moves, we record it separately.
                            this.castleMoveCounts[this.currplayer - 1]++;
                            this.results.push({ type: "move", from: prev, to: move, how: "castle", what: pieceStr });
                            this.results.push({ type: "use", what: "castle-move", remaining: this.castleMoveCounts[this.currplayer - 1] });
                        } else {
                            this.results.push({ type: "move", from: prev, to: move, how: "plain", what: pieceStr });
                        }
                    } else if (moveTypes[i - 1] === "^") {
                        // For canters.
                        this.board.delete(prev);
                        this.board.set(move, [this.currplayer, piece]);
                        this.results.push({ type: "move", from: prev, to: move, how: "canter", what: pieceStr });
                    } else if (moveTypes[i - 1] === "x") {
                        // For jumps.
                        const jumpsMap = this.getJumps(prev, [], this.currplayer);
                        this.board.delete(prev);
                        this.board.delete(jumpsMap.get(move)!);
                        this.board.set(move, [this.currplayer, piece]);
                        this.results.push({ type: "move", from: prev, to: move, how: "jump", what: pieceStr, by: jumpsMap.get(move) });
                        this.results.push({ type: "capture", where: jumpsMap.get(move) });
                    }
                }
            }
            const last = split[split.length - 1];
            // Manage countdown
            if (!this.castleCells[this.currplayer % 2].includes(from) && this.castleCells[this.currplayer % 2].includes(last) || this.results.find(r => r.type === "capture") !== undefined) {
                this.countdown = 0;
            } else {
                this.countdown++;
            }
        }
        if (partial) { return this; }
        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    private materialEnd(): boolean {
        // Check that both players have at most only one piece left.
        const pieces1 = [...this.board].filter(([, v]) => v[0] === 1).map(([k, ]) => k);
        if (pieces1.length > 1) { return false; }
        const pieces2 = [...this.board].filter(([, v]) => v[0] === 2).map(([k, ]) => k);
        if (pieces2.length > 1) { return false; }
        return true;
    }

    protected checkEOG(): CamelotGame {
        const otherPlayer = this.currplayer % 2 + 1 as playerid;
        if (this.lastmove === "draw") {
            // Player claimed a draw.
            this.gameover = true;
            this.winner = [1, 2];
            const move = this.results.find(r => r.type === "claim") as Extract<APMoveResult, { type: "claim" }>;
            if (move.how === "repetition") {
                this.results.push({ type: "eog", reason: "claim-draw-repetition" });
            } else {
                this.results.push({ type: "eog", reason: "claim-draw-progression" });
            }
        } else if (this.variants.includes("anti")) {
            // For anti variant, the goals are reversed.
            if (this.castleCells[this.currplayer - 1].some(c => this.board.has(c) && this.board.get(c)![0] === otherPlayer)) {
                // Player has moved one piece into the opponent's castle.
                this.gameover = true;
                this.winner = [this.currplayer];
                this.results.push({ type: "eog", reason: "breakthrough" });
            } else if (!this.hasMoves(this.currplayer)) {
                // Player has run out of moves.
                this.gameover = true;
                this.winner = [this.currplayer];
                this.results.push({ type: "eog", reason: "stalemate" });
            }
        } else {
            if (this.castleCells[this.currplayer - 1].every(c => this.board.has(c) && this.board.get(c)![0] === otherPlayer)) {
                // Player has both pieces in the opponent's castle.
                this.gameover = true;
                this.winner = [otherPlayer];
                this.results.push({ type: "eog", reason: "breakthrough" });
            } else if (this.castleCells[0].length === 2 && this.materialEnd()) {
                // Each player has one piece remaining so they cannot capture both castle cells.
                this.gameover = true;
                this.winner = [1, 2];
                this.results.push({ type: "eog", reason: "material" });
            } else if (!this.hasMoves(this.currplayer)) {
                // Player has run out of moves.
                this.gameover = true;
                this.winner = [otherPlayer];
                this.results.push({ type: "eog", reason: "stalemate" });
            }
        }
        if (this.gameover) {
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public state(): ICamelotState {
        return {
            game: CamelotGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: CamelotGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: [...this.board].reduce((m, [k, v]) => m.set(k, [v[0], v[1]]), new Map<string, CellContents>()),
            castleMoveCounts: [this.castleMoveCounts[0], this.castleMoveCounts[1]],
            trees: [...this.trees],
            countdown: this.countdown,
        };
    }

    private getTreeHighlightIndex(): number | undefined {
        // The typical `isNewResult` didn't seem to work for some reason so this is a specific implementation.
        if (this.stack.length === 1) { return 0; }
        const place = this.results.find(x => x.type === "place") as Extract<APMoveResult, { type: 'place' }> | undefined;
        if (place === undefined) { return undefined; }
        if (this.stack.length === 2) {
            return this.lastmove!.split(",").length < 3 ? 0 : 1;
        }
        if (this.lastmove!.split(",").length < 3) { return 1; }
        return undefined;
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < this.height; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            for (let col = 0; col < this.width; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const [player, piece] = this.board.get(cell)!;
                    if (player === 1) {
                        if (piece === 1) {
                            pstr += "A";
                        } else if (piece === 2) {
                            pstr += "C";
                        }
                    } else if (player === 2) {
                        if (piece === 1) {
                            pstr += "B";
                        } else if (piece === 2) {
                            pstr += "D";
                        }
                    }
                } else if (this.trees.includes(cell)) {
                    pstr += "T";
                } else {
                    pstr += "-";
                }
            }
        }
        pstr = pstr.replace(new RegExp(`-{${this.width}}`, "g"), "_");

        const blocked: RowCol[] = [];
        for (const cell of this.blockedCells) {
            const [x, y] = this.algebraic2coords(cell);
            blocked.push({ row: y, col: x });
        }

        const markers: MarkerFlood[] = [];
        // Mark castles.
        const castle1: RowCol[] = [];
        for (const cell of this.castleCells[0]) {
            const [x, y] = this.algebraic2coords(cell);
            castle1.push({ row: y, col: x });
        }
        markers.push({ type: "flood", points: castle1 as [RowCol, ...RowCol[]], colour: 1, opacity: 0.2 });
        const castle2: RowCol[] = [];
        for (const cell of this.castleCells[1]) {
            const [x, y] = this.algebraic2coords(cell);
            castle2.push({ row: y, col: x });
        }
        markers.push({ type: "flood", points: castle2 as [RowCol, ...RowCol[]], colour: 2, opacity: 0.2 });
        // Mark rivers
        if (this.riverCells.length > 0) {
            const river: RowCol[] = [];
            for (const cell of this.riverCells) {
                const [x, y] = this.algebraic2coords(cell);
                river.push({ row: y, col: x });
            }
            markers.push({ type: "flood", points: river as [RowCol, ...RowCol[]], colour: "#44bbff", opacity: 0.8 });
        }
        // Mark bridges
        if (this.bridgeCells.length > 0) {
            const bridge: RowCol[] = [];
            for (const cell of this.bridgeCells) {
                const [x, y] = this.algebraic2coords(cell);
                bridge.push({ row: y, col: x });
            }
            markers.push({ type: "flood", points: bridge as [RowCol, ...RowCol[]], colour: "#765341", opacity: 0.8 });
        }
        // Mark tree placeable
        if (this.stack.length < 4 && this.variants.includes("river")) {
            let highlightCells: string[] = [];
            const treeHighlightIndex = this.getTreeHighlightIndex();
            if (treeHighlightIndex !== undefined) {
                highlightCells = this.treePlaceableCells[treeHighlightIndex];
            }
            if (highlightCells.length > 0) {
                const highlight: RowCol[] = [];
                for (const cell of highlightCells) {
                    if (this.trees.includes(cell)) { continue; }
                    const [x, y] = this.algebraic2coords(cell);
                    highlight.push({ row: y, col: x });
                }
                markers.push({ type: "flood", points: highlight as [RowCol, ...RowCol[]], colour: "#FF0", opacity: 0.2 });
            }
        }

        if (this.variants.includes("anti")) {
            // Add flood markers on all empty non-special cells.
            const tint: RowCol[] = [];
            for (let row = 0; row < this.height; row++) {
                for (let col = 0; col < this.width; col++) {
                    const cell = this.coords2algebraic(col, row);
                    if (this.castleCells[0].includes(cell)) { continue; }
                    if (this.castleCells[1].includes(cell)) { continue; }
                    if (this.blockedCells.includes(cell)) { continue; }
                    if (this.riverCells.includes(cell)) { continue; }
                    if (this.bridgeCells.includes(cell)) { continue; }
                    const [x, y] = this.algebraic2coords(cell);
                    tint.push({ row: y, col: x });
                }
            }
            markers.push({ type: "flood", colour: "#FFA500", opacity: 0.1, points: tint as [RowCol, ...RowCol[]] });
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares",
                width: this.width,
                height: this.height,
                blocked: blocked as [RowCol, ...RowCol[]],
                markers,
            },
            legend: {
                A: [{ name: "piece", colour: 1 }],
                B: [{ name: "piece", colour: 2 }],
                C: [{ name: "piece-horse", colour: 1 }],
                D: [{ name: "piece-horse", colour: 2 }],
                T: [{ name: "piece-triangle", colour: 3, orientation: "vertical" }],
            },
            pieces: pstr,
        };

        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") {
                    for (const where of move.where!.split(",")) {
                        const [x, y] = this.algebraic2coords(where);
                        rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                    }
                } else if (move.type === "capture") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({ type: "exit", targets: [{ row: y, col: x }] });
                } else if (move.type === "move") {
                    const [fromX, fromY] = this.algebraic2coords(move.from);
                    const [toX, toY] = this.algebraic2coords(move.to);
                    rep.annotations.push({ type: "move", targets: [{ row: fromY, col: fromX }, { row: toY, col: toX }] });
                }
            }
        }
        if (this.dots.length > 0) {
            const points = [];
            for (const cell of this.dots) {
                const [x, y] = this.algebraic2coords(cell);
                points.push({ row: y, col: x });
            }
            rep.annotations.push({ type: "dots", targets: points as [RowCol, ...RowCol[]] });
        }
        return rep;
    }

    public getPlayerPieces(player: number): number {
        return [...this.board.values()].filter(p => p[0] === player).length;
    }

    public getPlayersScores(): IScores[] {
        if (this.castleCells[0].length >= 2 && !this.variants.includes("anti")) {
            // For variants with more than one castle cell per player, we show the castle move counts.
            return [
                { name: i18next.t("apgames:status.PIECESREMAINING"), scores: [this.getPlayerPieces(1), this.getPlayerPieces(2)] },
                { name: i18next.t("apgames:status.camelot.CASTLE_MOVE_COUNTS"), scores: this.castleMoveCounts }
            ]
        }
        return [
            { name: i18next.t("apgames:status.PIECESREMAINING"), scores: [this.getPlayerPieces(1), this.getPlayerPieces(2)] },
        ];
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Pieces On Board:**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            status += `Player ${n}: ${this.getPlayerPieces(n)}\n\n`;
        }

        status += "**Castle Move Counts:**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            status += `Player ${n}: ${this.castleMoveCounts[n - 1]}\n\n`;
        }

        status += "**Countdown:** ";
        status += this.countdown;
        status += "\n\n";

        const stateCount = this.stateCount(new Map<string, any>([["board", this.board], ["currplayer", this.currplayer]]));

        status += "**State Count:** ";
        status += stateCount;
        status += "\n\n";

        status += "**Can Claim Draw:** ";
        status += this.countdown >= 50 || stateCount > 3 ? "Yes" : "No";
        status += "\n\n";

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.camelot_place", { player, where: r.where!.split(",").join(", ") }));
                resolved = true;
                break;
            case "capture":
                resolved = true;
                break;
            case "move":
                if (r.how === "castle") {
                    if (r.what === "knight") {
                        node.push(i18next.t("apresults:MOVE.camelot_castle_knight", { player, from: r.from, to: r.to }));
                    } else {
                        node.push(i18next.t("apresults:MOVE.camelot_castle", { player, from: r.from, to: r.to }));
                    }
                } else if (r.how === "plain") {
                    if (r.what === "knight") {
                        node.push(i18next.t("apresults:MOVE.camelot_plain_knight", { player, from: r.from, to: r.to }));
                    } else {
                        node.push(i18next.t("apresults:MOVE.camelot_plain", { player, from: r.from, to: r.to }));
                    }
                } else if (r.how === "canter") {
                    if (r.what === "knight") {
                        node.push(i18next.t("apresults:MOVE.camelot_canter_knight", { player, from: r.from, to: r.to }));
                    } else {
                        node.push(i18next.t("apresults:MOVE.camelot_canter", { player, from: r.from, to: r.to }));
                    }
                } else if (r.how === "jump") {
                    if (r.what === "knight") {
                        node.push(i18next.t("apresults:MOVE.camelot_jump_knight", { player, from: r.from, to: r.to, captured: r.by }));
                    } else {
                        node.push(i18next.t("apresults:MOVE.camelot_jump", { player, from: r.from, to: r.to, captured: r.by }));
                    }
                }
                resolved = true;
                break;
            case "use":
                if (r.remaining === 0) {
                    node.push(i18next.t("apresults:USE.camelot_castle_move_none", { player, count: r.remaining }));
                } else {
                    node.push(i18next.t("apresults:USE.camelot_castle_move", { player, count: r.remaining }));
                }
                resolved = true;
            case "claim":
                resolved = true;
                break;
            case "eog":
                if (r.reason === "claim-draw-repetition") {
                    node.push(i18next.t("apresults:EOG.camelot_claim_draw_repetition", { player }));
                } else if (r.reason === "claim-draw-progression") {
                    node.push(i18next.t("apresults:EOG.camelot_claim_draw_progression", { player }));
                } else if (r.reason === "stalemate") {
                    node.push(i18next.t("apresults:EOG.stalemate"));
                } else if (r.reason === "material") {
                    node.push(i18next.t("apresults:EOG.material"));
                } else if (r.reason === "breakthrough") {
                    node.push(i18next.t("apresults:EOG.default"));
                }
                resolved = true;
        }
        return resolved;
    }

    public clone(): CamelotGame {
        return new CamelotGame(this.serialize());
    }
}
