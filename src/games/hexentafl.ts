import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, MarkerFlood } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { HexTriGraph, reviver, UserFacingError } from "../common";
import i18next from "i18next";

type playerid = 1 | 2;
type pieceid = "T" | "K";
type CellContents = [playerid, pieceid];
type Direction = "NE" | "E" | "SE" | "SW" | "W" | "NW";
const directions: Direction[] = ["NE", "E", "SE", "SW", "W", "NW"];
const spreadDirections: Map<Direction, Direction[]> = new Map([
    ["NE", ["NW", "E"]],
    ["E", ["NE", "SE"]],
    ["SE", ["E", "SW"]],
    ["SW", ["SE", "W"]],
    ["W", ["SW", "NW"]],
    ["NW", ["W", "NE"]]
]);

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    lastmove?: string;
}

export interface IHexentaflState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class HexentaflGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "heXentafl",
        uid: "hexentafl",
        playercounts: [2],
        version: "20240701",
        dateAdded: "2024-07-01",
        // i18next.t("apgames:descriptions.hexentafl")
        description: "apgames:descriptions.hexentafl",
        urls: [],
        people: [],
        variants: [
            { uid: "size-5", group: "board" }
        ],
        categories: ["goal>royal-escape", "goal>royal-capture", "mechanic>asymmetry", "mechanic>capture", "board>shape>hex", "board>connect>hex", "components>simple"],
        flags: ["experimental", "check", "limited-pieces"],
    };

    public coords2algebraic(x: number, y: number): string {
        return this.graph.coords2algebraic(x, y);
    }

    public algebraic2coords(cell: string): [number, number] {
        return this.graph.algebraic2coords(cell);
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, CellContents>;
    public graph: HexTriGraph = new HexTriGraph(7, 13);
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private boardSize = 0;
    private dots: string[] = [];
    private corners: string[];
    private centre: string;

    constructor(state?: IHexentaflState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            this.boardSize = this.getBoardSize();
            const board = this.getStartingBoard();
            const fresh: IMoveState = {
                _version: HexentaflGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IHexentaflState;
            }
            if (state.game !== HexentaflGame.gameinfo.uid) {
                throw new Error(`The Hexentafl game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
            this.boardSize = this.getBoardSize();
        }
        this.corners = this.getCorners();
        this.centre = this.boardSize === 4 ? "d4" : "e5";
        this.load();
    }

    public load(idx = -1): HexentaflGame {
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
        this.board = new Map(Array.from(state.board, ([key, value]) => [key, [...value]]));
        this.lastmove = state.lastmove;
        this.buildGraph();
        return this;
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
        return 4;
    }

    private getStartingBoard(): Map<string, CellContents> {
        // Get starting board.
        if (this.boardSize === 4) {
            return new Map([
                ["a1", [1, "T"]], ["a4", [1, "T"]], ["d1", [1, "T"]], ["d7", [1, "T"]], ["g1", [1, "T"]], ["g4", [1, "T"]],
                ["d4", [2, "K"]], ["c3", [2, "T"]], ["d5", [2, "T"]], ["e3", [2, "T"]],
            ])
        }
        return new Map([
            ["a1", [1, "T"]], ["a5", [1, "T"]], ["e1", [1, "T"]], ["e9", [1, "T"]], ["i1", [1, "T"]], ["i5", [1, "T"]],
            ["b2", [1, "T"]], ["b5", [1, "T"]], ["e2", [1, "T"]], ["e8", [1, "T"]], ["h2", [1, "T"]], ["h5", [1, "T"]],
            ["e5", [2, "K"]], ["d4", [2, "T"]], ["d5", [2, "T"]], ["e4", [2, "T"]], ["e6", [2, "T"]], ["f4", [2, "T"]], ["f5", [2, "T"]],
        ])
    }

    private getCorners(): string[] {
        // Get all corners.
        if (this.boardSize === 4) {
            return ["a1", "a4", "d1", "d7", "g1", "g4"];
        }
        return ["a1", "a5", "e1", "e9", "i1", "i5"];
    }

    private getGraph(): HexTriGraph {
        return new HexTriGraph(this.boardSize, (this.boardSize * 2) - 1);
    }

    private buildGraph(): HexentaflGame {
        this.graph = this.getGraph();
        return this;
    }

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }
        const moves: string[] = [];
        for (const [cell, [owner,]] of this.board) {
            if (owner !== player) { continue; }
            const from = this.addPrefix(cell);
            for (const to of this.getTos(cell)) {
                moves.push(this.normaliseMove(from + "-" + to));
            }
        }
        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    private addPrefix(cell: string): string {
        // Assumes that the cell has a piece.
        const [, pc] = this.board.get(cell)!;
        const letter = pc === "T" ? "" : pc;
        return letter + cell;
    }

    private stripPrefix(cell: string): string {
        // Remove the letter from the cell name.
        return cell.replace(/[A-Z]/, "");
    }

    private sort(a: string, b: string): number {
        // Sort two cells. This is necessary because "a10" should come after "a9".
        const [ax, ay] = this.algebraic2coords(a);
        const [bx, by] = this.algebraic2coords(b);
        if (ay < by) { return 1; }
        if (ay > by) { return -1; }
        if (ax < bx) { return -1; }
        if (ax > bx) { return 1; }
        return 0;
    }

    private normaliseMove(move: string): string {
        // Normalize the move.
        const [fromP, to] = move.replace(/x.*/, "").split("-");
        const from = this.stripPrefix(fromP);
        if (!this.getTos(from).includes(to)) { return move; }
        const captures = this.getCaptures(from, to);
        if (captures.length === 0) {
            return this.addPrefix(from) + "-" + to;
        } else {
            return this.addPrefix(from) + "-" + to + "x" + captures.sort((a, b) => this.sort(a, b)).map((x) => this.addPrefix(x)).join("x");
        }
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            let newmove = "";
            if (move === "") {
                newmove = this.board.has(cell) ? this.addPrefix(cell) : cell;
            } else if (this.stripPrefix(move) === cell) {
                newmove = "";
            } else if (this.board.has(cell) && this.board.get(cell)![0] === this.currplayer) {
                newmove = this.addPrefix(cell);
            } else {
                newmove = this.normaliseMove(move + "-" + cell);
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

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.hexentafl.INITIAL_INSTRUCTIONS");
            return result;
        }
        const split = m.replace(/x.*/, "").split("-");
        // Valid cell
        let currentMove;
        try {
            for (const move of split) {
                currentMove = this.stripPrefix(move);
                const [, y] = this.algebraic2coords(currentMove);
                // `algebraic2coords` does not check if the cell is on the board fully.
                if (y < 0) { throw new Error("Invalid cell."); }
            }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: currentMove});
            return result;
        }
        const [fromP, to] = split;
        const [,from] = this.splitFrom(fromP);
        if (!this.board.has(from)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NONEXISTENT", { where: from });
            return result;
        }
        const [player, piece] = this.board.get(from)!;
        if (player !== this.currplayer) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
            return result;
        }
        if (piece === "K" && !m.startsWith("K")) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.hexentafl.KING_PREFIX");
            return result;
        }
        const tos = this.getTos(from);
        if (tos.length === 0) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NO_MOVES", { where: from });
            return result;
        }
        if (to === undefined || to === "") {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation._general.NEED_DESTINATION");
            return result;
        }
        if (from === to) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.SAME_FROM_TO");
            return result;
        }
        if (this.board.has(to)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", { where: to });
            return result;
        }
        if (!tos.includes(to)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.hexentafl.INVALID_TO", { from, to });
            return result;
        }
        const normalised = this.normaliseMove(from + "-" + to);
        if (normalised !== m) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.hexentafl.NORMALISE", { move: normalised });
            return result;
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private splitFrom(from: string): [pieceid, string] {
        // Split the from cell into the piece and the cell.
        if (from[0] !== "K") { return ["T", from]; }
        return [from[0] as pieceid, from.slice(1)];
    }

    private getTos(from: string): string[] {
        // Get all possible to cells from the from cell.
        const [,piece] = this.board.get(from)!;
        const [x, y] = this.algebraic2coords(from);
        const tos: string[] = [];
        for (const dir of directions) {
            for (const [i, coords] of this.graph.ray(x, y, dir).entries()) {
                if (piece === "K" && this.boardSize === 4 && i > 0) { break; }
                const c = this.coords2algebraic(...coords);
                if (this.board.has(c)) { break; }
                if (piece === "T" && this.centre === c) { continue; }
                tos.push(c);
            }
        }
        return tos;
    }

    private getCaptures(from: string, to: string): string[] {
        // Get all possible when a piece moves from the from cell to the to cell.
        const captures: string[] = [];
        const [x, y] = this.algebraic2coords(to);
        const [player,] = this.board.get(from)!;
        loop:
        for (const dir of directions) {
            const coords = this.graph.move(x, y, dir);
            if (coords === undefined) { continue; }
            const next = this.coords2algebraic(...coords);
            if (!this.board.has(next)) { continue; }
            const [nextP, nextPiece] = this.board.get(next)!;
            if (nextP === player) { continue; }
            if (nextPiece === "T" && this.corners.includes(next)) {
                for (const spreadDir of spreadDirections.get(dir)!) {
                    // Only one should be undefined.
                    const coords2 = this.graph.move(...coords, spreadDir);
                    if (coords2 === undefined) { continue; }
                    const next2 = this.coords2algebraic(...coords2);
                    if (!this.board.has(next2)) { continue; }
                    if (this.board.get(next2)![0] !== player) { continue; }
                    captures.push(next);
                }
            } else if (nextPiece === "K" && this.centre === next) {
                for (const spreadDir of spreadDirections.get(dir)!) {
                    const coords2 = this.graph.move(...coords, spreadDir);
                    if (coords2 === undefined) { continue loop; }
                    const next2 = this.coords2algebraic(...coords2);
                    if (!this.board.has(next2)) { continue loop; }
                    if (this.board.get(next2)![0] !== player) { continue loop; }
                }
                captures.push(next);
            } else {
                const coords2 = this.graph.move(...coords, dir);
                if (coords2 === undefined) { continue; }
                const next2 = this.coords2algebraic(...coords2);
                if (!this.board.has(next2)) { continue; }
                if (this.board.get(next2)![0] !== player) { continue; }
                captures.push(next);
            }
        }
        return captures;
    }

    public move(m: string, {partial = false, trusted = false} = {}): HexentaflGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        let result;
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
        const [fromP, to] = m.replace(/x.*/, "").split("-");
        const [piece, from] = this.splitFrom(fromP);
        if (to === undefined || to === "") {
            this.dots = this.getTos(from);
        } else {
            const captures = this.getCaptures(from, to);
            this.board.set(to, this.board.get(from)!);
            this.board.delete(from);
            this.results.push({ type: "move", from, to, what: piece });
            for (const capture of captures) {
                const [,pieceC] = this.board.get(capture)!;
                this.board.delete(capture);
                this.results.push({ type: "capture", where: capture, what: pieceC });
            }
        }
        if (partial) { return this; }
        this.dots = [];

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    private kingDead(move?: string): boolean {
        // Check if the king is absent from the board.
        if (move !== undefined) {
            const captures = move.split("x").slice(1);
            return captures.some(c => c.startsWith("K"));
        }
        return [...this.board.values()].filter(([p, pc]) => p === 2 && pc === "K").length === 0;
    }

    private kingEscaped(move?: string): boolean {
        // Check if the king has escaped.
        if (move !== undefined) {
            const [fromP, to] = move.split("x")[0].split("-");
            return fromP.startsWith("K") && this.corners.includes(to);
        }
        const kingPos = [...this.board.entries()].filter(([, [p, pc]]) => p === 2 && pc === "K")[0][0];
        return this.corners.includes(kingPos);
    }

    protected checkEOG(): HexentaflGame {
        if (this.kingDead()) {
            this.gameover = true;
            this.winner = [1];
            this.results.push({ type: "eog" });
        } else if (this.kingEscaped()) {
            this.gameover = true;
            this.winner = [2];
            this.results.push({ type: "eog" });
        } else if (this.stateCount() >= 2) {
            this.gameover = true;
            this.winner = [1, 2];
            this.results.push({ type: "eog", reason: "repetition" });
        }
        if (this.gameover) {
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public state(): IHexentaflState {
        return {
            game: HexentaflGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: HexentaflGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(Array.from(this.board, ([key, value]) => [key, [...value]])),
        };
    }

    public render(): APRenderRep {
        // Build piece string
        const pstr: string[][] = [];
        const cells = this.graph.listCells(true);
        for (const row of cells) {
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const [owner, piece] = this.board.get(cell)!;
                    if (owner === 1) {
                        pieces.push("A")
                    } else {
                        if (piece === "K") {
                            pieces.push("D");
                        } else {
                            pieces.push("B");
                        }
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr.push(pieces);
        }

        const markers: MarkerFlood[] = [];
        const edgePoints: { row: number, col: number }[] = [];
        for (const cell of this.corners) {
            const [x, y] = this.algebraic2coords(cell);
            edgePoints.push({ row: y, col: x });
        }
        const [xC, yC] = this.algebraic2coords(this.centre);
        markers.push({ type: "flood", colour: 1, opacity: 0.4, points: edgePoints as [{ row: number, col: number }, ...[{ row: number, col: number }]] });
        markers.push({ type: "flood", colour: 2, opacity: 0.4, points: [{ row: yC, col: xC }] });

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "hex-of-hex",
                minWidth: this.boardSize,
                maxWidth: (this.boardSize * 2) - 1,
                markers,
            },
            legend: {
                A: {
                    name: "piece",
                    colour: 1
                },
                B: {
                    name: "piece",
                    colour: 2
                },
                D: {
                    name: "piece-horse",
                    colour: 2
                },
            },
            pieces: pstr.map(p => p.join("")).join("\n"),
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = this.algebraic2coords(move.from);
                    const [toX, toY] = this.algebraic2coords(move.to);
                    rep.annotations.push({ type: "move", targets: [{ row: fromY, col: fromX }, { row: toY, col: toX }] });
                } else if (move.type === "capture") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({ type: "exit", targets: [{ row: y, col: x }] });
                }
            }
        }
        if (this.dots.length > 0) {
            if (rep.annotations === undefined) {
                rep.annotations = [];
            }
            const points: { row: number, col: number}[] = [];
            for (const cell of this.dots) {
                const [x, y] = this.algebraic2coords(cell);
                points.push({ row: y, col: x });
            }
            rep.annotations.push({ type: "dots", targets: points as [{ row: number, col: number }, ...[{ row: number, col: number }]] });
        }
        return rep;
    }

    public getPlayerPieces(player: number): number {
        return [...this.board.values()].filter(([p, pc]) => p === player && pc !== "K").length;
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.PIECESREMAINING"), scores: [this.getPlayerPieces(1), this.getPlayerPieces(2)] }
        ]
    }

    public inCheck(): number[] {
        if (this.gameover && this.lastmove !== undefined && this.specialMove(this.lastmove)) {
            return [];
        }
        const checks: playerid[] = [];
        for (const move of this.moves(2)) {
            if (this.kingEscaped(move)) {
                checks.push(1);
                break;
            }
        }
        for (const move of this.moves(1)) {
            if (this.kingDead(move)) {
                checks.push(2);
                break;
            }
        }
        return checks;
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += `**In Check:** ${this.inCheck().toString()}\n\n`;

        status += "**Pieces On Board:**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            status += `Player ${n}: ${this.getPlayerPieces(n)}\n\n`;
        }

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "move":
                if (r.what === "K") {
                    node.push(i18next.t("apresults:MOVE.hexentafl_king", { player, from: r.from, to: r.to }));
                } else {
                    node.push(i18next.t("apresults:MOVE.nowhat", { player, from: r.from, to: r.to }));
                }
                resolved = true;
                break;
            case "capture":
                if (r.what === "K") {
                    node.push(i18next.t("apresults:CAPTURE.hexentafl_king", { player, where: r.where }));
                } else {
                    node.push(i18next.t("apresults:CAPTURE.nowhat", { player, where: r.where }));
                }
                resolved = true;
                break;
            case "eog":
                if (r.reason === "repetition") {
                    node.push(i18next.t("apresults:EOG.repetition", { count: 3 }));
                } else {
                    node.push(i18next.t("apresults:EOG.default"));
                }
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): HexentaflGame {
        return new HexentaflGame(this.serialize());
    }
}
