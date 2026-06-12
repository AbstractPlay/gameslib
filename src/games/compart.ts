import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult, IScores, IRenderOpts } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, BoardBasic, MarkerDots, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError, SquareOrthGraph } from "../common";
import { connectedComponents } from "graphology-components";
import i18next from "i18next";

const PALETTE = [
        "#228B22", // Forest Green
        "#FF8C00", // Dark Orange
        "#8A2BE2", // Blue Violet
        "#FFD700", // Gold
        "#8B4513", // Saddle Brown
        "#FFC0CB", // Pink
        "#FFA07A", // Light Salmon
        "#BF00FF", // Electric Purple
    ]

export type playerid = 1 | 2;

type Territory = {
    cells: string[];
    owner: playerid | undefined;
};

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface ICompartState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class CompartGame extends GameBase {

    public static readonly gameinfo: APGamesInformation = {
        name: "Compart",
        uid: "compart",
        playercounts: [2],
        version: "20260612",
        dateAdded: "2026-06-12",
        // i18next.t("apgames:descriptions.compart")
        description: "apgames:descriptions.compart",
        urls: [
            "https://boardgamegeek.com/boardgame/385587/compart"
        ],
        people: [
            {
                type: "designer",
                name: "Luis Bolaños Mures",
                urls: ["https://boardgamegeek.com/boardgamedesigner/47001/luis-bolanos-mures"],
                apid: "6b518a3f-7f63-47b8-b92b-a04792fba8e7",
            },
            {
                type: "coder",
                name: "João Pedro Neto",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3829/joao-pedro-neto"],
                apid: "9228bccd-a1bd-452b-b94f-d05380e6638f",
            },
        ],
        categories: ["goal>score>eog", "mechanic>place", "board>shape>rect", "board>connect>rect"],
        variants: [
            { uid: "size-7", group: "board" },
            { uid: "#board", }, // 9x9
            { uid: "size-11", group: "board" },
            { uid: "size-13", group: "board" },
            { uid: "size-15", group: "board" },
            { uid: "size-19", group: "board" },
        ],
        flags: ["no-moves", "pie", "scores", "experimental"],
        displays: [{uid: "show-viable-areas"}],
    };

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardSize);
    }
    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardSize);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public boardSize = 9;
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: ICompartState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const board = new Map<string, playerid>();
            const fresh: IMoveState = {
                _version: CompartGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ICompartState;
            }
            if (state.game !== CompartGame.gameinfo.uid) {
                throw new Error(`The Compart engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): CompartGame {
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
        this.boardSize = this.getBoardSize();
        this.results = [...state._results];
        return this;
    }

    private getBoardSize(): number {
        // Get board size from variants.
        if ( (this.variants !== undefined) && (this.variants.length > 0) && (this.variants[0] !== undefined) && (this.variants[0].length > 0) ) {
            const sizeVariants = this.variants.filter(v => v.includes("size"));
            if (sizeVariants.length > 0) {
                const size = sizeVariants[0].match(/\d+/);
                return parseInt(size![0], 10);
            }
            if (isNaN(this.boardSize)) {
                throw new Error(`Could not determine the board size from variant "${this.variants[0]}"`);
            }
        }
        return 9;
    }

    private getGraph(): SquareOrthGraph { // just orthogonal connections
        return new SquareOrthGraph(this.boardSize, this.boardSize);
    }

    // get all viable areas of `player`
    private getTerritories(player?: playerid): Territory[] {
        player ??= this.currplayer;
        const oppPieces = [...this.board.entries()].filter(p => p[1] !== player).map(p => p[0]);

        // compute viable areas
        const g = this.getGraph();
        for (const node of g.graph.nodes()) {
            if (oppPieces.includes(node)) { // remove intersections with opponent pieces
                g.graph.dropNode(node);
            }
        }
        const viableAreas : Array<Array<string>> = connectedComponents(g.graph);

        const territories: Territory[] = [];
        for(const area of viableAreas) {
            // viable areas must have at least one empty cell
            if ( [...area].some(c => !this.board.has(c)) ) {
                territories.push({cells: area, owner: player});
            }
        }
        return territories;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            let newmove = "";

            if ( move === "" ) {
                newmove = cell;
            } else {
                const moves = move.split(",");
                if ( moves.includes(cell) ) { // check if the cell already was clicked
                    newmove = moves.filter(c => c !== cell).join(","); // if clicked, undo it
                } else {
                    newmove = `${move},${cell}`; // otherwise, append new cell
                }
            }

            const result = this.validateMove(newmove) as IClickResult;
            result.move = result.valid ? newmove : move;
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
        const result: IValidationResult = {valid: false,
                                           message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        const viableAreas = this.getTerritories();

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.compart.INSTRUCTIONS", {count: viableAreas.length})
            return result;
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        const moves = m.split(',');

        try { // check if cells are valid
            for (const cell of moves) { this.algebraic2coords(cell); }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
            return result;
        }

        const seenAreas: number[] = []; // keeps indices of areas already with placement

        for (const cell of moves) {
            if ( this.board.has(cell) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.compart.OCCUPIED");
                return result;
            }

            // check which viable area the cell belongs to
            let idx = 0;
            for (const area of viableAreas) {
                if ( area.cells.includes(cell) ) {
                    if ( seenAreas.includes(idx) ) { // a viable area can only have one placement
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.compart.VIABLE_AREA_REPEATED");
                        return result;
                    } else {
                        seenAreas.push(idx);
                    }
                }
                idx += 1;
            }
        }

        result.valid = true;
        result.complete = seenAreas.length < viableAreas.length ? -1 : 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {partial = false, trusted = false} = {}): CompartGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        if (m.length === 0) { return this; }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        this.results = [];

        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) { throw new UserFacingError("VALIDATION_GENERAL", result.message) }
        }

        for (const cell of m.split(',')) {
            this.board.set(cell, this.currplayer);
            this.results.push({ type: "place", where: cell });
        }

        if (partial) { return this; }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): CompartGame {
        const numP1Pieces = this.getPlayerScore(1);
        const numP2Pieces = this.getPlayerScore(2);

        this.gameover = numP1Pieces + numP2Pieces === this.boardSize * this.boardSize;

        if (this.gameover) {
            if ( numP1Pieces === numP2Pieces ) {
                // if there is a tie, whoever placed the last stone wins
                this.winner = [this.currplayer % 2 + 1 as playerid];
            } else {
                this.winner = numP1Pieces < numP2Pieces ? [1] : [2];
            }
            this.results.push( {type: "eog"},
                               {type: "winners", players: [...this.winner]} );
        }
        return this;
    }

    public render(opts?: IRenderOpts): APRenderRep {
        let altDisplay: string | undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }
        let highlightAreas = false;
        if (altDisplay !== undefined) {
            if (altDisplay === "show-viable-areas") {
                highlightAreas = true;
            }
        }

        // Build piece string
        let pstr = "";
        for (let row = 0; row < this.boardSize; row++) {
            if (pstr.length > 0) { pstr += "\n"; }
            const pieces: string[] = [];
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    if (contents === 1) {
                        pieces.push("A");
                    } else {
                        pieces.push("B");
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join("");
        }
        pstr = pstr.replace(new RegExp(`-{${this.boardSize}}`, "g"), "_");

        // Build rep
        const rep: APRenderRep =  {
            options: ["hide-star-points"],
            board: {
                style: "vertex",
                width: this.boardSize,
                height: this.boardSize,
            },
            legend: {
                A: [{ name: "piece", colour: 1 }],
                B: [{ name: "piece", colour: 2 }],
            },
            pieces: pstr
        };

        // add territory dots
        if (highlightAreas && this.stack.length > 2) {
            const territories = this.getTerritories().sort((a, b) => b.cells.length - a.cells.length);
            const markers: Array<MarkerDots> = []
            let colorIdx = 0
            for (const t of territories) {
                const points = t.cells.map(c => this.algebraic2coords(c));
                markers.push({type: "dots",
                              colour: PALETTE[colorIdx],
                              points: points.map(p => { return {col: p[0], row: p[1]}; }) as [RowCol, ...RowCol[]]});
                colorIdx = (colorIdx + 1) % PALETTE.length;
            }
            if (markers.length > 0) {
                (rep.board as BoardBasic).markers = markers;
            }
        }

        // Add annotations
        if (this.results.length > 0) {
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }

        return rep;
    }

    public getPlayerScore(player: number): number {
        return [...this.board.entries()].filter(([,owner]) => owner === player).length;
    }

    public sidebarScores(): IScores[] {
        return [ { name: i18next.t("apgames:status.SCORES"),
                   scores: [this.getPlayerScore(1),
                            this.getPlayerScore(2)] } ];
    }

    public state(): ICompartState {
        return {
            game: CompartGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    public moveState(): IMoveState {
        return {
            _version: CompartGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    public clone(): CompartGame {
        return new CompartGame(this.serialize());
    }
}
