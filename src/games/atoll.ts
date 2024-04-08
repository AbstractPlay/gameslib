import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { UndirectedGraph } from "graphology";
import { bidirectional } from "graphology-shortest-path";

type playerid = 1 | 2;
type PlayerLines = [string[], string[], string[], string[]];

const offsetsEvenOdd = [
    // even cols
    [[0, -1], [-1, 0], [1, 0], [-1, -1], [-1, -1], [0, 1]],
    // odd cols
    [[0, -1], [-1, 0], [1, 0], [-1, 1], [-1, 1], [0, 1]],
]

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    connPaths: string[][];
    lastmove?: string;
}

export interface IAtollState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class AtollGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Atoll",
        uid: "atoll",
        playercounts: [2],
        version: "20240317",
        dateAdded: "2024-03-18",
        // i18next.t("apgames:descriptions.atoll")
        description: "apgames:descriptions.atoll",
        urls: ["http://www.marksteeregames.com/Atoll_rules.pdf"],
        people: [
            {
                type: "designer",
                name: "Mark Steere",
                urls: ["https://marksteeregames.com/"]
            }
        ],
        variants: [
            { uid: "size-15", group: "board" },
            { uid: "size-19", group: "board" },
        ],
        categories: ["goal>connect", "mechanic>place", "board>shape>rect", "board>connect>hex", "components>simple>1per"],
        flags: ["pie", "rotate90"],
        displays: [{uid: "show-labels"}],
    };

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardSize - 1);
    }

    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardSize - 1);
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, playerid>;
    public connPaths: string[][] = [];
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private boardSize = 0;
    private dots: string[] = [];
    private lines: [PlayerLines,PlayerLines];

    constructor(state?: IAtollState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: AtollGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                connPaths: [],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IAtollState;
            }
            if (state.game !== AtollGame.gameinfo.uid) {
                throw new Error(`The Atoll game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
        this.lines = this.getLines();
    }

    public load(idx = -1): AtollGame {
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
        this.connPaths  = state.connPaths.map(a => [...a]);
        this.lastmove = state.lastmove;
        this.boardSize = this.getBoardSize();
        return this;
    }

    private getLines(): [PlayerLines, PlayerLines] {
        const lineN1: string[] = [];
        const lineS1: string[] = [];
        const lineW1: string[] = [];
        const lineE1: string[] = [];
        const lineN2: string[] = [];
        const lineS2: string[] = [];
        const lineW2: string[] = [];
        const lineE2: string[] = [];
        const half = (this.boardSize - 1) / 2;
        for (let x = 0; x < half + 1; x++) {
            const N1 = this.coords2algebraic(x + half, (x + half) % 2 ? 0 : 1);
            const N2 = this.coords2algebraic(x, x % 2 ? 0 : 1);
            const S1 = this.coords2algebraic(x, this.boardSize - 2);
            const S2 = this.coords2algebraic(x + half, this.boardSize - 2);
            lineN1.push(N1);
            lineN2.push(N2);
            lineS1.push(S1);
            lineS2.push(S2);
        }
        for (let y = 0; y < half; y++) {
            const W1 = this.coords2algebraic(0, y + 1);
            const W2 = this.coords2algebraic(0, y + half);
            const E1 = this.coords2algebraic(this.boardSize - 1, y + half);
            const E2 = this.coords2algebraic(this.boardSize - 1, y + 1);
            lineW1.push(W1);
            lineW2.push(W2);
            lineE1.push(E1);
            lineE2.push(E2);
        }
        return [[lineN1, lineS1, lineW1, lineE1], [lineN2, lineS2, lineW2, lineE2]];
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

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }
        const moves: string[] = [];
        for (let j = 0; j < this.boardSize - 1; j++) {
            for (let i = 0; i < this.boardSize; i++) {
                if (j === 0 && i % 2 === 0) { continue; }
                const cell = this.coords2algebraic(i, j);
                if (!this.board.has(cell)) {
                    moves.push(cell);
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
            newmove = cell;
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
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.atoll.INITIAL_INSTRUCTIONS");
            return result;
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        // valid cell
        try {
            const [x, y] = this.algebraic2coords(m);
            if (!this.onBoard(x, y)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: m});
                return result;
            }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: m});
            return result;
        }
        // cell is empty
        if (this.board.has(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: m});
            return result;
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {partial = false, trusted = false} = {}): AtollGame {
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
        this.results.push({ type: "place", where: m });
        this.board.set(m, this.currplayer);

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    private getNeighbours(cell: string): string[] {
        const [x, y] = this.algebraic2coords(cell);
        const neighbours: string[] = [];
        const offsets = offsetsEvenOdd[x % 2];
        for (const [dx, dy] of offsets) {
            const nx = x + dx;
            const ny = y + dy;
            if (this.onBoard(nx, ny)) {
                neighbours.push(this.coords2algebraic(nx, ny));
            }
        }
        return neighbours;
    }

    private onBoard(x: number, y: number): boolean {
        // Check if the coordinates is on board.
        if (x < 0 || y < 0 || x >= this.boardSize || y >= this.boardSize) {
            return false;
        }
        if (x % 2 === 0 && y === 0) {
            return false;
        }
        return true;
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

    protected checkEOG(): AtollGame {
        const otherPlayer = this.currplayer % 2 + 1 as playerid;
        const graph = this.buildGraph(otherPlayer);
        const lines = this.lines[otherPlayer - 1];
        for (const [sources, targets] of [[lines[0], lines[1]], [lines[2], lines[3]]]) {
            if (this.gameover) { break; }
            for (const source of sources) {
                for (const target of targets) {
                    if ( (graph.hasNode(source)) && (graph.hasNode(target)) ) {
                        const path = bidirectional(graph, source, target);
                        if (path !== null) {
                            this.gameover = true;
                            this.winner = [otherPlayer];
                            this.connPaths.push(path);
                            break;
                        }
                    }
                }
                if (this.gameover) { break; }
            }
        }
        if (!this.gameover) {
            for (const [sources1, sources2, targets] of [
                [lines[0], lines[1], lines[2]],
                [lines[0], lines[1], lines[3]],
                [lines[2], lines[3], lines[0]],
                [lines[2], lines[3], lines[1]],
            ]) {
                if (this.gameover) { break; }
                const paths: string[][] = [];
                let satisfyOne = false;
                for (const target of targets) {
                    for (const source of sources1) {
                        if ( (graph.hasNode(source)) && (graph.hasNode(target)) ) {
                            const path = bidirectional(graph, source, target);
                            if (path !== null) {
                                satisfyOne = true;
                                paths.push(path);
                                break;
                            }
                        }
                    }
                    if (satisfyOne) { break; }
                }
                if (!satisfyOne) { continue; }
                let satisfyBoth = false;
                for (const target of targets) {
                    for (const source of sources2) {
                        if ( (graph.hasNode(source)) && (graph.hasNode(target)) ) {
                            const path = bidirectional(graph, source, target);
                            if (path !== null) {
                                satisfyBoth = true;
                                paths.push(path);
                                break;
                            }
                        }
                    }
                    if (satisfyBoth) { break; }
                }
                if (satisfyBoth) {
                    this.gameover = true;
                    this.winner = [otherPlayer];
                    this.connPaths = paths;
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

    public state(): IAtollState {
        return {
            game: AtollGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: AtollGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            connPaths: this.connPaths.map(a => [...a]),
        };
    }

    public render(opts?: { altDisplay: string | undefined }): APRenderRep {
        let altDisplay: string | undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }
        let showLabels = false;
        if (altDisplay !== undefined) {
            if (altDisplay === "show-labels") {
                showLabels = true;
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

        const blocked: Array<any> = [];
        for (let i = 0; i < (this.boardSize + 1) / 2; i++) {
            blocked.push({ row: 0, col: 2 * i });
        }

        const markers: Array<any> = [];
        const half = (this.boardSize - 1) / 2;
        // Neutral fences at the intersection of different-coloured edges.
        markers.push({ type: "fence", cell: { col: half, row: 0}, side: "N" });
        markers.push({ type: "fence", cell: { col: half, row: this.boardSize - 2}, side: "S" });
        markers.push({ type: "fence", cell: { col: 0, row: 1}, side: "NW" });
        markers.push({ type: "fence", cell: { col: this.boardSize - 1, row: 1}, side: "NE" });
        markers.push({ type: "fence", cell: { col: 0, row: this.boardSize - 2}, side: "SW" });
        markers.push({ type: "fence", cell: { col: this.boardSize - 1, row: this.boardSize - 2}, side: "SE" });
        for (let i = 0; i < this.boardSize; i++) {
            if (i === half) {
                markers.push({ type: "fence", cell: { col: i, row: 0}, side: "NW", colour: 2 });
                markers.push({ type: "fence", cell: { col: i, row: 0}, side: "NE", colour: 1 });
                markers.push({ type: "fence", cell: { col: i, row: this.boardSize - 2}, side: "SW", colour: 1 });
                markers.push({ type: "fence", cell: { col: i, row: this.boardSize - 2}, side: "SE", colour: 2 });
                continue;
            }
            const topRow = i % 2 ? 0 : 1;
            markers.push({ type: "fence", cell: { col: i, row: topRow}, side: "N", colour: i < half ? 2 : 1 });
            markers.push({ type: "fence", cell: { col: i, row: this.boardSize - 2}, side: "S", colour: i < half ? 1 : 2 });
            if (i % 2) {
                markers.push({ type: "fence", cell: { col: i, row: topRow}, side: "NW", colour: i < half ? 2 : 1 });
                markers.push({ type: "fence", cell: { col: i, row: topRow}, side: "NE", colour: i < half ? 2 : 1 });
                markers.push({ type: "fence", cell: { col: i, row: this.boardSize - 2}, side: "SW", colour: i < half ? 1 : 2 });
                markers.push({ type: "fence", cell: { col: i, row: this.boardSize - 2}, side: "SE", colour: i < half ? 1 : 2 });
            }
        }
        for (let j = 1; j < this.boardSize - 1; j++) {
            if (j === half) {
                markers.push({ type: "fence", cell: { col: 0, row: j}, side: "NW", colour: 1 });
                markers.push({ type: "fence", cell: { col: 0, row: j}, side: "SW", colour: 2 });
                markers.push({ type: "fence", cell: { col: this.boardSize - 1, row: j}, side: "NE", colour: 2 });
                markers.push({ type: "fence", cell: { col: this.boardSize - 1, row: j}, side: "SE", colour: 1 });
                continue;
            }
            if (j > 1) {
                markers.push({ type: "fence", cell: { col: 0, row: j}, side: "NW", colour: j < half ? 1 : 2 });
                markers.push({ type: "fence", cell: { col: this.boardSize - 1, row: j}, side: "NE", colour: j < half ? 2 : 1 });
            }
            if (j < this.boardSize - 2) {
                markers.push({ type: "fence", cell: { col: 0, row: j}, side: "SW", colour: j < half ? 1 : 2 });
                markers.push({ type: "fence", cell: { col: this.boardSize - 1, row: j}, side: "SE", colour: j < half ? 2 : 1 });
            }
        }

        // Build rep
        const rep: APRenderRep =  {
            options: [showLabels ? "swap-labels" : "hide-labels"],
            board: {
                style: "hex-odd-f",
                width: this.boardSize,
                height: this.boardSize - 1,
                blocked: blocked as [{ row: number; col: number; }, ...{ row: number; col: number; }[]],
                // @ts-ignore
                markers,
            },
            legend: {
                A: {
                    name: "hex-flat",
                    scale: 1.75,
                    player: 1
                },
                B: {
                    name: "hex-flat",
                    scale: 1.75,
                    player: 2
                },
            },
            pieces: pstr,
        };

        // @ts-ignore
        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                } else if (move.type === "move") {
                    const [fromX, fromY] = this.algebraic2coords(move.from);
                    const [toX, toY] = this.algebraic2coords(move.to);
                    rep.annotations.push({ type: "move", targets: [{ row: fromY, col: fromX }, { row: toY, col: toX }] });
                }
            }
            if (this.connPaths.length > 0) {
                for (const connPath of this.connPaths) {
                    type RowCol = {row: number; col: number;};
                    const targets: RowCol[] = [];
                    for (const cell of connPath) {
                        const [x,y] = this.algebraic2coords(cell);
                        targets.push({row: y, col: x})
                    }
                    // @ts-ignore
                    rep.annotations.push({type: "move", targets, arrow: false});
                }

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

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        return status;
    }

    public clone(): AtollGame {
        return new AtollGame(this.serialize());
    }
}
