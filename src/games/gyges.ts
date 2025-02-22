/* eslint-disable @typescript-eslint/no-unsafe-call */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, AreaPieces, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, shuffle, UserFacingError } from "../common";
import { GygesGraph } from "./gyges/graph";
import i18next from "i18next";
import Graph, { DirectedGraph, MultiDirectedGraph } from "graphology";
import { allSimpleEdgeGroupPaths } from "graphology-simple-path";
import { bidirectional } from "graphology-shortest-path";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-var-requires
const deepclone = require("rfdc/default");

export type playerid = 1|2;
export type Size = 1|2|3;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, Size>;
    lastmove?: string;
};

export interface IGygesState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

const pathsOfLen = (g: DirectedGraph, target: number, paths: string[][]): string[][] => {
    const newpaths: string[][] = [];
    for (const path of paths) {
        for (const next of g.outNeighbors(path[path.length - 1])) {
            if (!path.includes(next)) {
                newpaths.push([...path, next]);
            }
        }
    }
    if (newpaths[0].length < target + 1) {
        return pathsOfLen(g, target, newpaths);
    } else {
        return newpaths.map(p => cells2edges(g, p));
    }
}

const edges2cells = (g: Graph, edges: string[]): string[] => {
    const cells: string[] = [];
    for (let i = 0; i < edges.length; i++) {
        const [from, to] = g.extremities(edges[i]);
        if (i === 0) {
            cells.push(from);
        }
        cells.push(to)
    }
    return cells;
}

const cells2edges = (g: DirectedGraph, cells: string[]): string[] => {
    const edges: string[] = [];
    for (let i = 1; i < cells.length; i++) {
        const source = cells[i-1];
        const target = cells[i];
        const edge = g.directedEdge(source, target);
        if (edge === undefined) {
            throw new Error(`Could not find an edge between ${source} and ${target}`);
        }
        edges.push(edge);
    }
    return edges;
}

const extractOrigPath = (gBase: GygesGraph, gMove: MultiDirectedGraph, edges: string[]): string[] => {
    const stream: string[] = [];

    for (const edge of edges) {
        if (!gMove.hasEdgeAttribute(edge, "origPath")) {
            throw new Error("Couldn't extract origPath variable from edge.");
        }
        const origPath = gMove.getEdgeAttribute(edge, "origPath") as string[];
        const cells = edges2cells(gBase.graph, origPath);
        stream.push(...cells);
    }

    // clean up duplicates
    const cleaned: string[] = [];
    for (const cell of stream) {
        if (cleaned[cleaned.length - 1] !== cell) {
            cleaned.push(cell);
        }
    }

    return cleaned;
}

const expandGroups = (lst: string[][]): string[][] => {
    const expanded: string[][] = [];
    if (lst.length > 0) {
        const node = lst[0];
        for (const ele of node) {
            if (lst.length > 1) {
                const rest = expandGroups(lst.slice(1));
                for (const group of rest) {
                    expanded.push([ele, ...group]);
                }
            } else {
                expanded.push([ele]);
            }
        }
    }
    return expanded;
}

