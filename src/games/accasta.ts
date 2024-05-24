/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { HexTriGraph } from "../common/graphs";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

export type playerid = 1|2;
export type Piece = "C"|"H"|"S";
export type CellContents = [Piece, playerid]

const distances: Map<string, number> = new Map([["S", 1], ["H", 2], ["C", 3]]);
const castles = [["a1", "a2", "a3", "a4", "b2", "b3", "b4", "c3", "c4"], ["g1", "g2", "g3", "g4", "f2", "f3", "f4", "e3", "e4"]];

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents[]>;
    lastmove?: string;
};

export interface IAccastaState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class AccastaGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Accasta",
        uid: "accasta",
        playercounts: [2],
        version: "20211116",
        dateAdded: "2023-05-01",
        // i18next.t("apgames:descriptions.accasta")
        description: "apgames:descriptions.accasta",
        urls: ["https://spielstein.com/games/accasta"],
        people: [
            {
                type: "designer",
                name: "Dieter Stein",
                urls: ["https://spielstein.com/"]
            }
        ],
        variants: [
            {
                uid: "pari",
            },
        ],
        categories: ["goal>breakthrough", "mechanic>move", "mechanic>stack", "mechanic>coopt", "board>shape>hex", "board>connect>hex", "components>simple>1per", "components>special"],
        flags: ["multistep", "perspective"]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, CellContents[]>;
    public graph: HexTriGraph = new HexTriGraph(4, 7);
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IAccastaState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            const fresh: IMoveState = {
                _version: AccastaGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map([
                    ["a1", [["S", 1], ["H", 1], ["C", 1]]],
                    ["a2", [["S", 1], ["H", 1], ["C", 1]]],
                    ["a3", [["S", 1], ["H", 1], ["C", 1]]],
                    ["a4", [["S", 1], ["H", 1], ["C", 1]]],
                    ["b2", [["S", 1], ["H", 1]]],
                    ["b3", [["S", 1], ["H", 1]]],
                    ["b4", [["S", 1], ["H", 1]]],
                    ["c3", [["S", 1]]], ["c4", [["S", 1]]],

                    ["g1", [["S", 2], ["H", 2], ["C", 2]]],
                    ["g2", [["S", 2], ["H", 2], ["C", 2]]],
                    ["g3", [["S", 2], ["H", 2], ["C", 2]]],
                    ["g4", [["S", 2], ["H", 2], ["C", 2]]],
                    ["f2", [["S", 2], ["H", 2]]],
                    ["f3", [["S", 2], ["H", 2]]],
                    ["f4", [["S", 2], ["H", 2]]],
                    ["e3", [["S", 2]]], ["e4", [["S", 2]]],
                ]),
            };
            if ( (variants !== undefined) && (variants.length === 1) && (variants[0] === "pari") ) {
                this.variants = ["pari"];
                fresh.board = new Map([
                    ["a1", [["S", 1], ["S", 1], ["S", 1]]],
                    ["a2", [["S", 1], ["S", 1], ["S", 1]]],
                    ["a3", [["S", 1], ["S", 1], ["S", 1]]],
                    ["a4", [["S", 1], ["S", 1], ["S", 1]]],
                    ["b2", [["S", 1], ["S", 1]]],
                    ["b3", [["S", 1], ["S", 1]]],
                    ["b4", [["S", 1], ["S", 1]]],
                    ["c3", [["S", 1]]], ["c4", [["S", 1]]],

                    ["g1", [["S", 2], ["S", 2], ["S", 2]]],
                    ["g2", [["S", 2], ["S", 2], ["S", 2]]],
                    ["g3", [["S", 2], ["S", 2], ["S", 2]]],
                    ["g4", [["S", 2], ["S", 2], ["S", 2]]],
                    ["f2", [["S", 2], ["S", 2]]],
                    ["f3", [["S", 2], ["S", 2]]],
                    ["f4", [["S", 2], ["S", 2]]],
                    ["e3", [["S", 2]]], ["e4", [["S", 2]]],
                ]);
            }
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IAccastaState;
            }
            if (state.game !== AccastaGame.gameinfo.uid) {
                throw new Error(`The Accasta engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): AccastaGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = deepclone(state.board) as Map<string, CellContents[]>;
        this.lastmove = state.lastmove;
        this.results = [...state._results];
        return this;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];

        const playerPieces = [...this.board.entries()].filter(e => e[1][e[1].length - 1][1] === player);
        for (const [cell,] of playerPieces) {
            const movelsts = this.recurseMoves(deepclone(this.board) as Map<string, CellContents[]>, this.graph, player, cell, this.variants.includes("pari"));
            for (const move of movelsts) {
                moves.push(`${cell}:${move.join(",")}`)
            }
        }

        return moves;
    }

    private recurseMoves(board: Map<string, CellContents[]>, graph: HexTriGraph, player: playerid, cell: string, pari = false): string[][] {
        const moves: string[][] = [];
        // If the stack is now empty, we're done
        if (board.has(cell)) {
            const stack = board.get(cell)!;
            const [x, y] = graph.algebraic2coords(cell);
            // You can only move stacks you control
            const top = stack[stack.length - 1];
            if (top[1] === player) {
                let maxDistance = distances.get(top[0])!;
                if (pari) {
                    maxDistance = stack.filter(p => p[1] === player).length;
                }
                for (let len = 1; len <= stack.length; len++) {
                    const substack = stack.slice(stack.length - len);
                    for (const dir of ["NE", "E", "SE", "SW", "W", "NW"] as const) {
                        let ray = graph.ray(x, y, dir);
                        if (ray.length > maxDistance) {
                            ray = ray.slice(0, maxDistance);
                        }
                        for (const [xNext, yNext] of ray) {
                            const next = graph.coords2algebraic(xNext, yNext);
                            let step: string | undefined;
                            // If it's empty, movement is allowed
                            if (! board.has(next)) {
                                if (len === stack.length) {
                                    step = `-${next}`;
                                } else {
                                    step = `${len}-${next}`;
                                }
                            // Otherwise we have to validate that the stacking move is legal
                            } else {
                                const contents = board.get(next)!;
                                if (substack.length + contents.length <= 6) {
                                    const mylen = [...contents, ...substack].filter(p => p[1] === player).length;
                                    const theirlen = substack.length + contents.length - mylen;
                                    if ( (mylen <= 3) && (theirlen <= 3) ) {
                                        if (len === stack.length) {
                                            step = `+${next}`;
                                        } else {
                                            step = `${len}+${next}`;
                                        }
                                    }
                                }
                            }
                            // If we found a valid move, we need to recurse
                            if (step !== undefined) {
                                // Make the move on a cloned board, which you will pass when recursing
                                const newboard = deepclone(board) as Map<string, CellContents[]>;
                                const remaining = stack.slice(0, stack.length - substack.length);
                                if (remaining.length > 0) {
                                    newboard.set(cell, [...remaining])
                                } else {
                                    newboard.delete(cell);
                                }
                                if (newboard.has(next)) {
                                    const contents = newboard.get(next)!;
                                    newboard.set(next, [...contents, ...substack]);
                                } else {
                                    newboard.set(next, [...substack]);
                                }
                                moves.push([step]);
                                const followups = this.recurseMoves(newboard, graph, player, cell, pari);
                                for (const fu of followups) {
                                    moves.push([step, ...fu]);
                                }
                            }
                            // If we didn't find a valid move, or we just moved on top of another stack, stop searching in this direction
                            if ( (step === undefined) || (step.includes("+")) ) {
                                break;
                            }
                        }
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

    public handleClick(move: string, row: number, col: number, piece: string): IClickResult {
        try {
            const cell = this.graph.coords2algebraic(col, row);
            const index = parseInt(piece, 10);
            if ( (isNaN(index)) && (this.board.has(cell)) ) {
                throw new Error("Invalid index passed");
            }
            let newmove = "";
            if (move.length === 0) {
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    if (index === 0) {
                        newmove = `${cell}:`
                    } else {
                        const numpieces = contents.length - index;
                        newmove = `${cell}:${numpieces}`
                    }
                } else {
                    return {move: "", message: ""} as IClickResult;
                }
            } else {
                const [source, moves] = move.split(":");
                const steps = moves.split(",");
                const last = steps[steps.length - 1];
                const lastComplete = ( (last !== undefined) && (/^\d?[-\+]/.test(last)) );
                if (lastComplete) {
                    // If they're clicking on the source cell, assume they are selecting a new index
                    if (cell === source) {
                        // If the last move used up all the pieces, then this is an error; just return the move
                        if (/^[-\+]/.test(last)) {
                            newmove = move;
                        } else {
                            // If selecting the rest of the stack, things are simple
                            if (index === 0) {
                                newmove = `${move},`;
                            } else {
                                // first calculate how many pieces have already been accounted for (no validation, just counting)
                                let prevcount = 0;
                                for (const step of steps) {
                                    const match = step.match(/^(\d+)/);
                                    if (match !== null) {
                                        prevcount += parseInt(match[1], 10);
                                    }
                                }
                                const contents = this.board.get(cell)!;
                                const numpieces = contents.length - index - prevcount;
                                newmove = `${move},${numpieces}`;
                            }
                        }
                    // If they are clicking on a different cell, start the move over again
                    } else {
                        // Set a new source
                        if (this.board.has(cell)) {
                            const contents = this.board.get(cell)!;
                            if (index === 0) {
                                newmove = `${cell}:`
                            } else {
                                const numpieces = contents.length - index;
                                newmove = `${cell}:${numpieces}`
                            }
                        // Or something weird; just preserve the move
                        } else {
                            newmove = move;
                        }
                    }
                // The previous step is incomplete
                } else {
                    const newsteps = steps.slice(0, steps.length - 1);
                    // If you click on the source, assume something was wrong with the previous step and discard it
                    if (cell === source) {
                        // If selecting the rest of the stack, things are simple
                        if (index === 0) {
                            if (newsteps.length === 0) {
                                newmove = `${source}:`;
                            } else {
                                newmove = `${source}:${newsteps.join(",")},`;
                            }
                        } else {
                            // first calculate how many pieces have already been accounted for (no validation, just counting)
                            let prevcount = 0;
                            for (const step of newsteps) {
                                const match = step.match(/^(\d+)/);
                                if (match !== null) {
                                    prevcount += parseInt(match[1], 10);
                                }
                            }
                            const contents = this.board.get(cell)!;
                            const numpieces = contents.length - index - prevcount;
                            if (newsteps.length === 0) {
                                newmove = `${source}:${numpieces}`
                            } else {
                                newmove = `${source}:${newsteps.join(",")},${numpieces}`
                            }
                        }
                    // otherwise, assume you're trying to move there
                    } else {
                        if (this.board.has(cell) || newsteps.some(step => step.match(/[-\+]([a-g]\d+)/)![1] === cell)) {
                            newmove = `${move}+${cell}`;
                        } else {
                            newmove = `${move}-${cell}`;
                        }
                    }
                }
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

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        const allcells = this.graph.listCells() as string[];

        if (m === "") {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.accasta.INITIAL_INSTRUCTIONS")
            return result;
        }

        const [source, moves] = m.split(":");

        // source exists
        if (! allcells.includes(source)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: source});
            return result
        }
        // source has pieces
        if (! this.board.has(source)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: source});
            return result
        }
        // source is controlled by player
        const sourceContents = this.board.get(source)!;
        if (sourceContents[sourceContents.length - 1][1] !== this.currplayer) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
            return result
        }

        // If there are no moves, then assume they are moving the entire stack
        if (moves === undefined) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.accasta.PARTIAL_FULLSTACK");
            return result;
        }

        let steps = moves.split(",");
        const last = steps[steps.length - 1];
        const lastComplete = ( (last !== undefined) && (/^\d?[-\+]/.test(last)) );

        // If the last move is incomplete, process the rest of the moves first
        if (! lastComplete) {
            steps = steps.slice(0, steps.length - 1);
        }

        // Validate each step along the way
        let stack: CellContents[] = deepclone(sourceContents) as CellContents[];
        const cloned = this.clone();
        for (const step of steps) {
            const [num, destination] = step.split(/[-\+]/);
            let subsize: number;
            if (num === undefined) {
                subsize = stack.length;
            } else {
                subsize = parseInt(num, 10);
                if (subsize === stack.length) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.accasta.INVALID_SIZE", {move: m, step});
                    return result;
                }
            }

            if ( (destination === undefined) || (! allcells.includes(destination)) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: destination});
                return result
            }

            // does the stack even have pieces at the moment
            if (stack.length === 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.accasta.SOURCE_EMPTY", {move: m, source, step});
                return result;
            }

            // do you control the top piece of the stack at this moment?
            if (stack[stack.length - 1][1] !== this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                return result;
            }
            let maxDistance = distances.get(stack[stack.length - 1][0])!
            if (cloned.variants.includes("pari")) {
                maxDistance = stack.filter(p => p[1] === this.currplayer).length;
            }
            // unobstructed line of sight
            let seen = false;
            let ray: string[] = [];
            // indiscriminate ray casting because I'm exhausted and don't want to write a `bearing` function for HexTris
            for (const dir of ["NE", "E", "SE", "SW", "W", "NW"] as const) {
                ray = cloned.graph.ray(...this.graph.algebraic2coords(source), dir).map(pt => cloned.graph.coords2algebraic(...pt));
                if (ray.includes(destination)) {
                    seen = true;
                    break;
                }
            }
            if (! seen) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NOLOS", {from: source, to: destination});
                return result;
            }
            const idx = ray.findIndex(s => s === destination);
            ray = ray.slice(0, idx + 1);
            for (const cell of ray) {
                if ( (cloned.board.has(cell)) && (cell !== destination) ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.OBSTRUCTED", {from: source, to: destination, obstruction: cell});
                    return result;
                }
            }
            if (ray.length > maxDistance) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.accasta.TOOFAR", {move: m, step});
                return result;
            }

            // Update the cloned game state for the next step
            const substack = [...stack.slice(stack.length - subsize)];
            if (cloned.board.has(destination)) {
                const toContents = cloned.board.get(destination)!;
                // Use '+' if moving onto an existing stack
                if (toContents.length && step.includes('-')) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.accasta.USEPLUS", {step});
                    return result;
                }
                // Use '-' if moving to an empty cell
                if (toContents.length === 0 && step.includes('+')) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.accasta.USEMINUS", {step});
                    return result;
                }
                if (toContents.length + subsize > 6) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.accasta.TOOHIGH", {move: m, step});
                    return result;
                } else {
                    const mylen = [...toContents, ...substack].filter(p => p[1] === this.currplayer).length;
                    const theirlen = substack.length + toContents.length - mylen;
                    if ( (mylen > 3) || (theirlen > 3) ) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.accasta.MORE_THAN_THREE", {move: m, step});
                        return result;
                    }
                }
                cloned.board.set(destination, [...toContents, ...substack]);
            } else {
                cloned.board.set(destination, [...substack]);
            }
            stack = [...stack.slice(0, stack.length - subsize)];
            if (stack.length === 0) {
                cloned.board.delete(source);
            } else {
                cloned.board.set(source, [...stack])
            }
        }

        // If the last move isn't complete, then process it now
        if (! lastComplete) {
            if ( (last === undefined) || (last === "") ) {
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.accasta.PARTIAL_FULLSTACK");
                return result;
            } else {
                const numpieces = parseInt(last, 10);
                if ( (isNaN(numpieces)) || (numpieces === stack.length) ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.accasta.INVALID_SIZE", {move: m, step: last});
                    return result;
                }
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.accasta.PARTIAL_SUBSTACK", {count: numpieces});
                return result;
            }
        // Otherwise, we have a valid move at this point
        } else {
            result.valid = true;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            // If the stack is empty, or if we don't own the top piece, then we're truly done
            if ( (stack.length === 0) || (stack[stack.length - 1][1] !== cloned.currplayer) ) {
                result.complete = 1;
            // otherwise more moves are possible
            } else {
                result.complete = 0;
                result.canrender = true;
            }
        }

        return result;
    }

    public move(m: string, {partial = false, trusted = false} = {}): AccastaGame {
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
            if (partial) {
                if ( (result.complete === undefined) || (result.complete < 0) || ( (result.canrender !== undefined) && (result.canrender === false) ) ) {
                    throw new Error(`The move '${m}' is not a valid partial.`)
                }
            }
        }

        this.results = [];


        const [cell, moves] = m.split(":");
        const steps = moves.split(",");
        for (const step of steps) {
            const fromStack = this.board.get(cell)!;
            const rStep = /^(\d*)[-+]([a-z]\d+)$/;
            const match = step.match(rStep);
            if (match === null) {
                throw new Error("Invalid move format");
            }
            let substack = [...fromStack];
            if (match[1] !== "") {
                const len = parseInt(match[1], 10);
                substack = fromStack.slice(substack.length - len);
            }
            const remaining = [...fromStack].slice(0, fromStack.length - substack.length)
            const destination = match[2];
            const toStack = this.board.get(destination);
            if (toStack === undefined) {
                this.board.set(destination, [...substack]);
            } else {
                this.board.set(destination, [...toStack, ...substack]);
            }
            if (remaining.length > 0) {
                this.board.set(cell, [...remaining]);
            } else {
                this.board.delete(cell);
            }
            this.results.push({type: "move", from: cell, to: destination});
        }

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

    protected checkEOG(): AccastaGame {
        let prevPlayer = 1;
        if (this.currplayer === 1) {
            prevPlayer = 2;
        }
        if (this.moves().length === 0) {
            this.gameover = true;
            this.winner = [prevPlayer as playerid];
        } else {
            let count = 0;
            for (const cell of castles[prevPlayer - 1]) {
                const contents = this.board.get(cell);
                if ( (contents !== undefined) && (contents[contents.length - 1][1] === this.currplayer) ) {
                    count++;
                }
            }
            if (count >= 3) {
                this.gameover = true;
                this.winner = [this.currplayer];
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

    public state(): IAccastaState {
        return {
            game: AccastaGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: AccastaGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: deepclone(this.board) as Map<string, CellContents[]>,
        };
    }

    public render(): APRenderRep {
        // Build piece string
        const pstr: string[][][] = [];
        const cells = this.graph.listCells(true) as string[][];
        for (const row of cells) {
            const pieces: string[][] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const str = this.board.get(cell)!.map(e => e.join(""));
                    pieces.push([...str]);
                } else {
                    pieces.push([]);
                }
            }
            pstr.push(pieces);
        }

        // Build rep
        // let offset = 0.13;
        // if (this.variants.length === 0) {
        //     offset = 0.2;
        // }
        const rep: APRenderRep =  {
            renderer: "stacking-offset",
            board: {
                style: "hex-of-tri",
                minWidth: 4,
                maxWidth: 7,
                stackOffset: 0.2,
                markers: [
                    {
                        type: "shading",
                        points: [
                            {row: 0, col: 0},
                            {row: 0, col: 3},
                            {row: 2, col: 3},
                            {row: 2, col: 2},
                        ],
                        colour: 2
                    },
                    {
                        type: "shading",
                        points: [
                            {row: 6, col: 0},
                            {row: 6, col: 3},
                            {row: 4, col: 3},
                            {row: 4, col: 2},
                        ],
                        colour: 1
                    }
                ]
            },
            legend: {
                S1: {
                    name: "piece",
                    player: 1
                },
                S2: {
                    name: "piece",
                    player: 2
                },
                H1: {
                    name: "piece-horse",
                    player: 1
                },
                H2: {
                    name: "piece-horse",
                    player: 2
                },
                C1: {
                    name: "piece-chariot",
                    player: 1
                },
                C2: {
                    name: "piece-chariot",
                    player: 2
                },
            },
            // @ts-ignore
            pieces: pstr
        };
        if (this.variants.includes("pari")) {
            delete rep.legend!.H1;
            delete rep.legend!.H2;
            delete rep.legend!.C1;
            delete rep.legend!.C2;
        }

        // Add annotations
        // if (this.stack[this.stack.length - 1]._results.length > 0) {
        if (this.results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            // for (const move of this.stack[this.stack.length - 1]._results) {
            for (const move of this.results) {
                if (move.type === "move") {
                    const [fromX, fromY] = this.graph.algebraic2coords(move.from);
                    const [toX, toY] = this.graph.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                }
            }
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

    public clone(): AccastaGame {
        return new AccastaGame(this.serialize());
    }
}
