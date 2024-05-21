/* eslint-disable @typescript-eslint/no-unsafe-call */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { Board } from "./calculus/board";
import { Piece } from "./calculus/piece";
import { Cycle } from "./calculus/cycle";
import { Navmesh, calcBearing, projectPoint, ptDistance, reviver } from "../common";
import { fundamentalGraphCycles } from "../common/graphs";
import { polygon as turfPoly } from "@turf/helpers";
import turfContains from "@turf/boolean-contains";
import turfIntersects from "@turf/boolean-intersects";
import { UserFacingError } from "../common";
import { Combination } from "js-combinatorics";
import { UndirectedGraph } from "graphology";
import { bidirectional } from "graphology-shortest-path/unweighted";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-var-requires
const deepclone = require("rfdc/default");

type Vertex = [number,number];
export type playerid = 1|2;

interface ILooseObj {
    [key: string]: any;
}

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    pieces: Piece[];
    lastmove?: string;
    connPath: Vertex[];
}

export interface ICalculusState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

const id2vert = (id: string): Vertex => {
    if (id.includes("|")) {
        const verts = id.split("|").map(v => v.split(",").map(str => parseFloat(str)) as Vertex);
        const xs = verts.map(([x,]) => x);
        const ys = verts.map(([,y]) => y);
        return [xs.reduce((prev, curr) => prev + curr, 0) / xs.length, ys.reduce((prev, curr) => prev + curr, 0) / ys.length];
    } else {
        const [left, right] = id.split(",");
        const nLeft = parseFloat(left);
        const nRight = parseFloat(right);
        if (isNaN(nLeft) || isNaN(nRight)) {
            throw new Error(`Error interpreting id ${id}`);
        }
        return [nLeft, nRight] as Vertex;
    }
}