type Opts = {gBase: GygesGraph, start: string, board: Map<string, Size>, seen: Set<string>, gWorking?: MultiDirectedGraph}
const buildMoveGraph = (opts: Opts): [MultiDirectedGraph, GygesGraph] => {
    let {gBase, start, board, seen, gWorking} = opts;
    const size = board.get(start);
    if (size === undefined) {
        throw new Error(`No piece at ${start}`);
    }
    if (gWorking === undefined) {
        gWorking = new MultiDirectedGraph();
        gWorking.addNode(start);
        board.delete(start);
    }
    const paths: string[][] = pathsOfLen(gBase.graph, size, [[start]]);
    for (const path of paths) {
        const localSeen = deepclone(seen) as Set<string>;
        // can't use the same edge twice
        let haveSeen = false;
        const uidPath: string[] = [];
        for (const edge of path) {
            const uid = gBase.graph.getEdgeAttribute(edge, "uid") as string;
            if (uid === undefined) {
                throw new Error(`Could not fetch the uid from an edge`);
            }
            uidPath.push(uid);
            if (localSeen.has(uid)) {
                haveSeen = true;
                break;
            }
            localSeen.add(uid);
        }
        if (haveSeen) {
            continue;
        }

        // middle cells can't be occupied
        const cells = edges2cells(gBase.graph, path);
        let isBlocked = false;
        for (let i = 1; i < cells.length - 1; i++) {
            if (board.has(cells[i])) {
                isBlocked = true;
                break;
            }
        }
        if (isBlocked) {
            continue;
        }

        // add destination if not already present
        const dest = cells[cells.length - 1];
        if (!gWorking.hasNode(dest)) {
            gWorking.addNode(dest);
        }
        gWorking.addDirectedEdge(start, dest, {path: [...uidPath], origPath: [...path]})
        // if destination is occupied, recurse
        if (board.has(dest)) {
            buildMoveGraph({gBase, start: dest, seen: localSeen, board: deepclone(board) as Map<string, Size>, gWorking});
        }
    }
    return [gWorking, gBase];
}

const pathReusesEdge = (g: MultiDirectedGraph, path: string[]): boolean => {
    const attrs: string[][] = [];
    for (const edgeID of path) {
        if (!g.hasEdgeAttribute(edgeID, "path")) {
            throw new Error("Couldn't extract path variable from edge.");
        }
        attrs.push(g.getEdgeAttribute(edgeID, "path") as string[]);
    }
    const set = new Set<string>(attrs.flat());
    return set.size !== attrs.flat().length;
}

