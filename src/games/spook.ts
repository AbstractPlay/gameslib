/* eslint-disable no-console */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, Glyph } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";

type playerid = 1 | 2 | 3;
// The move number after which spooky is placed for each board size.
const spookyMoveNumber = new Map([
    [4, 29],
    [5, 54],
    [6, 90],
])

interface ILooseObj {
    [key: string]: any;
}
interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    pieceCounts: [number, number];
    lastmove?: string;
}

export interface ISpookState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class SpookGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Spook",
        uid: "spook",
        playercounts: [2],
        version: "20240501",
        dateAdded: "2024-05-26",
        // i18next.t("apgames:descriptions.spook")
        description: "apgames:descriptions.spook",
        // i18next.t("apgames:notes.spook")
        notes: "apgames:notes.spook",
        urls: [
            "https://spielstein.com/games/spook",
            "https://boardgamegeek.com/boardgame/115077/spook",
        ],
        people: [
            {
                type: "designer",
                name: "Dieter Stein",
                urls: ["https://spielstein.com/"]
            }
        ],
        variants: [
            { uid: "size-5", group: "board" },
            { uid: "random", group: "setup" },
        ],
        categories: ["goal>evacuate", "mechanic>place", "mechanic>capture", "mechanic>random>setup", "board>shape>rect", "board>connect>rect", "components>simple>3c", "board>3d"],
        flags: ["scores", "rotate90", "random-start"],
        displays: [{ uid: "orb-3d" }],
    };

    public coords2algebraic(x: number, y: number, boardSize = this.boardSize): string {
        return GameBase.coords2algebraic(x, y, 2 * boardSize - 1);
    }

    public algebraic2coords(cell: string, boardSize = this.boardSize): [number, number] {
        // Remove all numbers from the beginning of the string.
        return GameBase.algebraic2coords(cell.replace(/^\d+/, ""), 2 * boardSize - 1);
    }

    private layerCoords2algebraic(col: number, row: number, layer: number, boardSize = this.boardSize): string {
        // Convert layer coordinates to algebraic.
        // This is the "intuitive" coordinates where sequence of col or row indices are adjacent.
        // Bottom layer is 0, top layer is boardSize - 1.
        // Origin is at the top left corner of the board as usual.
        if (layer >= boardSize) { throw new Error(`Layer index ${layer} is out of bounds for board size ${boardSize}`); }
        if (col < 0 || row < 0 || col > boardSize - layer || row > boardSize - layer) { throw new Error(`Coordinates (${col},${row}) are out of bounds for layer ${layer}`); }
        const l = layer + 1;
        const x = 2 * col + layer;
        const y = 2 * row + layer;
        return `${l}${this.coords2algebraic(x, y, boardSize)}`;
    }

    private algebraic2position(cell: string): [number, number] {
        // Convert algebraic coordinates to position on the board for annotations.
        const [x, y, l] = this.algebraic2coords2(cell);
        let row = (y - l) / 2;
        for (let i = 0; i < l; i++) {
            row += this.boardSize - i;
        }
        return [(x - l) / 2, row];
    }

    private coords2algebraic2(x: number, y: number, layer: number): string {
        // The same as coords2algebraic, but with concatenated layer index.
        return `${layer + 1}${this.coords2algebraic(x, y)}`;
    }

    private algebraic2coords2(cell: string): [number, number, number] {
        // The same as algebraic2coords, but also return the layer.
        const [l, coords] = cell.split(/(?<=^\d)/);
        const layer = parseInt(l, 10) - 1;
        const [x, y] = this.algebraic2coords(coords);
        return [x, y, layer];
    }

    private placeableCell(i: number, j: number): string | undefined {
        // Get the highest supported layer for a cell.
        // If that cell is not placeable, return undefined.
        if (i % 2 !== j % 2) { return undefined; }
        let layer = i % 2 ? 1 : 0;
        while (layer < this.boardSize) {
            const cell = `${layer + 1}${this.coords2algebraic(i, j)}`
            if (this.board.has(cell)) {
                layer += 2;
                continue;
            }
            if (layer > 0) {
                if (i < layer || j < layer || i >= 2 * this.boardSize - layer || j >= 2 * this.boardSize - layer) { return undefined; }
                // Check the four cells below the currentone.
                if (!this.board.has(this.coords2algebraic2(i - 1, j - 1, layer - 1))) { return undefined; }
                if (!this.board.has(this.coords2algebraic2(i - 1, j + 1, layer - 1))) { return undefined; }
                if (!this.board.has(this.coords2algebraic2(i + 1, j - 1, layer - 1))) { return undefined; }
                if (!this.board.has(this.coords2algebraic2(i + 1, j + 1, layer - 1))) { return undefined; }
            }
            return cell;
        }
        return undefined;
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, playerid>;
    public pieceCounts: [number, number] = [999, 999];
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private boardSize = 0;
    private hideLayer: number|undefined;

    constructor(state?: ISpookState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            this.boardSize = this.getBoardSize();
            const board = this.initBoard();
            const pieceCounts = this.initPieceCounts()
            const fresh: IMoveState = {
                _version: SpookGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                pieceCounts,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ISpookState;
            }
            if (state.game !== SpookGame.gameinfo.uid) {
                throw new Error(`The Spook process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
            this.boardSize = this.getBoardSize();
        }
        this.load();
    }

    public load(idx = -1): SpookGame {
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
        this.pieceCounts = [...state.pieceCounts];
        this.lastmove = state.lastmove;
        return this;
    }

    private fairnessHeuristic(board: Map<string, playerid>): boolean {
        // Some heuristics to make the random start interesting.
        // Check that at the top row, there are balls of both colours.
        const topPlayer = board.get(this.layerCoords2algebraic(0, 0, this.boardSize - 2));
        if (topPlayer === board.get(this.layerCoords2algebraic(1, 0, this.boardSize - 2)) &&
            topPlayer === board.get(this.layerCoords2algebraic(0, 1, this.boardSize - 2)) &&
            topPlayer === board.get(this.layerCoords2algebraic(1, 1, this.boardSize - 2))) {
            return false;
        }

        // Check if there is a equal number of balls in pyramids of a single colour at the bottom layer.
        const player1: Set<string> = new Set();
        const player2: Set<string> = new Set();
        for (let x = 0; x < this.boardSize - 1; x++) {
            for (let y = 0; y < this.boardSize - 1; y++) {
                const nw = this.layerCoords2algebraic(x, y, 0);
                const player = board.get(nw);
                const ne = this.layerCoords2algebraic(x + 1, y, 0);
                if (player !== board.get(ne)) { continue; }
                const sw = this.layerCoords2algebraic(x, y + 1, 0);
                if (player !== board.get(sw)) { continue; }
                const se = this.layerCoords2algebraic(x + 1, y + 1, 0);
                if (player !== board.get(se)) { continue; }
                const top = this.layerCoords2algebraic(x, y, 1);
                if (player !== board.get(top)) { continue; }
                if (player === 1) {
                    [nw, ne, sw, se, top].forEach(cell => player1.add(cell));
                } else {
                    [nw, ne, sw, se, top].forEach(cell => player2.add(cell));
                }
            }
        }
        if (player1.size !== player2.size) { return false; }
        return true;
    }

    private initBoard(): Map<string, playerid> {
        // Get the initial board.
        if (this.variants.includes("random")) {
            let board: Map<string, playerid>;
            do {
                const allSpaces: string[] = [];
                for (let l = 0; l < this.boardSize - 1; l++) {
                    for (let x = 0; x < this.boardSize - l; x++) {
                        for (let y = 0; y < this.boardSize - l; y++) {
                            allSpaces.push(this.layerCoords2algebraic(x, y, l));
                        }
                    }
                }
                // These spaces should be assigned randomly to players without repeat.
                // We first assign to player 1, then player 2, then player 1, etc.
                board = new Map<string, playerid>();
                let player = 1;
                while (allSpaces.length > 0) {
                    const idx = Math.floor(Math.random() * allSpaces.length);
                    board.set(allSpaces[idx], player as playerid);
                    allSpaces.splice(idx, 1);
                    player = player % 2 + 1 as playerid;
                }
            } while (!this.fairnessHeuristic(board));
            board.set(this.layerCoords2algebraic(0, 0, this.boardSize - 1), 3)
            return board;
        }
        return new Map();
    }

    private initPieceCounts(): [number, number] {
        // Get the initial piece counts for each player.
        if (this.variants.includes("random")) {
            return [Math.ceil(spookyMoveNumber.get(this.boardSize)! / 2), Math.floor(spookyMoveNumber.get(this.boardSize)! / 2)];
        } else {
            return [0, 0];
        }
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
        return 4;
    }

    private parityPass(): boolean {
        // Check if the game should pass to the next player because of parity when starting the getaway phase.
        if (this.variants.includes("random")) { return false; }
        const moveNumber = spookyMoveNumber.get(this.boardSize)!;
        if (moveNumber % 2 === 0) { return false; }
        return this.stack.length === moveNumber + 1;
    }

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }
        const moves: string[] = [];
        if (!this.spookyPresent()) {
            for (let i = 0; i < 2 * this.boardSize - 1; i++) {
                for (let j = 0; j < 2 * this.boardSize - 1; j++) {
                    const cell = this.placeableCell(i, j);
                    if (cell !== undefined) {
                        moves.push(cell);
                    }
                }
            }
        } else if (this.parityPass()) {
            moves.push("pass");
        } else if (this.spookyIsolated()) {
            for (let i = 0; i < 2 * this.boardSize - 1; i++) {
                for (let j = 0; j < 2 * this.boardSize - 1; j++) {
                    const cell = this.placeableCell(i, j);
                    if (cell !== undefined) {
                        if (!this.hasAdjacent(cell)) { continue; }
                        moves.push(`m${cell}`);
                    }
                }
            }
        } else if (this.noCaptures()) {
            const notPinned = this.notPinned(player % 2 + 1 as playerid);
            for (const cell of notPinned) {
                moves.push(`r${cell}`);
            }
            if (moves.length === 0) {
                moves.push("pass");
            }
        } else {
            const captures = this.getCaptures();
            for (const capture of captures) {
                moves.push(`c${capture.join("-")}`);
            }
        }
        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    private getTopMostCell(x: number, y: number): string | undefined {
        // Get the top-most ball at a coordinate.
        // If there is no ball at that coordinate, return undefined.
        if (x % 2 !== y % 2) { return undefined; }
        let layer = x % 2 ? 1 : 0;
        let cell = this.coords2algebraic2(x, y, layer);
        while (layer < this.boardSize) {
            if (x < layer || y < layer || x >= 2 * this.boardSize - layer || y >= 2 * this.boardSize - layer) { return undefined; }
            layer += 2;
            const nextCell = this.coords2algebraic2(x, y, layer);
            if (this.board.has(nextCell)) {
                cell = nextCell;
                continue;
            }
            return cell;
        }
        return undefined;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = "";
            if (row === -1 && col === -1) {
                if (piece === undefined) {
                    throw new Error(`A click was registered off the board, but no 'piece' parameter was passed.`);
                }
                if (! piece.startsWith("scroll_newval_")) {
                    throw new Error(`An invalid scroll bar value was returned: ${piece}`);
                }
                // calculate maximum layer (0 indexed)
                const maxLayer = Math.max(0, ...[...this.board.keys()].map(cell => this.algebraic2coords2(cell)).map(([,,l]) => l));
                const [,,nstr] = piece.split("_");
                const n = parseInt(nstr, 10);
                if (isNaN(n)) {
                    throw new Error(`Could not parse '${nstr}' into an integer.`);
                }
                if (n > maxLayer) {
                    this.hideLayer = undefined;
                } else if (n < 1) {
                    this.hideLayer = 1;
                } else {
                    this.hideLayer = n;
                }
            } else {
                if (!this.spookyPresent()) {
                    const placeableCell = this.placeableCell(col, row);
                    if (placeableCell === undefined) {
                        return {
                            move,
                            valid: false,
                            message: i18next.t("apgames:validation.spook.CANNOT_PLACE", { where: this.coords2algebraic(col, row) })
                        };
                    }
                    newmove = placeableCell;
                } else if (this.spookyIsolated()) {
                    const placeableCell = this.placeableCell(col, row);
                    if (placeableCell === undefined) {
                        return {
                            move,
                            valid: false,
                            message: i18next.t("apgames:validation.spook.CANNOT_PLACE", { where: this.coords2algebraic(col, row) })
                        };
                    }
                    newmove = `m${placeableCell}`;
                } else {
                    const topMostCell = this.getTopMostCell(col, row);
                    if (topMostCell === undefined) {
                        return {
                            move,
                            valid: false,
                            message: i18next.t("apgames:validation.spook.NO_BALL", { where: this.coords2algebraic(col, row) })
                        };
                    }
                    const prefix = this.noCaptures() ? "r" : "c";
                    if (move === "") {
                        newmove = `${prefix}${topMostCell}`;
                    } else {
                        newmove = `${move}-${topMostCell}`;
                    }

                }
            }
            const result = this.validateMove(newmove) as IClickResult;
            if (!result.valid) {
                result.move = move;
            } else {
                result.move = newmove;
            }
            result.opts = {hideLayer: this.hideLayer};
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", { move, row, col, piece, emessage: (e as Error).message })
            }
        }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        if (m.length === 0) {
            let message;
            if (!this.spookyPresent()) {
                message = i18next.t("apgames:validation.spook.INITIAL_INSTRUCTIONS_PLACEMENT");
            } else if (this.parityPass()) {
                message = i18next.t("apgames:validation.spook.INITIAL_INSTRUCTIONS_PARITY_PASS");
            } else if (this.noCaptures()) {
                if (this.spookyIsolated()) {
                    message = i18next.t("apgames:validation.spook.INITIAL_INSTRUCTIONS_ISOLATED");
                } else if (this.notPinned(this.currplayer % 2 + 1 as playerid).length === 0) {
                    message = i18next.t("apgames:validation.spook.INITIAL_INSTRUCTIONS_PASS");
                } else {
                    message = i18next.t("apgames:validation.spook.INITIAL_INSTRUCTIONS_REMOVE");
                }
            } else {
                message = i18next.t("apgames:validation.spook.INITIAL_INSTRUCTIONS_CAPTURE");
            }
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = message;
            return result;
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const prefix = m.startsWith("c") ? "c" : m.startsWith("m") ? "m" : m.startsWith("r") ? "r" : "";
        m = m.replace(/^[cmr]/, "");
        if (this.parityPass()) {
            if (m === "pass") {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
            result.valid = false;
            result.message = i18next.t("apgames:validation.spook.INITIAL_INSTRUCTIONS_PARITY_PASS");
            return result;
        }
        if (m === "pass") {
            if (this.spookyPresent() && this.noCaptures() && !this.spookyIsolated() && this.notPinned(this.currplayer % 2 + 1 as playerid).length === 0) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
            result.valid = false;
            result.message = i18next.t("apgames:validation.spook.INVALID_PASS");
            return result;
        }
        const moves = m.split("-");
        // Valid cell
        let currentMove;
        try {
            for (const p of moves) {
                currentMove = p;
                const [x, y] = this.algebraic2coords(p);
                // `algebraic2coords` does not check if the cell is on the board.
                if (x < 0 || x >= 2 * this.boardSize - 1 || y < 0 || y >= 2 * this.boardSize - 1) {
                    throw new Error("Invalid cell");
                }
            }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: currentMove });
            return result;
        }
        if (!this.spookyPresent()) {
            if (moves.length > 1) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.spook.SINGLE_MOVE_PLACE");
                return result;
            }
            if (this.board.has(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", { where: m });
                return result;
            }
            const [x, y] = this.algebraic2coords(m);
            if (this.placeableCell(x, y) === undefined) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.spook.CANNOT_PLACE", { where: m });
                return result;
            }
            if (prefix !== "") {
                result.valid = false;
                result.message = i18next.t("apgames:validation.spook.WRONG_PREFIX_PLACE", { prefix });
                return result;
            }
        } else {
            const spooky = this.spookyPos();
            if (this.noCaptures(spooky)) {
                if (this.spookyIsolated(spooky)) {
                    if (moves.length > 1) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.spook.SINGLE_MOVE_MOVE");
                        return result;
                    }
                    if (this.board.has(m)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.OCCUPIED", { where: m });
                        return result;
                    }
                    if (!this.hasAdjacent(m)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.spook.NO_ADJACENT", { where: m });
                        return result;
                    }
                    if (prefix !== "m") {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.spook.WRONG_PREFIX_MOVE");
                        return result;
                    }
                } else {
                    if (moves.length > 1) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.spook.SINGLE_MOVE_REMOVE");
                        return result;
                    }
                    if (!this.board.has(m)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.spook.NO_BALL", { where: m });
                        return result;
                    }
                    if (this.board.get(m) !== this.currplayer % 2 + 1) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.spook.REMOVE_WRONG_PLAYER", { where: m });
                        return result;
                    }
                    if (this.ballsAboveCount(m) > 1) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.spook.PINNED", { where: m });
                        return result;
                    }
                    if (prefix !== "r") {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.spook.WRONG_PREFIX_REMOVE");
                        return result;
                    }
                }
            } else if (this.underSpooky(moves[0], spooky)) {
                if (moves.length > 1) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.spook.SINGLE_MOVE_DROP");
                    return result;
                }
                if (this.ballsAboveCount(m) > 1) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.spook.PINNED", { where: m });
                    return result;
                }
                if (prefix !== "c") {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.spook.WRONG_PREFIX_CAPTURE");
                    return result;
                }
            } else {
                const captured: string[] = [];
                const capturedPlayer = this.board.get(moves[0]);
                let nexts: string[] = this.getNext(spooky);
                let from = spooky;
                for (const move of moves) {
                    if (!this.adjacents(from).includes(move)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.spook.NOT_ADJACENT", { where: move });
                        return result;
                    }
                    if (this.ballsAboveCount(move) > 0) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.spook.NOT_FREE", { where: move });
                        return result;
                    }
                    if (this.board.get(move) !== capturedPlayer) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.spook.CHAIN_WRONG_PLAYER", { where: move });
                        return result;
                    }
                    if (!nexts.includes(move)) {
                        // Fallback
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.spook.NOT_CAPTURABLE", { from, to: move });
                        return result;
                    }
                    captured.push(move);
                    nexts = this.getNext(move, captured, capturedPlayer);
                    from = captured[captured.length - 1]
                }
                if (prefix !== "c") {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.spook.WRONG_PREFIX_CAPTURE");
                    return result;
                }
                if (nexts.length > 0) {
                    result.valid = true;
                    result.complete = 0;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.spook.CONTINUE");
                    return result;
                }
            }
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private spookyPresent(): boolean {
        // Begin spooky phase?
        if (this.variants.includes("random")) {
            return true;
        }
        return this.stack.length > spookyMoveNumber.get(this.boardSize)!
    }

    private spookyIsolated(spooky?: string): boolean {
        // Check if spooky is isolated.
        spooky ??= this.spookyPos();
        const [, , l] = this.algebraic2coords2(spooky);
        if (l !== 0) { return false; }
        return this.adjacents(spooky).every(c => !this.board.has(c));
    }

    private noCaptures(spooky?: string): boolean {
        // Check if there are no captures possible.
        spooky ??= this.spookyPos();
        const [, , l] = this.algebraic2coords2(spooky);
        if (l !== 0) { return false; }
        return this.getNext(spooky).length === 0;
    }

    private hasAdjacent(cell: string): boolean {
        // If spooky is isolated, check if spooky can move to `cell`.
        const [, , l] = this.algebraic2coords2(cell);
        if (l !== 0) { return true; }
        return this.adjacents(cell).some(c => this.board.has(c));
    }

    private notPinned(player: playerid): string[] {
        // Look for all balls of `player` that are not pinned.
        const notPinned: string[] = [];
        const balls = [...this.board.keys()].filter(cell => this.board.get(cell) === player);
        for (const ball of balls) {
            if (this.ballsAboveCount(ball) <= 1) {
                notPinned.push(ball);
            }
        }
        return notPinned;
    }

    private ballsAboveCount(cell: string): number {
        // Count the number of balls that are directly above a cell.
        let count = 0;
        const [x, y, l] = this.algebraic2coords2(cell);
        if (x > l + 1) {
            if (y > l) { if (this.board.has(this.coords2algebraic2(x - 1, y - 1, l + 1))) { count++; } }
            if (y < 2 * this.boardSize - l - 2) { if (this.board.has(this.coords2algebraic2(x - 1, y + 1, l + 1))) { count++; } }
        }
        if (x < 2 * this.boardSize - l - 2) {
            if (y > l + 1) { if (this.board.has(this.coords2algebraic2(x + 1, y - 1, l + 1))) { count++; } }
            if (y < 2 * this.boardSize - l - 2) { if (this.board.has(this.coords2algebraic2(x + 1, y + 1, l + 1))) { count++; } }
        }
        return count;
    }

    private ballsBelow(cell: string): string[] {
        // Get the cells that are directly below a cell.
        const [x, y, l] = this.algebraic2coords2(cell);
        if (l === 0) { return []; }
        const below: string[] = [];
        if (x > l - 1) {
            if (y > l - 1) { below.push(this.coords2algebraic2(x - 1, y - 1, l - 1)); }
            if (y < 2 * this.boardSize - l) { below.push(this.coords2algebraic2(x - 1, y + 1, l - 1)); }
        }
        if (x < 2 * this.boardSize - l) {
            if (y > l - 1) { below.push(this.coords2algebraic2(x + 1, y - 1, l - 1)); }
            if (y < 2 * this.boardSize - l) { below.push(this.coords2algebraic2(x + 1, y + 1, l - 1)); }
        }
        return below;
    }

    private adjacents(cell: string): string[] {
        // Get the adjacent cells to a cell.
        const [x, y, l] = this.algebraic2coords2(cell);
        const adjacents: string[] = [];
        if (x > l + 1) { adjacents.push(this.coords2algebraic2(x - 2, y, l)); }
        if (x < 2 * this.boardSize - l - 2) { adjacents.push(this.coords2algebraic2(x + 2, y, l)); }
        if (y > l + 1) { adjacents.push(this.coords2algebraic2(x, y - 2, l)); }
        if (y < 2 * this.boardSize - l - 2) { adjacents.push(this.coords2algebraic2(x, y + 2, l)); }
        return adjacents;
    }

    private getNext(cell: string, captured: string[] = [], player?: playerid): string[] {
        // Check if there are adjacent cells to `cell` that have no balls above.
        // Do not count the cells in `captured`.
        player ??= captured.length === 0 ? undefined : this.board.get(captured[captured.length - 1]);
        return this.adjacents(cell).filter(c => this.board.has(c) && (player === undefined || this.board.get(c) === player) && !captured.includes(c) && this.ballsAboveCount(c) === 0);
    }

    private underSpooky(cell: string, spooky?: string): boolean {
        // Check if a cell is below spooky.
        const [x, y, l] = this.algebraic2coords2(cell);
        const spookyCell = spooky ?? this.spookyPos()
        if (spookyCell === undefined) { return false; }
        const [x1, y1, l1] = this.algebraic2coords2(spookyCell);
        if (l1 - l !== 1) { return false; }
        if (Math.abs(x - x1) === 1 && Math.abs(y - y1) === 1) { return true; }
        return false;
    }

    private spookyPos(previous = 0): string {
        // Get the position of spooky.
        // If `usePreviousBoard` is true, use the previous board instead of current board
        const board = previous === 0 ?this.board : this.stack[this.stack.length - previous].board;
        const spooky = [...board.keys()].find(cell => board.get(cell) === 3);
        if (spooky === undefined) { throw new Error("Cannot find Spooky."); }
        return spooky;
    }

    private getAllNext(cell: string, captured: string[] = [], player: playerid): string[][] {
        // Recursively get all cells that can be reached from `cell`.
        // This has to be initated in a weird way because of how `getNext` was written.
        // It's called in `getCaptures`.
        // There's probably a more elegant way to do this, but eh, it works.
        const newCaptured = [...captured, cell];
        const out: string[][] = [newCaptured];
        for (const next of this.getNext(cell, captured, player)) {
            out.push(...this.getAllNext(next, newCaptured, player));
        }
        return out;
    }

    private getCaptures(): string[][] {
        // Get all possible captures.
        const captures: string[][] = [];
        const spooky = this.spookyPos();
        for (const cell of this.ballsBelow(spooky)) {
            if (this.ballsAboveCount(cell) === 1) {
                captures.push([cell]);
            }
        }
        for (const lateral of this.getNext(spooky)) {
            const player = this.board.get(lateral)!;
            captures.push(...this.getAllNext(lateral, [], player));
        }
        return captures;
    }

    private dropBalls(from: string): string[] {
        // Upon movement, drop balls that are not supported.
        // Return the highest cell that was dropped if there was a drop.
        // Assumes that there is only one ball above the `from` cell.
        const [x, y, layer] = this.algebraic2coords2(from);
        const direction = this.board.has(this.coords2algebraic2(x - 1, y - 1, layer + 1))
            ? [-1, -1]
            : this.board.has(this.coords2algebraic2(x - 1, y + 1, layer + 1))
            ? [-1, 1]
            : this.board.has(this.coords2algebraic2(x + 1, y - 1, layer + 1))
            ? [1, -1]
            : this.board.has(this.coords2algebraic2(x + 1, y + 1, layer + 1))
            ? [1, 1]
            : undefined;
        if (direction === undefined) { return []; }
        let i = 1
        const drops: string[] = [];
        while (true) {
            const above = this.coords2algebraic2(x + i * direction[0], y + i * direction[1], layer + i);
            if (!this.board.has(above)) { break; }
            drops.push(above);
            i++;
        }
        return drops;
    }

    private getDropMap(from: string, player?: playerid): [string[], playerid[]] | undefined {
        // Return the information needed to perform the transformation of `board` for drops.
        const drops = this.dropBalls(from);
        if (drops.length === 0) { return undefined; }
        if (player === undefined) { player = this.currplayer; }
        const dropPlayers = drops.map(d => this.board.get(d)!);
        drops.unshift(from);
        dropPlayers.unshift(player);
        return [drops, dropPlayers];
    }

    private applyDrop(dropMap: [string[], playerid[]]): void {
        // Apply the drop transformation to the board.
        const [drops, dropPlayers] = dropMap;
        for (let i = 0; i < drops.length - 1; i++) {
            this.board.delete(drops[i + 1]);
            this.board.set(drops[i], dropPlayers[i + 1]);
        }
    }

    public move(m: string, {partial = false, trusted = false} = {}): SpookGame {
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
        this.results = [];
        if (m === "pass") {
            this.results.push({ type: "pass" });
        } else if (!this.spookyPresent()) {
            this.results.push({ type: "place", where: m });
            this.board.set(m, this.currplayer);
            this.pieceCounts[this.currplayer - 1]++;
            if (this.stack.length === spookyMoveNumber.get(this.boardSize)!) {
                const spooky = this.layerCoords2algebraic(0, 0, this.boardSize - 1);
                this.board.set(spooky, 3);
                this.results.push({ type: "place", where: spooky, what: "spooky" });
            }
        } else {
            const withoutPrefix = m.startsWith("c") || m.startsWith("r") || m.startsWith("m") ? m.slice(1) : m;
            if (this.spookyIsolated()) {
                const spooky = this.spookyPos();
                this.board.delete(spooky);
                this.board.set(withoutPrefix, 3);
                this.results.push({ type: "move", from: spooky, to: withoutPrefix });
            } else if (this.noCaptures()) {
                const dropMap = this.getDropMap(withoutPrefix, this.currplayer);
                if (dropMap !== undefined) {
                    this.applyDrop(dropMap);
                    const dropTopMost = dropMap[0][dropMap[0].length - 1];
                    this.results.push({ type: "remove", where: withoutPrefix, num: dropMap[0].length - 1, how: dropTopMost });
                } else {
                    this.board.delete(withoutPrefix);
                    this.results.push({ type: "remove", where: withoutPrefix, num: 0 });
                }
                this.pieceCounts[this.currplayer % 2]--;
            } else {
                const spooky = this.spookyPos();
                const split = withoutPrefix.split("-");
                if (this.underSpooky(split[0], spooky)) {
                    const what = this.board.get(withoutPrefix) === this.currplayer ? "self" : "opponent";
                    const whose = this.board.get(withoutPrefix)!;
                    this.results.push({ type: "capture", where: withoutPrefix, how: "drop", whose, what });
                    this.board.delete(spooky);
                    this.board.set(withoutPrefix, 3);
                    this.pieceCounts[whose - 1]--
                } else {
                    const what = this.board.get(split[0]) === this.currplayer ? "self" : "opponent";
                    const whose = this.board.get(split[0])!;
                    const captures: string[] = [];
                    this.board.delete(spooky);
                    for (const cell of split) {
                        captures.push(cell);
                        this.board.delete(cell);
                        this.pieceCounts[whose - 1]--;
                    }
                    this.board.set(split[split.length - 1], 3);
                    if (captures.length > 0) {
                        this.results.push({ type: "capture", where: captures.join(","), how: "lateral", count: captures.length, whose, what });
                    }
                }
            }
        }
        if (partial) { return this; }
        this.hideLayer = undefined;

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): SpookGame {
        if (this.spookyPresent()) {
            if (this.getPlayerPieces(1) === 0) {
                this.winner = [1];
            } else if (this.getPlayerPieces(2) === 0) {
                this.winner = [2];
            }
        }
        if (this.winner.length > 0) {
            this.gameover = true;
        }
        if (this.gameover) {
            this.results.push({ type: "eog" });
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public state(): ISpookState {
        return {
            game: SpookGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: SpookGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            pieceCounts: [...this.pieceCounts],
        };
    }

    private isNewResult(): boolean {
        // Check if the `this.result` is new, or if it was copied from the previous state.
        return this.results.every(r => r !== this.stack[this.stack.length - 1]._results[0]);
    }

    private getPiece(player: number, layer: number, trans = false, orb3d = false): [Glyph, ...Glyph[]]  {
        // Choose max blackness and whiteness.
        // Returns a combined glyphs based on the player colour for a given layer 1 to boardSize.
        // orb_3d: if true, only return pure orb glyphs, for which some people prefer.
        if (orb3d) {
            if (trans) {
                return [{ name: "circle", player, scale: 1.15, opacity: 0.5 }];
            }
            return [{ name: "orb", player, scale: 1.2 }];
        }
        const layers = this.boardSize;
        if (trans) {
            const minOpacity = 0.2;
            const maxOpacity = 0.6;
            const opacity = (maxOpacity - minOpacity) * (layer - 2) / (layers - 2) + minOpacity;
            return [
                { name: "circle", colour: "#FFF", scale: 1.15, opacity: opacity * 0.75 },
                { name: "circle", player, scale: 1.15, opacity },
            ];
        } else {
            const blackness = 0.1;
            const whiteness = 0.5;
            const scaled = (whiteness + blackness) * (layer - 1) / (layers - 1) - blackness;
            if (scaled === 0) {
                return [
                    { name: "piece-borderless", player, scale: 1.15 },
                    { name: "orb", player, scale: 1.15, opacity: 0.5 },
                    { name: "piece", scale: 1.15, opacity: 0 },
                ];
            } else {
                const colour = scaled < 0 ? "#000" : "#FFF";
                const opacity = scaled < 0 ? 1 + scaled : 1 - scaled;
                return [
                    { name: "piece-borderless", colour, scale: 1.15 },
                    { name: "piece-borderless", player, scale: 1.15, opacity },
                    { name: "orb", player, scale: 1.15, opacity: 0.5 },
                    { name: "piece", scale: 1.15, opacity: 0 },
                ];
            }
        }
    }

    public render(opts?: IRenderOpts): APRenderRep {
        let hideLayer = this.hideLayer;
        if (opts?.hideLayer !== undefined) {
            hideLayer = opts.hideLayer;
        }
        let altDisplay: string | undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }
        let orb3d = false;
        if (altDisplay !== undefined) {
            if (altDisplay === "orb-3d") {
                orb3d = true;
            }
        }
        // calculate maximum layer (0 indexed)
        const maxLayer = Math.max(0, ...[...this.board.keys()].map(cell => this.algebraic2coords2(cell)).map(([,,l]) => l));
        // Build piece string
        let pstr = "";
        const labels: Set<string> = new Set();
        for (let layer = 0; layer <= (hideLayer ?? maxLayer); layer++) {
            for (let row = 0; row < this.boardSize - layer; row++) {
                if (pstr.length > 0) {
                    pstr += "\n";
                }
                let pieces: string[] = [];
                for (let col = 0; col < this.boardSize - layer; col++) {
                    const cell = this.layerCoords2algebraic(col, row, layer);
                    if (this.board.has(cell)) {
                        const contents = this.board.get(cell);
                        let key;
                        if (contents === 1) {
                            if (hideLayer !== undefined && hideLayer <= layer) {
                                key = `X${layer + 1}`;
                            } else {
                                key = `A${layer + 1}`;
                            }
                        } else if (contents === 2) {
                            if (hideLayer !== undefined && hideLayer <= layer) {
                                key = `Y${layer + 1}`;
                            } else {
                                key = `B${layer + 1}`;
                            }
                        } else {
                            if (hideLayer !== undefined && hideLayer <= layer) {
                                key = `Z${layer + 1}`;
                            } else {
                                key = `C${layer + 1}`;
                            }
                        }
                        pieces.push(key);
                        labels.add(key);
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
        }

        const legend: ILooseObj = {};
        for (const label of labels) {
            const piece = label[0];
            const layer = parseInt(label.slice(1), 10);
            const player = piece === "A" || piece === "X" ? 1 : piece === "B" || piece === "Y" ? 2 : 3;
            legend[label] = this.getPiece(player, layer, ["X", "Y", "Z"].includes(piece), orb3d);
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-stacked",
                width: this.boardSize,
                height: this.boardSize,
            },
            legend,
            pieces: pstr,
        };

        // @ts-ignore
        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") {
                    if (move.what !== "spooky") {
                        const [x, y] = this.algebraic2position(move.where!);
                        rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                    }
                } else if (move.type === "move") {
                    const [xF, yF] = this.algebraic2position(move.from);
                    const [xT, yT] = this.algebraic2position(move.to);
                    rep.annotations.push({ type: "move", targets: [{ row: yF, col: xF }, { row: yT, col: xT }] });
                } else if (move.type === "capture") {
                    const spooky = this.spookyPos(this.isNewResult() ? 1 : 2);
                    let [xF, yF] = this.algebraic2position(spooky);
                    let xT;
                    let yT;
                    for (const cell of move.where!.split(",")) {
                        [xT, yT] = this.algebraic2position(cell);
                        rep.annotations.push({ type: "move", targets: [{ row: yF, col: xF }, { row: yT, col: xT }] });
                        [xF, yF] = [xT, yT];
                    }
                } else if (move.type === "remove") {
                    const [toX, toY] = this.algebraic2position(move.where);
                    if (move.how !== undefined) {
                        const [fromX, fromY] = this.algebraic2position(move.how);
                        rep.annotations.push({ type: "move", targets: [{ row: fromY, col: fromX }, { row: toY, col: toX }], style: "dashed" });
                    }
                    rep.annotations.push({ type: "exit", targets: [{ row: toY, col: toX }] });
                }
            }
        }

        rep.areas = [
            {
                type: "scrollBar",
                position: "left",
                min: 0,
                max: maxLayer + 1,
                current: hideLayer !== undefined ? hideLayer : maxLayer + 1,
            }
        ];

        return rep;
    }

    public getPlayerPieces(player: number): number {
        return this.pieceCounts[player - 1];
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.PIECESONBOARD"), scores: [this.getPlayerPieces(1), this.getPlayerPieces(2)] }
        ]
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

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                if (r.what === "spooky") {
                    node.push(i18next.t("apresults:PLACE.spooky", { where: r.where }));
                } else {
                    node.push(i18next.t("apresults:PLACE.ball", { player, where: r.where }));
                }
                resolved = true;
                break;
            case "capture":
                if (r.how === "drop") {
                    if (r.what === "self") {
                        node.push(i18next.t("apresults:CAPTURE.spook_drop_self", { player, where: r.where, count: r.count }));
                    } else {
                        node.push(i18next.t("apresults:CAPTURE.spook_drop_opponent", { player, where: r.where, count: r.count }));
                    }
                } else {
                    if (r.what === "self") {
                        node.push(i18next.t("apresults:CAPTURE.spook_lateral_self", { player, where: r.where, count: r.count }));
                    } else {
                        node.push(i18next.t("apresults:CAPTURE.spook_lateral_opponent", { player, where: r.where, count: r.count }));
                    }
                }
                resolved = true;
                break;
            case "remove":
                if (r.num === 0) {
                    node.push(i18next.t("apresults:REMOVE.spook", { player, where: r.where }));
                } else {
                    node.push(i18next.t("apresults:REMOVE.spook_drop", { player, where: r.where, count: r.num, how: r.how }));
                }
                resolved = true;
                break;
            case "move":
                node.push(i18next.t("apresults:MOVE.spook", { player, from: r.from, to: r.to }));
                resolved = true;
                break;
            case "pass":
                node.push(i18next.t("apresults:PASS.forced", { player }));
                resolved = true;
                break;
        }
        return resolved;
    }

    public getStartingPosition(): string {
        if (!this.variants.includes("random")) { return ""; }
        let pstr = "";
        const board = this.stack[0].board;
        for (let layer = 0; layer < this.boardSize - 1; layer++) {
            for (let row = 0; row < this.boardSize - layer; row++) {
                if (pstr.length > 0) {
                    pstr += "\n";
                }
                const pieces: string[] = [];
                for (let col = 0; col < this.boardSize - layer; col++) {
                    const cell = this.layerCoords2algebraic(col, row, layer);
                    if (board.has(cell)) {
                        const contents = board.get(cell);
                        if (contents === 1) {
                            pieces.push("1")
                        } else {
                            pieces.push("2")
                        }
                    }
                }
                pstr += pieces.join("");
            }
        }
        return pstr;
    }

    public clone(): SpookGame {
        return new SpookGame(this.serialize());
    }
}
