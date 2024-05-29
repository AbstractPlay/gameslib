import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";

type playerid = 1 | 2;
type CellContents = playerid;
type Directions = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";
const directionDelta: Map<Directions, [number, number]> = new Map([
    ["N", [0, -1]],
    ["NE", [1, -1]],
    ["E", [1, 0]],
    ["SE", [1, 1]],
    ["S", [0, 1]],
    ["SW", [-1, 1]],
    ["W", [-1, 0]],
    ["NW", [-1, -1]],
]);
const allDirections: Directions[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const allDeltas: [number, number][] = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
const manGroupSize = 3;
const knightGroupSize = 5;
const dragonGroupSize = 5;

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    lastmove?: string;
}

export interface IAnacheState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class AnacheGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Anache",
        uid: "anache",
        playercounts: [2],
        version: "20240501",
        dateAdded: "2024-05-01",
        // i18next.t("apgames:descriptions.anache")
        description: "apgames:descriptions.anache",
        // i18next.t("apgames:notes.anache")
        notes: "apgames:notes.anache",
        urls: ["https://www.mathematik.hu-berlin.de/~ploog/BSB/Anache.pdf"],
        people: [
            {
                type: "designer",
                name: "GoldGeneral_0"
            }
        ],
        variants: [
            { uid: "size-10", group: "board" },
            { uid: "size-15", group: "board" },
        ],
        categories: ["goal>breakthrough", "goal>immobilise", "mechanic>move>group", "mechanic>capture", "board>shape>rect", "board>connect>rect", "components>simple"],
        flags: ["experimental", "perspective", "limited-pieces", "no-moves"],
    };

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardSize);
    }

    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardSize);
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, CellContents>;
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private boardSize = 0;
    private arrows: Map<string, Directions> = new Map();
    private selectedPieces: string[] = [];
    private corners: string[] = [];
    private movingDragon: string | undefined;

    constructor(state?: IAnacheState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            this.boardSize = this.getBoardSize();
            const board = this.getStartingBoard();
            const fresh: IMoveState = {
                _version: AnacheGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IAnacheState;
            }
            if (state.game !== AnacheGame.gameinfo.uid) {
                throw new Error(`The Anache game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
            this.boardSize = this.getBoardSize();
        }
        this.load();
        this.corners = [
            this.coords2algebraic(0, 0),
            this.coords2algebraic(this.boardSize - 1, 0),
            this.coords2algebraic(0, this.boardSize - 1),
            this.coords2algebraic(this.boardSize - 1, this.boardSize - 1)
        ];
    }

    public load(idx = -1): AnacheGame {
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
        this.lastmove = state.lastmove;
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
        return 12;
    }

    private getStartingBoard(debug = false): Map<string, CellContents> {
        // Get the starting position for the board.
        if (debug) {
            // Dragons only appear later in the game so we can use this flag for debugging.
            // Put one dragon at the corners for both players
            const boardDebug = new Map<string, CellContents>();
            boardDebug.set(this.coords2algebraic(0, 0), 2);
            boardDebug.set(this.coords2algebraic(0, this.boardSize - 1), 1);
            // Fill in the board randomly with both players' pieces, or leave empty
            for (let j = 0; j < this.boardSize; j++) {
                for (let i = 0; i < this.boardSize; i++) {
                    if (i === 0 && j === 0) { continue; }
                    if (i === 0 && j === this.boardSize - 1) { continue; }
                    if (i === this.boardSize - 1 && j === 0) { continue; }
                    if (i === this.boardSize - 1 && j === this.boardSize - 1) { continue; }
                    if (Math.random() < 0.3) {
                        boardDebug.set(this.coords2algebraic(i, j), Math.random() < 0.5 ? 1 : 2);
                    }
                }
            }
            return boardDebug;
        }
        const filledRowCount = this.boardSize === 10 ? 3 : this.boardSize === 15 ? 5 : 4;
        const board = new Map<string, CellContents>();
        for (let j = 0; j < filledRowCount; j++) {
            for (let i = 0; i < this.boardSize - 2; i++) {
                board.set(this.coords2algebraic(i + 1, j), 2);
                board.set(this.coords2algebraic(i + 1, this.boardSize - j - 1), 1);
            }
        }
        return board;
    }

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }
        const moves: string[] = [];
        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    private getNeighbours(cell: string): string[] {
        // Get all orthogonal and diagonal neighbours of a cell.
        const [x, y] = this.algebraic2coords(cell);
        const neighbours: string[] = [];
        for (let i = x - 1; i <= x + 1; i++) {
            for (let j = y - 1; j <= y + 1; j++) {
                if (i >= 0 && i < this.boardSize && j >= 0 && j < this.boardSize && (i !== x || j !== y)) {
                    neighbours.push(this.coords2algebraic(i, j));
                }
            }
        }
        return neighbours;
    }

    private getAdjacentFree(group: string[], board: Map<string, playerid>): Set<string> {
        // Get all adjacent cells that do not have a piece of `player`.
        const adjacents: Set<string> = new Set();
        for (const cell of group) {
            const neighbours = this.getNeighbours(cell);
            for (const neighbour of neighbours) {
                if (board.has(neighbour)) { continue; }
                if (group.includes(neighbour)) { continue; }
                adjacents.add(neighbour);
            }
        }
        return adjacents;
    }

    private getNeighbourDirections(cell: string, group: string[]): Directions[] {
        // Check all directions to see if there if a cell in `group` is there.
        const directions: Directions[] = [];
        const [x, y] = this.algebraic2coords(cell);
        for (const [direction, [dx, dy]] of directionDelta) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < this.boardSize && ny >= 0 && ny < this.boardSize) {
                const neighbour = this.coords2algebraic(nx, ny);
                if (group.includes(neighbour)) {
                    directions.push(direction);
                }
            }
        }
        return directions;
    }

    private hasKnight(group: string[], player: playerid) {
        // Check if a group has a knight.
        if (player === 1) {
            return group.some((cell) => this.algebraic2coords(cell)[1] < Math.ceil(this.boardSize / 2));
        }
        return group.some((cell) => this.algebraic2coords(cell)[1] >= Math.floor(this.boardSize / 2));
    }

    private getAllowedDirections(group: string[], player: playerid, hasKnight: boolean): Directions[] {
        // If one piece in the group is beyond the middle line, only allow the opposite direction.
        // Assumes no dragon.
        if (player === 1) {
            if (hasKnight) {
                return ["E", "NE", "N", "NW", "W"];
            }
            return ["NE", "N", "NW"];
        }
        if (hasKnight) {
            return ["E", "SE", "S", "SW", "W"];
        }
        return ["SE", "S", "SW"];
    }

    private checkFree(group: string[], board: Map<string, playerid>, player: playerid, direction: Directions): boolean {
        // Check if the cells in the group can move in the direction.
        for (const cell of group) {
            const [x, y] = this.algebraic2coords(cell);
            const [dx, dy] = directionDelta.get(direction)!;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= this.boardSize || ny < 0 || ny >= this.boardSize) {
                return false;
            }
            const ahead = this.coords2algebraic(nx, ny);
            if (board.has(ahead) && !group.includes(ahead)) { return false; }
        }
        return true;
    }

    private getGroup(cell: string, board: Map<string, playerid>): Set<string> {
        // Get the group of cells that are connected to `cell`.
        const seen: Set<string> = new Set();
        const player = board.get(cell);
        const todo = [cell];
        while (todo.length > 0) {
            const current = todo.pop()!;
            if (seen.has(current)) { continue; }
            seen.add(current);
            for (const neighbour of this.getNeighbours(current)) {
                if (board.has(neighbour) && board.get(neighbour) === player) {
                    todo.push(neighbour);
                }
            }
        }
        return seen;
    }

    private isImmobilised(piece: string, board: Map<string, playerid>, player: playerid): boolean {
        // Imobilisation check.
        const group = this.getGroup(piece, board);
        if (group.size > 1) { return false };
        const [x, y] = this.algebraic2coords(piece);
        for (const dir of this.getAllowedDirections(Array.from(group), player, false)) {
            const [dx, dy] = directionDelta.get(dir)!;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= this.boardSize || ny < 0 || ny >= this.boardSize) { continue; }
            const ahead = this.coords2algebraic(nx, ny);
            if (this.board.has(ahead) && this.board.get(ahead) !== player) {
                return true;
            }
        }
        return false;
    }

    private formsBarrier(piece: string, board: Map<string, playerid>): boolean {
        // Check if a barrier is formed.
        // Provide a single piece in the group.
        const group = this.getGroup(piece, board);
        let seenLeft = false;
        let seenRight = false;
        for (const cell of group) {
            const [x, ] = this.algebraic2coords(cell);
            if (x === 0) { seenLeft = true; }
            if (x === this.boardSize - 1) { seenRight = true; }
        }
        return seenLeft && seenRight;
    }

    private getArrows(group: string[], board: Map<string, playerid>, player: playerid, hasDragon = false): Map<string, Directions> {
        // Get the directions of the arrows in a group.
        const arrows: Map<string, Directions> = new Map();
        const allowedDirections = hasDragon ? allDirections : this.getAllowedDirections(group, player, this.hasKnight(group, player));
        for (const c of this.getAdjacentFree(group, board)) {
            const neighbourDirections = this.getNeighbourDirections(c, group);
            if (player === 1 && neighbourDirections.includes("S") && this.checkFree(group, board, player, "N")) {
                arrows.set(c, "N");
            } else if (player === 2 && neighbourDirections.includes("N") && this.checkFree(group, board, player, "S")) {
                arrows.set(c, "S");
            } else if (allowedDirections.includes("S") && neighbourDirections.includes("N") && this.checkFree(group, board, player, "S")) {
                arrows.set(c, "S");
            } else if (allowedDirections.includes("N") && neighbourDirections.includes("S") && this.checkFree(group, board, player, "N")) {
                arrows.set(c, "N");
            } else if (allowedDirections.includes("W") && neighbourDirections.includes("E") && this.checkFree(group, board, player, "W")) {
                arrows.set(c, "W");
            } else if (allowedDirections.includes("E") && neighbourDirections.includes("W") && this.checkFree(group, board, player, "E")) {
                arrows.set(c, "E");
            } else if (allowedDirections.includes("SW") && neighbourDirections.includes("NE") && this.checkFree(group, board, player, "SW")) {
                arrows.set(c, "SW");
            } else if (allowedDirections.includes("NE") && neighbourDirections.includes("SW") && this.checkFree(group, board, player, "NE")) {
                arrows.set(c, "NE");
            } else if (allowedDirections.includes("SE") && neighbourDirections.includes("NW") && this.checkFree(group, board, player, "SE")) {
                arrows.set(c, "SE");
            } else if (allowedDirections.includes("NW") && neighbourDirections.includes("SE") && this.checkFree(group, board, player, "NW")) {
                arrows.set(c, "NW");
            }
        }
        return arrows;
    }

    private normaliseMove(m: string): string {
        // Make sure that all froms are sorted.
        const moves = m.trim().replace(/\s+/g, " ").split(" ");
        const normalised: string[] = [];
        for (const move of moves) {
            const [fromsPre, dir] = move.split("-");
            if (dir === undefined || dir === "") {
                normalised.push(fromsPre.split(",").sort((a, b) => this.sort(a, b)).join(","));
            } else {
                normalised.push(fromsPre.split(",").sort((a, b) => this.sort(a, b)).join(",") + "-" + dir);
            }
        }
        return normalised.join(" ");
    }

    private sort(a: string, b: string): number {
        // Sort two cells. This is necessary because "a10" should come after "a9".
        const [ax, ay] = this.algebraic2coords(a);
        const [bx, by] = this.algebraic2coords(b);
        if (ax < bx) { return -1; }
        if (ax > bx) { return 1; }
        if (ay < by) { return 1; }
        if (ay > by) { return -1; }
        return 0;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            let newmove = "";
            if (move === "") {
                newmove = cell;
            } else {
                if (move.includes("-") && !move.split("-").pop()!.includes(" ")) {
                    newmove = this.normaliseMove(move + " " + cell);
                } else {
                    const moves = move.split(" ");
                    const isDragonMove = this.isDragonMove(move);
                    const [newBoard, ] = this.postMoveBoard(this.extractGroupMoves(move.split(" ")));
                    if (newBoard.has(cell)) {
                        const lastMove = moves.pop()!;
                        const pieces = lastMove.split(",");
                        if (pieces.includes(cell)) {
                            pieces.splice(pieces.indexOf(cell), 1);
                            if (moves.length > 0) {
                                newmove = this.normaliseMove(`${moves.join(" ")} ${pieces.join(",")}`);
                            } else {
                                newmove = pieces.join(",");
                            }
                        } else {
                            newmove = this.normaliseMove(move + "," + cell);
                        }
                    } else {
                        if (moves.length === 1 && isDragonMove) {
                            newmove = `${move}-${cell}`;
                        } else {
                            const lastMove = moves[moves.length - 1];
                            const arrows = this.getArrows(lastMove.split(","), newBoard, this.currplayer, isDragonMove);
                            if (arrows.has(cell)) {
                                newmove = this.normaliseMove(`${move}-${arrows.get(cell)}`);
                            } else {
                                newmove = move;
                            }
                        }
                    }
                    if (isDragonMove) {
                        // Automatically reselect dragon because it is mandatory to move it.
                        const newsplit = newmove.split(" ");
                        if (newsplit.length === 1 && newsplit[0].includes("-")) {
                            newmove = `${newmove} ${cell}`;
                        }
                    }
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

    private oneGroup(group: string[]) {
        // Check if the cells are all in one group.
        const seen = new Set<string>();
        const todo = [group[0]];
        while (todo.length > 0) {
            const current = todo.pop()!;
            if (seen.has(current)) { continue; }
            seen.add(current);
            for (const neighbour of this.getNeighbours(current)) {
                if (group.includes(neighbour)) {
                    todo.push(neighbour);
                }
            }
        }
        return seen.size === group.length;
    }

    private isDragonMove(m: string): boolean {
        // Check if the move string is a dragon move.
        return this.corners.includes(m.split(" ")[0].split("-")[0])
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.anache.INITIAL_INSTRUCTIONS");
            return result;
        }
        m = m.trim().replace(/\s+/g, " ");
        const moves = m.split(" ");
        const groupMoves: [string[], Directions | string | undefined][] = []
        const isDragonMove = this.isDragonMove(m);
        if (this.stack.length === 1) {
            if (moves.length > 1) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.anache.FIRST_MOVE_NO_DOUBLE");
                return result;
            }
        } else {
            if (!isDragonMove && moves.length > 2) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.anache.TOO_MANY_MOVES");
                return result;
            }
        }
        const movedPieces = new Set<string>();
        let dragonContinue = true;
        let movingDragon: string | undefined;
        let newBoard: Map<string, CellContents> = new Map(this.board);
        let formsBarrier = false;
        for (const [i, move] of moves.entries()) {
            if (isDragonMove && !dragonContinue) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.DRAGON_NO_CONTINUE");
                return result;
            }
            const [fromsPre, dir] = move.split("-");
            const froms = fromsPre.split(",");
            // valid cell
            let currentMove;
            try {
                for (const p of froms) {
                    if (p === undefined || p.length === 0) { continue; }
                    currentMove = p;
                    const [x, y] = this.algebraic2coords(p);
                    // `algebraic2coords` does not check if the cell is on the board.
                    if (x < 0 || x >= this.boardSize || y < 0 || y >= this.boardSize) {
                        throw new Error("Invalid cell");
                    }
                }
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: currentMove });
                return result;
            }
            // No duplicate cells.
            const seen: Set<string> = new Set();
            const duplicates: Set<string> = new Set();
            for (const f of froms) {
                if (seen.has(f)) { duplicates.add(f); }
                seen.add(f);
            }
            if (duplicates.size > 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.anache.DUPLICATE", {where: [...duplicates].join(", ")});
                return result;
            }
            for (const from of froms) {
                if (!newBoard.has(from)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.NONEXISTENT", { where: from });
                    return result;
                }
                if (newBoard.get(from)! !== this.currplayer) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.UNCONTROLLED", { where: from });
                    return result;
                }
            }
            if (isDragonMove && i === 0) {
                if (froms.length > 1) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.anache.DRAGON_TOO_MANY");
                    return result;
                }
                if (dir !== undefined && dir !== "") {
                    try {
                        const [x, y] = this.algebraic2coords(dir);
                        // `algebraic2coords` does not check if the cell is on the board.
                        if (x < 0 || x >= this.boardSize || y < 0 || y >= this.boardSize) {
                            throw new Error("Invalid cell");
                        }
                    } catch {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.INVALID_DRAGON_TO", { to: dir });
                        return result;
                    }
                    if (!this.dragonJumpable(froms[0], dir, this.currplayer)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.anache.NOT_DRAGON_JUMPABLE");
                        return result;
                    }
                    if (moves.length === 1) {
                        result.valid = true;
                        result.complete = -1;
                        result.canrender = true;
                        result.message = i18next.t("apgames:validation.anache.DRAGON_SELECT_MORE_MANDATORY");
                        return result;
                    }
                }
                dragonContinue = true;
                movingDragon = dir;
                groupMoves.push([froms, dir]);
                newBoard = this.postMoveBoard(groupMoves)[0];
            } else {
                if (isDragonMove) {
                    if (!froms.includes(movingDragon!)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.anache.DRAGON_MUST_INCLUDE", { cell: movingDragon });
                        return result;
                    }
                } else {
                    if (froms.some((f) => this.corners.includes(f))) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.anache.CORNER_NO_MOVE");
                        return result;
                    }
                }
                if (froms.length === 1 && this.isImmobilised(froms[0], newBoard, this.currplayer)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.anache.IMMOBILISED", { where: froms[0] });
                    return result;
                }
                if (!this.oneGroup(froms)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.anache.NOT_CONNECTED");
                    return result;
                }
                const groupSizeLimit = isDragonMove ? dragonGroupSize : this.hasKnight(froms, this.currplayer) ? knightGroupSize : manGroupSize;
                if (i === moves.length - 1) {
                    if (dir === undefined || dir === "") {
                        if (froms.length < groupSizeLimit) {
                            result.valid = true;
                            result.complete = 0;
                            result.canrender = true;
                            result.message = i18next.t("apgames:validation.anache.SELECT_MORE_PIECES", { count: groupSizeLimit });
                            return result;
                        } else if (froms.length === groupSizeLimit) {
                            if (!isDragonMove && froms.every((f) => movedPieces.has(f))) {
                                result.valid = false;
                                result.message = i18next.t("apgames:validation.anache.INCLUDE_UNMOVED");
                                return result;
                            } else {
                                result.valid = true;
                                result.complete = -1;
                                result.canrender = true;
                                result.message = i18next.t("apgames:validation.anache.SELECT_DIR");
                                return result;
                            }
                        } else {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.anache.TOO_MANY", { count: groupSizeLimit });
                            return result;
                        }
                    } else {
                        const arrows = this.getArrows(froms, newBoard, this.currplayer, isDragonMove);
                        if (!Array.from(arrows.values()).includes(dir as Directions)) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.anache.INVALID_DIR", { dir });
                            return result;
                        }
                    }
                } else {
                    if (dir === undefined || dir === "") {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.anache.DIR_MISSING", { move });
                        return result;
                    }
                }
                if (dir !== undefined && dir !== "") {
                    if (!isDragonMove && froms.every((f) => movedPieces.has(f))) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.anache.INCLUDE_UNMOVED");
                        return result;
                    }
                    movingDragon = isDragonMove ? this.shiftGroup([movingDragon!], dir as Directions)[0] : undefined;
                }
                groupMoves.push(this.extractGroupMoves([move])[0]);
                const [b, lastCaptures] = this.postMoveBoard(groupMoves);
                newBoard = b;
                dragonContinue = isDragonMove && lastCaptures.size > 0;
                const tos = this.shiftGroup(froms, dir as Directions);
                froms.forEach((f) => movedPieces.delete(f));
                tos.forEach((t) => movedPieces.add(t));
                if (i === moves.length - 1 && dir !== undefined && dir !== "" && this.formsBarrier(tos[0], newBoard)) {
                    formsBarrier = true;
                }
            }
        }
        const count = this.stateCount(newBoard, this.currplayer % 2 + 1 as playerid);
        if (isDragonMove && dragonContinue) {
            if (count >= 1) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.anache.DRAGON_SELECT_MORE_SUPERKO");
                return result;
            } else if (formsBarrier) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.anache.DRAGON_SELECT_MORE_BARRIER");
                return result;
            } else {
                result.valid = true;
                result.complete = 0;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.anache.DRAGON_SELECT_MORE");
                return result;
            }
        } else {
            if (this.stack.length > 1 && moves.length < 2) {
                if (count >= 1) {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.anache.SELECT_MORE_SUPERKO");
                } else if (formsBarrier) {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.anache.SELECT_MORE_BARRIER");
                } else {
                    result.valid = true;
                    result.complete = 0;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.anache.SELECT_MORE", { count: 1 });
                }
                return result;
            }
        }
        if (count >= 1) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.anache.SUPERKO");
            return result;
        }
        if (formsBarrier) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.anache.BARRIER");
            return result;
        }
        // Final regex check to see if move is valid.
        const regex = new RegExp(`^([a-z]+[1-9][0-9]*)(,[a-z]+[1-9][0-9]*)*(-(([a-z]+[1-9][0-9]*)|(N|NE|E|SE|S|SW|W|NW)))?(( [a-z]+[1-9][0-9]*)(,[a-z]+[1-9][0-9]*)*(-(([a-z]+[1-9][0-9]*)|(N|NE|E|SE|S|SW|W|NW)))?)*$`);
        if (!regex.test(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", { move: m });
            return result;
        }
        const normalised = this.normaliseMove(m);
        if (m !== normalised) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.anache.NORMALISE", { move: normalised });
            return result;
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private dragonJumpable(from: string, to: string, player: playerid) {
        // Check if the dragon can jump to a cell.
        const [xF, ] = this.algebraic2coords(from);
        const [xT, yT] = this.algebraic2coords(to);
        if (player === 1) {
            if (xF === 0) {
                return xT < Math.ceil(this.boardSize / 2) && yT >= Math.floor(this.boardSize / 2);
            }
            return xT >= Math.floor(this.boardSize / 2) && yT >= Math.floor(this.boardSize / 2);
        }
        if (xF === 0) {
            return xT < Math.ceil(this.boardSize / 2) && yT < Math.ceil(this.boardSize / 2);
        }
        return xT >= Math.floor(this.boardSize / 2) && yT < Math.ceil(this.boardSize / 2);
    }

    private shiftGroup(group: string[], direction: Directions): string[] {
        // Return a new list of cells where every member of a group of cells
        // has been shifted in a particular direction.
        const newGroup: string[] = [];
        for (const cell of group) {
            const [x, y] = this.algebraic2coords(cell);
            const [dx, dy] = directionDelta.get(direction)!;
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < this.boardSize && ny >= 0 && ny < this.boardSize) {
                newGroup.push(this.coords2algebraic(nx, ny));
            }
        }
        return newGroup;
    }

    private extractGroupMoves(moves: string[]): [string[], Directions | undefined][] {
        // Extract the group and direction from a move.
        // Direction can be undefined if it is a partial move.
        const groupMoves: [string[], Directions | undefined][] = [];
        for (const move of moves) {
            const [fromsPre, dir] = move.split("-");
            const froms = fromsPre.split(",");
            groupMoves.push([froms, dir === undefined || dir === "" ? undefined : dir as Directions]);
        }
        return groupMoves;
    }

    private postMoveBoard(groupMoves: [string[], Directions | string | undefined][]): [Map<string, CellContents>, Set<string>] {
        // Get a copy of the board that represents the state after the move.
        // `groupMoves` is a list of cells and the direction to shift them to.
        // It removes opponent's pieces from the board if they are captured.
        // If the direction is undefined, the move is skipped.
        // The direction can also be a string, which is only used for the dragon's first move.
        // The dragon's first move will never result in captures.
        // Also returns the last set of captures, which is useful for checking
        // if the dragon moves continue.
        const board = new Map(this.board);
        let captures: Set<string> = new Set();
        for (const [group, dir] of groupMoves) {
            if (dir === undefined) { continue; }
            if (!allDirections.includes(dir as Directions)) {
                board.delete(group[0]);
                board.set(dir, this.currplayer);
            } else {
                const tos = this.shiftGroup(group, dir as Directions);
                for (const from of group) {
                    board.delete(from);
                }
                for (const to of tos) {
                    board.set(to, this.currplayer);
                }
                captures = this.getCaptures(tos, board, this.currplayer);
                for (const capture of captures) {
                    board.delete(capture);
                }
            }
        }
        return [board, captures];
    }

    private getCaptures(group: string[], board: Map<string, CellContents>, player: playerid): Set<string> {
        // Get all enemy pieces that can be captured when a group moves.
        const captures: Set<string> = new Set();
        const otherPlayer = player % 2 + 1 as playerid;
        // Crushing and custodianship captures
        for (const cell of group) {
            const [x, y] = this.algebraic2coords(cell);
            outer:
            for (const [dx, dy] of allDeltas) {
                const tentativeCaptures: string[] = [];
                let seenPlayer = false;
                for (let i = 1; true; i++) {
                    const nx = x + i * dx;
                    const ny = y + i * dy;
                    if (nx < 0 || nx >= this.boardSize || ny < 0 || ny >= this.boardSize) { break; }
                    const ahead = this.coords2algebraic(nx, ny);
                    if (this.corners.includes(ahead)) { break; }
                    const piece = board.get(ahead);
                    if (piece === undefined) { continue outer; }
                    if (piece === player) {
                        seenPlayer = true;
                        break;
                    }
                    tentativeCaptures.push(ahead);
                }
                if (!seenPlayer) {
                    // For crushing captures, there needs to be at least two captures.
                    if (tentativeCaptures.length >= 2) {
                        tentativeCaptures.forEach((c) => captures.add(c));
                    }
                } else {
                    tentativeCaptures.forEach((c) => captures.add(c));
                }
            }
            // Intervention captures
            for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
                let xL = x;
                let yL = y;
                for (let i = 1; true; i++) {
                    if (xL < 0 || xL >= this.boardSize || yL < 0 || yL >= this.boardSize) { break; }
                    if (board.get(this.coords2algebraic(xL - dx, yL - dy)) !== player) { break; }
                    xL -= dx;
                    yL -= dy;
                }
                let xH = x;
                let yH = y;
                for (let i = 1; true; i++) {
                    if (xH < 0 || xH >= this.boardSize || yH < 0 || yH >= this.boardSize) { break; }
                    if (board.get(this.coords2algebraic(xH + dx, yH + dy)) !== player) { break; }
                    xH += dx;
                    yH += dy;
                }
                const tentativeCaptures: string[] = [];
                for (let i = 1; true; i++) {
                    const nxp = xH + i * dx;
                    const nyp = yH + i * dy;
                    if (nxp < 0 || nxp >= this.boardSize || nyp < 0 || nyp >= this.boardSize) { break; }
                    const nxn = xL - i * dx;
                    const nyn = yL - i * dy;
                    if (nxn < 0 || nxn >= this.boardSize || nyn < 0 || nyn >= this.boardSize) { break; }
                    const aheadp = this.coords2algebraic(nxp, nyp);
                    if (this.corners.includes(aheadp)) { break; }
                    const aheadn = this.coords2algebraic(nxn, nyn);
                    if (this.corners.includes(aheadn)) { break; }
                    const piecep = board.get(aheadp);
                    const piecen = board.get(aheadn);
                    if (piecep !== otherPlayer || piecen !== otherPlayer) { break; }
                    tentativeCaptures.push(aheadp);
                    tentativeCaptures.push(aheadn);
                }
                tentativeCaptures.forEach((c) => captures.add(c));
            }
        }
        return captures;
    }

    public move(m: string, {partial = false, trusted = false} = {}): AnacheGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        let result;
        m = m.trim().replace(/\s+/g, " ");
        if (!trusted) {
            result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
        }
        if (m.length === 0) { return this; }
        this.results = [];
        const isDragonMove = this.isDragonMove(m);
        const moves = m.split(" ");
        for (const [i, move] of moves.entries()) {
            const [fromsPre, dir] = move.split("-");
            if (isDragonMove && i === 0) {
                if (dir !== undefined && dir !== "") {
                    this.board.delete(fromsPre);
                    this.board.set(dir, this.currplayer);
                    this.results.push({ type: "move", from: fromsPre, to: dir, what: "dragon", how: "jump", count: 1 });
                    this.movingDragon = dir;
                }
            } else {
                const froms = fromsPre.split(",");
                if (dir === undefined || dir === "") {
                    this.selectedPieces = froms;
                    this.arrows = this.getArrows(froms, this.board, this.currplayer, isDragonMove);
                } else {
                    const pieceType = isDragonMove ? "dragon" : this.hasKnight(froms, this.currplayer) ? "knight" : "man";
                    const tos = this.shiftGroup(froms, dir as Directions);
                    for (const from of froms) {
                        this.board.delete(from);
                    }
                    for (const to of tos) {
                        this.board.set(to, this.currplayer);
                    }
                    this.results.push({ type: "move", from: froms.join(","), to: tos.join(","), what: pieceType, how: dir, count: froms.length });
                    const captures = this.getCaptures(tos, this.board, this.currplayer);
                    for (const capture of captures) {
                        this.board.delete(capture);
                    }
                    if (captures.size > 0) {
                        this.results.push({ type: "capture", where: [...captures].join(","), count: captures.size });
                    }
                    if (isDragonMove) {
                        this.movingDragon = this.shiftGroup([this.movingDragon!], dir as Directions)[0];
                    }
                }
            }
        }
        if (partial) { return this; }
        this.arrows = new Map();
        this.selectedPieces = [];
        this.movingDragon = undefined;

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    private hasMoves(player: playerid): boolean {
        // Check if a player has any moves left.
        const allPieces = [...this.board.entries()].filter(([, p]) => p === player).map(([c]) => c);
        if (allPieces.length === 0) { return false; }
        for (const piece of allPieces) {
            if (!this.isImmobilised(piece, this.board, player)) { return true; }
        }
        return false;
    }

    private occupiesCorners(player: playerid): boolean {
        // Check if a player occupies the corners.
        return this.corners.filter((c) => this.board.get(c) === player).length === 2;
    }

    protected checkEOG(): AnacheGame {
        const otherPlayer = this.currplayer % 2 + 1 as playerid;
        if (this.occupiesCorners(otherPlayer)) {
            this.gameover = true;
            this.winner = [otherPlayer];
            this.results.push({ type: "eog", reason: "breakthrough" });
        } else if (!this.hasMoves(this.currplayer)) {
            this.gameover = true;
            this.winner = [otherPlayer];
            this.results.push({ type: "eog", reason: "stalemate" });
        }
        if (this.gameover) {
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public state(): IAnacheState {
        return {
            game: AnacheGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: AnacheGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
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
                    const player = this.board.get(cell)!;
                    if (this.corners.includes(cell) || this.movingDragon === cell) {
                        if (player === 1) {
                            if (this.selectedPieces.includes(cell)) {
                                pstr += "G";
                            } else {
                                pstr += "C";
                            }
                        } else if (player === 2) {
                            if (this.selectedPieces.includes(cell)) {
                                pstr += "H";
                            } else {
                                pstr += "D";
                            }
                        }
                    } else {
                        if (player === 1) {
                            if (this.selectedPieces.includes(cell)) {
                                pstr += "E";
                            } else {
                                pstr += "A";
                            }
                        } else if (player === 2) {
                            if (this.selectedPieces.includes(cell)) {
                                pstr += "F";
                            } else {
                                pstr += "B";
                            }
                        }
                    }
                } else {
                    pstr += "-";
                }
            }
        }
        pstr = pstr.replace(new RegExp(`-{${this.boardSize}}`, "g"), "_");
        const markers: Array<any> = [
            {
                type: "flood", colour: 2, opacity: 0.2,
                points: [{ col: 0, row: 0}, { col: this.boardSize - 1, row: 0 }],
            },
            {
                type: "flood", colour: 1, opacity: 0.2,
                points: [{ col: 0, row: this.boardSize - 1}, { col: this.boardSize - 1, row: this.boardSize - 1}],
            }
        ];
        if (this.boardSize % 2 === 0) {
            markers.push(
                {
                    type: "line", colour: "_context_strokes", width: 4,
                    points: [{ col: 0, row: this.boardSize / 2 }, { col: this.boardSize, row: this.boardSize / 2 }],
                }
            )
        } else {
            markers.push(
                {
                    type: "shading", colour: "_context_fill", opacity: 0.2,
                    points: [{ row: (this.boardSize - 1) / 2, col: 0 }, { row: (this.boardSize - 1) / 2, col: this.boardSize }, { row: (this.boardSize - 1) / 2 + 1, col: this.boardSize }, { row: (this.boardSize - 1) / 2 + 1, col: 0 }],
                }
            )
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares",
                width: this.boardSize,
                height: this.boardSize,
                markers,
            },
            legend: {
                A: [{ name: "piece", player: 1 }],
                B: [{ name: "piece", player: 2 }],
                C: [{ name: "piece-horse", player: 1}],
                D: [{ name: "piece-horse", player: 2}],
                // Selected pieces
                E: [{ name: "piece", colour: "#FFF" }, { name: "piece", player: 1, opacity: 0.5 }],
                F: [{ name: "piece", colour: "#FFF" }, { name: "piece", player: 2, opacity: 0.5 }],
                G: [{ name: "piece", colour: "#FFF" }, { name: "piece-horse", player: 1, opacity: 0.5 }],
                H: [{ name: "piece", colour: "#FFF" }, { name: "piece-horse", player: 2, opacity: 0.5 }],
                "arrow-W": [{ text: "←" }],
                "arrow-NW": [{ text: "↖" }],
                "arrow-N": [{ text: "↑" }],
                "arrow-NE": [{ text: "↗" }],
                "arrow-SW": [{ text: "↙" }],
                "arrow-S": [{ text: "↓" }],
                "arrow-SE": [{ text: "↘" }],
                "arrow-E": [{ text: "→" }],
            },
            pieces: pstr,
        };

        // @ts-ignore
        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "move") {
                    const froms = move.from.split(",");
                    const tos = move.to.split(",");
                    for (let i = 0; i < froms.length; i++) {
                        const [fromX, fromY] = this.algebraic2coords(froms[i]);
                        const [toX, toY] = this.algebraic2coords(tos[i]);
                        if (move.how === "jump") {
                            rep.annotations.push({ type: "eject", targets: [{ row: fromY, col: fromX }, { row: toY, col: toX }] });
                        } else {
                            rep.annotations.push({ type: "move", targets: [{ row: fromY, col: fromX }, { row: toY, col: toX }] });
                        }
                    }
                } else if (move.type === "capture") {
                    const targets: { row: number, col: number }[] = [];
                    for (const cell of move.where!.split(",")) {
                        const [x, y] = this.algebraic2coords(cell);
                        targets.push({ row: y, col: x });
                    }
                    // @ts-ignore
                    rep.annotations.push({ type: "exit", targets });
                }
            }
        }
        if (this.arrows.size > 0) {
            for (const [cell, dir] of this.arrows) {
                const [x, y] = this.algebraic2coords(cell);
                const points = [];
                points.push({ row: y, col: x });
                // @ts-ignore
                rep.annotations.push({ type: "glyph", glyph: `arrow-${dir}`, targets: points });
            }
        }
        return rep;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "move":
                if (r.what === "dragon") {
                    if (r.how === "jump") {
                        node.push(i18next.t("apresults:MOVE.anache_dragon_jump", { player, from: r.from, to: r.to }));
                    } else {
                        node.push(i18next.t("apresults:MOVE.anache_dragon", { player, from: r.from, dir: r.how, count: r.count }));
                    }
                } else if (r.what === "knight") {
                    node.push(i18next.t("apresults:MOVE.anache_knight", { player, from: r.from, dir: r.how, count: r.count }));
                } else if (r.what === "man") {
                    node.push(i18next.t("apresults:MOVE.anache_man", { player, from: r.from, dir: r.how, count: r.count }));
                }
                resolved = true;
                break;
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.noperson.nowhere", { player, count: r.count }));
                resolved = true;
                break;
            case "eog":
                if (r.reason === "breakthrough") {
                    node.push(i18next.t("apresults:EOG.default"));
                } else if (r.reason === "stalemate") {
                    node.push(i18next.t("apresults:EOG.stalemate"));
                }
                resolved = true;
                break;
        }
        return resolved;
    }

    public getPlayerPieces(player: number): number {
        return [...this.board.values()].filter(x => x === player).length;
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.PIECESREMAINING"), scores: [this.getPlayerPieces(1), this.getPlayerPieces(2)] }
        ]
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Pieces On Board:**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            status += `Player ${n}: ${this.getPlayerPieces(n)}\n\n`;
        }

        return status;
    }

    public clone(): AnacheGame {
        return new AnacheGame(this.serialize());
    }
}
