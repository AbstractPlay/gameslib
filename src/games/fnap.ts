/* eslint-disable no-console */
import { GameBaseSimultaneous, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, Glyph } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { allDirections, RectGrid, reviver, UserFacingError } from "../common";
import i18next from "i18next";

type playerid = 1|2;
type Piece = [number, "O"|"D"|"A"|"C"]; // orth, diag, all, cicle
type CellContents = [...Piece, playerid];

export interface IMoveState extends IIndividualState {
    board: Map<string, CellContents>;
    fnap: playerid;
    scores: [number,number];
    phase: "select"|"place"|"playOrPass";
    passing: playerid|undefined;
    lastmove: string[];
    selected: string[];
};

export interface IFnapState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class FnapGame extends GameBaseSimultaneous {
    public static readonly gameinfo: APGamesInformation = {
        name: "FNAP",
        uid: "fnap",
        playercounts: [2],
        version: "20231225",
        // i18next.t("apgames:descriptions.fnap")
        description: "apgames:descriptions.fnap",
        urls: [
            "https://boardgamegeek.com/boardgame/22698/fnap",
        ],
        people: [
            {
                type: "designer",
                name: "Andrew Juell"
            }
        ],
        flags: ["experimental", "simultaneous", "scores", "automove", "multistep"]
    };

    public static coords2algebraic(x: number, y: number): string {
        return GameBaseSimultaneous.coords2algebraic(x, y, 6);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBaseSimultaneous.algebraic2coords(cell, 6);
    }

    public static genTriplets(): {type: "diag"|"orth", cells: string[]}[] {
        const triplets: {type: "diag"|"orth", cells: string[]}[] = [];

        // rows
        for (let y = 0; y < 6; y++) {
            for (let x = 0; x < 4; x++) {
                const type: "diag"|"orth" = "orth";
                const cells: string[] = [FnapGame.coords2algebraic(x, y), FnapGame.coords2algebraic(x+1, y), FnapGame.coords2algebraic(x+2, y)];
                triplets.push({type, cells});
            }
        }
        // cols
        for (let x = 0; x < 6; x++) {
            for (let y = 0; y < 4; y++) {
                const type: "diag"|"orth" = "orth";
                const cells: string[] = [FnapGame.coords2algebraic(x, y), FnapGame.coords2algebraic(x, y+1), FnapGame.coords2algebraic(x, y+2)];
                triplets.push({type, cells});
            }
        }
        // se/sw diags
        const grid = new RectGrid(6,6);
        for (let y = 0; y < 6; y++) {
            for (let x = 0; x < 6; x++) {
                const cell = FnapGame.coords2algebraic(x, y);
                const raySE = grid.ray(x, y, "SE").map(pt => FnapGame.coords2algebraic(...pt));
                const raySW = grid.ray(x, y, "SW").map(pt => FnapGame.coords2algebraic(...pt));
                for (const ray of [raySE, raySW]) {
                    if (ray.length >= 2) {
                        triplets.push({type: "diag", cells: [cell, ...ray.slice(0, 2)]})
                    }
                }
            }
        }

        return triplets;
    }
    public static triplets = FnapGame.genTriplets();

    public numplayers = 2;
    public board!: Map<string, CellContents>;
    public fnap!: playerid;
    public scores!: [number,number];
    public phase!: "select"|"place"|"playOrPass";
    public passing!: playerid|undefined;
    public selected!: string[];
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = []
    public variants: string[] = [];

