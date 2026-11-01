import { GameBase, IAPGameState, IClickResult, IClickBoardContext, IHandleClickUi, IIndividualState, IRenderOpts, IValidationResult , type ChatLogCollectContext, type ChatLogLine} from "./_base.js";
import type { APGamesInformation } from "../schemas/gameinfo.js";
import { APRenderRep, RowCol } from "@abstractplay/renderer/build/schemas/schema";
import type { APMoveResult } from "../schemas/moveresults.js";
import { RectGrid, reviver, UserFacingError } from "../common/index.js";
import { SquareDiamondsDirectedGraph } from "../common/graphs/index.js";
import i18next from "i18next";
import { UndirectedGraph } from "graphology";
import { bidirectional } from "graphology-shortest-path";
export const gameApgamesEn = {
    validation: {
        EMPTY_FROM: "You are indicating to place a diagonal connection, but there is no piece at {{where}}.",
        INITIAL_INSTRUCTIONS: "Select a cell to place a piece, or select a piece to link with a diagonal connection.",
        INVALID_DIAG: "Diagonal connection {{from}} with {{to}} is not valid.",
        NO_DIAGS: "The piece at {{where}} cannot make a diagonal connection with any neighbouring piece.",
        OPPONENT_FROM: "You cannot make a diagonal connection with an opponent's piece at {{where}}.",
        SELECT_TO: "Select an adjacent piece to make a diagonal connection.",
    },
    variants: {
        "#board": {
            name: "11x11 board",
        },
        "size-15": {
            name: "15x15 board",
        },
    },
    displays: {
        "diamond-board": {
            description: "Show diagonal connections as filled diamonds between stones on a squares-and-diamonds board.",
            name: "Diamond board",
        },
    },
};
export const gameApresultsEn = {
    PLACE: {
        diag: "{{player}} placed a diagonal connection at {{where}}.",
    },
};



type playerid = 1 | 2;
type PlayerLines = [string[], string[]];

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    diags: Map<string, playerid>;
    connPath: string[];
    lastmove?: string;
}

