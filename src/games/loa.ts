import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, UserFacingError, Directions } from "../common";
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
        urls: ["https://en.wikipedia.org/wiki/Lines_of_Action"],
        people: [
            {
                type: "designer",
                name: "Claude Soucie",
            }
        ],
        variants: [
            {
                uid: "scrambled",
                group: "setup"
            },
            {
                uid: "classic",
                group: "board"
            }
        ],
        categories: ["goal>unify", "mechanic>capture", "mechanic>move", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["multistep", "check", "limited-pieces"]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public gameover = false;
    public boardsize = 9;
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
            }
            let board: Map<string,playerid>;
            if (this.variants.includes("classic")) {
                this.boardsize = 8;
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
            this.variants = state.variants;
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

        if (this.variants.includes("classic")) {
            this.boardsize = 8;
        } else {
            this.boardsize = 9;
        }
        return this;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves: string[] = [];

        const grid = new RectGrid(this.boardsize, this.boardsize);
        const dirPairs: [Directions, Directions][] = [["N", "S"], ["E", "W"], ["NE", "SW"], ["NW", "SE"]];
        const pieces = [...this.board.entries()].filter(e => e[1] === player).map(e => e[0]);
        for (const cell of pieces) {
            const [x, y] = LinesOfActionGame.algebraic2coords(cell, this.boardsize);
            for (const pair of dirPairs) {
                const rays: [number, number][][] = [];
                let magnitude = 1;
                for (const d of pair) {
                    const ray = grid.ray(x, y, d);
                    for (const point of ray) {
                        if (this.board.has(LinesOfActionGame.coords2algebraic(...point, this.boardsize))) {
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
                            const nextCell = LinesOfActionGame.coords2algebraic(...next, this.boardsize);
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
                            const nextCell = LinesOfActionGame.coords2algebraic(...next, this.boardsize);
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
        const grid = new RectGrid(this.boardsize, this.boardsize);
        const [x, y] = LinesOfActionGame.algebraic2coords(start, this.boardsize);
        for (const pair of [["N", "S"] as const, ["E", "W"] as const, ["NE", "SW"] as const, ["NW", "SE"] as const]) {
            const ray1 = grid.ray(x, y, pair[0]).map(pt => LinesOfActionGame.coords2algebraic(...pt, this.boardsize));
            const ray2 = grid.ray(x, y, pair[1]).map(pt => LinesOfActionGame.coords2algebraic(...pt, this.boardsize));
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
            const cell = LinesOfActionGame.coords2algebraic(col, row, this.boardsize);
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

        const [from, to] = m.split(/[-x]/);
        if (from !== undefined) {
            // cell is valid
            try {
                LinesOfActionGame.algebraic2coords(from, this.boardsize);
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
                    LinesOfActionGame.algebraic2coords(to, this.boardsize);
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

        // if partial, just set the points and get out
        if ( (partial) && (! m.includes("-")) && (! m.includes("x")) ) {
            const [cell,] = m.split(/[-x]/);
            const pts = this.findPoints(cell);
            if (pts !== undefined) {
                this._points = pts.map(c => LinesOfActionGame.algebraic2coords(c, this.boardsize));
            } else {
                this._points = [];
            }
            return this;
        // otherwise delete the points and process the full move
        } else {
            this._points = [];
        }

        this.results = [];
        const [from, to] = m.split(/[-x]/);
        this.board.delete(from);
        if ( (this.variants.includes("classic")) || (to !== "e5") ) {
            this.board.set(to, this.currplayer);
        }
        this.results.push({type: "move", from, to});
        if ( (! this.variants.includes("classic")) && (to === "e5") ) {
            this.results.push({type: "capture", where: "e5"})
        } else if (m.includes("x")) {
            this.results.push({type: "capture", where: to})
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
        const grid = new RectGrid(this.boardsize, this.boardsize);
        const seen: Set<string> = new Set();
        const todo: string[] = [pieces[0]];
        while (todo.length > 0) {
            const cell = todo.pop();
            seen.add(cell!);
            const [x, y] = LinesOfActionGame.algebraic2coords(cell!, this.boardsize);
            const neighbours = grid.adjacencies(x, y);
            for (const n of neighbours) {
                const nCell = LinesOfActionGame.coords2algebraic(...n, this.boardsize);
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
        // Build piece string
        let pstr = "";
        for (let row = 0; row < this.boardsize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < this.boardsize; col++) {
                const cell = LinesOfActionGame.coords2algebraic(col, row, this.boardsize);
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
                } else if ( (! this.variants.includes("classic")) && (cell === "e5") ) {
                    pieces.push("X");
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join("");
        }
        if (this.variants.includes("classic")) {
            pstr = pstr.replace(/-{8}/g, "_");
        } else {
            pstr = pstr.replace(/-{9}/g, "_");
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-checkered",
                width: this.boardsize,
                height: this.boardsize,
            },
            legend: {
                A: {
                    name: "piece",
                    player: 1
                },
                B: {
                    name: "piece",
                    player: 2
                },
                X: {
                    name: "piecepack-number-void",
                    colour: "#000"
                }
            },
            pieces: pstr
        };
        if (this.variants.includes("classic")) {
            delete rep.legend!.X;
        }

        // Add annotations
        if ( (this.results.length > 0) || (this._points.length > 0) ){
            // @ts-ignore
            rep.annotations = [];

            if (this._points.length > 0) {
                const points = [];
                for (const cell of this._points) {
                    points.push({row: cell[1], col: cell[0]});
                }
                // @ts-ignore
                rep.annotations.push({type: "dots", targets: points});
            }

            for (const move of this.results) {
                if (move.type === "move") {
                    const [fromX, fromY] = LinesOfActionGame.algebraic2coords(move.from, this.boardsize);
                    const [toX, toY] = LinesOfActionGame.algebraic2coords(move.to, this.boardsize);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "capture") {
                    const [x, y] = LinesOfActionGame.algebraic2coords(move.where!, this.boardsize);
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
