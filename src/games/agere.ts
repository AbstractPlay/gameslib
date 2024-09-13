/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Direction, Grid, rectangle, defineHex, Orientation, Hex } from "honeycomb-grid";
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, BoardBasic, MarkerFlood, MarkerHalo, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError, intersects } from "../common";
import { UndirectedGraph } from "graphology";
import { bidirectional } from "graphology-shortest-path/unweighted";
import { connectedComponents } from 'graphology-components';
import i18next from "i18next";
import { HexMoonGraph } from "../common/graphs";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

type playerid = 1|2;

type CellContents = playerid[];

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    lastmove?: string;
}

export interface IAgereState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class AgereGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Adere",
        uid: "agere",
        playercounts: [2],
        version: "20230727",
        dateAdded: "2023-07-31",
        // i18next.t("apgames:descriptions.agere")
        description: "apgames:descriptions.agere",
        urls: ["https://agere.drew-edwards.com/"],
        people: [
            {
                type: "designer",
                name: "Drew Edwards",
                urls: ["https://games.drew-edwards.com/"]
            }
        ],
        variants: [
            {uid: "cobweb", group: "board"},
            {uid: "cobweb-small", group: "board"},
            {uid: "standard-11", group: "board"},
            {uid: "standard-14", group: "board"},
            {uid: "moon", group: "board", experimental: true},
        ],
        categories: ["goal>connect", "mechanic>place", "mechanic>stack", "mechanic>move", "mechanic>coopt", "board>shape>circle", "board>connect>rect", "board>shape>tri", "board>connect>hex", "components>simple>1per"],
        flags: ["pie", "check", "custom-rotation"]
    };


    public static edgesDefault: string[][] = [
        ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"],
        ["a1", "b1", "c2", "d2", "e3", "f3", "g4", "h4"],
        ["h4", "g5", "f5", "e6", "d6", "c7", "b7", "a8"],
    ];
    public static edgesDefault11: string[][] = [
        ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "a10", "a11"],
        ["a1", "b2", "c2", "d3", "e3", "f4", "g4", "h5", "i5", "j6", "k6"],
        ["k6", "j7", "i7", "h8", "g8", "f9", "e9", "d10", "c10", "b11", "a11"],
    ];
    public static edgesDefault14: string[][] = [
        ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "a10", "a11", "a12", "a13", "a14"],
        ["a1", "b1", "c2", "d2", "e3", "f3", "g4", "h4", "i5", "j5", "k6", "l6", "m7", "n7"],
        ["n7", "m8", "l8", "k9", "j9", "i10", "h10", "g11", "f11", "e12", "d12", "c13", "b13", "a14"],
    ];

    public static blocked8: string[] = ["c1", "d1", "e1", "e2", "f1", "f2", "g1", "g2", "g3", "h1", "h2", "h3", "h5", "h6", "h7", "h8", "g6", "g7", "g8", "f6", "f7", "f8", "e7", "e8", "d7", "d8", "c8", "b8"];
    public static blocked11 = ["b1","c1","c11","d1","d11","d2","e1","e10","e11","e2","f1","f10","f11","f2","f3","g1","g10","g11","g2","g3","g9","h1","h10","h11","h2","h3","h4","h9","i1","i10","i11","i2","i3","i4","i8","i9","j1","j10","j11","j2","j3","j4","j5","j8","j9","k1","k10","k11","k2","k3","k4","k5","k7","k8","k9"];
    public static blocked14 = ["b14","c1","c14","d1","d13","d14","e1","e13","e14","e2","f1","f12","f13","f14","f2","g1","g12","g13","g14","g2","g3","h1","h11","h12","h13","h14","h2","h3","i1","i11","i12","i13","i14","i2","i3","i4","j1","j10","j11","j12","j13","j14","j2","j3","j4","k1","k10","k11","k12","k13","k14","k2","k3","k4","k5","l1","l10","l11","l12","l13","l14","l2","l3","l4","l5","l9","m1","m10","m11","m12","m13","m14","m2","m3","m4","m5","m6","m9","n1","n10","n11","n12","n13","n14","n2","n3","n4","n5","n6","n8","n9"];

    public static edgesCobweb = new Map<playerid, [[string[],string[]],[string[],string[]]]>([
        [1, [[["a4", "h4"], ["d4", "e4"]],[["b4", "c4"], ["f4", "g4"]]]],
        [2, [[["a4", "b4"], ["e4", "f4"]],[["c4", "d4"], ["g4", "h4"]]]],
    ]);

    public static edgesCobwebSmall = new Map<playerid, [[string[],string[]],[string[],string[]]]>([
        [1, [[["a3", "h3"], ["d3", "e3"]],[["b3", "c3"], ["f3", "g3"]]]],
        [2, [[["a3", "b3"], ["e3", "f3"]],[["c3", "d3"], ["g3", "h3"]]]],
    ]);

    public static buildGraph(style: "hex8"|"hex11"|"hex14"|"cobweb"|"cobwebSmall"|"moon"): UndirectedGraph {
        const columnLabels = "abcdefghijklmnopqrstuvwxyz".split("");
        if (style.startsWith("hex")) {
            let width = 8;
            if (style === "hex11") {
                width = 11;
            } else if (style === "hex14") {
                width = 14;
            }

            const myHex = defineHex({
                offset: 1,
                orientation: Orientation.POINTY
            });
            const hexGrid = new Grid(myHex, rectangle({width, height: width}));
            const allHexDirs = [Direction.NE, Direction.E, Direction.SE, Direction.SW, Direction.W, Direction.NW];

            const getNeighbours = (hex: Hex): Hex[] => {
                const neighbours: Hex[] = [];
                for (const dir of allHexDirs) {
                    const n = hexGrid.neighborOf(hex, dir, {allowOutside: false});
                    if (n !== undefined) {
                        neighbours.push(n);
                    }
                }
                return neighbours;
            }

            const coords2algebraic = (x: number, y: number): string => {
                return columnLabels[width - y - 1] + (x + 1).toString();
            }

            let blocked = [...AgereGame.blocked8];
            if (style === "hex11") {
                blocked = [...AgereGame.blocked11];
            } else if (style === "hex14") {
                blocked = [...AgereGame.blocked14];
            }

            const graph = new UndirectedGraph();
            for (const hex of hexGrid) {
                const label  = coords2algebraic(hex.col, hex.row);
                if (blocked.includes(label)) {
                    continue;
                }
                if (! graph.hasNode(label)) {
                    graph.addNode(label);
                }
                for (const n of getNeighbours(hex)) {
                    const nLabel = coords2algebraic(n.col, n.row);
                    if (blocked.includes(nLabel)) {
                        continue;
                    }
                    if (! graph.hasNode(nLabel)) {
                        graph.addNode(nLabel);
                    }
                    if (! graph.hasEdge(label, nLabel)) {
                        graph.addEdge(label, nLabel);
                    }
                }
            }
            return graph;
        } else if ( (style === "cobweb") || (style === "cobwebSmall") ) {
            let cobHeight = 4;
            if (style === "cobwebSmall") {
                cobHeight = 3;
            }
            const graph = new UndirectedGraph();
            for (let col = 0; col < 8; col++) {
                for (let row = cobHeight - 1; row >= 0; row--) {
                    const cell = GameBase.coords2algebraic(col, row, cobHeight);
                    if (! graph.hasNode(cell)) {
                        graph.addNode(cell);
                    }
                    // connect to the cell above
                    if (row > 0) {
                        const above = GameBase.coords2algebraic(col, row-1, cobHeight);
                        if (! graph.hasNode(above)) {
                            graph.addNode(above);
                        }
                        if (! graph.hasEdge(cell, above)) {
                            graph.addEdge(cell, above);
                        }
                    }

                    if (col % 2 === 0) {
                        // connect left and right
                        const br = GameBase.coords2algebraic(col+1, row, cobHeight);
                        if (! graph.hasNode(br)) {
                            graph.addNode(br);
                        }
                        if (! graph.hasEdge(cell, br)) {
                            graph.addEdge(cell, br);
                        }
                        if (row !== 0) {
                            const tr = GameBase.coords2algebraic(col+1, row-1, cobHeight);
                            if (! graph.hasNode(tr)) {
                                graph.addNode(tr);
                            }
                            if (! graph.hasEdge(cell, tr)) {
                                graph.addEdge(cell, tr);
                            }
                        }
                        let lcol = col - 1;
                        if (lcol < 0) { lcol = 7; }
                        const bl = GameBase.coords2algebraic(lcol, row, cobHeight);
                        if (! graph.hasNode(bl)) {
                            graph.addNode(bl);
                        }
                        if (! graph.hasEdge(cell, bl)) {
                            graph.addEdge(cell, bl);
                        }
                        if (row !== 0) {
                            const tl = GameBase.coords2algebraic(lcol, row-1, cobHeight);
                            if (! graph.hasNode(tl)) {
                                graph.addNode(tl);
                            }
                            if (! graph.hasEdge(cell, tl)) {
                                graph.addEdge(cell, tl);
                            }
                        }
                    }
                }
            }
            // add the centre connections manually
            graph.addNode("ctr");
            for (let col = 0; col < 8; col++) {
                const cell = GameBase.coords2algebraic(col, cobHeight - 1, cobHeight);
                graph.addEdge("ctr", cell);
            }
            return graph;
        } else if (style === "moon") {
            return (new HexMoonGraph()).graph;
        }
        throw new Error("Unrecognized graph style.");
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, playerid[]>;
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    public startpos!: string;

    constructor(state?: IAgereState | string, variants?: string[]) {
        super();
        if (state !== undefined) {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IAgereState;
            }
            if (state.game !== AgereGame.gameinfo.uid) {
                throw new Error(`The Agere game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.variants = [...state.variants];
            this.winner = [...state.winner];
            this.stack = [...state.stack];
        } else {
            if ( (variants !== undefined) && (variants.length > 0) ) {
                this.variants = [...variants];
            }
            const board = new Map<string,playerid[]>();
            const fresh: IMoveState = {
                _version: AgereGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        }
        this.load();
    }

    public load(idx = -1): AgereGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        if (state === undefined) {
            throw new Error(`Could not load state index ${idx}`);
        }
        this.results = [...state._results];
        this.currplayer = state.currplayer;
        this.board = deepclone(state.board) as Map<string, CellContents>;
        this.lastmove = state.lastmove;
        return this;
    }

    private coords2algebraic(x: number, y: number): string {
        const columnLabels = "abcdefghijklmnopqrstuvwxyz".split("");
        if (this.variants.includes("cobweb")) {
            if ( (x === 0) && (y === 4) ) {
                return "ctr";
            }
            return GameBase.coords2algebraic(x, y, 4);
        } else if (this.variants.includes("cobweb-small")) {
            if ( (x === 0) && (y === 3) ) {
                return "ctr";
            }
            return GameBase.coords2algebraic(x, y, 3);
        } else if (this.variants.includes("moon")) {
            return (new HexMoonGraph()).coords2algebraic(x, y);
        } else {
            let width = 8;
            if (this.variants.includes("standard-11")) {
                width = 11;
            } else if (this.variants.includes("standard-14")) {
                width = 14;
            }
            return columnLabels[width - y - 1] + (x + 1).toString();
        }
    }

    private algebraic2coords(cell: string): [number,number] {
        const columnLabels = "abcdefghijklmnopqrstuvwxyz".split("");
        if (this.variants.includes("cobweb")) {
            if (cell === "ctr") {
                return [0,4];
            }
            return GameBase.algebraic2coords(cell, 4);
        } else if (this.variants.includes("cobweb-small")) {
            if (cell === "ctr") {
                return [0,3];
            }
            return GameBase.algebraic2coords(cell, 3);
        } else if (this.variants.includes("moon")) {
            return (new HexMoonGraph()).algebraic2coords(cell);
        } else {
            let width = 8;
            if (this.variants.includes("standard-11")) {
                width = 11;
            } else if (this.variants.includes("standard-14")) {
                width = 14;
            }
            const pair: string[] = cell.split("");
            const num = (pair.slice(1)).join("");
            const y = columnLabels.indexOf(pair[0]);
            if ( (y === undefined) || (y < 0) ) {
                throw new Error(`The column label is invalid: ${pair[0]}`);
            }
            const x = parseInt(num, 10);
            if ( (x === undefined) || (isNaN(x)) ) {
                throw new Error(`The row label is invalid: ${pair[1]}`);
            }
            return [x - 1, width - y - 1];
        }
    }

    private getGraph(): UndirectedGraph {
        if (this.variants.includes("cobweb")) {
            return AgereGame.buildGraph("cobweb");
        } else if (this.variants.includes("cobweb-small")) {
            return AgereGame.buildGraph("cobwebSmall");
        } else if (this.variants.includes("moon")) {
            return AgereGame.buildGraph("moon");
        } else if (this.variants.includes("standard-11")) {
            return AgereGame.buildGraph("hex11");
        } else if (this.variants.includes("standard-14")) {
            return AgereGame.buildGraph("hex14");
        } else {
            return AgereGame.buildGraph("hex8");
        }
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];
        const graph = this.getGraph();

        // placements first
        for (const cell of graph.nodes()) {
            if (! this.board.has(cell)) {
                moves.push(cell);
            }
        }

        const mypieces = [...this.board.entries()].filter(([,stack]) => stack[stack.length - 1] === player).map(e => e[0]);
        // movements
        for (const cell of mypieces) {
            const stack = this.board.get(cell)!;
            for (const n of graph.neighbors(cell)) {
                if (this.board.has(n)) {
                    const nStack = this.board.get(n)!;
                    if ( (stack.length === nStack.length) && (nStack[nStack.length - 1] !== player) ) {
                        moves.push(`${cell}-${n}`);
                    }
                }
            }
        }

        return moves.sort((a,b) => a.localeCompare(b));
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        move = move.toLowerCase();
        move = move.replace(/\s+/g, "");
        try {
            const cell = this.coords2algebraic(col, row);
            let newmove = "";

            // starting fresh
            if (move.length === 0) {
                // if empty, place
                if (! this.board.has(cell)) {
                    newmove = cell;
                } else {
                    const contents = this.board.get(cell)!;
                    // if yours, then assume movement
                    if (contents[contents.length - 1] === this.currplayer) {
                        newmove = cell;
                    } else {
                        return {move: "", message: i18next.t("apgames:validation.agere.INITIAL_INSTRUCTIONS")} as IClickResult;
                    }
                }
            }
            // adding to existing string
            else {
                // if existing cell, possible movement
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    // can't be yours
                    if (contents[contents.length - 1] !== this.currplayer) {
                        newmove = `${move}-${cell}`;
                    } else {
                        newmove = move;
                    }
                }
                // otherwise, ignore
                else {
                    newmove = move;
                }
            }

            const result = this.validateMove(newmove) as IClickResult;
            if (! result.valid) {
                result.move = move;
            } else {
                result.move = newmove;
            }
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
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (m === "") {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.agere.INITIAL_INSTRUCTIONS");
            return result;
        }

        const graph = this.getGraph();
        const [from, to] = m.split("-");

        // valid cell
        if (! graph.nodes().includes(from)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.agere.INVALIDCELL", {cell: from});
            return result;
        }

        if (to === undefined) {
            // if empty, move is over
            if (! this.board.has(from)) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }

            const contents = this.board.get(from)!;
            // if enemy, invalid
            if (contents[contents.length - 1] !== this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                return result;
            }

            // otherwise, assume valid partial
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.agere.PARTIAL");
            return result;
        } else {
            // valid cell
            if (! graph.nodes().includes(to)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.agere.INVALIDCELL", {cell: to});
                return result;
            }

            if (! graph.neighbors(from).includes(to)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.agere.ADJACENCY");
                return result;
            }

            // must be occupied
            if (! this.board.has(to)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.agere.EMPTY_MOVE");
                return result;
            }

            const contents = this.board.get(to)!;
            // must belong to opponent
            if (contents[contents.length - 1] === this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.agere.FRIENDLY_CAPTURE");
                return result;
            }

            const fContents = this.board.get(from)!;
            // must be same height
            if (fContents.length !== contents.length) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.agere.SAME_HEIGHT");
                return result;
            }

            // all good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
    }

    public move(m: string, {trusted = false} = {}): AgereGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        // Normalize
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (! trusted) {
            const result = this.validateMove(m);
            if ( (! result.valid) || (result.complete === -1) ) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (! this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];

        if (m.includes("-")) {
            const [from, to] = m.split("-");
            const fStack = this.board.get(from)!;
            const tStack = this.board.get(to)!;
            const pc = fStack[fStack.length - 1];
            const newFrom = fStack.slice(0, fStack.length - 1);
            if (newFrom.length > 0) {
                this.board.set(from, [...newFrom]);
            } else {
                this.board.delete(from);
            }
            this.board.set(to, [...tStack, pc]);
            this.results.push({type: "move", from, to});
        } else {
            this.board.set(m, [this.currplayer]);
            this.results.push({type: "place", where: m});
        }

        // reconstitute a normalized move rep
        this.lastmove = m;
        if (this.currplayer === 1) {
            this.currplayer = 2;
        } else {
            this.currplayer = 1;
        }

        this.checkEOG();
        this.saveState();
        return this;
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        return status;
    }

    public checkEOGCobweb(player?: playerid): boolean {
        if (player === undefined) {
            player = this.currplayer;
        }
        // start with the full board graph
        const graph = this.getGraph();
        // drop any nodes not occupied by currplayer
        for (const node of [...graph.nodes()]) {
            if (! this.board.has(node)) {
                graph.dropNode(node);
            } else {
                const stack = this.board.get(node)!;
                if (stack[stack.length - 1] !== player) {
                    graph.dropNode(node);
                }
            }
        }

        let edges = AgereGame.edgesCobweb;
        if (this.variants.includes("cobweb-small")) {
            edges = AgereGame.edgesCobwebSmall;
        }

        for (const [left,right] of edges.get(player)!) {
            for (const lnode of left) {
                for (const rnode of right) {
                    if ( graph.hasNode(lnode) && graph.hasNode(rnode) ) {
                        const path = bidirectional(graph, lnode, rnode);
                        if (path !== null) {
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    }

    public checkEOGHexTri(player?: playerid): boolean {
        if (player === undefined) {
            player = this.currplayer;
        }
        let edges = [...AgereGame.edgesDefault];
        if (this.variants.includes("standard-11")) {
            edges = [...AgereGame.edgesDefault11];
        } else if (this.variants.includes("standard-14")) {
            edges = [...AgereGame.edgesDefault14];
        }
        // start with the full board graph
        const graph = this.getGraph();
        // drop any nodes not occupied by currplayer
        for (const node of [...graph.nodes()]) {
            if (! this.board.has(node)) {
                graph.dropNode(node);
            } else {
                const stack = this.board.get(node)!;
                if (stack[stack.length - 1] !== player) {
                    graph.dropNode(node);
                }
            }
        }

        for (const g of connectedComponents(graph)) {
            let connected = true;
            for (const edge of edges) {
                if (! intersects(g, edge)) {
                    connected = false;
                    break;
                }
            }
            if (connected) {
                return true;
            }
        }
        return false;
    }

    public checkEOGMoon(player?: playerid): boolean {
        if (player === undefined) {
            player = this.currplayer;
        }
        const allEdges = (new HexMoonGraph()).getEdges();
        const edges: string[][] = [
            [...allEdges.get("N")!, ...allEdges.get("NE")!],
            [...allEdges.get("SE")!, ...allEdges.get("S")!],
            [...allEdges.get("SW")!, ...allEdges.get("NW")!],
        ];
        // start with the full board graph
        const graph = this.getGraph();
        // drop any nodes not occupied by currplayer
        for (const node of [...graph.nodes()]) {
            if (! this.board.has(node)) {
                graph.dropNode(node);
            } else {
                const stack = this.board.get(node)!;
                if (stack[stack.length - 1] !== player) {
                    graph.dropNode(node);
                }
            }
        }

        for (const g of connectedComponents(graph)) {
            let connected = true;
            for (const edge of edges) {
                if (! intersects(g, edge)) {
                    connected = false;
                    break;
                }
            }
            if (connected) {
                return true;
            }
        }
        return false;
    }

    protected checkEOG(): AgereGame {
        // We are now at the START of `this.currplayer`'s turn
        if ( (this.variants.includes("cobweb")) || (this.variants.includes("cobweb-small")) ) {
            if (this.checkEOGCobweb()) {
                this.gameover = true;
                this.winner = [this.currplayer];
            }
        } else if (this.variants.includes("moon")) {
            if (this.checkEOGMoon()) {
                this.gameover = true;
                this.winner = [this.currplayer];
            }
        } else {
            if (this.checkEOGHexTri()) {
                this.gameover = true;
                this.winner = [this.currplayer];
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

    public state(): IAgereState {
        return {
            game: AgereGame.gameinfo.uid,
            numplayers: 2,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: AgereGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: deepclone(this.board) as Map<string, playerid[]>,
        };
    }

    protected renderHexTri(): APRenderRep {
        const graph = this.getGraph();
        let width = 8;
        let blockedCells = [...AgereGame.blocked8];
        let markerPts: [{row: number; col: number}, ...{row: number; col: number}[]]|undefined;
        if (this.variants.includes("standard-11")) {
            width = 11;
            blockedCells = [...AgereGame.blocked11];
            markerPts = [{row: 4, col: 5}, {row: 8, col: 3}, {row: 8, col: 7}];
        } else if (this.variants.includes("standard-14")) {
            width = 14;
            blockedCells = [...AgereGame.blocked14];
            markerPts = [{row: 6, col: 6}, {row: 10, col: 4}, {row: 10, col: 8}];
        }
        const blocked: {row: number; col: number}[] = [];
        for (const cell of blockedCells) {
            const [x,y] = this.algebraic2coords(cell);
            blocked.push({row: y, col: x});
        }

        // Build piece string
        const pieces: string[][] = [];
        for (let row = 0; row < width; row++) {
            const node: string[] = [];
            for (let col = 0; col < width; col++) {
                const cell = this.coords2algebraic(col, row);
                if ( (! graph.hasNode(cell)) || (! this.board.has(cell)) ) {
                    node.push("-");
                } else if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    node.push(contents.join("").replace(/1/g, "A").replace(/2/g, "B"));
                }
            }
            pieces.push(node);
        }
        const pstr: string = pieces.map(r => r.join(",")).join("\n");

        // Build rep
        const rep: APRenderRep =  {
            renderer: "stacking-offset",
            board: {
                style: "hex-even-p",
                width,
                height: width,
                blocked: blocked as [{row: number; col: number}, ...{row: number; col: number}[]],
                markers: markerPts === undefined ? undefined : [
                    {
                        type: "dots",
                        points: markerPts,
                    }
                ],
            },
            legend: {
                A: {
                        name: "piece",
                        colour: 1,
                },
                B: {
                        name: "piece",
                        colour: 2,
                },
            },
            pieces: pstr
        };


        // Add annotations
        if (this.results.length > 0) {
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                } else if (move.type === "move") {
                    const [fx, fy] = this.algebraic2coords(move.from);
                    const [tx, ty] = this.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fy, col: fx},{row: ty, col: tx}]});
                }
            }
        }

        return rep;
    }

    protected renderMoon(): APRenderRep {
        const graph = this.getGraph();

        // Build piece string
        const pieces: string[][] = [];
        const flooded: [[number,number][], [number,number][]] = [[],[]];
        const obj = new HexMoonGraph();
        for (const row of (new HexMoonGraph()).listCells(true) as string[][]) {
            const node: string[] = [];
            for (const cell of row) {
                const [nx, ny] = obj.algebraic2coords(cell)
                if ( (! graph.hasNode(cell)) || (! this.board.has(cell)) ) {
                    node.push("-");
                } else if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    node.push(contents.join("").replace(/1/g, "A").replace(/2/g, "B"));
                    flooded[contents[contents.length - 1] - 1].push([nx, ny]);
                }
            }
            pieces.push(node);
        }
        const pstr: string = pieces.map(r => r.join(",")).join("\n");

        // Build rep
        const rep: APRenderRep =  {
            renderer: "stacking-offset",
            board: {
                style: "circular-moon",
                strokeWeight: 0.5,
                stackOffset: 0.03,
                markers: [
                    {
                        type: "halo",
                        offset: -60,
                        width: 3,
                        segments: [
                            {
                                colour: "_context_fill",
                                opacity: 0.9,
                            },
                            {
                                colour: "_context_fill",
                                opacity: 0.5,
                            },
                            {
                                colour: "_context_fill",
                                opacity: 0.1,
                            }
                        ]
                    },
                ],
            },
            legend: {
                A: {
                        name: "piece",
                        colour: 1,
                        scale: 0.25,
                },
                B: {
                        name: "piece",
                        colour: 2,
                        scale: 0.25,
                },
            },
            pieces: pstr
        };

        for (let p = 0; p < flooded.length; p++) {
            const targets: {row:number; col: number}[] = [];
            for (const flood of flooded[p]) {
                targets.push({row: flood[1], col: flood[0]});
            }
            if (targets.length > 0) {
                (rep.board! as BoardBasic).markers!.push({
                    type: "flood",
                    colour: p+1,
                    points: targets,
                    opacity: 0.5,
                } as MarkerFlood);
            }
        }

        // Add annotations
        if (this.results.length > 0) {
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = obj.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                } else if (move.type === "move") {
                    const [fx, fy] = obj.algebraic2coords(move.from);
                    const [tx, ty] = obj.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", strokeWidth: 0.25, targets: [{row: fy, col: fx},{row: ty, col: tx}]});
                }
            }
        }

        return rep;
    }

    protected renderCobweb(): APRenderRep {
        let cobHeight = 4;
        if (this.variants.includes("cobweb-small")) {
            cobHeight = 3;
        }
        const graph = this.getGraph();
        // Build piece string
        const pieces: string[][] = [];
        const flooded: [[number,number][], [number,number][]] = [[],[]];
        for (let row = 0; row < cobHeight; row++) {
            const node: string[] = [];
            for (let col = 0; col < 8; col++) {
                const cell = this.coords2algebraic(col, row);
                if ( (! graph.hasNode(cell)) || (! this.board.has(cell)) ) {
                    node.push("-");
                } else if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    node.push(contents.join("").replace(/1/g, "A").replace(/2/g, "B"));
                    flooded[contents[contents.length - 1] - 1].push([col, row]);
                }
            }
            pieces.push(node);
        }
        // manually do centre
        if (this.board.has("ctr")) {
            const contents = this.board.get("ctr")!;
            pieces.push([contents.join("").replace(/1/g, "A").replace(/2/g, "B")]);
            flooded[contents[contents.length - 1] - 1].push([0, cobHeight]);
        }
        const pstr: string = pieces.map(r => r.join(",")).join("\n");

        // Build rep
        const rep: APRenderRep =  {
            renderer: "stacking-offset",
            board: {
                style: "circular-cobweb",
                width: 8,
                height: cobHeight,
                markers: [
                    {
                        "type": "halo",
                        "width": 10,
                        "segments": [{"colour":1},{"colour":2},{"colour":1},{"colour":2},{"colour":1},{"colour":2},{"colour":1},{"colour":2}],
                        "offset": -22.5,
                        "fill": "#000",
                    }
                ] as (MarkerHalo|MarkerFlood)[],
                strokeColour: "#666",
            } as BoardBasic,
            legend: {
                A: {
                        name: "piece",
                        colour: 1,
                        scale: 0.75,
                },
                B: {
                        name: "piece",
                        colour: 2,
                        scale: 0.75,
                },
            },
            pieces: pstr
        };
        for (let p = 0; p < flooded.length; p++) {
            const targets: {row:number; col: number}[] = [];
            for (const flood of flooded[p]) {
                targets.push({row: flood[1], col: flood[0]});
            }
            if (targets.length > 0) {
                (rep.board! as BoardBasic).markers!.push({
                    type: "flood",
                    colour: p+1,
                    points: targets,
                    opacity: 0.5,
                } as MarkerFlood);
            }
        }

        // Add annotations
        if (this.results.length > 0) {
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                } else if (move.type === "move") {
                    const [fx, fy] = this.algebraic2coords(move.from);
                    const [tx, ty] = this.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fy, col: fx},{row: ty, col: tx}]});
                }
            }
        }

        return rep;
    }

    public render(): APRenderRep {
        if ( (this.variants.includes("cobweb")) || (this.variants.includes("cobweb-small")) ) {
            return this.renderCobweb();
        } else if (this.variants.includes("moon")) {
            return this.renderMoon();
        }
        return this.renderHexTri();
    }

    // public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
    //     let resolved = false;
    //     switch (r.type) {
    //         case "place":
    //             node.push(i18next.t("apresults:PLACE.agere", {player, where: r.where}));
    //             resolved = true;
    //             break;
    //     }
    //     return resolved;
    // }

    // Only detects check for the current player
    public inCheck(): number[] {
        let otherPlayer: playerid = 1;
        if (this.currplayer === 1) {
            otherPlayer = 2;
        }
        let connected = false;
        if ( (this.variants.includes("cobweb")) || (this.variants.includes("cobweb-small")) ) {
            connected = this.checkEOGCobweb(otherPlayer);
        } else if (this.variants.includes("moon")) {
            connected = this.checkEOGMoon(otherPlayer);
        } else {
            connected = this.checkEOGHexTri(otherPlayer);
        }
        if (connected) {
            return [this.currplayer];
        } else {
            return [];
        }
    }

    public getCustomRotation(): number | undefined {
        if (this.variants.length === 0 || this.variants[0].startsWith("standard")) {
            return 120;
        } else {
            return 0;
        }
    }

    public clone(): AgereGame {
        return Object.assign(new AgereGame(), deepclone(this) as AgereGame);
        // return new AgereGame(this.serialize());
    }
}
