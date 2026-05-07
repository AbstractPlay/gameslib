/* eslint-disable no-console */
import { GameBase, IAPGameState, IClickResult, ICustomButton, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, BoardBasic, MarkerDots, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { replacer, reviver, SquareOrthGraph, UserFacingError } from "../common";
import { connectedComponents } from "graphology-components";
import pako, { Data } from "pako";

import i18next from "i18next";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Buffer = require('buffer/').Buffer  // note: the trailing slash is important!

type playerid = 1 | 2;
export type cellcontents = [playerid, number];

type Territory = {
    cells: string[];
    owner: playerid|undefined;
};

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, cellcontents>;
    lastmove?: string;
    scores: [number, number];
    reserve: [number, number];
    maxGroups: [number, number]; // relevant for the opening to define which groups are alive
    komi?: number;
    swapped: boolean;
}

export interface ISporaState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class SporaGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Spora",
        uid: "spora",
        playercounts: [2],
        version: "20260407",
        dateAdded: "2026-05-04",
        // i18next.t("apgames:descriptions.spora")
        description: "apgames:descriptions.spora",
        notes: "apgames:notes.spora",
        urls: [
                "https://boardgamegeek.com/thread/3493284/rules-of-spora"
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
        variants: [
            { uid: "size-9", group: "board" },
            { uid: "#board",  group: "board" }, // 13x13
            { uid: "size-15", group: "board" },
            { uid: "size-19", group: "board" },
            { uid: "size-25", group: "board" }
        ],
        categories: ["goal>area", "mechanic>place", "mechanic>move>sow", "mechanic>capture", "mechanic>stack",
                     "mechanic>enclose", "board>shape>rect", "components>simple>2c"],
        flags: ["scores", "no-moves", "custom-buttons", "custom-colours", "experimental"],
    };

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardSize);
    }

    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardSize);
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, cellcontents>;
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    public scores: [number, number] = [0, 0];
    public reserve: [number, number] = [this.getReserveSize(), this.getReserveSize()]; // #pieces off-board
    public maxGroups: [number, number] = [0, 0];
    public komi?: number;
    public swapped = true;

    private boardSize = 13;
    private _selected: null|[string, number] = null;

    constructor(state?: ISporaState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: SporaGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                scores: [0, 0],
                reserve: [this.getReserveSize(), this.getReserveSize()],
                maxGroups: [0, 0],
                swapped: true,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                // is the state a raw JSON obj
                if (state.startsWith("{")) {
                    state = JSON.parse(state, reviver) as ISporaState;
                } else {
                    const decoded = Buffer.from(state, "base64") as Data;
                    const decompressed = pako.ungzip(decoded, {to: "string"});
                    state = JSON.parse(decompressed, reviver) as ISporaState;
                }
            }
            if (state.game !== SporaGame.gameinfo.uid) {
                throw new Error(`The Spora game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): SporaGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if (idx < 0 || idx >= this.stack.length) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        if (state === undefined) {
            throw new Error(`Could not load state index ${idx}`);
        }
        this.currplayer = state.currplayer;
        this.board = new Map([...state.board].map(([k, v]) => [k, [...v]]));
        this.results = [...state._results];
        this.lastmove = state.lastmove;
        this.boardSize = this.getBoardSize();
        this.scores = [...state.scores];
        this.reserve = [...state.reserve];
        this.maxGroups = state.maxGroups === undefined ? [0,0] : [...state.maxGroups];
        this.komi = state.komi;
        this.swapped = false;
        // We have to check the first state because we store the updated version in later states
        if (state.swapped === undefined) {
            this.swapped = this.stack.length < 3 || this.stack[2].lastmove !== "play-second";
        } else {
            this.swapped = state.swapped;
        }
        return this;
    }

    private getBoardSize(): number {
        // Get board size from variants.
        if (this.variants !== undefined && this.variants.length > 0 && this.variants[0] !== undefined && this.variants[0].length > 0) {
            const sizeVariants = this.variants.filter(v => v.includes("size"))
            if (sizeVariants.length > 0) {
                const size = sizeVariants[0].match(/\d+/);
                return parseInt(size![0], 10);
            }
            if (isNaN(this.boardSize)) {
                throw new Error(`Could not determine the board size from variant "${this.variants[0]}"`);
            }
        }
        return 13;
    }

    // consider the number of stones to be 1/2 or 2/3 of the board intersections, as reasonable
    // lower and upper bounds for the amount of stones each player should have, then the arithmetic
    // mean of these two bounds give us the initial budget
    private getReserveSize() : number {
        const a =   (this.getBoardSize() * this.getBoardSize())/2;
        const b = 2*(this.getBoardSize() * this.getBoardSize())/3;
        return Math.ceil((a+b)/2);
    }

    public isKomiTurn(): boolean {
        return this.stack.length === 1;
    }

    public isPieTurn(): boolean {
        return this.stack.length === 2;
    }

    public isEndPhase(): boolean {
        const prevplayer = this.currplayer === 1 ? 2 : 1;
        return this.reserve[prevplayer - 1] == 0;
    }

    public moves(): string[] {
        return []; // too many moves to list
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            if (this.isKomiTurn()) { // Komi time, so no clicks are acceptable
                const dummyResult = this.validateMove("") as IClickResult;
                dummyResult.move = "";
                dummyResult.valid = false;
                return dummyResult;
            }

            const cell = this.coords2algebraic(col, row);
            let newmove = "";

            // there are two phases: the normal playing phase, and the end phase after the adversary has no reserve
            if (! this.isEndPhase() ) {
                if ( move === "" ) { // starting fresh
                    newmove = `${cell}<1`;
                } else if (! move.includes(',') ) { // still in the placement phase
                    const [c, n] = move.split(/[<]/);
                    if ( c === cell ) {                // first cell is reclicked, add one more piece top stack
                        newmove = `${c}<${Number(n)+1}`;
                    } else {
                        newmove = `${move},${cell}>1`; // otherwise, the click was elsewhere, so now the sow phase starts
                        this._selected = [cell, 1];
                        console.log(JSON.stringify(this._selected));
                    }
                } else if ( move.includes(',') && !move.includes('@')) { // sowing still not started (eg, a<1,b1>1)
                    const [placeStack, n1, sowingStack, n2] = move.split(/[<,>]/);
                    if ( sowingStack === cell ) {
                        newmove = `${placeStack}<${n1},${sowingStack}>${Number(n2)+1}`; // add a new piece for sowing
                        this._selected = [sowingStack, Number(n2)+1];
                        console.log(JSON.stringify(this._selected));
                    } else if (Number(n2) === 1) {
                        newmove = `${placeStack}<${n1},${sowingStack}@${cell}`; // sow just one stone
                        this._selected = [sowingStack, Number(n2)];
                        console.log(JSON.stringify(this._selected));
                    } else {
                        newmove = `${placeStack}<${n1},${sowingStack}>${Number(n2)-1}@${cell}`; // start sowing
                        this._selected = [sowingStack, Number(n2)-1];
                        console.log(JSON.stringify(this._selected));
                    }
                } else if ( move.includes('>') && move.includes('@') ) { // in the middle of the sowing phase (eg, a1<1,b1>3@c1)
                    const [placeStack, n1, sowingStack, n2, sowingPath] = move.split(/[<,>@]/);
                    if ( Number(n2) > 1 ) {
                        newmove = `${placeStack}<${n1},${sowingStack}>${Number(n2)-1}@${sowingPath}-${cell}`; // continue sowing
                        this._selected = [sowingStack, Number(n2)-1];
                        console.log(JSON.stringify(this._selected));
                    } else { // all pieces were sowed (eg, a1<1,b1>1@c1-d1  becomes  a1<1,b1@c1-d1-cell)
                        newmove = `${placeStack}<${n1},${sowingStack}@${sowingPath}-${cell}`; // end sowing
                        this._selected = null;
                        console.log(JSON.stringify(this._selected));
                    }
                } else {
                    throw new Error();
                }
            } else { // otherwise, the game is at its end phase
                // the current player must place all of his pieces in sequence
                newmove = move === "" ? `${cell}` : `${move},${cell}`;
            }

            const result = this.validateMove(newmove) as IClickResult;
            if (!result.valid) {
                result.move = "";
            } else {
                result.move = newmove;
            }
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", { move, row, col, piece, emessage: (e as Error).message })
            }
        }
    }

    //////////////////////// helper functions ////////////////////////

    public getGraph(): SquareOrthGraph { // just orthogonal connections
        return new SquareOrthGraph(this.boardSize, this.boardSize);
    }

    // check orthogonal adjacency
    private isOrthAdjacent(a: string, b: string): boolean {
      const [x1, y1] = this.algebraic2coords(a);
      const [x2, y2] = this.algebraic2coords(b);
      return Math.abs(x1 - x2) + Math.abs(y1 - y2) === 1;
    }

    // checks if the given path is legal according to Spora's rules
    // we need (placedStack, n) because the player might sow over the just placed/increased stack
    private isValidPath(placedStack: string, n: number,
                        start: string, remainingSowSize: number, path: string[]): boolean {
      if (path.length === 0) return true;

      // first step must be adjacent to start
      if (! this.isOrthAdjacent(start, path[0])) {
          return false;
      }

      let currentSowSize = remainingSowSize + path.length; // initial amount of pieces to sow
      let prev = start;
      let prevDir: [number, number] | null = null;

      for (const cell of path) {
        if (! this.isOrthAdjacent(prev, cell)) { return false; }
        const [x1, y1] = this.algebraic2coords(prev); //this.toXY(prev); //
        const [x2, y2] = this.algebraic2coords(cell); //this.toXY(cell); //
        const dir: [number, number] = [x2 - x1, y2 - y1];

        if (prevDir) {  // check no 180° turn
          const isOpposite = dir[0] === -prevDir[0] && dir[1] === -prevDir[1];
          if (isOpposite) { return false; }
        }

        // check if current position is occupied by an un-capturable enemy stack
        if ( this.board.has(cell) && this.board.get(cell)![0] !== this.currplayer ) {
            // this cell has an enemy stack, check if size is compatible
            const size = this.board.get(cell)![1];
            if ( currentSowSize < 2*size ) {
                return false; // enemy stack is too big; this path is invalid
            }
        }
        // also check if there's a friendly stack with size 4 (size 5 is illegal),
        // unless the last piece is the start (ie, the sowing made a complete square)
        if ( this.board.has(cell) && this.board.get(cell)![0] === this.currplayer && start !== cell ) {
            const size = this.board.get(cell)![1];
            if ( cell !== placedStack && size === 4 ) {
                return false; // friendly stack is too big; this path is invalid
            }
            if ( cell === placedStack && size + n === 4 ) {
                return false; // friendly stack is too big; this path is invalid
            }
        }

        if (! this.board.has(cell) ) { // the player might have placed an entire 4-stack
            if ( cell === placedStack && n === 4 ) {
                return false; // friendly stack is too big; this path is invalid
            }
        }

        prevDir = dir;
        prev = cell;
        currentSowSize -= 1; // one piece stays here, the rest are to be sowed in the remaining path
      }

      return true;
    }

    // returns all the dead pieces, and how many dead groups they define
    public findDead(p: playerid, board?: Map<string, cellcontents>): string[] {
        if (board === undefined) {
            board = this.cloneBoard(); //new Map(this.board);
        }
        const dead: string[] = [];

        // get list of pieces owned by each player
        const pcsOwned   = [...board.entries()].filter(e => e[1][0] === p).map(e => e[0]);
        const pcsUnowned = [...board.entries()].filter(e => e[1][0] !== p).map(e => e[0]);

        // get groups of owned pieces (just owned pieces, no empty spaces)
        const gOwned = this.getGraph();
        for (const node of gOwned.graph.nodes()) {
            if (! pcsOwned.includes(node)) {
                gOwned.graph.dropNode(node);
            }
        }
        const groupsOwned = connectedComponents(gOwned.graph);

        // if there's only one group, and that's all there has ever been
        // then this single group is, by definition, alive
        if (groupsOwned.length === 1 && this.maxGroups[p - 1] <= 1) {
            return [];
        }

        // check connecting paths

        // first generate a new graph with owned pcs and empties
        const gLos = this.getGraph();
        for (const node of gLos.graph.nodes()) {
            if (pcsUnowned.includes(node)) {
                gLos.graph.dropNode(node);
            }
        }
        // now test that there's a path from the first cell of each group
        // to the first cell in at least one other group
        for (let i = 0; i < groupsOwned.length; i++) {
            const comp = groupsOwned[i];
            const others = [...groupsOwned.slice(0,i), ...groupsOwned.slice(i+1)];
            let hasLos = false;
            for (const test of others) {
                const path = gLos.path(comp[0], test[0]);
                if (path !== null) {
                    hasLos = true;
                    break;
                }
            }
            if (! hasLos) {
                dead.push(...comp);
            }
        }

        return dead;
    }

    // a stack placement is legal iff
    // after placing it, and removing the dead pieces, that position is accessible to other friendly groups
    private validPlacement(initialCell: string): boolean {
        const prevplayer = this.currplayer === 1 ? 2 : 1;
        // we'll simulate the process in a cloned board
        const cloned = this.cloneBoard();
        // place the stack (herein, its size is irrelevant)
        cloned.set(initialCell, [this.currplayer, 1]);
        // compute all enemy captures
        const dead = this.findDead(prevplayer, cloned);
        dead.forEach(cell => cloned.delete(cell));
        // if there are still friendly captures, the placement is illegal
        return this.findDead(this.currplayer, cloned).length === 0;
    }

    // this method is called at the end, when the last player makes a sequence of placements
    // in this case, after placing some stones, some captures might become legal,
    //  so we need to try placing piece by piece, and evaluate their validity
    private validSequence(cells: string[]): boolean {
        const prevplayer = this.currplayer === 1 ? 2 : 1;
        // we'll simulate the process in a cloned board
        const cloned = this.cloneBoard();
        for (const cell of cells) {
            // place the stack (herein, its size is irrelevant)
            cloned.set(cell, [this.currplayer, 1]);
            // compute all enemy captures
            const dead = this.findDead(prevplayer, cloned);
            dead.forEach(cell => cloned.delete(cell));
            // if there are still friendly captures, the placement is illegal
            if (this.findDead(this.currplayer, cloned).length > 0) {
                return false;
            }
        }
        return true;
    }

    // What pieces are orthogonally adjacent to a given area?
    public getAdjacentPieces(area: string[], pieces: string[]): string[] {
      // convert area strings to numeric coordinates
      const areaCoords = area.map(cell => this.algebraic2coords(cell));

      return pieces.filter(pieceStr => {   // Filter the pieces array
        const piece = this.algebraic2coords(pieceStr);

        return areaCoords.some(square => {  // check adjacency
          const dx = Math.abs(piece[0] - square[0]);
          const dy = Math.abs(piece[1] - square[1]);
          return (dx == 1 && dy == 0) || (dx == 0 && dy == 1);
        });
      });
    }

    // Get all available territories
    // Used in (1) computing scores, and (2) in the render process
    public getTerritories(): Territory[] {
        const p1Pieces = [...this.board.entries()].filter(e => e[1][0] === 1).map(e => e[0]);
        const p2Pieces = [...this.board.entries()].filter(e => e[1][0] === 2).map(e => e[0]);
        const allPieces = [...p1Pieces, ...p2Pieces];

        // compute empty areas
        const gEmpties = this.getGraph();
        for (const node of gEmpties.graph.nodes()) {
            if (allPieces.includes(node)) {  // remove intersections/nodes with pieces
                gEmpties.graph.dropNode(node);
            }
        }
        const emptyAreas : Array<Array<string>> = connectedComponents(gEmpties.graph);

        const territories: Territory[] = [];
        for(const area of emptyAreas) {
            let owner : playerid | undefined = undefined;
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

    /**
     *  Move type       | Requirements
     *  ----------------+-------------------------------------------------------------------------------------------------
     *  c1<n            | !enemy(c1), n <= min(reserve, 4), friend(c1) ==> size(c1)+n <= 4
     *  c1<n,c2>n1      | requirements(c1<n), friend(c2), c1!=c2, n1 <= size(c2)
     *  c1<n,c2>n1@path | requirements(c1<n,c2>n1), path orthogonal & adj(c2)
     *  c1<n,c2@path    | requirements(c1<n,c2>n1@path)
     */
    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (this.isKomiTurn()) {
            if (m.length === 0) {
                // game is starting, show initial KOMI message
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.spora.INITIAL_SETUP");
                return result;
            }

            // player typed something in the move textbox,
            // check if it is an integer or a number with 0.5 decimal part
            if (! /^-?\d+(\.[05])?$/.test(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.spora.INVALID_KOMI");
                return result
            }
            result.valid = true;
            result.complete = 0; // partial because player can continue typing
            result.canrender = true;
            result.message = i18next.t("apgames:validation.spora.INSTRUCTIONS");
            return result;
        }

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            if ( this.isPieTurn() ) {
                result.message = i18next.t("apgames:validation.spora.KOMI_CHOICE");
            } if ( this.isEndPhase() ) {
                result.message = i18next.t("apgames:validation.spora.END_PHASE_INSTRUCTIONS",
                                           { remaining: this.reserve[this.currplayer - 1] });
            } else {
                result.message = i18next.t("apgames:validation.spora.INSTRUCTIONS")
            }
            return result;
        }

        if (m === "play-second") {
            if ( this.isPieTurn() ) {
                result.valid = true;
                result.complete = 1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.spora.INVALID_PLAYSECOND");
            }
            return result;
        }

        // check if the game is in its end phase and, if so, deal with the situation
        if ( this.isEndPhase() ) {
            const cells = m.split(/[,]/);
            if ( cells.length > this.reserve[this.currplayer - 1] ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.spora.NOT_ENOUGH_PIECES");
                return result;
            }
            for (const cell of cells) {
                if (this.board.has(cell) && this.board.get(cell)![0] !== this.currplayer) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.spora.ENEMY_PIECE");
                    return result;
                }
                if ( this.board.has(cell) && this.board.get(cell)![1] + cells.filter(c => c === cell).length > 4 ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.spora.MAXIMUM_STACK");
                    return result;
                }
            }
            // check if the sequence of placements are able to make legal captures
            if (! this.validSequence(cells) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.spora.SELF_CAPTURE");
                return result;
            }
            result.valid = true;
            result.complete = this.reserve[this.currplayer - 1] > cells.length ? -1 : 1; // end when all pieces are on board
            result.canrender = true;
            if ( this.reserve[this.currplayer - 1] === cells.length + 1 ) {
                result.message = i18next.t("apgames:validation.spora.END_PHASE_LAST");
            } else {
                const remaining = this.reserve[this.currplayer - 1] - cells.length;
                result.message = i18next.t("apgames:validation.spora.END_PHASE_INSTRUCTIONS", { remaining: remaining });
            }
            return result;
        }

        const initialCell = m.split(/[<,>@]/)[0];
        const isEmpty   = !this.board.has(initialCell);
        const hasEnemy  =  this.board.has(initialCell) && this.board.get(initialCell)![0] !== this.currplayer;
        const hasFriend =  this.board.has(initialCell) && this.board.get(initialCell)![0] === this.currplayer;

        const commands: string[] = m.split(/[,]/);
        const n = Number(commands[0].split(/[<]/)[1]);  // get the amount of pieces to place

        try {
            this.algebraic2coords(initialCell); // check if valid cell
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: m });
            return result;
        }

        // otherwise, we are in the playing phase

        if ( hasEnemy ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.spora.ENEMY_PIECE");
            return result;
        }

        if ( n > this.reserve[this.currplayer - 1] ) {
            result.valid = false;
            result.canrender = false;
            result.message = i18next.t("apgames:validation.spora.NOT_ENOUGH_PIECES");
            return result;
        }

        if ( (isEmpty && n > 4) || (hasFriend && n + this.board.get(initialCell)![1] > 4) ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.spora.MAXIMUM_STACK");
            return result;
        }

        // a placement is legal iff we are still placing the first two stacks of each player, or
        // after placing it, and removing the dead pieces, that position is accessible to other friendly groups
        if (this.stack.length > 5 && isEmpty && !this.validPlacement(initialCell) ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.spora.SELF_CAPTURE");
            return result;
        }

        // at this moment, the place phase is correct

        // if the move does not have a comma, it is a valid move (but might not be complete)
        if (! m.includes(',') ) {
            result.valid = true;
            result.complete = 0; // the sowing phase is optional (the player might still choose to sow)
            result.canrender = true;
            result.message = i18next.t("apgames:validation.spora.SOW_SIZE_SELECTION");
            return result;
        }

        // otherwise, the sow phase already began

        if (! m.includes('@') ) { // we are still finding how many pieces are to be sowed
            const info = m.split(/[<,>]/);  // eg, c1<n,c2>n1
            const sowingStack = info[2];
            const n1 = Number(info[3]);

            if ( !this.board.has(sowingStack) || this.board.get(sowingStack)![0] !== this.currplayer ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.spora.SOW_FRIENDLY");
                return result;
            }
            if ( initialCell === sowingStack ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.spora.SAME_PLACE_SOW_STACK");
                return result;
            }
            if ( n1 > this.board.get(sowingStack)![1] ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.spora.SOW_TOO_LARGE");
                return result;
            }
            result.valid = true;
            result.complete = -1; // still necessary to state the sowing path, next
            result.canrender = true;
            result.message = i18next.t("apgames:validation.spora.SOW_INSTRUCTIONS");
            return result;
        }

        // there is already a (partial) path; check if path is correct
        const tokens = m.split(/[<,>@]/);
        const sowingStack = tokens[2];
        let remainingSowSize : number = 0;
        let cellsPath : string[];

        if ( m.includes('>') ) { // eg, c1<n,c2>n1@path
            remainingSowSize = Number(tokens[3]); // get n1
            cellsPath = tokens[4].split('-');
        } else {                // eg, c1<n,c2@path
            cellsPath = tokens[3].split('-');
        }

        if (! this.isValidPath(initialCell, n, sowingStack, remainingSowSize, cellsPath) ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.spora.INVALID_SOW_PATH");
            return result;
        }

        result.valid = true;
        result.complete = m.includes('>') ? -1 : 1; // incomplete until all pieces are sowed
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private doCaptures(): string[] {
        const result = [];
        const prevplayer = this.currplayer === 1 ? 2 : 1;

        for (const cell of this.findDead(prevplayer)) {
            this.board.delete(cell);
            result.push(cell);
        }
        for (const cell of this.findDead(this.currplayer)) {
            this.board.delete(cell);
            result.push(cell);
        }
        return result;
    }

    public updateGroupCounts(): void {
        for (const p of [1, 2] as const) {
            const owned = [...this.board.entries()].filter(e => e[1][0] === p).map(e => e[0]);
            const gOwned = this.getGraph();
            for (const node of gOwned.graph.nodes()) {
                if (! owned.includes(node)) {
                    gOwned.graph.dropNode(node);
                }
            }
            const groups = connectedComponents(gOwned.graph);
            this.maxGroups[p - 1] = Math.max(this.maxGroups[p - 1], groups.length);
        }
    }

    public move(m: string, {partial = false, trusted = false} = {}): SporaGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
        }
        if (m.length === 0) { return this; }
        this.results = [];
        const captures = []; // all the captures made in the turn
        let totalPiecesPlaced = 0;

        if (this.isKomiTurn()) {
            // first move, get the Komi proposed value, and add komi to game state
            this.komi = Number(m);
            this.results.push({type: "komi", value: this.komi});
            this.komi *= -1; // invert it for backwards compatibility reasons
        } else if (m === "play-second") {
            this.komi! *= -1;
            this.swapped = false;
            this.results.push({type: "play-second"});
        } else if ( this.isEndPhase() ) {
            const cells = m.split(/[,]/);
            totalPiecesPlaced = cells.length;
            for (const cell of cells) {
                const prevsize = this.board.has(cell) ? this.board.get(cell)![1] : 0;
                this.board.set(cell, [this.currplayer, prevsize + 1]);
                this.results.push({ type: "place", where: cell });
                captures.push(...this.doCaptures());
                if (captures.length > 0) {
                    this.results.push({ type: "capture", where: [...captures].join(), count: captures.length });
                }
            }
        } else { // normal play
            // the possible commands have format "c1<n" or "c1<n,c2>n1@path" or "c1<n,c2@path"
            const commands: string[] = m.split(/[<,>@]/);
            const placeStack = commands[0];
            const n = Number(commands[1]);
            totalPiecesPlaced = n;

            // first, do the stack placement
            const prevsize = this.board.has(placeStack) ? this.board.get(placeStack)![1] : 0;
            this.board.set(placeStack, [this.currplayer, prevsize + n]);
            this.results = [{type: "place", where: placeStack}]

            captures.push(...this.doCaptures());
            if (captures.length > 0) {
                this.results.push({ type: "capture", where: [...captures].join(), count: captures.length });
            }

            // second, do the (optional) partial sowing
            if ( m.includes('>') && m.includes('@') ) {
                const sowingStack = commands[2];
                const originalSize = this.board.get(sowingStack)![1];
                const n1 = Number(commands[3]); // pieces that await their turn to be sowed
                const cells = m.split(/[@]/)[1].split(/[-]/);
                const totalSowed = n1 + cells.length; // the total number of pieces in the sowing move

                this.board.set(sowingStack, [this.currplayer, originalSize - totalSowed + n1]);

                for (const cell of cells) {
                    const size = this.board.has(cell) && this.board.get(cell)![0] == this.currplayer
                                 ? this.board.get(cell)![1] : 0;
                    this.board.set(cell, [this.currplayer, size+1]); // place a friendly piece (possibly capturing an enemy stack)
                    captures.push(...this.doCaptures()); // each sowed piece can capture
                }

                if (captures.length > 0) {
                    this.results.push({ type: "capture", where: [...captures].join(), count: captures.length });
                }

                const sowingPath = [sowingStack, ...cells]
                for(let i = 0; i < sowingPath.length-1; i++ ) { // mark path
                    this.results.push({type: "move", from: sowingPath[i], to: sowingPath[i+1]});
                }
                return this;
            }

            // or do the (optional) complete sowing
            if ( m.includes('@') ) {
                const sowingStack = commands[2];
                const cells = commands[3].split(/[-]/);
                const n1: number = cells.length; // number of pieces to be removed from sowingStack

                if ( this.board.get(sowingStack)![1] === n1 ) { // the entire stack is moving
                    this.board.delete(sowingStack);
                } else { // otherwise, just update the stack's size
                    this.board.set(sowingStack, [this.currplayer, this.board.get(sowingStack)![1] - n1]);
                }

                for (const cell of cells) {
                    const size: number = this.board.has(cell) && this.board.get(cell)![0] == this.currplayer
                                         ? this.board.get(cell)![1] : 0;
                    this.board.set(cell, [this.currplayer, size+1]); // place a friendly piece (possibly capturing an enemy stack)
                    captures.push(...this.doCaptures()); // each sowed piece can capture
                }

                if (captures.length > 0) {
                    this.results.push({ type: "capture", where: [...captures].join(), count: captures.length });
                }

                const sowingPath = [sowingStack, ...cells]
                for(let i = 0; i < sowingPath.length-1; i++ ) { // mark path
                    this.results.push({type: "move", from: sowingPath[i], to: sowingPath[i+1]});
                }
            }
        }

        if (this.stack.length > 3) {
            this.updateGroupCounts();
        }
        if ( partial ) { return this; }

        this.lastmove = m;
        this._selected = null;
        console.log(JSON.stringify(this._selected));
        this.scores = [this.getPlayerScore(1), this.getPlayerScore(2)];
        this.reserve[this.currplayer - 1] -= totalPiecesPlaced;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): SporaGame {
        if (this.stack.length <= 4) return this; // players must place at least one stack each

        const p1Pieces = [...this.board.entries()].filter(e => e[1][0] === 1).map(e => e[0]);
        const p2Pieces = [...this.board.entries()].filter(e => e[1][0] === 2).map(e => e[0]);

        this.gameover = (this.reserve[0] === 0 && this.reserve[1] === 0) // game ends when both reserves are empty
                      || p1Pieces.length === 0 || p2Pieces.length === 0; // or one player is without pieces on board

        if (this.gameover) {
            this.scores = [this.getPlayerScore(1), this.getPlayerScore(2)];
            this.winner = this.scores[0] > this.scores[1] ? [1] : [2];
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): ISporaState {
        return {
            game: SporaGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: SporaGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: this.cloneBoard(),
            scores: [...this.scores],
            reserve: [...this.reserve],
            maxGroups: [...this.maxGroups],
            komi: this.komi,
            swapped: this.swapped
        };
    }

    public render(): APRenderRep {
        let pstr = "";
        for (let row = 0; row < this.getBoardSize(); row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < this.getBoardSize(); col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    let idxSelected: null|number = null;
                    if (this._selected !== null && this._selected[0] === cell) {
                        idxSelected = contents[1] - this._selected[1];
                    }
                    let str = "";
                    for (let i = 0; i < contents[1]; i++) {
                        if (idxSelected !== null && i === idxSelected) {
                            str += "X";
                        }
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
        pstr = pstr.replace(/-{9}/g, "_");

        // Build rep
        const rep: APRenderRep =  {
            renderer: "stacking-offset",
            board: {
                style: "vertex",
                width: this.boardSize,
                height: this.boardSize,
            },
            legend: {
                A: [{ name: "piece", colour: this.getPlayerColour(1) }],
                B: [{ name: "piece", colour: this.getPlayerColour(2) }],
                X: [{ name: "piece-borderless", opacity: 0 }],
            },
            pieces: pstr,
        };

        rep.annotations = [];

        if ( this.results.length > 0 ) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                } else if (move.type === "move") {
                    const [fromX, fromY] = this.algebraic2coords(move.from);
                    const [toX, toY] = this.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "capture") {
                    for (const cell of move.where!.split(",")) {
                        const [x, y] = this.algebraic2coords(cell);
                        rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                    }
                }
            }
        }

        // add territory dots
        if (this.maxGroups[0] > 0 && this.maxGroups[1] > 0) {
            const territories = this.getTerritories();
            const markers: Array<MarkerDots> = []
            for (const t of territories) {
                if (t.owner !== undefined) {
                    const points = t.cells.map(c => this.algebraic2coords(c));
                    if (t.owner !== undefined) {
                        markers.push({type: "dots",
                                      colour: this.getPlayerColour(t.owner),
                                      points: points.map(p => { return {col: p[0], row: p[1]}; }) as [RowCol, ...RowCol[]]});
                    }
                }
            }
            if (markers.length > 0) {
                (rep.board as BoardBasic).markers = markers;
            }
        }

        return rep;
    }

    public getPlayerScore(player: playerid): number {
        const playerPieces = [...this.board.entries()].filter(e => e[1][0] === player).map(e => e[0]);

        let komi = 0.0;
        if (player === 1 && this.komi !== undefined && this.komi < 0)
            komi = -this.komi;
        if (player === 2 && this.komi !== undefined && this.komi > 0)
            komi = this.komi;

        const terr = this.getTerritories();
        return terr.filter(t => t.owner === player)
                   .reduce((prev, curr) => prev + curr.cells.length, komi + playerPieces.length);
    }

    public getPlayerColour(player: playerid): number | string {
        return (player == 1 && !this.swapped) || (player == 2 && this.swapped) ? 1 : 2;
    }

    public cloneBoard(): Map<string, cellcontents> {
        return new Map([...this.board].map(([k, v]) => [k, [...v]]));
    }

    public getButtons(): ICustomButton[] {
        if ( this.isPieTurn() ) {
            return [{ label: "playsecond", move: "play-second" }];
        }
        return [];
    }

    public sidebarScores(): IScores[] {
        const p1nStacks = [...this.board.entries()].filter(e => e[1][0] === 1).length;
        const p2nStacks = [...this.board.entries()].filter(e => e[1][0] === 2).length;

        return [
            { name: i18next.t("apgames:status.spora.RESERVE"),
                  scores: [...this.reserve] },
            { name: i18next.t("apgames:status.SCORES"),
                  //scores: [this.getPlayerScore(1), this.getPlayerScore(2)] },
                  scores: [`${this.getPlayerScore(1)} (with ${p1nStacks} stacks)`,
                           `${this.getPlayerScore(2)} (with ${p2nStacks} stacks)`] },
        ];
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.nowhat", { player, where: r.where }));
                resolved = true;
                break;
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.noperson.group_nowhere", { player, count: r.count }));
                resolved = true;
                break;
            case "eog":
                node.push(i18next.t("apresults:EOG.default"));
                resolved = true;
                break;
        }
        return resolved;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public serialize(opts?: {strip?: boolean, player?: number}): string {
        const json = JSON.stringify(this.state(), replacer);
        const compressed = pako.gzip(json);
        return Buffer.from(compressed).toString("base64") as string;
    }

    public clone(): SporaGame {
        return new SporaGame(this.serialize());
    }
}
