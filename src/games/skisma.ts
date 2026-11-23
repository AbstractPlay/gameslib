import { GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IValidationResult } from "./_base.js";
import type { APGamesInformation } from "../schemas/gameinfo.js";
import type { APRenderRep, BoardBasic, MarkerFlood, RowCol } from "@abstractplay/renderer/build/schemas/schema";
import type { APMoveResult } from "../schemas/moveresults.js";
import { HexTriGraph, reviver, UserFacingError } from "../common/index.js";

import i18next from "i18next";

export const gameApgamesEn = {
    validation: {
        INSTRUCTIONS: "Select an empty cell to place a stone.",
        SUICIDE: "You may not place a stone at {{where}}: it would be surrounded.",
    },
    variants: {
        "#board": { name: "Hexhex 6" },
        "size-7": { name: "Hexhex 7" },
        "size-8": { name: "Hexhex 8" },
        "size-9": { name: "Hexhex 9" },
        "square-9": { name: "Square 9x9" },
        "square-11": { name: "Square 11x11" },
        "square-13": { name: "Square 13x13" },
        "square-15": { name: "Square 15x15" },
    },
    displays: {
        "hide-enclosed": {
            name: "Hide enclosed zones",
            description: "Don't shade the zones enclosed by each player's groups, where the other player may only play a winning move.",
        },
    },
};

export const gameApresultsEn = {
    EOG: {
        surround: "The game has ended because an enemy stone was surrounded.",
    },
};

type playerid = 1 | 2;

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
}

export interface ISkismaState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
}

/** Board geometry: cell names, the two adjacencies and the edge. */
interface IGeometry {
    square: boolean;
    size: number;
    cells: string[];
    /** adjacency of stones in a group */
    gadj: Map<string, string[]>;
    /** adjacency of paths (sides of a group) */
    padj: Map<string, string[]>;
    edge: Set<string>;
    coords: Map<string, [number, number]>;
    hexGraph?: HexTriGraph;
}

/** A side of a group: a connected area of the cells outside it. */
interface ISide {
    cells: string[];
    edges: number;
}

