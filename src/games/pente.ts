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
    lastmove?: string;
    captureCounts: [number, number];
    winningLines: string[][];
    swapped: boolean;
}

export interface IPenteState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class PenteGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Pente",
        uid: "pente",
        playercounts: [2],
        version: "20240328",
        dateAdded: "2024-03-28",
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
            { uid: "size-15", group: "board" },
            { uid: "swap2", group: "opening" },
            { uid: "swap5", group: "opening" },
            { uid: "overline-forbidden", group: "overline" },
            // { uid: "overline-ignored", group: "overline" },  // A lot of edge cases when pieces capture to form 5-in-a-rows.
            { uid: "capture-2-3", group: "capture" },
            { uid: "self-capture", group: "self-capture" },
            { uid: "self-capture-forbidden", group: "self-capture" },
            { uid: "overtime-capture", group: "overtime-capture" },
        ],
        categories: ["goal>align", "mechanic>place", "mechanic>capture", "board>shape>rect", "board>connect>rect", "components>simple"],
        flags: ["experimental", "scores", "multistep", "custom-colours", "check", "rotate90"],
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
    public captureCounts: [number, number] = [0, 0];
    public swapped = false;
    private boardSize = 0;
    private openingProtocol: "pro" | "swap2" | "swap5";
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
        return 19;
    }

    private getThreshold(): number {
        return this.variants.includes("capture-2-3") ? 15 : 10;
    }

    private getOpeningProtocol(): "pro" | "swap2" | "swap5" {
        return this.variants.includes("swap2") ? "swap2" : this.variants.includes("swap5") ? "swap5" : "pro";
    }

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }
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
        if (this.stack.length === 1 && this.openingProtocol === "swap2") {
            return ["No movelist in swap2 opening"]
            // The swap2 opening has too many possible moves to list them all.
            // // Get all double cells such that we don't get reversed duplicates.
            // // For example, doubleCells = [["a1", "a2"], ["a2", "a1"]] is not allowed.
            // const doubleCells: string[][] = [];
            // for (let row = 0; row < this.boardSize; row++) {
            //     for (let col = 0; col < this.boardSize; col++) {
            //         const cell = this.coords2algebraic(col, row);
            //         for (let row1 = row; row1 < this.boardSize; row1++) {
            //             for (let col1 = row1 === row ? col + 1 : 0; col1 < this.boardSize; col1++) {
            //                 const cell1 = this.coords2algebraic(col1, row1);
            //                 doubleCells.push([cell, cell1]);
            //             }
            //         }
            //     }
            // }
            // // Now we get a third cell for each doubleCell
            // for (const doubleCell of doubleCells) {
            //     for (let row = 0; row < this.boardSize; row++) {
            //         for (let col = 0; col < this.boardSize; col++) {
            //             const cell = this.coords2algebraic(col, row);
            //             if (!doubleCell.includes(cell)) {
            //                 moves.push(this.normalisePlacement(doubleCell[0] + "," + cell + "," + doubleCell[1]));
            //             }
            //         }
            //     }
            // }
            // return moves;
        }
        for (let row = 0; row < this.boardSize; row++) {
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) { continue; }
                if (this.variants.includes("self-capture-forbidden") && this.getSelfCaptures(cell).length > 0) { continue; }
                moves.push(cell);
            }
        }
        // This is also for swap2 and it seems like it's also too heavy for the dropdown box.
        // if (this.stack.length === 2 && this.openingProtocol === "swap2") {
        //     // Get all pairs of cells
        //     // We don't check for forbidden self-captures here because it's too expensive.
        //     for (let row = 0; row < this.boardSize; row++) {
        //         for (let col = 0; col < this.boardSize; col++) {
        //             const cell = this.coords2algebraic(col, row);
        //             for (let row1 = 0; row1 < this.boardSize; row1++) {
        //                 for (let col1 = 0; col1 < this.boardSize; col1++) {
        //                     const cell1 = this.coords2algebraic(col1, row1);
        //                     if (cell !== cell1) {
        //                         moves.push(cell + "," + cell1);
        //                     }
        //                 }
        //             }
        //         }
        //     }
        // }
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
        if (this.openingProtocol === "pro") { return false; }
        if (this.openingProtocol === "swap2") {
            if (this.stack.length === 2) { return true; }
            if (this.stack.length === 3 && this.stack[2].lastmove?.includes(",")) { return true; }
            return false;
        }
        if (this.openingProtocol === "swap5") {
            if (this.stack.length === 1) { return false; }
            if (this.stack[this.stack.length - 1].lastmove === "pass") { return false; }
            let count = 0;
            for (const slice of this.stack) {
                if (slice.lastmove !== "pass") { count++; }
                if (count > 6) { return false; }
            }
            return true;
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
        // Normalise placement string for swap2 opening.
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
            const cell = this.coords2algebraic(col, row);
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
            let message = i18next.t("apgames:validation.pente.INITIAL_INSTRUCTIONS");
            if (this.openingProtocol === "swap2") {
                if (this.stack.length === 1) {
                    message = i18next.t("apgames:validation.pente.INITIAL_INSTRUCTIONS_SWAP21");
                } else if (this.stack.length === 2) {
                    message = i18next.t("apgames:validation.pente.INITIAL_INSTRUCTIONS_SWAP22");
                } else if (this.stack.length === 3 && this.canSwap()) {
                    message = i18next.t("apgames:validation.pente.INITIAL_INSTRUCTIONS_SWAP23");
                }
            }
            if (this.openingProtocol === "swap5" && this.canSwap()) {
                message = i18next.t("apgames:validation.pente.INITIAL_INSTRUCTIONS_SWAP5");
            }
            if (this.openingProtocol === "pro") {
                if (this.stack.length === 1) {
                    message = i18next.t("apgames:validation.pente.INITIAL_INSTRUCTIONS_PRO1");
                } else if (this.stack.length === 3) {
                    message = i18next.t("apgames:validation.pente.INITIAL_INSTRUCTIONS_PRO3");
                }
            }
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = message;
            return result;
        }
        if (m === "No movelist in swap2 opening") {
            // Special for swap2 because move list is too large on first move.
            result.valid = false;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.pente.NO_MOVELIST");
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
                result.message = i18next.t("apgames:validation.pente.CANNOT_SWAP");
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
                result.message = i18next.t("apgames:validation.pente.DUPLICATE", { where: [...duplicates].join(",") });
                return result;
            }
        }
        if (this.openingProtocol === "swap2" && this.stack.length < 3) {
            if (this.stack.length === 1) {
                if (moves.length < 3) {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.pente.SWAP21", { count: 3 - moves.length });
                    return result;
                }
                if (moves.length > 3) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.pente.SWAP21_EXCESS");
                    return result;
                }
            } else if (this.stack.length === 2) {
                if (moves.length < 2) {
                    if (this.variants.includes("self-capture-forbidden")) {
                        if (this.getSelfCaptures(moves[0]).length > 0) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.pente.SELF_CAPTURE_FORBIDDEN");
                            return result;
                        }
                    }
                    result.valid = true;
                    result.complete = 0;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.pente.SWAP22_PARTIAL");
                    return result;
                }
                if (moves.length > 2) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.pente.SWAP22_EXCESS");
                    return result;
                }
                if (moves.length > 1 && this.variants.includes("self-capture-forbidden")) {
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
                result.message = i18next.t("apgames:validation.pente.EXCESS");
                return result;
            }
        }
        if (this.openingProtocol === "pro") {
            if (this.stack.length === 1 && !this.isNearCentre(moves[0], 0)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pente.PRO_RESTRICTION_FIRST");
                return result;
            }
            if (this.stack.length === 3 && this.isNearCentre(moves[0], 2)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pente.PRO_RESTRICTION_THIRD");
                return result;
            }
        }
        if (this.variants.includes("self-capture-forbidden")) {
            if (this.getSelfCaptures(moves[0]).length > 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pente.SELF_CAPTURE_FORBIDDEN");
                return result;
            }
        }
        if (this.variants.includes("overline-forbidden")) {
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
            result.message = i18next.t("apgames:validation.pente.INVALID_PLACEMENT", {move: m});
            return result;
        }
        const normalised = this.normalisePlacement(m);
        if (m !== normalised) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.pente.NORMALISE", {normalised});
            return result;
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private isNearCentre(cell: string, distance: number): boolean {
        // Check if a cell is within a certain Manhattan distance from the centre.
        const [x, y] = this.algebraic2coords(cell);
        const centre = (this.boardSize - 1) / 2;
        return Math.abs(x - centre) <= distance && Math.abs(y - centre) <= distance;
    }

    private getCaptures(place: string): string[] {
        // Get captures given a placement at a given cell.
        const captures: string[] = [];
        const [x, y] = this.algebraic2coords(place);
        const player = this.currplayer;
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
                    const [x1, y1] = [x + i * dx, y + i * dy];
                    if (x1 < 0 || x1 >= this.boardSize || y1 < 0 || y1 >= this.boardSize) { break; }
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

    private getSelfCaptures(place: string): string[] {
        // Get self-captures given a placement at a given cell.
        const captures: string[] = [];
        const [x, y] = this.algebraic2coords(place);
        const player = this.currplayer;
        const deltas = [[0, 1], [1, 0], [1, 1], [1, -1]];
        const checkDistances = this.variants.includes("capture-2-3") ? [2, 3] : [2];
        for (const [dx, dy] of deltas) {
            loop:
            for (const distance of checkDistances) {
                const tentativeCaptures: string[] = [];
                // We traverse in both the positive and negative directions.
                // If we find that there is exactly `distance` stones in a row for that combined direction,
                // and they are surronded by the opponent then there is a self-capture.
                let captureCount = 1;
                for (const sign of [-1, 1]) {
                    for (let i = 1; i <= distance + 1; i++) {
                        const [x1, y1] = [x + sign * i * dx, y + sign * i * dy];
                        if (x1 < 0 || x1 >= this.boardSize || y1 < 0 || y1 >= this.boardSize) { continue loop; }
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
                    const [x1, y1] = [x + sign * i * dx, y + sign * i * dy];
                    if (x1 < 0 || x1 >= this.boardSize || y1 < 0 || y1 >= this.boardSize) { break; }
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
        // A cature looks like XOOX, or OXXO, where X is the player and O is the opponent.
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
        if (m === "No movelist in swap2 opening") {
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
            // Because move generation is quite heavy, we don't do it for swap2 opening.
            if (!partial && (this.openingProtocol !== "swap2" || this.stack.length > 2) && !this.moves().includes(m)) {
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
            this.results.push({ type: "pass" });
        } else {
            const moves = m.split(",");
            let placePlayer = this.currplayer;
            for (const move of moves) {
                this.results.push({ type: "place", where: move });
                this.board.set(move, placePlayer);
                const captures = this.getCaptures(move);
                const selfCaptures = this.variants.includes("self-capture") ? this.getSelfCaptures(move) : [];
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
        }
        if (partial) { return this; }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    private checkLines(startX: number, startY: number, dx: number, dy: number, inARow = 5, exact = false): string[][] {
        // Check for winning lines in a given direction.
        // Returns an array of winning lines, which are arrays of cells that are all occupied by the same player.
        // `inARow` is the minimum number of pieces in a row to return a winning line.
        // exact determines whether the line must be exactly `inARow` or at least `inARow`.
        let currentPlayer: playerid | undefined;
        let currentCounter = 0;
        let cells: string[] = [];
        const winningLines: string[][] = [];

        for (let x = startX, y = startY; x < this.boardSize && y < this.boardSize; x += dx, y += dy) {
            const cell = this.coords2algebraic(x, y);
            const player = this.board.has(cell) ? this.board.get(cell) : undefined;
            if (player !== undefined && currentPlayer === player) {
                currentCounter++;
                cells.push(cell);
            }
            if (player !== currentPlayer || x === this.boardSize - 1 || y === this.boardSize - 1){
                if (exact && currentCounter === inARow || !exact && currentCounter >= inARow) {
                    winningLines.push(cells);
                }
                currentPlayer = player;
                currentCounter = currentPlayer === undefined ? 0 : 1;
                if (cells.length > 0) { cells = []; }
                if (player !== undefined) { cells.push(cell); }
            }
        }
        return winningLines;
    }

    private getWinningLinesMap(): Map<playerid, string[][]> {
        const winningLines = new Map<playerid, string[][]>([
            [1, []],
            [2, []],
        ]);
        // If the overline-ignored variant is enabled, we only check for exact 5-in-a-row.
        const exact = this.variants.includes("overline-ignored");
        // Check rows
        for (let j = 0; j < this.boardSize; j++) {
            const lines = this.checkLines(0, j, 1, 0, 5, exact);
            for (const line of lines) {
                const player = this.board.get(line[0]);
                winningLines.get(player!)!.push(line);
            }
        }

        // Check columns
        for (let i = 0; i < this.boardSize; i++) {
            const lines = this.checkLines(i, 0, 0, 1, 5, exact);
            for (const line of lines) {
                const player = this.board.get(line[0]);
                winningLines.get(player!)!.push(line);
            }
        }

        // Check diagonals from bottom-left to top-right
        for (let i = 0; i < this.boardSize; i++) {
            const lines = this.checkLines(i, 0, -1, 1, 5, exact).concat(this.checkLines(this.boardSize - 1, i + 1, -1, 1, 5, exact));
            for (const line of lines) {
                const player = this.board.get(line[0]);
                winningLines.get(player!)!.push(line);
            }
        }

        // Check diagonals from top-left to bottom-right
        for (let i = 0; i < this.boardSize; i++) {
            const lines = this.checkLines(i, 0, 1, 1, 5, exact).concat(this.checkLines(0, i + 1, 1, 1, 5, exact));
            for (const line of lines) {
                const player = this.board.get(line[0]);
                winningLines.get(player!)!.push(line);
            }
        }

        return winningLines;
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
        if (this.variants.includes("overtime-capture")) {
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
        const winningLinesMap = this.getWinningLinesMap();
        const winner: playerid[] = [];
        this.winningLines = [];
        for (const player of [1, 2] as playerid[]) {
            if (winningLinesMap.get(player)!.length > 0) {
                // If the overtime-capture variant is enabled, players win if they have a 5-in-a-row at the end of the opponent's turn.
                if (!this.variants.includes("overtime-capture") || this.variants.includes("overtime-capture") && player === this.currplayer) {
                    winner.push(player);
                }
                this.winningLines.push(...winningLinesMap.get(player)!);
            }
        }
        if (winner.length === 0) {
            // In the case of overtime-capture, not being able to break the 5-in-a-row takes priority over potential win elsewhere.
            const winnerCaptureCount = this.getWinnerCaptureCount();
            if (winnerCaptureCount !== undefined && !winner.includes(winnerCaptureCount)) {
                winner.push(winnerCaptureCount);
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
                    const contents = this.board.get(cell);
                    if (contents === 1) {
                        pstr += "A";
                    } else if (contents === 2) {
                        pstr += "B";
                    }
                } else {
                    pstr += "-";
                }
            }
        }
        pstr = pstr.replace(new RegExp(`-{${this.boardSize}}`, "g"), "_");
        let markers: Array<any> | undefined = []
        if (this.variants.includes("capture-2-3")) {
            markers.push({
                belowGrid: true, type: "shading", colour: "#FFA500", opacity: 0.1,
                points: [{row: 0, col: 0}, {row: 0, col: this.boardSize - 1}, {row: this.boardSize - 1, col: this.boardSize - 1}, {row: this.boardSize - 1, col: 0}],
            });
        }
        if (this.openingProtocol === "pro" && this.stack.length === 1) {
            markers.push({
                type: "dots", points: [{ row: (this.boardSize - 1) / 2, col: (this.boardSize - 1) / 2 }]
            });
        }
        if (markers.length === 0) {
            markers = undefined;
        }
        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "vertex",
                width: this.boardSize,
                height: this.boardSize,
                markers,
            },
            legend: {
                A: [{ name: "piece", player: this.getPlayerColour(1) as playerid }],
                B: [{ name: "piece", player: this.getPlayerColour(2) as playerid }],
            },
            pieces: pstr,
        };

        // @ts-ignore
        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                } else if (move.type === "capture") {
                    for (const cell of move.where!.split(",")) {
                        const [x, y] = this.algebraic2coords(cell);
                        rep.annotations.push({ type: "exit", targets: [{ row: y, col: x }] });
                    }
                }
            }
            if (this.winningLines.length > 0) {
                for (const connPath of this.winningLines) {
                    type RowCol = {row: number; col: number;};
                    const targets: RowCol[] = [];
                    for (const cell of connPath) {
                        const [x,y] = this.algebraic2coords(cell);
                        targets.push({row: y, col: x})
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
