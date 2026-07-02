import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/build/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import { SquareOrthGraph } from "../common/graphs";
import {connectedComponents} from 'graphology-components';
import i18next from "i18next";

export type playerid = 1 | 2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface IFormsState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class FormsGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Forms",
        uid: "forms",
        playercounts: [2],
        version: "20260610",
        dateAdded: "2026-06-22",
        // i18next.t("apgames:descriptions.forms")
        description: "apgames:descriptions.forms",
        notes: "apgames:notes.forms",
        urls: [
            "https://boardgamegeek.com/boardgame/36917/forms",
            "https://jpneto.github.io/world_abstract_games/forms.htm",
        ],
        people: [
            {
                type: "designer",
                name: "Steven Meyers",
                urls: ["https://boardgamegeek.com/boardgamedesigner/6984/steven-meyers",
                       "https://web.archive.org/web/20140216114207/https://home.fuse.net/swmeyers/home.htm"],
            },
            {
                type: "coder",
                name: "João Pedro Neto",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3829/joao-pedro-neto"],
                apid: "9228bccd-a1bd-452b-b94f-d05380e6638f",
            },
        ],
        categories: ["goal>immobilize", "mechanic>move", "mechanic>capture", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["no-moves"],
        variants: [
            { uid: "#board", }, // 8x8
            { uid: "size-10",  group: "board" },
            { uid: "size-12",  group: "board" },
            { uid: "size-14",  group: "board" },
            { uid: "size-16",  group: "board" },
            { uid: "size-18",  group: "board" },
            { uid: "original", group: "ruleset" },
        ]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public boardSize = this.getBoardSize();
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    private ruleset: "default" | "original";
    private dots: [number, number][] = []; // if there are points here, the renderer will show them
    private highlight: string | undefined; // highlight moving piece

    constructor(state?: IFormsState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const board = new Map<string, playerid>();
            const sz = this.getBoardSize(); // this.boardSize is not yet defined

            for (let x=0; x<sz; x++) {
                for (let y=0; y<sz; y++) {
                    const cell = GameBase.coords2algebraic(x, y, sz);
                    let owner: playerid;
                    if (this.variants.includes("original")) {
                        owner = y < Math.floor(sz/2) ? 2 : 1; // half-board per color
                    } else {
                        owner = x%2 === y%2 ? 1 : 2; // checkered pattern
                    }
                    board.set(cell, owner);
                }
            }

            const fresh: IMoveState = {
                _version: FormsGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IFormsState;
            }
            if (state.game !== FormsGame.gameinfo.uid) {
                throw new Error(`The Forms engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
        this.ruleset = this.getRuleset();
    }

    public load(idx = -1): FormsGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        if (state === undefined) {
            throw new Error(`Could not load state index ${idx}`);
        }
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.lastmove = state.lastmove;
        this.boardSize = this.getBoardSize();
        this.results = [...state._results];
        return this;
    }

    private coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardSize);
    }
    private algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardSize);
    }

    private getBoardSize(): number {
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
        return 8;
    }

    private getRuleset(): "default" | "original" {
        if (this.variants.includes("original")) { return "original"; }
        return "default";
    }

    private getGraph(): SquareOrthGraph { // just orthogonal connections
        return new SquareOrthGraph(this.boardSize, this.boardSize);
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            let newmove = "";

            if (move === "") {
                newmove = cell;
            } else if (move === cell) {
                newmove = ""; // re-click resets the move
            } else if ( this.board.has(cell) && this.board.get(cell)! === this.currplayer ) {
                newmove = cell; // player select another friendly piece to move instead
            } else {
                newmove = `${move}-${cell}`;
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

    // return the groups of pieces on the board if move `from-to` was made
    private getGroups(from: string, to: string): string[][] {
        // simulate move
        const wasTo : playerid|undefined = this.board.has(to) ? this.board.get(to) : undefined;
        this.board.delete(from);
        this.board.set(to, this.currplayer)

        // find number of mutually exclusive groups of pieces
        const graph = this.getGraph();
        for (const node of graph.graph.nodes()) {
            if (! this.board.has(node) ) {
                graph.graph.dropNode(node);
            }
        }
        const groups = connectedComponents(graph.graph);

        // undo simulated actions
        this.board.set(from, this.currplayer);
        if (wasTo === undefined) {
            this.board.delete(to);
        } else {
            this.board.set(to, wasTo);
        }

        return groups;
    }

    // returns all moves that `cell` can capture/move
    // requires: all pieces (of either color) at gathered in a single orthogonal group
    private validMoves(cell: string, player?: playerid): string[] {
        const allPieces = [...this.board.entries()].map(pair => pair[0]);
        const g = this.getGraph();
        player ??= this.currplayer;

        if (this.ruleset === 'original' ) {
            // the player moves the selected stone to any cell occupied by an opponent's stone
            return [...this.board.entries()].filter(([,owner]) => owner !== player).map(pair => pair[0]);
        }

        // compute empty areas
        const gEmpties = this.getGraph();
        for (const node of gEmpties.graph.nodes()) {
            if ( allPieces.includes(node) ) {  // remove intersections/nodes with pieces
                gEmpties.graph.dropNode(node);
            }
        }
        const emptyAreas : Array<Array<string>> = connectedComponents(gEmpties.graph);

        // find empty area(s) adjacent to `cell` (there are, at most, two areas that can be adjacent)
        const myArea: string[] = [];
        const myNeighs = g.neighbours(cell);
        for (const area of emptyAreas) {
            for (const cellArea of area) {
                if ( myNeighs.includes(cellArea) ) {
                    myArea.push(...area);
                }
            }
        }

        // get all empty cells from myArea adjacent to at least one piece
        const myAreaSet: Set<string> = new Set(myArea); // for faster look-up
        const emptyNeighs = new Set<string>();
        for (const piece of allPieces) {
            for (const neigh of g.neighbours(piece)) {
                if ( myAreaSet.has(neigh) ) {
                    emptyNeighs.add(neigh);
                }
            }
        }
        // only include moves that split the main group of pieces [costly operation: O(n³)]
        const moves: string[] = [...emptyNeighs].filter(to => this.getGroups(cell, to).length > 1);

        // add captures moves to `moves`
        for (const neigh of myNeighs) {
            if ( this.board.has(neigh) && this.board.get(neigh)! !== player) {
                moves.push(neigh);
            }
        }

        return moves;
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false,
                                           message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.forms.INITIAL_INSTRUCTIONS");
            return result;
        }

        const moves = m.split('-');

        try { // check cell validity
            for (const cell of moves) { this.algebraic2coords(cell); }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
            return result;
        }

        if (moves.length === 1) {
            if ( !this.board.has(m) || this.board.get(m) !== this.currplayer ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.forms.INVALID_SELECTION");
                return result;
            }
            if ( this.validMoves(m).length === 0 ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.forms.NO_MOVES");
                return result;
            }
            result.valid = true;
            result.complete = -1; // player still needs to move the piece
            result.canrender = true;
            if (this.ruleset === 'original' ) {
                result.message = i18next.t("apgames:validation.forms.INSTRUCTIONS_ORIGINAL");
            } else {
                result.message = i18next.t("apgames:validation.forms.INSTRUCTIONS");
            }
            return result;
        }

        const from = moves[0];
        const to = moves[1];

        if (! this.validMoves(from).includes(to) ) {
            result.valid = false;
            if (this.ruleset === 'original' ) {
                result.message = i18next.t("apgames:validation.forms.INVALID_MOVE_ORIGINAL");
            } else {
                result.message = i18next.t("apgames:validation.forms.INVALID_MOVE");
            }
            return result;
        }

        result.valid = true;
        result.complete = 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {partial = false, trusted = false} = {}): FormsGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) { throw new UserFacingError("VALIDATION_GENERAL", result.message) }
        }

        this.results = [];
        this.dots = [];
        this.highlight = undefined;

        if ( m.length === 0 ) { return this; }

        if ( partial && !m.includes('-') ) {
            this.highlight = m;
            if (this.ruleset !== 'original' ) {
                this.dots = this.validMoves(m).map(c => this.algebraic2coords(c));
            }
            return this;
        } else {
            this.dots = []; // otherwise delete the points and process the full move
        }

        const moves = m.split('-');

        // mark which groups are to be captured
        const captures = [];
        for (const group of this.getGroups(moves[0], moves[1])) {
            if ( group.includes(moves[1]) ) { continue; }
            captures.push(...group);
        }

        this.board.delete(moves[0]);
        this.board.set(moves[1], this.currplayer);
        this.results.push({ type: "move", from: moves[0], to: moves[1]});

        if (captures.length > 0) {
            for (const cell of captures) {
                this.board.delete(cell);
            }
            this.results.push({ type: "capture", where: captures.join(), count: captures.length });
        }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): FormsGame {
        const pieces = [...this.board.entries()].filter(([,owner]) => owner === this.currplayer)
                                                .map(pair => pair[0]);
        let foundValidMove = false;

        for (const piece of pieces) {
            const valid = this.validMoves(piece);
            if ( valid.length > 0 ) {
                foundValidMove = true;
                break;
            }
        }

        if (! foundValidMove ) { // the last player to move loses (Forms is a misère game)
            this.gameover = true;
            this.winner = [this.currplayer];
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }

        return this;
    }

    public render(): APRenderRep {
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
                        pieces.push(this.highlight === cell ? "C" : "A");
                    } else {
                        pieces.push(this.highlight === cell ? "D" : "B");
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
            board: {
                style: "squares",
                width: this.boardSize,
                height: this.boardSize,
            },
            legend: {
                A: { name: "piece", colour: 1 },
                B: { name: "piece", colour: 2 },
                C: { name: "piece-horse", colour: 1 },
                D: { name: "piece-horse", colour: 2 }
            },
            pieces: pstr,
        };

        // Add annotations
        rep.annotations = [];
        for (const move of this.results) {
            if (move.type === "move") {
                const [fromX, fromY] = this.algebraic2coords(move.from);
                const [toX, toY] = this.algebraic2coords(move.to);
                rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
            } else if (move.type === "capture") {
                for (const cell of move.where!.split(",")) {
                    const [x, y] = this.algebraic2coords(cell);
                    rep.annotations.push({ type: "exit", targets: [{ row: y, col: x }] });
                }
            }
        }

        // show the dots where the selected piece can move to
        if (this.dots.length > 0) {
            const points = [];
            for (const [x,y] of this.dots) {
                points.push({row: y, col: x});
            }
            rep.annotations.push({type: "dots",
                                  targets: points as [{row: number; col: number;}, ...{row: number; col: number;}[]]});
        }

        return rep;
    }

    public state(): IFormsState {
        return {
            game: FormsGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: FormsGame.gameinfo.version,
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
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.forms", { player, count: r.count }));
                resolved = true;
                break;
            case "eog":
                node.push(i18next.t("apresults:EOG.forms"));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): FormsGame {
        return new FormsGame(this.serialize());
    }
}
