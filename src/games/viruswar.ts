import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError, SquareGraph } from "../common";
import { connectedComponents } from "graphology-components";
import i18next from "i18next";

export type playerid = 1 | 2 | 3 | 4 | 5 | 6; // 3,4 are dead virus; 5,6 are home-bases

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface IVirusWarState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class VirusWarGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Virus War",
        uid: "viruswar",
        playercounts: [2],
        version: "20260609",
        dateAdded: "2026-06-09",
        // i18next.t("apgames:descriptions.viruswar")
        description: "apgames:descriptions.viruswar",
        notes: "apgames:notes.viruswar",
        urls: [
            "https://boardgamegeek.com/boardgame/68214/virus-wars",
            "https://ptupitsyn.github.io/klopodavka-rs/",
            "https://sagme.blogspot.com/2025/09/pencil-and-paper-games-dots-and-bugs.html",
        ],
        people: [
            {
                type: "designer",
                name: "Traditional",
            },
            {
                type: "coder",
                name: "João Pedro Neto",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3829/joao-pedro-neto"],
                apid: "9228bccd-a1bd-452b-b94f-d05380e6638f",
            },
        ],
        variants: [
            { uid: "size-10", group: "board" }, // 3 moves
            { uid: "size-20", group: "board" }, // 4 moves
            { uid: "size-25", group: "board" }, // 5 moves
            { uid: "#board", }, // 30x30, 6 moves
        ],
        categories: ["goal>immobilize", "other>traditional", "mechanic>place", "mechanic>capture", "board>shape>rect", "board>connect>rect", "components>simple>pnp"],
        flags: ["no-moves", "experimental"]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    private boardSize = 30;
    private numMoves = 6;
    private dots: string[] = [];

    constructor(state: IVirusWarState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if ( (variants !== undefined) && (variants.length > 0) ) {
                this.variants = [...variants];
            }
            const size = this.getBoardSize();
            const board = new Map<string, playerid>();
            if (size === 10) { board.set("a1", 5); board.set("j10",  6); }
            if (size === 20) { board.set("b2", 5); board.set("s19",  6); }
            if (size === 25) { board.set("c3", 5); board.set("w23",  6); }
            if (size === 30) { board.set("c3", 5); board.set("ab28", 6); }

            const fresh: IMoveState = {
                _version: VirusWarGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IVirusWarState;
            }
            if (state.game !== VirusWarGame.gameinfo.uid) {
                throw new Error(`The Virus War engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): VirusWarGame {
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
        this.numMoves = this.getMoveSize();
        this.results = [...state._results];
        this.dots = this.getAdjacentMoves(this.currplayer, this.board); // show dots before the player acts
        return this;
    }

    private getBoardSize(): number {
        // Get board size from variants.
        if (this.variants !== undefined && this.variants.length > 0 &&
            this.variants[0] !== undefined && this.variants[0].length > 0) {
            const sizeVariants = this.variants.filter(v => v.includes("size"))
            if (sizeVariants.length > 0) {
                const size = sizeVariants[0].match(/\d+/);
                return parseInt(size![0], 10);
            }
            if (isNaN(this.boardSize)) {
                throw new Error(`Could not determine the board size from variant "${this.variants[0]}"`);
            }
        }
        return 30;
    }

    private getMoveSize(): number {
        switch (this.boardSize) {
            case 10: return 3;
            case 20: return 4;
            case 25: return 5;
        }
        return 6;
    }

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardSize);
    }

    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardSize);
    }

    public get graph(): SquareGraph {
        return new SquareGraph(this.boardSize, this.boardSize);
    }

    private homeBase(player: playerid): string {
        switch (this.boardSize) {
            case 10: return player === 1 ? "a1" : "j10";
            case 20: return player === 1 ? "b2" : "s19";
            case 25: return player === 1 ? "c3" : "w23";
        }
        return player === 1 ? "c3" : "ab28";
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.graph.coords2algebraic(col, row);
            const newmove = move === "" ? cell : `${move},${cell}`;

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

    // return the group of pieces of `player` connected to his home-base
    private homeGroup(player: playerid, board: Map<string, playerid>): string[] {
        const homebase = this.homeBase(player);
        const friendlies = player === 1 ? [1,3,5] : [2,4,6];
        const pieces = [...board.entries()].filter(([,owner]) => friendlies.includes(owner)).map(pair => pair[0]);

        // compute player groups
        const gPieces = this.graph;
        for (const node of gPieces.graph.nodes()) {
            if (! pieces.includes(node)) {  // remove squares not with friendly pieces
                gPieces.graph.dropNode(node);
            }
        }
        const playerGroups : Array<Array<string>> = connectedComponents(gPieces.graph);
        return playerGroups.filter(gr => gr.includes(homebase))[0]; // select group with home base
    }

    // get all possible moves adjacent to `group` of `player`
    private getAdjacentMoves(player: playerid, board: Map<string,playerid>): string[] {
        const prevplayer = player % 2 + 1 as playerid;
        const g = this.graph;
        const moves = new Set<string>();

        for (const cell of this.homeGroup(player, board)) {
            for (const neigh of g.neighbours(cell)) {
                if (!board.has(neigh) || board.get(neigh)! === prevplayer) {
                    moves.add(neigh);
                }
            }
        }
        return [...moves];
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.viruswar.INITIAL_INSTRUCTIONS_one", {count: this.numMoves})
            return result;
        }

        const moves = m.split(',');

        try { // check if cells are valid
            for (const cell of moves) { this.algebraic2coords(cell); }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
            return result;
        }

        // need to simulate previous placements, to check validity of the last placement
        // assume they are all correct since they were processed previously by validateMove()
        const prevplayer = this.currplayer % 2 + 1 as playerid;
        const clone = new Map(this.board);
        for (const move of moves.slice(0,-1)) {
            if (! clone.has(move) ) {
                clone.set(move, this.currplayer); // drop a new virus on an empty cell
            } else if (clone.get(move) === prevplayer) {
                clone.set(move, this.currplayer + 2 as playerid); // kills an enemy virus
            }
        }

        // process last placement
        const lastmove = moves.at(-1)!;
        let validMoves = this.getAdjacentMoves(this.currplayer, clone);

        if (validMoves.length > 0  && !validMoves.includes(lastmove) ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.viruswar.CANNOT_GROW", {where: lastmove});
            return result;
        }

        // update board clone with last move
        if (! clone.has(lastmove) ) {
            clone.set(lastmove, this.currplayer); // drop a new virus on an empty cell
        } else if (clone.get(lastmove) === prevplayer) {
            clone.set(lastmove, this.currplayer + 2 as playerid); // kills an enemy virus
        }
        validMoves = this.getAdjacentMoves(this.currplayer, clone);

        result.valid = true;
        result.complete = validMoves.length > 0 && moves.length < this.numMoves ? -1 : 1;
        result.canrender = true;
        if ( result.complete === -1 ) {
            result.message = i18next.t("apgames:validation.viruswar.INITIAL_INSTRUCTIONS_other", 
                                       {count: this.numMoves - moves.length});
        } else {
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        }
        return result;
    }

    public move(m: string, {trusted = false, partial = false} = {}): VirusWarGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        if (m.length === 0) {
            this.dots = this.getAdjacentMoves(this.currplayer, this.board);
            return this;
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) { throw new UserFacingError("VALIDATION_GENERAL", result.message) }
        }

        const prevplayer = this.currplayer % 2 + 1 as playerid;
        for (const move of m.split(',')) {
            if (! this.board.has(move) ) {
                this.board.set(move, this.currplayer); // drop a new virus on an empty cell
            } else if (this.board.get(move) === prevplayer) {
                this.board.set(move, this.currplayer + 2 as playerid); // kills an enemy virus
            }
        }
        this.results = [{ type: "place", where: m }];

        if (partial) { // if partial, populate dots
            this.dots = this.getAdjacentMoves(this.currplayer, this.board);
            return this;
        } else {
            this.dots = [];
        }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): VirusWarGame {
        // the previous player loses if he was unable to make all mandatory moves
        if ( this.lastmove !== undefined && this.lastmove!.split(',').length < this.getMoveSize() ) {
            this.gameover = true;
            this.winner = [this.currplayer];
        } else { // if the next player is stalemated, he loses
            const prevplayer = this.currplayer % 2 + 1 as playerid;
            const validMoves = this.getAdjacentMoves(this.currplayer, this.board);
            if ( validMoves.length === 0 ) {
                this.gameover = true;
                this.winner = [prevplayer];
            }
        }

        if (this.gameover) {
            this.results.push( {type: "eog"},
                               {type: "winners", players: [...this.winner]} );
        }
        return this;
    }

    public render(): APRenderRep {
        const g = this.graph;
        // Build piece string
        let pstr = "";
        for (let row = 0; row < this.boardSize; row++) {
            if (pstr.length > 0) { pstr += "\n"; }
            const pieces: string[] = [];
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                         if (contents === 1) { pieces.push("A"); }
                    else if (contents === 3) { pieces.push("B"); }
                    else if (contents === 5) { pieces.push("C"); }
                    else if (contents === 2) { pieces.push("D"); }
                    else if (contents === 4) { pieces.push("E"); }
                    else if (contents === 6) { pieces.push("F"); }
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join("");
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares",
                width: this.boardSize,
                height: this.boardSize,
            },
            legend: {
                A: { name: "piece",        colour: 1 },
                B: { name: "piece-square", colour: 1 },
                C: { name: "palace",       colour: 1 },
                D: { name: "piece",        colour: 2 },
                E: { name: "piece-square", colour: 2 },
                F: { name: "palace",       colour: 2 },
            },
            pieces: pstr
        };

        // Add annotations
        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") { // note: one `place` has a sequence of placements
                    for (const mv of move.where!.split(',')) {
                        const [x, y] = g.algebraic2coords(mv);
                        rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                    }
                }
            }
        }

        if (this.dots.length > 0) {
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

    public state(): IVirusWarState {
        return {
            game: VirusWarGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: VirusWarGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.viruswar", { player, where: r.where }));
                resolved = true;
                break;
            case "eog":
                node.push(i18next.t("apresults:EOG.default"));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): VirusWarGame {
        return new VirusWarGame(this.serialize());
    }
}
