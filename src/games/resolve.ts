import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { Directions, RectGrid, reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { UndirectedGraph } from "graphology";
import { bidirectional } from "graphology-shortest-path";

type playerid = 1 | 2;
type PlayerLines = [string[], string[]];

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    connPath: string[];
    lastmove?: string;
}

export interface IResolveState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class ResolveGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Resolve",
        uid: "resolve",
        playercounts: [2],
        version: "20240917",
        dateAdded: "2024-09-22",
        // i18next.t("apgames:descriptions.resolve")
        description: "apgames:descriptions.resolve",
        urls: ["https://boardgamegeek.com/boardgame/314106/resolve"],
        people: [
            {
                type: "designer",
                name: "Alek Erickson",
                urls: ["https://boardgamegeek.com/boardgamedesigner/101050/alek-erickson"],
            }
        ],
        variants: [
            { uid: "size-13", group: "board" },
        ],
        categories: ["goal>connect", "mechanic>place", "mechanic>move", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["pie"],
    };

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardSize);
    }

    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardSize);
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, playerid>;
    public connPath: string[] = [];
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private boardSize = 0;
    private dots: string[] = [];
    private grid: RectGrid;
    private lines: [PlayerLines,PlayerLines];

    constructor(state?: IResolveState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: ResolveGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                connPath: [],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IResolveState;
            }
            if (state.game !== ResolveGame.gameinfo.uid) {
                throw new Error(`The Resolve game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
        this.grid = new RectGrid(this.boardSize, this.boardSize);
        this.lines = this.getLines();
    }

    public load(idx = -1): ResolveGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if (idx < 0 || idx >= this.stack.length) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        if (state === undefined) {
            throw new Error(`Could not load state index ${idx}`);
        }
        this.results = [...state._results];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.connPath = [...state.connPath];
        this.lastmove = state.lastmove;
        this.boardSize = this.getBoardSize();
        return this;
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

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }
        const moves: string[] = [];
        for (let row = 0; row < this.boardSize; row++) {
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) { continue; }
                for (const path of this.traversePaths(player, [cell])) {
                    moves.push(path.join("-"));
                }
            }
        }
        if (moves.length === 0) {
            for (let row = 0; row < this.boardSize; row++) {
                for (let col = 0; col < this.boardSize; col++) {
                    const cell = this.coords2algebraic(col, row);
                    if (!this.board.has(cell)) { continue; }
                    if (this.board.get(cell) !== player) { continue; }
                    if (this.swappablePieces(cell, player).length === 0) { continue; }
                    for (const path of this.traversePaths(player, [cell])) {
                        moves.push(path.join("-"));
                    }
                }
            }
        }
        return moves;
    }

    private hasPlacement(): boolean {
        // Check if the player has placement moves.
        return this.board.size < this.boardSize * this.boardSize;
    }

    private traversePaths(player: playerid, path: string[]): string[][] {
        // Traverse all paths that a piece may take.
        // The first element of `path` should be the starting cell, or where it was placed.
        const swappablePieces = this.swappablePieces(path[path.length - 1], player, path.slice(0, -1));
        if (swappablePieces.length === 0) {
            return [path];
        }
        const paths: string[][] = [];
        for (const piece of swappablePieces) {
            paths.push(...this.traversePaths(player, [...path, piece]));
        }
        return paths;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            let newmove = "";
            if (move === "") {
                newmove = cell;
            } else {
                newmove = `${move}-${cell}`;
            }
            const result = this.validateMove(newmove) as IClickResult;
            if (!result.valid) {
                result.move = move;
            } else {
                result.move = newmove;
            }
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", { move, row, col, piece, emessage: (e as Error).message })
            }
        }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = { valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER") };
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            if (this.hasPlacement()) {
                result.message = i18next.t("apgames:validation.resolve.INITIAL_INSTRUCTIONS");
            } else {
                result.message = i18next.t("apgames:validation.resolve.INITIAL_INSTRUCTIONS_SWAP");
            }
            return result;
        }
        const moves = m.split("-");

        // Valid cell
        let currentMove;
        try {
            for (const p of moves) {
                currentMove = p;
                const [x, y] = this.algebraic2coords(p);
                // `algebraic2coords` does not check if the cell is on the board.
                if (x < 0 || x >= this.boardSize || y < 0 || y >= this.boardSize) {
                    throw new Error("Invalid cell");
                }
            }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: currentMove });
            return result;
        }

        const swapped: string[] = [];
        for (const [i, move] of moves.entries()) {
            if (i === 0) {
                if (this.hasPlacement()) {
                    if (this.board.has(move)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.OCCUPIED", { where: move });
                        return result;
                    }
                } else {
                    if (this.board.get(move) !== this.currplayer) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.resolve.CHOOSE_OWN", { where: move });
                        return result;
                    }
                    if (this.swappablePieces(move, this.currplayer).length === 0) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.resolve.CANNOT_SWAP", { where: move });
                        return result;
                    }
                    if (moves.length === 1) {
                        result.valid = true;
                        result.complete = -1;
                        result.canrender = true;
                        result.message = i18next.t("apgames:validation.resolve.SWAP");
                        return result;
                    }
                }
            } else {
                const prev = moves[i - 1];
                const swappablePieces = this.swappablePieces(prev, this.currplayer, swapped);
                if (!swappablePieces.includes(move)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.resolve.INVALID_SWAP", { to: move, from: prev });
                    return result;
                }
                swapped.push(prev);
            }
        }

        if (this.swappablePieces(moves[moves.length - 1], this.currplayer, moves.slice(0, -1)).length > 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.resolve.SWAP");
            return result;
        }

        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private getCrossCuts(cell: string, player: playerid, swapped: string[] = []): Directions[] {
        // Return the directions of crosscuts.
        const [x, y] = this.algebraic2coords(cell);
        const toCheck: [Directions, Directions][] = [["N", "E"], ["S", "E"], ["S", "W"], ["N", "W"]];
        const crosscuts: Directions[] = [];
        for (const [left, right] of toCheck) {
            let matchLeft = false;
            const rayLeft = this.grid.ray(x, y, left).map(n => this.coords2algebraic(...n));
            if (rayLeft.length > 0) {
                if (swapped.includes(rayLeft[0]) || this.board.has(rayLeft[0]) && this.board.get(rayLeft[0])! !== player) {
                    matchLeft = true;
                }
            }
            let matchRight = false;
            const rayRight = this.grid.ray(x, y, right).map(n => this.coords2algebraic(...n));
            if (rayRight.length > 0) {
                if (swapped.includes(rayRight[0]) || this.board.has(rayRight[0]) && this.board.get(rayRight[0])! !== player) {
                    matchRight = true;
                }
            }
            const dirDiag = (left + right) as Directions;
            let matchDiag = false;
            const rayDiag = this.grid.ray(x, y, dirDiag).map(n => this.coords2algebraic(...n));
            if (rayDiag.length > 0) {
                if (!swapped.includes(rayDiag[0]) && this.board.has(rayDiag[0]) && this.board.get(rayDiag[0])! === player) {
                    matchDiag = true;
                }
            }
            if (matchLeft && matchRight && matchDiag) {
                crosscuts.push(dirDiag);
            }
        }
        return crosscuts;
    }

    private swappablePieces(where: string, player: playerid, swapped: string[] = []): string[] {
        // Get the pieces that can be swapped.
        const coords = this.algebraic2coords(where);
        const pieces: string[] = [];
        const crosscuts = this.getCrossCuts(where, player, swapped);
        for (const crosscut of crosscuts) {
            for (const dir of crosscut as string) {
                const piece = this.coords2algebraic(...RectGrid.move(...coords, dir as Directions));
                if (pieces.includes(piece)) { continue; }
                if (swapped.includes(piece)) { continue; }
                pieces.push(piece);
            }
        }
        return pieces;
    }

    public move(m: string, { partial = false, trusted = false } = {}): ResolveGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        let result;
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (!trusted) {
            result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
            if (!partial && !this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", { move: m }));
            }
        }
        if (m.length === 0) { return this; }
        this.dots = [];
        this.results = [];
        const moves = m.split("-");
        for (const [i, move] of moves.entries()) {
            if (i === 0) {
                if (!this.board.has(move)) {
                    this.results.push({ type: "place", where: move });
                    if (moves.length === 1) {
                        this.board.set(move, this.currplayer);
                    } else {
                        this.board.set(move, this.currplayer % 2 + 1 as playerid);
                    }
                } else {
                    this.results.push({ type: "select", where: move });
                    if (moves.length > 1) {
                        this.board.set(move, this.currplayer % 2 + 1 as playerid);
                    }
                }
            } else {
                this.results.push({ type: "swap", where: move, with: moves[i-1] });
            }
            if (i === moves.length - 1) {
                this.board.set(move, this.currplayer);
            }
        }
        const swappablePieces = this.swappablePieces(moves[moves.length - 1], this.currplayer, moves.slice(0, -1));
        for (const piece of swappablePieces) {
            if (!this.dots.includes(piece)) {
                this.dots.push(piece);
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
        [...this.board.entries()].filter(([,p]) => p === player).forEach(([cell,]) => {
            graph.addNode(cell);
        });
        // for each node, check neighbours
        // if any are in the graph, add an edge
        for (const node of graph.nodes()) {
            const [x,y] = this.algebraic2coords(node);
            const neighbours = this.grid.adjacencies(x, y, false).map(n => this.coords2algebraic(...n));
            for (const n of neighbours) {
                if (graph.hasNode(n) && !graph.hasEdge(node, n)) {
                    graph.addEdge(node, n);
                }
            }
        }
        return graph;
    }

    protected checkEOG(): ResolveGame {
        for (const player of [1, 2] as playerid[]) {
            // We need to check both players because
            // the swapping may lead to a win for either player.
            const graph = this.buildGraph(player);
            const [sources, targets] = this.lines[player - 1];
            for (const source of sources) {
                for (const target of targets) {
                    if (graph.hasNode(source) && graph.hasNode(target)) {
                        const path = bidirectional(graph, source, target);
                        if (path !== null) {
                            this.gameover = true;
                            this.winner = [player];
                            this.connPath = [...path];
                            break;
                        }
                    }
                }
                if (this.gameover) {
                    break;
                }
            }
        }
        if (this.gameover) {
            this.results.push({ type: "eog" });
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public state(): IResolveState {
        return {
            game: ResolveGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: ResolveGame.gameinfo.version,
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
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell);
                    if (contents === 1) {
                        pstr += "A";
                    } else if (contents === 2) {
                        pstr += "B";
                    }
                } else {
                    pstr += "-";
                }
            }
        }
        pstr = pstr.replace(new RegExp(`-{${this.boardSize}}`, "g"), "_");

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "vertex",
                width: this.boardSize,
                height: this.boardSize,
                markers: [
                    { type:"edge", edge: "N", colour: 1 },
                    { type:"edge", edge: "S", colour: 1 },
                    { type:"edge", edge: "E", colour: 2 },
                    { type:"edge", edge: "W", colour: 2 },
                ],
            },
            legend: {
                A: [{ name: "piece", colour: 1 }],
                B: [{ name: "piece", colour: 2 }],
            },
            pieces: pstr,
        };

        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                } else if (move.type === "swap") {
                    const [fromX, fromY] = this.algebraic2coords(move.with!);
                    const [toX, toY] = this.algebraic2coords(move.where);
                    rep.annotations.push({ type: "move", targets: [{ row: fromY, col: fromX }, { row: toY, col: toX }] });
                }
            }
            if (this.connPath.length > 0) {
                const targets: RowCol[] = [];
                for (const cell of this.connPath) {
                    const [x,y] = this.algebraic2coords(cell);
                    targets.push({ row: y, col: x })
                }
                rep.annotations.push({ type: "move", targets: targets as [RowCol, ...RowCol[]], arrow: false });
            }
        }
        if (this.dots.length > 0) {
            const points = [];
            for (const cell of this.dots) {
                const [x, y] = this.algebraic2coords(cell);
                points.push({ row: y, col: x });
            }
            rep.annotations.push({ type: "dots", targets: points as [RowCol, ...RowCol[]] });
        }
        return rep;
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.nowhat", { player, where: r.where }));
                resolved = true;
                break;
            case "swap":
                node.push(i18next.t("apresults:SWAP.resolve", { player, where: r.where }));
                resolved = true;
                break;
            case "select":
                node.push(i18next.t("apresults:SELECT.resolve", { player, where: r.where }));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): ResolveGame {
        return new ResolveGame(this.serialize());
    }
}
