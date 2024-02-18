/**
 * BINAR HAS BEEN SOLVED! Code has been marked as "experimental" so it is no longer available.
 * For now, at least, the game code should remain. One day, I will purge the historical records
 * and the code can be permanently removed.
 */

/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { matrixRectRot90, reviver, UserFacingError } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: boolean[][];
    lastmove?: string;
};

export interface IBinarState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

const labels = "abcdefghijklmnopqrstuvwxyz".split("");

type LabelMarker = {
    /**
     * A ham-fisted way of getting arbitrary labels on a board or series of boards (e.g., Wizard's Garden). Experimentation will definitely be needed to accomplish your goal.
     */
    type: "label";
    /**
     * If true, the labels will be drawn below the grid lines.
     */
    belowGrid?: boolean;
    /**
     * The string itself you want to display.
     */
    label: string;
    /**
     * Expects exactly two points. This defines a line along which the text will flow and be centred along, as best as we can.
     *
     * @minItems 2
     * @maxItems 2
     */
    points: [
      {
        row: number;
        col: number;
      },
      {
        row: number;
        col: number;
      }
    ];
    /**
     * You almost never want a label *on* the board. Nudge lets you use board coordinates to get started and then move that line by a multiple of the 'cellspacing' (i.e., the base unit, the width of a square in a square grid). The nudge is applied to both points.
     */
    nudge?: {
      dx: number;
      dy: number;
    };
    /**
     * The colour of the shaded area. Can be either a number (which will be interpreted as a built-in player colour) or a hexadecimal colour string.
     */
    colour?: number;
    /**
     * Font size in absolute pixels
     */
    size?: number;
    /**
     * Font style, e.g. 'font: Stencil; font-weight: Bold'
     */
    font?: string;
  };

