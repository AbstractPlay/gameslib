import {
    GameBase,
    IAPGameState,
    IClickResult,
    ICustomButton,
    IIndividualState,
    IValidationResult,
    type ChatLogCollectContext,
    type ChatLogLine,
} from "./_base.js";
import type { APGamesInformation } from "../schemas/gameinfo.js";
import { APRenderRep, AnnotationBasic } from "@abstractplay/renderer/build/schemas/schema";
import type { APMoveResult } from "../schemas/moveresults.js";
import { generateColumnLabel, reviver, UserFacingError } from "../common/index.js";
import i18next from "i18next";
export const gameApgamesEn = {
    validation: {
        ALREADY_DECLARED: "Someone has already declared. You can not declare now.",
        BAD_PLACEMENT: "You can not play at {{where}}. It would be adjacent or overlapping with another mirador. The only adjacency allowed is diagonal to one of your own miradors.",
        CANNOT_DECLARE_OPENING: "You can not declare until the opening is complete.",
        CANNOT_PASS: "You can only pass during the opening, when it gives you a choice of colours.",
        INITIAL_INSTRUCTIONS: "Place a mirador, or, if you think your connection is unassailable, declare",
        INITIAL_INSTRUCTIONS_CHALLENGE: "Place as many miradors as you would like.",
        INITIAL_INSTRUCTIONS_PIE: "Place a mirador, pass to swap colours, or, if you think your connection is unassailable, declare.",
        INITIAL_INSTRUCTIONS_SWAP21: "Place three miradors: one of your colour, one of the opponent's colour, then one of your colour. The opponent then chooses sides.",
        INITIAL_INSTRUCTIONS_SWAP22: "You may do one of (1) place a single mirador to continue with your colour, (2) pass to swap colours, or (3) place two more miradors (one of your colour, then one of the opponent's) and let the opponent choose sides.",
        INITIAL_INSTRUCTIONS_SWAP23: "Choose sides: place a mirador to take the colour that is to move (you move now), or pass to keep your colour and let the opponent move.",
        INITIAL_INSTRUCTIONS_SWAP5: "Place a mirador, or pass to swap colours.",
        NO_EDGE_PLAY: "You can not play on the very edge of the board.",
        NO_MOVELIST: "Move list not available during this opening move. Click on the board to place miradors.",
        SINGLE_PLACEMENT: "You can only place one mirador.",
        SWAP21_one: "Place one more mirador.",
        SWAP21_other: "Place {{count}} more miradors.",
        SWAP21_EXCESS: "You have placed too many miradors. You may only place three.",
        SWAP22_EXCESS: "You have placed too many miradors. You may only place two.",
        SWAP22_PARTIAL: "Complete the move to continue with your colour, or place another mirador to let the opponent choose sides.",
        VALID_PARTIAL_MOVE: "Keep placing miradors until you have broken all the opponent's connections.",
    },
    variants: {
        "#board": {
            name: "28x28 board",
        },
        "#opening": {
            description: "After the first mirador is placed, the second player may pass to swap colours. The miradors never change colour; only who plays each colour does.",
            name: "Simple pie",
        },
        "size-40": {
            name: "40x40 board",
        },
        "swap-2": {
            description: "The first player places three miradors: one of their colour, one of the opponent's, then one of theirs. The next player may do one of (1) place a single mirador to continue with their colour, (2) pass to swap colours, or (3) place two more miradors and let the first player choose sides, by placing a mirador to take the colour that is to move or by passing to keep their own. The miradors never change colour; only who plays each colour does. Declaring is not allowed until the opening is complete.",
            name: "Swap-2 opening",
        },
        "swap-5": {
            description: "For the first five miradors on the board, after each placement, the next player may pass to swap colours. The miradors never change colour; only who plays each colour does. Declaring is not allowed until five miradors have been placed.",
            name: "Swap-5 opening",
        },
    },
};


