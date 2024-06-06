import { GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, Glyph } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { UndirectedGraph } from "graphology";
import { bidirectional } from "graphology-shortest-path";

type playerid = 1 | 2;
type PlayerLines = [string[], string[]];

interface ILooseObj {
    [key: string]: any;
}

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    connPath: string[];
    lastmove?: string;
}

export interface IAkronState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class AkronGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Akron",
        uid: "akron",
        playercounts: [2],
        version: "20240421",
        dateAdded: "2024-04-30",
        // i18next.t("apgames:descriptions.akron")
        description: "apgames:descriptions.akron",
        urls: [
            "http://cambolbro.com/games/akron",
            "https://boardgamegeek.com/boardgame/10889/akron"
        ],
        people: [
            {
                type: "designer",
                name: "Cameron Browne",
                urls: ["http://cambolbro.com/"]
            },
        ],
        variants: [
            { uid: "size-7", group: "board" },
            { uid: "size-11", group: "board" },
        ],
        categories: ["goal>connect", "mechanic>place", "mechanic>move", "board>shape>rect", "board>connect>rect", "components>simple", "board>3d"],
        flags: ["pie", "rotate90", "check"],
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

    private placeableFirstCell(i: number, j: number): string | undefined {
        // Same as placeableCell, but only for the first layer.
        if (i % 2 !== 0 || j % 2 !== 0) { return undefined; }
        const cell = `${1}${this.coords2algebraic(i, j)}`
        if (this.board.has(cell)) { return undefined; }
        return cell;
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
    private dots: string[] = [];
    private lines: [PlayerLines,PlayerLines];
    private hideLayer: number|undefined;

    constructor(state?: IAkronState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: AkronGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                connPath: [],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IAkronState;
            }
            if (state.game !== AkronGame.gameinfo.uid) {
                throw new Error(`The Akron game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
        this.lines = this.getLines();
    }

    public load(idx = -1): AkronGame {
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
        this.connPath = [...state.connPath];
        this.lastmove = state.lastmove;
        this.boardSize = this.getBoardSize();
        return this;
    }

    private getLines(): [PlayerLines,PlayerLines] {
        const lineN: string[] = [];
        const lineS: string[] = [];
        for (let x = 0; x < this.boardSize; x++) {
            const N = this.layerCoords2algebraic(x, 0, 0);
            const S = this.layerCoords2algebraic(x, this.boardSize - 1, 0);
            lineN.push(N);
            lineS.push(S);
        }
        const lineE: string[] = [];
        const lineW: string[] = [];
        for (let y = 0; y < this.boardSize; y++) {
            const E = this.layerCoords2algebraic(this.boardSize - 1, y, 0);
            const W = this.layerCoords2algebraic(0, y, 0);
            lineE.push(E);
            lineW.push(W);
        }
        return [[lineN, lineS], [lineE, lineW]];
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
        return 9;
    }

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }
        const moves: string[] = [];
        const froms: string[] = [];
        for (let i = 0; i < 2 * this.boardSize - 1; i++) {
            for (let j = 0; j < 2 * this.boardSize - 1; j++) {
                if (i % 2 !== j % 2) { continue; }
                const cell = this.placeableFirstCell(i, j);
                if (cell !== undefined) {
                    moves.push(cell);
                } else {
                    const topMostCell = this.getTopMostCell(i, j);
                    if (topMostCell !== undefined && this.board.get(topMostCell) === player && this.canMove(topMostCell)) {
                        froms.push(topMostCell);
                    }
                }
            }
        }
        for (const from of froms) {
            for (const to of this.getTos(from)) {
                moves.push(`${from}-${to}`);
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
                if (move === "" && topMostCell !== undefined && this.canMove(topMostCell)) {
                    newmove = topMostCell + "-";
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

    private canMove(cell: string): boolean {
        // A ball can be moved if it is below one ball or less.
        if (!this.board.has(cell)) { return false; }
        const [x, y, layer] = this.algebraic2coords2(cell);
        let aboveCount = 0;
        if (this.board.has(this.coords2algebraic2(x - 1, y - 1, layer + 1))) { aboveCount += 1; }
        if (this.board.has(this.coords2algebraic2(x - 1, y + 1, layer + 1))) { aboveCount += 1; }
        if (aboveCount > 1) { return false; }
        if (this.board.has(this.coords2algebraic2(x + 1, y - 1, layer + 1))) { aboveCount += 1; }
        if (aboveCount > 1) { return false; }
        if (this.board.has(this.coords2algebraic2(x + 1, y + 1, layer + 1))) { aboveCount += 1; }
        if (aboveCount > 1) { return false; }
        return true;
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.akron.INITIAL_INSTRUCTIONS");
            return result;
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        // valid cell
        const cells = m.split("-");
        let tryCell;
        for (const cell of cells) {
            if (cell === undefined || cell === "") { continue; }
            try {
                tryCell = cell;
                const [x, y] = this.algebraic2coords(cell);
                if (x < 0 || x >= 2 * this.boardSize - 1 || y < 0 || y >= 2 * this.boardSize - 1) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: tryCell});
                    return result;
                }
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: tryCell});
                return result;
            }
        }
        if (m.includes("-")) {
            const [from, to] = cells;
            if (!this.canMove(from)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.akron.CANNOT_MOVE", {where: from});
                return result;
            }
            if (!this.board.has(from)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: from});
                return result;
            }
            if (this.board.get(from) !== this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.UNCONTROLLED", {where: from});
                return result;
            }
            const tos = this.getTos(from);
            if (tos.length === 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.akron.NO_TOS", {where: from});
                return result;
            }
            if (to === undefined || to === "") {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.akron.MOVE_TO");
                return result;
            }
            if (from === to) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.SAME_FROM_TO");
                return result;
            }
            if (!tos.includes(to)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.akron.INVALID_TO", {from, to});
                return result;
            }
        } else {
            if (this.board.has(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: m});
                return result;
            }
            const [x, y, l] = this.algebraic2coords2(m);
            if (m !== this.placeableCell(x, y)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.akron.CANNOT_PLACE", {where: m});
                return result;
            }
            if (l > 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.akron.LEVEL1", {where: m});
                return result;
            }
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private getGroup(from: string, player: playerid): Set<string> {
        // Returns all balls that are connected to the given cell.
        const seen: Set<string> = new Set();
        const todo: string[] = [from]
        while (todo.length > 0) {
            const cell1 = todo.pop()!;
            if (seen.has(cell1)) { continue; }
            seen.add(cell1);
            for (const n of this.getPresentNeighbours(cell1, player)) {
                todo.push(n);
            }
        }
        return seen;
    }

    private getGroupIntersection(from: string, player: playerid): Set<string> {
        // Get the intersection of groups before and after drop.
        const dropMap = this.getDropMap(from, player);
        const groupBefore = this.getGroup(from, player);
        if (dropMap === undefined) { return groupBefore; }
        this.applyDrop(dropMap);
        const groupAfter = this.getGroup(from, player);
        this.unapplyDrop(dropMap);
        return new Set([...groupBefore].filter(x => groupAfter.has(x)));
    }

    private isOn(cell: string, on: string): boolean {
        // Check if a cell is on top of another cell.
        const [x, y, l] = this.algebraic2coords2(cell);
        const [x1, y1, l1] = this.algebraic2coords2(on);
        if (l - l1 !== 1) { return false; }
        if (Math.abs(x - x1) === 1 && Math.abs(y - y1) === 1) { return true; }
        return false;
    }

    // private isNeighbour(cell: string, check: string, player: playerid): boolean {
    //     // Check if cell is neighbour to cell `check`.
    //     const [x, y] = this.algebraic2coords2(cell);
    //     const [cx, cy] = this.algebraic2coords(check);
    //     if (Math.abs(x - cx) === 1 && Math.abs(y - cy) === 1) { return true; }
    //     if (Math.abs(x - cx) === 2 && y === cy) { return true; }
    //     if (Math.abs(y - cy) === 2 && x === cx) { return true; }
    //     return false;
    // }

    private getNeighbours(cell: string): string[] {
        // Get all diagonal and orthogonal neighbours of a cell.
        const [x, y] = this.algebraic2coords(cell);
        const neighbours = [];
        if (x - 1 >= 0) {
            if (y - 1 >= 0) { neighbours.push(this.coords2algebraic(x - 1, y - 1)); }
            if (y + 1 < 2 * this.boardSize - 1) { neighbours.push(this.coords2algebraic(x - 1, y + 1)); }
        }
        if (x + 1 < 2 * this.boardSize - 1) {
            if (y - 1 >= 0) { neighbours.push(this.coords2algebraic(x + 1, y - 1)); }
            if (y + 1 < 2 * this.boardSize - 1) { neighbours.push(this.coords2algebraic(x + 1, y + 1)); }
        }
        if (x - 2 >= 0) { neighbours.push(this.coords2algebraic(x - 2, y)); }
        if (x + 2 < 2 * this.boardSize - 1) { neighbours.push(this.coords2algebraic(x + 2, y)); }
        if (y - 2 >= 0) { neighbours.push(this.coords2algebraic(x, y - 2)); }
        if (y + 2 < 2 * this.boardSize - 1) { neighbours.push(this.coords2algebraic(x, y + 2)); }
        return neighbours;
    }

    private getTos(from: string): string[] {
        // Get all tos form a cell
        const tos: Set<string> = new Set();
        const group = this.getGroupIntersection(from, this.currplayer);
        group.delete(from);
        const dropBalls = this.dropBalls(from);
        const drop = dropBalls.length > 0 ? dropBalls[dropBalls.length - 1] : undefined;
        const allNeighbours = new Map<string, string[]>();
        for (const cell of group) {
            allNeighbours.set(cell, this.getNeighbours(cell));
        }
        const seen: Set<string> = new Set();
        for (const [cell, neighbours] of allNeighbours) {
            for (const neighbour of neighbours) {
                if (seen.has(neighbour)) { continue; }
                seen.add(neighbour);
                const place = this.placeableCell(...this.algebraic2coords(neighbour));
                if (place === undefined) { continue; }
                if (this.isOn(place, from)) { continue; }
                if (drop !== undefined && this.isOn(place, drop)) { continue; }
                if (Math.abs(this.algebraic2coords2(cell)[2] - this.algebraic2coords2(place)[2]) > 1) { continue; }
                tos.add(place);
            }
        }
        return [...tos];
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

    private unapplyDrop(dropMap: [string[], playerid[]]): void {
        // Unapply the drop transformation to the board.
        const [drops, dropPlayers] = dropMap;
        for (let i = 0; i < drops.length; i++) {
            this.board.set(drops[i], dropPlayers[i]);
        }
    }

    public move(m: string, {partial = false, trusted = false} = {}): AkronGame {
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
        if (m.includes("-")) {
            const [from, to] = m.split("-");
            if (to === undefined || to === "") {
                this.dots = this.getTos(from);
            } else {
                this.board.delete(from);
                this.board.set(to, this.currplayer);
                this.results.push({ type: "move", from, to });
                const dropMap = this.getDropMap(from, this.currplayer);
                if (dropMap !== undefined) {
                    this.applyDrop(dropMap);
                    const dropTopMost = dropMap[0][dropMap[0].length - 1];
                    this.results.push({ type: "move", from: dropTopMost, to: from, how: "drop", count: dropMap[0].length - 1 });
                }
            }
        } else {
            this.results.push({ type: "place", where: m });
            this.board.set(m, this.currplayer);
        }
        if (partial) { return this; }
        this.dots = [];
        this.hideLayer = undefined;

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
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

    private isTopMostCell(cell: string): boolean {
        // Check if a cell has a ball at the top-most layer.
        const [col, row,] = this.algebraic2coords2(cell);
        return this.getTopMostCell(col, row) === cell;
    }

    private getPresentNeighbours(cell: string, player: playerid, orthogonalCut = true): string[] {
        // Get neighbours for a `cell` that are already present for `player`.
        // If `orthogonalCut` is true, orthogonal connections only count if they're not blocked from above.
        // Note that this method does not check if `cell` is visible.
        const neighbours: string[] = [];
        const [col, row, layer] = this.algebraic2coords2(cell);
        // Check layer above.
        if (col > layer) {
            if (row > layer) {
                const topLeft = this.coords2algebraic2(col - 1, row - 1, layer + 1);
                if (this.board.has(topLeft) && this.board.get(topLeft) === player) { neighbours.push(topLeft); }
            }
            if (row < 2 * this.boardSize - layer - 1) {
                const bottomLeft = this.coords2algebraic2(col - 1, row + 1, layer + 1);
                if (this.board.has(bottomLeft) && this.board.get(bottomLeft) === player) { neighbours.push(bottomLeft); }
            }
        }
        if (col < 2 * this.boardSize - layer - 1) {
            if (row > layer) {
                const topRight = this.coords2algebraic2(col + 1, row - 1, layer + 1);
                if (this.board.has(topRight) && this.board.get(topRight) === player) { neighbours.push(topRight); }
            }
            if (row < 2 * this.boardSize - layer - 1) {
                const bottomRight = this.coords2algebraic2(col + 1, row + 1, layer + 1);
                if (this.board.has(bottomRight) && this.board.get(bottomRight) === player) { neighbours.push(bottomRight); }
            }
        }
        // Check layer below.
        if (layer > 0) {
            const topLeft = this.coords2algebraic2(col - 1, row - 1, layer - 1);
            if (this.board.get(topLeft) === player) { neighbours.push(topLeft); }
            const topRight = this.coords2algebraic2(col + 1, row - 1, layer - 1);
            if (this.board.get(topRight) === player) { neighbours.push(topRight); }
            const bottomLeft = this.coords2algebraic2(col - 1, row + 1, layer - 1);
            if (this.board.get(bottomLeft) === player) { neighbours.push(bottomLeft); }
            const bottomRight = this.coords2algebraic2(col + 1, row + 1, layer - 1);
            if (this.board.get(bottomRight) === player) { neighbours.push(bottomRight); }
        }
        // Check same layer.
        if (orthogonalCut) {
            if (col > layer + 1) {
                const topLeft = this.coords2algebraic2(col - 1, row + 1, layer + 1);
                const bottomLeft = this.coords2algebraic2(col - 1, row - 1, layer + 1);
                if (!this.board.has(topLeft) || !this.board.has(bottomLeft)) {
                    const left = this.coords2algebraic2(col - 2, row, layer);
                    if (this.board.has(left) && this.board.get(left) === player) { neighbours.push(left); }
                }
            }
            if (col < 2 * this.boardSize - layer - 2) {
                const topRight = this.coords2algebraic2(col + 1, row + 1, layer + 1);
                const bottomRight = this.coords2algebraic2(col + 1, row - 1, layer + 1);
                if (!this.board.has(topRight) || !this.board.has(bottomRight)) {
                    const right = this.coords2algebraic2(col + 2, row, layer);
                    if (this.board.has(right) && this.board.get(right) === player) { neighbours.push(right); }
                }
            }
            if (row > layer + 1) {
                const leftTop = this.coords2algebraic2(col - 1, row - 1, layer + 1);
                const rightTop = this.coords2algebraic2(col + 1, row - 1, layer + 1);
                if (!this.board.has(leftTop) || !this.board.has(rightTop)) {
                    const top = this.coords2algebraic2(col, row - 2, layer);
                    if (this.board.has(top) && this.board.get(top) === player) { neighbours.push(top); }
                }
            }
            if (row < 2 * this.boardSize - layer - 2) {
                const leftBottom = this.coords2algebraic2(col - 1, row + 1, layer + 1);
                const rightBottom = this.coords2algebraic2(col + 1, row + 1, layer + 1);
                if (!this.board.has(leftBottom) || !this.board.has(rightBottom)) {
                    const bottom = this.coords2algebraic2(col, row + 2, layer);
                    if (this.board.has(bottom) && this.board.get(bottom) === player) { neighbours.push(bottom); }
                }
            }
        } else {
            if (col > layer + 1) {
                const left = this.coords2algebraic2(col - 2, row, layer);
                if (this.board.has(left) && this.board.get(left) === player) { neighbours.push(left); }
            }
            if (col < 2 * this.boardSize - layer - 2) {
                const right = this.coords2algebraic2(col + 2, row, layer);
                if (this.board.has(right) && this.board.get(right) === player) { neighbours.push(right); }
            }
            if (row > layer + 1) {
                const top = this.coords2algebraic2(col, row - 2, layer);
                if (this.board.has(top) && this.board.get(top) === player) { neighbours.push(top); }
            }
            if (row < 2 * this.boardSize - layer - 2) {
                const bottom = this.coords2algebraic2(col, row + 2, layer);
                if (this.board.has(bottom) && this.board.get(bottom) === player) { neighbours.push(bottom); }
            }
        }
        return neighbours;
    }

    private isVisible(cell: string): boolean {
        // Check that a cell is visible from above.
        const [x, y, l] = this.algebraic2coords2(cell);
        if (x === l || y === l || x === 2 * this.boardSize - l - 1 || y === 2 * this.boardSize - l - 1) { return true; }
        if (!this.board.has(this.coords2algebraic2(x - 1, y - 1, l + 1))) { return true; }
        if (!this.board.has(this.coords2algebraic2(x - 1, y + 1, l + 1))) { return true; }
        if (!this.board.has(this.coords2algebraic2(x + 1, y - 1, l + 1))) { return true; }
        if (!this.board.has(this.coords2algebraic2(x + 1, y + 1, l + 1))) { return true; }
        if (l < this.boardSize - 2) {
            if (!this.board.has(this.coords2algebraic2(x, y, l + 2))) { return true; }
        }
        return false;
    }

    private buildGraph(player: playerid): UndirectedGraph {
        const graph = new UndirectedGraph();
        // seed nodes
        [...this.board.entries()].filter(([c, p]) => p === player && this.isTopMostCell(c)).forEach(([cell,]) => {
            graph.addNode(cell);
        });
        // for each node, check neighbours
        // if any are in the graph, add an edge
        for (const node of graph.nodes()) {
            for (const n of this.getPresentNeighbours(node, player)) {
                if (graph.hasNode(n) && !graph.hasEdge(node, n) && this.isVisible(n)) {
                    graph.addEdge(node, n);
                }
            }
        }
        return graph;
    }

    private hasMoves(): boolean {
        // Check if there is a placeable space in the first layer.
        for (let i = 0; i < 2 * this.boardSize - 1; i++) {
            for (let j = 0; j < 2 * this.boardSize - 1; j++) {
                if (i % 2 === 0 && j % 2 === 0 && this.placeableFirstCell(i, j) !== undefined) {
                    return true;
                }
            }
        }
        return false;
    }

    private isConnected(player: playerid): string[] | undefined {
        // Check if the player has a connection between their lines.
        // If it's connected, return the connection path.
        const graph = this.buildGraph(player);
        const [sources, targets] = this.lines[player - 1];
        for (const source of sources) {
            for (const target of targets) {
                if ( (graph.hasNode(source)) && (graph.hasNode(target)) ) {
                    const path = bidirectional(graph, source, target);
                    if (path !== null) {
                        return [...path];
                    }
                }
            }
        }
        return undefined;
    }

    protected checkEOG(): AkronGame {
        // Check for your win at the end of the opponent's turn.
        const connPath = this.isConnected(this.currplayer);
        if (connPath !== undefined) {
            this.connPath = connPath;
            this.gameover = true;
            this.winner = [this.currplayer];
        }
        if (!this.gameover && !this.hasMoves()) {
            this.gameover = true;
            this.winner = [1, 2];
        }
        if (this.gameover) {
            this.results.push({ type: "eog" });
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public state(): IAkronState {
        return {
            game: AkronGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: AkronGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            connPath: [...this.connPath],
        };
    }

    private getPiece(player: number, layer: number, trans = false, orb3d = false): [Glyph, ...Glyph[]]  {
        // Choose max blackness and whiteness.
        // Returns a combined glyphs based on the player colour for a given layer 1 to boardSize.
        // orb_3d: if true, only return pure orb glyphs, for which some people prefer.
        if (orb3d) {
            if (trans) {
                return [{ name: "circle", player, scale: 1.15, opacity: 0.5 }];
            }
            return [{ name: "orb", player, scale: 1.2 }];
        }
        const layers = this.boardSize;
        if (trans) {
            const minOpacity = 0.2;
            const maxOpacity = 0.6;
            const opacity = (maxOpacity - minOpacity) * (layer - 2) / (layers - 2) + minOpacity;
            return [
                { name: "circle", colour: "#FFF", scale: 1.15, opacity: opacity * 0.75 },
                { name: "circle", player, scale: 1.15, opacity },
            ];
        } else {
            const blackness = 0.1;
            const whiteness = 0.5;
            const scaled = (whiteness + blackness) * (layer - 1) / (layers - 1) - blackness;
            if (scaled === 0) {
                return [
                    { name: "piece-borderless", player, scale: 1.15 },
                    { name: "orb-borderless", player, scale: 1.15, opacity: 0.5 },
                    { name: "piece", scale: 1.15, opacity: 0 },
                ];
            } else {
                const colour = scaled < 0 ? "#000" : "#FFF";
                const opacity = scaled < 0 ? 1 + scaled : 1 - scaled;
                return [
                    { name: "piece-borderless", colour, scale: 1.15 },
                    { name: "piece-borderless", player, scale: 1.15, opacity },
                    { name: "orb", player, scale: 1.15, opacity: 0.5 },
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
                        } else {
                            if (hideLayer !== undefined && hideLayer <= layer) {
                                key = `Y${layer + 1}`;
                            } else {
                                key = `B${layer + 1}`;
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

        const legend: ILooseObj = {};
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
                markers: [
                    {type:"edge", edge: "N", colour: 1},
                    {type:"edge", edge: "S", colour: 1},
                    {type:"edge", edge: "E", colour: 2},
                    {type:"edge", edge: "W", colour: 2},
                ]
            },
            legend,
            pieces: pstr,
        };

        // @ts-ignore
        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.algebraic2position(move.where!);
                    rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
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
            if (this.connPath.length > 0) {
                type RowCol = {row: number; col: number;};
                const targets: RowCol[] = [];
                for (const cell of this.connPath) {
                    const [x, y] = this.algebraic2position(cell);
                    targets.push({row: y, col: x})
                }
                // @ts-ignore
                rep.annotations.push({type: "move", targets, arrow: false});
            }
        }
        if (this.dots.length > 0) {
            const points = [];
            for (const cell of this.dots) {
                const [x, y] = this.algebraic2position(cell);
                points.push({row: y, col: x});
            }
            // @ts-ignore
            rep.annotations.push({type: "dots", targets: points});
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

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += `In check: ${this.inCheck().join(",")}\n\n`;

        return status;
    }

    public inCheck(): number[] {
        if (this.isConnected(this.currplayer % 2 + 1 as playerid) !== undefined) {
            return [this.currplayer];
        } else {
            return [];
        }
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.ball", { player, where: r.where }));
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
        }
        return resolved;
    }

    public clone(): AkronGame {
        return new AkronGame(this.serialize());
    }
}
