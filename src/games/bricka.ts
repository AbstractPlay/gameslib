import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base.js";
import type { APGamesInformation } from "../schemas/gameinfo.js";
import { APRenderRep, RowCol, MarkerFlood } from "@abstractplay/renderer/build/schemas/schema";
import type { APMoveResult } from "../schemas/moveresults.js";
import { reviver, UserFacingError } from "../common/index.js";
import {union} from 'graphology-operators';
import { UndirectedGraph } from 'graphology';
import { dfsFromNode, bfsFromNode } from 'graphology-traversal';
import {bidirectional} from 'graphology-shortest-path';
import i18next from "i18next";
import { indexToColumnLabel, columnLabelToIndex } from "../common/columnLabels.js";

export const gameApgamesEn = {
    validation: {
        INITIAL_INSTRUCTIONS: "Select an intersection to place a piece.",
        BLOCKED: "You may not place on an intersection that shares a cell with the last-placed stone."
    }
};

function mod(n: number, m: number): number {
    return ((n % m) + m) % m;
}

export type playerid = 1|2;
export type cellcontent = playerid|"neutral";

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, cellcontent>;
    lastmove?: string;
    winningGroup: string[];
}

export interface IBrickaState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

/* Direction of regions, 0 is the upper arm of a cross, then clockwise */
type Dir = 0|1|2|3;
const dirs: Dir[] = [0, 1, 2, 3];

type Coord = [number, number];

function coord2algebraic([x, y]: Coord): string {
    return indexToColumnLabel(x) + (y + 1);
}

function algebraic2coord(cell: string): Coord {
    return [columnLabelToIndex(cell[0]), parseInt(cell.slice(1)) - 1];
}

function addCoord(a: Coord, b: Coord): Coord {
    return [a[0] + b[0], a[1] + b[1]];
}

function rotateCoord(c: Coord, times: number): Coord {
    /* Rotate Coord around 0, 90 degrees clockwise, a number of times */
    if(times === 0) {
        return c;
    }
    times = mod(times, 4);
    const [x, y] = c;
    // transpose then flip
    return rotateCoord([y, -x], times - 1);
}

function groupIntersection(a: Set<string>, b: Set<string>): boolean {
    /* Alternative for Set.intersection which is not available yet */
    for(const cell of a) {
        if(b.has(cell)){
            return true;
        }
    }
    return false;
}

// Order is important here because we may insert an extra coordinate, and will make
// a graph from it.
const regionTemplate: Coord[] = [[1, -1], [1, 0], [0, 1], [-1, 0], [-1, -1]];

/* The board consists of regions surrounded by 5 or 6 cells,
similar in shape but in different orientations */
class Region {
    readonly center: string;
    readonly dir: Dir;
    readonly cells: string[];

    constructor(centerCoord: Coord, dir: Dir) {
        this.center = coord2algebraic(centerCoord);
        this.dir = dir;
        this.cells = regionTemplate.map((c) => coord2algebraic(addCoord(
                rotateCoord(c, dir), centerCoord)))
    }

    public graph(): UndirectedGraph {
        const graph = new UndirectedGraph();
        this.cells.forEach((cell) => {graph.addNode(cell)});
        for (let i = 0; i < this.cells.length; i++) {
            graph.addEdge(this.cells[i], this.cells[(i+1)%this.cells.length]);
        }
        return graph;
    }
}

export class BrickaGame extends GameBase {

    public static readonly gameinfo: APGamesInformation = {
        name: "Bricka",
        uid: "bricka",
        playercounts: [2],
        version: "20261021",
        dateAdded: "2026-10-21",
        description: "Connection game played on a special board. Placing adjacent to a cell where you own the majority of non-neutral intersections means your stone becomes neutral. Also, intersections surrounding cells adjacent to the last placement are blocked for the current turn.",
        urls: ["https://www.pergioco.net/1/bricka-en.html", "https://boardgamegeek.com/boardgame/403689/bricka"],
        bggid: "403689",
        people: [
            {
                type: "designer",
                name: "Marino Carpignano",
                urls: ["https://boardgamegeek.com/boardgamedesigner/95427/marino-carpignano"],
                apid: "091df2d1-4e19-4916-8101-627a792b7c06",
            },
            {
                type: "coder",
                name: "hoembla",
                urls: [],
                apid: "36926ace-08c0-417d-89ec-15346119abf2",
            },
        ],
        customizations: [
            {
                num: 3,
                default: "#aaa",
                explanation: "Colour of the neutral stones",
            }
        ],
        categories: ["goal>connect", "mechanic>place", "components>simple>3c", "board>other", "board>shape>other", "board>connect>other", "mechanic>block"],
        flags: ["experimental", "autopass"]
    };

