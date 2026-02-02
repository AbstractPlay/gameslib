
import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, BoardBasic, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { IGraph, SquareGraph, SnubSquareGraph, HexTriGraph } from "../common/graphs";
import { ModularBoard } from "../common/modular/board";
import { Orientation } from "honeycomb-grid";
import { IHexCoord } from "../common/hexes";
import { ModularHex } from "../common/modular/hex";
// eslint-disable-next-line @typescript-eslint/no-require-imports
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
        dateAdded: "2023-05-01",
        // i18next.t("apgames:descriptions.abande")
        description: "apgames:descriptions.abande",
        urls: [
            "https://spielstein.com/games/abande/rules",
            "https://boardgamegeek.com/boardgame/21324/abande",
            "https://boardgamegeek.com/boardgameexpansion/57291/abande2",
        ],
        people: [
            {
                type: "designer",
                name: "Dieter Stein",
                urls: ["https://spielstein.com/"],
                apid: "e7f53920-5be9-406a-9d5c-baa0316ab4f4",
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
                uid: "snub",
                group: "board"
            },
            {
                uid: "hex",
                group: "board",
            },
            {
                uid: "libre",
                group: "board",
                experimental: true,
            }
        ],
        categories: ["goal>score>eog", "mechanic>place", "mechanic>stack", "board>shape>rect", "board>shape>hex", "board>connect>rect", "board>connect>hex", "board>connect>snub", "components>simple>1per"],
        flags: ["limited-pieces", "scores", "automove"]
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
    public hexBoard: ModularBoard|undefined;

    constructor(state?: IAbandeState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if ( (variants !== undefined) && (variants.length === 1) ) {
                this.variants = [...variants];
            }
            let pieces: [number,number] = [18,18];
            const board = new Map<string, playerID[]>();
            if (this.variants.includes("libre")) {
                board.set("0,0", [1]);
                board.set("1,0", [2]);
                pieces = [17,17];
            }
            const fresh: IMoveState = {
                _version: AbandeGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                pieces,
            };
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

    private static uid2hexCoord(uid: string): IHexCoord {
        const [q,r] = uid.split(",");
        return {q: parseInt(q, 10), r: parseInt(r, 10)};
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
        if (this.variants.includes("libre")) {
            this.genHexBoard();
        }
        return this;
    }

    private genHexBoard(): ModularBoard|undefined {
        if (this.variants.includes("libre")) {
            const hexes: IHexCoord[] = [...this.board.keys()].map(str => AbandeGame.uid2hexCoord(str));
            this.hexBoard = new ModularBoard({orientation: Orientation.POINTY, offset: 1, centres: hexes});
        }
        return undefined;
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

    public isStronglyConnected(hex: ModularHex): boolean {
        const ns = this.hexBoard!.neighbours(hex).filter(h => this.board.has(h.uid));
        return ns.length >= 2;
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
            if (this.variants.includes("libre")) {
                const empties = this.hexBoard!.hexes.filter(hex => ! this.board.has(hex.uid));
                for (const hex of empties) {
                    // strongly connected spaces are always allowed
                    if (this.isStronglyConnected(hex)) {
                        moves.push(hex.uid);
                    }
                    // otherwise must be adjacent to a strongly connected piece
                    else {
                        const neighbours = this.hexBoard!.neighbours(hex).filter(h => this.board.has(h.uid));
                        for (const n of neighbours) {
                            if (this.isStronglyConnected(n)) {
                                moves.push(hex.uid);
                                break;
                            }
                        }
                    }
                }
            }
            // normal play
            else {
                for (const cell of this.board.keys()) {
                    const neighbours = this.graph.neighbours(cell);
                    for (const n of neighbours) {
                        if (! this.board.has(n)) {
                            moves.push(n);
                        }
                    }
                }
            }
        // If you don't have any pieces in hand, then passing is allowed
        } else {
            moves.push("pass");
        }

        // in libre, you can't move until 4 pieces are on the board
        if (this.variants.includes("libre") && [...this.board.values()].flat().length > 4) {
            const playerPieces = [...this.board.entries()].filter(([,v]) => v[v.length - 1] === player).map(([k,v]) => [AbandeGame.uid2hexCoord(k), v] as [IHexCoord, playerID[]]).map(([k,v]) => [this.hexBoard!.getHexAtAxial(k.q, k.r)!, v] as [ModularHex, playerID[]]);
            for (const [hex, stack] of playerPieces) {
                const neighbours = this.hexBoard!.neighbours(hex);
                for (const n of neighbours) {
                    const cloned: AbandeGame = this.clone();
                    // You can't move to empty spaces, only spaces occupied by opponents
                    if (cloned.board.has(n.uid)) {
                        const contents = cloned.board.get(n.uid)!;
                        // If it's an enemy stack and the stack is no more than 3, try it
                        if ( (stack.length + contents.length <= 3) && (contents[contents.length - 1] !== player) ) {
                            cloned.board.delete(hex.uid);
                            cloned.board.set(n.uid, [...contents, ...stack]);
                            // If connected, this is a possible move
                            if (cloned.isConnected()) {
                                moves.push(`${hex.uid}->${n.uid}`);
                            }
                        }
                    }
                }
            }
        }
        // in normal play, you just have to wait for the first player to place two pieces
        else if (!this.variants.includes("libre") && this.pieces[0] <= 16) {
            const playerPieces = [...this.board.entries()].filter(e => e[1][e[1].length - 1] === player);
            for (const [cell, stack] of playerPieces) {
                const neighbours = this.graph.neighbours(cell);
                for (const n of neighbours) {
                    const cloned: AbandeGame = this.clone();
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
            const cell = todo.pop()!;
            seen.add(cell);
            // libre
            if (this.variants.includes("libre")) {
                const coords = AbandeGame.uid2hexCoord(cell);
                const hex = this.hexBoard!.getHexAtAxial(coords.q, coords.r);
                if (hex !== undefined) {
                    const neighbours = this.hexBoard!.neighbours(hex);
                    for (const n of neighbours) {
                        if ( (this.board.has(n.uid)) && (! seen.has(n.uid)) ) {
                            todo.push(n.uid);
                        }
                    }
                }
            }
            // normal play
            else {
                const neighbours = this.graph.neighbours(cell);
                for (const n of neighbours) {
                    if ( (this.board.has(n)) && (! seen.has(n)) ) {
                        todo.push(n);
                    }
                }
            }
        }
        return seen.size === this.board.size;
    }

    public randomMove(): string {
        const moves = this.moves();
        console.log(`${moves.length} moves found`);
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = "";
            // libre
            if (this.variants.includes("libre")) {
                // convert row,col to an actual hex
                const cell = this.hexBoard!.graph.coords2algebraic(col, row);
                const hex = this.hexBoard!.getHexAtAlgebraic(cell);
                if (hex !== undefined) {
                    if (move.length === 0) {
                        newmove = hex.uid;
                    } else {
                        const [from,] = move.split("->");
                        if ( (from !== undefined) && (this.board.has(from)) && (this.board.has(hex.uid)) ) {
                            newmove = `${from}->${hex.uid}`;
                        } else {
                            newmove = hex.uid;
                        }
                    }
                }
            }
            // normal play
            else {
                const cell = this.graph.coords2algebraic(col, row);
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
        }
        // all libre moves
        else if (this.variants.includes("libre")) {
            const allHexCells = this.hexBoard!.hexes.map(hex => hex.uid);
            // Then placements
            if (! m.includes("->")) {
                // Invalid cell
                if (! allHexCells.includes(m)) {
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
                    if (this.pieces[0] > 16) {
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
                    const coords = AbandeGame.uid2hexCoord(m);
                    const hex = this.hexBoard!.getHexAtAxial(coords.q, coords.r)!;
                    const neighbours = this.hexBoard!.neighbours(hex);
                    let connected = false;
                    for (const n of neighbours) {
                        if (this.board.has(n.uid)) {
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
                const [from, to] = m.split("->");
                // invalid coordinates
                if (! allHexCells.includes(from)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: from});
                    return result;
                }
                if (! allHexCells.includes(to)) {
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
                // Tried to move too far
                const coords = AbandeGame.uid2hexCoord(from);
                const hex = this.hexBoard!.getHexAtAxial(coords.q, coords.r)!;
                const neighbours = this.hexBoard!.neighbours(hex).map(h => h.uid);
                if (! neighbours.includes(to)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.abande.TOOFAR", {from, to});
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
                // You can't move until there are four stones on the board
                if (this.board.size < 4) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.abande.TOOEARLY_libre");
                    return result;
                }

                // Apparently successful
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
        }
        // normal play
        else {
            // Then placements
            if (! m.includes("-")) {
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
                    if (this.pieces[0] > 16) {
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
                // Tried to move too far
                const neighbours = this.graph.neighbours(from);
                if (! neighbours.includes(to)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.abande.TOOFAR", {from, to});
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

    }

    public move(m: string, {trusted = false} = {}): AbandeGame {
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
            if (! this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];
        if (m === "pass") {
            this.results.push({type: "pass"});
        }
        // libre
        else if (this.variants.includes("libre")) {
            // placement
            if (! m.includes("->")) {
                this.board.set(m, [this.currplayer]);
                this.pieces[this.currplayer - 1]--;
                this.results.push({type: "place", where: m});
            // movement
            } else if (m.includes("->")) {
                const [from, to] = m.split("->");
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
            } else {
                throw new Error("Unrecognized move format");
            }
        }
        // normal play
        else {
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
            } else {
                throw new Error("Unrecognized move format");
            }
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
        if (this.variants.includes("libre")) {
            return this.renderLibre();
        }

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
        let board: BoardBasic = {
            style: "vertex-cross",
            width: 7,
            height: 7,
        }
        if (this.variants.includes("hex")) {
            board = {
                style: "hex-of-tri",
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
            board,
            legend: {
                A: {
                    name: "piece",
                    colour: 1
                },
                B: {
                    name: "piece",
                    colour: 2
                }
            },
            pieces: pstr
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
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

    public renderLibre(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let y = 0; y < this.hexBoard!.height; y++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let x = 0; x < this.hexBoard!.width; x++) {
                const algebraic = this.hexBoard!.graph.coords2algebraic(x, y);
                const hex = this.hexBoard!.getHexAtAlgebraic(algebraic);
                if (hex !== undefined && this.board.has(hex.uid)) {
                    let str = this.board.get(hex.uid)!.join("");
                    str = str.replace(/1/g, "A");
                    str = str.replace(/2/g, "B");
                    pieces.push(str);
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join(",");
        }

        const blocked: RowCol[] = [];
        const labelGrid: string[][] = [];
        const placements = this.moves().filter(mv => !mv.includes("->"));
        for (let y = 0; y < this.hexBoard!.height; y++) {
            const node: string[] = [];
            for (let x = 0; x < this.hexBoard!.width; x++) {
                const algebraic = this.hexBoard!.graph.coords2algebraic(x, y);
                const hex = this.hexBoard!.getHexAtAlgebraic(algebraic);
                // If it's not in the grid at all, it's blocked
                if (hex === undefined) {
                    blocked.push({row: y, col: x});
                    node.push("");
                }
                // if it's occupied, it's definitely not blocked
                else if (this.board.has(hex.uid)) {
                    node.push(hex.uid);
                    continue;
                }
                // otherwise, see if it's a valid placement spot
                else {
                    if (!placements.includes(hex.uid)) {
                        blocked.push({row: y, col: x});
                        node.push("");
                    } else {
                        node.push(hex.uid);
                    }
                }
            }
            labelGrid.push(node);
        }

        // Build rep
        const rep: APRenderRep =  {
            renderer: "stacking-offset",
            board: {
                style: "hex-even-p",
                width: this.hexBoard!.width,
                height: this.hexBoard!.height,
                blocked,
                labelGrid,
                labelOpacity: 0.5,
            } as BoardBasic,
            legend: {
                A: {
                    name: "piece",
                    colour: 1
                },
                B: {
                    name: "piece",
                    colour: 2
                }
            },
            pieces: pstr
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const fromCoord = AbandeGame.uid2hexCoord(move.from);
                    const from = this.hexBoard!.getHexAtAxial(fromCoord.q, fromCoord.r)!;
                    const [fx, fy] = this.hexBoard!.hex2coords(from);
                    const toCoord = AbandeGame.uid2hexCoord(move.to);
                    const to = this.hexBoard!.getHexAtAxial(toCoord.q, toCoord.r)!;
                    const [tx, ty] = this.hexBoard!.hex2coords(to);
                    rep.annotations.push({type: "move", targets: [{row: fy, col: fx}, {row: ty, col: tx}]});
                } else if (move.type === "place") {
                    const coord = AbandeGame.uid2hexCoord(move.where!);
                    const hex = this.hexBoard!.getHexAtAxial(coord.q, coord.r)!;
                    const [x, y] = this.hexBoard!.hex2coords(hex);
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

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] },
            { name: i18next.t("apgames:status.PIECESINHAND"), scores: this.pieces }
        ]
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
                if (this.variants.includes("libre")) {
                    const coords = AbandeGame.uid2hexCoord(cell);
                    const hex = this.hexBoard!.getHexAtAxial(coords.q, coords.r)!;
                    const neighbours = this.hexBoard!.neighbours(hex);
                    for (const n of neighbours) {
                        const nContents = this.board.get(n.uid);
                        if ( (nContents !== undefined) && (nContents[nContents.length - 1] !== player) ) {
                            score += contents.length;
                            break;
                        }
                    }
                } else {
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
        }
        return score;
    }

    public clone(): AbandeGame {
        return new AbandeGame(this.serialize());
    }
}
