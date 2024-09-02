import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, MarkerEdge, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { allDirections, Directions, RectGrid, reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { UndirectedGraph } from "graphology";
import { bidirectional } from "graphology-shortest-path";

type playerid = 1 | 2;
type PlayerLines = [string[], string[]];

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    connPath: string[];
    lastmove?: string;
}

export interface IShiftyState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class ShiftyGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Shifty",
        uid: "shifty",
        playercounts: [2],
        version: "20240831",
        dateAdded: "2024-08-31",
        // i18next.t("apgames:descriptions.shifty")
        description: "apgames:descriptions.shifty",
        urls: ["https://boardgamegeek.com/boardgame/124313/shifty"],
        people: [
            {
                type: "designer",
                name: "Nick Bentley",
                urls: ["https://boardgamegeek.com/boardgamedesigner/7958/nick-bentley"],
            }
        ],
        variants: [
            { uid: "size-13", group: "board" },
        ],
        categories: ["goal>connect", "mechanic>move", "mechanic>place", "board>shape>rect", "board>connect>rect", "components>simple"],
        flags: ["experimental", "pie"],
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
    public connPath: string[] = [];
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private boardSize = 0;
    private dots: string[] = [];
    private grid: RectGrid;
    private lines: [PlayerLines, PlayerLines];

    constructor(state?: IShiftyState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: ShiftyGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                connPath: [],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IShiftyState;
            }
            if (state.game !== ShiftyGame.gameinfo.uid) {
                throw new Error(`The Shifty game code cannot process a game of '${state.game}'.`);
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

    public load(idx = -1): ShiftyGame {
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
        const moves: string[] = [];
        for (let row = 0; row < this.boardSize; row++) {
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                if (!this.board.has(cell)) {
                    if (this.stack.length > 2) {
                        if (!this.canGrow(cell, player)) { continue; }
                        if (!this.canPlace(cell, player)) { continue; }
                    }
                    moves.push(cell);
                } else if (this.board.get(cell) === player) {
                    const tos = this.getTos(cell);
                    for (const to of tos) {
                        moves.push(`${cell}-${to}`);
                    }
                }
            }
        }
        if (moves.length === 0) { return ["pass"]; }
        return moves;
    }

    private hasMoves(player: playerid): boolean {
        // Check if a player has any moves.
        player ??= this.currplayer;
        for (let row = 0; row < this.boardSize; row++) {
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                if (!this.board.has(cell)) {
                    if (this.canGrow(cell, player) && this.canPlace(cell, player)) {
                        return true;
                    }
                } else if (this.board.get(cell) === player) {
                    const tos = this.getTos(cell);
                    if (tos.length > 0) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    private canPlace(where: string, player: playerid, from?: string): boolean {
        // Check if placement by `player` at `where` will result in a crosscut.
        // If `from` is provided, it is the cell from which the piece is being moved.
        const [x,y] = this.algebraic2coords(where);
        const nonos: [Directions, Directions][] = [["N", "E"], ["S", "E"], ["S", "W"], ["N", "W"]];
        for (const [left, right] of nonos) {
            let matchLeft = false;
            const rayLeft = this.grid.ray(x, y, left).map(n => this.coords2algebraic(...n));
            if (rayLeft.length > 0) {
                const cell = rayLeft[0];
                if (cell !== from && this.board.has(cell) && this.board.get(cell)! !== player) {
                    matchLeft = true;
                }
            }
            let matchRight = false;
            const rayRight = this.grid.ray(x, y, right).map(n => this.coords2algebraic(...n));
            if (rayRight.length > 0) {
                const cell = rayRight[0];
                if (cell !== from && this.board.has(cell) && this.board.get(cell)! !== player) {
                    matchRight = true;
                }
            }
            const dirDiag = (left + right) as Directions;
            let matchDiag = false;
            const rayDiag = this.grid.ray(x, y, dirDiag).map(n => this.coords2algebraic(...n));
            if (rayDiag.length > 0) {
                const cell = rayDiag[0];
                if (cell !== from && this.board.has(cell) && this.board.get(cell)! === player) {
                    matchDiag = true;
                }
            }
            if (matchLeft && matchRight && matchDiag) {
                return false;
            }
        }
        return true;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            let newmove = "";
            if (move === "") {
                newmove = cell;
            } else if (move === cell) {
                newmove = "";
            } else if (this.board.has(cell) && this.board.get(cell) === this.currplayer) {
                newmove = cell;
            } else {
                newmove = `${move}-${cell}`;
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
            if (!this.hasMoves(this.currplayer)) {
                result.message = i18next.t("apgames:validation.shifty.INITIAL_INSTRUCTIONS_PASS");
            } else if (this.stack.length < 3) {
                result.message = i18next.t("apgames:validation.shifty.INITIAL_INSTRUCTIONS_OPENING");
            } else {
                result.message = i18next.t("apgames:validation.shifty.INITIAL_INSTRUCTIONS");
            }
            return result;
        }
        if (m === "pass") {
            if (this.hasMoves(this.currplayer)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.shifty.INVALID_PASS");
                return result;
            }
        } else if (this.stack.length < 3) {
            // Opening
            try {
                this.algebraic2coords(m);
                if (this.grid.inBounds(...this.algebraic2coords(m)) === false) {
                    throw new Error("Cell is out of bounds.");
                }
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: m });
                return result;
            }
            if (this.board.has(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", { where: m });
                return result;
            }
        } else {
            const [first, last] = m.split("-");
            try {
                this.algebraic2coords(first);
                if (this.grid.inBounds(...this.algebraic2coords(first)) === false) {
                    throw new Error("Cell is out of bounds.");
                }
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: first });
                return result;
            }
            if (!this.board.has(first)) {
                // Placement
                if (last !== undefined && last !== "") {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.NONEXISTENT", { where: first });
                    return result;
                }
                if (!this.canGrow(first, this.currplayer)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.shifty.CANNOT_PLACE", { where: first });
                    return result;
                }
                if (!this.canPlace(first, this.currplayer)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.shifty.CROSSCUT", { where: first });
                    return result;
                }
            } else {
                // Movement
                if (this.board.get(first) !== this.currplayer) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                    return result;
                }
                const tos = this.getTos(first);
                if (tos.length === 0) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.shifty.NO_TOS", { from: first });
                    return result;
                }
                if (last === undefined || last === "") {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation._general.NEED_DESTINATION", { from: first });
                    return result;
                }
                try {
                    this.algebraic2coords(last);
                    if (this.grid.inBounds(...this.algebraic2coords(last)) === false) {
                        throw new Error("Cell is out of bounds.");
                    }
                } catch {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: first });
                    return result;
                }
                if (!tos.includes(last)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.shifty.INVALID_DESTINATION", { from: first, to: last });
                    return result;
                }
            }
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private canGrow(from: string, player: playerid): boolean {
        // Check if a piece can be placed in a given cell.
        return this.grid.adjacencies(...this.algebraic2coords(from), false).map(n => this.coords2algebraic(...n)).some(cell => this.board.has(cell) && this.board.get(cell) === player);
    }

    private getTos(from: string): string[] {
        // Get all possible destinations from a given cell.
        const coords = this.algebraic2coords(from);
        const tos: string[] = [];
        for (const dir of allDirections) {
            for (const coords2 of this.grid.ray(...coords, dir)) {
                const cell = this.coords2algebraic(...coords2);
                if (this.board.has(cell)) { break; }
                if (!this.canPlace(cell, this.currplayer, from)) { continue; }
                tos.push(cell);
            }
        }
        return tos;
    }

    public move(m: string, { partial = false, trusted = false } = {}): ShiftyGame {
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
        if (m === "pass") {
            this.results = [{ type: "pass" }];
        } else {
            const [first, last] = m.split("-");
            if (!this.board.has(first)) {
                this.results.push({ type: "place", where: m });
                this.board.set(m, this.currplayer);
            } else {
                if (last === undefined || last === "") {
                    this.dots = this.getTos(first);
                } else {
                    this.results.push({ type: "move", from: first, to: last });
                    this.board.delete(first);
                    this.board.set(last, this.currplayer);
                }
            }
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
            const neighbours = this.grid.adjacencies(x, y, true).map(n => this.coords2algebraic(...n));
            for (const n of neighbours) {
                if ( (graph.hasNode(n)) && (! graph.hasEdge(node, n)) ) {
                    graph.addEdge(node, n);
                }
            }
        }
        return graph;
    }

    protected checkEOG(): ShiftyGame {
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

    public state(): IShiftyState {
        return {
            game: ShiftyGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: ShiftyGame.gameinfo.version,
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

        const markers: Array<MarkerEdge> = [
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
                }
            }
            if (this.connPath.length > 0) {
                const targets: RowCol[] = [];
                for (const cell of this.connPath) {
                    const [x,y] = this.algebraic2coords(cell);
                    targets.push({row: y, col: x})
                }
                rep.annotations.push({ type: "move", targets: targets as [RowCol, ...RowCol[]], arrow: false });
            }
        }
        if (this.dots.length > 0) {
            const points = [];
            for (const cell of this.dots) {
                const [x, y] = this.algebraic2coords(cell);
                points.push({ row: y, col: x });
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

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.nowhat", { player, where: r.where }));
                resolved = true;
                break;
            case "move":
                node.push(i18next.t("apresults:MOVE.nowhat", { player, from: r.from, to: r.to }));
                resolved = true;
                break;
            case "pass":
                node.push(i18next.t("apresults:PASS.forced", { player }));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): ShiftyGame {
        return new ShiftyGame(this.serialize());
    }
}
