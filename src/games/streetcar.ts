/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Direction, Grid, rectangle, defineHex, Orientation, Hex } from "honeycomb-grid";
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult, IScores } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError, shuffle, oppositeDirections } from "../common";
import { CompassDirection, IEdge, IVertex, edge2hexes, edge2verts, hex2edges, vert2hexes } from "../common/hexes";
import { UndirectedGraph } from "graphology";
import {connectedComponents} from 'graphology-components';
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

type playerid = 1|2;
type Colour = 1|2|3|4;

interface IHouse {
    colour: Colour;
    removable: boolean;
}
interface IBuilding {
    colour: Colour;
    size: 1|2|3;
}
type CellContents = IHouse|IBuilding;

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    lastmove?: string;
    taken: [Colour[], Colour[]];
    claimed: [IEdge[], IEdge[]];
}

export interface IStreetcarState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
    startpos: string;
};

const reMovePartial = /^\[(.*?)\](.*?)$/;
const reEdge = /^([a-h]\d)(.+?)$/i;
const columnLabels = "abcdefghijklmnopqrstuvwxyz".split("");

// eslint-disable-next-line @typescript-eslint/naming-convention
const myHex = defineHex({
    offset: 1,
    orientation: Orientation.POINTY
});
const hexGrid = new Grid(myHex, rectangle({width: 8, height: 8}));
const allHexDirs = [Direction.NE, Direction.E, Direction.SE, Direction.SW, Direction.W, Direction.NW];

const edge2celldir = (edge: IEdge): [string,string] => {
    if (edge === undefined) {
        throw new Error("Can't process an undefined edge.");
    }
    let hex = hexGrid.getHex({q: edge.q, r: edge.r});
    let realdir = edge.dir;
    if (hex === undefined) {
        // adjust for out of grid
        hex = nudgeEdge(edge);
        realdir = oppositeDirections.get(edge.dir)!
        if (hex === undefined) {
            throw new Error(`Could not find a hex that corresponds to the given edge: ${edge.uid}`);
        }
    }
    const {col, row} = hex;
    const cell = StreetcarGame.coords2algebraic(col, row);
    return [cell, realdir];
}

const nudgeEdge = (edge: IEdge): Hex|undefined => {
    const hexes = edge2hexes(edge).map(c => hexGrid.getHex([c.q, c.r])).filter(h => h !== undefined);
    if (hexes.length === 1) {
        return hexes[0];
    }
    return undefined;
}

const edge2string = (edge: IEdge): string => {
    if (edge === undefined) {
        throw new Error("Can't process an undefined edge.");
    }
    const [cell, dir] = edge2celldir(edge);
    return `${cell}${dir}`;
}

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