    private regions: Region[] = this.getRegions();

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, cellcontent>;
    public boardsize = 13;
    public graph: UndirectedGraph = this.getGraph();
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    private winningEdges: [Set<string>, Set<string>][] = this.getWinningEdges();

    public winningGroup: string[] = [];

    public getGraph(): UndirectedGraph {
        return this.regions.map((r) => (r.graph())).reduce(union);
    }

    private getWinningEdges(): [Set<string>, Set<string>][] {
        /* Return sets of opposing edges */
        const leftpt: Coord[] = [[0, 6]]
        const NW: Coord[] = [
            [1, 5],
            [1, 3],
            [2, 3],
            [2, 2],
            [4, 2],
            [4, 1],
            [5, 1],
            [5, 0]
        ]
        let NE: Coord[] = [...NW]
        NE.reverse();
        NE = NE.map(([x, y]) => ([x, this.boardsize - y - 1]));
        const rightpt: Coord[] = [[12, 6]]
        let SE = [...NE]
        SE.reverse();
        SE = SE.map(([x, y]) => ([this.boardsize - x - 1, y]));
        let SW: Coord[] = [...NW]
        SW.reverse();
        SW = SW.map(([x, y]) => ([this.boardsize - x - 1, y]));

        return [[leftpt, rightpt], [NW, SE], [NE, SW]].map(
            (pair) => (
                pair.map((edge) => (new Set(edge.map(coord2algebraic)))) as [Set<string>, Set<string>]
            ))
    }

    private getRegions(): Region[] {
        /* Build the region objects making up the board */
        // The regions are organized in a cross-shape, and the board consists
        // of multiple interlocking crosses. We start with the central cross, then
        // copy this to the layer of crosses surrounding it.
        // Then the overlapping crosses must be stitched together (i.e. add the extra
        // cell to those that have 6 cells instead of 5).
        const regions: Region[] = [];
        const start: Coord = [6, 6];
        const crossOffsets: Coord[] = [[0, 0],
            [0, -4], [3, -2], [3, 2], [0, 4], [-3, -2], [-3, 2]];
        const offset: Coord = [0, -1];
        crossOffsets.forEach((crossOffset) => {
            const cross: Region[] = dirs.map((dir) => (
                new Region(addCoord(crossOffset, addCoord(start, rotateCoord(offset, dir))), dir)))
            regions.push(...cross);
        });
        // Two extra regions east and west
        regions.push(new Region(addCoord(start, [-5, 0]), 3));
        regions.push(new Region(addCoord(start, [5, 0]), 1));
        // Now add the overlapping cells
        const allCells: Set<string> = new Set(regions.flatMap((region) => (region.cells)));
        regions.forEach((region) => {
            const spot = coord2algebraic(
                addCoord(algebraic2coord(region.center), rotateCoord(offset, region.dir)));
            if(allCells.has(spot)){
                region.cells.push(spot);
            }
        });
        return regions;
    }

