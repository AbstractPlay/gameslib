import { GameBase, IAPGameState, IClickResult, ICustomButton, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { InARowBase } from "./in_a_row/InARowBase";
import { APRenderRep } from "@abstractplay/renderer";
import { MarkerDots, MarkerShading } from "@abstractplay/renderer/src/schemas/schema";

type playerid = 1 | 2;

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
    winningLines: string[][];
    swapped: boolean;
    tiebreaker?: playerid;
}

export interface IConnect6State extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class Connect6Game extends InARowBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Connect6",
        uid: "connect6",
        playercounts: [2],
        version: "20240328",
        dateAdded: "2024-04-20",
        // i18next.t("apgames:descriptions.connect6")
        description: "apgames:descriptions.connect6",
        urls: ["https://boardgamegeek.com/boardgame/22847/connect6"],
        people: [
            {
                type: "designer",
                name: "Professor I-Chen Wu",
            },
        ],
        variants: [
            { uid: "toroidal-15", group: "board" },
            { uid: "collinear6", group: "ruleset" },
            { uid: "noncollinear5", group: "ruleset" },
            { uid: "swap-3rd", group: "opening" },
            { uid: "pass", group: "tiebreaker" },
        ],
        categories: ["goal>align", "mechanic>place", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["multistep", "custom-colours", "perspective", "rotate90", "no-moves", "custom-buttons"],
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
    private openingProtocol: "centre" | "swap-3rd";
    public toroidal = false;
    public winningLineLength = 6;
    public defaultBoardSize = 19;
    public overline = "win" as "win" | "ignored" | "forbidden";
    private passTiebreaker = false;
    private tiebreaker?: playerid;
    private ruleset: "default" | "collinear6" | "noncollinear5";

    constructor(state?: IConnect6State | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: Connect6Game.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                winningLines: [],
                swapped: false,
                tiebreaker: undefined,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IConnect6State;
            }
            if (state.game !== Connect6Game.gameinfo.uid) {
                throw new Error(`The Connect6 game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
        this.openingProtocol = this.getOpeningProtocol();
        this.toroidal = this.variants.some(v => v.startsWith("toroidal"));
        this.passTiebreaker = this.variants.includes("pass");
        this.ruleset = this.getRuleset();
        this.winningLineLength = this.ruleset === "noncollinear5" ? 5 : 6;
    }

    public load(idx = -1): Connect6Game {
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
        this.tiebreaker = state.tiebreaker;
        this.lastmove = state.lastmove;
        this.boardSize = this.getBoardSize();
        return this;
    }

    private getOpeningProtocol(): "centre" | "swap-3rd" {
        if (this.variants.includes("swap-3rd")) { return "swap-3rd"; }
        return "centre";
    }

    private getRuleset(): "default" | "collinear6" | "noncollinear5" {
        if (this.variants.includes("collinear6")) { return "collinear6"; }
        if (this.variants.includes("noncollinear5")) { return "noncollinear5"; }
        return "default";
    }

    private hasMoveGeneration(): boolean {
        // If the number of moves is too large, we don't want to generate the entire move list.
        return this.stack.length === 1;
    }

    public getButtons(): ICustomButton[] {
        if (this.pastOpening() || this.canSwap()) {
            return [{
                label: "pass",
                move: "pass"
            }];
        }
        return [];
    }

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }
        if (!this.hasMoveGeneration()) {
            if (this.canSwap() || this.pastOpening()) { return ["No movelist", "pass"] }
            return ["No movelist"]
        }
        if (this.stack.length === 1) {
            return [this.coords2algebraic((this.boardSize - 1) / 2, (this.boardSize - 1) / 2)];
        }
        const moves: string[] = [];
        if (this.canSwap() || this.pastOpening()) {
            moves.push("pass");
        }
        return moves;
    }

    private canSwap(): boolean {
        // Check if the player is able to invoke the pie rule on this turn.
        if (this.openingProtocol === "swap-3rd") {
            if (this.stack.length === 4) { return true; }
        }
        return false;
    }

    private pastOpening(buffer = 2): boolean {
        // This is usually used to check if we are past the opening phase so that players can pass.
        // Pass is also used to invoke the pie rule during the opening phase.
        // For safety, passing is not allowed for the first two moves after the opening phase.
        if (this.openingProtocol === "swap-3rd") {
            return this.pastOpeningFunc(3, 0, true, buffer);
        }
        return this.pastOpeningFunc(1, 0, false, buffer);
    }

    public randomMove(): string {
        const moves: string[] = [];
        if (this.stack.length === 1) {
            moves.push(this.coords2algebraic((this.boardSize - 1) / 2, (this.boardSize - 1) / 2));
        } else {
            if (this.openingProtocol === "swap-3rd" && this.stack.length === 2) {
                const middle = (this.boardSize - 1) / 2;
                if (this.ruleset === "collinear6") {
                    const collinearPrev = this.collinearPrev();
                    const moveSet: Set<string> = new Set();
                    for (const cell of collinearPrev) {
                        const [x, y] = this.algebraic2coords(cell);
                        if (x < middle - 2 || x > middle + 2 || y < middle - 2 || y > middle + 2) { continue; }
                        for (const cell1 of this.cellsFrom(cell)) {
                            const [x1, y1] = this.algebraic2coords(cell1);
                            if (x1 < middle - 2 || x1 > middle + 2 || y1 < middle - 2 || y1 > middle + 2) { continue; }
                            moveSet.add(this.normalisePlacement(cell + "," + cell1));
                        }
                    }
                    moves.push(...moveSet);
                } else if (this.ruleset === "noncollinear5") {
                    const moveSet: Set<string> = new Set();
                    for (let row = middle - 2; row <= middle + 2; row++) {
                        for (let col = middle - 2; col <= middle + 2; col++) {
                            const cell = this.coords2algebraic(col, row);
                            if (this.board.has(cell)) { continue; }
                            const fromFirst = this.cellsFrom(cell);
                            for (let row1 = row; row1 <= middle + 2; row1++) {
                                for (let col1 = row1 === row ? col + 1 : middle - 2; col1 <= middle + 2; col1++) {
                                    const cell1 = this.coords2algebraic(col1, row1);
                                    if (this.board.has(cell1)) { continue; }
                                    if (fromFirst.has(cell1)) { continue; }
                                    moveSet.add(this.normalisePlacement(cell + "," + cell1));
                                }
                            }
                        }
                    }
                    moves.push(...moveSet);
                } else {
                    for (let row = middle - 2; row <= middle + 2; row++) {
                        for (let col = middle - 2; col <= middle + 2; col++) {
                            const cell = this.coords2algebraic(col, row);
                            if (this.board.has(cell)) { continue; }
                            for (let row1 = row; row1 <= middle + 2; row1++) {
                                for (let col1 = row1 === row ? col + 1 : middle - 2; col1 <= middle + 2; col1++) {
                                    const cell1 = this.coords2algebraic(col1, row1);
                                    if (this.board.has(cell1)) { continue; }
                                    moves.push(this.normalisePlacement(cell + "," + cell1));
                                }
                            }
                        }
                    }
                }
            } else {
                if (this.ruleset === "collinear6") {
                    const collinearPrev = this.collinearPrev();
                    const moveSet: Set<string> = new Set();
                    for (const cell of collinearPrev) {
                        for (const cell1 of this.cellsFrom(cell)) {
                            moveSet.add(this.normalisePlacement(cell + "," + cell1));
                        }
                    }
                    moves.push(...moveSet);
                } else if (this.ruleset === "noncollinear5") {
                    const moveSet: Set<string> = new Set();
                    for (let row = 0; row < this.boardSize; row++) {
                        for (let col = 0; col < this.boardSize; col++) {
                            const cell = this.coords2algebraic(col, row);
                            if (this.board.has(cell)) { continue; }
                            const fromFirst = this.cellsFrom(cell);
                            for (let row1 = row; row1 < this.boardSize; row1++) {
                                for (let col1 = row1 === row ? col + 1 : 0; col1 < this.boardSize; col1++) {
                                    const cell1 = this.coords2algebraic(col1, row1);
                                    if (this.board.has(cell1)) { continue; }
                                    if (fromFirst.has(cell1)) { continue; }
                                    moveSet.add(this.normalisePlacement(cell + "," + cell1));
                                }
                            }
                        }
                    }
                    moves.push(...moveSet);
                } else {
                    for (let row = 0; row < this.boardSize; row++) {
                        for (let col = 0; col < this.boardSize; col++) {
                            const cell = this.coords2algebraic(col, row);
                            if (this.board.has(cell)) { continue; }
                            for (let row1 = row; row1 < this.boardSize; row1++) {
                                for (let col1 = row1 === row ? col + 1 : 0; col1 < this.boardSize; col1++) {
                                    const cell1 = this.coords2algebraic(col1, row1);
                                    if (this.board.has(cell1)) { continue; }
                                    moves.push(this.normalisePlacement(cell + "," + cell1));
                                }
                            }
                        }
                    }
                }
            }
            if (this.canSwap() || this.pastOpening()) {
                moves.push("pass");
            }
        }
        return moves[Math.floor(Math.random() * moves.length)];
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
        // Sort the two cells in a move.
        if (this.ruleset === "collinear6") {
            // We sort only if both cells are collinear with a previous move.
            const moves = m.split(",");
            const collinearPrev = this.collinearPrev();
            if (collinearPrev.has(moves[0]) && collinearPrev.has(moves[1])) {
                return moves.sort((a, b) => this.sort(a, b)).join(",");
            } else {
                return m;
            }

        } else {
            const moves = m.split(",");
            return moves.sort((a, b) => this.sort(a, b)).join(",");
        }
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
            let message = i18next.t("apgames:validation.connect6.INITIAL_INSTRUCTIONS");
            if (this.stack.length === 1) {
                message = i18next.t("apgames:validation._inarow.INITIAL_INSTRUCTIONS_CENTRE1");
            } else if (this.openingProtocol === "swap-3rd") {
                if (this.stack.length === 2) {
                    message = i18next.t("apgames:validation.connect6.INITIAL_INSTRUCTIONS_SWAP3RD2");
                } else if (this.stack.length === 4) {
                    message = i18next.t("apgames:validation.connect6.INITIAL_INSTRUCTIONS_SWAP3RD4");
                }
            }
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = message;
            return result;
        }
        if (m === "No movelist") {
            result.valid = false;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.connect6.NO_MOVELIST");
            return result;
        }
        if (m === "pass") {
            if (!this.pastOpening(0)) {
                if (!this.canSwap()) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._inarow.CANNOT_SWAP");
                    return result;
                }
            } else if (!this.pastOpening()) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._inarow.CANNOT_PASS");
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
        let singleStone = false;
        if (this.stack.length === 1) {
            if (moves.length > 1) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.connect6.EXCESS_FIRST");
                return result;
            }
            if (!this.isNearCentre(moves[0], 0)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._inarow.CENTRE_OFFCENTRE");
                return result;
            }
            singleStone = true;
        } else if (this.stack.length === 2 && this.openingProtocol === "swap-3rd") {
            for (const move of moves) {
                if (!this.isNearCentre(move, 2)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.connect6.SWAP3RD2_INVALID");
                    return result;
                }
            }
        }
        if (this.stack.length > 1 && this.ruleset === "collinear6") {
            const collinearPrev = this.collinearPrev();
            if (!collinearPrev.has(moves[0])) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.connect6.COLLINEAR_FIRST");
                return result;
            }
        }
        if (!singleStone) {
            if (moves.length === 1) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                if (this.stack.length === 2 && this.openingProtocol === "swap-3rd") {
                    result.message = i18next.t("apgames:validation.connect6.SWAP3RD2_ONE_MORE");
                } else {
                    result.message = i18next.t("apgames:validation.connect6.ONE_MORE");
                }
                return result;
            }
            if (moves.length > 2) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.connect6.EXCESS");
                return result;
            }
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
            if (this.ruleset === "collinear6") {
                if (!this.cellsFrom(moves[0]).has(moves[1])) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.connect6.COLLINEAR_SECOND");
                    return result;
                }
            } else if (this.ruleset === "noncollinear5") {
                if (this.cellsFrom(moves[0]).has(moves[1])) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.connect6.NONCOLLINEAR_SECOND");
                    return result;
                }
            }
        }
        // Since there is no move list for placement phase, we have to do some extra validation.
        const regex = new RegExp(`^([a-z]+[1-9][0-9]*)(,[a-z]+[1-9][0-9]*)*$`);
        if (!regex.test(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._inarow.INVALID_PLACEMENT", {move: m});
            return result;
        }
        const normalised = this.normalisePlacement(m);
        if (m !== normalised) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._inarow.NORMALISE", {normalised});
            return result;
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private cellsFrom(cell: string): Set<string> {
        // Return all unoccupied cells that can be seen from the given cell.
        const [x, y] = this.algebraic2coords(cell);
        const cells: Set<string> = new Set();
        for (const delta of [[0, 1], [1, 0], [-1, 0], [0, -1], [-1, -1], [-1, 1], [1, -1], [1, 1]]) {
            const [dx, dy] = delta;
            let i = 1;
            while (i < this.boardSize) {
                const [x1, y1, wrapped] = this.wrap(x + i * dx, y + i * dy);
                if (!this.toroidal && wrapped) { break; }
                i++;
                const cell1 = this.coords2algebraic(x1, y1);
                if (this.board.has(cell1)) { continue; }
                cells.add(cell1);
            }
        }
        return cells;
    }

    private collinearPrev(lastMove?: string): Set<string> {
        // Get last non-pass move and return all cells that can be seen from it.
        if (this.stack.length === 1) { return new Set(); }
        lastMove ??= this.lastNonPass()!;
        const cells: Set<string> = new Set();
        for (const c of lastMove.split(",")) {
            for (const cell of this.cellsFrom(c)) {
                cells.add(cell);
            }
        }
        return cells;
    }

    public move(m: string, {partial = false, trusted = false} = {}): Connect6Game {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        let result;
        if (m === "No movelist") {
            result = {valid: false, message: i18next.t("apgames:validation.connect6.NO_MOVELIST")};
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
            } else if (this.pastOpening()) {
                if (this.passTiebreaker && this.tiebreaker === undefined) {
                    this.tiebreaker = this.currplayer;
                    this.results.push({ type: "pass", why: "tiebreaker" });
                } else {
                    this.results.push({ type: "pass" });
                }
            }
        } else {
            const moves = m.split(",");
            for (const move of moves) {
                this.results.push({ type: "place", where: move });
                this.board.set(move, this.currplayer);
            }
        }
        if (partial) { return this; }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected hasMovesCollinear6(): boolean {
        // This is used to determine if there are still moves left for collinear6.
        const lastMove = this.lastmove === "pass" ? this.lastNonPass() : this.lastmove;
        const collinearPrev = this.collinearPrev(lastMove);
        if (collinearPrev.size === 0) { return false; }
        for (const cell of collinearPrev) {
            const cellsFrom = this.cellsFrom(cell);
            if (cellsFrom.size > 0) { return true; }
        }
        return false;
    }

    protected hasMovesNonCollinear5(): boolean {
        // This is used to determine if there are still moves left for noncollinear5.
        for (let i = 0; i < this.boardSize; i++) {
            for (let j = 0; j < this.boardSize; j++) {
                const cell = this.coords2algebraic(j, i);
                if (this.board.has(cell)) { continue; }
                const cellsFrom = this.cellsFrom(cell);
                for (let i1 = i; i1 < this.boardSize; i1++) {
                    for (let j1 = i1 === i ? j + 1 : 0; j1 < this.boardSize; j1++) {
                        const cell1 = this.coords2algebraic(j1, i1);
                        if (this.board.has(cell1)) { continue; }
                        if (cellsFrom.has(cell1)) { continue; }
                        return true;
                    }
                }
            }
        }
        return false;
    }

    protected checkEOG(): Connect6Game {
        const winningLinesMap = this.getWinningLinesMap(this.overline === "ignored" ? [1, 2] : []);
        const winner: playerid[] = [];
        this.winningLines = [];
        for (const player of [1, 2] as playerid[]) {
            if (winningLinesMap.get(player)!.length > 0) {
                winner.push(player);
                this.winningLines.push(...winningLinesMap.get(player)!);
            }
        }
        if (winner.length === 0 && this.pastOpening(1)) {
            if (this.lastmove === "pass" && this.stack[this.stack.length - 1].lastmove === "pass" ||
                    this.ruleset === "default" && !this.hasEmptySpace() ||
                    this.ruleset === "collinear6" && !this.hasMovesCollinear6() ||
                    this.ruleset === "noncollinear5" && !this.hasMovesNonCollinear5()) {
                if (this.passTiebreaker) {
                    if (this.tiebreaker === undefined) {
                        winner.push(this.swapped ? 1 : 2);
                    } else {
                        winner.push(this.tiebreaker);
                    }
                } else {
                    winner.push(1);
                    winner.push(2);
                }
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

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        const renderBoardSize = this.toroidal ? this.boardSize + 2 * this.toroidalPadding : this.boardSize;
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
        const referencePoints: [number, number][] = [];
        if (this.boardSize === 15) {
            referencePoints.push([(this.boardSize - 1) / 2, (this.boardSize - 1) / 2]);
            referencePoints.push([(this.boardSize - 1) / 2 - 4, (this.boardSize - 1) / 2 - 4]);
            referencePoints.push([(this.boardSize - 1) / 2 - 4, (this.boardSize - 1) / 2 + 4]);
            referencePoints.push([(this.boardSize - 1) / 2 + 4, (this.boardSize - 1) / 2 - 4]);
            referencePoints.push([(this.boardSize - 1) / 2 + 4, (this.boardSize - 1) / 2 + 4]);
        } else if (this.boardSize === 19) {
            referencePoints.push([(this.boardSize - 1) / 2, (this.boardSize - 1) / 2]);
            referencePoints.push([(this.boardSize - 1) / 2 - 6, (this.boardSize - 1) / 2 - 6]);
            referencePoints.push([(this.boardSize - 1) / 2 - 6, (this.boardSize - 1) / 2 + 6]);
            referencePoints.push([(this.boardSize - 1) / 2 + 6, (this.boardSize - 1) / 2 - 6]);
            referencePoints.push([(this.boardSize - 1) / 2 + 6, (this.boardSize - 1) / 2 + 6]);
            referencePoints.push([(this.boardSize - 1) / 2, (this.boardSize - 1) / 2 - 6]);
            referencePoints.push([(this.boardSize - 1) / 2, (this.boardSize - 1) / 2 + 6]);
            referencePoints.push([(this.boardSize - 1) / 2 - 6, (this.boardSize - 1) / 2]);
            referencePoints.push([(this.boardSize - 1) / 2 + 6, (this.boardSize - 1) / 2]);
        }
        const referencePointsObj: { row: number, col: number }[] = [];
        for (const point of referencePoints) {
            for (const [x1, y1] of this.renderCoordsAll(...point)) {
                referencePointsObj.push({ row: y1, col: x1 });
            }
        }
        const markers: (MarkerShading|MarkerDots)[] = referencePointsObj.length > 0 ? [{ type: "dots", points: referencePointsObj, size: 0.15 }] as MarkerDots[] : [];
        if (this.toroidal) {
            const end = this.boardSize + 2 * this.toroidalPadding;
            markers.push(...[
                {
                    type: "shading", colour: "#000", opacity: 0.2,
                    points: [{row: 0, col: 0}, {row: 0, col: this.toroidalPadding}, {row: end - 1, col: this.toroidalPadding}, {row: end - 1, col: 0}],
                },
                {
                    type: "shading", colour: "#000", opacity: 0.2,
                    points: [{row: 0, col: end - 1 - this.toroidalPadding}, {row: 0, col: end - 1}, {row: end - 1, col: end - 1}, {row: end - 1, col: end - 1 - this.toroidalPadding}],
                },
                {
                    type: "shading", colour: "#000", opacity: 0.2,
                    points: [{row: 0, col: this.toroidalPadding}, {row: 0, col: end - 1 - this.toroidalPadding}, {row: this.toroidalPadding, col: end - 1 - this.toroidalPadding}, {row: this.toroidalPadding, col: this.toroidalPadding}],
                },
                {
                    type: "shading", colour: "#000", opacity: 0.2,
                    points: [{row: end - 1 - this.toroidalPadding, col: this.toroidalPadding}, {row: end - 1 - this.toroidalPadding, col: end - 1 - this.toroidalPadding}, {row: end - 1, col: end - 1 - this.toroidalPadding}, {row: end - 1, col: this.toroidalPadding}],
                },
            ] as MarkerShading[]);
        }
        // Build rep
        const rep: APRenderRep =  {
            // We use custom star points for toroidal board support.
            options: ["hide-star-points"],
            board: {
                style: "vertex",
                width: renderBoardSize,
                height: renderBoardSize,
                rowLabels: this.toroidal ? this.renderRowLabels() : undefined,
                columnLabels: this.toroidal ? this.renderColLabels() : undefined,
                markers: markers.length > 0 ? markers : undefined,
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
                    type RowCol = {row: number; col: number;};
                    const targets: RowCol[] = [];
                    for (const coords of connPath) {
                        targets.push({row: coords[1], col: coords[0]})
                    }
                    rep.annotations.push({type: "move", targets: targets as [RowCol, ...RowCol[]], arrow: false});
                }
            }
        }
        // If the last move was a pass, we want to annotate the last non-pass move.
        if (this.lastmove === "pass" && !this.isNewResult()) {
            const lastNonPass = this.lastNonPass()!;
            for (const cell of lastNonPass.split(",")) {
                const coordsAll = this.renderAlgebraic2coords(cell);
                for (const [x, y] of coordsAll) {
                    rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                }
            }
        }
        return rep;
    }

    public state(): IConnect6State {
        return {
            game: Connect6Game.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: Connect6Game.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            winningLines: this.winningLines.map(a => [...a]),
            swapped: this.swapped,
            tiebreaker: this.tiebreaker,
        };
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        return status;
    }

    public clone(): Connect6Game {
        return new Connect6Game(this.serialize());
    }
}
