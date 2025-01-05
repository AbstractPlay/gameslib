import { GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, Glyph, IsoPiece, MarkerFlood, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { IGraph3D, SquareDiag3DGraph, SquareOrth3DGraph } from "../common/graphs";
import { Square3DGraph } from "../common/graphs";
import { connectedComponents } from "graphology-components";
import { bidirectional } from "graphology-shortest-path";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-var-requires
const deepclone = require("rfdc/default");

export type playerid = 1|2;
export type size = 1|2|3|4;
export type TerracePiece = {owner: playerid, size: size, royal: boolean}

type FlatLegend = {
    [key: string]: Glyph|[Glyph, ...Glyph[]];
}
type IsoLegend = {
    [key: string]: IsoPiece;
}

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, TerracePiece>;
    lastmove?: string;
};

export interface ITerraceState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class TerraceGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Terrace",
        uid: "terrace",
        playercounts: [2],
        version: "20250104",
        dateAdded: "2023-06-18",
        // i18next.t("apgames:descriptions.terrace")
        description: "apgames:descriptions.terrace",
        urls: [
            "https://boardgamegeek.com/boardgame/2872/terrace",
            "https://boardgamegeek.com/boardgame/15676/terrace-6x6",
            "https://web.archive.org/web/20060430134129/http://www.terracegames.com/rules.html",
            "https://boardgamegeek.com/thread/551125/variant-for-more-aggressive-less-drawish-play",
        ],
        people: [
            {
                type: "designer",
                name: "Anton Dresden",
                urls: ["https://boardgamegeek.com/boardgamedesigner/1171/anton-dresden"],
            },
            {
                type: "designer",
                name: "Buzz Siler",
                urls: ["https://boardgamegeek.com/boardgamedesigner/1172/buzz-siler"],
            }
        ],
        displays: [{ uid: "flat" }],
        categories: ["goal>royal-escape", "goal>royal-capture", "mechanic>move", "mechanic>capture", "board>3d", "board>shape>rect", "board>connect>rect", "components>special"],
        flags: ["experimental"],
        variants: [
            {
                uid: "board-8",
                group: "board",
            },
            {
                uid: "long",
                group: "setup",
            },
            {
                uid: "assassination",
                group: "capture",
            }
        ],
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, TerracePiece>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public dots: string[] = [];

    constructor(state?: ITerraceState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const board = new Map<string, TerracePiece>();
            if (this.variants.includes("board-8")) {
                if (this.variants.includes("long")) {
                    board.set("a8", {owner: 2, size: 4, royal: false});
                    board.set("b8", {owner: 2, size: 4, royal: false});
                    board.set("c8", {owner: 2, size: 3, royal: false});
                    board.set("d8", {owner: 2, size: 3, royal: false});
                    board.set("e8", {owner: 2, size: 2, royal: false});
                    board.set("f8", {owner: 2, size: 2, royal: false});
                    board.set("g8", {owner: 2, size: 1, royal: false});
                    board.set("h8", {owner: 2, size: 1, royal: true});
                    board.set("a7", {owner: 2, size: 1, royal: false});
                    board.set("b7", {owner: 2, size: 1, royal: false});
                    board.set("c7", {owner: 2, size: 2, royal: false});
                    board.set("d7", {owner: 2, size: 2, royal: false});
                    board.set("e7", {owner: 2, size: 3, royal: false});
                    board.set("f7", {owner: 2, size: 3, royal: false});
                    board.set("g7", {owner: 2, size: 4, royal: false});
                    board.set("h7", {owner: 2, size: 4, royal: false});

                    board.set("a1", {owner: 1, size: 1, royal: true});
                    board.set("b1", {owner: 1, size: 1, royal: false});
                    board.set("c1", {owner: 1, size: 2, royal: false});
                    board.set("d1", {owner: 1, size: 2, royal: false});
                    board.set("e1", {owner: 1, size: 3, royal: false});
                    board.set("f1", {owner: 1, size: 3, royal: false});
                    board.set("g1", {owner: 1, size: 4, royal: false});
                    board.set("h1", {owner: 1, size: 4, royal: false});
                    board.set("a2", {owner: 1, size: 4, royal: false});
                    board.set("b2", {owner: 1, size: 4, royal: false});
                    board.set("c2", {owner: 1, size: 3, royal: false});
                    board.set("d2", {owner: 1, size: 3, royal: false});
                    board.set("e2", {owner: 1, size: 2, royal: false});
                    board.set("f2", {owner: 1, size: 2, royal: false});
                    board.set("g2", {owner: 1, size: 1, royal: false});
                    board.set("h2", {owner: 1, size: 1, royal: false});
                } else {
                    board.set("b8", {owner: 2, size: 1, royal: true});
                    board.set("c8", {owner: 2, size: 2, royal: false});
                    board.set("d8", {owner: 2, size: 2, royal: false});
                    board.set("e8", {owner: 2, size: 3, royal: false});
                    board.set("f8", {owner: 2, size: 3, royal: false});
                    board.set("g8", {owner: 2, size: 4, royal: false});

                    board.set("b1", {owner: 1, size: 4, royal: false});
                    board.set("c1", {owner: 1, size: 3, royal: false});
                    board.set("d1", {owner: 1, size: 3, royal: false});
                    board.set("e1", {owner: 1, size: 2, royal: false});
                    board.set("f1", {owner: 1, size: 2, royal: false});
                    board.set("g1", {owner: 1, size: 1, royal: true});
                }
            } else {
                if (this.variants.includes("long")) {
                    board.set("a6", {owner: 2, size: 3, royal: false});
                    board.set("b6", {owner: 2, size: 3, royal: false});
                    board.set("c6", {owner: 2, size: 2, royal: false});
                    board.set("d6", {owner: 2, size: 2, royal: false});
                    board.set("e6", {owner: 2, size: 1, royal: false});
                    board.set("f6", {owner: 2, size: 1, royal: true});
                    board.set("a5", {owner: 2, size: 1, royal: false});
                    board.set("b5", {owner: 2, size: 1, royal: false});
                    board.set("c5", {owner: 2, size: 2, royal: false});
                    board.set("d5", {owner: 2, size: 2, royal: false});
                    board.set("e5", {owner: 2, size: 3, royal: false});
                    board.set("f5", {owner: 2, size: 3, royal: false});

                    board.set("a1", {owner: 1, size: 1, royal: true});
                    board.set("b1", {owner: 1, size: 1, royal: false});
                    board.set("c1", {owner: 1, size: 2, royal: false});
                    board.set("d1", {owner: 1, size: 2, royal: false});
                    board.set("e1", {owner: 1, size: 3, royal: false});
                    board.set("f1", {owner: 1, size: 3, royal: false});
                    board.set("a2", {owner: 1, size: 3, royal: false});
                    board.set("b2", {owner: 1, size: 3, royal: false});
                    board.set("c2", {owner: 1, size: 2, royal: false});
                    board.set("d2", {owner: 1, size: 2, royal: false});
                    board.set("e2", {owner: 1, size: 1, royal: false});
                    board.set("f2", {owner: 1, size: 1, royal: false});
                } else {
                    board.set("b6", {owner: 2, size: 1, royal: true});
                    board.set("c6", {owner: 2, size: 2, royal: false});
                    board.set("d6", {owner: 2, size: 2, royal: false});
                    board.set("e6", {owner: 2, size: 3, royal: false});

                    board.set("b1", {owner: 1, size: 3, royal: false});
                    board.set("c1", {owner: 1, size: 2, royal: false});
                    board.set("d1", {owner: 1, size: 2, royal: false});
                    board.set("e1", {owner: 1, size: 1, royal: true});
                }
            }
            const fresh: IMoveState = {
                _version: TerraceGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ITerraceState;
            }
            if (state.game !== TerraceGame.gameinfo.uid) {
                throw new Error(`The Terrace engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): TerraceGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        this.board = deepclone(state.board) as Map<string, TerracePiece>;
        this.lastmove = state.lastmove;
        return this;
    }

    public getGraph(type: "omni"|"orth"|"diag" = "omni"): IGraph3D {
        const hm = this.heightmap;
        if (this.variants.includes("board-8")) {
            switch (type) {
                case "omni":
                    return new Square3DGraph(8,8, hm);
                case "orth":
                    return new SquareOrth3DGraph(8,8, hm);
                case "diag":
                    return new SquareDiag3DGraph(8,8, hm);
            }
        } else {
            switch (type) {
                case "omni":
                    return new Square3DGraph(6,6, hm);
                case "orth":
                    return new SquareOrth3DGraph(6,6, hm);
                case "diag":
                    return new SquareDiag3DGraph(6,6, hm);
            }
        }
    }

    public get boardSize(): number {
        if (this.variants.includes("board-8")) {
            return 8;
        } else {
            return 6;
        }
    }

    public get heightmap(): number[][] {
        if (this.variants.includes("board-8")) {
            return [
                [8,7,6,5,4,3,2,1],
                [7,7,6,5,4,3,2,2],
                [6,6,6,5,4,3,3,3],
                [5,5,5,5,4,4,4,4],
                [4,4,4,4,5,5,5,5],
                [3,3,3,4,5,6,6,6],
                [2,2,3,4,5,6,7,7],
                [1,2,3,4,5,6,7,8],
            ];
        } else {
            return [
                [6,5,4,3,2,1],
                [5,5,4,3,2,2],
                [4,4,4,3,3,3],
                [3,3,3,4,4,4],
                [2,2,3,4,5,5],
                [1,2,3,4,5,6],
            ];
        }
    }

    public moves(): string[] {
        if (this.gameover) { return []; }

        const g = this.getGraph();
        const gOrth = this.getGraph("orth");
        const gDiag = this.getGraph("diag");
        const moves: string[] = [];

        const mine = [...this.board.entries()].filter(([, piece]) => piece.owner === this.currplayer).map(([cell, piece]) => { return {location: cell, ...piece}; });

        for (const piece of mine) {
            const thisElev = g.elevation(piece.location);
            // moving up
            const adjUp = g.neighbours(piece.location).filter(cell => !this.board.has(cell) && g.elevation(cell) === thisElev + 1);
            for (const cell of adjUp) {
                moves.push(`${piece.size}${piece.location}-${cell}`);
            }
            // moving down
            const adjDown = gOrth.neighbours(piece.location).filter(cell => !this.board.has(cell) && g.elevation(cell) === thisElev - 1);
            for (const cell of adjDown) {
                moves.push(`${piece.size}${piece.location}-${cell}`);
            }
            // moving laterally
            // With an orth-only graph, drop all cells of a different elevation.
            // Then find the connected group that contains the moving piece.
            // Then, for each empty cell, check that there's a path that doesn't involve
            // an enemy piece (only simple paths are possible, thankfully)
            let newg = gOrth.graph.copy();
            for (const node of newg.nodes()) {
                if (g.elevation(node) !== thisElev) {
                    newg.dropNode(node);
                }
            }
            const group = connectedComponents(newg).find(grp => grp.includes(piece.location));
            if (group !== undefined) {
                const empty = group.filter(cell => !this.board.has(cell));
                newg = gOrth.graph.copy();
                for (const node of newg.nodes()) {
                    if (! group.includes(node)) {
                        newg.dropNode(node);
                    }
                }
                for (const cell of empty) {
                    const path = bidirectional(newg, piece.location, cell);
                    if (path !== null) {
                        let clear = true;
                        for (const node of path) {
                            if (this.board.has(node) && this.board.get(node)!.owner !== this.currplayer) {
                                clear = false;
                                break;
                            }
                        }
                        if (clear) {
                            moves.push(`${piece.size}${piece.location}-${cell}`);
                        }
                    }
                }
            }
            // basic captures
            if (!this.variants.includes("assassination")) {
                const adj = gDiag.neighbours(piece.location).filter(cell => this.board.has(cell) && gDiag.elevation(cell) === thisElev - 1);
                for (const cell of adj) {
                    if (this.board.get(cell)!.size <= piece.size) {
                        // different notation for canibalizing
                        if (this.board.get(cell)!.owner === this.currplayer) {
                            moves.push(`${piece.size}${piece.location}*${cell}`);
                        } else {
                            moves.push(`${piece.size}${piece.location}x${cell}`);
                        }
                    }
                }
            }
            // ranked captures
            else {
                // up straight, I must be larger
                const capUp = gOrth.neighbours(piece.location).filter(cell => this.board.has(cell) && gOrth.elevation(cell) === thisElev + 1 && this.board.get(cell)!.size < piece.size);
                // same level, I must be at least same size
                const capSame = g.neighbours(piece.location).filter(cell => this.board.has(cell) && gOrth.elevation(cell) === thisElev && this.board.get(cell)!.size <= piece.size);
                // down diagonal, I must be at least 1 size smaller
                const capDown = gDiag.neighbours(piece.location).filter(cell => this.board.has(cell) && gDiag.elevation(cell) === thisElev - 1 && this.board.get(cell)!.size > piece.size);
                // up straight, my king attacking a largest piece
                const largest: size = this.variants.includes("board-8") ? 4 : 3;
                const assassinations = gOrth.neighbours(piece.location).filter(cell => this.board.has(cell) && gOrth.elevation(cell) === thisElev + 1 && this.board.get(cell)!.size === largest && piece.royal);

                for (const cell of [...capUp, ...capSame, ...capDown, ...assassinations]) {
                    // different notation for canibalizing
                    if (this.board.get(cell)!.owner === this.currplayer) {
                        moves.push(`${piece.size}${piece.location}*${cell}`);
                    } else {
                        moves.push(`${piece.size}${piece.location}x${cell}`);
                    }
                }
            }
        }

        return moves.sort((a,b) => a.localeCompare(b));
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const g = this.getGraph();
            const cell = g.coords2algebraic(col, row);
            let newmove = "";
            // if starting a new move, must be clicking on a piece
            if (move.length === 0) {
                const realpc = this.board.get(cell);
                if (realpc !== undefined) {
                    newmove = `${realpc.size}${cell}`;
                }
            }
            // otherwise, assume you are extending the first part
            else {
                const [from,] = move.split(/[-x*]/);
                const topc = this.board.get(cell);
                // a move
                if (topc === undefined) {
                    newmove = `${from}-${cell}`;
                }
                // canibalize
                else if (topc.owner === this.currplayer) {
                    newmove = `${from}*${cell}`;
                }
                // capture
                else {
                    newmove = `${from}x${cell}`;
                }
            }

            // autocomplete moves when there is only one option
            const starts = this.moves().filter(m => m.startsWith(newmove));
            if (starts.length === 1) {
                newmove = starts[0];
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

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.terrace.INITIAL_INSTRUCTIONS")
            return result;
        }

        const allmoves = this.moves();
        if (allmoves.includes(m)) {
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        const [from, to] = m.split(/[-x*]/);
        const fCell = from.substring(1);
        const g = this.getGraph();
        // from is a valid cell
        try {
            g.algebraic2coords(fCell);
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_CELL", {cell: fCell});
            return result;
        }
        const fElev = g.elevation(fCell);

        // from is a piece
        if (! this.board.has(fCell)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: fCell});
            return result;
        }
        const pcFrom = this.board.get(fCell)!;
        // from is yours
        if (pcFrom.owner !== this.currplayer) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
            return result;
        }

        // if to is empty, then possible partial
        if (to === undefined || to.length === 0) {
            // if no possible moves for that piece, then reject
            if (allmoves.filter(mv => mv.startsWith(m)).length === 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.terrace.NO_MOVES", {cell: fCell});
                return result;
            }

            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation._general.NEED_DESTINATION");
            return result;
        }
        else {
            // to is a valid cell
            try {
                g.algebraic2coords(to);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALID_CELL", {cell: to});
                return result;
            }

            const tElev = g.elevation(to);
            // find movement errors
            if (m.includes("-")) {
                if (fElev === tElev) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.terrace.MOVE_SAME_LEVEL");
                    return result;
                } else if (fElev > tElev) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.terrace.MOVE_DOWN");
                    return result;
                } else {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.terrace.MOVE_UP");
                    return result;
                }
            }
            // capture errors
            else {
                if (!this.variants.includes("assassination")) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.terrace.BAD_CAPTURE", {context: "standard"});
                    return result;
                } else {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.terrace.BAD_CAPTURE", {context: "ranked"});
                    return result;
                }
            }
        }
    }

    public move(m: string, {trusted = false, partial = false} = {}): TerraceGame {
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
            if ( (!partial) && (! this.moves().includes(m)) ) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        const [from, to] = m.split(/[-x*]/);
        const fCell = from.substring(1);

        // if partial, populate dots and get out
        if (partial || (to === undefined) || (to.length === 0)) {
            this.dots = [...this.moves().filter(mv => mv.startsWith(m)).map(mv => mv.split(/[-x*]/)[1])];
            return this;
        }

        this.dots = [];
        this.results = [];
        // replace piece
        const pcFrom = this.board.get(fCell)!;
        const pcTo = this.board.get(to);
        this.board.delete(fCell);
        this.board.set(to, pcFrom);
        this.results.push({type: "move", from: fCell, to, what: pcFrom.size.toString()});
        if (m.includes("x") || m.includes("*")) {
            this.results.push({type: "capture", where: to, what: pcTo!.size.toString(), whose: pcTo!.owner});
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

    protected checkEOG(): TerraceGame {
        const otherPlayer = this.currplayer === 1 ? 2 : 1;
        const targets = new Map<playerid, string>([
            [1, this.variants.includes("board-8") ? "h8" : "f6"],
            [2, "a1"],
        ]);

        // if no moves, then draw
        if (this.moves().length === 0) {
            this.gameover = true;
            this.winner = [1,2];
        }
        // if current player has no royal piece, they lose
        else if ([...this.board.values()].filter(pc => pc.owner === this.currplayer && pc.royal).length === 0) {
            this.gameover = true;
            this.winner = [otherPlayer];
        }
        // if other player has no royal piece, they lose (can only happen by self capture)
        else if ([...this.board.values()].filter(pc => pc.owner === otherPlayer && pc.royal).length === 0) {
            this.gameover = true;
            this.winner = [this.currplayer];
        }
        // if previous player has their royal piece in the target cell, they win
        else if (this.board.has(targets.get(otherPlayer)!) && this.board.get(targets.get(otherPlayer)!)!.owner === otherPlayer && this.board.get(targets.get(otherPlayer)!)!.royal) {
            this.gameover = true;
            this.winner = [otherPlayer];
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): ITerraceState {
        return {
            game: TerraceGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: TerraceGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            board: deepclone(this.board) as Map<string, TerracePiece>,
        };
    }

    public render(opts?: IRenderOpts): APRenderRep {
        let altDisplay: string | undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }
        let isIso = true;
        let pcHeight = 15;
        if (altDisplay !== undefined && altDisplay.startsWith("isometric")) {
            isIso = true;
            const [,heightStr] = altDisplay.split("-");
            if (heightStr !== undefined) {
                pcHeight = parseInt(heightStr, 10);
            }
        } else if (altDisplay !== undefined && altDisplay === "flat") {
            isIso = false;
        }
        // Build piece string
        const pstr: string[][][] = [];
        for (let row = 0; row < this.boardSize; row++) {
            const pieces: string[][] = [];
            for (let col = 0; col < this.boardSize; col++) {
                const cell = TerraceGame.coords2algebraic(col, row, this.boardSize);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    pieces.push([`${contents.owner === 1 ? "A" : "B"}${contents.royal ? "T" : contents.size}`]);
                } else {
                    pieces.push([]);
                }
            }
            pstr.push(pieces);
        }

        // build legend with distance marker tiles
        let myLegend: FlatLegend|IsoLegend;
        if (isIso) {
            myLegend = {
                "A1": {
                    piece: "cylinder",
                    height: pcHeight,
                    scale: this.boardSize === 8 ? 0.25 : 0.33,
                    colour: 1,
                },
                "A2": {
                    piece: "cylinder",
                    height: pcHeight * 2,
                    scale: this.boardSize === 8 ? 0.5 : 0.66,
                    colour: 1,
                },
                "A3": {
                    piece: "cylinder",
                    height: pcHeight * 3,
                    scale: this.boardSize === 8 ? 0.75 : 0.95,
                    colour: 1,
                },
                "A4": {
                    piece: "cylinder",
                    height: pcHeight * 4,
                    scale: 0.95,
                    colour: 1,
                },
                "AT": {
                    piece: "cube",
                    height: pcHeight,
                    scale: this.boardSize === 8 ? 0.25 : 0.33,
                    colour: 1,
                },
                "B1": {
                    piece: "cylinder",
                    height: pcHeight,
                    scale: this.boardSize === 8 ? 0.25 : 0.33,
                    colour: 2,
                },
                "B2": {
                    piece: "cylinder",
                    height: pcHeight * 2,
                    scale: this.boardSize === 8 ? 0.5 : 0.66,
                    colour: 2,
                },
                "B3": {
                    piece: "cylinder",
                    height: pcHeight * 3,
                    scale: this.boardSize === 8 ? 0.75 : 0.95,
                    colour: 2,
                },
                "B4": {
                    piece: "cylinder",
                    height: pcHeight * 4,
                    scale: 0.95,
                    colour: 2,
                },
                "BT": {
                    piece: "cube",
                    height: pcHeight,
                    scale: this.boardSize === 8 ? 0.25 : 0.33,
                    colour: 2,
                },
            } as IsoLegend;
        } else {
            myLegend = {
                "A1": {
                    name: "piece",
                    scale: this.boardSize === 8 ? 0.25 : 0.33,
                    colour: 1,
                },
                "A2": {
                    name: "piece",
                    scale: this.boardSize === 8 ? 0.5 : 0.66,
                    colour: 1,
                },
                "A3": {
                    name: "piece",
                    scale: this.boardSize === 8 ? 0.75 : 1,
                    colour: 1,
                },
                "A4": {
                    name: "piece",
                    scale: 1,
                    colour: 1,
                },
                "AT": {
                    name: "piece-square",
                    scale: this.boardSize === 8 ? 0.25 : 0.33,
                    colour: 1,
                },
                "B1": {
                    name: "piece",
                    scale: this.boardSize === 8 ? 0.25 : 0.33,
                    colour: 2,
                },
                "B2": {
                    name: "piece",
                    scale: this.boardSize === 8 ? 0.5 : 0.66,
                    colour: 2,
                },
                "B3": {
                    name: "piece",
                    scale: this.boardSize === 8 ? 0.75 : 1,
                    colour: 2,
                },
                "B4": {
                    name: "piece",
                    scale: 1,
                    colour: 2,
                },
                "BT": {
                    name: "piece-square",
                    scale: this.boardSize === 8 ? 0.25 : 0.33,
                    colour: 2,
                },
            } as FlatLegend;
        }

        let rep: APRenderRep;
        const heightmap = this.heightmap;
        if (isIso) {
            const realhm = heightmap.map(row => row.map(h => (h-1) * pcHeight));

            // Build rep
            rep =  {
                renderer: "isometric",
                board: {
                    style: "squares",
                    width: this.boardSize,
                    height: this.boardSize,
                    heightmap: realhm as [[number, ...number[]], ...[number, ...number[]][]],
                },
                legend: myLegend,
                pieces: pstr as [string[][], ...string[][][]],
            };
        } else {
            const opacities = new Map<number, [number,number][]>();
            const unit = 1 / this.boardSize;
            for (let row = 0; row < this.boardSize; row++) {
                for (let col = 0; col < this.boardSize; col++) {
                    const opacity = 1 - ((this.boardSize - (heightmap[row][col] - 1)) * unit);
                    if (!opacities.has(opacity)) {
                        opacities.set(opacity, [[col, row]]);
                    } else {
                        const curr = opacities.get(opacity)!;
                        opacities.set(opacity, [...curr, [col, row]]);
                    }
                }
            }

            // create the board markers
            const markers: MarkerFlood[] = [];
            for (const [k, v] of opacities.entries()) {
                const points: RowCol[] = [];
                for (const pt of v) {
                    points.push({row: pt[1], col: pt[0]});
                }
                markers.push({
                    type: "flood",
                    points: points as [RowCol, ...RowCol[]],
                    colour: {
                        func: "flatten",
                        bg: "_context_background",
                        fg: "_context_fill",
                        opacity: k,
                    }
                });
            }

            // Build rep
            rep =  {
                board: {
                    style: "squares",
                    width: this.boardSize,
                    height: this.boardSize,
                    markers,
                },
                legend: myLegend,
                pieces: pstr as [string[][], ...string[][][]],
            };
        }

        // Add annotations
        if (this.results.length > 0) {
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "move") {
                    const [fromX, fromY] = TerraceGame.algebraic2coords(move.from, this.boardSize);
                    const [toX, toY] = TerraceGame.algebraic2coords(move.to, this.boardSize);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "capture") {
                    const [x, y] = TerraceGame.algebraic2coords(move.where!, this.boardSize);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                }
            }
        }
        if (this.dots.length > 0) {
            const g = this.getGraph();
            if (!("annotations" in rep) || rep.annotations === undefined) {
                rep.annotations = [];
            }
            rep.annotations.push({
                type: "dots",
                targets: this.dots.map(cell => {
                    const [x, y] = g.algebraic2coords(cell);
                    return {row: y, col: x};
                }) as [RowCol, ...RowCol[]],
            });
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
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.terrace", {player, where: r.where, what: r.what}));
                resolved = true;
                break;
            case "move":
                node.push(i18next.t("apresults:PLACE.terrace", {player, size: r.what, from: r.from, to: r.to}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): TerraceGame {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        return Object.assign(new TerraceGame(), deepclone(this) as TerraceGame);
    }
}