export type playerid = 1 | 2;
export type CellContents = null | 1 | 2;
export type Stage = "play" | "challenge";

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    // The stored grid is one row and column smaller than the rendered board.
    // A placement at (x, y) occupies a 2x2 block from board[y][x] through board[y + 1][x + 1].
    board: Array<Array<CellContents>>;
    stage: Stage;
    lastmove?: string;
    // Whether the swap openings have given the players each other's colour (absent in older games).
    swapped?: boolean;
}

export interface IMiradorState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
}

export class MiradorGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Mirador",
        uid: "mirador",
        playercounts: [2],
        version: "20230729",
        dateAdded: "2023-08-25",
        description: "Mirador is a fast and exhilarating connection game played on a square grid (28 x 28 by default) by placing 2 x 2 squares to represent watchtowers. It uses line-of-sight connections and equivalent goals (making it more of a race than a pure connection game).",
        notes: "Declaring takes your entire turn. Complete your unassailable connection first, then declare on your next turn; you cannot place a mirador and declare on the same turn.",
        urls: [
            "https://www.abstractgames.org/mirador.html",
            "https://boardgamegeek.com/boardgame/65822/mirador",
        ],
        bggid: "65822",
        people: [
            {
                type: "designer",
                name: "Andrew Perkis",
            },
            {
                type: "coder",
                name: "fritzd",
                urls: [],
                apid: "a96b36a2-2c9d-4597-8c4a-f926062a45b6",
            },
        ],
        variants: [
            {
                uid: "#board",
            },
            {
                uid: "size-40",
                group: "board",
            },
            {
                uid: "#opening",
            },
            {
                uid: "swap-2",
                group: "opening",
            },
            {
                uid: "swap-5",
                group: "opening",
            },
        ],
        categories: ["goal>connect", "mechanic>block",  "mechanic>place", "board>shape>rect", "board>connect>rect", "components>simple>pnp"],
        // every opening, the simple pie included, handles its colour decisions in-engine
        flags: ["custom-buttons", "custom-colours"],
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Array<Array<CellContents>>;
    public stage: Stage = "play";
    public swapped = false;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    private static readonly defaultBoardSize = 28;

    private get boardSize(): number {
        const sizeVariant = this.variants.find((variant) => /^size-\d+$/.test(variant));
        if (sizeVariant === undefined) {
            return MiradorGame.defaultBoardSize;
        }
        return Number.parseInt(sizeVariant.slice("size-".length), 10);
    }

    private get gridSize(): number {
        return this.boardSize - 1;
    }

    private get placementSize(): number {
        return this.boardSize - 2;
    }

    private get openingProtocol(): "pie" | "swap-2" | "swap-5" {
        return this.variants.includes("swap-2") ? "swap-2" : this.variants.includes("swap-5") ? "swap-5" : "pie";
    }

    // The colour of a player's miradors. The swap openings may give the players each other's
    // colour; the miradors on the board never change colour.
    private colourOf(player: playerid): playerid {
        return this.swapped ? (player === 1 ? 2 : 1) : player;
    }

    public getPlayerColour(p: playerid): number {
        return this.colourOf(p);
    }

    private miradorCount(): number {
        let cells = 0;
        for (let row = 0; row < this.gridSize; row++) {
            for (let col = 0; col < this.gridSize; col++) {
                if (this.board[row][col] !== null) {
                    cells++;
                }
            }
        }
        return cells / 4;
    }

    // Turns so far that placed miradors (colour decisions and the declaration don't count).
    private placeMoveCount(): number {
        let count = 0;
        for (const slice of this.stack) {
            if (slice.lastmove !== undefined && slice.lastmove !== "pass" && slice.lastmove !== "declare") {
                count++;
            }
        }
        return count;
    }

    // In the swap-2 opening, whether the second player has placed two extra miradors, leaving
    // the first player to choose sides.
    private choosingSides(): boolean {
        return this.openingProtocol === "swap-2" && this.stack.length === 3 && (this.stack[2].lastmove?.includes("-") ?? false);
    }

    // Whether the opening protocol is still being played out; declaring waits until it's done.
    private inOpening(): boolean {
        if (this.openingProtocol === "swap-2") {
            return this.stack.length <= 2 || this.choosingSides();
        } else if (this.openingProtocol === "swap-5") {
            return this.placeMoveCount() < 5;
        }
        return false;
    }

    // The colour decision open to the player to move, if any. As in the gomoku family, it is made
    // by passing. "swap": passing takes the opponent's colour. "keep", offered to the first player
    // after the second player's two extra miradors in the swap-2 opening: passing keeps their
    // colour and hands the move over, while placing a mirador takes the colour that is to move.
    private decision(): "swap" | "keep" | undefined {
        if (this.stage !== "play") { return undefined; }
        if (this.openingProtocol === "pie") {
            // the simple pie: one chance to swap, right after the first mirador
            if (this.stack.length === 2) { return "swap"; }
        } else if (this.openingProtocol === "swap-2") {
            if (this.stack.length === 2) { return "swap"; }
            if (this.choosingSides()) { return "keep"; }
        } else if (this.openingProtocol === "swap-5") {
            // after each of the first five placements, unless the swap was just taken (the length
            // check is only a cheap way out once the opening is long over)
            if (this.stack.length > 10 || this.stack[this.stack.length - 1].lastmove === "pass") { return undefined; }
            const placed = this.placeMoveCount();
            return placed >= 1 && placed <= 5 ? "swap" : undefined;
        }
        return undefined;
    }

    // How many miradors this turn places, as [min, max]; only the swap-2 opening places more than one.
    private placementBounds(): [number, number] {
        if (this.openingProtocol === "swap-2") {
            if (this.stack.length === 1) { return [3, 3]; }
            if (this.stack.length === 2) { return [1, 2]; }
        }
        return [1, 1];
    }

    // The turns that may place several miradors have far too many moves to list.
    private hasMoveGeneration(): boolean {
        return this.placementBounds()[1] === 1;
    }

    // The colour of the mirador placed `index`-th this turn. In the play stage the colours simply
    // alternate across the whole game, so it follows from how many are down; in the challenge
    // stage every mirador is the challenger's.
    private placementColour(index: number): playerid {
        if (this.stage === "challenge") { return this.colourOf(this.currplayer); }
        return (this.miradorCount() + index) % 2 === 0 ? 1 : 2;
    }

    // The first turn of the swap-2 opening places two miradors of the first player's colour around one
    // of the opponent's. Swapping the first and third gives the same position, so list the smaller first.
    private normalisePlacement(m: string): string {
        if (this.openingProtocol !== "swap-2" || this.stack.length !== 1) { return m; }
        const placements = m.split("-");
        if (placements.length !== 3) { return m; }
        const [first, second, third] = placements;
        return (first <= third ? [first, second, third] : [third, second, first]).join("-");
    }

    constructor(state?: IMiradorState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const board = [];
            for (let row = 0; row < this.gridSize; row++) {
                const node: Array<CellContents> = [];
                for (let col = 0; col < this.gridSize; col++) {
                    node.push(null);
                }
                board.push(node);
            }
            const fresh: IMoveState = {
                _version: MiradorGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                stage: "play",
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IMiradorState;
            }
            if (state.game !== MiradorGame.gameinfo.uid) {
                throw new Error(
                    `The Mirador engine cannot process a game of '${state.game}'.`
                );
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): MiradorGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if (idx < 0 || idx >= this.stack.length) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = state.board.map((a) => {
            return { ...a };
        });
        this.stage = state.stage;
        this.swapped = state.swapped ?? false;
        this.lastmove = state.lastmove;
        this.results = [...state._results];
        return this;
    }

    public moves(): string[] {
        if (this.gameover) {
            return [];
        }
        const decision = this.decision();
        if (!this.hasMoveGeneration()) {
            return decision === undefined ? ["No movelist in opening"] : ["No movelist in opening", "pass"];
        }
        const moves: string[] = [];
        // placements
        const colour = this.placementColour(0);
        for (let x = 0; x < this.placementSize; x++) {
            for (let y = 0; y < this.placementSize; y++) {
                if (this.canPlace(this.board, colour, x, y)) {
                    moves.push(GameBase.coords2algebraic(x, y, this.placementSize));
                }
            }
        }
        if (decision !== undefined) {
            moves.push("pass");
        }
        if (this.stage === "play" && !this.inOpening()) {
            moves.push("declare");
        }
        return moves.sort((a, b) => a.localeCompare(b));
    }

    public getButtons(): ICustomButton[] {
        const buttons: ICustomButton[] = [];
        // The Declare button means custom buttons, which turn off the front end's own Pass
        // button, so the opening's pass is listed here with the standard label.
        if (this.decision() !== undefined) {
            buttons.push({ label: "apgames:buttons.pass", move: "pass" });
        }
        if (this.stage === "play" && !this.inOpening()) {
            buttons.push({ label: "apgames:buttons.declare", move: "declare" });
        }
        return buttons;
    }

    public handleClick(
        move: string,
        row: number,
        col: number,
        piece?: string
    ): IClickResult {
        try {
            // A Pass button may arrive as a click on "_btn_pass" (the playground sends it this way).
            if (piece === "_btn_pass") {
                const result = this.validateMove("pass") as IClickResult;
                result.move = result.valid ? "pass" : move;
                return result;
            }
            // a decision or declaration waiting to be submitted gives way to a placement
            if (move === "pass" || move === "declare") {
                move = "";
            }
            // A click that is not taken leaves the move as it was, so that miradors already placed
            // this turn stay on the board, and says why.
            const keepMove = (reason: string): IClickResult => {
                if (move.length === 0) {
                    return { move, valid: false, message: reason };
                }
                const kept = this.validateMove(move) as IClickResult;
                kept.move = move;
                if (kept.valid) {
                    kept.message = reason;
                }
                return kept;
            };
            if (col === 0 || col === this.boardSize - 1 || row === 0 || row === this.boardSize - 1) {
                return keepMove(i18next.t("apgames:validation.mirador.NO_EDGE_PLAY"));
            }
            const cell = GameBase.coords2algebraic(col - 1, row - 1, this.placementSize);
            const newmove = this.normalisePlacement(move ? `${move}-${cell}` : cell);
            const result = this.validateMove(newmove) as IClickResult;
            if (!result.valid) {
                return keepMove(result.message);
            }
            result.move = newmove;
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", {
                    move,
                    row,
                    col,
                    piece,
                    emessage: (e as Error).message,
                }),
            };
        }
    }

    // Whether the miradors of `player` (a colour) connect the two sides.
    private isConnected(horizontal: boolean, player: playerid): boolean {
        const localBoard = [];
        const work: [number, number][] = [];
        if (horizontal) {
            for (let row = 0; row < this.gridSize; row++) {
                const node: Array<number> = [];
                let seeleft = true;
                for (let col = 0; col < this.gridSize; col++) {
                    if (seeleft && this.board[row][col] === player) {
                        node.push(3); // 3 means connected to the left
                        work.push([row, col]);
                        seeleft = false;
                    } else if (this.board[row][col] !== null) {
                        node.push(this.board[row][col]!);
                        seeleft = false;
                    } else {
                        node.push(0);
                    }
                }
                localBoard.push(node);
            }
        } else {
            for (let col = 0; col < this.gridSize; col++) {
                const node: Array<number> = [];
                let seeleft = true;
                for (let row = 0; row < this.gridSize; row++) {
                    if (seeleft && this.board[row][col] === player) {
                        node.push(3);
                        work.push([col, row]); // transposing the board
                        seeleft = false;
                    } else if (this.board[row][col] !== null) {
                        node.push(this.board[row][col]!);
                        seeleft = false;
                    } else {
                        node.push(0);
                    }
                }
                localBoard.push(node);
            }
        }
        while (work.length > 0) {
            const start = work.pop()!;
            const dirs = [
                [-1, 0],
                [0, 1],
                [1, 0],
                [0, -1],
            ];
            for (const dir of dirs) {
                let dist = 1;
                while (true) {
                    const next: [number, number] = [start[0] + dir[0] * dist, start[1] + dir[1] * dist];
                    if (next[1] >= this.gridSize) {
                        return true;
                    }
                    if (next[0] < 0 || next[0] >= this.gridSize || next[1] < 0 || localBoard[next[0]][next[1]] === 3 - player || localBoard[next[0]][next[1]] === 3) {
                        break;
                    }
                    if (localBoard[next[0]][next[1]] === 3 - player) {
                        break;
                    }
                    if (localBoard[next[0]][next[1]] === player) {
                        localBoard[next[0]][next[1]] = 3;
                        work.push(next);
                        break;
                    }
                    dist++;
                }
            }
            const diags = [
                [-1, -1],
                [-1, 1],
                [1, 1],
                [1, -1],
            ];
            for (const dir of diags) {
                const next: [number, number] = [start[0] + dir[0], start[1] + dir[1]];
                if (! (next[0] < 0 || next[0] >= this.gridSize || next[1] < 0 || next[1] >= this.gridSize) && localBoard[next[0]][next[1]] === player) {
                    localBoard[next[0]][next[1]] = 3;
                    work.push(next);
                }
            }
        }
        return false;
    }

    // Whether a mirador of colour `player` may be placed at (x, y).
    private canPlace(board: Array<Array<CellContents>>, player: playerid, x: number, y: number): boolean {
        for (let dx = -1; dx <= 2; dx++) {
            for (let dy = -1; dy <= 2; dy++) {
                if (x + dx >= 0 && x + dx < this.gridSize && y + dy >= 0 && y + dy < this.gridSize && !(board[y + dy][x + dx] === null || ((dx === -1 || dx === 2) && (dy === -1 || dy === 2) && board[y + dy][x + dx] === player))) {
                    return false;
                }
            }
        }
        return true;
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {
            valid: false,
            message: i18next.t("apgames:validation._general.DEFAULT_HANDLER"),
        };

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            if (this.stage === "challenge") {
                result.message = i18next.t(
                    "apgames:validation.mirador.INITIAL_INSTRUCTIONS_CHALLENGE"
                );
            } else if (this.openingProtocol === "swap-2" && this.stack.length === 1) {
                result.message = i18next.t("apgames:validation.mirador.INITIAL_INSTRUCTIONS_SWAP21");
            } else if (this.openingProtocol === "swap-2" && this.stack.length === 2) {
                result.message = i18next.t("apgames:validation.mirador.INITIAL_INSTRUCTIONS_SWAP22");
            } else if (this.decision() === "keep") {
                result.message = i18next.t("apgames:validation.mirador.INITIAL_INSTRUCTIONS_SWAP23");
            } else if (this.decision() === "swap" && this.openingProtocol === "pie") {
                result.message = i18next.t("apgames:validation.mirador.INITIAL_INSTRUCTIONS_PIE");
            } else if (this.decision() === "swap") {
                result.message = i18next.t("apgames:validation.mirador.INITIAL_INSTRUCTIONS_SWAP5");
            } else {
                result.message = i18next.t(
                    "apgames:validation.mirador.INITIAL_INSTRUCTIONS"
                );
            }
            return result;
        }
        if (m === "No movelist in opening") {
            result.valid = false;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.mirador.NO_MOVELIST");
            return result;
        }
        if (m === "pass") {
            if (this.decision() !== undefined) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.mirador.CANNOT_PASS");
            }
            return result;
        }
        if (m === "declare") {
            if (this.stage !== "play") {
                result.valid = false;
                result.message = i18next.t("apgames:validation.mirador.ALREADY_DECLARED");
            } else if (this.inOpening()) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.mirador.CANNOT_DECLARE_OPENING");
            } else {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            }
            return result;
        }

        const placements = m.split("-");
        const [minPlacements, maxPlacements] = this.placementBounds();
        if (placements.length > maxPlacements && this.stage === "play") {
            result.valid = false;
            if (maxPlacements === 1) {
                result.message = i18next.t("apgames:validation.mirador.SINGLE_PLACEMENT");
            } else if (maxPlacements === 3) {
                result.message = i18next.t("apgames:validation.mirador.SWAP21_EXCESS");
            } else {
                result.message = i18next.t("apgames:validation.mirador.SWAP22_EXCESS");
            }
            return result;
        }

        const localBoard: Array<Array<CellContents>> = this.board.map((a) => {
            return { ...a };
        });
        for (const [index, placement] of placements.entries()) {
            const placeColour = this.placementColour(index);
            let coords;
            try {
                coords = GameBase.algebraic2coords(placement, this.placementSize);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {
                    cell: placement,
                });
                return result;
            }
            if (coords[0] < 0 || coords[0] >= this.placementSize || coords[1] < 0 || coords[1] >= this.placementSize) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {
                    cell: placement,
                });
                return result;
            }
            if (!this.canPlace(localBoard, placeColour, coords[0], coords[1])) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.mirador.BAD_PLACEMENT", { where: placement });
                return result;
            }
            localBoard[coords[1]][coords[0]] = placeColour;
            localBoard[coords[1]][coords[0] + 1] = placeColour;
            localBoard[coords[1] + 1][coords[0]] = placeColour;
            localBoard[coords[1] + 1][coords[0] + 1] = placeColour;
        }
        // Looks good
        if (this.stage === "play") {
            if (placements.length < minPlacements) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.mirador.SWAP21", { count: minPlacements - placements.length });
                return result;
            }
            const normalised = this.normalisePlacement(m);
            if (m !== normalised) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NORMALISE", { normalised });
                return result;
            }
            if (placements.length < maxPlacements) {
                result.valid = true;
                result.complete = 0;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.mirador.SWAP22_PARTIAL");
                return result;
            }
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        } else {
            result.valid = true;
            result.complete = 0;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.mirador.VALID_PARTIAL_MOVE");
            return result;
        }
    }

    public move(m: string, {partial = false, trusted = false} = {}): MiradorGame {
        if (this.gameover) {
            throw new UserFacingError(
                "MOVES_GAMEOVER",
                i18next.t("apgames:validation._general.MOVES_GAMEOVER")
            );
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (! trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
            // A turn still missing placements can't be submitted. This matters for the swap-2
            // opening's first turn of three miradors, which has no move list to check against.
            if (!partial && result.complete === -1) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
            if (!partial && this.stage === "play" && this.hasMoveGeneration() && !this.moves().includes(m)) {
                throw new UserFacingError(
                    "VALIDATION_FAILSAFE",
                    i18next.t("apgames:validation._general.FAILSAFE", { move: m })
                );
            }
        }

        this.results = [];
        if (m === "declare") {
            this.stage = "challenge";
            this.results.push({ type: "declare" });
        } else if (m === "pass") {
            if (this.decision() === "keep") {
                // the first player keeps their colour and hands the move over
                this.results.push({ type: "pass", why: "keep" });
            } else {
                // the players exchange colours; the miradors stay as they are
                this.swapped = !this.swapped;
                this.results.push({ type: "pie" });
            }
        } else {
            const placements = m.split("-");
            const colours = placements.map((_, i) => this.placementColour(i));
            // Placing a mirador of the colour that is to move when it isn't yours takes that colour:
            // this is how the first player chooses sides after the swap-2 opening's two extra miradors.
            if (this.stage === "play" && colours[0] !== this.colourOf(this.currplayer)) {
                this.swapped = !this.swapped;
            }
            for (const [i, placement] of placements.entries()) {
                const coords = GameBase.algebraic2coords(placement, this.placementSize);
                this.board[coords[1]][coords[0]] = colours[i];
                this.board[coords[1]][coords[0] + 1] = colours[i];
                this.board[coords[1] + 1][coords[0]] = colours[i];
                this.board[coords[1] + 1][coords[0] + 1] = colours[i];
            }
            this.results.push({ type: "place", where: m });
        }

        if (partial) {
            return this;
        }

        // update currplayer
        this.lastmove = m;
        let newplayer = (this.currplayer as number) + 1;
        if (newplayer > this.numplayers) {
            newplayer = 1;
        }
        this.currplayer = newplayer as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): MiradorGame {
        let prevPlayer: playerid = 1;
        if (this.currplayer === 1) {
            prevPlayer = 2;
        }
        if (this.stage === "challenge" && this.lastmove !== "declare") {
            this.gameover = true;
            const colour = this.colourOf(this.currplayer);
            if (this.isConnected(true, colour) || this.isConnected(false, colour)) {
                this.winner = [this.currplayer];
            } else {
                this.winner = [prevPlayer];
            }
        }
        if (this.gameover) {
            this.results.push(
                { type: "eog" },
                { type: "winners", players: [...this.winner] }
            );
        }
        return this;
    }

    public state(): IMiradorState {
        return {
            game: MiradorGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    public moveState(): IMoveState {
        return {
            _version: MiradorGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: this.board.map((a) => {
                return { ...a };
            }),
            stage: this.stage,
            swapped: this.swapped,
        };
    }

    public render(): APRenderRep {
        // Build piece string
        const border = "-".repeat(this.boardSize);
        let pstr = border;
        for (let row = 0; row < this.placementSize; row++) {
            pstr += "\n";
            const pieces: string[] = [];
            for (let col = 0; col < this.placementSize; col++) {
                if (this.board[row][col] !== null && this.board[row][col] === this.board[row][col + 1] && this.board[row][col] === this.board[row + 1][col] && this.board[row][col] === this.board[row + 1][col + 1]) {
                    pieces.push(this.board[row][col] === 1 ? "A" : "B");
                } else {
                    pieces.push("-");
                }
            }
            pstr += "-" + pieces.join("") + "-";
        }
        pstr += `\n${border}`;

        const labelIterator = generateColumnLabel("abcdefghijklmnopqrstuvwxyz");
        const columnLabels = Array.from(
            { length: this.placementSize },
            () => labelIterator.next().value as string,
        );
        const rowLabels = Array.from(
            { length: this.placementSize },
            (_, index) => (index + 1).toString(),
        );

        // Build rep
        const rep: APRenderRep = {
            options: ["hide-star-points"],
            board: {
                style: "vertex",
                width: this.boardSize,
                height: this.boardSize,
                columnLabels: ["", ...columnLabels, ""],
                rowLabels: ["", ...rowLabels, ""],
            },
            legend: {
                A: {
                    name: "piece-square",
                    scale: 2.1,
                    colour: 1
                },
                B: {
                    name: "piece-square",
                    scale: 2.1,
                    colour: 2
                },
            },
            pieces: pstr,
        };

        // Add annotations
        if (this.results.length > 0) {
            rep.annotations = [] as AnnotationBasic[];
            for (const move of this.results) {
                if (move.type === "place") {
                    for (const placement of move.where!.split("-")) {
                        const [x, y] = GameBase.algebraic2coords(placement, this.placementSize);
                        rep.annotations.push({type: "dots", targets: [{row: y + 1, col: x + 1}], size: 0.3, colour: "#f4ea56"});
                    }
                }
            }
        }

        return rep;
    }

    protected recordExportExclude(): string[] {
        return ["place", "move", "winners", "eog"];
    }

    public collectChatLogLine(lines: ChatLogLine[], r: APMoveResult, ctx: ChatLogCollectContext): boolean {
        switch (r.type) {
            case "pie":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:_general.PIE.default", {});
                return true;
            case "pass":
                if (r.why === "keep") {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:_general.PASS.keep", {});
                    return true;
                }
                return super.collectChatLogLine(lines, r, ctx);
            default:
                return super.collectChatLogLine(lines, r, ctx);
        }
    }

    public clone(): MiradorGame {
        return new MiradorGame(this.serialize());
    }
}
