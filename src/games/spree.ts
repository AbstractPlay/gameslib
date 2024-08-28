import { GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, AreaKey, Glyph } from "@abstractplay/renderer/src/schemas/schema";
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
    toPlace?: playerid;
    lastmove?: string;
    winningLines: string[][];
}

export interface ISpreeState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class SpreeGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Spree",
        uid: "spree",
        playercounts: [2],
        version: "20240602",
        dateAdded: "2024-06-08",
        // i18next.t("apgames:descriptions.spree")
        description: "apgames:descriptions.spree",
        // i18next.t("apgames:notes.spree")
        notes: "apgames:notes.spree",
        urls: ["https://boardgamegeek.com/boardgame/114263/spree"],
        people: [
            {
                type: "designer",
                name: "Avri Klemer",
                urls: ["https://boardgamegeek.com/boardgamedesigner/9042/avri-klemer"],
            }
        ],
        variants: [
            { uid: "size-5", group: "board" },
        ],
        categories: ["goal>align", "mechanic>place", "mechanic>move", "board>shape>rect", "board>connect>rect", "components>simple>3c", "components>shibumi", "board>3d"],
        flags: ["shared-pieces"],
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
    public toPlace?: playerid;
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private boardSize = 0;
    private hideLayer: number|undefined;
    private dots: string[] = [];

    constructor(state?: ISpreeState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: SpreeGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                toPlace: undefined,
                winningLines: [],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ISpreeState;
            }
            if (state.game !== SpreeGame.gameinfo.uid) {
                throw new Error(`The UpperHanSpree process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): SpreeGame {
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
        this.toPlace = state.toPlace;
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
        if (this.stack.length === 1) {
            return ["1", "2", "3"];
        }
        const moves: string[] = [];
        const placements: string[] = [];
        for (let i = 0; i < 2 * this.boardSize - 1; i++) {
            for (let j = 0; j < 2 * this.boardSize - 1; j++) {
                const cell = this.placeableCell(i, j);
                if (cell !== undefined) {
                    placements.push(cell);
                }
            }
        }
        const availableChoices = [1, 2, 3].filter(c => c !== this.toPlace);
        for (const place of placements) {
            if (this.getWinningLines(place, this.toPlace).length > 0) {
                moves.push(place);
            } else {
                for (const choice of availableChoices) {
                    moves.push(`${place}/${choice}`);
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
            let newmove = "";
            if (row === -1 && col === -1) {

                if (piece === undefined) {
                    throw new Error(`A click was registered off the board, but no 'piece' parameter was passed.`);
                }
                if (piece?.startsWith("scroll_newval_")) {
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
                } else if (["1", "2", "3"].includes(piece)) {
                    if (this.stack.length === 1) {
                        newmove = piece;
                    } else {
                        newmove = `${move}/${piece}`;
                    }
                }
            } else {
                const cell = this.placeableCell(col, row);
                if (cell === undefined) {
                    return {
                        move,
                        valid: false,
                        message: i18next.t("apgames:validation.spree.CANNOT_PLACE", { where: this.coords2algebraic(col, row) })
                    };
                }
                newmove = cell;
            }
            const result = this.validateMove(newmove) as IClickResult;
            if (!result.valid) {
                result.move = move;
            } else {
                result.move = newmove;
            }
            result.opts = { hideLayer: this.hideLayer };
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
            if (this.stack.length === 1) {
                result.message = i18next.t("apgames:validation.spree.INITIAL_INSTRUCTIONS_FIRST");
            } else {
                result.message = i18next.t("apgames:validation.spree.INITIAL_INSTRUCTIONS", { choice: this.toPlace });
            }
            return result;
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (this.stack.length === 1) {
            if (!["1", "2", "3"].includes(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.spree.FIRST_MOVE_CHOICE", { choice: m });
                return result;
            }
        } else {
            if (m.startsWith("/")) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.spree.PLACE_FIRST");
                return result;
            }
            const [cell, choiceStr] = m.split("/");
            // valid cell
            try {
                const [x, y] = this.algebraic2coords(cell);
                if (x < 0 || x >= 2 * this.boardSize - 1 || y < 0 || y >= 2 * this.boardSize - 1) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell });
                    return result;
                }
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell });
                return result;
            }
            if (this.board.has(cell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", { where: cell });
                return result;
            }
            const isWin = this.getWinningLines(cell, this.toPlace).length > 0;
            if (isWin) {
                if (choiceStr !== undefined && choiceStr !== "") {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.spree.ALREADY_WON");
                    return result;
                }
            } else {
                if (choiceStr === undefined || choiceStr === "") {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.spree.CHOOSE_NEXT");
                    return result;
                }
                if (!["1", "2", "3"].includes(choiceStr)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.spree.INVALID_CHOICE", { choice: choiceStr });
                    return result;
                }
                const choice = parseInt(choiceStr, 10) as playerid;
                if (this.toPlace === choice) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.spree.SAME_CHOICE", { choice });
                    return result;
                }
            }
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {partial = false, trusted = false} = {}): SpreeGame {
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
        // If it is a winning move, there will be no choice.
        // Set the choice to undefined in that case.
        let won = true;
        if (this.stack.length === 1) {
            this.toPlace = parseInt(m, 10) as playerid;
            this.results.push({ type: "select", who: this.toPlace });
        } else {
            const [cell, choice] = m.split("/");
            this.results.push({ type: "place", where: cell, who: this.toPlace });
            this.board.set(cell, this.toPlace!);
            if (choice !== undefined && choice !== "") {
                this.toPlace = parseInt(choice, 10) as playerid;
                this.results.push({ type: "select", who: this.toPlace });
                won = false;
            }
        }
        if (partial) { return this; }
        if (this.stack.length > 1 && won) {
            this.toPlace = undefined;
        }
        this.hideLayer = undefined;
        this.dots = [];

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected getWinningLines(place?: string, who?: playerid): string[][] {
        // Get the winning lines for each player.
        // Check for horizontal, vertical, and diagonal lines of size equal to the full width of that layer.
        // Layer 0 needs boardSize in a row, layer 1 needs boardSize - 1 in a row, and so on.
        if (place !== undefined && who !== undefined) {
            this.board.set(place, who);
        }
        const winningLines: string[][] = []
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
                    const thisPlayer = this.board.get(cell);
                    if (player === undefined && thisPlayer !== 3) {
                        player = thisPlayer;
                    } else if (thisPlayer !== 3 && player !== thisPlayer) {
                        continue loop_h;
                    }
                }
                if (player !== undefined) {
                    winningLines.push(tentativeLine);
                }
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
                    const thisPlayer = this.board.get(cell);
                    if (player === undefined && thisPlayer !== 3) {
                        player = thisPlayer;
                    } else if (thisPlayer !== 3 && player !== thisPlayer) {
                        continue loop_v;
                    }
                }
                if (player !== undefined) {
                    winningLines.push(tentativeLine);
                }
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
                const thisPlayer = this.board.get(cell);
                if (player1 === undefined && thisPlayer !== 3) {
                    player1 = this.board.get(cell);
                } else if (thisPlayer !== 3 && player1 !== this.board.get(cell)) {
                    hasLine1 = false;
                    break;
                }
            }
            if (player1 !== undefined && hasLine1) { winningLines.push(tentativeLine1); }

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
                const thisPlayer = this.board.get(cell);
                if (player2 === undefined && thisPlayer !== 3) {
                    player2 = this.board.get(cell);
                } else if (thisPlayer !== 3 && player2 !== this.board.get(cell)) {
                    hasLine2 = false;
                    break;
                }
            }
            if (player2 !== undefined && hasLine2) { winningLines.push(tentativeLine2); }

            if (winningLines.length > 0 ) { break; }
        }
        if (place !== undefined && who !== undefined) {
            this.board.delete(place);
        }
        return winningLines;
    }

    protected checkEOG(): SpreeGame {
        const winningLines = this.getWinningLines();
        if (winningLines.length > 0) {
            this.winningLines = winningLines;
            this.gameover = true;
            this.winner = [this.currplayer % 2 + 1 as playerid];
        }
        if (this.gameover) {
            this.results.push({ type: "eog" });
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public state(): ISpreeState {
        return {
            game: SpreeGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: SpreeGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            toPlace: this.toPlace,
            winningLines: this.getWinningLines(),
        };
    }

    private getPiece(player: number, layer: number, trans = false, orb3d = false, where: "board" | "key" | "key-to-place" | "key-to-choose" = "board"): [Glyph, ...Glyph[]]  {
        // Choose max blackness and whiteness.
        // Returns a combined glyphs based on the player colour for a given layer 1 to boardSize.
        // orb_3d: if true, only return pure orb glyphs, for which some people prefer.
        // gradient: if false, return a single glyph for the piece, without the gradient effect.
        if (where === "board") {
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
        } else {
            if (orb3d) {
                if (where === "key-to-choose") {
                    return [
                        { name: "orb", colour: player, scale: 0.9 },
                        { name: "x" }
                    ];
                } else if (where === "key-to-place") {
                    return [
                        { name: "piece-borderless", colour: "#ffff00", opacity: 0.75 },
                        { name: "orb", colour: player, scale: 0.9 },
                        { name: "piece-borderless", colour: "#ffff00", opacity: 0.3 },
                    ];
                } else {
                    return [
                        { name: "orb", colour: player, scale: 0.9 },
                    ];
                }
            }
            if (where === "key-to-choose") {
                return [
                    { name: "piece-borderless", colour: player, scale: 0.9 },
                    { name: "orb", colour: player, scale: 0.9, opacity: 0.5 },
                    { name: "piece", scale: 0.9, opacity: 0 },
                    { name: "x" }
                ];
            } else if (where === "key-to-place") {
                return [
                    { name: "piece-borderless", colour: "#ffff00", opacity: 0.75 },
                    { name: "piece-borderless", colour: player, scale: 0.9 },
                    { name: "orb", colour: player, scale: 0.9, opacity: 0.5 },
                    { name: "piece", scale: 0.9, opacity: 0 },
                    { name: "piece-borderless", colour: "#ffff00", opacity: 0.3 },
                ];
            } else {
                return [
                    { name: "piece-borderless", colour: player, scale: 0.9 },
                    { name: "orb", colour: player, scale: 0.9, opacity: 0.5 },
                    { name: "piece", scale: 0.9, opacity: 0 },
                ];
            }
        }
    }

    private isNewResult(): boolean {
        // Check if the `this.result` is new, or if it was copied from the previous state.
        return this.results.every(r => r !== this.stack[this.stack.length - 1]._results[0]);
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

        const stage = this.isNewResult() ? "key-to-choose" : "key-to-place";
        legend.A = this.getPiece(1, 0, false, orb3d, this.toPlace === 1 ? stage : "key");
        legend.B = this.getPiece(2, 0, false, orb3d, this.toPlace === 2 ? stage : "key");
        legend.C = this.getPiece(3, 0, false, orb3d, this.toPlace === 3 ? stage : "key");

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

        // Add key so the user can click to select the color to place
        const keyObj: AreaKey = {
            type: "key",
            position: "right",
            height: 0.7,
            list: [
                { piece: "A", name: "", value: "1" },
                { piece: "B", name: "", value: "2" },
                { piece: "C", name: "", value: "3" },
            ],
            clickable: true
        };

        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.algebraic2position(move.where!);
                    rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
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
            },
            keyObj
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
            case "select":
                node.push(i18next.t("apresults:SELECT.spree", { player, who: r.who }));
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

    public clone(): SpreeGame {
        return new SpreeGame(this.serialize());
    }
}
