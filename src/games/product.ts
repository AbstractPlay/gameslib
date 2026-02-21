import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { HexTriGraph } from "../common/graphs";

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface IProductState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class ProductGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Product",
        uid: "product",
        playercounts: [2],
        version: "20240219",
        dateAdded: "2024-02-19",
        // i18next.t("apgames:descriptions.product")
        description: "apgames:descriptions.product",
        urls: ["https://boardgamegeek.com/boardgame/136995/produto",
               "https://jpneto.github.io/world_abstract_games/product.htm"],
        people: [
            {
                type: "designer",
                name: "Nick Bentley",
                urls: ["https://boardgamegeek.com/boardgamedesigner/7958/nick-bentley"],
            },
            {
                type: "coder",
                name: "João Pedro Neto",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3829/joao-pedro-neto"],
                apid: "9228bccd-a1bd-452b-b94f-d05380e6638f",
            },
        ],
        categories: ["goal>majority", "mechanic>place", "board>shape>hex"],
        variants: [
            { uid: "size-4", group: "board" },
            { uid: "#board", },
            { uid: "size-6", group: "board" },
            { uid: "size-7", group: "board" },
        ],
        flags: ["scores", "no-moves", "experimental"]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public graph: HexTriGraph = new HexTriGraph(7, 13);
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public boardSize = 5;

    constructor(state?: IProductState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: ProductGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IProductState;
            }
            if (state.game !== ProductGame.gameinfo.uid) {
                throw new Error(`The Product engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): ProductGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.lastmove = state.lastmove;
        this.boardSize = this.getBoardSize();
        this.buildGraph();
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
        return 5;
    }

    private getGraph(): HexTriGraph {
        return new HexTriGraph(this.boardSize, this.boardSize * 2 - 1);
    }

    private buildGraph(): ProductGame {
        this.graph = this.getGraph();
        return this;
    }

    /**
     * For sorting movements using the game notation
     * Notation eg: '1c3' means player 1 placed at hex c3
     */
    private sort(a: string, b: string): number {
        // First sort by player id
        if (a[0] < b[0]) { return -1; }
        if (a[0] > b[0]) { return +1; }

        // If same player, sort the two cells; necessary because "a10" should come after "a9"
        const [ax, ay] = this.graph.algebraic2coords(a.slice(1));
        const [bx, by] = this.graph.algebraic2coords(b.slice(1));
        if (ay < by) { return  1; }
        if (ay > by) { return -1; }
        if (ax < bx) { return -1; }
        if (ax > bx) { return  1; }
        return 0;
    }

    // Get all groups of pieces for `player`, sorted by decreasing size
    private getGroupSizes(player: playerid): number[] {
        const groups: Set<string>[] = [];
        const pieces = [...this.board.entries()].filter(e => e[1] === player).map(e => e[0]);
        const seen: Set<string> = new Set();
        for (const piece of pieces) {
            if (seen.has(piece)) {
                continue;
            }
            const group: Set<string> = new Set();
            const todo: string[] = [piece];
            while (todo.length > 0) {
                const cell = todo.pop()!;
                if (seen.has(cell)) {
                    continue;
                }
                group.add(cell);
                seen.add(cell);
                const neighbours = this.graph.neighbours(cell);
                for (const n of neighbours) {
                    if (pieces.includes(n)) {
                        todo.push(n);
                    }
                }
            }
            groups.push(group);
        }

        while ( groups.length < 2 ) {
          // guarantee that players always have, at least, two groups
          groups.push(new Set());
        }
        return groups.map(g => g.size).sort((a, b) => b - a);
    }

    public moves(): string[] {
        if (this.gameover) { return []; }
        const moves: string[] = [];

        if (this.stack.length === 1) {
            // At ply 1, there's just one move
            for (const cell of this.graph.listCells(false) as string[]) {
                if (this.board.has(cell)) { continue; }
                moves.push(this.normaliseMove(`1${cell}`));
                moves.push(this.normaliseMove(`2${cell}`));
            }
        } else {
            // At ply 2+, pick two different empty hexes and add placement
            //  for all four color permutations
            for (const cell1 of this.graph.listCells(false) as string[]) {
                if (this.board.has(cell1)) { continue; }
                for (const cell2 of this.graph.listCells(false) as string[]) {
                    if (cell1 === cell2 || this.board.has(cell2)) { continue; }
                    moves.push(this.normaliseMove(`1${cell1},1${cell2}`));
                    moves.push(this.normaliseMove(`1${cell1},2${cell2}`));
                    moves.push(this.normaliseMove(`2${cell1},1${cell2}`));
                    moves.push(this.normaliseMove(`2${cell1},2${cell2}`));
                }
            }
        }

        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    /**
     * Updates a list of coordinates based on the selection cycle:
     *   Current Player's Piece -> Enemy Piece -> Empty (Delete)
     * So that users can choose which color they prefer placing on an empty hex
     * @param coordinates - Current list of prefixed coordinates (e.g., ['1c1', '2d3'])
     * @param newCoord - The raw coordinate selected (e.g., 'c1')
     * @param currentPlayer - The player making the selection (1 or 2)
     * @returns The updated list of coordinates
     */
    private processMoves(coordinates: string[],
                         newCoord: string,
                         currentPlayer: number): string[] {
        const enemyPlayer = currentPlayer === 1 ? 2 : 1;
        // check if the new cell already exists in the coordinates list
        const existingEntry = coordinates.find(c => c.endsWith(newCoord));

        if (!existingEntry) {
            // if not in the list, add it with the current player's prefix
            return [...coordinates, `${currentPlayer}${newCoord}`];
        }

        const currentPrefix = existingEntry[0]; // get the first digit ('1' or '2')
        const otherCoordinates = coordinates.filter(c => !c.endsWith(newCoord));

        if (currentPrefix === currentPlayer.toString()) {
            // Own Piece -> Enemy Piece: replace the entry with the enemy prefix
            return [...otherCoordinates, `${enemyPlayer}${newCoord}`];
        }
        // Enemy Piece -> Empty: return the list without this coordinate
        return otherCoordinates;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove: string = "";
            const cell = this.graph.coords2algebraic(col, row);

            if (move === "") {
                // a placement includes the current player id as a prefix
                newmove = `${this.currplayer}${cell}`;
            } else {
                const moves : string[] = move.split(",");
                newmove = this.processMoves(moves, cell, this.currplayer)
                              .sort((a, b) => this.sort(a, b))
                              .join(",");
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

    private spacesLeft(): number {
        // Count the number of empty cells.
        return this.graph.listCells().length - this.board.size;
    }

    private normaliseMove(move: string): string {
        // Sort the move list so that there is a unique representation.
        move = move.toLowerCase();
        move = move.replace(/\s+/g, "");
        return move.split(",").sort((a, b) => this.sort(a, b)).join(",");
    }

    public sameMove(move1: string, move2: string): boolean {
        return this.normaliseMove(move1) === this.normaliseMove(move2);
    }

    public validateMove(m: string): IValidationResult {
        const nMovesTurn = 2;
        const result: IValidationResult = {valid: false,
                                           message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            if (this.stack.length == 1) {
                result.message = i18next.t("apgames:validation.product.INITIAL_INSTRUCTIONS");
            } else {
                result.message = i18next.t("apgames:validation.product.INSTRUCTIONS");
            }
            return result;
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const moves = m.split(',');

        if (moves.length > nMovesTurn) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.product.TOO_MANY_MOVES");
            return result;
        }

        // Is it a valid cell?
        let currentMove;
        try {
            for (const move of moves) {
                currentMove = move.slice(1);
                if (! (this.graph.listCells() as string []).includes(currentMove)) {
                    throw new Error("Invalid cell.");
                }
            }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: currentMove});
            return result;
        }

        // Is is an empty cell?
        let notEmpty;
        for (const move of moves) {
            if (this.board.has(move.slice(1))) { notEmpty = move.slice(1); break; }
        }
        if (notEmpty) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: notEmpty});
            return result;
        }

        // possible to use moves() list to validate, but regex is (kind of?) fun
        const regex = new RegExp(`^[12][a-z]\\d+(,[12][a-z]\\d+)?$`);
        if (!regex.test(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.product.INVALID_PLACEMENT", {move: m});
            return result;
        }

        // is move normalised? (sanity check, in case user types the move)
        const normalised = this.normaliseMove(m);
        if (! this.sameMove(m, normalised)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.product.NORMALISED", {move: normalised});
            return result;
        }

        if (this.stack.length === 1) {
            if (moves.length === 1) {
                // initially, the first player can only move once (either color)
                result.valid = true;
                result.complete = 0; // 0 so the player may flip before submitting
                result.canrender = true;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.product.TOO_MANY_MOVES_START");
            }
            return result;
        }

        if (moves.length < nMovesTurn) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.product.INCOMPLETE_TURN");
            return result;
        }

        result.valid = true;
        result.complete = 0; // 0 so the player may flip also the last placement
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, { partial = false, trusted = false } = {}): ProductGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
        }

        if (m.length === 0) { return this; }

        const nMovesTurn = 2;
        m = this.normaliseMove(m);
        const moves = m.split(",");

        this.results = [];
        for (const move of moves) {
            const thePlayer = move[0];
            const theMove = move.slice(1);
            this.board.set(theMove, thePlayer == '1' ? 1 : 2);
            this.results.push({type: "place", where: theMove});
        }

        this.lastmove = m;

        if (partial) { return this; }
        // the game should not accept a single placement if the game is after ply 1
        if (this.stack.length > 1 && moves.length < nMovesTurn) { return this; }

        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): ProductGame {
        this.gameover = this.spacesLeft() === 0;

        if (this.gameover) {
            // tied scores is a P2 win
            this.winner = this.getPlayerScore(1) > this.getPlayerScore(2) ? [1] : [2];
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }

        return this;
    }

    public state(): IProductState {
        return {
            game: ProductGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    public moveState(): IMoveState {
        return {
            _version: ProductGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
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
                A: {name: "hex-pointy", scale: 1.25, colour: 1 },
                B: {name: "hex-pointy", scale: 1.25, colour: 2 },
            },
            pieces: pstr.map(p => p.join("")).join("\n"),
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
                    const [x, y] = this.graph.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }
        return rep;
    }

    public getPlayerScore(player: playerid): number {
        const groups = this.getGroupSizes(player);
        return groups[0] * groups[1]; // multiply the two largest groups
    }

    public getPlayersScores(): IScores[] {
        return [{ name: i18next.t("apgames:status.SCORES"),
                  scores: [this.getPlayerScore(1), this.getPlayerScore(2)] }];
    }

    public status(): string {
        let status = super.status();
        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }
        return status;
    }

    public clone(): ProductGame {
        return new ProductGame(this.serialize());
    }
}