export class GygesGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Gyges",
        uid: "gyges",
        playercounts: [2],
        version: "20250217",
        dateAdded: "2023-06-18",
        // i18next.t("apgames:descriptions.gyges")
        description: "apgames:descriptions.gyges",
        // i18next.t("apgames:notes.gyges")
        notes: "apgames:notes.gyges",
        urls: ["https://boardgamegeek.com/boardgame/10527/gyges"],
        people: [
            {
                type: "designer",
                name: "Claude Leroy",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3187/claude-leroy"],
            },
        ],
        categories: ["goal>breakthrough", "mechanic>place", "mechanic>move", "mechanic>displace", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["experimental", "custom-randomization", "no-moves", "perspective"]
    };
    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 8);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 8);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, Size>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private highlights: string[] = [];
    private dots: string[] = [];

    constructor(state?: IGygesState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const board = new Map<string, Size>();
            const fresh: IMoveState = {
                _version: GygesGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IGygesState;
            }
            if (state.game !== GygesGame.gameinfo.uid) {
                throw new Error(`The Gyges engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): GygesGame {
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
        return this;
    }

    // public moves(): string[] {
    //     if (this.gameover) { return []; }

    //     const g = new GygesGraph(this.currplayer);
    //     const moves = new Set<string>();
    //     this.detailedPaths = new Map<string, string[]>();

    //     // setup
    //     if (this.board.size < 12) {
    //         const myCells = g.graph.nodes().filter(c => c.endsWith(this.currplayer === 1 ? "2" : "7"))
    //         const myPcs = [...this.board.entries()].filter(([c,]) => myCells.includes(c)).map(([,v]) => v);
    //         const toPlace: Size[] = [];
    //         for (const size of [1,1,2,2,3,3] as Size[]) {
    //             const idx = myPcs.findIndex(n => n === size);
    //             if (idx >= 0) {
    //                 myPcs.splice(idx, 1);
    //             } else {
    //                 toPlace.push(size);
    //             }
    //         }
    //         for (const size of new Set<Size>(toPlace)) {
    //             const empty = myCells.filter(c => !this.board.has(c));
    //             for (const cell of empty) {
    //                 moves.add(`${size}${cell}`);
    //             }
    //         }
    //     }
    //     // normal play
    //     else {
    //         // go row by row, looking for moves
    //         const rows = [2, 3, 4, 5, 6, 7].map(n => n.toString());
    //         if (this.currplayer === 2) {
    //             rows.reverse();
    //         }

    //         // for advanced moves, we need a list of empty cells we can move pieces to
    //         // can't be beyond the last row the opponent has pieces
    //         const otherRows = [...rows].reverse();
    //         let firstRow: string;
    //         for (const row of otherRows) {
    //             const pcs = [...this.board.keys()].filter(c => c.endsWith(row));
    //             if (pcs.length > 0) {
    //                 firstRow = row;
    //                 break;
    //             }
    //         }
    //         const idx = otherRows.findIndex(n => n === firstRow);
    //         const validRows = otherRows.slice(idx);
    //         const validEmpty = [...g.graph.nodes()].filter(c => validRows.includes(c[1]) && !this.board.has(c));

    //         for (const row of rows) {
    //             const avail = [...this.board.entries()].filter(([c,]) => c.endsWith(row));
    //             for (const [from,] of avail) {
    //                 const [gMove, gBase] = buildMoveGraph({gBase: g, start: from, seen: new Set<string>(), board: deepclone(this.board) as Map<string,Size>});
    //                 for (const to of gMove.nodes()) {
    //                     // if (from === to) { continue; }
    //                     // bounce moves require you to end on an empty cell
    //                     if (!this.board.has(to)) {
    //                         const paths = allSimpleEdgeGroupPaths(gMove, from, to);
    //                         for (const path of paths) {
    //                             const expanded = expandGroups(path);
    //                             for (const edgePath of expanded) {
    //                                 if (!pathReusesEdge(gMove, edgePath)) {
    //                                     const mv = edges2cells(gMove, edgePath).join("-");
    //                                     const origPath = extractOrigPath(gBase, gMove, edgePath);
    //                                     moves.add(mv);
    //                                     this.detailedPaths.set(mv, origPath);
    //                                 }
    //                             }
    //                         }
    //                     }
    //                     // "punches"
    //                     else {
    //                         const paths = allSimpleEdgeGroupPaths(gMove, from, to);
    //                         for (const path of paths) {
    //                             const expanded = expandGroups(path);
    //                             for (const edgePath of expanded) {
    //                                 if (!pathReusesEdge(gMove, edgePath)) {
    //                                     const mv = edges2cells(gMove, edgePath).join("-");
    //                                     const origPath = extractOrigPath(gBase, gMove, edgePath);
    //                                     this.detailedPaths.set(mv, origPath);
    //                                     for (const empty of validEmpty) {
    //                                         moves.add(`${mv}(${empty})`);
    //                                     }
    //                                 }
    //                             }
    //                         }
    //                     }
    //                 }
    //             }

    //             // if you found any moves on this row, then stop looking
    //             if (moves.size > 0) {
    //                 break;
    //             }
    //         }
    //     }

    //     return [...moves].sort((a,b) => a.localeCompare(b));
    // }

    public inHand(p?: playerid): Size[] {
        if (p === undefined) {
            p = this.currplayer;
        }

        if (this.board.size < 12) {
            const g = new GygesGraph(p);
            const myCells = g.graph.nodes().filter(c => c.endsWith(p === 1 ? "2" : "7"))
            const myPcs = [...this.board.entries()].filter(([c,]) => myCells.includes(c)).map(([,v]) => v);
            const toPlace: Size[] = [];
            for (const size of [1,1,2,2,3,3] as Size[]) {
                const idx = myPcs.findIndex(n => n === size);
                if (idx >= 0) {
                    myPcs.splice(idx, 1);
                } else {
                    toPlace.push(size);
                }
            }
            return toPlace.sort();
        } else {
            return [];
        }
    }

    public getPlayableRow(p?: playerid): string {
        if (p === undefined) {
            p = this.currplayer;
        }
        const g = new GygesGraph(p);

        // go row by row, looking for moves
        const rows = [2, 3, 4, 5, 6, 7].map(n => n.toString());
        if (p === 2) {
            rows.reverse();
        }

        for (const row of rows) {
            const avail = [...this.board.entries()].filter(([c,]) => c.endsWith(row));
            for (const [from,] of avail) {
                const [gMove, ] = buildMoveGraph({gBase: g, start: from, seen: new Set<string>(), board: deepclone(this.board) as Map<string,Size>});
                for (const to of gMove.nodes()) {
                    const paths = allSimpleEdgeGroupPaths(gMove, from, to);
                    for (const path of paths) {
                        const expanded = expandGroups(path);
                        for (const edgePath of expanded) {
                            if (!pathReusesEdge(gMove, edgePath)) {
                                return row;
                            }
                        }
                    }
                }
            }
        }
        throw new Error("No playable row found. This should never happen.");
    }

    public getDisplacements(p?: playerid): string[] {
        if (p === undefined) {
            p = this.currplayer;
        }

        const g = new GygesGraph(p);
        const rows = [2, 3, 4, 5, 6, 7].map(n => n.toString());
        if (p === 2) {
            rows.reverse();
        }

        const otherRows = [...rows].reverse();
        const firstRow = this.getPlayableRow(p === 1 ? 2 : 1);
        const idx = otherRows.findIndex(n => n === firstRow);
        const validRows = otherRows.slice(idx);
        return [...g.graph.nodes()].filter(c => validRows.includes(c[1]) && !this.board.has(c));
    }

    // public movesFor(start: string, p?: playerid): string[] {
    //     if (p === undefined) {
    //         p = this.currplayer;
    //     }
    //     const g = new GygesGraph(p);
    //     const moves = new Set<string>();
    //     this.detailedPaths = new Map<string, string[]>();
    //     const validEmpty = this.getDisplacements(p);

    //     const [gMove, gBase] = buildMoveGraph({gBase: g, start, seen: new Set<string>(), board: deepclone(this.board) as Map<string,Size>});
    //     for (const to of gMove.nodes()) {
    //         // if (from === to) { continue; }
    //         // bounce moves require you to end on an empty cell
    //         if (!this.board.has(to) || to === start) {
    //             const paths = allSimpleEdgeGroupPaths(gMove, start, to);
    //             for (const path of paths) {
    //                 const expanded = expandGroups(path);
    //                 for (const edgePath of expanded) {
    //                     if (!pathReusesEdge(gMove, edgePath)) {
    //                         const mv = edges2cells(gMove, edgePath).join("-");
    //                         const origPath = extractOrigPath(gBase, gMove, edgePath);
    //                         moves.add(mv);
    //                         this.detailedPaths.set(mv, origPath);
    //                     }
    //                 }
    //             }
    //         }
    //         // "punches"
    //         else {
    //             const paths = allSimpleEdgeGroupPaths(gMove, start, to);
    //             for (const path of paths) {
    //                 const expanded = expandGroups(path);
    //                 for (const edgePath of expanded) {
    //                     if (!pathReusesEdge(gMove, edgePath)) {
    //                         const mv = edges2cells(gMove, edgePath).join("-");
    //                         const origPath = extractOrigPath(gBase, gMove, edgePath);
    //                         this.detailedPaths.set(mv, origPath);
    //                         for (const empty of validEmpty) {
    //                             moves.add(`${mv}(${empty})`);
    //                         }
    //                     }
    //                 }
    //             }
    //         }
    //     }

    //     return [...moves].sort((a,b) => a.localeCompare(b));
    // }

    // assumes that any path it receives is valid so far
    public getContinuations(mv: string, p?: playerid): string[] {
        if (p === undefined) {
            p = this.currplayer;
        }
        const continuations = new Set<string>();
        const g = new GygesGraph(p);
        const cells = mv.split("-");
        const start = cells[0];
        const end = cells[cells.length - 1];

        // only calculate if you landed on an occupied cell (which can't be your start cell)
        if (mv.length === 2 || (this.board.has(end) && end !== start)) {
            const [gMove, ] = buildMoveGraph({gBase: g, start, seen: new Set<string>(), board: deepclone(this.board) as Map<string,Size>});
            // accumulate all valid edge paths so far
            const allEdges: string[][] = [];
            for (let i = 1; i < cells.length; i++) {
                const from = cells[i-1];
                const to = cells[i];
                allEdges.push([...gMove.edgeEntries()].filter(({source, target}) => source === from && target === to).map(({edge}) => edge));
            }
            const expanded = expandGroups(allEdges);
            const valid = expanded.filter(path => !pathReusesEdge(gMove, path));
            const outEdges = [...gMove.outEdgeEntries()].filter(({source}) => source === end);
            for (const edge of outEdges) {
                if (valid.length > 0) {
                    for (const sofar of valid) {
                        if (!pathReusesEdge(gMove, [...sofar, edge.edge])) {
                            continuations.add(edge.target);
                        }
                    }
                } else {
                    continuations.add(edge.target);
                }
            }
        }

        return [...continuations].sort((a,b) => a.localeCompare(b));
    }

    public isValidPath(mv: string, p?: playerid): boolean {
        if (p === undefined) {
            p = this.currplayer;
        }
        const g = new GygesGraph(p);
        const cells = mv.split("-");
        if (cells.length < 2) {
            return true;
        }
        const start = cells[0];
        const [gMove, ] = buildMoveGraph({gBase: g, start, seen: new Set<string>(), board: deepclone(this.board) as Map<string,Size>});
        // accumulate all valid edge paths so far
        const allEdges: string[][] = [];
        for (let i = 1; i < cells.length; i++) {
            const from = cells[i-1];
            const to = cells[i];
            const outEdges = [...gMove.edgeEntries()].filter(({source, target}) => source === from && target === to).map(({edge}) => edge);
            if (outEdges.length === 0) {
                return false;
            }
            allEdges.push(outEdges);
        }
        const expanded = expandGroups(allEdges);
        const valid = expanded.filter(path => !pathReusesEdge(gMove, path));
        return valid.length > 0;
    }

    public getDetailedPath(mv: string, p?: playerid): string[] {
        if (p === undefined) {
            p = this.currplayer;
        }
        const g = new GygesGraph(p);
        const cells = mv.split("-");
        const start = cells[0];
        const [gMove, gBase] = buildMoveGraph({gBase: g, start, seen: new Set<string>(), board: deepclone(this.board) as Map<string,Size>});
        // accumulate all valid edge paths so far
        const allEdges: string[][] = [];
        for (let i = 1; i < cells.length; i++) {
            const from = cells[i-1];
            const to = cells[i];
            allEdges.push([...gMove.edgeEntries()].filter(({source, target}) => source === from && target === to).map(({edge}) => edge));
        }
        const expanded = expandGroups(allEdges);
        const valid = expanded.filter(path => !pathReusesEdge(gMove, path));
        if (valid.length === 0) {
            return [];
        } else {
            const origPath = extractOrigPath(gBase, gMove, valid[0]);
            return origPath;
        }
    }

    public randomMove(): string {
        if (this.board.size < 12) {
            const inhand = shuffle(this.inHand()) as Size[];
            const cells = [];
            for (let x = 0; x < 6; x++) {
                const cell = GygesGame.coords2algebraic(x, this.currplayer === 1 ? 6 : 1);
                cells.push(cell);
            }
            const shuffled = shuffle(cells) as string[];
            const mvs: string[] = [];
            for (let i = 0; i < inhand.length; i++) {
                mvs.push(`${inhand[i]}${shuffled[i]}`);
            }
            return mvs.join(",");
        } else {
            const playable = this.getPlayableRow();
            const pcs = shuffle([...this.board.keys()].filter(c => c.endsWith(playable))) as string[];
            const start = pcs[0];
            const g = new GygesGraph(this.currplayer);
            const [gMove,] = buildMoveGraph({gBase: g, start, board: deepclone(this.board) as Map<string, Size>, seen: new Set<string>()});
            // check for winning move
            const goal = this.currplayer === 1 ? "d8" : "c1";
            if (gMove.hasNode(goal)) {
                const path = bidirectional(gMove, start, goal);
                if (path !== null) {
                    if (this.isValidPath(path.join("-"))) {
                        return path.join("-");
                    }
                }
            }
            for (const node of shuffle([...g.graph.nodes()]) as string[]) {
                if (gMove.hasNode(node)) {
                    // displacement
                    if (this.board.has(node) && node !== start) {
                        const path = bidirectional(gMove, start, node);
                        if (path !== null && path.length > 1) {
                            if (this.isValidPath(path.join("-"))) {
                                const empties = shuffle(this.getDisplacements()) as string[];
                                return path.join("-") + `(${empties[0]})`;
                            }
                        }
                    }
                    // movement
                    else {
                        const path = bidirectional(gMove, start, node);
                        if (path !== null && path.length > 1) {
                            if (this.isValidPath(path.join("-"))) {
                                return path.join("-");
                            }
                        }
                    }
                }
            }
        }
        throw new Error("Could not calculate a valid move. This should never happen.");
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove: string;
            let cell: string|undefined;
            if (row >= 0 && col >= 0) {
                cell = GygesGame.coords2algebraic(col, row);
            }

            if (move === "") {
                // placing a piece
                if (cell === undefined) {
                    if (piece === undefined) {
                        throw new Error("Piece was not defined.");
                    }
                    newmove = piece[1];
                }
                // selecting a piece on the board
                else {
                    newmove = cell;
                }
            } else {
                // in setup phase
                if (move.length === 1 || move.length === 3 || move.includes(",")) {
                    const cells = move.split(",");
                    const last = cells[cells.length - 1];
                    // placing the piece
                    if (last.length === 1) {
                        // selecting a different piece to place
                        if (cell === undefined) {
                            if (piece === undefined) {
                                throw new Error("Piece was not defined.");
                            }
                            newmove = [...cells.slice(0, -1), piece[1]].join(",");
                        }
                        // placing it on the board
                        else {
                            newmove = move + cell;
                        }
                    }
                    // last placement is complete
                    else {
                        // selecting a new piece
                        if (cell === undefined) {
                            if (piece === undefined) {
                                throw new Error("Piece was not defined.");
                            }
                            newmove = [...cells, piece[1]].join(",");
                        }
                        // just moving the last piece
                        else {
                            newmove = [...cells.slice(0, -1), `${last[0]}${cell}`].join(",");
                        }
                    }
                }
                // extending a move
                else {
                    if (cell === undefined) {
                        throw new Error("Clicked outside the board?");
                    }
                    // ending a displacement
                    if (move.includes("(")) {
                        const idx = move.indexOf("(");
                        newmove = move.substring(0, idx) + `(${cell})`;
                    } else {
                        const cells = move.split("-");
                        // trigger displacement
                        if (cells.length > 1 && cells[cells.length - 1] === cell) {
                            newmove = move + "()";
                        }
                        // extending the move
                        else {
                            newmove = [...cells, cell].join("-");
                            // if there are no continuations and the cell is occupied
                            // auto trigger displacement
                            if (this.board.has(cell) && cell !== move.substring(0, 2)) {
                                const continuations = this.getContinuations(newmove);
                                if (continuations.length === 0) {
                                    newmove += "()";
                                }
                            }
                        }
                    }
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
        const g = new GygesGraph(this.currplayer);

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.gyges.INITIAL_INSTRUCTIONS", {context: this.board.size < 12 ? "setup" : "play"})
            return result;
        }

        // setup phase
        if (this.board.size < 12) {
            const placements = m.split(",");
            const sizes = placements.map(p => parseInt(p[0], 10) as Size);
            // eslint-disable-next-line @typescript-eslint/no-shadow
            const cells = placements.map(p => p.substring(1));

            // only two of each size
            for (const size of [1,2,3] as Size[]) {
                if (sizes.filter(s => s === size).length > 2) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.gyges.NOT_INHAND", {size});
                    return result;
                }
            }
            // no duplicate cells
            const set = new Set<string>(cells);
            if (set.size !== cells.length) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.gyges.NO_DUPES");
                return result;
            }

            for (const cell of cells) {
                if (cell.length === 0) { continue; }
                if (!g.graph.nodes().includes(cell)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                    return result;
                }
                if (!cell.endsWith(this.currplayer === 1 ? "2" : "7")) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.gyges.HOMEROW");
                    return result;
                }
            }

            const last = placements[placements.length - 1];
            if (placements.length === 6 && last.length === 3) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            } else {
                if (last.length === 1) {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.gyges.PARTIAL", {context: "setup"});
                    return result;
                } else {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.gyges.PARTIAL", {context: "setup2"});
                    return result;
                }
            }
        }

        let stub = m;
        let displacement: string|undefined;
        if (m.includes("(")) {
            const idx = m.indexOf("(");
            stub = m.substring(0, idx);
            displacement = m.substring(idx+1, m.length - 1);
        }

        // is path so far wholly invalid
        if (!this.isValidPath(stub)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.gyges.INVALID_PATH", {move: stub});
            return result;
        }

        const cells = stub.split("-");
        const start = cells[0];
        const end = cells[cells.length - 1];
        // must be occupied
        if (!this.board.has(start)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: start});
            return result;
        }
        // moving piece must be closest to player
        const firstRow = this.getPlayableRow();
        if (!start.endsWith(firstRow)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.gyges.NO_MOVES", {cell: start});
            return result;
        }
        // if ending on an occupied cell, must displace or keep moving
        if (this.board.has(end) && end !== start) {
            // no displacement signalled, then rebound
            if (displacement === undefined) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.gyges.PARTIAL", {context: "move"});
                return result;
            } else {
                const empties = [...this.getDisplacements(), start];
                if (displacement === "") {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.gyges.PARTIAL", {context: "displace"});
                    return result;
                }
                if (!empties.includes(displacement)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.gyges.BAD_DISPLACE", {cell: displacement});
                    return result;
                }
                // we're good
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
        } else {
            if (cells.length === 1) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation._general.NEED_DESTINATION");
                return result;
            }
            // we're good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
    }

    public move(m: string, {trusted = false, partial = false} = {}): GygesGame {
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
            // if (!partial && !allMoves.includes(m)) {
            //     throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            // }
        }

        this.results = [];
        this.highlights = [];
        this.dots = [];

        if (partial) {
            // setup in progress
            if (m.includes(",") || m.length === 1 || m.length === 3) {
                const placements = m.split(",").filter(c => c.length === 3);
                for (const p of placements) {
                    const size = parseInt(p[0], 10) as Size;
                    const cell = p.substring(1);
                    this.board.set(cell, size);
                }
            }
            // show displacements
            else if (m.includes("(")) {
                const start = m.substring(0, 2);
                this.dots = [...this.getDisplacements(), start];
            }
            // show movement highlights
            else {
                // add movement arrows for clarity
                const cells = m.split("-");
                const detailedPath = this.getDetailedPath(m);
                this.results.push({type: "move", from: cells[0], to: cells[cells.length - 1], how: detailedPath?.join(",")});
                this.highlights = this.getContinuations(m);
            }
            return this;
        }

        // setup
        if (m.includes(",") || m.length < 5) {
            const placements = m.split(",");
            for (const p of placements) {
                const size = parseInt(p[0], 10) as Size;
                const cell = p.substring(1);
                this.board.set(cell, size);
                this.results.push({type: "place", what: size.toString(), where: cell});
            }
        }
        // regular play
        else {
            let stub = m;
            let displaceTo: string|undefined;
            if (m.includes("(")) {
                const idx = m.indexOf("(");
                stub = m.substring(0, idx);
                displaceTo = m.substring(idx+1, idx+3);
            }
            const detailedPath = this.getDetailedPath(stub);
            const cells = stub.split("-");
            const from = cells[0];
            const to = cells[cells.length - 1];
            const size = this.board.get(from)!;
            const sizeTo = this.board.get(to);
            this.board.set(to, size);
            this.board.delete(from);
            for (let i = 1; i < cells.length; i++) {
                this.results.push({type: "move", from: cells[i-1], to: cells[i], how: detailedPath?.join(",")});
            }
            if (displaceTo !== undefined) {
                if (sizeTo === undefined) {
                    throw new Error(`Displacing a nonexistent piece at ${to}`);
                }
                this.board.set(displaceTo, sizeTo);
                this.results.push({type: "eject", from: to, to: displaceTo});
            }
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

    protected checkEOG(): GygesGame {
        if (this.board.has("c1")) {
            this.gameover = true;
            this.winner = [2];
        } else if (this.board.has("d8")) {
            this.gameover = true;
            this.winner = [1];
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IGygesState {
        return {
            game: GygesGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: GygesGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < 8; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < 6; col++) {
                const cell = GygesGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    pieces.push(`p${contents}`);
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join(",");
        }
        // pstr = pstr.replace(/-{4}/g, "_");

        const areas: AreaPieces[] = [];
        if (this.board.size < 12) {
            for (let p = 1; p <= this.numplayers; p++) {
                const inhand = this.inHand(p as playerid);
                if (inhand.length > 0) {
                    areas.push({
                        type: "pieces",
                        pieces: inhand.map(n => `p${n}`) as [string, ...string[]],
                        label: `Player ${p}'s stash`
                    });
                }
            }
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares",
                width: 6,
                height: 8,
                blocked: [
                    {row: 0, col: 0},
                    {row: 0, col: 1},
                    {row: 0, col: 2},
                    {row: 0, col: 4},
                    {row: 0, col: 5},
                    {row: 7, col: 0},
                    {row: 7, col: 1},
                    {row: 7, col: 3},
                    {row: 7, col: 4},
                    {row: 7, col: 5}
                ],
                markers: [
                    {
                        type: "flood",
                        points: [
                            {row: 0, col: 3}
                        ],
                        colour: 2,
                    },
                    {
                        type: "flood",
                        points: [
                            {row: 7, col: 2}
                        ],
                        colour: 1,
                    },
                ],
            },
            legend: {
                p1: {
                    name: "piece",
                    colour: 9,
                },
                p2: [
                    {
                        name: "piece",
                        colour: 9,
                    },
                    {
                        name: "ring-23",
                        colour: 9,
                    },
                ],
                p3: [
                    {
                        name: "piece",
                        colour: 9,
                    },
                    {
                        name: "ring-23",
                        colour: 9,
                    },
                    {
                        name: "ring-01",
                        colour: 9,
                    }
                ]
            },
            pieces: pstr,
            areas: areas.length > 0 ? areas : undefined,
        };

        // Add annotations
        if (this.results.length > 0) {
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "move") {
                    const path = move.how!.split(",");
                    for (let i = 1; i < path.length; i++) {
                        const [fromX, fromY] = GygesGame.algebraic2coords(path[i-1]);
                        const [toX, toY] = GygesGame.algebraic2coords(path[i]);
                        rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                    }
                } else if (move.type === "eject") {
                    const [fromX, fromY] = GygesGame.algebraic2coords(move.from);
                    const [toX, toY] = GygesGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "eject", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "place") {
                    const [x, y] = GygesGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }

        // add highlighting
        if (this.highlights.length > 0) {
            if (!("annotations" in rep)) {
                rep.annotations = [];
            }
            for (const cell of this.highlights) {
                const [x, y] = GygesGame.algebraic2coords(cell);
                rep.annotations!.push({type: "enter", targets: [{row: y, col: x}], colour: 1});
            }
        }

        if (this.dots.length > 0) {
            if (!("annotations" in rep)) {
                rep.annotations = [];
            }
            const targets: RowCol[] = [];
            for (const cell of this.dots) {
                const [x, y] = GygesGame.algebraic2coords(cell);
                targets.push({row: y, col: x});
            }
            rep.annotations!.push({type: "dots", targets: targets as [RowCol, ...RowCol[]]});
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
                node.push(i18next.t("apresults:PLACE.complete", {player, where: r.where, what: r.what}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): GygesGame {
        return Object.assign(new GygesGame(), deepclone(this) as GygesGame);
    }
}
