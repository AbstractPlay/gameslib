import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { InARowBase } from "./in_a_row/InARowBase";
import { APRenderRep } from "@abstractplay/renderer";

type playerid = 1 | 2;
const openingProtocols = ["centre", "rif", "taraguchi-10", "soosyrv-8", "yamaguchi", "swap-2", "swap-5"] as const;
type OpeningProtocol = typeof openingProtocols[number];
const renjuMove2s: Set<string> = new Set(["h9", "i9"]);
const renjuMove3is: Set<string> = new Set([
    "j10", "j9", "j8", "j7", "j6", "i8", "i7", "i6", "h7", "h6", "g7", "g6", "f6",
]);
const renjuMove3ds: Set<string> = new Set([
    "h10", "i10", "j10", "i9", "j9", "i8", "j8", "h7", "i7", "j7", "h6", "i6", "j6",
]);

interface ILooseObj {
    [key: string]: any;
}


interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
    captureCounts: [number, number];
    winningLines: string[][];
    swapped: boolean;
    tiebreaker?: playerid;
    tentativeCount: number | undefined;
    tentatives: string[];
}

export interface IRenjuState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class RenjuGame extends InARowBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Renju",
        uid: "renju",
        playercounts: [2],
        version: "20240328",
        dateAdded: "2024-03-28",
        // i18next.t("apgames:descriptions.renju")
        description: "apgames:descriptions.renju",
        urls: ["https://boardgamegeek.com/boardgame/11929/go-moku"],
        people: [],
        variants: [
            { uid: "rif", group: "opening" },
            { uid: "taraguchi-10", group: "opening" },
            { uid: "soosyrv-8", group: "opening" },
            { uid: "yamaguchi", group: "opening" },
            { uid: "swap-2", group: "opening" },
            { uid: "swap-5", group: "opening" },
            { uid: "pass", group: "tiebreaker" },
        ],
        categories: ["goal>align", "mechanic>place", "board>shape>rect", "board>connect>rect", "components>simple>1per", "mechanic>asymmetry"],
        flags: ["experimental", "multistep", "custom-colours", "rotate90"],
        displays: [{uid: "hide-restrictions"}],
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
    private openingProtocol: OpeningProtocol;
    public toroidal = false;
    public winningLineLength = 5;
    public overline = "ignored" as "win" | "ignored" | "forbidden";
    private passTiebreaker = false;
    private tiebreaker?: playerid;
    private tentativeCount: number | undefined;
    private tentatives: string[] = [];
    private _points: [number, number][] = [];

    constructor(state?: IRenjuState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: RenjuGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                captureCounts: [0, 0],
                winningLines: [],
                swapped: false,
                tiebreaker: undefined,
                tentativeCount: this.variants.includes("rif") ? 2 : undefined,
                tentatives: [],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IRenjuState;
            }
            if (state.game !== RenjuGame.gameinfo.uid) {
                throw new Error(`The Renju game code cannot process a game of '${state.game}'.`);
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

    public load(idx = -1): RenjuGame {
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
        this.tentativeCount = state.tentativeCount;
        this.tentatives = [...state.tentatives];
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

    private getOpeningProtocol(): OpeningProtocol {
        // Get opening protocol from variants.
        const openingVariants = this.variants.filter(v => openingProtocols.includes(v as OpeningProtocol));
        if (openingVariants.length > 0) {
            return openingVariants[0] as OpeningProtocol;
        }
        return "centre";
    }

    private hasMoveGeneration(): boolean {
        // Whether move generation is programmed for the current move.
        // Some of these are just too large, and for others I just haven't bothered for now.
        // TOOD: Implement move generation for these.
        if (this.openingProtocol === "swap-2" && this.stack.length < 3) { return false; }
        if (this.openingProtocol === "rif" || this.openingProtocol === "yamaguchi") {
            if (this.stack.length === 1) { return false; }
            if (this.stack.length > 6) { return true; }
            const placeMoveCount = this.placeMoveCount();
            if (placeMoveCount === 2 || placeMoveCount === 3) { return false; }
        }
        if (this.openingProtocol === "taraguchi-10") {
            if (this.stack.length > 10) { return true; }
            const placeMoveCount = this.placeMoveCount();
            if (placeMoveCount < 5) { return false; }
            if (placeMoveCount === 5 && this.tentativeCount === 10) { return false; }
        }
        if (this.openingProtocol === "soosyrv-8") {
            if (this.stack.length > 7) { return true; }
            const placeMoveCount = this.placeMoveCount();
            if (placeMoveCount < 4) { return false; }
        }
        return true;
    }

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }
        if (!this.hasMoveGeneration()) { return ["No movelist in opening"] }
        const moves: string[] = [];
        if (this.stack.length === 1 && this.openingProtocol === "centre") {
            return [this.coords2algebraic((this.boardSize - 1) / 2, (this.boardSize - 1) / 2)];
        }
        for (let row = 0; row < this.boardSize; row++) {
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) { continue; }
                moves.push(cell);
            }
        }
        if (this.canSwap() || this.pastOpening()) {
            moves.push("pass");
        }
        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    private canSwap(): boolean {
        // Check if the player is able to invoke the pie rule on this turn.
        if (this.openingProtocol === "rif" || this.openingProtocol === "yamaguchi") {
            if (this.stack.length === 2) { return true; }
        }
        if (this.openingProtocol === "taraguchi-10") {
            if (this.stack.length > 10) { return false; }
            if (this.stack.length === 1) { return false; }
            if (this.stack[this.stack.length - 1].lastmove === "pass") { return false; }
            const placeMoveCount = this.placeMoveCount();
            if (placeMoveCount < 5) { return true; }
            if (placeMoveCount === 5 && this.tentativeCount === undefined) { return true; }
        }
        if (this.openingProtocol === "soosyrv-8") {
            if (this.stack.length > 7) { return false; }
            if (this.stack.length === 2) { return true; }
            if (this.stack[this.stack.length - 1].lastmove === "pass") { return false; }
            const placeMoveCount = this.placeMoveCount();
            if (placeMoveCount === 2) { return true; }
        }
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

    private pastOpening(buffer = 2): boolean {
        // This is usually used to check if we are past the opening phase so that players can pass.
        // Pass is also used to invoke the pie rule during the opening phase.
        // For safety, passing is not allowed for the first two moves after the opening phase.
        if (this.openingProtocol === "centre") {
            if (this.stack.length > 1 + buffer) { return true; }
        } else if (this.openingProtocol === "rif" || this.openingProtocol === "yamaguchi") {
            return this.pastOpeningFunc(4, 1, false, buffer);
        } else if (this.openingProtocol === "taraguchi-10") {
            if (this.stack.length > 10 + buffer) { return true; }
            const placeMoveCount = this.placeMoveCount();
            if (placeMoveCount < 5) { return false; }
            if (this.tentativeCount === 10) {
                return this.pastOpeningFunc(6, 4, false, buffer);
            } else {
                return this.pastOpeningFunc(5, 4, true, buffer);
            }
        } else if (this.openingProtocol === "soosyrv-8") {
            return this.pastOpeningFunc(4, 2, false, buffer);
        } else if (this.openingProtocol === "swap-2") {
            if (this.stack.length < 3) { return false; }
            if (this.stack.length > 4 + buffer) { return true; }
            if (this.stack[2].lastmove?.includes(",")) {
                return this.pastOpeningFunc(2, 0, true, buffer);
            } else {
                return this.pastOpeningFunc(1, 0, true, buffer);
            }
        } else if (this.openingProtocol === "swap-5") {
            return this.pastOpeningFunc(5, 4, true, buffer);
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
        // Apply normalisation if relevant.
        if (this.openingProtocol === "swap-2") {
            // Normalise placement string for swap-2 opening.
            // If there are three placements, sort the first and third placements.
            const moves = m.split(",");
            if (moves.length < 3) { return m; }
            let [first, second, third] = moves;
            [first, third] = this.sort(first, third) === -1 ? [first, third] : [third, first];
            return [first, second, third].join(",");
        } else if (this.openingProtocol === "rif" || this.openingProtocol === "yamaguchi") {
            const moves = m.split(",");
            if (moves.length < 2) { return m; }
            if (this.stack.length === 1) { return m; }
            if (this.stack.length > 6) { return m; }
            if (this.placeMoveCount() === 2) { return moves.sort((a, b) => this.sort(a, b)).join(",") };
            return m;
        } else if (this.openingProtocol === "soosyrv-8") {
            const moves = m.split(",");
            if (moves.length < 2) { return m; }
            if (this.stack.length === 1) { return m; }
            if (this.stack.length > 7) { return m; }
            if (this.placeMoveCount() === 2) { return moves.sort((a, b) => this.sort(a, b)).join(",") };
            return m;
        } else if (this.openingProtocol === "taraguchi-10") {
            const moves = m.split(",");
            if (moves.length < 2) { return m; }
            if (this.stack.length === 1) { return m; }
            if (this.stack.length > 10) { return m; }
            if (this.placeMoveCount() === 4) { return moves.sort((a, b) => this.sort(a, b)).join(",") };
            return m;
        }
        return m;
    }

    private isSymmetric(moves: string[]): boolean {
        // This is specifically for placement of tentative fifths in some openings.
        // Because we normalise the first three stones, the board is only symmetric
        // if all four stones on the board are either on the same vertical or positive diagonal.
        // If either is true, then we just check for reflection across the respective axes.
        if ([...this.board.keys()].every(k => this.algebraic2coords(k)[0] === (this.boardSize - 1) / 2)) {
            for (let i = 0; i < moves.length; i++) {
                for (let j = i + 1; j < moves.length; j++) {
                    const [xi, yi] = this.algebraic2coords(moves[i]);
                    const [xj, yj] = this.algebraic2coords(moves[j]);
                    if (yi === yj && (xi + xj) / 2 === (this.boardSize - 1) / 2) {
                        return true;
                    }
                }
            }
        }
        if ([...this.board.keys()].every(k => this.algebraic2coords(k).reduce((a, b) => a + b) === this.boardSize - 1)) {
            for (let i = 0; i < moves.length; i++) {
                for (let j = i + 1; j < moves.length; j++) {
                    const [xi, yi] = this.algebraic2coords(moves[i]);
                    const [xj, yj] = this.algebraic2coords(moves[j]);
                    if (xi + yj === this.boardSize - 1 && xj + yi === this.boardSize - 1) { return true; }
                }
            }
        }
        return false;
    }

    private requireTentativeCount(): boolean {
        if (this.openingProtocol === "soosyrv-8" && this.stack.length < 4 && this.placeMoveCount() === 1) {
            return true;
        }
        if (this.openingProtocol === "yamaguchi" && this.stack.length === 1) {
            return true;
        }
        return false;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = "";
            const cell = this.renderCoords2algebraic(col, row);
            if (move === "") {
                newmove = cell;
            } else if (this.showTenteativeCountSelector(move.split(",").length)) {
                const tentativeCountSelector = this.getTentativeCountSelector();
                if (tentativeCountSelector.has(cell)) {
                    newmove = `${move},${tentativeCountSelector.get(cell)}`;
                } else {
                    newmove = move;
                }
            } else {
                if (this.openingProtocol === "taraguchi-10" && this.stack.length < 9 && this.placeMoveCount() === 4 ||
                        ["rif", "soosyrv-8", "yamaguchi"].includes(this.openingProtocol) && this.stack.length < 5 && this.placeMoveCount() === 2) {
                    const moves = move.split(",");
                    if (moves.includes(cell)) {
                        newmove = this.normalisePlacement(move.split(",").filter(m => m !== cell).join(","));
                    }
                    else {
                        newmove = this.normalisePlacement(move + "," + cell);
                    }
                } else {
                    newmove = this.normalisePlacement(move + "," + cell);
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

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        if (m.length === 0) {
            let message = i18next.t("apgames:validation._inarow.INITIAL_INSTRUCTIONS");
            if (this.openingProtocol === "swap-2") {
                if (this.stack.length === 1) {
                    message = i18next.t("apgames:validation._inarow.INITIAL_INSTRUCTIONS_SWAP21");
                } else if (this.stack.length === 2) {
                    message = i18next.t("apgames:validation._inarow.INITIAL_INSTRUCTIONS_SWAP22");
                } else if (this.stack.length === 3 && this.canSwap()) {
                    message = i18next.t("apgames:validation._inarow.INITIAL_INSTRUCTIONS_SWAP23");
                }
            } else if (this.openingProtocol === "swap-5") {
                if (this.canSwap()) {
                    message = i18next.t("apgames:validation._inarow.INITIAL_INSTRUCTIONS_SWAP5");
                }
            } else if (this.openingProtocol === "centre") {
                if (this.stack.length === 1) {
                    message = i18next.t("apgames:validation._inarow.INITIAL_INSTRUCTIONS_CENTRE1");
                }
            } else if (this.openingProtocol === "rif") {
                if (this.stack.length < 6) {
                    if (this.stack.length === 1) {
                        message = i18next.t("apgames:validation.renju.INITIAL_INSTRUCTIONS_RIF1");
                    }
                    const placeMoveCount = this.placeMoveCount();
                    if (placeMoveCount === 1) {
                        if (this.stack[this.stack.length - 1].lastmove === "pass") {
                            message = i18next.t("apgames:validation.renju.INITIAL_INSTRUCTIONS_RIF2_PASSED");
                        } else {
                            message = i18next.t("apgames:validation.renju.INITIAL_INSTRUCTIONS_RIF2");
                        }
                    } else if (placeMoveCount === 2) {
                        message = i18next.t("apgames:validation.renju.INITIAL_INSTRUCTIONS_RIF3");
                    } else if (placeMoveCount === 3) {
                        message = i18next.t("apgames:validation.renju.INITIAL_INSTRUCTIONS_RIF4");
                    }
                }
            } else if (this.openingProtocol === "soosyrv-8") {
                if (this.stack.length < 7) {
                    if (this.stack.length === 1) {
                        message = i18next.t("apgames:validation.renju.INITIAL_INSTRUCTIONS_SOOSYRV1");
                    }
                    const placeMoveCount = this.placeMoveCount();
                    if (placeMoveCount === 1) {
                        if (this.stack[this.stack.length - 1].lastmove === "pass") {
                            message = i18next.t("apgames:validation.renju.INITIAL_INSTRUCTIONS_SOOSYRV2_PASSED");
                        } else {
                            message = i18next.t("apgames:validation.renju.INITIAL_INSTRUCTIONS_SOOSYRV2");
                        }
                    } else if (placeMoveCount === 2) {
                        if (this.stack[this.stack.length - 1].lastmove === "pass") {
                            message = i18next.t("apgames:validation.renju.INITIAL_INSTRUCTIONS_SOOSYRV3_PASSED", { count: this.tentativeCount });
                        } else {
                            message = i18next.t("apgames:validation.renju.INITIAL_INSTRUCTIONS_SOOSYRV3", { count: this.tentativeCount });
                        }
                    } else if (placeMoveCount === 3) {
                        message = i18next.t("apgames:validation.renju.INITIAL_INSTRUCTIONS_SOOSYRV4");
                    }
                }
            } else if (this.openingProtocol === "taraguchi-10") {
                if (this.stack.length < 11) {
                    if (this.stack.length === 1) {
                        message = i18next.t("apgames:validation.renju.INITIAL_INSTRUCTIONS_TARAGUCHI1");
                    }
                    const placeMoveCount = this.placeMoveCount();
                    if (placeMoveCount === 1) {
                        if (this.stack[this.stack.length - 1].lastmove === "pass") {
                            message = i18next.t("apgames:validation.renju.INITIAL_INSTRUCTIONS_TARAGUCHI2_PASSED");
                        } else {
                            message = i18next.t("apgames:validation.renju.INITIAL_INSTRUCTIONS_TARAGUCHI2");
                        }
                    } else if (placeMoveCount === 2) {
                        if (this.stack[this.stack.length - 1].lastmove === "pass") {
                            message = i18next.t("apgames:validation.renju.INITIAL_INSTRUCTIONS_TARAGUCHI3_PASSED");
                        } else {
                            message = i18next.t("apgames:validation.renju.INITIAL_INSTRUCTIONS_TARAGUCHI3");
                        }
                    } else if (placeMoveCount === 3) {
                        if (this.stack[this.stack.length - 1].lastmove === "pass") {
                            message = i18next.t("apgames:validation.renju.INITIAL_INSTRUCTIONS_TARAGUCHI4_PASSED");
                        } else {
                            message = i18next.t("apgames:validation.renju.INITIAL_INSTRUCTIONS_TARAGUCHI4");
                        }
                    } else if (placeMoveCount === 4) {
                        if (this.stack[this.stack.length - 1].lastmove === "pass") {
                            message = i18next.t("apgames:validation.renju.INITIAL_INSTRUCTIONS_TARAGUCHI5_PASSED");
                        } else {
                            message = i18next.t("apgames:validation.renju.INITIAL_INSTRUCTIONS_TARAGUCHI5");
                        }
                    } else if (placeMoveCount === 5) {
                        if (this.tentativeCount === 10) {
                            message = i18next.t("apgames:validation.renju.INITIAL_INSTRUCTIONS_TARAGUCHI6_CHOOSE");
                        } else if (this.stack[this.stack.length - 1].lastmove !== "pass") {
                            message = i18next.t("apgames:validation.renju.INITIAL_INSTRUCTIONS_TARAGUCHI6");
                        }
                    }
                }
            } else if (this.openingProtocol === "yamaguchi") {
                if (this.stack.length < 6) {
                    if (this.stack.length === 1) {
                        message = i18next.t("apgames:validation.renju.INITIAL_INSTRUCTIONS_YAMAGUCHI1");
                    }
                    const placeMoveCount = this.placeMoveCount();
                    if (placeMoveCount === 1) {
                        if (this.stack[this.stack.length - 1].lastmove === "pass") {
                            message = i18next.t("apgames:validation.renju.INITIAL_INSTRUCTIONS_YAMAGUCHI2_PASSED");
                        } else {
                            message = i18next.t("apgames:validation.renju.INITIAL_INSTRUCTIONS_YAMAGUCHI2");
                        }
                    } else if (placeMoveCount === 2) {
                        message = i18next.t("apgames:validation.renju.INITIAL_INSTRUCTIONS_YAMAGUCHI3", { count: this.tentativeCount });
                    } else if (placeMoveCount === 3) {
                        message = i18next.t("apgames:validation.renju.INITIAL_INSTRUCTIONS_YAMAGUCHI4", { count: this.tentativeCount });
                    }
                }
            }
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = message;
            return result;
        }
        if (m === "No movelist in opening") {
            // Special for swap-2 because move list is too large on first move.
            result.valid = false;
            result.complete = -1;
            result.message = i18next.t("apgames:validation._inarow.NO_MOVELIST");
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
        let tentativeCount = 0;
        const moves = m.split(",");
        // Valid cell
        let currentMove;
        let currentIndex;
        try {
            for (const [i, p] of moves.entries()) {
                currentMove = p;
                currentIndex = i;
                const [x, y] = this.algebraic2coords(p);
                // `algebraic2coords` does not check if the cell is on the board.
                if (x < 0 || x >= this.boardSize || y < 0 || y >= this.boardSize) {
                    throw new Error("Invalid cell");
                }
            }
        } catch {
            if (currentIndex === moves.length - 1 && Number(currentMove) > 0 && this.requireTentativeCount()) {
                tentativeCount = Number(currentMove);
                moves.pop();
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: currentMove });
                return result;
            }
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
        // Since there is no move list for placement phase, we have to do some extra validation.
        const regex = new RegExp(`^([a-z]+[1-9][0-9]*)(,[a-z]+[1-9][0-9]*)*(,[1-9][0-9]*)?$`);
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
        // Opening validations
        if (this.openingProtocol === "centre") {
            if (this.stack.length === 1 && !this.isNearCentre(moves[0], 0)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._inarow.CENTRE_OFFCENTRE");
                return result;
            }
        }
        let max1 = true;
        if (this.openingProtocol === "swap-2") {
            if (this.stack.length === 1) {
                if (moves.length < 3) {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation._inarow.SWAP21", { count: 3 - moves.length });
                    return result;
                }
                if (moves.length > 3) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._inarow.SWAP21_EXCESS");
                    return result;
                }
                max1 = false;
            } else if (this.stack.length === 2) {
                if (moves.length < 2) {
                    result.valid = true;
                    result.complete = 0;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation._inarow.SWAP22_PARTIAL");
                    return result;
                }
                if (moves.length > 2) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._inarow.SWAP22_EXCESS");
                    return result;
                }
                max1 = false;
            }
        } else if (this.openingProtocol === "rif") {
            if (this.stack.length === 1) {
                if (this.classicOpening(result, moves)) { return result; }
                max1 = false;
            } else {
                if (this.stack.length < 6) {
                    const placeMoveCount = this.placeMoveCount();
                    if (placeMoveCount === 2) {
                        if (moves.length === 1) {
                            result.valid = true;
                            result.complete = -1;
                            result.canrender = true;
                            result.message = i18next.t("apgames:validation.renju.RIF32");
                            return result;
                        }
                        if (moves.length > 2) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.renju.RIF3_EXCESS");
                            return result;
                        }
                        if (this.isSymmetric(moves)) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.renju.SYMMETRY");
                            return result;
                        }
                        max1 = false;
                    } else if (placeMoveCount === 3) {
                        const tentatives = this.stack[this.stack.length - 1].tentatives;
                        if (moves.length >= 1 && !tentatives.includes(moves[0])) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.renju.RIF4_CHOOSE");
                            return result;
                        }
                        if (moves.length === 1) {
                            result.valid = true;
                            result.complete = -1;
                            result.canrender = true;
                            result.message = i18next.t("apgames:validation.renju.RIF42");
                            return result;
                        }
                        if (moves.length > 2) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.renju.RIF4_EXCESS");
                            return result;
                        }
                        max1 = false;
                    }
                }
            }
        } else if (this.openingProtocol === "soosyrv-8") {
            if (this.stack.length === 1) {
                if (this.classicOpening(result, moves)) { return result; }
                max1 = false;
            } else {
                if (this.stack.length < 7) {
                    const placeMoveCount = this.placeMoveCount();
                    if (placeMoveCount === 1) {
                        if (tentativeCount > 0 && moves.length < 1) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.renju.SOOSYRV2_STONES_BEFORE_TENTATIVE");
                            return result;
                        }
                        if (tentativeCount === 0) {
                            if (moves.length > 1) {
                                result.valid = false;
                                result.message = i18next.t("apgames:validation._inarow.EXCESS");
                                return result;
                            }
                            result.valid = true;
                            result.complete = -1;
                            result.canrender = true;
                            result.message = i18next.t("apgames:validation.renju.SOOSYRV2_TENTATIVE");
                            return result;
                        }
                        if (tentativeCount > 8) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.renju.SOOSYRV2_TENTATIVE_COUNT_EXCEED");
                            return result;
                        }
                        max1 = false;
                    } else if (placeMoveCount === 2) {
                        const tentativeCountChosen = this.stack[this.stack.length - 1].tentativeCount!;
                        if (moves.length < tentativeCountChosen) {
                            result.valid = true;
                            result.complete = -1;
                            result.canrender = true;
                            result.message = i18next.t("apgames:validation.renju.SOOSYRV3_MORE", { count: tentativeCountChosen - moves.length });
                            return result;

                        }
                        if (moves.length > tentativeCountChosen) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.renju.SOOSYRV3_EXCESS", { count: tentativeCountChosen });
                            return result;
                        }
                        if (this.isSymmetric(moves)) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.renju.SYMMETRY");
                            return result;
                        }
                        max1 = false;
                    } else if (placeMoveCount === 3) {
                        const tentatives = this.stack[this.stack.length - 1].tentatives;
                        if (moves.length >= 1 && !tentatives.includes(moves[0])) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.renju.SOOSYRV4_CHOOSE", { count: this.tentativeCount });
                            return result;
                        }
                        if (moves.length === 1) {
                            result.valid = true;
                            result.complete = -1;
                            result.canrender = true;
                            result.message = i18next.t("apgames:validation.renju.SOOSYRV42");
                            return result;
                        }
                        if (moves.length > 2) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.renju.SOOSYRV4_EXCESS");
                            return result;
                        }
                        max1 = false;
                    }
                }
            }
        } else if (this.openingProtocol === "taraguchi-10") {
            if (this.stack.length < 11) {
                const placeMoveCount = this.placeMoveCount();
                if (this.stack.length === 1 && !this.isNearCentre(moves[0], 0)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.renju.TARAGUCHI_RESTRICTION1");
                    return result;
                } else if (placeMoveCount === 1 && !renjuMove2s.has(moves[0])) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.renju.TARAGUCHI_RESTRICTION2");
                    return result;
                } else if (placeMoveCount === 2) {
                    const lastPlace = this.stack[this.stack.length - 1].lastmove === "pass" ? this.stack[this.stack.length - 2].lastmove : this.stack[this.stack.length - 1].lastmove;
                    if (lastPlace === "i9" && !renjuMove3is.has(moves[0]) || lastPlace !== "i9" && !renjuMove3ds.has(moves[0])) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.renju.TARAGUCHI_RESTRICTION3");
                        return result;
                    }
                } else if (placeMoveCount === 3 && !this.isNearCentre(moves[0], 3)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.renju.TARAGUCHI_RESTRICTION4");
                    return result;
                } else if (placeMoveCount === 4) {
                    if (moves.length === 1) {
                        if (this.stack[this.stack.length - 1].lastmove === "pass") {
                            if (!this.isNearCentre(moves[0], 4)) {
                                result.valid = false;
                                result.message = i18next.t("apgames:validation.renju.TARAGUCHI_RESTRICTION5");
                                return result;
                            }
                        } else {
                            if (!this.isNearCentre(moves[0], 4)) {
                                result.valid = true;
                                result.complete = -1;
                                result.canrender = true;
                                result.message = i18next.t("apgames:validation.renju.TARAGUCHI_RESTRICTION5_MORE", { count: 9 });
                                return result;
                            } else  {
                                result.valid = true;
                                result.complete = 0;
                                result.canrender = true;
                                result.message = i18next.t("apgames:validation.renju.TARAGUCHI_RESTRICTION5_INSIDE");
                                return result;
                            }
                        }
                    } else if (this.stack[this.stack.length - 1].lastmove !== "pass") {
                        if (this.isSymmetric(moves)) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.renju.SYMMETRY");
                            return result;
                        }
                        if (moves.length < 10) {
                            result.valid = true;
                            result.complete = -1;
                            result.canrender = true;
                            result.message = i18next.t("apgames:validation.renju.TARAGUCHI_RESTRICTION5_MORE", { count: 10 - moves.length });
                            return result;
                        }
                        if (moves.length > 10) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.renju.TARAGUCHI_RESTRICTION5_EXCESS");
                            return result;
                        }
                        max1 = false;
                    }
                } else if (placeMoveCount === 5 && this.tentativeCount === 10) {
                    const tentatives = this.stack[this.stack.length - 1].tentatives;
                    if (moves.length >= 1 && !tentatives.includes(moves[0])) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.renju.TARAGUCHI6_CHOOSE");
                        return result;
                    }
                    if (moves.length === 1) {
                        result.valid = true;
                        result.complete = -1;
                        result.canrender = true;
                        result.message = i18next.t("apgames:validation.renju.TARAGUCHI62");
                        return result;
                    }
                    if (moves.length > 2) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.renju.TARAGUCHI6_EXCESS");
                        return result;
                    }
                    max1 = false;
                }
            }
        } else if (this.openingProtocol === "yamaguchi") {
            if (this.stack.length === 1) {
                if (this.classicOpening(result, moves)) { return result; }
                if (tentativeCount > 0 && moves.length < 3) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.renju.YAMAGUCHI1_STONES_BEFORE_TENTATIVE");
                    return result;
                }
                if (tentativeCount === 0) {
                    if (moves.length > 3) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.renju.YAMAGUCHI1_EXCESS");
                        return result;
                    }
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.renju.YAMAGUCHI1_TENTATIVE", { count: 3 - moves.length });
                    return result;
                }
                if (tentativeCount > 12) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.renju.YAMAGUCHI1_TENTATIVE_COUNT_EXCEED");
                    return result;
                }
                max1 = false;
            } else {
                if (this.stack.length < 6) {
                    const placeMoveCount = this.placeMoveCount();
                    if (placeMoveCount === 2) {
                        const tentativeCountChosen = this.stack[this.stack.length - 1].tentativeCount!;
                        if (moves.length > tentativeCountChosen) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.renju.YAMAGUCHI3_EXCESS", { count: tentativeCountChosen });
                            return result;
                        }
                        if (this.isSymmetric(moves)) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.renju.SYMMETRY");
                            return result;
                        }
                        if (moves.length < tentativeCountChosen) {
                            result.valid = true;
                            result.complete = -1;
                            result.canrender = true;
                            result.message = i18next.t("apgames:validation.renju.YAMAGUCHI3_MORE", { count: tentativeCountChosen - moves.length });
                            return result;
                        }
                        max1 = false;
                    } else if (placeMoveCount === 3) {
                        const tentatives = this.stack[this.stack.length - 1].tentatives;
                        if (moves.length >= 1 && !tentatives.includes(moves[0])) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.renju.YAMAGUCHI4_CHOOSE");
                            return result;
                        }
                        if (moves.length === 1) {
                            result.valid = true;
                            result.complete = -1;
                            result.canrender = true;
                            result.message = i18next.t("apgames:validation.renju.YAMAGUCHI42");
                            return result;
                        }
                        if (moves.length > 2) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.renju.YAMAGUCHI4_EXCESS");
                            return result;
                        }
                        max1 = false;
                    }
                }
            }
        }
        if (max1 && moves.length > 1) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._inarow.EXCESS");
            return result;
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private classicOpening(result: IValidationResult, moves: string[]): boolean {
        // Check for classic opening where the first player places three stones.
        // `result` will be mutated and it may be returned from the validation
        // method directly if this method returns true.
        if (moves.length >= 1) {
            if (!this.isNearCentre(moves[0], 0)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.renju.RENJU_OPENING1_INCORRECT");
                return true;
            }
        }
        if (moves.length >= 2) {
            if (!renjuMove2s.has(moves[1])) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.renju.RENJU_OPENING2_INCORRECT");
                return true;
            }
        }
        if (moves.length >= 3) {
            if (moves[1] === "i9" && !renjuMove3is.has(moves[2]) || moves[1] !== "i9" && !renjuMove3ds.has(moves[2])) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.renju.RENJU_OPENING3_INCORRECT");
                return true;
            }
        }
        if (moves.length === 1) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.renju.RENJU_OPENING2");
            return true;
        } else if (moves.length === 2) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.renju.RENJU_OPENING3");
            return true;
        }
        if (moves.length > 3) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.renju.RENJU_OPENING_EXCESS");
            return true;
        }
        return false;
    }

    public move(m: string, {partial = false, trusted = false} = {}): RenjuGame {
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
            // Because move generation is quite heavy, we don't do it for swap-2 opening.
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
            const split = m.split(",");
            let moves = []
            let tentativeCount = 0;
            if (this.openingProtocol === "soosyrv-8" && this.requireTentativeCount() && split.length === 2 ||
                    this.openingProtocol === "yamaguchi" && this.requireTentativeCount() && split.length === 4) {
                moves = split.slice(0, -1);
                tentativeCount = Number(split[split.length - 1]);
            } else {
                moves = split;
            }
            let placePlayer = this.currplayer;
            this.tentatives = [];
            let chooseTentative = false;
            if (["rif", "soosyrv-8", "yamaguchi"].includes(this.openingProtocol) && this.stack.length < 6 && this.placeMoveCount() === 2 ||
                    this.openingProtocol === "taraguchi-10" && (moves.length === 1 && !this.isNearCentre(moves[0], 4) || moves.length > 1) && this.stack.length < 10 && this.placeMoveCount() === 4) {
                if (this.openingProtocol === "taraguchi-10") {
                    // For Taraguchi, the declare result should be at the top.
                    this.tentativeCount = 10;
                    this.results.push({ type: "declare", count: tentativeCount });
                }
                for (const move of moves) {
                    this.results.push({ type: "place", where: move, what: "tentative" });
                    this.tentatives.push(move);
                }
            } else {
                if (["rif", "soosyrv-8", "yamaguchi"].includes(this.openingProtocol) && this.stack.length < 7 && this.placeMoveCount() === 3 ||
                        this.openingProtocol === "taraguchi-10" && this.tentativeCount === 10 && this.stack.length < 11 && this.placeMoveCount() === 5) {
                    // First stone is to choose tentative stone, so we can just swap `placePlayer`.
                    placePlayer = placePlayer % 2 + 1 as playerid;
                    chooseTentative = true;
                }
                for (const move of moves) {
                    this.results.push({ type: "place", where: move, what: chooseTentative ? "choose" : undefined });
                    this.board.set(move, placePlayer);
                    placePlayer = placePlayer % 2 + 1 as playerid;
                }
            }
            if (tentativeCount > 0 && this.openingProtocol !== "taraguchi-10") {
                this.tentativeCount = tentativeCount;
                this.results.push({ type: "declare", count: tentativeCount });
            }
            this._points = [];
            if (this.stack.length === 1) {
                if (["rif", "soosyrv-8", "yamaguchi"].includes(this.openingProtocol)) {
                    if (moves.length === 1) {
                        for (const move of renjuMove2s) {
                            this._points.push(this.algebraic2coords(move));
                        }
                    } else if (moves.length === 2) {
                        if (moves[1] === "i9") {
                            for (const move of renjuMove3is) {
                                this._points.push(this.algebraic2coords(move));
                            }
                        } else {
                            for (const move of renjuMove3ds) {
                                this._points.push(this.algebraic2coords(move));
                            }
                        }
                    }
                }
            }
        }
        if (partial) { return this; }
        this._points = [];

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): RenjuGame {
        const winningLinesMap = this.getWinningLinesMap();
        const winner: playerid[] = [];
        this.winningLines = [];
        for (const player of [1, 2] as playerid[]) {
            if (winningLinesMap.get(player)!.length > 0) {
                winner.push(player);
                this.winningLines.push(...winningLinesMap.get(player)!);
            }
        }
        if (winner.length === 0 && this.currplayer === this.getPlayerColour(2)) {
            if (this.lastmove !== undefined && !this.specialMove(this.lastmove) && this.lastmove !== "pass" && this.lastmove.split(",").length === 1) {
                const player1 = this.getPlayerColour(1) as playerid;
                if (this.isRenjuFoul(...this.algebraic2coords(this.lastmove), player1)) {
                    winner.push(this.currplayer);
                }
            }

        }
        if (winner.length === 0 && this.pastOpening(1)) {
            const allMoves = this.moves();
            if (this.lastmove === "pass" && this.stack[this.stack.length - 1].lastmove === "pass" ||
                    allMoves.length === 0 ||
                    allMoves.length === 1 && allMoves[0] === "pass") {
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

    private showTenteativeCountSelector(moveSplitCount: number): boolean {
        // Whether to show the tentative count selector.
        // `moveSplitCount` is the number of pieces placed in the partial move.
        if (this.openingProtocol === "soosyrv-8") {
            return this.stack.length < 4 && this.placeMoveCount() === 1 && moveSplitCount === 1;
        } else if (this.openingProtocol === "yamaguchi") {
            return this.stack.length === 1 && moveSplitCount === 3;
        }
        return false;
    }

    private getTentativeCountSelector(): Map<string, string> {
        const selector: Map<string, string> = new Map();
        if (this.openingProtocol === "soosyrv-8") {
            for (let i = 1; i <= 8; i++) {
                selector.set(this.coords2algebraic(i, 1), i.toString());
            }
        } else if (this.openingProtocol === "yamaguchi") {
            for (let i = 1; i <= 12; i++) {
                selector.set(this.coords2algebraic(i, 1), i.toString());
            }
        }
        return selector;
    }

    private isNewResult(): boolean {
        // Check if the `this.result` is new, or if it was copied from the previous state.
        return this.results.every(r => r !== this.stack[this.stack.length - 1]._results[0]);
    }

    public render(opts?: { altDisplay: string | undefined }): APRenderRep {
        let altDisplay: string | undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }
        let showRestrictions = true;
        if (altDisplay !== undefined) {
            if (altDisplay === "hide-restrictions") {
                showRestrictions = false;
            }
        }
        // Build piece string
        let pstr = "";
        const restrictions = showRestrictions ? this.getRestrictions(this.getPlayerColour(1) === 1 ? 1 : 2 as playerid) : new Map();
        const renderBoardSize = this.toroidal ? this.boardSize + 2 * this.toroidalPadding : this.boardSize;
        const tentativeCountSelector = this.isNewResult() && this.showTenteativeCountSelector(this.results.length) ? this.getTentativeCountSelector() : new Map<string, string>();
        for (let row = 0; row < renderBoardSize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < renderBoardSize; col++) {
                const cell = this.renderCoords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell);
                    if (contents === 1) {
                        pieces.push("A");
                    } else if (contents === 2) {
                        pieces.push("B");
                    }
                } else if (this.tentatives.includes(cell) || this.stack[this.stack.length - 1].tentatives.includes(cell) && this.results.length === 0) {
                    pieces.push("F");
                } else if (tentativeCountSelector.has(cell)) {
                    pieces.push(`G${tentativeCountSelector.get(cell)}`);
                } else if (restrictions.has(cell)) {
                    if (restrictions.get(cell) === "33") {
                        pieces.push("C");
                    } else if (restrictions.get(cell) === "44") {
                        pieces.push("D");
                    } else if (restrictions.get(cell) === "6+") {
                        pieces.push("E");
                    }
                } else {
                    pieces.push("");
                }
            }
            pstr += pieces.join(",");
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
        let markers: Array<any> | undefined = referencePointsObj.length > 0 ? [{ type: "dots", points: referencePointsObj }] : [];
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
        if (markers.length === 0) { markers = undefined; }
        const legend: ILooseObj = {
            A: [{ name: "piece", player: this.getPlayerColour(1) as playerid }],
            B: [{ name: "piece", player: this.getPlayerColour(2) as playerid }],
            C: [
                { name: "piece-borderless", player: 1 as playerid, opacity: 0.2 },
                { text: "33" },
            ],
            D: [
                { name: "piece-borderless", player: 1 as playerid, opacity: 0.2 },
                { text: "44" },
            ],
            E: [
                { name: "piece-borderless", player: 1 as playerid, opacity: 0.2 },
                { text: "6+" },
            ],
            F: [{ name: "piece", player: 1 as playerid, opacity: 0.5 }],
        }
        if (tentativeCountSelector.size > 0) {
            for (let i = 1; i <= tentativeCountSelector.size; i++) {
                legend[`G${i}`] = [
                    { name: "piece", player: 1 as playerid, opacity: 0.5 },
                    { text: i.toString() },
                ];
            }
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
            legend,
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
        if (this._points.length > 0 || this.openingProtocol === "taraguchi-10" && this.stack.length < 6) {
            const points = [];
            for (const cell of this._points) {
                points.push({ row: cell[1], col: cell[0] });
            }
            // This display has to appear before the first move, so the logic is placed here directly.
            if (this.openingProtocol === "taraguchi-10") {
                const placeMoveCount = this.placeMoveCount();
                if (placeMoveCount === 1 && !this.isNewResult()) {
                    for (const move of renjuMove2s) {
                        const [x, y] = this.algebraic2coords(move);
                        points.push({ row: y, col: x });
                    }
                } else if (placeMoveCount === 2 && !this.isNewResult()) {
                    const lastMove = this.stack[this.stack.length - 1].lastmove;
                    const secondPlacement = lastMove === "pass" ? this.stack[this.stack.length - 2].lastmove : lastMove;
                    if (secondPlacement === "i9") {
                        for (const move of renjuMove3is) {
                            const [x, y] = this.algebraic2coords(move);
                            points.push({ row: y, col: x });
                        }
                    } else {
                        for (const move of renjuMove3ds) {
                            const [x, y] = this.algebraic2coords(move);
                            points.push({ row: y, col: x });
                        }
                    }
                }
            }
            if (points.length > 0) {
                // @ts-ignore
                rep.annotations.push({type: "dots", targets: points});
            }
        }
        return rep;
    }

    public state(): IRenjuState {
        return {
            game: RenjuGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: RenjuGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            captureCounts: [...this.captureCounts],
            winningLines: this.winningLines.map(a => [...a]),
            swapped: this.swapped,
            tiebreaker: this.tiebreaker,
            tentativeCount: this.tentativeCount,
            tentatives: [...this.tentatives],
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
                if (r.what === "tentative") {
                    node.push(i18next.t("apresults:PLACE.renju_tentative", { player, where: r.where }));
                } else if (r.what === "choose") {
                    node.push(i18next.t("apresults:PLACE.renju_tentative_choose", { player, where: r.where }));
                } else {
                    node.push(i18next.t("apresults:PLACE.nowhat", { player, where: r.where }));
                }
                resolved = true;
                break;
            case "pie":
                node.push(i18next.t("apresults:PIE", { player }));
                resolved = true;
                break;
            case "pass":
                if (r.why === "tiebreaker") {
                    node.push(i18next.t("apresults:PASS.tiebreaker", { player }));
                    resolved = true;
                } else {
                    node.push(i18next.t("apresults:PASS.simple", { player }));
                    resolved = true;
                }
                break;
            case "declare":
                node.push(i18next.t("apresults:DECLARE.renju", { player, count: r.count }));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): RenjuGame {
        return new RenjuGame(this.serialize());
    }
}