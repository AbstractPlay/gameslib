/* eslint-disable no-console */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";

type playerid = 1 | 2;

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    pieceCount: [number, number];
    connPath: string[];
    lastmove?: string;
}

export interface IMargoState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class MargoGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Margo",
        uid: "margo",
        playercounts: [2],
        version: "20240421",
        dateAdded: "2024-04-30",
        // i18next.t("apgames:descriptions.margo")
        description: "apgames:descriptions.margo",
        urls: [
            "http://cambolbro.com/games/margo",
            "https://boardgamegeek.com/boardgame/24923/margo"
        ],
        people: [
            {
                type: "designer",
                name: "Cameron Browne",
                urls: ["http://cambolbro.com/"]
            },
        ],
        variants: [
            { uid: "size-4", group: "board" },
            { uid: "size-6", group: "board" },
            { uid: "size-9", group: "board" },
        ],
        categories: ["goal>score>eog", "mechanic>place", "mechanic>capture", "mechanic>enclose", "board>shape>rect", "board>connect>rect", "components>simple"],
        flags: ["pie", "scores", "rotate90"],
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

    private algebraicToPosition(cell: string): [number, number] {
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
        return `${layer + 1}${this.coords2algebraic(x, y)}`;
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
    public connPath: string[] = [];
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private boardSize = 0;
    public pieceCount: [number, number] = [0, 0];
    private hideLayer: number|undefined;
    // private dots: string[] = [];

    constructor(state?: IMargoState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: MargoGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                pieceCount: [0, 0],
                connPath: [],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IMargoState;
            }
            if (state.game !== MargoGame.gameinfo.uid) {
                throw new Error(`The Margo game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): MargoGame {
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
        this.pieceCount = [...state.pieceCount];
        this.connPath = [...state.connPath];
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
        return 7;
    }

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }
        const moves: string[] = [];
        for (let i = 0; i < 2 * this.boardSize - 1; i++) {
            for (let j = 0; j < 2 * this.boardSize - 1; j++) {
                const cell = this.placeableCell(i, j);
                if (cell !== undefined) {
                    if (this.isSelfCapture(cell, player)) { continue; }
                    if (this.checkKo(cell, player)) { continue; }
                    moves.push(cell);
                }
            }
        }
        return moves;
    }

    private hasMoves(player?: playerid): boolean {
        // Short-circuited version of above.
        if (player === undefined) {
            player = this.currplayer;
        }
        for (let i = 0; i < 2 * this.boardSize - 1; i++) {
            for (let j = 0; j < 2 * this.boardSize - 1; j++) {
                const cell = this.placeableCell(i, j);
                if (cell !== undefined) {
                    if (this.isSelfCapture(cell, player)) { continue; }
                    if (this.checkKo(cell, player)) { continue; }
                    return true;
                }
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
                } else if (n < 2) {
                    this.hideLayer = 2;
                } else {
                    this.hideLayer = n;
                }
            } else {
                const cell = this.placeableCell(col, row);
                if (cell === undefined) {
                    return {
                        move,
                        valid: false,
                        message: i18next.t("apgames:validation.margo.CANNOT_PLACE", { where: this.coords2algebraic(col, row) })
                    };
                }
                newmove = cell;
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
            result.message = i18next.t("apgames:validation.margo.INITIAL_INSTRUCTIONS");
            return result;
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        // valid cell
        try {
            const [x, y] = this.algebraic2coords(m);
            if (x < 0 || x >= 2 * this.boardSize - 1 || y < 0 || y >= 2 * this.boardSize - 1) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: m });
                return result;
            }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: m });
            return result;
        }
        if (this.board.has(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", { where: m });
            return result;
        }
        if (!this.moves().includes(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.margo.CANNOT_PLACE", { where: m });
            return result;
        }
        if (this.isSelfCapture(m, this.currplayer)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.margo.SELF_CAPTURE", { where: m });
            return result;
        }
        if (this.checkKo(m, this.currplayer)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.margo.KO");
            return result;
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    protected orthNeighboursLayer1(cell: string): string[] {
        // Get all orthogonal neighbours of a cell.
        const [col, row, layer] = this.algebraic2coords2(cell);
        if (layer > 0) { return []; }
        const neighbours: string[] = [];
        if (col > 1) { neighbours.push(this.coords2algebraic2(col - 2, row, 0)); }
        if (col < 2 * this.boardSize - 2) { neighbours.push(this.coords2algebraic2(col + 2, row, 0)); }
        if (row > 1) { neighbours.push(this.coords2algebraic2(col, row - 2, 0)); }
        if (row < 2 * this.boardSize - 2) { neighbours.push(this.coords2algebraic2(col, row + 2, 0)); }
        return neighbours;
    }

    private getTopMostCell(x: number, y: number): string | undefined {
        // Get the top-most ball at a coordinate.
        // If there is no ball at that coordinate, return undefined.
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

    private getPresentNeighbours(cell: string, player: playerid): string[] {
        // Get neighbours for a `cell` that are already present for `player`.
        // If `from` is provided, we assume that balls are dropped.
        const neighbours: string[] = [];
        const [col, row, layer] = this.algebraic2coords2(cell);
        if (col > 0) {
            if (row > 0) {
                const topMost = this.getTopMostCell(col - 1, row - 1);
                if (topMost !== undefined && this.board.get(topMost) === player) { neighbours.push(topMost); }
            }
            if (row < 2 * this.boardSize - layer - 1) {
                const topMost = this.getTopMostCell(col - 1, row + 1);
                if (topMost !== undefined && this.board.get(topMost) === player) { neighbours.push(topMost); }
            }
        }
        if (col < 2 * this.boardSize - layer - 1) {
            if (row > 0) {
                const topMost = this.getTopMostCell(col + 1, row - 1);
                if (topMost !== undefined && this.board.get(topMost) === player) { neighbours.push(topMost); }
            }
            if (row < 2 * this.boardSize - layer - 1) {
                const topMost = this.getTopMostCell(col + 1, row + 1);
                if (topMost !== undefined && this.board.get(topMost) === player) { neighbours.push(topMost); }
            }
        }
        const otherPlayer = player % 2 + 1 as playerid;
        if (col > layer + 1) {
            const topLeft = this.coords2algebraic2(col - 1, row + 1, layer + 1);
            const bottomLeft = this.coords2algebraic2(col - 1, row - 1, layer + 1);
            if (this.board.get(topLeft) !== otherPlayer || this.board.get(bottomLeft) !== otherPlayer) {
                const left = this.coords2algebraic2(col - 2, row, layer);
                if (this.board.has(left) && this.board.get(left) === player) { neighbours.push(left); }
            }
        }
        if (col < 2 * this.boardSize - layer - 2) {
            const topRight = this.coords2algebraic2(col + 1, row + 1, layer + 1);
            const bottomRight = this.coords2algebraic2(col + 1, row - 1, layer + 1);
            if (this.board.get(topRight) !== otherPlayer || this.board.get(bottomRight) !== otherPlayer) {
                const right = this.coords2algebraic2(col + 2, row, layer);
                if (this.board.has(right) && this.board.get(right) === player) { neighbours.push(right); }
            }
        }
        if (row > layer + 1) {
            const leftTop = this.coords2algebraic2(col - 1, row - 1, layer + 1);
            const rightTop = this.coords2algebraic2(col + 1, row - 1, layer + 1);
            if (this.board.get(leftTop) !== otherPlayer || this.board.get(rightTop) !== otherPlayer) {
                const top = this.coords2algebraic2(col, row - 2, layer);
                if (this.board.has(top) && this.board.get(top) === player) { neighbours.push(top); }
            }
        }
        if (row < 2 * this.boardSize - layer - 2) {
            const leftBottom = this.coords2algebraic2(col - 1, row + 1, layer + 1);
            const rightBottom = this.coords2algebraic2(col + 1, row + 1, layer + 1);
            if (this.board.get(leftBottom) !== otherPlayer || this.board.get(rightBottom) !== otherPlayer) {
                const bottom = this.coords2algebraic2(col, row + 2, layer);
                if (this.board.has(bottom) && this.board.get(bottom) === player) { neighbours.push(bottom); }
            }
        }
        return neighbours;
    }

    private getGroupLiberties(cell: string, opponentPlaced: string[], player: playerid): [Set<string>, number] {
        // Get all groups associated with `cell` and the liberties of the group.
        // The `cell` does not need to be placed on the `board`. We assume that it's already there.
        const seen: Set<string> = new Set();
        const liberties = new Set<string>();
        const todo: string[] = [cell]
        while (todo.length > 0) {
            const cell1 = todo.pop()!;
            if (seen.has(cell1)) { continue; }
            seen.add(cell1);
            for (const n of this.orthNeighboursLayer1(cell1)) {
                if (this.board.has(n) || opponentPlaced.includes(n) || n === cell) { continue; }
                liberties.add(n);
            }
            this.getPresentNeighbours(cell1, player).forEach(n => todo.push(n));
        }
        return [seen, liberties.size];
    }

    private isZombie(cell: string, player: playerid): boolean {
        // Check if there is an opponent's ball on top of `cell` recursively.
        const [col, row, layer] = this.algebraic2coords2(cell);
        const directions = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
        for (const direction of directions) {
            const [x, y, l] = [col + direction[0], row + direction[1], layer + 1];
            if (x < 0 || y < 0 || x >= 2 * this.boardSize - l || y >= 2 * this.boardSize - l) { continue; }
            const above = this.coords2algebraic2(x, y, l);
            if (this.board.has(above)) {
                if (this.board.get(above) !== player) { return true; }
                const nextZombie = this.isZombie(above, player);
                if (nextZombie) { return true; }
            }
        }
        return false;
    }

    private getCaptures(place: string, player: playerid): Set<string>[] {
        // Get all captured cells if `place` is placed on the board.
        // `place` can either be a ball that is already placed on the board or a ball that is to be placed.
        const allCaptures: Set<string>[] = []
        const otherPlayer = player % 2 + 1 as playerid;
        const toCheck = this.algebraic2coords2(place)[2] === 0 ? this.orthNeighboursLayer1(place) : this.getBelow([new Set([place])], player % 2 + 1 as playerid);
        for (const n of toCheck) {
            if (allCaptures.some(x => x.has(n)) || !this.board.has(n) || this.board.get(n) === player) { continue; }
            const [group, liberties] = this.getGroupLiberties(n, [place], otherPlayer);
            if (liberties === 0) {
                const captures = new Set<string>();
                for (const c of group) {
                    captures.add(c);
                }
                allCaptures.push(captures);
            }
        }
        allCaptures.forEach(captures => {
            captures.forEach(c => {
                if (this.isZombie(c, otherPlayer)) { captures.delete(c); }
            });
        });
        return allCaptures.filter(captures => captures.size > 0);
    }

    private getCapturesExisting(cells: string[], player: playerid): Set<string>[] {
        // Get balls that are in the same groups in one of the cell in `cells` that have no more liberties.
        // This is called in a loop in the `move` method to sequentially get balls that are to be removed
        // due to removal of balls zombifying them from above.
        const allCaptures: Set<string>[] = [];
        const checked = [...cells];
        while (checked.length > 0) {
            const cell = checked.pop()!;
            if (allCaptures.some(x => x.has(cell))) { continue; }
            const [group, liberties] = this.getGroupLiberties(cell, checked, player);
            if (liberties === 0) {
                const captures = new Set<string>();
                for (const c of group) {
                    captures.add(c);
                }
                allCaptures.push(captures);
            }
        }
        allCaptures.forEach(captures => {
            captures.forEach(c => {
                if (this.isZombie(c, player)) { captures.delete(c); }
            });
        });
        return allCaptures.filter(captures => captures.size > 0);
    }

    private getBelow(groups: Set<string>[], player: playerid): Set<string> {
        // When a capture is made and stones are removed, it may result in more captures.
        // This method is used to get all balls that are directly below any captured ball.
        // `player` is the player's balls to check for that are below the groups.
        const ballsBelow = new Set<string>();
        for (const group of groups) {
            for (const ball of group) {
                const [col, row, layer] = this.algebraic2coords2(ball);
                if (layer > 0) {
                    for (const [c, r] of [[col - 1, row + 1], [col + 1, row + 1], [col - 1, row - 1], [col + 1, row - 1]]) {
                        const cell = this.coords2algebraic2(c, r, layer - 1);
                        if (this.board.get(cell) === player) { ballsBelow.add(cell); }
                    }
                }
            }
        }
        return ballsBelow;
    }

    private isSelfCapture(place: string, player: playerid): boolean {
        // Check if placing `place` would result in a self-capture.
        // This does not check for revealed captures, but I am not yet able to
        // construct situations where it may make a difference.
        // Revealed captures in itself is supposed to be rare, so perhaps it won't happen
        // even if such a construction is possible.
        const allCaptures = this.getCaptures(place, player);
        if (allCaptures.length === 0) {
            return this.getGroupLiberties(place, [], player)[1] === 0;
        }
        for (const captures of allCaptures) {
            for (const capture of captures) { this.board.delete(capture); }
        }
        const groupLiberties = this.getGroupLiberties(place, [], player)[1];
        for (const captures of allCaptures) {
            for (const capture of captures) { this.board.set(capture, player % 2 + 1 as playerid); }
        }
        return groupLiberties === 0;
    }

    private checkKo(place: string, player: playerid): boolean {
        // Check if the move is a ko.
        if (this.stack.length < 2) { return false; }
        const captures = this.getCaptures(place, player);
        if (captures.length !== 1) { return false; }
        if (captures[0].size !== 1) { return false; }
        const previous = this.stack[this.stack.length - 1];
        const previousMove = previous.lastmove!;
        if (!captures.some(x => x.has(previousMove))) { return false; }
        const previousCaptures = previous._results.filter(r => r.type === "capture")
        if (previousCaptures.length !== 1) { return false; }
        return (previousCaptures[0] as Extract<APMoveResult, { type: 'capture' }>).count! === 1;
    }

    public move(m: string, {partial = false, trusted = false} = {}): MargoGame {
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
        this.results.push({ type: "place", where: m });
        this.board.set(m, this.currplayer);
        const firstCaptures = this.getCaptures(m, this.currplayer);
        if (firstCaptures.length > 0) {
            for (const captures of firstCaptures) {
                for (const capture of captures) { this.board.delete(capture); }
                this.results.push({ type: "capture", where: [...captures].join(), count: captures.size });
            }
        }
        let checkPlayer = this.currplayer;
        while (true) {
            // For "revealed captures" edge case where a capture results in
            // more captures as zombies are no longer zombies.
            const belowCells = this.getBelow(firstCaptures, checkPlayer);
            if (belowCells.size === 0) { break; }
            const chainCaptures = this.getCapturesExisting([...belowCells], checkPlayer);
            if (chainCaptures.length === 0) { break; }
            for (const captures of chainCaptures) {
                for (const capture of captures) { this.board.delete(capture); }
                this.results.push({ type: "capture", where: [...captures].join(), count: captures.size });
            }
            checkPlayer = checkPlayer % 2 + 1 as playerid;
        }
        this.pieceCount[0] = [...this.board.values()].filter(x => x === 1).length;
        this.pieceCount[1] = [...this.board.values()].filter(x => x === 2).length;

        if (partial) { return this; }
        this.hideLayer = undefined;
        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): MargoGame {
        if (!this.hasMoves()) {
            this.gameover = true;
            const p1Score = this.getPlayerScore(1);
            const p2Score = this.getPlayerScore(2);
            this.winner = p1Score > p2Score ? [1] : p1Score < p2Score ? [2] : [1, 2];
        }
        if (!this.gameover) {
            const count = this.stateCount();
            if (count >= 1) {
                this.gameover = true;
                this.winner = [this.currplayer];
            }
        }
        if (this.gameover) {
            this.results.push({ type: "eog" });
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public state(): IMargoState {
        return {
            game: MargoGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: MargoGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            pieceCount: [...this.pieceCount],
            connPath: [...this.connPath],
        };
    }

    public render(): APRenderRep {
        // calculate maximum layer (0 indexed)
        const maxLayer = Math.max(0, ...[...this.board.keys()].map(cell => this.algebraic2coords2(cell)).map(([,,l]) => l));
        // Build piece string
        let pstr = "";
        for (let layer = 0; layer <= maxLayer; layer++) {
            for (let row = 0; row < this.boardSize - layer; row++) {
                if (pstr.length > 0) {
                    pstr += "\n";
                }
                for (let col = 0; col < this.boardSize - layer; col++) {
                    const cell = this.layerCoords2algebraic(col, row, layer);
                    if (this.board.has(cell)) {
                        const contents = this.board.get(cell);
                        if (contents === 1) {
                            if (this.hideLayer !== undefined && this.hideLayer <= layer) {
                                pstr += "Y";
                            } else {
                                pstr += "A";
                            }
                        } else if (contents === 2) {
                            if (this.hideLayer !== undefined && this.hideLayer <= layer) {
                                pstr += "Z";
                            } else {
                                pstr += "B";
                            }
                        }
                    } else {
                        pstr += "-";
                    }
                }
            }
        }
        pstr = pstr.replace(new RegExp(`-{${this.boardSize}}`, "g"), "_");

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-stacked",
                width: this.boardSize,
                height: this.boardSize,
            },
            legend: {
                A: { name: "orb", player: 1, scale: 1.15 },
                B: { name: "orb", player: 2, scale: 1.15 },
                Y: { name: "circle", player: 1, scale: 1.15, opacity: 0.5 },
                Z: { name: "circle", player: 2, scale: 1.15, opacity: 0.5 },
            },
            pieces: pstr,
        };

        // @ts-ignore
        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.algebraicToPosition(move.where!);
                    rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                } else if (move.type === "capture") {
                    for (const cell of move.where!.split(",")) {
                        const [x, y] = this.algebraicToPosition(cell);
                        rep.annotations.push({ type: "exit", targets: [{ row: y, col: x }] });
                    }
                }
            }
            if (this.connPath.length > 0) {
                type RowCol = {row: number; col: number;};
                const targets: RowCol[] = [];
                for (const cell of this.connPath) {
                    const [x, y] = this.algebraicToPosition(cell);
                    targets.push({row: y, col: x})
                }
                // @ts-ignore
                rep.annotations.push({type: "move", targets, arrow: false});
            }
        }

        if (maxLayer >= 2) {
            rep.areas = [
                {
                    type: "scrollBar",
                    position: "left",
                    min: 2,
                    max: maxLayer + 1,
                    current: this.hideLayer !== undefined ? this.hideLayer : maxLayer + 1,
                }
            ];
        }

        return rep;
    }

    public getPlayerScore(player: playerid): number {
        return this.pieceCount[player - 1];
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] },
        ]
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Pieces**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const score = this.getPlayerScore(n as playerid);
            status += `Player ${n}: ${score}\n\n`;
        }

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.ball", { player, where: r.where }));
                resolved = true;
                break;
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.noperson.group_nowhere", { player, count: r.count }));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): MargoGame {
        return new MargoGame(this.serialize());
    }
}
