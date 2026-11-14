
import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base.js";
import type { APGamesInformation } from "../schemas/gameinfo.js";
import { APRenderRep } from "@abstractplay/renderer/build/schemas/schema";
import type { APMoveResult } from "../schemas/moveresults.js";
import { reviver, UserFacingError, cloneState } from "../common/index.js";
import i18next from "i18next";
import { IGraph, SnubSquareGraph } from "../common/graphs/index.js";

export const gameApgamesEn = {
    validation: {
        DISCONNECTEDMOVE: "A move from {{from}} to {{to}} would disconnect the band.",
        DISCONNECTEDPLACE: "Placing a piece at {{where}} would disconnect the band.",
        INITIAL_INSTRUCTIONS: "Place a piece on an empty space connected to the other pieces.",
        INVALIDPASS: "You cannot pass while you have pieces in hand.",
        MOVE2CONTROLLED: "You cannot capture your own stacks.",
        MOVE2EMPTY: "You cannot move to empty spaces.",
        PARTIAL: "It's possible you're trying to move a stack. Provide the destination.",
        TOOEARLY: "You cannot move until the first player has placed two pieces.",
        TOOEARLY_libre: "You cannot move until four stones have been placed on the board.",
        TOOFAR: "You can only move to an adjacent cell. {{to}} is not adjacent to {{from}}.",
        TOOHIGH: "Moving from {{from}} to {{to}} would result in a stack taller than three pieces high.",
        TRIPLESTACK: "You cannot move triple stacks.",
    },
    variants: {
        "size-6": {
            name: "6x6 board",
        },
        "size-7": {
            name: "7x7 board",
        },
        "#size": {
            name: "8x8 board",
        },
        "size-9": {
            name: "9x9 board",
        },
        "size-10": {
            name: "10x10 board",
        },
        "size-11": {
            name: "11x11 board",
        },
        "size-12": {
            name: "12x12 board",
        },
        "#variant": {
            description: "Directly attacked feet leave permanent remains.",
            name: "Polypods Base Game"
        },
        "Stoney-footed": {
            description: "All removed feet leave permanent remains.",
            name: "Stoney-footed Polypods"
        },
        "Energized": {
            description: "Eating remains gives a double move.",
            name: "Energized Polypods"
        },
        "Scavenging": {
            description: "Every removed piece leaves remains. Placing next to (or on) a remains marker eats one, but a move that eats can't also attack.",
            name: "Scavenging Polypods"
        },
    },
};


export type playerid = 1|2;
export type piecetype = "core"|"foot";
export type cellcontent = {
    player: playerid,
    type: piecetype
};
export type board = Map<string, cellcontent>;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: board;
    lastmove?: string;
};

