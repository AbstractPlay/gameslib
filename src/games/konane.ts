import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { SquareOrthGraph } from "../common/graphs";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const deepclone = require("rfdc/default");

export type PlayerId = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: PlayerId;
    board: Map<string, PlayerId>;
    lastmove?: string;
};

export interface IKonaneState extends IAPGameState {
    winner: PlayerId[];
    stack: Array<IMoveState>;
};

export class KonaneGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Konane",
        uid: "konane",
        playercounts: [2],
        version: "20241029",
        dateAdded: "2024-11-01",
        // i18next.t("apgames:descriptions.konane")
        description: "apgames:descriptions.konane",
        // i18next.t("apgames:notes.konane")
        notes: "apgames:notes.konane",
        urls: ["https://boardgamegeek.com/boardgame/8122/konane"],
        people: [
            {
                type: "coder",
                name: "ManaT",
                urls: [],
                apid: "a82c4aa8-7d43-4661-b027-17afd1d1586f",
            },
        ],
        categories: ["goal>immobilize", "mechanic>capture", "other>traditional", "board>shape>rect"],
        flags: ["automove"],
        variants: [
            {
                uid: "size-8",
                group: "board"
            }
        ]
    };

    public numplayers = 2;
    public currplayer: PlayerId = 1;
    public board!: Map<string, PlayerId>;
    public graph?: SquareOrthGraph;
    public gameover = false;
    public winner: PlayerId[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private boardSize = 0;
    private _points: [number, number][] = [];
    private _highlight: string | undefined;

    constructor(state?: IKonaneState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            this.boardSize = this.getBoardSize();
            const board: Map<string, PlayerId> = new Map();
            let color = 2 as PlayerId;
            for (let x = 0; x < this.boardSize; x++) {
                for (let y = 0; y < this.boardSize; y++) {
                    board.set(GameBase.coords2algebraic(x, y, this.boardSize), color);
                    color = (color === 1) ? 2 : 1;
                }
                color = (color === 1) ? 2 : 1;
            }

            const fresh: IMoveState = {
                _version: KonaneGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IKonaneState;
            }
            if (state.game !== KonaneGame.gameinfo.uid) {
                throw new Error(`The Konane engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.boardSize = this.getBoardSize();
        this.load();
        this.buildGraph();
    }

    public load(idx = -1): KonaneGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;

        this.board = deepclone(state.board) as Map<string, PlayerId>;
        this.lastmove = state.lastmove;
        this.results = [...state._results];
        return this;
    }

    private buildGraph(): SquareOrthGraph {
        this.graph = new SquareOrthGraph(this.boardSize, this.boardSize);
        return this.graph;
    }

    private getGraph(boardSize?: number): SquareOrthGraph {
        if (boardSize === undefined) {
            return (this.graph === undefined) ? this.buildGraph() : this.graph;
        } else {
            return new SquareOrthGraph(boardSize, boardSize);
        }
    }

    // Fixes known issue with some edge cases not calling load
    private listCells(ordered = false): string[] | string[][] {
        try {
            if (ordered === undefined) {
                return this.getGraph().listCells();
            } else {
                return this.getGraph().listCells(ordered);
            }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (e) {
            return this.buildGraph().listCells(ordered);
        }
    }

    private getBoardSize(): number {
        // Get board size from variants.
        if ( (this.variants !== undefined) && (this.variants.length > 0) && (this.variants[0] !== undefined) && (this.variants[0].length > 0) ) {
            const sizeVariants = this.variants.filter(v => v.includes("size"))
            if (sizeVariants.length > 0) {
                const size = sizeVariants[0].match(/\d+/);
                return parseInt(size![0], 10);
            }
            if (isNaN(this.boardSize)) {
                throw new Error(`Could not determine the board size from variant "${this.variants[0]}"`);
            }
        }
        return 6;
    }

    public moves(player?: PlayerId): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];
        if (this.stack.length === 1) {
            moves.push("a1");
            if (this.boardSize === 6) {
                moves.push("c3");
                moves.push("d4");
                moves.push("f6");
            } else {
                moves.push("d4");
                moves.push("e5");
                moves.push("h8");
            }
        } else if (this.stack.length === 2) {
             for (const m of this.getGraph().neighbours(this.stack[1].lastmove!)) {
                moves.push(m);
             }
        } else {
            for (const cell of (this.listCells() as string[]).filter(c => this.board.has(c) && this.board.get(c) === this.currplayer)) {
                for (const neighbour of this.getGraph().neighbours(cell).filter(n => this.board.has(n))) {
                    const bearing = this.getGraph().bearing(cell, neighbour) as "N"|"E"|"S"|"W";
                    let [x, y] = this.getGraph().algebraic2coords(cell);
                    let coords = this.getGraph().move(x, y, bearing, 2);
                    while (true) {
                        if (coords === undefined) break;
                        const landing = this.getGraph().coords2algebraic(coords[0], coords[1]);
                        if (this.board.has(landing)) break;
                        moves.push(`${cell}-${landing}`);
                        [x, y] = this.getGraph().algebraic2coords(landing);
                        const enemyCoords = this.getGraph().move(x, y, bearing);
                        coords = this.getGraph().move(x, y, bearing, 2);
                        if (enemyCoords === undefined || coords === undefined) break;
                        const enemy = this.getGraph().coords2algebraic(enemyCoords[0], enemyCoords[1]);
                        const empty = this.getGraph().coords2algebraic(coords[0], coords[1]);
                        if (!this.board.has(enemy) || this.board.has(empty)) break;
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
            const cell = this.getGraph().coords2algebraic(col, row);
            let newmove = "";
            if (this.board.has(cell) && this.board.get(cell) === this.currplayer) {
                newmove = cell;
            } else if (move.length === 2 && !this.board.has(cell)) {
                newmove = `${move}-${cell}`;
            }
            const result = this.validateMove(newmove) as IClickResult;
            if (!result.valid || newmove === "") {
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
        const result: IValidationResult = {valid: false, complete: -1, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (m.length === 0) {
            result.valid = true;
            if (this.stack.length === 1) {
                result.message = i18next.t("apgames:validation.konane.FIRST_MOVE");
            } else if (this.stack.length === 2) {
                result.message = i18next.t("apgames:validation.konane.SECOND_MOVE");
            } else {
                result.message = i18next.t("apgames:validation.konane.NORMAL_MOVE");
            }
            return result;
        }

        const moves = this.moves();
        if (!moves.includes(m)) {
            if (this.stack.length === 1) {
                result.message = i18next.t("apgames:validation.konane.FIRST_MOVE");
            } else if (this.stack.length === 2) {
                result.message = i18next.t("apgames:validation.konane.SECOND_MOVE");
            } else if (m.length > 0 && moves.filter(move => move.startsWith(m)).length > 0) {
                result.valid = true;
                result.canrender = true;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            } else {
                result.message = i18next.t("apgames:validation.konane.INVALID_MOVE");
            }
            return result;
        }

        // we're good
        result.valid = true;
        result.complete = 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");

        return result;
    }

    public move(m: string, { trusted = false } = {}): KonaneGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        if (m.length === 0) return this;

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        const moves = this.moves();

        let complete = false;
        const result = this.validateMove(m);
        if (result.complete === 1) complete = true;
        if (!trusted && !result.valid) throw new UserFacingError("VALIDATION_GENERAL", result.message);

        this.results = [];
        this._points = [];
        this._highlight = undefined;

        if (complete) {
            if (!m.includes("-")) {
                this.board.delete(m);
                this.results.push({type: "take", from: m});
            } else {
                const cells: string[] = m.split("-");
                this.board.delete(cells[0]);
                this.board.set(cells[1], this.currplayer);
                this.results.push({type: "move", from: cells[0], to: cells[1]});

                const bearing = this.getGraph().bearing(cells[0], cells[1]) as "N"|"E"|"S"|"W";
                const [endX, endY] = this.getGraph().algebraic2coords(cells[1]);
                let [x, y] = this.getGraph().algebraic2coords(cells[0]);
                while (x !== endX || y !== endY) {
                    const coords = this.getGraph().move(x, y, bearing)!;
                    const takeFrom = this.getGraph().coords2algebraic(coords[0], coords[1]);
                    if (this.board.has(takeFrom) && this.board.get(takeFrom) !== this.currplayer) {
                        this.board.delete(takeFrom);
                        this.results.push({type: "take", from: takeFrom});
                    }
                    [x, y] = this.getGraph().move(x, y, bearing)!;
                }
            }
        } else {
            this._highlight = m;
            for (const move of moves.filter(mv => mv.startsWith(m))) {
                const cells = move.split("-");
                const coords = this.getGraph().algebraic2coords(cells[1]);
                this._points.push(coords);
            }
        }

        // update currplayer
        this.lastmove = m;
        this.currplayer = this.getOtherPlayer(this.currplayer);

        this.checkEOG();
        this.saveState();
        return this;
    }

    private getOtherPlayer(player: PlayerId): PlayerId {
        const otherplayer = (player as number) + 1;
        if (otherplayer > this.numplayers) return 1;
        return otherplayer as PlayerId;
    }

    protected checkEOG(): KonaneGame {
        if (this.moves().length === 0) {
            this.gameover = true;
            this.winner = [this.getOtherPlayer(this.currplayer)];
        }
        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IKonaneState {
        return {
            game: KonaneGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: KonaneGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,

            board: deepclone(this.board) as Map<string, PlayerId>
        };
    }

    public render(): APRenderRep {
        let pstr = "";
        const legendNames: Set<string> = new Set();
        for (const row of this.listCells(true)) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            let pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const player = this.board.get(cell)!;
                    let key;
                    if (player === 1) {
                        key = this._highlight === cell ? "C" : "A";
                    } else {
                        key = this._highlight === cell ? "D" : "B";
                    }
                    legendNames.add(key);
                    pieces.push(key);
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

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares",
                width: this.boardSize,
                height: this.boardSize
            },
            legend: {
                A: { name: "piece", colour: 1 },
                B: { name: "piece", colour: 2 },
                C: { name: "piece-horse", colour: 1 },
                D: { name: "piece-horse", colour: 2 }
            },
            pieces: pstr
        };

        rep.annotations = [];
        for (const move of this.stack[this.stack.length - 1]._results) {
            if (move.type === "move") {
                const [fromX, fromY] = this.getGraph().algebraic2coords(move.from);
                const [toX, toY] = this.getGraph().algebraic2coords(move.to);
                rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
            } else if (move.type === "take") {
                const [x, y] = this.getGraph().algebraic2coords(move.from);
                rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
            }
        }
        if (this._points.length > 0) {
            const points = [];
            for (const coords of this._points) {
                points.push({ row: coords[1], col: coords[0] });
            }
            rep.annotations.push({type: "dots", targets: points as [{row: number; col: number;}, ...{row: number; col: number;}[]]});
        }

        if (rep.annotations.length === 0) {
            delete rep.annotations;
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

    public clone(): KonaneGame {
        return new KonaneGame(this.serialize());
    }

}
