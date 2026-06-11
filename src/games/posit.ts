import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, Colourfuncs } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { SquareGraph } from "../common/graphs";

export type playerid = 1 | 2 | 3; // 3 is for stacks with only neutral stacks
export type cellcontents = [playerid, number]; // number is the amount of neutral pieces

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, cellcontents>;
    lastmove?: string;
};

export interface IPositState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class PositGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Posit",
        uid: "posit",
        playercounts: [2],
        version: "20260607",
        dateAdded: "2026-06-07",
        // i18next.t("apgames:descriptions.posit")
        description: "apgames:descriptions.posit",
        notes: "apgames:notes.posit",
        urls: [
            "https://boardgamegeek.com/boardgame/186367/posit-3-d-board-game"
        ],
        people: [
            {
                type: "designer",
                name: "Shinichi Tobita",
                urls: ["https://boardgamegeek.com/boardgamedesigner/86267/shinichi-tobita"],
            },
            {
                type: "coder",
                name: "João Pedro Neto",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3829/joao-pedro-neto"],
                apid: "9228bccd-a1bd-452b-b94f-d05380e6638f",
            },
        ],
        categories: ["goal>immobilize", "mechanic>move", "mechanic>place", "mechanic>stack", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["no-moves", "experimental"],
        variants: []
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, cellcontents>;
    public graph?: SquareGraph;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private boardSize = 0;
    private _points: [number, number][] = [];

    constructor(state?: IPositState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            this.boardSize = this.getBoardSize();
            const board: Map<string, cellcontents> = new Map();
            board.set('d1', [1, 0]); // initial position of the two pieces
            board.set('c6', [2, 0]);

            const fresh: IMoveState = {
                _version: PositGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IPositState;
            }
            if (state.game !== PositGame.gameinfo.uid) {
                throw new Error(`The Posit engine cannot process a game of '${state.game}'.`);
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

    public load(idx = -1): PositGame {
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
        this.results = [...state._results];
        return this;
    }

    private buildGraph(): SquareGraph {
        this.graph = new SquareGraph(this.boardSize, this.boardSize);
        return this.graph;
    }

    private getGraph(boardSize?: number): SquareGraph {
        if (boardSize === undefined) {
            return (this.graph === undefined) ? this.buildGraph() : this.graph;
        } else {
            return new SquareGraph(boardSize, boardSize);
        }
    }

    private getBoardSize(): number {
        return 6;
    }

    // return the cell where the player's (single) piece is
    private findPiece(player?: playerid): string {
        player ??= this.currplayer;
        return [...this.board.entries()].filter(e => e[1][0] === player)[0][0];
    }

    // returns the number of neutral pieces are at `cell`
    private nNeutrals(cell: string): number {
        return this.board.has(cell) ? this.board.get(cell)![1] : 0;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.getGraph().coords2algebraic(col, row);
            let newmove = "";

            if (move === "") {
                newmove = cell;
            } else if (move === cell) {
                newmove = ""; // reset click
            } else if (! move.includes(',') ) {
                newmove = move.includes('-') ? `${move},${cell}` : `${move}-${cell}`;
            } else {
                newmove = "";
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

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, complete: -1,
                                           message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.posit.INSTRUCTIONS");
            return result;
        }

        const g = this.getGraph();
        const moves = m.split(/[,-]/);
        const piece = this.findPiece(); // get where the single piece is

        try { // check if all cells' selection are valid cells
            for (const cell of moves) { g.algebraic2coords(cell); }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
            return result;
        }

        if ( moves[0] !== piece ) { // the player needs first to select his piece
            result.valid = false;
            result.message = i18next.t("apgames:validation.posit.SELECT_ERROR");
            return result;
        }

        if ( moves.length === 1) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.posit.SELECT_MOVE");
            return result;
        }

        const oppPiece = this.findPiece(this.currplayer % 2 + 1 as playerid); // get where the opponent's piece is

        if (! g.neighbours(moves[0]).includes(moves[1]) ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.posit.NOT_ADJACENT");
            return result;
        }

        if ( moves[1] === oppPiece ) { // cannot move to the opponent's player square
            result.valid = false;
            result.message = i18next.t("apgames:validation.posit.OPPONENT_MOVE");
            return result;
        }

        const sizeFrom = this.nNeutrals(moves[0]);
        const sizeTo   = this.nNeutrals(moves[1]);

        if ( sizeFrom > sizeTo ) { // the piece cannot move to a smaller stack
            result.valid = false;
            result.message = i18next.t("apgames:validation.posit.CANNOT_GO_DOWN");
            return result;
        }

        if ( sizeFrom < sizeTo - 1 ) { // the piece cannot move up two or more levels at once
            result.valid = false;
            result.message = i18next.t("apgames:validation.posit.CANNOT_GO_UPUP");
            return result;
        }

        if ( sizeTo === 3 ) { // the piece cannot climb on top of a 3-stack
            result.valid = false;
            result.message = i18next.t("apgames:validation.posit.CANNOT_CLIMB");
            return result;
        }

        if ( moves.length === 2) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.posit.SELECT_PLACEMENT");
            return result;
        }

        if ( moves[2] === oppPiece || moves[2] === moves[1]) { // neutral pieces cannot be placed on player's pieces
            result.valid = false;
            result.message = i18next.t("apgames:validation.posit.PLACE_ON_PIECE");
            return result;
        }

        const sizePlacement = this.nNeutrals(moves[2]);

        if ( sizePlacement === 3 ) { // stacks cannot have more than three neutral pieces
            result.valid = false;
            result.message = i18next.t("apgames:validation.posit.STACK_TOO_BIG");
            return result;
        }

        result.valid = true;
        result.complete = 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    // return the list of cells that a given piece at `cell` can move to
    private findPoints(cell: string): string[] {
        const g = this.getGraph();
        const moves = [];

        const sizeFrom = this.nNeutrals(cell);
        for (const neigh of g.neighbours(cell)) {
            const [p, sizeTo] = this.board.has(neigh) ? this.board.get(neigh)! : [3, 0];

            if ( p === 3 && sizeTo >= sizeFrom && sizeTo <= sizeFrom+1 && sizeTo < 3 ) {
                moves.push(neigh);
            }
        }

        return moves;
    }

    public move(m: string, { partial = false, trusted = false } = {}): PositGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) { throw new UserFacingError("VALIDATION_GENERAL", result.message); }
        }

        if (m.length === 0) { return this; }

        this.results = [];

        if ( partial && !m.includes("-") ) { // if partial, set the points to be shown
            const g = this.getGraph();
            this._points = this.findPoints(m).map(c => g.algebraic2coords(c));
            return this;
        } else {
            this._points = []; // otherwise delete the points and process the full move
        }

        const moves = m.split(/[,-]/);
        const sizeFrom = this.nNeutrals(moves[0]); // get #neutral pieces for each square of `m`
        const sizeTo   = this.nNeutrals(moves[1]);

        this.board.set(moves[0], [3, sizeFrom]);
        this.board.set(moves[1], [this.currplayer, sizeTo]);
        this.results.push({ type: "move", from: moves[0], to: moves[1], count: 1 });

        if ( partial ) { return this; }

        const sizePlacement = this.nNeutrals(moves[2]);
        this.board.set(moves[2], [3, sizePlacement + 1]);
        this.results.push({ type: "place", where: moves[2] });

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): PositGame {
        const availableMoves = this.findPoints(this.findPiece(this.currplayer));

        if ( availableMoves.length === 0 ) {
            const prevplayer = this.currplayer % 2 + 1 as playerid;
            this.gameover = true;
            this.winner = [prevplayer];
        }

        if (this.gameover) {
            this.results.push( { type: "eog" },
                               { type: "winners", players: [...this.winner] } );
        }
        return this;
    }

    public state(): IPositState {
        return {
            game: PositGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: PositGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    public render(): APRenderRep {
        const g = this.getGraph();
        let pstr = "";
        for (let row = 0; row < this.boardSize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < this.boardSize; col++) {
                const cell = g.coords2algebraic(col, row);
                if ( this.board.has(cell) ) {
                    const [player, size] = this.board.get(cell)!;
                    let str = "";
                    for (let i = 0; i < size; i++) {
                        str += "C"
                    }
                    str += player === 1 ? "A" : (player === 2 ? "B" : "");
                    pieces.push(str);
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join(",");
        }

        const neutralColour: Colourfuncs = {
            func: "custom",
            // default: "#778899", // slate gray
            // default: "#44d7a8", // eucalyptus
            default: "#ba55d3", // medium orchid
            palette: 3
        };

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
                C: { name: "piece", colour: neutralColour },
            },
            pieces: pstr
        };

        rep.annotations = [];
        if ( this.results.length > 0 ) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = g.algebraic2coords(move.where!);
                    rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                } else if (move.type === "move") {
                    const [fromX, fromY] = g.algebraic2coords(move.from);
                    const [toX, toY] = g.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                }
            }
        }

        // show the dots where the selected piece can move to
        if (this._points.length > 0) {
            const points = [];
            for (const [x,y] of this._points) {
                points.push({row: y, col: x});
            }
            rep.annotations.push({type: "dots",
                                  targets: points as [{row: number; col: number;}, ...{row: number; col: number;}[]]});
        }

        return rep;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.complete", { player, where: r.where, what: "neutral piece" }));
                resolved = true;
                break;
            case "move":
                node.push(i18next.t("apresults:MOVE.posit", { player, from: r.from, to: r.to }));
                resolved = true;
                break;
            case "eog":
                node.push(i18next.t("apresults:EOG.default"));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): PositGame {
        return new PositGame(this.serialize());
    }
}
