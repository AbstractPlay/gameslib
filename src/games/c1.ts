import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";

type playerid = 1 | 2;
type PieceType = "C" | "P"; // Cone, Pyramid
type TileType = "F" | "S"; // Fixed, Slidable
type MoveType = "C" | "P" | "T"; // Cone, Pyramid, Tile
type Direction = [number, number];
type CellPredicate = (x: number, y: number) => boolean;

const moveType2name: Record<MoveType, string> = {
    C: "cone",
    P: "pyramid",
    T: "tile",
};

const orthogonalDirs: Direction[] = [[0,1], [1,0], [0,-1], [-1,0]];
const diagonalDirs: Direction[] = [[1,1], [1,-1], [-1,-1], [-1,1]];
const allDirs: Direction[] = [...orthogonalDirs, ...diagonalDirs];

interface IPiece {
    type: PieceType;
    owner: playerid;
}

interface ITile {
    type: TileType;
    owner: playerid;
}

interface ICellContents {
    tile?: ITile;
    piece?: IPiece;
}

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, ICellContents>;
    lastmove?: string;
}

export interface IC1State extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class C1Game extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "C1",
        uid: "c1",
        playercounts: [2],
        version: "20250401",
        dateAdded: "2024-04-01",
        // i18next.t("apgames:descriptions.c1")
        description: "apgames:descriptions.c1",
        urls: [
            "https://boardgamegeek.com/boardgame/386986/c1",
            "http://lumicube.uk/",
        ],
        people: [
            {
                type: "designer",
                name: "Michael Seal",
                urls: ["https://boardgamegeek.com/boardgamedesigner/396/michael-seal"],
            },
            {
                type: "coder",
                name: "ypaul",
                urls: [],
                apid: "46f6da78-be02-4469-94cb-52f17078e9c1",
            },
        ],
        variants: [
            { uid: "two-move", experimental: true },
        ],
        categories: ["goal>align", "mechanic>move", "mechanic>differentiate", "board>shape>rect", "board>connect>rect", "components>special"],
        flags: ["perspective", "check"],
    };

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardSize);
    }

    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardSize);
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, ICellContents>;
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private boardSize = 0;
    private dots: string[] = [];


    private initBoard(): Map<string, ICellContents> {
        const board = new Map<string, ICellContents>();
        const size = this.boardSize;
        const tileRows = Math.min(3, Math.floor(size / 2));

        // Add tiles for both players
        for (let row = 0; row < tileRows; row++) {
            for (let col = 0; col < size; col++) {
                // Player 1 tiles (bottom)
                const cell1 = this.coords2algebraic(col, size - 1 - row);
                const isEdge1 = row === 0 || col === 0 || col === size - 1;
                board.set(cell1, { tile: { owner: 1, type: isEdge1 ? "F" : "S" } });

                // Player 2 tiles (top)
                const cell2 = this.coords2algebraic(col, row);
                const isEdge2 = row === 0 || col === 0 || col === size - 1;
                board.set(cell2, { tile: { owner: 2, type: isEdge2 ? "F" : "S" } });
            }
        }

        const center = Math.floor(size / 2);
        // Player 1 back rank (bottom row)
        for (let col = 0; col < size; col++) {
            const cell = this.coords2algebraic(col, size - 1);
            if (col === center) {
                const contents = board.get(cell) || {};
                contents.piece = { type: "C", owner: 1 };
                board.set(cell, contents);
            } else if (col > 0 && col < size - 1) {
                const contents = board.get(cell) || {};
                contents.piece = { type: "P", owner: 1 };
                board.set(cell, contents);
            }
        }
        // Player 2 back rank (top row)
        for (let col = 0; col < size; col++) {
            const cell = this.coords2algebraic(col, 0);
            if (col === center) {
                const contents = board.get(cell) || {};
                contents.piece = { type: "C", owner: 2 };
                board.set(cell, contents);
            } else if (col > 0 && col < size - 1) {
                const contents = board.get(cell) || {};
                contents.piece = { type: "P", owner: 2 };
                board.set(cell, contents);
            }
        }
        return board;
    }

    constructor(state?: IC1State | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            this.boardSize = this.getBoardSize();
            const fresh: IMoveState = {
                _version: C1Game.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: this.initBoard(),
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IC1State;
            }
            if (state.game !== C1Game.gameinfo.uid) {
                throw new Error(`The C1 game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
            this.boardSize = this.getBoardSize();
        }
        this.load();
    }

    public load(idx = -1): C1Game {
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
        this.board = new Map(
            [...state.board.entries()].map(([cell, contents]) => [cell, {
                 tile: contents.tile ? { ...contents.tile } : undefined,
                 piece: contents.piece ? { ...contents.piece } : undefined
            }])
        );
        this.lastmove = state.lastmove;
        return this;
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
        return 7;
    }

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }

        const moves: string[] = [];

        if (this.variants.includes("two-move")) {
            // Get all possible tile moves first
            const tileMoves: string[] = [];
            for (let row = 0; row < this.boardSize; row++) {
                for (let col = 0; col < this.boardSize; col++) {
                    const cell = this.coords2algebraic(col, row);
                    const contents = this.board.get(cell);
                    if (contents?.piece) { continue; }
                    if (!contents?.tile || contents.tile.owner !== player || contents.tile.type !== "S") { continue; }
                    const destinations = this.getTos(cell, "T");
                    for (const dest of destinations) {
                        tileMoves.push(`T${cell}-${dest}`);
                    }
                }
            }

            // If there are no tile moves, we must move a piece
            if (tileMoves.length === 0) {
                for (let row = 0; row < this.boardSize; row++) {
                    for (let col = 0; col < this.boardSize; col++) {
                        const cell = this.coords2algebraic(col, row);
                        const contents = this.board.get(cell);
                        if (!contents?.piece || contents.piece.owner !== player) { continue; }
                        const moveType = contents.piece.type === "C" ? "C" : "P";
                        const destinations = this.getTos(cell, moveType);
                        for (const dest of destinations) {
                            const separator = this.eliminatesTile(cell, dest) ? "x" : "-";
                            moves.push(`${moveType}${cell}${separator}${dest}`);
                        }
                    }
                }
                return moves;
            }

            // Otherwise, for each tile move, simulate it and get all possible piece moves
            for (const tileMove of tileMoves) {
                // Clone the board
                const tempBoard = new Map(
                    [...this.board.entries()].map(([cell, contents]) => [cell, {
                        tile: contents.tile ? { ...contents.tile } : undefined,
                        piece: contents.piece ? { ...contents.piece } : undefined
                    }])
                );

                // Apply the tile move
                const [from, to] = tileMove.slice(1).split("-");
                this.applyMoveToBoard(tempBoard, from, to, "T");

                // Now get all piece moves in this new position
                for (let row = 0; row < this.boardSize; row++) {
                    for (let col = 0; col < this.boardSize; col++) {
                        const cell = this.coords2algebraic(col, row);
                        const contents = tempBoard.get(cell);
                        if (!contents?.piece || contents.piece.owner !== player) { continue; }

                        const moveType = contents.piece.type === "C" ? "C" : "P";
                        const destinations = this.getTos(cell, moveType, tempBoard);
                        for (const dest of destinations) {
                            // Use the existing board for eliminatesTile check since we're constructing the move string
                            const separator = this.eliminatesTile(cell, dest, tempBoard) ? "x" : "-";
                            moves.push(`${tileMove} ${moveType}${cell}${separator}${dest}`);
                        }
                    }
                }
            }
        } else {
            // Original move generation for non-variant game
            for (let row = 0; row < this.boardSize; row++) {
                for (let col = 0; col < this.boardSize; col++) {
                    const cell = this.coords2algebraic(col, row);
                    const contents = this.board.get(cell);
                    if (!contents) { continue; }
                    if (contents.piece !== undefined) {
                        if (contents.piece.owner !== player) { continue; }
                        const moveType = contents.piece.type === "C" ? "C" : "P";
                        const destinations = this.getTos(cell, moveType);
                        for (const dest of destinations) {
                            const separator = this.eliminatesTile(cell, dest) ? "x" : "-";
                            moves.push(`${moveType}${cell}${separator}${dest}`);
                        }
                    } else if (contents.tile?.owner === player && contents.tile.type === "S") {
                        const destinations = this.getTos(cell, "T");
                        for (const dest of destinations) {
                            moves.push(`T${cell}-${dest}`);
                        }
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

    private eliminatesTile(from: string, to: string, board?: Map<string, ICellContents>): boolean {
        // Check if the move from `from` to `to` eliminates a tile.
        board ??= this.board;
        const fromContents = board.get(from);
        const toContents = board.get(to);
        if (!fromContents?.tile || !toContents?.tile) { return false; }
        if (fromContents.piece === undefined) { return false; }
        return fromContents.tile.owner !== fromContents.piece.owner &&
                fromContents.tile.owner !==  toContents.tile.owner;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            let newmove = "";

            // First check if we're deselecting
            let done = false;
            if (move !== "") {
                const moves = move.split(" ");
                const lastMove = moves[moves.length - 1];
                if (lastMove.slice(1) === cell) {
                    moves.pop();
                    newmove = moves.join(" ");
                    done = true;
                } else if (moves.length === 1 && lastMove.includes("-") || lastMove.includes("x")) {
                    const [from, to] = lastMove.slice(1).split(/[x-]/);
                    if (from === cell || to === cell) {
                        moves.pop();
                        newmove = moves.join(" ");
                        done = true;
                    }
                }
            }
            if (!done) {
                // Then try to build the move
                const parts = move.split(" ");
                const lastMove = parts[parts.length - 1];
                if (move === "" || lastMove.includes("-") || lastMove.includes("x")) {
                    const moveType = this.getMoveType(cell);
                    if (moveType === undefined) {
                        // Let the validation handle this
                        newmove = move + (move === "" ? "" : " ") + cell;
                    } else {
                        newmove = move + (move === "" ? "" : " ") + moveType + cell;
                    }
                } else {
                    const prevMoves = parts.slice(0, -1);
                    const tempBoard = new Map(
                        [...this.board.entries()].map(([c, contents]) => [c, {
                            tile: contents.tile ? { ...contents.tile } : undefined,
                            piece: contents.piece ? { ...contents.piece } : undefined
                        }])
                    );
                    for (const m of prevMoves) {
                        const [f, t] = m.slice(1).split(/[x-]/);
                        const moveType = this.getMoveType(f, tempBoard)!;
                        this.applyMoveToBoard(tempBoard, f, t, moveType);
                    }
                    const from = lastMove.slice(1);
                    const separator = this.eliminatesTile(from, cell, tempBoard) ? "x" : "-";
                    parts[parts.length - 1] = lastMove + separator + cell;
                    newmove = parts.join(" ");
                }
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

    private hasTileMoves(board: Map<string, ICellContents>): boolean {
        // Check if there are any tile moves available for the current player.
        for (let row = 0; row < this.boardSize; row++) {
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                const contents = board.get(cell);
                if (contents?.piece) { continue; }
                if (!contents?.tile || contents.tile.owner !== this.currplayer || contents.tile.type !== "S") { continue; }
                const destinations = this.getTos(cell, "T", board);
                if (destinations.length > 0) {
                    return true;
                }
            }
        }
        return false;
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = { valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER") };
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            if (this.variants.includes("two-move")) {
                if (this.hasTileMoves(this.board)) {
                    result.message = i18next.t("apgames:validation.c1.INITIAL_INSTRUCTIONS_TWO_MOVE");
                } else {
                    result.message = i18next.t("apgames:validation.c1.INITIAL_INSTRUCTIONS_TWO_MOVE_NO_TILE");
                }
            } else {
                result.message = i18next.t("apgames:validation.c1.INITIAL_INSTRUCTIONS");
            }
            return result;
        }
        m = this.normaliseMove(m);

        // Track board state for sequential moves
        const tempBoard = new Map(
            [...this.board.entries()].map(([cell, contents]) => [cell, {
                tile: contents.tile ? { ...contents.tile } : undefined,
                piece: contents.piece ? { ...contents.piece } : undefined
            }])
        );

        // Split into moves
        const moves = m.split(" ");
        if (this.variants.includes("two-move") && moves.length > 2) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", { move: m });
            return result;
        }
        if (!this.variants.includes("two-move") && moves.length > 1) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", { move: m });
            return result;
        }
        const hasTileMoves = this.variants.includes("two-move") && this.hasTileMoves(tempBoard);

        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const prefix = ["C", "P", "T"].includes(move[0]) ? move[0] : undefined;
            const [from, to] = (() => {
                const s = prefix ? move.slice(1) : move;
                const idx = s.search(/[x-]/);
                return idx === -1 ? [s, ""] : [s.slice(0, idx), s.slice(idx + 1)];
            })();

            // Valid cell check
            let currentMove;
            try {
                for (const p of [from, to]) {
                    if (p === undefined || p.length === 0) { continue; }
                    currentMove = p;
                    const [x, y] = this.algebraic2coords(p);
                    if (x < 0 || x >= this.boardSize || y < 0 || y >= this.boardSize) {
                        throw new Error("Invalid cell");
                    }
                }
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: currentMove });
                return result;
            }

            // Get cell contents
            const contentsFrom = tempBoard.get(from);
            if (contentsFrom === undefined) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NONEXISTENT", { where: from });
                return result;
            }

            if (this.variants.includes("two-move")) {
                if (i === 0) {
                    // Check if the first move is a tile move
                    if (hasTileMoves && prefix !== "T") {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.c1.FIRST_MOVE_TILE", {move: m});
                        return result;
                    }
                } else if (i === 1) {
                    // Check if the second move is a piece move
                    if (prefix !== "C" && prefix !== "P") {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.c1.SECOND_MOVE_PIECE", {move: m});
                        return result;
                    }
                }
            }

            // Validate piece or tile move
            const pieceFrom = contentsFrom.piece;
            if (pieceFrom !== undefined) {
                if (pieceFrom.owner !== this.currplayer) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.UNCONTROLLED", { where: from });
                    return result;
                }
                if (prefix === undefined) {
                    const rightPrefix = pieceFrom.type;
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.c1.MISSING_PREFIX", { prefix: rightPrefix, move: rightPrefix + move });
                    return result;
                }
                if (prefix === "C" && pieceFrom.type !== "C" || prefix === "P" && pieceFrom.type !== "P") {
                    const rightPrefix = pieceFrom.type;
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.c1.WRONG_PREFIX", { prefix: rightPrefix, move: rightPrefix + move });
                    return result;
                }
            } else {
                const tileFrom = contentsFrom.tile;
                if (tileFrom === undefined) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.NONEXISTENT", { where: from });
                    return result;
                }
                if (tileFrom.type !== "S") {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.c1.NOT_SLIDABLE", { where: from });
                    return result;
                }
                if (tileFrom.owner !== this.currplayer) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.UNCONTROLLED", { where: from });
                    return result;
                }
                if (prefix === undefined) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.c1.MISSING_PREFIX", { prefix: "T", move: "T" + move });
                    return result;
                }
                if (prefix !== "T") {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.c1.WRONG_PREFIX", { prefix: "T", move: "T" + move });
                    return result;
                }
            }

            // Validate destinations
            const tos = this.getTos(from, prefix as MoveType, tempBoard);
            if (tos.length === 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NO_MOVES", { where: from });
                return result;
            }
            if (to === "") {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation._general.NEED_DESTINATION");
                return result;
            }
            if (to === from) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.SAME_FROM_TO", { where: from });
                return result;
            }
            if (!tos.includes(to)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.c1.INVALID_TO", { what: moveType2name[prefix as MoveType], from, to });
                return result;
            }

            // Check separator
            const separator = move.includes("x") ? "x" : "-";
            if (separator === "x" && !this.eliminatesTile(from, to, tempBoard)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.c1.USE_MOVE_NOTATION", { move: move.replace("x", "-") });
                return result;
            }
            if (separator === "-" && this.eliminatesTile(from, to, tempBoard)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.c1.USE_ELIMINATE_NOTATION", { move: move.replace("-", "x") });
                return result;
            }

            // Apply the move to tempBoard for next validation
            this.applyMoveToBoard(tempBoard, from, to, prefix as MoveType);
        }

        // Partial move for variant
        if (this.variants.includes("two-move") && hasTileMoves && moves.length === 1) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.c1.NEED_SECOND_MOVE");
            return result;
        }

        // All good
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private getMoveType(at: string, board: Map<string, ICellContents> = this.board): MoveType | undefined {
        // Get move type at `at`.
        // If there is a piece, return the type of the piece.
        const contents = board.get(at);
        if (contents?.piece) {
            return contents.piece.type;
        }
        // If there is a slidable tile, return "T".
        if (contents?.tile && contents.tile.type === "S") {
            return "T";
        }
        return undefined;
    }

    private getTos(from: string, moveType: MoveType, board: Map<string, ICellContents> = this.board): string[] {
        // Get all possible destinations for a move from `from`.
        const [fromX, fromY] = this.algebraic2coords(from);
        if (moveType === "C") {
            return this.getConeMoves(fromX, fromY, board);
        } else if (moveType === "T") {
            return this.getTileMoves(fromX, fromY, board);
        } else {
            const visited = new Set<string>([from]);
            const tos: string[] = [];
            this.findPyramidJumps(fromX, fromY, visited, tos, true, board);
            return tos;
        }
    }

    private findPyramidJumps(x: number, y: number, visited: Set<string>, tos: string[], isFirstMove: boolean, board: Map<string, ICellContents>): void {
        // Find all possible jumps for a pyramid piece from (x, y).
        for (const [dx, dy] of orthogonalDirs) {
            const newX = x + dx;
            const newY = y + dy;
            if (!this.inBounds(newX, newY)) { continue; }
            const cell = this.coords2algebraic(newX, newY);
            if (visited.has(cell)) { continue; }

            if (isFirstMove && this.canLandOn(newX, newY, board)) {
                tos.push(cell);
                continue;
            }

            if (!this.isObstacle(newX, newY, board)) { continue; }

            const jumpX = newX + dx;
            const jumpY = newY + dy;
            if (!this.inBounds(jumpX, jumpY)) { continue; }
            const jumpCell = this.coords2algebraic(jumpX, jumpY);
            if (!visited.has(jumpCell) && this.canLandOn(jumpX, jumpY, board)) {
                tos.push(jumpCell);
                visited.add(jumpCell);
                this.findPyramidJumps(jumpX, jumpY, visited, tos, false, board);
            }
        }
    }

    private findPyramidPath(from: string, to: string): string[] | undefined {
        // Find shortest path for a pyramid piece from `from` to `to`.
        // We assume that `from` is a pyramid and `to` is a valid destination.
        const [fromX, fromY] = this.algebraic2coords(from);
        const [toX, toY] = this.algebraic2coords(to);

        // If it's a single step, return undefined
        const dx = Math.abs(toX - fromX);
        const dy = Math.abs(toY - fromY);
        if (dx === 1 && dy === 0 || dx === 0 && dy === 1) {
            return undefined;
        }

        // Keep track of visited cells and their paths
        const visited = new Set<string>();
        const queue: Array<[number, number, string[]]> = [[fromX, fromY, [from]]];
        visited.add(from);

        while (queue.length > 0) {
            const [x, y, path] = queue.shift()!;
            if (x === toX && y === toY) {
                return path;
            }

            for (const [dirX, dirY] of orthogonalDirs) {
                const newX = x + dirX;
                const newY = y + dirY;
                if (!this.inBounds(newX, newY)) { continue; }
                const cell = this.coords2algebraic(newX, newY);
                if (visited.has(cell)) { continue; }

                const isObstacle = !this.board.get(cell)?.tile || this.board.get(cell)?.piece;
                if (!isObstacle) { continue; }

                const jumpX = newX + dirX;
                const jumpY = newY + dirY;
                if (!this.inBounds(jumpX, jumpY)) { continue; }
                const jumpCell = this.coords2algebraic(jumpX, jumpY);
                if (!visited.has(jumpCell) &&
                    this.board.get(jumpCell)?.tile &&
                    !this.board.get(jumpCell)?.piece) {
                    visited.add(jumpCell);
                    queue.push([jumpX, jumpY, [...path, jumpCell]]);
                }
            }
        }
        return undefined;
    }

    private inBounds(x: number, y: number): boolean {
        // Check if the coordinates are within the bounds of the board.
        return x >= 0 && x < this.boardSize && y >= 0 && y < this.boardSize;
    }

    private getCellContents(x: number, y: number, board: Map<string, ICellContents>): ICellContents | undefined {
        // Get the contents of the cell at (x, y).
        return board.get(this.coords2algebraic(x, y));
    }

    private hasPiece(x: number, y: number, board: Map<string, ICellContents>): boolean {
        // Check if the cell at (x, y) has a piece.
        return this.getCellContents(x, y, board)?.piece !== undefined;
    }

    private hasTile(x: number, y: number, board: Map<string, ICellContents>): boolean {
        // Check if the cell at (x, y) has a tile.
        return this.getCellContents(x, y, board)?.tile !== undefined;
    }

    private isObstacle(x: number, y: number, board: Map<string, ICellContents>): boolean {
        // Check if the cell at (x, y) is an obstacle for a pyramid.
        return this.hasPiece(x, y, board) || !this.hasTile(x, y, board);
    }

    private canLandOn(x: number, y: number, board: Map<string, ICellContents>): boolean {
        // Check if the cell at (x, y) is a valid landing spot for a pyramid.
        const contents = this.getCellContents(x, y, board);
        return contents?.tile !== undefined && contents.piece === undefined;
    }

    private moveAlongLine(x: number, y: number, dir: Direction, checker: CellPredicate): string[] {
        // Move along a line in the specified direction until an obstacle is found.
        const [dx, dy] = dir;
        const cells: string[] = [];
        let currX = x + dx;
        let currY = y + dy;

        while (this.inBounds(currX, currY)) {
            if (!checker(currX, currY)) { break; }
            cells.push(this.coords2algebraic(currX, currY));
            currX += dx;
            currY += dy;
        }
        return cells;
    }

    private getConeMoves(fromX: number, fromY: number, board: Map<string, ICellContents>): string[] {
        // Get all possible moves for a cone piece.
        return allDirs.flatMap(dir =>
            this.moveAlongLine(fromX, fromY, dir, (x, y) =>
                !this.hasPiece(x, y, board) && this.hasTile(x, y, board)
            )
        );
    }

    private getTileMoves(fromX: number, fromY: number, board: Map<string, ICellContents>): string[] {
        // Get all possible moves for a tile.
        return orthogonalDirs.flatMap(dir =>
            this.moveAlongLine(fromX, fromY, dir, (x, y) =>
                !this.hasTile(x, y, board)
            )
        );
    }

    private normaliseMove(m: string): string {
        // Normalize the move string by removing extra spaces and ensuring proper casing.
        m = m.trim().replace(/\s+/g, " ");
        const parts = m.split(" ");
        const normalized = parts.map(part => {
            if (part.length > 1 && part[0].match(/[a-z]/i) && part.slice(1).match(/^\d+$/)) {
                return part.toLowerCase();
            }
            if (part.length > 0 && part[0].match(/[a-z]/i)) {
                return part[0].toUpperCase() + part.slice(1).toLowerCase();
            }
            return part.toLowerCase();
        });
        return normalized.join(" ");
    }

    private applyMoveToBoard(
        board: Map<string, ICellContents>,
        from: string,
        to: string,
        moveType: MoveType
    ): void {
        // Apply the move to a board.
        const fromContents = board.get(from)!;
        if (!board.has(to)) {
            board.set(to, { tile: undefined, piece: undefined });
        }

        if (moveType === "T") {
            // Moving a tile
            board.get(to)!.tile = fromContents.tile;
            delete fromContents.tile;
        } else {
            // Moving a piece
            if (this.eliminatesTile(from, to)) {
                delete fromContents.tile;
            }
            const toContents = board.get(to)!;
            toContents.piece = fromContents.piece;
            fromContents.piece = undefined;
        }

        // Clean up empty cells
        if (fromContents.tile === undefined && fromContents.piece === undefined) {
            board.delete(from);
        } else {
            board.set(from, fromContents);
        }
    }

    public move(m: string, { partial = false, trusted = false } = {}): C1Game {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        let result;
        m = this.normaliseMove(m);
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

        // Apply moves in sequence
        const moves = m.split(" ");
        for (const singlemove of moves) {
            const [from, to] = singlemove.slice(1).split(/[x-]/);
            const moveType = this.getMoveType(from)!;
            if (to === undefined) {
                this.dots = this.getTos(from, moveType);
                return this;
            }

            let path: string[] | undefined;
            const eliminatesTile = this.eliminatesTile(from, to);
            if (moveType === "P") {
                path = this.findPyramidPath(from, to);
            }

            this.applyMoveToBoard(this.board, from, to, moveType);

            const moveResult: APMoveResult = { type: "move", from, to, what: moveType };
            if (path !== undefined) {
                moveResult.how = path.join(",");
            }
            this.results.push(moveResult);

            if (eliminatesTile) {
                this.results.push({ type: "capture", where: from });
            }
        }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    private isConeSurrounded(player: playerid, board: Map<string, ICellContents> = this.board): boolean {
        // Find this player's cone
        let coneCell: string | undefined;
        for (const [cell, contents] of board.entries()) {
            if (contents.piece?.type === "C" && contents.piece.owner === player) {
                coneCell = cell;
                break;
            }
        }
        if (coneCell === undefined) {
            throw new Error(`Player ${player} does not have a cone on the board.`);
        }

        // Check if cone is surrounded
        const [x, y] = this.algebraic2coords(coneCell);
        return orthogonalDirs.every(([dx, dy]) => {
            const newX = x + dx;
            const newY = y + dy;
            if (!this.inBounds(newX, newY)) { return true; }
            const contents = board ? board.get(this.coords2algebraic(newX, newY)) : this.getCellContents(newX, newY, board);
            return contents?.piece !== undefined || contents?.tile === undefined;
        });
    }

    protected checkEOG(): C1Game {
        const cone1Surrounded = this.isConeSurrounded(1);
        const cone2Surrounded = this.isConeSurrounded(2);

        if (cone1Surrounded || cone2Surrounded) {
            this.gameover = true;
            if (cone1Surrounded && cone2Surrounded) {
                this.winner = [1, 2];
            } else if (cone1Surrounded) {
                this.winner = [2];
            } else {
                this.winner = [1];
            }
        }

        if (this.gameover) {
            this.results.push({ type: "eog" });
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public state(): IC1State {
        return {
            game: C1Game.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: C1Game.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(
                [...this.board.entries()].map(([cell, contents]) => [cell, {
                    tile: contents.tile ? { ...contents.tile } : undefined,
                    piece: contents.piece ? { ...contents.piece } : undefined
                }])
            ),
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < this.boardSize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const cells: string[] = [];
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                const contents = this.board.get(cell);
                const pieces: string[] = [];

                // Add tile first if it exists
                if (contents?.tile !== undefined) {
                    if (contents.tile.owner === 1) {
                        pieces.push(contents.tile.type === "S" ? "B" : "A");
                    } else {
                        pieces.push(contents.tile.type === "S" ? "F" : "E");
                    }
                }

                // Add piece if it exists
                if (contents?.piece !== undefined) {
                    if (contents.piece.owner === 1) {
                        pieces.push(contents.piece.type === "P" ? "C" : "D");
                    } else {
                        pieces.push(contents.piece.type === "P" ? "G" : "H");
                    }
                }

                cells.push(pieces.length > 0 ? pieces.join("") : "-");
            }
            pstr += cells.join(",");
        }
        pstr = pstr.replace(/-,-,-,-,-,-,-/g, "_");

        // Build rep
        const rep: APRenderRep =  {
            renderer: "stacking-offset",
            board: {
                stackOffset: 0,
                style: "squares",
                width: this.boardSize,
                height: this.boardSize,
            },
            legend: {
                // p1 fixed tile
                A: [{ name: "piece-square", colour: "#FFF", scale: 1.2 }, { name: "piece-square", colour: 1, scale: 1.2, opacity: 0.55 }],
                // p1 slidable tile
                B: [{ name: "piece-square", colour: "#FFF", scale: 1.2 }, { name: "piece-square", colour: 1, scale: 1.2, opacity: 0.8 }],
                // p1 pyramid
                C: [{ name: "piece-square", colour: 1, scale: 0.8 }, { name: "x", scale: 0.85, colour: "_context_borders" }],
                // p1 cone
                D: [{ name: "piece", colour: 1 }, { name: "ring-01", colour: "_context_borders", scale: 0.3 }],
                // p2 fixed tile
                E: [{ name: "piece-square", colour: "#FFF", scale: 1.2 }, { name: "piece-square", colour: 2, scale: 1.2, opacity: 0.55 }],
                // p2 slidable tile
                F: [{ name: "piece-square", colour: "#FFF", scale: 1.2 }, { name: "piece-square", colour: 2, scale: 1.2, opacity: 0.8 }],
                // p2 pyramid
                G: [{ name: "piece-square", colour: 2, scale: 0.8 }, { name: "x", scale: 0.85, colour: "_context_borders" }],
                // p2 cone
                H: [{ name: "piece", colour: 2 }, { name: "ring-01", colour: "_context_borders", scale: 0.3 }],
            },
            pieces: pstr,
        };

        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "capture") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({ type: "exit", targets: [{ row: y, col: x }] });
                } else if (move.type === "move") {
                    if (move.how) {
                        // Create annotations for the complete path
                        const points = move.how.split(",").map((cell: string) => {
                            const [x, y] = this.algebraic2coords(cell);
                            return { row: y, col: x };
                        });
                        rep.annotations.push({ type: "move", targets: points as [RowCol, ...RowCol[]] });
                    } else {
                        // Regular move annotation
                        const [fromX, fromY] = this.algebraic2coords(move.from);
                        const [toX, toY] = this.algebraic2coords(move.to);
                        rep.annotations.push({ type: "move", targets: [{ row: fromY, col: fromX }, { row: toY, col: toX }] });
                    }
                }
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

    public inCheck(): number[] {
        if (this.gameover && this.lastmove !== undefined && this.specialMove(this.lastmove)) {
            return [];
        }
        const checked: number[] = [];
        const testBoard = new Map(
            [...this.board.entries()].map(([cell, contents]) => [cell, {
                tile: contents.tile ? { ...contents.tile } : undefined,
                piece: contents.piece ? { ...contents.piece } : undefined
            }])
        );

        for (const p of [1,2] as playerid[]) {
            const otherPlayer = p === 1 ? 2 : 1;
            const possibleMoves = this.moves(otherPlayer);

            for (const move of possibleMoves) {
                // Reset board state
                testBoard.clear();
                for (const [cell, contents] of this.board) {
                    testBoard.set(cell, {
                        tile: contents.tile ? { ...contents.tile } : undefined,
                        piece: contents.piece ? { ...contents.piece } : undefined
                    });
                }

                // Apply each move in sequence
                const moves = move.split(" ");
                for (const singlemove of moves) {
                    const [from, to] = singlemove.slice(1).split(/[x-]/);
                    const moveType = this.getMoveType(from, testBoard)!;
                    this.applyMoveToBoard(testBoard, from, to, moveType);
                }

                if (this.isConeSurrounded(p, testBoard)) {
                    checked.push(p);
                    break;
                }
            }
        }
        return checked;
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += `**In Check:** ${this.inCheck().toString()}\n\n`;

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.c1", { player, where: r.where }));
                resolved = true;
                break;
            case "move":
                node.push(i18next.t("apresults:MOVE.complete", { player, from: r.from, to: r.to, what: moveType2name[r.what as MoveType] }));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): C1Game {
        return new C1Game(this.serialize());
    }
}
