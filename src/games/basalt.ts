/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, AreaKey } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError, shuffle, intersects } from "../common";
import i18next from "i18next";
import { UndirectedGraph } from "graphology";
import { connectedComponents } from "graphology-components";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

type playerid = 1|2;
type Directions = "NE"|"E"|"SE"|"SW"|"W"|"NW";
const allDirections: Directions[] = ["NE", "E", "SE", "SW", "W", "NW"];

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid[]>;
    lastmove?: string;
}

export interface IBasaltState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class BasaltGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Basalt",
        uid: "basalt",
        playercounts: [2],
        version: "20250118",
        dateAdded: "2023-12-26",
        // version: "20231225",
        // i18next.t("apgames:descriptions.basalt")
        description: "apgames:descriptions.basalt",
        urls: ["https://boardgamegeek.com/boardgame/421505/basalt"],
        people: [
            {
                type: "designer",
                name: "Michael Amundsen",
                urls: ["https://boardgamegeek.com/boardgamedesigner/133389/michael-amundsen"],
            },
            {
                type: "designer",
                name: "Alek Erickson",
                urls: ["https://boardgamegeek.com/boardgamedesigner/101050/alek-erickson"],
            },
        ],
        variants: [
            {uid: "pie"},
        ],
        categories: ["goal>connect", "mechanic>stack",  "mechanic>move", "mechanic>coopt", "board>shape>tri", "board>connect>hex", "components>simple>1per"],
        flags: ["experimental", "pie", "automove", "custom-rotation", "custom-randomization"],
    };
    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, playerid[]>;
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    public startpos!: string;
    private boardSize = 9;
    private dots: string[] = [];

    constructor(state?: IBasaltState | string, variants?: string[]) {
        super();
        if (state !== undefined) {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IBasaltState;
            }
            if (state.game !== BasaltGame.gameinfo.uid) {
                throw new Error(`The Basalt game code cannot process a game of '${state.game}'.`);
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
            if (!this.variants.includes("pie")) {
                board.set("a1", [1]);
                board.set("i1", [2]);
                board.set("i9", [2]);
            }
            const fresh: IMoveState = {
                _version: BasaltGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        }
        this.load();
    }

    public load(idx = -1): BasaltGame {
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
        this.board = deepclone(state.board) as Map<string, playerid[]>;
        this.lastmove = state.lastmove;
        return this;
    }

    public isPieTurn(): boolean {
        return this.stack.length === 2;
    }

    public shouldOfferPie(): boolean {
        return this.variants.includes("pie");
    }

    public coords2algebraic(x: number, y: number): string {
        if (x > y) {
            throw new Error(`The coordinates (${x},${y}) are invalid.`);
        }
        const columnLabels = "abcdefghijklmnopqrstuvwxyz".split("");
        return columnLabels[y] + (x + 1).toString();
    }

    public algebraic2coords(cell: string): [number,number] {
        const columnLabels = "abcdefghijklmnopqrstuvwxyz".split("");
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
        if (this.stack[0]._version === "20231225") {
            return [y, x - 1];
        }
        if (x - 1 > y) {
            throw new Error(`The coordinates (${x},${y}) are invalid.`);
        }
        return [x - 1, y];
    }

    private movePosition(x: number, y: number, dir: Directions, dist = 1): [number, number] | undefined {
        let xNew = x;
        let yNew = y;
        switch (dir) {
            case "NE":
                yNew -= dist
                break;
            case "E":
                xNew += dist;
                break;
            case "SE":
                xNew += dist;
                yNew += dist;
                break;
            case "SW":
                yNew += dist;
                break;
            case "W":
                xNew -= dist;
                break;
            case "NW":
                xNew -= dist;
                yNew -= dist;
                break;
            default:
                throw new Error("Invalid direction requested.");
        }
        if (!this.validCell(xNew, yNew)) {
            return undefined;
        }
        return [xNew, yNew];
    }

    private genRay(x: number, y: number, dir: Directions): [number, number][] {
        const ray: [number,number][] = [];
        let next = this.movePosition(x, y, dir);
        while (next !== undefined) {
            ray.push(next);
            next = this.movePosition(...next, dir);
        }
        return ray;
    }

    private validCell(x: number, y: number): boolean {
        if (x < 0 || y < 0 || x > y || y >= this.boardSize) {
            return false;
        }
        return true;
    }

    private getNeighbours(x: number, y: number): string[] {
        const neighbours: string[] = [];
        for (const dir of allDirections) {
            const pos = this.movePosition(x, y, dir);
            if (pos !== undefined) {
                neighbours.push(this.coords2algebraic(...pos));
            }
        }
        return neighbours;
    }

    private getAllCells(): string[] {
        const cells: string[] = [];
        for (let y = 0; y < this.boardSize; y++) {
            for (let x = 0; x <= y; x++) {
                cells.push(this.coords2algebraic(x, y));
            }
        }
        return cells;
    }

    private get graph(): UndirectedGraph {
        const g = new UndirectedGraph();
        for (const cell of this.getAllCells()) {
            if (!g.hasNode(cell)) {
                g.addNode(cell);
            }
            for (const n of this.getNeighbours(...this.algebraic2coords(cell))) {
                if (!g.hasNode(n)) {
                    g.addNode(n);
                }
                if (!g.hasEdge(cell, n)) {
                    g.addEdge(cell, n);
                }
            }
        }
        return g;
    }

    private get edges(): string[][] {
        const left: string[] = [];
        const right: string[] = [];
        const bottom: string[] = [];

        for (const cell of this.getAllCells()) {
            const [x, y] = this.algebraic2coords(cell);
            if (x === 0) {
                left.push(cell);
            }
            if (x === y) {
                right.push(cell);
            }
            if (y === this.boardSize - 1) {
                bottom.push(cell);
            }
        }

        return [left, right, bottom];
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        // can't generate initial pie offer
        if (this.variants.includes("pie") && this.stack.length === 1) {
            return [];
        }

        const moves: string[] = [];

        const mine = [...this.board.entries()].filter(([,s]) => s[s.length - 1] === player);
        for (const [from, stack] of mine) {
            const [fx, fy] = this.algebraic2coords(from);
            for (const dir of allDirections) {
                const ray = this.genRay(fx, fy, dir).map(c => this.coords2algebraic(...c));
                for (let dist = 1; dist <= stack.length; dist++) {
                    let to: string|undefined;
                    let between: string[] = [];
                    if (ray.length >= dist) {
                        to = ray[dist-1];
                        between = ray.slice(0, dist-1);
                    }
                    if (to !== undefined) {
                        // can't jump over opposing stacks
                        let hasEnemy = false;
                        for (const cell of between) {
                            if (this.board.has(cell)) {
                                const s = this.board.get(cell)!;
                                if (s[s.length - 1] !== this.currplayer) {
                                    hasEnemy = true;
                                    break;
                                }
                            }
                        }
                        if (!hasEnemy) {
                            // if burying a stack, it must be the same size or smaller
                            // than the substack that's moving
                            if (this.board.has(to)) {
                                const tStack = this.board.get(to)!;
                                if (tStack.length > dist) {
                                    break;
                                }
                            }
                            // if moving entire stack, notation is simpler
                            if (dist === stack.length) {
                                moves.push(`${from}-${to}`);
                            }
                            // otherwise do the subset
                            else {
                                moves.push(`${from}:${dist}-${to}`);
                            }
                        }
                    }
                }
            }
        }

        if (moves.length === 0) {
            return ["pass"];
        }
        return moves.sort((a,b) => a.localeCompare(b));
    }

    public randomMove(): string {
        if (this.variants.includes("pie") && this.stack.length === 1) {
            const cells = shuffle(this.getAllCells()) as string[];
            return `1${cells[0]},2${cells[1]}`;
        } else {
            const moves = this.moves();
            return moves[Math.floor(Math.random() * moves.length)];
        }
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        move = move.toLowerCase();
        move = move.replace(/\s+/g, "");
        try {
            let newmove = "";
            if (row === -1 && col === -1) {
                if (move === "") {
                    newmove = piece!;
                } else {
                    const mvs = move.split(",");
                    if (mvs[mvs.length - 1].length !== 3) {
                        newmove = [...mvs.slice(0, -1), piece!].join(",");
                    } else {
                        newmove = [...mvs, piece!].join(",");
                    }
                }
            } else {
                const cell = this.coords2algebraic(col, row);

                // if first moves, just keep a list of clicked cells
                if (this.variants.includes("pie") && this.stack.length === 1) {
                    const mvs = move.split(",");
                    const last = mvs[mvs.length - 1];
                    if (last === "1" || last === "2") {
                        newmove = move + cell;
                    } else {
                        newmove = move;
                    }
                }
                // otherwise all other moves
                else {
                    // empty move means clicking on an occupied cell to start a move
                    if (move === "") {
                        newmove = cell;
                    }
                    // otherwise you're selecting a destination
                    // autocomplete happens here
                    else {
                        const matches = this.moves().filter(m => m.startsWith(move) && m.endsWith(cell));
                        if (matches.length === 1) {
                            newmove = matches[0];
                        } else {
                            newmove = move + "-" + cell;
                        }
                    }
                }
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
                message: i18next.t("apgames:validation._general.GENERIC", {move, row, col, piece, emessage: (e as Error).message})
            }
        }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const allMoves = this.moves();

        if (m === "") {
            let context = "play";
            if (this.variants.includes("pie")) {
                if (this.stack.length === 1) {
                    context = "offer"
                } else if (this.stack.length === 2) {
                    context = "response";
                }
            }

            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.basalt.INITIAL_INSTRUCTIONS", {context});
            return result;
        }

        if (m === "pass") {
            if (!allMoves.includes("pass")) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.basalt.BAD_PASS");
                return result;
            } else {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
        }

        // pie offers require special handling
        if (this.variants.includes("pie") && this.stack.length === 1) {
            const mvs = m.split(",")
            let p1 = 0; let p2 = 0;
            for (const mv of mvs) {
                if (!mv.startsWith("1") && !mv.startsWith("2")) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.basalt.PIE_PC_FIRST");
                    return result;
                }
                if (mv.startsWith("1")) { p1++; }
                if (mv.startsWith("2")) { p2++; }

                if (mv.length === 1) {
                    result.valid = true;
                    result.complete = -1;
                    result.message = i18next.t("apgames:validation.basalt.PIE_PARTIAL_PLACE", {pc: mv});
                    return result;
                }

                const cell = mv.substring(1);
                const [x,y] = this.algebraic2coords(cell);
                if (!this.validCell(x, y)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.basalt.PIE_BAD_CELL", {cell});
                    return result;
                }
            }

            if (p1 === 0 || p2 === 0) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.basalt.PIE_BOTH_PCS");
                return result;
            }
            if (p1 > 2 || p2 > 2) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.basalt.PIE_TWO_EACH");
                return result;
            }
            if (p1 + p2 > 4) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.basalt.PIE_TWO_FOUR");
                return result;
            }

            result.valid = true;
            result.complete = p1 + p2 < 4 ? 0 : 1;
            result.canrender = true;
            result.message = p1 + p2 < 4 ?
                                i18next.t("apgames:validation.basalt.PIE_PARTIAL") :
                                i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        if (m.length === 2 && allMoves.filter(mv => mv.startsWith(m)).length > 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.basalt.PARTIAL");
            return result;
        } else if (m.length === 2) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.basalt.INITIAL_INSTRUCTIONS", {context: "play"});
            return result;
        }

        if (!allMoves.includes(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.basalt.BAD_MOVE");
            return result;
        }

        // all good
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {trusted = false, partial = false} = {}): BasaltGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        // Normalize
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const allMoves = this.moves();

        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (!partial && ! allMoves.includes(m) && !(this.variants.includes("pie") && this.stack.length === 1)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];
        this.dots = [];

        if (partial) {
            // if partial and pie, draw the pieces
            if (this.variants.includes("pie") && this.stack.length === 1) {
                const mvs = m.split(",");
                for (const mv of mvs) {
                    if (mv.length === 3) {
                        const pc = parseInt(mv[0], 10) as playerid;
                        const cell = mv.substring(1);
                        if (this.board.has(cell)) {
                            const now = this.board.get(cell)!;
                            this.board.set(cell, [...now, pc]);
                        } else {
                            this.board.set(cell, [pc]);
                        }
                    }
                }
            }
            // otherwise just draw the dots
            else {
                this.dots = allMoves.filter(mv => mv.startsWith(m)).map(mv => mv.split("-")[1]);
            }
            return this;
        }

        // handle openings first
        if (this.variants.includes("pie") && this.stack.length === 1) {
            const mvs = m.split(",");
            for (const mv of mvs) {
                const p = parseInt(mv[0], 10) as playerid;
                const cell = mv.substring(1);
                if (this.board.has(cell)) {
                    this.board.set(cell, [...this.board.get(cell)!, p]);
                } else {
                    this.board.set(cell, [p]);
                }
                this.results.push({type: "place", where: cell, what: p.toString()});
            }
        }
        // all other moves
        else {
            if (m === "pass") {
                this.results.push({type: "pass"});
            } else {
                const [left, to] = m.split("-");
                const [from, heightStr] = left.split(":");
                // moving substack
                if (left.includes(":")) {
                    const height = parseInt(heightStr, 10);
                    if (isNaN(height)) {
                        throw new Error(`Could not interpret the substack height from "${m}."`);
                    }
                    const fStack = this.board.get(from)!;
                    const staying = fStack.slice(0, height * -1);
                    const moving = fStack.slice(height * -1);
                    const tStack = this.board.get(to);
                    if (tStack !== undefined) {
                        this.board.set(to, [...tStack, ...moving, this.currplayer]);
                    } else {
                        this.board.set(to, [...moving, this.currplayer]);
                    }
                    this.board.set(from, [...staying]);
                    this.results.push({type: "move", from, to, count: height});
                }
                // moving entire stack
                else {
                    const fStack = this.board.get(from)!;
                    const tStack = this.board.get(to);
                    if (tStack !== undefined) {
                        this.board.set(to, [...tStack, ...fStack, this.currplayer]);
                    } else {
                        this.board.set(to, [...fStack, this.currplayer]);
                    }
                    this.board.delete(from);
                    this.results.push({type: "move", from, to, count: fStack.length});
                }
            }
        }

        // update currplayer
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

    public isConnected(player?: playerid): boolean {
        if (player === undefined) {
            player = this.currplayer;
        }
        const g = this.graph;
        for (const cell of this.getAllCells()) {
            if (!this.board.has(cell)) {
                g.dropNode(cell);
            } else {
                const stack = this.board.get(cell)!;
                if (stack[stack.length - 1] !== player) {
                    g.dropNode(cell);
                }
            }
        }
        const edges = this.edges;
        for (const grp of connectedComponents(g)) {
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

    protected checkEOG(): BasaltGame {
        // connection win triggers immediately
        const other = this.currplayer === 1 ? 2 : 1;
        if (this.isConnected(other)) {
            this.gameover = true;
            this.winner = [other];
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IBasaltState {
        return {
            game: BasaltGame.gameinfo.uid,
            numplayers: 2,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: BasaltGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: deepclone(this.board) as Map<string, playerid[]>,
        };
    }

    public render(): APRenderRep {
        // Build piece string
        const pieces: string[][] = [];
        for (let y = 0; y < this.boardSize; y++) {
            const nodes: string[] = [];
            for (let x = 0; x <= y; x++) {
                const cell = this.coords2algebraic(x, y);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    nodes.push(contents.map(c => c === 1 ? "A" : "B").join(""));
                } else {
                    nodes.push("-");
                }
            }
            pieces.push(nodes);
        }
        const pstr: string = pieces.map(r => r.join(",")).join("\n");

        // Build rep
        const rep: APRenderRep =  {
            options: ["reverse-letters"],
            renderer: "stacking-offset",
            board: {
                style: "hex-of-hex",
                minWidth:  1,
                maxWidth: this.boardSize,
                half: "top",
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

        if (this.variants.includes("pie") && this.stack.length === 1) {
            // Add key so the user can click to select the color to place
            const lst = [];
            if (pieces.flat().filter(p => p === "A").length < 2) {
                lst.push({ piece: "A", name: "", value: "1"});
            }
            if (pieces.flat().filter(p => p === "B").length < 2) {
                lst.push({ piece: "B", name: "", value: "2"});
            }
            if (lst.length > 0) {
                const key: AreaKey = {
                    type: "key",
                    position: "left",
                    height: 0.7,
                    list: lst,
                    clickable: true
                };
                rep.areas = [key];
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
        if (this.dots.length > 0) {
            if (!("annotations" in rep)) {
                rep.annotations = [];
            }
            for (const cell of this.dots) {
                const [x, y] = this.algebraic2coords(cell);
                rep.annotations!.push({type: "dots", targets: [{row: y, col: x}]});
            }
        }

        return rep;
    }

    public clone(): BasaltGame {
        return Object.assign(new BasaltGame(), deepclone(this) as BasaltGame);
        // return new BasaltGame(this.serialize());
    }

    public getCustomRotation(): number | undefined {
        return 120;
    }
}
