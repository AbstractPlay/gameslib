import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import { HexSlantedGraph } from "../common/graphs";
import { UndirectedGraph } from "graphology";
import { bidirectional } from "graphology-shortest-path/unweighted";
import i18next from "i18next";

export type playerid = 1 | 2;
export type cellcontents = [playerid, number]; // number: 1 for moving tower, 2 for static piece/cube

type directions = "NE"|"E"|"SE"|"SW"|"W"|"NW";

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, cellcontents>;
    connPath: string[];
    lastmove?: string;
};

export interface IPolluxState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

type PlayerLines = [string[], string[]];

export class PolluxGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Pollux",
        uid: "pollux",
        playercounts: [2],
        version: "20260602",
        dateAdded: "2026-06-22",
        // i18next.t("apgames:descriptions.pollux")
        description: "apgames:descriptions.pollux",
        urls: [
            "https://boardgamegeek.com/boardgame/82267/pollux",
        ],
        people: [
            {
                type: "designer",
                name: "Alban Viard",
                urls: ["https://boardgamegeek.com/boardgamedesigner/6048/alban-viard"],
            },
            {
                type: "coder",
                name: "João Pedro Neto",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3829/joao-pedro-neto"],
                apid: "9228bccd-a1bd-452b-b94f-d05380e6638f",
            },
        ],
        categories: ["goal>connect", "goal>immobilize", "mechanic>place", "mechanic>move", "mechanic>block", "board>shape>rect", "board>connect>hex", "components>simple>1per"],
        flags: ["automove"],
        variants: [
            { uid: "#board", }, // size-10
            { uid: "size-12", group: "board", },
            { uid: "size-14", group: "board", },
            { uid: "size-16", group: "board", },
            { uid: "size-18", group: "board", },
        ]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, cellcontents>;
    public connPath: string[] = [];
    public graph: HexSlantedGraph;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private boardSize = 0;
    private lines: [PlayerLines, PlayerLines];
    private _points: [number, number][] = []; // if there are points here, the renderer will show them

    constructor(state?: IPolluxState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: PolluxGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                connPath: [],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IPolluxState;
            }
            if (state.game !== PolluxGame.gameinfo.uid) {
                throw new Error(`The Pollux engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
        this.graph = this.getGraph();
        this.lines = this.getLines();
    }

    public load(idx = -1): PolluxGame {
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
        this.results = [...state._results];
        this.connPath = [...state.connPath];
        this.boardSize = this.getBoardSize();
        return this;
    }

    private getLines(): [PlayerLines,PlayerLines] {
        const lineN: string[] = [];
        const lineS: string[] = [];
        for (let x = 0; x < this.boardSize; x++) {
            const N = this.graph.coords2algebraic(x, 0);
            const S = this.graph.coords2algebraic(x, this.boardSize - 1);
            lineN.push(N);
            lineS.push(S);
        }
        const lineE: string[] = [];
        const lineW: string[] = [];
        for (let y = 0; y < this.boardSize; y++) {
            const E = this.graph.coords2algebraic(this.boardSize-1, y);
            const W = this.graph.coords2algebraic(0, y);
            lineE.push(E);
            lineW.push(W);
        }
        return [[lineN,lineS],[lineE,lineW]];
    }

    private getBoardSize(): number {
        // Get board size from variants.
        if ( (this.variants !== undefined) && (this.variants.length > 0) && (this.variants[0] !== undefined) && (this.variants[0].length > 0) ) {
            const sizeVariants = this.variants.filter(v => v.includes("size"))
            if (sizeVariants.length > 0) {
                const size = sizeVariants[0].match(/\d+/);
                return parseInt(size![0], 10);
            }
            if (isNaN(this.boardSize)) {
                throw new Error(`Could not determine the board size from variant "${this.variants[0]}"`);
            }
        }
        return 10;
    }

    private getGraph(): HexSlantedGraph {
        return new HexSlantedGraph(this.boardSize, this.boardSize);
    }

    // return the pieces adjacent to 'cell'
    private nNeighbors(cell: string): string[] {
        const res = [];
        for (const neigh of this.graph.neighbours(cell)) {
            if ( this.board.has(neigh) ) {
                res.push(neigh);
            }
        }
        return res;
    }

    private shuffle<T>(xs: T[]): void {
        for (let i = xs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1)); // random index from 0 to i
            [xs[i], xs[j]] = [xs[j], xs[i]];
        }
    }

    public moves(player?: playerid, safe:boolean = false): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) { player = this.currplayer; }
        const moves: string[] = [];

        if ( this.stack.length === 1 || this.stack.length === 3 ) {
            // at ply 1 and 3 just drop a tower on an empty isolated cell
            const empties = (this.graph.listCells() as string[]).filter(c => !this.board.has(c));
            for (const cell of empties) {
                if ( this.nNeighbors(cell).length === 0 ) {
                    moves.push(cell);
                }
            }
        }

        if ( this.stack.length === 2 ) {
            // at ply 2 drop both towers on empty isolated cells
            const empties = (this.graph.listCells() as string[]).filter(c => !this.board.has(c));

            ///// hack: to work with AP's playground (since flags no-moves and automove are incompatible)
            // this is the computational heaviest ply of the game, computing all possible moves is unfeasible
            this.shuffle(empties);
            for (const cell of empties) {
                if ( this.nNeighbors(cell).length === 0 ) {
                    for (const cell1 of empties) {
                        if ( cell === cell1 ) { continue; }
                        if ( this.nNeighbors(cell1).length === 0 &&
                            !this.graph.neighbours(cell).includes(cell1) ) {
                            moves.push(`${cell},${cell1}`);
                            if (moves.length >= 50) { return moves; }
                        }
                    }
                }
            }
            //// end hack

            /* validateMove does not need this computation, which is too costly: O(n^4)
              for (const cell of empties) {
                if ( this.nNeighbors(cell).length === 0 ) {
                    for (const cell1 of empties) {
                        if ( cell === cell1 ) { continue; }
                        if ( this.nNeighbors(cell1).length === 0 &&
                            !this.graph.neighbours(cell).includes(cell1) ) {
                            moves.push(`${cell},${cell1}`);
                        }
                    }
                }
            }*/
        }

        if ( this.stack.length === 4 ) {
            return ["pass"];
        }

        if ( this.stack.length > 4 ) { // the towers are already placed: move one tower and shoot one piece
            const dirs: directions[] = ["NE","E","SE","SW","W","NW"];
            const clone = new Map(this.board); // work on clone, just in case
            // find player's towers
            const towers = [...clone.entries()].filter(e => e[1][0] === player && e[1][1] === 1)
                                               .map(e => e[0]);
            for (const tower of towers) {
                const [x, y] = this.graph.algebraic2coords(tower);
                for (const dir of dirs) {
                    for (const cell of this.graph.ray(x, y, dir)) {
                        const toCell = this.graph.coords2algebraic(cell[0], cell[1]);
                        if (clone.has(toCell)) { break; }
                        // now, after tower moved from 'tower' to 'toCell', we need to shoot
                        clone.delete(tower);            // simulate the movement of the tower
                        clone.set(toCell, [player, 1]); // needed bc the tower can shoot back, to where it was
                        const [x1, y1] = this.graph.algebraic2coords(toCell);
                        for (const shootDir of dirs) {
                            for (const shootCell of this.graph.ray(x1, y1, shootDir)) {
                                const shoot = this.graph.coords2algebraic(shootCell[0], shootCell[1]);
                                if (clone.has(shoot)) { break; }
                                moves.push(`${tower},${toCell},${shoot}`);
                            }
                        }
                        clone.delete(toCell); // undo the simulated move
                        clone.set(tower, [player, 1]);
                    }
                }
            }
        }

        if (! safe ) { // shows a sample of moves (just for the frontend, the code will keep `safe` as true)
            this.shuffle(moves);
            return moves.slice(0, 50); // output a random (smallish) selection of moves
        }

        return moves;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = "";
            const cell = this.graph.coords2algebraic(col, row);

            if ( move === "" ) {
                newmove = cell;
            } else if ( move === cell ) {  // reclick tower to reset move
                newmove = "";
            } else {
                newmove = `${move},${cell}`;
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

    private hasPrefix(moves: string[], partial: string): boolean {
        return moves.some(str => str.startsWith(partial));
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = { valid: false,
                                            message: i18next.t("apgames:validation._general.DEFAULT_HANDLER") };
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            if (this.stack.length === 1)
                result.message = i18next.t("apgames:validation.pollux.INITIAL_INSTRUCTIONS_1");
            if (this.stack.length === 2)
                result.message = i18next.t("apgames:validation.pollux.INITIAL_INSTRUCTIONS_2");
            if (this.stack.length === 3)
                result.message = i18next.t("apgames:validation.pollux.INITIAL_INSTRUCTIONS_3");
            if (this.stack.length > 3)
                result.message = i18next.t("apgames:validation.pollux.INSTRUCTION_SLIDE");
            return result;
        }

        if (m === "pass") {
            if (this.stack.length !== 4) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pollux.BAD_PASS");
                return result;
            } else {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
        }

        const moves = m.split(',');
        const allMoves = this.moves(this.currplayer, true);

        try {
            for (const cell of moves) {
                this.graph.algebraic2coords(cell);
            }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
            return result;
        }

        if ( moves.length === 1 ) {
            if ( this.stack.length < 4 && this.nNeighbors(moves[0]).length > 0 ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pollux.TOWER_ADJACENT");
                return result;
            }

            if ( this.stack.length === 1 ||
                 (this.stack.length === 3 && !this.board.has(moves[0])) ) {
                result.valid = true;
                result.complete = 1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }

            if ( this.stack.length === 2 && !this.board.has(moves[0])) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.pollux.INITIAL_INSTRUCTIONS_3");
                return result;
            }

            if ( this.stack.length <= 3 && this.board.has(moves[0]) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pollux.TOWER_OCCUPIED_CELL");
                return result;
            }

            if (!this.board.has(moves[0]) ||
                  this.board.get(moves[0])![0] !== this.currplayer ||
                  this.board.get(moves[0])![1] !== 1 ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pollux.NEED_FRIENDLY_TOWER");
                return result;
            }
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.pollux.INSTRUCTION_SLIDE");
            return result;
        }

        if ( moves.length === 2 ) {
            if ( this.stack.length === 1 || this.stack.length === 3 ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {m});
                return result;
            }

            if ( this.stack.length < 4 &&
                 (this.nNeighbors(moves[1]).length > 0 || this.graph.neighbours(moves[0]).includes(moves[1])) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pollux.TOWER_ADJACENT");
                return result;
            }

            if ( this.stack.length === 2 ) {
                if ( this.board.has(moves[0]) || this.board.has(moves[1]) ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.pollux.TOWER_OCCUPIED_CELL");
                    return result;
                }
                result.valid = true;
                result.complete = 1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }

            if ( this.board.has(moves[1]) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pollux.TOWER_OCCUPIED_CELL");
                return result;
            }

            if (! this.hasPrefix(allMoves, m) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pollux.TOWER_STRAIGHT_LINE");
                return result;
            }

            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.pollux.INSTRUCTION_SHOOT");
            return result;
        }

        if ( moves.length === 3 ) {
            if ( this.board.has(moves[2]) && moves[2] !== moves[0]) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pollux.PIECE_OCCUPIED_CELL");
                return result;
            }
        }

        if ( moves.length > 3 ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {m});
            return result;
        }

        if (! this.hasPrefix(allMoves, m) ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.pollux.PIECE_STRAIGHT_LINE");
            return result;
        }

        result.valid = true;
        result.complete = 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    // return the list of cells the current move can go to
    private findPoints(moves: string[]): string[] {
        if (this.stack.length > 3) {
            if (moves.length === 1) {
                return this.moves(this.currplayer, true).filter(m => m.startsWith(moves[0]))
                                                        .map(m => m.split(',')[1]);
            }
            if (moves.length === 2) {
                return this.moves(this.currplayer, true).filter(m => m.startsWith(moves.join(',')))
                                                        .map(m => m.split(',')[2]);
            }
        }
        return [];
    }

    public move(m: string, {partial = false, trusted = false} = {}): PolluxGame {
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
        }

        this.results = [];
        if (m === "") { return this; }

        const moves = m.split(',');

        if ( partial ) { // if partial, set the points to be shown
            this._points = this.findPoints(moves).map(c => this.graph.algebraic2coords(c));
        } else {
            this._points = []; // otherwise delete the points and process the full move
        }

        if ( this.stack.length <= 3 ) {
            for (const cell of moves) {
                this.board.set(cell, [this.currplayer, 1]);
                this.results.push({type: "place", where: cell});
            }
        } else {
            if ( moves.length === 1 ) {
                this.results.push({type: "place", where: moves[0]});
            } else if ( moves.length === 2 ) {
                this.board.delete(moves[0]);
                this.board.set(moves[1], [this.currplayer, 1]);
                this.results.push({type: "move", from: moves[0], to: moves[1]});
            } else {
                this.board.delete(moves[0]);
                this.board.set(moves[1], [this.currplayer, 1]);
                this.results.push({type: "move", from: moves[0], to: moves[1]});
                this.board.set(moves[2], [this.currplayer, 2]);
                this.results.push({type: "block", where: moves[2]});
            }
        }

        if (partial) { return this; }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    private buildGraph(player: playerid): UndirectedGraph {
        const graph = new UndirectedGraph();
        // seed nodes
        [...this.board.entries()].filter(([,p]) => p[0] === player).forEach(([cell,]) => {
            graph.addNode(cell);
        });
        // for each node, check neighbours
        // if any are in the graph, add an edge
        for (const node of graph.nodes()) {
            const neighbours = this.graph.neighbours(node);
            for (const n of neighbours) {
                if (graph.hasNode(n) && !graph.hasEdge(node, n)) {
                    graph.addEdge(node, n);
                }
            }
        }
        return graph;
    }

    protected checkEOG(): PolluxGame {
        const prevPlayer = this.currplayer % 2 + 1 as playerid;
        // note that the current player is yet to move, we're checking the previous player last move
        if ( this.moves(this.currplayer, true).length === 0 ) { // if no valid moves are left, the current player loses
            this.gameover = true;
            this.winner = [prevPlayer];
        } else { // otherwise, check if the previous player has a connection
            const graph = this.buildGraph(prevPlayer);
            const [sources, targets] = this.lines[prevPlayer - 1];
            for (const source of sources) {
                for (const target of targets) {
                    if ( (graph.hasNode(source)) && (graph.hasNode(target)) ) {
                        const path = bidirectional(graph, source, target);
                        if (path !== null) {
                            this.gameover = true;
                            this.winner = [prevPlayer];
                            this.connPath = [...path];
                            break;
                        }
                    }
                }
                if (this.gameover) { break; }
            }
        }

        if (this.gameover) {
            this.results.push( {type: "eog"},
                               {type: "winners", players: [...this.winner]} );
        }
        return this;
    }

    public state(): IPolluxState {
        return {
            game: PolluxGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: PolluxGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            connPath: [...this.connPath],
        };
    }

    public render(): APRenderRep {
        // Build piece string
        const pstr: string[][] = [];
        const cells = this.graph.listCells(true);
        for (const row of cells) {
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const [owner, piece] = this.board.get(cell)!;
                    if (owner === 1) {
                        pieces.push(piece === 1 ? "C" : "A"); // C is tower, A is piece/cube
                    } else {
                        pieces.push(piece === 1 ? "D" : "B"); // D is tower, B is piece/cube
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr.push(pieces);
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "hex-slanted",
                width: this.boardSize,
                height: this.boardSize,
                markers: [
                    { type: "edge", edge: "N", colour: 1 },
                    { type: "edge", edge: "S", colour: 1 },
                    { type: "edge", edge: "W", colour: 2 },
                    { type: "edge", edge: "E", colour: 2 },
                ],
            },
            options: ["reverse-letters"],
            legend: {
                A: { name: "piece", colour: 1 },
                B: { name: "piece", colour: 2 },
                C: { name: "piece-horse", colour: 1 },
                D: { name: "piece-horse", colour: 2 },
            },
            pieces: pstr.map(p => p.join("")).join("\n"),
        };

        // Add annotations
        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "block") {
                    const [x, y] = this.graph.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
                if (move.type === "move") {
                    const [fromX, fromY] = this.graph.algebraic2coords(move.from);
                    const [toX, toY] = this.graph.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                }
            }
            if (this.connPath.length > 0) {
                type RowCol = {row: number; col: number;};
                const targets: RowCol[] = [];
                for (const cell of this.connPath) {
                    const [x, y] = this.graph.algebraic2coords(cell);
                    targets.push({row: y, col: x})
                }
                rep.annotations.push({type: "move", targets: targets as [RowCol, ...RowCol[]], arrow: false});
            }
        }

        // show the dots where the selected piece can move to
        if (this._points.length > 0) {
            const points = [];
            for (const [x,y] of this._points) {
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
            case "move":
                node.push(i18next.t("apresults:MOVE.complete", { player, from: r.from, to: r.to, what: "piece" }));
                resolved = true;
                break;
            case "block":
                node.push(i18next.t("apresults:PLACE.pollux", { player, where: r.where }));
                resolved = true;
                break;
            case "eog":
                node.push(i18next.t("apresults:EOG.default"));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): PolluxGame {
        return new PolluxGame(this.serialize());
    }
}
