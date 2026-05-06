import { GameBase, IAPGameState, IClickResult, ICustomButton, IIndividualState, IValidationResult, IScores } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, BoardBasic, MarkerDots, RowCol, Colourfuncs } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import { HexTriGraph } from "../common/graphs";
import { connectedComponents } from "graphology-components";
import i18next from "i18next";

export type playerid = 1 | 2 | 3 ;  // 3 are neutral stones, ie, walls
export type cellcontents = [playerid, number];

const BOARD_SIZE = 8;    // the game is played on a hexhex board of size 8
const RESERVE_SIZE = 16; // how many pieces each player has off-board

type Territory = {
    cells: string[];
    owner: playerid|undefined;
};

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, cellcontents>;
    lastmove?: string;
    scores: [number, number];
    prisoners: [number, number];
    reserve: [number, number];
    swapped: boolean;
};

export interface IXanaState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class XanaGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Xana",
        uid: "xana",
        playercounts: [2],
        version: "20260404",
        dateAdded: "2026-04-22",
        // i18next.t("apgames:descriptions.xana")
        description: "apgames:descriptions.xana",
        notes: "apgames:notes.xana",
        urls: [
            "https://boardgamegeek.com/thread/3482800",
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
        customizations: [
            {
                num: 1,
                default: 1,
                explanation: "Colour of player 1"
            },
            {
                num: 2,
                default: 2,
                explanation: "Colour of player 2"
            },
            {
                num: 3,
                default: "#999",
                explanation: "Colour of wall"
            },
        ],
        categories: ["goal>area", "mechanic>place", "mechanic>move", "mechanic>stack", "mechanic>enclose", "board>shape>hex", "board>connect>hex", "components>simple>3c"],
        flags: ["pie", "no-moves", "custom-buttons", "custom-colours", "scores"],
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, cellcontents>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public graph: HexTriGraph = new HexTriGraph(BOARD_SIZE, 2*BOARD_SIZE-1);
    public swapped = true;

    private scores: [number, number] = [0, 0];
    private prisoners: [number, number] = [0, 0]; // number of enemy pieces (not stacks) captured
    private reserve: [number, number] = [RESERVE_SIZE, RESERVE_SIZE]; // number of pieces initially off-board
    private _points: [number, number][] = []; // if there are points here, the renderer will show them

    constructor(state?: IXanaState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if ( (variants !== undefined) && (variants.length > 0) ) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: XanaGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                scores: [0, 0],
                prisoners: [0, 0],
                reserve: [RESERVE_SIZE, RESERVE_SIZE],
                swapped: true,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IXanaState;
            }
            if (state.game !== XanaGame.gameinfo.uid) {
                throw new Error(`The Xana engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): XanaGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.results = [...state._results];
        this.lastmove = state.lastmove;
        this.scores = [...state.scores];
        this.prisoners = [...state.prisoners];
        this.reserve = [...state.reserve];
        this.graph = new HexTriGraph(BOARD_SIZE, 2*BOARD_SIZE-1);
        this.swapped = false;
        // We have to check the first state because we store the updated version in later states
        if (state.swapped === undefined) {
            this.swapped = this.stack.length < 3 || this.stack[2].lastmove !== "swap";
        } else {
            this.swapped = state.swapped;
        }
        return this;
    }

    /////////////// helper functions ///////////////

    public isPieTurn(): boolean {
        return this.stack.length === 2;
    }

    // all the cells accessible to the pieces of a given player
    private accessibleCells(player: playerid): string[] {
        const pieces = [...this.board.entries()].filter(e => e[1][0] === player)
                                        .map(e => [e[0], e[1][1]] as [string,number]);

        // frontier will start with all adjacent empty cells around the given pieces
        const frontier = new Set<string>(); // a set removes duplicates
        for (const [cell,] of pieces) {
            for (const adj of this.graph.neighbours(cell)) {
                if ( !this.board.has(adj) ) { // an accessible empty cell
                    frontier.add(adj);
                }
            }
        }

        const frontier2 = [...frontier];
        const visited = new Set<string>();
        while (frontier2.length > 0) {
            const cell = frontier2.shift()!;  // dequeue the first cell
            visited.add(cell);
            for (const adj of this.graph.neighbours(cell)) {
                if (! this.board.has(adj) && ! visited.has(adj) ) {
                    frontier2.push(adj); // enqueue new empty non-visited neighbors
                }
            }
        }

        return [...visited];
    }

    // return all the player's pieces that are not adjacent to an empty cell
    private withoutLiberties(player: playerid): string[] {
        const result = [];
        const pieces = [...this.board.entries()].filter(e => e[1][0] === player)
                                        .map(e => [e[0], e[1][1]] as [string,number]);

        for(const [cell,] of pieces) {  // for each friendly stack...
            let found = false;
            for (const adj of this.graph.neighbours(cell)) {
                if (! this.board.has(adj) ) { found = true; break; }
            }
            if (! found ) { result.push(cell); } // if no liberties found, include it
        }
        return result;
    }

    // the empty cells reachable by the stack at 'cell'
    private circle(cell: string): string[] {
        if (! this.board.has(cell) ) { return []; }
        const size = Number(this.board.get(cell)![1]);

        const frontier:[number, string][] =
            (this.graph.neighbours(cell) as string[])
                .filter(c => !this.board.has(c))
                .map(c => [size-1, c]);

        const visited = new Set<string>();
        while (frontier.length > 0) {
            const [n, c] = frontier.shift()!;  // dequeue the first cell
            if ( !visited.has(c) ) {
                visited.add(c);
                for (const adj of this.graph.neighbours(c)) {
                    if ( !this.board.has(adj) && !visited.has(adj) && n > 0 ) {
                        frontier.push([n-1, adj]); // enqueue new empty non-visited neighbors
                    }
                }
            }
        }

        return [...visited];
    }

    // remove all captured pieces
    private makeCaptures(): string[] {
        const captures: string[] = [];

        let prevPlayer: playerid = 1;
        if (this.currplayer === 1) { prevPlayer = 2; }

        // first check if some enemy captures are possible
        const enemyPieces = this.withoutLiberties(prevPlayer);
        for (const capturedCell of enemyPieces) {
            // account prisoners
            this.prisoners[this.currplayer-1] += this.board.get(capturedCell)![1]; // sum the size of the stack
            this.board.delete(capturedCell);
            captures.push(capturedCell)
        }

        // then check if there are friendly captures
        const friendlyPieces = this.withoutLiberties(this.currplayer);
        for (const capturedCell of friendlyPieces) {
            // account prisoners
            this.prisoners[prevPlayer-1] += this.board.get(capturedCell)![1]; // sum the size of the stack
            this.board.delete(capturedCell);
            captures.push(capturedCell)
        }

        return captures;
    }

    /**
     *   A Xana move is composed of a (mandatory) stack interaction, and (optional) wall placement(s)
     *     1) Pieces can be (a) dropped on new empty cells (making a new stack)
     *                      (b) dropped on friendly stack (so increasing the stack)
     *                      (c) move a stack (or part of it) within its range
     *     2) Optionally place one or two walls on empty cells
     *
     *   Notation examples:
     *     b6<5          <- dropped five stones at b6, no walls placed
     *     e2<2,e1       <- dropped two stones at e2, one wall at e1
     *     h8<1,e1,e2    <- dropped a single stone at h8, two walls placed at e1 and e2
     *     e4>3-e5,e1,e2 <- moved three stones from e4 to e5, and then dropped walls at e1 and e2
     */

    public moves(): string[] {
        return []; // too many moves to list
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.graph.coords2algebraic(col, row);
            let newmove = "";

            if ( move === "" ) { // starting fresh
                if ( this.board.has(cell) ) {
                    newmove = `${cell}`;   // it can be a placement or movement, that will be decided in the next click
                } else {
                    newmove = `${cell}<1`; // if the cell is empty, we already know it is a placement
                }
            } else if (!move.includes('<') && !move.includes('>') ) { // player must decide to place or to move
                if (move === cell) {
                    newmove = `${move}<1`;         // placement
                } else {
                    newmove = `${move}>1-${cell}`; // movement
                }
            } else if (move.includes('<') && move.split(',').length === 1) { // it is a placement
                const [c, n] = move.split(/[<]/);
                if ( c === cell ) {              // first cell is reclicked, add one more piece top stack
                    newmove = `${c}<${Number(n)+1}`;
                } else {
                    newmove = `${move},${cell}`; // otherwise, the click was elsewhere, so now one wall is placed
                }
            } else if (move.includes('>') && move.split(',').length === 1) { // it is a movement
                const commands = move.split(/[>-]/);
                const n = Number(commands[1]);
                if ( commands[2] === cell ) {
                    newmove = `${commands[0]}>${n+1}-${commands[2]}`; // click the destiny again to increase #pieces transfer
                } else {
                    newmove = `${move},${cell}`; // otherwise, the click was elsewhere, so now one wall is placed
                }
            } else if (move.split(',').length === 2) {
                newmove = `${move},${cell}`; // and now there is a second wall
            } else {
                throw new Error();
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

    /**
     *  Move type     | Requirements
     *  --------------+-------------------------------------------------------------------------------------------------
     *  c1<n          | c1 empty or friendly, n <= reserve
     *  c1<n,w1       | c1 empty or friendly, n <= reserve, w1 empty and accessible
     *  c1<n,w1,w2    | c1 empty or friendly, n <= reserve, w1 and w2 empty and accessible, w1 != w2
     *                |
     *  c1>n-c2       | c1 friendly, n <= size(c1), c2 empty, c2 in circle(c1)
     *  c1>n-c2,w1    | c1 friendly, n <= size(c1), c2 empty, c2 in circle(c1), w1 empty and accessible
     *  c1>n-c2,w1,w2 | c1 friendly, n <= size(c1), c2 empty, c2 in circle(c1), w1 and w2 empty and accessible, w1 != w2
     */
    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            if ( this.isPieTurn() ) {
                result.message = i18next.t("apgames:validation.xana.PIE_CHOICE");
            } else {
                result.message = i18next.t("apgames:validation.xana.INITIAL_INSTRUCTIONS");
            }
            return result;
        }

        if (m === "swap") {
            if ( this.isPieTurn() ) {
                result.valid = true;
                result.complete = 1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.xana.INVALID_PLAYSECOND");
            }
            return result;
        }

        if (m === "pass") {
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        const initialCell = m.split(/[<>]/)[0];
        const hasEnemy  = this.board.has(initialCell) && this.board.get(initialCell)![0] !== this.currplayer;
        const hasFriend = this.board.has(initialCell) && this.board.get(initialCell)![0] === this.currplayer;

        if ( hasEnemy ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.xana.ENEMY_PIECE");
            return result;
        }

        if ( m.includes('<') && this.reserve[this.currplayer - 1] === 0 ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.xana.RESERVE_EMPTY");
            return result;
        }

        if ( !m.includes('<') && !m.includes('>') ) {
            result.valid = true;
            result.complete = -1; // player still needs to decide to place or move
            result.canrender = true;
            result.message = i18next.t("apgames:validation.xana.DROP_MOVE_INSTRUCTIONS");
            return result;
        }

        const commands: string[] = m.split(',');
        if ( commands.length > 3 ) { // something strange happened
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {m});
            return result;
        }

        if ( m.includes('<') ) {
            const isAccessible = this.reserve[this.currplayer-1] === RESERVE_SIZE || // no piece played yet
                                 this.accessibleCells(this.currplayer).includes(initialCell);
            const reserve = this.reserve[this.currplayer - 1]; // how many pieces are still off-board
            const n = Number(commands[0].split(/[<]/)[1]);     // get the amount of pieces to place

            if ( (!isAccessible && !hasFriend) || n > reserve ) {
                result.valid = false;
                if ( !isAccessible && !hasFriend ) {
                    result.message = i18next.t("apgames:validation.xana.UNACCESSIBLE_PIECE");
                } else {
                    result.message = i18next.t("apgames:validation.xana.RESERVE_EMPTY");
                }
                return result;
            }
        }

        if ( m.includes('>') ) {
            const n = Number(commands[0].split(/[>-]/)[1]); // get the amount of pieces to move

            if ( !hasFriend || n > this.board.get(initialCell)![1] ) {
                result.valid = false;
                if (! hasFriend ) {
                    result.message = i18next.t("apgames:validation.xana.NOT_PLACED_ON_FRIEND");
                } else {
                    result.message = i18next.t("apgames:validation.xana.NOT_ENOUGH_PIECES_TO_MOVE");
                }
                return result;
            }

            const finalCell = commands[0].split(/[>-]/)[2]; // get the cell where the n pieces will move to
            if ( this.board.has(finalCell) ) { // pieces cannot move to an occupied cell
                result.valid = false;
                result.message = i18next.t("apgames:validation.xana.MOVE_TO_OCCUPIED_CELL");
                return result;
            }

            if (! this.circle(initialCell).includes(finalCell) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.xana.MOVE_NOT_INSIDE_CIRCLE");
                return result;
            }
        }

        if (commands.length > 1) {
            // check walls: both cells must be empty and accessible to the current player
            const walls = commands.length === 3 ? [commands[1], commands[2]] : [commands[1]];
            // check if the stack moved entirely out of its original cell (if so, a wall can be placed there)
            let cellLeft = "";
            if ( m.includes('>') ) {
                const n = Number(commands[0].split(/[>-]/)[1]); // get the amount of pieces that moved
                if ( this.board.get(initialCell)![1] === n ) {  // if stack 100% moved
                    cellLeft = initialCell;
                }
            }

            for (const wall of walls) {
                const isAccessible = this.reserve[this.currplayer-1] === RESERVE_SIZE || // no piece played yet
                                     this.accessibleCells(this.currplayer).includes(wall) ||
                                     wall === cellLeft;
                if ( (this.board.has(wall) && cellLeft === "") || !isAccessible ) {
                    result.valid = false;
                    if ( this.board.has(wall) ) {
                        result.message = i18next.t("apgames:validation.xana.OCCUPIED_WALL");
                    } else {
                        result.message = i18next.t("apgames:validation.xana.UNACCESSIBLE_WALL");
                    }
                    return result;
                }
            }
            if ( commands.length === 3 && commands[1] === commands[2]) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.xana.SAME_WALL");
                return result;
            }
        }

        result.valid = true;
        result.complete = commands.length === 3 ? 1 : 0; // complete only when both walls were placed
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {partial = false, trusted = false} = {}): XanaGame {
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
        }

        this.results = [];
        const captures = []; // all the captures made in the turn

        if ( partial && !m.includes('<') && !m.includes('>') ) {
            this._points = this.circle(m).map(c => this.graph.algebraic2coords(c));
            return this;
        } else {
            this._points = [];
        }

        if (m === "pass") {
            this.results.push({type: "pass"});
        } else if (m === "swap") { // pie was accepted
            this.swapped = true;
            this.board.forEach((v, k) => {
                if (v[0] !== 3) { // if it's not a wall, swap colors
                    this.board.set(k, [v[0] === 1 ? 2 : 1, v[1]]);
                }
            })
            this.reserve = [this.reserve[1], this.reserve[0]];
            this.results.push({ type: "pie" });
        } else {
            const commands: string[] = m.split(',');
            const initialCell: string = m.split(/[<>]/)[0];
            const initialN = this.board.has(initialCell) ? this.board.get(initialCell)![1] : 0; // current #pieces
            const n = Number(commands[0].split(/[<>-]/)[1]);

            if ( m.includes('<') ) {
                this.board.set(initialCell, [this.currplayer, initialN + n]);
                this.reserve[this.currplayer - 1] -= n;
                this.results.push({ type: "place", where: initialCell });
            } else { // m.includes('>')
                const finalCell = commands[0].split(/[>-]/)[2];  // get the cell where the n pieces will move to
                if ( initialN === n ) {
                    this.board.delete(initialCell); // the entire stack has moved
                } else {
                    this.board.set(initialCell, [this.currplayer, initialN - n]); // the stack split
                }
                this.board.set(finalCell, [this.currplayer, n]);
                this.results.push({ type: "move", from: initialCell, to: finalCell, count: n});
            }

            // before walls: check pieces without liberty and capture them
            captures.push(...this.makeCaptures());
            if (captures.length > 0) {
                this.results.push({ type: "capture", where: [...captures].join(), count: captures.length });
            }

            /////// place walls
            if ( commands.length === 2 ) { // one wall
                this.board.set(commands[1], [3 as playerid, 1]);
                this.results.push({ type: "place", where: commands[1] });
                captures.push(...this.makeCaptures());
                if (captures.length > 0) {
                    this.results.push({ type: "capture", where: [...captures].join(), count: captures.length });
                }
            }

            if ( commands.length === 3 ) { // two walls
                this.board.set(commands[1], [3 as playerid, 1]);
                this.results.push({ type: "place", where: commands[1] });
                captures.push(...this.makeCaptures());
                if (captures.length > 0) {
                    this.results.push({ type: "capture", where: [...captures].join(), count: captures.length });
                }

                this.board.set(commands[2], [3 as playerid, 1]);
                this.results.push({ type: "place", where: commands[2] });
                captures.push(...this.makeCaptures());
                if (captures.length > 0) {
                    this.results.push({ type: "capture", where: [...captures].join(), count: captures.length });
                }
            }
        }

        if ( partial ) { return this; }

        // update currplayer
        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.scores = [this.getPlayerScore(1), this.getPlayerScore(2)];
        this.checkEOG();
        this.saveState();
        return this;
    }

    //////////// Scoring and End-of-Game ////////////

    protected checkEOG(): XanaGame {
        // game ends if two consecutive passes occurred
        this.gameover = this.lastmove === "pass" &&
                        this.stack[this.stack.length - 1].lastmove === "pass";

        // if no shared accessible cells, the game is over, since all areas ownership are decided
        if (this.stack.length > 4 && !this.gameover) {
            const p1cells: string[]    = this.accessibleCells(1);
            const p2cells: Set<string> = new Set(this.accessibleCells(2));
            const shareCells: string[] = p1cells.filter(c => p2cells.has(c));
            if ( shareCells.length == 0 ) {
                this.gameover = true;
            }
        }

        if ( this.gameover ) {
            this.scores = [this.getPlayerScore(1), this.getPlayerScore(2)];
            this.winner = this.scores[0] > this.scores[1] ? [1] : [2];
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public getPlayerScore(player: playerid): number {
        const nPrisoners = this.prisoners[player - 1];
        const komi = player === 1 ? 0.5 : 0.0;

        return this.getTerritories()
                   .filter(t => t.owner === player)
                   .reduce((prev, curr) => prev + curr.cells.length, nPrisoners+komi);
    }

    // What pieces are adjacent to a given area?
    public getAdjacentPieces(area: string[], pieces: string[]): string[] {
        const result: string[] = [];

        for (const cell of pieces) {
            for (const adj of this.graph.neighbours(cell)) {
                if ( area.includes(adj) ) { // current piece is adjacent to area
                    result.push(cell);
                    break;
                }
            }
        }
        return result;
    }

    /**
     * Get all available territories (based in Asli/Plurality code)
     * This is used in (1) computing scores, and (2) in the render process
     */
    public getTerritories(): Territory[] {
        const p1Pieces = [...this.board.entries()].filter(e => e[1][0] === 1).map(e => e[0]);
        const p2Pieces = [...this.board.entries()].filter(e => e[1][0] === 2).map(e => e[0]);
        const walls    = [...this.board.entries()].filter(e => e[1][0] === 3).map(e => e[0]);
        const allPieces = [...p1Pieces, ...p2Pieces, ...walls];

        // compute empty areas
        const gEmpties = new HexTriGraph(BOARD_SIZE, 2*BOARD_SIZE-1);
        for (const node of gEmpties.graph.nodes()) {
            if (allPieces.includes(node)) {  // remove intersections/nodes with pieces
                gEmpties.graph.dropNode(node);
            }
        }
        const emptyAreas : Array<Array<string>> = connectedComponents(gEmpties.graph);

        const territories: Territory[] = [];
        for(const area of emptyAreas) {
            let owner : playerid = 3; // default value: neutral area
            // find who owns it
            const p1AdjacentCells = this.getAdjacentPieces(area, p1Pieces);
            const p2AdjacentCells = this.getAdjacentPieces(area, p2Pieces);
            if (p1AdjacentCells.length > 0 && p2AdjacentCells.length == 0) {
                owner = 1;
            }
            if (p1AdjacentCells.length == 0 && p2AdjacentCells.length > 0) {
                owner = 2;
            }
            territories.push({cells: area, owner});
        }
        return territories;
    }

    /////////////////////////////////////////////////

    public state(): IXanaState {
        return {
            game: XanaGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: XanaGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            scores: [...this.scores],
            prisoners: [...this.prisoners],
            reserve: [...this.reserve],
            swapped: this.swapped
        };
    }

    public render(): APRenderRep {
        const pieces: string[][] = [];
        for (const row of this.graph.listCells(true)) {
            const nodes: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const [player, size] = this.board.get(cell)!;
                    if (player === 3) {
                        nodes.push("C");
                    } else {
                        nodes.push(player===1 ? "A".repeat(size) : "B".repeat(size));
                    }
                } else {
                    nodes.push("-");
                }
            }
            pieces.push(nodes);
        }

        const wallColour: Colourfuncs = {
            func: "custom",
            default: "#999",
            palette: 3
        };

        // Build rep
        const rep: APRenderRep =  {
            renderer: "stacking-offset",
            board: {
                style: "hex-of-hex",
                minWidth: BOARD_SIZE,
                maxWidth: 2*BOARD_SIZE - 1,
            },
            legend: {
                A: { name: "piece", colour: this.getPlayerColour(1) },
                B: { name: "piece", colour: this.getPlayerColour(2) },
                C: { name: "piece", colour: wallColour },
            },
            pieces: pieces.map(r => r.join(",")).join("\n"),
        };

        rep.annotations = [];

        if ( this.results.length > 0 ) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.graph.algebraic2coords(move.where!);
                    rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                } else if (move.type === "move") {
                    const [fromX, fromY] = this.graph.algebraic2coords(move.from);
                    const [toX, toY] = this.graph.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "capture") {
                    for (const cell of move.where!.split(",")) {
                        const [x, y] = this.graph.algebraic2coords(cell);
                        rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                    }
                }
            }
        }

        // add dots to define moving-range of current stack
        if (this._points.length > 0) {
            const points = [];
            for (const [x,y] of this._points) {
                points.push({row: y, col: x});
            }
            rep.annotations.push({type: "dots",
                                  targets: points as [{row: number; col: number;}, ...{row: number; col: number;}[]]});
        }

        // add territorial dots for area controlled by players
        if (this.stack.length > 3) {
            const territories = this.getTerritories();
            const markers: Array<MarkerDots> = []
            for (const t of territories) {
                if (t.owner !== undefined && t.owner !== 3) {
                    const points = t.cells.map(c => this.graph.algebraic2coords(c));
                    markers.push({type: "dots",
                                  colour: this.getPlayerColour(t.owner),
                                  points: points.map(p => { return {col: p[0], row: p[1]}; }) as [RowCol, ...RowCol[]]});
                }
            }
            if (markers.length > 0) {
                (rep.board as BoardBasic).markers = markers;
            }
        }

        return rep;
    }

    public getButtons(): ICustomButton[] {
        if ( this.isPieTurn() ) {
            return [{ label: "acceptpie", move: "swap" }];
        }
        return [{ label: "pass", move: "pass" }];
    }

    public getPlayerColour(p: playerid): Colourfuncs {
        p = (p == 1 && !this.swapped) || (p == 2 && this.swapped) ? 1 : 2;

        if (p === 1) {
            return {
                func: "custom",
                default: 1,
                palette: 1
            };
        } else {
            return {
                func: "custom",
                default: 2,
                palette: 2
            };
        }
    }

    public sidebarScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.xana.RESERVE"),
                  scores: [...this.reserve] },
            { name: i18next.t("apgames:status.SCORES"),
                  scores: [this.getPlayerScore(1), this.getPlayerScore(2)] },
        ];
    }

    public clone(): XanaGame {
        return new XanaGame(this.serialize());
    }
}
