import { GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, Glyph } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";

type playerid = 1 | 2 | 3;

interface ILegendObj {
    [key: string]: Glyph|[Glyph, ...Glyph[]];
}

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
}

export interface ISpireState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class SpireGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Spire",
        uid: "spire",
        playercounts: [2],
        version: "20240602",
        dateAdded: "2024-06-08",
        // i18next.t("apgames:descriptions.spire")
        description: "apgames:descriptions.spire",
        // i18next.t("apgames:notes.spire")
        notes: "apgames:notes.spire",
        urls: ["https://boardgamegeek.com/boardgame/113641/spire"],
        people: [
            {
                type: "designer",
                name: "Dieter Stein",
                urls: ["https://spielstein.com/"]
            },
            {
                type: "coder",
                name: "ypaul",
                urls: [],
                apid: "46f6da78-be02-4469-94cb-52f17078e9c1",
            },
        ],
        variants: [
            { uid: "size-5", group: "board" },
        ],
        categories: ["goal>immobilize", "mechanic>place", "board>shape>rect", "board>connect>rect", "components>simple>3c", "components>shibumi", "board>3d"],
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
        try {
            return `${layer + 1}${this.coords2algebraic(x, y)}`;
        } catch {
            return "";
        }
    }

    private algebraic2coords2(cell: string): [number, number, number] {
        // The same as algebraic2coords, but also return the layer.
        const idx = cell.search(/\D/);
        const l = cell.substring(0, idx);
        const coords = cell.substring(idx);
        const layer = parseInt(l, 10) - 1;
        const [x, y] = this.algebraic2coords(coords);
        return [x, y, layer];
    }

    private placeableCell(i: number, j: number, placed?: string): string | undefined {
        // Get the highest supported layer for a cell.
        // If that cell is not placeable, return undefined.
        // Modified to support an optional "placed" parameter, which is a cell that has already been placed.
        if (i % 2 !== j % 2) { return undefined; }
        let layer = i % 2 ? 1 : 0;
        while (layer < this.boardSize) {
            const cell = `${layer + 1}${this.coords2algebraic(i, j)}`
            if (this.board.has(cell) || cell === placed) {
                layer += 2;
                continue;
            }
            if (layer > 0) {
                if (i < layer || j < layer || i >= 2 * this.boardSize - layer || j >= 2 * this.boardSize - layer) { return undefined; }
                // Check the four cells below the currentone.
                const topLeft = this.coords2algebraic2(i - 1, j - 1, layer - 1);
                if (!this.board.has(topLeft) && topLeft !== placed) { return undefined; }
                const bottomLeft = this.coords2algebraic2(i - 1, j + 1, layer - 1);
                if (!this.board.has(bottomLeft) && bottomLeft !== placed) { return undefined; }
                const topRight = this.coords2algebraic2(i + 1, j - 1, layer - 1);
                if (!this.board.has(topRight) && topRight !== placed) { return undefined; }
                const bottomRight = this.coords2algebraic2(i + 1, j + 1, layer - 1);
                if (!this.board.has(bottomRight) && bottomRight !== placed) { return undefined; }
            }
            return cell;
        }
        return undefined;
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private boardSize = 0;
    private hideLayer: number|undefined;
    // private dots: string[] = [];
    private tentative: string | undefined;

    constructor(state?: ISpireState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: SpireGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ISpireState;
            }
            if (state.game !== SpireGame.gameinfo.uid) {
                throw new Error(`The UpperHanSpire process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): SpireGame {
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
        const neutralPlacements: string[] = [];
        for (let i = 0; i < 2 * this.boardSize - 1; i++) {
            for (let j = 0; j < 2 * this.boardSize - 1; j++) {
                const cell = this.placeableCell(i, j);
                if (cell !== undefined) {
                    if (this.canPlace(cell, player)) { moves.push(cell); }
                    if (this.canPlace(cell, 3)) { neutralPlacements.push(cell); }
                }
            }
        }
        for (const p of neutralPlacements) {
            for (let i = 0; i < 2 * this.boardSize - 1; i++) {
                for (let j = 0; j < 2 * this.boardSize - 1; j++) {
                    const cell = this.placeableCell(i, j, p);
                    if (cell !== undefined) {
                        if (cell === p) { continue; }
                        if (this.canPlace(cell, player, p)) { moves.push(`${p},${cell}`); }
                    }
                }
            }
        }
        return moves;
    }

    private hasMoves(player: playerid): boolean {
        // Check if a player has any moves left.
        // Same as above but short circuited.
        if (player === undefined) {
            player = this.currplayer;
        }
        const neutralPlacements: string[] = [];
        for (let i = 0; i < 2 * this.boardSize - 1; i++) {
            for (let j = 0; j < 2 * this.boardSize - 1; j++) {
                const cell = this.placeableCell(i, j);
                if (cell !== undefined) {
                    if (this.canPlace(cell, player)) { return true; }
                    if (this.canPlace(cell, 3)) { neutralPlacements.push(cell); }
                }
            }
        }
        for (const p of neutralPlacements) {
            for (let i = 0; i < 2 * this.boardSize - 1; i++) {
                for (let j = 0; j < 2 * this.boardSize - 1; j++) {
                    const cell = this.placeableCell(i, j);
                    if (cell !== undefined) {
                        if (this.canPlace(cell, player, p)) { return true; }
                    }
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
                } else if (n < 1) {
                    this.hideLayer = 1;
                } else {
                    this.hideLayer = n;
                }
            } else {
                if (move === "") {
                    const cell = this.placeableCell(col, row);
                    if (cell === undefined) {
                        return {
                            move,
                            valid: false,
                            message: i18next.t("apgames:validation.spire.CANNOT_PLACE", { where: this.coords2algebraic(col, row) })
                        };
                    }
                    newmove = cell;
                } else if (move.split(",").length === 1) {
                    const cell = this.placeableCell(col, row, move);
                    if (cell === undefined) {
                        return {
                            move,
                            valid: false,
                            message: i18next.t("apgames:validation.spire.CANNOT_PLACE", { where: this.coords2algebraic(col, row) })
                        };
                    }
                    newmove = `${move},${cell}`;
                } else {
                    const cell = this.coords2algebraic(col, row);
                    newmove = `${move},${cell}`
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
            result.message = i18next.t("apgames:validation.spire.INITIAL_INSTRUCTIONS");
            return result;
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const moves = m.split(",");
        if (moves.length > 2) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.spire.TOO_MANY_MOVES");
            return result;
        }
        // Valid cell
        let tryCell;
        for (const cell of moves) {
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
        // Cell is empty
        let notEmpty;
        for (const p of moves) {
            if (this.board.has(p)) { notEmpty = p; break; }
        }
        if (notEmpty) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", { where: notEmpty });
            return result;
        }
        const [m1, m2] = moves;
        const canPlacePlayer1 = this.canPlace(m1, this.currplayer);
        const canPlaceNeutral1 = this.canPlace(m1, this.currplayer, undefined, true);
        if (m2 === undefined || m2 === "") {
            if (canPlacePlayer1 && canPlaceNeutral1) {
                result.valid = true;
                result.complete = 0;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.spire.PLACE_PLAYER", { where: m1 });
                return result;
            } else if (!canPlacePlayer1 && !canPlaceNeutral1) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.spire.VIOLATES_BOTH", { where: m1 });
                return result;
            } else if (canPlaceNeutral1) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.spire.PLACE_PLAYER_MANDATORY", { where: m1 });
                return result;
            }
        } else {
            if (m1 === m2) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.SAME_CELL", { cell: m1 });
                return result;
            }
            if (!canPlaceNeutral1) {
                if (this.violatesL(m1, 3)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.spire.VIOLATES_NEUTRAL_L", { where: m1 });
                    return result;
                }
                if (this.violatesPlatform(m1, 3)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.spire.VIOLATES_NEUTRAL_PLATFORM", { where: m1 });
                    return result;
                }
            }
            if (!this.canPlace(m2, this.currplayer, m1)) {
                if (this.violatesL(m2, this.currplayer)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.spire.VIOLATES_PLAYER_L", { where: m2 });
                    return result;
                }
                if (this.violatesPlatform(m2, this.currplayer, m1)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.spire.VIOLATES_PLAYER_PLATFORM", { where: m2 });
                    return result;
                }
            }
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private checkL(x: number, y: number, l: number, player: playerid, committed = false): boolean {
        // Check if there is an L shape of `player`'s balls.
        // Starting from the top left.
        let counts = 0;
        for (let i = x; i < x + 4; i += 2) {
            for (let j = y; j < y + 4; j += 2) {
                const c = this.coords2algebraic2(i, j, l);
                if (this.board.has(c)) {
                    if (this.board.get(c) === player) {
                        counts++;
                    }
                }
            }
        }
        return committed ? counts > 2 : counts > 1;
    }

    private canPlace(cell: string, player: playerid, placed?: string, neutral = false): boolean {
        // Check if a ball can be placed at `cell` for `player`.
        // Assumes that `placed` is by player 3.
        // If `neutral` is true, then we are checking for a neutral ball.
        // Previously, `player` could be 1, 2, or 3, but then I realised that it's useful to also
        // check if the placement of the neutral ball has a valid followup.
        // In order to do that, we need to know the player's colour, so whether the ball is neutral
        // or not is now determined by the `neutral` parameter.
        // It's a bit of monkey patching, but that was just the history just in case anybody reads this code.
        if (this.violatesL(cell, neutral ? 3 : player)) { return false; }
        if (this.violatesPlatform(cell, neutral ? 3 : player, placed)) { return false; }
        if (neutral) {
            if (!this.hasFollowUp(cell, player)) { return false; }
        }
        return true;
    }

    private hasFollowUp(neutral: string, player: playerid): boolean {
        // Check if it's possible to place a ball of the player's colour after
        // placing a neutral ball at `cell`.
        for (let i = 0; i < 2 * this.boardSize - 1; i++) {
            for (let j = 0; j < 2 * this.boardSize - 1; j++) {
                const cell = this.placeableCell(i, j, neutral);
                if (cell !== undefined) {
                    if (cell === neutral) { continue; }
                    if (this.canPlace(cell, player, neutral)) { return true; }
                }
            }
        }
        return false;
    }

    private violatesL(cell: string, player: playerid): boolean {
        // Check for L violation at `cell` for `player`.
        const [x, y, layer] = this.algebraic2coords2(cell);
        for (const [x1, y1] of [[x - 2, y - 2], [x - 2, y], [x, y - 2], [x, y]] as [number, number][]) {
            if (x1 < layer || y1 < layer || x1 >= 2 * this.boardSize - layer - 1 || y1 >= 2 * this.boardSize - layer - 1) { continue; }
            if (this.checkL(x1, y1, layer, player)) { return true; }
        }
        return false;
    }

    private violatesPlatform(cell: string, player: playerid, placed?: string): boolean {
        // Check that placement at `cell` is not on more than two balls of the `player`'s colour.
        // Assumes that `placed` is by player 3.
        const [x, y, layer] = this.algebraic2coords2(cell);
        let count = 0;
        if (layer > 0) {
            const topLeft = this.coords2algebraic2(x - 1, y - 1, layer - 1);
            if (this.board.get(topLeft) === player || player === 3 && topLeft === placed ) { count++; }
            const bottomLeft = this.coords2algebraic2(x - 1, y + 1, layer - 1);
            if (this.board.get(bottomLeft) === player || player === 3 && bottomLeft === placed ) { count++; }
            const topRight = this.coords2algebraic2(x + 1, y - 1, layer - 1);
            if (this.board.get(topRight) === player || player === 3 && topRight === placed ) { count++; }
            const bottomRight = this.coords2algebraic2(x + 1, y + 1, layer - 1);
            if (this.board.get(bottomRight) === player || player === 3 && bottomRight === placed ) { count++; }
        }
        return count > 1;
    }

    public move(m: string, {partial = false, trusted = false} = {}): SpireGame {
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
        const [m1, m2] = m.split(",");
        if (m2 === undefined || m2 === "") {
            const canPlacePlayer1 = this.canPlace(m1, this.currplayer);
            const canPlaceNeutral1 = this.canPlace(m1, this.currplayer, undefined, true);
            if (canPlacePlayer1 && canPlaceNeutral1) {
                this.tentative = m1;
                this.results.push({ type: "place", where: m1, who: this.currplayer, what: "player" });
                this.board.set(m1, this.currplayer);
            } else if (canPlacePlayer1) {
                this.results.push({ type: "place", where: m1, who: this.currplayer, what: "player" });
                this.board.set(m1, this.currplayer);
            } else if (canPlaceNeutral1) {
                this.results.push({ type: "place", where: m1, who: 3, what: "neutral" });
                this.board.set(m1, 3);
            }
        } else {
            this.results.push({ type: "place", where: m1, who: 3, what: "neutral" });
            this.board.set(m1, 3);
            this.results.push({ type: "place", where: m2, who: this.currplayer, what: "player" });
            this.board.set(m2, this.currplayer);
        }
        if (partial) { return this; }
        this.tentative = undefined;
        this.hideLayer = undefined;

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): SpireGame {
        if (!this.hasMoves(this.currplayer)) {
            this.winner = [this.currplayer % 2 + 1 as playerid];
            this.gameover = true;
        }
        if (this.gameover) {
            this.results.push({ type: "eog" });
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public state(): ISpireState {
        return {
            game: SpireGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: SpireGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    private getPiece(player: number, layer: number, trans = false, orb3d = false, tentative = false): [Glyph, ...Glyph[]]  {
        // Choose max blackness and whiteness.
        // Returns a combined glyphs based on the player colour for a given layer 1 to boardSize.
        // orb_3d: if true, only return pure orb glyphs, for which some people prefer.
        // tentative: if true, return a transparent piece.
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
                    { name: "piece-borderless", colour: player, scale: 1.15, opacity: tentative ? 0.2 : 1 },
                    ...(tentative ? [{ name: "piece-borderless", colour: 3, scale: 1.15, opacity: 0.5 }] : []),
                    { name: "orb", colour: player, scale: 1.15, opacity: 0.5 },
                    { name: "piece", scale: 1.15, opacity: 0 },
                ];
            } else {
                const colour = scaled < 0 ? "#000" : "#FFF";
                const opacity = scaled < 0 ? 1 + scaled : 1 - scaled;
                return [
                    { name: "piece-borderless", colour, scale: 1.15, opacity: tentative ? 0.2 : 1 },
                    { name: "piece-borderless", colour: player, scale: 1.15, opacity: opacity * (tentative ? 0.2 : 1) },
                    ...(tentative ? [{ name: "piece-borderless", colour: 3, scale: 1.15, opacity: 0.5 }] : []),
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
                            if (this.tentative === cell) {
                                key = `D${layer + 1}`;
                            } else if (hideLayer !== undefined && hideLayer <= layer) {
                                key = `X${layer + 1}`;
                            } else {
                                key = `A${layer + 1}`;
                            }
                        } else if (contents === 2) {
                            if (this.tentative === cell) {
                                key = `E${layer + 1}`;
                            } else if (hideLayer !== undefined && hideLayer <= layer) {
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
            const player = piece === "A" || piece === "X" || piece === "D" ? 1 : piece === "B" || piece === "Y" || piece === "E" ? 2 : 3;
            legend[label] = this.getPiece(player, layer, ["X", "Y", "Z"].includes(piece), orb3d, ["D", "E"].includes(piece));
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
                if (r.who === 3) {
                    node.push(i18next.t("apresults:PLACE.spire_neutral", { player, where: r.where }));
                } else {
                    node.push(i18next.t("apresults:PLACE.spire_player", { player, where: r.where }));
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

    public clone(): SpireGame {
        return new SpireGame(this.serialize());
    }
}
