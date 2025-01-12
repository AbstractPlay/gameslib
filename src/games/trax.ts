import { GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, AreaKey, MarkerGlyph, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { UndirectedGraph } from "graphology";
import { bidirectional } from "graphology-shortest-path";
import { UnboundedSquareBoard } from "../common/unbounded-square-board";

type playerid = 1 | 2;
const colLabels = "abcdefghijklmnopqrstuvwxyz".split("");
// A: 2+2 player 1 vertical
// B: 1+1 player 1 horizontal
// C: 1/2 player 1 top-left
// D: 2/1 player 1 bottom-right
// E: 1\2 player 1 bottom-left
// F: 2\1 player 1 top-right
// X: Blocked
type TileID = "A" | "B" | "C" | "D" | "E" | "F" | "X";
type PieceID = "+" | "/" | "\\";
const tile2piece: Record<TileID, PieceID> = {
    "A": "+",
    "B": "+",
    "C": "/",
    "D": "/",
    "E": "\\",
    "F": "\\",
    "X": "+",
};
const allDirections: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: UnboundedSquareBoard<TileID>;
    connPaths: string[][];
    lastmove?: string;
}

export interface ITraxState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class TraxGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Trax",
        uid: "trax",
        playercounts: [2],
        version: "20241006",
        dateAdded: "2025-01-11",
        // i18next.t("apgames:descriptions.trax")
        description: "apgames:descriptions.trax",
        urls: [
            "http://www.traxgame.com",
            "https://boardgamegeek.com/boardgame/748/trax",
        ],
        people: [
            {
                type: "designer",
                name: "David L. Smith",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3412/david-l-smith"],
            },
        ],
        variants: [
            { uid: "size-8", group: "variant" },
            { uid: "loop", group: "variant" },
        ],
        categories: ["goal>connect", "mechanic>place", "board>dynamic", "board>shape>rect", "board>connect>rect", "components>special"],
        flags: [],
        displays: [{ uid: "show-origin" }],
    };

    public renCoords2algebraic(x: number, y: number): string {
        // In trax, the rows go from top to bottom.
        // The top-left cell of the expanded board is at (1, 1).
        // This means the top-left rendered cell is at (0, 0).
        // The top-most rendered row rendered is labelled 0.
        // The left-most rendered column rendered is labelled @.
        if (x === 0) {
            return "@" + y.toString();
        }
        return GameBase.coords2algebraic(x - 1, y - 1, 0, true);
    }

    public algebraic2renCoords(cell: string): [number, number] {
        // In trax, the rows go from top to bottom.
        // The top-left cell of the expanded board is at (1, 1).
        // This means the top-left rendered cell is at (0, 0).
        // The top-most rendered row rendered is labelled 0.
        // The left-most rendered column rendered is labelled @.
        if (cell[0] === "@") {
            return [0, parseInt(cell.slice(1), 10)];
        }
        const [x, y] = GameBase.algebraic2coords(cell, 0, true);
        return [x + 1, y + 1];
    }

    public algebraic2absCoords(cell: string, board?: UnboundedSquareBoard<TileID>): [number, number] {
        // Convert from algebraic to renCoords,
        // from which we can easily find the relCoords,
        // then feed to method on board to get absCoords.
        board ??= this.board;
        const [x, y] = this.algebraic2renCoords(cell);
        return board.rel2abs(x - 1, y - 1);
    }

    public absCoords2algebraic(x: number, y: number, board?: UnboundedSquareBoard<TileID>): string {
        // Convert from absCoords to relCoords using method on board
        // then convert to algebraic via renCoords2algebraic method.
        board ??= this.board;
        const [relx, rely] = board.abs2rel(x, y);
        return this.renCoords2algebraic(relx + 1, rely + 1);
    }

    public absCoords2renCoords(x: number, y: number): [number, number] {
        // Convert from absCoords to relCoords, then feed to method.
        const [relx, rely] = this.board.abs2rel(x, y);
        return [relx + 1, rely + 1];
    }

    public relCoords2absCoords(x: number, y: number): [number, number] {
        // Convert from relCoords to absCoords.
        return this.board.rel2abs(x, y);
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: UnboundedSquareBoard<TileID>;
    public connPaths: string[][] = [];
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private boardSize = 0;
    private dots: string[] = [];
    private selected: PieceID | undefined;
    private maxSize: number | undefined;

    constructor(state?: ITraxState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const board: UnboundedSquareBoard<TileID> = new UnboundedSquareBoard();
            const fresh: IMoveState = {
                _version: TraxGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                connPaths: [],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ITraxState;
            }
            if (state.game !== TraxGame.gameinfo.uid) {
                throw new Error(`The Trax game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
            this.stack.forEach((s) => {
                s.board = UnboundedSquareBoard.from(s.board);
            });

        }
        this.load();
        // this.grid = new RectGrid(this.boardSize, this.boardSize);
        // this.lines = this.getLines();
    }

    public load(idx = -1): TraxGame {
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
        this.board = state.board.clone();
        this.connPaths = state.connPaths.map(a => [...a])
        this.lastmove = state.lastmove;
        this.maxSize = this.getMaxSize();
        return this;
    }

    private getMaxSize(): number | undefined {
        // Get max board size from variants.
        // If none specified, then return undefined.
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
        return undefined;
    }

    private getPlaceableCells(): string[] {
        // Get the cells where a piece can be placed.
        if (this.stack.length === 1) { return ["@0"]; }
        const cells: string[] = [];
        const relXRange = this.getRelXRange();
        const relYRange = this.getRelYRange();
        const canExpandX = this.maxSize === undefined || this.board.width < this.maxSize;
        const canExpandY = this.maxSize === undefined || this.board.height < this.maxSize;
        for (let y = relYRange[0]; y <= relYRange[1]; y++) {
            for (let x = relXRange[0]; x <= relXRange[1]; x++) {
                const [absX, absY] = this.relCoords2absCoords(x, y);
                if (!this.canPlaceAt(absX, absY, canExpandX, canExpandY)) { continue; }
                cells.push(this.absCoords2algebraic(absX, absY));
            }
        }
        return cells;
    }

    private canPlaceAt(absX: number, absY: number, canExpandX: boolean, canExpandY: boolean): boolean {
        if (this.board.has(absX, absY)) { return false; }
        if (!canExpandX) {
            if (this.board.expandsX(absX)) { return false; }
        }
        if (!canExpandY) {
            if (this.board.expandsY(absY)) { return false; }
        }
        const neighbours = this.getNeighboursDir(absX, absY);
        if (neighbours.length === 0) { return false; }
        return true;
    }

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }
        if (this.stack.length === 1) {
            return ["@0+", "@0/"];
        }
        const moves: Set<string> = new Set();
        const placeableCells = new Set(this.getPlaceableCells());
        for (const cell of placeableCells) {
            const absCoords = this.algebraic2absCoords(cell);
            const placeablePieces = this.getPlaceablePieces(...absCoords);
            for (const piece of placeablePieces) {
                if (moves.has(cell + piece)) { continue; }
                const tile = this.piece2tile(...absCoords, piece);
                const followupMoves = this.getFollowupMoves(...absCoords, tile);
                if (followupMoves.length > 0 && followupMoves[followupMoves.length - 1][2] === "X") { continue; }
                moves.add(cell + piece);
                // If the move is valid, then all followup moves in placeable cells are valid.
                followupMoves.forEach(([x, y, t]) => {
                    if (placeableCells.has(this.absCoords2algebraic(x, y))) {
                        moves.add(this.absCoords2algebraic(x, y) + tile2piece[t]);
                    }
                });
            }
        }
        return [...moves].sort();
    }

    private hasMoves(): boolean {
        // Check if the player has any moves left.
        // Useful for finite board variants.
        if (this.stack.length === 1) { return true; }
        const placeableCells = new Set(this.getPlaceableCells());
        for (const cell of placeableCells) {
            const absCoords = this.algebraic2absCoords(cell);
            const placeablePieces = this.getPlaceablePieces(...absCoords);
            for (const piece of placeablePieces) {
                const tile = this.piece2tile(...absCoords, piece);
                const followupMoves = this.getFollowupMoves(...absCoords, tile);
                if (followupMoves.length > 0 && followupMoves[followupMoves.length - 1][2] === "X") { continue; }
                return true
            }
        }
        return false;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = "";
            if (piece !== undefined && piece !== "") {
                if (tile2piece[piece as TileID] !== undefined) {
                    piece = tile2piece[piece as TileID];
                }
                if (this.stack.length === 1) {
                    // At the start of the game, the first player just picks a piece.
                    if (piece === "/") {
                        newmove = "@0/";
                    } else if (piece === "+") {
                        newmove = "@0+";
                    } else {
                        newmove = piece;
                    }
                } else {
                    if (newmove === piece) {
                        newmove = "";
                    } else {
                        newmove = piece;
                    }
                }
            } else if (move === "+" || move === "/" || move === "\\") {
                const cell = this.renCoords2algebraic(col, row);
                newmove = cell + move;
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
            if (this.stack.length === 1) {
                result.message = i18next.t("apgames:validation.trax.INITIAL_INSTRUCTIONS_FIRST");
            } else {
                result.message = i18next.t("apgames:validation.trax.INITIAL_INSTRUCTIONS");
            }
            return result;
        }
        if (!/^((\@|[a-z]+)\d+)?[\+\/\\]$/.test(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.trax.INVALID_NOTATION", { move: m });
            return result;
        }
        if (this.stack.length === 1) {
            if (m === "+" || m === "/") {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.trax.FIRST_PIECE_POSITION");
                return result;
            }
            if (m === "\\") {
                result.valid = false;
                result.message = i18next.t("apgames:validation.trax.FIRST_PIECE_POSITION");
                return result;
            }
            const [cell, piece] = this.splitMove(m);
            if (cell !== "@0") {
                result.valid = false;
                result.message = i18next.t("apgames:validation.trax.FIRST_PIECE_POSITION");
                return result;
            }
            if (piece === "\\") {
                result.valid = false;
                result.message = i18next.t("apgames:validation.trax.FIRST_PIECE_POSITION");
                return result;
            }
        } else {
            if (m === "+" || m === "/" || m === "\\") {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.trax.SELECT_CELL");
                return result;
            } else {
                const [where, piece] = this.splitMove(m);
                const absCoords = this.algebraic2absCoords(where);
                if (this.board.has(...absCoords)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.OCCUPIED", { where });
                    return result;
                }
                const neighbours = this.getNeighboursDir(...absCoords);
                if (neighbours.length === 0) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.trax.NO_NEIGHBOURS", { where });
                    return result;
                }
                const placeablePieces = this.getPlaceablePieces(...absCoords);
                if (!placeablePieces.includes(piece)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.trax.CANNOT_PLACE_PIECE", { where, piece });
                    return result;
                }
                const tile = this.piece2tile(...absCoords, piece);
                const followupMoves = this.getFollowupMoves(...absCoords, tile);
                if (followupMoves.length > 0 && followupMoves[followupMoves.length - 1][2] === "X") {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.trax.INVALID_FOLLOWUP", { where, piece });
                    return result;
                }
                if (this.maxSize !== undefined) {
                    if (this.board.width >= this.maxSize && this.board.expandsX(absCoords[0])) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.trax.NO_EXPAND_X", { size: this.maxSize });
                        return result;
                    }
                    if (this.board.height >= this.maxSize && this.board.expandsY(absCoords[1])) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.trax.NO_EXPAND_Y", { size: this.maxSize });
                        return result;
                    }
                }
            }
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private getPlaceablePieces(absX: number, absY: number): PieceID[] {
        // Get the pieces that can be placed at the cell at (absX, absY).
        const neighbours = this.getNeighboursDir(absX, absY);
        if (neighbours.length === 0) { return []; }
        if (neighbours.length === 1) { return ["+", "/", "\\"]; }
        if (neighbours.length > 2) {
            throw new Error("Tile should have already been filled.");
        }
        const [ndX1, ndY1, nT1] = neighbours[0];
        const [ndX2, ndY2, nT2] = neighbours[1];
        const nPlayer1 = this.tilesFacingP1(ndX1, ndY1).includes(nT1) ? 1 : 2;
        const nPlayer2 = this.tilesFacingP1(ndX2, ndY2).includes(nT2) ? 1 : 2;
        if (nPlayer1 === nPlayer2) {
            throw new Error("Tile should have already been filled.");
        }
        if (ndY1 === -1 && ndY2 === 1 || ndY2 === -1 && ndY1 === 1) {
            return ["/", "\\"];
        }
        if (ndX1 === 1 && ndX2 === -1 || ndX2 === 1 && ndX1 === -1) {
            return ["/", "\\"];
        }
        if (ndX1 === -1 && ndY2 === -1 || ndX2 === -1 && ndY1 === -1) {
            return ["+", "\\"];
        }
        if (ndX1 === 1 && ndY2 === 1 || ndX2 === 1 && ndY1 === 1) {
            return ["+", "\\"];
        }
        // if (ndX1 === -1 && ndY2 === 1 || ndX2 === -1 && ndY1 === 1) {
        //     return ["+", "/"];
        // }
        // if (ndX1 === 1 && ndY2 === -1 || ndX2 === 1 && ndY1 === -1) {
        //     return ["+", "/"];
        // }
        return ["+", "/"];
    }

    private splitMove(m: string): [string, PieceID] {
        // Split the move into the cell and the piece type.
        return [m.slice(0, -1), m.slice(-1) as PieceID];
    }

    private getNeighboursDir(absX: number, absY: number, board?: UnboundedSquareBoard<TileID>): [number, number, TileID][] {
        // Get the directions where the cell at (absX, absY) has neighbours.
        board ??= this.board;
        const neighbours: [number, number, TileID][] = [];
        for (const [dx, dy] of allDirections) {
            const x = absX + dx;
            const y = absY + dy;
            const tile = board.get(x, y);
            if (tile !== undefined) {
                neighbours.push([dx, dy, tile]);
            }
        }
        return neighbours;
    }

    private getEmptyNeighboursAbs(absX: number, absY: number, board?: UnboundedSquareBoard<TileID>): [number, number][] {
        // Get the absolute coordinates of the empty neighbours of the cell at (absX, absY).
        board ??= this.board;
        const neighbours: [number, number][] = [];
        for (const [dx, dy] of allDirections) {
            const x = absX + dx;
            const y = absY + dy;
            if (board.get(x, y) === undefined) {
                neighbours.push([x, y]);
            }
        }
        return neighbours;
    }

    private tilesFacingP1(ndX: number, ndY: number): TileID[] {
        // Get the tiles that have have the path of player 1
        // coming in from neighbour at relative position (ndX, ndY).
        // No error checking, but assumes that neighbour is
        // in one of the four cardinal directions.
        if (ndX === 1) {
            return ["B", "C", "E"];
        } else if (ndX === -1) {
            return ["B", "D", "F"];
        } else if (ndY === 1) {
            return ["A", "C", "F"];
        } else {
            return ["A", "D", "E"];
        }
    }

    private piece2tile(absX: number, absY: number, piece: PieceID): TileID {
        // Given the piece and the cell at (absX, absY),
        // determine the tile that should be placed at that cell.
        if (this.stack.length === 1) {
            if (piece === "+") {
                return "A";
            } else {
                return "C";
            }
        }
        const neighbours = this.getNeighboursDir(absX, absY);
        // If this is a valid move, then we can take an arbitrary neighbour.
        const neighbour = neighbours[0];
        const [ndX, ndY, nT] = neighbour;
        const isFacingP1 = this.tilesFacingP1(ndX, ndY).includes(nT);
        if (piece === "+") {
            if (ndX === 0) {
                return isFacingP1 ? "A" : "B";
            } else {
                return isFacingP1 ? "B" : "A";
            }
        } else if (piece === "/") {
            if (ndX === 1 || ndY === 1) {
                return isFacingP1 ? "D" : "C";
            } else {
                return isFacingP1 ? "C" : "D";
            }
        } else {
            if (ndX === 1 || ndY === -1) {
                return isFacingP1 ? "F" : "E";
            } else {
                return isFacingP1 ? "E" : "F";
            }
        }
    }

    private getForcedTile(player: playerid, ndX1: number, ndY1: number, ndX2: number, ndY2: number): TileID {
        // In Trax, if a cell has two neighbours of the same player,
        // then the cell is forced to be filled with a certain tile.
        if (player === 1) {
            if (ndY1 === 1 && ndY2 === -1 || ndY2 === 1 && ndY1 === -1) {
                return "A";
            } else if (ndX1 === 1 && ndX2 === -1 || ndX2 === 1 && ndX1 === -1) {
                return "B";
            } else if (ndX1 === -1 && ndY2 === -1 || ndX2 === -1 && ndY1 === -1) {
                return "C";
            } else if (ndX1 === 1 && ndY2 === 1 || ndX2 === 1 && ndY1 === 1) {
                return "D";
            } else if (ndX1 === -1 && ndY2 === 1 || ndX2 === -1 && ndY1 === 1) {
                return "E";
            } else {
                return "F";
            }
        } else {
            if (ndY1 === 1 && ndY2 === -1 || ndY2 === 1 && ndY1 === -1) {
                return "B";
            } else if (ndX1 === 1 && ndX2 === -1 || ndX2 === 1 && ndX1 === -1) {
                return "A";
            } else if (ndX1 === -1 && ndY2 === -1 || ndX2 === -1 && ndY1 === -1) {
                return "D";
            } else if (ndX1 === 1 && ndY2 === 1 || ndX2 === 1 && ndY1 === 1) {
                return "C";
            } else if (ndX1 === -1 && ndY2 === 1 || ndX2 === -1 && ndY1 === 1) {
                return "F";
            } else {
                return "E";
            }
        }
    }

    private getFollowupMoves(absX: number, absY: number, tile?: TileID): [number, number, TileID][] {
        // Get the followup moves after placing a piece at (absX, absY).
        // If the followup results in an invalid configuration,
        // add a move with an "X" tile, and immediately return the list.
        // The tile can be given if the piece is not already placed on the board.
        const board = this.board.clone();
        if (tile !== undefined) {
            board.set(absX, absY, tile);
        }
        const toCheck = this.getEmptyNeighboursAbs(absX, absY, board);
        const toPlace: [number, number, TileID][] = [];
        while (toCheck.length > 0) {
            const [x, y] = toCheck.pop()!;
            if (board.has(x, y)) { continue; }
            const neighbours = this.getNeighboursDir(x, y, board);
            if (neighbours.length < 2) { continue; }
            if (neighbours.length === 2) {
                const [ndX1, ndY1, nT1] = neighbours[0];
                const [ndX2, ndY2, nT2] = neighbours[1];
                const nPlayer1: playerid = this.tilesFacingP1(ndX1, ndY1).includes(nT1) ? 1 : 2;
                const nPlayer2: playerid = this.tilesFacingP1(ndX2, ndY2).includes(nT2) ? 1 : 2;
                if (nPlayer1 !== nPlayer2) { continue; }
                const forcedTile = this.getForcedTile(nPlayer1, ndX1, ndY1, ndX2, ndY2);
                toPlace.push([x, y, forcedTile]);
                board.set(x, y, forcedTile);
                toCheck.push(...this.getEmptyNeighboursAbs(x, y, board));
            } else {
                // At least 3 neighbours.
                const player1neighbours: [number, number][] = [];
                const player2neighbours: [number, number][] = [];
                for (const [ndX, ndY, nT] of neighbours) {
                    if (this.tilesFacingP1(ndX, ndY).includes(nT)) {
                        player1neighbours.push([ndX, ndY]);
                    } else {
                        player2neighbours.push([ndX, ndY]);
                    }
                }
                // Check that there are at most 2 neighbours of the same player.
                if (player1neighbours.length > 2 || player2neighbours.length > 2) {
                    toPlace.push([x, y, "X"]);
                    break;
                }
                const player: playerid = player1neighbours.length === 2 ? 1 : 2;
                const forcedTile =
                    player === 1
                        ? this.getForcedTile(1, ...player1neighbours[0], ...player1neighbours[1])
                        : this.getForcedTile(2, ...player2neighbours[0], ...player2neighbours[1]);
                toPlace.push([x, y, forcedTile]);
                board.set(x, y, forcedTile);
                toCheck.push(...this.getEmptyNeighboursAbs(x, y, board));
            }
        }
        return toPlace;
    }

    public move(m: string, { partial = false, trusted = false } = {}): TraxGame {
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
        if (m === "+" || m === "/" || m === "\\") {
            this.selected = m;
            return this;
        } else {
            const [cell, piece] = this.splitMove(m);
            const [absX, absY] = cell === "@0" ? [0, 0] : this.algebraic2absCoords(cell);
            const tile = this.piece2tile(absX, absY, piece);
            this.results.push({ type: "place", where: this.board.abs2notation(absX, absY), how: cell, what: piece });
            // Get previous board so that we can get the algebraic notation of followup moves.
            const oldBoard = this.board.clone();
            this.board.set(absX, absY, tile);
            // Check for followup moves.
            const toPlace = this.getFollowupMoves(absX, absY);
            for (const [x, y, t] of toPlace) {
                this.board.set(x, y, t);
                const algebraic = this.absCoords2algebraic(x, y, oldBoard);
                this.results.push({ type: "place", where: this.board.abs2notation(x, y), how: algebraic, what: tile2piece[t] });
            }
        }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    private getNeighbours(cell: string, player: playerid): string[] {
        const [x, y] = this.board.notation2abs(cell);
        const neighboursDirs = this.getNeighboursDir(x, y);
        const neighbours: string[] = [];
        for (const [dx, dy, tile] of neighboursDirs) {
            if (this.tilesFacingP1(dx, dy).includes(tile)) {
                if (player === 1) {
                    neighbours.push(this.board.abs2notation(x + dx, y + dy));
                }
            } else {
                if (player === 2) {
                    neighbours.push(this.board.abs2notation(x + dx, y + dy));
                }
            }
        }
        return neighbours;
    }

    private buildGraph(player: playerid, allPositionsNotation: string[]): UndirectedGraph {
        const graph = new UndirectedGraph();
        // seed nodes
        allPositionsNotation.forEach(c => { graph.addNode(c); });
        // for each node, check neighbours
        // if any are in the graph, add an edge
        for (const node of graph.nodes()) {
            const neighbours = this.getNeighbours(node, player);
            for (const n of neighbours) {
                if (graph.hasNode(n) && !graph.hasEdge(node, n)) {
                    graph.addEdge(node, n);
                }
            }
        }
        return graph;
    }

    private getLoops(player: playerid, allPositionsNotation: string[]): string[][] {
        // Get all loops for a player.
        const loops: string[][] = [];
        const seen: Set<string> = new Set();
        for (const cell of allPositionsNotation) {
            if (seen.has(cell)) { continue; }
            const loop: string[] = [];
            let last: string | undefined;
            let curr = cell;
            let isLoop = false;
            while (true) {
                if (curr === cell && last !== undefined) {
                    isLoop = true;
                    break;
                }
                if (seen.has(curr)) { break; }
                loop.push(curr);
                seen.add(curr);
                const neighbours = this.getNeighbours(curr, player);
                if (neighbours.length !== 2) { break; }
                for (const n of neighbours) {
                    if (n === last) { continue; }
                    last = curr;
                    curr = n;
                    break;
                }
            }
            if (isLoop) {
                loop.push(cell);
                loops.push(loop);
            }
        }
        return loops;
    }

    protected checkEOG(): TraxGame {
        const winner = [];
        const connPaths = [];
        const allPositions = this.board.getAllPositions();
        const allPositionsNotation = allPositions.map(([x, y]) => this.board.abs2notation(x, y));
        if (!this.variants.includes("loop")) {
            if (this.board.width >= 8) {
                const xRange = this.board.xRange;
                const edgeW  = allPositions.filter(([x,]) => x === xRange[0]).map(([x, y]) => this.board.abs2notation(x, y));
                const edgeE = allPositions.filter(([x,]) => x === xRange[1]).map(([x, y]) => this.board.abs2notation(x, y));
                for (const player of [1, 2] as playerid[]) {
                    const graph = this.buildGraph(player, allPositionsNotation);
                    for (const source of edgeW) {
                        const tileW = this.board.get(...this.board.notation2abs(source))!;
                        if (player === 1 && !["B", "C", "E"].includes(tileW)) { continue; }
                        if (player === 2 && !["A", "D", "F"].includes(tileW)) { continue; }
                        for (const target of edgeE) {
                            const tileE = this.board.get(...this.board.notation2abs(target))!;
                            if (player === 1 && !["B", "D", "F"].includes(tileE)) { continue; }
                            if (player === 2 && !["A", "C", "E"].includes(tileE)) { continue; }
                            if (graph.hasNode(source) && graph.hasNode(target)) {
                                const path = bidirectional(graph, source, target);
                                if (path !== null) {
                                    this.gameover = true;
                                    winner.push(player);
                                    connPaths.push(path);
                                    break;
                                }
                            }
                        }
                        if (this.gameover) {
                            break;
                        }
                    }
                }
            }
            if (this.board.height >= 8) {
                const yRange = this.board.yRange;
                const edgeN = allPositions.filter(([, y]) => y === yRange[0]).map(([x, y]) => this.board.abs2notation(x, y));
                const edgeS = allPositions.filter(([, y]) => y === yRange[1]).map(([x, y]) => this.board.abs2notation(x, y));
                for (const player of [1, 2] as playerid[]) {
                    const graph = this.buildGraph(player, allPositionsNotation);
                    for (const source of edgeN) {
                        const tileN = this.board.get(...this.board.notation2abs(source))!;
                        if (player === 1 && !["A", "C", "F"].includes(tileN)) { continue; }
                        if (player === 2 && !["B", "D", "E"].includes(tileN)) { continue; }
                        for (const target of edgeS) {
                            const tileS = this.board.get(...this.board.notation2abs(target))!;
                            if (player === 1 && !["A", "D", "E"].includes(tileS)) { continue; }
                            if (player === 2 && !["B", "C", "F"].includes(tileS)) { continue; }
                            if (graph.hasNode(source) && graph.hasNode(target)) {
                                const path = bidirectional(graph, source, target);
                                if (path !== null) {
                                    this.gameover = true;
                                    winner.push(player);
                                    connPaths.push(path);
                                    break;
                                }
                            }
                        }
                        if (this.gameover) {
                            break;
                        }
                    }
                }
            }
        }
        for (const player of [1, 2] as playerid[]) {
            const loops = this.getLoops(player, allPositionsNotation);
            if (loops.length > 0) {
                this.gameover = true;
                winner.push(player);
                connPaths.push(...loops);
            }
        }
        if (this.gameover) {
            this.connPaths = connPaths;
            this.results.push({ type: "eog" });
        }
        if (!this.gameover && this.maxSize !== undefined && !this.hasMoves()) {
            this.gameover = true;
            winner.push(this.currplayer);
            this.results.push({ type: "eog", reason: "stalemate" });
        }
        if (this.gameover) {
            this.winner = Array.from(new Set(winner)).sort() as playerid[];
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public state(): ITraxState {
        return {
            game: TraxGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: TraxGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: this.board.clone(),
            connPaths: this.connPaths.map(a => [...a])
        };
    }

    private getRelXRange(): [number, number] {
        // Get the x range of the relative coordinates.
        if (this.board.size === 0) { return [0, 0]; }
        return [-1, this.board.width + 1];
    }

    private getRelYRange(): [number, number] {
        // Get the y range of the relative coordinates.
        if (this.board.size === 0) { return [0, 0]; }
        return [-1, this.board.height + 1];
    }

    private getRenderWidthHeight(): [number, number] {
        // Get the width and height of the board for rendering.
        if (this.board.size === 0) { return [1, 1]; }
        const relXRange = this.getRelXRange();
        const relYRange = this.getRelYRange();
        return [relXRange[1] - relXRange[0], relYRange[1] - relYRange[0]];
    }

    public render(opts?: IRenderOpts): APRenderRep {
        let altDisplay: string | undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }
        let showOrigin = false;
        if (altDisplay !== undefined) {
            if (altDisplay === "show-origin") {
                showOrigin = true;
            }
        }
        // Build piece string
        const pieces: string[] = [];
        let blocked: RowCol[] | undefined = [];
        const canExpandX = this.maxSize === undefined || this.board.width < this.maxSize;
        const canExpandY = this.maxSize === undefined || this.board.height < this.maxSize;
        if (this.board.size > 0) {
            const relXRange = this.getRelXRange();
            const relYRange = this.getRelYRange();
            for (let y = relYRange[0]; y <= relYRange[1]; y++) {
                let pstr = "";
                for (let x = relXRange[0]; x <= relXRange[1]; x++) {
                    const [absX, absY] = this.relCoords2absCoords(x, y);
                    const tile = this.board.get(absX, absY);
                    if (tile === undefined) {
                        pstr += "-";
                        if (!this.canPlaceAt(absX, absY, canExpandX, canExpandY)) {
                            blocked.push({ row: y + 1, col: x + 1 });
                        }
                    } else {
                        pstr += tile;
                    }
                }
                pieces.push(pstr);
            }
            pieces.push("_")
        } else {
            pieces.push("_");
        }
        if (blocked.length === 0) { blocked = undefined; }
        let markers: MarkerGlyph[] | undefined = [];
        if (showOrigin) {
            if (this.stack.length === 1) {
                markers.push({ type: "glyph", glyph: "O", points: [{ row: 0, col: 0 }] });
            } else {
                const [col, row] = this.absCoords2renCoords(0, 0);
                markers.push({ type: "glyph", glyph: "O", points: [{ row, col }] });
            }
        }
        if (markers.length === 0) { markers = undefined; }


        const [width, height] = this.getRenderWidthHeight();
        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares",
                width,
                height,
                // This needs to account for aa, ab, ac, ...
                columnLabels: ["@", ...colLabels.slice(0, width) ],
                rowLabels: Array.from({ length: height }, (a, i) => (height - 1 - i).toString()),
                blocked: blocked as [RowCol, ...RowCol[]] | undefined,
                markers,
                strokeColour: {
                    func: "flatten",
                    fg: "_context_strokes",
                    bg: "_context_background",
                    opacity: 0.15,
                },
            },
            legend: {
                A: [{ name: "piece-square-borderless", opacity: 0 }, { name: "trax-plus", colour: 1, colour2: 2, scale: 1.15 }],
                B: [{ name: "piece-square-borderless", opacity: 0 }, { name: "trax-plus", colour: 1, colour2: 2, rotate: 90, scale: 1.15 }],
                C: [{ name: "piece-square-borderless", opacity: 0 }, { name: "trax-corners", colour: 1, colour2: 2, scale: 1.15 }],
                D: [{ name: "piece-square-borderless", opacity: 0 }, { name: "trax-corners", colour: 2, colour2: 1, scale: 1.15 }],
                E: [{ name: "piece-square-borderless", opacity: 0 }, { name: "trax-corners", colour: 2, colour2: 1, rotate: 90, scale: 1.15 }],
                F: [{ name: "piece-square-borderless", opacity: 0 }, { name: "trax-corners", colour: 1, colour2: 2, rotate: 90, scale: 1.15 }],
                // For display on selection panel.
                A1: [{ name: "piece-square-borderless", opacity: 0 }, { name: "trax-plus", colour: "#444", colour2: "#444" }],
                C1: [{ name: "piece-square-borderless", opacity: 0 }, { name: "trax-corners", colour: "#444", colour2: "#444" }],
                E1: [{ name: "piece-square-borderless", opacity: 0 }, { name: "trax-corners", colour: "#444", colour2: "#444", rotate: 90 }],
                // Selected
                A2: [{ name: "piece-square-borderless", colour: "#FFFF00" }, { name: "trax-plus", colour: "#444", colour2: "#444" }],
                C2: [{ name: "piece-square-borderless", colour: "#FFFF00" }, { name: "trax-corners", colour: "#444", colour2: "#444" }],
                E2: [{ name: "piece-square-borderless", colour: "#FFFF00" }, { name: "trax-corners", colour: "#444", colour2: "#444", rotate: 90 }],
                // Origin
                O: [{ name: "x", opacity: 0.8, scale: 0.9, colour: "_context_strokes" }],
            },
            pieces: pieces.join("\n"),
        };

        const key: AreaKey = {
            type: "key",
            height: 0.7,
            list: [
                { piece: this.selected === "+" ? "A2" : "A1", name: "", value: "+"},
                { piece: this.selected === "/" ? "C2": "C1", name: "", value: "/"},
                ...(this.stack.length === 1 ? [] : [{ piece: this.selected === "\\" ? "E2": "E1", name: "", value: "\\"}])],
            clickable: true,
        };
        rep.areas = [key];

        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const [absX, absY] = this.board.notation2abs(move.where!);
                    const [col, row] = this.absCoords2renCoords(absX, absY);
                    rep.annotations.push({ type: "enter", targets: [{ row, col }] });
                }
            }
            if (this.connPaths.length > 0) {
                const targets: RowCol[] = [];
                for (const connPath of this.connPaths) {
                    for (const cell of connPath) {
                        const [absX, absY] = this.board.notation2abs(cell);
                        const [col, row] = this.absCoords2renCoords(absX, absY);
                        targets.push({ row, col })
                    }
                    rep.annotations.push({ type: "move", targets: targets as [RowCol, ...RowCol[]], arrow: false });
                }
            }
        }
        if (this.dots.length > 0) {
            const points = [];
            for (const cell of this.dots) {
                const [absX, absY] = this.board.notation2abs(cell);
                const [col, row] = this.absCoords2renCoords(absX, absY);
                points.push({ row, col })
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
                node.push(i18next.t("apresults:PLACE.trax", { player, where: r.where, piece: r.what, algebraic: r.how }));
                resolved = true;
                break;
            case "eog":
                if (r.reason === "stalemate") {
                    node.push(i18next.t("apresults:EOG.stalemate", { count: 1 }));
                } else {
                    node.push(i18next.t("apresults:EOG.default"));
                }
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): TraxGame {
        return new TraxGame(this.serialize());
    }
}
