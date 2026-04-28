import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError, intersects } from "../common";
import { UndirectedGraph } from "graphology";
import { connectedComponents } from "graphology-components";
import { bidirectional } from "graphology-shortest-path";
import i18next from "i18next";

type playerid = 1|2;
type Directions = "NE"|"E"|"SE"|"SW"|"W"|"NW";
const allDirections: Directions[] = ["NE", "E", "SE", "SW", "W", "NW"];

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
    connPath: string[];
}

export interface IYState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class YGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Y",
        uid: "y",
        playercounts: [2],
        version: "20260429",
        dateAdded: "2026-04-29",
        // i18next.t("apgames:descriptions.y")
        description: "apgames:descriptions.y",
        urls: ["https://boardgamegeek.com/boardgame/5242/the-game-of-y"],
        people: [
            {
                type: "designer",
                name: "Charles Titus",
                urls: ["https://boardgamegeek.com/boardgamedesigner/1663/charles-titus"],
            },
            {
                type: "designer",
                name: "Craige Schensted (Ea Ea)",
                urls: ["https://boardgamegeek.com/boardgamedesigner/1664/ea-ea"],
            },
            {
                type: "coder",
                name: "João Pedro Neto",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3829/joao-pedro-neto"],
                apid: "9228bccd-a1bd-452b-b94f-d05380e6638f",
            },
        ],
        variants: [
            { uid: "#board", }, // hextri13
            { uid: "size-15", group: "board" },
            { uid: "size-19", group: "board" },
            { uid: "size-21", group: "board" },
        ],
        categories: ["goal>connect", "mechanic>place",  "board>shape>tri", "board>connect>hex", "components>simple>1per"],
        flags: ["pie", "experimental"],
    };
    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private boardSize = 9;
    public connPath: string[] = [];

    constructor(state?: IYState | string, variants?: string[]) {
        super();
        if (state !== undefined) {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IYState;
            }
            if (state.game !== YGame.gameinfo.uid) {
                throw new Error(`The Y game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.variants = [...state.variants];
            this.winner = [...state.winner];
            this.stack = [...state.stack];
        } else {
            if ( (variants !== undefined) && (variants.length > 0) ) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: YGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map<string,playerid>(),
                connPath: [],
            };
            this.stack = [fresh];
        }
        this.load();
    }

    public load(idx = -1): YGame {
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
        this.board = new Map(state.board);
        this.boardSize = this.getBoardSize();
        this.lastmove = state.lastmove;
        return this;
    }

    private getBoardSize(): number {
        // Get board size from variants.
        if ( (this.variants !== undefined) && (this.variants.length > 0) && (this.variants[0] !== undefined) && (this.variants[0].length > 0) ) {
            const sizeVariants = this.variants.filter(v => v.includes("size"));
            if (sizeVariants.length > 0) {
                const size = sizeVariants[0].match(/\d+/);
                return parseInt(size![0], 10);
            }
            if (isNaN(this.boardSize)) {
                throw new Error(`Could not determine the board size from variant "${this.variants[0]}"`);
            }
        }
        return 13;
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
        if (player === undefined) { player = this.currplayer; }

        /*const moves: string[] = [];
        for(const cell of this.getAllCells()) {
            if (! this.board.has(cell) ) {
                moves.push(cell);
            }
        }

        return moves.sort((a,b) => a.localeCompare(b));*/
        return this.getAllCells()
                   .filter(c => !this.board.has(c))
                   .sort((a,b) => a.localeCompare(b));
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const newmove = move === "" ? this.coords2algebraic(col, row) : "";

            const result = this.validateMove(newmove) as IClickResult;
            result.move = result.valid ? newmove : move;
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
        const result: IValidationResult = {valid: false,
                                           message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.y.INSTRUCTIONS");
            return result;
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if ( this.board.has(m) ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: m});
            return result;
        }

        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {trusted = false, partial = false} = {}): YGame {
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
            if ( !partial && ! this.moves().includes(m) ) {
                throw new UserFacingError("VALIDATION_FAILSAFE",
                                          i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];
        this.board.set(m, this.currplayer);
        this.results.push({type: "place", where: m});

        if (partial) { return this; }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    private buildPath(g: UndirectedGraph): void {
        const [left, right, bottom] = this.edges;
        const lr: string[][] = [];
        for (const l of left) {
            for (const r of right) {
                if (g.hasNode(l) && g.hasNode(r)) {
                    const path = bidirectional(g, l, r);
                    if (path !== null) {
                        lr.push(path);
                    }
                }
            }
        }
        const rb: string[][] = [];
        for (const r of right) {
            for (const b of bottom) {
                if (g.hasNode(r) && g.hasNode(b)) {
                    const path = bidirectional(g, r, b);
                    if (path !== null) {
                        rb.push(path);
                    }
                }
            }
        }
        const lb: string[][] = [];
        for (const l of left) {
            for (const b of bottom) {
                if (g.hasNode(l) && g.hasNode(b)) {
                    const path = bidirectional(g, l, b);
                    if (path !== null) {
                        lb.push(path);
                    }
                }
            }
        }
        for (const lrPath of lr) {
            const rbMatch = rb.find(p => p[0] === lrPath[lrPath.length - 1]);
            if (rbMatch !== undefined) {
                this.connPath = [...lrPath.slice(0, -1), ...rbMatch];
                return;
            }
        }
        throw new Error("Could not build a path");
    }

    public isConnected(player?: playerid): boolean {
        if (player === undefined) {
            player = this.currplayer;
        }
        const g = this.graph;
        for (const cell of this.getAllCells()) {
            if ( !this.board.has(cell) || this.board.get!(cell) !== player ) {
                g.dropNode(cell);
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
                this.buildPath(g)
                return true;
            }
        }
        return false;
    }

    protected checkEOG(): YGame {
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

    public state(): IYState {
        return {
            game: YGame.gameinfo.uid,
            numplayers: 2,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: YGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            connPath: [...this.connPath],
        };
    }

    public render(): APRenderRep {
        // Build piece string
        const pstr: string[][] = [];
        for (let y = 0; y < this.boardSize; y++) {
            const pieces: string[] = [];
            for (let x = 0; x <= y; x++) {
                const cell = this.coords2algebraic(x, y);
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

        // Build rep
        const rep: APRenderRep =  {
            options: ["reverse-letters"],
            board: {
                style: "hex-of-hex",
                minWidth: 1,
                maxWidth: this.boardSize,
                half: "top",
            },
            legend: {
                A: { name: "piece", colour: 1 },
                B: { name: "piece", colour: 2 },
            },
            pieces: pstr.map(p => p.join("")).join("\n"),
        };

        // Add annotations
        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }
        if ( this.isConnected(this.currplayer === 1 ? 2 : 1) ) {
            const targets: RowCol[] = [];
            for (const cell of this.connPath) {
                const [x, y] = this.algebraic2coords(cell);
                targets.push({ row: y, col: x })
            }
            rep.annotations.push({ type: "move", targets: targets as [RowCol, ...RowCol[]], arrow: false});
        }

        return rep;
    }

    public clone(): YGame {
        return new YGame(this.serialize());
    }
}