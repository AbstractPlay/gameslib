import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { randomInt, reviver, UserFacingError, SquareOrthGraph } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-var-requires
const deepclone = require("rfdc/default");

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid[]>;
    roll: [number,number];
    pieces: [number,number];
    lastmove?: string;
    bumped?: playerid;
};

export interface ITableroState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class TableroGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Tablero di Berona",
        uid: "tablero",
        playercounts: [2],
        version: "20240124",
        // i18next.t("apgames:descriptions.tablero")
        description: "apgames:descriptions.tablero",
        // i18next.t("apgames:notes.tablero")
        notes: "apgames:notes.tablero",
        urls: ["https://crabfragmentlabs.com/tablero-di-berona"],
        people: [
            {
                type: "designer",
                name: "James Ernest",
                urls: ["https://crabfragmentlabs.com/"],
            },
            {
                type: "publisher",
                name: "Crab Fragment Labs",
                urls: ["https://crabfragmentlabs.com/"],
            },
        ],
        flags: ["experimental", "limited-pieces", "perspective", "multistep", "scores"]
    };
    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 3);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 3);
    }
    public static algebraic2d6(cell: string): number {
        const labels = "abcdef";
        return labels.indexOf(cell[0]) + 1;
    }
    public static move2d6(move: string): number {
        // adding a piece
        if (move.startsWith("+")) {
            return TableroGame.algebraic2d6(move.substring(1));
        }
        // movement
        else if ( (! move.startsWith("-")) && (move.includes("-")) ) {
            const subs = move.split("-");
            return TableroGame.algebraic2d6(subs[0]);
        }
        throw new Error(`Could not convert move "${move}" into a d6 result.`);
    }
    public static clone(obj: TableroGame): TableroGame {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        const cloned: TableroGame = Object.assign(new TableroGame(), deepclone(obj) as TableroGame);
        return cloned;
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid[]>;
    public gameover = false;
    public roll!: [number,number];
    public bumped?: playerid;
    public pieces!: [number,number];
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    // This field is not persisted. It is used for partials only to show the stack that is moving.
    public moving?: playerid[];

    constructor(state?: ITableroState | string) {
        super();
        if (state === undefined) {
            const d1 = randomInt(6);
            const d2= randomInt(6);
            const board = new Map<string, playerid[]>();
            const fresh: IMoveState = {
                _version: TableroGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                pieces: [12,12],
                roll: [d1, d2],
            };
            this.results = [{type: "roll", values: [d1,d2]}];
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ITableroState;
            }
            if (state.game !== TableroGame.gameinfo.uid) {
                throw new Error(`The Tablero engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): TableroGame {
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
        this.roll = [...state.roll];
        this.pieces = [...state.pieces];
        this.bumped = state.bumped;
        return this;
    }

    public moves(): string[] {
        if (this.gameover) { return []; }

        // get all possible initial moves first
        const first: string[] = [];
        for (const num of new Set<number>(this.roll)) {
            // eliminate all bumps in this first round
            first.push(...this.getFirstMoves(num).filter(m => m !== "bump"));
        }

        // then for each initial move, get possible second moves
        let moves: string[] = [];
        for (const moveFirst of first) {
            const d6First = TableroGame.move2d6(moveFirst);
            let d6Second: number;
            if (this.roll[0] === this.roll[1]) {
                d6Second = d6First;
            } else {
                d6Second = this.roll.find(n => n !== d6First)!;
            }
            // copy game, make the move, then get possible follow-ups
            const cloned = TableroGame.clone(this);
            // set trusted to avoid infinite recursion
            cloned.move(moveFirst, {partial: true, trusted: true});
            const second = cloned.getFirstMoves(d6Second);
            for (const sec of second) {
                moves.push(`${moveFirst},${sec}`);
            }
        }

        // if doubles, add taking options and remove any bump options
        if (this.roll[0] === this.roll[1]) {
            for (const [cell, stack] of this.board.entries()) {
                if (stack[stack.length - 1] === this.currplayer) {
                    moves.push(`-${cell}`);
                }
            }
            // if there are any removal options, you can't bump
            if (moves.filter(m => m.startsWith("-")).length > 0) {
                moves = moves.filter(m => ! m.includes("bump"))
            }
        }

        // if *none* of the dice can be used, then `moves` will be empty
        // add a single "bump" move at that point
        if (moves.length === 0) {
            moves.push("bump");
        }

        return moves;
    }

    // Gets all possible moves for the current object state and number
    public getFirstMoves(num: number): string[] {
        let homerow = 0;
        if (this.currplayer === 1) {
            homerow = 2;
        }
        const cell = TableroGame.coords2algebraic(num - 1, homerow);
        const first: string[] = [];
        // placement
        if (this.pieces[this.currplayer - 1] > 0) {
            first.push(`+${cell}`);
        }
        // movement
        if (this.board.has(cell)) {
            const stack = this.board.get(cell)!;
            if (stack[stack.length - 1] === this.currplayer) {
                first.push(...this.recurseGetMovement(cell, [...stack]).map(lst => lst.join("-")));
            }
        }
        if (first.length === 0) {
            first.push("bump");
        }
        return first;
    }

    // This function doesn't validate. It just calculates.
    // No need to clone the game because no mutation happens, and board state is irrelevant.
    public recurseGetMovement(cell: string, stack: playerid[], sofar: string[] = [cell]): string[][] {
        if (stack.length > 0) {
            const moves: string[][] = [];
            const g = new SquareOrthGraph(6, 3);
            for (const next of g.neighbours(cell)) {
                if (sofar.includes(next)) {
                    continue;
                }
                moves.push(...this.recurseGetMovement(next, stack.slice(0, -1), [...sofar, next]));
            }
            return moves;
        } else {
            return [[...sofar]];
        }
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    // is the submitted move syntactically complete (no validation)
    private isComplete(move: string): boolean {
        // bumping
        if (move === "bump") {
            return true;
        }
        // taking from an occupied space
        if ( (move.startsWith("-")) && (this.board.has(move.substring(1))) ) {
            return true;
        }
        // placing on an empty space
        if ( (move.startsWith("+")) && (move.length === 3) ) {
            return true;
        }
        // move of correct length
        if (move.includes("-")) {
            const subs = move.split("-");
            if (this.board.has(subs[0])) {
                const stack = this.board.get(subs[0])!;
                if (subs.length - 1 === stack.length) {
                    return true;
                }
            }
        }
        return false;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let homerow = 0;
            if (this.currplayer === 1) {
                homerow = 2;
            }
            const moves = move.split(/\s*,\s*/);
            const cloned = TableroGame.clone(this);
            // apply any previous moves
            if (moves.length > 1) {
                cloned.move(moves[0], {partial: true, trusted: true});
            }
            const lastComplete = cloned.isComplete(moves[moves.length - 1]);
            let newmove: string|undefined;
            // incomplete; continuing last move (doesn't matter which one)
            if (! lastComplete) {
                newmove = moves.pop()!;
            }
            // first move complete; this is start of new second move
            else if (lastComplete && moves.length === 1) {
                cloned.move(moves[0], {partial: true, trusted: true});
                newmove = "";
            }

            // process click regardless of scenario
            if (newmove !== undefined) {
                let cell: string|undefined;
                if (row !== -1 && col !== -1) {
                    cell = TableroGame.coords2algebraic(col, row);
                }
                // bump button
                if (cell === undefined && piece?.endsWith("Bump")) {
                    newmove = "bump";
                }
                // take button
                else if (cell === undefined && piece?.endsWith("Take")) {
                    if (newmove.length === 2) {
                        newmove = `-${newmove}`;
                    } else {
                        newmove = "-";
                    }
                } else if (cell === undefined && piece?.endsWith("Place")) {
                    if (newmove.length === 2) {
                        newmove = `+${newmove}`;
                    } else {
                        newmove = "+";
                    }
                }
                // clicked on a cell
                else if (cell !== undefined) {
                    // if newmove is empty and column matches a die
                    if (newmove.length === 0 && cloned.roll.includes(col + 1)) {
                        // if cell is empty and home row, placement
                        if ( (! cloned.board.has(cell)) && (row === homerow) ) {
                            newmove = `+${cell}`;
                        }
                        // if occupied and home row
                        else if (cloned.board.has(cell) && row === homerow) {
                            const stack = cloned.board.get(cell)!;
                            // if enemy occupied, placement
                            if (stack[stack.length - 1] !== cloned.currplayer) {
                                newmove = `+${cell}`;
                            }
                            // otherwise, assume movement
                            else {
                                newmove = cell;
                            }
                        }
                        // occupied and not home row, assume taking
                        else if (cloned.board.has(cell) && row !== homerow) {
                            newmove = `-${cell}`;
                        }
                    }
                    // if newmove is empty but column doesn't match a die, take
                    else if (newmove.length === 0) {
                        newmove = `-${cell}`;
                    }
                    // newmove is empty or starts with a - or +
                    else if (newmove.length <= 1) {
                        newmove += cell;
                    }
                    // clicked the same cell twice, assume placement
                    else if (newmove === cell) {
                        newmove = `+${cell}`;
                    }
                    // otherwise, assume it's a movement
                    else {
                        newmove += `-${cell}`;
                    }
                }
            }

            // otherwise, just ignore the click and pass through
            let combined: string;
            if (newmove === undefined) {
                combined = moves.join(",");
            } else {
                combined = [...moves, newmove].join(",");
            }

            // autocomplete if possible
            const matching = this.moves().filter(m => m.startsWith(combined));
            if (matching.length === 1) {
                combined = matching[0];
            }

            const result = this.validateMove(combined) as IClickResult;
            if (! result.valid) {
                // nondestructive failure
                result.move = move;
            } else {
                result.move = combined;
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

        m = m.toLowerCase().replace(/\s+/g, "");

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.tablero.INITIAL_INSTRUCTIONS")
            return result;
        }

        // Although passing can be forced by taking a piece when rolling doubles,
        // it is never a valid voluntary move. So it is handled in the `move()`
        // function and not here.

        let homerow = 0;
        if (this.currplayer === 1) {
            homerow = 2;
        }
        const origMoves = this.moves();
        const g = new SquareOrthGraph(6, 3);
        const moves = m.split(/\s*,\s*/);
        const cloned = TableroGame.clone(this);
        for (const move of moves) {
            // bump
            // If you're bumping, then the entire move string must be valid.
            // So you only have to test if the full move is in the move list.
            if (move === "bump") {
                if (! origMoves.includes(m)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.tablero.BAD_BUMP");
                    return result;
                }
            }

            // take
            else if (move.startsWith("-")) {
                // must have rolled doubles
                if (cloned.roll[0] !== cloned.roll[1]) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.tablero.BAD_TAKE");
                    return result;
                }

                const cell = move.substring(1);
                // `cell` is potentially empty, which is a valid partial
                if (cell === "") {
                    result.valid = true;
                    result.complete = 0;
                    result.message = i18next.t("apgames:validation.tablero.PARTIAL_TAKE");
                    return result;
                }

                // must be occupied
                if (! cloned.board.has(cell)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: cell});
                    return result;
                }

                // must be yours
                const stack = cloned.board.get(cell)!;
                if (stack[stack.length - 1] !== cloned.currplayer) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                    return result;
                }
            }

            // movement
            else if (move.includes("-")) {
                const subs = move.split("-");

                // start must be occupied
                if (! cloned.board.has(subs[0])) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: subs[0]});
                    return result;
                }

                // must be yours
                const stack = cloned.board.get(subs[0])!
                if (stack[stack.length - 1] !== cloned.currplayer) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                    return result;
                }

                // must be on your home row
                const [,startRow] = TableroGame.algebraic2coords(subs[0]);
                if (startRow !== homerow) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.tablero.NOT_HOME");
                    return result;
                }

                // must match one of your dice
                const d = TableroGame.algebraic2d6(subs[0]);
                if (! cloned.roll.includes(d)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.tablero.NO_MATCHING_DIE", {die: d});
                    return result;
                }

                // no backtracking
                const unique = new Set<string>(subs);
                if (unique.size !== subs.length) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.tablero.BACKTRACKING");
                    return result;
                }

                // each cell must be orthogonally adjacent to the next
                for (let i = 1; i < subs.length; i++) {
                    const from = subs[i-1];
                    const to = subs[i];
                    if (! g.neighbours(from).includes(to)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.NOT_ORTH", {from, to});
                        return result;
                    }
                }

                // while length is short, valid partial
                // don't return fully complete moves yet
                if (subs.length < stack.length + 1) {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.tablero.PARTIAL_MOVE", {count: stack.length + 1 - subs.length});
                    return result;
                }
            }

            // placement
            else if (move.startsWith("+")) {
                const cell = move.substring(1);
                // `cell` is potentially empty, which is a valid partial
                if (cell === "") {
                    result.valid = true;
                    result.complete = 0;
                    result.message = i18next.t("apgames:validation.tablero.PARTIAL_PLACE");
                    return result;
                }

                // valid cell
                try {
                    TableroGame.algebraic2coords(cell);
                } catch {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALID_CELL", {cell});
                    return result;
                }
                const [, row] = TableroGame.algebraic2coords(cell);

                // must be home row
                if (row !== homerow) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.tablero.NOT_HOME");
                    return result;
                }

                // must match one of your dice
                const d = TableroGame.algebraic2d6(cell);
                if (! cloned.roll.includes(d)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.tablero.NO_MATCHING_DIE", {die: d});
                    return result;
                }

                // must have a piece in hand
                if (cloned.pieces[cloned.currplayer - 1] === 0) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.NOPIECES");
                    return result;
                }

            }
            // otherwise, very beginning of movement
            else {
                // valid cell
                try {
                    TableroGame.algebraic2coords(move);
                } catch {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALID_CELL", {cell: move});
                    return result;
                }
                const [, row] = TableroGame.algebraic2coords(move);

                // must be home row
                if (row !== homerow) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.tablero.NOT_HOME");
                    return result;
                }

                // if occupied, must be controlled
                if (cloned.board.has(move)) {
                    const stack = cloned.board.get(move)!;
                    if (stack[stack.length - 1] !== cloned.currplayer) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                        return result;
                    }
                    // valid partial move
                    else {
                        result.valid = true;
                        result.complete = -1;
                        result.canrender = true;
                        result.message = i18next.t("apgames:validation.tablero.PARTIAL_MOVE", {count: stack.length});
                        return result;
                    }
                } else {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: move});
                    return result;
                }
            }

            // execute the move at the end if we made it this far
            cloned.move(move, {partial: true, trusted: true})
        }

        // If we've gotten here, all submoves are valid.
        // But how many submoves did we get? Is the move really complete?
        if ( (moves.length === 2) || (m === "bump") || (m.startsWith("-")) ) {
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        } else {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.tablero.VALID_PARTIAL");
            return result;
        }
    }

    public move(m: string, {trusted = false, partial = false} = {}): TableroGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (! trusted) {
            // Don't validate "pass". It's just always valid.
            if (m !== "pass") {
                const result = this.validateMove(m);
                if (! result.valid) {
                    throw new UserFacingError("VALIDATION_GENERAL", result.message)
                }
            }

            // Don't check against the move list if the move is partial or if it's a forced pass
            if ( (! partial) && (m !== "pass") && (! this.moves().includes(m)) ) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];
        const moves = (m.split(","));
        for (const move of moves) {
            // bump
            if (move === "bump") {
                if (this.bumped === undefined) {
                    this.bumped = this.currplayer;
                }
                this.results.push({type: "pass"});
            }
            // take
            else if (move.startsWith("-")) {
                if (move !== "-") {
                    const from = move.substring(1);
                    const stack = this.board.get(from)!;
                    // remove top piece
                    stack.pop();
                    // replace stack
                    this.board.set(from, [...stack]);
                    // add piece to hand
                    this.pieces[this.currplayer - 1]++;

                    this.results.push({type: "take", from});
                }
            }
            // movement
            else if (move.includes("-")) {
                const subs = move.split("-");
                const stack = [...this.board.get(subs[0])!];
                this.moving = stack.reverse();
                for (let i = 1; i < subs.length; i++) {
                    const from = subs[i-1];
                    const to = subs[i];
                    const checker = stack.pop()!;
                    let toStack: playerid[]|undefined = this.board.get(to);
                    if (toStack === undefined) {
                        toStack = [] as playerid[];
                    }
                    toStack = [...toStack, checker];
                    this.board.set(to, [...toStack]);
                    this.results.push({type: "move", from, to});
                }
                this.board.delete(subs[0]);
            }
            // placement
            else if (move.startsWith("+")) {
                const cell = move.substring(1);
                if (this.board.has(cell)) {
                    const stack = this.board.get(cell)!;
                    this.board.set(cell, [...stack, this.currplayer]);
                    this.pieces[this.currplayer - 1]--;
                    this.results.push({type: "place", where: cell});
                } else {
                    this.board.set(cell, [this.currplayer]);
                    this.pieces[this.currplayer - 1]--;
                    this.results.push({type: "place", where: cell});
                }
            }
            // starting a new move
            else if (move.length === 2) {
                if (this.board.has(move)) {
                    this.moving = [...this.board.get(move)!];
                }
            }
            // ERROR
            else {
                throw new Error(`Unable to process the various parts of the following move: ${m}`);
            }

        }

        if (partial) { return this; }
        delete this.moving;

        this.lastmove = m;
        // reroll the dice
        const d1 = randomInt(6);
        const d2 = randomInt(6);
        this.roll = [d1,d2];
        this.results.push({type: "roll", values: [d1,d2]});

        // update currplayer
        // if player took a piece, force a pass and leave currplayer
        if (m.startsWith("-")) {
            // save the current move
            this.saveState();
            // insert a forced pass (but no `result`)
            this.lastmove = "pass"
        }
        // otherwise
        else {
            let newplayer = (this.currplayer as number) + 1;
            if (newplayer > this.numplayers) {
                newplayer = 1;
            }
            this.currplayer = newplayer as playerid;
        }

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): TableroGame {
        if ( (this.bumped !== undefined) && (this.bumped === this.currplayer) ) {
            this.gameover = true;
            const score1 = this.getPlayerScore(1);
            const score2 = this.getPlayerScore(2);
            if (score1 > score2) {
                this.winner = [1];
            } else if (score2 > score1) {
                this.winner = [2];
            } else {
                const highest = this.getHighestSpace();
                if (highest === undefined) {
                    this.winner = [1,2];
                } else {
                    this.winner = [highest];
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

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] },
            { name: i18next.t("apgames:status.PIECESREMAINING"), scores: this.pieces }
        ];
    }

    public getPlayerScore(player: number): number {
        let score = 0;
        for (let col = 0; col < 6; col++) {
            const cell = TableroGame.coords2algebraic(col, 1);
            if (this.board.has(cell)) {
                const stack = this.board.get(cell)!;
                if (stack[stack.length - 1] === player) {
                    score += col + 1
                }
            }
        }
        return score;
    }

    public getHighestSpace(): playerid|undefined {
        for (let col = 5; col >= 0; col--) {
            const cell = TableroGame.coords2algebraic(col, 1);
            if (this.board.has(cell)) {
                const stack = this.board.get(cell)!;
                return stack[stack.length - 1];
            }
        }
        return undefined;
    }

    public state(): ITableroState {
        return {
            game: TableroGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: TableroGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            bumped: this.bumped,
            roll: [...this.roll],
            pieces: [...this.pieces],
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        const graph = new SquareOrthGraph(6, 3);
        const cells = graph.listCells(true);
        for (const row of cells) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    let str = this.board.get(cell)!.join("");
                    str = str.replace(/1/g, "A");
                    str = str.replace(/2/g, "B");
                    pieces.push(str);
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join(",");
        }

        // Build rep
        const rep: APRenderRep =  {
            renderer: "stacking-offset",
            board: {
                style: "squares-checkered",
                width: 6,
                height: 3,
                startLight: true,
                markers: [
                    {
                        type: "glyph",
                        glyph: "D601",
                        points: [
                            {
                                row: 1,
                                col: 0
                            }
                        ]
                    },
                    {
                        type: "glyph",
                        glyph: "D602",
                        points: [
                            {
                                row: 1,
                                col: 1
                            }
                        ]
                    },
                    {
                        type: "glyph",
                        glyph: "D603",
                        points: [
                            {
                                row: 1,
                                col: 2
                            }
                        ]
                    },
                    {
                        type: "glyph",
                        glyph: "D604",
                        points: [
                            {
                                row: 1,
                                col: 3
                            }
                        ]
                    },
                    {
                        type: "glyph",
                        glyph: "D605",
                        points: [
                            {
                                row: 1,
                                col: 4
                            }
                        ]
                    },
                    {
                        type: "glyph",
                        glyph: "D606",
                        points: [
                            {
                                row: 1,
                                col: 5
                            }
                        ]
                    },
                    {
                        type: "edge",
                        "colour": 1,
                        "edge": "S"
                    },
                    {
                        type: "edge",
                        "colour": 2,
                        "edge": "N"
                    }
                ]
            },
            legend: {
                A: {
                    name: "piece",
                    player: 1,
                },
                B: {
                    name: "piece",
                    player: 2,
                },
                D601: {
                    name: "d6-1",
                    opacity: 0.25,
                    scale: 0.5
                },
                D602: {
                    name: "d6-2",
                    opacity: 0.25,
                    scale: 0.5
                },
                D603: {
                    name: "d6-3",
                    opacity: 0.25,
                    scale: 0.5
                },
                D604: {
                    name: "d6-4",
                    opacity: 0.25,
                    scale: 0.5
                },
                D605: {
                    name: "d6-5",
                    opacity: 0.25,
                    scale: 0.5
                },
                D606: {
                    name: "d6-6",
                    opacity: 0.25,
                    scale: 0.5
                },
                D1: {
                    name: `d6-${this.roll[0]}`,
                },
                D2: {
                    name: `d6-${this.roll[1]}`,
                }
            },
            pieces: pstr,
            areas: [
                {
                    type: "key",
                    list: [
                        {
                            piece: "D1",
                            name: ""
                        },
                        {
                            piece: "D2",
                            name: ""
                        }
                    ],
                    position: "right",
                    clickable: false,
                    height: 1
                },
                {
                    type: "buttonBar",
                    position: "left",
                    height: 0.5,
                    buttons: [
                        {
                            label: "Place"
                        },
                        {
                            label: "Take"
                        },
                        {
                            label: "Bump"
                        },
                    ]
                }
            ]
        };

        // add pieces area if moving a stack
        if ( (this.moving !== undefined) && (this.moving.length > 0) ) {
            rep.areas!.push({
                type: "pieces",
                label: `Stack to be moved (next checker is on the right)`,
                // @ts-ignore
                pieces: [...this.moving.map(p => p === 1 ? "A": "B")].reverse()
            });
        }

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = TableroGame.algebraic2coords(move.from);
                    const [toX, toY] = TableroGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "place") {
                    const [x, y] = TableroGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                } else if (move.type === "take") {
                    const [x, y] = TableroGame.algebraic2coords(move.from);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
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

        status += "**In hand**: " + this.pieces.join(", ") + "\n\n";
        status += `**Scores**: ${this.getPlayerScore(1)}, ${this.getPlayerScore(2)}\n\n`;

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.nowhat", {player, where: r.where}));
                resolved = true;
                break;
            case "take":
                node.push(i18next.t("apresults:TAKE.tablero", {player, from: r.from}));
                resolved = true;
                break;
            case "roll":
                node.push(i18next.t("apresults:ROLL.tablero", {player, values: r.values.join(",")}));
                resolved = true;
                break;
            case "pass":
                node.push(i18next.t("apresults:PASS.tablero", {player}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): TableroGame {
        return new TableroGame(this.serialize());
    }
}
