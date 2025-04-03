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
            "http://lumicube.uk/",
            "https://boardgamegeek.com/boardgame/386986/c1",
        ],
        people: [
            {
                type: "designer",
                name: "Michael Seal",
                urls: ["https://boardgamegeek.com/boardgamedesigner/396/michael-seal"],
            }
        ],
        variants: [],
        categories: ["goal>align", "mechanic>move", "mechanic>differentiate", "board>shape>rect", "board>connect>rect", "components>special"],
        flags: ["experimental", "perspective", "check"],
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
        for (let row = 0; row < this.boardSize; row++) {
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                const contents = this.board.get(cell);
                if (!contents) { continue; }
                if (contents.piece !== undefined) {
                    // Check for pieces belonging to current player
                    if (contents.piece.owner !== player) { continue; }
                    const moveType = contents.piece.type === "C" ? "C" : "P";
                    const destinations = this.getTos(cell, moveType);
                    for (const dest of destinations) {
                        const separator = this.eliminatesTile(cell, dest) ? "x" : "-";
                        moves.push(`${moveType}${cell}${separator}${dest}`);
                    }
                } else if (contents.tile?.owner === player && contents.tile.type === "S") {
                    // Check for slidable tiles belonging to current player
                    const destinations = this.getTos(cell, "T");
                    for (const dest of destinations) {
                        moves.push(`T${cell}-${dest}`);
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

    private eliminatesTile(from: string, to: string): boolean {
        // Check if the move from `from` to `to` eliminates a tile.
        const fromContents = this.board.get(from);
        const toContents = this.board.get(to);
        if (!fromContents?.tile || !toContents?.tile) { return false; }
        if (fromContents.piece === undefined) { return false; }
        return fromContents.tile.owner !== fromContents.piece.owner &&
                fromContents.tile.owner !==  toContents.tile.owner;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            let newmove = "";

            if (move === "") {
                const moveType = this.getMoveType(cell);
                if (moveType === undefined) {
                    // Let the validation handle this
                    newmove = cell;
                } else {
                    newmove = moveType + cell;
                }
            } else if (move.slice(1) === cell) {
                // Deselection
                newmove = "";
            } else if (
                (this.board.get(cell)?.piece?.owner === this.currplayer) ||
                (this.board.get(cell)?.tile?.owner === this.currplayer &&
                 this.board.get(cell)?.tile?.type === "S" &&
                 !this.board.get(cell)?.piece)
            ) {
                // Piece reselection without deselection
                const firstCell = move.slice(1);
                const moveType = this.getMoveType(firstCell);
                if (moveType !== undefined) {
                    const validDests = this.getTos(firstCell, moveType);
                    if (!validDests.includes(cell)) {
                        const newMoveType = this.getMoveType(cell)!;
                        newmove = newMoveType + cell;
                    }
                }
                if (newmove === "") {
                    const separator = this.eliminatesTile(firstCell, cell) ? "x" : "-";
                    newmove = move + separator + cell;
                }
            } else {
                const firstCell = move.slice(1);
                const separator = this.eliminatesTile(firstCell, cell) ? "x" : "-";
                newmove = move + separator + cell;
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
            result.message = i18next.t("apgames:validation.c1.INITIAL_INSTRUCTIONS");
            return result;
        }
        m = this.normaliseMove(m);
        const prefix = ["C", "P", "T"].includes(m[0]) ? m[0] : undefined;
        const [from, to] = (() => {
            const s = prefix ? m.slice(1) : m;
            const idx = s.search(/[x-]/);
            return idx === -1 ? [s, ""] : [s.slice(0, idx), s.slice(idx + 1)];
        })();
        // Valid cell
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
        const contentsFrom = this.board.get(from);
        // No piece or tile at `from`
        if (contentsFrom === undefined) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NONEXISTENT", { where: from });
            return result;
        }
        const pieceFrom = contentsFrom.piece;
        if (pieceFrom !== undefined) {
            // Wrong player
            if (pieceFrom.owner !== this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.UNCONTROLLED", { where: from });
                return result;
            }
            // Prefix check
            if (prefix === undefined) {
                const rightPrefix = pieceFrom.type;
                result.valid = false;
                result.message = i18next.t("apgames:validation.c1.MISSING_PREFIX", { prefix: rightPrefix, move: rightPrefix + m });
                return result;
            }
            if (prefix === "C" && pieceFrom.type !== "C" || prefix === "P" && pieceFrom.type !== "P") {
                const rightPrefix = pieceFrom.type;
                result.valid = false;
                result.message = i18next.t("apgames:validation.c1.WRONG_PREFIX", { prefix: rightPrefix, move: rightPrefix + m });
                return result;
            }
        } else {
            const tileFrom = contentsFrom.tile;
            // No piece or tile at `from`
            if (tileFrom === undefined) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NONEXISTENT", { where: from });
                return result;
            }
            // Fixed tile
            if (tileFrom.type !== "S") {
                result.valid = false;
                result.message = i18next.t("apgames:validation.c1.NOT_SLIDABLE", { where: from });
                return result;
            }
            // Wrong player
            if (tileFrom.owner !== this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.UNCONTROLLED", { where: from });
                return result;
            }
            // Prefix check
            if (prefix === undefined) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.c1.MISSING_PREFIX", { prefix: "T", move: "T" + m });
                return result;
            }
            if (prefix !== "T") {
                result.valid = false;
                result.message = i18next.t("apgames:validation.c1.WRONG_PREFIX", { prefix: "T", move: "T" + m });
                return result;
            }
        }
        const tos = this.getTos(from, prefix as MoveType);
        // Has destinations
        if (tos.length === 0) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NO_MOVES", { where: from });
            return result;
        }
        // Select destination
        if (to === "") {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation._general.NEED_DESTINATION");
            return result;
        }
        // Check tos.
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
        // Separator type.
        const separator = m.includes("x") ? "x" : "-";
        if (separator === "x" && !this.eliminatesTile(from, to)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.c1.USE_MOVE_NOTATION", { move: m.replace("x", "-") });
            return result;
        }
        if (separator === "-" && this.eliminatesTile(from, to)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.c1.USE_ELIMINATE_NOTATION", { move: m.replace("-", "x") });
            return result;
        }
        // All good
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private getMoveType(at: string): MoveType | undefined {
        // Get move type at `at`.
        // If there is a piece, return the type of the piece.
        const contents = this.board.get(at);
        if (contents?.piece) {
            return contents.piece.type;
        }
        // If there is a slidable tile, return "T".
        if (contents?.tile && contents.tile.type === "S") {
            return "T";
        }
        return undefined;
    }

    private getTos(from: string, moveType: MoveType): string[] {
        // Get all possible destinations for a move from `from`.
        const [fromX, fromY] = this.algebraic2coords(from);
        if (moveType === "C") {
            return this.getConeMoves(fromX, fromY);
        } else if (moveType === "T") {
            return this.getTileMoves(fromX, fromY);
        } else {
            const visited = new Set<string>([from]);
            const tos: string[] = [];
            this.findPyramidJumps(fromX, fromY, visited, tos, true);
            return tos;
        }
    }

    private findPyramidJumps(x: number, y: number, visited: Set<string>, tos: string[], isFirstMove: boolean): void {
        // Find all possible jumps for a pyramid piece from (x, y).
        for (const [dx, dy] of orthogonalDirs) {
            const newX = x + dx;
            const newY = y + dy;
            if (!this.inBounds(newX, newY)) { continue; }
            const cell = this.coords2algebraic(newX, newY);
            if (visited.has(cell)) { continue; }

            if (isFirstMove && this.canLandOn(newX, newY)) {
                tos.push(cell);
                continue;
            }

            if (!this.isObstacle(newX, newY)) { continue; }

            const jumpX = newX + dx;
            const jumpY = newY + dy;
            if (!this.inBounds(jumpX, jumpY)) { continue; }
            const jumpCell = this.coords2algebraic(jumpX, jumpY);
            if (!visited.has(jumpCell) && this.canLandOn(jumpX, jumpY)) {
                tos.push(jumpCell);
                visited.add(jumpCell);
                this.findPyramidJumps(jumpX, jumpY, visited, tos, false);
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

    private getCellContents(x: number, y: number): ICellContents | undefined {
        // Get the contents of the cell at (x, y).
        return this.board.get(this.coords2algebraic(x, y));
    }

    private hasPiece(x: number, y: number): boolean {
        // Check if the cell at (x, y) has a piece.
        return this.getCellContents(x, y)?.piece !== undefined;
    }

    private hasTile(x: number, y: number): boolean {
        // Check if the cell at (x, y) has a tile.
        return this.getCellContents(x, y)?.tile !== undefined;
    }

    private isObstacle(x: number, y: number): boolean {
        // Check if the cell at (x, y) is an obstacle for a pyramid.
        return this.hasPiece(x, y) || !this.hasTile(x, y);
    }

    private canLandOn(x: number, y: number): boolean {
        // Check if the cell at (x, y) is a valid landing spot for a pyramid.
        const contents = this.getCellContents(x, y);
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

    private getConeMoves(fromX: number, fromY: number): string[] {
        // Get all possible moves for a cone piece.
        return allDirs.flatMap(dir =>
            this.moveAlongLine(fromX, fromY, dir, (x, y) =>
                !this.hasPiece(x, y) && this.hasTile(x, y)
            )
        );
    }

    private getTileMoves(fromX: number, fromY: number): string[] {
        // Get all possible moves for a tile.
        return orthogonalDirs.flatMap(dir =>
            this.moveAlongLine(fromX, fromY, dir, (x, y) =>
                !this.hasTile(x, y)
            )
        );
    }

    private normaliseMove(m: string): string {
        // Normalise the move string by removing spaces and converting the capitalisation.
        m = m.replace(/\s+/g, "");
        if (m.length > 1 && m[0].match(/[a-z]/i) && m.slice(1).match(/^\d+$/)) {
            return m.toLowerCase();
        }
        if (m.length > 0 && m[0].match(/[a-z]/i)) {
            return m[0].toUpperCase() + m.slice(1).toLowerCase();
        }
        return m.toLowerCase();
    }

    private applyMoveToBoard(
        board: Map<string, ICellContents>,
        from: string,
        to: string,
        moveType: MoveType
    ): void {
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

        const [from, to] = m.slice(1).split(/[x-]/);
        const moveType = this.getMoveType(from)!;
        if (to === undefined) {
            this.dots = this.getTos(from, moveType);
            return this;
        } else {
            let path: string[] | undefined;
            // Check some stuff before move is committed.
            const eliminatesTile = this.eliminatesTile(from, to);
            if (moveType === "P") { path = this.findPyramidPath(from, to); }

            // Apply the move
            this.applyMoveToBoard(this.board, from, to, moveType);

            // Now record moves
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

    private isConeSurrounded(player: playerid, board?: Map<string, ICellContents>): boolean {
        const currentBoard = board || this.board;
        // Find this player's cone
        let coneCell: string | undefined;
        for (const [cell, contents] of currentBoard.entries()) {
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
            const contents = board ? board.get(this.coords2algebraic(newX, newY)) : this.getCellContents(newX, newY);
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
                A: [{ name: "piece-square", colour: "#FFF", scale: 1.2 }, { name: "piece-square", colour: 1, scale: 1.2, opacity: 0.45 }],
                // p1 slidable tile
                B: [{ name: "piece-square", colour: "#FFF", scale: 1.2 }, { name: "piece-square", colour: 1, scale: 1.2, opacity: 0.7 }],
                // p1 pyramid
                C: [{ name: "piece-square", colour: 1, scale: 0.8 }, { name: "x", scale: 0.85, colour: "_context_borders" }],
                // p1 cone
                D: [{ name: "piece", colour: 1 }, { name: "ring-01", colour: "_context_borders", scale: 0.3 }],
                // p2 fixed tile
                E: [{ name: "piece-square", colour: "#FFF", scale: 1.2 }, { name: "piece-square", colour: 2, scale: 1.2, opacity: 0.45 }],
                // p2 slidable tile
                F: [{ name: "piece-square", colour: "#FFF", scale: 1.2 }, { name: "piece-square", colour: 2, scale: 1.2, opacity: 0.7 }],
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
        // Create a single clone of the board that we'll reuse
        const testBoard = new Map(
            [...this.board.entries()].map(([cell, contents]) => [cell, {
                tile: contents.tile ? { ...contents.tile } : undefined,
                piece: contents.piece ? { ...contents.piece } : undefined
            }])
        );

        for (const p of [1,2] as playerid[]) {
            const otherPlayer = p === 1 ? 2 : 1;
            // Get all possible moves for the other player
            const possibleMoves = this.moves(otherPlayer);

            for (const move of possibleMoves) {
                // Apply the move
                const [from, to] = move.slice(1).split(/[x-]/);
                const moveType = this.getMoveType(from)!;
                this.applyMoveToBoard(testBoard, from, to, moveType);

                // Check if this move would surround the opponent's cone
                if (this.isConeSurrounded(p, testBoard)) {
                    checked.push(p);
                    break;
                }

                // Restore the board state
                testBoard.clear();
                for (const [cell, contents] of this.board) {
                    testBoard.set(cell, {
                        tile: contents.tile ? { ...contents.tile } : undefined,
                        piece: contents.piece ? { ...contents.piece } : undefined
                    });
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