    private adjacentRegions(cell: string): Region[] {
        const coord = algebraic2coord(cell);
        const possibleRegionCenters: Set<string> = new Set(
            ([[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as Coord[]).map(
                (d) => (addCoord(d, coord))).filter(([x, y]) => (x >= 0 && y >= 0)).map(coord2algebraic));
        return this.regions.filter((region) => (possibleRegionCenters.has(
            region.center)));
    }

    private blockedCells(): Set<string> {
        if(this.lastmove === undefined || this.lastmove === "pass") {
            return new Set();
        } else {
            return new Set(this.adjacentRegions(this.lastmove).flatMap((r) => (r.cells)))
        }
    }

    private hasRegionMajority(cell: string): boolean {
        /* Returns true if the active player would own the majority of intersections
        of any adjacent cell */
        const adjRegions = this.adjacentRegions(cell);
        for(const region of adjRegions) {
            let n = 0;
            region.cells.forEach((cell) => {
                if(this.board.has(cell) && this.board.get(cell) == this.currplayer){
                    n++;
                }
            });
            if((n + 1) > (region.cells.filter((c) => (this.board.get(c) !== "neutral")).length / 2)) {
                return true;
            }
        };
        return false;
    }

    public otherPlayer(): playerid {
        return this.currplayer === 1 ? 2 : 1;
    }

    constructor(state?: IBrickaState | string) {
        super();

        if (state === undefined) {
            const fresh: IMoveState = {
                _version: BrickaGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map<string, cellcontent>(),
                winningGroup: []
            };
            this.stack = [fresh];

        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IBrickaState;
            }
            if (state.game !== BrickaGame.gameinfo.uid) {
                throw new Error(`The Bricka engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): BrickaGame {
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
        this.winningGroup = [...state.winningGroup];

        return this;
    }

    public moves(): string[] {
        const moves: string[] = [];
        if (this.gameover) { return moves; }

        const blocked = this.blockedCells();
        for (const cell of this.graph.nodes()) {
            if (!this.board.has(cell) && !blocked.has(cell)) {
                moves.push(cell);
            }
        }
        if(moves.length === 0) {
            moves.push("pass");
        }

        return moves;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = "";
            const cell = coord2algebraic([col, row]);
            if(this.graph.nodes().includes(cell)) {
                newmove = cell;
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
                message: i18next.t("apgames:validation._general.GENERIC", {move, row, col, piece, emessage: (e as Error).message})
            }
        }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.bricka.INITIAL_INSTRUCTIONS");
            return result;
        }

        if (m === "pass") {
            if (this.moves().includes("pass")) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.go.INVALID_PASS");
                return result;
            }
        }

        const cell = m;

        if (!this.graph.hasNode(cell)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
            return result;
        }

        if (this.board.has(cell)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: cell});
            return result;
        }

        if (this.lastmove !== undefined && this.blockedCells().has(cell)){
            result.valid = false;
            result.message = i18next.t("apgames:validation.bricka.BLOCKED");
            return result;
        }

        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {trusted = false} = {}): BrickaGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:validation._general.MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (!this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }
        this.results = [];

        if (m === "pass") {
            this.results.push({type: "pass"});
        } else {
            const cell = m;

            const piece = this.hasRegionMajority(cell) ? "neutral" : this.currplayer;

            this.board.set(cell, piece);
            this.results.push({type: "place", where: cell});
        }

        this.lastmove = m;

        this.checkEOG();
        this.currplayer = this.otherPlayer();

        this.saveState();
        return this;
    }

    public isWinningGroup(player: playerid, lastmove: string): boolean {
        /*
        Check if the current group is a winning group i.e. connects two opposite board edges
        */
        if(lastmove === "pass"){ return false };
        const graph = this.getGraph();

        // Find the current group of player + neutral stones
        const currentGroup = new Set<string>();
        dfsFromNode(graph, lastmove, (cell) => {
            const value = this.board.get(cell);
            if (value === player || value === "neutral") {
                currentGroup.add(cell);
                return false;
            } else {
                return true;
            }
        });

        let winning = false;
        for (const [a, b] of this.winningEdges) {
            if(groupIntersection(currentGroup, a) && groupIntersection(currentGroup, b)) {
                winning = true;
                /* Store the shortest winning path */
                // First find the edge cells to use, i.e. closest to the placed stone
                let edgeCells: string[] = [];
                for( const edgeI of [0, 1]){
                    const edge = [a, b][edgeI];
                    bfsFromNode(graph, lastmove, (cell) => {
                        const value = this.board.get(cell);
                        if (value === player || value === "neutral") {
                            if(edge.has(cell)){
                                edgeCells.push(cell);
                            }
                            if(edgeCells.length > edgeI) {
                                return true;
                            }
                            return false;
                        } else {
                            return true;
                        }
                    });
                }
                const groupGraph = this.graph.copy();
                for(const node of this.graph.nodes()){
                    if(!currentGroup.has(node)){
                        groupGraph.dropNode(node);
                    }
                }
                const shortPath = bidirectional(groupGraph, edgeCells[0], edgeCells[1]);
                if(shortPath != null && (this.winningGroup.length === 0 || shortPath.length < this.winningGroup.length)) {
                    this.winningGroup = shortPath;
                }
            }
        }

        return winning;
    }

    protected checkEOG(): BrickaGame {
        /* A winning group or a full board */

        if (this.lastmove === "pass") {
            /* Game never ends right after a pass */
            return this;
        }

        if (this.isWinningGroup(this.currplayer, this.lastmove!)){
            this.gameover = true;
            this.winner.push(this.currplayer);
        } else if (this.board.get(this.lastmove!) === "neutral" && this.isWinningGroup(this.otherPlayer(), this.lastmove!)) {
            this.gameover = true;
            this.winner.push(this.otherPlayer());
        } else { // Check for full board
            if (this.board.size === this.graph.order) {
                /* Player with most stones on the board wins, or a draw if equal */
                this.gameover = true;
                const n1 = [...this.board.values()].filter((piece) => (piece === 1)).length;
                const n2 = [...this.board.values()].filter((piece) => (piece === 2)).length;
                if(n1 > n2) {
                    this.winner.push(1);
                } else if (n2 > n1) {
                    this.winner.push(2);
                } else {
                    this.winner = [1, 2];
                }
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

    public state(): IBrickaState {
        return {
            game: BrickaGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        const state = {
            _version: BrickaGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            winningGroup: [...this.winningGroup]
        };
        return state;
    }

    public render(): APRenderRep {
        const pstr: string[][][] = [];
        for (let row = 0; row < this.boardsize; row++) {
            const pieces: string[][] = [];
            for (let col = 0; col < this.boardsize; col++) {
                const cell = coord2algebraic([col, row]);
                const piece: string[] = [];
                if (this.board.has(cell)) {
                    const player = this.board.get(cell)!;

                    if (player === 1) { piece.push("A"); }
                    else if (player === 2) { piece.push("B"); }
                    else { piece.push("C"); }
                }
                pieces.push(piece);
            }
            pstr.push(pieces);
        }

        const blockedMarkers: MarkerFlood[] = [];
        if (this.lastmove !== undefined && this.lastmove !== "pass") {
            const regions = this.adjacentRegions(this.lastmove).map((r) => (r.center));
            blockedMarkers.push(
                {
                    type:"flood",
                    points: regions.map(algebraic2coord).map(([x, y]) => ({row: y, col: x})) as [RowCol, ...RowCol[]],
                    colour: this.otherPlayer()
                }
            )
        }


        // Build rep

        const rep: APRenderRep =  {
            board: {
                style: "bricka",
                markers: [
                    {type:"edge", edge: "NW", colour: 4},
                    {type:"edge", edge: "SE", colour: 4},
                    {type:"edge", edge: "NE", colour: 5},
                    {type:"edge", edge: "SW", colour: 5},
                    {type:"edge", edge: "W", colour: 6},
                    {type:"edge", edge: "E", colour: 6},
                    ...blockedMarkers
                ]
            },
            legend: {
                A: {name: "piece", colour: 1},
                B: {name: "piece", colour: 2},
                C: {name: "piece", colour: 3}
            },
            pieces: pstr as [string[][], ...string[][][]],
            options: ["reverse-numbers"]
        };

        rep.annotations = [];
        for (const move of this.stack.at(-1)!._results) {
            if (move.type === "place") {
                const [x, y] = algebraic2coord(move.where!);
                rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
            }
        }
        if (this.winningGroup.length > 0) {
            const targets: RowCol[] = [];
            for (const cell of this.winningGroup) {
                const [x, y] = algebraic2coord(cell);
                targets.push({row: y, col: x})
            }
            rep.annotations.push({type: "move", targets: targets as [RowCol, ...RowCol[]], arrow: false});
        }

        return rep;
    }

    public clone(): BrickaGame {
        return new BrickaGame(this.serialize());
    }
};

