/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

export type pieceType = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: pieceType;
    board: Map<string, Array<pieceType>>;
    lastmove?: string;
    reversemove: string|null;
    reversemimic: string|null;
};

export interface IMimicState extends IAPGameState {
    winner: pieceType[];
    stack: Array<IMoveState>;
};

export class MimicGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Mimic",
        uid: "mimic",
        playercounts: [2],
        version: "20240120",
        dateAdded: "2024-01-20",
        // i18next.t("apgames:descriptions.mimic")
        description: "apgames:descriptions.mimic",
        urls: ["https://geomegranate.com/wp-content/uploads/2024/01/Mimic.pdf"],
        people: [
            {
                type: "designer",
                name: "Andrew Bressette"
            }
        ],
        categories: ["goal>breakthrough", "mechanic>displace",  "mechanic>move", "board>shape>rect", "board>connect>rect", "components>simple"],
        flags: ["perspective"]
    };

    // Will need to update these methods to fully support board size variants
    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 10);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 10);
    }

    public static readonly PLAYER_ONE = 1;
    public static readonly PLAYER_TWO = 2;

    public numplayers = 2;
    public currplayer: pieceType = MimicGame.PLAYER_ONE;
    public board!: Map<string, Array<pieceType>>;
    public boardsize = 10;
    public gameover = false;
    public winner: pieceType[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public reversemove: string|null = null;
    public reversemimic: string|null = null;

    constructor(state?: IMimicState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const board = new Map<string, Array<pieceType>>([
                ["b2", [MimicGame.PLAYER_ONE]], ["c2", [MimicGame.PLAYER_ONE]], ["d2", [MimicGame.PLAYER_ONE]], ["e2", [MimicGame.PLAYER_ONE]], ["f2", [MimicGame.PLAYER_ONE]], ["g2", [MimicGame.PLAYER_ONE]], ["h2", [MimicGame.PLAYER_ONE]], ["i2", [MimicGame.PLAYER_ONE]],
                ["b9", [MimicGame.PLAYER_TWO]], ["c9", [MimicGame.PLAYER_TWO]], ["d9", [MimicGame.PLAYER_TWO]], ["e9", [MimicGame.PLAYER_TWO]], ["f9", [MimicGame.PLAYER_TWO]], ["g9", [MimicGame.PLAYER_TWO]], ["h9", [MimicGame.PLAYER_TWO]], ["i9", [MimicGame.PLAYER_TWO]]
            ]);
            const fresh: IMoveState = {
                _version: MimicGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                reversemove: null,
                reversemimic: null,
                currplayer: 1,
                board
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IMimicState;
            }
            if (state.game !== MimicGame.gameinfo.uid) {
                throw new Error(`The Mimic engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): MimicGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = deepclone(state.board) as Map<string, Array<pieceType>>;
        this.lastmove = state.lastmove;
        this.reversemove = state.reversemove;
        this.reversemimic = state.reversemimic;
        this.results = [...state._results];
        return this;
    }

    public getTopPiece(cell: string): pieceType {
        const contents = this.board.get(cell);
        if (!Array.isArray(contents) || !contents.length) throw new Error("Cannot get top piece from bad array.");
        return contents[contents.length-1];
    }

    public getMimicCount(cell: string): number {
        if (!this.board.has(cell)) return 0;
        const player = this.getTopPiece(cell);
        const [col, row] = MimicGame.algebraic2coords(cell);
        let mimicCount = 0;
        for (let dcol = 1; col-dcol >= 0; dcol++) {
            const cell2 = MimicGame.coords2algebraic(col-dcol, row);
            if (this.board.has(cell2)) {
                if (this.getTopPiece(cell2) !== player) {
                    mimicCount++;
                }
                break;
            }
        }
        for (let dcol = 1; col+dcol <= this.boardsize; dcol++) {
            const cell2 = MimicGame.coords2algebraic(col+dcol, row);
            if (this.board.has(cell2)) {
                if (this.getTopPiece(cell2) !== player) {
                    mimicCount++;
                }
                break;
            }
        }
        for (let drow = 1; row-drow >= 0; drow++) {
            const cell2 = MimicGame.coords2algebraic(col, row-drow);
            if (this.board.has(cell2)) {
                if (this.getTopPiece(cell2) !== player) {
                    mimicCount++;
                }
                break;
            }
        }
        for (let drow = 1; row+drow <= this.boardsize; drow++) {
            const cell2 = MimicGame.coords2algebraic(col, row+drow);
            if (this.board.has(cell2)) {
                if (this.getTopPiece(cell2) !== player) {
                    mimicCount++;
                }
                break;
            }
        }
        return mimicCount;
    }

    // Get at least one mimic of the cell. Probably shouldn't use if you don't know that mimic count is 1.
    public getMimic(cell: string): string|null {
        if (!this.board.has(cell)) return null;
        const player = this.getTopPiece(cell);
        const [col, row] = MimicGame.algebraic2coords(cell);
        for (let dcol = 1; col-dcol >= 0; dcol++) {
            const cell2 = MimicGame.coords2algebraic(col-dcol, row);
            if (this.board.has(cell2)) {
                if (this.getTopPiece(cell2) !== player) {
                    return cell2;
                }
                break;
            }
        }
        for (let dcol = 1; col+dcol <= this.boardsize; dcol++) {
            const cell2 = MimicGame.coords2algebraic(col+dcol, row);
            if (this.board.has(cell2)) {
                if (this.getTopPiece(cell2) !== player) {
                    return cell2;
                }
                break;
            }
        }
        for (let drow = 1; row-drow >= 0; drow++) {
            const cell2 = MimicGame.coords2algebraic(col, row-drow);
            if (this.board.has(cell2)) {
                if (this.getTopPiece(cell2) !== player) {
                    return cell2;
                }
                break;
            }
        }
        for (let drow = 1; row+drow <= this.boardsize; drow++) {
            const cell2 = MimicGame.coords2algebraic(col, row+drow);
            if (this.board.has(cell2)) {
                if (this.getTopPiece(cell2) !== player) {
                    return cell2;
                }
                break;
            }
        }
        return null;
    }

    public moves(player?: pieceType): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];

        for (let row = 0; row < this.boardsize; row++) {
            for (let col = 0; col < this.boardsize; col++) {
                const cell = MimicGame.coords2algebraic(col, row);
                if (this.board.has(cell) && this.getTopPiece(cell) === player) {
                    // If mimic count is 2 or more, then the piece is frozen
                    const mimicCount = this.getMimicCount(cell);
                    if (mimicCount > 1) continue;

                    let checkForReverse = mimicCount === 1 && this.reversemove !== null && this.reversemimic !== null;

                    // else, make sure each king move is to a real, empty space
                    let cell2 = null;
                    if (row > 0) {
                        if (col > 0) {
                            cell2 = MimicGame.coords2algebraic(col-1, row-1);
                            if (!this.board.has(cell2)) {
                                // Check that this isn't a reversing move
                                const move = `${cell}-${cell2}`;
                                if (!checkForReverse || this.reversemove !== move) {
                                    moves.push(move);
                                } else {
                                    const mimic = this.getMimic(cell)!;
                                    const [mimicFromCol, mimicFromRow] = MimicGame.algebraic2coords(mimic);
                                    if (mimicFromCol >= this.boardsize-1 || mimicFromRow >= this.boardsize-1) {
                                        moves.push(move);
                                    } else {
                                        const mimicTo = MimicGame.coords2algebraic(mimicFromCol+1, mimicFromRow+1);
                                        if (this.reversemimic !== `${mimic}-${mimicTo}`) {
                                            moves.push(move);
                                        } else {
                                            // This is a reverse move and shouldn't be allowed, and since it's unique, we can stop checking.
                                            checkForReverse = false;
                                        }
                                    }
                                }
                            }
                        }

                        cell2 = MimicGame.coords2algebraic(col, row-1);
                        if (!this.board.has(cell2)) {
                            // Check that this isn't a reversing move
                            const move = `${cell}-${cell2}`;
                            if (!checkForReverse || this.reversemove !== move) {
                                moves.push(move);
                            } else {
                                const mimic = this.getMimic(cell)!;
                                const [mimicFromCol, mimicFromRow] = MimicGame.algebraic2coords(mimic);
                                if (mimicFromRow >= this.boardsize-1) {
                                    moves.push(move);
                                } else {
                                    const mimicTo = MimicGame.coords2algebraic(mimicFromCol, mimicFromRow+1);
                                    if (this.reversemimic !== `${mimic}-${mimicTo}`) {
                                        moves.push(move);
                                    } else {
                                        // This is a reverse move and shouldn't be allowed, and since it's unique, we can stop checking.
                                        checkForReverse = false;
                                    }
                                }
                            }
                        }

                        if (col < this.boardsize-1) {
                            cell2 = MimicGame.coords2algebraic(col+1, row-1);
                            if (!this.board.has(cell2)) {
                                // Check that this isn't a reversing move
                                const move = `${cell}-${cell2}`;
                                if (!checkForReverse || this.reversemove !== move) {
                                    moves.push(move);
                                } else {
                                    const mimic = this.getMimic(cell)!;
                                    const [mimicFromCol, mimicFromRow] = MimicGame.algebraic2coords(mimic);
                                    if (mimicFromCol < 1 || mimicFromRow >= this.boardsize-1) {
                                        moves.push(move);
                                    } else {
                                        const mimicTo = MimicGame.coords2algebraic(mimicFromCol-1, mimicFromRow+1);
                                        if (this.reversemimic !== `${mimic}-${mimicTo}`) {
                                            moves.push(move);
                                        } else {
                                            // This is a reverse move and shouldn't be allowed, and since it's unique, we can stop checking.
                                            checkForReverse = false;
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if (col > 0) {
                        cell2 = MimicGame.coords2algebraic(col-1, row);
                        if (!this.board.has(cell2)) {
                            // Check that this isn't a reversing move
                            const move = `${cell}-${cell2}`;
                            if (!checkForReverse || this.reversemove !== move) {
                                moves.push(move);
                            } else {
                                const mimic = this.getMimic(cell)!;
                                const [mimicFromCol, mimicFromRow] = MimicGame.algebraic2coords(mimic);
                                if (mimicFromCol >= this.boardsize-1) {
                                    moves.push(move);
                                } else {
                                    const mimicTo = MimicGame.coords2algebraic(mimicFromCol+1, mimicFromRow);
                                    if (this.reversemimic !== `${mimic}-${mimicTo}`) {
                                        moves.push(move);
                                    } else {
                                        // This is a reverse move and shouldn't be allowed, and since it's unique, we can stop checking.
                                        checkForReverse = false;
                                    }
                                }
                            }
                        }
                    }

                    if (col < this.boardsize-1) {
                        cell2 = MimicGame.coords2algebraic(col+1, row);
                        if (!this.board.has(cell2)) {
                            // Check that this isn't a reversing move
                            const move = `${cell}-${cell2}`;
                            if (!checkForReverse || this.reversemove !== move) {
                                moves.push(move);
                            } else {
                                const mimic = this.getMimic(cell)!;
                                const [mimicFromCol, mimicFromRow] = MimicGame.algebraic2coords(mimic);
                                if (mimicFromCol < 1) {
                                    moves.push(move);
                                } else {
                                    const mimicTo = MimicGame.coords2algebraic(mimicFromCol-1, mimicFromRow);
                                    if (this.reversemimic !== `${mimic}-${mimicTo}`) {
                                        moves.push(move);
                                    } else {
                                        // This is a reverse move and shouldn't be allowed, and since it's unique, we can stop checking.
                                        checkForReverse = false;
                                    }
                                }
                            }
                        }
                    }

                    if (row < this.boardsize-1) {
                        if (col > 0) {
                            cell2 = MimicGame.coords2algebraic(col-1, row+1);
                            if (!this.board.has(cell2)) {
                                // Check that this isn't a reversing move
                                const move = `${cell}-${cell2}`;
                                if (!checkForReverse || this.reversemove !== move) {
                                    moves.push(move);
                                } else {
                                    const mimic = this.getMimic(cell)!;
                                    const [mimicFromCol, mimicFromRow] = MimicGame.algebraic2coords(mimic);
                                    if (mimicFromCol >= this.boardsize-1 || mimicFromRow < 1) {
                                        moves.push(move);
                                    } else {
                                        const mimicTo = MimicGame.coords2algebraic(mimicFromCol+1, mimicFromRow-1);
                                        if (this.reversemimic !== `${mimic}-${mimicTo}`) {
                                            moves.push(move);
                                        } else {
                                            // This is a reverse move and shouldn't be allowed, and since it's unique, we can stop checking.
                                            checkForReverse = false;
                                        }
                                    }
                                }
                            }
                        }

                        cell2 = MimicGame.coords2algebraic(col, row+1);
                        if (!this.board.has(cell2)) {
                            // Check that this isn't a reversing move
                            const move = `${cell}-${cell2}`;
                            if (!checkForReverse || this.reversemove !== move) {
                                moves.push(move);
                            } else {
                                const mimic = this.getMimic(cell)!;
                                const [mimicFromCol, mimicFromRow] = MimicGame.algebraic2coords(mimic);
                                if (mimicFromRow < 1) {
                                    moves.push(move);
                                } else {
                                    const mimicTo = MimicGame.coords2algebraic(mimicFromCol, mimicFromRow-1);
                                    if (this.reversemimic !== `${mimic}-${mimicTo}`) {
                                        moves.push(move);
                                    } else {
                                        // This is a reverse move and shouldn't be allowed, and since it's unique, we can stop checking.
                                        checkForReverse = false;
                                    }
                                }
                            }
                        }

                        if (col < this.boardsize-1) {
                            cell2 = MimicGame.coords2algebraic(col+1, row+1);
                            if (!this.board.has(cell2)) {
                                // Check that this isn't a reversing move
                                const move = `${cell}-${cell2}`;
                                if (!checkForReverse || this.reversemove !== move) {
                                    moves.push(move);
                                } else {
                                    const mimic = this.getMimic(cell)!;
                                    const [mimicFromCol, mimicFromRow] = MimicGame.algebraic2coords(mimic);
                                    if (mimicFromCol < 1 || mimicFromRow < 1) {
                                        moves.push(move);
                                    } else {
                                        const mimicTo = MimicGame.coords2algebraic(mimicFromCol-1, mimicFromRow-1);
                                        if (this.reversemimic !== `${mimic}-${mimicTo}`) {
                                            moves.push(move);
                                        }
                                        // Do not need an else, since this is the last block.
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = MimicGame.coords2algebraic(col, row);
            if (move === "") {
                if (!this.board.has(cell) || this.getTopPiece(cell) !== this.currplayer) {
                    return {move: "", message: i18next.t("apgames:validation.mimic.INITIAL_INSTRUCTIONS")} as IClickResult;
                }

                const result = this.validateMove(cell) as IClickResult;
                if (!result.valid) {
                    // Clean up the entry for them
                    result.move = "";
                } else {
                    result.move = cell;
                }
                return result;
            } else if (move.includes("-")) {
                return {move, message: ""} as IClickResult;
            } else {
                const result = this.validateMove(`${move}-${cell}`) as IClickResult;
                if (!result.valid) {
                    // Clean up the entry for them
                    result.move = "";
                } else {
                    result.move = `${move}-${cell}`;
                }
                return result;
            }
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", {move, row, col, piece, emessage: (e as Error).message})
            }
        }
    }

    public movesStartWith(m: string): boolean {
        for (const move of this.moves()) {
            if (move.startsWith(`${m}-`)) return true;
        }
        return false;
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.mimic.INITIAL_INSTRUCTIONS");
            return result;
        }

        const cells: string[] = m.split(new RegExp('[\-]'));
        if (cells.length === 1) {
            if (!this.board.has(cells[0]) || this.getTopPiece(cells[0]) !== this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.mimic.INITIAL_INSTRUCTIONS");
                return result;
            } else if (this.getMimicCount(cells[0]) > 1) {
                // validate that the piece isn't frozen
                result.valid = false;
                result.message = i18next.t("apgames:validation.mimic.FROZEN_PIECE");
                return result;
            } else if (!this.movesStartWith(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.mimic.NO_LEGAL_MOVES");
                return result;
            }

            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.mimic.MOVE_TO_EMPTY");
            return result;
        } else if (cells.length !== 2) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
            return result;
        } else {
            let cell = cells[0];
            let col1: number|null = null;
            let row1: number|null = null;
            try {
                [col1, row1] = MimicGame.algebraic2coords(cell);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                return result;
            }

            // first cell must be occupied by own meeple
            if (!this.board.has(cell) || this.getTopPiece(cell) !== this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.mimic.INITIAL_INSTRUCTIONS");
                return result;
            } else {
                // validate that the piece isn't frozen
                if (this.getMimicCount(cell) > 1) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.mimic.FROZEN_PIECE");
                    return result;
                }
            }

            // validate second cell
            cell = cells[1];
            let col2: number|null = null;
            let row2: number|null = null;
            try {
                [col2, row2] = MimicGame.algebraic2coords(cell);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                return result;
            }

            if (col1-col2 > 1 || col1-col2 < -1 || row1-row2 > 1 || row1-row2 < -1 || (col1 === col2 && row1 === row2)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.mimic.MOVE_TO_EMPTY");
                return result;
            }

            // second cell must be unoccupied
            if (this.board.has(cell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: cell});
                return result;
            }

            if (!this.moves().includes(m)) {
                // Only possible scenario left is that this was a reversing move
                result.valid = false;
                result.message = i18next.t("apgames:validation.mimic.NO_REVERSES");
                return result;
            }
        }

        // Valid and complete move
        result.valid = true;
        result.complete = 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {trusted = false} = {}): MimicGame {
        if (m === "") return this;

        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
            if (!this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}));
            }
        }

        this.results = [];

        const cells: string[] = m.split(new RegExp('[\-]'));
        if (cells.length !== 2) {
            throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}));
        }

        // Get mimic, we don't have to worry about multiple mimics here becuase the move was already validated
        const mimic = this.getMimic(cells[0]);

        // Do first move
        const contents = [...this.board.get(cells[0])!];
        contents.pop();
        if (contents.length === 0) {
            this.board.delete(cells[0]);
        } else {
            this.board.set(cells[0], contents);
        }
        this.board.set(cells[1], [this.currplayer]);
        this.results.push({type: "move", from: cells[0], to: cells[1]});

        this.checkVictory();
        if (this.gameover) {
            this.lastmove = m;
            this.saveState();
            return this;
        }

        this.reversemove = null;
        this.reversemimic = null;
        if (mimic !== null) {
            const mimicContent = [...this.board.get(mimic)!];
            const mimicPiece = mimicContent.pop()!;
            if (mimicContent.length === 0) {
                this.board.delete(mimic);
            } else {
                this.board.set(mimic, mimicContent);
            }

            const [fromCol, fromRow] = MimicGame.algebraic2coords(cells[0]);
            const [toCol, toRow] = MimicGame.algebraic2coords(cells[1]);
            const [mimicFromCol, mimicFromRow] = MimicGame.algebraic2coords(mimic);
            const mimicToCol = mimicFromCol+fromCol-toCol;
            const mimicToRow = mimicFromRow+fromRow-toRow;
            if (mimicToCol >= 0 && mimicToCol < this.boardsize && mimicToRow >= 0 && mimicToRow < this.boardsize) {
                const mimicTo = MimicGame.coords2algebraic(mimicToCol, mimicToRow);
                if (this.board.has(mimicTo)) {
                    const mimicToContents = [...this.board.get(mimicTo)!];
                    mimicToContents.push(mimicPiece);
                    this.board.set(mimicTo, mimicToContents);
                } else {
                    this.board.set(mimicTo, [mimicPiece]);
                }
                this.results.push({type: "move", from: mimic, to: mimicTo});
                this.reversemove = `${mimicTo}-${mimic}`;
                this.reversemimic = `${cells[1]}-${cells[0]}`;
            } else {
                this.results.push({type: "destroy", where: mimic});
            }
        }

        // update currplayer
        let newplayer = (this.currplayer as number) + 1;
        if (newplayer > this.numplayers) newplayer = 1;
        this.currplayer = newplayer as pieceType;

        // Check for victory from mimic move, then check if stalemated
        this.checkVictory();
        if (!this.gameover) this.checkStalemate();
        this.lastmove = m;
        this.saveState();
        return this;
    }

    protected checkVictory(): MimicGame {
        for (let col = 0; col < this.boardsize; col++) {
            const cell = (this.currplayer === MimicGame.PLAYER_ONE) ? MimicGame.coords2algebraic(col, 0) : MimicGame.coords2algebraic(col, this.boardsize-1);
            if (this.board.has(cell) && this.getTopPiece(cell) === this.currplayer) {
                this.gameover = true;
                this.winner = [this.currplayer];
                this.results.push(
                    {type: "eog"},
                    {type: "winners", players: [...this.winner]}
                );
                return this;
            }
        }
        return this;
    }

    protected checkStalemate(): MimicGame {
        const prevPlayer: pieceType = (this.currplayer === MimicGame.PLAYER_ONE) ? MimicGame.PLAYER_TWO : MimicGame.PLAYER_ONE;

        if (this.moves().length === 0) {
            this.gameover = true;
            this.winner = [prevPlayer];
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IMimicState {
        return {
            game: MimicGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: MimicGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            reversemove: this.reversemove,
            reversemimic: this.reversemimic,
            board: deepclone(this.board) as Map<string, Array<pieceType>>
        };
    }

    public render(): APRenderRep {
        const pieces: string[][] = [];
        for (let row = 0; row < this.boardsize; row++) {
            const node: string[] = [];
            for (let col = 0; col < this.boardsize; col++) {
                const cell = MimicGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = [...this.board.get(cell)!];
                    if (this.getMimicCount(cell) > 1) {
                        node.push(contents.join("").replace(/1/g, "B").replace(/2/g, "D"));
                    } else {
                        node.push(contents.join("").replace(/1/g, "A").replace(/2/g, "C"));
                    }
                } else {
                    node.push("-");
                }
            }
            pieces.push(node);
        }
        const pstr: string = pieces.map(r => r.join(",")).join("\n");

        // Build rep
        const rep: APRenderRep =  {
            renderer: "stacking-offset",
            board: {
                style: "squares-checkered",
                width: this.boardsize,
                height: this.boardsize
            },
            legend: {
                A: [{ name: "piece", player: 1 }],
                B: [{ name: "piece", colour: "#FFF"}, { name: "piece", player: 1, opacity: 0.5 }],
                C: [{ name: "piece", player: 2 }],
                D: [{ name: "piece", colour: "#FFF"}, { name: "piece", player: 2, opacity: 0.5 }],
            },
            pieces: pstr
        };

        // Add annotations
        if (this.results.length > 0) {
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "move") {
                    const [fromX, fromY] = MimicGame.algebraic2coords(move.from);
                    const [toX, toY] = MimicGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                }
                if (move.type === "destroy") {
                    const [x, y] = MimicGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                }
            }
            if (rep.annotations.length === 0) {
                delete rep.annotations;
            }
        }

        return rep;
    }

    public status(): string {
        const status = super.status();
        return status;
    }

    public clone(): MimicGame {
        return new MimicGame(this.serialize());
    }
}
