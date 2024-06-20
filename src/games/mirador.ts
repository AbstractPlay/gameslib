/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import {
    GameBase,
    IAPGameState,
    IClickResult,
    IIndividualState,
    IValidationResult,
} from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";

export type playerid = 1 | 2;
export type CellContents = null | 1 | 2;
export type Stage = "play" | "challenge";

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    // board is 27 x 27. A1 corresponds to board[0][0], board[0][1], board[1][0], and board[1][1],
    // Z26 corresponds to board[25][25], board[25][26], board[26][25], board[26][26]
    board: Array<Array<CellContents>>;
    stage: Stage;
    lastmove?: string;
}

export interface IMiradorState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
}

export class MiradorGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Mirador",
        uid: "mirador",
        playercounts: [2],
        version: "20230729",
        dateAdded: "2023-08-25",
        description: "apgames:descriptions.mirador",
        urls: ["https://www.abstractgames.org/mirador.html"],
        people: [
            {
                type: "designer",
                name: "Andrew Perkis",
            },
        ],
        categories: ["goal>connect", "mechanic>block",  "mechanic>place", "board>shape>rect", "board>connect>rect", "components>simple>pnp"],
        flags: ["pie"],
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Array<Array<CellContents>>;
    public stage: Stage = "play";
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IMiradorState | string) {
        super();
        if (state === undefined) {
            const board = [];
            for (let row = 0; row < 27; row++) {
                const node: Array<CellContents> = [];
                for (let col = 0; col < 27; col++) {
                    node.push(null);
                }
                board.push(node);
            }
            const fresh: IMoveState = {
                _version: MiradorGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                stage: "play",
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IMiradorState;
            }
            if (state.game !== MiradorGame.gameinfo.uid) {
                throw new Error(
                    `The Mirador engine cannot process a game of '${state.game}'.`
                );
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): MiradorGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if (idx < 0 || idx >= this.stack.length) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = state.board.map((a) => {
            return { ...a };
        });
        this.stage = state.stage;
        this.lastmove = state.lastmove;
        this.results = [...state._results];
        return this;
    }

    public moves(): string[] {
        if (this.gameover) {
            return [];
        }
        const moves: string[] = [];
        // placements
        for (let x = 0; x < 26; x++) {
            for (let y = 0; y < 26; y++) {
                if (this.canPlace(this.board, this.currplayer, x, y)) {
                    moves.push(GameBase.coords2algebraic(x, y, 26));
                }
            }
        }
        if (this.stage === "play") {
            moves.push("declare");
        }
        return moves.sort((a, b) => a.localeCompare(b));
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(
        move: string,
        row: number,
        col: number,
        piece?: string
    ): IClickResult {
        try {
            if (col === 0 || col === 27 || row === 0 || row === 27) {
                return {
                    move,
                    valid: false,
                    message: i18next.t("apgames:validation.mirador.NO_EDGE_PLAY")
                };
            }
            const cell = GameBase.coords2algebraic(col - 1, row - 1, 26);
            const newmove = move ? `${move}-${cell}` : cell;
            const result = this.validateMove(newmove) as IClickResult;
            if (!result.valid) {
                result.move = "";
            } else {
                result.move = newmove;
            }
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", {
                    move,
                    row,
                    col,
                    piece,
                    emessage: (e as Error).message,
                }),
            };
        }
    }

    private isConnected(horizontal: boolean, player: playerid): boolean {
        const localBoard = [];
        const work: [number, number][] = [];
        if (horizontal) {
            for (let row = 0; row < 27; row++) {
                const node: Array<number> = [];
                let seeleft = true;
                for (let col = 0; col < 27; col++) {
                    if (seeleft && this.board[row][col] === player) {
                        node.push(3); // 3 means connected to the left
                        work.push([row, col]);
                        seeleft = false;
                    } else if (this.board[row][col] !== null) {
                        node.push(this.board[row][col]!);
                        seeleft = false;
                    } else {
                        node.push(0);
                    }
                }
                localBoard.push(node);
            }
        } else {
            for (let col = 0; col < 27; col++) {
                const node: Array<number> = [];
                let seeleft = true;
                for (let row = 0; row < 27; row++) {
                    if (seeleft && this.board[row][col] === player) {
                        node.push(3);
                        work.push([col, row]); // transposing the board
                        seeleft = false;
                    } else if (this.board[row][col] !== null) {
                        node.push(this.board[row][col]!);
                        seeleft = false;
                    } else {
                        node.push(0);
                    }
                }
                localBoard.push(node);
            }
        }
        while (work.length > 0) {
            const start = work.pop()!;
            const dirs = [
                [-1, 0],
                [0, 1],
                [1, 0],
                [0, -1],
            ];
            for (const dir of dirs) {
                let dist = 1;
                while (true) {
                    const next: [number, number] = [start[0] + dir[0] * dist, start[1] + dir[1] * dist];
                    if (next[1] >= 27) {
                        return true;
                    }
                    if (next[0] < 0 || next[0] >= 27 || next[1] < 0 || localBoard[next[0]][next[1]] === 3 - player || localBoard[next[0]][next[1]] === 3) {
                        break;
                    }
                    if (localBoard[next[0]][next[1]] === 3 - player) {
                        break;
                    }
                    if (localBoard[next[0]][next[1]] === player) {
                        localBoard[next[0]][next[1]] = 3;
                        work.push(next);
                        break;
                    }
                    dist++;
                }
            }
            const diags = [
                [-1, -1],
                [-1, 1],
                [1, 1],
                [1, -1],
            ];
            for (const dir of diags) {
                const next: [number, number] = [start[0] + dir[0], start[1] + dir[1]];
                if (! (next[0] < 0 || next[0] >= 27 || next[1] < 0 || next[1] >= 27) && localBoard[next[0]][next[1]] === player) {
                    localBoard[next[0]][next[1]] = 3;
                    work.push(next);
                }
            }
        }
        return false;
    }

    private canPlace(board: Array<Array<CellContents>>, player: playerid, x: number, y: number): boolean {
        for (let dx = -1; dx <= 2; dx++) {
            for (let dy = -1; dy <= 2; dy++) {
                if (x + dx >= 0 && x + dx < 27 && y + dy >= 0 && y + dy < 27 && !(board[y + dy][x + dx] === null || ((dx === -1 || dx === 2) && (dy === -1 || dy === 2) && board[y + dy][x + dx] === player))) {
                    return false;
                }
            }
        }
        return true;
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {
            valid: false,
            message: i18next.t("apgames:validation._general.DEFAULT_HANDLER"),
        };

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            if (this.stage === "play") {
                result.message = i18next.t(
                    "apgames:validation.mirador.INITIAL_INSTRUCTIONS"
                );
            } else {
                result.message = i18next.t(
                    "apgames:validation.mirador.INITIAL_INSTRUCTIONS_CHALLENGE"
                );
            }
            return result;
        }
        if (m === "declare") {
            if (this.stage === "play") {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.mirador.ALREADY_DECLARED");
                return result;
            }
        }

        const placements = m.split("-");
        if (placements.length > 1 && this.stage === "play") {
            result.valid = false;
            result.message = i18next.t("apgames:validation.mirador.SINGLE_PLACEMENT");
            return result;
        }

        let localBoard: Array<Array<CellContents>> = [];
        if (this.stage === "challenge") {
            localBoard = this.board.map((a) => {
                return { ...a };
            });
        }
        for (const placement of placements) {
            let coords;
            try {
                coords = GameBase.algebraic2coords(placement, 26);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {
                    cell: placement,
                });
                return result;
            }
            if (coords[0] < 0 || coords[0] >= 26 || coords[1] < 0 || coords[1] >= 26) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {
                    cell: placement,
                });
                return result;
            }
            if (this.stage === "challenge") {
                if (!this.canPlace(localBoard, this.currplayer, coords[0], coords[1])) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.mirador.BAD_PLACEMENT", { where: placement });
                    return result;
                }
                localBoard[coords[1]][coords[0]] = this.currplayer;
                localBoard[coords[1]][coords[0] + 1] = this.currplayer;
                localBoard[coords[1] + 1][coords[0]] = this.currplayer;
                localBoard[coords[1] + 1][coords[0]] = this.currplayer;
            } else {
                if (!this.canPlace(this.board, this.currplayer, coords[0], coords[1])) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.mirador.BAD_PLACEMENT", { where: placement });
                    return result;
                }
            }
        }
        // Looks good
        if (this.stage === "play") {
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        } else {
            result.valid = true;
            result.complete = 0;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.mirador.VALID_PARTIAL_MOVE");
            return result;
        }
    }

    public move(m: string, {trusted = false} = {}): MiradorGame {
        if (this.gameover) {
            throw new UserFacingError(
                "MOVES_GAMEOVER",
                i18next.t("apgames:MOVES_GAMEOVER")
            );
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (! trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
            if (this.stage === "play" && !this.moves().includes(m)) {
                throw new UserFacingError(
                    "VALIDATION_FAILSAFE",
                    i18next.t("apgames:validation._general.FAILSAFE", { move: m })
                );
            }
        }

        this.results = [];
        if (m === "declare") {
            this.stage = "challenge";
            this.results.push({ type: "declare" });
        } else {
            const placements = m.split("-");
            for (const placement of placements) {
                const coords = GameBase.algebraic2coords(placement, 26);
                this.board[coords[1]][coords[0]] = this.currplayer;
                this.board[coords[1]][coords[0] + 1] = this.currplayer;
                this.board[coords[1] + 1][coords[0]] = this.currplayer;
                this.board[coords[1] + 1][coords[0] + 1] = this.currplayer;
            }
            this.results.push({ type: "place", where: m });
        }

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

    protected checkEOG(): MiradorGame {
        let prevPlayer: playerid = 1;
        if (this.currplayer === 1) {
            prevPlayer = 2;
        }
        if (this.stage === "challenge" && this.lastmove !== "declare") {
            this.gameover = true;
            if (this.isConnected(true, this.currplayer) || this.isConnected(false, this.currplayer)) {
                this.winner = [this.currplayer];
            } else {
                this.winner = [prevPlayer];
            }
        }
        if (this.gameover) {
            this.results.push(
                { type: "eog" },
                { type: "winners", players: [...this.winner] }
            );
        }
        return this;
    }

    public state(): IMiradorState {
        return {
            game: MiradorGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    public moveState(): IMoveState {
        return {
            _version: MiradorGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: this.board.map((a) => {
                return { ...a };
            }),
            stage: this.stage
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "----------------------------";
        for (let row = 0; row < 26; row++) {
            pstr += "\n";
            const pieces: string[] = [];
            for (let col = 0; col < 26; col++) {
                if (this.board[row][col] !== null && this.board[row][col] === this.board[row][col + 1] && this.board[row][col] === this.board[row + 1][col] && this.board[row][col] === this.board[row + 1][col + 1]) {
                    pieces.push(this.board[row][col] === 1 ? "A" : "B");
                } else {
                    pieces.push("-");
                }
            }
            pstr += "-" + pieces.join("") + "-";
        }
        pstr += "\n----------------------------";

        // Build rep
        const rep: APRenderRep = {
            options: ["hide-star-points"],
            board: {
                style: "vertex",
                width: 28,
                height: 28,
                columnLabels: ["", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z", ""],
                rowLabels: ["", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", ""]
            },
            legend: {
                A: {
                    name: "piece-square",
                    scale: 2.1,
                    colour: 1
                },
                B: {
                    name: "piece-square",
                    scale: 2.1,
                    colour: 2
                },
            },
            pieces: pstr,
        };

        // Add annotations
        if (this.results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "place") {
                    for (const placement of move.where!.split("-")) {
                        const [x, y] = GameBase.algebraic2coords(placement, 26);
                        rep.annotations.push({type: "dots", targets: [{row: y + 1, col: x + 1}], size: 0.3, colour: "#f4ea56"});
                    }
                }
            }
        }

        return rep;
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        return status;
    }

    protected getMoveList(): any[] {
        return this.getMovesAndResults(["place", "move"]);
    }

    public clone(): MiradorGame {
        return new MiradorGame(this.serialize());
    }
}
