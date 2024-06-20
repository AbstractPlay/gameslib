/* eslint-disable @typescript-eslint/no-unsafe-call */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult, IScores } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, UserFacingError } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-var-requires
const deepclone = require("rfdc/default");

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, 1|2|3>;
    lastmove?: string;
};

export interface IFlumeState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class FlumeGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Flume",
        uid: "flume",
        playercounts: [2],
        version: "20230716",
        dateAdded: "2023-07-17",
        // i18next.t("apgames:descriptions.flume")
        description: "apgames:descriptions.flume",
        urls: ["https://www.marksteeregames.com/Flume_Go_rules.pdf"],
        people: [
            {
                type: "designer",
                name: "Mark Steere",
                urls: ["http://www.marksteeregames.com/"],
            }
        ],
        variants: [
            {
                uid: "11x11",
                group: "board"
            },
            {
                uid: "7x7",
                group: "board",
            }
        ],
        categories: ["goal>majority", "mechanic>place", "board>shape>rect", "board>connect>rect", "components>simple>3c"],
        flags: ["pie", "multistep", "scores", "no-moves"]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, 1|2|3>;
    public gameover = false;
    public boardsize = 9;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IFlumeState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if ( (variants !== undefined) && (variants.length > 0) ) {
                this.variants = [...variants];
                if (variants.includes("11x11")) {
                    this.boardsize = 11;
                } else if (variants.includes("7x7")) {
                    this.boardsize = 7;
                }
            }
            const board = new Map<string, 1|2|3>();
            for (let x = 0; x < this.boardsize; x++) {
                for (let y = 0; y < this.boardsize; y++) {
                    if ( (x === 0) || (x === this.boardsize - 1) || (y === 0) || (y === this.boardsize - 1) ) {
                        const cell = FlumeGame.coords2algebraic(x, y, this.boardsize);
                        board.set(cell, 3);
                    }
                }
            }
            const fresh: IMoveState = {
                _version: FlumeGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IFlumeState;
            }
            if (state.game !== FlumeGame.gameinfo.uid) {
                throw new Error(`The Flume engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): FlumeGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.lastmove = state.lastmove;

        if (this.variants.includes("11x11")) {
            this.boardsize = 11;
        } else if (this.variants.includes("7x7")) {
            this.boardsize = 7;
        }

        return this;
    }

    public moves(): string[] {
        if (this.gameover) { return []; }
        const moves: string[] = [];

        // can place on any empty space
        const toCheck: string[] = [];
        for (let y = 0; y < this.boardsize; y++) {
            for (let x = 0; x < this.boardsize; x++) {
                const cell = FlumeGame.coords2algebraic(x, y, this.boardsize);
                if (! this.board.has(cell)) {
                    toCheck.push(cell)
                }
            }
        }

        const grid = new RectGrid(this.boardsize, this.boardsize);
        while (toCheck.length > 0) {
            const move = toCheck.pop()!;
            const parts = move.split(/\s*,\s*/);
            const last = parts[parts.length - 1];
            const [x, y] = FlumeGame.algebraic2coords(last, this.boardsize);
            const neighbours = grid.adjacencies(x, y, false).map(n => FlumeGame.coords2algebraic(...n, this.boardsize)).filter(c => this.board.has(c));
            if (neighbours.length >= 3) {
                const cloned: FlumeGame = Object.assign(new FlumeGame(), deepclone(this) as FlumeGame);
                cloned.board.set(move, this.currplayer);
                // if board is full, just push this move and return
                if (cloned.board.size === this.boardsize * this.boardsize) {
                    moves.push(move);
                }
                // otherwise, recurse
                else {
                    for (const nextmove of cloned.moves()) {
                        const newmove = `${move},${nextmove}`;
                        moves.push(newmove);
                    }
                }
            } else {
                moves.push(move);
            }
        }

        // can't place on center space on first turn
        if (this.stack.length === 1) {
            const idx = moves.findIndex(m => m === "e5");
            moves.splice(idx, 1);
        }

        return moves.sort((a,b) => a.localeCompare(b))
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = FlumeGame.coords2algebraic(col, row, this.boardsize);
            let newmove = "";
            if (move.length === 0) {
                newmove = cell;
            } else {
                newmove = `${move},${cell}`;
            }

            const result = this.validateMove(newmove) as IClickResult;
            if (! result.valid) {
                result.move = "";
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
            result.message = i18next.t("apgames:validation.flume.INITIAL_INSTRUCTIONS")
            return result;
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        const centre = FlumeGame.coords2algebraic(Math.floor(this.boardsize / 2), Math.floor(this.boardsize / 2), this.boardsize);
        if ( (this.stack.length === 1) && (m === centre) ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.flume.CENTRE_START")
            return result;
        }

        const cells = m.split(/\s*,\s*/);
        const grid = new RectGrid(this.boardsize, this.boardsize);
        const scratchBoard = deepclone(this.board) as Map<string,1|2|3>;
        for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];

            // valid cell
            try {
                FlumeGame.algebraic2coords(cell, this.boardsize);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell})
                return result;
            }

            // is empty
            if (scratchBoard.has(cell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: cell})
                return result;
            }

            const [x,y] = FlumeGame.algebraic2coords(cell, this.boardsize);
            const neighbours = grid.adjacencies(x,y,false).map(n => FlumeGame.coords2algebraic(...n, this.boardsize)).filter(c => scratchBoard.has(c)).length;
            // if we're not on the last submove yet
            if (i !== cells.length - 1) {
                if (neighbours < 3) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.flume.INVALID_CONTINUATION")
                    return result;
                }
            }
            // otherwise, decide whether the move is complete or not
            else {
                if ( (neighbours < 3) || (scratchBoard.size === (this.boardsize * this.boardsize) - 1) ) {
                    // All done
                    result.valid = true;
                    result.complete = 1;
                    result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                    return result;
                } else {
                    // Valid partial
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.flume.KEEP_GOING");
                    return result;
                }
            }
            // apply submove
            scratchBoard.set(cell, this.currplayer);
        }
        // added to satisfy the linter, but really, it should never get here
        return result;
    }

    public move(m: string, {partial = false, trusted = false} = {}): FlumeGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (! partial && ! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            // if (! this.moves().includes(m)) {
            //     throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            // }
        }

        this.results = [];
        for (const move of m.split(",")) {
            this.board.set(move, this.currplayer);
            this.results.push({type: "place", where: move});
        }
        if (partial) { return this; }

        // update currplayer
        this.lastmove = m.replace(/,/g, ", ");
        let newplayer = (this.currplayer as number) + 1;
        if (newplayer > this.numplayers) {
            newplayer = 1;
        }
        this.currplayer = newplayer as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] },
        ]
    }

    public getPlayerScore(player: number): number {
        return [...this.board.values()].filter(n => n === player).length;
    }

    protected checkEOG(): FlumeGame {
        const target = Math.ceil((this.boardsize - 2)**2 / 2);
        const score1 = this.getPlayerScore(1);
        const score2 = this.getPlayerScore(2);
        if ( (score1 >= target) || (score2 >= target) ) {
            this.gameover = true;
            if (score1 > score2) {
                this.winner = [1];
            } else {
                this.winner = [2];
            }
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IFlumeState {
        return {
            game: FlumeGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: FlumeGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < this.boardsize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < this.boardsize; col++) {
                const cell = FlumeGame.coords2algebraic(col, row, this.boardsize);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    if (contents === 1) {
                        pieces.push("A");
                    } else if (contents === 2) {
                        pieces.push("B");
                    } else {
                        pieces.push("C");
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join("");
        }
        // pstr = pstr.replace(/-{19}/g, "_");

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "vertex",
                width: this.boardsize,
                height: this.boardsize,
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
                C: {
                    name: "piece",
                    colour: 3,
                }
            },
            pieces: pstr
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            const pts: [number,number][] = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
                    const [x, y] = FlumeGame.algebraic2coords(move.where!, this.boardsize);
                    pts.push([x,y]);
                }
            }
            if (pts.length > 0) {
                // @ts-ignore
                rep.annotations.push({type: "dots", targets: pts.map(n => {return {col: n[0], row: n[1]}; }), colour: "#fff"});
            }
        }
        if (this.results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            const pts: [number,number][] = [];
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = FlumeGame.algebraic2coords(move.where!, this.boardsize);
                    pts.push([x,y]);
                }
            }
            if (pts.length > 0) {
                // @ts-ignore
                rep.annotations.push({type: "dots", targets: pts.map(n => {return {col: n[0], row: n[1]}; }), colour: "#000"});
            }
        }

        return rep;
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }
        status += "**Scores**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const score = this.getPlayerScore(n);
            status += `Player ${n}: ${score}\n\n`;
        }

        return status;
    }

    public clone(): FlumeGame {
        return new FlumeGame(this.serialize());
    }
}
