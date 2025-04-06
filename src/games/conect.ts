/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, Glyph } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { HexConeGraph, HexSlantedGraph } from "../common/graphs";
import { UndirectedGraph } from "graphology";
import { bidirectional } from "graphology-shortest-path/unweighted";

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    connPath: string[];
    lastmove?: string;
};

export interface IConectState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class ConectGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Conect",
        uid: "conect",
        playercounts: [2],
        version: "20240614",
        dateAdded: "2024-06-17",
        // i18next.t("apgames:descriptions.conect")
        description: "apgames:descriptions.conect",
        urls: ["https://www.marksteeregames.com/Conect_rules.pdf"],
        people: [
            {
                type: "designer",
                name: "Mark Steere",
                urls: ["https://marksteeregames.com/"],
                apid: "e7a3ebf6-5b05-4548-ae95-299f75527b3f",
            },
            {
                type: "coder",
                name: "ypaul",
                urls: [],
                apid: "46f6da78-be02-4469-94cb-52f17078e9c1",
            },
        ],
        categories: ["goal>connect", "mechanic>place", "board>shape>rect", "board>connect>hex", "components>simple>1per"],
        flags: ["pie"],
        variants: [
            { uid: "size-13", group: "board" },
            { uid: "size-15", group: "board" },
            { uid: "narrow", group: "cone" },
        ],
        displays: [{uid: "display-hex"}],
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public connPath: string[] = [];
    public graph: HexConeGraph;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private boardSize = 0;
    private lines: [string[], string[]];
    private coneType: "wide" | "narrow";

    constructor(state?: IConectState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: ConectGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                connPath: [],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IConectState;
            }
            if (state.game !== ConectGame.gameinfo.uid) {
                throw new Error(`The Conect engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
        this.coneType = this.variants.includes("narrow") ? "narrow" : "wide";
        this.graph = this.getGraph();
        this.lines = this.getLines();
    }

    public load(idx = -1): ConectGame {
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

    private getLines(): [string[], string[]] {
        const lineP1: string[] = [];
        // For player 1, one of the cells in that edge does not exist.
        for (let x = 0; x < this.boardSize - 1; x++) {
            if (this.coneType === "narrow") {
                const N = this.graph.coords2algebraic(x, 0);
                lineP1.push(N);
            } else {
                const N = this.graph.coords2algebraic(x + 1, 0);
                lineP1.push(N);
            }
        }
        const lineP2: string[] = [];
        for (let y = 0; y < this.boardSize; y++) {
            if (this.coneType === "narrow") {
                const W = this.graph.coords2algebraic(0, y);
                lineP2.push(W);
            } else {
                const E = this.graph.coords2algebraic(this.boardSize - 1, y);
                lineP2.push(E);
            }
        }
        // This last cell is owned by both players, so we need to add it to player 1's line.
        if (this.coneType === "narrow") {
            lineP1.push(this.graph.coords2algebraic(0, this.boardSize - 1));
        } else {
            lineP1.push(this.graph.coords2algebraic(this.boardSize - 1, this.boardSize - 1));
        }
        return [lineP1, lineP2];
    }

    private getBoardSize(): number {
        // Get board size from variants.
        if ( (this.variants !== undefined) && (this.variants.length > 0) && (this.variants[0] !== undefined) && (this.variants[0].length > 0) ) {
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

    private getGraph(): HexConeGraph {
        return new HexConeGraph(this.boardSize, this.coneType);
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];
        const empties = (this.graph.listCells() as string[]).filter(c => !this.board.has(c));
        for (const cell of empties) {
            moves.push(cell);
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
            newmove = this.graph.normaliseCell(cell);

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
                message: i18next.t("apgames:validation._general.GENERIC", { move, row, col, piece, emessage: (e as Error).message })
            }
        }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = { valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER") };

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.conect.INITIAL_INSTRUCTIONS");
            return result;
        }

        const cell = m;
        // valid cell
        try {
            this.graph.algebraic2coords(cell);
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell });
            return result;
        }
        const [x, y] = this.graph.algebraic2coords(cell);
        if (this.coneType === "narrow") {
            if (x === this.boardSize - 1) {
                if (y === this.boardSize - 1) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.conect.NO_CENTRE", { cell });
                }
                result.valid = false;
                result.message = i18next.t("apgames:validation.conect.WRONG_CELL", { cell, other: this.graph.otherCell(cell) });
                return result;
            }
        } else {
            if (x === 0 && cell !== this.graph.centre()) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.conect.WRONG_CELL", { cell, other: this.graph.otherCell(cell) });
                return result;
            }
        }
        // cell is empty
        if (this.board.has(cell)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", { where: cell });
            return result;
        }
        // we're good
        result.valid = true;
        result.complete = 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");

        return result;
    }

    public move(m: string, {trusted = false} = {}): ConectGame {
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
            if (!this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];
        this.board.set(m, this.currplayer);
        this.results.push({type: "place", where: m});

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

    private checkWin(player: playerid): string[] {
        // Return the connection paths if the player has won.
        // Otherwise, return an empty array.
        // There are three ways to win:
        // 1) Connect from the player's edge to the centre cell.
        // 2) Connect two points on the player's edge in a path that loops around the centre.
        // 3) Loop around the centre, and connect from the player's edge to the loop.

        // The first check is easy.
        const centre = this.graph.centre();
        const graph = this.buildGraph(player);
        const piecesOnEdge = this.lines[player - 1].filter(c => this.board.get(c) === player);
        for (const source of this.lines[player - 1]) {
            if ((graph.hasNode(source)) && (graph.hasNode(centre)) ) {
                const path = bidirectional(graph, source, centre);
                if (path !== null && path.filter(c => piecesOnEdge.includes(c)).length === 1) {
                    return path;
                }
            }
        }
        // For the second and third check, we flood fill from the centre to see if
        // we find a closed region that does not touch the opponent's edge.
        // If the region exists, then if it sees the player's edge, it's a win by (3).
        // If the region exists and it does not see the player's edge, then
        // we need to check if there is a path from the player's edge to the loop around the region.
        // But we also want to always find the outer-most ring, which is why we wrap it in another loop.
        let seenOwnEdge = false;
        // Keep track of all cells that contain the player's pieces.
        let owned = new Set<string>();
        // Keep track of all cells that do not contain the player's pieces.
        const seen = new Set<string>();
        // Get outer-most ring.
        outer:
        while (true) {
            const queue = owned.size === 0 ? [centre]: [...owned];
            const currentOwned = new Set<string>();
            let currentSeenOwnEdge = false;
            while (queue.length > 0) {
                const cell = queue.pop()!;
                seen.add(cell);
                for (const n of this.graph.neighbours(cell)) {
                    const neighbour = this.board.get(n);
                    if (neighbour === undefined) {
                        if (!seen.has(n)) { queue.push(n); }
                    } else if (neighbour === player) {
                        if (owned.has(n)) { continue; }
                        currentOwned.add(n);
                    } else {
                        if (!seen.has(n)) {
                            queue.push(n);
                        }
                    }
                    if (neighbour !== player && this.lines[player % 2].includes(n)) {
                        // The player has reached their opponent's edge
                        // Break now, so we do not reassign `owned` and `seenOwnEdge`.
                        // If `owned` is not reassigned, then it is empty, and there is no loop.
                        break outer;
                    } else if (neighbour !== player % 2 + 1 as playerid && this.lines[player - 1].includes(n)) {
                        currentSeenOwnEdge = true;
                    }
                }
            }
            owned = currentOwned;
            seenOwnEdge = currentSeenOwnEdge;
            if (seenOwnEdge) { break; }
        }
        if (owned.size === 0) { return []; }
        // If we have seen the player's edge, then we have a win by (2).
        // Look for a path that loops around the centre from a point on the edge to another
        // point on the edge, after having dropped all others of the player's pieces on that edge.
        if (seenOwnEdge) {
            for (const start1 of piecesOnEdge) {
                for (const end1 of piecesOnEdge) {
                    if (start1 === end1) { continue; }
                    const graph2 = this.buildGraph(player);
                    for (const toDrop of piecesOnEdge) {
                        if (toDrop !== start1 && toDrop !== end1) {
                            graph2.dropNode(toDrop);
                        }
                    }
                    const path = bidirectional(graph2, start1, end1);
                    if (path !== null && this.loopsCentre(path, player)) {
                        return path;
                    }
                }
            }
        }
        // Now check if player has a path from their edge to the owned set.
        // If there is, get that path.
        const visited = new Set<string>();
        const startPoints = this.lines[player - 1].filter(c => this.board.get(c) === player);
        let pathToRing: string[] | undefined;
        outer2:
        for (const startPoint of startPoints) {
            const queue = [startPoint];
            while (queue.length > 0) {
                const cell = queue.pop()!;
                if (visited.has(cell)) { continue; }
                visited.add(cell);
                for (const n of this.graph.neighbours(cell)) {
                    if (owned.has(n)) {
                        // Found a path from the edge to the owned set.
                        const graph3 = this.buildGraph(player);
                        pathToRing = bidirectional(graph3, startPoint, n)!
                        break outer2;
                    }
                    if (this.board.get(n) === player && !visited.has(n)) {
                        queue.push(n);
                    }
                }
            }
        }
        if (pathToRing === undefined) { return []; }
        const start = pathToRing.length > 0 ? pathToRing[pathToRing.length - 1] : [...owned].find(c => this.lines[player - 1].includes(c))!
        return [...pathToRing.slice(0, -1), ...this.findCycle(owned, start)];
    }

    private findCycle(owned: Set<string>, start: string): string[] {
        // Search for a cycle in the graph such that it surrounds the centre.
        // This implicitly exploits a lot of properties of the hex graph,
        // but they're not proven, and I'm not completely defining them here.
        const loopSet = this.getLoopSet(owned);
        // Special case for a loop of size 2.
        // This needs to be handled separetely because the path finding algorithm
        // assumes that the path found is at least of size 3 to simplify the logic
        // of finding degenerate paths.
        if (loopSet.size === 2) {
            const notStart = [...loopSet].find(c => c !== start)!;
            return [start, notStart, start];
        }
        return this.traversePaths(start, loopSet, start, [start])!;
    }

    private getLoopSet(owned: Set<string>): Set<string> {
        // Look for the group of cells that form a loop around the centre.
        const seen: Set<string> = new Set();
        for (const piece of owned) {
            if (seen.has(piece)) {
                continue;
            }
            const group: Set<string> = new Set();
            const todo: string[] = [piece]
            while (todo.length > 0) {
                const cell = todo.pop()!;
                if (seen.has(cell)) {
                    continue;
                }
                group.add(cell);
                seen.add(cell);
                for (const n of this.getOwnedNeighbours(cell, owned)) {
                    todo.push(n);
                }
            }
            if (this.loopsCentre([...group])) {
                return group;
            }
        }
        throw new Error("Could not find a loop around the centre.");
    }

    private getOwnedNeighbours(cell: string, owned: Set<string>): string[] {
        // Get the neighbours of a cell that are in the owned set.
        const neighbours: string[] = [];
        for (const n of this.graph.neighbours(cell)) {
            if (owned.has(n)) {
                neighbours.push(n);
            }
        }
        return neighbours;
    }

    private traversePaths(cell: string, loopSet: Set<string>, start: string, currPath: string[]): string[] | undefined {
        // Look for a cycle back to the start such that the number of cells in the cycle is at least 4.
        // This avoids degenerate cycles with only 3 cells.
        // Note that we do not need to check if the cycle loops around the centre
        // because the set of cells passed here is already the loop set.
        for (const neighbour of this.getOwnedNeighbours(cell, loopSet)) {
            if (neighbour === start) {
                if (currPath.length < 3) { continue; };
                return [...currPath, start];
            }
            if (currPath.includes(neighbour)) { continue; }
            const path = this.traversePaths(neighbour, loopSet, start, [...currPath, neighbour]);
            if (path !== undefined) { return path; }
        }
        return undefined;
    }

    private loopsCentre(cycle: string[], player?: playerid): boolean {
        // Chcek if the cycle loops around the centre.
        // Use the flood fill algorithm to check if the cycle surrounds the centre.
        // If we touch an edge, then the cycle does not loop around the centre.
        const centre = this.graph.centre();
        const queue = [centre];
        const visited = new Set<string>();
        while (queue.length > 0) {
            const cell = queue.pop()!;
            if (visited.has(cell)) { continue; }
            visited.add(cell);
            for (const n of this.graph.neighbours(cell)) {
                if (cycle.includes(n)) { continue; }
                if (player === undefined) {
                    if (this.lines[0].includes(n)) { return false; }
                    if (this.lines[1].includes(n)) { return false; }
                } else {
                    if (this.lines[player % 2].includes(n)) { return false; }
                }
                if (!visited.has(n)) { queue.push(n); }
            }
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
            const neighbours = this.graph.neighbours(node);
            for (const n of neighbours) {
                if (graph.hasNode(n) && !graph.hasEdge(node, n)) {
                    graph.addEdge(node, n);
                }
            }
        }
        return graph;
    }

    protected checkEOG(): ConectGame {
        const connPath = this.checkWin(this.currplayer % 2 + 1 as playerid);
        if (connPath.length > 0) {
            this.connPath = connPath;
            this.gameover = true;
            this.winner = [this.currplayer % 2 + 1 as playerid];
        }
        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IConectState {
        return {
            game: ConectGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: ConectGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            connPath: [...this.connPath],
        };
    }

    private breakPathsHex(path: string[]): string[][] {
        // On the hex board, break the path into segments for rendering.
        // This is needed because lines wrap around the board, and each time it does that,
        // we need to create a new path segment.
        const paths: string[][] = [];
        const hexSlantedGraph = new HexSlantedGraph(this.boardSize, this.boardSize);
        let prev = path[0];
        let currPath: string[] = [prev];
        for (let i = 1; i < path.length; i++) {
            const next = path[i];
            if (i === path.length - 1) {
                // Some hacks to handle the last cell if the loop is the two cells next to the centre.
                const [x, y] = hexSlantedGraph.algebraic2coords(next);
                if (y === this.boardSize - 1 && (this.coneType === "wide" && x === 1 || this.coneType === "narrow" && x === this.boardSize - 3)) {
                    currPath.push(this.graph.otherCell(next)!);
                    break;
                } else if (y === this.boardSize - 2 && (this.coneType === "wide" && x === 1 || this.coneType === "narrow" && x === this.boardSize - 2)) {
                    currPath.push(next);
                    if (this.coneType === "wide") {
                        currPath.push(this.graph.coords2algebraic(0, this.boardSize - 2));
                    } else {
                        currPath.push(this.graph.coords2algebraic(this.boardSize - 1, this.boardSize - 3));
                    }
                    break;
                }
            }
            if (hexSlantedGraph.neighbours(prev).includes(next)) {
                currPath.push(next);
            } else {
                const [, y] = hexSlantedGraph.algebraic2coords(next);
                if (y === this.boardSize - 1) {
                    currPath.push(this.graph.otherCell(next)!);
                    paths.push(currPath);
                    currPath = [next];
                } else {
                    paths.push(currPath);
                    currPath = [this.graph.otherCell(prev)!, next];
                }
            }
            prev = next;
        }
        paths.push(currPath);
        return paths;
    }

    public render(opts?: IRenderOpts): APRenderRep {
        let altDisplay: string | undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }
        let displayHex = false;
        if (altDisplay !== undefined) {
            if (altDisplay === "display-hex") {
                displayHex = true;
            }
        }
        // Build piece string for hex board
        const pstr: string[][] = [];
        if (displayHex) {
            for (let row = 0; row < this.boardSize; row++) {
                const pieces: string[] = [];
                for (let col = 0; col < this.boardSize; col++) {
                    const cell = this.graph.normaliseCell(this.graph.coords2algebraic(col, row));
                    if (this.board.has(cell)) {
                        const owner = this.board.get(cell)!;
                        if (owner === 1) {
                            pieces.push("A")
                        } else {
                            pieces.push("B");
                        }
                    } else {
                        pieces.push("-");
                    }
                }
                pstr.push(pieces);
            }
        }

        const markers: Array<any> = [];
        if (displayHex) {
            markers.push({ type: "edge", edge: "N", colour: 1 });
            markers.push({ type: "edge", edge: this.coneType === "narrow" ? "W" : "E", colour: 2 });
            const flood: { row: number, col: number }[] = [];
            for (let i = 0; i < this.boardSize - 1; i++) {
                if (this.coneType === "narrow") {
                    flood.push({ row: i, col: this.boardSize - 1 });
                    flood.push({ row: this.boardSize - 1, col: i });
                } else {
                    flood.push({ row: i, col: 0 });
                    flood.push({ row: this.boardSize - 1, col: i + 1 });
                }
            }
            markers.push({ type: "flood", colour: "#FFFF00", opacity: 0.15, points: flood });
            if (this.coneType === "wide") {
                markers.push({ type: "fence", side: "NW", cell: { row: 0, col: 0 }})
                markers.push({ type: "fence", side: "E", cell: { row: this.boardSize - 1, col: this.boardSize - 1 }})
            } else {
                markers.push({ type: "fence", side: "NW", cell: { row: 0, col: this.boardSize - 1 }})
                markers.push({ type: "fence", side: "E", cell: { row: this.boardSize - 1, col: 0 }})
            }
        } else {
            markers.push({ type: "halo", width: 10, segments: [{ colour: 1 }, { colour: 2 }] });
        }

        if (!displayHex) {
            const p1: Array<any> = [];
            const p2: Array<any> = [];
            // const winning: Array<any> = [];
            for (const [cell, player] of this.board) {
                const [x, y] = this.graph.algebraic2coords(cell);
                // if (this.connPath.includes(cell)) {
                //     winning.push({ row: y, col: x });
                // }
                if (player === 1) {
                    p1.push({ row: y, col: x });
                } else {
                    p2.push({ row: y, col: x });
                }
            }
            if (p1.length > 0) {
                markers.push({ type: "flood", colour: 1, points: p1, opacity: 0.95 });
            }
            if (p2.length > 0) {
                markers.push({ type: "flood", colour: 2, points: p2, opacity: 0.95 });
            }
            // if (winning.length > 0) {
            //     markers.push({ type: "flood", colour: "#FFFF00", points: winning, opacity: 0.2 });
            // }
        }

        let legend: {[k: string]: Glyph|[Glyph, ...Glyph[]]} | undefined;
        if (displayHex) {
            legend = {
                A: {
                    name: "piece",
                    colour: 1
                },
                B: {
                    name: "piece",
                    colour: 2
                },
            };
            for (let i = 0; i < this.boardSize - 1; i++) {
                legend[`n${i}`] = {
                    text: (i + 1).toString(),
                    opacity: 0.6,
                    scale: 0.6,
                };
                markers.push({
                    type: "glyph",
                    glyph: `n${i}`,
                    points: this.coneType === "narrow" ? [
                        { row: i, col: this.boardSize - 1 },
                        { row: this.boardSize - 1, col: i },
                    ] : [
                        { row: i, col: 0 },
                        { row: this.boardSize - 1, col: this.boardSize - 1 - i },
                    ]
                })
            }
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: displayHex ? "hex-slanted" : this.coneType === "narrow" ? "conical-hex-narrow" : "conical-hex",
                width: this.boardSize,
                height: this.boardSize,
                blocked: displayHex && this.coneType === "narrow" ? [{ row: this.boardSize - 1, col: this.boardSize - 1 }] : undefined,
                markers,
                strokeWeight: displayHex ? undefined : 5,
            },
            options: displayHex ? ["reverse-letters"] : undefined,
            legend,
            pieces: displayHex ? pstr.map(p => p.join("")).join("\n") : "-",
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
                    const [x, y] = this.graph.algebraic2coords(move.where!);
                    rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                    const repeatedCell = this.graph.repeatedCell(move.where!);
                    if (repeatedCell !== undefined) {
                        const [otherX, otherY] = this.graph.algebraic2coords(repeatedCell);
                        rep.annotations.push({ type: "enter", targets: [{ row: otherY, col: otherX }] });
                    }
                }
            }
            if (this.connPath.length > 0 && displayHex) {
                type RowCol = {row: number; col: number;};
                const connPaths = displayHex ? this.breakPathsHex(this.connPath) : [this.connPath];
                for (const connPath of connPaths) {
                    const targets: RowCol[] = [];
                    if (connPath.length < 2) { continue; }
                    for (const cell of connPath) {
                        const [x, y] = this.graph.algebraic2coords(cell);
                        targets.push({ row: y, col: x })
                    }
                    rep.annotations.push({ type: "move", targets: targets as [RowCol, ...RowCol[]], arrow: false });
                }
            }
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

    public clone(): ConectGame {
        return new ConectGame(this.serialize());
    }
}