export interface IPolypodsState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class PolypodsGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Polypods",
        uid: "polypods",
        playercounts: [2],
        version: "20261111",
        dateAdded: "2026-11-11",
        description: "Polypods are creatures of the snub-square grid. They are composed of connected pieces of 2 types: core and feet. Feet are the extremities, i.e. the pieces with only one similarly-colored adjacent piece, or with exactly 2 that fill the other points of a small triangle of the grid. Core are the other pieces that connect all the feet together. Cores are toxic to the feet of adjacent opponent polypods. Polypods need to have at least as many feet as cores to stay alive. The game of Polypods is about growing and protecting polypods of your colour so that you have the most polypod cores when the game ends. Some removed pieces leave remains. Variants differ in when exactly remains are generated, and how they affect further play.",
        urls: [
            "https://boardgamegeek.com/boardgame/466344/polypods"
        ],
        bggid: "466344",
        people: [
            {
                type: "designer",
                name: "Dale Walton",
                urls: ["https://boardgamegeek.com/boardgamedesigner/1988/dale-walton"],
                apid: "1f26a119-d9a4-4ff1-bbc7-ec599c07ea1e",
            },
            {
                type: "coder",
                name: "hoembla",
                urls: [],
                apid: "36926ace-08c0-417d-89ec-15346119abf2",
            },
        ],
        variants: [
            {
                uid: "size-6",
                group: "size"
            },
            {
                uid: "size-7",
                group: "size"
            },
            { uid: "#size" },
            {
                uid: "size-9",
                group: "size"
            },
            {
                uid: "size-10",
                group: "size"
            },
            {
                uid: "size-11",
                group: "size"
            },
            {
                uid: "size-12",
                group: "size"
            },
            { uid: "#variant" },
            {
                uid: "Stoney-footed",
                group: "variant",
            },
            {
                uid: "Energized",
                group: "variant",
            },
            {
                uid: "Scavenging",
                group: "variant",
            },

        ],
        categories: ["goal>score>eog", "mechanic>place", "board>shape>rect", "board>connect>snub"],
        flags: ["scores", "experimental"]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: board;
    public boardsize = 8;
    public graph: IGraph = this.getGraph();
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    public applyVariants(variants?: string[]) {
        this.variants = (variants !== undefined) ? [...variants] : [];
        for(const v of this.variants) {
            if(v.startsWith("size")) {
                const [,size] = v.split("-");
                this.boardsize = parseInt(size, 10);
                this.graph = this.getGraph();
            }
        }
    }

    constructor(state?: IPolypodsState | string, variants?: string[]) {
        super();

        if (state === undefined) {
            this.applyVariants(variants);
            const fresh: IMoveState = {
                _version: PolypodsGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map<string, cellcontent>(),
            };
            this.stack = [fresh];

        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IPolypodsState;
            }
            if (state.game !== PolypodsGame.gameinfo.uid) {
                throw new Error(`The Polypods engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.applyVariants(state.variants);
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): PolypodsGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];

        this.currplayer = state.currplayer;
        this.board = cloneState(state.board) as board;
        this.lastmove = state.lastmove;
        return this;
    }

    public otherPlayer(): playerid {
        return this.currplayer === 1 ? 2 : 1;
    }

    private getGraph(): IGraph {
        return new SnubSquareGraph(this.boardsize, this.boardsize, "T");
    }

    private updatePolypods(board: board): board {
        /* Update the */
        return board;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves = (this.graph.listCells() as string[]).filter((c) => (!this.board.has(c)));
        moves.push("pass");

        return moves;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let move = "";
            // normal play
            const cell = this.graph.coords2algebraic(col, row);
            if (move.length === 0) {
                move = cell;
            }

            const result = this.validateMove(move) as IClickResult;
            if (! result.valid) {
                result.move = "";
            } else {
                result.move = move;
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
            result.message = i18next.t("apgames:validation.bricka.INITIAL_INSTRUCTIONS");
            return result;
        }

        if (m === "pass") {
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        const cell = m;

        if (!this.graph.graph.hasNode(cell)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
            return result;
        }

        if (this.board.has(cell)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: cell});
            return result;
        }

        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {trusted = false} = {}): PolypodsGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:validation._general.MOVES_GAMEOVER"));
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
        } else {
            // placement
            this.board.set(m, {player: this.currplayer, type: "foot"});
            this.results.push({type: "place", where: m});
        }

        this.board = this.updatePolypods(this.board);

        // update currplayer
        this.lastmove = m;
        this.currplayer = this.otherPlayer();

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): PolypodsGame {
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

    public state(): IPolypodsState {
        return {
            game: PolypodsGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: PolypodsGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: cloneState(this.board) as board
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
                    const c = this.board.get(cell)!;
                    if (c.player === 1 && c.type === "foot") {
                        pieces.push("A");
                    } else if (c.player === 1 && c.type === "core") {
                        pieces.push("B");
                    } else if (c.player === 2 && c.type === "foot") {
                        pieces.push("C");
                    } else if (c.player === 2 && c.type === "core") {
                        pieces.push("D");
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join(",");
        }

        // Build rep
        const board = {
            style: "snubsquare",
            snubStart: "T",
            width: this.boardsize,
            height: this.boardsize,
            blocked: [{row: 0, col: 0}],
        };
        if (this.boardsize % 2 === 0) {
            board.blocked.push({row: this.boardsize-1, col: this.boardsize-1});
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
                    name: "piece-chariot",
                    colour: 1
                },
                C: {
                    name: "piece",
                    colour: 2
                },
                D: {
                    name: "piece-chariot",
                    colour: 2
                }
            },
            pieces: pstr
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
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

    public sidebarScores(): IScores[] {
        return [
            { name: this.neutralAreaLabel("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] }
        ]
    }

    public getPlayerScore(player: playerid): number {
        let score = [...this.board.values()].filter((c) => (c.player === player && c.type === "core")).length;
        return score;
    }

    public clone(): PolypodsGame {
        return new PolypodsGame(this.serialize());
    }
}
