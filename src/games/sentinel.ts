import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, MarkerGlyph } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, UserFacingError, Direction, allDirections } from "../common";
import i18next from "i18next";

export type playerid = 1|2;
export type cellcontents = [playerid, number];

const CENTER = 'e5';
const BOARD_SIZE = 9;

// RAYS contains, for each direction, the cells that radiate out of the center
const RAYS = [  // made this manually, since the initial board size (9x9) is fixed
  ['f5', 'g5', 'h5', 'i5'],  // East
  ['d5', 'c5', 'b5', 'a5'],  // West
  ['e6', 'e7', 'e8', 'e9'],  // North
  ['e4', 'e3', 'e2', 'e1'],  // South
  ['f6', 'g7', 'h8', 'i9'],  // Northeast
  ['d6', 'c7', 'b8', 'a9'],  // Northwest
  ['f4', 'g3', 'h2', 'i1'],  // Southeast
  ['d4', 'c3', 'b2', 'a1']   // Southwest
];

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, cellcontents>;
    lastmove?: string;
};

export interface ISentinelState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class SentinelGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Sentinel",
        uid: "sentinel",
        playercounts: [2],
        version: "20260328",
        dateAdded: "2026-04-22",
        description: "apgames:descriptions.sentinel",
        notes: "apgames:notes.sentinel",
        urls: [
            "https://boardgamegeek.com/thread/3651706/rules-of-sentinel",
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
        categories: ["goal>annihilate", "goal>vigil", "mechanic>capture",  "mechanic>move", "mechanic>move>sow", "mechanic>stack", "board>shape>rect", "board>connect>rect", "components>simple>2c"],
        flags: []
    };

    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, BOARD_SIZE);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, BOARD_SIZE);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, cellcontents>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private _points: [number, number][] = []; // if there are points here, the renderer will show them

    constructor(state?: ISentinelState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            const board = new Map<string, cellcontents>([  // initial setup
                ["c1", [1,1]], ["d1", [1,1]], ["e1", [1,1]], ["f1", [1,1]], ["g1", [1,1]],
                ["c9", [2,1]], ["d9", [2,1]], ["e9", [2,1]], ["f9", [2,1]], ["g9", [2,1]],
            ]);
            if ( (variants !== undefined) && (variants.length > 0) ) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: SentinelGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ISentinelState;
            }
            if (state.game !== SentinelGame.gameinfo.uid) {
                throw new Error(`The Sentinel engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): SentinelGame {
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

    // check is a stack can be sowed, in the sense that it cannot create new
    // intermediate stacks that are not sow-able (stacks must be sowed inside the board)
    private isSowable(cell: string, player: playerid): boolean {
        const infoPiece = this.board.get(cell);
        if ( infoPiece === undefined ) { return true; } // an empty cell is always ok

        const [playerPiece, heightPiece] = infoPiece;
        if (player !== playerPiece) { return true; } // a capture is always ok

        const grid = new RectGrid(BOARD_SIZE, BOARD_SIZE);

        // there is a friendly stone/stack at cell:
        //  we need to check if there is at least one possible direction to sow
        //  the resulting stack (that does not pass thru the center)
        const [x, y] = SentinelGame.algebraic2coords(cell);
        for (const dir of allDirections) {
            // get all cells in that direction until the end of the board
            const ray = grid.ray(x, y, dir).map(n => SentinelGame.coords2algebraic(...n));
            if (!ray.includes(CENTER) && ray.length > heightPiece+1) { // +1 is the future piece being sowed here
                return true;
            }
        }
        return false;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) { player = this.currplayer; }

        const moves: string[] = [];

        const grid = new RectGrid(BOARD_SIZE, BOARD_SIZE);
        const pieces = [...this.board.entries()].filter(e => e[1][0] === player)
                                                .map(e => [e[0], e[1][1]] as [string,number]);
        let forwardDirs: Direction[];

        for (const [cell, height] of pieces) {
            const [x, y] = SentinelGame.algebraic2coords(cell);
            if (height === 1) {  // it is a single stone
                forwardDirs = player === 1 ? ["NW", "N", "NE"] : ["SW", "S", "SE"];
                for (const dir of forwardDirs) {
                    // get all cells in that direction until the end of the board
                    const ray = grid.ray(x, y, dir).map(n => SentinelGame.coords2algebraic(...n));
                    if (ray.length === 0) { // the stone is at the edge and can move out of the board
                        moves.push(`${cell}-off`);
                    } else { // there is, at least, an adjacent square in this direction
                        if (ray[0] === CENTER) {              // cannot move into the center
                            continue;
                        }
                        if (! this.isSowable(ray[0], player) ) {   // cannot make an unsowable stack
                            continue;
                        }
                        const adj = this.board.get(ray[0]);   // get piece (if any) at adjacent cell
                        if (adj === undefined) {              // if it is an empty cell,
                            moves.push(`${cell}-${ray[0]}`);  //   stone can move there
                        } else if (adj[0] === player &&       // if there is a friendly stone or stack,
                                   this.stack.length !== 3) { //    and we are *not* at turn 3
                            moves.push(`${cell}-${ray[0]}`);  //   the stone can move on top of it
                        } else if (adj[0] !== player) {       // if there is an enemy,
                            moves.push(`${cell}-${ray[0]}`);  //   the stone can move and capture it
                        }
                    }
                }
            } else {  // it is a stack
                for (const dir of allDirections) {
                    const ray = grid.ray(x, y, dir).map(n => SentinelGame.coords2algebraic(...n));
                    // cannot sow over the center, and the entire stack must be sown inside the board
                    if ( ray.length <= height || ray.slice(0, height+1).includes(CENTER) ) {
                        continue;
                    }
                    // check if any intermediate stack remains sow-able (sowing a stack includes a new stone)
                    const sowableCells: string[] = ray.slice(0, height+1);
                    if ( sowableCells.every(c => this.isSowable(c, player)) ) {
                        moves.push(`${cell}-${ray[height]}`);
                    }
                }
            }
        }

        moves.sort((a, b) => a.localeCompare(b));
        return moves;
    }

    private atEdge(move: string, player: playerid): boolean {
        const [x, y] = SentinelGame.algebraic2coords(move);

        if ( player === 1 && (x === 0 || x === BOARD_SIZE-1 || y === 0) ) {
            return true;
        }
        if ( player === 2 && (x === 0 || x === BOARD_SIZE-1 || y === BOARD_SIZE-1) ) {
            return true;
        }
        return false;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = SentinelGame.coords2algebraic(col, row);
            let newmove = "";

            if ( move === "" ) {
                newmove = cell;  // starting fresh
            } else if (! move.includes('-') ) {
                if ( move === cell ) { // if first cell is reclicked, clear everything
                    newmove = "";
                } else if ( this.atEdge(move, this.currplayer) && cell === CENTER ) {
                    newmove = `${move}-off`;
                } else {
                    newmove = `${move}-${cell}`;
                }
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
            result.canrender = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.sentinel.INITIAL_INSTRUCTIONS");
            return result;
        }

        if (! m.includes("-") ) { // partial move
            if (!this.board.has(m) || this.board.get(m)![0] !== this.currplayer) {
                result.valid = false;  // can only move friendly pieces
                result.message = i18next.t("apgames:validation.sentinel.MOVE_INSTRUCTIONS");
                return result;
            }
            result.valid = true; // it is a friendly piece or stack (still need to move it)
            result.canrender = true;
            result.complete = -1;
            if (this.board.get(m)![1] === 1) { // pieces have size 1
                if ( this.atEdge(m, this.currplayer) ) {
                    result.message = i18next.t("apgames:validation.sentinel.EDGE_INSTRUCTIONS");
                } else {
                    result.message = i18next.t("apgames:validation.sentinel.PIECE_INSTRUCTIONS");
                }
            } else {
                result.message = i18next.t("apgames:validation.sentinel.STACK_INSTRUCTIONS");
            }
            return result;
        }

        const allMoves = this.moves();

        if (! allMoves.includes(m) ) {
            result.valid = false;
            const [start, end] = m.split(/[-]/);
            if ( this.path(start, end).includes(CENTER) ) {
                result.message = i18next.t("apgames:validation.sentinel.INVALID_CENTER");
            } else if (this.stack.length === 3 && this.board.has(m.slice(-2))) {
                result.message = i18next.t("apgames:validation.sentinel.NO_STACK_TURN_3");
            } else {
                result.message = i18next.t("apgames:validation._general.INVALID_MOVE", { move: m });
            }
            return result;
        }

        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    // return the list of cells between start and end (or [] if they are not colinear)
    private path(start: string, end: string): string[] {
        const grid = new RectGrid(BOARD_SIZE, BOARD_SIZE);
        const [x, y] = SentinelGame.algebraic2coords(start);
        const height = this.board.get(start)![1];
        let result: string[] = [];

        for (const dir of allDirections) {
            const ray = grid.ray(x, y, dir).map(n => SentinelGame.coords2algebraic(...n));
            if ( ray.includes(end) ) { // found direction
                if ( height === 1 ) {
                    result = [ray[0]];
                } else { // sowing a stack gains one extra piece
                    result = ray.slice(0, height+1);
                }
                break;
            }
        }
        return result;
    }

    // return the list of cells that a given piece at 'cell' can move to
    private findPoints(cell: string): string[] {
        return this.moves().map(move => move.split('-'))          // ["a1-b1"] --> ["a1", "b1"]
                           .filter(([from,]) => from === cell)  // keep moves starting at cell
                           .map(([, to]) => to)                  // extract destination
                           .map(c => c === "off" ? CENTER : c);   // off moves must point to board center
    }

    public move(m: string, {partial = false, trusted = false} = {}): SentinelGame {
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

        if ( partial && !m.includes("-") ) { // if partial, set the points to be shown
            this._points = this.findPoints(m).map(c => SentinelGame.algebraic2coords(c));
            return this;
        } else {
            this._points = []; // otherwise delete the points and process the full move
        }

        const [start, end] = m.split(/[-]/);

        if ( end !== 'off' ) {
            for (const cell of this.path(start, end)) {
                if (! this.board.has(cell) ) {
                    // empty cell, so add one friendly stone
                    this.board.set(cell, [this.currplayer, 1]);
                } else if (this.board.get(cell)![0] === this.currplayer) {
                    // already some friendly piece here, add an extra stone
                    const height = this.board.get(cell)![1];
                    this.board.set(cell, [this.currplayer, height+1]);
                } else {
                    // enemy piece, so capture it before adding a new friendly stone
                    this.board.delete(cell);
                    this.board.set(cell, [this.currplayer, 1]);
                }
                this.results.push({ type: "move", from: start, to: end, count: this.path(start, end).length});
            }
        }
        this.board.delete(start); // the original piece is always removed
        this.results.push({ type: "capture", where: start, count: 1 });

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

    // return the number of line-of-sight to the center wrt player's pieces (needed for EOG)
    private linesSeen(player : playerid): string[] {
        const whichCells = [];
        for (const ray of RAYS) {
            for (const cell of ray) {
                // if the first non-empty cell has a friendly stone, the player 'sees' the center
                if ( this.board.has(cell) ) {
                    if ( this.board.get(cell)![0] === player ) {
                        whichCells.push(cell);
                    }
                    break;
                }
            }
        }
        return whichCells;
    }

    protected checkEOG(): SentinelGame {
        const prevPlayer = this.currplayer % 2 + 1 as playerid;

        const p1Pieces = [...this.board.entries()].filter(e => e[1][0] === 1).map(e => e[0]);
        const p2Pieces = [...this.board.entries()].filter(e => e[1][0] === 2).map(e => e[0]);

        if ( this.linesSeen(prevPlayer).length === 0 || this.linesSeen(this.currplayer).length >= 5 ) {
            this.gameover = true;
            this.winner = [this.currplayer];
        }

        if (p1Pieces.length === 0) {
            this.gameover = true;
            this.winner = [2];
        }

        if (p2Pieces.length === 0) {
            this.gameover = true;
            this.winner = [1];
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): ISentinelState {
        return {
            game: SentinelGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: SentinelGame.gameinfo.version,
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
        for (let row = 0; row < BOARD_SIZE; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < BOARD_SIZE; col++) {
                const cell = SentinelGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    let str = "";
                    for (let i = 0; i < contents[1]; i++) {
                        if (contents[0] === 1) {
                            str += "A";
                        } else {
                            str += "B";
                        }
                    }
                    pieces.push(str);
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join(",");
        }

        const markers: Array<MarkerGlyph> = [
            { type: "glyph", glyph: "Center", points: [ {row: 4, col: 4} ] }
        ];

        // Build rep
        const rep: APRenderRep =  {
            renderer: "stacking-offset",
            board: {
                style: "squares-checkered",
                width: BOARD_SIZE,
                height: BOARD_SIZE,
                markers
            },
            legend: {
                A: {
                    name: "piece",
                    colour: 1
                },
                B: {
                    name: "piece",
                    colour: 2
                },
                Center: {
                    name: "piecepack-suit-suns", // cf. https://github.com/AbstractPlay/renderer
                    colour: 5,                   //     https://renderer.dev.abstractplay.com/
                    opacity: 0.85,
                    scale: 0.85
                }
            },
            pieces: pstr
        };

        rep.annotations = [];

        // show the lines of sight
        const [toX, toY] = SentinelGame.algebraic2coords(CENTER);
        const prevplayer = this.currplayer % 2 + 1 as playerid;
        for (const cell of this.linesSeen(this.currplayer)) {
            const [fromX, fromY] = SentinelGame.algebraic2coords(cell);
            rep.annotations.push({ type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}],
                           style: "dashed", opacity: 0.3, arrow: false, strokeWidth: 0.05,
                           colour: this.currplayer });
        }
        for (const cell of this.linesSeen(prevplayer)) {
            const [fromX, fromY] = SentinelGame.algebraic2coords(cell);
            rep.annotations.push({ type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}],
                           style: "dashed", opacity: 0.3, arrow: false, strokeWidth: 0.05,
                           colour: prevplayer });
        }

        // show the current move
        if ( this.results.length > 0 ) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = SentinelGame.algebraic2coords(move.where!);
                    rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                } else if (move.type === "move") {
                    const [fromX, fromY] = SentinelGame.algebraic2coords(move.from);
                    const [toX, toY] = SentinelGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "capture") {
                    for (const cell of move.where!.split(",")) {
                        const [x, y] = SentinelGame.algebraic2coords(cell);
                        rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                    }
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

    public clone(): SentinelGame {
        return new SentinelGame(this.serialize());
    }
}