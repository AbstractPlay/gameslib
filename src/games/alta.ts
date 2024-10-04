import { GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, AreaKey, MarkerFlood, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { UndirectedGraph } from "graphology";
import { bidirectional } from "graphology-shortest-path";

type playerid = 1 | 2;
type PlayerLines = [string[], string[]];
const colLabels = "abcdefghijklmnopqrstuvwxyz".split("");
type pieceid = "/" | "\\";
export type CellContents = [playerid, pieceid]

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    connPath: string[];
    lastmove?: string;
}

export interface IAltaState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class AltaGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Alta",
        uid: "alta",
        playercounts: [2],
        version: "20240929",
        dateAdded: "2024-09-29",
        // i18next.t("apgames:descriptions.alta")
        description: "apgames:descriptions.alta",
        // i18next.t("apgames:notes.alta")
        notes: "apgames:notes.alta",
        urls: ["https://boardgamegeek.com/boardgame/40658/alta"],
        people: [
            {
                type: "designer",
                name: "Dan Troyka",
                urls: ["https://boardgamegeek.com/boardgamedesigner/1543/dan-troyka"]
            },
        ],
        variants: [
            { uid: "size-13", group: "board", experimental: true },
        ],
        categories: ["goal>connect", "mechanic>place", "board>shape>rect", "board>connect>rect", "components>simple"],
        flags: ["experimental", "pie"],
        displays: [{ uid: "hide-panel" }],
    };

    public coords2algebraic(x: number, y: number): string {
        if (y % 2 === 0) {
            return GameBase.coords2algebraic(x, y / 2, this.boardSize);
        } else {
            return "*" + GameBase.coords2algebraic(x + 1, (y + 1) / 2 - 1, this.boardSize);
        }
    }

    public algebraic2coords(cell: string): [number, number] {
        if (cell[0] === "*") {
            const [x, y] = GameBase.algebraic2coords(cell.slice(1), this.boardSize);
            return [x - 1, 2 * (y + 1) - 1];
        } else {
            const [x, y] = GameBase.algebraic2coords(cell, this.boardSize);
            return [x, 2 * y];
        }
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, CellContents>;
    public connPath: string[] = [];
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private boardSize = 0;
    private dots: string[] = [];
    private lines: [PlayerLines,PlayerLines];
    private blockedSpaces: Set<string>;
    private selected: pieceid | undefined;

    constructor(state?: IAltaState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: AltaGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                connPath: [],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IAltaState;
            }
            if (state.game !== AltaGame.gameinfo.uid) {
                throw new Error(`The Alta game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
        this.lines = this.getLines();
        this.blockedSpaces = this.getBlockedSpaces();
    }

    public load(idx = -1): AltaGame {
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
        this.board = [...state.board].reduce((m, [k, v]) => m.set(k, [v[0], v[1]]), new Map<string, CellContents>());
        this.connPath = [...state.connPath];
        this.lastmove = state.lastmove;
        this.boardSize = this.getBoardSize();
        return this;
    }

    private getLines(): [PlayerLines,PlayerLines] {
        const halfBoard = (this.boardSize - 1) / 2;
        const lineN = [this.coords2algebraic(halfBoard - 1, -1), this.coords2algebraic(halfBoard, -1)];
        const lineS = [this.coords2algebraic(halfBoard - 1, 2 * this.boardSize - 1), this.coords2algebraic(halfBoard, 2 * this.boardSize - 1)];
        const lineE = [this.coords2algebraic(-1, this.boardSize - 2), this.coords2algebraic(-1, this.boardSize)]
        const lineW = [this.coords2algebraic(this.boardSize - 1, this.boardSize - 2), this.coords2algebraic(this.boardSize - 1, this.boardSize)]
        return [[lineN, lineS], [lineE, lineW]];
    }

    private getBlockedSpaces(): Set<string> {
        // Get all blocked spaces.
        const blocked = new Set<string>();
        const halfBoard = (this.boardSize - 1) / 2;
        for (let i = 0; i < halfBoard - 1; i++) {
            for (let j = 0; j < halfBoard - 1 - i; j++) {
                blocked.add(this.coords2algebraic(j, 2 * i));
                blocked.add(this.coords2algebraic(this.boardSize - j - 1, 2 * i));
                blocked.add(this.coords2algebraic(j, 2 * (this.boardSize - i - 1)));
                blocked.add(this.coords2algebraic(this.boardSize - j - 1, 2 * (this.boardSize - i - 1)));
            }
        }
        return blocked;
    }

    private getBlockedVertices(): Set<string> {
        // Get all blocked vertices.
        const blocked = new Set<string>();
        const halfBoard = (this.boardSize - 1) / 2;
        for (let i = 0; i < halfBoard - 1; i++) {
            for (let j = 0; j < halfBoard - 1 - i; j++) {
                blocked.add(this.coords2algebraic(j - 1, 2 * i - 1));
                blocked.add(this.coords2algebraic(this.boardSize - 1 - j, 2 * i - 1));
                blocked.add(this.coords2algebraic(j - 1, 2 * (this.boardSize - i) - 1));
                blocked.add(this.coords2algebraic(this.boardSize - 1 - j, 2 * (this.boardSize - i) - 1));
            }
        }
        return blocked;
    }

    private getPlayerSpaces(player: playerid): string[] {
        // Return the six spaces for a player.
        if (player === 1) {
            const halfBoard = (this.boardSize - 1) / 2;
            return [
                this.coords2algebraic(halfBoard, 0),
                this.coords2algebraic(halfBoard - 1, 0),
                this.coords2algebraic(halfBoard + 1, 0),
                this.coords2algebraic(halfBoard - 1, 2 * this.boardSize - 2),
                this.coords2algebraic(halfBoard, 2 * this.boardSize - 2),
                this.coords2algebraic(halfBoard + 1, 2 * this.boardSize - 2),
            ];
        }
        return [
            this.coords2algebraic(0, this.boardSize - 1),
            this.coords2algebraic(0, this.boardSize - 3),
            this.coords2algebraic(0, this.boardSize + 1),
            this.coords2algebraic(this.boardSize - 1, this.boardSize - 1),
            this.coords2algebraic(this.boardSize - 1, this.boardSize - 3),
            this.coords2algebraic(this.boardSize - 1, this.boardSize + 1),
        ];
    }

    private getBoardSize(): number {
        // Get board size from variants.
        if (this.variants !== undefined && this.variants.length > 0 && this.variants[0] !== undefined && this.variants[0].length > 0) {
            const sizeVariants = this.variants.filter(v => v.includes("size"));
            if (sizeVariants.length > 0) {
                const size = sizeVariants[0].match(/\d+/);
                return parseInt(size![0], 10);
            }
            if (isNaN(this.boardSize)) {
                throw new Error(`Could not determine the board size from variant "${this.variants[0]}"`);
            }
        }
        return 9;
    }

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }
        const opponentSpaces = this.getPlayerSpaces(player % 2 + 1 as playerid);
        const moves: string[] = [];
        for (let x = 0; x < this.boardSize; x++) {
            for (let y = 0; y < this.boardSize; y++) {
                const cell = this.coords2algebraic(x, 2 * y);
                if (this.blockedSpaces.has(cell)) { continue; }
                if (opponentSpaces.includes(cell)) { continue; }
                if (this.board.has(cell)) {
                    const [p, orient] = this.board.get(cell)!;
                    if (p === player) {
                        if (orient === "/") {
                            moves.push("\\" + cell + "+");
                        } else {
                            moves.push("/" + cell + "+");
                        }
                    }
                } else {
                    moves.push("/" + cell);
                    moves.push("\\" + cell);
                }
            }
        }
        return moves;
    }

    private getAllSpaces(): string[] {
        // Get all spaces on the board.
        const spaces: string[] = [];
        for (let x = 0; x < this.boardSize; x++) {
            for (let y = 0; y < this.boardSize; y++) {
                const space = this.coords2algebraic(x, 2 * y);
                if (this.blockedSpaces.has(space)) { continue; }
                spaces.push(space);
            }
        }
        return spaces;
    }

    private getAllVertices(): string[] {
        // Get all vertices on the board.
        const vertices: string[] = [];
        for (let x = -1; x < this.boardSize; x++) {
            for (let y = -1; y < this.boardSize; y++) {
                const vertex = this.coords2algebraic(x, 2 * y + 1);
                if (this.getBlockedVertices().has(vertex)) { continue; }
                vertices.push(vertex);
            }
        }
        return vertices;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    private vertices2place(vertex1: string, vertex2: string, addToggleSuffix = false): string | undefined {
        // Convert two vertices into a place move.
        const [x1, y1] = this.algebraic2coords(vertex1);
        const [x2, y2] = this.algebraic2coords(vertex2);
        if (y2 % 2 === 0) { return undefined; }
        const xDiff = Math.abs(x1 - x2);
        const yDiff = Math.abs(y1 - y2);
        if (xDiff !== yDiff / 2) { return undefined; }
        if (yDiff !== 2) { return undefined; }
        const xL = Math.min(x1, x2);
        const yU = Math.max(y1, y2);
        const isRising = y2 > y1 !== x2 > x1;
        const cell = this.coords2algebraic(xL, yU).slice(1);
        if (addToggleSuffix && this.board.has(cell)) {
            return (isRising ? "/" : "\\") + cell + "+";
        }
        return (isRising ? "/" : "\\") + cell;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = "";
            if (piece === "/" || piece === "\\") {
                if (move === piece) {
                    newmove = "";
                } else {
                    newmove = piece;
                }
            } else if (row > 0 && row < 2 * this.boardSize + 2 && (row % 2 !== 0 || col > 0 && col < this.boardSize + 1)) {
                const cell = this.coords2algebraic(col - 1, row - 2);
                if (row % 2 !== 0) {
                    if (move === "" || move === "/" || move === "\\") {
                        const tos = this.getDots(cell);
                        if (tos.length === 1) {
                            newmove = this.vertices2place(cell, tos[0], true)!;
                        } else {
                            newmove = cell;
                        }
                    } else {
                        if (move === cell) {
                            newmove = "";
                        } else {
                            const place = this.vertices2place(move, cell, true);
                            if (place === undefined) {
                                newmove = cell;
                            } else {
                                newmove = place;
                            }
                        }
                    }
                } else if (move === "/" || move === "\\") {
                    if (this.board.has(cell)) {
                        newmove = move + cell + "+";
                    } else {
                        newmove = move + cell;
                    }
                } else if (this.board.has(cell)) {
                    const [p, orient] = this.board.get(cell)!;
                    if (p === this.currplayer) {
                        if (orient === "/") {
                            newmove = "\\" + cell + "+";
                        } else {
                            newmove = "/" + cell + "+";
                        }
                    } else {
                        newmove = cell;
                    }
                }
            } else {
                newmove = move;
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
                message: i18next.t("apgames:validation._general.GENERIC", { move, row, col, piece, emessage: (e as Error).message })
            }
        }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = { valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER") };
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.alta.INITIAL_INSTRUCTIONS");
            return result;
        }
        if (m === "/" || m === "\\") {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.alta.SELECT_SPACE", { orient: m });
            result.canrender = true;
            return result;
        }
        if (m.startsWith("*")) {
            const [from, to] = m.split("-");
            if (!this.getAllVertices().includes(from)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.alta.INVALID_VERTEX", { vertex: m });
                return result;
            }
            const tos = this.getDots(from);
            if (tos.length === 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.alta.NO_DOTS", { vertex: from });
                return result;
            }
            if (to === undefined || to === "") {
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.alta.SELECT_TO");
                result.canrender = true;
                return result;
            }
            if (tos.includes(to)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.alta.USE_PLACE", { from, to, place: this.vertices2place(from, to) });
                return result;
            }
            result.valid = false;
            result.message = i18next.t("apgames:validation.alta.INVALID_TO", { from, to });
            return result;
        } else {
            const orient = m[0];
            const cell = m.endsWith("+") ? m.slice(1, -1) : m.slice(1);
            if (!this.getAllSpaces().includes(cell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.alta.INVALID_SPACE", { space: cell });
                return result;
            }
            const opponentSpaces = this.getPlayerSpaces(this.currplayer % 2 + 1 as playerid);
            if (opponentSpaces.includes(cell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.alta.OPPONENT_SPACE", { where: cell });
                return result;
            }
            if (this.board.has(cell)) {
                const [player, dir] = this.board.get(cell)!;
                if (player !== this.currplayer) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.UNCONTROLLED", { where: cell });
                    return result;
                }
                if (dir === orient) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.alta.ALREADY_OCCUPIED", { orient, where: cell });
                    return result;
                }
                if (!m.endsWith("+")) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.alta.NO_ORIENT_SUFFIX", { move: m + "+" });
                    return result;
                }
            } else if (m.endsWith("+")) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.alta.ORIENT_SUFFIX", { move: m.slice(0, -1) });
                return result;
            }
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private getNeighbours(vertex: string): string[] {
        // Get all neighbours connected to vertex.
        const neighbours: string[] = [];
        const [x, y] = this.algebraic2coords(vertex);
        if (x - 1 >= 0) {
            if (y - 2 >= 0) {
                const to = this.coords2algebraic(x - 1, y - 2);
                const place = this.vertices2place(vertex, to)!;
                const cell = place.slice(1);
                if (!this.blockedSpaces.has(cell) && this.board.has(cell)) {
                    const [, orient] = this.board.get(cell)!;
                    if (orient === "\\") { neighbours.push(to)}
                }
            }
            if (y + 2 <= 2 * this.boardSize) {
                const to = this.coords2algebraic(x - 1, y + 2);
                const place = this.vertices2place(vertex, to)!;
                const cell = place.slice(1);
                if (!this.blockedSpaces.has(cell) && this.board.has(cell)) {
                    const [, orient] = this.board.get(cell)!;
                    if (orient === "/") { neighbours.push(to)}
                }
            }
        }
        if (x + 1 < this.boardSize) {
            if (y - 2 >= 0) {
                const to = this.coords2algebraic(x + 1, y - 2);
                const place = this.vertices2place(vertex, to)!;
                const cell = place.slice(1);
                if (!this.blockedSpaces.has(cell) && this.board.has(cell)) {
                    const [, orient] = this.board.get(cell)!;
                    if (orient === "/") { neighbours.push(to)}
                }
            }
            if (y + 2 <= 2 * this.boardSize) {
                const to = this.coords2algebraic(x + 1, y + 2);
                const place = this.vertices2place(vertex, to)!;
                const cell = place.slice(1);
                if (!this.blockedSpaces.has(cell) && this.board.has(cell)) {
                    const [, orient] = this.board.get(cell)!;
                    if (orient === "\\") { neighbours.push(to)}
                }
            }
        }
        return neighbours;
    }

    private getDots(vertex: string): string[] {
        // Get all the possible vertices to move to.
        const tos: string[] = [];
        const [x, y] = this.algebraic2coords(vertex);
        const opponentSpaces = this.getPlayerSpaces(this.currplayer % 2 + 1 as playerid);
        if (x - 1 >= -1) {
            if (y - 2 >= -1) {
                const to = this.coords2algebraic(x - 1, y - 2);
                const place = this.vertices2place(vertex, to)!;
                const cell = place.slice(1);
                if (this.blockedSpaces.has(cell) || opponentSpaces.includes(cell)) {
                    // tslint:disable-next-line:no-empty
                } else if (!this.board.has(cell)) {
                    tos.push(to);
                } else {
                    const [player, orient] = this.board.get(cell)!;
                    if (player === this.currplayer && orient !== place[0]) {
                        tos.push(to);
                    }
                }
            }
            if (y + 2 <= 2 * this.boardSize) {
                const to = this.coords2algebraic(x - 1, y + 2);
                const place = this.vertices2place(vertex, to)!;
                const cell = place.slice(1);
                if (this.blockedSpaces.has(cell) || opponentSpaces.includes(cell)) {
                    // tslint:disable-next-line:no-empty
                } else if (!this.board.has(cell)) {
                    tos.push(to);
                } else {
                    const [player, orient] = this.board.get(cell)!;
                    if (player === this.currplayer && orient !== place[0]) {
                        tos.push(to);
                    }
                }
            }
        }
        if (x + 1 < this.boardSize) {
            if (y - 2 >= -1) {
                const to = this.coords2algebraic(x + 1, y - 2);
                const place = this.vertices2place(vertex, to)!;
                const cell = place.slice(1);
                if (this.blockedSpaces.has(cell) || opponentSpaces.includes(cell)) {
                    // tslint:disable-next-line:no-empty
                } else if (!this.board.has(cell)) {
                    tos.push(to);
                } else {
                    const [player, orient] = this.board.get(cell)!;
                    if (player === this.currplayer && orient !== place[0]) {
                        tos.push(to);
                    }
                }
            }
            if (y + 2 <= 2 * this.boardSize) {
                const to = this.coords2algebraic(x + 1, y + 2);
                const place = this.vertices2place(vertex, to)!;
                const cell = place.slice(1);
                if (this.blockedSpaces.has(cell) || opponentSpaces.includes(cell)) {
                    // tslint:disable-next-line:no-empty
                } else if (!this.board.has(cell)) {
                    tos.push(to);
                } else {
                    const [player, orient] = this.board.get(cell)!;
                    if (player === this.currplayer && orient !== place[0]) {
                        tos.push(to);
                    }
                }
            }
        }
        return tos;
    }

    public move(m: string, { partial = false, trusted = false } = {}): AltaGame {
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
        this.selected = undefined;
        if (m === "/") {
            this.selected = "/";
        } else if (m === "\\") {
            this.selected = "\\";
        } else if (m.startsWith("*")) {
            this.dots = this.getDots(m);
        } else {
            const orient = m[0];
            const cell = m.endsWith("+") ? m.slice(1, -1) : m.slice(1);
            if (this.board.has(cell)) {
                this.results.push({ type: "orient", where: cell, facing: orient });
            } else {
                this.results.push({ type: "place", where: cell, what: orient });
            }
            this.board.set(cell, [this.currplayer, orient as pieceid]);
        }
        if (partial) { return this; }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    private space2vertices(space: string, orient: pieceid): string[] {
        // Get the two vertices associated with a space.
        const [x, y] = this.algebraic2coords(space);
        if (orient === "/") {
            return ["*" + space, "*" + this.coords2algebraic(x + 1, y - 2)];
        } else {
            return ["*" + this.coords2algebraic(x, y - 2), "*" + this.coords2algebraic(x + 1, y)];
        }
    }

    private getVertices(): string[] {
        // Get all the vertices on the board.
        const vertices: Set<string> = new Set();
        for (const [cell, [, orient]] of this.board) {
            const [v1, v2] = this.space2vertices(cell, orient);
            vertices.add(v1);
            vertices.add(v2);
        }
        return [...vertices];
    }

    private pathVertex2place(path: string[]): string[] {
        // Convert a path of vertices to a path of places.
        const places: string[] = [];
        for (let i = 1; i < path.length; i++) {
            places.push(this.vertices2place(path[i - 1], path[i])!)
        }
        return places;
    }

    private pathPlace2vertex(path: string[]): string[] {
        // Convert a path of places to a path of vertices.
        const vertices: string[] = [];
        for (const [i, place] of path.entries()) {
            const space = place.slice(1);
            const orient = place[0] as pieceid;
            const [v1, v2] = this.space2vertices(space, orient);
            if (i === 0) {
                if (this.lines[0][0].includes(v1) || this.lines[0][1].includes(v1) || this.lines[1][0].includes(v1) || this.lines[1][1].includes(v1)) {
                    vertices.push(v1);
                    vertices.push(v2);
                } else {
                    vertices.push(v2);
                    vertices.push(v1);
                }
            } else {
                if (vertices[vertices.length - 1] === v1) {
                    vertices.push(v2);
                } else {
                    vertices.push(v1);
                }
            }
        }
        return vertices;
    }

    private buildGraph(): UndirectedGraph {
        const graph = new UndirectedGraph();
        // seed nodes
        this.getVertices().forEach(v => {
            graph.addNode(v);
        });
        // for each node, check neighbours
        // if any are in the graph, add an edge
        for (const node of graph.nodes()) {
            for (const n of this.getNeighbours(node)) {
                if (graph.hasNode(n) && !graph.hasEdge(node, n)) {
                    graph.addEdge(node, n);
                }
            }
        }
        return graph;
    }

    protected checkEOG(): AltaGame {
        const otherPlayer = this.currplayer % 2 + 1 as playerid;
        const graph = this.buildGraph();
        for (const player of [otherPlayer, this.currplayer]) {
            const [sources, targets] = this.lines[player - 1];
            for (const source of sources) {
                for (const target of targets) {
                    if (graph.hasNode(source) && graph.hasNode(target)) {
                        const path = bidirectional(graph, source, target);
                        if (path !== null) {
                            this.gameover = true;
                            this.winner = [player];
                            this.connPath = this.pathVertex2place(path);
                            break;
                        }
                    }
                }
                if (this.gameover) { break; }
            }
            if (this.gameover) { break; }
        }
        if (this.gameover) {
            this.results.push({ type: "eog" });
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public state(): IAltaState {
        return {
            game: AltaGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: AltaGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: [...this.board].reduce((m, [k, v]) => m.set(k, [v[0], v[1]]), new Map<string, CellContents>()),
            connPath: [...this.connPath],
        };
    }

    private getBlocked(): RowCol[] {
        const blocked: RowCol[] = [];
        const fullBoard = this.boardSize + 2;
        const halfBoard = (fullBoard - 1) / 2;
        for (let i = 0; i < halfBoard; i++) {
            for (let j = 0; j < halfBoard - i; j++) {
                blocked.push({ row: 2 * i, col: j });
                blocked.push({ row: 2 * i, col: fullBoard - j - 1 });
                blocked.push({ row: 2 * (fullBoard - i - 1), col: j });
                blocked.push({ row: 2 * (fullBoard - i - 1), col: fullBoard - j - 1 });
            }
        }
        for (let i = 0; i < halfBoard - 2; i++) {
            for (let j = 0; j < halfBoard - 2 - i; j++) {
                blocked.push({ row: 2 * i + 1, col: j });
                blocked.push({ row: 2 * i + 1, col: fullBoard - j - 2 });
                blocked.push({ row: 2 * (fullBoard - i - 1) - 1, col: j });
                blocked.push({ row: 2 * (fullBoard - i - 1) - 1, col: fullBoard - j - 2 });
            }
        }
        return blocked;
    }

    public render(opts?: IRenderOpts): APRenderRep {
        let altDisplay: string | undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }
        let hidePanel = false;
        if (altDisplay !== undefined) {
            if (altDisplay === "hide-panel") {
                hidePanel = true;
            }
        }
        // Build piece string
        const pieces = ["_"];
        for (let row = -1; row < 2 * this.boardSize; row++) {
            let pstr = "-";
            for (let col = 0; col < this.boardSize + 1; col++) {
                if (row % 2 === 0 && col === this.boardSize) { continue; }
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const [player, orient] = this.board.get(cell)!;
                    if (player === 1) {
                        if (orient === "/") {
                            pstr += "A";
                        } else {
                            pstr += "B";
                        }
                    } else {
                        if (orient === "/") {
                            pstr += "C";
                        } else {
                            pstr += "D";
                        }
                    }
                } else {
                    pstr += "-";
                }
            }
            if (row % 2 === 0) {
                pstr += "-";
            }
            if (pstr.match(/^-+$/)) {
                pieces.push("_");
            } else {
                pieces.push(pstr);
            }
        }
        pieces.push("_");
        const columnLabels = ["", ...colLabels.slice(0, this.boardSize), ""];
        const rowLabels = ["", ...Array.from({ length: this.boardSize }, (a, i) => (i + 1).toString()), ""];
        const markers: MarkerFlood[] = [
            { type: "flood", colour: 1, opacity: 1, points: [
                { row: 0, col: (this.boardSize + 1) / 2 },
                { row: 2 * (this.boardSize + 1), col: (this.boardSize + 1) / 2 },
            ] },
            { type: "flood", colour: 2, opacity: 1, points: [
                { row: this.boardSize + 1, col: 0 },
                { row: this.boardSize + 1, col: this.boardSize + 1 },
            ] },
            { type: "flood", colour: 1, opacity: 0.2, points: [
                { row: 2, col: (this.boardSize + 1) / 2 },
                { row: 2, col: (this.boardSize + 1) / 2 - 1 },
                { row: 2, col: (this.boardSize + 1) / 2 + 1 },
                { row: 2 * (this.boardSize + 1) - 2, col: (this.boardSize + 1) / 2 },
                { row: 2 * (this.boardSize + 1) - 2, col: (this.boardSize + 1) / 2 - 1 },
                { row: 2 * (this.boardSize + 1) - 2, col: (this.boardSize + 1) / 2 + 1 },
            ] },
            { type: "flood", colour: 2, opacity: 0.2, points: [
                { row: this.boardSize + 1, col: 1 },
                { row: this.boardSize - 1, col: 1 },
                { row: this.boardSize + 3, col: 1 },
                { row: this.boardSize + 1, col: this.boardSize },
                { row: this.boardSize - 1, col: this.boardSize },
                { row: this.boardSize + 3, col: this.boardSize },
            ] },
        ];

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-diamonds",
                width: this.boardSize + 2,
                height: this.boardSize + 2,
                rowLabels,
                columnLabels,
                blocked: this.getBlocked() as [RowCol, ...RowCol[]],
                markers,
            },
            legend: {
                A: [{ name: "dline-pos", colour: 1, scale: 0.9 }],
                B: [{ name: "dline-neg", colour: 1, scale: 0.9 }],
                C: [{ name: "dline-pos", colour: 2, scale: 0.9 }],
                D: [{ name: "dline-neg", colour: 2, scale: 0.9 }],
                A1: [{ name: "piece-borderless", opacity: 0 }, { name: "dline-pos", colour: 1, scale: 0.9 }],
                B1: [{ name: "piece-borderless", opacity: 0 }, { name: "dline-neg", colour: 1, scale: 0.9 }],
                C1: [{ name: "piece-borderless", opacity: 0 }, { name: "dline-pos", colour: 2, scale: 0.9 }],
                D1: [{ name: "piece-borderless", opacity: 0 }, { name: "dline-neg", colour: 2, scale: 0.9 }],
                A2: [{ name: "piece-borderless", colour: "#FFFF00" }, { name: "dline-pos", colour: 1, scale: 0.9 }],
                B2: [{ name: "piece-borderless", colour: "#FFFF00" }, { name: "dline-neg", colour: 1, scale: 0.9 }],
                C2: [{ name: "piece-borderless", colour: "#FFFF00" }, { name: "dline-pos", colour: 2, scale: 0.9 }],
                D2: [{ name: "piece-borderless", colour: "#FFFF00" }, { name: "dline-neg", colour: 2, scale: 0.9 }],
            },
            pieces: pieces.join("\n"),
        };
        if (!hidePanel) {
            const key: AreaKey = {
                type: "key",
                height: 0.7,
                list: this.currplayer === 1 ?
                    [{ piece: this.selected === "/" ? "A2" : "A1", name: "", value: "/"}, { piece: this.selected === "\\" ? "B2" : "B1", name: "", value: "\\"}] :
                    [{ piece: this.selected === "/" ? "C2" : "C1", name: "", value: "/"}, { piece: this.selected === "\\" ? "D2" : "D1", name: "", value: "\\"}],
                clickable: true
            };
            rep.areas = [key];
        }

        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({ type: "enter", targets: [{ row: y + 2, col: x + 1 }] });
                } else if (move.type === "orient") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({ type: "enter", targets: [{ row: y + 2, col: x + 1 }] });
                    rep.annotations.push({ type: "exit", targets: [{ row: y + 2, col: x + 1 }] });
                }
            }
            if (this.connPath.length > 0) {
                const targets: RowCol[] = [];
                for (const cell of this.pathPlace2vertex(this.connPath)) {
                    const [x,y] = this.algebraic2coords(cell);
                    targets.push({ row: y + 2, col: x + 1 })
                }
                rep.annotations.push({ type: "move", targets: targets as [RowCol, ...RowCol[]], arrow: false });
            }
        }
        if (this.dots.length > 0) {
            const points = [];
            for (const cell of this.dots) {
                const [x, y] = this.algebraic2coords(cell);
                points.push({ row: y + 2, col: x + 1 });
            }
            rep.annotations.push({ type: "dots", targets: points as [RowCol, ...RowCol[]] });
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

    public clone(): AltaGame {
        return new AltaGame(this.serialize());
    }
}
