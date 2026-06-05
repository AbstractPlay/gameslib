import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, UserFacingError, SquareOrthGraph } from "../common";
import i18next from "i18next";

type playerid = 1 | 2; // regarding pieces: 1 is the ball, 2 are the walls

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface IInvectorState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class InvectorGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Invector",
        uid: "invector",
        playercounts: [2],
        version: "20260605",
        dateAdded: "2026-06-05",
        // i18next.t("apgames:descriptions.invector")
        description: "apgames:descriptions.invector",
        notes: "apgames:notes.invector",
        urls: [
            "https://www.marksteeregames.com/Invector_rules.pdf",
        ],
        people: [
            {
                type: "designer",
                name: "Mark Steere",
                urls: ["http://www.marksteeregames.com/"],
                apid: "e7a3ebf6-5b05-4548-ae95-299f75527b3f",
            },
            {
                type: "coder",
                name: "João Pedro Neto",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3829/joao-pedro-neto"],
                apid: "9228bccd-a1bd-452b-b94f-d05380e6638f",
            },
        ],
        categories: ["goal>unify", "mechanic>move", "mechanic>capture", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        variants: [
            { uid: "size-6",  group: "board" }, // 5x6
            { uid: "#board", }, // 7 rows x 8 cols
            { uid: "size-10", group: "board" }, //  9x10
            { uid: "size-12", group: "board" }, // 11x12
            { uid: "size-14", group: "board" }, // 13x14
            { uid: "size-16", group: "board" }, // 15x16
        ],
        flags: ["automove", "pie", "experimental"]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    private boardSize = this.getBoardSize();
    private grid: RectGrid;
    private dots: [number, number][] = []; // if there are points here, the renderer will show them

    constructor(state?: IInvectorState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if ( (variants !== undefined) && (variants.length > 0) ) {
                this.variants = [...variants];
            }
            const board = new Map<string, playerid>();
            const sz = this.getBoardSize();
            const g = new SquareOrthGraph(sz, sz-1);

            for (let x=0; x<sz; x++) {
                for (let y=0; y<sz-1; y++) {
                    const cell = g.coords2algebraic(x, y);
                    const owner: playerid = x%2 === y%2 ? 1 : 2;
                    board.set(cell, owner);
                }
            }
            const fresh: IMoveState = {
                _version: InvectorGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IInvectorState;
            }
            if (state.game !== InvectorGame.gameinfo.uid) {
                throw new Error(`The Invector engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
        this.grid = new RectGrid(this.getBoardSize(), this.getBoardSize()-1);
    }

    public load(idx = -1): InvectorGame {
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
        this.boardSize = this.getBoardSize();
        this.results = [...state._results];
        return this;
    }

    public getBoardSize(): number {
        // Get board size from variants.
        if (this.variants    !== undefined && this.variants.length > 0 &&
            this.variants[0] !== undefined && this.variants[0].length > 0) {
            const sizeVariants = this.variants.filter(v => v.includes("size"))
            if (sizeVariants.length > 0) {
                const size = sizeVariants[0].match(/\d+/);
                return parseInt(size![0], 10);
            }
            if (isNaN(this.boardSize)) {
                throw new Error(`Could not determine the board size from variant "${this.variants[0]}"`);
            }
        }
        return 8;
    }

    public get graph(): SquareOrthGraph {
        return new SquareOrthGraph(this.boardSize, this.boardSize-1);
    }

    // return the list of orthogonal neighbors of 'cell'
    private orthNeighbours(cell: string): string[] {
        const [x, y] = this.graph.algebraic2coords(cell);
        const neighbours = this.grid.adjacencies(x, y, false);
        return neighbours.map(n => this.graph.coords2algebraic(...n));
    }

    private manhattan(p1: [number, number], p2: [number, number]): number {
        return Math.abs(p1[0] - p2[0]) + Math.abs(p1[1] - p2[1]);
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) { player = this.currplayer; }
        const g = this.graph;
        const moves = [];

        for (const cell of g.graph.nodes()) {
            if (this.board.has(cell) && this.board.get(cell) === player) {
                // players can move their friendly stones to capture an enemy stone
                for (const neigh of this.orthNeighbours(cell)) {
                    if (this.board.has(neigh) && this.board.get(neigh) !== player) {
                        moves.push(`${cell}-${neigh}`);
                    }
                }

                // pieces can also move to empty cell if it's near to the board center of mass
                const xc = (this.boardSize-1) / 2; // eg, if 6 cols, xc is 2.5 (0-indexed)
                const yc = (this.boardSize-2) / 2; // eg, if 5 rows, ys is 2   (0-indexed)

                const [x, y] = g.algebraic2coords(cell);
                const currentDistance = this.manhattan([x, y], [xc, yc] );
                for (const neigh of this.orthNeighbours(cell)) {
                    const [x1, y1] = g.algebraic2coords(neigh);
                    const newDistance = this.manhattan([x1, y1], [xc, yc] );
                    if ( !this.board.has(neigh) && newDistance < currentDistance) {
                        moves.push(`${cell}-${neigh}`);
                    }
                }
            }
        }

        if (moves.length === 0) {
            moves.push("pass"); // if no legal move is available, pass turn
        }

        return moves.sort((a,b) => a.localeCompare(b));
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.graph.coords2algebraic(col, row);
            let newmove = "";

            if (move === "") {
                newmove = cell;
            } else if (move === cell) {
                newmove = "";
            } else {
                newmove = `${move}-${cell}`;
            }

            const result = this.validateMove(newmove) as IClickResult;
            result.move = result.valid ? newmove : move;
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", {move, row, col, piece, emessage: (e as Error).message})
            }
        }
    }

    private hasPrefix(moves: string[], partial: string): boolean {
        return moves.some(str => str.startsWith(partial));
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.invector.INITIAL_INSTRUCTIONS");
            return result;
        }

        const moves = m.split('-');

        const allMoves = this.moves();

        if ( m === "pass" ) {
            if (! allMoves.includes("pass") ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.invector.INVALID_PASS");
                return result;
            }
            result.valid = true;
            result.complete = 1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        } else { // if not a pass move, confirm the mentioned cells are all valid
            try {
                for (const cell of moves) {
                    this.graph.algebraic2coords(cell);
                }
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
                return result;
            }
            // ok, the move is not a pass, but check if a pass move is mandatory
            if ( allMoves.length === 1 && allMoves.includes("pass") ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.invector.ONLY_PASS");
                return result;
            }
        }

        if (moves.length === 1) {
            if (!this.board.has(m) || this.board.get(m) !== this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.invector.INVALID_SELECTION");
                return result;
            }
            if (! this.hasPrefix(allMoves, m) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.narrows.CANNOT_MOVE");
                return result
            }
            result.valid = true;
            result.complete = -1; // player still needs to decide to place or remove this stone
            result.canrender = true;
            result.message = i18next.t("apgames:validation.invector.INSTRUCTIONS");
            return result;
        }

        if (! allMoves.includes(m) ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.invector.INVALID_MOVE");
            return result
        }

        result.valid = true;
        result.complete = 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private findPoints(cell: string): string[] {
        return this.moves().filter(mv => mv.startsWith(cell))
                           .map(mv => mv.split('-')[1]);
    }

    public move(m: string, {partial = false, trusted = false} = {}): InvectorGame {
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
            if ( (! partial) && (! this.moves().includes(m)) ) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];
        this.dots = [];
        if (m === "") { return this; }

        if (m !== "pass") {
            if (partial) {
                this.dots = this.findPoints(m).map(c => this.graph.algebraic2coords(c));
                return this;
            } else {
                this.dots = []; // otherwise delete the points and process the full move
            }

            const moves = m.split('-');
            this.board.delete(moves[0]);
            this.board.set(moves[1], this.currplayer);
            this.results.push({ type: "move", from: moves[0], to: moves[1]});

            if (partial) { return this; }
        }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): InvectorGame {
        const p1Pieces = [...this.board.entries()].filter(([,owner]) => owner === 1);
        const p2Pieces = [...this.board.entries()].filter(([,owner]) => owner === 2);

        if (p1Pieces.length === 0 || p2Pieces.length === 0) {
            this.gameover = true;
            this.winner = p1Pieces.length === 0 ? [2] : [1];
        }

        if ( this.gameover ) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }

        return this;
    }

    public state(): IInvectorState {
        return {
            game: InvectorGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: InvectorGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    public render(): APRenderRep {
        const g = this.graph;
        // Build piece string
        let pstr = "";
        for (const row of g.listCells(true) as string[][]) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell);
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
        const rep: APRenderRep =  {
            board: {
                style: "vertex",
                width: this.boardSize,
                height: this.boardSize-1
            },
            legend: {
                A: { name: "piece", colour: 1 },
                B: { name: "piece", colour: 2 },
            },
            pieces: pstr
        };

        rep.annotations = [];
        for (const move of this.results) {
            if (move.type === "place") {
                const [toX, toY] = g.algebraic2coords(move.where!);
                rep.annotations.push({type: "enter", targets: [{row: toY, col: toX}]});
            } else if (move.type === "move") {
                    const [fromX, fromY] = g.algebraic2coords(move.from);
                    const [toX, toY] = g.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
            }
        }

        // show the dots where the selected piece can move to
        if (this.dots.length > 0) {
            const points = [];
            for (const [x,y] of this.dots) {
                points.push({row: y, col: x});
            }
            rep.annotations.push({type: "dots",
                                  targets: points as [{row: number; col: number;}, ...{row: number; col: number;}[]]});
        }

        return rep;
    }

    public clone(): InvectorGame {
        return new InvectorGame(this.serialize());
    }
}
