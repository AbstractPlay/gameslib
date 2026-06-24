import { GameBase, IAPGameState, IClickResult, ICustomButton, IIndividualState, IValidationResult, IScores } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, Colourfuncs } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import { HexTriGraph } from "../common/graphs";
import i18next from "i18next";

export type playerid = 1 | 2 | 3 ; // 3 are neutral stones, ie, walls
export type cellcontents = [playerid, number]; // number is the stack size of neutral stones

type directions = "NE"|"E"|"SE"|"SW"|"W"|"NW";

const BOARD_SIZE = 7;  // size of hexhex board
const NUM_MARBLES = 5; // number of marbles each player has
const NUM_NUTS = 70;   // number of nuts are in the playing field
const TOWERS_GOAL = 3; // number of occupied towers to win
const NUT_COLOR = "#ba55d3"; // medium orchid

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, cellcontents>;
    lastmove?: string;
    reserve: [number, number];
};

export interface IMutternlandState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class MutternlandGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Mutternland",
        uid: "mutternland",
        playercounts: [2],
        version: "20260618",
        dateAdded: "2026-06-18",
        // i18next.t("apgames:descriptions.mutternland")
        description: "apgames:descriptions.mutternland",
        notes: "apgames:notes.mutternland",
        urls: [
            "https://boardgamegeek.com/boardgame/1051/mutternland",
            "https://jpneto.github.io/world_abstract_games/modern_rules/1997_Mutternland.pdf"
        ],
        people: [
            {
                type: "designer",
                name: "Hartmut Witt",
                urls: ["https://boardgamegeek.com/boardgamedesigner/275/hartmut-witt"],
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
                default: NUT_COLOR,
                explanation: "Colour of nuts"
            },
        ],
        categories: ["goal>score>eog", "mechanic>place", "mechanic>move", "mechanic>stack", "board>shape>hex", "board>connect>hex", "components>simple>1c"],
        flags: ["no-moves", "custom-buttons", "scores", "experimental"],
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

    private reserve: [number, number] = [0, 0]; // number of pieces initially off-board
    private _points: [number, number][] = []; // if there are points here, the renderer will show them

    constructor(state?: IMutternlandState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if ( (variants !== undefined) && (variants.length > 0) ) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: MutternlandGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: this.getRandomPlacement(), // build random setup,
                reserve: [NUM_MARBLES, NUM_MARBLES],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IMutternlandState;
            }
            if (state.game !== MutternlandGame.gameinfo.uid) {
                throw new Error(`The Mutternland engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): MutternlandGame {
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
        this.reserve = [...state.reserve];
        this.graph = new HexTriGraph(BOARD_SIZE, 2*BOARD_SIZE-1);
        return this;
    }

    private shuffle<T>(xs: T[]): void {
        for (let i = xs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1)); // random index from 0 to i
            [xs[i], xs[j]] = [xs[j], xs[i]];
        }
    }

    private surrounded(cell: string, board: Map<string, cellcontents>) {
        for (const neigh of this.graph.neighbours(cell)) {
            if (! board.has(neigh) ) {
                return false;
            }
        }
        return true;
    }

    private getRandomPlacement(): Map<string, cellcontents> {
        const board = new Map<string, cellcontents>();
        const start = this.graph.coords2algebraic(BOARD_SIZE, BOARD_SIZE); // start at the center of the board
        let nutsLeft = NUM_NUTS;
        let frontier = [start];

        while ( nutsLeft > 0 ) {
            const emptyNeighs = this.graph.neighbours(frontier[0]).filter(c => !board.has(c));
            this.shuffle(emptyNeighs);
            // place two neighbors (if possible)
            board.set(emptyNeighs[0], [3, 1]);
            frontier.push(emptyNeighs[0]);
            frontier = frontier.filter(c => !this.surrounded(c, board) );
            this.shuffle(frontier);
            nutsLeft -= 1;
        }

        return board;
    }

    private atEdge(cell: string): boolean {
        const neighs = this.graph.neighbours(cell);
        let counterVoid = 0, counterNuts = 0;

        for (const adj of neighs) {
            if ( !this.board.has(adj) ) { // might be adjacent to a void cell
                counterVoid += 1;
            } else {
                counterNuts += 1;
            }
        }
        // cannot be a dead-end, and
        // either is adjacent to a void cell, or at the edge of the board
        return counterNuts > 2 && (counterVoid > 0 || neighs.length < 6); // or at the edge of the playing field
    }

    // is `cell` adjacent to any piece of `player`?
    private isAdjacent(cell: string, player: playerid): boolean {
        for (const adj of this.graph.neighbours(cell)) {
            if ( this.board.has(adj) && this.board.get(adj)![0] === player ) {
                return true;
            }
        }
        return false;
    }

    // get group that includes `marble`
    private getGroup(marble: string): string[] {
        const todo = [marble];
        const seen: Set<string> = new Set();
        while (todo.length > 0) {
            const cell = todo.pop()!;
            seen.add(cell);
            for (const neigh of this.graph.neighbours(cell)) {
                if ( seen.has(neigh) ) { continue; }
                if ( this.board.has(neigh) && this.board.get(neigh)![0] === this.currplayer ) {
                    todo.push(neigh);
                }
            }
        }
        return [...seen];
    }

    // return all non-player cells adjacent to the group where `marble` belongs
    // that `nut` can move to
    private adjacentToGroup(marble: string, nut: string): string[] {
        const marbleGroup = this.getGroup(marble);
        // get all the non-player cells adjacent to the group (except `nut`)
        const res: Set<string> = new Set();
        for (const cell of marbleGroup) {
            for (const neigh of this.graph.neighbours(cell)) {
                if ( neigh === nut ) { continue; }
                if ( this.board.has(neigh) && this.board.get(neigh)![0] === 3 ) {
                    res.add(neigh);
                }
            }
        }
        return [...res];
    }

    // all the cells where a free `marble` can move
    // firstMove informs if this relates to the first or second move of the player's turn
    private nutMoves(nut: string, firstMove = true): string[] {
        const moves: Set<string> = new Set();

        // A free nut can move if it is adjacent to a friendly piece, where its group is adjacent to
        // another free nut
        for (const neigh of this.graph.neighbours(nut)) {
            if ( this.board.has(neigh) && this.board.get(neigh)![0] === this.currplayer ) {
                for (const empty of this.adjacentToGroup(neigh, nut)) {
                    if ( this.board.get(empty)![1] < 4 ) { // cannot place over full towers
                        moves.add(empty);
                    }
                }
            }
        }

        // if there are marbles in reserve, include self to represent a placement (hut must be a singleton)
        if ( firstMove && this.reserve[this.currplayer - 1] > 0 && this.board.get(nut)![1] === 1 ) {
            moves.add(nut);
        }

        return [...moves];
    }

    // all the cells where the friendly `marble` can move
    // requires: this.board.get(marble)[0] === this.currplayer
    private marbleMoves(marble: string): string[] {
        const prevplayer = this.currplayer % 2 + 1 as playerid;
        const sizeStack = this.board.get(marble)![1];
        const moves: string[] = [];

        // move to an adjacent nut which has, at most, one level difference
        for (const neigh of this.graph.neighbours(marble)) {
            if ( this.board.has(neigh) &&
                 this.board.get(neigh)![0] === 3 &&
                 Math.abs( this.board.get(neigh)![1] - sizeStack ) <= 1 ) {
                moves.push(neigh);
            }
        }

        const dirs: directions[] = ["NE","E","SE","SW","W","NW"];
        const [x, y] = this.graph.algebraic2coords(marble);

        // jump over a friendly marble landing on the immediate next nut, that must be empty
        for (const dir of dirs) {
            const ray = this.graph.ray(x, y, dir).map(n => this.graph.coords2algebraic(...n));
            if ( ray.length < 2 ) { continue; } // not enough space to jump
            if ( !this.board.has(ray[0]) || !this.board.has(ray[1]) ) { continue; } // jump impossible
            if ( this.board.get(ray[0])![0] !== this.currplayer ) { continue; } // jump only friendlies
            if ( this.board.get(ray[1])![0] !== 3 ) { continue; } // can only land on nuts
            // the level differences of at most 1, for each pair of cells, must be respected
            if ( Math.abs( this.board.get(ray[0])![1] -          sizeStack         ) > 1 ) { continue; }
            if ( Math.abs( this.board.get(ray[0])![1] - this.board.get(ray[1])![1] ) > 1 ) { continue; }
            moves.push(ray[1]);
        }

        // push one opponent marble a distance of one nut, if the final nut is empty and not on a higher level
        for (const dir of dirs) {
            const ray = this.graph.ray(x, y, dir).map(n => this.graph.coords2algebraic(...n));
            // slide thru the phalanx of friendly lines in this ray
            let idx = 0;
            while ( this.board.has(ray[idx]) && this.board.get(ray[idx])![0] === this.currplayer ) idx += 1;
            // if the next cell, ray[idx], has an opponent marble, it might be pushed!
            if ( this.board.has(ray[idx]) && this.board.get(ray[idx])![0] === prevplayer ) {
                // check restriction that no movement can be between two stacks with size difference > 1
                if ( Math.abs(sizeStack - this.board.get(ray[0])![1]) > 1 ) { continue; }
                // check if the *remaining* all marbles in path satisfy the stack's size difference of 1
                for (let i=0; i<idx-1; i++) {
                    if ( Math.abs(this.board.get(ray[ i ])![1] -
                                  this.board.get(ray[i+1])![1]) > 1 ) { continue; }
                }
                // check the last cell (where the pushed marble will go)
                if ( this.board.has(ray[idx+1]) ) // if in the playing field
                    if ( Math.abs(this.board.get(ray[ idx ])![1] -
                                  this.board.get(ray[idx+1])![1]) > 1 ) { continue; }

                // push only if is the final cell before the board ends, or
                // the new place is only a non-higher stack of nuts
                if ( idx === ray.length - 1 ||      // the opponent piece will be pushed-off
                     !this.board.has(ray[idx+1]) || // idem
                     (this.board.has(ray[idx+1]) && // or just pushed
                      this.board.get(ray[idx+1])![0] === 3 &&
                      this.board.get(ray[idx])![1] >= this.board.get(ray[idx+1])![1]) ) {
                    moves.push(ray[idx]);
                }
            }
        }

        return moves;
    }

    // update board state of moving a marble
    // return true is there was an opponent's marble pushed-off the board
    // requires: the move is valid
    private moveMarble(from: string, to: string): void {
        const prevplayer = this.currplayer % 2 + 1 as playerid;
        const dirs: directions[] = ["NE","E","SE","SW","W","NW"];
        const sizeStackFrom = this.board.get(from)![1];
        const sizeStackTo   = this.board.get( to )![1];
        const [x, y] = this.graph.algebraic2coords(from);

        if (from === to) { // placement from reserve
            this.reserve[this.currplayer - 1] -= 1;
            this.board.set(to, [this.currplayer, sizeStackTo]);
            return;
        }

        for (const dir of dirs) {
            const ray = this.graph.ray(x, y, dir).map(n => this.graph.coords2algebraic(...n));
            if (! ray.includes(to) ) { continue; }
            if ( this.board.get(to)![0] === 3 ) { // a move or jump
                this.board.set(to, [this.currplayer, sizeStackTo]);
            } else { // an opponent marble was pushed
                const idxPushed = ray.indexOf(to);
                if ( idxPushed < ray.length-1 && this.board.has(ray[idxPushed+1]) ) { // not a push-off
                    const cellAfter = ray[idxPushed+1];
                    const sizeStackAfter = this.board.get(cellAfter)![1];
                    this.board.set(cellAfter, [prevplayer, sizeStackAfter]);
                    if ( this.results !== undefined ) { // add an arrow to show the push
                        this.results.push({ type: "move", from: to, to: cellAfter });
                    }
                } else { // a push-off
                    this.reserve[prevplayer - 1] += 1;
                    if ( this.results !== undefined && idxPushed < ray.length-1 ) {
                        this.results.push({ type: "capture", where: ray[idxPushed+1] });
                    }
                }
                this.board.set(to, [this.currplayer, sizeStackTo]);
            }
        }
        this.board.set(from, [3, sizeStackFrom]); // remove marble from its original cell
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.graph.coords2algebraic(col, row);
            let newmove = "";

            // during the setup players drops one friendly and one opponent marble
            if ( this.stack.length <= NUM_MARBLES ) {
                if ( move === "" ) { // starting fresh
                    newmove = cell;
                } else {
                    const moves = move.split(",");
                    if ( moves.includes(cell) ) { // check if the cell already was clicked
                        newmove = moves.filter(c => c!=cell).join(","); // if re-click, undo it
                    } else {
                        newmove = `${move},${cell}`; // otherwise, append coordinates of current click
                    }
                }
            } else {
                if ( move === "" ) { // starting fresh
                    if ( this.board.has(cell) &&  // check if it only can be a placement
                         this.board.get(cell)![0] === 3 &&
                         this.nutMoves(cell).length === 1 &&
                         this.reserve[this.currplayer-1] > 0 ) {
                        newmove = `${cell}-${cell}`;
                    } else {
                        newmove = cell;
                    }
                } else if (move === cell) {
                    if ( this.board.has(cell) && this.board.get(cell)![0] === this.currplayer) {
                        newmove = ""; // re-click resets
                    } else {
                        newmove = `${move}-${cell}`; // placement from reserve
                    }
                } else if (! move.includes('-') ) {
                    newmove = `${move}-${cell}`; // movement
                } else if (! move.includes(',') ) {
                    newmove = `${move},${cell}`; // start of second move
                } else {
                    const moves = move.split(/[-,]/);
                    if (moves.at(-1) === cell) {
                        newmove = `${moves[0]}-${moves[1]}`; // re-click resets second move
                    } else {
                        newmove = `${move}-${cell}`; // end of second movement
                    }
                }
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
            if ( this.stack.length <= NUM_MARBLES ) {
                result.message = i18next.t("apgames:validation.mutternland.INITIAL_PLACE");
            } else {
                result.message = i18next.t("apgames:validation.mutternland.INSTRUCTIONS");
            }
            return result;
        }

        if (m === "pass") {
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        if ( this.stack.length <= NUM_MARBLES ) { // setup phase
            const moves = m.split(',');
            for (const cell of moves) {
                if (! this.atEdge(cell) ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.mutternland.NOT_AT_EDGE", { cell: cell });
                    return result;
                }
                if ( this.board.has(cell) && this.board.get(cell)![0] !== 3 ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.mutternland.OCCUPIED");
                    return result;
                }
            }
            result.valid = true;
            result.complete = moves.length === 2 ? 1 : -1;
            result.canrender = true;
            if ( moves.length === 1 ) {
                result.message = i18next.t("apgames:validation.mutternland.INITIAL_PLACE_STEP2");
            } else {
                result.message = i18next.t("apgames:validation.mutternland.INSTRUCTIONS");
            }
            return result;
        }

        const moves = m.split(/[,-]/);
        const prevplayer = this.currplayer % 2 + 1 as playerid;

        try {
            for (const move of moves) { this.graph.algebraic2coords(move); } // check if valid cell
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: m });
            return result;
        }

        for (const move of moves) {  // check for void cells
            if (! this.board.has(move) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.mutternland.CELL_VOID");
                return result;
            }
        }

        if ( moves.length === 1 ) {
            // this can be a place/move of a friendly marble, or the movement of a nut
            if ( this.board.get(m)![0] === prevplayer ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.mutternland.ENEMY_MARBLE");
                return result;
            }
            if ( this.board.get(m)![0] === this.currplayer && this.marbleMoves(m).length === 0 ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.mutternland.MARBLE_CANNOT_MOVE", {move: moves[0]});
                return result;
            }
            if ( this.board.get(m)![0] === 3 && this.board.get(m)![1] === 4 ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.mutternland.NUT_IN_TOWER");
                return result;
            }
            const hasReserve = this.reserve[this.currplayer - 1] > 0;
            if ( this.board.get(m)![0] === 3 && !hasReserve && !this.isAdjacent(m, this.currplayer) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.mutternland.NUT_NOT_ADJACENT_FRIEND");
                return result;
            }
            if ( this.board.get(m)![0] === 3 && this.nutMoves(m).length === 0 ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.mutternland.NUT_CANNOT_MOVE", {move: moves[0]});
                return result;
            }
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            if ( this.board.get(m)![0] === this.currplayer ) {
                result.message = i18next.t("apgames:validation.mutternland.MOVE_MARBLE");
            } else if ( hasReserve && this.board.get(m)![1] === 1 ) {
                result.message = i18next.t("apgames:validation.mutternland.MOVE_NUT_OR_PLACE");
            } else {
                result.message = i18next.t("apgames:validation.mutternland.MOVE_NUT");
            }
            return result;
        }

        if ( moves.length === 2 ) {
            if ( this.board.get(moves[0])![0] === 3 ) {
                // is it a nut moving? or a marble placed?
                if ( moves[0] === moves[1] ) { // a marble placement
                    if ( this.reserve[this.currplayer-1] === 0 ) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.mutternland.RESERVE_EMPTY");
                        return result;
                    }
                    if ( this.board.get(moves[0])![1] !== 1 ) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.mutternland.PLACE_TOO_HIGH");
                        return result;
                    }
                    result.valid = true;
                    result.complete = 0; // a nut might still be moved
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.mutternland.INSTRUCTIONS_STEP2");
                    return result;
                }
                if (! this.nutMoves(moves[0]).includes(moves[1]) ) { // a nut movement
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.mutternland.NUT_ILLEGAL_MOVE", {move: moves[1]});
                    return result;
                }
                result.valid = true;
                result.complete = 1; // the turn ends after the nut move
                result.canrender = true;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            } else { // it is a marble move
                if (! this.marbleMoves(moves[0]).includes(moves[1]) ) {
                    result.valid = false;
                    if ( this.board.get(moves[1])![0] === prevplayer ) {
                        result.message = i18next.t("apgames:validation.mutternland.MARBLE_ILLEGAL_PUSH", {move: moves[1]});
                    } else {
                        result.message = i18next.t("apgames:validation.mutternland.MARBLE_ILLEGAL_MOVE", {move: moves[1]});
                    }
                    return result;
                }
                result.valid = true;
                result.complete = 0; // turn might end after a marble move
                result.canrender = true;
                result.message = i18next.t("apgames:validation.mutternland.INSTRUCTIONS_STEP2");
                return result;
            }
        }

        if ( moves.length === 3 ) {
            const clone = this.clone();
            clone.moveMarble(moves[0], moves[1]); // the first move was a marble move
            // we are checking the nut selection (the marble movement is done)
            if ( clone.board.get(moves[2])![0] !== 3 ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.mutternland.NOT_A_NUT");
                return result;
            }
            if ( clone.board.get(moves[2])![1] === 4 ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.mutternland.NUT_IN_TOWER");
                return result;
            }
            if (! clone.isAdjacent(moves[2], clone.currplayer) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.mutternland.NUT_NOT_ADJACENT_FRIEND");
                return result;
            }
            if ( clone.nutMoves(moves[2], false).length === 0 ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.mutternland.NUT_CANNOT_MOVE", {move: moves[2]});
                return result;
            }
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.mutternland.MOVE_NUT");
            return result;
        }

        // we have a complete move, just need to check if the nut moved legally
        const clone = this.clone();
        clone.moveMarble(moves[0], moves[1]);

        if (! clone.nutMoves(moves[2]).includes(moves[3]) ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.mutternland.NUT_ILLEGAL_MOVE", {move: moves[3]});
            return result;
        }

        result.valid = true;
        result.complete = 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {trusted = false} = {}): MutternlandGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) { throw new UserFacingError("VALIDATION_GENERAL", result.message) }
        }

        this.results = [];
        this._points = [];

        if ( m.length === 0 ) { return this; }

        if ( this.stack.length <= NUM_MARBLES ) { // setup phase
            const moves = m.split(',');

            this.board.set(moves[0], [this.currplayer, 1])
            this.reserve[this.currplayer - 1] -= 1;
            this.results.push({ type: "place", where: moves[0] });
            if ( moves.length === 1 ) { return this; }

            const prevplayer = this.currplayer % 2 + 1 as playerid;
            this.board.set(moves[1], [prevplayer, 1])
            this.reserve[prevplayer - 1] -= 1;
            this.results.push({ type: "place", where: moves[1] });
        } else if (m === "pass") {
            this.results.push({type: "pass"});
        } else {
            const moves = m.split(/[,-]/);

            if ( moves.length === 1 ) {
                if ( this.board.get(m)![0] === 3 ) {
                    this._points = this.nutMoves(m).map(c => this.graph.algebraic2coords(c));
                } else {
                    this._points = this.marbleMoves(m).map(c => this.graph.algebraic2coords(c));
                }
                return this;
            }

            // hack: the -1 prevents running the partial 2nd part of moves like "c1-c2,c3"
            for (let idx = 0; idx < moves.length-1; idx += 2) {
            //                                  ^^
                if ( this.board.get(moves[idx])![0] === this.currplayer ) { // marble move
                    this.moveMarble(moves[idx], moves[idx+1]);
                    if ( moves[idx] === moves[idx+1] ) {
                        this.results.push({ type: "place", where: moves[idx] });
                    } else {
                        this.results.push({ type: "move", from: moves[idx], to: moves[idx+1]});
                    }
                } else if ( moves[idx] === moves[idx+1] ) { // reserve placement
                    const sizeStack = this.board.get(moves[idx])![1];
                    this.board.set(moves[idx], [this.currplayer, sizeStack]);
                    this.reserve[this.currplayer - 1] -= 1
                    this.results.push({ type: "place", where: moves[idx] });
                } else { // nut move
                    const sizeStackFrom = this.board.get(moves[idx  ])![1];
                    const sizeStackTo   = this.board.get(moves[idx+1])![1];
                    if ( sizeStackFrom > 1 ) {
                        this.board.set(moves[idx], [3, sizeStackFrom-1]);
                    } else {
                        this.board.delete(moves[idx]);
                    }
                    this.board.set(moves[idx+1], [3, sizeStackTo+1]);
                    this.results.push({ type: "move", from: moves[idx], to: moves[idx+1]});
                }
            }

            if ( moves.length === 3 ) {
                this._points = this.nutMoves(moves[2], false).map(c => this.graph.algebraic2coords(c));
                return this;
            }
        } // end !pass

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    //////////// Scoring and End-of-Game ////////////

    protected checkEOG(): MutternlandGame {
        const prevplayer = this.currplayer % 2 + 1 as playerid;

        // game ends when three towers are achieved, or two consecutive passes occur
        this.gameover = this.getPlayerScore(prevplayer) === TOWERS_GOAL ||
                        (this.lastmove === "pass" &&
                         this.stack[this.stack.length - 1].lastmove === "pass");

        if ( this.gameover ) {
            const scores = [this.getPlayerScore(1), this.getPlayerScore(2)];
            if ( scores[0] === scores[1] ) {
                this.winner = [1, 2];
            } else {
                this.winner = scores[0] > scores[1] ? [1] : [2];
            }
            this.results.push( {type: "eog"},
                               {type: "winners", players: [...this.winner]} );
        }
        return this;
    }

    public render(): APRenderRep {
        const pieces: string[][] = [];
        for (const row of this.graph.listCells(true)) {
            const nodes: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const [player, size] = this.board.get(cell)!;
                    let str = "";
                    for (let i = 0; i < size; i++) {
                        str += "C"
                    }
                    str += player === 1 ? "A" : (player === 2 ? "B" : "");
                    nodes.push(str);
                } else {
                    nodes.push("-");
                }
            }
            pieces.push(nodes);
        }

        const nutColour: Colourfuncs = {
            func: "custom",
            default: NUT_COLOR,
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
                A: { name: "piece-horse", colour: 1 },
                B: { name: "piece-horse", colour: 2 },
                C: { name: "piece", colour: nutColour },
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
                    const [x, y] = this.graph.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
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

        return rep;
    }

    public getPlayerScore(player: playerid): number {
        const ownTowers = [...this.board.entries()].filter(e => e[1][0] === player && e[1][1] === 4);
        return ownTowers.length;
    }

    public getButtons(): ICustomButton[] {
        return [{ label: "pass", move: "pass" }];
    }

    public sidebarScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.mutternland.RESERVE"),
                  scores: [...this.reserve] },
            { name: i18next.t("apgames:status.SCORES"),
                  scores: [this.getPlayerScore(1), this.getPlayerScore(2)] },
        ];
    }

    public state(): IMutternlandState {
        return {
            game: MutternlandGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: MutternlandGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            reserve: [...this.reserve],
        };
    }

    public clone(): MutternlandGame {
        return new MutternlandGame(this.serialize());
    }
}
