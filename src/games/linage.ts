import { GameBase, IAPGameState, IClickResult, ICustomButton, IIndividualState, IValidationResult, IScores } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, BoardBasic, MarkerDots, RowCol, Colourfuncs } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError, SquareOrthGraph } from "../common";

import { connectedComponents } from "graphology-components";

import i18next from "i18next";

// 1 is Vertical, 2 is Horizontal, 3 is for neutral pieces/free regions, 4 is for invalid regions
export type playerid = 1 | 2 | 3 | 4;

type Territory = {
    cells: string[];
    owner: playerid | undefined;
};

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
    komi?: number;
    swapped: boolean;
};

export interface ILinageState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class LinageGame extends GameBase {

    public static readonly gameinfo: APGamesInformation = {
        name: "Linage",
        uid: "linage",
        playercounts: [2],
        version: "20260601",
        dateAdded: "2026-06-01",
        // i18next.t("apgames:descriptions.linage")
        description: "apgames:descriptions.linage",
        notes: "apgames:notes.linage",
        urls: [
            "https://boardgamegeek.com/boardgame/219420/linage"
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
        categories: ["goal>area", "mechanic>place", "board>shape>rect", "board>connect>rect"],
        variants: [
            { uid: "size-11", group: "board" },
            { uid: "size-13", group: "board" },
            { uid: "#board", }, // 15x15
            { uid: "size-17", group: "board" },
            { uid: "size-19", group: "board" },
        ],
        flags: ["custom-buttons", "custom-colours", "experimental"]
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
    public boardSize = 13;
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public komi?: number;
    public swapped = true;

    constructor(state?: ILinageState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const board = new Map<string, playerid>();
            const fresh: IMoveState = {
                _version: LinageGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                swapped: true
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ILinageState;
            }
            if (state.game !== LinageGame.gameinfo.uid) {
                throw new Error(`The Linage engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): LinageGame {
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
        this.komi = state.komi;
        this.swapped = false;
        // We have to check the first state because we store the updated version in later states
        if (state.swapped === undefined) {
            this.swapped = this.stack.length < 3 || this.stack[2].lastmove !== "play-second";
        } else {
            this.swapped = state.swapped;
        }
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
        return 15;
    }

    public isKomiTurn(): boolean {
        return this.stack.length === 1;
    }

    public isPieTurn(): boolean {
        return this.stack.length === 2;
    }

    private getGraph(): SquareOrthGraph { // just orthogonal connections
        return new SquareOrthGraph(this.boardSize, this.boardSize);
    }

    // return how many horizontal and vertical lines, of size three, are inside the given area
    private getLines(area: Array<string>) : [number,number] {
        let hLines = 0, vLines = 0;
        const cells = new Set<string>();
        // make a set of all cells (using their coordinates), for quick search
        for (const cell of area) {
            const [x,y] = this.algebraic2coords(cell);
            cells.add(`${x},${y}`); // used strings bc arrays are compared by reference, not by value
        }
        for (const cell of area) {
            const [x,y] = this.algebraic2coords(cell);
            // check right for 3 in-a-row
            if (cells.has(`${x+1},${y}`) && cells.has(`${x+2},${y}`) ) {
                hLines += 1;
            }
            // check below for 3 in-a-row
            if (cells.has(`${x},${y+1}`) && cells.has(`${x},${y+2}`) ) {
                vLines += 1;
            }
        }

        return [hLines, vLines];
    }

    // get all territories/regions either owned or free (or invalid)
    private getTerritories(): Territory[] {
        const allPieces = [...this.board.entries()].map(pair => pair[0]);

        // compute empty areas
        const gEmpties = this.getGraph();
        for (const node of gEmpties.graph.nodes()) {
            if (allPieces.includes(node)) {  // remove intersections/nodes with pieces
                gEmpties.graph.dropNode(node);
            }
        }
        const emptyAreas : Array<Array<string>> = connectedComponents(gEmpties.graph);

        const territories: Territory[] = [];
        for(const area of emptyAreas) {
            let owner : playerid = 3; // default value: neutral area
            const [hLines, vLines] = this.getLines(area);
            if (hLines == 0 && vLines > 0) {
                owner = 1; // vertical is player 1
            }
            else if (vLines == 0 && hLines > 0) {
                owner = 2;
            }
            else if (vLines == 0 && hLines == 0) {
                owner = 4; // invalid region
            }
            territories.push({cells: area, owner});
        }
        return territories;
    }

    // does cell is in a owned region or, playing in it, does it creates an invalid region?
    // requires: cell (x,y) is empty
    private isTaboo(cell: string): boolean {

        // is in an owned territory?
        for (const terr of this.getTerritories()) {
            if ( terr.owner !== 3 && terr.cells.includes(cell) ) {
                return true; // cannot play on owned regions
            }
        }

        // check if the move would create an invalid region
        this.board.set(cell, this.currplayer);
        const result = this.getTerritories().some(terr => terr.owner === 4);
        this.board.delete(cell);

        return result;
    }

    // Generates a full list of valid moves from the current game state.
    public moves(): string[] {
        return []; // costly to compute
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            if (this.isKomiTurn()) { // Komi time, so no clicks are acceptable
                const dummyResult = this.validateMove("") as IClickResult;
                dummyResult.move = "";
                dummyResult.valid = false;
                return dummyResult;
            }
            const cell = this.coords2algebraic(col, row);
            const result = this.validateMove(cell) as IClickResult;
            result.move = result.valid ? cell : "";
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
        if (this.isKomiTurn()) {
            if (m.length === 0) {
                // game is starting, show initial KOMI message
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.linage.INITIAL_SETUP");
                return result;
            }

            // player typed something in the move textbox, check if it is an integer
            if (! /^-?\d+$/.test(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.linage.INVALID_KOMI");
                return result
            }
            result.valid = true;
            result.complete = 0; // partial because player can continue typing for abs(Komi) > 9
            result.message = i18next.t("apgames:validation.linage.INSTRUCTIONS");
            return result;
        }

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            if (this.isPieTurn()) {
                result.message = i18next.t("apgames:validation.linage.KOMI_CHOICE");
            } else {
                result.message = i18next.t("apgames:validation.linage.INSTRUCTIONS")
            }
            return result;
        }

        if (m === "play-second") {
            if (this.isPieTurn()) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.linage.INVALID_PLAYSECOND");
            }
            return result;
        }

        if (m === "pass") {
            if (this.isPieTurn()) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.linage.INVALID_PASS");
                return result;
            }
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        if ( this.board.has(m) ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.linage.OCCUPIED");
            return result;
        }

        // is it playing on a free region, or making an invalid region?
        if ( this.isTaboo(m) ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.linage.TABOO");
            return result;
        }

        result.valid = true;
        result.complete = 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {partial = false, trusted = false} = {}): LinageGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        if (m.length === 0) { return this; }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
        }

        if (this.isKomiTurn()) {
            // first move, get the Komi proposed value, and add komi to game state
            this.komi = parseInt(m, 10);
            this.results.push({type: "komi", value: this.komi});
            this.komi *= -1; // Invert it for backwards compatibility reasons
        } else if (m === "play-second") {
            this.komi! *= -1;
            this.swapped = false;
            this.results.push({type: "play-second"});
        } else if (m === "pass") {
            this.results.push({type: "pass"});
        } else {
            // piece placement (after the Komi+Pie phase)
            this.results.push({ type: "place", where: m });
            this.board.set(m, this.currplayer);
        }

        if (partial) { return this; }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    private hasPlacements(): boolean {
        return this.getTerritories().some(terr => terr.owner === 3);
    }

    protected checkEOG(): LinageGame {
        this.gameover = !this.hasPlacements() // all regions are owned
                        || 
                        (this.lastmove === "pass" &&  // two consecutive passes occurred
                         this.stack[this.stack.length - 1].lastmove === "pass");

        if (this.gameover) {
            this.winner = this.getPlayerScore(1) > this.getPlayerScore(2) ? [1] : [2]; // draws not possible
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): ILinageState {
        return {
            game: LinageGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    public moveState(): IMoveState {
        return {
            _version: LinageGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            komi: this.komi,
            swapped: this.swapped
        };
    }

    public getPlayerColour(player: playerid): number | string {
        return (player == 1 && !this.swapped) || (player == 2 && this.swapped) ? 1 : 2;
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < this.boardSize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
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

        const pieceColour: Colourfuncs = {
            func: "custom",
            default: "#999",
            palette: 3
        };

        // Build rep
        const rep: APRenderRep =  {
            options: ["hide-star-points"],
            board: {
                style: "vertex",
                width: this.boardSize,
                height: this.boardSize,
            },
            legend: {
                A: [{ name: "piece", colour: pieceColour }],
                B: [{ name: "piece", colour: pieceColour }],
            },
            pieces: pstr
        };

        // add territory dots
        if (this.stack.length > 2) {
            const territories = this.getTerritories();
            const markers: Array<MarkerDots> = []
            for (const t of territories) {
                if (t.owner !== undefined) {
                    const points = t.cells.map(c => this.algebraic2coords(c));
                    if (t.owner !== 3) {
                        markers.push({type: "dots",
                                      colour: this.getPlayerColour(t.owner),
                                      points: points.map(p => { return {col: p[0], row: p[1]}; }) as [RowCol, ...RowCol[]]});
                    }
                }
            }
            if (markers.length > 0) {
                (rep.board as BoardBasic).markers = markers;
            }
        }

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }

        return rep;
    }

    public getButtons(): ICustomButton[] {
        if (this.moves().includes("pass"))
            return [{ label: "pass", move: "pass" }];
        if (this.moves().includes("play-second"))
            return [{ label: "playsecond", move: "play-second" }];
        return []; // no buttons should appear when typing Komi at start
    }

    public sidebarScores(): IScores[] {
        return [ { name: i18next.t("apgames:status.SCORES"),
                   scores: [this.getPlayerScore(1), this.getPlayerScore(2)] } ];
    }

    public getPlayerScore(player: number): number {
        let komi = 0.0;
        if (player === 1 && this.komi !== undefined && this.komi < 0)
            komi = -this.komi + 0.5; // 0.5 is to prevent draws
        if (player === 2 && this.komi !== undefined && this.komi > 0)
            komi = this.komi + 0.5;

        const terr = this.getTerritories();
        return terr.filter(t => t.owner === player).reduce((prev, curr) => prev + curr.cells.length, komi);
    }

    public clone(): LinageGame {
        return new LinageGame(this.serialize());
    }
}
