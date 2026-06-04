import { GameBase, IAPGameState, IClickResult, ICustomButton, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, RowCol, Colourfuncs } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, UserFacingError } from "../common";
import { UndirectedGraph } from "graphology";
import { bidirectional } from "graphology-shortest-path/unweighted";
import i18next from "i18next";

export type playerid = 1 | 2 | 3; // 3 are Pip pieces

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    zipPlayer: playerid | undefined;
    connPath: string[];
    lastmove?: string;
};

export interface IPippinzipState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

type PlayerLines = [string[],string[]];

export class PippinzipGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Pippinzip",
        uid: "pippinzip",
        playercounts: [2],
        version: "20260603",
        dateAdded: "2026-06-03",
        // i18next.t("apgames:descriptions.pippinzip")
        description: "apgames:descriptions.pippinzip",
        notes: "apgames:notes.pippinzip",
        urls: ["https://boardgamegeek.com/boardgame/298409/pippinzip"],
        people: [
            {
                type: "designer",
                name: "Craig Duncan",
                urls: ["https://boardgamegeek.com/boardgamedesigner/66694/craig-duncan"],
                apid: "d1f9fa1b-889c-4234-a95c-9a5d389bf98e",
            },
            {
                type: "designer",
                name: "João Pedro Neto",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3829/joao-pedro-neto"],
                apid: "9228bccd-a1bd-452b-b94f-d05380e6638f",
            },
            {
                type: "designer",
                name: "Bill Taylor",
                urls: ["https://boardgamegeek.com/boardgamedesigner/9249/bill-taylor"],
            },
            {
                type: "coder",
                name: "João Pedro Neto",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3829/joao-pedro-neto"],
                apid: "9228bccd-a1bd-452b-b94f-d05380e6638f",
            },
        ],
        variants: [
            { uid: "size-9",  group: "board" },
            { uid: "#board", }, // 11x11
            { uid: "size-13", group: "board" },
            { uid: "size-15", group: "board" },
            { uid: "size-19", group: "board" },
        ],
        categories: ["goal>connect", "mechanic>place", "mechanic>asymmetry",
                     "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["no-moves", "custom-buttons", "experimental"]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public zipPlayer!: playerid | undefined;
    public connPath: string[] = [];
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public boardSize = 0;
    private lines: [PlayerLines,PlayerLines];

    constructor(state?: IPippinzipState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            const board = new Map<string, playerid>();
            const fresh: IMoveState = {
                _version: PippinzipGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                zipPlayer: undefined,
                connPath: [],
            };
            this.stack = [fresh];
            if (variants !== undefined) {
                this.variants = [...variants];
            }
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IPippinzipState;
            }
            if (state.game !== PippinzipGame.gameinfo.uid) {
                throw new Error(`The Pippinzip engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
        this.lines = this.getLines();
    }

    public load(idx = -1): PippinzipGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.results = [...state._results];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.zipPlayer = state.zipPlayer;
        this.lastmove = state.lastmove;
        this.connPath = [...state.connPath];
        this.boardSize = this.getBoardSize();
        return this;
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
        return 11;
    }

    private getLines(): [PlayerLines,PlayerLines] {
        const lineN: string[] = [];
        const lineS: string[] = [];
        for (let x = 0; x < this.boardSize; x++) {
            const N = GameBase.coords2algebraic(x, 0, this.boardSize);
            const S = GameBase.coords2algebraic(x, this.boardSize-1, this.boardSize);
            lineN.push(N);
            lineS.push(S);
        }
        const lineE: string[] = [];
        const lineW: string[] = [];
        for (let y = 0; y < this.boardSize; y++) {
            const E = GameBase.coords2algebraic(this.boardSize-1, y, this.boardSize);
            const W = GameBase.coords2algebraic(0, y, this.boardSize);
            lineE.push(E);
            lineW.push(W);
        }
        return [[lineN,lineS], [lineE,lineW]];
    }

    // is the game still in the auction phase?
    private inAuctionPhase() : boolean {
        return this.zipPlayer === undefined;
    }

    // requires: !inAuctionPhase()
    private isZipTurn() : boolean {
        return this.zipPlayer === this.currplayer;
    }

    public moves(): string[] {
        return []; // too many moves
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = PippinzipGame.coords2algebraic(col, row, this.boardSize);
            let newmove = "";

            if ( move.length === 0 ) {
                newmove = cell;
            } else {
                const moves = move.split(',');
                if ( moves.includes(cell) ) { // check if the cell already was clicked
                    newmove = moves.filter(c => c!=cell).join(","); // if re-click, undo it
                } else {
                    newmove = `${move},${cell}`; // otherwise, append coordinates of current click
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

    // check if cells are orthogonally adjacent
    private isAdjacent(from: string, to: string): boolean {
        const [x1, y1] = PippinzipGame.algebraic2coords(from, this.boardSize);
        const [x2, y2] = PippinzipGame.algebraic2coords(to,   this.boardSize);
        const dx = Math.abs(x1 - x2);
        const dy = Math.abs(y1 - y2);
        return (dx === 1) && (dy === 0) || (dx === 0) && (dy === 1);
    }

    // used to check if we can place the second piece for Pip
    private isFull(): boolean {
        return this.board.size == this.boardSize * this.boardSize - 1;
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false,
                                           message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            if ( this.inAuctionPhase() ) {
                result.message = i18next.t("apgames:validation.pippinzip.INITIAL_INSTRUCTIONS")
            } else if ( this.isZipTurn() ) {
                result.message = i18next.t("apgames:validation.pippinzip.INSTRUCTIONS_ZIP")
            } else {
                result.message = i18next.t("apgames:validation.pippinzip.INSTRUCTIONS_PIP")
            }
            return result;
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (m === "pass") {
            if (! this.inAuctionPhase() ) { // players only pass to finish the auction
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALID_PASS")
                return result;
            }
            result.valid = true;
            result.complete = 1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        const moves = m.split(',');

        try {
            for (const cell of moves) {
                PippinzipGame.algebraic2coords(cell, this.boardSize);
            }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
            return result;
        }

        for (const cell of moves) {
            if ( this.board.has(cell) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: cell})
                return result;
            }
        }

        // check Auction phase

        if ( this.inAuctionPhase() && moves.length > 3 ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.pippinzip.TOO_MANY_PLACEMENTS_AUCTION")
            return result;
        }

        if ( this.inAuctionPhase() && moves.length <= 3 ) {
            if ( moves.length === 3 ) {
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            } else {
                result.complete = 0;
                result.message = i18next.t("apgames:validation.pippinzip.INITIAL_INSTRUCTIONS");
            }
            result.valid = true;
            result.canrender = true;
            return result;
        }

        // check Connection phase

        if ( !this.isZipTurn() ) {
            if ( moves.length > 2 ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pippinzip.ERROR_PLACEMENT_PIP")
                return result;
            }

            if ( moves.length === 2 && this.isAdjacent(moves[0], moves[1]) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pippinzip.ADJACENT_PLACEMENT_PIP")
                return result;
            }

            if ( moves.length === 1 ) {
                result.valid = true;
                result.complete = this.isFull() ? 1 : -1;
                result.canrender = true;
                if ( this.isFull() ) {
                    result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                } else {
                    result.message = i18next.t("apgames:validation.pippinzip.INSTRUCTIONS_PIP_2");
                }
                return result;
            }
        }

        if ( this.isZipTurn() && moves.length > 1 ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.pippinzip.ERROR_PLACEMENT_ZIP")
            return result;
        }

        result.valid = true;
        result.canrender = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {partial = false, trusted = false} = {}): PippinzipGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) { throw new UserFacingError("VALIDATION_GENERAL", result.message) }
        }

        if (m === "") { return this; }

        if (m === "pass") {
            this.zipPlayer = this.currplayer; // auction phase ended, Zip is the 'taker'
            this.results = [{ type: "pass" }];
        } else {
            this.results = [];
            const p = this.inAuctionPhase() || this.isZipTurn() ? 3 : this.currplayer;
            for (const cell of m.split(',')) {
                this.board.set(cell, p);
                this.results.push( {type: "place", where:cell} );
            }
        }

        if (partial) { return this; }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    private buildGraph(player: playerid, useDiag: boolean): UndirectedGraph {
        const grid = new RectGrid(this.boardSize, this.boardSize);
        const graph = new UndirectedGraph();

        [...this.board.entries()].filter(([,p]) => p === player).forEach(([cell,]) => {  // seed nodes
            graph.addNode(cell);
        });
        // for each node, check neighbours; if any are in the graph, add an edge
        for (const node of graph.nodes()) {
            const [x,y] = PippinzipGame.algebraic2coords(node, this.boardSize);
            const neighbours = grid.adjacencies(x, y, useDiag)
                                   .map(n => PippinzipGame.coords2algebraic(...n, this.boardSize));
            for (const n of neighbours) {
                if ( (graph.hasNode(n)) && (! graph.hasEdge(node, n)) ) {
                    graph.addEdge(node, n);
                }
            }
        }
        return graph;
    }

    // returns an orthogonal connection path between two opposite edges,
    // or [] if it does not exist
    private connectedPip(): string[] {
        const pipPlayer: playerid = this.zipPlayer === 1 ? 2 : 1;
        const graph = this.buildGraph(pipPlayer, false); // check orthogonal path for Pip pieces

        for (const [sources, targets] of this.lines) {
            for (const source of sources) {
                for (const target of targets) {
                    if ( (graph.hasNode(source)) && (graph.hasNode(target)) ) {
                        const path = bidirectional(graph, source, target);
                        if (path !== null) {
                            return path;
                        }
                    }
                }
            }
        }
        return [];
    }

    // returns an diagonal connection path between all four edges,
    // or [] if it does not exist
    private connectedZip(): string[] {
        const graph = this.buildGraph(3, true); // check ortho+diag path for Zip pieces
        const path: string[] = []

        // check North/South
        let path1 = null;
        for (const source of this.lines[0][0]) {
            for (const target of this.lines[0][1]) {
                if ( (graph.hasNode(source)) && (graph.hasNode(target)) ) {
                    path1 = bidirectional(graph, source, target);
                    if (path1 !== null) {
                        path.push(...path1);
                        break;
                    }
                }
            }
            if (path1 !== null) break;
        }
        if (path1 === null) return [];

        path.push("0"); // include separator (for rendering purposes)

        // check East/West
        let path2 = null;
        for (const source of this.lines[1][0]) {
            for (const target of this.lines[1][1]) {
                if ( (graph.hasNode(source)) && (graph.hasNode(target)) ) {
                    path2 = bidirectional(graph, source, target);
                    if (path2 !== null) {
                        path.push(...path2);
                        break;
                    }
                }
            }
            if (path2 !== null) break;
        }
        if (path2 === null) return [];

        return path;
    }

    protected checkEOG(): PippinzipGame {
        const prevPlayer = this.currplayer % 2 + 1 as playerid;
        let path = [];

        if ( this.inAuctionPhase() ) {
            // if, strangely, the Zip pieces make a connection before the auction ends, 
            // the game is a win for the player that made the connection
            path = this.connectedZip();
            if ( path.length > 0 ) {
                this.gameover = true;
                this.winner = [prevPlayer];
                this.connPath = [...path];
                this.results.push({ type: "eog" });
            }
        } else {
            if ( this.zipPlayer === prevPlayer ) { // check if Zip won
                path = this.connectedZip();
            } else { // check if Pip won
                path = this.connectedPip();
            }
            if ( path.length > 0 ) {
                this.gameover = true;
                this.winner = [prevPlayer];
                this.connPath = [...path];
                this.results.push({ type: "eog" });
            }
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
        // Build piece string
        let pstr = "";
        for (let row = 0; row < this.boardSize; row++) {
            if (pstr.length > 0) { pstr += "\n"; }
            for (let col = 0; col < this.boardSize; col++) {
                const cell = PippinzipGame.coords2algebraic(col, row, this.boardSize);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell);
                    if (contents === 1) { pstr += "A"; }
                    if (contents === 2) { pstr += "B"; }
                    if (contents === 3) { pstr += "C"; }
                } else {
                    pstr += "-";
                }
            }
        }
        pstr = pstr.replace(new RegExp(`-{${this.boardSize}}`, "g"), "_");

        const pipColour: Colourfuncs = {
            func: "custom",
            default: "#999",
            palette: 3
        };

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "vertex",
                width: this.boardSize,
                height: this.boardSize,
            },
            legend: {
                A: { name: "piece", colour: 1 },
                B: { name: "piece", colour: 2 },
                C: { name: "piece", colour: pipColour },
            },
            pieces: pstr
        };

        // Add annotations
        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = PippinzipGame.algebraic2coords(move.where!, this.boardSize);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
            if (this.connPath.length > 0) {
                if ( this.connPath.includes("0") ) { // it is a four edge connection
                    const i = this.connPath.indexOf("0"); // find where the separator is, to draw each path separately
                    let targets: RowCol[] = [];
                    const path1 = this.connPath.slice(0,i);
                    for (const cell of path1) {
                        const [x,y] = PippinzipGame.algebraic2coords(cell, this.boardSize);
                        targets.push({row: y, col: x})
                    }
                    rep.annotations.push({type: "move", targets: targets as [RowCol, ...RowCol[]], arrow: false});

                    targets = [];
                    const path2 = this.connPath.slice(i+1);
                    for (const cell of path2) {
                        const [x,y] = PippinzipGame.algebraic2coords(cell, this.boardSize);
                        targets.push({row: y, col: x})
                    }
                    rep.annotations.push({type: "move", targets: targets as [RowCol, ...RowCol[]], arrow: false});
                } else { // it is a connection between opposite edges
                    const targets: RowCol[] = [];
                    for (const cell of this.connPath) {
                        const [x,y] = PippinzipGame.algebraic2coords(cell, this.boardSize);
                        targets.push({row: y, col: x})
                    }
                    rep.annotations.push({type: "move", targets: targets as [RowCol, ...RowCol[]], arrow: false});
                }
            }
        }

        return rep;
    }

    public getButtons(): ICustomButton[] {
        if ( this.inAuctionPhase() ) {
            return [{ label: "pass", move: "pass" }];
        }
        return [];
    }

    public state(): IPippinzipState {
        return {
            game: PippinzipGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: PippinzipGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            zipPlayer: this.zipPlayer,
            connPath: [...this.connPath],
        };
    }

    public clone(): PippinzipGame {
        return new PippinzipGame(this.serialize());
    }
}