export class BinarGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Binar",
        uid: "binar",
        playercounts: [2],
        version: "20240214",
        // i18next.t("apgames:descriptions.binar")
        description: "apgames:descriptions.binar",
        // i18next.t("apgames:notes.binar")
        notes: "apgames:notes.binar",
        urls: ["https://marksteeregames.com/Binar_rules.pdf"],
        people: [
            {
                type: "designer",
                name: "Mark Steere",
                urls: ["https://marksteeregames.com/"]
            }
        ],
        flags: ["shared-pieces", "experimental"],
        variants: [
            {
                uid: "partisan",
            },
            {
                uid: "size-5",
                group: "board",
            },
            {
                uid: "size-6",
                group: "board",
            },
        ]
    };

    private coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardsize);
    }
    private algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardsize);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: boolean[][];
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    public get boardsize(): number {
        if (this.variants.includes("size-5")) {
            return 5;
        } else if (this.variants.includes("size-6")) {
            return 6;
        }
        return 4;
    }

    constructor(state?: IBinarState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const board: boolean[][] = [];
            for (let y = 0; y < this.boardsize; y++) {
                const row: boolean[] = [];
                for (let x = 0; x < this.boardsize; x++) {
                    row.push(false);
                }
                board.push(row);
            }
            const fresh: IMoveState = {
                _version: BinarGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IBinarState;
            }
            if (state.game !== BinarGame.gameinfo.uid) {
                throw new Error(`The Binar engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): BinarGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = [...state.board.map(lst => [...lst])];
        this.lastmove = state.lastmove;
        this.results = [...state._results];
        return this;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];

        // in this one case, return list of column moves
        if (this.variants.includes("partisan") && player === 2) {
            for (let x = 0; x < this.boardsize; x++) {
                let str = "";
                for (let y = 0; y < this.boardsize; y++) {
                    str += this.board[y][x] === true ? "1" : "0";
                }
                const num = parseInt(str, 2);
                if (num < 15) {
                    moves.push(labels[x]);
                }
            }
        }
        // in all others, return rows
        else {
            for (let y = 0; y < this.boardsize; y++) {
                const str = this.board[y].map(b => b === true ? "1" : "0").join("");
                const num = parseInt(str, 2);
                if (num < 15) {
                    moves.push(labels[y]);
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
            let newmove = "";
            // couldn't be simpler
            if (this.variants.includes("partisan") && this.currplayer === 2) {
                newmove = labels[col];
            } else {
                newmove = labels[row];
            }

            const result = this.validateMove(newmove) as IClickResult;
            if (! result.valid) {
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

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.binar.INITIAL_INSTRUCTIONS", {context: (this.variants.includes("partisan") && this.currplayer === 2) ? "col" : "row"});
            return result;
        }

        // valid index
        const idx = labels.findIndex(c => c === m);
        if (idx === -1) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.binar.INVALID_IDX", {move: m});
            return result;
        }

        // row/col can't already be the maximum value
        let maxStr = "";
        for (let i = 0; i < this.boardsize; i++) {
            maxStr += "1";
        }
        const maxVal = parseInt(maxStr, 2);
        let currStr = "";
        // idx is a column
        if (this.variants.includes("partisan") && this.currplayer === 2) {
            for (let y = 0; y < this.boardsize; y++) {
                currStr += this.board[y][idx] === true ? "1" : "0";
            }
        }
        // idx is a row
        else {
            currStr = this.board[idx].map(b => b === true ? "1" : "0").join("");
        }
        const currVal = parseInt(currStr, 2);
        if (currVal >= maxVal) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.binar.MAX_VAL", {move: m, maxVal, context: (this.variants.includes("partisan") && this.currplayer === 2) ? "col" : "row"});
            return result;
        }

        // we're good
        result.valid = true;
        result.complete = 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {trusted = false} = {}): BinarGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (! this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];

        const idx = labels.findIndex(c => c === m);
        if (idx === -1) {
            throw new Error(`Could not find an index for the move ${m}`);
        }
        // move is a column
        if (this.variants.includes("partisan") && this.currplayer === 2) {
            const currStr: string[] = [];
            for (let y = 0; y < this.boardsize; y++) {
                currStr.push(this.board[y][idx] === true ? "1" : "0");
            }
            const currVal = parseInt(currStr.join(""), 2);
            const newStr = Number(currVal + 1).toString(2).split("");
            while (newStr.length < this.boardsize) {
                newStr.unshift("0");
            }

            // update board state and signal added/removed stones
            for (let y = 0; y < this.boardsize; y++) {
                this.board[y][idx] = newStr[y] === "1" ? true : false;
                if (currStr[y] > newStr[y]) {
                    this.results.push({type: "remove", where: this.coords2algebraic(idx, y), num: 1});
                } else if (currStr[y] < newStr[y]) {
                    this.results.push({type: "add", where: this.coords2algebraic(idx, y), num: 1});
                }
            }
        }
        // otherwise it's a row
        else {
            const currStr: string[] = this.board[idx].map(b => b === true ? "1" : "0");
            const currVal = parseInt(currStr.join(""), 2);
            const newStr = Number(currVal + 1).toString(2).split("");
            while (newStr.length < this.boardsize) {
                newStr.unshift("0");
            }

            // update board state and signal added/removed stones
            for (let x = 0; x < this.boardsize; x++) {
                this.board[idx][x] = newStr[x] === "1" ? true : false;
                if (currStr[x] > newStr[x]) {
                    this.results.push({type: "remove", where: this.coords2algebraic(x, idx), num: 1});
                } else if (currStr[x] < newStr[x]) {
                    this.results.push({type: "add", where: this.coords2algebraic(x, idx), num: 1});
                }
            }
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

    public isRow(): boolean {
        // rows
        for (const row of this.board) {
            if (row.reduce((prev, curr) => prev && curr, true)) {
                return true;
            }
        }
        // rotate then check columns
        const rotated = matrixRectRot90([...this.board.map(lst => [...lst])]) as boolean[][];
        for (const col of rotated) {
            if (col.reduce((prev, curr) => prev && curr, true)) {
                return true;
            }
        }
        const pos: boolean[] = [];
        const neg: boolean[] = [];
        for (let i = 0; i < this.boardsize; i++) {
            pos.push(this.board[this.boardsize - i - 1][i]);
            neg.push(this.board[i][i])
        }
        if (pos.reduce((prev, curr) => prev && curr, true)) {
            return true;
        }
        if (neg.reduce((prev, curr) => prev && curr, true)) {
            return true;
        }
        return false;
    }

    protected checkEOG(): BinarGame {
        let prevPlayer: playerid = 1;
        if (this.currplayer === 1) {
            prevPlayer = 2;
        }

        if (this.isRow()) {
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

    public state(): IBinarState {
        return {
            game: BinarGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: BinarGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: [...this.board.map(lst => [...lst])],
        };
    }

    public render(): APRenderRep {
        // Build piece string
        const pstr: string[][] = [];
        for (const row of this.board) {
            const pieces: string[] = [];
            for (const cell of row) {
                if (cell) {
                    pieces.push("A")
                } else {
                    pieces.push("-");
                }
            }
            pstr.push(pieces);
        }

        const markers: LabelMarker[] = [];
        // always add row values
        for (let row = 0; row < this.boardsize; row++) {
            const str = this.board[row].map(b => b === true ? "1" : "0").join("");
            const val = parseInt(str, 2);
            markers.push({
                type: "label",
                label: val.toString(),
                points: [
                    {row, col: this.boardsize - 1},
                    {row, col: this.boardsize},
                ],
                nudge: {dx: 0.75, dy: 0.35},
            });
        }
        // add columns if partisan variant
        if (this.variants.includes("partisan")) {
            for (let col = 0; col < this.boardsize; col++) {
                const str: string[] = [];
                for (let row = 0; row < this.boardsize; row++) {
                    str.push(this.board[row][col] === true ? "1" : "0");
                }
                const val = parseInt(str.join(""), 2);
                markers.push({
                    type: "label",
                    label: val.toString(),
                    points: [
                        {row: 0, col},
                        {row: 0, col: col + 1},
                    ],
                    nudge: {dx: 0, dy: -0.5},
                });
            }
        }

        // Build rep
        const rep: APRenderRep =  {
            options: ["hide-labels-half"],
            board: {
                style: "squares",
                width: this.boardsize,
                height: this.boardsize,
                rowLabels: [...labels.slice(0, this.boardsize)].reverse(),
                markers,
            },
            legend: {
                A: {
                    name: "piece",
                    player: 1
                },
            },
            pieces: pstr.map(p => p.join("")).join("\n"),
        };

        // Add annotations
        if (this.results.length > 0) {
            // @ts-ignore
            rep.annotations = [];

            for (const move of this.results) {
                if (move.type === "add") {
                    const [x, y] = this.algebraic2coords(move.where);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                } else if (move.type === "remove") {
                    const [x, y] = this.algebraic2coords(move.where);
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
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        return status;
    }

    public player2seat(player: playerid = this.currplayer): string {
        if (this.variants.includes("partisan")) {
            if (player === 1) {
                return "Horizontal";
            } else {
                return "Vertical";
            }
        } else {
            return `Player ${player}`;
        }
    }

    public clone(): BinarGame {
        return Object.assign(new BinarGame(), deepclone(this) as BinarGame);
        // return new BinarGame(this.serialize());
    }
}
