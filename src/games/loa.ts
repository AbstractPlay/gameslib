import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { SquareGraph, HexTriGraph, reviver, UserFacingError, Direction } from "../common";
import { HexDir } from "../common/graphs/hextri";
import i18next from "i18next";

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface ILinesOfActionState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class LinesOfActionGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Lines of Action",
        uid: "loa",
        playercounts: [2],
        version: "20211113",
        dateAdded: "2023-05-01",
        // i18next.t("apgames:descriptions.loa")
        description: "apgames:descriptions.loa",
        // i18next.t("apgames:notes.loa")
        notes: "apgames:notes.loa",
        urls: [
            "https://en.wikipedia.org/wiki/Lines_of_Action",
            "https://boardgamegeek.com/boardgame/3406/lines-of-action",
        ],
        people: [
            {
                type: "designer",
                name: "Claude Soucie",
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        variants: [
            {
                uid: "classic",
                group: "board",
                default: true,
            },
            { uid: "#board" },
            { uid: "hex5", group: "board" },
            { uid: "hex6", group: "board" },
            {
                uid: "scrambled",
                group: "setup"
            },
        ],
        categories: ["goal>unify", "mechanic>capture", "mechanic>move", "board>shape>rect", "board>shape>hex", "board>connect>rect", "board>connect>hex", "components>simple>1per"],
        flags: ["check", "limited-pieces", "automove"]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private _points: [number, number][] = []; // if there are points here, the renderer will show them

    constructor(state?: ILinesOfActionState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if ( (variants !== undefined) && (variants.length > 0) ) {
                this.variants = [...variants];
                if (this.variants.includes("hex5")) {
                    this.variants = this.variants.filter(v => v !== "scrambled");
                }
            }
            let board: Map<string,playerid>;
            if (this.variants.includes("classic")) {
                if (this.variants.includes("scrambled")) {
                    board = new Map<string, playerid>([
                        ["b8", 1], ["c8", 2], ["d8", 1], ["e8", 2], ["f8", 1], ["g8", 2],
                        ["b1", 2], ["c1", 1], ["d1", 2], ["e1", 1], ["f1", 2], ["g1", 1],
                        ["a2", 1], ["a3", 2], ["a4", 1], ["a5", 2], ["a6", 1], ["a7", 2],
                        ["h2", 2], ["h3", 1], ["h4", 2], ["h5", 1], ["h6", 2], ["h7", 1],
                    ]);
                } else {
                    board = new Map<string, playerid>([
                        ["b8", 1], ["c8", 1], ["d8", 1], ["e8", 1], ["f8", 1], ["g8", 1],
                        ["b1", 1], ["c1", 1], ["d1", 1], ["e1", 1], ["f1", 1], ["g1", 1],
                        ["a2", 2], ["a3", 2], ["a4", 2], ["a5", 2], ["a6", 2], ["a7", 2],
                        ["h2", 2], ["h3", 2], ["h4", 2], ["h5", 2], ["h6", 2], ["h7", 2],
                    ]);
                }
            } else if (this.variants.includes("hex5")) {
                board = new Map<string, playerid>([
                    ["i1", 2], ["i2", 1], ["i4", 2], ["i5", 1],
                    ["h1", 1], ["h6", 2],
                    ["f1", 2], ["f8", 1],
                    ["e1", 1], ["e9", 2],
                    ["d1", 2], ["d8", 1],
                    ["b1", 1], ["b6", 2],
                    ["a1", 2], ["a2", 1], ["a4", 2], ["a5", 1],
                ]);
            } else if (this.variants.includes("hex6")) {
                if (this.variants.includes("scrambled")) {
                    board = new Map<string, playerid>([
                        ["k2", 1], ["k3", 2], ["k4", 1], ["k5", 2],
                        ["j1", 2], ["j7", 1],
                        ["i1", 1], ["i8", 2],
                        ["h1", 2], ["h9", 1],
                        ["g1", 1], ["g10", 2],
                        ["e1", 2], ["e10", 1],
                        ["d1", 1], ["d9", 2],
                        ["c1", 2], ["c8", 1],
                        ["b1", 1], ["b7", 2],
                        ["a2", 2], ["a3", 1], ["a4", 2], ["a5", 1],
                    ]);
                } else {
                    board = new Map<string, playerid>([
                        ["k2", 1], ["k3", 1], ["k4", 1], ["k5", 1],
                        ["j1", 2], ["j7", 2],
                        ["i1", 2], ["i8", 2],
                        ["h1", 2], ["h9", 2],
                        ["g1", 2], ["g10", 2],
                        ["e1", 1], ["e10", 1],
                        ["d1", 1], ["d9", 1],
                        ["c1", 1], ["c8", 1],
                        ["b1", 1], ["b7", 1],
                        ["a2", 2], ["a3", 2], ["a4", 2], ["a5", 2],
                    ]);
                }
            } else {
                if (this.variants.includes("scrambled")) {
                    board = new Map<string, playerid>([
                        ["b9", 1], ["c9", 2], ["d9", 1], ["e9", 2], ["f9", 1], ["g9", 2], ["h9", 1],
                        ["b1", 1], ["c1", 2], ["d1", 1], ["e1", 2], ["f1", 1], ["g1", 2], ["h1", 1],
                        ["a2", 2], ["a3", 1], ["a4", 2], ["a5", 1], ["a6", 2], ["a7", 1], ["a8", 2],
                        ["i2", 2], ["i3", 1], ["i4", 2], ["i5", 1], ["i6", 2], ["i7", 1], ["i8", 2],
                    ]);
                } else {
                    board = new Map<string, playerid>([
                        ["b9", 1], ["c9", 1], ["d9", 1], ["e9", 1], ["f9", 1], ["g9", 1], ["h9", 1],
                        ["b1", 1], ["c1", 1], ["d1", 1], ["e1", 1], ["f1", 1], ["g1", 1], ["h1", 1],
                        ["a2", 2], ["a3", 2], ["a4", 2], ["a5", 2], ["a6", 2], ["a7", 2], ["a8", 2],
                        ["i2", 2], ["i3", 2], ["i4", 2], ["i5", 2], ["i6", 2], ["i7", 2], ["i8", 2],
                    ]);
                }
            }

            const fresh: IMoveState = {
                _version: LinesOfActionGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ILinesOfActionState;
            }
            if (state.game !== LinesOfActionGame.gameinfo.uid) {
                throw new Error(`The Lines of Action engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): LinesOfActionGame {
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

    public get boardsize(): number {
        if (this.variants.includes("classic")) {
            return 8;
        } else if (this.variants.includes("hex5")) {
            return 5;
        } else if (this.variants.includes("hex6")) {
            return 6;
        } else {
            return 9;
        }
    }

    public get graph(): SquareGraph|HexTriGraph {
        if (this.variants.includes("hex5")) {
            return new HexTriGraph(5, 9);
        } else if (this.variants.includes("hex6")) {
            return new HexTriGraph(6, 11);
        } else {
            return new SquareGraph(this.boardsize, this.boardsize);
        }
    }

    public isBlackHole(cell: string): boolean {
        if (this.variants.includes("classic") || this.variants.includes("hex5")) {
            return false;
        }
        if (this.variants.includes("hex6")) {
            if (cell === "f6") {
                return true;
            } else {
                return false;
            }
        } else {
            if (cell === "e5") {
                return true;
            } else {
                return false;
            }
        }
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves: string[] = [];

        const grid = this.graph;
        let dirPairs: ([Direction,Direction][])|([HexDir,HexDir][]) = [];
        if (this.variants.includes("hex5") || this.variants.includes("hex6")) {
            dirPairs = [["NE","SW"], ["NW", "SE"], ["E","W"]] as [HexDir,HexDir][];
        } else {
            dirPairs = [["N", "S"], ["E", "W"], ["NE", "SW"], ["NW", "SE"]] as [Direction,Direction][];
        }
        const pieces = [...this.board.entries()].filter(e => e[1] === player).map(e => e[0]);
        for (const cell of pieces) {
            const [x, y] = grid.algebraic2coords(cell);
            for (const pair of dirPairs) {
                const rays: [number, number][][] = [];
                let magnitude = 1;
                for (const d of pair) {
                    // @ts-expect-error: I don't have the patience to differentiate Direction and HexDir right now
                    const ray = grid.ray(x, y, d);
                    for (const point of ray) {
                        if (this.board.has(grid.coords2algebraic(...point))) {
                            magnitude++;
                        }
                    }
                    rays.push(ray);
                }
                for (const ray of rays) {
                    if (ray.length >= magnitude) {
                        let valid = true;
                        for (let i = 0; i < magnitude - 1; i++) {
                            const next = ray[i];
                            const nextCell = grid.coords2algebraic(...next);
                            if (this.board.has(nextCell)) {
                                const contents = this.board.get(nextCell);
                                if (contents !== player) {
                                    valid = false;
                                    break;
                                }
                            }
                        }
                        if (valid) {
                            const next = ray[magnitude - 1];
                            const nextCell = grid.coords2algebraic(...next);
                            if (this.board.has(nextCell)) {
                                const contents = this.board.get(nextCell);
                                if (contents !== player) {
                                    moves.push(`${cell}x${nextCell}`);
                                }
                            } else {
                                moves.push(`${cell}-${nextCell}`);
                            }
                        }
                    }
                }
            }
        }
        if (moves.length === 0) {
            moves.push("pass");
        }

        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    private findPoints(start: string): string[] | undefined {
        if (! this.board.has(start)) {
            return undefined;
        }
        const targets: string[] = [];
        const grid = this.graph;
        const [x, y] = grid.algebraic2coords(start);
        let dirPairs: ([Direction,Direction][])|([HexDir,HexDir][]) = [];
        if (this.variants.includes("hex5") || this.variants.includes("hex6")) {
            dirPairs = [["NE","SW"], ["NW", "SE"], ["E","W"]] as [HexDir,HexDir][];
        } else {
            dirPairs = [["N", "S"], ["E", "W"], ["NE", "SW"], ["NW", "SE"]] as [Direction,Direction][];
        }
        for (const pair of dirPairs) {
            // @ts-expect-error: I don't have the patience to differentiate Direction and HexDir right now
            const ray1 = grid.ray(x, y, pair[0]).map(pt => grid.coords2algebraic(...pt));
            // @ts-expect-error: I don't have the patience to differentiate Direction and HexDir right now
            const ray2 = grid.ray(x, y, pair[1]).map(pt => grid.coords2algebraic(...pt));
            const combined: string[] = [start, ...ray1, ...ray2];
            const numPieces = [...this.board.entries()].filter(e => combined.includes(e[0])).length;
            for (const ray of [ray1, ray2]) {
                if (ray.length >= numPieces) {
                    const next = ray[numPieces - 1];
                    if ( (! this.board.has(next)) || (this.board.get(next) !== this.currplayer) ) {
                        // check for obstructions
                        let blocked = false;
                        for (const mid of ray.slice(0, numPieces - 1)) {
                            if ( (this.board.has(mid)) && (this.board.get(mid) !== this.currplayer) ) {
                                blocked = true;
                                break;
                            }
                        }
                        if (! blocked) {
                            targets.push(next);
                        }
                    }
                }
            }
        }
        return targets;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const g = this.graph;
            const cell = g.coords2algebraic(col, row);
            let newmove = "";
            if (move.length > 0) {
                let prev = move;
                if (move.includes("-")) {
                    prev = move.split("-")[0];
                }
                // If you clicked on the previous cell, clear the move
                if (cell === prev) {
                    return {move: "", message: ""} as IClickResult;
                // otherwise, see if clicked cell is a valid move
                } else {
                    const pts = this.findPoints(prev)!;
                    if (pts.includes(cell)) {
                        if (this.board.has(cell)) {
                            newmove = `${prev}x${cell}`;
                        } else {
                            newmove = `${prev}-${cell}`;
                        }
                    // if it's a friendly piece, just switch to that piece instead
                    } else if ( (this.board.has(cell)) && (this.board.get(cell) === this.currplayer) ) {
                        newmove = cell;
                    }
                }
            } else if ( (this.board.has(cell)) && (this.board.get(cell) === this.currplayer) ) {
                newmove = cell;
            } else {
                return {move: "", message: ""} as IClickResult;
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
            result.complete = -1;
            result.message = i18next.t("apgames:validation.loa.INITIAL_INSTRUCTIONS");
            return result;
        }

        if (m === "pass") {
            const allMoves = this.moves();
            if (allMoves.length === 1 && allMoves.includes("pass")) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.loa.BAD_PASS");
                return result;
            }
        }

        const g = this.graph;
        const [from, to] = m.split(/[-x]/);
        if (from !== undefined) {
            // cell is valid
            try {
                g.algebraic2coords(from);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: from});
                return result;
            }
            // cell is occupied
            if (! this.board.has(from)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: from});
                return result;
            }
            // cell is yours
            if (this.board.get(from) !== this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.UNCONTROLLED", {cell: from});
                return result;
            }
            if (this.moves().filter(x => x.startsWith(from)).length < 1) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NO_MOVES", {where: from});
                return result;
            }

            // if no `to`, we're a good partial
            if (to === undefined) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.loa.PARTIAL");
                return result;
            } else {
                // cell is valid
                try {
                    g.algebraic2coords(to);
                } catch {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: to});
                    return result;
                }
                // cell is in range
                const pts = this.findPoints(from);
                if ( (pts === undefined) || (! pts.includes(to)) ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.loa.NOT_IN_RANGE", {from, to});
                    return result;
                }
                // cell is not yours
                if ( (this.board.has(to)) && (this.board.get(to) === this.currplayer) ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.SELFCAPTURE");
                    return result;
                }

                // we're good
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
        }
        return result;
    }

    public move(m: string, {partial = false, trusted = false} = {}): LinesOfActionGame {
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
            // } else if ( (partial) && (this.moves().filter(x => x.startsWith(m)).length < 1) ) {
            //     throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        const g = this.graph;
        this.results = [];
        if (m === "pass") {
            this.results.push({type: "pass"});
        } else {
            // if partial, just set the points and get out
            if ( (partial) && (! m.includes("-")) && (! m.includes("x")) ) {
                const [cell,] = m.split(/[-x]/);
                const pts = this.findPoints(cell);
                if (pts !== undefined) {
                    this._points = pts.map(c => g.algebraic2coords(c));
                } else {
                    this._points = [];
                }
                return this;
            // otherwise delete the points and process the full move
            } else {
                this._points = [];
            }

            const [from, to] = m.split(/[-x]/);
            this.board.delete(from);
            if (! this.isBlackHole(to)) {
                this.board.set(to, this.currplayer);
            }
            this.results.push({type: "move", from, to});
            if ( this.isBlackHole(to) ) {
                this.results.push({type: "capture", where: to})
            } else if (m.includes("x")) {
                this.results.push({type: "capture", where: to})
            }
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

    protected checkEOG(): LinesOfActionGame {
        const connected1 = this.isConnected(1);
        const connected2 = this.isConnected(2);

        if ( (connected1) || (connected2) ) {
            this.gameover = true;
            if ( (connected1) && (connected2) ) {
                this.winner = [1, 2];
            } else if (connected1) {
                this.winner = [1];
            } else {
                this.winner = [2];
            }
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }

        return this;
    }

    private isConnected(player: playerid): boolean {
        const pieces = [...this.board.entries()].filter(e => e[1] === player).map(e => e[0]);
        const grid = this.graph;
        const seen: Set<string> = new Set();
        const todo: string[] = [pieces[0]];
        while (todo.length > 0) {
            const cell = todo.pop();
            seen.add(cell!);
            const neighbours = grid.neighbours(cell!);
            for (const nCell of neighbours) {
                if (pieces.includes(nCell)) {
                    if (! seen.has(nCell)) {
                        todo.push(nCell);
                    }
                }
            }
        }
        return seen.size === pieces.length;
    }

    public state(): ILinesOfActionState {
        return {
            game: LinesOfActionGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: LinesOfActionGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    public render(): APRenderRep {
        const g = this.graph;
        // Build piece string
        let pstr = "";
        for (const row of g.listCells(true) as string[][]) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell);
                    if (contents === undefined) {
                        throw new Error("Malformed cell contents.");
                    }
                    if (contents === 1) {
                        pieces.push("A");
                    } else {
                        pieces.push("B");
                    }
                } else if (this.isBlackHole(cell)) {
                    pieces.push("X");
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join("");
        }

        // Build rep
        const rep: APRenderRep =  {
            board: (this.variants.includes("hex5") || this.variants.includes("hex6")) ?
            {
                style: "hex-of-hex",
                minWidth: this.boardsize,
                maxWidth: (this.boardsize * 2) - 1,
            } :
            {
                style: "squares-checkered",
                width: this.boardsize,
                height: this.boardsize,
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
                X: {
                    name: "piecepack-number-void",
                    colour: "#000"
                }
            },
            pieces: pstr
        };
        if (this.variants.includes("classic") || this.variants.includes("hex5")) {
            delete rep.legend!.X;
        }

        // Add annotations
        if ( (this.results.length > 0) || (this._points.length > 0) ){
            rep.annotations = [];

            if (this._points.length > 0) {
                const points = [];
                for (const cell of this._points) {
                    points.push({row: cell[1], col: cell[0]});
                }
                rep.annotations.push({type: "dots", targets: points as [{row: number; col: number;}, ...{row: number; col: number;}[]]});
            }

            for (const move of this.results) {
                if (move.type === "move") {
                    const [fromX, fromY] = g.algebraic2coords(move.from);
                    const [toX, toY] = g.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "capture") {
                    const [x, y] = g.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                }
            }
        }

        return rep;
    }

    public getPlayerPieces(player: number): number {
        return [...this.board.values()].filter(x => x === player).length;
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.PIECESREMAINING"), scores: [this.getPlayerPieces(1), this.getPlayerPieces(2)] }
        ]
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Pieces On Board:**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            status += `Player ${n}: ${this.getPlayerPieces(n)}\n\n`;
        }

        return status;
    }

    public inCheck(): number[] {
        const checked: number[] = [];
        for (const p of [1,2] as playerid[]) {
            let otherPlayer: playerid = 1;
            if (p === 1) {
                otherPlayer = 2;
            }
            const moves = this.moves(otherPlayer);
            for (const m of moves) {
                const cloned = this.clone();
                cloned.currplayer = otherPlayer;
                cloned.move(m);
                if ( (cloned.gameover) && (cloned.winner.includes(otherPlayer)) ) {
                    checked.push(p);
                    break;
                }
            }
        }
        return checked;
    }

    public clone(): LinesOfActionGame {
        return new LinesOfActionGame(this.serialize());
    }
}
