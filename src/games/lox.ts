import { GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, MarkerDots, MarkerEdge, MarkerFlood, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { HexSlantedGraph } from "../common/graphs";
import { UndirectedGraph } from "graphology";
import { bidirectional } from "graphology-shortest-path/unweighted";

export type playerid = 1|2;
type directions = "NE" | "E" | "SE" | "SW" | "W" | "NW";
const allDirections: directions[] = ["NE", "E", "SE", "SW", "W", "NW"];

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    connPath: string[];
    lastmove?: string;
};

export interface ILoxState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

type PlayerLines = [string[], string[]];

export class LoxGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Lox",
        uid: "lox",
        playercounts: [2],
        version: "20240831",
        dateAdded: "2024-09-05",
        // i18next.t("apgames:descriptions.lox")
        description: "apgames:descriptions.lox",
        urls: ["https://www.mindsports.nl/index.php/the-pit/1212-lox"],
        people: [
            {
                type: "designer",
                name: "Christian Freeling",
                urls: ["https://www.mindsports.nl/"]
            },
            {
                type: "designer",
                name: "Steve Metzger",
                urls: ["https://boardgamegeek.com/boardgamedesigner/11879/steve-metzger"]
            },
            {
                type: "designer",
                name: "Luis Bolaños Mures",
                urls: ["https://boardgamegeek.com/boardgamedesigner/47001/luis-bolanos-mures"]
            },
        ],
        categories: ["goal>connect", "mechanic>place", "mechanic>capture", "board>shape>rect", "board>connect>hex", "components>simple>1per"],
        flags: ["pie", "check"],
        variants: [
            { uid: "size-13", group: "board" },
            { uid: "size-15", group: "board" },
        ],
        displays: [{ uid: "hide-focus-threatened" }, { uid: "dot-focus-threatened" }, { uid: "hide-controlled" }],
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public connPath: string[] = [];
    public graph: HexSlantedGraph;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private boardSize = 0;
    private lines: [PlayerLines,PlayerLines];

    constructor(state?: ILoxState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: LoxGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                connPath: [],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ILoxState;
            }
            if (state.game !== LoxGame.gameinfo.uid) {
                throw new Error(`The Lox engine cannot process a game of '${state.game}'.`);
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

    public load(idx = -1): LoxGame {
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
            const sizeVariants = this.variants.filter(v => v.includes("size"));
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

    private getGraph(): HexSlantedGraph {
        return new HexSlantedGraph(this.boardSize, this.boardSize);
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];
        for (const cell of this.graph.listCells() as string[]) {
            if (!this.board.has(cell)) {
                moves.push(cell);
            } else if (this.board.get(cell) !== player && this.controlledBy(cell) === player) {
                moves.push(`${cell}x`);
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
            let newmove = "";
            const cell = this.graph.coords2algebraic(col, row);
            if (this.board.has(cell) && this.board.get(cell) !== this.currplayer) {
                newmove = `${cell}x`;
            } else {
                newmove = cell;
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
            result.message = i18next.t("apgames:validation.lox.INITIAL_INSTRUCTIONS");
            return result;
        }

        const cell = m.endsWith("x") ? m.slice(0, -1) : m;
        const isCapture = m.endsWith("x");
        // valid cell
        try {
            this.graph.algebraic2coords(cell);
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell });
            return result;
        }
        // cell is empty
        if (!isCapture) {
            if (this.board.has(cell)) {
                if (this.board.get(cell) === this.currplayer) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.OCCUPIED", { where: cell });
                    return result;
                } else if (this.controlledBy(cell) === this.currplayer) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.lox.PLACE4CAPTURE", { cell });
                    return result;
                } else {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.lox.INSUFFICIENT_LOS", { cell, count: Math.min(this.graph.neighbours(cell).length / 2) + 1 });
                    return result;
                }
            }
        } else {
            if (!this.board.has(cell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.lox.CAPTURE4PLACE", { cell });
                return result;
            }
            if (this.board.get(cell) === this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.SELFCAPTURE", { where: cell });
                return result;
            }
            if (this.controlledBy(cell) !== this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.lox.INSUFFICIENT_LOS", { cell, count: Math.min(this.graph.neighbours(cell).length / 2) + 1 });
                return result;
            }
        }

        // we're good
        result.valid = true;
        result.complete = 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");

        return result;
    }

    private controlledBy(where: string): playerid | undefined {
        // Returns the player who controls the cell, or undefined if it's not controlled.
        const coords = this.graph.algebraic2coords(where);
        const losCounts = [0, 0];
        for (const dir of allDirections) {
            for (const c of this.graph.ray(...coords, dir)) {
                const cell = this.graph.coords2algebraic(c[0], c[1]);
                if (this.board.has(cell)) {
                    losCounts[this.board.get(cell)! - 1]++;
                    break;
                }
            }
        }
        const threshold = Math.floor(this.graph.neighbours(where).length / 2);
        if (losCounts[0] > threshold) { return 1; }
        if (losCounts[1] > threshold) { return 2; }
        return undefined;
    }

    public move(m: string, { trusted = false } = {}): LoxGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (!this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", { move: m }))
            }
        }

        this.results = [];
        const cell = m.endsWith("x") ? m.slice(0, -1) : m;
        const isCapture = m.endsWith("x");
        this.board.set(cell, this.currplayer);
        if (isCapture) {
            this.results.push({ type: "place", where: cell });
        } else {
            this.results.push({ type: "place", where: cell, how: "capture" });
        }

        // update currplayer
        this.lastmove = m;
        let newplayer = (this.currplayer as number) + 1;
        if (newplayer > this.numplayers) {
            newplayer = 1;
        }
        this.currplayer = newplayer as playerid;

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

    private isConnected(player: playerid): string[] | undefined {
        // Check if the player has a connection between their lines.
        // If it's connected, return the connection path.
        const graph = this.buildGraph(player);
        const [sources, targets] = this.lines[player - 1];
        for (const source of sources) {
            for (const target of targets) {
                if ( (graph.hasNode(source)) && (graph.hasNode(target)) ) {
                    const path = bidirectional(graph, source, target);
                    if (path !== null) {
                        return [...path];
                    }
                }
            }
        }
        return undefined;
    }

    protected checkEOG(): LoxGame {
        // Check for your win at the end of the opponent's turn.
        const connPath = this.isConnected(this.currplayer);
        if (connPath !== undefined) {
            this.connPath = connPath;
            this.gameover = true;
            this.winner = [this.currplayer];
        }
        if (this.gameover) {
            this.results.push({ type: "eog" });
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public state(): ILoxState {
        return {
            game: LoxGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: LoxGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            connPath: [...this.connPath],
        };
    }

    public render(opts?: IRenderOpts): APRenderRep {
        let altDisplay: string | undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }
        let showControl = true;
        let showFocusThreatened = true;
        let dotFocusThreatened = false;
        if (altDisplay !== undefined) {
            if (altDisplay === "hide-controlled") {
                showControl = false;
            } else if (altDisplay === "hide-focus-threatened") {
                showFocusThreatened = false;
            } else if (altDisplay === "dot-focus-threatened") {
                dotFocusThreatened = true;
            }
        }
        // Build piece string
        const pstr: string[][] = [];
        for (const row of this.graph.listCells(true) as string[][]) {
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const owner = this.board.get(cell)!;
                    if (owner === 1) {
                        if (showFocusThreatened && !dotFocusThreatened && this.controlledBy(cell) === 2) {
                            pieces.push("C");
                        } else {
                            pieces.push("A")
                        }
                    } else {
                        if (showFocusThreatened && !dotFocusThreatened && this.controlledBy(cell) === 1) {
                            pieces.push("D");
                        } else {
                            pieces.push("B");
                        }
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr.push(pieces);
        }
        const markers: Array<MarkerFlood | MarkerEdge | MarkerDots> = [
            { type: "edge", edge: "N", colour: 1 },
            { type: "edge", edge: "S", colour: 1 },
            { type: "edge", edge: "W", colour: 2 },
            { type: "edge", edge: "E", colour: 2 },
        ];

        const dots1: RowCol[] = [];
        const dots2: RowCol[] = [];
        if (showControl) {
            const points1: RowCol[] = [];
            const points2: RowCol[] = [];
            for (const row of this.graph.listCells(true) as string[][]) {
                for (const c of row) {
                    const controlledBy = this.controlledBy(c);
                    if (controlledBy === undefined) { continue; }
                    if (controlledBy === this.board.get(c)) { continue; }
                    const [x, y] = this.graph.algebraic2coords(c);
                    if (controlledBy === 1) {
                        points1.push({ col: x, row: y })
                        if (dotFocusThreatened && this.board.has(c)) {
                            dots1.push({ col: x, row: y })
                        }
                    } else if (controlledBy === 2) {
                        points2.push({ col: x, row: y })
                        if (dotFocusThreatened && this.board.has(c)) {
                            dots2.push({ col: x, row: y })
                        }
                    }
                }
            }
            if (points1.length > 0) {
                markers.push({ type: "flood", colour: 1, opacity: 0.2, points: points1 as [RowCol, ...RowCol[]] });
            }
            if (points2.length > 0) {
                markers.push({ type: "flood", colour: 2, opacity: 0.2, points: points2 as [RowCol, ...RowCol[]] });
            }
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "hex-slanted",
                width: this.boardSize,
                height: this.boardSize,
                markers,
            },
            options: ["reverse-letters"],
            legend: {
                A: [{ name: "piece", colour: 1 }],
                B: [{ name: "piece", colour: 2 }],
                C: [
                    { name: "piece-borderless", scale: 1.1, colour: 2 },
                    { name: "piece", colour: 1 },
                ], // Player 1 threatened
                D: [
                    { name: "piece-borderless", scale: 1.1, colour: 1 },
                    { name: "piece", colour: 2 },
                ], // Player 2 threatened
            },
            pieces: pstr.map(p => p.join("")).join("\n"),
        };

        // Add annotations
        rep.annotations = [];
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
                    const [x, y] = this.graph.algebraic2coords(move.where!);
                    if (move.how === "capture") {
                        rep.annotations.push({ type: "exit", targets: [{ row: y, col: x }]  });
                    }
                    rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                }
            }
            if (this.connPath.length > 0) {
                const targets: RowCol[] = [];
                for (const cell of this.connPath) {
                    const [x, y] = this.graph.algebraic2coords(cell);
                    targets.push({ row: y, col: x })
                }
                rep.annotations.push({ type: "move", targets: targets as [RowCol, ...RowCol[]], arrow: false });
            }
        }
        if (dots1.length > 0) {
            rep.annotations.push({ type: "dots", targets: dots1 as [RowCol, ...RowCol[]], colour: 1 });
        }
        if (dots2.length > 0) {
            rep.annotations.push({ type: "dots", targets: dots2 as [RowCol, ...RowCol[]], colour: 2 });
        }
        return rep;
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += `In check: ${this.inCheck().join(",")}\n\n`;

        return status;
    }

    public inCheck(): number[] {
        try {
            this.graph.graph.nodes();
        } catch {
            // WEIRD ISSUE where the `nodes` is undefined when it reaches this point according to the debugger...
            // What is going on!?
            // Gonna try this code out in prod to see if this helps.
            this.graph = this.getGraph();
        }
        if (this.isConnected(this.currplayer % 2 + 1 as playerid) !== undefined) {
            return [this.currplayer];
        } else {
            return [];
        }
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                if (r.how === "capture") {
                    node.push(i18next.t("apresults:CAPTURE.nowhat", { player, where: r.where }));
                } else {
                    node.push(i18next.t("apresults:PLACE.nowhat", { player, where: r.where }));
                }
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): LoxGame {
        return new LoxGame(this.serialize());
    }
}
