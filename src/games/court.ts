import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult, IStashEntry } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError, SquareGraph, Direction } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const deepclone = require("rfdc/default");

export type playerid = 1 | 2; // regarding pieces: 1 is the ball, 2 are the walls
export type Piece = "P" | "R" | "N" | "B";
export type CellContents = [Piece, playerid];

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    lastmove?: string;
    hands: [Piece[], Piece[]];
};

export interface ICourtState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class CourtGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Court",
        uid: "court",
        playercounts: [2],
        version: "20260510",
        dateAdded: "2026-05-27",
        // i18next.t("apgames:descriptions.court")
        description: "apgames:descriptions.court",
        // i18next.t("apgames:notes.court")
        // notes: "apgames:notes.court",
        urls: [
            "https://boardgamegeek.com/boardgame/109681/court",
            "https://jpneto.github.io/world_abstract_games/court.htm",
        ],
        people: [
            {
                type: "designer",
                name: "João Pedro Neto",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3829/joao-pedro-neto"],
                apid: "9228bccd-a1bd-452b-b94f-d05380e6638f",
            },
            {
                type: "coder",
                name: "João Pedro Neto",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3829/joao-pedro-neto"],
                apid: "9228bccd-a1bd-452b-b94f-d05380e6638f",
            },
        ],
        categories: ["goal>annihilate", "mechanic>move", "mechanic>capture", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["player-stashes"]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, CellContents>;
    public gameover = false;
    public hands!: [Piece[], Piece[]];
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private _points: [number, number][] = []; // if there are points here, the renderer will show them

    constructor(state?: ICourtState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if ( (variants !== undefined) && (variants.length > 0) ) {
                this.variants = [...variants];
            }
            const board = new Map<string, CellContents>([ // initial setup
                    ["b2", ["P", 1]], ["c2", ["P", 1]], ["d2", ["P", 1]], ["e2", ["P", 1]], ["f2", ["P", 1]], ["g2", ["P", 1]],
                    ["b3", ["P", 1]], ["c3", ["P", 1]], ["d3", ["P", 1]], ["e3", ["P", 1]], ["f3", ["P", 1]], ["g3", ["P", 1]],
                    ["b6", ["P", 2]], ["c6", ["P", 2]], ["d6", ["P", 2]], ["e6", ["P", 2]], ["f6", ["P", 2]], ["g6", ["P", 2]],
                    ["b7", ["P", 2]], ["c7", ["P", 2]], ["d7", ["P", 2]], ["e7", ["P", 2]], ["f7", ["P", 2]], ["g7", ["P", 2]],
                ]);
            const hands: [Piece[], Piece[]] = [["N", "N", "B", "B", "R", "R"], ["N", "N", "B", "B", "R", "R"]];
            const fresh: IMoveState = {
                _version: CourtGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                hands,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ICourtState;
            }
            if (state.game !== CourtGame.gameinfo.uid) {
                throw new Error(`The Court engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): CourtGame {
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
        this.hands = deepclone(state.hands);
        this.results = [...state._results];
        return this;
    }

    public get boardsize(): number {
        return 8;
    }

    public get graph(): SquareGraph {
        return new SquareGraph(this.boardsize, this.boardsize);
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) { player = this.currplayer; }
        const g = this.graph;
        const moves = [];

        for (const cell of g.graph.nodes()) {
            if ( !this.board.has(cell) || this.board.get(cell)![1] !== player ) { continue; }
            const piece = this.board.get(cell)![0];
            const [x, y] = g.algebraic2coords(cell);

            if ( piece === "P" ) {
                if ( player === 1 && y > 0 ) { // pawns move forward by decreasing row index
                    const nCell = g.coords2algebraic(x, y-1);
                    if (! this.board.has(nCell) ) {
                        moves.push(`${cell}-${nCell}`);
                    }
                    if ( x > 0 ) {
                        const nwCell = g.coords2algebraic(x-1, y-1);
                        if ( this.board.has(nwCell) && this.board.get(nwCell)![1] !== player ) {
                            moves.push(`${cell}-${nwCell}`); // capture
                        }
                    }
                    if ( x < this.boardsize-1 ) {
                        const neCell = g.coords2algebraic(x+1, y-1);
                        if ( this.board.has(neCell) && this.board.get(neCell)![1] !== player ) {
                            moves.push(`${cell}-${neCell}`); // capture
                        }
                    }
                } else if ( player === 2 && y < this.boardsize-1 ) { // pawns move forward by increasing row index
                    const sCell = g.coords2algebraic(x, y+1);
                    if (! this.board.has(sCell) ) {
                        moves.push(`${cell}-${sCell}`);
                    }
                    if ( x > 0 ) {
                        const swCell = g.coords2algebraic(x-1, y+1);
                        if ( this.board.has(swCell) && this.board.get(swCell)![1] !== player ) {
                            moves.push(`${cell}-${swCell}`); // capture
                        }
                    }
                    if ( x < this.boardsize-1 ) {
                        const seCell = g.coords2algebraic(x+1, y+1);
                        if ( this.board.has(seCell) && this.board.get(seCell)![1] !== player ) {
                            moves.push(`${cell}-${seCell}`); // capture
                        }
                    }
                }
                // check promotions
                const available: Piece[] = [...new Set(this.hands[this.currplayer - 1])]; // remove duplicates
                for (const piece of available) {
                    moves.push(`${cell}+${piece}`); // promotion to piece
                }
            } // if ("P")

            if ( piece === "N" ) {
                const knightMoves = [[2, 1], [2,-1], [-2,1], [-2,-1],
                                     [1, 2], [-1,2], [1,-2], [-1,-2]];
                for (const [dx,dy] of knightMoves) {
                    if ( x+dx < 0 || x+dx >= this.boardsize ||
                         y+dy < 0 || y+dy >= this.boardsize ) { continue; }
                    const moveCell = g.coords2algebraic(x+dx, y+dy);
                    if ( !this.board.has(moveCell) || this.board.get(moveCell)![1] !== player ) {
                        moves.push(`${cell}-${moveCell}`);
                    }
                }
            }

            if ( piece === "B" || piece === 'R' ) {
                const dirs: Direction[] = piece === "B" ? ["NE", "NW", "SW", "SE"] : ["N", "S", "E", "W"];
                for (const dir of dirs) {
                    const ray = g.ray(x, y, dir);
                    for (let i=0; i<ray.length; i++) {
                        const moveCell = g.coords2algebraic(...ray[i]);
                        if ( this.board.has(moveCell) ) { // there's another piece here
                            if ( this.board.get(moveCell)![1] !== player ) { // check if it's an enemy
                                moves.push(`${cell}-${moveCell}`); // if so, capture
                            }
                            break; // bishops cannot jump, so no more moves in this direction
                        } else {
                            moves.push(`${cell}-${moveCell}`);
                        }
                    }
                }
            }
        }

        return moves.sort((a,b) => a.localeCompare(b));
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.graph.coords2algebraic(col, row);
            const moves: string[] = move.split(/[+-]/);
            let newmove = "";

            if ( move === "" ) {
                newmove = cell;
            } else if ( moves[0] === cell ) { // reclick cycles thru all possible promotions and then resets
                const available: Piece[] = [...new Set(this.hands[this.currplayer - 1])]; // remove duplicates
                if ( available.length === 0 ||
                     move.includes(available.at(-1)!) ||
                     this.board.get(cell)![0] !== "P" ) {  // non-pawns do not promote
                    newmove = "";
                } else if (! move.includes('+') ) {
                    newmove = `${moves[0]}+${available[0]}`;
                } else {
                    for (let i=0; i<available.length-1; i++) {
                        if ( move.includes(available[i]) ) {
                            newmove = `${moves[0]}+${available[i+1]}`;
                            break;
                        }
                    }
                }
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

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.court.INITIAL_INSTRUCTIONS");
            return result;
        }

        const moves: string[] = m.split(/[+-]/);

        if ( moves.length === 1 ) {
            if ( !this.board.has(moves[0]) || this.board.get(moves[0])![1] !== this.currplayer ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.court.NOT_FRIENDLY_PIECE");
                return result
            }
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.court.PIECE_INSTRUCTIONS");
            return result;
        }

        const allMoves = this.moves();
        if (! allMoves.includes(m) ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
            return result
        }

        result.valid = true;
        result.complete = m.includes('+') ? 0 : 1; // promotions cannot be final, the user might still choose another
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    // return the list of cells the current move can go to
    private findPoints(move: string): string[] {
        return this.moves().filter(m => !m.includes('+') && m.startsWith(move))
                           .map(m => m.split('-')[1]);
    }

    public move(m: string, {partial = false, trusted = false} = {}): CourtGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        //m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
        }

        this.results = [];
        const moves = m.split(/[+-]/);

        if (m === "") { return this; }

        if ( partial && m.length > 0 && !m.includes('+') ) { // if partial move, set the points to be shown
            const g = this.graph;
            this._points = this.findPoints(m).map(c => g.algebraic2coords(c));
            return this;
        } else {
            this._points = []; // otherwise delete the points and process the full move
        }

        if ( m.includes('+') ) { // a promotion (eg, "cell+piece")
            const idxPiece = this.hands[this.currplayer - 1].indexOf(moves[1] as Piece);
            this.hands[this.currplayer - 1].splice(idxPiece, 1); // remove piece from player's hand
            this.board.set(moves[0], [moves[1] as Piece, this.currplayer]); // add piece to board
            this.results.push({ type: "place", where: moves[0] });
        } else { // it is a move
            this.board.set(moves[1], this.board.get(moves[0])!);
            this.board.delete(moves[0]);
            this.results.push({ type: "move", from: moves[0], to: moves[1] });
        }

        if (partial) { return this; } // a promotion might still be partial

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    private getPawns(player: playerid): string[] {
        return [...this.board.entries()].filter(e => e[1][1] === player && e[1][0] === "P")
                                        .map(e => e[0]);
    }

    protected checkEOG(): CourtGame {
        const nPawns = this.getPawns(this.currplayer).length;

        if ( nPawns === 0 || this.moves().length === 0 ) {
            const prevPlayer: playerid = this.currplayer % 2 + 1 as playerid;
            this.gameover = true;
            this.winner = [prevPlayer];
        }

        if ( this.gameover ) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }

        return this;
    }

    public state(): ICourtState {
        return {
            game: CourtGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: CourtGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            hands: deepclone(this.hands),
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
                    const [piece, player] = this.board.get(cell)!;
                    if (player === 1) {
                        pieces.push(piece+'1');
                    } else {
                        pieces.push(piece+'2');
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join(",");
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-checkered",
                width: this.boardsize,
                height: this.boardsize
            },
            legend: {
                P1: { name: "piece", colour: 1 },
                P2: { name: "piece", colour: 2 },
                B1: [{ name: "piece", colour: 1 },
                     { name: "chess-bishop-outline-traditional", colour: "#ffffff", scale: 0.6, opacity: 0.6 }],
                B2: [{ name: "piece", colour: 2 },
                     { name: "chess-bishop-outline-traditional", colour: "#aaaaaa", scale: 0.6, opacity: 0.6 }],
                N1: [{ name: "piece", colour: 1 },
                     { name: "chess-knight-outline-traditional", colour: "#ffffff", scale: 0.6, opacity: 0.6 }],
                N2: [{ name: "piece", colour: 2 },
                     { name: "chess-knight-outline-traditional", colour: "#aaaaaa", scale: 0.6, opacity: 0.6 }],
                R1: [{ name: "piece", colour: 1 },
                     { name: "chess-rook-outline-traditional",   colour: "#ffffff", scale: 0.6, opacity: 0.6 }],
                R2: [{ name: "piece", colour: 2 },
                     { name: "chess-rook-outline-traditional",   colour: "#aaaaaa", scale: 0.6, opacity: 0.6 }],
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

    public getPlayerStash(player: number): IStashEntry[] | undefined {
        const col = player as playerid;
        return [
            { count: this.hands[player - 1].filter(x => x === 'N').length,
              glyph: { name: "chess-knight-outline-traditional", colour: col },
              movePart: "" },
            { count: this.hands[player - 1].filter(x => x === 'B').length,
              glyph: { name: "chess-bishop-outline-traditional", colour: col },
              movePart: "" },
            { count: this.hands[player - 1].filter(x => x === 'R').length,
              glyph: { name: "chess-rook-outline-traditional", colour: col },
              movePart: "" },
        ];
    }

    public clone(): CourtGame {
        return new CourtGame(this.serialize());
    }
}
