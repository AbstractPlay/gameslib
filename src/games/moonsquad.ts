/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, AreaPieces, Glyph, MarkerEdge, MarkerFlood, MarkerHalo, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError, intersects, shuffle } from "../common";
import { connectedComponents } from 'graphology-components';
import i18next from "i18next";
import { HexMoonGraph, HexTriGraph } from "../common/graphs";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

type playerid = 1|2;
type OreColour = 3|4|5|6|7;
const colourNum2Name = new Map<OreColour, string>([
    [3, "G"],
    [4, "Y"],
    [5, "P"],
    [6, "O"],
    [7, "B"],
]);
const colourName2Num = new Map<string, OreColour>([
    ["G", 3],
    ["Y", 4],
    ["P", 5],
    ["O", 6],
    ["B", 7],
]);
const reMvmt = /^\-\S+?\((.*?)\)$/;
interface ILegendObj {
    [key: string]: Glyph|[Glyph, ...Glyph[]];
}


type CellContents = playerid|OreColour;

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    squads: Set<string>;
    ore: [OreColour[], OreColour[]];
    lastmove?: string;
}

export interface IMoonSquadState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class MoonSquadGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Moon Squad",
        uid: "moonsquad",
        playercounts: [2],
        version: "20241206",
        dateAdded: "2023-07-31",
        // i18next.t("apgames:descriptions.moonsquad")
        description: "apgames:descriptions.moonsquad",
        urls: ["https://moon.drew-edwards.com/"],
        people: [
            {
                type: "designer",
                name: "Drew Edwards",
                urls: ["https://games.drew-edwards.com/"]
            }
        ],
        variants: [
            {uid: "limping", group: "board"},
            {uid: "hex5", group: "board"},
        ],
        categories: ["goal>connect", "mechanic>place", "mechanic>capture", "board>shape>circle", "board>connect>hex", "components>simple>7c"],
        flags: ["experimental", "pie", "check", "custom-rotation", "random-start", "no-moves", "custom-randomization"]
    };

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, CellContents>;
    public squads!: Set<string>;
    public ore: [OreColour[], OreColour[]] = [[], []];
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private highlights: string[] = [];
    private dots: string[] = [];

    constructor(state?: IMoonSquadState | string, variants?: string[]) {
        super();
        if (state !== undefined) {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IMoonSquadState;
            }
            if (state.game !== MoonSquadGame.gameinfo.uid) {
                throw new Error(`The MoonSquad game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.variants = [...state.variants];
            this.winner = [...state.winner];
            this.stack = [...state.stack];
        } else {
            if ( (variants !== undefined) && (variants.length > 0) ) {
                this.variants = [...variants];
            }
            const board = new Map<string,CellContents>();
            const fresh: IMoveState = {
                _version: MoonSquadGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                squads: new Set<string>(),
                ore: [[], []],
            };
            this.stack = [fresh];
        }
        this.load();
    }

    public load(idx = -1): MoonSquadGame {
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
        this.ore = deepclone(state.ore) as [OreColour[], OreColour[]];
        this.squads = deepclone(state.squads) as Set<string>;
        this.lastmove = state.lastmove;
        return this;
    }

    private get graph(): HexTriGraph|HexMoonGraph {
        if (this.variants.includes("limping")) {
            return new HexTriGraph(5, 10, true);
        } else if (this.variants.includes("hex5")) {
            return new HexTriGraph(5, 9, false);
        } else {
            return new HexMoonGraph();
        }
    }

    public randomMove(): string {
        // The randomizer never moves squads
        const g = this.graph;
        // if first move, randomly pick three cells
        if (this.stack.length === 1) {
            const shuffled = shuffle(g.listCells(false) as string[]) as string[];
            if (this.variants.includes("hex5")) {
                return shuffled[0];
            } else {
                return shuffled.slice(0,3).join(",");
            }
        }
        // if capture is possible, capture 25% of the time
        const caps: string[] = [];
        for (const cell of this.mySquads()) {
            for (const n of g.neighbours(cell)) {
                if (this.board.get(n) === (this.currplayer === 1 ? 2 : 1)) {
                    caps.push(`${cell}x${n}`);
                }
            }
        }
        if (caps.length > 0 && Math.random() < 0.25) {
            return (shuffle(caps) as string[])[0];
        }
        // otherwise, just randomly place
        const avail = [...this.board.entries()].filter(([,c]) => c > 2).map(([cell,]) => cell);
        return (shuffle(avail) as string[])[0];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        move = move.toLowerCase();
        move = move.replace(/\s+/g, "");

        try {
            let newmove = "";
            // click the stash means initiating squad movement
            if (row < 0 && col < 0) {
                if (piece === undefined) {
                    throw new Error(`Piece argument not received.`);
                }
                newmove = `-${piece}()`;
            }
            // otherwise clicking the board for any of the three actions
            else {
                const cell = this.graph.coords2algebraic(col, row);
                // if first move of the game, then string of placements
                if (this.stack.length === 1) {
                    if (move.length === 0) {
                        newmove = cell;
                    } else {
                        const mvs = move.split(",");
                        mvs.push(cell);
                        newmove = mvs.join(",");
                    }
                }
                // if move is blank, then either placing or starting a capture
                else if (move.length === 0) {
                    newmove = cell;
                }
                // but if move starts with a -, then moving squads
                else if (move.startsWith("-")) {
                    const match = move.match(reMvmt);
                    if (match === null) {
                        throw new Error(`Unable to parse a squad movement click.`);
                    }
                    const mvs = match[1].split(";");
                    if (mvs[0] === "") {
                        mvs.shift();
                    }
                    // if the last move is not complete, extend it
                    if (mvs.length > 0 && !mvs[mvs.length - 1].includes("-")) {
                        mvs[mvs.length - 1] += `-${cell}`;
                    }
                    // otherwise start a new one
                    else {
                        mvs.push(cell);
                    }
                    newmove = move.substring(0, 2) + "(" + mvs.join(";") + ")";
                }
                // otherwise it must be a capture
                else {
                    newmove = `${move}x${cell}`;
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

    private getIslands(player?: playerid): string[][] {
        if (player === undefined) {
            player = this.currplayer;
        }
        const g = this.graph.graph;
        for (const node of g.nodes()) {
            if (!this.board.has(node) || this.board.get(node) !== player) {
                g.dropNode(node);
            }
        }
        return connectedComponents(g);
    }

    private mySquads(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        const mine: string[] = [];
        for (const squad of this.squads) {
            if (this.board.get(squad) === player) {
                mine.push(squad);
            }
        }
        return mine;
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        // if not a squad movement and contains explanatory parentheticals, strip them
        if (!m.startsWith("-") && m.includes("(")) {
            const idx = m.indexOf("(");
            m = m.substring(0, idx);
        }

        if (m === "") {
            result.valid = true;
            result.complete = -1;
            if (this.variants.includes("hex5")) {
                result.message = i18next.t("apgames:validation.moonsquad.INITIAL_INSTRUCTIONS", {context: this.stack.length === 1 ? "hexoffer" : this.stack.length === 2 ? "pie" : "normal"});
            } else {
                result.message = i18next.t("apgames:validation.moonsquad.INITIAL_INSTRUCTIONS", {context: this.stack.length === 1 ? "offer" : this.stack.length === 2 ? "pie" : "normal"});
            }
            return result;
        }

        const g = this.graph;

        // pie offer handling
        if (this.stack.length === 1) {
            // hex5 is a single piece offer
            if (this.variants.includes("hex5")) {
                // cell is valid
                if (!(g.listCells(false) as string[]).includes(m)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: m});
                    return result;
                }
            }
            // the rest are three pieces
            else {
                const mvs = new Set<string>(m.split(","));
                const cells = g.listCells(false) as string[];
                for (const cell of mvs) {
                    // cell is valid
                    if (!cells.includes(cell)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                        return result;
                    }
                }
                if (mvs.size === 1) {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.moonsquad.PARTIAL_PLACE1");
                    return result;
                } else if (mvs.size === 2) {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.moonsquad.PARTIAL_PLACE2");
                    return result;
                } else if (mvs.size > 3) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
                    return result;
                }
            }

            // if we make it here, we're good
            result.valid = true;
            result.complete = 1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        // movement
        if (m.startsWith("-")) {
            // extract the ore code
            const idxParen = m.indexOf("(");
            const oreName = m.substring(1, idxParen === -1 ? m.length : idxParen).toUpperCase();
            const oreNum = colourName2Num.get(oreName);
            if (oreNum === undefined) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.moonsquad.INVALID_ORE", {ore: oreName});
                return result;
            }
            if (!this.ore[this.currplayer - 1].includes(oreNum)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.moonsquad.MISSING_ORE", {ore: oreName});
                return result;
            }
            // extract movement string
            if (idxParen !== -1) {
                let mvStr = m.substring(idxParen+1);
                if (mvStr.endsWith(")")) {
                    mvStr = mvStr.substring(0, mvStr.length - 1);
                }
                // if no moves, valid partial
                if (mvStr.length === 0) {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.moonsquad.PARTIAL_MOVE", {context: "first"});
                    return result;
                }
                const mvs = mvStr.split(";");
                const mySquads = this.mySquads();
                for (const mv of mvs) {
                    const [from, to] = mv.split("-");
                    if (from === undefined || from === "") { continue; }
                    // from is a squad
                    if (!mySquads.includes(from)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.moonsquad.MISSING_SQUAD", {where: from});
                        return result;
                    }
                    // if a to is present
                    if (to !== undefined && to !== "") {
                        if (from === to) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.moonsquad.BAD_MOVE", {context: "stationary", from, to});
                            return result;
                        }
                        const islands = this.getIslands();
                        const group = islands.find(x => x.includes(from))!;
                        // to exists
                        if (!group.includes(to)) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.moonsquad.BAD_MOVE", {context: "group", from, to});
                            return result;
                        }
                        // to doesn't already have a squad
                        if (this.squads.has(to)) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.moonsquad.BAD_MOVE", {context: "double", from, to});
                            return result;
                        }
                    }
                    // otherwise, valid partial
                    else {
                        result.valid = true;
                        result.complete = -1;
                        result.canrender = true;
                        result.message = i18next.t("apgames:validation.moonsquad.PARTIAL_MOVE", {context: "second"});
                        return result;
                    }
                }
                // if we make it here, then it's valid and possibly complete
                result.valid = true;
                result.complete = mvs.length === mySquads.length ? 1 : 0;
                result.canrender = true;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
            // otherwise valid partial
            else {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.moonsquad.PARTIAL_MOVE", {context: "first"});
                return result;
            }
        }
        // capture
        else if (m.includes("x")) {
            const [from, to] = m.split("x");
            const mySquads = this.mySquads();
            // squad exists
            if (!mySquads.includes(from)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.moonsquad.MISSING_SQUAD", {where: from});
                return result;
            }
            // to exists
            const otherPlayer = this.currplayer === 1 ? 2 : 1;
            if (!this.board.has(to) || this.board.get(to) !== otherPlayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.moonsquad.BAD_CAPTURE");
                return result;
            }

            // we're good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
        // regular placement (pie offer handled earlier) or possible capture start
        else {
            // if capture start
            if (this.mySquads().includes(m)) {
                // valid partial capture
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.moonsquad.PARTIAL_CAPTURE");
                return result;
            }
            // otherwise regular placement
            // cell valid
            if (!this.board.has(m) || this.board.get(m)! < 3) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.moonsquad.BAD_PLACEMENT", {where: m});
                return result;
            }

            // we're good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
    }

    public move(m: string, {trusted = false, partial = false, emulation = false} = {}): MoonSquadGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        // Normalize
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        // if not a squad movement and contains explanatory parentheticals, strip them
        if (!m.startsWith("-") && m.includes("(")) {
            const idx = m.indexOf("(");
            m = m.substring(0, idx);
        }

        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
        }

        this.results = [];
        this.highlights = [];
        this.dots = [];
        let parenthetical = "";

        // first-move handling
        if (this.stack.length === 1) {
            const mvs = m.split(",");
            for (let i = 0; i < mvs.length; i++) {
                this.board.set(mvs[i], i < 2 ? 1 : 2);
                this.results.push({type: "place", what: i < 3 ? "1" : "2", where: mvs[i]});
            }
            // if not emulated and not partial, fill the rest of the board with cubes
            if (!partial && !emulation) {
                const cells = (this.graph.listCells(true) as string[][]).flat();
                const numCubes = cells.length - mvs.length;
                const bag: OreColour[] = [];
                let idx = 0;
                while (bag.length < numCubes) {
                    bag.push((3 + idx) as OreColour);
                    idx = (idx + 1) % 5;
                }
                const shuffled = shuffle(bag) as OreColour[];
                for (const cell of cells) {
                    if (this.board.has(cell)) {
                        continue;
                    }
                    const ore = shuffled.pop();
                    if (ore === undefined) {
                        throw new Error(`Ran out of cubes before we ran out of empty spaces!`);
                    }
                    this.board.set(cell, ore);
                }
            }
        }
        // everything else
        else {
            // squad movement
            if (m.startsWith("-")) {
                const idx = m.indexOf("(");
                const oreName = m.substring(1, idx > -1 ? idx : m.length).toUpperCase();
                const oreNum = colourName2Num.get(oreName);
                if (oreNum === undefined) {
                    throw new Error(`Could not find a code for the ore colour ${oreName}.`);
                }
                const oreIdx = this.ore[this.currplayer - 1].findIndex(x => x === oreNum);
                if (oreIdx > -1) {
                    this.ore[this.currplayer - 1].splice(oreIdx, 1);
                }
                this.results.push({type: "sacrifice", what: oreName});
                let mvStr = "";
                if (idx > -1) {
                    mvStr = m.substring(idx+1);
                    if (mvStr.endsWith(")")) {
                        mvStr = mvStr.substring(0, mvStr.length - 1);
                    }
                }
                if (partial) {
                    this.highlights.push(...this.mySquads());
                }
                const mvs = mvStr.split(",");
                for (const mv of mvs) {
                    const [from, to] = mv.split("-");
                    if (from === undefined || from === "") { continue; }
                    // if a to is provided
                    if (to !== undefined && to.length > 0) {
                        // move the squad
                        this.squads.delete(from);
                        this.squads.add(to);
                        this.results.push({type: "move", from, to});
                        // if partial, highlight remaining squads
                        if (partial) {
                            this.highlights = this.highlights.filter(x => x !== from);
                        }
                    }
                    // otherwise we're definitely partial
                    else {
                        this.highlights = [from];
                        const islands = this.getIslands();
                        const group = islands.find(x => x.includes(from))!;
                        this.dots = group.filter(g => g !== from && !this.squads.has(g));
                    }
                }
            }
            // capture
            else if (m.includes("x")) {
                const [from, to] = m.split("x");
                this.squads.delete(from);
                this.squads.delete(to);
                this.board.set(to, this.currplayer);
                this.results.push({type: "move", from, to});
                this.results.push({type: "capture", where: to});
            }
            // placement or partial capture
            else {
                // if this is a squad, it's a partial capture
                if (this.squads.has(m)) {
                    this.highlights = [m];
                    // find neighbouring capture opportunities and add dots
                    for (const n of this.graph.neighbours(m)) {
                        if (this.board.has(n) && this.board.get(n) === (this.currplayer === 1 ? 2 : 1)) {
                            this.dots.push(n);
                        }
                    }
                }
                // otherwise we're just placing a piece
                else {
                    const oreNum = this.board.get(m);
                    if (oreNum === undefined || oreNum < 3 || oreNum > 7) {
                        throw new Error(`Unable to find an ore cube at ${m}`);
                    }
                    const oreName = colourNum2Name.get(oreNum as OreColour)!;
                    parenthetical += oreName;
                    this.ore[this.currplayer-1].push(oreNum as OreColour);
                    this.board.set(m, this.currplayer);
                    this.results.push({type: "take", from: m, what: oreName})
                    this.results.push({type: "place", where: m});
                    const matching = this.ore[this.currplayer-1].filter(x => x === oreNum);
                    if (matching.length === 3) {
                        this.ore[this.currplayer-1] = this.ore[this.currplayer-1].filter(x => x !== oreNum);
                        this.results.push({type: "convert", what: oreName, into: "squad"});
                        this.squads.add(m);
                        parenthetical += "*";
                    }
                }
            }
        }

        if (partial) { return this; }

        this.lastmove = parenthetical.length > 0 ? m + "(" + parenthetical + ")" : m;
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

    private checkConnected(player?: playerid): boolean {
        if (player === undefined) {
            player = this.currplayer;
        }
        const g = this.graph;
        const allEdges = g.getEdges();
        const edges: string[][] = [
            [...allEdges.get("N")!, ...allEdges.get("NE")!],
            [...allEdges.get("SE")!, ...allEdges.get("S")!],
            [...allEdges.get("SW")!, ...allEdges.get("NW")!],
        ];
        // start with the full board graph
        const graph = g.graph.copy();
        // drop any nodes not occupied by currplayer
        for (const node of [...graph.nodes()]) {
            if (! this.board.has(node) || this.board.get(node) !== this.currplayer) {
                graph.dropNode(node);
            }
        }

        for (const grp of connectedComponents(graph)) {
            let connected = true;
            for (const edge of edges) {
                if (! intersects(grp, edge)) {
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

    protected checkEOG(): MoonSquadGame {
        // We are now at the START of `this.currplayer`'s turn
        // Only the current player can win right now
        if (this.checkConnected()) {
            this.gameover = true;
            this.winner = [this.currplayer];
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IMoonSquadState {
        return {
            game: MoonSquadGame.gameinfo.uid,
            numplayers: 2,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: MoonSquadGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: deepclone(this.board) as Map<string, CellContents>,
            squads: deepclone(this.squads) as Set<string>,
            ore: [[...this.ore[0]], [...this.ore[1]]],
        };
    }

    protected renderHexTri(pieces: string, legend: ILegendObj, floods?: MarkerFlood[]): APRenderRep {
        const markers: (MarkerFlood|MarkerEdge)[] = [
            {
                "type": "edge",
                "edge": "N",
                "colour": "#ddcc77"
            },
            {
                "type": "edge",
                "edge": "NE",
                "colour": "#ddcc77"
            },
            {
                "type": "edge",
                "edge": "SE",
                "colour": "#332288"
            },
            {
                "type": "edge",
                "edge": "S",
                "colour": "#332288"
            },
            {
                "type": "edge",
                "edge": "SW",
                "colour": "#117733"
            },
            {
                "type": "edge",
                "edge": "NW",
                "colour": "#117733"
            }
        ];
        if (floods !== undefined) {
            markers.push(...floods);
        }
        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "hex-of-hex",
                minWidth: 5,
                maxWidth: 9,
                markers,
            },
            legend,
            pieces,
        };
        return rep;
    }

    protected renderMoon(pieces: string, legend: ILegendObj, floods?: MarkerFlood[]): APRenderRep {
        const markers: (MarkerFlood|MarkerHalo)[] = [
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
        ];
        if (floods !== undefined) {
            markers.push(...floods);
        }
        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "circular-moon",
                strokeWeight: 0.5,
                markers,
            },
            legend,
            pieces,
        };

        return rep;
    }

    protected renderLimping(pieces: string, legend: ILegendObj, floods?: MarkerFlood[]): APRenderRep {
        const markers: (MarkerFlood|MarkerEdge)[] = [
            {
                "type": "edge",
                "edge": "N",
                "colour": "#ddcc77"
            },
            {
                "type": "edge",
                "edge": "NE",
                "colour": "#ddcc77"
            },
            {
                "type": "edge",
                "edge": "SE",
                "colour": "#332288"
            },
            {
                "type": "edge",
                "edge": "S",
                "colour": "#332288"
            },
            {
                "type": "edge",
                "edge": "SW",
                "colour": "#117733"
            },
            {
                "type": "edge",
                "edge": "NW",
                "colour": "#117733"
            }
        ];
        if (floods !== undefined) {
            markers.push(...floods);
        }
        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "hex-of-hex",
                minWidth: 5,
                maxWidth: 10,
                alternatingSymmetry: true,
                markers,
            },
            legend,
            pieces,
        };

        return rep;
    }

    public render(): APRenderRep {
        const graph = this.graph;
        const floods: [string[], string[]] = [[],[]];
        let pstr = "";
        const cells = graph.listCells(true) as string[][];
        for (const row of cells) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    if (contents === 1 && this.squads.has(cell)) {
                        pieces.push("P1X");
                        floods[0].push(cell);
                    } else if (contents === 1) {
                        pieces.push("P1");
                        floods[0].push(cell);
                    } else if (contents === 2 && this.squads.has(cell)) {
                        pieces.push("P2X");
                        floods[1].push(cell);
                    } else if (contents === 2) {
                        pieces.push("P2");
                        floods[1].push(cell);
                    } else {
                        pieces.push(colourNum2Name.get(contents)!);
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join(",");
        }

        let markers: MarkerFlood[]|undefined;
        if (floods[0].length > 0 || floods[1].length > 0) {
            markers = [];
            for (let i = 0; i < floods.length; i++) {
                const points: [RowCol, ...RowCol[]] = floods[i].map(cell => {
                    const [x,y] = graph.algebraic2coords(cell);
                    return {row: y, col: x};
                }) as [RowCol, ...RowCol[]];
                if (points.length > 0) {
                    markers.push({
                        type: "flood",
                        points,
                        colour: i+1,
                        opacity: 0.5,
                    });
                }
            }
        }

        const legend: ILegendObj = {
            "P1": {
                name: "piece",
                colour: 1,
            },
            "P1X": [
                {
                    name: "piece",
                    colour: 1,
                },
                {
                    name: "meeple",
                    colour: "#fff",
                    scale: 0.75,
                    opacity: 0.25,
                }
            ],
            "P2": {
                name: "piece",
                colour: 2,
            },
            "P2X": [
                {
                    name: "piece",
                    colour: 2,
                },
                {
                    name: "meeple",
                    colour: "#fff",
                    scale: 0.75,
                    opacity: 0.25,
                }
            ],
        };
        for (const name of colourName2Num.keys()) {
            legend[name] = {
                name: "cube",
                colour: colourName2Num.get(name)!,
                scale: 0.75,
            };
        }

        let rep: APRenderRep;
        if (this.variants.includes("hex5")) {
            rep = this.renderHexTri(pstr, legend, markers);
        } else if (this.variants.includes("limping")) {
            rep = this.renderLimping(pstr, legend, markers);
        } else {
            rep = this.renderMoon(pstr, legend, markers);
        }

        // add areas
        const areas: AreaPieces[] = [];
        for (let i = 0; i < 2; i++) {
            if (this.ore[i].length > 0) {
                areas.push({
                    type: "pieces",
                    label: `Player ${i+1}'s ore`,
                    pieces: this.ore[i].sort((a,b) => a - b).map(ore => colourNum2Name.get(ore)!) as [string, ...string[]],
                });
            }
        }
        if (areas.length > 0) {
            rep.areas = areas;
        }

        // Add annotations
        const g = this.graph;
        if (this.results.length > 0) {
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = g.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                } else if (move.type === "capture") {
                    const [x, y] = g.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                } else if (move.type === "move") {
                    const [fx, fy] = g.algebraic2coords(move.from);
                    const [tx, ty] = g.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fy, col: fx},{row: ty, col: tx}]});
                }
            }
        }

        // add highlighting and dots, if present
        if (this.highlights.length > 0) {
            if (!("annotations" in rep)) {
                rep.annotations = [];
            }
            for (const cell of this.highlights) {
                const [x, y] = g.algebraic2coords(cell);
                rep.annotations!.push({type: "enter", targets: [{row: y, col: x}]});
            }
        }
        if (this.dots.length > 0) {
            if (!("annotations" in rep)) {
                rep.annotations = [];
            }
            for (const cell of this.dots) {
                const [x, y] = g.algebraic2coords(cell);
                rep.annotations!.push({type: "dots", targets: [{row: y, col: x}]});
            }
        }

        return rep;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        // place, move, capture, convert?, sacrifice, take
        switch (r.type) {
            case "place":
                if (r.what === undefined) {
                    node.push(i18next.t("apresults:PLACE.nowhat", {player, where: r.where}));
                } else {
                    node.push(i18next.t("apresults:PLACE.moonsquad", {player, where: r.where}));
                }
                resolved = true;
                break;
            case "move":
                node.push(i18next.t("apresults:MOVE.nowhat", {player, from: r.from, to: r.to}));
                resolved = true;
                break;
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.nowhat", {player, where: r.where}));
                resolved = true;
                break;
            case "sacrifice":
                node.push(i18next.t("apresults:SACRIFICE.moonsquad", {player, ore: r.what}));
                resolved = true;
                break;
            case "take":
                node.push(i18next.t("apresults:TAKE.moonsquad", {player, ore: r.what}));
                resolved = true;
                break;
            case "convert":
                node.push(i18next.t("apresults:CONVERT.moonsquad", {player}));
                resolved = true;
                break;
        }
        return resolved;
    }

    // Only detects check for the current player
    public inCheck(): number[] {
        let otherPlayer: playerid = 1;
        if (this.currplayer === 1) {
            otherPlayer = 2;
        }
        const connected = this.checkConnected(otherPlayer);
        if (connected) {
            return [this.currplayer];
        } else {
            return [];
        }
    }

    public getCustomRotation(): number | undefined {
        return 0;
    }

    public getStartingPosition(): string {
        if (this.stack.length > 1) {
            const cells: string[][] = this.graph.listCells(true) as string[][];
            const contents = cells.map(row => row.map(cell => this.board.get(cell)!));
            return contents.map(row => row.join(",")).join("\n");
        }
        return "";
    }

    public clone(): MoonSquadGame {
        return Object.assign(new MoonSquadGame(), deepclone(this) as MoonSquadGame);
        // return new MoonSquadGame(this.serialize());
    }
}
