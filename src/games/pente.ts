import { IAPGameState, IClickResult, IIndividualState, IRenderOpts, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { InARowBase } from "./in_a_row/InARowBase";

type playerid = 1 | 2;

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
    captureCounts: [number, number];
    winningLines: string[][];
    swapped: boolean;
}

export interface IPenteState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class PenteGame extends InARowBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Pente",
        uid: "pente",
        playercounts: [2],
        version: "20240328",
        dateAdded: "2024-04-20",
        // i18next.t("apgames:descriptions.pente")
        description: "apgames:descriptions.pente",
        urls: ["https://boardgamegeek.com/boardgame/1295/pente"],
        people: [
            {
                type: "designer",
                name: "Tom Braunlich",
            },
            {
                type: "designer",
                name: "Gary Gabrel",
            },
        ],
        variants: [
            { uid: "standard-19", group: "board" },
            { uid: "swap-2", group: "opening" },
            { uid: "swap-5", group: "opening" },
            { uid: "capture-2-3", group: "capture" },
            { uid: "self-capture", group: "self-capture" },
            { uid: "overtime-capture", group: "overtime-capture" },
        ],
        categories: ["goal>align", "mechanic>place", "mechanic>capture", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["scores", "multistep", "custom-colours", "check", "rotate90"],
        displays: [{uid: "hide-threatened"}],
    };

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, playerid>;
    public winningLines: string[][] = [];
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    public captureCounts: [number, number] = [0, 0];
    public swapped = false;
    public boardSize = 0;
    public toroidal = false;
    public overline;
    public winningLineLength = 5;
    private openingProtocol: "pro" | "swap-2" | "swap-5";
    private overtimeCapture: boolean;
    private selfCapture: "ignored" | "allowed" | "forbidden";
    private threshold: number;
    private dots: string[] = [];

    constructor(state?: IPenteState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: PenteGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                captureCounts: [0, 0],
                winningLines: [],
                swapped: false,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IPenteState;
            }
            if (state.game !== PenteGame.gameinfo.uid) {
                throw new Error(`The Pente game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
        this.openingProtocol = this.getOpeningProtocol();
        this.threshold = this.getThreshold();
        this.overline = this.getOverlineType();
        this.toroidal = this.variants.some(v => v.startsWith("toroidal"));
        this.overtimeCapture = this.getOvertimeCapture();
        this.selfCapture = this.getSelfCaptureType();
    }

    public load(idx = -1): PenteGame {
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
        this.captureCounts = [...state.captureCounts];
        this.winningLines  = state.winningLines.map(a => [...a]);
        this.swapped = state.swapped;
        this.lastmove = state.lastmove;
        this.boardSize = this.getBoardSize();
        return this;
    }

    private getThreshold(): number {
        return this.variants.includes("capture-2-3") ? 15 : 10;
    }

    private getOpeningProtocol(): "pro" | "swap-2" | "swap-5" {
        return this.variants.includes("swap-2") ? "swap-2" : this.variants.includes("swap-5") ? "swap-5" : "pro";
    }

    private getOverlineType(): "win" | "ignored" | "forbidden" {
        if (this.variants.includes("overline-ignored")) { return "ignored"; }
        if (this.variants.includes("overline-forbidden")) { return "forbidden"; }
        return "win";
    }

    private getOvertimeCapture(): boolean {
        return this.variants.includes("overtime-capture");
    }

    private getSelfCaptureType(): "ignored" | "allowed" | "forbidden" {
        if (this.variants.includes("self-capture")) { return "allowed"; }
        if (this.variants.includes("self-capture-forbidden")) { return "forbidden"; }
        return "ignored";
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
        if (this.stack.length === 1 && this.openingProtocol === "pro") {
            return [this.coords2algebraic((this.boardSize - 1) / 2, (this.boardSize - 1) / 2)];
        }
        if (this.stack.length === 3 && this.openingProtocol === "pro") {
            for (let row = 0; row < this.boardSize; row++) {
                for (let col = 0; col < this.boardSize; col++) {
                    const cell = this.coords2algebraic(col, row);
                    if (this.isNearCentre(cell, 2)) { continue; }
                    if (!this.board.has(cell)) {
                        moves.push(cell);
                    }
                }
            }
            return moves;
        }
        for (let row = 0; row < this.boardSize; row++) {
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) { continue; }
                if (this.selfCapture === "forbidden" && this.getSelfCaptures(cell, player).length > 0) { continue; }
                moves.push(cell);
            }
        }
        if (this.canSwap()) {
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
            if (this.openingProtocol === "pro") {
                if (this.stack.length === 1) {
                    message = i18next.t("apgames:validation._inarow.INITIAL_INSTRUCTIONS_PRO1");
                } else if (this.stack.length === 3) {
                    message = i18next.t("apgames:validation._inarow.INITIAL_INSTRUCTIONS_PRO3");
                }
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
            if (this.canSwap()) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation._inarow.CANNOT_SWAP");
                return result;

            }
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
                    if (this.selfCapture === "forbidden") {
                        if (this.getSelfCaptures(moves[0]).length > 0) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation._inarow.SELF_CAPTURE_FORBIDDEN");
                            return result;
                        }
                    }
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
                if (moves.length > 1 && this.selfCapture === "forbidden") {
                    if (this.hasCapturesOnBoard(moves)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.pente.SWAP22_CAPTURE");
                        return result;
                    }
                }
            }
        } else {
            if (moves.length > 1) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._inarow.EXCESS");
                return result;
            }
        }
        if (this.openingProtocol === "pro") {
            if (this.stack.length === 1 && !this.isNearCentre(moves[0], 0)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._inarow.PRO_RESTRICTION_FIRST");
                return result;
            }
            if (this.stack.length === 3 && this.isNearCentre(moves[0], 2)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._inarow.PRO_RESTRICTION_THIRD");
                return result;
            }
        }
        if (this.selfCapture === "forbidden") {
            if (this.getSelfCaptures(moves[0]).length > 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pente.SELF_CAPTURE_FORBIDDEN");
                return result;
            }
        }
        if (this.overline === "forbidden") {
            if (this.hasOverlines(moves[0])) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pente.OVERLINE_FORBIDDEN");
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

    private getCaptures(place: string, player?: playerid): string[] {
        // Get captures given a placement at a given cell.
        if (player === undefined) {
            player = this.currplayer;
        }
        const captures: string[] = [];
        const [x, y] = this.algebraic2coords(place);
        const deltas = [
            [-1, 0], [1, 0], [0, -1], [0, 1],
            [-1, -1], [1, 1], [-1, 1], [1, -1],
        ];
        // For the default variant, look for custodian captures exactly 2 stones away.
        // For the 2-3 variant, look for custodian captures exactly 2 or 3 stones away.
        const checkDistances = this.variants.includes("capture-2-3") ? [2, 3] : [2];
        for (const [dx, dy] of deltas) {
            for (const distance of checkDistances) {
                const tentativeCaptures: string[] = [];
                for (let i = 1; i <= distance + 1; i++) {
                    const [x1, y1, wrapped] = this.wrap(x + i * dx, y + i * dy);
                    if (!this.toroidal && wrapped) { break; }
                    const cell = this.coords2algebraic(x1, y1);
                    if (!this.board.has(cell)) { break; }
                    if (i <= distance) {
                        if (this.board.get(cell) === player) { break; }
                        tentativeCaptures.push(cell);
                        continue;
                    }
                    if (this.board.get(cell) !== player) { break; }
                    captures.push(...tentativeCaptures);
                }
            }
        }
        return captures;
    }

    private getSelfCaptures(place: string, player?: playerid): string[] {
        // Get self-captures given a placement at a given cell.
        if (player === undefined) {
            player = this.currplayer;
        }
        const captures: string[] = [];
        const [x, y] = this.algebraic2coords(place);
        const deltas = [[0, 1], [1, 0], [1, 1], [1, -1]];
        const checkDistances = this.variants.includes("capture-2-3") ? [2, 3] : [2];
        for (const [dx, dy] of deltas) {
            loop:
            for (const distance of checkDistances) {
                const tentativeCaptures: string[] = [];
                // We traverse in both the positive and negative directions.
                // If we find that there is exactly `distance` stones in a row for that combined direction,
                // and they are surrounded by the opponent then there is a self-capture.
                let captureCount = 1;
                for (const sign of [-1, 1]) {
                    for (let i = 1; i <= distance + 1; i++) {
                        const [x1, y1, wrapped] = this.wrap(x + sign * i * dx, y + sign * i * dy);
                        if (!this.toroidal && wrapped) { continue loop; }
                        const cell = this.coords2algebraic(x1, y1);
                        if (!this.board.has(cell)) { continue loop; }
                        if (this.board.get(cell) === player) {
                            captureCount++;
                            if (captureCount > distance) { continue loop; }
                            tentativeCaptures.push(cell);
                            continue;
                        }
                        break;
                    }
                }
                if (captureCount === distance) {
                    captures.push(...tentativeCaptures);
                }
            }
        }
        if (captures.length > 0) { captures.push(place); }
        return captures;
    }

    private hasOverlines(place: string, overlineLength = 6): boolean {
        // Get self-captures given a placement at a given cell.
        const [x, y] = this.algebraic2coords(place);
        const player = this.currplayer;
        const deltas = [[0, 1], [1, 0], [1, 1], [1, -1]];
        for (const [dx, dy] of deltas) {
            // We traverse in both the positive and negative directions.
            let alignCount = 1;
            for (const sign of [-1, 1]) {
                let i = 1;
                while (true) {
                    const [x1, y1, wrapped] = this.wrap(x + sign * i * dx, y + sign * i * dy);
                    if (!this.toroidal && wrapped) { break; }
                    const cell = this.coords2algebraic(x1, y1);
                    if (!this.board.has(cell)) { break; }
                    if (this.board.get(cell) === player) {
                        alignCount++;
                        if (alignCount >= overlineLength) { return true; }
                        i++;
                        continue;
                    }
                    break;
                }
            }
        }
        return false;
    }


    private checkPatterns(startX: number, startY: number, dx: number, dy: number, places: string[], playerPlaced: string[], winningPatterns: string[]): boolean {
        let line = "";
        for (let x = startX, y = startY; x < this.boardSize && y < this.boardSize; x += dx, y += dy) {
            const cell = this.coords2algebraic(x, y);
            if (!this.board.has(cell) && !places.includes(cell)) {
                line += ".";
                continue;
            }
            const player = this.board.get(cell);
            if (player === this.currplayer || playerPlaced.includes(cell)) {
                line += "X";
                continue;
            }
            line += "O";
        }
        return winningPatterns.some(pattern => line.includes(pattern));
    }

    private hasCapturesOnBoard(places: string[]): boolean {
        // Used to check if there are illegal placements for the self-captures-forbidden variant.
        // We assume that if there are multiple placements, pieces alternate in colours.
        const playerPlaced: string[] = [];
        for (const [i, place] of places.entries()) {
            if (i % 2 === 0) {
                playerPlaced.push(place);
            }
        }
        // A capture looks like XOOX, or OXXO, where X is the player and O is the opponent.
        // In the captures-2-3 variant, captures can also look like XOOOX or OXXXO.
        const winningPatterns = this.variants.includes("capture-2-3") ? ["XOOX", "OXXO", "XOOOX", "OXXXO"] : ["XOOX", "OXXO"];
        for (let i = 0; i < this.boardSize; i++) {
            if (this.checkPatterns(0, i, 1, 0, places, playerPlaced, winningPatterns)) { return true; }
            if (this.checkPatterns(i, 0, 0, 1, places, playerPlaced, winningPatterns)) { return true; }
            if (this.checkPatterns(i, 0, 1, 1, places, playerPlaced, winningPatterns)) { return true; }
            if (this.checkPatterns(0, i + 1, 1, 1, places, playerPlaced, winningPatterns)) { return true; }
            if (this.checkPatterns(i, 0, -1, 1, places, playerPlaced, winningPatterns)) { return true; }
            if (this.checkPatterns(this.boardSize - 1, i + 1, -1, 1, places, playerPlaced, winningPatterns)) { return true; }
        }
        return false;
    }

    public move(m: string, {partial = false, trusted = false} = {}): PenteGame {
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
        this.dots = [];
        this.results = [];
        if (m === "pass") {
            // Swap all pieces on the board.
            this.swapped = !this.swapped;
            this.board.forEach((v, k) => {
                this.board.set(k, v === 1 ? 2 : 1);
            })
            this.captureCounts = [this.captureCounts[1], this.captureCounts[0]];
            this.results.push({ type: "pie" });
        } else {
            const moves = m.split(",");
            let placePlayer = this.currplayer;
            for (const move of moves) {
                this.results.push({ type: "place", where: move });
                this.board.set(move, placePlayer);
                const captures = this.getCaptures(move);
                const selfCaptures = this.selfCapture === "allowed" ? this.getSelfCaptures(move) : [];
                for (const capture of captures) {
                    this.captureCounts[placePlayer - 1]++;
                    this.board.delete(capture);
                }
                if (captures.length > 0) {
                    this.results.push({ type: "capture", where: captures.join(","), count: captures.length });
                }
                for (const capture of selfCaptures) {
                    this.captureCounts[placePlayer % 2]++;
                    this.board.delete(capture);
                }
                if (selfCaptures.length > 0) {
                    this.results.push({ type: "capture", where: selfCaptures.join(","), count: selfCaptures.length, what: "self" });
                }
                placePlayer = placePlayer % 2 + 1 as playerid;
            }
            if (this.stack.length === 2 && this.openingProtocol === "swap-2" && moves.length === 2) {
                this.swapped = !this.swapped;
                this.board.forEach((v, k) => {
                    this.board.set(k, v === 1 ? 2 : 1);
                })
            }
        }
        if (partial) { return this; }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    private getWinnerCaptureCount(): playerid | undefined {
        // Check for capture count win.
        // In order to count, there must be at least `minCount` captures,
        // and a player must have more captures than the opponent.
        // This handles the edge cases where a player makes a capture with a self-capture
        // and the scores are tied.
        const captureCount1 = this.captureCounts[0];
        const captureCount2 = this.captureCounts[1];
        if (captureCount1 >= this.threshold && captureCount1 > captureCount2) {
            return 1;
        }
        if (captureCount2 >= this.threshold && captureCount2 > captureCount1) {
            return 2;
        }
        return undefined;
    }

    public inCheck(): number[] {
        // Only for when overtime-capture variant is enabled, players can only win
        // when they have a 5-in-a-row at the end of the opponent's turn.
        const checks: playerid[] = [];
        if (this.overtimeCapture && !this.gameover) {
            const winningLinesMap = this.getWinningLinesMap();
            for (const player of [1, 2] as playerid[]) {
                if (winningLinesMap.get(player)!.length > 0) {
                    checks.push(player % 2 + 1 as playerid);
                }
            }
        }
        return checks;
    }

    protected checkEOG(): PenteGame {
        const winningLinesMap = this.getWinningLinesMap(this.overline === "ignored" ? [1, 2] : []);
        const winner: playerid[] = [];
        this.winningLines = [];
        for (const player of [1, 2] as playerid[]) {
            if (winningLinesMap.get(player)!.length > 0) {
                // If the overtime-capture variant is enabled, players win if they have a 5-in-a-row at the end of the opponent's turn.
                if (!this.overtimeCapture || this.overtimeCapture && player === this.currplayer) {
                    this.winningLines.push(...winningLinesMap.get(player)!);
                    winner.push(player);
                }
            }
        }
        if (winner.length === 0 || this.stack.length > 1 && this.stack[this.stack.length - 1].winningLines.length === 0) {
            // In the case of overtime-capture, not being able to break the 5-in-a-row takes priority over potential win elsewhere.
            const winnerCaptureCount = this.getWinnerCaptureCount();
            if (winnerCaptureCount !== undefined && !winner.includes(winnerCaptureCount)) {
                winner.push(winnerCaptureCount);
            }
        }
        if (winner.length === 0) {
            if (!this.hasEmptySpace()) {
                winner.push(1);
                winner.push(2);
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

    public state(): IPenteState {
        return {
            game: PenteGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: PenteGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            captureCounts: [...this.captureCounts],
            winningLines: this.winningLines.map(a => [...a]),
            swapped: this.swapped,
        };
    }

    public getPlayerColour(p: playerid): number | string {
        if (p === 1) {
            return this.swapped ? 2 : 1;
        }
        return this.swapped ? 1 : 2;
    }

    private getThreatened(): [Set<string>, Set<string>] {
        // Get all threatened cells for both players.
        const threatened1: Set<string> = new Set();
        const threatened2: Set<string> = new Set();
        for (let row = 0; row < this.boardSize; row++) {
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) { continue; }
                if (this.selfCapture !== "forbidden" || this.getSelfCaptures(cell, 2).length > 0) {
                    this.getCaptures(cell, 2).forEach((capture) => threatened1.add(capture));
                }
                if (this.selfCapture !== "forbidden" || this.getSelfCaptures(cell, 1).length > 0) {
                    this.getCaptures(cell, 1).forEach((capture) => threatened2.add(capture));
                }
            }
        }
        return [threatened1, threatened2];
    }

    public render(opts?: IRenderOpts): APRenderRep {
        let altDisplay: string | undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }
        let showThreatened = true;
        if (altDisplay !== undefined) {
            if (altDisplay === "hide-threatened") {
                showThreatened = false;
            }
        }
        const [threatened1, threatened2]: [Set<string>, Set<string>] = showThreatened ? this.getThreatened() : [new Set(), new Set()];
        // Build piece string
        let pstr = "";
        const renderBoardSize = this.toroidal ? this.boardSize + 2 * this.toroidalPadding : this.boardSize;
        for (let row = 0; row < renderBoardSize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            for (let col = 0; col < renderBoardSize; col++) {
                const cell = this.renderCoords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell);
                    if (contents === 1) {
                        if (threatened1.has(cell)) {
                            pstr += "C";
                        } else {
                            pstr += "A";
                        }
                    } else if (contents === 2) {
                        if (threatened2.has(cell)) {
                            pstr += "D";
                        } else {
                            pstr += "B";
                        }
                    }
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
        if (this.variants.includes("capture-2-3")) {
            markers.push({
                belowGrid: true, type: "shading", colour: "#FFA500", opacity: 0.1,
                points: [{row: 0, col: 0}, {row: 0, col: renderBoardSize - 1}, {row: renderBoardSize - 1, col: renderBoardSize - 1}, {row: renderBoardSize - 1, col: 0}],
            });
        }
        if (this.toroidal) {
            const end = this.boardSize + 2 * this.toroidalPadding;
            markers.push(...[
                {
                    type: "shading", colour: "#000", opacity: 0.2,
                    points: [{row: 0, col: 0}, {row: 0, col: this.toroidalPadding}, {row: end - 1, col: this.toroidalPadding}, {row: end - 1, col: 0}],
                },
                {
                    type: "shading", colour: "#000", opacity: 0.2,
                    points: [{row: 0, col: end - 1 - this.toroidalPadding}, {row: 0, col: end - 1}, {row: end - 1, col: end - 1}, {row: end - 1, col: end - 1 - this.toroidalPadding}],
                },
                {
                    type: "shading", colour: "#000", opacity: 0.2,
                    points: [{row: 0, col: this.toroidalPadding}, {row: 0, col: end - 1 - this.toroidalPadding}, {row: this.toroidalPadding, col: end - 1 - this.toroidalPadding}, {row: this.toroidalPadding, col: this.toroidalPadding}],
                },
                {
                    type: "shading", colour: "#000", opacity: 0.2,
                    points: [{row: end - 1 - this.toroidalPadding, col: this.toroidalPadding}, {row: end - 1 - this.toroidalPadding, col: end - 1 - this.toroidalPadding}, {row: end - 1, col: end - 1 - this.toroidalPadding}, {row: end - 1, col: this.toroidalPadding}],
                },
            ]);
        }
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
                C: [
                    { name: "piece-borderless", scale: 1.1, player: this.getPlayerColour(2) as playerid },
                    { name: "piece", player: this.getPlayerColour(1) as playerid },
                ],
                D: [
                    { name: "piece-borderless", scale: 1.1, player: this.getPlayerColour(1) as playerid },
                    { name: "piece", player: this.getPlayerColour(2) as playerid },
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
        if (this.dots.length > 0) {
            const points = [];
            for (const cell of this.dots) {
                const [x, y] = this.algebraic2coords(cell);
                points.push({ row: y, col: x });
            }
            // @ts-ignore
            rep.annotations.push({ type: "dots", targets: points });
        }
        return rep;
    }

    public getPlayerScore(player: playerid): number {
        return this.captureCounts[player - 1];
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.SCORES"), scores: [`${this.getPlayerScore(1)} / ${this.threshold}`, `${this.getPlayerScore(2)} / ${this.threshold}`] },
        ]
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Scores**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const score = this.getPlayerScore(n as playerid);
            status += `Player ${n}: ${score} / ${this.threshold}\n\n`;
        }

        status += "**In Check**\n\n";
        status += `In check: ${this.inCheck().join(",")}\n\n`;

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
                if (r.what === "self") {
                    node.push(i18next.t("apresults:CAPTURE.pente_self", { player, count: r.count }));
                } else {
                    node.push(i18next.t("apresults:CAPTURE.pente", { player, count: r.count }));
                }
                resolved = true;
                break;
            case "pass":
                node.push(i18next.t("apresults:PASS.pie", { player }));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): PenteGame {
        return new PenteGame(this.serialize());
    }
}
