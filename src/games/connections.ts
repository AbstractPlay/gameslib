import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, MarkerEdge, MarkerLine, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
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

export interface IConnectionsState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class ConnectionsGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Connections",
        uid: "connections",
        playercounts: [2],
        version: "20240912",
        dateAdded: "2024-09-14",
        // i18next.t("apgames:descriptions.connections")
        description: "apgames:descriptions.connections",
        urls: ["https://boardgamegeek.com/boardgame/3370/connections"],
        people: [
            {
                type: "designer",
                name: "Tom McNamara",
            },
            {
                type: "coder",
                name: "ypaul",
                urls: [],
                apid: "46f6da78-be02-4469-94cb-52f17078e9c1",
            },
        ],
        variants: [
            { uid: "size-5", group: "board" },
        ],
        categories: ["goal>align", "goal>connect", "mechanic>place", "board>shape>rect", "board>connect>rect", "components>special"],
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
    private lines: [PlayerLines, PlayerLines];

    constructor(state?: IConnectionsState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: ConnectionsGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                connPath: [],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IConnectionsState;
            }
            if (state.game !== ConnectionsGame.gameinfo.uid) {
                throw new Error(`The Connections game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
        this.lines = this.getLines();
    }

    public load(idx = -1): ConnectionsGame {
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
        this.boardSize = this.getBoardSize() * 2 + 1;
        return this;
    }

    private getLines(): [PlayerLines,PlayerLines] {
        const lineN: string[] = [];
        const lineS: string[] = [];
        for (let x = 0; x < (this.boardSize + 1) / 2; x++) {
            const N = this.coords2algebraic(2 * x + 1, 1) + "v";
            const S = this.coords2algebraic(2 * x + 1, this.boardSize - 2) + "v";
            lineN.push(N);
            lineS.push(S);
        }
        const lineE: string[] = [];
        const lineW: string[] = [];
        for (let y = 0; y < (this.boardSize + 1) / 2; y++) {
            const E = this.coords2algebraic(this.boardSize - 2, 2 * y + 1) + "h";
            const W = this.coords2algebraic(1, 2 * y + 1) + "h";
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
                if (row % 2 !== col % 2 || row < 1 || col < 1 || row >= this.boardSize - 1 || col >= this.boardSize - 1) {
                    continue;
                }
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell + "h")) { continue; }
                if (this.board.has(cell + "v")) { continue; }
                if ((player === 1) === (row % 2 === 0)) {
                    moves.push(cell + "h");
                } else {
                    moves.push(cell + "v");
                }
            }
        }
        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            let newmove = "";
            if (col % 2 !== row % 2 || col < 1 || row < 1 || col >= this.boardSize - 1 || row >= this.boardSize - 1) {
                newmove = move;
            } else {
                if ((this.currplayer === 1) === (row % 2 === 0)) {
                    newmove = cell + "h";
                } else {
                    newmove = cell + "v";
                }
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
            result.message = i18next.t("apgames:validation.connections.INITIAL_INSTRUCTIONS");
            return result;
        }
        // valid move
        try {
            const [x, y,] = this.splitLine(m);
            if (x % 2 !== y % 2 || x < 1 || y < 1 || x >= this.boardSize - 1 || y >= this.boardSize - 1) {
                throw new Error("Invalid line");
            }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation.connections.INVALID_LINE", { move: m });
            return result;
        }
        const cell = m.slice(0, m.length - 1);
        if (this.board.has(cell + "h") || this.board.has(cell + "v")) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.connections.OCCUPIED", { where: cell });
            return result;
        }
        const [row,, orient] = this.splitLine(m);
        if ((this.currplayer === 1) === (row % 2 === 0)) {
            if (orient !== "h") {
                result.valid = false;
                result.message = i18next.t("apgames:validation.connections.WRONG_ORIENT_H", { cell });
                return result;
            }
        } else {
            if (orient !== "v") {
                result.valid = false;
                result.message = i18next.t("apgames:validation.connections.WRONG_ORIENT_V", { cell });
                return result;
            }
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, { partial = false, trusted = false } = {}): ConnectionsGame {
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
        this.results = [];
        this.results.push({ type: "place", where: m });
        this.board.set(m, this.currplayer);

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    private getNeighbours(cell: string): string[] {
        // Get all 6 neighbours of a line.
        const [x, y, orient] = this.splitLine(cell);
        const neighbours: string[] = [];
        // Parallel neighbours.
        if (orient === "h") {
            if (x > 2) {
                neighbours.push(this.coords2algebraic(x - 2, y) + "h");
            }
            if (x < this.boardSize - 3) {
                neighbours.push(this.coords2algebraic(x + 2, y) + "h");
            }
        } else {
            if (y > 2) {
                neighbours.push(this.coords2algebraic(x, y - 2) + "v");
            }
            if (y < this.boardSize - 3) {
                neighbours.push(this.coords2algebraic(x, y + 2) + "v");
            }
        }
        // Cross neighbours.
        if (orient === "h") {
            if (x > 1) {
                if (y > 1) {
                    neighbours.push(this.coords2algebraic(x - 1, y - 1) + "v");
                }
                if (y < this.boardSize - 2) {
                    neighbours.push(this.coords2algebraic(x - 1, y + 1) + "v");
                }
            }
            if (x < this.boardSize - 2) {
                if (y > 1) {
                    neighbours.push(this.coords2algebraic(x + 1, y - 1) + "v");
                }
                if (y < this.boardSize - 2) {
                    neighbours.push(this.coords2algebraic(x + 1, y + 1) + "v");
                }
            }
        } else {
            if (y > 1) {
                if (x > 1) {
                    neighbours.push(this.coords2algebraic(x - 1, y - 1) + "h");
                }
                if (x < this.boardSize - 2) {
                    neighbours.push(this.coords2algebraic(x + 1, y - 1) + "h");
                }
            }
            if (y < this.boardSize - 2) {
                if (x > 1) {
                    neighbours.push(this.coords2algebraic(x - 1, y + 1) + "h");
                }
                if (x < this.boardSize - 2) {
                    neighbours.push(this.coords2algebraic(x + 1, y + 1) + "h");
                }
            }
        }

        return neighbours;
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
            const neighbours = this.getNeighbours(node);
            for (const n of neighbours) {
                if ( (graph.hasNode(n)) && (! graph.hasEdge(node, n)) ) {
                    graph.addEdge(node, n);
                }
            }
        }
        return graph;
    }

    private traverse(graph: UndirectedGraph, path: string[], prevNeighbours: string[] = []): string[] | undefined {
        // Traverse the graph to find a cycle to see if we go back to the start.
        // If we do, return the path.
        // This function is a bit weird because we search in terms of the lines instead of the nodes.
        // We need the previous neighbours to ensure that we are moving forward in a path.
        const last = path[path.length - 1];
        const neighbours = graph.neighbors(last);
        for (const neighbour of neighbours) {
            if (neighbour === last) { continue; }
            if (prevNeighbours.includes(neighbour)) { continue; }
            if (neighbour === path[0]) {
                if (path.length > 2) {
                    return path;
                } else {
                    continue;
                }
            }
            if (path.includes(neighbour)) { continue; }
            const cycle = this.traverse(graph, [...path, neighbour], neighbours);
            if (cycle !== undefined) { return cycle; }
        }
        return undefined;
    }

    private findCycle(lastmove: string, graph: UndirectedGraph): string[] | undefined {
        // Check if there is a cycle. If there is, return it.
        // Otherwise, return undefined.
        return this.traverse(graph, [lastmove]);
    }

    protected checkEOG(): ConnectionsGame {
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
                        this.results.push({ type: "eog", reason: "path" });
                        break;
                    }
                }
            }
            if (this.gameover) {
                break;
            }
        }
        if (!this.gameover) {
            const cycle = this.findCycle(this.lastmove!, graph);
            if (cycle !== undefined) {
                this.gameover = true;
                this.winner = [otherPlayer];
                this.connPath = [...cycle];
                this.results.push({ type: "eog", reason: "loop" });
            }
        }
        if (this.gameover) {
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public state(): IConnectionsState {
        return {
            game: ConnectionsGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: ConnectionsGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            connPath: [...this.connPath],
        };
    }

    private splitLine(line: string): [number, number, string] {
        // Split the wall into its components.
        // To distinguish between the output from this method and the render output
        // we call the third element "orient" for orientation instead of "side".
        const cell = line.slice(0, line.length - 1);
        const orient = line[line.length - 1];
        const [x, y] = this.algebraic2coords(cell);
        return [x, y, orient];
    }

    private lineToRowCol(line: string): [RowCol, RowCol] {
        // Get the RowCol given a line.
        const [x, y, orient] = this.splitLine(line);
        if (orient === "h") {
            return [{ row: y, col: x - 1 }, { row: y, col: x + 1 }];
        } else {
            return [{ row: y - 1, col: x }, { row: y + 1, col: x }];
        }
    }

    private connPathToRowCol(connPath: string[]): RowCol[] {
        // Get the winning path.
        const targets: RowCol[] = [];
        for (const line of connPath) {
            const [node1, node2] = this.lineToRowCol(line);
            if (targets.length === 0) {
                // Special case for the first line: we need to check the next line.
                const next = this.lineToRowCol(connPath[1]);
                if (node1.row === next[0].row && node1.col === next[0].col || node1.row === next[1].row && node1.col === next[1].col) {
                    targets.push(node2);
                    targets.push(node1);
                } else {
                    targets.push(node1);
                    targets.push(node2);
                }
            } else {
                if (node1.row === targets[targets.length - 1].row && node1.col === targets[targets.length - 1].col) {
                    targets.push(node2);
                } else {
                    targets.push(node1);
                }
            }
        }
        return targets;
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < this.boardSize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            for (let col = 0; col < this.boardSize; col++) {
                if (row % 2 !== col % 2) {
                    if (row % 2 === 0) {
                        pstr += "A";
                    } else {
                        pstr += "B";
                    }
                } else if (row > 0 && row < this.boardSize - 1 && col > 0 && col < this.boardSize - 1) {
                    pstr += "C";
                } else {
                    pstr += "-";
                }
            }
        }
        pstr = pstr.replace(new RegExp(`-{${this.boardSize}}`, "g"), "_");

        const markers: Array<MarkerEdge | MarkerLine> = [
            { type: "edge", edge: "N", colour: 1 },
            { type: "edge", edge: "S", colour: 1 },
            { type: "edge", edge: "W", colour: 2 },
            { type: "edge", edge: "E", colour: 2 },
        ];

        for (const [line, player] of this.board) {
            markers.push({
                type: "line",
                points: this.lineToRowCol(line),
                colour: player,
                width: 5,
                centered: true,
                opacity: 1.0,
            })
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "pegboard",
                width: this.boardSize,
                height: this.boardSize,
                strokeOpacity: 0,
                markers,
            },
            legend: {
                A: [{ name: "piece-square", colour: 1, scale: 0.25 }],
                B: [{ name: "piece-square", colour: 2, scale: 0.25 }],
                C: [{ name: "piece-square-borderless", colour: "_context_fill", opacity: 0.05, scale: 1.5, rotate: 45 }],
            },
            pieces: pstr,
        };

        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") {
                    rep.annotations.push({ type: "move", targets: this.lineToRowCol(move.where!) as [RowCol, ...RowCol[]], arrow: false, colour: "#FFFF00", strokeWidth: 0.2, anchors: false, opacity: 0.5 });
                }
            }
            if (this.connPath.length > 0) {
                const targets = this.connPathToRowCol(this.connPath);
                rep.annotations.push({ type: "move", targets: targets as [RowCol, ...RowCol[]], arrow: false });
            }
        }
        return rep;
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        if (this.connPath.length > 0) {
            status += "**Winning Path**: ";
            for (const cell of this.connPath) {
                status += cell + " ";
            }
            status += "\n\n";
        }

        return status;
    }

    public clone(): ConnectionsGame {
        return new ConnectionsGame(this.serialize());
    }
}