export class StreetcarGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Streetcar Suburb",
        uid: "streetcar",
        playercounts: [2],
        version: "20230629",
        // i18next.t("apgames:descriptions.streetcar")
        description: "apgames:descriptions.streetcar",
        urls: ["https://streetcar.drew-edwards.com/rules"],
        people: [
            {
                type: "designer",
                name: "Drew Edwards",
                urls: ["https://games.drew-edwards.com/"]
            }
        ],
        variants: [
            {uid: "5point", "group": "penalty"},
            {uid: "15point", "group": "penalty"},
        ],
        flags: ["multistep", "no-moves", "scores"]
    };

    public static coords2algebraic(x: number, y: number): string {
        return columnLabels[8 - y - 1] + (x + 1).toString();
    }

    public static algebraic2coords(cell: string): [number, number] {
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
        return [x - 1, 8 - y - 1];
    }

    public static genBuilding(colours: Colour[]): IBuilding {
        const counts = new Map<Colour,number>();
        for (const c of colours) {
            if (counts.has(c)) {
                const num = counts.get(c)!;
                counts.set(c, num + 1);
            } else {
                counts.set(c, 1);
            }
        }
        const numEntries = [...counts.entries()].length;
        if (numEntries === 1) {
            return {
                size: 3,
                colour: [...counts.keys()][0],
            };
        } else if (numEntries === 2) {
            return {
                size: 2,
                colour: [...counts.entries()].filter(([,cnt]) => cnt === 2).map(([clr,]) => clr)[0],
            };
        } else {
            return {
                size: 1,
                colour: ([1,2,3,4] as Colour[]).filter(n => ! counts.has(n))[0],
            }
        }
    }

    public static blockedCells: string[] = ["b8","c1","c8","d1","d7","d8","e1","e2","e8","f1","f8","g1"];

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, CellContents>;
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    public startpos!: string;
    public taken: [Colour[],Colour[]] = [[],[]];
    public claimed: [IEdge[],IEdge[]] = [[],[]];

    constructor(state?: IStreetcarState | string, variants?: string[]) {
        super();
        if (state !== undefined) {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IStreetcarState;
            }
            if (state.game !== StreetcarGame.gameinfo.uid) {
                throw new Error(`The Streetcar game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.variants = [...state.variants];
            this.winner = [...state.winner];
            this.stack = [...state.stack];
        } else {
            const bag = shuffle("1111111111111222222222222233333333333334444444444444".split("").map(n => parseInt(n, 10) as Colour)) as Colour[];
            this.startpos = bag.join("");
            const board = new Map<string,CellContents>();
            for (let y = 0; y < 8; y++) {
                for (let x = 0; x < 8; x++) {
                    const cell = StreetcarGame.coords2algebraic(x, y);
                    if (StreetcarGame.blockedCells.includes(cell)) {
                        continue;
                    }
                    const colour = bag.pop()!;
                    board.set(cell, {colour, removable: true});
                }
            }
            if (bag.length !== 0) {
                throw new Error("There are still pieces in the bag! This should never happen!");
            }
            const fresh: IMoveState = {
                _version: StreetcarGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                taken: [[],[]],
                claimed: [[],[]],
            };
            this.stack = [fresh];
            if ( (variants !== undefined) && (variants.length > 0) ) {
                this.variants = [...variants];
            }
        }
        this.load();
    }

    public load(idx = -1): StreetcarGame {
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
        this.taken = [[...state.taken[0]], [...state.taken[1]]];
        this.claimed = deepclone(state.claimed) as [IEdge[],IEdge[]];
       return this;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        move = move.toLowerCase();
        move = move.replace(/\s+/g, "");
        const edgePieces = ["NE","E","SE","SW","W","NW"];
        try {
            const cell = StreetcarGame.coords2algebraic(col, row);
            let newmove = "";

            // parse out parts of moves
            let edges: string[] = [];
            let house = "";
            if ( (move.length > 0) && (reMovePartial.test(move)) ) {
                const [,edgeList, houseCell] = move.match(reMovePartial)!;
                edges = edgeList.split(",");
                house = houseCell || "";
            }
            if ( (edges.length === 1) && (edges[0] === "") ) {
                edges = [];
            }

            // if clicking a hex, change the "remove house" portion
            if ( (piece === undefined) || (! edgePieces.includes(piece)) ) {
                // unless it's the first turn
                if (this.stack.length === 1) {
                    return {move, message: i18next.t("apgames:validation.streetcar.FIRST_HOUSE")} as IClickResult;
                }
                house = cell;
            }
            // if it's an edge, add it to the list
            else if (piece !== undefined) {
                const edge = cell + piece.toLowerCase();
                if (! edges.includes(edge)) {
                    edges.push(edge);
                    if (edges.length > 2) {
                        edges = edges.slice(1);
                    }
                } else {
                    edges = edges.filter(e => e !== edge);
                }
            }
            // otherwise something untoward has happened
            else {
                throw new Error("This error should never be thrown.");
            }

            newmove = `[${edges.join(",")}]${house}`;
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
            if (this.stack.length === 1) {
                result.message = i18next.t("apgames:validation.streetcar.INITIAL_INSTRUCTIONS", {context: "initial"});
            } else {
                result.message = i18next.t("apgames:validation.streetcar.INITIAL_INSTRUCTIONS", {context: "normal"});
            }
            return result;
        }

        // break down the component parts
        let edges: string[] = [];
        let house = "";
        if ( (m.length > 0) && (reMovePartial.test(m)) ) {
            const [,edgeList, houseCell] = m.match(reMovePartial)!;
            edges = edgeList.split(",");
            house = houseCell || "";
        }
        // ignore house removal on first turn
        if (this.stack.length === 1) {
            house = "";
        }
        // look for empty edges
        if ( (edges.length === 1) && (edges[0] === "") ) {
            edges = [];
        }

        // validate house limit
        if ( (house !== undefined) && (house.length > 0) ) {
            // must be a valid cell
            try {
                StreetcarGame.algebraic2coords(house);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: house});
                return result;
            }
            // must not be blocked
            if (StreetcarGame.blockedCells.includes(house)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: house});
                return result;
            }
            // there must be a house on the cell
            if (! this.board.has(house)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: house});
                return result;
            }
            const houseContents = this.board.get(house)!;
            if ("size" in houseContents) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.streetcar.NO_REMOVE_BLDGS");
                return result;
            }
            // must not be next to a building
            const [x,y] = StreetcarGame.algebraic2coords(house);
            const hex = hexGrid.getHex({col: x, row: y})!;
            const neighbours = getNeighbours(hex);
            for (const n of neighbours) {
                const nCell = StreetcarGame.coords2algebraic(n.col, n.row);
                if (this.board.has(nCell)) {
                    const contents = this.board.get(nCell)!;
                    if ("size" in contents) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.streetcar.ADJ_TO_BLDG", {cell: house});
                        return result;
                    }
                }
            }
        }

        // validate edges
        if (edges.length > 0) {
            const pts = new Set<string>();
            for (const edge of edges) {
                // each edge must be valid
                if (! reEdge.test(edge)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.streetcar.INVALID_EDGE", {edge});
                    return result;
                }
                const [,cell,dir] = edge.match(reEdge)!;
                const [cellx, celly] = StreetcarGame.algebraic2coords(cell);
                const edgeHex = hexGrid.getHex({col: cellx, row: celly})!;
                const realEdge = hex2edges(edgeHex).get(dir.toUpperCase() as CompassDirection)!;
                // must be unclaimed
                for (const claimed of this.claimed) {
                    for (const claim of claimed) {
                        if (claim.uid === realEdge.uid) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.streetcar.ALREADY_CLAIMED", {edge});
                            return result;
                        }
                    }
                }
                // store points for later reference
                for (const pt of edge2verts(realEdge)) {
                    pts.add(pt.uid);
                }
            }
            // no more than two edges
            if (edges.length > 2) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.streetcar.ONLY_TWO");
                return result;
            }
            // the new edges must touch
            if ( (edges.length === 2) && (pts.size !== 3) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.streetcar.MUST_TOUCH");
                return result;
            }
            // can't touch opposing lines
            let otherPlayer: playerid = 1;
            if (this.currplayer === 1) {
                otherPlayer = 2;
            }
            const claimedPts = this.getClaimedPts(otherPlayer);
            for (const pt of claimedPts) {
                if (pts.has(pt.uid)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.streetcar.MAY_NOT_TOUCH");
                    return result;
                }
            }
        }

        // validation passed, now to determine completion level
        if ( (edges.length >= 1) && ( (house.length > 0) || (this.stack.length === 1) ) ) {
            result.valid = true;
            result.complete = 1;
            if (edges.length === 1) {
                result.complete = 0;
            }
            result.canrender = true;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        } else if (house.length > 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.streetcar.VALID_PARTIAL", {context: "havehouse"});
            return result;
        } else {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.streetcar.VALID_PARTIAL", {context: "haveedge"});
            return result;
        }
    }

    public getClaimedPts(player: playerid): IVertex[] {
        const claimed: IVertex[] = [];
        const seen = new Set<string>();
        for (const claim of this.claimed[player - 1]) {
            for (const v of edge2verts(claim)) {
                if (seen.has(v.uid)) { continue; }
                seen.add(v.uid);
                claimed.push(v);
            }
        }
        return claimed;
    }

    public getClaimedCells(player: playerid): string[] {
        const cells = new Set<string>();

        const verts = this.getClaimedPts(player);
        const coords = verts.map(v => vert2hexes(v)).flat();
        for (const {q,r} of coords) {
            const hex = hexGrid.getHex([q,r]);
            if (hex !== undefined) {
                const {col,row} = hex;
                cells.add(StreetcarGame.coords2algebraic(col, row));
            }
        }

        return [...cells];
    }

    public countLines(player: playerid): number {
        const graph = new UndirectedGraph();
        for (const claim of this.claimed[player - 1]) {
            const [left, right] = edge2verts(claim);
            if (! graph.hasNode(left.uid)) {
                graph.addNode(left.uid);
            }
            if (! graph.hasNode(right.uid)) {
                graph.addNode(right.uid);
            }
            if (! graph.hasUndirectedEdge(left.uid, right.uid)) {
                graph.addUndirectedEdge(left.uid, right.uid);
            }
        }
        return connectedComponents(graph).length;
    }

    public move(m: string, partial = false): StreetcarGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        // Normalize
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (! partial) {
            const result = this.validateMove(m);
            if ( (! result.valid) || (result.complete === -1) ) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
        }

        this.results = [];

        // break the move into parts
        const edges: IEdge[] = [];
        let house = "";
        if ( (m.length > 0) && (reMovePartial.test(m)) ) {
            const [,edgeList, houseCell] = m.match(reMovePartial)!;
            if (edgeList !== "") {
                for (const e of edgeList.split(",")) {
                    const [, cell, dir] = e.match(reEdge)!;
                    const [cellx, celly] = StreetcarGame.algebraic2coords(cell);
                    const edgeHex = hexGrid.getHex({col: cellx, row: celly})!;
                    const realEdge = hex2edges(edgeHex).get(dir.toUpperCase() as CompassDirection)!;
                    if (realEdge === undefined) {
                        throw new Error(`Could not derive a true edge for ${cell} + ${dir}.`);
                    }
                    edges.push(realEdge);
                }
            }
            house = houseCell || "";
        }
        // ignore house removal on first turn
        if (this.stack.length === 1) {
            house = "";
        }
        // claim the edges
        for (const edge of edges) {
            this.claimed[this.currplayer - 1].push(deepclone(edge) as IEdge);
            this.results.push({type: "claim", where: edge2string(edge)})
        }
        // remove the housing limit (and add to taken list)
        if (house.length > 0) {
            const contents = this.board.get(house)!;
            this.board.delete(house);
            this.taken[this.currplayer - 1].push(contents.colour);
            this.results.push({type: "take", from: house, what: contents.colour.toString()});
        }
        // build buildings
        for (const hex of hexGrid) {
            const {col, row} = hex;
            const cell = StreetcarGame.coords2algebraic(col, row);
            if (StreetcarGame.blockedCells.includes(cell)) {
                continue;
            }
            if (! this.board.has(cell)) {
                const neighbours = getNeighbours(hex);
                const occupied: string[] = [];
                for (const n of neighbours) {
                    const {col: ncol, row: nrow} = n;
                    const ncell = StreetcarGame.coords2algebraic(ncol, nrow);
                    if (this.board.has(ncell)) {
                        const contents = this.board.get(ncell)!;
                        if ("removable" in contents) {
                            occupied.push(ncell);
                        }
                    }
                }
                if (occupied.length === 3) {
                    const bldg = StreetcarGame.genBuilding(occupied.map(c => this.board.get(c)!.colour));
                    this.board.set(cell, bldg);
                    this.results.push({type: "place", where: cell});
                }
            }
        }
        // update housing removability
        for (const hex of hexGrid) {
            const {col, row} = hex;
            const cell = StreetcarGame.coords2algebraic(col, row);
            if (StreetcarGame.blockedCells.includes(cell)) {
                continue;
            }
            if (this.board.has(cell)) {
                const contents = this.board.get(cell)!;
                if ("size" in contents) {
                    continue;
                }
                const neighbours = getNeighbours(hex);
                let adjBldg = false;
                for (const n of neighbours) {
                    const {col: ncol, row: nrow} = n;
                    const ncell = StreetcarGame.coords2algebraic(ncol, nrow);
                    if (this.board.has(ncell)) {
                        const ncontents = this.board.get(ncell)!;
                        if ("size" in ncontents) {
                            adjBldg = true;
                            break;
                        }
                    }
                }
                if (adjBldg) {
                    this.board.set(cell, {colour: contents.colour, removable: false});
                } else {
                    this.board.set(cell, {colour: contents.colour, removable: true});
                }
            }
        }

        if (partial) { return this; }

        // reconstitute a normalized move rep
        this.lastmove = `[${edges.map(e => edge2string(e)).join(",")}]${house}`;
        if (this.currplayer === 1) {
            this.currplayer = 2;
        } else {
            this.currplayer = 1;
        }

        this.checkEOG();
        this.saveState();
        return this;
    }

    public getPlayerScore(player: playerid, colour?: Colour): number {
        let colours: Colour[] = [1,2,3,4];
        if (colour !== undefined) {
            colours = [colour];
        }
        let score = 0;

        const cells = this.getClaimedCells(player);
        for (const c of colours) {
            const taken = this.taken[player - 1].filter(t => t === c).length;
            let cubes = 0;
            for (const cell of cells) {
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    if ( ("size" in contents) && (contents.colour === c) ) {
                        cubes += contents.size
                    }
                }
            }
            score += cubes * taken;
        }

        // only apply penalty if you didn't ask for a single colour
        if (colour === undefined) {
            let penalty = 10;
            if (this.variants.includes("5point")) {
                penalty = 5;
            } else if (this.variants.includes("15point")) {
                penalty = 15;
            }
            score -= this.countLines(player) * penalty;
        }

        return score;
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] }
        ]
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Scores**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const score = this.getPlayerScore(n as playerid);
            status += `Player ${n}: ${score}\n\n`;
        }

        return status;
    }

    protected checkEOG(): StreetcarGame {
        const removable = [...this.board.values()].filter(c => ("removable" in c) && (c.removable)).length;
        if (removable === 0) {
            this.gameover = true;
            const score1 = this.getPlayerScore(1);
            const score2 = this.getPlayerScore(2);
            if (score1 > score2) {
                this.winner = [1];
            } else if (score2 > score1) {
                this.winner = [2];
            } else {
                let max1 = 0;
                let max2 = 0;
                for (const colour of [1,2,3,4] as Colour[]) {
                    const cscore1 = this.getPlayerScore(1, colour);
                    max1 = Math.max(max1, cscore1);
                    const cscore2 = this.getPlayerScore(2, colour);
                    max2 = Math.max(max2, cscore2);
                }
                if (max1 > max2) {
                    this.winner = [1];
                } else if (max2 > max1) {
                    this.winner = [2];
                } else {
                    this.winner = [1,2];
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

    public state(): IStreetcarState {
        return {
            game: StreetcarGame.gameinfo.uid,
            numplayers: 2,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
            startpos: this.startpos,
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: StreetcarGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: deepclone(this.board) as Map<string, CellContents>,
            taken: [[...this.taken[0]],[...this.taken[1]]],
            claimed: deepclone(this.claimed) as [IEdge[],IEdge[]],
        };
    }

    public render(): APRenderRep {
        // Build piece string
        const pieces: string[][] = [];
        const houseLet = "ABCD";
        const blankLet = "EFGH";
        const bldgLets = ["KLMN","OPQR","STUV","WXYZ"];
        for (let row = 0; row < 8; row++) {
            const node: string[] = [];
            for (let col = 0; col < 8; col++) {
                const cell = StreetcarGame.coords2algebraic(col, row);
                if ( (StreetcarGame.blockedCells.includes(cell)) || (! this.board.has(cell)) ) {
                    node.push("-");
                } else if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    if ("size" in contents) {
                        let str = "";
                        for (let i = 0; i < contents.size; i++) {
                            const bldgLet = bldgLets[Math.floor(Math.random() * 4)];
                            str += bldgLet[contents.colour - 1];
                        }
                        node.push(str);
                    } else {
                        if (contents.removable) {
                            node.push(houseLet[contents.colour - 1]);
                        } else {
                            node.push(blankLet[contents.colour - 1]);
                        }
                    }
                }
            }
            pieces.push(node);
        }
        const pstr: string = pieces.map(r => r.join(",")).join("\n");

        // Build rep
        const rep: APRenderRep =  {
            options: ["clickable-edges"],
            renderer: "stacking-offset",
            board: {
                style: "hex-even-p",
                width: 8,
                height: 8,
                strokeWeight: 15,
                strokeColour: "#fff",
                hexFill: "#cede86",
                backFill: "#cede86",
                stackOffset: 0.39,
                blocked: [
                    {row: 1, col: 0},
                    {row: 2, col: 0},
                    {row: 2, col: 7},
                    {row: 3, col: 0},
                    {row: 3, col: 1},
                    {row: 3, col: 7},
                    {row: 4, col: 0},
                    {row: 4, col: 6},
                    {row: 4, col: 7},
                    {row: 5, col: 0},
                    {row: 5, col: 7},
                    {row: 6, col: 7}
                ],
            },
            legend: {
                A: [
                    {
                        name: "piece-borderless",
                        player: 6
                    },
                    {
                        name: "streetcar-house",
                        scale: 0.75
                    },
                ],
                B: [
                    {
                        name: "piece-borderless",
                        player: 4
                    },
                    {
                        name: "streetcar-house",
                        scale: 0.75
                    },
                ],
                C: [
                    {
                        name: "piece-borderless",
                        colour: "#000"
                    },
                    {
                        name: "streetcar-house",
                        scale: 0.75
                    },
                ],
                D: [
                    {
                        name: "piece-borderless",
                        colour: "#fff"
                    },
                    {
                        name: "streetcar-house",
                        scale: 0.75
                    },
                ],
                E: {
                    name: "piece-borderless",
                    player: 6
                },
                F: {
                    name: "piece-borderless",
                    player: 4
                },
                G: {
                    name: "piece-borderless",
                    colour: "#000"
                },
                H: {
                    name: "piece-borderless",
                    colour: "#fff"
                },
                K: {
                    name: "cube-cat-plant",
                    scale: 0.85,
                    player: 6
                },
                L: {
                    name: "cube-cat-plant",
                    scale: 0.85,
                    player: 4
                },
                M: {
                    name: "cube-cat-plant",
                    scale: 0.85,
                    colour: "#000"
                },
                N: {
                    name: "cube-cat-plant",
                    scale: 0.85,
                    colour: "#fff"
                },
                O: {
                    name: "cube-lamp-cat",
                    scale: 0.85,
                    player: 6
                },
                P: {
                    name: "cube-lamp-cat",
                    scale: 0.85,
                    player: 4
                },
                Q: {
                    name: "cube-lamp-cat",
                    scale: 0.85,
                    colour: "#000"
                },
                R: {
                    name: "cube-lamp-cat",
                    scale: 0.85,
                    colour: "#fff"
                },
                S: {
                    name: "cube-plant-person",
                    scale: 0.85,
                    player: 6
                },
                T: {
                    name: "cube-plant-person",
                    scale: 0.85,
                    player: 4
                },
                U: {
                    name: "cube-plant-person",
                    scale: 0.85,
                    colour: "#000"
                },
                V: {
                    name: "cube-plant-person",
                    scale: 0.85,
                    colour: "#fff"
                },
                W: {
                    name: "cube-person-lamp",
                    scale: 0.85,
                    player: 6
                },
                X: {
                    name: "cube-person-lamp",
                    scale: 0.85,
                    player: 4
                },
                Y: {
                    name: "cube-person-lamp",
                    scale: 0.85,
                    colour: "#000"
                },
                Z: {
                    name: "cube-person-lamp",
                    scale: 0.85,
                    colour: "#fff"
                },
            },
            pieces: pstr
        };

        if ( (this.claimed[0].length > 0) || (this.claimed[1].length > 0) ) {
            // @ts-ignore
            rep.board!.markers = [];
            for (const p of [1,2] as playerid[]) {
                for (const claim of this.claimed[p - 1]) {
                    // check if just now claimed
                    const justnow = this.results.filter(r => r.type === "claim" && r.where === edge2string(claim)).length === 1;
                    const [cell, dir] = edge2celldir(claim);
                    const [col, row] = StreetcarGame.algebraic2coords(cell);
                    const node = {
                        type: "fence",
                        cell: {
                            row,
                            col,
                        },
                        side: dir,
                        colour: p,
                        width: 0.5,
                    }
                    if (justnow) {
                        // @ts-ignore
                        node.dashed = [1,9];
                    }
                    // @ts-ignore
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                    rep.board!.markers.push(node);
                }
            }
        }

        rep.areas = [];
        for (const player of [1,2] as playerid[]) {
            if (this.taken[player - 1].length > 0) {
                // Put any inhand pieces in the bar
                const taken = this.taken[player - 1].sort((a,b) => a - b).map(n => blankLet[n - 1]);
                // @ts-ignore
                rep.areas.push({
                    type: "pieces",
                    pieces: [...taken] as [string, ...string[]],
                    label: i18next.t("apgames:validation.streetcar.TAKEN_LABEL", {playerNum: player}) || "local",
                    background: "#cede86",
                    ownerMark: player,
                });
            }
        }
        if (rep.areas.length === 0) {
            delete rep.areas;
        }

        // Add annotations
        if (this.results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = StreetcarGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                } else if (move.type === "take") {
                    const [x, y] = StreetcarGame.algebraic2coords(move.from);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                }
            }
        }

        return rep;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "take":
                node.push(i18next.t("apresults:TAKE.streetcar", {player, from: r.from}));
                resolved = true;
                break;
            case "place":
                node.push(i18next.t("apresults:PLACE.streetcar", {player, where: r.where}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): StreetcarGame {
        return new StreetcarGame(this.serialize());
    }

    private normalizeMove(m: string): string {
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const edges: IEdge[] = [];
        let house = "";
        if ( (m.length > 0) && (reMovePartial.test(m)) ) {
            const [,edgeList, houseCell] = m.match(reMovePartial)!;
            if (edgeList !== "") {
                for (const e of edgeList.split(",")) {
                    const [, cell, dir] = e.match(reEdge)!;
                    const [cellx, celly] = StreetcarGame.algebraic2coords(cell);
                    const edgeHex = hexGrid.getHex({col: cellx, row: celly})!;
                    const realEdge = hex2edges(edgeHex).get(dir.toUpperCase() as CompassDirection)!;
                    if (realEdge === undefined) {
                        throw new Error(`Could not derive a true edge for ${cell} + ${dir}.`);
                    }
                    edges.push(realEdge);
                }
            }
            house = houseCell || "";
        }
        return `[${edges.map(e => edge2string(e)).join(",")}]${house}`;
    }

    public sameMove(move1: string, move2: string): boolean {
        return this.normalizeMove(move1) === this.normalizeMove(move2);
    }

}