export class CalculusGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Calculus",
        uid: "calculus",
        playercounts: [2],
        version: "20240518",
        dateAdded: "2024-05-18",
        // i18next.t("apgames:descriptions.calculus")
        description: "apgames:descriptions.calculus",
        // i18next.t("apgames:notes.calculus")
        notes: "apgames:notes.calculus",
        urls: [
            "https://boardgamegeek.com/boardgame/30914/calculus",
        ],
        people: [
            {
                type: "designer",
                name: "Gord! (Gordon Hamilton)"
            }
        ],
        flags: ["experimental", "no-moves"],
        categories: ["goal>connect", "mechanic>place", "mechanic>move", "board>none", "components>simple>1per"],
        variants: [
            {
                uid: "width-10",
                group: "board",
            },
            {
                uid: "width-15",
                group: "board"
            },
        ]
    };

    public static clone(obj: CalculusGame): CalculusGame {
        const cloned: CalculusGame = Object.assign(new CalculusGame(), deepclone(obj) as CalculusGame);
        cloned.load();
        return cloned;
    }

    public static readonly PIECE_RADIUS = 10;
    public static readonly SNAP_RADIUS = (this.PIECE_RADIUS * 2) + 2;
    public static readonly EDGE_SNAP_RADIUS = this.PIECE_RADIUS + 2;
    public static readonly DETECT_RADIUS = (this.PIECE_RADIUS * 2) + 4;
    public static readonly EDGE_DETECT_RADIUS = this.PIECE_RADIUS + 3;

    public numplayers = 2;
    public currplayer!: playerid;
    public pieces: Piece[] = [];
    public boardsize = 12;
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private board!: Board;              // defined in load()
    private graph!: UndirectedGraph;    // defined in load()
    private cycles!: Cycle[];           // defined in load();
    public connPath: Vertex[] = [];
    private ghosts: Piece[] = [];

    constructor(state?: ICalculusState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
                for (const v of variants) {
                    if (v.startsWith("width-")) {
                        const [,numStr] = v.split("-");
                        const num = parseInt(numStr, 10);
                        if (isNaN(num)) {
                            throw new Error(`Could not interpret a board width from "${v}"`);
                        }
                        this.boardsize = num;
                        break;
                    }
                }
            }

            const fresh: IMoveState = {
                _version: CalculusGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                pieces: [],
                connPath: [],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ICalculusState;
            }
            if (state.game !== CalculusGame.gameinfo.uid) {
                throw new Error(`The Calculus game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.variants = [...state.variants];
            this.winner = [...state.winner];
            this.stack = [...state.stack];

            // Now recursively "Objectify" the pieces
            this.stack.map((s) => {
                s.pieces = s.pieces.map(pc => Piece.deserialize(pc));
            });
        }
        this.load();
    }

    public load(idx = -1): CalculusGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.pieces = state.pieces.map(pc => Piece.deserialize(pc));
        this.lastmove = state.lastmove;
        this.results = [...state._results];
        this.connPath = [...state.connPath.map(v => [...v] as Vertex)];
        this.boardsize = 12;
        for (const v of this.variants) {
            if (v.startsWith("width-")) {
                const [,numStr] = v.split("-");
                const num = parseInt(numStr, 10);
                if (isNaN(num)) {
                    throw new Error(`Could not interpret a board width from "${v}"`);
                }
                this.boardsize = num;
                break;
            }
        }

        this.board = new Board(this.boardsize * (CalculusGame.PIECE_RADIUS * 1.1));
        this.graph = this.getGraph();
        this.cycles = this.getCycles(this.graph);

        return this;
    }

    public getGraph(): UndirectedGraph {
        const g = new UndirectedGraph();

        // add all edge vertices
        for (const vert of this.board.verts) {
            g.addNode(vert.join(","));
        }
        // connect them to each other
        const verts = [...this.board.verts, this.board.verts[0]];
        for (let i = 0; i < this.board.verts.length; i++) {
            const left = verts[i].join(",");
            const right = verts[i+1].join(",");
            g.addEdge(left, right);
        }

        // add all pieces
        for (const pc of this.pieces) {
            g.addNode(pc.id);
        }

        // look for pieces touching each other
        const combos = new Combination(this.pieces, 2);
        for (const [left, right] of combos) {
            if (ptDistance(...left.centre, ...right.centre) <= CalculusGame.DETECT_RADIUS) {
                g.addEdge(left.id, right.id);
            }
        }

        // Now look for pieces touching the edge
        // Pieces should only connect to a single edge vertex---the closest one
        for (const pc of this.pieces) {
            const {distance, closest} = this.board.closestTo(pc.centre);
            if (distance <= CalculusGame.EDGE_DETECT_RADIUS) {
                g.addEdge(pc.id, closest.join(","));
            }
        }

        return g;
    }

    public getCycles(g: UndirectedGraph): Cycle[] {
        // const t0 = Date.now();
        const allCycles = fundamentalGraphCycles(g);
        // const t1 = Date.now();
        // console.log(`Raw list of cycles generated in ${t1-t0} ms`);

        let goodCycles: string[][] = [];
        // only keep cycles that contain <=2 transition points
        const pts = this.board.transitionVerts.map(pt => pt.join(","));
        for (const cycle of allCycles) {
            let count = 0;
            for (const pt of pts) {
                if (cycle.includes(pt)) {
                    count++;
                }
            }
            if (count <= 2) {
                goodCycles.push(cycle)
            }
        }

        // strip out any cycles that wholly include other cycles
        const containers = new Set<string>();
        goodCycles.sort((a,b) => b.length - a.length);
        const polys = goodCycles.map(c => [...c, c[0]].map(n => n.split(",").map(num => parseFloat(num)) as Vertex)).map(v => turfPoly([v]));
        for (let i = 0; i < goodCycles.length; i++) {
            const comp = polys[i];
            const test = polys.slice(i+1);
            for (const t of test) {
                if (turfIntersects(comp, t) && turfContains(comp, t)) {
                    containers.add(goodCycles[i].join("|"));
                    break;
                }
            }
        }
        goodCycles = goodCycles.filter(c => ! containers.has(c.join("|")));

        // determine owner
        // throw error if invalid cycle is found
        const realCycles: Cycle[] = [];
        for (const cycle of goodCycles) {
            const pcs = cycle.map(node => this.pieces.find(pc => pc.id === node)).filter(pc => pc !== undefined) as Piece[];
            const p1 = pcs.filter(pc => pc.owner === 1).length;
            const p2 = pcs.filter(pc => pc.owner === 2).length;
            if (p1 === p2) {
                throw new Error(`Invalid cycle found containing equal numbers of player pieces: ${JSON.stringify(pcs)}`);
            }
            const owner = (p1 > p2 ? 1 : 2) as playerid;
            realCycles.push(new Cycle(cycle.map(node => id2vert(node)), owner));
        }

        return realCycles;
    }

    // Takes a given point and returns a new snap point if the piece overlaps.
    // Returns null if a snap point cannot be determined.
    private snapPoint(x: number, y: number): Vertex|null {
        const overlaps: {type: "edge"|"piece", vert: Vertex}[] = [];
        const {distance, closest} = this.board.closestTo([x,y]);
        if (distance <= CalculusGame.EDGE_DETECT_RADIUS) {
            overlaps.push({type: "edge", vert: closest});
        }
        for (const pc of this.pieces) {
            if (pc.distanceFrom([x,y]) <= CalculusGame.DETECT_RADIUS) {
                overlaps.push({type: "piece", vert: pc.centre});
            }
        }

        const truncate = (v: Vertex): Vertex => {
            return v.map(n => Math.round(n * 1000) / 1000) as Vertex;
        }

        if (overlaps.length === 0) {
            return truncate([x,y]);
        } else if (overlaps.length === 1) {
            const overlap = overlaps[0];
            const bearing = calcBearing(...overlap.vert, x, y);
            let pt: Vertex;
            if (overlap.type === "piece") {
                pt = truncate(projectPoint(...overlap.vert, CalculusGame.SNAP_RADIUS, bearing));
            } else {
                pt = truncate(projectPoint(...overlap.vert, CalculusGame.EDGE_SNAP_RADIUS, bearing));
            }
            return pt;
        } else {
            /**
             * BRUTE FORCE METHOD
             * - Pick any overlapped vertex.
             * - For every degree at whatever precision, calculate a point 2r away from the overlapped centre.
             * - Check to see if that point is within 2r+buffer of all the other vertices.
             * - If so, store it.
             * - If when done you have at least one value stored, return the one closest to the clicked point.
             */
            const last = overlaps.pop()!;
            const stored: Vertex[] = [];
            for (let deg = 0; deg < 360; deg++) {
                let pt: Vertex;
                if (last.type === "piece") {
                    pt = projectPoint(...last.vert, CalculusGame.SNAP_RADIUS, deg);
                } else {
                    pt = projectPoint(...last.vert, CalculusGame.EDGE_SNAP_RADIUS, deg);
                }
                let matchesAll = true;
                for (const v of overlaps) {
                    const dist = ptDistance(...pt, ...v.vert);
                    if ( (v.type === "piece") && (dist > CalculusGame.DETECT_RADIUS) ) {
                        matchesAll = false;
                        break;
                    } else if ( (v.type === "edge") && (dist > CalculusGame.EDGE_DETECT_RADIUS) ) {
                        matchesAll = false;
                        break;
                    }
                }
                if (matchesAll) {
                    stored.push(pt);
                }
            }
            if (stored.length === 0) {
                return null;
            } else if (stored.length === 1) {
                return truncate(stored[0]);
            } else {
                let [smallestDist, closestPt] = [Infinity, null as null|Vertex];
                for (const v of stored) {
                    const dist = ptDistance(...v, x, y);
                    if (dist < smallestDist) {
                        smallestDist = dist;
                        closestPt = v;
                    }
                }
                return truncate(closestPt!);
            }
        }
    }

    public handleClick(move: string, row: number, col: number, piece: string): IClickResult {
        try {
            let newmove: string;
            // click on the open area of the board
            if (piece === "_field") {
                const newPt = this.snapPoint(col, row);
                if (newPt === null) {
                    return {
                        move,
                        valid: false,
                        message: i18next.t("apgames:validation.calculus.INVALID_POINT"),
                    };
                }
                // partial move present
                if (move.length > 0) {
                    // if move already has a destination, update it
                    if (move.includes(";")) {
                        newmove = move.substring(0, move.indexOf(";")) + `;${newPt.join(",")}`;
                    }
                    // fresh
                    else {
                        newmove = move + `;${newPt.join(",")}`
                    }
                }
                // fresh move
                else {
                    newmove = `${newPt.join(",")}`
                }
            }
            // otherwise, clicked on a piece
            else {
                // anytime you click on an existing piece,
                // try to move it, throwing away existing partials
                newmove = piece;
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
        m = m.replace(/^\s+/g, "");
        m = m.replace(/\s+$/g, "");

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.calculus.INITIAL_INSTRUCTIONS");
            return result;
        }

        // pass is always valid
        if (m === "pass") {
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        let from: string|undefined;
        let to: string|undefined;
        const [left, right] = m.split(";");
        if (this.pieces.find(pc => pc.id === left) !== undefined) {
            from = left;
            to = right;
        } else {
            to = left;
        }

        // if moving an existing piece
        if (from !== undefined) {
            // must not be part of a perimeter
            for (const cycle of this.cycles) {
                if (cycle.perimeterIds.includes(from)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.calculus.BAD_MOVE");
                    return result;
                }
            }

            // must exist
            const piece = this.pieces.find(pc => pc.id === from);
            if (piece === undefined) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: from});
                return result;
            }
            // must be yours
            if (piece.owner !== this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.UNCONTROLLED", {where: from});
                return result;
            }
        }

        if (to === undefined) {
            result.valid = true;
            result.canrender = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.calculus.VALID_PARTIAL");
            return result;
        } else {
            // can navigate to the given position
            let actualPieces = [...this.pieces];
            if (from !== undefined) {
                actualPieces = actualPieces.filter(pc => pc.id !== from);
            }
            const mesh = new Navmesh({container: this.board.verts, obstacles: actualPieces.map(pc => pc.verts), minEdgeLength: CalculusGame.PIECE_RADIUS});
            let canNav = false;
            if (from !== undefined) {
                const path = mesh.findPath(id2vert(from), id2vert(to));
                if (path !== null) {
                    canNav = true;
                }
            } else {
                for (const v of this.board.verts) {
                    const path = mesh.findPath(v, id2vert(to));
                    if (path !== null) {
                        canNav = true;
                        break;
                    }
                }
            }
            if (! canNav) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.calculus.NO_PATH", {from, to});
                return result;
            }

            const newVert = id2vert(to);
            const newPiece = new Piece({cx: newVert[0], cy: newVert[1], owner: this.currplayer});
            // resulting piece is within the board
            if (! this.board.contains(newPiece.circularForm)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.calculus.NOT_CONTAINED");
                return result;
            }
            // no collision with other pieces
            for (const pc of this.pieces) {
                if (pc.id === from) {
                    continue;
                }
                if (pc.overlaps([newPiece.circularForm])) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.calculus.COLLIDES", {with: pc.id});
                    return result;
                }
            }

            // Check if new piece would create an illegal cycle
            const cloned = CalculusGame.clone(this);
            if (from !== undefined) {
                cloned.pieces.filter(pc => pc.id !== from);
            }
            cloned.pieces.push(newPiece);
            cloned.graph = cloned.getGraph();
            try {
                cloned.getCycles(cloned.graph);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation.calculus.BAD_PERIMETER");
                return result;
            }
        }

        // valid move
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    /**
     * The `partial` flag leaves the object in an invalid state. It should only be used on a disposable object,
     * or you should call `load()` before finalizing the move.
     *
     * @param m The move string itself
     * @param partial A signal that you're just exploring the move; don't do end-of-move processing
     * @returns [CalculusGame]
     */
    public move(m: string, {partial = false, trusted = false} = {}): CalculusGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        // validate if not partial
        if ( (! partial) && (! trusted) ) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
        }

        // strip leading and trailing spaces
        m = m.toLowerCase();
        m = m.replace(/^\s+/, "");
        m = m.replace(/\s+$/, "");

        this.results = [];
        if (m === "pass") {
            this.results.push({type: "pass"});
        } else {
            let from: string|undefined;
            let to: string|undefined;
            const [left, right] = m.split(";");
            if (this.pieces.find(pc => pc.id === left) !== undefined) {
                from = left;
                to = right;
            } else {
                to = left;
            }

            if (from !== undefined) {
                this.ghosts = this.pieces.filter(pc => pc.id === from);
                this.pieces = this.pieces.filter(pc => pc.id !== from);
            }
            if (to !== undefined) {
                const vert = id2vert(to);
                this.pieces.push(new Piece({cx: vert[0], cy: vert[1], owner: this.currplayer}));
                if (from !== undefined) {
                    this.results.push({type: "move", from, to});
                } else {
                    this.results.push({type: "place", where: to});
                }
                this.ghosts = [];
                // update graph and cycles
                this.graph = this.getGraph();
                this.cycles = this.getCycles(this.graph);
            }
        }

        if (partial) { return this; }

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

    private isConnected(p?: playerid): Vertex[]|null {
        if (p === undefined) {
            p = this.currplayer;
        }

        // start with the piece graph
        const g = this.graph.copy()
        // add the cycles as nodes that connect to each perimeter cell
        for (const cycle of this.cycles) {
            const cycleNode = g.addNode(cycle.id);
            for (const pNode of cycle.perimeterIds) {
                g.addEdge(cycleNode, pNode);
            }
        }
        // Gather ids of all owned edges, pieces, and nodes
        const owned: string[] = [];
        owned.push(...this.board.ownedVerts(p).map(v => v.join(",")));
        owned.push(...this.pieces.filter(pc => pc.owner === p).map(pc => pc.id));
        owned.push(...this.cycles.filter(c => c.owner === p).map(c => c.id));
        // Drop all the nodes that don't match
        for (const node of g.nodes()) {
            if (! owned.includes(node)) {
                g.dropNode(node);
            }
        }
        // Test connection between each owned edge in one quadrant with
        // each owned edge in the other.
        const paths: Vertex[][] = []
        const [quad1, quad2] = this.board.ownedQuadrants(p);
        for (const left of quad1) {
            for (const right of quad2) {
                const result = bidirectional(g, left.join(","), right.join(","));
                if (result !== null) {
                    paths.push(result.map(n => id2vert(n)));
                }
            }
        }

        if (paths.length === 0) {
            return null;
        }
        paths.sort((a,b) => a.length - b.length);
        return paths[0];
    }

    protected checkEOG(): CalculusGame {
        // If two passes in a row, we need to end
        let passedout = false;
        if ( (this.lastmove === "pass") && (this.stack[this.stack.length - 1].lastmove === "pass") ) {
            passedout = true;
        }

        if (passedout) {
            this.gameover = true;
            const conn1 = this.isConnected(1);
            const conn2 = this.isConnected(2);
            if (conn1 !== null) {
                this.winner = [1];
                this.connPath = conn1;
            } else if (conn2 !== null) {
                this.winner = [2];
                this.connPath = conn2;
            } else {
                this.winner = [1,2];
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

    public state(): ICalculusState {
        return {
            game: CalculusGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: CalculusGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            pieces: [...this.pieces],
            connPath: [...this.connPath],
        };
    }

    public render(): APRenderRep {
        const pieces: ILooseObj[] = [];
        for (const pc of this.pieces) {
            pieces.push({
                glyph: pc.owner === 1 ? "A" : "B",
                id: pc.id,
                x: pc.cx,
                y: pc.cy,
            });
        }
        for (const pc of this.ghosts) {
            pieces.push({
                glyph: pc.owner === 1 ? "C" : "D",
                id: pc.id,
                x: pc.cx,
                y: pc.cy,
            });
        }

        const markers: ILooseObj[] = [];
        // Draw the board first
        for (const p of [1,2] as playerid[]) {
            const quads = this.board.ownedQuadrants(p);
            for (const q of quads) {
                const path = `M${q[0].join(",")}L${q.slice(0).map(v => v.join(",")).join("L")}`
                markers.push({
                    type: "path",
                    path,
                    stroke: p,
                    fillOpacity: 0,
                });
            }
        }

        // fill in enclosures
        for (const cycle of this.cycles) {
            markers.push({
                type: "path",
                path: cycle.path,
                stroke: "#000",
                strokeOpacity: 0,
                fill: cycle.owner,
                fillOpacity: 0.5,
            });
        }

        const annotations: ILooseObj[] = [];
        for (const r of this.results) {
            if (r.type === "place") {
                const [cx, cy] = id2vert(r.where!);
                annotations.push({
                    type: "path",
                    path: `M${cx},${cy}m2,0a2,2 0 1,1 -4,0a2,2 0 1,1 4,0Z`,
                    fill: "#000",
                    stroke: "#000",
                });
            } else if (r.type === "move") {
                annotations.push({
                    type: "path",
                    path: `M${r.from}L${r.to}`,
                    fillOpacity: 0,
                    stroke: "#000",
                });
            }
        }

        const pcIds = this.pieces.map(p => p.id);
        // show perimeter connections first
        const pEdges = new Set<string>();
        for (const cycle of this.cycles) {
            const ids = cycle.perimeterIds;
            for (let i = 0; i < ids.length; i++) {
                const left = ids[i];
                let right: string;
                if (i === ids.length - 1) {
                    right = ids[0];
                } else {
                    right = ids[i+1];
                }
                if ( (! pcIds.includes(left)) && (! pcIds.includes(right)) ) {
                    continue;
                }
                pEdges.add([left, right].join("|"));
            }
        }
        for (const edge of pEdges) {
            const [left, right] = edge.split("|");
            annotations.push({
                type: "path",
                path: `M${left}L${right}`,
                stroke: "#000",
                strokeWidth: 1,
                fillOpacity: 0,
            });
        }

        // then show simple touching
        // get list nodes that are pieces
        const nodes = this.graph.nodes().filter(n => pcIds.includes(n));
        // get list of unique edges that connect these nodes to things
        const edges = new Set<string>();
        for (const n of nodes) {
            for (const edge of this.graph.edges(n)) {
                edges.add(edge);
            }
        }
        // for each unique edge, draw a line between the nodes
        for (const edge of edges) {
            const [left, right] = this.graph.extremities(edge);
            if (pEdges.has([left, right].join("|")) || pEdges.has([right,left].join("|"))) {
                continue;
            }
            annotations.push({
                type: "path",
                path: `M${left}L${right}`,
                stroke: "#000",
                dashed: [4],
                strokeWidth: 0.25,
                fillOpacity: 0,
            });
        }

        // draw the connecting path, if present
        if (this.gameover && this.connPath.length > 0) {
            const first = this.connPath[0];
            const rest = this.connPath.slice(1);
            annotations.push({
                type: "path",
                path: `M${first.join(",")}L${rest.map(v => v.join(",")).join("L")}`,
                stroke: "#000",
                strokeWidth: 2,
                fillOpacity: 0,
            });
        }

        // Build rep
        const rep: APRenderRep =  {
            // @ts-ignore
            renderer: "freespace",
            // @ts-ignore
            board: {
                width: this.board.width,
                height: this.board.height,
                backFill: "#eee",
            },
            legend: {
                "A": {
                    name: "piece",
                    player: 1,
                    scale: 0.45,
                },
                "B": {
                    name: "piece",
                    player: 2,
                    scale: 0.45,
                },
                "C": {
                    name: "piece",
                    player: 1,
                    scale: 0.45,
                    opacity: 0.5,
                },
                "D": {
                    name: "piece",
                    player: 2,
                    scale: 0.45,
                    opacity: 0.5,
                }
            },
            // @ts-ignore
            pieces,
        };
        if (annotations.length > 0) {
            // @ts-ignore
            rep.annotations = annotations;
        }
        if (markers.length > 0) {
            // @ts-ignore
            rep.board.markers = markers;
        }

        return rep;
    }

    public clone(): CalculusGame {
        // Have to use Object.assign to track internal variables (like showArcs) that are not part of the persistent state
        // return Object.assign(new CalculusGame(this.numplayers), deepclone(this) as CalculusGame);
        return new CalculusGame(this.serialize());
    }
}
