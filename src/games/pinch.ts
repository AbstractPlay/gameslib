import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, MarkerEdge } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { Direction, RectGrid, reviver, UserFacingError, SquareOrthGraph } from "../common";
import { UndirectedGraph } from "graphology";
import { bidirectional } from "graphology-shortest-path/unweighted";
import i18next from "i18next";

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    connPath: string[];
    lastmove?: string;
};

export interface IPinchState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

type PlayerLines = [string[], string[]];

export class PinchGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Pinch",
        uid: "pinch",
        playercounts: [2],
        version: "20260423",
        dateAdded: "2026-04-23",
        // i18next.t("apgames:descriptions.pinch")
        description: "apgames:descriptions.pinch",
        urls: [
            "https://boardgamegeek.com/boardgame/285214/pinch",
        ],
        people: [
            {
                type: "designer",
                name: "Craig Duncan",
                urls: ["https://boardgamegeek.com/boardgamedesigner/66694/craig-duncan"],
                apid: "d1f9fa1b-889c-4234-a95c-9a5d389bf98e",
            },
            {
                type: "coder",
                name: "João Pedro Neto",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3829/joao-pedro-neto"],
                apid: "9228bccd-a1bd-452b-b94f-d05380e6638f",
            },
        ],
        variants: [
            { uid: "size-5", group: "board" },
            { uid: "size-9", group: "board" },
            { uid: "size-13", group: "board" },
            { uid: "size-15", group: "board" },
            { uid: "#board", },  // 17x17
            { uid: "size-21", group: "board" },
            { uid: "original", group: "ruleset" },
        ],
        categories: ["goal>connect", "mechanic>place", "mechanic>capture", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["pie", "experimental"]
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
    public connPath: string[] = [];
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private boardSize = 0;
    private lines: [PlayerLines, PlayerLines];
    private ruleset: "default" | "original";

    constructor(state?: IPinchState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const board = new Map<string, playerid>();
            const fresh: IMoveState = {
                _version: PinchGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                connPath: [],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IPinchState;
            }
            if (state.game !== PinchGame.gameinfo.uid) {
                throw new Error(`The Pinch engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
        this.lines = this.getLines();
        this.ruleset = this.getRuleset();
    }

    public load(idx = -1): PinchGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.results = [...state._results];
        this.lastmove = state.lastmove;
        this.connPath = [...state.connPath];
        this.boardSize = this.getBoardSize();
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
        return 17;
    }

    private getRuleset(): "default" | "original" {
        if (this.variants.includes("original")) { return "original"; }
        return "default";
    }

    // returns the cells belonging to each board edge
    private getLines(): [PlayerLines,PlayerLines] {
        const lineN: string[] = [];
        const lineS: string[] = [];
        for (let x = 0; x < this.boardSize; x++) {
            const N = this.coords2algebraic(x, 0);
            const S = this.coords2algebraic(x, this.boardSize - 1);
            lineN.push(N);
            lineS.push(S);
        }
        const lineE: string[] = [];
        const lineW: string[] = [];
        for (let y = 0; y < this.boardSize; y++) {
            const E = this.coords2algebraic(this.boardSize-1, y);
            const W = this.coords2algebraic(0, y);
            lineE.push(E);
            lineW.push(W);
        }
        return [[lineN, lineS], [lineE, lineW]];
    }

    public moves(): string[] {
        return []; // too many moves to list
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            let newmove = "";

            if (this.ruleset === "original") {
                newmove = cell; // there is just one placement in the original rules
            } else {
                if ( move === "" ) {
                    newmove = cell;
                } else {
                    const moves = move.split(",");
                    if ( moves[moves.length - 1] === cell ) {
                        newmove = moves.slice(0, -1).join(","); // if same as last, undo it
                    } else {
                        newmove = `${move},${cell}`; // otherwise, append coordinates of current click
                    }
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

    // get all captured stones if 'player' places at 'cell' given the current 'board'
    private getCaptures(cell: string, player: playerid, board: Map<string, playerid>): string[] {
        const captures = new Set<string>;
        const [x, y] = this.algebraic2coords(cell);
        const grid = new RectGrid(this.boardSize, this.boardSize);
        const nonos: [Direction, Direction][] = [["N","E"], ["S","E"], ["S","W"], ["N","W"]];

        for (const [left, right] of nonos) {
            // check if there's a friend on that diagonal
            const dirDiag = (left + right) as Direction;
            const rayDiag = grid.ray(x, y, dirDiag).map(n => this.coords2algebraic(...n));
            if (rayDiag.length > 0) {
                if ( !board.has(rayDiag[0]) || board.get(rayDiag[0])! !== player ) {
                    continue; // no friend at diagonal, so no captures in this direction
                }
                // check if there is an opponent stone at its left to be captured
                const rayLeft = grid.ray(x, y, left).map(n => this.coords2algebraic(...n));
                if (rayLeft.length > 0) {
                    if ( (board.has(rayLeft[0])) && (board.get(rayLeft[0])! !== player) ) {
                        captures.add(rayLeft[0]);
                    }
                }
                // check if there is an opponent stone at its right to be captured
                const rayRight = grid.ray(x, y, right).map(n => this.coords2algebraic(...n));
                if (rayRight.length > 0) {
                    if ( (board.has(rayRight[0])) && (board.get(rayRight[0])! !== player) ) {
                        captures.add(rayRight[0]);
                    }
                }
            }
        }
        return [...captures];
    }

    // checks if there are still available placements at a given 'board', while assuming a set of taboo cells
    private availableSpaces(board: Map<string, playerid>, taboo: Set<string>): boolean {
        const allPieces = [...this.board.entries()].map(e => e[0]);
        const g = new SquareOrthGraph(this.boardSize, this.boardSize);

        for (const node of g.graph.nodes()) {
            if (allPieces.includes(node) || taboo.has(node)) {
                g.graph.dropNode(node);
            }
        }
        return [...g.graph.nodes()].length > 0;
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false,
                                           message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            if (this.ruleset === "original") {
                result.message = i18next.t("apgames:validation.pinch.INITIAL_INSTRUCTIONS_ORIGINAL")
            } else {
                result.message = i18next.t("apgames:validation.pinch.INITIAL_INSTRUCTIONS")
            }

            return result;
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (this.ruleset === "original") {
            // here is the entire validateMove for the "original" variant (a simpler game)
            if ( this.board.has(m) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pinch.OCCUPIED_CELL");
                return result;
            } else {
                result.valid = true;
                result.complete = 1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
        }

        // need to move through all the moves, and check if they follow the rules
        // for that we need a copy of the board, to keep the effects of the previous moves
        const clone = new Map(this.board);
        // all cells that changed state, bc these cannot be reused in this turn
        const changed: Set<string> = new Set();
        // the 'queue' keeps all pairs [playerid,stone] that were captured and not yet placed
        const queue: [playerid, string][] = [];
        const player = this.currplayer;

        const [firstMove, ...rest] = m.split(',');
        if ( clone.has(firstMove) ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.pinch.OCCUPIED_CELL");
            return result;
        }

        for (const capture of this.getCaptures(firstMove, player, clone)) {
            clone.delete(capture);
            changed.add(capture);
            queue.push([player % 2 + 1 as playerid, capture]); // these are opponent stones
        }
        clone.set(firstMove, player);
        changed.add(firstMove);

        // now, deal with the remaining moves
        for ( const move of rest ) {
            if ( changed.has(move) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pinch.REUSED_CELL", {cell: move});
                return result;
            }

            if ( clone.has(move) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pinch.OCCUPIED_CELL");
                return result;
            }

            const [p, ] = queue.shift()!; // current move is the relocation of this stone

            for (const capture of this.getCaptures(move, p, clone)) {
                if ( changed.has(capture) ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.pinch.REUSED_CELL", {cell: capture});
                    return result;
                }
                clone.delete(capture);
                changed.add(capture);
                queue.push([p % 2 + 1 as playerid, capture]); // these are opponent stones
            }
            clone.set(move, p);
            changed.add(move);
        }

        if ( this.availableSpaces(this.board, changed) && queue.length > 0 ) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            if ( queue[0][0] === this.currplayer ) {
                const n = queue.filter(e => e[0] === this.currplayer).length;
                if (n === queue.length) {
                    result.message = i18next.t("apgames:validation.pinch.SELF_STONES_TO_PLACE", { own: n });
                } else {
                    result.message = i18next.t("apgames:validation.pinch.SELF_OPP_STONES_TO_PLACE",
                                               { own: n, opp: queue.length - n });
                }
            } else {
                const n = queue.filter(e => e[0] === (this.currplayer%2 + 1 as playerid)).length;
                if (n === queue.length) {
                    result.message = i18next.t("apgames:validation.pinch.OPP_STONES_TO_PLACE", { opp: n });
                } else {
                    result.message = i18next.t("apgames:validation.pinch.OPP_SELF_STONES_TO_PLACE",
                                               { own: queue.length - n, opp: n });
                }
            }
            return result;
        }

        // Looks good
        result.valid = true;
        result.complete = 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {partial = false, trusted = false} = {}): PinchGame {
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

        if (this.ruleset === "original") {
            // here is the entire move() for the "original" variant
            const queue: string[] = [m];
            while ( queue.length > 0 ) {
                const cell: string = queue.shift()!;
                this.board.set(cell, this.currplayer);
                this.results.push({type: "place", where: cell});
                for (const capture of this.getCaptures(cell, this.currplayer, this.board)) {
                    queue.push(capture);
                }
            }

            this.lastmove = m;
            this.currplayer = this.currplayer % 2 + 1 as playerid;
            this.checkEOG();
            this.saveState();
            return this;
        }

        // the 'queue' keeps all pairs [playerid,stone] that were captured and not yet placed
        const queue: [playerid, string][] = [];
        const player = this.currplayer;

        const [firstMove, ...rest] = m.split(',');

        for (const capture of this.getCaptures(firstMove, player, this.board)) {
            this.board.delete(capture);
            this.results.push({type: "capture", where: capture});
            queue.push([player % 2 + 1 as playerid, capture]); // these are opponent stones
        }
        this.board.set(firstMove, player);
        this.results.push({ type: "place", where: firstMove });

        // now, deal with the remaining moves
        for ( const move of rest ) {
            const [p, ] = queue.shift()!; // current move is the relocation of this stone
            for (const capture of this.getCaptures(move, p, this.board)) {
                this.board.delete(capture);
                this.results.push({type: "capture", where: capture});
                queue.push([p % 2 + 1 as playerid, capture]);
            }
            this.board.set(move, p);
            this.results.push({ type: "place", where: move });
        }

        if ( partial ) { return this; }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    private buildGraph(player: playerid): UndirectedGraph {
        const grid = new RectGrid(this.boardSize, this.boardSize);
        const graph = new UndirectedGraph();
        // seed nodes
        [...this.board.entries()].filter(([,p]) => p === player).forEach(([cell,]) => {
            graph.addNode(cell);
        });
        // for each node, check neighbours
        // if any are in the graph, add an edge
        for (const node of graph.nodes()) {
            const [x,y] = this.algebraic2coords(node);
            // diagonal connections are not relevant
            const neighbours = grid.adjacencies(x,y,false).map(n => this.coords2algebraic(...n));
            for (const n of neighbours) {
                if ( (graph.hasNode(n)) && (! graph.hasEdge(node, n)) ) {
                    graph.addEdge(node, n);
                }
            }
        }
        return graph;
    }

    protected checkEOG(): PinchGame {
        const prevPlayer: playerid = this.currplayer === 1 ? 2 : 1 ;

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
            if (this.gameover) {
                break;
            }
        }

        // since relocation can happen, either player can win after the position stabilizes
        // so we need to check the win condition again for the remaining player
        const graph2 = this.buildGraph(this.currplayer);
        const [sources2, targets2] = this.lines[this.currplayer - 1];
        for (const source of sources2) {
            for (const target of targets2) {
                if ( (graph2.hasNode(source)) && (graph2.hasNode(target)) ) {
                    const path = bidirectional(graph2, source, target);
                    if (path !== null) {
                        this.gameover = true;
                        this.winner = [this.currplayer];
                        this.connPath = [...path];
                        break;
                    }
                }
            }
            if (this.gameover) {
                break;
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

    public state(): IPinchState {
        return {
            game: PinchGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: PinchGame.gameinfo.version,
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

        const markers: Array<MarkerEdge> = [
            { type:"edge", edge: "N", colour: 1 },
            { type:"edge", edge: "S", colour: 1 },
            { type:"edge", edge: "E", colour: 2 },
            { type:"edge", edge: "W", colour: 2 },
        ];

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "vertex",
                width: this.boardSize,
                height: this.boardSize,
                markers,
            },
            legend: {
                A: { name: "piece", colour: 1 },
                B: { name: "piece", colour: 2 }
            },
            pieces: pstr
        };

        // Add annotations
        rep.annotations = [];
        if ( this.results.length > 0 ) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    // rep.annotations.push({type: "dots", targets: [{row: y, col: x}], colour: "#fff"});
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
                if (move.type === "capture") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    // rep.annotations.push({type: "dots", targets: [{row: y, col: x}], colour: "#fff"});
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                }
            }
        }
        if ( this.connPath.length > 0 ) {
            type RowCol = {row: number; col: number;};
            const targets: RowCol[] = [];
            for (const cell of this.connPath) {
                const [x,y] = this.algebraic2coords(cell);
                targets.push({row: y, col: x})                ;
            }
            rep.annotations.push({type: "move", targets: targets as [RowCol, ...RowCol[]], arrow: false});
        }

        return rep;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected getMoveList(): any[] {
        return this.getMovesAndResults(["place", "eog", "winners"]);
    }

    public clone(): PinchGame {
        return new PinchGame(this.serialize());
    }
}