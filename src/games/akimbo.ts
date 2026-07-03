import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, MarkerEdge } from "@abstractplay/renderer/build/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { Direction, RectGrid, reviver, UserFacingError } from "../common";
import { UndirectedGraph } from "graphology";
import { bidirectional } from "graphology-shortest-path/unweighted";
import i18next from "i18next";

export type playerid = 1 | 2 | 3 | 4; // 3 represents empty cell; 4 is off-board

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    connPath: string[];
    lastmove?: string;
    nakedDiagonalP1: string[];
    nakedDiagonalP2: string[];
};

export interface IAkimboState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

type PlayerLines = [string[],string[]];

export class AkimboGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Akimbo",
        uid: "akimbo",
        playercounts: [2],
        version: "20260613",
        dateAdded: "2026-06-22",
        // i18next.t("apgames:descriptions.akimbo")
        description: "apgames:descriptions.akimbo",
        notes: "apgames:notes.akimbo",
        urls: [
            "https://boardgamegeek.com/boardgame/466041/akimbo",
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
        variants: [
            { uid: "size-9", group: "board" },
            { uid: "size-11", group: "board" },
            { uid: "size-13", group: "board" },
            { uid: "#board", }, // 15x15
            { uid: "size-17", group: "board" },
            { uid: "size-19", group: "board" },
        ],
        categories: ["goal>connect", "mechanic>place", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["no-moves", "pie"]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public connPath: string[] = [];
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public nakedDiagonalP1: string[] = [];
    public nakedDiagonalP2: string[] = [];
    private boardSize = 0;
    private lines: [PlayerLines, PlayerLines];

    constructor(state?: IAkimboState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const board = new Map<string, playerid>();
            const fresh: IMoveState = {
                _version: AkimboGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                connPath: [],
                nakedDiagonalP1: [],
                nakedDiagonalP2: [],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IAkimboState;
            }
            if (state.game !== AkimboGame.gameinfo.uid) {
                throw new Error(`The Akimbo engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
        this.lines = this.getLines();
    }

    public load(idx = -1): AkimboGame {
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
        this.connPath = [...state.connPath];
        this.boardSize = this.getBoardSize();
        this.results = [...state._results];
        this.nakedDiagonalP1 = [...state.nakedDiagonalP1];
        this.nakedDiagonalP2 = [...state.nakedDiagonalP2];
        return this;
    }

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardSize);
    }
    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardSize);
    }

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

    private getBoardSize(): number {
        // Get board size from variants.
        if (this.variants !== undefined && this.variants.length > 0 && this.variants[0] !== undefined && this.variants[0].length > 0) {
            const sizeVariants = this.variants.filter(v => v.includes("size"))
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

    // returns [p1,p2,p3] where `p1` is the player at its `dir1`, `p2` at its `dir2`,
    //                      and `p3` at the diagonal of both directions
    // returns 3 anytime a cell is empty, or 4 if the 'cell' is off-board
    // requires: dir1 in [N,S] && dir2 in [E,W]
    private checkDiagonal(cell: string, dir1: Direction, dir2: Direction): [playerid,playerid,playerid] {
        const [x,y] = this.algebraic2coords(cell);
        const g = new RectGrid(this.boardSize, this.boardSize);
        let p1: playerid, p2: playerid, p3: playerid;

        let ray = g.ray(x, y, dir1).map(n => this.coords2algebraic(...n));
        if (ray.length > 0) {
            p1 = this.board.has(ray[0]) ? this.board.get(ray[0])! : 3;
        } else {
            p1 = 4;
        };

        ray = g.ray(x, y, dir2).map(n => this.coords2algebraic(...n));
        if (ray.length > 0) {
            p2 = this.board.has(ray[0]) ? this.board.get(ray[0])! : 3;
        } else {
            p2 = 4;
        };

        ray = g.ray(x, y, (dir1+dir2) as Direction).map(n => this.coords2algebraic(...n));
        if (ray.length > 0) {
            p3 = this.board.has(ray[0]) ? this.board.get(ray[0])! : 3;
        } else {
            p3 = 4;
        };

        return [p1, p2, p3];
    }

    // check if placing at stone at `cell` creates a naked diagonal for the current player
    // def: a naked diagonal is a pair of like-colored, diagonally adjacent stones with no other
    //      like-colored stone adjacent to both
    private numNakedDiagonals(cell: string): number {
        const dirs: [Direction, Direction][] = [["N","E"],["S","E"],["S","W"],["N","W"]];
        let nNaked = 0;

        for (const [dir1, dir2] of dirs) {
            const [p1, p2, p3] = this.checkDiagonal(cell, dir1, dir2);
            if ( p1 === 4 || p2 === 4 ) { continue; }
            if ( p1 !== this.currplayer && p2 !== this.currplayer && p3 === this.currplayer ) {
                nNaked += 1;
            }
        }
        return nNaked;
    }

    // returns the friendly stone that makes a naked diagonal with `cell`
    // requires: numNakedDiagonals(cell) === 1
    private pairNakedDiagonal(cell: string): string {
        const dirs: [Direction, Direction][] = [["N","E"],["S","E"],["S","W"],["N","W"]];
        const g = new RectGrid(this.boardSize, this.boardSize);
        const [x,y] = this.algebraic2coords(cell);

        for (const [dir1, dir2] of dirs) {
            const [p1, p2, p3] = this.checkDiagonal(cell, dir1, dir2);
            if ( p1 === 4 || p2 === 4 ) { continue; }
            if ( p1 !== this.currplayer && p2 !== this.currplayer && p3 === this.currplayer ) {
                return this.coords2algebraic(...g.ray(x, y, (dir1+dir2) as Direction)[0]);
            }
        }
        throw new Error(`Could not determine the naked diagonal of ${cell}"`);
    }

    // check if placing at stone at `cell` creates a crosscut for the current player
    // def: a crosscut is a 2×2 area with two interlocking naked diagonals of opposite colors
    private isCrosscut(cell: string): boolean {
        const dirs: [Direction, Direction][] = [["N","E"],["S","E"],["S","W"],["N","W"]];
        const prevplayer = this.currplayer % 2 + 1 as playerid;

        for (const [dir1, dir2] of dirs) {
            const [p1, p2, p3] = this.checkDiagonal(cell, dir1, dir2);
            if ( p1 === 4 || p2 === 4 ) { continue; }
            if ( p1 === prevplayer && p2 === prevplayer && p3 === this.currplayer ) {
                return true;
            }
        }
        return false;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            const result = this.validateMove(cell) as IClickResult;
            result.move = result.valid ? cell : move;
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
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.akimbo.INSTRUCTIONS")
            return result;
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        try { // check if cell is valid
            this.algebraic2coords(m);
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
            return result;
        }

        if ( this.board.has(m) ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.compart.OCCUPIED");
            return result;
        }

        const prevNaked = this.currplayer === 1 ? this.nakedDiagonalP1 : this.nakedDiagonalP2;
        const wasNaked = prevNaked.length > 0;

        this.board.set(m, this.currplayer); // simulate placement
        const continuesNaked = wasNaked && this.numNakedDiagonals(prevNaked[0]) > 0;
        const newNakeds = this.numNakedDiagonals(m);
        this.board.delete(m); // undo placement

        if ( continuesNaked && newNakeds > 0 || newNakeds > 1 ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.akimbo.EXCESS_NAKED_DIAGONALS");
            return result;
        }

        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {trusted = false} = {}): AkimboGame {
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

        this.board.set(m, this.currplayer);
        this.results.push( {type: "place", where: m} );

        const prevNaked = this.currplayer === 1 ? this.nakedDiagonalP1 : this.nakedDiagonalP2;
        let isNaked = prevNaked.length > 0;

        if ( isNaked ) { // a naked diagonal existed
            if ( this.numNakedDiagonals(prevNaked[0]) === 0 ) { // but not anymore
                isNaked = this.numNakedDiagonals(m) > 0; // check if 'm' created a new naked diagonal
            }
        }

        if ( !isNaked ) { // remove naked diagonal
            if ( this.currplayer === 1 ) {
                this.nakedDiagonalP1 = [];
            } else {
                this.nakedDiagonalP2 = [];
            }
        }

        if ( this.numNakedDiagonals(m) > 0 ) {
            if ( this.currplayer === 1 ) {
                this.nakedDiagonalP1 = [m, this.pairNakedDiagonal(m)];
            } else {
                this.nakedDiagonalP2 = [m, this.pairNakedDiagonal(m)];
            }
        }

        if ( this.isCrosscut(m) ) {
            // m and its pair are the one and only naked diagonal of current player
            // so the naked diagonal disappears, since its pair is about to be removed
            if ( this.currplayer === 1 ) {
                this.nakedDiagonalP1 = [];
            } else {
                this.nakedDiagonalP2 = [];
            }

            const toDelete = this.pairNakedDiagonal(m);
            this.board.delete(toDelete);
            this.results.push( {type: "remove", where: toDelete} );
        }

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
            const neighbours = grid.adjacencies(x,y,false).map(n => this.coords2algebraic(...n));
            for (const n of neighbours) {
                if ( (graph.hasNode(n)) && (! graph.hasEdge(node, n)) ) {
                    graph.addEdge(node, n);
                }
            }
        }
        return graph;
    }

    protected checkEOG(): AkimboGame {
        const prevplayer = this.currplayer % 2 + 1 as playerid;
        const graph = this.buildGraph(prevplayer);
        const [sources, targets] = this.lines[prevplayer - 1];

        for (const source of sources) {
            for (const target of targets) {
                if ( (graph.hasNode(source)) && (graph.hasNode(target)) ) {
                    const path = bidirectional(graph, source, target);
                    if (path !== null) {
                        this.gameover = true;
                        this.winner = [prevplayer];
                        this.connPath = [...path];
                        break;
                    }
                }
            }
            if (this.gameover) { break; }
        }

        if (this.gameover) {
            this.results.push( {type: "eog"},
                               {type: "winners", players: [...this.winner]} );
        }
        return this;
    }

    public render(): APRenderRep {
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
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
                if (move.type === "remove") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                }
            }

            if (this.connPath.length > 0) {
                type RowCol = {row: number; col: number;};
                const targets: RowCol[] = [];
                for (const cell of this.connPath) {
                    const [x,y] = this.algebraic2coords(cell);
                    targets.push({row: y, col: x})                ;
                }
                rep.annotations.push({type: "move", targets: targets as [RowCol, ...RowCol[]], arrow: false});
            }
        }

        // render naked diagonals
        if ( this.nakedDiagonalP1.length > 0 ) {
            type RowCol = {row: number; col: number;};
            const targets: RowCol[] = [];
            for (const cell of this.nakedDiagonalP1) {
                const [x,y] = this.algebraic2coords(cell);
                targets.push({row: y, col: x})                ;
            }
            rep.annotations.push({type: "move", targets: targets as [RowCol, ...RowCol[]], arrow: false});
        }

        if ( this.nakedDiagonalP2.length > 0 ) {
            type RowCol = {row: number; col: number;};
            const targets: RowCol[] = [];
            for (const cell of this.nakedDiagonalP2) {
                const [x,y] = this.algebraic2coords(cell);
                targets.push({row: y, col: x})                ;
            }
            rep.annotations.push({type: "move", targets: targets as [RowCol, ...RowCol[]], arrow: false});
        }

        return rep;
    }

    public state(): IAkimboState {
        return {
            game: AkimboGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: AkimboGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            connPath: [...this.connPath],
            nakedDiagonalP1: [...this.nakedDiagonalP1],
            nakedDiagonalP2: [...this.nakedDiagonalP2],
        };
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "remove":
                node.push(i18next.t("apresults:REMOVE.akimbo", { player, where: r.where }));
                resolved = true;
                break;
            case "eog":
                node.push(i18next.t("apresults:EOG.default"));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): AkimboGame {
        return new AkimboGame(this.serialize());
    }
}
