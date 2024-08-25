import { GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, Glyph } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";

type playerid = 1 | 2;

interface ILegendObj {
    [key: string]: Glyph|[Glyph, ...Glyph[]];
}

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
    winningLines: string[][];
}

export interface ISplineState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class SplineGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Spline",
        uid: "spline",
        playercounts: [2],
        version: "20240530",
        dateAdded: "2024-06-08",
        // i18next.t("apgames:descriptions.spline")
        description: "apgames:descriptions.spline",
        urls: ["https://boardgamegeek.com/boardgame/93164/spline"],
        people: [
            {
                type: "designer",
                name: "Néstor Romeral Andrés",
                urls: ["https://boardgamegeek.com/boardgamedesigner/9393/nestor-romeral-andres"]
            }
        ],
        variants: [
            { uid: "size-5", group: "board" },
            { uid: "plus" }
        ],
        categories: ["goal>align", "mechanic>place", "mechanic>move", "board>shape>rect", "board>connect>rect", "components>simple>1per", "components>shibumi", "board>3d"],
        flags: [],
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

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, playerid>;
    public winningLines: string[][] = [];
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private boardSize = 0;
    private hideLayer: number|undefined;
    private dots: string[] = [];

    constructor(state?: ISplineState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: SplineGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                winningLines: [],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ISplineState;
            }
            if (state.game !== SplineGame.gameinfo.uid) {
                throw new Error(`The UpperHanSpline process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): SplineGame {
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
                const cell = this.placeableCell(i, j);
                if (cell !== undefined) {
                    moves.push(cell);
                } else if (this.variants.includes("plus")) {
                    const topMostCell = this.getTopMostCell(i, j);
                    if (topMostCell !== undefined && this.board.get(topMostCell) === player && this.canMove(topMostCell)) {
                        froms.push(topMostCell);
                    }
                }
            }
        }
        if (this.variants.includes("plus")) {
            for (const from of froms) {
                for (const to of this.getTos(from)) {
                    moves.push(`${from}-${to}`);
                }
            }
        }
        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
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
                if (move === "" && this.variants.includes("plus") && topMostCell !== undefined && this.canMove(topMostCell)) {
                    newmove = topMostCell + "-";
                } else {
                    const cell = this.placeableCell(col, row);
                    if (cell === undefined) {
                        return {
                            move,
                            valid: false,
                            message: i18next.t("apgames:validation.spline.CANNOT_PLACE", { where: this.coords2algebraic(col, row) })
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
            result.message = i18next.t("apgames:validation.spline.INITIAL_INSTRUCTIONS");
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
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: tryCell });
                    return result;
                }
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: tryCell });
                return result;
            }
        }
        if (this.variants.includes("plus") && m.includes("-")) {
            const [from, to] = cells;
            if (!this.canMove(from)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.spline.CANNOT_MOVE", { where: from });
                return result;
            }
            if (!this.board.has(from)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", { where: from });
                return result;
            }
            if (this.board.get(from) !== this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.UNCONTROLLED", { where: from });
                return result;
            }
            const tos = this.getTos(from);
            if (tos.length === 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.spline.NO_TOS", { where: from });
                return result;
            }
            if (to === undefined || to === "") {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.spline.MOVE_TO");
                return result;
            }
            if (from === to) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.SAME_FROM_TO");
                return result;
            }
            if (!tos.includes(to)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.spline.INVALID_TO", { from, to });
                return result;
            }
        } else {
            if (this.board.has(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", { where: m });
                return result;
            }
            const [x, y, ] = this.algebraic2coords2(m);
            if (m !== this.placeableCell(x, y)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.spline.CANNOT_PLACE", { where: m });
                return result;
            }
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
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

    private isOn(cell: string, on: string): boolean {
        // Check if a cell is on top of another cell.
        const [x, y, l] = this.algebraic2coords2(cell);
        const [x1, y1, l1] = this.algebraic2coords2(on);
        if (l - l1 !== 1) { return false; }
        if (Math.abs(x - x1) === 1 && Math.abs(y - y1) === 1) { return true; }
        return false;
    }

    private getTos(from: string): string[] {
        // Get all tos form a cell
        const tos: string[] = [];
        const dropBalls = this.dropBalls(from);
        const drop = dropBalls.length > 0 ? dropBalls[dropBalls.length - 1] : undefined;
        from = from.toLowerCase();
        for (let i = 0; i < 2 * this.boardSize - 1; i++) {
            for (let j = 0; j < 2 * this.boardSize - 1; j++) {
                const cell = this.placeableCell(i, j);
                if (cell === undefined) { continue; }
                if (this.isOn(cell, from)) { continue; }
                if (drop !== undefined && this.isOn(cell, drop)) { continue; }
                tos.push(cell);
            }
        }
        return tos;
    }

    public move(m: string, {partial = false, trusted = false} = {}): SplineGame {
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
        this.hideLayer = undefined;

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected getWinningLinesMap(): Map<playerid, string[][]> {
        // Get the winning lines for each player.
        // Check for horizontal, vertical, and diagonal lines of size equal to the full width of that layer.
        // Layer 0 needs boardSize in a row, layer 1 needs boardSize - 1 in a row, and so on.
        const winningLines = new Map<playerid, string[][]>([
            [1, []],
            [2, []],
        ]);
        for (let l = 0; l < this.boardSize - 1; l++) {
            // Horizontal lines
            loop_h:
            for (let i = 0; i < this.boardSize - l; i++) {
                const tentativeLine: string[] = [];
                let player: playerid | undefined;
                for (let j = 0; j < this.boardSize - l; j++) {
                    const cell = this.layerCoords2algebraic(j, i, l);
                    tentativeLine.push(cell);
                    if (!this.board.has(cell)) { continue loop_h; }
                    if (player === undefined) {
                        player = this.board.get(cell);
                    } else if (player !== this.board.get(cell)) {
                        continue loop_h;
                    }
                }
                winningLines.get(player!)!.push(tentativeLine);
            }

            // Vertical lines
            loop_v:
            for (let i = 0; i < this.boardSize - l; i++) {
                const tentativeLine: string[] = [];
                let player: playerid | undefined;
                for (let j = 0; j < this.boardSize - l; j++) {
                    const cell = this.layerCoords2algebraic(i, j, l);
                    tentativeLine.push(cell);
                    if (!this.board.has(cell)) { continue loop_v; }
                    if (player === undefined) {
                        player = this.board.get(cell);
                    } else if (player !== this.board.get(cell)) {
                        continue loop_v;
                    }
                }
                winningLines.get(player!)!.push(tentativeLine);
            }

            // Now the two diagonals.
            const tentativeLine1: string[] = [];
            let player1: playerid | undefined;
            let hasLine1 = true;
            for (let j = 0; j < this.boardSize - l; j++) {
                const cell = this.layerCoords2algebraic(j, j, l);
                tentativeLine1.push(cell);
                if (!this.board.has(cell)) {
                    hasLine1 = false;
                    break;
                }
                if (player1 === undefined) {
                    player1 = this.board.get(cell);
                } else if (player1 !== this.board.get(cell)) {
                    hasLine1 = false;
                    break;
                }
            }
            if (player1 !== undefined && hasLine1) { winningLines.get(player1)!.push(tentativeLine1); }

            const tentativeLine2: string[] = [];
            let player2: playerid | undefined;
            let hasLine2 = true;
            for (let j = 0; j < this.boardSize - l; j++) {
                const cell = this.layerCoords2algebraic(j, this.boardSize - l - 1 - j, l);
                tentativeLine2.push(cell);
                if (!this.board.has(cell)) {
                    hasLine2 = false;
                    break;
                }
                if (player2 === undefined) {
                    player2 = this.board.get(cell);
                } else if (player2 !== this.board.get(cell)) {
                    hasLine2 = false;
                    break;
                }
            }
            if (player2 !== undefined && hasLine2) { winningLines.get(player2)!.push(tentativeLine2); }
            if (winningLines.get(1)!.length > 0 || winningLines.get(2)!.length > 0) {
                break;
            }
        }
        return winningLines;
    }

    protected checkEOG(): SplineGame {
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
        }
        if (this.gameover) {
            this.results.push({ type: "eog" });
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public state(): ISplineState {
        return {
            game: SplineGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: SplineGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
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
                backFill: this.variants.includes("plus") ? {colour: "#FFA500", opacity: 0.1} : undefined,
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
        if (this.dots.length > 0) {
            const points = [];
            for (const cell of this.dots) {
                const [x, y] = this.algebraic2position(cell);
                points.push({row: y, col: x});
            }
            rep.annotations.push({type: "dots", targets: points as [{row: number; col: number}, ...{row: number; col: number}[]]});
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

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        return status;
    }

    public clone(): SplineGame {
        return new SplineGame(this.serialize());
    }
}
