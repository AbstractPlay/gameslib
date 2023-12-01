/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable jsdoc/check-indentation */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { BaoGraph, reviver, UserFacingError } from "../common";
import i18next from "i18next";
import type { PitType } from "../common/graphs/bao";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-var-requires
const deepclone = require("rfdc/default");

export type playerid = 1|2;


export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    lastmove?: string;
    board: number[][];
    houses: [string|undefined, string|undefined];
    inhand: [number,number];
    blocked: [string|undefined, string|undefined];
};

export interface IBaoState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

type SowingResults = {
    complete: boolean;
    captured: {
        cells: string[];
        stones: number;
    };
    sown: string[];
    infinite: boolean;
};

export class BaoGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Bao",
        uid: "bao",
        playercounts: [2],
        version: "20231126",
        // i18next.t("apgames:descriptions.bao")
        description: "apgames:descriptions.bao",
        urls: ["https://en.wikipedia.org/wiki/Bao_(game)"],
        flags: ["experimental", "perspective", "limited-pieces", "automove"],
        variants: [
            {
                uid: "malawi",
                group: "setup",
            },
            {
                uid: "kujifunza",
                group: "setup",
            }
        ],
        displays: [{uid: "pips"}]
    };

    public static opposites = new Map<string, string>([
        ["a2", "a3"], ["a3", "a2"],
        ["b2", "b3"], ["b3", "b2"],
        ["c2", "c3"], ["c3", "c2"],
        ["d2", "d3"], ["d3", "d2"],
        ["e2", "e3"], ["e3", "e2"],
        ["f2", "f3"], ["f3", "f2"],
        ["g2", "g3"], ["g3", "g2"],
        ["h2", "h3"], ["h3", "h2"],
    ]);

    public static clone(obj: BaoGame): BaoGame {
        const cloned: BaoGame = Object.assign(new BaoGame(), deepclone(obj) as BaoGame);
        cloned.graph = new BaoGraph(cloned.houses);
        return cloned;
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: number[][];
    public houses!: [string|undefined,string|undefined];
    public blocked!: [string|undefined,string|undefined];
    public inhand!: [number,number];
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private graph!: BaoGraph;
    private instalose = false;

    constructor(state?: IBaoState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            let board = [
                [0,0,0,0,0,0,0,0],
                [0,2,2,6,0,0,0,0],
                [0,0,0,0,6,2,2,0],
                [0,0,0,0,0,0,0,0],
            ];
            let inhand = [22, 22] as [number,number];
            if (variants !== undefined) {
                if (variants.includes("malawi")) {
                    board = [
                        [0,0,0,0,0,0,0,0],
                        [0,2,2,8,0,0,0,0],
                        [0,0,0,0,8,2,2,0],
                        [0,0,0,0,0,0,0,0],
                    ];
                    inhand = [20, 20];
                } else if (variants.includes("kujifunza")) {
                    board = [
                        [2,2,2,2,2,2,2,2],
                        [2,2,2,2,2,2,2,2],
                        [2,2,2,2,2,2,2,2],
                        [2,2,2,2,2,2,2,2],
                    ];
                    inhand = [0, 0];
                }
            }
            const fresh: IMoveState = {
                _version: BaoGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                inhand,
                houses: ["e2", "d3"],
                blocked: [undefined, undefined],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IBaoState;
            }
            if (state.game !== BaoGame.gameinfo.uid) {
                throw new Error(`The Bao engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): BaoGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = [...state.board.map(r => [...r])];
        this.inhand = [...state.inhand];
        this.houses = [...state.houses];
        this.blocked = [...state.blocked];
        this.lastmove = state.lastmove;
        this.graph = new BaoGraph(this.houses);
        return this;
    }

    public hasWorkingHouse (player?: playerid): boolean {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.houses[player - 1] === undefined) {
            return false;
        }
        const [col, row] = this.graph.algebraic2coords(this.houses[player - 1]!);
        if (this.board[row][col] >= 6) {
            return true;
        }
        return false;
    }

    /**
     * Checks to see if a given player is in kutakatia.
     * The algorithm involves generating a list of moves for the *opposing* player,
     * executing those moves, and seeing if there is only one cell capturable.
     */
    public getBlocked(player?: playerid): string|undefined {
        if (player === undefined) {
            player = this.currplayer;
        }
        let opponent: playerid = 2;
        if (player === 2) {
            opponent = 1;
        }

        // must be in mtaji phase
        if (this.inhand.reduce((prev, curr) => prev + curr, 0) === 0) {
            // last move has to have been kutakata
            if (this.lastmove?.endsWith("*")) {
                // get moves for opponent
                const moves = this.moves(opponent, true)
                // only proceed if the moves are capture moves
                if ( (moves.length > 0) && (! moves[0].endsWith("*")) ) {
                    // execute each move and get the results
                    const results: SowingResults[] = [];
                    for (const move of moves) {
                        const cloned = BaoGame.clone(this);
                        results.push(cloned.processMove(move));
                    }
                    // Build a set out of the first captured pit of each result
                    const firsts = new Set<string>(results.map(r => r.captured.cells[0]));
                    // if all the first captures are the same, that pit is blocked
                    if (firsts.size === 1) {
                        return [...firsts.values()][0];
                    }
                }
            }
        }

        return;
    }

    /**
     * This function doesn't do any validation, but it is aware of the basic sowing rules.
     * All it does is execute a givem move exactly as provided and return the results.
     * It is used by the `move()` function to execute a valid move, by `getBlocked()` to check
     * for kutakatia, and `moves()` for move generation.
     *
     * It really needs to be efficient and fast!
     */
    public processMove(move: string): SowingResults {
        // init return variables
        const capturedCells: string[] = [];
        let capturedStones = 0;
        const sownCells: string[] = [];
        let distance = 0;
        let complete = true;
        let infinite = false;

        // init what we need to know about the game state
        const cell = move.substring(0, 2);
        const [startCol, startRow] = this.graph.algebraic2coords(cell);
        const marker = move[2];
        const isKutakata = move.endsWith("*") || this.board[startRow][startCol] >= 16;
        let player: playerid;
        if (startRow <= 1) {
            player = 2;
        } else {
            player = 1;
        }
        const phase: "namua"|"mtaji" = this.inhand[player - 1] > 0 ? "namua" : "mtaji";
        let dir: "CW"|"CCW";
        switch (startRow) {
            // outer rows
            case 0:
            case 3:
                dir = marker === "<" ? "CW" : "CCW";
                break;
            // inner rows
            case 1:
            case 2:
                dir = marker === "<" ? "CCW" : "CW";
                break;
            default:
                throw new Error(`Invalid startRow specified: ${startRow}`);
        }
        // in namua stage, on a mtaji turn, the marker indicates the kichwa, not the direction
        // so flip it
        if ( (phase === "namua") && (! isKutakata) ) {
            dir = dir === "CW" ? "CCW" : "CW";
        }

        // now let's try to execute the move
        // if in namua phase, add the stone
        if (phase === "namua") {
            this.board[startRow][startCol]++;
        }
        let curr = cell;
        let inhand = 0;
        // NOTE: Possible infinite loop
        while (true) {
            // distribute any seeds in hand
            distance += inhand;
            const toSow = this.graph.sow(curr, dir, inhand);
            for (const pit of toSow) {
                const [x, y] = this.graph.algebraic2coords(pit);
                this.board[y][x]++;
                curr = pit;
            }
            // `curr` is the last pit you placed a stone in
            const [currCol, currRow] = this.graph.algebraic2coords(curr);

            // check for capture
            const opposite = BaoGame.opposites.get(curr);
            if (opposite !== undefined) {
                const [oppCol, oppRow] = this.graph.algebraic2coords(opposite);
                if ( (! isKutakata) && (this.board[currRow][currCol] > 1) && (this.board[oppRow][oppCol] > 0)) {
                    inhand = this.board[oppRow][oppCol];
                    this.board[oppRow][oppCol] = 0;
                    capturedCells.push(opposite);
                    capturedStones += inhand;

                    // now determine new starting point and direction
                    let enterPit: string|undefined;
                    let enterDir = dir;
                    const currType = this.graph.getType(curr);
                    if (currType === undefined) {
                        throw new Error(`Could not determine pit type for ${curr}`);
                    }
                    // if capture occured in kimbi or kichwa, predetermined
                    if (currType.startsWith("ki")) {
                        const enterType: PitType = `kichwa${player}${currType[currType.length - 1]}` as PitType;
                        enterPit = this.graph.findType(enterType);
                        if (enterPit === undefined) {
                            throw new Error(`Could not find a pit of type ${enterType}`);
                        }
                        enterDir = currType[currType.length - 1] === "L" ? "CW" : "CCW";
                    }
                    // otherwise, continue in current direction
                    else {
                        const enterType: PitType = `kichwa${player}${dir === "CW" ? "L" : "R"}` as PitType;
                        enterPit = this.graph.findType(enterType);
                        if (enterPit === undefined) {
                            throw new Error(`Could not find a pit of type ${enterType}`);
                        }
                    }
                    // with captures, we don't want to skip the kichwa
                    // so move curr *back* one space
                    curr = this.graph.sow(enterPit, enterDir, -1)[0];
                    dir = enterDir;
                    // restart loop
                    continue;
                }
            }

            // no capture happened, so relay sow

            // if there's only one seed in the pit, then our turn is over
            if (this.board[currRow][currCol] === 1) {
                break;
            }
            // if functional nyumba
            if ( (this.graph.getType(curr) === "nyumba") && (this.board[currRow][currCol] >= 6) ) {
                // if we're in a mtaji move, check for "+" and stop here but mark move incomplete
                if ( (! isKutakata) && (! move.endsWith("+")) ) {
                    complete = false;
                    break;
                }
                // otherwise, in kutakata and relay sowing, just stop
                else if ( (isKutakata) && (distance > 0) ) {
                    break;
                }
            }
            // if we're in a kutakata move and we've reached a blocked pit, we have to stop
            if (isKutakata) {
                const blocked = this.getBlocked(player);
                if ( (blocked !== undefined) && (blocked === curr) ) {
                    break;
                }
            }

            // at this point, we must continue sowing
            sownCells.push(curr);
            // in namua phase, kutakata, very first turn, only tax nyumba
            if ( (phase === "namua") && (isKutakata) && (distance === 0) && (this.graph.getType(curr) === "nyumba") && (this.board[currRow][currCol] >= 6) ) {
                inhand = 2;
                this.board[currRow][currCol] -= 2;
            }
            // otherwise pick them all up
            else {
                inhand = this.board[currRow][currCol];
                this.board[currRow][currCol] = 0;
            }

            // FAILSAFE
            // infinite (or just very long) loops are very rare but possible
            // if a move travels the distance of more than 12 times around the board, abort
            if (distance > 16 * 12) {
                infinite = true;
                break;
            }
        }

        return {
            complete,
            captured: {
                cells: capturedCells,
                stones: capturedStones,
            },
            sown: sownCells,
            infinite,
        }
    }

    public moves(player?: playerid, ignoreBlocked = false): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        let myFront = 2; let myBack = 3; let theirFront = 1;
        if (player === 2) {
            myFront = 1;
            myBack = 0;
            theirFront = 2;
        }

        /**
         * Decision tree:
         *   Namua
         *     - Any pits with seeds with opposing seeds? --> Mtaji
         *     - If house and pits with seeds that are not house --> Kutakata
         *     - If any pits with 2+ seeds --> Kutakata
         *     - If any pits with any seeds --> Kutakata
         *   Mtaji
         *     - Any pits with opposing seeds that can be reached by sowing (<16 seeds)? --> Mtaji
         *     - Any unblocked inner pits with 2+ seeds ? --> Kutakata
         *     - Any outer pit with 2+ seeds? --> Kutakata
         */

        let caps: string[] = [];
        const noncaps: string[] = [];
        // namua
        if (this.inhand[player - 1] > 0) {
            // find all holes in your front row that have pieces in them
            const cols: number[] = [];
            for (let i = 0; i < 8; i++) {
                if (this.board[myFront][i] > 0) {
                    cols.push(i);
                }
            }
            // look for capture moves first
            for (const col of cols) {
                const cell = this.graph.coords2algebraic(col, myFront);
                const type = this.graph.getType(cell)!;
                // this is a capturing move
                if (this.board[theirFront][col] > 0) {
                    // if it's a kichwa or kimbi, then direction is predetermined
                    if (type.startsWith("ki")) {
                        if (type.endsWith("L")) {
                            caps.push(`${cell}<`);
                        } else {
                            caps.push(`${cell}>`);
                        }
                    }
                    // otherwise both are possible
                    else {
                        caps.push(`${cell}<`);
                        caps.push(`${cell}>`);
                    }
                }
            }
            // for each capture move, check to see if it includes "playing the house"
            for (const m of [...caps]) {
                const cloned = BaoGame.clone(this);
                const result = cloned.processMove(m);
                if (! result.complete) {
                    caps.push(`${m}+`);
                }
            }
            // only look for non-capturing moves if no captures were found
            if (caps.length === 0) {
                // with working house, can play any pit that's not the house
                if (this.hasWorkingHouse(player)) {
                    for (const col of cols) {
                        const cell = this.graph.coords2algebraic(col, myFront);
                        const type = this.graph.getType(cell)!;
                        if (type !== "nyumba") {
                            noncaps.push(`${cell}<*`);
                            noncaps.push(`${cell}>*`);
                        }
                    }
                }
                // without a working house, any cell with 2+ stones
                else {
                    for (const col of cols) {
                        const cell = this.graph.coords2algebraic(col, myFront);
                        if (this.board[myFront][col] >= 2) {
                            noncaps.push(`${cell}<*`);
                            noncaps.push(`${cell}>*`);
                        }
                    }
                }
                if (noncaps.length === 0) {
                    for (const col of cols) {
                        const cell = this.graph.coords2algebraic(col, myFront);
                        if (this.board[myFront][col] >= 1) {
                            noncaps.push(`${cell}<*`);
                            noncaps.push(`${cell}>*`);
                        }
                    }
                }
            }
        }
        // mtaji
        else {
            // review every owned pit with >=2 seeds and see if it will trigger a capture
            for (const row of [myFront, myBack]) {
                for (let col = 0; col < 8; col++) {
                    const cell = this.graph.coords2algebraic(col, row);
                    const num = this.board[row][col];
                    if (num >= 2) {
                        for (const dir of ["CW", "CCW"] as const) {
                            let dirMarker: "<"|">";
                            if (row === myFront) {
                                dirMarker = dir === "CW" ? ">" : "<";
                            } else {
                                dirMarker = dir === "CW" ? "<" : ">";
                            }
                            let isMarker = false;
                            const sown = this.graph.sow(cell, dir, num);
                            const final = sown[sown.length - 1];
                            const opp = BaoGame.opposites.get(final);
                            if (opp !== undefined) {
                                const [myX, myY] = this.graph.algebraic2coords(final);
                                const [theirX, theirY] = this.graph.algebraic2coords(opp);
                                if ( (this.board[myY][myX] > 0) && (this.board[theirY][theirX] > 0) ) {
                                    isMarker = true;
                                }
                            }
                            // to be a valid capture, must start with <16 pieces and end in a marker
                            if ( (num < 16) && (isMarker) ) {
                                caps.push(`${cell}${dirMarker}`);
                            }
                        }
                    }
                }
            }
            // for each capture move, check to see if it includes "playing the house"
            for (const m of [...caps]) {
                const cloned = BaoGame.clone(this);
                const result = cloned.processMove(m);
                if (! result.complete) {
                    caps.push(`${m}+`);
                }
            }
            // if no captures were found, examine kutakata
            if (caps.length === 0) {
                let blocked: string|undefined;
                if (! ignoreBlocked) {
                    blocked = this.getBlocked(player);
                }
                // check every inner cell with 2+ seeds
                for (let i = 0; i < 8; i++) {
                    if (this.board[myFront][i] >= 2) {
                        // make sure it's not blocked
                        const cell = this.graph.coords2algebraic(i, myFront);
                        if ( (blocked !== undefined) && (blocked === cell) ) {
                            continue;
                        }
                        // otherwise save the move
                        noncaps.push(`${cell}<*`);
                        noncaps.push(`${cell}>*`);
                    }
                }
                // if still no moves, check outer row
                if (noncaps.length === 0) {
                    for (let i = 0; i < 8; i++) {
                        if (this.board[myBack][i] >= 2) {
                            const cell = this.graph.coords2algebraic(i, myBack);
                            // otherwise save the move
                            noncaps.push(`${cell}<*`);
                            noncaps.push(`${cell}>*`);
                        }
                    }
                }
            }
        }

        if (caps.length > 0) {
            // remove any captures that do not clear a blocked pit
            const blockee = player === 1 ? 2 : 1;
            if (this.blocked[blockee - 1] !== undefined) {
                const allowed: string[] = [];
                for (const mv of caps) {
                    const cloned = BaoGame.clone(this);
                    cloned.move(mv, {trusted: true});
                    if (cloned.blocked[blockee - 1] === undefined) {
                        allowed.push(mv);
                    }
                }
                caps = [...allowed];
            }
            return caps;
        } else {
            return noncaps;
        }
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    /**
     * Because `moves()` is efficient, and the number of moves is generally quite small,
     * this function uses it to autocomplete valid moves where possible.
     */
    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.graph.coords2algebraic(col, row);
            let newmove: string;
            // starting fresh
            if (move.length === 0) {
                newmove = cell;
            }
            // something is already there
            else {
                // if all that's there is a cell, assume you're choosing a direction
                if (move.length === 2) {
                    const dir = this.graph.getDir(move, cell);
                    if (dir !== undefined) {
                        if (dir === "CW") {
                            newmove = move + ">";
                        } else {
                            newmove = move + "<";
                        }
                    } else {
                        throw new Error("Could not interpret the second click.")
                    }
                }
                // otherwise, ignore the click
                else {
                    newmove = move;
                }
            }

            // check to see if we can autocomplete the move
            const validMoves = this.moves();
            const matches = validMoves.filter(m => m.startsWith(newmove));
            matches.sort((a, b) => a.length - b.length);
            if (matches.length > 0) {
                newmove = matches[0];
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

    /**
     * Because `move()` is relatively efficient, this function uses it extensively.
     */
    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.bao.INITIAL_INSTRUCTIONS", {context: this.inhand[this.currplayer - 1] > 0 ? "namua" : "mtaji"});
            return result;
        }

        const cell = m.substring(0, 2);
        // valid cell
        if (! this.graph.graph.hasNode(cell)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
            return result;
        }

        // yours
        if ( ( (this.currplayer === 1) && ( (cell.substring(-1) === "3") ||
                                            (cell.substring(-1) === "4")
                                          )
             ) ||
             ( (this.currplayer === 2) && ( (cell.substring(-1) === "1") ||
                                            (cell.substring(-1) === "2")
                                          )
             )
           ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
            return result;
        }

        // has pieces
        const [x, y] = this.graph.algebraic2coords(cell);
        if (this.board[y][x] === 0) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.bao.EMPTY");
            return result;
        }

        // direction marker is required
        // in cases where it can be assumed, `handleClick()` will autocomplete
        if (m.length === 2) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.bao.CHOOSE_DIR");
            return result;
        }

        const validMoves = this.moves();
        const matches = validMoves.filter(mv => mv.startsWith(m));
        if (matches.includes(m)) {
            // exact match
            if (matches.length === 1) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
            // move is indeed valid, but there's an alternative
            // this only happens if one can "play the house"
            else if (matches.length > 1) {
                result.valid = true;
                result.complete = 0;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.bao.PLAY_HOUSE");
                return result;
            }
        }

        // failsafe
        result.valid = false;
        result.message = i18next.t("apgames:validation._general.FAILSAFE", {move: m});
        return result;
    }

    public move(m: string, {trusted = false, partial = false} = {}): BaoGame {
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

        // annotate initial move
        const cell = m.substring(0, 2);
        if (this.inhand[this.currplayer - 1] > 0) {
            this.results.push({type: "place", where: cell});
        }
        // determine very first direction for annotation
        const marker = m[2];
        let dir: "CW"|"CCW";
        const [, row] = this.graph.algebraic2coords(cell);
        if ( (row === 0) || (row === 3) ) {
            dir = marker === "<" ? "CW" : "CCW";
        } else {
            dir = marker === "<" ? "CCW" : "CW";
        }
        const next = this.graph.sow(cell, dir, 1)[0];
        this.results.push({type: "move", from: cell, to: next});

        const results = this.processMove(m);
        // failsafe check for board economy
        if (this.board.map(l => l.reduce((prev, curr) => prev + curr, 0)).reduce((prev, curr) => prev + curr, 0) > 64) {
            throw new Error("Too many pieces on the board!");
        }
        // if a blocked cell is captured or sown, remove it from the blocked list
        for (let i = 0; i < this.blocked.length; i++) {
            if (this.blocked[i] !== undefined) {
                if ( (results.sown.includes(this.blocked[i]!)) || (results.captured.cells.includes(this.blocked[i]!)) ) {
                    this.blocked[i] = undefined;
                }
            }
        }

        // now process results
        // if we have an infinite loop, nothing else matters
        if (results.infinite) {
            this.results.push({type: "infinite"});
            this.instalose = true;
            this.winner = [this.currplayer === 1 ? 2 : 1];
        }
        // otherwise, check other possible results
        else {
            // captures and sowings
            if (results.captured.cells.length > 0) {
                this.results.push({type: "capture", where: results.captured.cells.join(", "), count: results.captured.stones})
            } else {
                this.results.push({type: "sow", pits: [...results.sown]});
            }
            // destroyed houses
            // captured
            for (const capped of results.captured.cells) {
                const idx = this.houses.findIndex(s => s === capped);
                if (idx !== -1) {
                    this.results.push({type: "destroy", where: capped});
                    this.houses[idx] = undefined;
                    break;
                }
            }
            // sown
            for (const sown of results.sown) {
                const idx = this.houses.findIndex(s => s === sown);
                if (idx !== -1) {
                    this.results.push({type: "destroy", where: sown});
                    this.houses[idx] = undefined;
                    break;
                }
            }
            // check for kutakatia
            const cloned = BaoGame.clone(this);
            cloned.lastmove = m;
            const blockee = this.currplayer === 1 ? 2 : 1;
            const blocked = cloned.getBlocked(blockee);
            if (blocked !== undefined) {
                this.blocked[blockee - 1] = blocked;
                this.results.push({type: "block", where: blocked});
                if (! m.endsWith("**")) {
                    m += "*";
                }
            }
        }

        if (partial) {
            return this;
        }

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

    protected checkEOG(): BaoGame {
        // if instalose is set, so is winner, just go with it
        if (this.instalose) {
            this.gameover = true;
        }
        // otherwise check for normal EOG conditions
        else {
            // check either player for having no pieces in their front row
            for (const p of [1, 2] as const) {
                const front = p === 1 ? 2 : 1;
                const num = this.board[front].reduce((prev, curr) => prev + curr, 0);
                if (num === 0) {
                    this.gameover = true;
                    this.winner = [p === 1 ? 2 : 1];
                    break;
                }
            }
            // current player has no moves
            if ( (! this.gameover) && (this.moves().length === 0) ) {
                this.gameover = true;
                this.winner = [this.currplayer === 1 ? 2 : 1];
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

    public state(): IBaoState {
        return {
            game: BaoGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: BaoGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: this.cloneBoard(),
            houses: [...this.houses],
            inhand: [...this.inhand],
            blocked: [...this.blocked],
        };
    }

    public render(opts?: { altDisplay: string | undefined}): APRenderRep {
        let altDisplay: string|undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }

        // Build piece string
        let pstr = "";
        for (let row = 0; row < 4; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: number[] = [];
            for (let col = 0; col < 8; col++) {
                pieces.push(this.board[row][col]);
            }
            pstr += pieces.join(",");
        }

        // Build rep
        const rep: APRenderRep =  {
            renderer: altDisplay === "pips" ? "sowing-pips" : "sowing-numerals",
            board: {
                style: "sowing",
                width: 8,
                height: 4,
                showEndPits: false,
                markers: [
                    {
                        type:"edge",
                        edge:"N",
                        colour:2
                    },
                    {
                        type:"edge",
                        edge:"S",
                        colour:1
                    },
                ],
            },
            pieces: pstr
        };
        const houses: {row: number; col: number;}[] = [];
        for (const h of this.houses) {
            if (h !== undefined) {
                const [col, row] = this.graph.algebraic2coords(h);
                houses.push({row, col});
            }
        }
        if (houses.length > 0) {
            // @ts-ignore
            rep.board.squarePits = houses
        }

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = this.graph.algebraic2coords(move.from);
                    const [toX, toY] = this.graph.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "place") {
                    const [x, y] = this.graph.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                } else if (move.type === "capture") {
                    let wherestr = move.where!;
                    wherestr = wherestr.replace(/ /g, "");
                    const targets: {row: number; col: number;}[] = [];
                    for (const where of wherestr.split(",")) {
                        const [x, y] = this.graph.algebraic2coords(where);
                        targets.push({row: y, col: x});
                    }
                    // @ts-ignore
                    rep.annotations.push({type: "exit", targets});
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

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.nowhat", {player, where: r.where}));
                resolved = true;
                break;
            case "move":
                resolved = true;
                break;
            case "sow":
                node.push(i18next.t("apresults:SOW", {player, pits: r.pits.join(", "), count: r.pits.length}));
                resolved = true;
                break;
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.bao", {player, pits: r.where, count: r.count}));
                resolved = true;
                break;
            case "infinite":
                node.push(i18next.t("apresults:INFINITE", {player}));
                resolved = true;
                break;
            case "destroy":
                node.push(i18next.t("apresults:DESTROY.bao", {where: r.where}));
                resolved = true;
                break;
            case "block":
                node.push(i18next.t("apresults:BLOCK.bao", {where: r.where}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): BaoGame {
        return new BaoGame(this.serialize());
    }

    protected cloneBoard(): number[][] {
        return [...this.board.map(l => [...l])];
    }
}
