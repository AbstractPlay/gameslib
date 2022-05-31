/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { IGraph, SquareGraph, SnubSquareGraph, HexTriGraph } from "../common/graphs";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

export type playerID = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerID;
    board: Map<string, playerID[]>;
    lastmove?: string;
    pieces: [number, number];
};

export interface IAbandeState extends IAPGameState {
    winner: playerID[];
    stack: Array<IMoveState>;
};

export class AbandeGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Abande",
        uid: "abande",
        playercounts: [2],
        version: "20211112",
        // i18next.t("apgames:descriptions.abande")
        description: "apgames:descriptions.abande",
        urls: ["https://spielstein.com/games/abande/rules"],
        people: [
            {
                type: "designer",
                name: "Dieter Stein",
                urls: ["https://spielstein.com/"]
            }
        ],
        variants: [
            {
                uid: "snub",
                name: "Board: Snub Square",
                group: "board",
                // i18next.t("apgames:variants.abande.snub")
                description: "apgames:variants.abande.snub",
            },
            {
                uid: "hex",
                name: "Board: Hexagonal",
                group: "board",
                // i18next.t("apgames:variants.abande.hex")
                description: "apgames:variants.abande.hex",
            }
        ],
        flags: ["limited-pieces", "scores"]
    };

    public numplayers = 2;
    public currplayer: playerID = 1;
    public board!: Map<string, playerID[]>;
    public pieces!: [number, number];
    public graph!: IGraph;
    public gameover = false;
    public winner: playerID[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IAbandeState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            const fresh: IMoveState = {
                _version: AbandeGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                pieces: [18, 18],
            };
            if ( (variants !== undefined) && (variants.length === 1) ) {
                if (variants[0] === "snub") {
                    this.variants = ["snub"];
                } else if (variants[0] === "hex") {
                    this.variants = ["hex"];
                }
            }
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IAbandeState;
            }
            if (state.game !== AbandeGame.gameinfo.uid) {
                throw new Error(`The Abande engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): AbandeGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = deepclone(state.board) as Map<string, playerID[]>;
        this.lastmove = state.lastmove;
        this.pieces = [...state.pieces];
        this.buildGraph();
        return this;
    }

    private buildGraph(): AbandeGame {
        if (this.variants.includes("snub")) {
            this.graph = new SnubSquareGraph(7, 7);
        } else if (this.variants.includes("hex")) {
            this.graph = new HexTriGraph(4, 7);
        } else {
            this.graph = new SquareGraph(7, 7);
        }
        return this;
    }

    public moves(player?: playerID): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        // If the board is empty, place a piece anywhere
        if (this.board.size === 0) {
            return this.graph.listCells() as string[];
        }

        const moves: string[] = [];
        // If you still have pieces, place a piece next to any existing piece
        if (this.pieces[player - 1] > 0) {
            for (const cell of this.board.keys()) {
                const neighbours = this.graph.neighbours(cell);
                for (const n of neighbours) {
                    if (! this.board.has(n)) {
                        moves.push(n);
                    }
                }
            }
        // If you don't have any pieces in hand, then passing is allowed
        } else {
            moves.push("pass");
        }

        // If the first player has placed two pieces, then movements are allowed
        if (this.pieces[0] <= 16) {
            const playerPieces = [...this.board.entries()].filter(e => e[1][e[1].length - 1] === player);
            for (const [cell, stack] of playerPieces) {
                const neighbours = this.graph.neighbours(cell);
                for (const n of neighbours) {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    const cloned: AbandeGame = Object.assign(new AbandeGame(), deepclone(this));
                    cloned.buildGraph();
                    // You can't move to empty spaces, only spaces occupied by opponents
                    if (cloned.board.has(n)) {
                        const contents = cloned.board.get(n);
                        if (contents === undefined) {
                            throw new Error("Cell was undefined");
                        }
                        // If it's an enemy stack and the stack is no more than 3, try it
                        if ( (stack.length + contents.length <= 3) && (contents[contents.length - 1] !== player) ) {
                            cloned.board.delete(cell);
                            cloned.board.set(n, [...contents, ...stack]);
                            // If connected, this is a possible move
                            if (cloned.isConnected()) {
                                moves.push(`${cell}-${n}`);
                            }
                        }
                    }
                }
            }
        }

        return moves;
    }

    public isConnected(): boolean {
        const seen: Set<string> = new Set();
        const todo: string[] = [[...this.board.keys()][0]];
        while (todo.length > 0) {
            const cell = todo.pop();
            if (cell === undefined) {
                throw new Error("Cell was undefined.");
            }
            seen.add(cell);
            const neighbours = this.graph.neighbours(cell);
            for (const n of neighbours) {
                if ( (this.board.has(n)) && (! seen.has(n)) ) {
                    todo.push(n);
                }
            }
        }
        return seen.size === this.board.size;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.graph.coords2algebraic(col, row);
            let newmove = "";
            if (move.length === 0) {
                newmove = cell;
            } else {
                const [from,] = move.split("-");
                if ( (from !== undefined) && (this.board.has(from)) && (this.board.has(cell)) ) {
                    newmove = `${from}-${cell}`;
                } else {
                    newmove = cell;
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
            result.message = i18next.t("apgames:validation.abande.INITIAL_INSTRUCTIONS")
            return result;
        }

        // Pass first
        if (m === "pass") {
            // can only pass if you have no pieces in hand
            if (this.pieces[this.currplayer - 1] > 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.abande.INVALIDPASS");
                return result;
            }
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        // Then placements
        } else if (! m.includes("-")) {
            // Invalid cell
            if (! allcells.includes(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: m});
                return result;
            }
            // Already occupied
            if (this.board.has(m)) {
                const contents = this.board.get(m)!;
                // stack you don't control
                if (contents[contents.length - 1] !== this.currplayer) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.UNCONTROLLED", {where: m});
                    return result;
                }
                // triple stack
                if (contents.length === 3) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.abande.TRIPLESTACK", {where: m});
                    return result;
                }
                // too early
                if (this.pieces[1] > 16) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.abande.TOOEARLY");
                    return result;
                }
                // possible success
                result.valid = true;
                result.complete = -1
                result.message = i18next.t("apgames:validation.abande.PARTIAL");
                return result;
            }
            // No pieces to place
            if (this.pieces[this.currplayer - 1] < 1) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NOPIECES");
                return result;
            }
            // disconnected placement
            if (this.board.size > 0) {
                const neighbours = this.graph.neighbours(m);
                let connected = false;
                for (const n of neighbours) {
                    if (this.board.has(n)) {
                        connected = true;
                        break;
                    }
                }
                if (! connected) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.abande.DISCONNECTEDPLACE", {where: m});
                    return result;
                }
            }

            // Apparently successful
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        } else {
            const [from, to] = m.split("-");
            // invalid coordinates
            if (! allcells.includes(from)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: from});
                return result;
            }
            if (! allcells.includes(to)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: to});
                return result;
            }
            // Cell is empty
            if (! this.board.has(from)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: from});
                return result;
            }
            // You don't control the moving stack
            const fContents = this.board.get(from)!;
            if (fContents[fContents.length - 1] !== this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.UNCONTROLLED", {where: m});
                return result;
            }
            // tried to move to an empty space
            if (! this.board.has(to)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.abande.MOVE2EMPTY", {from, to});
                return result;
            }
            const tContents = this.board.get(to)!;
            // tried to move on top of your own piece
            if (tContents[tContents.length - 1] === this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.abande.MOVE2CONTROLLED", {from, to});
                return result;
            }
            // tried to move and create a stack that's too high
            if (fContents.length + tContents.length > 3) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.abande.TOOHIGH", {from, to});
                return result;
            }
            // tried to move in a way that caused disconnection
            const cloned = this.clone();
            cloned.board.delete(from);
            if (! cloned.isConnected()) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.abande.DISCONNECTEDMOVE", {from, to});
                return result;
            }
            // You can't move until the first player has placed two stones
            if (this.pieces[0] > 16) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.abande.TOOEARLY");
                return result;
            }

            // Apparently successful
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
    }

    public move(m: string): AbandeGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        const result = this.validateMove(m);
        if (! result.valid) {
            throw new UserFacingError("VALIDATION_GENERAL", result.message)
        }
        if (! this.moves().includes(m)) {
            throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
        }

        this.results = [];
        // placement
        if (m.length === 2) {
            this.board.set(m, [this.currplayer]);
            this.pieces[this.currplayer - 1]--;
            this.results.push({type: "place", where: m});
        // movement
        } else if (m.includes("-")) {
            const [from, to] = m.split("-");
            const fContents = this.board.get(from);
            if (fContents === undefined) {
                throw new Error("Could not fetch board contents");
            }
            this.board.delete(from);
            if (this.board.has(to)) {
                const tContents = this.board.get(to);
                if (tContents === undefined) {
                    throw new Error(`Could not fetch board contents.`);
                }
                this.board.set(to, [...tContents, ...fContents]);
            } else {
                this.board.delete(from);
                this.board.set(to, [...fContents]);
            }
            this.results.push({type: "move", from, to});
        // otherwise this was a "pass" and we can just move on
        } else {
            this.results.push({type: "pass"});
        }

        // update currplayer
        this.lastmove = m;
        let newplayer = (this.currplayer as number) + 1;
        if (newplayer > this.numplayers) {
            newplayer = 1;
        }
        this.currplayer = newplayer as playerID;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): AbandeGame {
        if ( (this.lastmove === "pass") && (this.stack[this.stack.length - 1].lastmove === "pass") ) {
            this.gameover = true;
            const score1 = this.getPlayerScore(1);
            const score2 = this.getPlayerScore(2);
            if (score1 > score2) {
                this.winner = [1];
            } else if (score1 < score2) {
                this.winner = [2];
            } else {
                this.winner = [1, 2];
            }
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }

        return this;
    }

    public state(): IAbandeState {
        return {
            game: AbandeGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: AbandeGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: deepclone(this.board) as Map<string, playerID[]>,
            pieces: [...this.pieces],
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        const cells = this.graph.listCells(true);
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
        let board = {
            style: "vertex-cross",
            width: 7,
            height: 7,
        }
        if (this.variants.includes("hex")) {
            board = {
                style: "hex-of-tri",
                // @ts-ignore
                minWidth: 4,
                maxWidth: 7,
            };
        } else if (this.variants.includes("snub")) {
            board = {
                style: "snubsquare",
                width: 7,
                height: 7,
            };
        }
        const rep: APRenderRep =  {
            renderer: "stacking-offset",
            // @ts-ignore
            board,
            legend: {
                A: {
                    name: "piece",
                    player: 1
                },
                B: {
                    name: "piece",
                    player: 2
                }
            },
            pieces: pstr
        };

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

        status += "**Pieces In Hand**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const pieces = this.pieces[n - 1];
            status += `Player ${n}: ${pieces}\n\n`;
        }

        status += "**Scores**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const score = this.getPlayerScore(n);
            status += `Player ${n}: ${score}\n\n`;
        }

        return status;
    }

    protected getVariants(): string[] | undefined {
        if ( (this.variants === undefined) || (this.variants.length === 0) ) {
            return undefined;
        }
        const vars: string[] = [];
        for (const v of this.variants) {
            for (const rec of AbandeGame.gameinfo.variants!) {
                if (v === rec.uid) {
                    vars.push(rec.name);
                    break;
                }
            }
        }
        return vars;
    }

    protected getMoveList(): any[] {
        return this.getMovesAndResults(["move", "place"]);
    }

    public getPlayerPieces(player: number): number {
        return this.pieces[player - 1];
    }

    public getPlayerScore(player: number): number {
        let score = 0;
        for (const cell of this.board.keys()) {
            const contents = this.board.get(cell);
            if (contents === undefined) {
                throw new Error("Could not fetch cell contents");
            }
            if (contents[contents.length - 1] === player) {
                const neighbours = this.graph.neighbours(cell);
                for (const n of neighbours) {
                    const nContents = this.board.get(n);
                    if ( (nContents !== undefined) && (nContents[nContents.length - 1] !== player) ) {
                        score += contents.length;
                        break;
                    }
                }
            }
        }
        return score;
    }
   
    public clone(): AbandeGame {
        return new AbandeGame(this.serialize());
    }
}
