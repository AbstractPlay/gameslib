/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { HexTriGraph } from "../common/graphs";

export type pieceType = 1|2|3;

export interface IMoveState extends IIndividualState {
    currplayer: pieceType;
    board: Map<string, pieceType>;
    lastmove?: string;
};

export interface IQuagmireState extends IAPGameState {
    winner: pieceType[];
    stack: Array<IMoveState>;
};

export class QuagmireGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Quagmire",
        uid: "quagmire",
        playercounts: [2],
        version: "20231122",
        dateAdded: "2023-11-26",
        // i18next.t("apgames:descriptions.quagmire")
        description: "apgames:descriptions.quagmire",
        urls: ["https://cjffield.com/rules/quagmire.pdf"],
        people: [
            {
                type: "designer",
                name: "Christopher Field",
                urls: ["https://cjffield.com/"]
            }
        ],
        categories: ["goal>immobilize", "mechanic>block",  "mechanic>move", "board>shape>hex", "board>connect>hex", "components>simple>3c"],
        flags: [],
        variants: [
            {
                uid: "large",
                name: "Large",
                group: "board"
            },
            {
                uid: "random",
                name: "Random",
                group: "setup"
            }
        ],
    };

    public static readonly PLAYER_ONE = 1;
    public static readonly PLAYER_TWO = 2;
    public static readonly FLOOD = 3;

    public numplayers = 2;
    public currplayer: pieceType = QuagmireGame.PLAYER_ONE;
    public board!: Map<string, pieceType>;
    public boardsize = 4;
    public graph: HexTriGraph = new HexTriGraph(4, 7);
    public gameover = false;
    public winner: pieceType[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IQuagmireState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const board = new Map<string, pieceType>();
            if (this.variants !== undefined && this.variants.length > 0 && this.variants.includes("random")) {
                const boardSize = this.getBoardSize();
                let count = 4 + Math.floor(5*Math.random());
                if (boardSize === 5) count = 5 + Math.floor(6*Math.random());
                const graph = new HexTriGraph(boardSize, (boardSize * 2) - 1);
                for (let i = 0; i < count; i++) {
                    const empties = (graph.listCells() as string[]).filter(c => !board.has(c));
                    const move = empties[Math.floor(Math.random() * empties.length)];
                    board.set(move, QuagmireGame.FLOOD);
                }
            }
            const fresh: IMoveState = {
                _version: QuagmireGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IQuagmireState;
            }
            if (state.game !== QuagmireGame.gameinfo.uid) {
                throw new Error(`The Quagmire engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): QuagmireGame {
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
        this.results = [...state._results];
        this.boardsize = this.getBoardSize();
        this.buildGraph();
        return this;
    }

    private getBoardSize(): number {
        if (this.variants !== undefined
                && this.variants.length > 0
                && this.variants.includes("large")) {
            return 5;
        }
        return 4;
    }

    private getGraph(): HexTriGraph {
        return new HexTriGraph(this.boardsize, (this.boardsize * 2) - 1);
    }

    private buildGraph(): QuagmireGame {
        this.graph = this.getGraph();
        return this;
    }

    public moves(player?: pieceType): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];
        const playerPieces = (this.graph.listCells() as string[]).filter(c => this.board.get(c) === player);

        if (playerPieces.length !== 2) {
            const empties = (this.graph.listCells() as string[]).filter(c => !this.board.has(c));
            for (const empty of empties) {
                moves.push(`${empty}`);
            }
            return moves;
        }

        for (const playerPiece of playerPieces) {
            const emptyNeighbors = this.graph.neighbours(playerPiece).filter(c => !this.board.has(c));
            for (const emptyNeighbor of emptyNeighbors) {
                moves.push(`${playerPiece}-${emptyNeighbor}`);
                const emptyRunNeighbors = this.graph.neighbours(emptyNeighbor).filter(c => !this.board.has(c) && c !== playerPiece);
                for (const emptyRunNeighbor of emptyRunNeighbors) {
                    moves.push(`${playerPiece}-${emptyNeighbor}-${emptyRunNeighbor}`);
                }
            }

            const [x, y] = this.graph.algebraic2coords(playerPiece);

            for (const dir of ["NW", "NE", "W", "E", "SW", "SE"] as const) {
                let move = this.graph.move(x, y, dir, 1);
                if (move === undefined) continue;
                const jumpOver = this.graph.coords2algebraic(move[0], move[1]);
                move = this.graph.move(move[0], move[1], dir, 1);
                if (move === undefined) continue;
                const jumpTarget = this.graph.coords2algebraic(move[0], move[1]);

                if (!this.board.has(jumpTarget)) {
                    if (!this.board.has(jumpOver) || this.board.get(jumpOver) === QuagmireGame.FLOOD) {
                        moves.push(`${playerPiece}-${jumpTarget}`);
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
            if (move.includes("-")) {
                const cells: string[] = move.split(new RegExp('[\-]'));
                if (cells.length >= 3) {
                    return {move, message: ""} as IClickResult;
                }
            }

            const playerPieces = (this.graph.listCells() as string[]).filter(c => this.board.get(c) === this.currplayer);
            if (move === "" && playerPieces.length < 2) {
                const cell = this.graph.coords2algebraic(col, row);
                // Clear the move if they aren't clicking an empty space
                if (this.board.has(cell)) {
                    return {move: "", message: i18next.t("apgames:validation.quagmire.PLACE_MEEPLE")} as IClickResult;
                }

                const result = this.validateMove(cell) as IClickResult;
                if (!result.valid) {
                    result.move = move;
                } else {
                    result.move = cell;
                }
                return result;
            } else if (move === "" && playerPieces.length >= 2) {
                const cell = this.graph.coords2algebraic(col, row);
                // Clear the move if they aren't clicking on one of their pieces
                if (this.board.get(cell) !== this.currplayer) {
                    return {move: "", message: i18next.t("apgames:validation.quagmire.SELECT_MEEPLE")} as IClickResult;
                }

                const result = this.validateMove(cell) as IClickResult;
                if (!result.valid) {
                    result.move = move;
                } else {
                    result.move = cell;
                }
                return result;
            } else {
                const cell = this.graph.coords2algebraic(col, row);
                const result = this.validateMove(`${move}-${cell}`) as IClickResult;
                if (!result.valid) {
                    result.move = move;
                } else {
                    result.move = `${move}-${cell}`;
                }
                return result;
            }
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

            const myPieces = (this.graph.listCells() as string[]).filter(c => this.board.get(c) === this.currplayer);
            if (myPieces.length !== 2) {
                result.message = i18next.t("apgames:validation.quagmire.PLACE_MEEPLE");
            } else {
                result.message = i18next.t("apgames:validation.quagmire.SELECT_MEEPLE");
            }
            return result;
        }

        const playerPieces = (this.graph.listCells() as string[]).filter(c => this.board.get(c) === this.currplayer);

        if (!m.includes("-")) {
            // Check that the cell is valid
            const cell = m;
            try {
                this.graph.algebraic2coords(cell);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                return result;
            }

            // If setup is finished...
            if (playerPieces.length >= 2) {
                // cell must be occupied with own meeple
                if (!this.board.has(cell) || this.board.get(cell) !== this.currplayer) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.quagmire.SELECT_MEEPLE");
                    return result;
                }

                // tell them to select a destination
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.quagmire.SELECT_DESTINATION");
                return result;
            }

            // If setup is not finished, cell must not be occupied
            if (this.board.has(cell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: cell});
                return result;
            }
        } else {
            // Setup moves don't require hyphens.
            if (playerPieces.length < 2) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.quagmire.MUST_FINISH_SETUP");
                return result;
            }

            const cells: string[] = m.split(new RegExp('[\-]'));
            if (cells.length > 3) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
                return result;
            } else {
                // validate first cell
                let cell = cells[0];
                try {
                    this.graph.algebraic2coords(cell);
                } catch {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                    return result;
                }

                // first cell must be occupied by own meeple
                if (!this.board.has(cell) || this.board.get(cell) !== this.currplayer) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.quagmire.SELECT_MEEPLE");
                    return result;
                }

                // validate second cell
                cell = cells[1];
                try {
                    this.graph.algebraic2coords(cell);
                } catch {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                    return result;
                }

                // second cell must be unoccupied
                if (this.board.has(cell)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: cell});
                    return result;
                }

                if (cells.length === 3) {
                    // validate third cell
                    cell = cells[2];
                    try {
                        this.graph.algebraic2coords(cell);
                    } catch {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                        return result;
                    }

                    // third cell must be unoccupied
                    if (this.board.has(cell)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: cell});
                        return result;
                    }
                }

                // move must be in the list of valid moves (proves adjacency)
                if (!this.moves().includes(m)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.quagmire.LEGAL_MOVES");
                    return result;
                }

                // check for walk
                const emptyNeighbors = this.graph.neighbours(cells[0]).filter(c => !this.board.has(c));
                if (cells.length === 2 && emptyNeighbors.includes(cells[1])) {
                    result.valid = true;
                    result.complete = 0;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.quagmire.MAY_RUN");
                    return result;
                }
            }
        }

        // Valid and complete move
        result.valid = true;
        result.complete = 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {trusted = false} = {}): QuagmireGame {
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
            if (!this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];

        if (!m.includes("-")) {
            this.board.set(m, this.currplayer);
            this.results.push({type: "place", where: m});
        } else {
            const cells: string[] = m.split(new RegExp('[\-]'));
            if (cells.length === 2) {
                this.board.set(cells[0], QuagmireGame.FLOOD);
                this.board.set(cells[1], this.currplayer);
                this.results.push({type: "move", from: cells[0], to: cells[1]});
            } else if (cells.length === 3) {
                this.board.set(cells[0], QuagmireGame.FLOOD);
                this.board.set(cells[1], QuagmireGame.FLOOD);
                this.board.set(cells[2], this.currplayer);
                this.results.push({type: "move", from: cells[0], to: cells[1]});
                this.results.push({type: "move", from: cells[1], to: cells[2]});
            }
        }

        this.lastmove = m;

        // update currplayer
        let newplayer = (this.currplayer as number) + 1;
        if (newplayer > this.numplayers) {
            newplayer = 1;
        }
        this.currplayer = newplayer as pieceType;

        // handle special setup passes to preserve reviewing the game afterwards
        const p1Pieces = (this.graph.listCells() as string[]).filter(c => this.board.get(c) === QuagmireGame.PLAYER_ONE);
        const p2Pieces = (this.graph.listCells() as string[]).filter(c => this.board.get(c) === QuagmireGame.PLAYER_TWO);
        if (p1Pieces.length === 1 && p2Pieces.length === 1) {
            // save the current move
            this.saveState();
            // insert a new one
            this.lastmove = "pass";
            this.results = [{type: "pass"}];
            this.currplayer = QuagmireGame.PLAYER_TWO;
            // this state gets saved outside of this IF statement
        } else if (p1Pieces.length === 2 && p2Pieces.length === 2 && this.stack.length === 5) {
            // save the current move
            this.saveState();
            // insert a new one
            this.lastmove = "pass";
            this.results = [{type: "pass"}];
            this.currplayer = QuagmireGame.PLAYER_ONE;
            // this state gets saved outside of this IF statement
        }

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): QuagmireGame {
        let prevPlayer: pieceType = 1;
        if (this.currplayer === 1) {
            prevPlayer = 2;
        }

        if (this.moves().length === 0) {
            this.gameover = true;
            this.winner = [prevPlayer];
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }

        return this;
    }

    public state(): IQuagmireState {
        return {
            game: QuagmireGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: QuagmireGame.gameinfo.version,
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
        let floodMarkers: [{ row: number; col: number; }, ...{ row: number; col: number; }[]] | undefined;

        const cells = this.graph.listCells(true);
        for (const row of cells) {
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const owner = this.board.get(cell)!;
                    if (owner === QuagmireGame.PLAYER_ONE) {
                        pieces.push("A");
                    } else if (owner === QuagmireGame.PLAYER_TWO) {
                        pieces.push("B");
                    } else if (owner === QuagmireGame.FLOOD) {
                        pieces.push("-");
                        const [x, y] = this.graph.algebraic2coords(cell);
                        if (floodMarkers === undefined) {
                            floodMarkers = [{row: y, col: x}];
                        } else {
                            floodMarkers.push({row: y, col: x});
                        }
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
                minWidth: this.boardsize,
                maxWidth: (this.boardsize * 2) - 1,
                hexFill: "#bbb",
                markers: floodMarkers === undefined ? undefined : [{
                    type: "flood",
                    colour: "#009",
                    opacity: 0.6,
                    points: floodMarkers
                }]
            },
            legend: {
                A: {
                    name: "meeple",
                    player: 1,
                    scale: 0.85
                },
                B: {
                    name: "meeple",
                    player: 2,
                    scale: 0.85
                },
            },
            pieces: pstr.map(p => p.join("")).join("\n"),
            key: []
        };

        // Add annotations
        if (this.results.length > 0) {
            rep.annotations = [];
            // highlight last-placed piece
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.graph.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}], colour: "#000"});
                } else if (move.type === "move") {
                    const [fromX, fromY] = this.graph.algebraic2coords(move.from);
                    const [toX, toY] = this.graph.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                }
            }
            if (rep.annotations.length === 0) {
                delete rep.annotations;
            }
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

    public clone(): QuagmireGame {
        return new QuagmireGame(this.serialize());
    }
}
