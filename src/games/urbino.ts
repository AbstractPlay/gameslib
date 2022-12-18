/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IStashEntry, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, UserFacingError, allDirections } from "../common";
import i18next from "i18next";
import { CartesianProduct } from "js-combinatorics";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

export type playerid = 0|1|2;
export type Size = 0|1|2|3;
export type CellContents = [playerid, Size];

const allMonuments: Map<string, number> = new Map([["111", 3], ["212", 5], ["323", 8]]);

interface IPointEntry {
    row: number;
    col: number;
}

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    lastmove?: string;
    pieces: [[number,number,number],[number,number,number]]; // house, palace, tower
};

export interface IUrbinoState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class UrbinoGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Urbino",
        uid: "urbino",
        playercounts: [2],
        version: "20211119",
        // i18next.t("apgames:descriptions.urbino")
        description: "apgames:descriptions.urbino",
        urls: ["https://spielstein.com/games/urbino"],
        people: [
            {
                type: "designer",
                name: "Dieter Stein",
                urls: ["https://spielstein.com/"]
            }
        ],
        variants: [
            {
                uid: "monuments"
            }
        ],
        flags: ["multistep", "player-stashes", "automove", "scores"]
    };

    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 9);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 9);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, CellContents>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public pieces!: [[number,number,number],[number,number,number]];
    private scratchboard: number[][] = [];

    constructor(state?: IUrbinoState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            const board = new Map<string, CellContents>();
            const fresh: IMoveState = {
                _version: UrbinoGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                pieces: [[18,6,3], [18,6,3]]
            };
            if ( (variants !== undefined) && (variants.length > 0) && (variants[0] === "monuments") ) {
                this.variants = ["monuments"];
            }
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IUrbinoState;
            }
            if (state.game !== UrbinoGame.gameinfo.uid) {
                throw new Error(`The Urbino engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
        for (let i = 0; i < 9; i++) {
            this.scratchboard[i] = [];
            for (let j = 0; j < 9; j++) {
                this.scratchboard[i][j] = 0;
            }
        }
    }

    public load(idx = -1): UrbinoGame {
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
        this.pieces = deepclone(state.pieces) as [[number,number,number],[number,number,number]];
        this.results = [...state._results];
        return this;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];
        const grid = new RectGrid(9, 9);

        // If there aren't two workers yet, place those first
        if (this.board.size < 2) {
            for (let row = 0; row < 9; row++) {
                for (let col = 0; col < 9; col++) {
                    const cell = UrbinoGame.coords2algebraic(col, row);
                    if (! this.board.has(cell)) {
                        moves.push(cell);
                    }
                }
            }
        // If there are only two workers, then only placement or passing is allowed
        } else if (this.board.size === 2) {
            // If nobody has passed yet, then passing is an option
            if ( (this.lastmove !== undefined) && (this.lastmove !== "pass") ) {
                moves.push("pass");
            }
            // In any case, the only other option is to place a piece
            const combos = new CartesianProduct(["1", "2", "3"], this.findPoints());
            moves.push(...[...combos].map(p => p.join("")));
        // Otherwise, all move types are possible
        } else {
            // First, you're allowed to place without moving
            const combos = new CartesianProduct(["1", "2", "3"], this.findPoints());
            moves.push(...[...combos].map(p => p.join("")));

            // Otherwise, calculate all possible moves and placements
            const empties: string[] = [];
            for (let row = 0; row < 9; row++) {
                for (let col = 0; col < 9; col++) {
                    const cell = UrbinoGame.coords2algebraic(col, row);
                    if (! this.board.has(cell)) {
                        empties.push(cell);
                    }
                }
            }
            const workers: string[] = [...this.board.entries()].filter(e => e[1][0] === 0).map(e => e[0]);
            const pairs = new CartesianProduct(workers, empties);
            for (const pair of pairs) {
                const g: UrbinoGame = Object.assign(new UrbinoGame(), deepclone(this) as UrbinoGame);
                const contents = g.board.get(pair[0])!;
                g.board.delete(pair[0]);
                g.board.set(pair[1], contents);
                const combinations = new CartesianProduct(["1", "2", "3"], g.findPoints())
                for (const cell of [...combinations].map(p => p.join(""))) {
                    moves.push(`${pair[0]}-${pair[1]},${cell}`);
                }
            }
        }

        const valid = moves.filter(m => {
            // We're only validating piece placements
            if ( (m.includes(",")) || (/^\d/.test(m)) ) {
                let placement = m;
                let from: string | undefined;
                let to: string | undefined;
                if (m.includes(",")) {
                    [from, to, placement] = m.split(/[-,]/);
                }
                const piece = parseInt(placement[0], 10);
                const cell = placement.slice(1);

                // Do you have a piece that size
                if (this.pieces[player! - 1][piece - 1] < 1) {
                    return false;
                }

                // Are there adjacency restrictions
                if (piece > 1) {
                    const [x, y] = UrbinoGame.algebraic2coords(cell);
                    const adjs = grid.adjacencies(x, y, false).map(pt => UrbinoGame.coords2algebraic(...pt));
                    for (const adj of adjs) {
                        if ( (this.board.has(adj)) && (this.board.get(adj)![1] === piece) ) {
                            return false;
                        }
                    }
                }

                // Now check for district restrictions
                const g: UrbinoGame = Object.assign(new UrbinoGame(), deepclone(this) as UrbinoGame);
                if ( (from !== undefined) && (to !== undefined) ) {
                    g.board.delete(from);
                    g.board.set(to, [0,0]);
                }
                g.board.set(cell, [player!, piece as Size])
                const district = g.getDistrict(cell);
                if (district.length > 2) {
                    return false;
                }
            }
            return true;
        });
        if (valid.length === 0) {
            return ["pass"];
        } else {
            return [...valid];
        }
    }

    public moves2(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];
        const grid = new RectGrid(9, 9);

        // If there aren't two workers yet, place those first
        if (this.board.size < 2) {
            for (let row = 0; row < 9; row++) {
                for (let col = 0; col < 9; col++) {
                    const cell = UrbinoGame.coords2algebraic(col, row);
                    if (! this.board.has(cell)) {
                        moves.push(cell);
                    }
                }
            }
            return moves;
        }
        let allDistricts = this.getAllDistricts();
        let allowedPlacements: string[] = [];
        for (let row = 0; row < 9; row++) {
            for (let col = 0; col < 9; col++) {
                const cell = UrbinoGame.coords2algebraic(col, row);
                if (this.board.has(cell) && (this.board.get(cell)![0] !== 0))  // workers allowed
                    continue;
                // Check for district restrictions
                const adjs = grid.adjacencies(col, row, false).map(pt => UrbinoGame.coords2algebraic(...pt));
                let newblocks = 1;
                for (const d of allDistricts) {
                    let touch = false;
                    let touchmyblock = false;
                    for (const adj of adjs) {
                        for (const b of d) {
                            if( b[1].has(adj) ) {
                                touch = true;
                                if (b[0] === player)
                                    touchmyblock = true;
                            }
                        }
                    }
                    if (touch)
                        newblocks += d.length - 1 + (touchmyblock ? 0 : 1);
                }
                // console.log(`cell ${cell}, newblocks ${newblocks}`);
                if (newblocks > 2)
                    continue;
                for (let piece = 1; piece < 4; piece++) {
                    // Do you have a piece that size
                    if (this.pieces[player! - 1][piece - 1] < 1)
                        continue;

                    // Are there adjacency restrictions
                    if (piece > 1 && adjs.some(adj => (this.board.has(adj)) && (this.board.get(adj)![1] === piece)))
                        continue;

                    allowedPlacements.push(piece + cell);
                }
            }
        }

        // If there are only two workers, then only placement or passing is allowed
        if (this.board.size === 2) {
            // If nobody has passed yet, then passing is an option
            if ( (this.lastmove !== undefined) && (this.lastmove !== "pass") ) {
                moves.push("pass");
            }
            // In any case, the only other option is to place a piece
            const combos = new CartesianProduct(["1", "2", "3"], this.findPoints2());
            moves.push(...[...combos].map(p => p.join("")).filter(m => allowedPlacements.includes(m)));
        // Otherwise, all move types are possible
        } else {
            // First, you're allowed to place without moving
            const combos = new CartesianProduct(["1", "2", "3"], this.findPoints2());
            moves.push(...[...combos].map(p => p.join("")).filter(m => allowedPlacements.includes(m)));

            // Otherwise, calculate all possible moves and placements
            const empties: string[] = [];
            for (let row = 0; row < 9; row++) {
                for (let col = 0; col < 9; col++) {
                    const cell = UrbinoGame.coords2algebraic(col, row);
                    if (! this.board.has(cell)) {
                        empties.push(cell);
                    }
                }
            }
            const workers: string[] = [...this.board.entries()].filter(e => e[1][0] === 0).map(e => e[0]);
            const pairs = new CartesianProduct(workers, empties);
            for (const pair of pairs) {
                const contents = this.board.get(pair[0])!;
                this.board.delete(pair[0]);
                this.board.set(pair[1], contents);
                const combinations = new CartesianProduct(["1", "2", "3"], this.findPoints2())
                for (const cell of [...combinations].map(p => p.join("")).filter(m => allowedPlacements.includes(m))) {
                    moves.push(`${pair[0]}-${pair[1]},${cell}`);
                }
                this.board.delete(pair[1]);
                this.board.set(pair[0], contents);
            }
        }

        if (moves.length === 0) {
            return ["pass"];
        } else {
            return [...moves];
        }
    }
    
    /**
     * Validates whether a particular sized piece can be placed at a particular cell.
     * It does not validate whether that cell is valid given worker placement, or
     * whether you have the piece to place, or even if the placement cell is empty.
     *
     * @private
     * @param {string} cell
     * @param {number} size
     * @returns {boolean}
     * @memberof UrbinoGame
     */
    private validPlacement(cell: string, size: Size, player: playerid): boolean {
        // Are there adjacency restrictions
        if (size > 1) {
            const [x, y] = UrbinoGame.algebraic2coords(cell);
            const grid = new RectGrid(9, 9);
            const adjs = grid.adjacencies(x, y, false).map(pt => UrbinoGame.coords2algebraic(...pt));
            for (const adj of adjs) {
                if ( (this.board.has(adj)) && (this.board.get(adj)![1] === size) ) {
                    return false;
                }
            }
        }

        // Now check for district restrictions
        const g: UrbinoGame = Object.assign(new UrbinoGame(), deepclone(this) as UrbinoGame);
        g.board.set(cell, [player, size])
        const district = g.getDistrict(cell);
        if (district.length > 2) {
            return false;
        }
        return true;
    }

    /**
     * With the given worker placement, check each possible placement until at least
     * one is found. Otherwise return false after checking them all.
     *
     * @private
     * @param {playerid} [player]
     * @returns {boolean}
     * @memberof UrbinoGame
     */
    private anyValidPlacement(player?: playerid): boolean {
        if (player === undefined) {
            player = this.currplayer;
        }
        const pts = this.findPoints();
        for (const pt of pts) {
            for (let size = 0; size < 3; size++) {
                if (this.pieces[player - 1][size] > 0) {
                    if (this.validPlacement(pt, (size + 1) as Size, player)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    private getAllDistricts(): [playerid, Set<string>][][] {
        const districts: [playerid, Set<string>][][] = [];
        let allPieces = [...this.board.entries()].filter(e => e[1][0] !== 0).map(e => e[0]);
        while (allPieces.length > 0) {
            const start = allPieces.pop()!;
            const district = this.getDistrict(start)
            districts.push(district);
            const seen: Set<string> = new Set();
            for (const d of district) {
                for (const cell of d[1]) {
                    seen.add(cell);
                }
            }
            allPieces = allPieces.filter(p => ! seen.has(p));
        }
        return districts;
    }

    private getDistrict(cell: string): [playerid, Set<string>][] {
        const grid = new RectGrid(9, 9);
        let district: Set<string> = new Set();
        const todo = [cell];
        while (todo.length > 0) {
            const next = todo.pop()!;
            if (district.has(next)) {
                continue;
            }
            district.add(next);
            const [x, y] = UrbinoGame.algebraic2coords(next);
            const adjs = grid.adjacencies(x, y, false).map(pt => UrbinoGame.coords2algebraic(...pt));
            for (const adj of adjs) {
                if ( (this.board.has(adj)) && (this.board.get(adj)![0] !== 0) ) {
                    todo.push(adj);
                }
            }
        }
        const blocks: [playerid, Set<string>][] = [];
        let block: [playerid, Set<string>];
        while (district.size > 0) {
            [block, district] = this.getBlock(district);
            blocks.push(block);
        }
        return blocks;
    }

    private getBlock(district: Set<string>): [[playerid, Set<string>], Set<string>] {
        if (district.size < 1) {
            throw new Error("Can't extract blocks from an empty district.");
        }
        const grid = new RectGrid(9, 9);
        const cells = [...district];
        const start = cells.pop()!;
        const owner = this.board.get(start)![0];
        const block: Set<string> = new Set();
        const todo = [start];
        while (todo.length > 0) {
            const next = todo.pop()!;
            if (block.has(next)) {
                continue;
            }
            block.add(next);
            district.delete(next);
            const [x, y] = UrbinoGame.algebraic2coords(next);
            const adjs = grid.adjacencies(x, y, false).map(pt => UrbinoGame.coords2algebraic(...pt));
            for (const adj of adjs) {
                if ( (district.has(adj)) && (this.board.get(adj)![0] === owner) ) {
                    todo.push(adj);
                }
            }
        }

        return [[owner, block], district];
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            if (!this.validateMove(move).valid)
                return {move, message: ""} as IClickResult;
            const cell = UrbinoGame.coords2algebraic(col, row);
            let newmove = "";
            const stash = this.pieces[this.currplayer - 1];
            let smallest: number | undefined;
            for (let i = 0; i < 3; i++) {
                if (stash[i] > 0) {
                    smallest = i + 1;
                    break;
                }
            }
            if (move === "") {
                // if all workers have been placed
                if (this.board.size >= 2) {
                    // empty space could be a placement because movement is optional
                    if (! this.board.has(cell)) {
                        if (smallest === undefined) {
                            newmove = "pass";
                        } else if (this.findPoints().includes(cell)) {
                            newmove = `${smallest}${cell}`;
                        } else {
                            return {move: "", message: ""} as IClickResult;
                        }
                    } else {
                        // occupied space must be a worker
                        if (this.board.get(cell)![0] === 0) {
                            newmove = cell;
                        } else {
                            return {move: "", message: ""} as IClickResult;
                        }
                    }
                // otherwise, early phases
                } else {
                    // only empty spaces can be clicked
                    if (! this.board.has(cell)) {
                        newmove = cell;
                    } else {
                        return {move: "", message: ""} as IClickResult;
                    }
                }
            } else {
                let [from, to, place] = move.split(/[-,]/);
                if (place === undefined && move.includes(',')) { // this happens when user clicks on stash (without movement)
                    place = to;
                    to = '';
                }
                if ( (this.board.size <= 2) && (from.length === 2) ) {
                    if (! this.board.has(cell)) {
                        newmove = cell;
                    } else {
                        newmove = move;
                    }
                } else if ( (place !== undefined) || (from.length !== 2) ) {
                    let pSize: number; let pCell: string;
                    if (place !== undefined) {
                        pSize = parseInt(place[0], 10);
                        pCell = place.slice(1);
                    } else {
                        pSize = parseInt(from[0], 10);
                        pCell = from.slice(1);
                    }
                    // if you have no more pieces, passing is your only option
                    if (smallest === undefined) {
                        newmove = "pass";
                    // if you're clicking on the same space, increment the piece size
                    } else if (cell === pCell) {
                        let next: number = pSize + 1;
                        if (next > 3) { next = 1;}
                        // not an infinite loop because there must at least be one `pSize` piece to have gotten this far
                        while ( (stash[next - 1] === 0) || (! this.validPlacement(pCell, next as Size, this.currplayer)) ) {
                            next++;
                            if (next > 3) { next = 1;}
                        }
                        if (from.length !== 2) {
                            newmove = `${next}${pCell}`;
                        } else {
                            newmove = `${from}-${to},${next}${pCell}`;
                        }
                    // user entered size to place
                    } else if (pCell === "") {
                        if (from.length !== 2) {
                            newmove = `${pSize}${cell}`;
                        } else {
                            newmove = `${from}-${to},${pSize}${cell}`;
                        }
                    // if you're clicking on a valid empty cell, replace it, starting with the smallest piece
                    } else {
                        const g = this.clone();
                        g.board.set(to, this.board.get(from)!)
                        g.board.delete(from);
                        if (g.findPoints().includes(place)) {
                            newmove = `${from}-${to},${smallest}${cell}`;
                        // otherwise, change nothing
                        } else {
                            newmove = move;
                        }
                    }
                } else if (to !== undefined) {
                    const g = this.clone();
                    g.board.set(to, this.board.get(from)!)
                    g.board.delete(from);
                    // if you have no more pieces, passing is your only option
                    if (smallest === undefined) {
                        newmove = "pass";
                    // if to is defined and you're clicking on a valid cell, assume placement
                    } else if (g.findPoints().includes(cell)) {
                        newmove = `${from}-${to},${smallest}${cell}`;
                    // otherwise, assume you want to move the worker again
                    } else {
                        newmove = `${from}-${cell}`;
                    }
                } else { // from *has* to be defined if move itself has content
                    if (smallest === undefined) {
                        newmove = "pass";
                    // if you click on an empty cell, assume movement
                    } else if ( (this.board.has(from)) && (! this.board.has(cell)) ) {
                        newmove = `${from}-${cell}`;
                    } else if (! this.board.has(from)) {
                        newmove = `${smallest}${cell}`;
                    } else {
                        newmove = move;
                    }
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
                message: i18next.t("apgames:validation._general.GENERIC", {move, row, col, piece, emessage: (e as Error).message, estack: (e as Error).stack})
            }
        }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (m.length > 0 && m.match(/^(pass|[a-i]([1-9](-([a-i]([1-9](,([123]([a-i]([1-9])?)?)?)?)?)?)?)?|,?([123]([a-i]([1-9])?)?)?)$/) == null) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
            return result;
        }
        if (m.length > 0 && m.match(/^(pass|[a-i][1-9](-[a-i][1-9](,[123]([a-i][1-9])?)?)?|,?([123]([a-i][1-9])?))$/) == null) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation._general.INCOMPLETE_MOVE");
            return result;
        }
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            if (this.board.size < 2) {
                result.message = i18next.t("apgames:validation.urbino.INITIAL_INSTRUCTIONS", {context: "fresh"});
            } else if (this.board.size === 2) {
                result.message = i18next.t("apgames:validation.urbino.INITIAL_INSTRUCTIONS", {context: "first"});
            } else {
                result.message = i18next.t("apgames:validation.urbino.INITIAL_INSTRUCTIONS", {context: "inprogress"});
            }
            return result;
        }

        // validate "pass" first of all
        if (m === "pass") {
            if (! this.moves().includes("pass")) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.urbino.INVALID_PASS");
                return result;
            }
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        let [from, to, place] = m.split(/[-,]/);
        let moved = true;
        if (place === undefined && m.includes(',')){ // this happens when user clicks on stash (without movement)
            place = to;
            to = '';
            moved = false;
        } else if (from.length !== 2) {
            place = from;
            from = '';
            moved = false;
        }

        if (moved) {
            if ( (from !== undefined) && (from.length === 2) ) {
                // valid cell
                try {
                    UrbinoGame.algebraic2coords(from);
                } catch {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: from});
                    return result;
                }
                // from currently contains a worker you control
                if (! this.board.has(from)) {
                    if (this.board.size < 2) {
                        result.valid = true;
                        result.complete = 1;
                        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                        return result;
                    }

                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: from});
                    return result;
                }
                // First move after placing workers has to be a placement or pass
                if (this.board.size === 2) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.urbino.MUST_PASS_PLAY");
                    return result;
                }

                if (this.board.get(from)![0] !== 0) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                    return result;
                }

                // if this is it, then this is a valid partial
                if (to === undefined) {
                    result.valid = true;
                    result.complete = -1;
                    result.message = i18next.t("apgames:validation.urbino.PARTIAL_MOVE");
                    return result;
                }
            }

            if (to !== undefined) {
                // valid cell
                try {
                    UrbinoGame.algebraic2coords(to);
                } catch {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: to});
                    return result;
                }
                // to is empty
                if (this.board.has(to)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: to});
                    return result;
                }
                // there are valid placements from here
                const g = this.clone();
                g.board.set(to, this.board.get(from)!);
                g.board.delete(from);
                if (! g.anyValidPlacement()) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.urbino.NOPLACEMENTS");
                    return result;
                }
                // If this is it, this is a valid partial
                if (place === undefined) {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.urbino.PARTIAL_PLACE_SIZE");
                    return result;
                }
            }
        }

        if ( place !== undefined ) {
            const pSize = parseInt(place[0], 10) as Size;
            const pCell = place.slice(1);
            if (pCell === "") {
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.urbino.PARTIAL_PLACE");
                return result;
            }
            const g = this.clone();
            if (moved) {
                g.board.set(to, this.board.get(from)!);
                g.board.delete(from);
            }
            const points = g.findPoints();
            // valid cell
            try {
                UrbinoGame.algebraic2coords(pCell);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: pCell});
                return result;
            }
            // This cell exists in the list of possible points
            if (! points.includes(pCell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.urbino.INVALID_PLACE_CELL", {where: pCell});
                return result;
            }
            // This piece can legally go here
            if (! g.validPlacement(pCell, pSize, this.currplayer)) {
                result.valid = false;
                switch (pSize) {
                    case 1:
                        result.message = i18next.t("apgames:validation.urbino.INVALID_PLACE_PIECE.house", {where: pCell});
                        break;
                    case 2:
                        result.message = i18next.t("apgames:validation.urbino.INVALID_PLACE_PIECE.tower", {where: pCell});
                        break;
                    case 3:
                        result.message = i18next.t("apgames:validation.urbino.INVALID_PLACE_PIECE.palace", {where: pCell});
                        break;
                }
                return result;
            }

            // we're good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        return result;
    }

    // The partial flag enabled dynamic connection checking.
    // It leaves the object in an invalid state, so only use it on cloned objects, or call `load()` before submitting again.
    public move(m: string, partial = false): UrbinoGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const result = this.validateMove(m);
        if (m[0] === ',')
            m = m.slice(1);
        if (! result.valid) {
            throw new UserFacingError("VALIDATION_GENERAL", result.message)
        }
        if ( (! partial) && (! this.moves().includes(m)) ) {
            throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
        } else if ( (partial) && (this.moves().filter(x => x.startsWith(m)).length < 1) ) {
            throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
        }
        this.results = [];

        // Look for movement first
        if (m.includes("-")) {
            const [from, to, place] = m.split(/[,-]/);
            const contents = this.board.get(from)!;
            this.board.delete(from);
            this.board.set(to, contents);
            this.results.push({type: "move", from, to});
            if ( (! partial) && (place === undefined) ) {
                throw new UserFacingError("MOVES_INVALID", i18next.t("apgames:MOVES_INVALID", {move: m}));
            }
            if (place !== undefined) {
                const piece = parseInt(place[0], 10) as Size;
                const cell = place.slice(1);
                this.board.set(cell, [this.currplayer, piece]);
                this.pieces[this.currplayer - 1][piece - 1]--;
                this.results.push({type: "place", what: piece.toString(), where: cell});
            }
        // Check for pass
        } else if (m === "pass") {
            this.results.push({type: "pass"});
        // Otherwise it should be just plain placement
        } else {
            if (this.board.size < 2) {
                this.board.set(m, [0, 0]);
                this.results.push({type: "place", what: "0", where: m});
            } else {
                const size = parseInt(m[0], 10) as Size;
                const cell = m.slice(1);
                this.board.set(cell, [this.currplayer, size]);
                this.pieces[this.currplayer - 1][size - 1]--;
                this.results.push({type: "place", what: size.toString(), where: cell});
            }
        }

        // Stop here if only requesting partial processing
        if (partial) { return this; }

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

    protected checkEOG(): UrbinoGame {
        // Two passes in a row ends the game
        if ( (this.lastmove === "pass") && (this.stack[this.stack.length - 1].lastmove === "pass")) {
            this.gameover = true;
            const score1 = this.getPlayerScore(1)!;
            const score2 = this.getPlayerScore(2)!;
            if (score1 > score2) {
                this.winner = [1]
            } else if (score1 < score2) {
                this.winner = [2];
            } else {
                const towers1 = [...this.board.entries()].filter(e => e[1][0] === 1 && e[1][1] === 3);
                const towers2 = [...this.board.entries()].filter(e => e[1][0] === 2 && e[1][1] === 3);
                if (towers1.length > towers2.length) {
                    this.winner = [1];
                } else if (towers1.length < towers2.length) {
                    this.winner = [2];
                } else {
                    const palaces1 = [...this.board.entries()].filter(e => e[1][0] === 1 && e[1][1] === 2);
                    const palaces2 = [...this.board.entries()].filter(e => e[1][0] === 2 && e[1][1] === 2);
                    if (palaces1.length > palaces2.length) {
                        this.winner = [1];
                    } else if (palaces1.length < palaces2.length) {
                        this.winner = [2];
                    } else {
                        const houses1 = [...this.board.entries()].filter(e => e[1][0] === 1 && e[1][1] === 1);
                        const houses2 = [...this.board.entries()].filter(e => e[1][0] === 2 && e[1][1] === 1);
                        if (houses1.length > houses2.length) {
                            this.winner = [1];
                        } else if (houses1.length < houses2.length) {
                            this.winner = [2];
                        } else {
                            this.winner = [1,2];
                        }
                    }
                }
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

    public getPlayerScore(player: playerid): number {
        let otherPlayer: playerid = 1;
        if (player === 1) {
            otherPlayer = 2;
        }
        let score = 0;
        const districts = this.getAllDistricts();
        for (const district of districts) {
            if (district.length > 2) {
                throw new Error("Invalid district found.");
            }
            // If the district doesn't contain two blocks, it doesn't count
            if (district.length < 2) {
                continue;
            }
            const myblock = district.find(d => d[0] === player)!;
            if (myblock === undefined) {
                throw new Error(`Error finding "myblock".`);
            }
            const theirblock = district.find(d => d[0] === otherPlayer)!;
            if (theirblock === undefined) {
                throw new Error(`Error finding "theirblock".`);
            }
            const myscore = this.scoreBlock(myblock[1]);
            const theirscore = this.scoreBlock(theirblock[1]);
            if (myscore > theirscore) {
                score += myscore
            } else if (myscore === theirscore) {
                const breaker = this.tiebreaker([myblock, theirblock]);
                if (breaker === player) {
                    score += score;
                }
            }
        }
        return score;
    }

    // Assumes you already checked for an actual tie
    // Simply tells you who placed the most valuable buildings, if anyone
    private tiebreaker(blocks: [[playerid, Set<string>], [playerid, Set<string>]]): playerid {
        const towers: [number, number] = [0, 0];
        const palaces: [number, number] = [0, 0];
        const houses: [number, number] = [0, 0];
        const monuments: [number, number] = [0, 0];
        for (const [owner, cells] of blocks) {
            towers[owner - 1] = [...this.board.entries()].filter(e => cells.has(e[0]) && e[1][1] === 3).length;
            palaces[owner - 1] = [...this.board.entries()].filter(e => cells.has(e[0]) && e[1][1] === 2).length;
            houses[owner - 1] = [...this.board.entries()].filter(e => cells.has(e[0]) && e[1][1] === 1).length;
            if (this.variants.includes("monuments")) {
                monuments[owner - 1] = this.largestMonument(cells);
            }
        }
        if (monuments[0] > monuments[1]) {
            return 1;
        } else if (monuments[0] < monuments[1]) {
            return 2;
        } else {
            if (towers[0] > towers[1]) {
                return 1;
            } else if (towers[0] < towers[1]) {
                return 2;
            } else {
                if (palaces[0] > palaces[1]) {
                    return 1;
                } else if (palaces[0] < palaces[1]) {
                    return 2;
                } else {
                    if (houses[0] > houses[1]) {
                        return 1;
                    } else if (houses[0] < houses[1]) {
                        return 2;
                    } else {
                        return 0;
                    }
                }
            }
        }
    }

    private scoreBlock(block: Set<string>): number {
        let score = 0;
        for (const cell of block) {
            score += this.board.get(cell)![1] as number;
        }
        if (this.variants.includes("monuments")) {
            score += this.largestMonument(block);
        }
        return score;
    }

    private largestMonument(block: Set<string>): number {
        let bonus = 0;
        // You only need to search East and North
        const grid = new RectGrid(9, 9);
        for (const cell of block) {
            const [x, y] = UrbinoGame.algebraic2coords(cell);
            for (const dir of ["N", "E"] as const) {
                const ray = grid.ray(x, y, dir).map(pt => UrbinoGame.coords2algebraic(...pt));
                if ( (ray.length >= 2) && (block.has(ray[0])) && (block.has(ray[1])) ) {
                    const str = `${this.board.get(cell)![1]}${this.board.get(ray[0])![1]}${this.board.get(ray[1])![1]}`;
                    if (allMonuments.has(str)) {
                        bonus = Math.max(bonus, allMonuments.get(str)!);
                    }
                }
            }
        }
        return bonus;
    }

    public findPoints(): string[] {
        const points: string[] = [];
        const grid = new RectGrid(9, 9);
        if (this.board.size >= 2) {
            const workers = [...this.board.entries()].filter(e => e[1][0] === 0).map(e => e[0]);
            const rays: [string[], string[]] = [[], []];
            if (workers.length === 2) {
                for (let i = 0; i < 2; i++) {
                    const worker = workers[i];
                    const [x, y] = UrbinoGame.algebraic2coords(worker);
                    for (const dir of allDirections) {
                        const ray = grid.ray(x, y, dir).map(pt => UrbinoGame.coords2algebraic(...pt));
                        for (const next of ray) {
                            if (! this.board.has(next)) {
                                rays[i].push(next);
                            } else {
                                break;
                            }
                        }
                    }
                }
                return rays[0].filter(cell => rays[1].includes(cell));
            }
        }
        return points;
    }

    public findPoints2(): string[] {
        const points: string[] = [];
        if (this.board.size >= 2) {
            for (let i = 0; i < 9; i++) {
                for (let j = 0; j < 9; j++) {
                    this.scratchboard[i][j] = 0;
                }
            }
            [...this.board.entries()].map(e => {let [x,y] = UrbinoGame.algebraic2coords(e[0]); this.scratchboard[x][y] = 1});
            const workers = [...this.board.entries()].filter(e => e[1][0] === 0).map(e => e[0]);
            const [x1, y1] = UrbinoGame.algebraic2coords(workers[0]);
            const [x2, y2] = UrbinoGame.algebraic2coords(workers[1]);
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    if (dx === 0 && dy === 0)
                        continue;
                    let x = x1 + dx;
                    let y = y1 + dy;
                    while (x >= 0 && x < 9 && y >= 0 && y < 9) {
                        if (this.scratchboard[x][y] === 1)
                            break;
                        this.scratchboard[x][y] = 2;
                        x += dx;
                        y += dy;
                    }
                }
            }
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    if (dx === 0 && dy === 0)
                        continue;
                    let x = x2 + dx;
                    let y = y2 + dy;
                    while (x >= 0 && x < 9 && y >= 0 && y < 9) {
                        if (this.scratchboard[x][y] === 1)
                            break;
                        if (this.scratchboard[x][y] === 2)
                            points.push(UrbinoGame.coords2algebraic(x, y));
                        x += dx;
                        y += dy;
                    }
                }
            }
        }
        return points;
    }

    public state(): IUrbinoState {
        return {
            game: UrbinoGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: UrbinoGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            pieces: deepclone(this.pieces) as [[number,number,number],[number,number,number]],
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < 9; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < 9; col++) {
                const cell = UrbinoGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell);
                    if (contents === undefined) {
                        throw new Error("Malformed cell contents.");
                    }
                    let colour = "X";
                    if (contents[0] === 1) {
                        colour = "R";
                    } else if (contents[0] === 2) {
                        colour = "B";
                    }
                    switch (contents[1]) {
                        case 0:
                            pieces.push(`${colour}`);
                            break;
                        case 1:
                            pieces.push(`${colour}1`);
                            break;
                        case 2:
                            pieces.push(`${colour}2`);
                            break;
                        case 3:
                            pieces.push(`${colour}3`);
                            break;
                    }
                } else {
                    pieces.push("");
                }
            }
            pstr += pieces.join(",");
        }
        pstr = pstr.replace(/\n,{8}(?=\n)/g, "\n_");

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-checkered",
                width: 9,
                height: 9,
            },
            legend: {
                R1: {
                    name: "house",
                    player: 1
                },
                R2: {
                    name: "palace",
                    player: 1
                },
                R3: {
                    name: "tower",
                    player: 1
                },
                B1: {
                    name: "house",
                    player: 2
                },
                B2: {
                    name: "palace",
                    player: 2
                },
                B3: {
                    name: "tower",
                    player: 2
                },
                X: {
                    name: "chess-queen-outline-montreal",
                    player: 3
                },
            },
            pieces: pstr
        };
        const cells = this.findPoints().map(p => UrbinoGame.algebraic2coords(p));
        if (cells.length > 0) {
            const points: IPointEntry[] = [];
            for (const cell of cells) {
                points.push({row: cell[1], col: cell[0]});
            }
            // @ts-ignore
            rep.board.markers = [{type: "dots", points}];
        }

        // Add annotations
        // if (this.stack[this.stack.length - 1]._results.length > 0) {
        if (this.results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            // for (const move of this.stack[this.stack.length - 1]._results) {
            for (const move of this.results) {
                if (move.type === "move") {
                    const [fromX, fromY] = UrbinoGame.algebraic2coords(move.from);
                    const [toX, toY] = UrbinoGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", player: 3, targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "place") {
                    const [x, y] = UrbinoGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
            if (rep.annotations.length === 0) {
                delete rep.annotations;
            }
        }

        return rep;
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Stashes**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const stash = this.getPlayerStash(n);
            if (stash === undefined) {
                throw new Error("Malformed stash.");
            }
            status += `Player ${n}: ${stash[0].count} houses, ${stash[1].count} palaces, ${stash[2].count} towers\n\n`;
        }

        status += "**Scores**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            status += `Player ${n}: ${this.getPlayerScore(n as playerid)}\n\n`;
        }

        return status;
    }

    public getPlayersScores(): IScores[] {
        return [{ name: i18next.t("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] }]
    }

    protected getMoveList(): any[] {
        return this.getMovesAndResults(["move", "capture"]);
    }

    public chat(node: string[], name: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                switch (r.what) {
                    case "0":
                        node.push(i18next.t("apresults:PLACE.urbino.worker", {player: name, where: r.where}));
                        break;
                    case "1":
                        node.push(i18next.t("apresults:PLACE.urbino.house", {player: name, where: r.where}));
                        break;
                    case "2":
                        node.push(i18next.t("apresults:PLACE.urbino.palace", {player: name, where: r.where}));
                        break;
                    case "3":
                        node.push(i18next.t("apresults:PLACE.urbino.tower", {player: name, where: r.where}));
                        break;
                }
                resolved = true;
                break;
        }
        return resolved;
    }

    public getPlayerStash(player: number): IStashEntry[] | undefined {
        const stash = this.pieces[player - 1];
        if (stash !== undefined) {
            return [
                {count: stash[0], glyph: { name: "house",  player }, movePart: ",1"},
                {count: stash[1], glyph: { name: "palace", player }, movePart: ",2"},
                {count: stash[2], glyph: { name: "tower",  player }, movePart: ",3"}
            ];
        }
        return;
    }

    public clone(): UrbinoGame {
        return new UrbinoGame(this.serialize());
    }
}