    constructor(state?: IFnapState | string) {
        super();
        if (state !== undefined) {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IFnapState;
            }
            if (state.game !== FnapGame.gameinfo.uid) {
                throw new Error(`The Pulling Fnap game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.stack = [...state.stack];
        } else {
            const fresh: IMoveState = {
                _version: FnapGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                lastmove: [],
                board: new Map(),
                fnap: 1,
                scores: [0,0],
                passing: undefined,
                phase: "select",
                selected: [],
            };
            this.stack = [fresh];
        }
        this.load();
    }

    public load(idx = -1): FnapGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.board = new Map(state.board);
        this.fnap = state.fnap;
        this.scores = [...state.scores];
        this.passing = state.passing;
        this.phase = state.phase;
        this.lastmove = state.lastmove.join(',');
        this.selected = [...state.selected];
        return this;
    }

    protected genStash(player: playerid): CellContents[] {
        const placed = [...this.board.values()].filter(p => p[2] === player);
        const stash: CellContents[] = [];
        for (let val = 0; val <= 5; val++) {
            for (const type of ["O","D","A","C"] as const) {
                const pcPlaced = placed.find(p => p[0] === val && p[1] === type);
                if ( (pcPlaced === undefined) && (! this.selected.includes([val, type, player].join(""))) ){
                    stash.push([val, type, player]);
                }
            }
        }
        return stash.sort((a, b) => {
            const order = ["O","D","A","C"];
            if (a[1] === b[1]) {
                return a[0] - b[0];
            } else {
                return order.findIndex(t => t === a[1]) - order.findIndex(t => t === b[1]);
            }
        });
    }

    protected getEmpties(): string[] {
        const empties: string[] = [];
        for (let x = 0; x < 6; x++) {
            for (let y = 0; y < 6; y++) {
                const cell = FnapGame.coords2algebraic(x, y);
                if (! this.board.has(cell)) {
                    empties.push(cell);
                }
            }
        }
        return empties;
    }

    public moves(player: playerid): string[] {
        if (this.gameover) {
            return [];
        }
        const moves: string[] = [];

        // only move is pass if passing is set
        if (this.passing !== undefined && this.passing === player) {
            moves.push("pass")
        }
        else {
            // select phase
            if (this.phase === "select") {
                const stash = this.genStash(player);
                moves.push(...stash.map(s => s.join("")));
            } else {
                if (this.selected.length === 0) {
                    throw new Error(`If phase is 'place' or 'playOrPass', then 'selected' has to be populated.`);
                }
                // place moves happen regardless
                const empties = this.getEmpties();
                for (const cell1 of empties) {
                    for (const cell2 of empties) {
                        if (cell1 === cell2) { continue; }
                        moves.push(`${this.selected[0]}-${cell1};${this.selected[1]}-${cell2}`);
                    }
                }
                // playOrPass means add a "pass" move to the list
                if (this.phase === "playOrPass") {
                    moves.push("pass");
                }
            }
        }

        return moves.sort((a,b) => a.localeCompare(b));
    }

    public randomMove(): string {
        const moves1 = this.moves(1);
        const move1 = moves1[Math.floor(Math.random() * moves1.length)];
        const moves2 = this.moves(2);
        const move2 = moves2[Math.floor(Math.random() * moves2.length)];
        return `${move1}, ${move2}`;
    }

    public handleClickSimultaneous(move: string, row: number, col: number, player: playerid, piece?: string): IClickResult {
        try {
            let newmove: string;
            // if an area click
            if (row === -1 || col === -1) {
                if (piece === undefined) {
                    throw new Error("If clicking off the board, then piece really should be defined!");
                }
                piece = piece.substring(1); // remove the leading `x`
                // if select phase, just keep replacing newmove
                if (this.phase === "select") {
                    newmove = piece;
                }
                // if place phase
                else {
                    if (move === "") {
                        newmove = piece;
                    } else {
                        // if piece already in the string,
                        // or if the move is incomplete, restart
                        if ( (move.includes(piece)) || (move.length < 6) ) {
                            newmove = piece;
                        }
                        // otherwise add
                        else {
                            newmove = `${move};${piece}`;
                        }
                    }
                }
            }
            // if board click
            else {
                const cell = FnapGame.coords2algebraic(col, row);
                // only valid click is placement
                if (move === "") {
                    return {move: "", message: i18next.t("apgames:validation.fnap.INITIAL_INSTRUCTIONS", {context: this.phase})} as IClickResult;
                } else if (move.length <=6) {
                    const [left,] = move.split("-");
                    newmove = `${left}-${cell}`;
                } else {
                    const [m1,m2] = move.split(";");
                    const [left,] = m2.split("-");
                    newmove = `${m1};${left}-${cell}`;
                }
            }

            const result = this.validateMove(newmove, player) as IClickResult;
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

    public validateMove(m: string, player: playerid): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        m = m.replace(/\s+/g, "");

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.fnap.INITIAL_INSTRUCTIONS", {context: this.phase});
            return result;
        }

        // always accept null move
        if (m === "\u0091") {
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
        // check for pass
        if (m === "pass") {
            if ( (this.passing === player) || (this.phase = "playOrPass") ) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.fnap.BAD_PASS");
                return result;
            }
        }

        if (this.phase === "select") {
            const tile = m.toUpperCase();
            // tile is available
            const stash = this.genStash(player).map(p => p.join(""));
            if (! stash.includes(tile)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.fnap.BAD_TILE", {tile});
                return result;
            }

            // we're good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
        // We checked for pass earlier, so everything else is a placement
        else {
            const [m1, m2] = m.split(";");
            // m1 is guaranteed to exist, at least
            let [tile1, cell1] = m1.split("-");
            tile1 = tile1.toUpperCase();
            // tile is selected
            if (! this.selected.includes(tile1)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.fnap.BAD_SELECTED");
                return result;
            }
            if (cell1 !== undefined) {
                // valid cell
                try {
                    FnapGame.algebraic2coords(cell1);
                } catch {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: cell1});
                    return result;
                }
                // empty
                if (this.board.has(cell1)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: cell1});
                    return result;
                }
            } else {
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.fnap.VALID_PARTIAL_cell");
                return result;
            }
            if (m2 !== undefined) {
                let [tile2, cell2] = m2.split("-");
                tile2 = tile2.toUpperCase();

                // tile is selected
                if (! this.selected.includes(tile2)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.fnap.BAD_SELECTED");
                    return result;
                }
                // check for dupes
                if (tile1 === tile2) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.fnap.DUPLICATE_TILE");
                    return result;
                }
                if (cell2 !== undefined) {
                    // valid cell
                    try {
                        FnapGame.algebraic2coords(cell2);
                    } catch {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: cell2});
                        return result;
                    }
                    // empty
                    if (this.board.has(cell2)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: cell2});
                        return result;
                    }
                    // check for dupes
                    if (cell1 === cell2) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.fnap.DUPLICATE_CELL");
                        return result;
                    }

                    // we're good
                    result.valid = true;
                    result.complete = 1;
                    result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                    return result;
                } else {
                    result.valid = true;
                    result.complete = -1;
                    result.message = i18next.t("apgames:validation.fnap.VALID_PARTIAL_cell");
                    return result;
                }
            }
            // it's a partial
            else {
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.fnap.VALID_PARTIAL_tile");
                return result;
            }
        }
    }

    public move(m: string, {partial = false, trusted = false} = {}): FnapGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        const moves: string[] = m.split(/,\s*/);
        if (moves.length !== 2) {
            throw new UserFacingError("MOVES_SIMULTANEOUS_PARTIAL", i18next.t("apgames:MOVES_SIMULTANEOUS_PARTIAL"));
        }
        for (let i = 0; i < moves.length; i++) {
            if ( (partial) && ( (moves[i] === undefined) || (moves[i] === "") ) ) {
                continue;
            }
            // moves[i] = moves[i].toLowerCase();
            moves[i] = moves[i].replace(/\s+/g, "");
            if (! trusted) {
                const result = this.validateMove(moves[i], (i + 1) as playerid);
                if (! result.valid) {
                    throw new UserFacingError("VALIDATION_GENERAL", result.message)
                }
                if (! ((partial && moves[i] === "") || this.moves((i + 1) as playerid).includes(moves[i]))) {
                    throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
                }
            }
        }

        let mover: playerid|undefined;
        if (this.passing !== undefined) {
            mover = 1;
            if (this.passing === 1) {
                mover = 2;
            }
        }

        this.results = [];
        if (this.phase === "select") {
            this.selected = [];
            for (let i = 0; i < 2; i++) {
                this.selected.push(moves[i].toUpperCase());
                this.results.push({type: "select", who: i + 1, what: moves[i].substring(0, 2)});
            }

            // if selected is complete, change phases
            if (this.selected.length === 2) {
                const vals = this.selected.map(s => parseInt(s[0], 10));
                // equal, the fnap holder gets to choose
                if (vals[0] === vals[1]) {
                    this.phase = "playOrPass";
                    this.passing = 1;
                    if (this.fnap === 2) {
                        this.passing = 2;
                    }
                }
                // p1 greater, they place
                else if (vals[0] > vals[1]) {
                    this.phase = "place";
                    this.passing = 2;
                }
                // p2 places
                else {
                    this.phase = "place";
                    this.passing = 1;
                }
            }
        }
        // if the fnap holder passes, move to place phase
        else if (this.phase === "playOrPass" && mover !== undefined && moves[mover - 1] === "pass") {
            this.results.push({type: "pass", who: mover});
            this.phase = "place";
            this.passing = mover;
        }
        // plain ol' placement
        else if (mover !== undefined) {
            const cells: string[] = [];
            for (const mv of moves[mover - 1].split(";")) {
                if (mv === undefined || mv === "") { continue; }
                const [tile, cell] = mv.split("-");
                const pc: CellContents = [parseInt(tile[0], 10), tile[1].toUpperCase() as "O"|"D"|"A"|"C", parseInt(tile[2], 10) as playerid];
                this.board.set(cell, pc);
                cells.push(cell);
                this.results.push({type: "place", what: tile, where: cell, who: mover});
            }
            // move the fnap token if playOrPass
            if (this.phase === "playOrPass") {
                let otherPlayer: playerid = 1;
                if (mover === 1) {
                    otherPlayer = 2;
                }
                if (this.fnap !== otherPlayer) {
                    this.fnap = otherPlayer;
                    this.results.push({type: "claim", where: "", who: otherPlayer, what: "fnap"});
                }
            }

            // score placed pieces
            const deltas: [number,number] = [0,0];

            // rows and columns first
            const rows = [...(new Set<number>(cells.map(c => FnapGame.algebraic2coords(c)[1]))).values()];
            const cols = [...(new Set<number>(cells.map(c => FnapGame.algebraic2coords(c)[0]))).values()];
            for (const row of rows) {
                const winner: playerid|undefined = this.scoreRowCol("row", row);
                if (winner !== undefined) {
                    this.results.push({type: "claim", who: winner, what: "row", where: FnapGame.coords2algebraic(0, row)[1]});
                    deltas[winner - 1]++;
                }
            }
            for (const col of cols) {
                const winner: playerid|undefined = this.scoreRowCol("col", col);
                if (winner !== undefined) {
                    this.results.push({type: "claim", who: winner, what: "col", where: FnapGame.coords2algebraic(col, 0)[0]});
                    deltas[winner - 1]++;
                }
            }

            // now triplets
            for (const cell of cells) {
                const pc = this.board.get(cell)!;
                const delta = this.scoreTriplets(cell);
                if (delta > 0) {
                    this.results.push({type: "set", who: pc[2], count: delta});
                    deltas[pc[2] - 1] += delta * 2;
                }
            }

            // finally, apply score deltas
            console.log(deltas);
            for (const player of [1,2] as playerid[]) {
                if (deltas[player - 1] !== 0) {
                    this.scores[player - 1] += deltas[player - 1];
                    this.results.push({type: "deltaScore", delta: deltas[player - 1], who: player});
                }
            }

            // transition state
            this.phase = "select";
            this.passing = undefined;
            this.selected = [];
        } else {
            throw new Error("Invalid game phase state.");
        }

        if (partial) { return this; }

        this.lastmove = [...moves].join(',');
        this.checkEOG();
        this.saveState();
        return this;
    }

    // No mutation; just returns a number
    public scoreTriplets(cell: string): number {
        if (! this.board.has(cell)) {
            throw new Error(`Trying to score a cell with no tile (${cell}).`);
        }
        const trips = FnapGame.triplets.filter(t => t.cells.includes(cell));
        const pc = this.board.get(cell)!;
        let score = 0;
        for (const trip of trips) {
            // must all be occupied
            let occupied = true;
            for (const tcell of trip.cells) {
                if (! this.board.has(tcell)) {
                    occupied = false;
                    break;
                }
            }
            if (! occupied) {
                continue;
            }

            // must all belong to the player
            const player = pc[2];
            let owned = true;
            for (const tcell of trip.cells) {
                if (this.board.get(tcell)![2] !== player) {
                    owned = false;
                    break;
                }
            }
            if (! owned) {
                continue;
            }

            // must be the correct pieces
            let aligned = true;
            for (const tcell of trip.cells) {
                const tpc = this.board.get(tcell)!;
                let correct: boolean;
                if (trip.type === "orth") {
                    correct = tpc[1] === "O" || tpc[1] === "A";
                } else {
                    correct = tpc[1] === "D" || tpc[1] === "A";
                }
                if (! correct) {
                    aligned = false;
                    break;
                }
            }
            if (! aligned) {
                continue;
            }

            // if we made it here, it's a valid triplet
            score++;
        }
        return score;
    }

    // no mutation, only winner
    public scoreRowCol(type: "row"|"col", val: number): playerid|undefined {
        const cells: string[] = [];
        for (let i = 0; i < 6; i++) {
            let x: number;
            let y: number;
            if (type === "row") {
                x = i; y = val;
            } else {
                x = val; y = i;
            }
            cells.push(FnapGame.coords2algebraic(x, y));
        }
        // cells must all be occupied
        let occupied = true;
        for (const cell of cells) {
            if (! this.board.has(cell)) {
                occupied = false;
                break;
            }
        }
        if (! occupied) {
            return undefined;
        }
        const p1 = cells.map(c => this.board.get(c)!).filter(pc => pc[2] === 1).map(pc => pc[0]).reduce((prev, curr) => prev + curr, 0);
        const p2 = cells.map(c => this.board.get(c)!).filter(pc => pc[2] === 2).map(pc => pc[0]).reduce((prev, curr) => prev + curr, 0);
        if (p1 > p2) {
            return 1;
        } else if (p2 > p1) {
            return 2;
        } else {
            return undefined;
        }
    }

    public isIsolated(cell: string): boolean {
        const [x, y] = FnapGame.algebraic2coords(cell);
        const pc = this.board.get(cell)!;
        let isolated = true;
        const grid = new RectGrid(6,6);
        for (const dir of allDirections) {
            const ray = grid.ray(x, y, dir).map(pt => FnapGame.coords2algebraic(...pt));
            if (ray.length > 0) {
                const next = this.board.get(ray[0]);
                if (next === undefined) {
                    throw new Error("The function isIsolated() should only be called when the board is full.");
                }
                if (next[2] === pc[2]) {
                    // orthogonal
                    if ( (dir.length === 1) && ( (next[1] === "O") || (next[1] === "A") ) ) {
                        isolated = false;
                        break;
                    }
                    if ( (dir.length === 2) && ( (next[1] === "D") || (next[1] === "A") ) ) {
                        isolated = false;
                        break;
                    }
                }
            }
        }
        return isolated;
    }

    // mutates this.scores directly
    public scoreCircles() {
        const circles = [...this.board.entries()].filter(([,v]) => v[1] === "C");
        for (const [cell, pc] of circles) {
            if (this.isIsolated(cell)) {
                this.results.push({type: "set", what: "circle", where: cell});
                this.results.push({type: "deltaScore", delta: 2, who: pc[2]});
                this.scores[pc[2] - 1] += 2;
            }
        }
    }

    protected checkEOG(): FnapGame {
        if ([...this.board.keys()].length === 36) {
            this.gameover = true;
            this.scoreCircles();
            const score1 = this.getPlayerScore(1);
            const score2 = this.getPlayerScore(2);
            if (score1 > score2) {
                this.winner = [1];
            } else if (score1 < score2) {
                this.winner = [2];
            } else {
                this.winner = [this.fnap];
            }
        }

        if (this.gameover) {
            this.results.push({type: "eog"});
            this.results.push({type: "winners", players: [...this.winner]});
        }

        return this;
    }

    public getPlayerScore(player: playerid): number {
        return this.scores[player - 1];
    }

    public state(): IFnapState {
        return {
            game: FnapGame.gameinfo.uid,
            numplayers: 2,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: FnapGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            lastmove: (this.lastmove === undefined ? [] : this.lastmove.split(',')),
            board: new Map(this.board),
            fnap: this.fnap,
            scores: [...this.scores],
            phase: this.phase,
            passing: this.passing,
            selected: [...this.selected],
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < 6; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const contents: string[] = [];
            for (let col = 0; col < 6; col++) {
                const cell = FnapGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    contents.push(`x${this.board.get(cell)!.join("")}`);
                } else {
                    contents.push("");
                }
            }
            pstr += contents.join(",");
        }
        pstr = pstr.replace(/\n,{5}(?=\n)/g, "\n_");

        const legend: {[k: string]: string|Glyph|[Glyph, ...Glyph[]]} = {}
        for (let val = 0; val <= 5; val++) {
            for (const type of ["O","D","A","C"] as const) {
                for (const player of [1,2] as playerid[]) {
                    const key = `x${val}${type}${player}`;
                    let piece: string;
                    switch (type) {
                        case "A":
                            piece = "cross-omni";
                            break;
                        case "O":
                            piece = "cross-orth";
                            break;
                        case "D":
                            piece = "cross-diag";
                            break;
                        default:
                            piece = "circle"
                    }
                    legend[key] = [
                        {
                            name: piece,
                            player,
                        },
                        {
                            "name": "piece-borderless",
                            "scale": 0.4
                        },
                        {
                            "text": val.toString(),
                            "scale": 0.4
                        }
                        ];
                }
            }
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares",
                width: 6,
                height: 6,
            },
            legend,
            pieces: pstr
        };

        // areas
        rep.areas = [];
        if (this.selected.length > 0) {
            rep.areas.push({
                type: "pieces",
                pieces: [...this.selected].filter(s => s !== undefined && s !== null && s !== "").map(s => `x${s}`) as [string, ...string[]],
                label: i18next.t("apgames:validation.fnap.LABEL_SELECTED") || "local",
            });
        }
        for (const player of [1,2] as playerid[]) {
            const stash = this.genStash(player).map(pc => `x${pc.join("")}`);
            // @ts-ignore
            rep.areas.push({
                type: "pieces",
                pieces: [...stash] as [string, ...string[]],
                label: i18next.t("apgames:validation.fnap.LABEL_STASH", {playerNum: player}) || "local",
            });
        }


        if (this.stack[this.stack.length - 1]._results.length > 0) {
        // if (this.results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
            // for (const move of this.results) {
                if (move.type === "place") {
                    // eslint-disable-next-line prefer-const
                    let [x, y] = FnapGame.algebraic2coords(move.where!);
                    rep.annotations.push({
                        type: "enter",
                        targets: [
                            {col: x, row: y}
                        ]
                    });
                }
            }
        }

        return rep;
    }

    public status(): string {
        let status = super.status();

        status += "**Scores**\n\n";
        status += `Player 1: ${this.getPlayerScore(1)}\n\n`;
        status += `Player 2: ${this.getPlayerScore(2)}\n\n`;
        status += `FNAP token is held by player ${this.fnap}\n\n`;
        return status;
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] },
            { name: i18next.t("apgames:status.fnap"), scores: this.fnap === 1 ? ["\u2021", ""] : ["", "\u2021"] }
        ]
    }

    public chatLog(players: string[]): string[][] {
        const result: string[][] = [];
        for (const state of this.stack) {
            if ( (state._results !== undefined) && (state._results.length > 0) ) {
                const node: string[] = [(state._timestamp && new Date(state._timestamp).toISOString()) || "unknown"];
                for (const r of state._results) {
                    switch (r.type) {
                        case "select":
                            node.push(i18next.t("apresults:SELECT.fnap", {player: players[r.who! - 1], tile: r.what as string}));
                            break;
                        case "pass":
                            node.push(i18next.t("apresults:PASS.simple", {player: players[r.who! - 1]}));
                            break;
                        case "place":
                            node.push(i18next.t("apresults:PLACE.complete", {player: players[r.who! - 1], what: r.what, where: r.where}));
                            break;
                        case "claim":
                            node.push(i18next.t("apresults:CLAIM.fnap", {context: r.what as string, player: players[r.who! - 1], where: r.where}));
                            break;
                        case "deltaScore":
                            node.push(i18next.t("apresults:DELTA_SCORE_GAIN", {delta: r.delta, count: r.delta, player: players[r.who! - 1]}));
                            break;
                        case "set":
                            if ( ("what" in r) && (r.what !== undefined) ) {
                                node.push(i18next.t("apresults:SET.fnap_circles", {where: r.where}));
                            } else {
                                node.push(i18next.t("apresults:SET.fnap_triplets", {count: r.count, player: players[r.who! - 1]}));
                            }
                            break;
                        case "eog":
                            node.push(i18next.t("apresults:EOG"));
                            break;
                        case "resigned":
                            let rname = `Player ${r.player}`;
                            if (r.player <= players.length) {
                                rname = players[r.player - 1]
                            }
                            node.push(i18next.t("apresults:RESIGN", {player: rname}));
                            break;
                        case "winners":
                            const names: string[] = [];
                            for (const w of r.players) {
                                if (w <= players.length) {
                                    names.push(players[w - 1]);
                                } else {
                                    names.push(`Player ${w}`);
                                }
                            }
                            node.push(i18next.t("apresults:WINNERS", {count: r.players.length, winners: names.join(", ")}));
                            break;
                    }
                }
                result.push(node);
            }
        }
        return result;
    }

    public isEliminated(player: playerid): boolean {
        if (this.passing === player) {
            return true;
        }
        return false;
    }

    public clone(): FnapGame {
        return new FnapGame(this.serialize());
    }
}
