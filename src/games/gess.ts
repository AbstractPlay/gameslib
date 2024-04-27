import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { RectGrid } from "../common";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { Directions } from "../common";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";

type playerid = 1|2;

type GridContents = Directions | "C";
// Name of the nine cells surrounding a cell, in order.
const nineCellMap: GridContents[] = ["NW", "N", "NE", "W", "C", "E", "SW", "S", "SE"];
const columnLabels = "abcdefghijklmnopqrstuvwxyz".split("");

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
}

export interface IGessState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class GessGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Gess",
        uid: "gess",
        playercounts: [2],
        version: "20240125",
        dateAdded: "2024-01-22",
        // i18next.t("apgames:descriptions.gess")
        description: "apgames:descriptions.gess",
        urls: ["https://boardgamegeek.com/boardgame/12862/gess"],
        people: [],
        variants: [],
        categories: ["goal>royal-capture", "mechanic>capture", "mechanic>move>group", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["perspective"],
        displays: [{uid: "hide-piece-highlight"}],
    };

    public coords2algebraic(x: number, y: number): string {
        // Custom method that supports "off" cell when x or y is out of bounds.
        if (x < 0 || x >= this.boardSize || y < 0 || y >= this.boardSize) { return "off" }
        return columnLabels[x] + (this.boardSize - y).toString();
    }

    public algebraic2coords(cell: string): [number, number] {
        // Custom method that supports "off" cell when x or y is out of bounds.
        if (cell === "off") { return [-1, -1]; }
        const pair: string[] = cell.split("");
        const num = (pair.slice(1)).join("");
        const x = columnLabels.indexOf(pair[0]);
        if ( (x === undefined) || (x < 0) ) {
            throw new Error(`The column label is invalid: ${pair[0]}`);
        }
        const y = parseInt(num, 10);
        if ( (y === undefined) || (isNaN(y)) ) {
            throw new Error(`The row label is invalid: ${pair[1]}`);
        }
        return [x, this.boardSize - y];
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private boardSize = 20;
    private grid!: RectGrid;
    private dots: string[] = [];
    private nineCellHighlight: string[] = [];

    constructor(state?: IGessState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: GessGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: this.setupBoard(),
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IGessState;
            }
            if (state.game !== GessGame.gameinfo.uid) {
                throw new Error(`The Gess game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
        this.grid = new RectGrid(this.boardSize, this.boardSize);
    }

    public load(idx = -1): GessGame {
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
        this.lastmove = state.lastmove;
        return this;
    }

    private setupBoard(): Map<string, playerid> {
        // Get the board setup for a new game.
        const gameBoard = [
            "____________________",
            "__2_2_22222222_2_2__",
            "_222_2_2222_2_2_222_",
            "__2_2_22222222_2_2__",
            "____________________",
            "____________________",
            "__2__2__2__2__2__2__",
            "____________________",
            "____________________",
            "____________________",
            "____________________",
            "____________________",
            "____________________",
            "__1__1__1__1__1__1__",
            "____________________",
            "____________________",
            "__1_1_11111111_1_1__",
            "_111_1_1111_1_1_111_",
            "__1_1_11111111_1_1__",
            "____________________",
        ]
        const board = new Map<string, playerid>();
        for (let row = 0; row < this.boardSize; row++) {
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                const contents = gameBoard[row][col];
                if (contents === "1") {
                    board.set(cell, 1);
                } else if (contents === "2") {
                    board.set(cell, 2);
                }
            }
        }
        return board;
    }

    public moves(player?: 1|2): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }
        const moves: string[] = [];
        for (let i = 0; i < this.boardSize; i++) {
            for (let j = 0; j < this.boardSize; j++) {
                const cell = this.coords2algebraic(j, i);
                const gridContents = this.getGridContents(cell, player);
                if (gridContents === undefined) { continue; }
                for (const toCell of this.movesFrom(cell, gridContents)) {
                    if (this.getCapturedCells(cell, toCell).length > 0) {
                        moves.push(cell + "x" + toCell);
                    } else {
                        moves.push(cell + "-" + toCell);
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
            if (move.length === 0) {
                newmove = cell;
            } else {
                const moves = move.split(/[-x]/);
                const from = moves[0];
                if (this.getCapturedCells(from, cell).length > 0) {
                    newmove = from + "x" + cell;
                } else {
                    newmove = from + "-" + cell;
                }
            }
            const result = this.validateMove(newmove) as IClickResult;
            if (! result.valid) {
                result.move = "";
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
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.gess.INITIAL_INSTRUCTIONS");
            return result;
        }
        const moves = m.split(/[-x]/);
        if (moves.length > 2) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.gess.TOO_MANY_MOVES");
            return result;
        }
        // Valid cell
        let currentMove;
        try {
            for (const p of moves) {
                currentMove = p;
                const [x, y] = this.algebraic2coords(p);
                if (!this.grid.inBounds(x, y)) {
                    throw new Error("Invalid cell");
                }
            }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: currentMove });
            return result;
        }
        const [from, to] = moves;
        const fromContents = this.getGridContents(from, this.currplayer);
        if (fromContents === undefined) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.gess.FROM_ENEMY", { cell: from });
            return result;
        }
        if (fromContents.length === 0) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.gess.FROM_EMPTY", { cell: from });
            return result;
        }
        if (fromContents.length === 1 && fromContents[0] === "C") {
            result.valid = false;
            result.message = i18next.t("apgames:validation.gess.FROM_CENTRE_ONLY", { cell: from });
            return result;
        }
        if (to === undefined) {
            result.valid = true;
            result.complete = 0;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.gess.POTENTIAL_MOVE");
            return result;
        }
        const movesFrom = this.movesFrom(from, fromContents);
        if (!movesFrom.includes(to)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.gess.INVALID_MOVE", { from, to });
            return result;
        }
        const capturedCells = this.getCapturedCells(from, to);
        if (capturedCells.length > 0) {
            if (m.includes("-")) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.gess.MOVE4CAPTURE", { to });
                return result;
            }
        } else {
            if (m.includes("x")) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.gess.CAPTURE4MOVE", { to });
                return result;
            }
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private getNineCells(centre: string): string[] {
        // Get the nine cells surrounding `centre`, including `centre` in a flat list.
        // The order is as per `nineCellMap`.
        const [x, y] = this.algebraic2coords(centre);
        const cells: string[] = [];
        for (let row = y - 1; row <= y + 1; row++) {
            for (let col = x - 1; col <= x + 1; col++) {
                cells.push(this.coords2algebraic(col, row));
            }
        }
        return cells;
    }

    private getGridContents(from: string, player: playerid): GridContents[] | undefined {
        // If the nineCells contains enemy pieces, return undefined.
        // Otherwise, return the grid contents.
        const nineCells = this.getNineCells(from);
        const gridContents: GridContents[] = [];
        for (let i = 0; i < 10; i++) {
            if (this.board.has(nineCells[i])) {
                if (this.board.get(nineCells[i]) !== player) { return undefined; }
                gridContents.push(nineCellMap[i]!);
            }
        }
        return gridContents;
    }

    private movesFrom(from: string, gridContents: GridContents[]): string[] {
        // No validation for whether movement is possible from `from`. Assume that it is.
        // Get all moves possible from `from` given the contents of the nine cells surrounding `from`.
        const hasCentre = gridContents.includes("C");
        const moves: string[] = [];
        for (const gridContent of gridContents) {
            if (gridContent === "C") { continue; }
            const maxRange = this.maxRange(from, gridContent, hasCentre);
            moves.push(...this.grid.ray(...this.algebraic2coords(from), gridContent).slice(0, maxRange).map((c) => this.coords2algebraic(...c)));
        }
        return moves;
    }

    private maxRange(from: string, direction: Directions, hasCentre?: boolean): number {
        // No validation for whether movement is possible from `from`. Assume that it is.
        // Get the maximum range in `direction` from `from`.
        // If `hasCentre` is true, then the centre cell is not considered.
        const nineCells = this.getNineCells(from);
        if (hasCentre === undefined) { hasCentre = nineCells.includes("C"); }
        const ray = this.grid.ray(...this.algebraic2coords(from), direction);
        for (let i = 0; i < ray.length; i++) {
            const coords = ray[i];
            const nextNineCells = this.getNineCells(this.coords2algebraic(...coords));
            for (const cell of nextNineCells) {
                if (nineCells.includes(cell)) { continue; }
                if (this.board.has(cell)) {
                    return i + 1;
                }
            }
            if (this.isOffBoard(...coords)) { return i + 1; }
            if (i === 2 && !hasCentre) { return 3; }
        }
        // Should never get here because `from` can not be on the edge.
        return 0;
    }

    private getCapturedCells(from: string, to: string): string[] {
        // Get the cells captured by moving from `from` to `to`.
        const nineCellsFrom = this.getNineCells(from);
        const nineCellsTo = this.getNineCells(to);
        const captured: string[] = [];
        for (const cell of nineCellsTo) {
            if (this.board.has(cell) && !nineCellsFrom.includes(cell)) {
                captured.push(cell);
            }
        }
        return captured;
    }

    private gridContents2Cells(gridContents: GridContents[], at: string): string[] {
        // Convert the cell contents to a list of cells.
        const coordsTo = this.algebraic2coords(at);
        const cells: string[] = [];
        for (const gridContent of gridContents) {
            if (gridContent === "C") {
                cells.push(at);
            } else {
                cells.push(this.coords2algebraic(...RectGrid.move(...coordsTo, gridContent)));
            }
        }
        return cells;
    }

    private getOffBoardCells(toCells: string[]): string[] {
        // Get the off board cells in `toCells`. These cells will be removed.
        const edgeCells: string[] = [];
        for (const cell of toCells) {
            const [x, y] = this.algebraic2coords(cell);
            if (this.isOffBoard(x, y)) {
                edgeCells.push(cell);
            }
        }
        return edgeCells;
    }

    private isOffBoard(x: number, y: number): boolean {
        // Check if the cell at `x`, `y` is on the edge of the board.
        return x <= 0 || x >= this.boardSize - 1 || y <= 0 || y >= this.boardSize - 1;
    }

    public move(m: string, {partial = false, trusted = false} = {}): GessGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        let result;
        if (m === "No movelist in placement phase") {
            result = {valid: false, message: i18next.t("apgames:validation.gess.NO_MOVELIST")};
            throw new UserFacingError("VALIDATION_GENERAL", result.message);
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (!trusted) {
            result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
            if (!partial && !this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}));
            }
        }
        if (m.length === 0) { return this; }
        // Move valid, so change the state
        const [from, to] = m.split(/[-x]/);
        const gridContents = this.getGridContents(from, this.currplayer)!;
        if (partial) {
            this.dots = this.movesFrom(from, gridContents);
            this.nineCellHighlight = [from];
            return this;
        }
        this.dots = [];
        this.nineCellHighlight = [];
        this.results = [];
        const fromCells = this.gridContents2Cells(gridContents, from);
        const toCells = this.gridContents2Cells(gridContents, to);
        const capturedCells = this.getCapturedCells(from, to);
        for (const cell of fromCells) {
            this.board.delete(cell);
        }
        for (const cell of capturedCells) {
            this.board.delete(cell);
        }
        for (const cell of toCells) {
            this.board.set(cell, this.currplayer);
        }
        this.results.push({type: "move", from, to, count: gridContents.length});
        const offBoardCells = this.getOffBoardCells(toCells);
        if (offBoardCells.length > 0) {
            for (const cell of offBoardCells) {
                this.board.delete(cell);
            }
        }
        const removedCount = offBoardCells.length + capturedCells.length;
        if (removedCount > 0) {
            this.results.push({
                type: "capture",
                count: removedCount,
                // where is for rendering "exit" annotations. Pieces moved completely off board are not captured here.
                where: [...offBoardCells, ...capturedCells].filter((c) => c !== "off").sort((a, b) => a.localeCompare(b)).join(","),
            });
        }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    private hasRing(player: playerid): boolean {
        // Check if `player` has at least one ring.
        for (let i = 1; i < this.boardSize - 1; i++) {
            for (let j = 1; j < this.boardSize - 1; j++) {
                const cell = this.coords2algebraic(j, i);
                if (this.board.has(cell)) { continue; }
                const gridContents = this.getGridContents(cell, player);
                if (gridContents === undefined) { continue; }
                if (gridContents.length === 8) { return true; }
            }
        }
        return false;
    }

    protected checkEOG(): GessGame {
        const otherPlayer = this.currplayer % 2 + 1 as playerid;
        if (!this.hasRing(otherPlayer)) {
            this.gameover = true;
            this.winner = [this.currplayer];
        } else if (!this.hasRing(this.currplayer)) {
            this.gameover = true;
            this.winner = [otherPlayer];
        }
        if (this.gameover) {
            this.results.push({type: "eog"});
            this.results.push({type: "winners", players: [...this.winner]});
        }
        return this;
    }

    public state(): IGessState {
        return {
            game: GessGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: GessGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    private pieceHighlightPoints(cell: string): { row: number, col: number }[] {
        // Get points that can be used in "shading" marker to highlight the nine cells surrounding `cell`.
        const [x, y] = this.algebraic2coords(cell);
        const points: { row: number, col: number }[] = [];
        points.push({ row: Math.max(0, y - 1), col: Math.max(0, x - 1) });
        points.push({ row: Math.max(0, y - 1), col: Math.min(this.boardSize, x + 2) });
        points.push({ row: Math.min(this.boardSize, y + 2), col: Math.min(this.boardSize, x + 2) });
        points.push({ row: Math.min(this.boardSize, y + 2), col: Math.max(0, x - 1) });
        return points;
    }

    public render(opts?: { altDisplay: string | undefined }): APRenderRep {
        let altDisplay: string | undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }
        let showPieceHighlight = true;
        if (altDisplay !== undefined) {
            if (altDisplay === "hide-piece-highlight") {
                showPieceHighlight = false;
            }
        }
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
            {
                type: "shading", colour: "_context_fill", opacity: 0.2,
                points: [{row: 0, col: 0}, {row: 0, col: 1}, {row: this.boardSize, col: 1}, {row: this.boardSize, col: 0}],
            },
            {
                type: "shading", colour: "_context_fill", opacity: 0.2,
                points: [{row: 0, col: this.boardSize - 1}, {row: 0, col: this.boardSize}, {row: this.boardSize, col: this.boardSize}, {row: this.boardSize, col: this.boardSize - 1}],
            },
            {
                type: "shading", colour: "_context_fill", opacity: 0.2,
                points: [{row: 0, col: 1}, {row: 0, col: this.boardSize - 1}, {row: 1, col: this.boardSize - 1}, {row: 1, col: 1}],
            },
            {
                type: "shading", colour: "_context_fill", opacity: 0.2,
                points: [{row: this.boardSize - 1, col: 1}, {row: this.boardSize - 1, col: this.boardSize - 1}, {row: this.boardSize, col: this.boardSize - 1}, {row: this.boardSize, col: 1}],
            },
        ]
        if (showPieceHighlight) {
            if (this.stack[this.stack.length - 1]._results.length > 0) {
                for (const move of this.stack[this.stack.length - 1]._results) {
                    if (move.type === "move") {
                        markers.push({ type: "shading", colour: "#FFFF00", opacity: 0.25, points: this.pieceHighlightPoints(move.from) });
                        markers.push({ type: "shading", colour: "#FFFF00", opacity: 0.25, points: this.pieceHighlightPoints(move.to) });
                    }
                }
            }
            for (const cell of this.nineCellHighlight) {
                markers.push({ type: "shading", colour: "#00FF00", opacity: 0.25, points: this.pieceHighlightPoints(cell) });
            }
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares",
                width: this.boardSize,
                height: this.boardSize,
                // @ts-ignore
                markers,
            },
            legend: {
                A: [{ name: "piece", player: 1 }],
                B: [{ name: "piece", player: 2 }],
            },
            pieces: pstr,
        };

        // Add annotations
        // @ts-ignore
        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "move") {
                    const [fromX, fromY] = this.algebraic2coords(move.from);
                    const [toX, toY] = this.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "capture") {
                    if (move.where === undefined) { continue; }
                    const targets: {row: number, col: number}[] = [];
                    for (const cell of move.where.split(",")) {
                        if (cell.length === 0) { continue; }
                        const [x, y] = this.algebraic2coords(cell);
                        targets.push({row: y, col: x});
                    }
                    if (targets.length > 0) {
                        // @ts-ignore
                        rep.annotations.push({type: "exit", targets});
                    }
                }
            }
        }
        if (this.dots.length > 0) {
            const points = [];
            for (const cell of this.dots) {
                const [x, y] = this.algebraic2coords(cell);
                points.push({row: y, col: x});
            }
            // @ts-ignore
            rep.annotations.push({type: "dots", targets: points});
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
            case "move":
                node.push(i18next.t("apresults:MOVE.gess", {player, from: r.from, to: r.to, count: r.count}));
                resolved = true;
                break;
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.gess", {count: r.count}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): GessGame {
        return new GessGame(this.serialize());
    }
}