export class SkismaGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Skisma",
        uid: "skisma",
        playercounts: [2],
        version: "20261123",
        dateAdded: "2026-11-22",
        description: "Surround one enemy stone with a single group to win: cut it off from half of the board's edge.",
        notes: "A stone is surrounded when, because of a single enemy group, it can reach fewer than half of the edge cells. Paths may go through any cell except that group's stones. You may not place a stone where it would be surrounded, unless that placement wins. A player with no legal move loses, also when the board is full: whoever fills the last cell wins, and there are no draws. On square boards, stones connect into groups diagonally as well as orthogonally, but paths only go orthogonally, so a diagonal chain is a wall.",
        urls: [],
        people: [
            {
                type: "designer",
                name: "Noé Falzon",
                urls: ["https://boardgamegeek.com/boardgamedesigner/164706/noe-falzon"],
                apid: "89144a32-7a68-41b4-a443-f98ed3c6df01",
            },
            {
                type: "coder",
                name: "Castux",
                urls: [],
                apid: "89144a32-7a68-41b4-a443-f98ed3c6df01",
            },
        ],
        variants: [
            { uid: "#board" },
            { uid: "size-7", group: "board" },
            { uid: "size-8", group: "board" },
            { uid: "size-9", group: "board" },
            { uid: "square-9", group: "board" },
            { uid: "square-11", group: "board" },
            { uid: "square-13", group: "board" },
            { uid: "square-15", group: "board" },
        ],
        categories: ["goal>cripple", "goal>isolate", "goal>immobilize", "mechanic>place", "mechanic>enclose", "board>shape>hex", "board>shape>rect", "board>connect>hex", "board>connect>rect", "components>simple>1per"],
        flags: ["experimental"],
        displays: [{ uid: "hide-enclosed" }],
    };

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private geo!: IGeometry;

    constructor(state?: ISkismaState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = this.applyVariantConstraints(variants);
            }
            const fresh: IMoveState = {
                _version: SkismaGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                if (!state.startsWith("{") && !state.startsWith("[")) {
                    throw new Error("Compressed game state must be decompressed before constructing the engine.");
                }
                state = JSON.parse(state, reviver) as ISkismaState;
            }
            if (state.game !== SkismaGame.gameinfo.uid) {
                throw new Error(`The Skisma game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.geo = SkismaGame.geometry(this.variants);
        this.load();
    }

    public load(idx = -1): SkismaGame {
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
        this.board = new Map(state.board);
        this.lastmove = state.lastmove;
        return this;
    }

    private static geometry(variants: string[]): IGeometry {
        let size = 6;
        let square = false;
        for (const v of variants) {
            const m = v.match(/^(size|square)-(\d+)$/);
            if (m !== null) {
                square = m[1] === "square";
                size = parseInt(m[2], 10);
            }
        }
        const geo: IGeometry = { square, size, cells: [], gadj: new Map(), padj: new Map(), edge: new Set(), coords: new Map() };
        if (square) {
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    const cell = GameBase.coords2algebraic(x, y, size);
                    geo.cells.push(cell);
                    geo.coords.set(cell, [x, y]);
                    if (x === 0 || y === 0 || x === size - 1 || y === size - 1) {
                        geo.edge.add(cell);
                    }
                }
            }
            for (const cell of geo.cells) {
                const [x, y] = geo.coords.get(cell)!;
                const orth: string[] = [];
                const all: string[] = [];
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const nx = x + dx;
                        const ny = y + dy;
                        if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= size || ny >= size) {
                            continue;
                        }
                        const n = GameBase.coords2algebraic(nx, ny, size);
                        all.push(n);
                        if (dx === 0 || dy === 0) {
                            orth.push(n);
                        }
                    }
                }
                geo.padj.set(cell, orth);
                geo.gadj.set(cell, all);
            }
        } else {
            const graph = new HexTriGraph(size, size * 2 - 1);
            geo.hexGraph = graph;
            for (const cell of graph.listCells(false) as string[]) {
                geo.cells.push(cell);
                geo.coords.set(cell, graph.algebraic2coords(cell));
                const ns = graph.neighbours(cell);
                geo.gadj.set(cell, ns);
                geo.padj.set(cell, ns);
                if (ns.length < 6) {
                    geo.edge.add(cell);
                }
            }
        }
        return geo;
    }

    public coords2algebraic(x: number, y: number): string {
        if (this.geo.square) {
            return GameBase.coords2algebraic(x, y, this.geo.size);
        }
        return this.geo.hexGraph!.coords2algebraic(x, y);
    }

    public algebraic2coords(cell: string): [number, number] {
        const c = this.geo.coords.get(cell);
        if (c === undefined) {
            throw new Error(`Invalid cell ${cell}`);
        }
        return c;
    }

    /** The group of `player`'s stones containing `cell` (board must hold it). */
    private groupOf(board: Map<string, playerid>, cell: string, player: playerid): Set<string> {
        const group = new Set<string>([cell]);
        const todo = [cell];
        while (todo.length > 0) {
            const c = todo.pop()!;
            for (const n of this.geo.gadj.get(c)!) {
                if (!group.has(n) && board.get(n) === player) {
                    group.add(n);
                    todo.push(n);
                }
            }
        }
        return group;
    }

    /**
     * The sides of a group that are small: fewer than half of all the edge
     * cells (the group's own included). A wall that halves the edge makes
     * both halves small.
     */
    private smallSides(group: Set<string>): ISide[] {
        const total = this.geo.edge.size;
        const seen = new Set<string>();
        const sides: ISide[] = [];
        for (const start of this.geo.cells) {
            if (group.has(start) || seen.has(start)) {
                continue;
            }
            const side: ISide = { cells: [], edges: 0 };
            seen.add(start);
            const todo = [start];
            while (todo.length > 0) {
                const c = todo.pop()!;
                side.cells.push(c);
                if (this.geo.edge.has(c)) {
                    side.edges++;
                }
                for (const n of this.geo.padj.get(c)!) {
                    if (!group.has(n) && !seen.has(n)) {
                        seen.add(n);
                        todo.push(n);
                    }
                }
            }
            if (2 * side.edges < total) {
                sides.push(side);
            }
        }
        return sides;
    }

    /**
     * The small sides of the group of `player`'s stone on `cell` that hold an
     * enemy stone, if `player` places there (empty if none).
     */
    private surrounds(cell: string, player: playerid): ISide[] {
        const board = new Map(this.board);
        board.set(cell, player);
        const group = this.groupOf(board, cell, player);
        if (group.size === 1) {
            return [];
        }
        const enemy = player === 1 ? 2 : 1;
        return this.smallSides(group).filter(s => s.cells.some(c => board.get(c) === enemy));
    }

    /** Cells lying in a small side of one of `player`'s groups. */
    private enclosedBy(player: playerid): Set<string> {
        const result = new Set<string>();
        const done = new Set<string>();
        for (const [cell, owner] of this.board) {
            if (owner !== player || done.has(cell)) {
                continue;
            }
            const group = this.groupOf(this.board, cell, player);
            for (const c of group) {
                done.add(c);
            }
            if (group.size === 1) {
                continue;
            }
            for (const side of this.smallSides(group)) {
                for (const c of side.cells) {
                    result.add(c);
                }
            }
        }
        return result;
    }

    private hasLegalMove(player: playerid): boolean {
        const forbidden = this.enclosedBy(player === 1 ? 2 : 1);
        return this.geo.cells.some(c => this.isLegal(c, player, forbidden));
    }

    private isLegal(cell: string, player: playerid, forbidden: Set<string>): boolean {
        if (this.board.has(cell)) {
            return false;
        }
        return !forbidden.has(cell) || this.surrounds(cell, player).length > 0;
    }

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) {
            return [];
        }
        const forbidden = this.enclosedBy(player === 1 ? 2 : 1);
        return this.geo.cells.filter(c => this.isLegal(c, player, forbidden)).sort((a, b) => a.localeCompare(b));
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            const result = this.validateMove(cell) as IClickResult;
            result.move = result.valid ? cell : "";
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", { move, row, col, piece, emessage: (e as Error).message }),
            };
        }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = { valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER") };
        m = m.toLowerCase().replace(/\s+/g, "");
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.skisma.INSTRUCTIONS");
            return result;
        }
        if (!this.geo.coords.has(m)) {
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: m });
            return result;
        }
        if (this.board.has(m)) {
            result.message = i18next.t("apgames:validation._general.OCCUPIED", { where: m });
            return result;
        }
        const forbidden = this.enclosedBy(this.currplayer === 1 ? 2 : 1);
        if (!this.isLegal(m, this.currplayer, forbidden)) {
            result.message = i18next.t("apgames:validation.skisma.SUICIDE", { where: m });
            return result;
        }
        result.valid = true;
        result.complete = 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, { partial = false, trusted = false } = {}): SkismaGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:validation._general.MOVES_GAMEOVER"));
        }
        m = m.toLowerCase().replace(/\s+/g, "");
        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
        }
        if (m.length === 0) {
            return this;
        }
        this.results = [];
        const won = this.surrounds(m, this.currplayer).length > 0;
        this.board.set(m, this.currplayer);
        this.results.push({ type: "place", where: m });
        if (partial) {
            return this;
        }
        this.lastmove = m;
        const mover = this.currplayer;
        this.currplayer = mover === 1 ? 2 : 1;
        this.checkEOG(won ? mover : undefined);
        this.saveState();
        return this;
    }

    protected checkEOG(surrounder?: playerid): SkismaGame {
        if (surrounder !== undefined) {
            this.gameover = true;
            this.winner = [surrounder];
            this.results.push({ type: "eog", reason: "surround" });
        } else if (!this.hasLegalMove(this.currplayer)) {
            // also a full board: no draws
            this.gameover = true;
            this.winner = [this.currplayer === 1 ? 2 : 1];
            this.results.push({ type: "eog", reason: "stalemate" });
        }
        if (this.gameover) {
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public state(): ISkismaState {
        return {
            game: SkismaGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: SkismaGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    private toRowCol(cells: Iterable<string>): RowCol[] {
        return [...cells].map(c => {
            const [x, y] = this.algebraic2coords(c);
            return { row: y, col: x };
        });
    }

    public render(opts?: IRenderOpts): APRenderRep {
        const showEnclosed = !this.hasDisplay(opts, "hide-enclosed");
        let pstr: string;
        if (this.geo.square) {
            const rows: string[] = [];
            for (let y = 0; y < this.geo.size; y++) {
                let row = "";
                for (let x = 0; x < this.geo.size; x++) {
                    const owner = this.board.get(this.coords2algebraic(x, y));
                    row += owner === 1 ? "A" : owner === 2 ? "B" : "-";
                }
                rows.push(row);
            }
            pstr = rows.join("\n");
        } else {
            const cells = this.geo.hexGraph!.listCells(true) as string[][];
            pstr = cells.map(row => row.map(c => {
                const owner = this.board.get(c);
                return owner === 1 ? "A" : owner === 2 ? "B" : "-";
            }).join("")).join("\n");
        }

        const rep: APRenderRep = {
            board: this.geo.square
                ? { style: "squares", width: this.geo.size, height: this.geo.size }
                : { style: "hex-of-hex", minWidth: this.geo.size, maxWidth: this.geo.size * 2 - 1 },
            legend: {
                A: [{ name: "piece", colour: 1 }],
                B: [{ name: "piece", colour: 2 }],
            },
            pieces: pstr,
        };

        // Enclosed zones: the small sides of each player's groups (where the
        // opponent may only play a winning move), in that player's colour.
        // At the end, the surrounded stone lies in a zone of the winner's
        // colour.
        const markers: MarkerFlood[] = [];
        if (showEnclosed) {
            for (const p of [1, 2] as playerid[]) {
                const cells = [...this.enclosedBy(p)];
                if (cells.length > 0) {
                    markers.push({ type: "flood", colour: p, opacity: 0.25, points: this.toRowCol(cells) as [RowCol, ...RowCol[]] });
                }
            }
        }
        if (markers.length > 0) {
            (rep.board as BoardBasic).markers = markers;
        }

        if (this.results.length > 0) {
            rep.annotations = [];
            for (const r of this.results) {
                if (r.type === "place") {
                    const [x, y] = this.algebraic2coords(r.where!);
                    rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                }
            }
        }
        return rep;
    }

    public clone(): SkismaGame {
        return new SkismaGame(this.serialize());
    }
}
