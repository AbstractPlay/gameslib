import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { HexTriGraph, reviver, UserFacingError } from "../common";
import i18next from "i18next";

type playerid = 1 | 2;

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    surroundedCells: string[];
    lastmove?: string;
}

export interface ISusanState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class SusanGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Susan",
        uid: "susan",
        playercounts: [2],
        version: "20240505",
        dateAdded: "2024-05-05",
        // i18next.t("apgames:descriptions.susan")
        description: "apgames:descriptions.susan",
        urls: [
            "https://www.stephen.com/sue/sue.html",
            "https://boardgamegeek.com/boardgame/26135/susan"
        ],
        people: [
            {
                type: "designer",
                name: "Stephen Linhart",
                urls: ["https://www.stephen.com"]
            },
        ],
        variants: [],
        categories: ["goal>align", "mechanic>place", "mechanic>move", "board>shape>hex", "board>connect>hex", "components>simple"],
        flags: ["experimental"],
    };

    public coords2algebraic(x: number, y: number): string {
        return this.graph.coords2algebraic(x, y);
    }

    public algebraic2coords(cell: string): [number, number] {
        return this.graph.algebraic2coords(cell);
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, playerid>;
    public surroundedCells!: string[];
    public graph: HexTriGraph = new HexTriGraph(7, 13);
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private boardSize = 0;
    private dots: string[] = [];

    constructor(state?: ISusanState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: SusanGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                surroundedCells: [],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ISusanState;
            }
            if (state.game !== SusanGame.gameinfo.uid) {
                throw new Error(`The Susan game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): SusanGame {
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
        this.surroundedCells = [...state.surroundedCells];
        this.lastmove = state.lastmove;
        this.boardSize = this.getBoardSize();
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
        return 5;
    }

    private getGraph(): HexTriGraph {
        return new HexTriGraph(this.boardSize, (this.boardSize * 2) - 1);
    }

    private buildGraph(): SusanGame {
        this.graph = this.getGraph();
        return this;
    }

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }
        const moves: string[] = [];
        for (const cell of this.graph.listCells(false) as string[]) {
            if (this.board.has(cell)) {
                if (this.board.get(cell) === player) {
                    for (const to of this.getTos(cell)) {
                        moves.push(cell + "-" + to);
                    }
                }
            } else {
                moves.push(cell);
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
            if (this.board.has(cell)) {
                newmove = cell + "-";
            } else {
                if (move.endsWith("-")) {
                    newmove = move + cell;
                } else {
                    newmove = cell;
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

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = { valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER") };
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.susan.INITIAL_INSTRUCTIONS");
            return result;
        }
        const split = m.split("-");
        let currentMove;
        try {
            for (const p of split) {
                if (p === "") { continue; }
                currentMove = p;
                const [x, y] = this.algebraic2coords(p);
                // `algebraic2coords` does not check if the cell is on the board.
                if (x < 0 || y < 0) { throw new Error("Invalid cell."); }
            }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: currentMove });
            return result;
        }
        if (m.includes("-")) {
            const [from, to] = split;
            // From cell must have a piece.
            if (!this.board.has(from)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.susan.EMPTY_FROM", { where: from });
                return result;
            }
            if (this.board.get(from) !== this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.susan.WRONG_PLAYER");
                return result;
            }
            if (to === undefined || to === "") {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.susan.SELECT_TO");
                return result;
            }
            if (!this.graph.neighbours(from).includes(to)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.susan.NOT_ADJACENT", { from, to });
            }
            if (this.board.has(to)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.general.OCCUPIED", { where: to });
                return result;
            }
        } else {
            if (this.board.has(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.general.OCCUPIED", { where: m });
                return result;
            }
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private getTos(cell: string): string[] {
        // Get all spaces that a piece can move to.
        const tos: string[] = [];
        for (const neighbour of this.graph.neighbours(cell)) {
            if (!this.board.has(neighbour)) { tos.push(neighbour); }
        }
        return tos;
    }

    private updateSurrounded(cell: string): void {
        // Check if there are any pieces that are surrounded.
        outer:
        for (const neighbour of this.graph.neighbours(cell)) {
            if (!this.board.has(neighbour)) { continue; }
            for (const neighbour2 of this.graph.neighbours(neighbour)) {
                if (!this.board.has(neighbour2)) { continue outer; }
            }
            this.surroundedCells.push(neighbour);
        }
    }

    public move(m: string, {partial = false, trusted = false} = {}): SusanGame {
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
        if (m.includes("-")) {
            const [from, to] = m.split("-");
            if (to === undefined || to === "") {
                this.dots = this.getTos(from);
            } else {
                this.board.delete(from);
                this.board.set(to, this.currplayer);
                this.results.push({ type: "move", from, to });
                this.updateSurrounded(to);
            }
        } else {
            this.results.push({ type: "place", where: m });
            this.board.set(m, this.currplayer);
            this.updateSurrounded(m);
        }
        if (partial) { return this; }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    private checkDraw(count: number): boolean {
        // If the previous six moves have been "move" results, the game is a draw.
        if (this.stack.length < count - 1) { return false; }
        if (this.results[0].type !== "move") { return false; }
        for (let i = 0; i < count - 1; i++) {
            if (this.stack[this.stack.length - i - 1]._results[0].type !== "move") { return false; }
        }
        return true;
    }

    protected checkEOG(): SusanGame {
        if (this.surroundedCells.length > 0) {
            const surroundedPlayers: Set<playerid> = new Set();
            for (const cell of this.surroundedCells) {
                surroundedPlayers.add(this.board.get(cell)!);
            }
            this.gameover = true;
            if (surroundedPlayers.has(this.currplayer)) {
                if (surroundedPlayers.has(this.currplayer % 2 + 1 as playerid)) {
                    this.winner = [this.currplayer];
                } else {
                    this.winner = [this.currplayer % 2 + 1 as playerid];
                }
            } else {
                this.winner = [this.currplayer % 2 + 1 as playerid];
            }
            this.results.push({ type: "eog" });
        }
        if (!this.gameover && this.checkDraw(6)) {
            this.gameover = true;
            this.winner = [1, 2];
            this.results.push({ type: "eog", reason: "nonplacement" });
        }
        if (this.gameover) {
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public state(): ISusanState {
        return {
            game: SusanGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: SusanGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            surroundedCells: [...this.surroundedCells],
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
            board: {
                style: "hex-of-hex",
                minWidth: this.boardSize,
                maxWidth: (this.boardSize * 2) - 1,
            },
            legend: {
                A: {
                    name: "piece",
                    player: 1
                },
                B: {
                    name: "piece",
                    player: 2
                },
                X: {
                    name: "x",
                },
            },
            pieces: pstr.map(p => p.join("")).join("\n"),
            key: []

        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
                    const [x, y] = this.graph.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                } else if (move.type === "move") {
                    const [fromX, fromY] = this.algebraic2coords(move.from);
                    const [toX, toY] = this.algebraic2coords(move.to);
                    rep.annotations.push({ type: "move", targets: [{ row: fromY, col: fromX }, { row: toY, col: toX }] });
                }
            }
        }
        if (this.dots.length > 0) {
            const points = [];
            for (const cell of this.dots) {
                const [x, y] = this.algebraic2coords(cell);
                points.push({ row: y, col: x });
            }
            // @ts-ignore
            rep.annotations.push({ type: "dots", targets: points });
        }
        if (this.surroundedCells.length > 0) {
            const points = [];
            for (const cell of this.surroundedCells) {
                const [x, y] = this.algebraic2coords(cell);
                points.push({ row: y, col: x });
            }
            // @ts-ignore
            rep.annotations.push({ type: "glyph", glyph: "X", targets: points });
        }
        return rep;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.nowhat", { player, where: r.where }));
                resolved = true;
                break;
            case "move":
                node.push(i18next.t("apresults:MOVE.susan", { player, from: r.from, to: r.to }));
                resolved = true;
                break;
            case "eog":
                if (r.reason === "nonplacement") {
                    node.push(i18next.t("apresults:EOG.susan_nonplacement"));
                } else {
                    node.push(i18next.t("apresults:EOG.default"));
                }
                resolved = true;
                break;
        }
        return resolved;
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        return status;
    }

    public clone(): SusanGame {
        return new SusanGame(this.serialize());
    }
}
