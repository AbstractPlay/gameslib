import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/build/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, UserFacingError, SquareOrthGraph } from "../common";
import { connectedComponents } from "graphology-components";
import i18next from "i18next";

type playerid = 1 | 2; // regarding pieces: 1 is the ball, 2 are the walls

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface IUnaneState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class UnaneGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Unane",
        uid: "unane",
        playercounts: [2],
        version: "20260521",
        dateAdded: "2026-05-27",
        // i18next.t("apgames:descriptions.unane")
        description: "apgames:descriptions.unane",
        notes: "apgames:notes.unane",
        urls: [
            "https://www.marksteeregames.com/Unane_rules.pdf",
        ],
        people: [
            {
                type: "designer",
                name: "Mark Steere",
                urls: ["http://www.marksteeregames.com/"],
                apid: "e7a3ebf6-5b05-4548-ae95-299f75527b3f",
            },
            {
                type: "coder",
                name: "João Pedro Neto",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3829/joao-pedro-neto"],
                apid: "9228bccd-a1bd-452b-b94f-d05380e6638f",
            },
        ],
        categories: ["goal>unify", "mechanic>move", "mechanic>capture", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        variants: [
            { uid: "size-6",  group: "board" }, // 5x6
            { uid: "#board", }, // 7 rows x 8 cols
            { uid: "size-10", group: "board" }, //  9x10
            { uid: "size-12", group: "board" }, // 11x12
            { uid: "size-14", group: "board" }, // 13x14
            { uid: "size-16", group: "board" }, // 15x16
        ],
        flags: ["pie"]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    private boardSize = this.getBoardSize();
    private grid: RectGrid;
    private dots: [number, number][] = []; // if there are points here, the renderer will show them

    constructor(state?: IUnaneState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if ( (variants !== undefined) && (variants.length > 0) ) {
                this.variants = [...variants];
            }
            const board = new Map<string, playerid>();
            const sz = this.getBoardSize();
            const g = new SquareOrthGraph(sz, sz-1);

            for (let x=0; x<sz; x++) {
                for (let y=0; y<sz-1; y++) {
                    const cell = g.coords2algebraic(x, y);
                    const owner: playerid = x%2 === y%2 ? 1 : 2;
                    board.set(cell, owner);
                }
            }
            const fresh: IMoveState = {
                _version: UnaneGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IUnaneState;
            }
            if (state.game !== UnaneGame.gameinfo.uid) {
                throw new Error(`The Unane engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
        this.grid = new RectGrid(this.getBoardSize(), this.getBoardSize()-1);
    }

    public load(idx = -1): UnaneGame {
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

    public getBoardSize(): number {
        // Get board size from variants.
        if (this.variants    !== undefined && this.variants.length > 0 &&
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

    public get graph(): SquareOrthGraph {
        return new SquareOrthGraph(this.boardSize, this.boardSize-1);
    }

    // return the list of orthogonal neighbors of 'cell'
    private orthNeighbours(cell: string): string[] {
        const [x, y] = this.graph.algebraic2coords(cell);
        const neighbours = this.grid.adjacencies(x, y, false);
        return neighbours.map(n => this.graph.coords2algebraic(...n));
    }

    // return all the groups/roots of a given player
    private getGroups(player?: playerid): string[][] {
        if (player === undefined) { player = this.currplayer; }
        const pieces = [...this.board.entries()].filter(([,owner]) => owner === player).map(pair => pair[0]);
        const g = this.graph;

        for (const node of g.graph.nodes()) {
            if (!pieces.includes(node)) { // remove intersections/nodes not occupied by the player
                g.graph.dropNode(node);
            }
        }

        const groups : Array<Array<string>> = connectedComponents(g.graph);
        const res: string[][] = [];
        for (const group of groups) {
            res.push( group );
        }
        return res;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) { player = this.currplayer; }
        const g = this.graph;
        const moves = [];

        for (const cell of g.graph.nodes()) {
            if (this.board.has(cell) && this.board.get(cell) === player) {
                // check if we can remove this friendly stone
                let canRemove = true;
                // this is only possible if there are no orthogonal adjacencies with enemy stones
                for (const neigh of this.orthNeighbours(cell)) {
                    if (this.board.has(neigh) && this.board.get(neigh) !== player) {
                        canRemove = false;
                        break;
                    }
                }
                if (canRemove) {
                    moves.push(`${cell}-${cell}`);
                }
                // players can move their friendly stones to capture an enemy stone
                for (const neigh of this.orthNeighbours(cell)) {
                    if (this.board.has(neigh) && this.board.get(neigh) !== player) {
                        moves.push(`${cell}-${neigh}`);
                    }
                }
            }
        }

        return moves.sort((a,b) => a.localeCompare(b));
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.graph.coords2algebraic(col, row);
            let newmove = "";

            if (move === "") {
                newmove = cell;
            } else if (! move.includes('-') ) {
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

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.unane.INITIAL_INSTRUCTIONS");
            return result;
        }

        const moves = m.split('-');
        if (moves.length === 1) {
            if (!this.board.has(m) || this.board.get(m) !== this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.unane.INVALID_SELECTION");
                return result;
            }
            result.valid = true;
            result.complete = -1; // player still needs to decide to place or remove this stone
            result.canrender = true;
            result.message = i18next.t("apgames:validation.unane.INSTRUCTIONS");
            return result;
        }

        const allMoves = this.moves();
        if (! allMoves.includes(m) ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.unane.INVALID_MOVE");
            return result
        }

        result.valid = true;
        result.complete = 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private findPoints(cell: string): string[] {
        return this.moves().filter(mv => mv.startsWith(cell))
                           .map(mv => mv.split('-')[1]);
    }

    public move(m: string, {partial = false, trusted = false} = {}): UnaneGame {
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
            }
        }

        this.results = [];
        this.dots = [];
        if (m === "") { return this; }

        if (partial) {
            this.dots = this.findPoints(m).map(c => this.graph.algebraic2coords(c));
            return this;
        } else {
            this.dots = []; // otherwise delete the points and process the full move
        }

        const moves = m.split('-');
        if (moves[0] === moves[1]) { // removal
            this.board.delete(moves[0]);
            this.results.push({ type: "place", where: moves[0], count: 1 });
        } else { // move and (eventual capture)
            this.board.delete(moves[0]);
            this.board.set(moves[1], this.currplayer);
            this.results.push({ type: "move", from: moves[0], to: moves[1]});
        }

        if (partial) { return this; }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): UnaneGame {
        const p1Groups = this.getGroups(1);
        const p2Groups = this.getGroups(2);

        if (p1Groups.length === 1 || p2Groups.length === 1) {
            this.gameover = true;
            if (p1Groups.length === 1 && p2Groups.length === 1) {
                const prevplayer = this.currplayer % 2 + 1 as playerid;
                this.winner = [prevplayer];
            } else {
                this.winner = p1Groups.length === 1 ? [1] : [2];
            }
        }

        if ( this.gameover ) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }

        return this;
    }

    public state(): IUnaneState {
        return {
            game: UnaneGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: UnaneGame.gameinfo.version,
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

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "vertex",
                width: this.boardSize,
                height: this.boardSize-1
            },
            legend: {
                A: { name: "piece", colour: 1 },
                B: { name: "piece", colour: 2 },
            },
            pieces: pstr
        };

        rep.annotations = [];
        for (const move of this.results) {
            if (move.type === "place") {
                const [toX, toY] = g.algebraic2coords(move.where!);
                rep.annotations.push({type: "enter", targets: [{row: toY, col: toX}]});
            } else if (move.type === "move") {
                    const [fromX, fromY] = g.algebraic2coords(move.from);
                    const [toX, toY] = g.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
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

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.unane", { player, where: r.where }));
                resolved = true;
                break;
            case "move":
                node.push(i18next.t("apresults:MOVE.complete", { player, from: r.from, to: r.to, what: "piece" }));
                resolved = true;
                break;
            case "eog":
                node.push(i18next.t("apresults:EOG.default"));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): UnaneGame {
        return new UnaneGame(this.serialize());
    }
}
