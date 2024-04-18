import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { InARowBase } from "./in_a_row/InARowBase";
import { APRenderRep } from "@abstractplay/renderer";

type playerid = 1 | 2;

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
    winningLines: string[][];
    swapped: boolean;
    tiebreaker?: playerid;
}

export interface IIrenseiState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class IrenseiGame extends InARowBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Irensei",
        uid: "irensei",
        playercounts: [2],
        version: "20240328",
        dateAdded: "2024-03-28",
        // i18next.t("apgames:descriptions.irensei")
        description: "apgames:descriptions.irensei",
        urls: ["https://boardgamegeek.com/boardgame/48871/irensei"],
        people: [
            {
                type: "designer",
                name: "Toki Higashi",
            },
        ],
        variants: [
            { uid: "toroidal-15", group: "board" },
            { uid: "swap-2", group: "opening" },
            { uid: "swap-5", group: "opening" },
            { uid: "pass", group: "tiebreaker" },
        ],
        categories: ["goal>align", "mechanic>place", "mechanic>capture", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["experimental", "multistep", "custom-colours", "rotate90"],
        displays: [{uid: "hide-restrictions"}],
    };

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardSize);
    }

    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardSize);
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
    public swapped = false;
    public boardSize = 0;
    private openingProtocol: "none" | "swap-2" | "swap-5";
    public toroidal = false;
    public winningLineLength = 7;
    private passTiebreaker = false;
    private tiebreaker?: playerid;
    private border = 2;

    constructor(state?: IIrenseiState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: IrenseiGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                winningLines: [],
                swapped: false,
                tiebreaker: undefined,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IIrenseiState;
            }
            if (state.game !== IrenseiGame.gameinfo.uid) {
                throw new Error(`The Irensei game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
        this.openingProtocol = this.getOpeningProtocol();
        this.toroidal = this.variants.some(v => v.startsWith("toroidal"));
        this.passTiebreaker = this.variants.includes("pass");
    }

    public load(idx = -1): IrenseiGame {
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
        this.swapped = state.swapped;
        this.tiebreaker = state.tiebreaker;
        this.lastmove = state.lastmove;
        this.boardSize = this.getBoardSize();
        return this;
    }

    protected getBoardSize(): number {
        // Get board size from variants.
        if (this.variants !== undefined && this.variants.length > 0 && this.variants[0] !== undefined && this.variants[0].length > 0) {
            const sizeVariants = this.variants.filter(v => v.includes("standard") || v.includes("toroidal"))
            if (sizeVariants.length > 0) {
                const size = sizeVariants[0].match(/\d+/);
                return parseInt(size![0], 10);
            }
            if (isNaN(this.boardSize)) {
                throw new Error(`Could not determine the board size from variant "${this.variants[0]}"`);
            }
        }
        return 19;
    }

    private getOpeningProtocol(): "none" | "swap-2" | "swap-5" {
        return this.variants.includes("swap-2") ? "swap-2" : this.variants.includes("swap-5") ? "swap-5" : "none";
    }

    private hasMoveGeneration(): boolean {
        // If the number of moves is too large, we don't want to generate the entire move list.
        if (this.openingProtocol === "swap-2" && this.stack.length < 3) { return false; }
        return true;
    }

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }
        if (!this.hasMoveGeneration()) {
            if (this.canSwap()) { return ["No movelist in opening", "pass"] }
            return ["No movelist in opening"]
        }
        const moves: string[] = [];
        for (let row = 0; row < this.boardSize; row++) {
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) { continue; }
                if (this.isSelfCapture(cell, player)) { continue; }
                moves.push(cell);
            }
        }
        if (this.canSwap() || this.pastOpening()) {
            moves.push("pass");
        }
        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    private canSwap(): boolean {
        // Check if the player is able to invoke the pie rule on this turn.
        if (this.openingProtocol === "swap-2") {
            if (this.stack.length === 2) { return true; }
            if (this.stack.length === 3 && this.stack[2].lastmove?.includes(",")) { return true; }
        }
        if (this.openingProtocol === "swap-5") {
            if (this.stack.length > 10) { return false; }
            if (this.stack.length === 1) { return false; }
            if (this.stack[this.stack.length - 1].lastmove === "pass") { return false; }
            const placeMoveCount = this.placeMoveCount();
            if (placeMoveCount < 6) { return true; }
        }
        return false;
    }

    private pastOpening(buffer = 2): boolean {
        // This is usually used to check if we are past the opening phase so that players can pass.
        // Pass is also used to invoke the pie rule during the opening phase.
        // For safety, passing is not allowed for the first two moves after the opening phase.
        if (this.openingProtocol === "none") {
            if (this.stack.length > buffer) { return true; }
        } else if (this.openingProtocol === "swap-2") {
            if (this.stack.length < 3) { return false; }
            if (this.stack.length > 4 + buffer) { return true; }
            if (this.stack[2].lastmove?.includes(",")) {
                return this.pastOpeningFunc(2, 0, true, buffer);
            } else {
                return this.pastOpeningFunc(1, 0, true, buffer);
            }
        } else if (this.openingProtocol === "swap-5") {
            return this.pastOpeningFunc(5, 4, true, buffer);
        }
        return false;
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

    private normalisePlacement(m: string): string {
        // Normalise placement string for swap-2 opening.
        // If there are three placements, sort the first and third placements.
        const moves = m.split(",");
        if (moves.length < 3) { return m; }
        let [first, second, third] = moves;
        [first, third] = this.sort(first, third) === -1 ? [first, third] : [third, first];
        return [first, second, third].join(",");
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = "";
            const cell = this.renderCoords2algebraic(col, row);
            if (move === "") {
                newmove = cell;
            } else {
                newmove = this.normalisePlacement(move + "," + cell);
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
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        if (m.length === 0) {
            let message = i18next.t("apgames:validation._inarow.INITIAL_INSTRUCTIONS");
            if (this.openingProtocol === "swap-2") {
                if (this.stack.length === 1) {
                    message = i18next.t("apgames:validation._inarow.INITIAL_INSTRUCTIONS_SWAP21");
                } else if (this.stack.length === 2) {
                    message = i18next.t("apgames:validation._inarow.INITIAL_INSTRUCTIONS_SWAP22");
                } else if (this.stack.length === 3 && this.canSwap()) {
                    message = i18next.t("apgames:validation._inarow.INITIAL_INSTRUCTIONS_SWAP23");
                }
            }
            if (this.openingProtocol === "swap-5" && this.canSwap()) {
                message = i18next.t("apgames:validation._inarow.INITIAL_INSTRUCTIONS_SWAP5");
            }
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = message;
            return result;
        }
        if (m === "No movelist in opening") {
            result.valid = false;
            result.complete = -1;
            result.message = i18next.t("apgames:validation._inarow.NO_MOVELIST");
            return result;
        }

        if (m === "pass") {
            if (!this.pastOpening(0)) {
                if (!this.canSwap()) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._inarow.CANNOT_SWAP");
                    return result;
                }
            } else if (!this.pastOpening()) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._inarow.CANNOT_PASS");
                return result;
            }
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
        const moves = m.split(",");
        // Valid cell
        let currentMove;
        try {
            for (const p of moves) {
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
        // No duplicate cells.
        if (moves.length > 1) {
            const seen: Set<string> = new Set();
            const duplicates: Set<string> = new Set();
            for (const move of moves) {
                if (seen.has(move)) {
                    duplicates.add(move);
                }
                seen.add(move);
            }
            if (duplicates.size > 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._inarow.DUPLICATE", { where: [...duplicates].join(",") });
                return result;
            }
        }
        if (this.isSelfCapture(moves[0], this.currplayer)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.irensei.SELFCAPTURE", { where: moves[0] });
            return result;
        }
        if (this.checkKo(moves[0], this.currplayer)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.irensei.KO");
            return result;
        }
        if (this.openingProtocol === "swap-2" && this.stack.length < 3) {
            if (this.stack.length === 1) {
                if (moves.length < 3) {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation._inarow.SWAP21", { count: 3 - moves.length });
                    return result;
                }
                if (moves.length > 3) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._inarow.SWAP21_EXCESS");
                    return result;
                }
            } else if (this.stack.length === 2) {
                if (moves.length < 2) {
                    result.valid = true;
                    result.complete = 0;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation._inarow.SWAP22_PARTIAL");
                    return result;
                }
                if (moves.length > 2) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._inarow.SWAP22_EXCESS");
                    return result;
                }
            }
        } else {
            if (moves.length > 1) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._inarow.EXCESS");
                return result;
            }
        }
        // Since there is no move list for placement phase, we have to do some extra validation.
        const regex = new RegExp(`^([a-z]+[1-9][0-9]*)(,[a-z]+[1-9][0-9]*)*$`);
        if (!regex.test(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._inarow.INVALID_PLACEMENT", {move: m});
            return result;
        }
        const normalised = this.normalisePlacement(m);
        if (m !== normalised) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._inarow.NORMALISE", {normalised});
            return result;
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
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
            for (const n of this.orthNeighbours(cell1)) {
                if (!this.board.has(n) && !opponentPlaced.includes(n) && n !== cell) {
                    liberties.add(n);
                    continue;
                }
                if (this.board.get(n) === player) { todo.push(n);
                }
            }
        }
        return [seen, liberties.size];
    }

    private getCaptures(cell: string, player: playerid): Set<string>[] {
        // Get all captured cells if `cell` is placed on the board.
        const allCaptures: Set<string>[] = []
        for (const n of this.orthNeighbours(cell)) {
            if (allCaptures.some(x => x.has(n)) || !this.board.has(n) || this.board.get(n) === this.currplayer) { continue; }
            const [group, liberties] = this.getGroupLiberties(n, [cell], player % 2 + 1 as playerid);
            if (liberties === 0) {
                const captures = new Set<string>();
                for (const c of group) {
                    captures.add(c);
                }
                if (captures.size > 0) { allCaptures.push(captures); }
            }
        }
        return allCaptures;
    }

    private isSelfCapture(cell: string, player: playerid): boolean {
        // Check if placing `cell` would result in a self-capture.
        if (this.hasInARow(...this.algebraic2coords(cell), player, 7, this.getPlayerColour(player) === 1)) { return false; }
        if (this.getCaptures(cell, player).length > 0) { return false; }
        return this.getGroupLiberties(cell, [], player)[1] === 0;
    }

    private checkKo(cell: string, player: playerid): boolean {
        // Check if the move is a ko.
        if (this.stack.length < 2) { return false; }
        const captures = this.getCaptures(cell, player);
        if (captures.length !== 1) { return false; }
        const previous = this.stack[this.stack.length - 1];
        const previousMove = previous.lastmove!;
        if (!captures.some(x => x.has(previousMove))) { return false; }
        const previousCaptures = previous._results.filter(r => r.type === "capture")
        if (previousCaptures.length !== 1) { return false; }
        return (previousCaptures[0] as Extract<APMoveResult, { type: 'capture' }>).count! === 1;
    }

    public move(m: string, {partial = false, trusted = false} = {}): IrenseiGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        let result;
        if (m === "No movelist in opening") {
            result = {valid: false, message: i18next.t("apgames:validation.pente.NO_MOVELIST")};
            throw new UserFacingError("VALIDATION_GENERAL", result.message);
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (!trusted) {
            result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
            if (!partial && this.hasMoveGeneration() && !this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}));
            }
        }
        if (m.length === 0) { return this; }
        this.results = [];
        if (m === "pass") {
            if (this.canSwap()) {
                // Swap all pieces on the board.
                this.swapped = !this.swapped;
                this.board.forEach((v, k) => {
                    this.board.set(k, v === 1 ? 2 : 1);
                })
                this.results.push({ type: "pie" });
            } else if (this.pastOpening()) {
                if (this.passTiebreaker && this.tiebreaker === undefined) {
                    this.tiebreaker = this.currplayer;
                    this.results.push({ type: "pass", why: "tiebreaker" });
                } else {
                    this.results.push({ type: "pass" });
                }
            }
        } else {
            const moves = m.split(",");
            let placePlayer = this.currplayer;
            for (const move of moves) {
                this.results.push({ type: "place", where: move });
                this.board.set(move, placePlayer);
                placePlayer = placePlayer % 2 + 1 as playerid;
            }
            const allCaptures = this.getCaptures(moves[0], this.currplayer);
            if (allCaptures.length > 0) {
                for (const captures of allCaptures) {
                    for (const capture of captures) { this.board.delete(capture); }
                    this.results.push({ type: "capture", where: [...captures].join(), count: captures.size });
                }
            }
        }
        if (partial) { return this; }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): IrenseiGame {
        const winningLinesMap = this.getWinningLinesMap([this.player1()], this.toroidal ? 0 : 2);
        const winner: playerid[] = [];
        if (this.currplayer === this.player2()) {
            if (this.lastmove !== undefined && !this.specialMove(this.lastmove) && this.lastmove !== "pass" && this.lastmove.split(",").length === 1) {
                if (this.isOverlineAll(...this.algebraic2coords(this.lastmove), this.player1())) {
                    winner.push(this.currplayer);
                }
            }
        }
        if (this.winner.length === 0) {
            this.winningLines = [];
            for (const player of [1, 2] as playerid[]) {
                if (winningLinesMap.get(player)!.length > 0) {
                    winner.push(player);
                    this.winningLines.push(...winningLinesMap.get(player)!);
                }
            }
        }
        if (winner.length === 0 && this.pastOpening(1)) {
            if (this.lastmove === "pass" && this.stack[this.stack.length - 1].lastmove === "pass" ||
                    !this.hasEmptySpace()) {
                if (this.passTiebreaker) {
                    if (this.tiebreaker === undefined) {
                        winner.push(this.swapped ? 1 : 2);
                    } else {
                        winner.push(this.tiebreaker);
                    }
                } else {
                    winner.push(1);
                    winner.push(2);
                }
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

    private getOverlines(player: playerid): Set<string> {
        // Get all restrictions for `player` assuming that faults apply.
        const faults = new Set<string>();
        for (let i = 0; i < this.boardSize; i++) {
            for (let j = 0; j < this.boardSize; j++) {
                const cell = this.coords2algebraic(j, i);
                if (this.isOverlineAll(j, i, player, 7)) {
                    faults.add(cell);
                }
            }
        }
        return faults;
    }

    public render(opts?: { altDisplay: string | undefined }): APRenderRep {
        let altDisplay: string | undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }
        let showRestrictions = true;
        if (altDisplay !== undefined) {
            if (altDisplay === "hide-restrictions") {
                showRestrictions = false;
            }
        }
        // Build piece string
        let pstr = "";
        const renderBoardSize = this.toroidal ? this.boardSize + 2 * this.toroidalPadding : this.boardSize;
        const overlines = showRestrictions && !this.gameover ? this.getOverlines(this.player1()) : new Map();
        for (let row = 0; row < renderBoardSize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            for (let col = 0; col < renderBoardSize; col++) {
                const cell = this.renderCoords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell);
                    if (contents === 1) {
                        pstr += "A";
                    } else if (contents === 2) {
                        pstr += "B";
                    }
                } else if (overlines.has(cell)) {
                    pstr += "E";
                } else {
                    pstr += "-";
                }
            }
        }
        pstr = pstr.replace(new RegExp(`-{${renderBoardSize}}`, "g"), "_");
        const referencePoints: [number, number][] = [];
        if (this.boardSize === 15) {
            referencePoints.push([(this.boardSize - 1) / 2, (this.boardSize - 1) / 2]);
            referencePoints.push([(this.boardSize - 1) / 2 - 4, (this.boardSize - 1) / 2 - 4]);
            referencePoints.push([(this.boardSize - 1) / 2 - 4, (this.boardSize - 1) / 2 + 4]);
            referencePoints.push([(this.boardSize - 1) / 2 + 4, (this.boardSize - 1) / 2 - 4]);
            referencePoints.push([(this.boardSize - 1) / 2 + 4, (this.boardSize - 1) / 2 + 4]);
        } else if (this.boardSize === 19) {
            referencePoints.push([(this.boardSize - 1) / 2, (this.boardSize - 1) / 2]);
            referencePoints.push([(this.boardSize - 1) / 2 - 6, (this.boardSize - 1) / 2 - 6]);
            referencePoints.push([(this.boardSize - 1) / 2 - 6, (this.boardSize - 1) / 2 + 6]);
            referencePoints.push([(this.boardSize - 1) / 2 + 6, (this.boardSize - 1) / 2 - 6]);
            referencePoints.push([(this.boardSize - 1) / 2 + 6, (this.boardSize - 1) / 2 + 6]);
            referencePoints.push([(this.boardSize - 1) / 2, (this.boardSize - 1) / 2 - 6]);
            referencePoints.push([(this.boardSize - 1) / 2, (this.boardSize - 1) / 2 + 6]);
            referencePoints.push([(this.boardSize - 1) / 2 - 6, (this.boardSize - 1) / 2]);
            referencePoints.push([(this.boardSize - 1) / 2 + 6, (this.boardSize - 1) / 2]);
        }
        const referencePointsObj: { row: number, col: number }[] = [];
        for (const point of referencePoints) {
            for (const [x1, y1] of this.renderCoordsAll(...point)) {
                referencePointsObj.push({ row: y1, col: x1 });
            }
        }
        let markers: Array<any> | undefined = referencePointsObj.length > 0 ? [{ type: "dots", points: referencePointsObj }] : [];
        const end = this.toroidal ? this.boardSize + 2 * this.toroidalPadding : this.boardSize;
        const padding = this.toroidal ? this.toroidalPadding : this.border;
        markers.push(...[
            {
                type: "shading", colour: "#000", opacity: 0.2,
                points: [{row: 0, col: 0}, {row: 0, col: padding}, {row: end - 1, col: padding}, {row: end - 1, col: 0}],
            },
            {
                type: "shading", colour: "#000", opacity: 0.2,
                points: [{row: 0, col: end - 1 - padding}, {row: 0, col: end - 1}, {row: end - 1, col: end - 1}, {row: end - 1, col: end - 1 - padding}],
            },
            {
                type: "shading", colour: "#000", opacity: 0.2,
                points: [{row: 0, col: padding}, {row: 0, col: end - 1 - padding}, {row: padding, col: end - 1 - padding}, {row: padding, col: padding}],
            },
            {
                type: "shading", colour: "#000", opacity: 0.2,
                points: [{row: end - 1 - padding, col: padding}, {row: end - 1 - padding, col: end - 1 - padding}, {row: end - 1, col: end - 1 - padding}, {row: end - 1, col: padding}],
            },
        ]);
        if (markers.length === 0) { markers = undefined; }
        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "vertex",
                width: renderBoardSize,
                height: renderBoardSize,
                rowLabels: this.toroidal ? this.renderRowLabels() : undefined,
                columnLabels: this.toroidal ? this.renderColLabels() : undefined,
                markers,
            },
            legend: {
                A: [{ name: "piece", player: this.getPlayerColour(1) as playerid }],
                B: [{ name: "piece", player: this.getPlayerColour(2) as playerid }],
                E: [
                    { name: "piece-borderless", colour: "#FFF" },
                    { name: "piece-borderless", player: 1 as playerid, opacity: 0.2 },
                    { text: "6+" },
                ],
            },
            pieces: pstr,
        };

        // @ts-ignore
        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const coordsAll = this.renderAlgebraic2coords(move.where!);
                    for (const [x, y] of coordsAll) {
                        rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                    }
                } else if (move.type === "capture") {
                    for (const cell of move.where!.split(",")) {
                        const coordsAll = this.renderAlgebraic2coords(cell);
                        for (const [x, y] of coordsAll) {
                            rep.annotations.push({ type: "exit", targets: [{ row: y, col: x }] });
                        }
                    }
                }
            }
            const renderWinningLines = this.renderWinningLines(this.winningLines);
            if (renderWinningLines.length > 0) {
                for (const connPath of renderWinningLines) {
                    if (connPath.length === 1) { continue; }
                    type RowCol = {row: number; col: number;};
                    const targets: RowCol[] = [];
                    for (const coords of connPath) {
                        targets.push({row: coords[1], col: coords[0]})
                    }
                    // @ts-ignore
                    rep.annotations.push({type: "move", targets, arrow: false});
                }
            }
        }
        return rep;
    }

    public state(): IIrenseiState {
        return {
            game: IrenseiGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: IrenseiGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            winningLines: this.winningLines.map(a => [...a]),
            swapped: this.swapped,
            tiebreaker: this.tiebreaker,
        };
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
                node.push(i18next.t("apresults:PLACE.nowhat", { player, where: r.where }));
                resolved = true;
                break;
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.noperson.group_nowhere", { player, count: r.count }));
                resolved = true;
                break;
            case "pass":
                node.push(i18next.t("apresults:PASS.pie", { player }));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): IrenseiGame {
        return new IrenseiGame(this.serialize());
    }
}
