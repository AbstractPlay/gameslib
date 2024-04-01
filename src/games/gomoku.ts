import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { InARowBase } from "./in_a_row/InARowBase";
import { APRenderRep } from "@abstractplay/renderer";

type playerid = 1 | 2;

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
    captureCounts: [number, number];
    winningLines: string[][];
    swapped: boolean;
    tiebreaker?: playerid;
}

export interface IGomokuState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class GomokuGame extends InARowBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Gomoku",
        uid: "gomoku",
        playercounts: [2],
        version: "20240328",
        dateAdded: "2024-03-28",
        // i18next.t("apgames:descriptions.gomoku")
        description: "apgames:descriptions.gomoku",
        urls: ["https://boardgamegeek.com/boardgame/11929/go-moku"],
        people: [],
        variants: [
            { uid: "standard-19", group: "board" },
            { uid: "swap2", group: "opening" },
            { uid: "swap5", group: "opening" },
            { uid: "pass", group: "tiebreaker" },
        ],
        categories: ["goal>align", "mechanic>place", "board>shape>rect", "board>connect>rect", "components>simple"],
        flags: ["experimental", "multistep", "custom-colours", "rotate90"],
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
    public captureCounts: [number, number] = [0, 0];
    public swapped = false;
    public boardSize = 0;
    private openingProtocol: "pro" | "swap2" | "swap5";
    public toroidal = false;
    public winningLineLength = 5;
    public overline = "ignored" as "win" | "ignored" | "forbidden";
    private passTiebreaker = false;
    private tiebreaker?: playerid;

    constructor(state?: IGomokuState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: GomokuGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                captureCounts: [0, 0],
                winningLines: [],
                swapped: false,
                tiebreaker: undefined,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IGomokuState;
            }
            if (state.game !== GomokuGame.gameinfo.uid) {
                throw new Error(`The Gomoku game code cannot process a game of '${state.game}'.`);
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
    }

    public load(idx = -1): GomokuGame {
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
        this.captureCounts = [...state.captureCounts];
        this.winningLines  = state.winningLines.map(a => [...a]);
        this.swapped = state.swapped;
        this.tiebreaker = state.tiebreaker;
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
        return 15;
    }

    private getOpeningProtocol(): "pro" | "swap2" | "swap5" {
        return this.variants.includes("swap2") ? "swap2" : this.variants.includes("swap5") ? "swap5" : "pro";
    }

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }
        const moves: string[] = [];
        if (this.stack.length === 1 && this.openingProtocol === "pro") {
            return [this.coords2algebraic((this.boardSize - 1) / 2, (this.boardSize - 1) / 2)];
        }
        if (this.stack.length === 3 && this.openingProtocol === "pro") {
            for (let row = 0; row < this.boardSize; row++) {
                for (let col = 0; col < this.boardSize; col++) {
                    const cell = this.coords2algebraic(col, row);
                    if (this.isNearCentre(cell, 2)) { continue; }
                    if (!this.board.has(cell)) {
                        moves.push(cell);
                    }
                }
            }
            return moves;
        }
        if (this.stack.length === 1 && this.openingProtocol === "swap2") {
            return ["No movelist in swap2 opening"]
            // The swap2 opening has too many possible moves to list them all.
            // // Get all double cells such that we don't get reversed duplicates.
            // // For example, doubleCells = [["a1", "a2"], ["a2", "a1"]] is not allowed.
            // const doubleCells: string[][] = [];
            // for (let row = 0; row < this.boardSize; row++) {
            //     for (let col = 0; col < this.boardSize; col++) {
            //         const cell = this.coords2algebraic(col, row);
            //         for (let row1 = row; row1 < this.boardSize; row1++) {
            //             for (let col1 = row1 === row ? col + 1 : 0; col1 < this.boardSize; col1++) {
            //                 const cell1 = this.coords2algebraic(col1, row1);
            //                 doubleCells.push([cell, cell1]);
            //             }
            //         }
            //     }
            // }
            // // Now we get a third cell for each doubleCell
            // for (const doubleCell of doubleCells) {
            //     for (let row = 0; row < this.boardSize; row++) {
            //         for (let col = 0; col < this.boardSize; col++) {
            //             const cell = this.coords2algebraic(col, row);
            //             if (!doubleCell.includes(cell)) {
            //                 moves.push(this.normalisePlacement(doubleCell[0] + "," + cell + "," + doubleCell[1]));
            //             }
            //         }
            //     }
            // }
            // return moves;
        }
        for (let row = 0; row < this.boardSize; row++) {
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) { continue; }
                moves.push(cell);
            }
        }
        // This is also for swap2 and it seems like it's also too heavy for the dropdown box.
        // if (this.stack.length === 2 && this.openingProtocol === "swap2") {
        //     // Get all pairs of cells
        //     // We don't check for forbidden self-captures here because it's too expensive.
        //     for (let row = 0; row < this.boardSize; row++) {
        //         for (let col = 0; col < this.boardSize; col++) {
        //             const cell = this.coords2algebraic(col, row);
        //             for (let row1 = 0; row1 < this.boardSize; row1++) {
        //                 for (let col1 = 0; col1 < this.boardSize; col1++) {
        //                     const cell1 = this.coords2algebraic(col1, row1);
        //                     if (cell !== cell1) {
        //                         moves.push(cell + "," + cell1);
        //                     }
        //                 }
        //             }
        //         }
        //     }
        // }
        if (this.canSwap() || this.passTiebreaker && this.tiebreaker === undefined && this.pastOpening()) {
            moves.push("pass");
        }
        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    private canSwap(): boolean {
        if (this.openingProtocol === "pro") { return false; }
        if (this.openingProtocol === "swap2") {
            if (this.stack.length === 2) { return true; }
            if (this.stack.length === 3 && this.stack[2].lastmove?.includes(",")) { return true; }
            return false;
        }
        if (this.openingProtocol === "swap5") {
            if (this.stack.length === 1) { return false; }
            if (this.stack[this.stack.length - 1].lastmove === "pass") { return false; }
            if (this.stack.length > 10) { return false; }
            let count = 0;
            for (const slice of this.stack) {
                if (slice.lastmove !== "pass") { count++; }
                if (count > 6) { return false; }
            }
            return true;
        }
        return false;
    }

    private pastOpening(): boolean {
        // If pass tiebreaker is enabled, we can pass after the opening phase.
        if (this.openingProtocol === "pro") {
            if (this.stack.length > 3) { return true; }
        } else if (this.openingProtocol === "swap2") {
            if (this.stack.length > 3) { return true; }
        } else if (this.openingProtocol === "swap5") {
            if (this.stack.length > 10) { return true; }
            let count = 0;
            for (const slice of this.stack) {
                if (slice.lastmove !== "pass") { count++; }
                if (count > 6) { return true; }
            }
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
        // Normalise placement string for swap2 opening.
        // If there are three placements, sort the first and third placements.
        const moves = m.split(",");
        if (moves.length < 3) { return m; }
        let [first, second, third] = moves;
        [first, third] = this.sort(first, third) === -1 ? [first, third] : [third, first];
        return [first, second, third].join(",");
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
            let message = i18next.t("apgames:validation.gomoku.INITIAL_INSTRUCTIONS");
            if (this.openingProtocol === "swap2") {
                if (this.stack.length === 1) {
                    message = i18next.t("apgames:validation.gomoku.INITIAL_INSTRUCTIONS_SWAP21");
                } else if (this.stack.length === 2) {
                    message = i18next.t("apgames:validation.gomoku.INITIAL_INSTRUCTIONS_SWAP22");
                } else if (this.stack.length === 3 && this.canSwap()) {
                    message = i18next.t("apgames:validation.gomoku.INITIAL_INSTRUCTIONS_SWAP23");
                }
            }
            if (this.openingProtocol === "swap5" && this.canSwap()) {
                message = i18next.t("apgames:validation.gomoku.INITIAL_INSTRUCTIONS_SWAP5");
            }
            if (this.openingProtocol === "pro") {
                if (this.stack.length === 1) {
                    message = i18next.t("apgames:validation.gomoku.INITIAL_INSTRUCTIONS_PRO1");
                } else if (this.stack.length === 3) {
                    message = i18next.t("apgames:validation.gomoku.INITIAL_INSTRUCTIONS_PRO3");
                }
            }
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = message;
            return result;
        }
        if (m === "No movelist in swap2 opening") {
            // Special for swap2 because move list is too large on first move.
            result.valid = false;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.gomoku.NO_MOVELIST");
            return result;
        }

        if (m === "pass") {
            if (!this.pastOpening()) {
                if (!this.canSwap()) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.gomoku.CANNOT_SWAP");
                    return result;
                }
            } else if (this.passTiebreaker) {
                if (this.tiebreaker !== undefined) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.gomoku.TIEBREAKER_TAKEN");
                    return result;
                }
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.gomoku.CANNOT_PASS");
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
                result.message = i18next.t("apgames:validation.gomoku.DUPLICATE", { where: [...duplicates].join(",") });
                return result;
            }
        }
        if (this.openingProtocol === "swap2" && this.stack.length < 3) {
            if (this.stack.length === 1) {
                if (moves.length < 3) {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.gomoku.SWAP21", { count: 3 - moves.length });
                    return result;
                }
                if (moves.length > 3) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.gomoku.SWAP21_EXCESS");
                    return result;
                }
            } else if (this.stack.length === 2) {
                if (moves.length < 2) {
                    result.valid = true;
                    result.complete = 0;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.gomoku.SWAP22_PARTIAL");
                    return result;
                }
                if (moves.length > 2) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.gomoku.SWAP22_EXCESS");
                    return result;
                }
            }
        } else {
            if (moves.length > 1) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.gomoku.EXCESS");
                return result;
            }
        }
        if (this.openingProtocol === "pro") {
            if (this.stack.length === 1 && !this.isNearCentre(moves[0], 0)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.gomoku.PRO_RESTRICTION_FIRST");
                return result;
            }
            if (this.stack.length === 3 && this.isNearCentre(moves[0], 2)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.gomoku.PRO_RESTRICTION_THIRD");
                return result;
            }
        }
        // Since there is no move list for placement phase, we have to do some extra validation.
        const regex = new RegExp(`^([a-z]+[1-9][0-9]*)(,[a-z]+[1-9][0-9]*)*$`);
        if (!regex.test(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.gomoku.INVALID_PLACEMENT", {move: m});
            return result;
        }
        const normalised = this.normalisePlacement(m);
        if (m !== normalised) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.gomoku.NORMALISE", {normalised});
            return result;
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {partial = false, trusted = false} = {}): GomokuGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        let result;
        if (m === "No movelist in swap2 opening") {
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
            // Because move generation is quite heavy, we don't do it for swap2 opening.
            if (!partial && (this.openingProtocol !== "swap2" || this.stack.length > 2) && !this.moves().includes(m)) {
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
                this.tiebreaker = this.currplayer;
                this.results.push({ type: "pass" });
            }
        } else {
            const moves = m.split(",");
            let placePlayer = this.currplayer;
            for (const move of moves) {
                this.results.push({ type: "place", where: move });
                this.board.set(move, placePlayer);
                placePlayer = placePlayer % 2 + 1 as playerid;
            }
        }
        if (partial) { return this; }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): GomokuGame {
        const winningLinesMap = this.getWinningLinesMap();
        const winner: playerid[] = [];
        this.winningLines = [];
        for (const player of [1, 2] as playerid[]) {
            if (winningLinesMap.get(player)!.length > 0) {
                winner.push(player);
                this.winningLines.push(...winningLinesMap.get(player)!);
            }
        }
        if (winner.length === 0) {
            const allMoves = this.moves();
            if (this.passTiebreaker) {
                if (allMoves.length === 0 || allMoves.length === 1 && allMoves[0] === "pass") {
                    if (this.tiebreaker === undefined) {
                        winner.push(this.swapped ? 1 : 2);
                    } else {
                        winner.push(this.tiebreaker);
                    }
                }
            } else {
                if (allMoves.length === 0) {
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
        let markers: Array<any> | undefined = []
        if (this.variants.includes("capture-2-3")) {
            markers.push({
                belowGrid: true, type: "shading", colour: "#FFA500", opacity: 0.1,
                points: [{row: 0, col: 0}, {row: 0, col: renderBoardSize - 1}, {row: renderBoardSize - 1, col: renderBoardSize - 1}, {row: renderBoardSize - 1, col: 0}],
            });
        }
        if (this.openingProtocol === "pro" && this.stack.length === 1) {
            markers.push({
                type: "dots", points: [{ row: (renderBoardSize - 1) / 2, col: (renderBoardSize - 1) / 2 }]
            });
        }
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
            ]);
        }
        if (markers.length === 0) {
            markers = undefined;
        }
        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "vertex",
                width: renderBoardSize,
                height: renderBoardSize,
                rowLabels: this.toroidal ? this.renderRowLabels() : undefined,
                columnLabels: this.toroidal ? this.renderColLabels() : undefined,
                markers,
            },
            legend: {
                A: [{ name: "piece", player: this.getPlayerColour(1) as playerid }],
                B: [{ name: "piece", player: this.getPlayerColour(2) as playerid }],
            },
            pieces: pstr,
        };

        // @ts-ignore
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
                    // @ts-ignore
                    rep.annotations.push({type: "move", targets, arrow: false});
                }
            }
        }
        return rep;
    }

    public state(): IGomokuState {
        return {
            game: GomokuGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: GomokuGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            captureCounts: [...this.captureCounts],
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

    public clone(): GomokuGame {
        return new GomokuGame(this.serialize());
    }
}
