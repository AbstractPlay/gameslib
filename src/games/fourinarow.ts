import { GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APMoveResult } from "../schemas/moveresults";
import { Directions, reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { InARowBase } from "./in_a_row/InARowBase";
import { APRenderRep } from "@abstractplay/renderer";

type playerid = 1 | 2;

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
    winningLines: string[][];
    swapped: boolean;
}

export interface IFourInARowState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class FourInARowGame extends InARowBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Four In A Row",
        uid: "fourinarow",
        playercounts: [2],
        version: "20240328",
        dateAdded: "2024-04-20",
        // i18next.t("apgames:descriptions.fourinarow")
        description: "apgames:descriptions.fourinarow",
        urls: ["https://boardgamegeek.com/boardgame/2719/connect-four"],
        people: [
            {
                type: "designer",
                name: "Ned Strongin",
            },
            {
                type: "designer",
                name: "Howard Wexler",
            },
        ],
        variants: [
            { uid: "standard-10", group: "board" },
            { uid: "swap-2", group: "opening" },
            { uid: "swap-5", group: "opening" },
            { uid: "edge-grow-4", group: "placement" },
            // { uid: "edge-drop-4", group: "placement" },
            { uid: "interior-gravity-4", group: "placement" },
            { uid: "clear", group: "clear" },
        ],
        categories: ["goal>align", "mechanic>place", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["custom-colours"],
        displays: [{uid: "hide-moves"}],
    };

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardSize);
    }

    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardSize);
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, playerid>;
    public winningLines: string[][] = [];
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    public swapped = false;
    public boardSize = 0;
    public defaultBoardSize = 8;
    private openingProtocol: "none" | "swap-2" | "swap-5";
    public toroidal = false;
    public winningLineLength = 4;
    public overline = "win" as "win" | "ignored" | "forbidden";
    private clear: boolean;
    private placement: "bottom" | "grow-4" | "drop-4" | "gravity-4";

    constructor(state?: IFourInARowState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: FourInARowGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                winningLines: [],
                swapped: false,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IFourInARowState;
            }
            if (state.game !== FourInARowGame.gameinfo.uid) {
                throw new Error(`The FourInARow game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
        this.openingProtocol = this.getOpeningProtocol();
        this.clear = this.variants.includes("clear");
        this.placement = this.getPlacement();
    }

    public load(idx = -1): FourInARowGame {
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
        this.winningLines  = state.winningLines.map(a => [...a]);
        this.swapped = state.swapped;
        this.lastmove = state.lastmove;
        this.boardSize = this.getBoardSize();
        return this;
    }

    protected getBoardSize(): number {
        // Get board size from variants.
        if (this.variants !== undefined && this.variants.length > 0 && this.variants[0] !== undefined && this.variants[0].length > 0) {
            const sizeVariants = this.variants.filter(v => v.includes("standard") || v.includes("toroidal"))
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

    private getOpeningProtocol(): "none" | "swap-2" | "swap-5" {
        return this.variants.includes("swap-2") ? "swap-2" : this.variants.includes("swap-5") ? "swap-5" : "none";
    }

    private getPlacement(): "bottom" | "grow-4" | "drop-4" | "gravity-4" {
        return this.variants.includes("edge-grow-4")
            ? "grow-4"
            : this.variants.includes("edge-drop-4")
            ? "drop-4"
            : this.variants.includes("interior-gravity-4")
            ? "gravity-4"
            : "bottom";
    }

    private hasMoveGeneration(): boolean {
        // If the number of moves is too large, we don't want to generate the entire move list.
        if (this.openingProtocol === "swap-2" && this.stack.length < 3) { return false; }
        return true;
    }

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }
        if (!this.hasMoveGeneration()) {
            if (this.canSwap()) { return ["No movelist in opening", "pass"] }
            return ["No movelist in opening"]
        }
        const moves = this.placeableCells().sort();
        if (this.canSwap()) {
            moves.push("pass");
        }
        return moves;
    }

    private placeableCells(placed: string[] = []): string[] {
        // Get all spaces where a piece can be placed.
        // `placed` is a list of cells that have already been placed but not committed to `this.board`.
        const moveSet: Set<string> = new Set();
        if (this.placement === "drop-4") {
            for (let col = 0; col < this.boardSize; col++) {
                let foundEmpty = false;
                let prevCell: string | undefined;
                for (let row = 0; row < this.boardSize; row++) {
                    const cell = this.coords2algebraic(col, this.boardSize - row - 1);
                    if (this.board.has(cell) || placed.includes(cell)) {
                        if (!foundEmpty) { continue; }
                        moveSet.add(prevCell!);
                        prevCell = undefined;
                        break;
                    }
                    foundEmpty = true;
                    prevCell = cell;
                }
                if (prevCell !== undefined) { moveSet.add(prevCell); }
            }
            for (let col = 0; col < this.boardSize; col++) {
                let foundEmpty = false;
                let prevCell: string | undefined;
                for (let row = 0; row < this.boardSize; row++) {
                    const cell = this.coords2algebraic(col, row);
                    if (this.board.has(cell) || placed.includes(cell)) {
                        if (!foundEmpty) { continue; }
                        moveSet.add(prevCell!);
                        prevCell = undefined;
                        break;
                    }
                    foundEmpty = true;
                    prevCell = cell;
                }
                if (prevCell !== undefined) { moveSet.add(prevCell); }
            }
            for (let row = 0; row < this.boardSize; row++) {
                let foundEmpty = false;
                let prevCell: string | undefined;
                for (let col = 0; col < this.boardSize; col++) {
                    const cell = this.coords2algebraic(col, row);
                    if (this.board.has(cell) || placed.includes(cell)) {
                        if (!foundEmpty) { continue; }
                        moveSet.add(prevCell!);
                        prevCell = undefined;
                        break;
                    }
                    foundEmpty = true;
                    prevCell = cell;
                }
                if (prevCell !== undefined) { moveSet.add(prevCell); }
            }
            for (let row = 0; row < this.boardSize; row++) {
                let foundEmpty = false;
                let prevCell: string | undefined;
                for (let col = 0; col < this.boardSize; col++) {
                    const cell = this.coords2algebraic(this.boardSize - col - 1, row);
                    if (this.board.has(cell) || placed.includes(cell)) {
                        if (!foundEmpty) { continue; }
                        moveSet.add(prevCell!);
                        prevCell = undefined;
                        break;
                    }
                    foundEmpty = true;
                    prevCell = cell;
                }
                if (prevCell !== undefined) { moveSet.add(prevCell); }
            }
        } else if (this.placement === "gravity-4") {
            for (let i = 0; i < this.boardSize; i++) {
                for (let j = 0; j < this.boardSize; j++) {
                    const cell = this.coords2algebraic(i, j);
                    if (this.board.has(cell) || placed.includes(cell)) { continue; }
                    moveSet.add(this.gravityMove(i, j));
                }
            }
        } else {
            // Normal downwards four in a row.
            for (let col = 0; col < this.boardSize; col++) {
                for (let row = 0; row < this.boardSize; row++) {
                    const cell = this.coords2algebraic(col, this.boardSize - row - 1);
                    if (this.board.has(cell) || placed.includes(cell)) { continue; }
                    moveSet.add(cell);
                    break;
                }
            }
            if (this.placement === "grow-4") {
                for (let col = 0; col < this.boardSize; col++) {
                    for (let row = 0; row < this.boardSize; row++) {
                        const cell = this.coords2algebraic(col, row);
                        if (this.board.has(cell) || placed.includes(cell)) { continue; }
                        moveSet.add(cell);
                        break;
                    }
                }
                for (let row = 0; row < this.boardSize; row++) {
                    for (let col = 0; col < this.boardSize; col++) {
                        const cell = this.coords2algebraic(col, row);
                        if (this.board.has(cell) || placed.includes(cell)) { continue; }
                        moveSet.add(cell);
                        break;
                    }
                }
                for (let row = 0; row < this.boardSize; row++) {
                    for (let col = 0; col < this.boardSize; col++) {
                        const cell = this.coords2algebraic(this.boardSize - col - 1, row);
                        if (this.board.has(cell) || placed.includes(cell)) { continue; }
                        moveSet.add(cell);
                        break;
                    }
                }
            }
        }
        return [...moveSet];
    }

    private gravityMove(i: number, j: number): string {
        // Get the cell where the piece will fall to for the gravity-4 variant.
        const cell = this.coords2algebraic(i, j);
        const d1 = i + j - this.boardSize + 1;
        const d2 = i - j;
        if (d1 < 0) {
            if (d2 === 0) { return this.lastAvailableSpace(cell, -1, -1); }
            else if (d2 < 0) { return this.lastAvailableSpace(cell, -1, 0); }
            else if (d2 > 0) { return this.lastAvailableSpace(cell, 0, -1); }
        } else if (d1 > 0) {
            if (d2 === 0) { return this.lastAvailableSpace(cell, 1, 1); }
            else if (d2 < 0) { return this.lastAvailableSpace(cell, 0, 1); }
            else if (d2 > 0) { return this.lastAvailableSpace(cell, 1, 0); }
        } else {
            if (d2 === 0) { return cell; }
            else if (d2 < 0) { return this.lastAvailableSpace(cell, -1, 1); }
            else if (d2 > 0) { return this.lastAvailableSpace(cell, 1, -1); }
        }
        // Should never reach here.
        return cell;
    }

    private lastAvailableSpace(cell: string, dx: number, dy: number): string {
        // Step in direction (dx, dy) until we find non-empty space or the edge of the board.
        // The last empty space is space right before the non-empty space or the edge of the board.
        // If the next space is immediately non-empty or the edge, just return the original cell.
        let prevCell = cell;
        let [x, y] = this.algebraic2coords(cell);
        while (true) {
            x += dx;
            y += dy;
            if (x < 0 || x >= this.boardSize || y < 0 || y >= this.boardSize) { break }
            const nextCell = this.coords2algebraic(x, y);
            if (this.board.has(nextCell)) {
                return prevCell;
            }
            prevCell = nextCell;
        }
        return prevCell;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    private canSwap(): boolean {
        // Check if the player is able to invoke the pie rule on this turn.
        if (this.openingProtocol === "swap-2") {
            if (this.stack.length === 2) { return true; }
            if (this.stack.length === 3 && this.stack[2].lastmove?.includes(",")) { return true; }
        }
        if (this.openingProtocol === "swap-5") {
            if (this.stack.length > 10) { return false; }
            if (this.stack.length === 1) { return false; }
            if (this.stack[this.stack.length - 1].lastmove === "pass") { return false; }
            const placeMoveCount = this.placeMoveCount();
            if (placeMoveCount < 6) { return true; }
        }
        return false;
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

    private normalisePlacement(m: string): string {
        // Normalise placement string for swap-2 opening.
        // If there are three placements, sort the first and third placements
        // as long as there is no order dependency.
        // A bit complicated, but as long as the users click on the board it should be fine.
        const moves = m.split(",");
        if (moves.length < 3) { return m; }
        const [first, second, third] = moves;
        if (!this.placeableCells().includes(third) && this.placeableCells([first, second]).includes(third)) {
            return m;
        }
        if (this.placeableCells([first]).includes(second) && !this.placeableCells([third]).includes(second)) {
            return m;
        }
        if (this.sort(first, third) === 1) {
            return [third, second, first].join(",");
        }
        return m;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = "";
            const cell = this.renderCoords2algebraic(col, row);
            if (move === "") {
                newmove = cell;
            } else {
                newmove = this.normalisePlacement(move + "," + cell);
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

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        if (m.length === 0) {
            let message = i18next.t("apgames:validation.fourinarow.INITIAL_INSTRUCTIONS");
            if (this.openingProtocol === "swap-2") {
                if (this.stack.length === 1) {
                    message = i18next.t("apgames:validation.fourinarow.INITIAL_INSTRUCTIONS_SWAP21");
                } else if (this.stack.length === 2) {
                    message = i18next.t("apgames:validation.fourinarow.INITIAL_INSTRUCTIONS_SWAP22");
                } else if (this.stack.length === 3 && this.canSwap()) {
                    message = i18next.t("apgames:validation.fourinarow.INITIAL_INSTRUCTIONS_SWAP23");
                }
            }
            if (this.openingProtocol === "swap-5" && this.canSwap()) {
                message = i18next.t("apgames:validation.fourinarow.INITIAL_INSTRUCTIONS_SWAP5");
            }
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = message;
            return result;
        }
        if (m === "No movelist in opening") {
            result.valid = false;
            result.complete = -1;
            result.message = i18next.t("apgames:validation._inarow.NO_MOVELIST");
            return result;
        }

        if (m === "pass") {
            if (!this.canSwap()) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._inarow.CANNOT_SWAP");
                return result;
            }
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
        const moves = m.split(",");
        // Valid cell
        let currentMove;
        try {
            for (const p of moves) {
                currentMove = p;
                const [x, y] = this.algebraic2coords(p);
                // `algebraic2coords` does not check if the cell is on the board.
                if (x < 0 || x >= this.boardSize || y < 0 || y >= this.boardSize) {
                    throw new Error("Invalid cell");
                }
            }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: currentMove });
            return result;
        }
        // Cell is empty
        let notEmpty;
        for (const p of moves) {
            if (this.board.has(p)) { notEmpty = p; break; }
        }
        if (notEmpty) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", { where: notEmpty });
            return result;
        }
        // No duplicate cells.
        if (moves.length > 1) {
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
                result.message = i18next.t("apgames:validation._inarow.DUPLICATE", { where: [...duplicates].join(",") });
                return result;
            }
        }
        for (const [i, move] of moves.entries()) {
            if (!this.placeableCells(moves.slice(0, i)).includes(move)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.fourinarow.NOT_PLACEABLE", { where: move });
                return result;
            }
        }
        if (this.openingProtocol === "swap-2" && this.stack.length < 3) {
            if (this.stack.length === 1) {
                if (moves.length < 3) {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.fourinarow.SWAP21", { count: 3 - moves.length });
                    return result;
                }
                if (moves.length > 3) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.fourinarow.SWAP21_EXCESS");
                    return result;
                }
            } else if (this.stack.length === 2) {
                if (moves.length < 2) {
                    result.valid = true;
                    result.complete = 0;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.fourinarow.SWAP22_PARTIAL");
                    return result;
                }
                if (moves.length > 2) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.fourinarow.SWAP22_EXCESS");
                    return result;
                }
            }
        } else {
            if (moves.length > 1) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.fourinarow.EXCESS");
                return result;
            }
        }
        // Since there is no move list for placement phase, we have to do some extra validation.
        const regex = new RegExp(`^([a-z]+[1-9][0-9]*)(,[a-z]+[1-9][0-9]*)*$`);
        if (!regex.test(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._inarow.INVALID_PLACEMENT", { move: m });
            return result;
        }
        const normalised = this.normalisePlacement(m);
        if (m !== normalised) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._inarow.NORMALISE", { normalised });
            return result;
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public lineClear(): Directions | undefined {
        // Get direction to clear. If no clear, return undefined.
        const clears: Directions[] = [];
        let add = true;
        for (let i = 0; i < this.boardSize; i++) {
            if (!this.board.has(this.coords2algebraic(i, this.boardSize - 1))) {
                add = false;
                break;
            }
        }
        if (add) { clears.push("S"); }
        if (this.placement.includes("4")) {
            add = true;
            for (let i = 0; i < this.boardSize; i++) {
                if (!this.board.has(this.coords2algebraic(i, 0))) {
                    add = false;
                    break;
                }
            }
            if (add) { clears.push("N"); }
            add = true;
            for (let j = 0; j < this.boardSize; j++) {
                if (!this.board.has(this.coords2algebraic(0, j))) {
                    add = false;
                    break;
                }
            }
            if (add) { clears.push("W"); }
            add = true;
            for (let j = 0; j < this.boardSize; j++) {
                if (!this.board.has(this.coords2algebraic(this.boardSize - 1, j))) {
                    add = false;
                    break;
                }
            }
            if (add) { clears.push("E"); }
        }
        return clears.length > 0 ? clears.join("") as Directions : undefined;
    }

    private shiftBoard(direction: Directions): Map<string, playerid>{
        // Get a new board with all pieces shifted in the given direction.
        const newBoard: Map<string, playerid> = new Map();
        for (const [cell, player] of this.board) {
            const [x, y] = this.algebraic2coords(cell);
            let [newX, newY] = [x, y];
            if (direction.includes("N")) { newY--; }
            if (direction.includes("S")) { newY++; }
            if (direction.includes("W")) { newX--; }
            if (direction.includes("E")) { newX++; }
            if (newX < 0 || newX >= this.boardSize || newY < 0 || newY >= this.boardSize) { continue; }
            newBoard.set(this.coords2algebraic(newX, newY), player);
        }
        return newBoard;
    }

    public move(m: string, {partial = false, trusted = false} = {}): FourInARowGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        let result;
        if (m === "No movelist in opening") {
            result = {valid: false, message: i18next.t("apgames:validation.pente.NO_MOVELIST")};
            throw new UserFacingError("VALIDATION_GENERAL", result.message);
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (!trusted) {
            result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
            if (!partial && this.hasMoveGeneration() && !this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}));
            }
        }
        if (m.length === 0) { return this; }
        this.results = [];
        if (m === "pass") {
            if (this.canSwap()) {
                // Swap all pieces on the board.
                this.swapped = !this.swapped;
                this.board.forEach((v, k) => {
                    this.board.set(k, v === 1 ? 2 : 1);
                })
                this.results.push({ type: "pie" });
            }
        } else {
            const moves = m.split(",");
            let placePlayer = this.currplayer;
            for (const move of moves) {
                this.results.push({ type: "place", where: move });
                this.board.set(move, placePlayer);
                placePlayer = placePlayer % 2 + 1 as playerid;
            }
            if (this.stack.length === 2 && this.openingProtocol === "swap-2" && moves.length === 2) {
                this.swapped = !this.swapped;
                this.board.forEach((v, k) => {
                    this.board.set(k, v === 1 ? 2 : 1);
                })
            }
            if (this.clear && !this.hasInARow(...this.algebraic2coords(moves[0]), this.currplayer, 4, false)) {
                let clearDirection;
                do {
                    clearDirection = this.lineClear();
                    if (clearDirection !== undefined) {
                        this.board = this.shiftBoard(clearDirection);
                        this.results.push({ type: "remove", where: clearDirection });
                    }
                } while (clearDirection !== undefined);
            }
        }
        if (partial) { return this; }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): FourInARowGame {
        const winningLinesMap = this.getWinningLinesMap(this.overline === "ignored" ? [1, 2] : []);
        const winner: playerid[] = [];
        this.winningLines = [];
        for (const player of [1, 2] as playerid[]) {
            if (winningLinesMap.get(player)!.length > 0) {
                winner.push(player);
                this.winningLines.push(...winningLinesMap.get(player)!);
            }
        }
        if (winner.length === 0) {
            if (!this.hasEmptySpace()) {
                winner.push(1);
                winner.push(2);
            }
        }
        if (winner.length > 0) {
            this.gameover = true;
            this.winner = winner;
        }
        if (this.gameover) {
            this.results.push({ type: "eog" });
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    private isNewResult(): boolean {
        // Check if the `this.result` is new, or if it was copied from the previous state.
        return this.results.every(r => r !== this.stack[this.stack.length - 1]._results[0]);
    }

    public render(opts?: IRenderOpts): APRenderRep {
        let altDisplay: string | undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }
        let showMoves = true;
        if (altDisplay !== undefined) {
            if (altDisplay === "hide-moves") {
                showMoves = false;
            }
        }
        // Build piece string
        let pstr = "";
        const renderBoardSize = this.boardSize;
        for (let row = 0; row < renderBoardSize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            for (let col = 0; col < renderBoardSize; col++) {
                const cell = this.renderCoords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell);
                    if (contents === 1) {
                        pstr += "A";
                    } else if (contents === 2) {
                        pstr += "B";
                    }
                } else {
                    pstr += "-";
                }
            }
        }
        pstr = pstr.replace(new RegExp(`-{${renderBoardSize}}`, "g"), "_");
        let markers: Array<any> | undefined = [];
        if (this.clear) {
            if (this.placement.includes("4")) {
                markers.push(...[
                    {
                        type: "shading", colour: "#FFA500", opacity: 0.1,
                        points: [{row: 0, col: 0}, {row: 0, col: 1}, {row: this.boardSize, col: 1}, {row: this.boardSize, col: 0}],
                    },
                    {
                        type: "shading", colour: "#FFA500", opacity: 0.1,
                        points: [{row: 0, col: this.boardSize - 1}, {row: 0, col: this.boardSize}, {row: this.boardSize, col: this.boardSize}, {row: this.boardSize, col: this.boardSize - 1}],
                    },
                    {
                        type: "shading", colour: "#FFA500", opacity: 0.1,
                        points: [{row: 0, col: 1}, {row: 0, col: this.boardSize - 1}, {row: 1, col: this.boardSize - 1}, {row: 1, col: 1}],
                    },
                    {
                        type: "shading", colour: "#FFA500", opacity: 0.1,
                        points: [{row: this.boardSize - 1, col: 1}, {row: this.boardSize - 1, col: this.boardSize - 1}, {row: this.boardSize, col: this.boardSize - 1}, {row: this.boardSize, col: 1}],
                    },
                ]);
            } else {
                markers.push({
                    type: "shading", colour: "#FFA500", opacity: 0.1,
                    points: [{row: this.boardSize - 1, col: 0}, {row: this.boardSize - 1, col: this.boardSize}, {row: this.boardSize, col: this.boardSize}, {row: this.boardSize, col: 0}],
                })
            }
        }
        if (this.placement === "gravity-4") {
            markers.push({
                type: "line",
                points: [ { "row": 0, "col": 0 }, { "row": this.boardSize, "col": this.boardSize } ],
                width: 2,
                opacity: 0.2,
            });
            markers.push({
                type: "line",
                points: [ { "row": 0, "col": this.boardSize }, { "row": this.boardSize, "col": 0 } ],
                width: 2,
                opacity: 0.2,
            });
        }
        if (this.results.some(r => r.type === "remove")) {
            const clearDirections = this.results.filter(r => r.type === "remove").map(r => (r as Extract<APMoveResult, { type: 'remove' }>).where);
            for (const dir of clearDirections) {
                if (dir.includes("N")) { markers.push({type:"edge", edge: "N", colour: "#FFA500"}); }
                if (dir.includes("S")) { markers.push({type:"edge", edge: "S", colour: "#FFA500"}); }
                if (dir.includes("E")) { markers.push({type:"edge", edge: "E", colour: "#FFA500"}); }
                if (dir.includes("W")) { markers.push({type:"edge", edge: "W", colour: "#FFA500"}); }
            }
        }
        if (markers.length === 0) { markers = undefined; }
        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares",
                width: renderBoardSize,
                height: renderBoardSize,
                rowLabels: this.toroidal ? this.renderRowLabels() : undefined,
                columnLabels: this.toroidal ? this.renderColLabels() : undefined,
                markers,
            },
            legend: {
                A: [{ name: "piece", colour: this.getPlayerColour(1) as playerid }],
                B: [{ name: "piece", colour: this.getPlayerColour(2) as playerid }],
            },
            pieces: pstr,
        };

        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const coordsAll = this.renderAlgebraic2coords(move.where!);
                    for (const [x, y] of coordsAll) {
                        rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                    }
                } else if (move.type === "capture") {
                    for (const cell of move.where!.split(",")) {
                        const coordsAll = this.renderAlgebraic2coords(cell);
                        for (const [x, y] of coordsAll) {
                            rep.annotations.push({ type: "exit", targets: [{ row: y, col: x }] });
                        }
                    }
                }
            }
            const renderWinningLines = this.renderWinningLines(this.winningLines);
            if (renderWinningLines.length > 0) {
                for (const connPath of renderWinningLines) {
                    if (connPath.length === 1) { continue; }
                    type RowCol = { row: number; col: number; };
                    const targets: RowCol[] = [];
                    for (const coords of connPath) {
                        targets.push({ row: coords[1], col: coords[0] })
                    }
                    rep.annotations.push({ type: "move", targets: targets as [RowCol, ...RowCol[]], arrow: false });
                }
            }
        }
        if (showMoves) {
            const places: string[] = [];
            if (this.isNewResult()) {
                const placeResults = this.results.filter(r => r.type === "place");
                places.push(...placeResults.map(r => (r as Extract<APMoveResult, { type: 'remove' }>).where));
            }
            for (const cell of this.placeableCells(places)){
                const [x, y] = this.algebraic2coords(cell);
                rep.annotations.push({ type: "dots", targets: [{ row: y, col: x }] });
            }
        }
        return rep;
    }

    public state(): IFourInARowState {
        return {
            game: FourInARowGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: FourInARowGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            winningLines: this.winningLines.map(a => [...a]),
            swapped: this.swapped,
        };
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.nowhat", { player, where: r.where }));
                resolved = true;
                break;
            case "pie":
                node.push(i18next.t("apresults:PIE.default", { player }));
                resolved = true;
                break;
            case "remove":
                node.push(i18next.t(`apresults:REMOVE.fourinarow_${r.where.toLowerCase()}`, { player }));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): FourInARowGame {
        return new FourInARowGame(this.serialize());
    }
}
