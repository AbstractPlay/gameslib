/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { HexTriGraph } from "../common/graphs";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

export type playerid = 1|2|3;  // Player 3 is used for the neutral obstacle pieces.
type directions = "NE"|"E"|"SE"|"SW"|"W"|"NW"
const allDirections: directions[] = ["NE","E","SE","SW","W","NW"];

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid[]>;
    lastmove?: string;
};

export interface IOnagerState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class OnagerGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Onager",
        uid: "onager",
        playercounts: [2],
        version: "20240121",
        dateAdded: "2024-02-01",
        // i18next.t("apgames:descriptions.onager")
        description: "apgames:descriptions.onager",
        urls: ["https://boardgamegeek.com/boardgame/131047/onager"],
        people: [
            {
                type: "designer",
                name: "Néstor Romeral Andrés",
                urls: ["https://boardgamegeek.com/boardgamedesigner/9393/nestor-romeral-andres"]
            }
        ],
        categories: ["goal>breakthrough", "mechanic>capture",  "mechanic>move", "board>shape>hex", "board>connect>hex", "components>simple>3c"],
        flags: ["multistep", "check", "perspective"],
        variants: [
            // { uid: "size-7", group: "board" },
        ],
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid[]>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private boardSize = 0;
    private graph: HexTriGraph;
    private _points: [number, number][] = [];
    private centreCell = "";

    constructor(state?: IOnagerState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            // Graph and board size properties are assigned after because
            // they're common to both fresh and loaded games.
            const boardSize = this.getBoardSize();
            const graph = this.getGraph(boardSize);
            const board: Map<string, playerid[]> = new Map();
            for (let i = 0; i < 2; i++) {
                for (let j = 0; j < boardSize + i; j++) {
                    board.set(graph.coords2algebraic(j, boardSize * 2 - 2 - i), [1]);
                    board.set(graph.coords2algebraic(j, i), [2]);
                }
            }
            const fresh: IMoveState = {
                _version: OnagerGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IOnagerState;
            }
            if (state.game !== OnagerGame.gameinfo.uid) {
                throw new Error(`The Onager engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
        this.graph = this.getGraph(this.boardSize)
        this.centreCell = this.graph.coords2algebraic(this.boardSize - 1, this.boardSize - 1);
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
        return 6;
    }

    public load(idx = -1): OnagerGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = deepclone(state.board) as Map<string, playerid[]>;
        this.lastmove = state.lastmove;
        this.results = [...state._results];
        this.boardSize = this.getBoardSize();
        return this;
    }

    private getGraph(boardSize: number): HexTriGraph {
        return new HexTriGraph(boardSize, boardSize * 2 - 1);
    }

    private getControlledCells(player: playerid): string[] {
        // Get all cells controlled by `player` (stacks with player piece on top).
        return [...this.board.entries()].filter(e => e[1][e[1].length - 1] === player).map(e => e[0]);
    }

    private getTopPiece(cell: string): playerid | undefined {
        // Get the top piece on `cell`. If `cell` is empty, return undefined.
        if (!this.board.has(cell)) { return undefined; }
        const stack = this.board.get(cell)!;
        return stack[stack.length - 1];
    }

    private getWalks(cell: string): string[] {
        // Get possible walks to empty cells neighbouring `cell`.
        const neighbours = this.graph.neighbours(cell);
        const walks: string[] = [];
        for (const n of neighbours) {
            if (!this.board.has(n)) {
                walks.push(n);
            }
        }
        return walks;
    }

    private getJumps(froms: string[], player?: playerid): string[] {
        // Get possible jumps to empty cells neighbouring `cell`
        // `froms` is the list of cells that have been jumped from.
        // Jumps cannot be to any of the cells in `froms`.
        // If a piece jumps to an opponent's piece, it may continue jumping.
        if (player === undefined) {
            player = this.getTopPiece(froms[0])!;
        }
        const jumps: string[] = [];
        const currFrom = froms[froms.length - 1];
        for (const direction of allDirections) {
            const ray = this.graph.ray(...this.graph.algebraic2coords(currFrom), direction);
            let halfJumpLength: number | undefined;
            for (const [i, checkCell] of ray.map(c => this.graph.coords2algebraic(...c)).entries()) {
                const topPiece = this.getTopPiece(checkCell);
                if (halfJumpLength === undefined) {
                    if (topPiece !== undefined && topPiece !== player) { break; }
                    if (topPiece === player) { halfJumpLength = i + 1; }
                }
            }
            if (halfJumpLength === undefined) { continue; }
            if (ray.length > 2 * halfJumpLength - 1) {
                const jumpCell = this.graph.coords2algebraic(...ray[2 * halfJumpLength - 1]);
                if (froms.includes(jumpCell)) { continue; }
                const topPiece = this.getTopPiece(jumpCell);
                if (topPiece === undefined || topPiece === player % 2 + 1) {
                    jumps.push(jumpCell);
                }
            }
        }
        return jumps;
    }

    private getAllJumps(froms: string[], player?: playerid): string[][] {
        // Recursively get all chains of cells to jump to from `cell`.
        // No checks are done to see if from cells are valid.
        if (player === undefined) {
            player = this.getTopPiece(froms[0])!;
        }
        const jumps: string[][] = [];
        for (const jump of this.getJumps(froms, player)) {
            const newFroms = [...froms, jump];
            jumps.push(newFroms);
            const topPiece = this.getTopPiece(jump);
            if (topPiece !== player % 2 + 1) { continue; }
            jumps.push(...this.getAllJumps(newFroms, player));
        }
        return jumps;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves: string[] = [];
        if (this.stack.length < 4) {
            // Placement phase
            for (const cell of this.graph.listCells(true).flat()) {
                if (!this.board.has(cell) && cell !== this.centreCell) {
                    moves.push(cell);
                }
            }
            return moves;
        }
        const controlledCells = this.getControlledCells(player);
        for (const cell of controlledCells) {
            for (const walk of this.getWalks(cell)) {
                moves.push(`${cell}-${walk}`);
            }
            for (const jump of this.getAllJumps([cell], player)) {
                moves.push(jump.join("-"));
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
            let newmove = "";
            const cell = this.graph.coords2algebraic(col, row);
            if (this.stack.length < 4) {
                newmove = cell;
            } else {
                if (move === "") {
                    newmove = cell;
                } else {
                    newmove = `${move}-${cell}`;
                }
            }
            let result = this.validateMove(newmove) as IClickResult;
            if (!result.valid) {
                if (this.stack.length > 3 && this.getTopPiece(cell) === this.currplayer) {
                    result = this.validateMove(cell) as IClickResult;
                    if (!result.valid) {
                        result.move = "";
                    } else {
                        result.move = cell;
                    }
                } else {
                    result.move = "";
                }
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
            if (this.stack.length < 4) {
                result.message = i18next.t("apgames:validation.onager.INITIAL_INSTRUCTIONS_PLACE");
            } else {
                result.message = i18next.t("apgames:validation.onager.INITIAL_INSTRUCTIONS");
            }
            return result;
        }

        if (this.stack.length < 4) {
            // Placement phase
            try {
                const [, y] = this.graph.algebraic2coords(m);
                // `algebraic2coords` does not check if the cell is on the board fully.
                if (y < 0) { throw new Error("Invalid cell."); }
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: m})
                return result;
            }

            // Cell is empty
            if (this.board.has(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: m});
                return result;
            }

            // No placing lake at centre.
            if (m === this.centreCell) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.onager.CENTRE_PLACEMENT", {where: this.centreCell});
                return result;
            }
            // looks good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        const moves = m.split("-")

        // valid cell
        let tryCell;
        try {
            for (const cell of moves) {
                if (cell === undefined) { continue; }
                tryCell = cell;
                const [, y] = this.graph.algebraic2coords(cell);
                // `algebraic2coords` does not check if the cell is on the board fully.
                if (y < 0) { throw new Error("Invalid cell."); }
            }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: tryCell})
            return result;
        }

        const from = moves[0];
        // from check
        if (!this.board.has(from)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: from})
            return result;
        }
        const fromStack = this.board.get(from)!;
        // top checker is player's
        if (fromStack[fromStack.length - 1] !== this.currplayer) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.UNCONTROLLED")
            return result;
        }
        const toStacks = moves.slice(1).map(c => this.board.get(c));
        if (toStacks.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.onager.SELECT_TO");
            return result;
        }
        // walk
        const walkTos = this.getWalks(from);
        if (walkTos.includes(moves[1])) {
            if (moves.length > 2) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.onager.CONTINUE");
                return result;
            }
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
        // jump
        let valid = true
        // check if the sequence of jumps is completely valid.
        for (let i = 1; i < moves.length; i++) {
            if (!this.getJumps(moves.slice(0, i), this.currplayer).includes(moves[i])) {
                valid = false;
                break;
            }
        }
        if (!valid) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.onager.INVALID_MOVES", {moves: m});
            return result;
        }
        if (this.getTopPiece(moves[moves.length - 1]) === this.currplayer % 2 + 1) {
            if (this.getJumps(moves, this.currplayer).length > 0) {
                result.valid = true;
                result.complete = 0;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.onager.OPTIONAL_CONTINUE");
                return result
            }
        }
        // we're good
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {partial = false, trusted = false} = {}): OnagerGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (! trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (!partial && !this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }
        if (m.length === 0) { return this; }
        this.results = [];

        if (this.stack.length < 4) {
            this.board.set(m, [3]);
            this.results.push({type: "place", where: m});
        } else {
            const moves = m.split("-");
            if (partial) {
                this._points = [];
                if (moves.length === 1) {
                    this._points.push(...this.getWalks(moves[0]).map(w => this.graph.algebraic2coords(w)));
                    this._points.push(...this.getJumps(moves, this.currplayer).map(j => this.graph.algebraic2coords(j)));
                } else if (this.getTopPiece(moves[moves.length - 1]) === this.currplayer % 2 + 1) {
                    this._points.push(...this.getJumps(moves, this.currplayer).map(j => this.graph.algebraic2coords(j)));
                }
            }
            if (moves.length > 1) {
                const from = moves[0];
                if (this.board.has(from)) {
                    const fromPiece = this.board.get(from)!;
                    if (fromPiece.length === 1) {
                        this.board.delete(from);
                    } else {
                        this.board.set(from, fromPiece.slice(0, fromPiece.length - 1));
                    }
                }
                const tos = moves.slice(1);
                const to = tos[tos.length - 1];
                if (this.board.has(to)) {
                    this.board.set(to, [...this.board.get(to)!, this.currplayer]);
                } else {
                    this.board.set(to, [this.currplayer]);
                }
                for (let i = 0; i < moves.length - 1; i++) {
                    this.results.push({type: "move", from: moves[i], to: moves[i + 1]});
                }
            }
            if (partial) { return this; }
            this._points = [];
        }
        // update currplayer
        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    private inOpponentHomeCount(): [number, number] {
        // Get the number of pieces in the opponent's home row for each player.
        const counts: [number, number] = [0, 0];
        for (let i = 0; i < this.boardSize; i++) {
            const cell1 = this.graph.coords2algebraic(i, 0);
            if (this.getTopPiece(cell1) === 1) {
                counts[0] += 1;
            }
            const cell2 = this.graph.coords2algebraic(i, this.boardSize * 2 - 2);
            if (this.getTopPiece(cell2) === 2) {
                counts[1] += 1;
            }
        }
        return counts;
    }

    public inCheck(): number[] {
        // Only detects check for the current player
        const inOpponentHomeCount = this.inOpponentHomeCount();
        const myCount = inOpponentHomeCount[this.currplayer - 1];
        const theirCount = inOpponentHomeCount[this.currplayer % 2];
        if (theirCount > myCount) {
            return [this.currplayer];
        } else {
            return [];
        }
    }

    protected checkEOG(): OnagerGame {
        // We are now at the START of `this.currplayer`'s turn
        const inOpponentHomeCount = this.inOpponentHomeCount();
        const myCount = inOpponentHomeCount[this.currplayer - 1];
        const theirCount = inOpponentHomeCount[this.currplayer % 2];
        if (myCount > theirCount) {
            this.gameover = true;
            this.winner = [this.currplayer];
        }
        if (!this.gameover && this.moves().length === 0) {
            this.gameover = true;
            this.winner = [this.currplayer % 2 + 1 as playerid];
        }
        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IOnagerState {
        return {
            game: OnagerGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    public moveState(): IMoveState {
        return {
            _version: OnagerGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: deepclone(this.board) as Map<string, playerid[]>,
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (const row of this.graph.listCells(true)) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const stack = this.board.get(cell)!;
                    pieces.push(stack.join("").replace(/1/g, "A").replace(/2/g, "B").replace(/3/g, "C"));
                } else {
                    pieces.push("-");
                }

            }
            pstr += pieces.join(",");
        }

        // Build marker points to show home row.
        const points1 = [];
        const points2 = [];
        for (let i = 0; i < this.boardSize; i++) {
            points1.push({row: this.boardSize * 2 - 2, col: i});
            points2.push({row: 0, col: i});
        }

        // Build rep
        const rep: APRenderRep =  {
            renderer: "stacking-offset",
            board: {
                style: "hex-of-hex",
                minWidth: this.boardSize,
                maxWidth: (this.boardSize * 2) - 1,
                markers: [
                    { type: "flood", colour: 1, opacity: 0.25, points: points1 as [{ row: number; col: number; }, ...{ row: number; col: number; }[]] },
                    { type: "flood", colour: 2, opacity: 0.25, points: points2 as [{ row: number; col: number; }, ...{ row: number; col: number; }[]] },
                ],
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
                C: {
                    name: "piece",
                    colour: 3,
                },
            },
            pieces: pstr,
        };

        // Add annotations
        // @ts-ignore
        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "move") {
                    const [fx, fy] = this.graph.algebraic2coords(move.from);
                    const [tx, ty] = this.graph.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fy, col: fx},{row: ty, col: tx}]});
                }
            }
        }
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
                    const [x, y] = this.graph.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }
        if (this._points.length > 0) {
            const points = [];
            for (const cell of this._points) {
                points.push({row: cell[1], col: cell[0]});
            }
            // @ts-ignore
            rep.annotations.push({type: "dots", targets: points});
        }
        return rep;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "move":
                if (this.graph.neighbours(r.from).includes(r.to)) {
                    node.push(i18next.t("apresults:MOVE.onager_walk", {player, from: r.from, to: r.to}));
                } else {
                    node.push(i18next.t("apresults:MOVE.onager_jump", {player, from: r.from, to: r.to}));
                }
                resolved = true;
                break;
            case "place":
                node.push(i18next.t("apresults:PLACE.onager", {player, where: r.where}));
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

    public clone(): OnagerGame {
        return new OnagerGame(this.serialize());
    }
}
