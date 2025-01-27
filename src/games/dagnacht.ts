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
import { Direction, RectGrid, reviver, UserFacingError } from "../common";
import i18next from "i18next";

export type playerid = 1 | 2;
const winningDirs: [Direction, Direction, number][] = [["N", "S", 5], ["E", "W", 5], ["NE", "SW", 4], ["NW", "SE", 4]];

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
}

export interface IDagEnNachtState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
}

export class DagEnNachtGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Dag en Nacht",
        uid: "dagnacht",
        playercounts: [2],
        version: "20230904",
        dateAdded: "2023-09-16",
        description: "apgames:descriptions.dagnacht",
        urls: [
            "https://www.abstractgames.org/unequalspaces.html",
            "https://boardgamegeek.com/boardgame/347536/dag-en-nacht",
        ],
        people: [
            {
                type: "designer",
                name: "Chris Huntoon",
            },
        ],
        variants: [
            {
                uid: "11x11",
                group: "board",
            },
            {
                uid: "13x13",
                group: "board",
            },
            {
                uid: "17x17",
                group: "board",
            },
            {
                uid: "19x19",
                group: "board",
            },
        ],
        categories: ["goal>align", "mechanic>place", "mechanic>move", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["aiai"],
    };

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardSize);
    }

    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardSize);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public boardSize = 15;

    constructor(state?: IDagEnNachtState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            const board = new Map<string, playerid>();
            if (variants !== undefined && variants.length === 1) {
                switch (variants[0]) {
                    case "11x11":
                        this.variants = ["11x11"];
                        this.boardSize = 11;
                        break;
                    case "13x13":
                        this.variants = ["13x13"];
                        this.boardSize = 13;
                        break;
                    case "17x17":
                        this.variants = ["17x17"];
                        this.boardSize = 17;
                        break;
                    case "19x19":
                        this.variants = ["19x19"];
                        this.boardSize = 19;
                        break;
                    default:
                        break;
                }
            }
            const fresh: IMoveState = {
                _version: DagEnNachtGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                lastTwo: [undefined, undefined],
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IDagEnNachtState;
            }
            if (state.game !== DagEnNachtGame.gameinfo.uid) {
                throw new Error(
                    `The DagEnNacht engine cannot process a game of '${state.game}'.`
                );
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): DagEnNachtGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if (idx < 0 || idx >= this.stack.length) {
            throw new Error("Could not load the requested state from the stack.");
        }
        if (this.variants.includes("11x11")) {
            this.boardSize = 11;
        } else if (this.variants.includes("13x13")) {
            this.boardSize = 13;
        } else if (this.variants.includes("17x17")) {
            this.boardSize = 17;
        } else if (this.variants.includes("19x19")) {
            this.boardSize = 19;
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.lastmove = state.lastmove;
        return this;
    }

    public moves(): string[] {
        if (this.gameover) {
            return [];
        }
        const moves: string[] = [];

        // can place on any empty blank black space
        for (let y = 0; y < this.boardSize; y++) {
            for (let x = 1 - (y % 2); x < this.boardSize; x += 2) {
                const cell = this.coords2algebraic(x, y);
                if (!this.board.has(cell)) {
                    moves.push(cell);
                }
            }
        }

        // can move to any empty white space
        const grid = new RectGrid(this.boardSize, this.boardSize);
        for (const cell of this.board.keys()) {
            if (this.board.get(cell) === this.currplayer) {
                const [x, y] = this.algebraic2coords(cell);
                for (const dest of grid
                    .adjacencies(x, y, false)
                    .map((n) => this.coords2algebraic(...n))) {
                    if (!this.board.has(dest)) {
                        moves.push(`${cell}-${dest}`);
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

    public handleClick(
        move: string,
        row: number,
        col: number,
        piece?: string
    ): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            let newmove;
            if (move.length > 0) {
                newmove = `${move}-${cell}`;
            } else {
                newmove = cell;
            }
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

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {
            valid: false,
            message: i18next.t("apgames:validation._general.DEFAULT_HANDLER"),
        };

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t(
                "apgames:validation.dagnacht.INITIAL_INSTRUCTIONS"
            );
            return result;
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        const cells = m.split(/[-]/);
        const cell = cells[0];

        // valid cell
        let x: number;
        let y: number;
        try {
            [x, y] = this.algebraic2coords(cell);
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {
                cell,
            });
            return result;
        }

        if (cells.length > 2) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.dagnacht.TOO_MANY");
            return result;
        }

        if (cells.length === 1) {
            if ((x % 2) === (y % 2)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.dagnacht.NOT_BLACK");
                return result;
            }
            // is empty
            if (this.board.has(cell)) {
                if (this.board.get(cell) === this.currplayer) {
                    result.valid = true;
                    result.complete = -1;
                    result.message = i18next.t("apgames:validation.dagnacht.PARTIAL_MOVE", {
                        cell,
                    });
                } else {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.OCCUPIED", {
                        where: cell,
                    });
                }
                return result;
            }

        } else {
            const cell2 = cells[1];
            if (!this.board.has(cell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.MOVE_EMPTY", {
                    where: cell,
                });
                return result;
            }
            if (this.board.get(cell) !== this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.MOVE_OPP", {
                    where: cell,
                });
                return result;
            }
            let x2: number;
            let y2: number;
            try {
                [x2, y2] = this.algebraic2coords(cell2);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {
                    cell2,
                });
                return result;
            }
            if (this.board.has(cell2)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.MOVE_OCCUPIED", {
                    where: cell,
                });
                return result;
            }
            if (! (((x === x2) && Math.abs(y - y2) === 1) || ((y === y2) && Math.abs(x - x2) === 1))) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.dagnacht.NOT_ORTH_ADJ");
                return result;
            }
        }

        // Looks good
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {trusted = false} = {}): DagEnNachtGame {
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
            if (!this.moves().includes(m)) {
                throw new UserFacingError(
                    "VALIDATION_FAILSAFE",
                    i18next.t("apgames:validation._general.FAILSAFE", { move: m })
                );
            }
        }

        this.results = [];

        const cells = m.split(/[-]/);
        if (cells.length === 1) {
            // place
            this.board.set(cells[0], this.currplayer);
            this.results.push({ type: "place", where: cells[0] });
        } else {
            // move
            this.board.set(cells[1], this.currplayer);
            this.board.delete(cells[0]);
            this.results.push({ type: "move", from: cells[0], to: cells[1] });
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

    protected checkEOG(): DagEnNachtGame {
        let prevPlayer: playerid = 1;
        if (this.currplayer === 1) {
            prevPlayer = 2;
        }

        const cells = this.lastmove!.split(/[-]/);
        const cell = cells[cells.length - 1];
        const grid = new RectGrid(this.boardSize, this.boardSize);
        for (const winDir of winningDirs) {
            let cnt = 0;
            let cntLight = 0;
            for (let i = 0; i < 2; i++) {
                const ray = grid.ray(...this.algebraic2coords(cell), winDir[i] as Direction);
                for (const c of ray) {
                    if (this.board.get(this.coords2algebraic(...c)) === prevPlayer) {
                        cnt++;
                        if ((c[0] % 2) === (c[1] % 2)) {
                            cntLight++;
                        }
                    } else {
                        break;
                    }
                }
            }
            if (cnt + 1 >= winDir[2] && cntLight > 0) {
                if (prevPlayer === 1) {
                    const [x, y] = this.algebraic2coords(cell);
                    if ((x % 2) === (y % 2))
                        cntLight++;
                }
                if (prevPlayer === 2 || cntLight > 2) {
                    this.gameover = true;
                    this.winner = [prevPlayer];
                    break;
                }
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

    public state(): IDagEnNachtState {
        return {
            game: DagEnNachtGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    public moveState(): IMoveState {
        return {
            _version: DagEnNachtGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board)
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < this.boardSize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    if (contents === 1) {
                        pieces.push("A");
                    } else {
                        pieces.push("B");
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join("");
        }

        // Build rep
        const rep: APRenderRep = {
            board: {
                style: "squares-checkered",
                width: this.boardSize,
                height: this.boardSize,
                startLight: true
            },
            legend: {
                A: {
                    name: "piece",
                    colour: 1,
                },
                B: {
                    name: "piece",
                    colour: 2,
                },
            },
            pieces: pstr,
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({
                        type: "enter",
                        targets: [{ row: y, col: x }],
                    });
                }
                else if (move.type === "move") {
                    const [fromX, fromY] = this.algebraic2coords(move.from);
                    const [toX, toY] = this.algebraic2coords(move.to);
                    rep.annotations.push({
                        type: "move",
                        targets: [
                            { row: fromY, col: fromX },
                            { row: toY, col: toX },
                        ],
                    });
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

    public clone(): DagEnNachtGame {
        return new DagEnNachtGame(this.serialize());
    }

    public aiaiMgl(): string {
        let mgl = "dagnacht";
        if (this.variants.includes("11x11")) {
            mgl = "dagnacht-11";
        } else if (this.variants.includes("13x13")) {
            mgl = "dagnacht-13";
        } else if (this.variants.includes("17x17")) {
            mgl = "dagnacht-17";
        } else if (this.variants.includes("19x19")) {
            mgl = "dagnacht-19";
        }
        return mgl;
    }
}
