import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
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

export interface IConnecticutState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class ConnecticutGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Connecticut",
        uid: "connecticut",
        playercounts: [2],
        version: "20240317",
        dateAdded: "2022-03-17",
        // i18next.t("apgames:descriptions.connecticut")
        description: "apgames:descriptions.connecticut",
        urls: ["https://boardgamegeek.com/boardgame/297319/connecticut"],
        people: [
            {
                type: "designer",
                name: "Corey Clark",
            }
        ],
        variants: [
            // { uid: "size-25", group: "board" },
        ],
        categories: ["goal>connect", "mechanic>place", "board>shape>rect", "board>connect>rect", "components>simple"],
        flags: ["experimental", "pie", "multistep", "rotate90"],
        displays: [{uid: "hide-triominoes"}],
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

    constructor(state?: IConnecticutState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: ConnecticutGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                connPath: [],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IConnecticutState;
            }
            if (state.game !== ConnecticutGame.gameinfo.uid) {
                throw new Error(`The Connecticut game code cannot process a game of '${state.game}'.`);
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

    public load(idx = -1): ConnecticutGame {
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
            const sizeVariants = this.variants.filter(v => v.includes("size"))
            if (sizeVariants.length > 0) {
                const size = sizeVariants[0].match(/\d+/);
                return parseInt(size![0], 10);
            }
            if (isNaN(this.boardSize)) {
                throw new Error(`Could not determine the board size from variant "${this.variants[0]}"`);
            }
        }
        return 19;
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
                    if (this.stack.length === 1) { continue; }
                    const tos = this.getTos(cell, resolved);
                    resolved.add(cell);
                    for (const t of tos) {
                        moves.push(this.normaliseMove(cell + "-" + t));
                    }
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
            if (move === "") {
                newmove = cell;
            } else {
                newmove = this.normaliseMove(move + "-" + cell);
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
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        if (m.length === 0) {
            if (this.stack.length === 1) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.connecticut.INITIAL_INSTRUCTIONS_FIRST");
                return result;
            } else {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.connecticut.INITIAL_INSTRUCTIONS");
                return result;
            }
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
        if (this.board.has(split[0])) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", { where: m });
            return result;
        }
        const tos = this.getTos(split[0]);
        if (split.length === 1) {
            if (this.stack.length === 1 || tos.length === 0) {
                result.valid = true;
                result.complete = 1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            } else {
                result.valid = true;
                result.complete = 0;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.connecticut.PARTIAL");
                return result;
            }
        }
        if (split.length > 1 && this.stack.length === 1) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.connecticut.FIRST_TRIOMINO");
            return result;
        }
        if (!tos.includes(split[1])) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.connecticut.INVALID_TO", { from: split[0], to: split[1] });
            return result;
        }
        const normalised = this.normaliseMove(m);
        if (normalised !== m) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.saltire.NORMALISE", { move: m, normalised });
            return result;
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
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

    private getTos(cell: string, resolved?: Set<string>): string[] {
        // Get all cells where the triomino can be extended to.
        const coords = this.algebraic2coords(cell);
        const tos: string[] = [];
        outer:
        for (const dir of ["N", "E", "S", "W"] as Directions[]) {
            const ray = this.grid.ray(...coords, dir);
            if (ray.length < 2) { continue; }
            for (const c of ray.slice(0, 2).map(x => this.coords2algebraic(...x))) {
                if (this.board.has(c)) { continue outer; }
            }
            const to = this.coords2algebraic(...ray[1]);
            if (resolved?.has(to)) { continue; }
            tos.push(to);
        }
        return tos;
    }

    private getMiddle(from: string, to: string): string {
        // Given the start and end cells of a triomino, return the middle cell.
        const coords0 = this.algebraic2coords(from);
        const coords1 = this.algebraic2coords(to);
        const bearing = RectGrid.bearing(...coords0, ...coords1)!;
        return this.coords2algebraic(...RectGrid.move(...coords0, bearing))
    }

    public move(m: string, {partial = false, trusted = false} = {}): ConnecticutGame {
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
        this.dots = [];
        this.results = [];
        if (m.length === 0) { return this; }
        const split = m.split("-");
        if (split.length === 1) {
            this.results.push({ type: "place", where: split[0] });
            this.board.set(split[0], this.currplayer);
            if (this.stack.length > 1) {
                this.dots = this.getTos(split[0]);
            }
        } else {
            const middle = this.getMiddle(split[0], split[1]);
            this.board.set(split[0], this.currplayer);
            this.board.set(middle, this.currplayer);
            this.board.set(split[1], this.currplayer);
            // This is abusing the "move" type slightly, but it works...
            this.results.push({ type: "place", where: m });
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
            const neighbours = this.grid.adjacencies(x, y, true).map(n => this.coords2algebraic(...n));
            for (const n of neighbours) {
                if ( (graph.hasNode(n)) && (! graph.hasEdge(node, n)) ) {
                    graph.addEdge(node, n);
                }
            }
        }
        return graph;
    }

    protected checkEOG(): ConnecticutGame {
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

    public state(): IConnecticutState {
        return {
            game: ConnecticutGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: ConnecticutGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            connPath: [...this.connPath],
        };
    }

    public render(opts?: { altDisplay: string | undefined }): APRenderRep {
        let altDisplay: string | undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }
        let showTriominoes = true;
        if (altDisplay !== undefined) {
            if (altDisplay === "hide-triominoes") {
                showTriominoes = false;
            }
        }
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

        const markers: Array<any> = [
            {type:"edge", edge: "N", colour:1},
            {type:"edge", edge: "S", colour:1},
            {type:"edge", edge: "E", colour:2},
            {type:"edge", edge: "W", colour:2},
        ];
        if (showTriominoes) {
            // // Current move.
            // if (this.results.length > 0) {
            //     for (const m of this.results) {
            //         if (m.type === "place") {
            //             const split = m.where!.split("-");
            //             if (split.length > 1) {
            //                 const player = this.board.get(split[0]);
            //                 const [x0, y0] = this.algebraic2coords(split[0]);
            //                 const [x2, y2] = this.algebraic2coords(split[1]);
            //                 markers.push({ type: "line", points: [{ row: y0, col: x0 }, { row: y2, col: x2 }], colour: player, width: 20 });
            //             }
            //         }
            //     }
            // }
            // Past moves.
            for (const move of this.stack) {
                for (const m of move._results) {
                    if (m.type === "place") {
                        const split = m.where!.split("-");
                        if (split.length > 1) {
                            const player = this.board.get(split[0]);
                            const [x0, y0] = this.algebraic2coords(split[0]);
                            const [x2, y2] = this.algebraic2coords(split[1]);
                            markers.push({ type: "line", points: [{ row: y0, col: x0 }, { row: y2, col: x2 }], colour: player, width: 20 });
                        }
                    }
                }
            }
        }
        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "vertex",
                width: this.boardSize,
                height: this.boardSize,
                markers,
            },
            legend: {
                A: [{ name: "piece", player: 1 }],
                B: [{ name: "piece", player: 2 }],
            },
            pieces: pstr,
        };

        // @ts-ignore
        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const split = move.where!.split("-");
                    if (split.length === 1) {
                        const [x, y] = this.algebraic2coords(move.where!);
                        rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                    } else {
                        const middle = this.getMiddle(split[0], split[1]);
                        const [x0, y0] = this.algebraic2coords(split[0]);
                        const [x1, y1] = this.algebraic2coords(middle);
                        const [x2, y2] = this.algebraic2coords(split[1]);
                        rep.annotations.push({ type: "enter", targets: [{ row: y0, col: x0 }, { row: y1, col: x1 }, { row: y2, col: x2 }] });
                    }
                }
            }
            if (this.connPath.length > 0) {
                type RowCol = {row: number; col: number;};
                const targets: RowCol[] = [];
                for (const cell of this.connPath) {
                    const [x,y] = this.algebraic2coords(cell);
                    targets.push({row: y, col: x})
                }
                // @ts-ignore
                rep.annotations.push({type: "move", targets, arrow: false});
            }
        }
        if (this.dots.length > 0) {
            const points = [];
            for (const cell of this.dots) {
                const [x, y] = this.algebraic2coords(cell);
                points.push({ row: y, col: x });
            }
            // @ts-ignore
            rep.annotations.push({ type: "dots", targets: points });
        }
        return rep;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                if (r.where!.includes("-")) {
                    node.push(i18next.t("apresults:PLACE.connecticut", { player, where: r.where }));
                } else {
                    node.push(i18next.t("apresults:PLACE.nowhat", { player, where: r.where }));
                }
                resolved = true;
                break;
        }
        return resolved;
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        return status;
    }

    public clone(): ConnecticutGame {
        return new ConnecticutGame(this.serialize());
    }
}
