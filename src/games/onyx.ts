import { GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { UndirectedGraph } from "graphology";
import { bidirectional } from "graphology-shortest-path";
import { OnyxGraph } from "../common/graphs";

type playerid = 1 | 2;
type PlayerLines = [string[], string[]];

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    connPath: string[];
    lastmove?: string;
}

export interface IOnyxState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class OnyxGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Onyx",
        uid: "onyx",
        playercounts: [2],
        version: "20240929",
        dateAdded: "2024-10-06",
        // i18next.t("apgames:descriptions.onyx")
        description: "apgames:descriptions.onyx",
        urls: ["https://boardgamegeek.com/boardgame/11375/onyx"],
        people: [
            {
                type: "designer",
                name: "Larry Back",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3654/larry-back"],
            },
            {
                type: "coder",
                name: "ypaul",
                urls: [],
                apid: "46f6da78-be02-4469-94cb-52f17078e9c1",
            },
        ],
        variants: [
            { uid: "size-16", group: "board" },
            { uid: "size-20", group: "board" },
            { uid: "head-start", group: "setup" },
        ],
        categories: ["goal>connect", "mechanic>place", "mechanic>capture", "board>shape>rect", "components>simple"],
        flags: ["pie"],
        displays: [{ uid: "hide-threatened" }],
    };

    public coords2algebraic(x: number, y: number): string {
        return this.graph.coords2algebraic(x, y);
    }

    public algebraic2coords(cell: string): [number, number] {
        return this.graph.algebraic2coords(cell);
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
    private lines: [PlayerLines,PlayerLines];
    private graph: OnyxGraph;

    constructor(state?: IOnyxState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            this.boardSize = this.getBoardSize();
            this.graph = new OnyxGraph(this.boardSize, this.boardSize);
            const fresh: IMoveState = {
                _version: OnyxGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: this.getInitialBoard(),
                connPath: [],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IOnyxState;
            }
            if (state.game !== OnyxGame.gameinfo.uid) {
                throw new Error(`The Onyx game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
            this.boardSize = this.getBoardSize();
            this.graph = new OnyxGraph(this.boardSize, this.boardSize);
        }
        this.load();
        this.lines = this.getLines();
    }

    public load(idx = -1): OnyxGame {
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
        return this;
    }

    private getInitialBoard(): Map<string, playerid> {
        // Get the initial board.
        const board = new Map<string, playerid>();
        if (this.variants.includes("head-start")) {
            const N1 = this.coords2algebraic(this.boardSize / 2 - 1, 0);
            const N2 = this.coords2algebraic(this.boardSize / 2, 0);
            const S1 = this.coords2algebraic(this.boardSize / 2 - 1, 2 * this.boardSize - 2);
            const S2 = this.coords2algebraic(this.boardSize / 2, 2 * this.boardSize - 2);
            const W1 = this.coords2algebraic(0, this.boardSize);
            const W2 = this.coords2algebraic(0, this.boardSize - 2);
            const E1 = this.coords2algebraic(this.boardSize - 1, this.boardSize);
            const E2 = this.coords2algebraic(this.boardSize - 1, this.boardSize - 2);
            const cells1 = [W1, W2, E1, E2];
            const cells2 = [N1, N2, S1, S2];
            for (const cell of cells1) {
                board.set(cell, 1);
            }
            for (const cell of cells2) {
                board.set(cell, 2);
            }
        }
        return board;
    }

    private getLines(): [PlayerLines,PlayerLines] {
        const lineN: string[] = [];
        const lineS: string[] = [];
        for (let x = 0; x < this.boardSize; x++) {
            const N = this.coords2algebraic(x, 0);
            const S = this.coords2algebraic(x, 2 * this.boardSize - 2);
            lineN.push(N);
            lineS.push(S);
        }
        const lineE: string[] = [];
        const lineW: string[] = [];
        for (let y = 0; y < 2 * this.boardSize - 1; y++) {
            if (y % 2 !== 0) { continue; }
            const E = this.coords2algebraic(this.boardSize - 1, y);
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
        return 12;
    }

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }
        const moves: string[] = [];
        for (const cell of this.graph.listCells(false) as string[]) {
            if (!this.canPlace(cell)) { continue; }
            const capturePairs = this.getCapturePairs(cell, player);
            if (capturePairs.length === 0) {
                moves.push(cell);
            } else if (capturePairs.length === 1) {
                moves.push(cell + "x");
            } else {
                moves.push(cell + "xx");
            }
        }
        return moves;
    }

    private canPlace(cell: string): boolean {
        // Check if a vertex can be placed on.
        if (this.board.has(cell)) { return false; }
        if (!cell.includes("/")) { return true; }
        const [cell1, cell2] = cell.split("/");
        const [x1, y1] = this.algebraic2coords(cell1);
        const [x2, y2] = this.algebraic2coords(cell2);
        if (this.board.has(this.coords2algebraic(x1, y1))) { return false; }
        if (this.board.has(this.coords2algebraic(x2, y2))) { return false; }
        if (this.board.has(this.coords2algebraic(x1, y2))) { return false; }
        if (this.board.has(this.coords2algebraic(x2, y1))) { return false; }
        return true;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            let newmove = "";
            const capturePairs = this.getCapturePairs(cell, this.currplayer);
            if (capturePairs.length === 0) {
                newmove = cell;
            } else if (capturePairs.length === 1) {
                newmove = cell + "x";
            } else {
                newmove = cell + "xx";
            }
            const result = this.validateMove(newmove) as IClickResult;
            if (!result.valid) {
                result.move = "";
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
            result.message = i18next.t("apgames:validation.onyx.INITIAL_INSTRUCTIONS");
            return result;
        }
        const move = m.replace(/x+$/, "");
        const xCount = m.length - move.length;
        // Valid cell
        if (!this.graph.graph.hasNode(move)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: move });
            return result;
        }
        if (this.board.has(move)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", { where: move });
            return result;
        }
        if (!this.canPlace(move)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.onyx.BLOCKED_CENTRE", { where: move });
            return result;
        }
        const pairs = this.getCapturePairs(move, this.currplayer);
        if (pairs.length === 0) {
            if (xCount > 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.onyx.NO_CAPTURES", { move });
                return result;
            }
        } else if (pairs.length === 1) {
            if (xCount !== 1) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.onyx.SINGLE_CAPTURE", { move: move + "x" });
                return result;
            }
        } else {
            if (xCount !== 2) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.onyx.DOUBLE_CAPTURE", { move: move + "xx" });
                return result;
            }
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private getCapturePairs(cell: string, player: playerid): [string, string][] {
        // Return pairs of cells that are captured by placing a vertex at cell.
        const pairs: [string, string][] = [];
        if (cell.includes("/")) { return pairs; }
        const [x, y] = this.algebraic2coords(cell);
        const toCheck = [[-1, -2], [1, 2], [-1, 2], [1, -2]];
        for (const [dx, dy] of toCheck) {
            const [nx, ny] = [x + dx, y + dy];
            if (nx < 0 || nx >= this.boardSize || ny < 0 || ny >= 2 * this.boardSize - 1) { continue; }
            const centre = `${this.coords2algebraic(Math.min(x, nx), Math.max(y, ny))}/${this.coords2algebraic(Math.max(x, nx), Math.min(y, ny))}`;
            // If centre exists, we can proceed with the capture check.
            if (!this.graph.graph.hasNode(centre)) { continue; }
            if (this.board.has(centre)) { continue; }
            const enemy1 = this.coords2algebraic(nx, y);
            if (this.board.get(enemy1) !== player % 2 + 1) { continue; }
            const enemy2 = this.coords2algebraic(x, ny);
            if (this.board.get(enemy2) !== player % 2 + 1) { continue; }
            const self = this.coords2algebraic(nx, ny);
            if (this.board.get(self) !== player) { continue; }
            pairs.push([enemy1, enemy2]);
        }
        return pairs;
    }

    public move(m: string, { partial = false, trusted = false } = {}): OnyxGame {
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
        const move = m.replace(/x+$/, "");
        this.results.push({ type: "place", where: move });
        this.board.set(move, this.currplayer);
        const pairs = this.getCapturePairs(move, this.currplayer);
        for (const pair of pairs) {
            for (const cell of pair) {
                this.board.delete(cell);
            }
            this.results.push({ type: "capture", where: pair.join(",") });
        }

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
            const neighbours = this.graph.neighbours(node);
            for (const n of neighbours) {
                if (graph.hasNode(n) && !graph.hasEdge(node, n)) {
                    graph.addEdge(node, n);
                }
            }
        }
        return graph;
    }

    protected checkEOG(): OnyxGame {
        const otherPlayer = this.currplayer % 2 + 1 as playerid;
        const graph = this.buildGraph(otherPlayer);
        const [sources, targets] = this.lines[otherPlayer - 1];
        for (const source of sources) {
            for (const target of targets) {
                if (graph.hasNode(source) && graph.hasNode(target)) {
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

    public state(): IOnyxState {
        return {
            game: OnyxGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: OnyxGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            connPath: [...this.connPath],
        };
    }

    private getThreatened(): [Set<string>, Set<string>] {
        // Get all threatened cells for each player.
        const threatened1: Set<string> = new Set();
        const threatened2: Set<string> = new Set();
        for (const cell of this.graph.listCells(false) as string[]) {
            if (this.board.has(cell)) { continue; }
            const pairs1 = this.getCapturePairs(cell, 2);
            if (pairs1.length > 0) {
                for (const pair of pairs1) {
                    threatened1.add(pair[0]);
                    threatened1.add(pair[1]);
                }
            }
            const pairs2 = this.getCapturePairs(cell, 1);
            if (pairs2.length > 0) {
                for (const pair of pairs2) {
                    threatened2.add(pair[0]);
                    threatened2.add(pair[1]);
                }
            }
        }
        return [threatened1, threatened2];
    }

    public render(opts?: IRenderOpts): APRenderRep {
        let altDisplay: string | undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }
        let showThreatened = true;
        if (altDisplay !== undefined) {
            if (altDisplay === "hide-threatened") {
                showThreatened = false;
            }
        }
        const threatened: [Set<string>, Set<string>] = showThreatened ? this.getThreatened() : [new Set(), new Set()];
        // Build piece string
        let pstr = "";
        for (const row of this.graph.listCells(true) as string[][]) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell);
                    if (contents === 1) {
                        if (threatened[0].has(cell)) {
                            pstr += "C";
                        } else {
                            pstr += "A";
                        }
                    } else if (contents === 2) {
                        if (threatened[1].has(cell)) {
                            pstr += "D";
                        } else {
                            pstr += "B";
                        }
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
                style: "onyx",
                width: this.boardSize,
                height: this.boardSize,
                markers: [
                    { type: "edge", edge: "N", colour: 1 },
                    { type: "edge", edge: "S", colour: 1 },
                    { type: "edge", edge: "W", colour: 2 },
                    { type: "edge", edge: "E", colour: 2 },
                ]
            },
            legend: {
                A: [{ name: "piece", colour: 1, scale: 0.7 }],
                B: [{ name: "piece", colour: 2, scale: 0.7 }],
                C: [
                    { name: "piece-borderless", scale: 0.8, colour: 2 },
                    { name: "piece", scale: 0.7, colour: 1 },
                ], // Player 1 threatened
                D: [
                    { name: "piece-borderless", scale: 0.8, colour: 1 },
                    { name: "piece", scale: 0.7, colour: 2 },
                ], // Player 2 threatened
            },
            pieces: pstr,
        };

        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                } else if (move.type === "capture") {
                    for (const cell of move.where!.split(",")) {
                        const [x, y] = this.algebraic2coords(cell);
                        rep.annotations.push({ type: "exit", targets: [{ row: y, col: x }] });
                    }
                }
            }
            if (this.connPath.length > 0) {
                const targets: RowCol[] = [];
                for (const cell of this.connPath) {
                    const [x,y] = this.algebraic2coords(cell);
                    targets.push({row: y, col: x})
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
            case "capture":
                const [c1, c2] = r.where!.split(",");
                node.push(i18next.t("apresults:CAPTURE.onyx", { where1: c1, where2: c2 }));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): OnyxGame {
        return new OnyxGame(this.serialize());
    }
}
