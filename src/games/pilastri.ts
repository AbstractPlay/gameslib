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
    board: Map<string, PlayerId[]>;
    lastmove?: string;
};

export interface IPilastriState extends IAPGameState {
    winner: PlayerId[];
    stack: Array<IMoveState>;
};

export class PilastriGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Pilastri",
        uid: "pilastri",
        playercounts: [2],
        version: "20250424",
        dateAdded: "2025-04-25",
        // i18next.t("apgames:descriptions.pilastri")
        description: "apgames:descriptions.pilastri",
        urls: [
            "https://cjffield.com/rules/pilastri.pdf",
            "https://boardgamegeek.com/boardgame/445080/pilastri"
        ],
        people: [
            {
                type: "designer",
                name: "Christopher Field",
                urls: ["https://cjffield.com"],
                apid: "a82c4aa8-7d43-4661-b027-17afd1d1586f",
            },
            {
                type: "coder",
                name: "ManaT",
                urls: [],
                apid: "a82c4aa8-7d43-4661-b027-17afd1d1586f",
            },
        ],
        categories: ["goal>immobilize", "mechanic>move", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["automove"],
        variants: [
            {
                uid: "size-8",
                group: "board",
                name: "Size 8 board",
                description: "Size 8 board"
            },
            {
                uid: "jumpers",
                group: "rules",
                name: "High jumpers",
                description: "A piece must move higher, but pieces that start with nothing beneath them are allowed to land on any other stack."
            }
        ]
    };

    public numplayers = 2;
    public currplayer: PlayerId = 1;
    public board!: Map<string, PlayerId[]>;
    public graph?: SquareOrthGraph;
    public gameover = false;
    public winner: PlayerId[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private boardSize = 0;
    private _points: [number, number][] = [];
    private _highlight: string | undefined;

    constructor(state?: IPilastriState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            this.boardSize = this.getBoardSize();
            const board: Map<string, PlayerId[]> = new Map();
            let color = 2 as PlayerId;
            for (let x = 0; x < this.boardSize; x++) {
                for (let y = 0; y < this.boardSize; y++) {
                    board.set(GameBase.coords2algebraic(x, y, this.boardSize), [color]);
                    color = (color === 1) ? 2 : 1;
                }
                color = (color === 1) ? 2 : 1;
            }

            const fresh: IMoveState = {
                _version: PilastriGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IPilastriState;
            }
            if (state.game !== PilastriGame.gameinfo.uid) {
                throw new Error(`The Pilastri engine cannot process a game of '${state.game}'.`);
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

    public load(idx = -1): PilastriGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;

        this.board = deepclone(state.board) as Map<string, PlayerId[]>;
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

    private areJumpersAllowed(): boolean {
        return this.variants !== undefined && this.variants.length > 0 && this.variants.includes("jumpers");
    }

    public moves(player?: PlayerId): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];
        for (const cell of (this.listCells() as string[]).filter(c => this.board.has(c) && this.board.get(c)!.at(-1) === this.currplayer)) {
            const height = this.board.get(cell)!.length;
            const [x, y] = this.getGraph().algebraic2coords(cell);
            for (const bearing of ["N","E","S","W"]) {
                const rayCells = this.getGraph().ray(x, y, bearing as "N"|"E"|"S"|"W");
                for (const [x0, y0] of rayCells) {
                    const cell0 = this.getGraph().coords2algebraic(x0, y0);
                    if (this.board.has(cell0)) {
                        if ((height === 1 && this.board.get(cell0)!.length === height) ||
                            ((height > 1 || this.areJumpersAllowed()) && this.board.get(cell0)!.length >= height)) {
                            moves.push(`${cell}-${cell0}`);
                        }
                        break;
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
            if (move.length === 0 && this.board.has(cell) && this.board.get(cell)!.at(-1) === this.currplayer) {
                newmove = cell;
            } else if (this.board.has(move) && this.board.get(move)!.at(-1) === this.currplayer && this.board.has(cell)) {
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
            result.message = i18next.t("apgames:validation.pilastri.NORMAL_MOVE");
            return result;
        }

        const moves = this.moves();
        if (!moves.includes(m)) {
            if (this.board.has(m) && moves.filter(move => move.startsWith(m)).length > 0) {
                result.valid = true;
                result.canrender = true;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            } else {
                result.message = i18next.t("apgames:validation.pilastri.INVALID_MOVE");
                if (this.areJumpersAllowed()) result.message = i18next.t("apgames:validation.pilastri.INVALID_MOVE_JUMPERS");
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

    public move(m: string, { trusted = false } = {}): PilastriGame {
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
            const cells: string[] = m.split("-");
            const oldStack = [...this.board.get(cells[0])!];
            const piece = oldStack.pop()!;
            if (oldStack.length === 0) this.board.delete(cells[0]);
            else this.board.set(cells[0], oldStack);
            const newStack = [...this.board.get(cells[1])!];
            newStack.push(piece);
            this.board.set(cells[1], newStack);
            this.results.push({type: "move", from: cells[0], to: cells[1]});

            // update currplayer
            this.lastmove = m;
            this.currplayer = this.getOtherPlayer(this.currplayer);

            this.checkEOG();
            this.saveState();
        } else {
            this._highlight = m;
            for (const move of moves.filter(mv => mv.startsWith(m))) {
                const cells = move.split("-");
                const coords = this.getGraph().algebraic2coords(cells[1]);
                this._points.push(coords);
            }
        }

        return this;
    }

    private getOtherPlayer(player: PlayerId): PlayerId {
        const otherplayer = (player as number) + 1;
        if (otherplayer > this.numplayers) return 1;
        return otherplayer as PlayerId;
    }

    protected checkEOG(): PilastriGame {
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

    public state(): IPilastriState {
        return {
            game: PilastriGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: PilastriGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,

            board: deepclone(this.board) as Map<string, PlayerId[]>
        };
    }

    public render(): APRenderRep {
        let pstr = "";
        for (const row of this.listCells(true)) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            let pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    let str = "";
                    for (const player of this.board.get(cell)!) {
                        if (player === 1) {
                            str += this._highlight === cell ? "C" : "A";
                        } else {
                            str += this._highlight === cell ? "D" : "B";
                        }
                    }
                    pieces.push(str);
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
            renderer: "stacking-offset",
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

    public clone(): PilastriGame {
        return new PilastriGame(this.serialize());
    }

}
