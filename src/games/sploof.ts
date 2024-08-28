import { GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, Glyph } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";

type playerid = 1 | 2 | 3;
const takeSymbol = "*";

interface ILegendObj {
    [key: string]: Glyph|[Glyph, ...Glyph[]];
}

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    hands: [number, number];
    stash: [number, number];
    lastmove?: string;
    winningLines: string[][];
}

export interface ISploofState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class SploofGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Sploof",
        uid: "sploof",
        playercounts: [2],
        version: "20240602",
        dateAdded: "2024-06-08",
        // i18next.t("apgames:descriptions.sploof")
        description: "apgames:descriptions.sploof",
        urls: ["https://boardgamegeek.com/boardgame/114188/sploof"],
        people: [
            {
                type: "designer",
                name: "Matt Green (I)",
                urls: ["https://boardgamegeek.com/boardgamedesigner/56134/matt-green-i"],
            }
        ],
        variants: [
            { uid: "size-5", group: "board" },
        ],
        categories: ["goal>align", "mechanic>place", "board>shape>rect", "board>connect>rect", "components>simple>3c", "components>shibumi", "board>3d"],
        flags: ["limited-pieces"],
        displays: [{ uid: "orb-3d" }],
    };

    public coords2algebraic(x: number, y: number, boardSize = this.boardSize): string {
        return GameBase.coords2algebraic(x, y, 2 * boardSize - 1);
    }

    public algebraic2coords(cell: string, boardSize = this.boardSize): [number, number] {
        // Remove all numbers from the beginning of the string.
        return GameBase.algebraic2coords(cell.replace(/^\d+/, ""), 2 * boardSize - 1);
    }

    private layerCoords2algebraic(col: number, row: number, layer: number, boardSize = this.boardSize): string {
        // Convert layer coordinates to algebraic.
        // This is the "intuitive" coordinates where sequence of col or row indices are adjacent.
        // Bottom layer is 0, top layer is boardSize - 1.
        // Origin is at the top left corner of the board as usual.
        if (layer >= boardSize) { throw new Error(`Layer index ${layer} is out of bounds for board size ${boardSize}`); }
        if (col < 0 || row < 0 || col > boardSize - layer || row > boardSize - layer) { throw new Error(`Coordinates (${col},${row}) are out of bounds for layer ${layer}`); }
        const l = layer + 1;
        const x = 2 * col + layer;
        const y = 2 * row + layer;
        return `${l}${this.coords2algebraic(x, y, boardSize)}`;
    }

    private algebraic2position(cell: string): [number, number] {
        // Convert algebraic coordinates to position on the board for annotations.
        const [x, y, l] = this.algebraic2coords2(cell);
        let row = (y - l) / 2;
        for (let i = 0; i < l; i++) {
            row += this.boardSize - i;
        }
        return [(x - l) / 2, row];
    }

    private coords2algebraic2(x: number, y: number, layer: number): string {
        // The same as coords2algebraic, but with concatenated layer index.
        try {
            return `${layer + 1}${this.coords2algebraic(x, y)}`;
        } catch {
            return "";
        }
    }

    private algebraic2coords2(cell: string): [number, number, number] {
        // The same as algebraic2coords, but also return the layer.
        const [l, coords] = cell.split(/(?<=^\d)/);
        const layer = parseInt(l, 10) - 1;
        const [x, y] = this.algebraic2coords(coords);
        return [x, y, layer];
    }

    private placeableCell(i: number, j: number): string | undefined {
        // Get the highest supported layer for a cell.
        // If that cell is not placeable, return undefined.
        if (i % 2 !== j % 2) { return undefined; }
        let layer = i % 2 ? 1 : 0;
        while (layer < this.boardSize) {
            const cell = `${layer + 1}${this.coords2algebraic(i, j)}`
            if (this.board.has(cell)) {
                layer += 2;
                continue;
            }
            if (layer > 0) {
                if (i < layer || j < layer || i >= 2 * this.boardSize - layer || j >= 2 * this.boardSize - layer) { return undefined; }
                // Check the four cells below the currentone.
                if (!this.board.has(this.coords2algebraic2(i - 1, j - 1, layer - 1))) { return undefined; }
                if (!this.board.has(this.coords2algebraic2(i - 1, j + 1, layer - 1))) { return undefined; }
                if (!this.board.has(this.coords2algebraic2(i + 1, j - 1, layer - 1))) { return undefined; }
                if (!this.board.has(this.coords2algebraic2(i + 1, j + 1, layer - 1))) { return undefined; }
            }
            return cell;
        }
        return undefined;
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, playerid>;
    public winningLines: string[][] = [];
    public hands!: [number, number];
    public stash!: [number, number];
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private boardSize = 0;
    private hideLayer: number|undefined;

    constructor(state?: ISploofState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            this.boardSize = this.getBoardSize();
            const board = this.initBoard();
            const hands = this.initHands();
            const stash = this.initStash();
            const fresh: IMoveState = {
                _version: SploofGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                hands,
                stash,
                winningLines: [],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ISploofState;
            }
            if (state.game !== SploofGame.gameinfo.uid) {
                throw new Error(`The UpperHanSploof process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
            this.boardSize = this.getBoardSize();
        }
        this.load();
    }

    public load(idx = -1): SploofGame {
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
        this.winningLines  = state.winningLines.map(a => [...a]);
        this.hands = [...state.hands];
        this.stash = [...state.stash];
        this.lastmove = state.lastmove;
        this.boardSize = this.getBoardSize();
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

    private initBoard(): Map<string, playerid> {
        // Get the initial board.
        if (this.boardSize === 5) {
            return new Map([
                ["1a9", 3], ["1c9", 3], ["1e9", 3], ["1g9", 3], ["1i9", 3],
                ["1a7", 3], ["1c7", 3], ["1e7", 3], ["1g7", 3], ["1i7", 3],
                ["1a5", 3], ["1c5", 3], ["1e5", 3], ["1g5", 3], ["1i5", 3],
                ["1a3", 3], ["1c3", 3], ["1e3", 3], ["1g3", 3], ["1i3", 3],
                ["1a1", 3], ["1c1", 3], ["1e1", 3], ["1g1", 3], ["1i1", 3],
            ]);
        }
        return new Map([
            ["1a7", 3], ["1c7", 3], ["1e7", 3], ["1g7", 3],
            ["1a5", 3],                         ["1g5", 3],
            ["1a3", 3],                         ["1g3", 3],
            ["1a1", 3], ["1c1", 3], ["1e1", 3], ["1g1", 3],
        ]);
    }

    private initHands(): [number, number] {
        // Get the initial hand counts for each player.
        return [2, 2];
    }

    private initStash(): [number, number] {
        // Get the initial piece counts for each player.
        if (this.boardSize === 5) {
            // There are 55 positions on a 5x5 board, so ceil(55 / 2) - 2 = 26 each.
            return [26, 26];
        }
        return [14, 14];
    }

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }
        const moves: string[] = [];
        if (this.hands[player - 1] > 0) {
            for (let i = 0; i < 2 * this.boardSize - 1; i++) {
                for (let j = 0; j < 2 * this.boardSize - 1; j++) {
                    const cell = this.placeableCell(i, j);
                    if (cell !== undefined) {
                        moves.push(cell);
                    }
                }
            }
        }
        if (this.stash[player - 1] > 0) {
            for (const take of this.takeable()) {
                moves.push(takeSymbol + take);
            }
        }
        return moves;
    }

    private hasMoves(player?: playerid): boolean {
        // Same as moves, but short circuited.
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.hands[player - 1] > 0) {
            for (let i = 0; i < 2 * this.boardSize - 1; i++) {
                for (let j = 0; j < 2 * this.boardSize - 1; j++) {
                    const cell = this.placeableCell(i, j);
                    if (cell !== undefined) {
                        return true;
                    }
                }
            }
        }
        if (this.stash[player - 1] > 0 && this.takeable().length > 0) {
            return true;
        }
        return false;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    private getTopMostCell(x: number, y: number): string | undefined {
        // Get the top-most ball at a coordinate.
        // If there is no ball at that coordinate, return undefined.
        if (x % 2 !== y % 2) { return undefined; }
        let layer = x % 2 ? 1 : 0;
        let cell = this.coords2algebraic2(x, y, layer);
        while (layer < this.boardSize) {
            if (x < layer || y < layer || x >= 2 * this.boardSize - layer || y >= 2 * this.boardSize - layer) { return undefined; }
            layer += 2;
            const nextCell = this.coords2algebraic2(x, y, layer);
            if (this.board.has(nextCell)) {
                cell = nextCell;
                continue;
            }
            return cell;
        }
        return undefined;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const topMostCell = this.getTopMostCell(col, row);
            let newmove = move;
            if (row === -1 && col === -1) {
                if (piece === undefined) {
                    throw new Error(`A click was registered off the board, but no 'piece' parameter was passed.`);
                }
                if (! piece.startsWith("scroll_newval_")) {
                    throw new Error(`An invalid scroll bar value was returned: ${piece}`);
                }
                // calculate maximum layer (0 indexed)
                const maxLayer = Math.max(0, ...[...this.board.keys()].map(cell => this.algebraic2coords2(cell)).map(([,,l]) => l));
                const [,,nstr] = piece.split("_");
                const n = parseInt(nstr, 10);
                if (isNaN(n)) {
                    throw new Error(`Could not parse '${nstr}' into an integer.`);
                }
                if (n > maxLayer) {
                    this.hideLayer = undefined;
                } else if (n < 1) {
                    this.hideLayer = 1;
                } else {
                    this.hideLayer = n;
                }
            } else {
                if (move === "" && topMostCell !== undefined && this.board.get(topMostCell) === 3 && this.ballsAboveCount(topMostCell) < 4) {
                    newmove = takeSymbol + topMostCell;
                } else {
                    const cell = this.placeableCell(col, row);
                    if (cell === undefined) {
                        return {
                            move,
                            valid: false,
                            message: i18next.t("apgames:validation.akron.CANNOT_PLACE", { where: this.coords2algebraic(col, row) })
                        };
                    }
                    newmove += cell;
                }
            }
            const result = this.validateMove(newmove) as IClickResult;
            if (!result.valid) {
                result.move = "";
            } else {
                result.move = newmove;
            }
            result.opts = {hideLayer: this.hideLayer};
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
            result.message = i18next.t("apgames:validation.sploof.INITIAL_INSTRUCTIONS");
            return result;
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const isTake = m.startsWith(takeSymbol);
        const where = isTake ? m.slice(1) : m;
        // valid cell
        try {
            const [x, y] = this.algebraic2coords(where);
            if (x < 0 || x >= 2 * this.boardSize - 1 || y < 0 || y >= 2 * this.boardSize - 1) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: where });
                return result;
            }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: where });
            return result;
        }
        if (isTake) {
            if (this.stash[this.currplayer - 1] <= 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.sploof.NO_BALLS_STASH");
                return result;
            }
            if (!this.board.has(where)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.sploof.UNOCCUPIED", { where });
                return result;
            }
            if (this.board.get(where) !== 3) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.sploof.NOT_NEUTRAL", { where });
                return result;
            }
            if (this.ballsAboveCount(where) > 1) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.sploof.PINNED", { where });
                return result;
            }
        } else {
            if (this.hands[this.currplayer - 1] <= 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.sploof.NO_BALLS_HAND");
                return result;
            }
            if (this.board.has(where)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", { where });
                return result;
            }
            const [x, y] = this.algebraic2coords2(where);
            if (where !== this.placeableCell(x, y)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.sploof.CANNOT_PLACE", { where });
                return result;
            }
        }

        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private takeable(): string[] {
        // Look for all neutral balls that can be taken.
        const notPinned: string[] = [];
        const balls = [...this.board.keys()].filter(cell => this.board.get(cell) === 3);
        for (const ball of balls) {
            if (this.ballsAboveCount(ball) <= 1) {
                notPinned.push(ball);
            }
        }
        return notPinned;
    }

    private ballsAboveCount(cell: string): number {
        // Count the number of balls that are directly above a cell.
        let count = 0;
        const [x, y, l] = this.algebraic2coords2(cell);
        if (x > l + 1) {
            if (y > l) { if (this.board.has(this.coords2algebraic2(x - 1, y - 1, l + 1))) { count++; } }
            if (y < 2 * this.boardSize - l - 2) { if (this.board.has(this.coords2algebraic2(x - 1, y + 1, l + 1))) { count++; } }
        }
        if (x < 2 * this.boardSize - l - 2) {
            if (y > l + 1) { if (this.board.has(this.coords2algebraic2(x + 1, y - 1, l + 1))) { count++; } }
            if (y < 2 * this.boardSize - l - 2) { if (this.board.has(this.coords2algebraic2(x + 1, y + 1, l + 1))) { count++; } }
        }
        return count;
    }

    private dropBalls(from: string): string[] {
        // Upon movement, drop balls that are not supported.
        // Return the highest cell that was dropped if there was a drop.
        // Assumes that there is only one ball above the `from` cell.
        const [x, y, layer] = this.algebraic2coords2(from);
        const direction = this.board.has(this.coords2algebraic2(x - 1, y - 1, layer + 1))
            ? [-1, -1]
            : this.board.has(this.coords2algebraic2(x - 1, y + 1, layer + 1))
            ? [-1, 1]
            : this.board.has(this.coords2algebraic2(x + 1, y - 1, layer + 1))
            ? [1, -1]
            : this.board.has(this.coords2algebraic2(x + 1, y + 1, layer + 1))
            ? [1, 1]
            : undefined;
        if (direction === undefined) { return []; }
        let i = 1
        const drops: string[] = [];
        while (true) {
            const above = this.coords2algebraic2(x + i * direction[0], y + i * direction[1], layer + i);
            if (!this.board.has(above)) { break; }
            drops.push(above);
            i++;
        }
        return drops;
    }

    private getDropMap(from: string, player?: playerid): [string[], playerid[]] | undefined {
        // Return the information needed to perform the transformation of `board` for drops.
        const drops = this.dropBalls(from);
        if (drops.length === 0) { return undefined; }
        if (player === undefined) { player = this.currplayer; }
        const dropPlayers = drops.map(d => this.board.get(d)!);
        drops.unshift(from);
        dropPlayers.unshift(player);
        return [drops, dropPlayers];
    }

    private applyDrop(dropMap: [string[], playerid[]]): void {
        // Apply the drop transformation to the board.
        const [drops, dropPlayers] = dropMap;
        for (let i = 0; i < drops.length - 1; i++) {
            this.board.delete(drops[i + 1]);
            this.board.set(drops[i], dropPlayers[i + 1]);
        }
    }

    public move(m: string, {partial = false, trusted = false} = {}): SploofGame {
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
        this.results = [];
        const isTake = m.startsWith(takeSymbol);
        const where = isTake ? m.slice(1) : m;
        if (isTake) {
            this.board.delete(where);
            this.results.push({ type: "take", from: where });
            this.hands[this.currplayer - 1] += 2;
            this.stash[this.currplayer - 1] -= 2;
            const dropMap = this.getDropMap(where, this.currplayer);
            if (dropMap !== undefined) {
                this.applyDrop(dropMap);
                const dropTopMost = dropMap[0][dropMap[0].length - 1];
                this.results.push({ type: "move", from: dropTopMost, to: where, how: "drop", count: dropMap[0].length - 1 });
            }
        } else {
            this.results.push({ type: "place", where: m });
            this.board.set(m, this.currplayer);
            this.hands[this.currplayer - 1]--;
        }
        if (partial) { return this; }
        this.hideLayer = undefined;

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    private checkCut(cell: string, dx: number, dy: number, direction: "vertical" | "horizontal"): boolean {
        // Check if a line is cut in a given direction from a cell.
        // This means that there are two balls on the layer above in that orthogonal direction.
        // If the direction is vertical, we use the sign of dy to determine the direction.
        // Similarly, if the direction is horizontal, we use the sign of dx to determine the direction.
        const [col, row, layer] = this.algebraic2coords2(cell);
        if (direction === "horizontal") {
            if (dx > 0) {
                if (col < 2 * this.boardSize - layer - 1) {
                    const topRight = this.coords2algebraic2(col + 1, row - 1, layer + 1);
                    const bottomRight = this.coords2algebraic2(col + 1, row + 1, layer + 1);
                    return this.board.has(topRight) && this.board.has(bottomRight);
                }
            } else {
                if (col > layer) {
                    const topLeft = this.coords2algebraic2(col - 1, row - 1, layer + 1);
                    const bottomLeft = this.coords2algebraic2(col - 1, row + 1, layer + 1);
                    return this.board.has(topLeft) && this.board.has(bottomLeft);
                }
            }
        } else {
            if (dy > 0) {
                if (row < 2 * this.boardSize - layer - 1) {
                    const rightBottom = this.coords2algebraic2(col + 1, row + 1, layer + 1);
                    const leftBottom = this.coords2algebraic2(col - 1, row + 1, layer + 1);
                    return this.board.has(rightBottom) && this.board.has(leftBottom);
                }
            } else {
                if (row > layer) {
                    const rightTop = this.coords2algebraic2(col + 1, row - 1, layer + 1);
                    const leftTop = this.coords2algebraic2(col - 1, row - 1, layer + 1);
                    return this.board.has(rightTop) && this.board.has(leftTop);
                }
            }
        }
        return false;
    }

    private checkLines(startX: number, startY: number, dx: number, dy: number, checkCuts: "vertical" | "horizontal" | undefined = undefined): string[][] {
        // Check for winning lines in a given direction
        // Returns an array of winning lines, which are arrays of cells that are all occupied by the same player
        // `checkCuts` is used to call `checkCut` because orthogonal lines can be cut by two balls on the layer above.
        // The level has to be the same for an orthogonal line to be considered.
        // If `checkCuts` is undefined, we assume that it is a diagonal line.
        // Honestly, is a monster of a method, but it works... I hope so anyway...
        let currentPlayer: playerid | undefined;
        let currentCounter = 0;
        let cells: string[] = [];
        let currentLevel: undefined | number;
        const winningLines: string[][] = [];
        for (let x = startX, y = startY; x >= 0 && y >= 0 && x < 2 * this.boardSize && y < 2 * this.boardSize; x += dx, y += dy) {
            const cell = this.getTopMostCell(x, y);
            const player = cell !== undefined ? this.board.get(cell) : undefined;
            const level = checkCuts !== undefined && cell !== undefined ? this.algebraic2coords2(cell)[2] : undefined;
            const cut = checkCuts !== undefined && cell !== undefined ? this.checkCut(cell, dx, dy, checkCuts) : false;
            if (player !== undefined && currentPlayer === player && player !== 3 && (currentLevel === undefined || currentLevel === level)) {
                currentCounter++;
                cells.push(cell!);
                if (checkCuts !== undefined) { currentLevel = level; }
            }
            const nextX = x + dx;
            const nextY = y + dy;
            if (player !== currentPlayer || nextX < 0 || nextY < 0 || nextX > 2 * this.boardSize - 2 || nextY > 2 * this.boardSize - 2 || cut || level !== currentLevel) {
                if (currentCounter >= 4) {
                    winningLines.push(cells);
                }
                currentPlayer = player;
                currentCounter = currentPlayer === undefined || currentPlayer === 3 || cut ? 0 : 1;
                currentLevel = checkCuts === undefined || currentPlayer || undefined || currentPlayer === 3 || cut ? undefined : level;
                if (cells.length > 0) { cells = []; }
                if (player !== undefined && player !== 3) { cells.push(cell!); }
            }
        }
        return winningLines;
    }

    protected getWinningLinesMap(): Map<playerid, string[][]> {
        // Get the winning lines for each player.
        const winningLines = new Map<playerid, string[][]>([
            [1, []],
            [2, []],
        ]);
        // Check rows
        for (let j = 0; j < 2 * this.boardSize; j++) {
            const lines = this.checkLines(j % 2 === 0 ? 0 : 1, j, 2, 0, "horizontal");
            for (const line of lines) {
                const player = this.board.get(line[0]);
                winningLines.get(player!)!.push(line);
            }
        }

        // Check columns
        for (let i = 0; i < 2 * this.boardSize; i++) {
            const lines = this.checkLines(i, i % 2 === 0 ? 0 : 1, 0, 2, "vertical");
            for (const line of lines) {
                const player = this.board.get(line[0]);
                winningLines.get(player!)!.push(line);
            }
        }

        // Check diagonals from bottom-left to top-right
        for (let i = 0; i < 2 * this.boardSize; i++) {
            if (i % 2 !== 0) { continue; }
            const lines = this.checkLines(i, 0, -1, 1).concat(this.checkLines(2 * this.boardSize - 1, i + 1, -1, 1));
            for (const line of lines) {
                const player = this.board.get(line[0]);
                winningLines.get(player!)!.push(line);
            }
        }

        // Check diagonals from top-left to bottom-right
        for (let i = 0; i < 2 * this.boardSize; i++) {
            if (i % 2 !== 0) { continue; }
            const lines = this.checkLines(i, 0, 1, 1).concat(this.checkLines(0, i + 1, 1, 1));
            for (const line of lines) {
                const player = this.board.get(line[0]);
                winningLines.get(player!)!.push(line);
            }
        }
        return winningLines;
    }

    protected checkEOG(): SploofGame {
        const winningLinesMap = this.getWinningLinesMap();
        const winner: playerid[] = [];
        this.winningLines = [];
        for (const player of [1, 2] as playerid[]) {
            if (winningLinesMap.get(player)!.length > 0) {
                winner.push(player);
                this.winningLines.push(...winningLinesMap.get(player)!);
            }
        }
        if (winner.length > 0) {
            this.gameover = true;
            this.winner = winner;
            this.results.push({ type: "eog" });
        }
        if (this.winner.length === 0 && !this.hasMoves(this.currplayer)) {
            this.gameover = true;
            this.winner = [this.currplayer % 2 + 1 as playerid];
            this.results.push({ type: "eog", reason: "stalemate" });
        }
        if (this.gameover) {
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public state(): ISploofState {
        return {
            game: SploofGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: SploofGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            hands: [...this.hands],
            stash: [...this.stash],
            winningLines: this.winningLines.map(a => [...a]),
        };
    }

    private getPiece(player: number, layer: number, trans = false, orb3d = false): [Glyph, ...Glyph[]]  {
        // Choose max blackness and whiteness.
        // Returns a combined glyphs based on the player colour for a given layer 1 to boardSize.
        // orb_3d: if true, only return pure orb glyphs, for which some people prefer.
        if (orb3d) {
            if (trans) {
                return [{ name: "circle", colour: player, scale: 1.15, opacity: 0.5 }];
            }
            return [{ name: "orb", colour: player, scale: 1.2 }];
        }
        const layers = this.boardSize;
        if (trans) {
            const minOpacity = 0.2;
            const maxOpacity = 0.6;
            const opacity = (maxOpacity - minOpacity) * (layer - 2) / (layers - 2) + minOpacity;
            return [
                { name: "circle", colour: "#FFF", scale: 1.15, opacity: opacity * 0.75 },
                { name: "circle", colour: player, scale: 1.15, opacity },
            ];
        } else {
            const blackness = 0.1;
            const whiteness = 0.5;
            const scaled = (whiteness + blackness) * (layer - 1) / (layers - 1) - blackness;
            if (scaled === 0) {
                return [
                    { name: "piece-borderless", colour: player, scale: 1.15 },
                    { name: "orb", colour: player, scale: 1.15, opacity: 0.5 },
                    { name: "piece", scale: 1.15, opacity: 0 },
                ];
            } else {
                const colour = scaled < 0 ? "#000" : "#FFF";
                const opacity = scaled < 0 ? 1 + scaled : 1 - scaled;
                return [
                    { name: "piece-borderless", colour, scale: 1.15 },
                    { name: "piece-borderless", colour: player, scale: 1.15, opacity },
                    { name: "orb", colour: player, scale: 1.15, opacity: 0.5 },
                    { name: "piece", scale: 1.15, opacity: 0 },
                ];
            }
        }
    }

    public render(opts?: IRenderOpts): APRenderRep {
        let hideLayer = this.hideLayer;
        if (opts?.hideLayer !== undefined) {
            hideLayer = opts.hideLayer;
        }
        let altDisplay: string | undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }
        let orb3d = false;
        if (altDisplay !== undefined) {
            if (altDisplay === "orb-3d") {
                orb3d = true;
            }
        }
        // calculate maximum layer (0 indexed)
        const maxLayer = Math.max(0, ...[...this.board.keys()].map(cell => this.algebraic2coords2(cell)).map(([,,l]) => l));
        // Build piece string
        let pstr = "";
        const labels: Set<string> = new Set();
        for (let layer = 0; layer <= (hideLayer ?? maxLayer); layer++) {
            for (let row = 0; row < this.boardSize - layer; row++) {
                if (pstr.length > 0) {
                    pstr += "\n";
                }
                let pieces: string[] = [];
                for (let col = 0; col < this.boardSize - layer; col++) {
                    const cell = this.layerCoords2algebraic(col, row, layer);
                    if (this.board.has(cell)) {
                        const contents = this.board.get(cell);
                        let key;
                        if (contents === 1) {
                            if (hideLayer !== undefined && hideLayer <= layer) {
                                key = `X${layer + 1}`;
                            } else {
                                key = `A${layer + 1}`;
                            }
                        } else if (contents === 2) {
                            if (hideLayer !== undefined && hideLayer <= layer) {
                                key = `Y${layer + 1}`;
                            } else {
                                key = `B${layer + 1}`;
                            }
                        } else {
                            if (hideLayer !== undefined && hideLayer <= layer) {
                                key = `Z${layer + 1}`;
                            } else {
                                key = `C${layer + 1}`;
                            }
                        }
                        pieces.push(key);
                        labels.add(key);
                    } else {
                        pieces.push("-");
                    }
                }
                // If all elements are "-", replace with "_"
                if (pieces.every(p => p === "-")) {
                    pieces = ["_"];
                }
                pstr += pieces.join(",");
            }
        }

        const legend: ILegendObj = {};
        for (const label of labels) {
            const piece = label[0];
            const layer = parseInt(label.slice(1), 10);
            const player = piece === "A" || piece === "X" ? 1 : piece === "B" || piece === "Y" ? 2 : 3;
            legend[label] = this.getPiece(player, layer, ["X", "Y", "Z"].includes(piece), orb3d);
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-stacked",
                width: this.boardSize,
                height: this.boardSize,
            },
            legend,
            pieces: pstr,
        };

        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.algebraic2position(move.where!);
                    rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                } else if (move.type === "take") {
                    const [x, y] = this.algebraic2position(move.from);
                    rep.annotations.push({ type: "exit", targets: [{ row: y, col: x }] });
                } else if (move.type === "move") {
                    const [fromX, fromY] = this.algebraic2position(move.from);
                    const [toX, toY] = this.algebraic2position(move.to);
                    if (move.how === "drop") {
                        rep.annotations.push({ type: "move", targets: [{ row: fromY, col: fromX }, { row: toY, col: toX }], style: "dashed" });
                    } else {
                        rep.annotations.push({ type: "move", targets: [{ row: fromY, col: fromX }, { row: toY, col: toX }] });
                    }
                }
            }
            if (this.winningLines.length > 0) {
                for (const connPath of this.winningLines) {
                    if (connPath.length === 1) { continue; }
                    type RowCol = {row: number; col: number;};
                    const targets: RowCol[] = [];
                    for (const cell of connPath) {
                        const [x, y] = this.algebraic2position(cell);
                        targets.push({row: y, col: x})
                    }
                    rep.annotations.push({type: "move", targets: targets as [RowCol, ...RowCol[]], arrow: false});
                }
            }
        }
        rep.areas = [
            {
                type: "scrollBar",
                position: "left",
                min: 0,
                max: maxLayer + 1,
                current: hideLayer !== undefined ? hideLayer : maxLayer + 1,
            }
        ];

        return rep;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.ball", { player, where: r.where }));
                resolved = true;
                break;
            case "take":
                node.push(i18next.t("apresults:TAKE.sploof", { player, from: r.from }));
                resolved = true;
                break;
            case "move":
                if (r.how === "drop") {
                    node.push(i18next.t("apresults:MOVE.ball_drop", { player, from: r.from, to: r.to, count: r.count }));
                } else {
                    node.push(i18next.t("apresults:MOVE.ball", { player, from: r.from, to: r.to }));
                }
                resolved = true;
                break;
            case "eog":
                if (r.reason === "stalemate") {
                    node.push(i18next.t("apresults:EOG.stalemate"));
                } else {
                    node.push(i18next.t("apresults:EOG.default"));
                }
                resolved = true;
                break;
        }
        return resolved;
    }

    public getPlayerPieces(player: number): number {
        return this.hands[player - 1];
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.PIECESINHANDSTASH"), scores: [`${this.hands[0]} / ${this.stash[0]}`, `${this.hands[1]} / ${this.stash[1]}`] }
        ]
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Pieces in hand / stash:**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            status += `Player ${n}: ${this.hands[n - 1]} / ${this.stash[n - 1]}\n\n`;
        }

        return status;
    }

    public clone(): SploofGame {
        return new SploofGame(this.serialize());
    }
}