export interface IQuaxState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class QuaxGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Quax",
        uid: "quax",
        playercounts: [2],
        version: "20240316",
        dateAdded: "2024-04-02",
        description: "Quax is a connection game on a square board with a special move: instead of placing a stone, you may connect diagonally adjacent stones.",
        urls: ["https://boardgamegeek.com/boardgame/36804/quax"],
        bggid: "36804",
        people: [
            {
                type: "designer",
                name: "Bill Taylor",
                urls: ["https://boardgamegeek.com/boardgamedesigner/9249/bill-taylor"],
            },
            {
                type: "coder",
                name: "ypaul",
                urls: [],
                apid: "46f6da78-be02-4469-94cb-52f17078e9c1",
            },
        ],
        variants: [
            { uid: "size-15", group: "board" },
        ],
        displays: [{ uid: "diamond-board", group: "board-style" }],
        categories: ["goal>connect", "mechanic>place", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
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
    public diags!: Map<string, playerid>;
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

    constructor(state?: IQuaxState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: QuaxGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                diags: new Map(),
                connPath: [],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IQuaxState;
            }
            if (state.game !== QuaxGame.gameinfo.uid) {
                throw new Error(`The Quax game code cannot process a game of '${state.game}'.`);
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

    public load(idx = -1): QuaxGame {
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
        this.diags = new Map(state.diags);
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

    private sdGraph(): SquareDiamondsDirectedGraph {
        return new SquareDiamondsDirectedGraph(this.boardSize, this.boardSize);
    }

    private isDiamondNode(cell: string): boolean {
        return cell.includes("|");
    }

    private crossedDiamond(from: string, to: string): string | undefined {
        const [fx, fy] = this.algebraic2coords(from);
        const [tx, ty] = this.algebraic2coords(to);
        const dx = tx - fx;
        const dy = ty - fy;
        if (Math.abs(dx) !== 1 || Math.abs(dy) !== 1) {
            return undefined;
        }
        if (dx === 1 && dy === 1) {
            return `${from}|${to}`;
        }
        if (dx === 1 && dy === -1) {
            return `${this.coords2algebraic(fx, fy - 1)}|${this.coords2algebraic(fx + 1, fy)}`;
        }
        if (dx === -1 && dy === 1) {
            return `${this.coords2algebraic(fx - 1, fy)}|${this.coords2algebraic(fx, fy + 1)}`;
        }
        return `${this.coords2algebraic(fx - 1, fy - 1)}|${this.coords2algebraic(fx, fy)}`;
    }

    private moveFromDiamondId(diamondId: string): string | undefined {
        const moves = this.diamondMovesFromId(diamondId);
        return moves[0];
    }

    /**
     * Square-diamonds cells use ids `tl|br` (NW–SE of a 2×2). Quax links the other diagonal `tr–bl` of that block too.
     */
    private diamondMovesFromId(diamondId: string): string[] {
        const [tl, br] = diamondId.split("|", 2);
        if (tl === undefined || br === undefined || tl === "" || br === "") {
            return [];
        }
        const moves: string[] = [this.normaliseMove(`${tl}-${br}`)];
        const [tcx, tcy] = this.algebraic2coords(tl);
        const [bcx, bcy] = this.algebraic2coords(br);
        if (bcx === tcx + 1 && bcy === tcy + 1) {
            const tr = this.coords2algebraic(tcx + 1, tcy);
            const bl = this.coords2algebraic(tcx, tcy + 1);
            const alternate = this.normaliseMove(`${tr}-${bl}`);
            if (alternate !== moves[0]) {
                moves.push(alternate);
            }
        }
        return moves;
    }

    private sdRowColForSquare(cell: string): RowCol {
        const [x, y] = this.algebraic2coords(cell);
        return { col: x, row: y * 2 };
    }

    private sdRowColForDiag(diagKey: string): RowCol | undefined {
        const split = diagKey.split("-", 2);
        if (split.length !== 2 || split[0] === undefined || split[1] === undefined) {
            return undefined;
        }
        const diamond = this.crossedDiamond(split[0], split[1]);
        if (diamond === undefined) {
            return undefined;
        }
        try {
            const [col, row] = this.sdGraph().algebraic2coords(diamond);
            return { col, row };
        } catch {
            return undefined;
        }
    }

    private sdCellAt(col: number, row: number): string | undefined {
        try {
            return this.sdGraph().coords2algebraic(col, row);
        } catch {
            return undefined;
        }
    }

    private vertexCellAt(col: number, row: number): string | undefined {
        if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) {
            return undefined;
        }
        return this.coords2algebraic(col, row);
    }

    private buildSquareClickMove(cell: string, move: string): string {
        if (!this.board.has(cell)) {
            return cell;
        }
        if (move === "") {
            const diags = this.getDiags(cell, this.currplayer);
            if (diags.length === 1) {
                return this.normaliseMove(cell + "-" + diags[0]);
            }
            return cell + "-";
        }
        if (move.includes("-")) {
            return this.normaliseMove(move + cell);
        }
        return move + "-" + cell;
    }

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }
        const moves: string[] = [];
        const resolved = new Set<string>();
        for (let x = 0; x < this.boardSize; x++) {
            for (let y = 0; y < this.boardSize; y++) {
                const cell = this.coords2algebraic(x, y);
                if (!this.board.has(cell)) {
                    moves.push(cell);
                } else if (this.board.get(cell) === player) {
                    const diags = this.getDiags(cell, player, resolved);
                    resolved.add(cell);
                    for (const diag of diags) {
                        moves.push(this.normaliseMove(cell + "-" + diag));
                    }
                }
            }
        }
        return moves;
    }

    private clickUsesSquaresDiamonds(ctx?: IClickBoardContext): boolean {
        return ctx?.boardStyle === "squares-diamonds";
    }

    /** Map a board click to a square id for the active draw grid. */
    private resolveSquareCell(col: number, row: number, boardContext?: IClickBoardContext): string {
        if (this.clickUsesSquaresDiamonds(boardContext)) {
            const sdCell = this.sdCellAt(col, row);
            if (sdCell === undefined || this.isDiamondNode(sdCell)) {
                throw new Error("Click is off the board.");
            }
            return sdCell;
        }
        const vCell = this.vertexCellAt(col, row);
        if (vCell === undefined) {
            throw new Error("Click is off the board.");
        }
        return vCell;
    }

    public handleClick(
        move: string,
        row: number,
        col: number,
        piece?: string,
        ui?: IHandleClickUi,
    ): IClickResult {
        try {
            const sdCell = this.sdCellAt(col, row);

            if (sdCell !== undefined && this.isDiamondNode(sdCell)) {
                const diamondMoves = this.diamondMovesFromId(sdCell);
                if (diamondMoves.length === 0) {
                    if (this.clickUsesSquaresDiamonds(ui?.board)) {
                        return {
                            move,
                            valid: false,
                            message: i18next.t("apgames:validation._general.INVALIDCELL", { cell: sdCell }),
                        };
                    }
                } else {
                    let lastResult: IClickResult | undefined;
                    for (const candidate of diamondMoves) {
                        const diamondResult = this.validateMove(candidate) as IClickResult;
                        if (diamondResult.valid && diamondResult.complete === 1) {
                            diamondResult.move = candidate;
                            return diamondResult;
                        }
                        lastResult = diamondResult;
                    }
                    if (this.clickUsesSquaresDiamonds(ui?.board) && lastResult !== undefined) {
                        lastResult.move = move;
                        return lastResult;
                    }
                }
            }

            const cell = this.resolveSquareCell(col, row, ui?.board);
            const newmove = this.buildSquareClickMove(cell, move);
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

    private sort(a: string, b: string): number {
        // Sort two cells. This is necessary because "a10" should come after "a9".
        const [ax, ay] = this.algebraic2coords(a);
        const [bx, by] = this.algebraic2coords(b);
        if (ax < bx) { return -1; }
        if (ax > bx) { return 1; }
        if (ay < by) { return 1; }
        if (ay > by) { return -1; }
        return 0;
    }

    private normaliseMove(m: string): string {
        if (m[m.length - 1] === "-") { return m; }
        const split = m.split("-", 2);
        if (split.length === 1) { return m; }
        return split.sort((a, b) => this.sort(a, b)).join("-");
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.quax.INITIAL_INSTRUCTIONS");
            return result;
        }
        const split = m.split("-", 2);
        // Valid cell.
        let currentMove;
        try {
            for (const p of split) {
                if (p === "") { continue; }
                currentMove = p;
                const [x, y] = this.algebraic2coords(p);
                // `algebraic2coords` does not check if the cell is on the board.
                if (x < 0 || x >= this.boardSize || y < 0 || y >= this.boardSize) {
                    throw new Error("Invalid cell");
                }
            }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: currentMove});
            return result;
        }
        // Cell is already occupied.
        if (split.length === 1) {
            if (this.board.has(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", { where: m });
                return result;
            } else {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
        }
        if (!this.board.has(split[0])) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.quax.EMPTY_FROM", { where: split[0] });
            return result;
        }
        if (this.board.get(split[0]) !== this.currplayer) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.quax.OPPONENT_FROM", { where: split[0] });
            return result;
        }
        const diags = this.getDiags(split[0], this.currplayer);
        if (split[1] === "") {
            if (diags.length === 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.quax.NO_DIAGS", { where: split[0] });
                return result;
            }
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.quax.SELECT_TO");
            return result;
        }
        if (!diags.includes(split[1])) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.quax.INVALID_DIAG", { from: split[0], to: split[1] });
            return result;
        }
        const normalised = this.normaliseMove(m);
        if (normalised !== m) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NORMALISE", { normalised });
            return result;
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private diagNeighbours(cell: string): string[] {
        const [x, y] = this.algebraic2coords(cell);
        const neighbours: string[] = [];
        for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < this.boardSize && ny >= 0 && ny < this.boardSize) {
                neighbours.push(this.coords2algebraic(nx, ny));
            }
        }
        return neighbours;
    }

    private getBlockingDiag(cell1: string, cell2: string): string {
        // Get the cell that blocks the diagonal between cell1 and cell2.
        const [x1, y1] = this.algebraic2coords(cell1);
        const [x2, y2] = this.algebraic2coords(cell2);
        return this.normaliseMove(this.coords2algebraic(x1, y2) + "-" + this.coords2algebraic(x2, y1));
    }

    private getDiags(cell: string, player: playerid, resolved?: Set<string>): string[] {
        const diags: string[] = [];
        for (const neighbour of this.diagNeighbours(cell).map(n => this.coords2algebraic(...this.algebraic2coords(n))) ) {
            if (resolved?.has(neighbour)) { continue; }
            if (this.board.has(neighbour) && this.board.get(neighbour) === player && !this.diags.has(this.normaliseMove(cell + "-" + neighbour))) {
                if (this.diags.has(this.getBlockingDiag(cell, neighbour))) { continue; }
                diags.push(neighbour);
            }
        }
        return diags;
    }

    public move(m: string, {partial = false, trusted = false} = {}): QuaxGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:validation._general.MOVES_GAMEOVER"));
        }

        let result;
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (!trusted) {
            result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
            // if (!partial && !this.moves().includes(m)) {
            //     throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", { move: m }));
            // }
        }
        if (m.length === 0) { return this; }
        this.results = [];
        const split = m.split("-");
        if (split.length === 1) {
            this.results.push({ type: "place", where: m });
            this.board.set(m, this.currplayer);
        } else {
            if (split[1] === "") {
                this.dots = this.getDiags(split[0], this.currplayer);
            } else {
                this.diags.set(m, this.currplayer);
                this.results.push({ type: "place", where: m, what: "diag" });
            }
        }
        if (partial) { return this; }
        this.dots = [];

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
                if ( (graph.hasNode(n)) && (! graph.hasEdge(node, n)) ) {
                    graph.addEdge(node, n);
                }
            }
        }
        // Get all player diags.
        const playerDiags = [...this.diags.entries()].filter(([,p]) => p === player).map(([k,]) => k);
        for (const diag of playerDiags) {
            const [from, to] = diag.split("-", 2);
            graph.addEdge(from, to);
        }
        return graph;
    }

    protected checkEOG(): QuaxGame {
        const otherPlayer = this.currplayer % 2 + 1 as playerid;
        const graph = this.buildGraph(otherPlayer);
        const [sources, targets] = this.lines[otherPlayer - 1];
        for (const source of sources) {
            for (const target of targets) {
                if ( (graph.hasNode(source)) && (graph.hasNode(target)) ) {
                    const path = bidirectional(graph, source, target);
                    if (path !== null) {
                        this.gameover = true;
                        this.winner = [otherPlayer];
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
            this.results.push({ type: "eog" });
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public state(): IQuaxState {
        return {
            game: QuaxGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: QuaxGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            diags: new Map(this.diags),
            connPath: [...this.connPath],
        };
    }

    public render(opts?: IRenderOpts): APRenderRep {
        if (this.hasDisplay(opts, "diamond-board")) {
            return this.renderDiamondBoard();
        }
        return this.renderVertexBoard();
    }

    private renderVertexBoard(): APRenderRep {
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

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const markers: Array<any> = [
            { type:"edge", edge: "N", colour: 1 },
            { type:"edge", edge: "S", colour: 1 },
            { type:"edge", edge: "E", colour: 2 },
            { type:"edge", edge: "W", colour: 2 },
        ];
        for (const move of this.stack) {
            for (const m of move._results) {
                if (m.type === "place" && m.what === "diag") {
                    const split = m.where!.split("-");
                    const player = this.board.get(split[0]);
                    const [x0, y0] = this.algebraic2coords(split[0]);
                    const [x2, y2] = this.algebraic2coords(split[1]);
                    markers.push({ type: "line", points: [{ row: y0, col: x0 }, { row: y2, col: x2 }], colour: "#000", width: 12 });
                    markers.push({ type: "line", points: [{ row: y0, col: x0 }, { row: y2, col: x2 }], colour: player, width: 8 });
                }
            }
        }
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place" && move.what === "diag") {
                    const split = move.where!.split("-");
                    const [x0, y0] = this.algebraic2coords(split[0]);
                    const [x2, y2] = this.algebraic2coords(split[1]);
                    markers.push({ type: "line", points: [{ row: y0, col: x0 }, { row: y2, col: x2 }], colour: "#FFFF00", width: 20, opacity: 0.5 });
                }
            }
        }

        const rep: APRenderRep =  {
            board: {
                style: "vertex",
                width: this.boardSize,
                height: this.boardSize,
                markers,
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
                if (move.type === "place" && move.what !== "diag") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                }
            }
            if (this.connPath.length > 0) {
                const targets: RowCol[] = [];
                for (const cell of this.connPath) {
                    const [x,y] = this.algebraic2coords(cell);
                    targets.push({row: y, col: x})
                }
                rep.annotations.push({type: "line", targets: targets as [RowCol, ...RowCol[]], arrow: false});
            }
        }
        if (this.dots.length > 0) {
            const points = [];
            for (const cell of this.dots) {
                const [x, y] = this.algebraic2coords(cell);
                points.push({ row: y, col: x });
            }
            rep.annotations.push({ type: "dots", targets: points as [{row: number; col: number}, ...{row: number; col: number}[]] });
        }
        return rep;
    }

    private renderDiamondBoard(): APRenderRep {
        const g = this.sdGraph();
        let pstr = "";
        for (const row of g.listCells(true) as string[][]) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.isDiamondNode(cell)) {
                    pieces.push("-");
                } else if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    pieces.push(contents === 1 ? "A" : "B");
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join("");
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const markers: Array<any> = [
            { type: "edge", edge: "N", colour: 1 },
            { type: "edge", edge: "S", colour: 1 },
            { type: "edge", edge: "E", colour: 2 },
            { type: "edge", edge: "W", colour: 2 },
        ];
        for (const [diagKey, player] of this.diags) {
            const pt = this.sdRowColForDiag(diagKey);
            if (pt !== undefined) {
                markers.push({ type: "flood", colour: player, opacity: 0.9, points: [pt] });
            }
        }

        const rep: APRenderRep = {
            board: {
                style: "squares-diamonds",
                width: this.boardSize,
                height: this.boardSize,
                markers,
            },
            legend: {
                A: [{ name: "piece", colour: 1, scale: 0.85 }],
                B: [{ name: "piece", colour: 2, scale: 0.85 }],
            },
            pieces: pstr,
        };

        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place" && move.what === "diag") {
                    const pt = this.sdRowColForDiag(move.where!);
                    if (pt !== undefined) {
                        rep.annotations.push({ type: "enter", targets: [pt] });
                    }
                } else if (move.type === "place") {
                    rep.annotations.push({ type: "enter", targets: [this.sdRowColForSquare(move.where!)] });
                }
            }
            if (this.connPath.length > 0) {
                const targets: RowCol[] = [];
                for (const cell of this.connPath) {
                    targets.push(this.sdRowColForSquare(cell));
                }
                rep.annotations.push({ type: "line", targets: targets as [RowCol, ...RowCol[]], arrow: false });
            }
        }
        if (this.dots.length > 0) {
            const hintPoints: RowCol[] = [];
            for (const target of this.dots) {
                for (const [square, owner] of this.board) {
                    if (owner !== this.currplayer) {
                        continue;
                    }
                    if (!this.getDiags(square, this.currplayer).includes(target)) {
                        continue;
                    }
                    const pt = this.sdRowColForDiag(this.normaliseMove(`${square}-${target}`));
                    if (pt !== undefined) {
                        hintPoints.push(pt);
                    }
                    break;
                }
            }
            if (hintPoints.length > 0) {
                markers.push({
                    type: "flood",
                    colour: "#FFA500",
                    opacity: 0.35,
                    points: hintPoints as [RowCol, ...RowCol[]],
                });
            }
        }
        return rep;
    }


    public collectChatLogLine(lines: ChatLogLine[], r: APMoveResult, ctx: ChatLogCollectContext): boolean {
        switch (r.type) {
            case "place":
                if (r.what === "diag") {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:quax.PLACE.diag", { where: r.where! });
                } else {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:_general.PLACE.nowhat", { where: r.where! });
                }
                return true;

            default:
                return super.collectChatLogLine(lines, r, ctx);
        }
    }


    public clone(): QuaxGame {
        return new QuaxGame(this.serialize());
    }
}

