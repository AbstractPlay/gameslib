// import { IGame } from "./IGame";
import { GameBaseSimultaneous, IAPGameState, IClickResult, IIndividualState, IStatus, IStashEntry, IScores, IValidationResult, IRenderOpts } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, BoardEntropy, Glyph } from "@abstractplay/renderer/src/schemas/schema";
import { RectGrid } from "../common";
import { Direction } from "../common";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, shuffle, UserFacingError } from "../common";
import i18next from "i18next";

type playerid = 1|2;
type CellContents = "RD"|"BU"|"GN"|"YE"|"VT"|"OG"|"BN";
const allColours: CellContents[] = ["RD","BU","GN","YE","VT","OG","BN"]
type Phases = "order"|"chaos";
const startBag: CellContents[] = [];
for (const colour of allColours) {
    for (let i = 0; i < 7; i++) {
        startBag.push(colour);
    }
}

interface ICountObj {
    [key: string]: number;
}

export interface IMoveState extends IIndividualState {
    board1: Map<string, CellContents>;
    board2: Map<string, CellContents>;
    phase: Phases;
    bag: CellContents[];
    lastmove: string[];
};

export interface IEntropyState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class EntropyGame extends GameBaseSimultaneous {
    public static readonly gameinfo: APGamesInformation = {
        name: "Entropy",
        uid: "entropy",
        playercounts: [2],
        version: "20211101",
        dateAdded: "2023-05-01",
        // i18next.t("apgames:descriptions.entropy")
        description: "apgames:descriptions.entropy",
        // i18next.t("apgames:notes.entropy")
        notes: "apgames:notes.entropy",
        urls: [
            "https://boardgamegeek.com/boardgame/1329/hyle",
        ],
        people: [
            {
                type: "designer",
                name: "Eric Solomon"
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        categories: ["goal>score>eog", "mechanic>asymmetry", "mechanic>coopt", "mechanic>move", "mechanic>place", "mechanic>random>play", "board>shape>rect", "board>connect>rect", "components>simple>7c"],
        flags: ["simultaneous", "shared-pieces", "shared-stash", "perspective", "scores"]
    };

    public static coords2algebraic(x: number, y: number): string {
        return GameBaseSimultaneous.coords2algebraic(x, y, 7);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBaseSimultaneous.algebraic2coords(cell, 7);
    }

    public numplayers = 2;
    public board1!: Map<string, CellContents>;
    public board2!: Map<string, CellContents>;
    public bag!: CellContents[];
    public phase!: Phases;
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = []
    public variants: string[] = [];
    public highlight?: string;

    constructor(state?: IEntropyState | string) {
        super();
        if (state !== undefined) {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IEntropyState;
            }
            if (state.game !== EntropyGame.gameinfo.uid) {
                throw new Error(`The Entropy game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.stack = [...state.stack];
        } else {
            const fresh: IMoveState = {
                _version: EntropyGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                lastmove: [],
                bag: shuffle(startBag) as CellContents[],
                board1: new Map(),
                board2: new Map(),
                phase: "chaos"
            };
            this.stack = [fresh];
        }
        this.load();
    }

    public load(idx = -1): EntropyGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.board1 = new Map(state.board1);
        this.board2 = new Map(state.board2);
        this.bag = [...state.bag];
        this.phase = state.phase;
        this.lastmove = state.lastmove.join(',');
        return this;
    }

    public moves(player: 1|2): string[] {
        if (this.gameover) {
            return [];
        }
        const moves: string[] = [];
        if (this.phase === "chaos") {
            let theirBoard: Map<string, CellContents> = this.board2;
            if (player === 2) {
                theirBoard = this.board1;
            }
            for (let row = 0; row < 7; row++) {
                for (let col = 0; col < 7; col++) {
                    const cell = EntropyGame.coords2algebraic(col, row);
                    if (! theirBoard.has(cell)) {
                        moves.push(cell);
                    }
                }
            }
        } else {
            let myBoard: Map<string, CellContents> = this.board1;
            if (player === 2) {
                myBoard = this.board2;
            }
            const grid = new RectGrid(7, 7);
            for (const cell of myBoard.keys()) {
                const coords = EntropyGame.algebraic2coords(cell);
                for (const dir of ["N" as Direction, "E" as Direction, "S" as Direction, "W" as Direction]) {
                    let ray = grid.ray(...coords, dir);
                    while ( (ray.length > 0) && (! myBoard.has(EntropyGame.coords2algebraic(...ray[0]))) ) {
                        moves.push(`${cell}-${EntropyGame.coords2algebraic(...ray[0])}`);
                        ray = ray.slice(1);
                    }
                }
            }
            moves.push("pass");
        }
        return moves;
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
            const cell = EntropyGame.coords2algebraic(col, row);
            let myboard = this.board1;
            if (player === 2) {
                myboard = this.board2;
            }
            let theirboard = this.board2;
            if (player === 2) {
                theirboard = this.board1;
            }
            let newmove = "";
            if (move.length === 0) {
                if ( (this.phase === "order") && (myboard.has(cell)) ) {
                    newmove = cell;
                } else if ( (this.phase === "chaos") && (! theirboard.has(cell)) ) {
                    newmove = cell;
                } else {
                    return {move: "", message: i18next.t("apgames:validation.entropy.INITIAL_INSTRUCTIONS", {context: this.phase})} as IClickResult;
                }
            } else {
                const [from,] = move.split("-");
                if (this.phase === "order") {
                    if (cell === from) {
                        return {move: "", message: i18next.t("apgames:validation.entropy.INITIAL_INSTRUCTIONS", {context: this.phase})} as IClickResult;
                    } else if (! myboard.has(cell)) {
                        newmove = `${from}-${cell}`;
                    } else {
                        newmove = cell;
                    }
                } else {
                    if (cell === from) {
                        return {move: "", message: i18next.t("apgames:validation.entropy.INITIAL_INSTRUCTIONS", {context: this.phase})} as IClickResult;
                    } else if (! theirboard.has(cell)) {
                        newmove = cell;
                    }
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

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            if (this.phase === "order") {
                result.message = i18next.t("apgames:validation.entropy.INITIAL_INSTRUCTIONS", {context: "order"});
            } else {
                result.message = i18next.t("apgames:validation.entropy.INITIAL_INSTRUCTIONS", {context: "chaos"});
            }
            return result;
        }

        // pass is always valid in ORDER phase
        if ( (m === "pass") && (this.phase === "order") ) {
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        let myboard = this.board1;
        if (player === 2) {
            myboard = this.board2;
        }
        let theirboard = this.board2;
        if (player === 2) {
            theirboard = this.board1;
        }

        const [from, to] = m.split("-");
        if (this.phase === "chaos") {
            if (to !== undefined) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.entropy.INVALID_MOVEMENT");
                return result;
            }
            // valid cell
            try {
                EntropyGame.algebraic2coords(from);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: from});
                return result;
            }
            // cell is empty
            if (theirboard.has(from)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: from});
                return result;
            }

            // valid final move
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        } else {
            // valid cell
            let xFrom: number; let yFrom: number;
            try {
                [xFrom, yFrom] = EntropyGame.algebraic2coords(from);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: from});
                return result;
            }
            // cell is occupied
            if (! myboard.has(from)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: from});
                return result;
            }
            // if no `to`
            if (to === undefined) {
                // valid partial
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.entropy.PARTIAL");
                return result;
            } else {
                // valid cell
                let xTo: number; let yTo: number;
                try {
                    [xTo, yTo] = EntropyGame.algebraic2coords(to);
                } catch {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: to});
                    return result;
                }
                // final cell is empty
                if (myboard.has(to)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: to});
                    return result;
                }
                // straight lines only
                const bearing = RectGrid.bearing(xFrom, yFrom, xTo, yTo);
                if ( (bearing === undefined) || (bearing.length !== 1) ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.entropy.STRAIGHT_LINES");
                    return result;
                }
                // no obstructions
                const between = RectGrid.between(xFrom, yFrom, xTo, yTo).map(pt => EntropyGame.coords2algebraic(...pt));
                for (const cell of between) {
                    if (myboard.has(cell)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.OBSTRUCTED", {from, to, obstruction: cell});
                        return result;
                    }
                }

                // valid complete move
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
        }
    }

    public move(m: string, {partial = false, trusted = false} = {}): EntropyGame {
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
            moves[i] = moves[i].toLowerCase();
            moves[i] = moves[i].replace(/\s+/g, "");
            if (! trusted) {
                const result = this.validateMove(moves[i], (i + 1) as playerid);
                if (! result.valid) {
                    throw new UserFacingError("VALIDATION_GENERAL", result.message)
                }
                // if (! ((partial && moves[i] === "") || this.moves((i + 1) as playerid).includes(moves[i]))) {
                // if (! partial && this.moves((i + 1) as playerid).includes(moves[i])) {
                //     throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
                // }
            }
        }

        this.lastmove = [...moves].join(',');
        const myboard = [this.board1, this.board2];
        const theirboard = [this.board2, this.board1];
        this.results = [];
        let next: CellContents | undefined;
        if (this.phase === "chaos") {
            next = this.bag.pop();
        }
        for (let i = 0; i < moves.length; i++) {
            if (moves[i] !== "") {
                if (moves[i] === "pass") {
                    this.results.push({type: "pass"});
                    continue;
                } else if (moves[i].includes("-") || this.phase === "order") {
                    const [from, to] = moves[i].split("-");
                    this.highlight = from;
                    if (to !== undefined) {
                        const piece = myboard[i].get(from);
                        if (piece === undefined) {
                            throw new Error(`Could not find a piece at ${from}`);
                        }
                        myboard[i].set(to, piece);
                        myboard[i].delete(from);
                        this.results.push({type: "move", from, to});
                    }
                } else if (! (partial && moves[i] === '')) {
                    if (next === undefined) {
                        throw new Error("Could not find a piece to place.");
                    }
                    this.highlight = moves[i];
                    theirboard[i].set(moves[i], next);
                    this.results.push({type: "place", what: next, where: moves[i]});
                    this.lastmove = this.lastmove.split(',').map((mv,idx) => (i === idx) ? `${next}${mv}` : mv).join(',');
                }
            }
        }

        if (! partial) {
            delete this.highlight;
            if (this.phase === "chaos") {
                this.phase = "order";
            } else {
                this.phase = "chaos";
            }
            // shuffle bag after placing
            this.bag = shuffle(this.bag) as CellContents[];

            this.checkEOG();
        }
        this.saveState();
        return this;
    }

    protected checkEOG(): EntropyGame {
        if ( (this.board1.size === 49) && (this.board2.size === 49) ) {
            this.gameover = true;
            this.results.push({type: "eog"});
            const score1 = this.getPlayerScore(1);
            const score2 = this.getPlayerScore(2);
            if (score1 > score2) {
                this.winner = [1];
                this.results.push({type: "winners", players: [1]});
            } else if (score2 > score1) {
                this.winner = [2];
                this.results.push({type: "winners", players: [2]});
            } else {
                this.winner = [1, 2];
                this.results.push({type: "winners", players: [1, 2]});
            }
        }
        return this;
    }

    public getPlayerScore(player: playerid): number {
        let score = 0;
        let board = this.board1;
        if (player === 2) {
            board = this.board2;
        }
        for (let row = 0; row < 7; row++) {
            score += this.scoreLine(this.getLine(board, [0, row], "E"));
        }
        for (let col = 0; col < 7; col++) {
            score += this.scoreLine(this.getLine(board, [col, 0], "S"));
        }
        return score;
    }

    private getLine(board: Map<string, CellContents>, start: [number, number], dir: Direction): string[] {
        const grid = new RectGrid(7, 7);
        const ray = [start, ...grid.ray(...start, dir)];
        // Convert coords to algebraic
        const cells = ray.map(c => EntropyGame.coords2algebraic(...c));
        // Convert cells into contents
        const pieces = cells.map(c => {
            if (board.has(c)) {
                return board.get(c) as string;
            } else {
                return "-";
            }
        });
        return [...pieces];
    }

    private scoreLine(line: string[]): number {
        if (line.length < 2) {
            return 0;
        }
        let score = 0;
        for (let len = 2; len <= line.length; len++) {
            for (let idx = 0; idx <= line.length - len; idx++) {
                const substr = line.slice(idx, idx + len);
                if (substr.includes("-")) {
                    continue;
                }
                if (substr.join("") === substr.reverse().join("")) {
                    score += substr.length;
                }
            }
        }
        return score;
    }

    public state(): IEntropyState {
        return {
            game: EntropyGame.gameinfo.uid,
            numplayers: 2,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: EntropyGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            lastmove: (this.lastmove === undefined ? [] : this.lastmove.split(',')),
            board1: new Map(this.board1),
            board2: new Map(this.board2),
            phase: this.phase,
            bag: [...this.bag]
        };
    }

    public render({perspective, altDisplay}: IRenderOpts): APRenderRep {
        let display: string|undefined;
        if (altDisplay !== undefined) {
            display = altDisplay;
        }
        // Build piece string
        let pstr = "";
        for (let row = 0; row < 7; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const contents1: string[] = [];
            const contents2: string[] = [];
            for (let col = 0; col < 7; col++) {
                const cell = EntropyGame.coords2algebraic(col, row);
                if (this.board1.has(cell)) {
                    contents1.push(this.board1.get(cell)!);
                } else {
                    contents1.push("");
                }
                if (this.board2.has(cell)) {
                    contents2.push(this.board2.get(cell)!);
                } else {
                    contents2.push("");
                }
            }
            pstr += [...contents1, ...contents2].join(",");
        }
        pstr = pstr.replace(/\n,{13}(?=\n)/g, "\n_");

        const board: BoardEntropy = {
            style: "entropy",
            orientation: "vertical",
            boardOne: { occluded: false, label: "" },
            boardTwo: { occluded: false, label: "" }
        };
        if (perspective !== undefined) {
            if (perspective === 1) {
                if (this.phase === "order") {
                    board.boardTwo!.occluded = true;
                } else {
                    board.boardOne!.occluded = true;
                }
            } else {
                if (this.phase === "order") {
                    board.boardOne!.occluded = true;
                } else {
                    board.boardTwo!.occluded = true;
                }
            }
        }
        if (this.phase === "order") {
            board.boardOne!.label = "Player 1: Order";
            board.boardTwo!.label = "Player 2: Order";
        } else {
            board.boardOne!.label = "Player 2: Chaos";
            board.boardTwo!.label = "Player 1: Chaos";
        }

        const legend : { [k: string]: [Glyph, ...Glyph[]]|Glyph } = {};
        allColours.forEach((c, i) => {
            let glyph: [Glyph, ...Glyph[]]|Glyph = { name: "piece", colour: i + 1 } as Glyph;
            if (display === "piece-numbers") {
                glyph = [
                    {
                        name: "piece",
                        colour: i + 1,
                    },
                    {
                        text: (i+1).toString(),
                        colour: {
                            func: "bestContrast",
                            bg: i + 1,
                            fg: ["#000000", "#ffffff"],
                        },
                    },
                ] as [Glyph, ...Glyph[]];
            }
            legend[c] = glyph;
        });

        // Build rep
        const rep: APRenderRep =  {
            renderer: "entropy",
            board,
            legend,
            pieces: pstr
        };

        // show the last two turns (place AND move)
        rep.annotations = [];
        if (this.highlight !== undefined) {
            const [col, row] = EntropyGame.algebraic2coords(this.highlight);
            let x = col;
            if ( (perspective === 1 && this.phase === "chaos") || (perspective === 2 && this.phase === "order") ) {
                x += 7;
            }
            rep.annotations.push({type: "dots", targets: [{col: x, row}]});
        }
        // check for pending annotations
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type !== "pass") {
                    if (move.type === "move") {
                        const [from, to] = [move.from, move.to];
                        // eslint-disable-next-line prefer-const
                        let [xFrom, yFrom] = EntropyGame.algebraic2coords(from);
                        if (perspective === 2) { xFrom += 7; }
                        // eslint-disable-next-line prefer-const
                        let [xTo, yTo] = EntropyGame.algebraic2coords(to);
                        if (perspective === 2) { xTo += 7; }
                        rep.annotations.push({
                            type: "move",
                            targets: [
                                {col: xFrom, row: yFrom},
                                {col: xTo, row: yTo}
                            ]
                        });
                    } else if (move.type === "place") {
                        // eslint-disable-next-line prefer-const
                        let [x, y] = EntropyGame.algebraic2coords(move.where!);
                        if (perspective === 1) { x += 7; }
                        rep.annotations.push({
                            type: "enter",
                            targets: [
                                {col: x, row: y}
                            ]
                        });
                    }
                }
            }
        }
        for (let turn = 1; turn <= 2; turn++) {
            // don't go out of bounds early in the game
            if (this.stack.length > turn) {
                // if all moves are in
                if (this.stack[this.stack.length - turn]._results.length === 2) {
                    for (let i = 0; i < 2; i++) {
                        const move = this.stack[this.stack.length - turn]._results[i];
                        if (move.type !== "pass") {
                            if (move.type === "move") {
                                const [from, to] = [move.from, move.to];
                                // eslint-disable-next-line prefer-const
                                let [xFrom, yFrom] = EntropyGame.algebraic2coords(from);
                                if (i === 1) { xFrom += 7; }
                                // eslint-disable-next-line prefer-const
                                let [xTo, yTo] = EntropyGame.algebraic2coords(to);
                                if (i === 1) { xTo += 7; }
                                rep.annotations.push({
                                    type: "move",
                                    targets: [
                                        {col: xFrom, row: yFrom},
                                        {col: xTo, row: yTo}
                                    ]
                                });
                            } else if (move.type === "place") {
                                // eslint-disable-next-line prefer-const
                                let [x, y] = EntropyGame.algebraic2coords(move.where!);
                                if (i === 0) { x += 7; }
                                rep.annotations.push({
                                    type: "enter",
                                    targets: [
                                        {col: x, row: y}
                                    ]
                                });
                            }
                        }
                    }
                }
            }
        }
        if (rep.annotations.length === 0) {
            delete rep.annotations;
        }
        return rep;
    }

    public nextPiece(): CellContents {
        return this.bag[this.bag.length - 1];
    }

    public bagContents(): ICountObj {
        return this.bag.reduce((obj, item) => {
            obj[item] = (obj[item] || 0) + 1;
            return obj;
          }, {} as ICountObj);
    }

    public status(): string {
        let status = super.status();

        status += `**Current phase**: ${this.phase}\n\n`;

        if (this.phase === "chaos") {
            status += `**Piece being placed**: ${this.nextPiece()}\n\n`;
        }

        status += `**Pieces still in the bag**: ${Object.entries(this.bagContents()).sort((a, b) => { return a[0].localeCompare(b[0]); }).map(p => p.join(": ")).join(", ")}\n\n`;

        status += "**Scores**\n\n";
        status += `Player 1: ${this.getPlayerScore(1)}\n\n`;
        status += `Player 2: ${this.getPlayerScore(2)}\n\n`;
        return status;
    }

    public statuses(isPartial: boolean): IStatus[] {
        const returned = [{ key: i18next.t("apgames:status.PHASE"), value: [i18next.t("apgames:status.entropy." + this.phase.toUpperCase())] } as IStatus];
        if (this.phase === "chaos" && !isPartial) {
            const key = i18next.t("apgames:status.TOPLACE");
            const value = { glyph: "piece", colour: allColours.findIndex(c => c === this.nextPiece()) + 1 };
            returned.push({ key, value: [value] });
        }
        return returned;
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)], spoiler: true }
        ]
    }

    public getSharedStash(): IStashEntry[] | undefined {
        return Object.entries(this.bagContents()).sort((a, b) => { return a[0].localeCompare(b[0]); }).map(
            p => { return {
                    count: p[1],
                    glyph: { name: "piece", colour: allColours.findIndex(c => c === p[0]) + 1 },
                    movePart: ""
                }});
    }

    public chatLog(players: string[]): string[][] {
        // move, place, pass, eog, resign, winners
        const result: string[][] = [];
        for (const state of this.stack) {
            if ( (state._results !== undefined) && (state._results.length > 0) ) {
                const node: string[] = [(state._timestamp && new Date(state._timestamp).toISOString()) || "unknown"];
                if (state._results.length >= 2) {
                    for (let p = 0; p < 2; p++) {
                        let name = `Player ${p + 1}`;
                        if (players.length >= p + 1) {
                            name = players[p];
                        }
                        const r = state._results[p];
                        switch (r.type) {
                            case "move":
                                node.push(i18next.t("apresults:MOVE.nowhat", {player: name, from: r.from, to: r.to}));
                                break;
                            case "place":
                                node.push(i18next.t("apresults:PLACE.complete", {player: name, what: r.what, where: r.where}));
                                break;
                            case "pass":
                                node.push(i18next.t("apresults:PASS.entropy", {player: name}));
                                break;
                        }
                    }
                }
                if (state._results.length > 2) {
                    for (const r of state._results) {
                        switch (r.type) {
                            case "eog":
                                node.push(i18next.t("apresults:EOG.default"));
                                break;
                            case "resigned": {
                                let rname = `Player ${r.player}`;
                                if (r.player <= players.length) {
                                    rname = players[r.player - 1]
                                }
                                node.push(i18next.t("apresults:RESIGN", {player: rname}));
                                break;
                            }
                            case "winners": {
                                const names: string[] = [];
                                for (const w of r.players) {
                                    if (w <= players.length) {
                                        names.push(players[w - 1]);
                                    } else {
                                        names.push(`Player ${w}`);
                                    }
                                }
                                if (r.players.length === 0)
                                    node.push(i18next.t("apresults:WINNERSNONE"));
                                else
                                    node.push(i18next.t("apresults:WINNERS", {count: r.players.length, winners: names.join(", ")}));

                                break;
                            }
                        }
                    }
                }
                result.push(node);
            }
        }
        return result;
    }

    public clone(): EntropyGame {
        return new EntropyGame(this.serialize());
    }
}
