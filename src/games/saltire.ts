import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { UndirectedGraph } from "graphology";
import { bidirectional } from "graphology-shortest-path";

type playerid = 1 | 2;
type PlayerLines = [string[], string[]];

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    connPath: string[];
    crosscutCount: number;
    supercutCount: number;
    lastmove?: string;
}

export interface ISaltireState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class SaltireGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Saltire",
        uid: "saltire",
        playercounts: [2],
        version: "20240316",
        dateAdded: "2024-03-17",
        // i18next.t("apgames:descriptions.saltire")
        description: "apgames:descriptions.saltire",
        urls: ["https://boardgamegeek.com/boardgame/402546/saltire"],
        people: [
            {
                type: "designer",
                name: "Luis Bolaños Mures",
                urls: ["https://boardgamegeek.com/boardgamedesigner/47001/luis-bolanos-mures"]
            },
            {
                type: "coder",
                name: "ypaul",
                urls: [],
                apid: "46f6da78-be02-4469-94cb-52f17078e9c1",
            },
        ],
        variants: [
            { uid: "size-9", group: "board" },
            { uid: "size-11", group: "board" },
            { uid: "#board" },
            { uid: "size-15", group: "board" },
            { uid: "size-17", group: "board" },
            { uid: "basic", group: "ruleset" },
        ],
        categories: ["goal>connect", "mechanic>place", "mechanic>move", "mechanic>coopt", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["pie"],
    };

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardSize);
    }

    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardSize);
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, playerid>;
    public crosscutCount = 0;
    public supercutCount = 0;
    public connPath: string[] = [];
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private boardSize = 0;
    private dots: string[] = [];
    private grid: RectGrid;
    private lines: [PlayerLines,PlayerLines];

    constructor(state?: ISaltireState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: SaltireGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                crosscutCount: 0,
                supercutCount: 0,
                connPath: [],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ISaltireState;
            }
            if (state.game !== SaltireGame.gameinfo.uid) {
                throw new Error(`The Saltire game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
        this.grid = new RectGrid(this.boardSize, this.boardSize);
        this.lines = this.getLines();
    }

    public load(idx = -1): SaltireGame {
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
        this.crosscutCount = state.crosscutCount;
        this.supercutCount = state.supercutCount;
        this.connPath = [...state.connPath];
        this.lastmove = state.lastmove;
        this.boardSize = this.getBoardSize();
        return this;
    }

    private getLines(): [PlayerLines,PlayerLines] {
        const lineN: string[] = [];
        const lineS: string[] = [];
        for (let x = 0; x < this.boardSize; x++) {
            const N = this.coords2algebraic(x, 0);
            const S = this.coords2algebraic(x, this.boardSize - 1);
            lineN.push(N);
            lineS.push(S);
        }
        const lineE: string[] = [];
        const lineW: string[] = [];
        for (let y = 0; y < this.boardSize; y++) {
            const E = this.coords2algebraic(this.boardSize-1, y);
            const W = this.coords2algebraic(0, y);
            lineE.push(E);
            lineW.push(W);
        }
        return [[lineN, lineS], [lineE, lineW]];
    }

    private getBoardSize(): number {
        // Get board size from variants.
        if (this.variants !== undefined && this.variants.length > 0 && this.variants[0] !== undefined && this.variants[0].length > 0) {
            const sizeVariants = this.variants.filter(v => v.includes("size"))
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

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }
        const moves: string[] = [];
        const resolved = new Set<string>();
        for (let x = 0; x < this.boardSize; x++) {
            for (let y = 0; y < this.boardSize; y++) {
                const cell = this.coords2algebraic(x, y);
                if (!this.board.has(cell)) {
                    moves.push(cell);
                } else {
                    const swappable = this.getSwappable(cell, resolved);
                    resolved.add(cell);
                    for (const s of swappable) {
                        moves.push(this.normaliseMove(cell + "-" + s));
                    }
                }
            }
        }
        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            let newmove = "";
            if (!this.board.has(cell)) {
                newmove = cell;
            } else {
                if (move === "") {
                    newmove = cell + "-";
                } else if (move.includes("-")) {
                    newmove = this.normaliseMove(move + cell);
                } else {
                    newmove = move + "-" + cell;
                }
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
                message: i18next.t("apgames:validation._general.GENERIC", { move, row, col, piece, emessage: (e as Error).message })
            }
        }
    }

    private sort(a: string, b: string): number {
        // Sort two cells. This is necessary because "a10" should come after "a9".
        const [ax, ay] = this.algebraic2coords(a);
        const [bx, by] = this.algebraic2coords(b);
        if (ax < bx) { return -1; }
        if (ax > bx) { return 1; }
        if (ay < by) { return 1; }
        if (ay > by) { return -1; }
        return 0;
    }

    private normaliseMove(m: string): string {
        if (m[m.length - 1] === "-") { return m; }
        const split = m.split("-", 2);
        if (split.length === 1) { return m; }
        return split.sort((a, b) => this.sort(a, b)).join("-");
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        m = m.replace(/\s+/g, "");
        m = m.toLowerCase();
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.saltire.INITIAL_INSTRUCTIONS");
            return result;
        }
        const split = m.split("-", 2);
        // Valid cell.
        let currentMove;
        try {
            for (const p of split) {
                if (p === "") { continue; }
                currentMove = p;
                const [x, y] = this.algebraic2coords(p);
                // `algebraic2coords` does not check if the cell is on the board.
                if (x < 0 || x >= this.boardSize || y < 0 || y >= this.boardSize) {
                    throw new Error("Invalid cell");
                }
            }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: currentMove});
            return result;
        }
        // Cell is already occupied.
        if (split.length === 1) {
            if (this.board.has(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", { where: m });
                return result;
            } else {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
        }
        if (!this.board.has(split[0])) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.saltire.EMPTY_FROM", { where: split[0] });
            return result;
        }
        const swappable = this.getSwappable(split[0]);
        if (swappable.length === 0) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.saltire.NO_SWAPPABLE", { where: split[0] });
            return result;
        }
        if (split[1] === "") {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.saltire.SELECT_TO");
            return result;
        }
        if (!swappable.includes(split[1])) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.saltire.INVALID_SWAP", { from: split[0], to: split[1] });
            return result;
        }
        const normalised = this.normaliseMove(m);
        if (normalised !== m) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.saltire.NORMALISE", { move: m, normalised });
            return result;
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private getCrosscutCount(from?: string, to?: string): number {
        // Count the number of crosscuts on the board.
        // Swap the stones if `from` and `to` are provided.
        if (from !== undefined && to !== undefined) {
            this.board.set(from, this.board.get(from)! % 2 + 1 as playerid);
            this.board.set(to, this.board.get(to)! % 2 + 1 as playerid);
        }
        let count = 0;
        for (let x = 0; x < this.boardSize - 1; x++) {
            for (let y = 0; y < this.boardSize - 1; y++) {
                const nw = this.coords2algebraic(x, y);
                if (!this.board.has(nw)) { continue; }
                const ne = this.coords2algebraic(x + 1, y);
                if (!this.board.has(ne)) { continue; }
                const sw = this.coords2algebraic(x, y + 1);
                if (!this.board.has(sw)) { continue; }
                const se = this.coords2algebraic(x + 1, y + 1);
                if (!this.board.has(se)) { continue; }
                const nwP = this.board.get(nw);
                const neP = this.board.get(ne);
                if (nwP === neP) { continue; }
                const seP = this.board.get(se);
                if (nwP !== seP) { continue; }
                const swP = this.board.get(sw);
                if (neP !== swP) { continue; }
                count++;
            }
        }
        // Swap back.
        if (from !== undefined && to !== undefined) {
            this.board.set(from, this.board.get(from)! % 2 + 1 as playerid);
            this.board.set(to, this.board.get(to)! % 2 + 1 as playerid);
        }
        return count;
    }

    private getSupercutCount(from?: string, to?: string): number {
        // Count the number of supercuts on the board.
        // Swap the stones if `from` and `to` are provided.
        if (from !== undefined && to !== undefined) {
            this.board.set(from, this.board.get(from)! % 2 + 1 as playerid);
            this.board.set(to, this.board.get(to)! % 2 + 1 as playerid);
        }
        let count = 0;
        for (let x = 0; x < this.boardSize - 3; x++) {
            for (let y = 0; y < this.boardSize - 3; y++) {
                const nnw = this.coords2algebraic(x + 1, y);
                if (!this.board.has(nnw)) { continue; }
                const nww = this.coords2algebraic(x, y + 1);
                if (!this.board.has(nww)) { continue; }
                const nw = this.coords2algebraic(x + 1, y + 1);
                if (!this.board.has(nw)) { continue; }
                const se = this.coords2algebraic(x + 2, y + 2);
                if (!this.board.has(se)) { continue; }
                const sse = this.coords2algebraic(x + 2, y + 3);
                if (!this.board.has(sse)) { continue; }
                const see = this.coords2algebraic(x + 3, y + 2);
                if (!this.board.has(see)) { continue; }
                const nne = this.coords2algebraic(x + 2, y);
                if (!this.board.has(nne)) { continue; }
                const nee = this.coords2algebraic(x + 3, y + 1);
                if (!this.board.has(nee)) { continue; }
                const ne = this.coords2algebraic(x + 2, y + 1);
                if (!this.board.has(ne)) { continue; }
                const sw = this.coords2algebraic(x + 1, y + 2);
                if (!this.board.has(sw)) { continue; }
                const ssw = this.coords2algebraic(x + 1, y + 3);
                if (!this.board.has(ssw)) { continue; }
                const sww = this.coords2algebraic(x, y + 2);
                if (!this.board.has(sww)) { continue; }
                const nnwP = this.board.get(nnw);
                const nwwP = this.board.get(nww);
                if (nnwP !== nwwP) { continue; }
                const nwP = this.board.get(nw);
                if (nnwP !== nwP) { continue; }
                const seP = this.board.get(se);
                if (nnwP !== seP) { continue; }
                const sseP = this.board.get(sse);
                if (nnwP !== sseP) { continue; }
                const seeP = this.board.get(see);
                if (nnwP !== seeP) { continue; }
                const nneP = this.board.get(nne);
                if (nnwP === nneP) { continue; }
                const neeP = this.board.get(nee);
                if (neeP !== nneP) { continue; }
                const neP = this.board.get(ne);
                if (neeP !== neP) { continue; }
                const swP = this.board.get(sw);
                if (neeP !== swP) { continue; }
                const sswP = this.board.get(ssw);
                if (neeP !== sswP) { continue; }
                const swwP = this.board.get(sww);
                if (neeP !== swwP) { continue; }
                count++;
            }
        }
        // Swap back.
        if (from !== undefined && to !== undefined) {
            this.board.set(from, this.board.get(from)! % 2 + 1 as playerid);
            this.board.set(to, this.board.get(to)! % 2 + 1 as playerid);
        }
        return count;
    }

    private getNeighbours(cell: string): string[] {
        // Get the neighbours of a given cell.
        const [x,y] = this.algebraic2coords(cell);
        return this.grid.adjacencies(x, y, true).map(n => this.coords2algebraic(...n));
    }

    private getSwappable(from: string, resolved?: Set<string>): string[] {
        // Get the swappable cells for a given a `from`.
        // Optionally, provide a `resolved` set to avoid returning cells that have already been checked.
        const swappable: string[] = [];
        const player = this.board.get(from)!;
        for (const n of this.getNeighbours(from)) {
            if (resolved !== undefined && resolved.has(n)) { continue; }
            if (this.board.has(n) && this.board.get(n) !== player) {
                const crosscutCount = this.getCrosscutCount(from, n);
                if (crosscutCount < this.crosscutCount) {
                    swappable.push(n);
                } else if (!this.variants.includes("basic") && crosscutCount === this.crosscutCount) {
                    const supercutCount = this.getSupercutCount(from, n);
                    if (supercutCount < this.supercutCount) {
                        swappable.push(n);
                    }
                }
            }
        }
        return swappable;
    }

    public move(m: string, {partial = false, trusted = false} = {}): SaltireGame {
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
        const split = m.split("-");
        if (split.length === 1) {
            this.results.push({ type: "place", where: m });
            this.board.set(m, this.currplayer);
        } else {
            if (split[1] === "") {
                this.dots = this.getSwappable(split[0]);
            } else {
                this.results.push({ type: "move", from: split[0], to: split[1] });
                this.board.set(split[0], this.board.get(split[0])! % 2 + 1 as playerid);
                this.board.set(split[1], this.board.get(split[1])! % 2 + 1 as playerid);
            }
        }
        this.crosscutCount = this.getCrosscutCount();
        if (!this.variants.includes("basic")) {
            this.supercutCount = this.getSupercutCount();
        }
        if (partial) { return this; }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
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
            const [x,y] = this.algebraic2coords(node);
            const neighbours = this.grid.adjacencies(x, y, false).map(n => this.coords2algebraic(...n));
            for (const n of neighbours) {
                if ( (graph.hasNode(n)) && (! graph.hasEdge(node, n)) ) {
                    graph.addEdge(node, n);
                }
            }
        }
        return graph;
    }

    protected checkEOG(): SaltireGame {
        const otherPlayer = this.currplayer % 2 + 1 as playerid;
        const graph = this.buildGraph(otherPlayer);
        const [sources, targets] = this.lines[otherPlayer - 1];
        for (const source of sources) {
            for (const target of targets) {
                if ( (graph.hasNode(source)) && (graph.hasNode(target)) ) {
                    const path = bidirectional(graph, source, target);
                    if (path !== null) {
                        this.gameover = true;
                        this.winner = [otherPlayer];
                        this.connPath = [...path];
                        break;
                    }
                }
            }
            if (this.gameover) {
                break;
            }
        }
        if (this.gameover) {
            this.results.push({ type: "eog" });
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public state(): ISaltireState {
        return {
            game: SaltireGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: SaltireGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            crosscutCount: this.crosscutCount,
            supercutCount: this.supercutCount,
            connPath: [...this.connPath],
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < this.boardSize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell);
                    if (contents === 1) {
                        pstr += "A";
                    } else if (contents === 2) {
                        pstr += "B";
                    }
                } else {
                    pstr += "-";
                }
            }
        }
        pstr = pstr.replace(new RegExp(`-{${this.boardSize}}`, "g"), "_");

        const markers: Array<any> = [
            { type:"edge", edge: "N", colour: 1 },
            { type:"edge", edge: "S", colour: 1 },
            { type:"edge", edge: "E", colour: 2 },
            { type:"edge", edge: "W", colour: 2 },
        ];

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "vertex",
                width: this.boardSize,
                height: this.boardSize,
                markers,
            },
            legend: {
                A: [{ name: "piece", colour: 1 }],
                B: [{ name: "piece", colour: 2 }],
            },
            pieces: pstr,
        };

        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                } else if (move.type === "move") {
                    const [fromX, fromY] = this.algebraic2coords(move.from);
                    const [toX, toY] = this.algebraic2coords(move.to);
                    rep.annotations.push({ type: "move", targets: [{ row: fromY, col: fromX }, { row: toY, col: toX }] });
                    rep.annotations.push({ type: "move", targets: [{ row: toY, col: toX }, { row: fromY, col: fromX }] });
                }
            }
            if (this.connPath.length > 0) {
                type RowCol = {row: number; col: number;};
                const targets: RowCol[] = [];
                for (const cell of this.connPath) {
                    const [x,y] = this.algebraic2coords(cell);
                    targets.push({row: y, col: x})
                }
                rep.annotations.push({type: "move", targets: targets as [RowCol, ...RowCol[]], arrow: false});
            }
        }
        if (this.dots.length > 0) {
            const points = [];
            for (const cell of this.dots) {
                const [x, y] = this.algebraic2coords(cell);
                points.push({ row: y, col: x });
            }
            rep.annotations.push({ type: "dots", targets: points as [{row: number; col: number}, ...{row: number; col: number}[]] });
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
                node.push(i18next.t("apresults:PLACE.nowhat", { player, where: r.where }));
                resolved = true;
                break;
            case "move":
                node.push(i18next.t("apresults:MOVE.saltire", { player, from: r.from, to: r.to }));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): SaltireGame {
        return new SaltireGame(this.serialize());
    }
}
