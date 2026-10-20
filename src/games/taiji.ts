import { GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IScores, IValidationResult, type ChatLogCollectContext, type ChatLogLine } from "./_base.js";
import { APGamesInformation } from "../schemas/gameinfo.js";
import { APRenderRep, BoardBasic, Glyph, MarkerLine } from "@abstractplay/renderer/build/schemas/schema";
import type { APMoveResult } from "../schemas/moveresults.js";
import { RectGrid, reviver, UserFacingError } from "../common/index.js";
import i18next from "i18next";
export const gameApgamesEn = {
    validation: {
        ADJACENT: "Pieces must be placed adjacent to each other. Diagonal placement is only permitted in the \"Tonga\" variant.",
        CANNOT_PASS: "You can only pass during the opening, when it gives you a choice of colours.",
        INITIAL_INSTRUCTIONS: "Place a light piece in an empty space.",
        INITIAL_INSTRUCTIONS_SWAP: "Place a light piece in an empty space, or pass to swap colours.",
        INITIAL_INSTRUCTIONS_SWAP21: "Place three pairs of pieces, each a light piece and then a dark piece next to it. The opponent then chooses sides.",
        INITIAL_INSTRUCTIONS_SWAP22: "You may do one of (1) place a single pair of pieces to continue with your colour, (2) pass to swap colours, or (3) place two more pairs and let the opponent choose sides.",
        INITIAL_INSTRUCTIONS_SWAP23: "Choose sides: place a pair of pieces to keep your colour, or pass to swap colours and let the opponent move.",
        NO_MIRROR: "That move would leave the position with a rotational or reflectional symmetry (with the colours as they are or reversed), which the \"No mirroring\" variant forbids.",
        NO_MIRROR_CONTINUE: "The position would be symmetric after this pair, which is not allowed. Place another pair, or choose different spaces.",
        NO_MIRROR_DARK: "Every space for the dark piece next to that light piece would leave the position symmetric. Choose a different space for the light piece.",
        NO_MOVELIST: "Move list not available during this opening move. Click on the board to place pieces.",
        NO_NEIGHBOUR: "That space has no valid empty neighbour.",
        PARTIAL: "Place the dark piece in an adjacent empty space.",
        SWAP21_one: "Place one more pair of pieces.",
        SWAP21_other: "Place {{count}} more pairs of pieces.",
        SWAP21_EXCESS: "You have placed too many pieces. You may only place three pairs.",
        SWAP22_EXCESS: "You have placed too many pieces. You may only place two pairs.",
        SWAP22_PARTIAL: "Complete the move to continue with your colour, or place another pair of pieces to let the opponent choose sides.",
        TOO_MANY: "You have placed too many pieces. You may only place one pair.",
    },
    variants: {
        "#board": {
            name: "Default board: 9x9",
        },
        "#groups": {
            name: "Scoring: Largest two groups",
        },
        "#opening": {
            name: "No pie",
        },
        "#scoring": {
            name: "Simple sum",
        },
        "7x7": {
            name: "Smaller board: 7x7",
        },
        "11x11": {
            name: "Larger board: 11x11",
        },
        "15x15": {
            name: "Largest board: 15x15",
        },
        fivegroups: {
            name: "Scoring: Largest five groups",
        },
        nomirror: {
            description: "No move may leave the position with a rotational or reflectional symmetry, whether the colours are taken as they are or reversed. This applies during the swap openings too.",
            name: "No mirroring",
        },
        onegroup: {
            name: "Scoring: Single largest group",
        },
        pie: {
            description: "After the first pair of pieces is placed, the second player may pass to swap colours. The pieces never change colour; only who scores each colour does.",
            name: "Simple pie",
        },
        products: {
            description: "Multiplies together the sizes of your n largest groups.",
            name: "Product",
        },
        squares: {
            description: "Adds together the square of each of your n largest groups.",
            name: "Sum of Squares",
        },
        "swap-2": {
            description: "The first player places three pairs of pieces. The next player may do one of (1) place a single pair to continue with their colour, (2) pass to swap colours, or (3) place two more pairs and let the first player choose sides, by placing a pair to keep their colour or by passing to swap colours. The pieces never change colour; only who scores each colour does.",
            name: "Swap-2 opening",
        },
        "swap-5": {
            description: "For the first five pairs of pieces on the board, after each placement, the next player may pass to swap colours. The pieces never change colour; only who scores each colour does.",
            name: "Swap-5 opening",
        },
        threegroups: {
            name: "Scoring: Largest three groups",
        },
        tonga: {
            name: "Tonga (Diagonal Placement)",
        },
    },
    displays: {
        "fade-nonscoring": {
            description: "Draws the pieces of groups that do not count towards the score at 75% opacity.",
            name: "Fade non-scoring groups",
        },
    },
};


export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
    // Whether the swap openings have given the players each other's colour (absent in older games).
    swapped?: boolean;
};

export interface ITaijiState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class TaijiGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Taiji",
        uid: "taiji",
        playercounts: [2],
        version: "20211118",
        dateAdded: "2023-05-01",
        description: "Two players take turns placing one piece of each colour next to each other. The winner is the one who forms the largest orthogonal groups of their own colour.",
        notes: "Moves are done with two clicks. The first tile you place is always the light one, and then the dark one.",
        urls: ["https://boardgamegeek.com/boardgame/31926/taiji", "https://nestorgames.com/rulebooks/TAIJIDELUXE_EN.pdf"],
        bggid: "31926",
        people: [
            {
                type: "designer",
                name: "Néstor Romeral Andrés",
                urls: ["https://boardgamegeek.com/boardgamedesigner/9393/nestor-romeral-andres"]
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        variants: [
            {
                uid: "7x7",
                group: "board"
            },
            { uid: "#board", },
            {
                uid: "11x11",
                group: "board"
            },
            {
                uid: "15x15",
                group: "board"
            },
            {
                uid: "onegroup",
                group: "groups"
            },
            {
                uid: "threegroups",
                group: "groups"
            },
            {
                uid: "fivegroups",
                group: "groups"
            },
            {
                uid: "squares",
                group: "scoring",
            },
            {
                uid: "products",
                group: "scoring"
            },
            {
                uid: "tonga",
            },
            { uid: "#opening", },
            {
                uid: "pie",
                group: "opening",
            },
            {
                uid: "swap-2",
                group: "opening",
            },
            {
                uid: "swap-5",
                group: "opening",
            },
            {
                uid: "nomirror",
            },
        ],
        categories: ["goal>score>eog", "mechanic>place",  "mechanic>coopt", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["scores", "custom-colours"],
        displays: [{ uid: "fade-nonscoring" }],
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public boardSize = 9;
    public swapped = false;

    constructor(state?: ITaijiState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            const board = new Map<string, playerid>();
            if ( (variants !== undefined) && (variants.length > 0) && (variants[0] !== "") ) {
                this.variants = this.applyVariantConstraints(variants);
            }
            const fresh: IMoveState = {
                _version: TaijiGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ITaijiState;
            }
            if (state.game !== TaijiGame.gameinfo.uid) {
                throw new Error(`The Lines of Action engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): TaijiGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.swapped = state.swapped ?? false;
        this.lastmove = state.lastmove;
        this.results = [...state._results];
        this.boardSize = 9;
        const sizeVariant = this.variants.find(v => /^(\d+)x\1$/.test(v));
        if (sizeVariant !== undefined) {
            this.boardSize = parseInt(sizeVariant, 10);
        }
        return this;
    }

    private get openingProtocol(): "none" | "pie" | "swap-2" | "swap-5" {
        return this.variants.includes("pie") ? "pie" : this.variants.includes("swap-2") ? "swap-2" : this.variants.includes("swap-5") ? "swap-5" : "none";
    }

    private get noMirror(): boolean {
        return this.variants.includes("nomirror");
    }

    // The colour a player scores. The swap openings may give the players each other's colour;
    // the pieces on the board never change colour, and every move still places light then dark.
    private colourOf(player: playerid): playerid {
        return this.swapped ? (player === 1 ? 2 : 1) : player;
    }

    public getPlayerColour(p: playerid): number {
        return this.colourOf(p);
    }

    // Turns so far that placed pieces (colour decisions don't count).
    private placeMoveCount(): number {
        let count = 0;
        for (const slice of this.stack) {
            if (slice.lastmove !== undefined && slice.lastmove !== "pass") {
                count++;
            }
        }
        return count;
    }

    // In the swap-2 opening, whether the second player has placed two extra pairs, leaving the
    // first player to choose sides.
    private choosingSides(): boolean {
        return this.openingProtocol === "swap-2" && this.stack.length === 3 && (this.stack[2].lastmove?.includes(";") ?? false);
    }

    // Whether the player to move may pass to swap colours: the pie rule, made by passing as in the
    // gomoku family, for which the front end shows its own Pass button. Taiji has no other passes.
    // Every move places one piece of each colour, so no colour is ever "to move", and after the
    // second player's two extra pairs in the swap-2 opening the first player chooses sides the
    // same way: placing a pair keeps their colour, passing swaps.
    private canSwap(): boolean {
        if (this.openingProtocol === "pie") {
            // the simple pie: one chance to swap, right after the first pair
            return this.stack.length === 2;
        } else if (this.openingProtocol === "swap-2") {
            return this.stack.length === 2 || this.choosingSides();
        } else if (this.openingProtocol === "swap-5") {
            // after each of the first five placements, unless the swap was just taken (the length
            // check is only a cheap way out once the opening is long over)
            if (this.stack.length > 10 || this.stack[this.stack.length - 1].lastmove === "pass") { return false; }
            const placed = this.placeMoveCount();
            return placed >= 1 && placed <= 5;
        }
        return false;
    }

    // How many pairs of pieces this turn places, as [min, max]; only the swap-2 opening places more than one.
    private pairBounds(): [number, number] {
        if (this.openingProtocol === "swap-2") {
            if (this.stack.length === 1) { return [3, 3]; }
            if (this.stack.length === 2) { return [1, 2]; }
        }
        return [1, 1];
    }

    // The turns that may place several pairs have far too many moves to list.
    private hasMoveGeneration(): boolean {
        return this.pairBounds()[1] === 1;
    }

    private neighbours(cell: string): string[] {
        const [x, y] = TaijiGame.algebraic2coords(cell, this.boardSize);
        const grid = new RectGrid(this.boardSize, this.boardSize);
        return grid.adjacencies(x, y, this.variants.includes("tonga")).map(pt => TaijiGame.coords2algebraic(...pt, this.boardSize));
    }

    // Whether `cell` names a space on the board; malformed input does not.
    private onBoard(cell: string): boolean {
        try {
            const [x, y] = TaijiGame.algebraic2coords(cell, this.boardSize);
            return x >= 0 && x < this.boardSize && y >= 0 && y < this.boardSize;
        } catch {
            return false;
        }
    }

    // Whether the position has one of the board's rotational or reflectional symmetries,
    // with the colours either as they are or reversed.
    private isSymmetric(board: Map<string, playerid>): boolean {
        const n = this.boardSize;
        const transforms: ((x: number, y: number) => [number, number])[] = [
            (x, y) => [n - 1 - y, x],           // rotate 90
            (x, y) => [n - 1 - x, n - 1 - y],   // rotate 180
            (x, y) => [y, n - 1 - x],           // rotate 270
            (x, y) => [n - 1 - x, y],           // mirror left-right
            (x, y) => [x, n - 1 - y],           // mirror top-bottom
            (x, y) => [y, x],                   // mirror across one diagonal
            (x, y) => [n - 1 - y, n - 1 - x],   // mirror across the other diagonal
        ];
        const pieces: [number, number, playerid][] = [...board.entries()].map(([cell, colour]) => [...TaijiGame.algebraic2coords(cell, n), colour]);
        for (const transform of transforms) {
            for (const reversed of [false, true]) {
                let holds = true;
                for (const [x, y, colour] of pieces) {
                    const there = board.get(TaijiGame.coords2algebraic(...transform(x, y), n));
                    const wanted = reversed ? (colour === 1 ? 2 : 1) : colour;
                    if (there !== wanted) {
                        holds = false;
                        break;
                    }
                }
                if (holds) {
                    return true;
                }
            }
        }
        return false;
    }

    // Whether placing the pair on `board` leaves a symmetric position (`board` is left as it was).
    private pairIsSymmetric(board: Map<string, playerid>, light: string, dark: string): boolean {
        board.set(light, 1);
        board.set(dark, 2);
        const symmetric = this.isSymmetric(board);
        board.delete(light);
        board.delete(dark);
        return symmetric;
    }

    // Every legal single pair on `board`.
    private pairMoves(board: Map<string, playerid>): string[] {
        const moves: string[] = [];
        for (let row = 0; row < this.boardSize; row++) {
            for (let col = 0; col < this.boardSize; col++) {
                const cell = TaijiGame.coords2algebraic(col, row, this.boardSize);
                if (board.has(cell)) { continue; }
                for (const next of this.neighbours(cell)) {
                    if (board.has(next)) { continue; }
                    if (this.noMirror && this.pairIsSymmetric(board, cell, next)) { continue; }
                    moves.push(`${cell},${next}`);
                }
            }
        }
        return moves;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        if (!this.hasMoveGeneration()) {
            return this.canSwap() ? ["No movelist in opening", "pass"] : ["No movelist in opening"];
        }
        const moves = this.pairMoves(this.board);
        if (this.canSwap()) {
            moves.push("pass");
        }
        return moves;
    }

    // Sort two cells by column, then row (so "a10" comes after "a9").
    private comparePairs(a: string, b: string): number {
        const [ax, ay] = TaijiGame.algebraic2coords(a.split(",")[0], this.boardSize);
        const [bx, by] = TaijiGame.algebraic2coords(b.split(",")[0], this.boardSize);
        if (ax !== bx) { return ax - bx; }
        return by - ay;
    }

    // The pairs of a multi-pair opening move can be placed in any order, so list them sorted.
    private normalisePlacement(m: string): string {
        const pairs = m.split(";");
        if (pairs.length < 2 || pairs.some(p => !p.includes(","))) { return m; }
        return [...pairs].sort((a, b) => this.comparePairs(a, b)).join(";");
    }


    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            // A Pass button may arrive as a click on "_btn_pass" (the playground sends it this way).
            if (piece === "_btn_pass") {
                const result = this.validateMove("pass") as IClickResult;
                result.move = result.valid ? "pass" : move;
                return result;
            }
            const cell = TaijiGame.coords2algebraic(col, row, this.boardSize);
            // clicking on an occupied space resets
            if (this.board.has(cell)) {
                return {move: "", message: ""} as IClickResult;
            }
            // a colour decision waiting to be submitted gives way to a placement
            if (move === "pass") {
                move = "";
            }
            const pairs = move.length === 0 ? [] : move.split(";");
            const last = pairs.length > 0 ? pairs[pairs.length - 1] : undefined;
            let newmove: string;
            if (last === undefined || last.includes(",")) {
                // place a light piece, starting a new pair
                newmove = [...pairs, cell].join(";");
            } else {
                const light = last;
                const done = pairs.slice(0, -1);
                // if you clicked on the same space as before, just move your light piece
                if (cell === light) {
                    newmove = [...done, cell].join(";");
                } else {
                    const [x, y] = TaijiGame.algebraic2coords(light, this.boardSize);
                    const grid = new RectGrid(this.boardSize, this.boardSize);
                    const neighbours = grid.adjacencies(x, y, true).map(pt => TaijiGame.coords2algebraic(...pt, this.boardSize));
                    if (neighbours.includes(cell)) {
                        // place a dark piece if adjacent to light
                        newmove = [...done, `${light},${cell}`].join(";");
                    // otherwise, assume they want to replace the light piece at the new location
                    } else {
                        newmove = [...done, cell].join(";");
                    }
                }
            }
            newmove = this.normalisePlacement(newmove);
            const result = this.validateMove(newmove) as IClickResult;
            if (! result.valid) {
                result.move = move;
            } else {
                result.move = newmove;
            }
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", {move, row, col, piece, emessage: (e as Error).message})
            }
        }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            if (this.openingProtocol === "swap-2" && this.stack.length === 1) {
                result.message = i18next.t("apgames:validation.taiji.INITIAL_INSTRUCTIONS_SWAP21");
            } else if (this.openingProtocol === "swap-2" && this.stack.length === 2) {
                result.message = i18next.t("apgames:validation.taiji.INITIAL_INSTRUCTIONS_SWAP22");
            } else if (this.choosingSides()) {
                result.message = i18next.t("apgames:validation.taiji.INITIAL_INSTRUCTIONS_SWAP23");
            } else if (this.canSwap()) {
                result.message = i18next.t("apgames:validation.taiji.INITIAL_INSTRUCTIONS_SWAP");
            } else {
                result.message = i18next.t("apgames:validation.taiji.INITIAL_INSTRUCTIONS");
            }
            return result;
        }
        if (m === "No movelist in opening") {
            result.valid = false;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.taiji.NO_MOVELIST");
            return result;
        }
        if (m === "pass") {
            if (this.canSwap()) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.taiji.CANNOT_PASS");
            }
            return result;
        }

        const [minPairs, maxPairs] = this.pairBounds();
        const pairs = m.split(";");
        if (pairs.length > maxPairs) {
            result.valid = false;
            if (maxPairs === 1) {
                result.message = i18next.t("apgames:validation.taiji.TOO_MANY");
            } else if (maxPairs === 3) {
                result.message = i18next.t("apgames:validation.taiji.SWAP21_EXCESS");
            } else {
                result.message = i18next.t("apgames:validation.taiji.SWAP22_EXCESS");
            }
            return result;
        }

        // place the pairs on a copy so later pairs see the earlier ones
        const local = new Map(this.board);
        for (let i = 0; i < pairs.length; i++) {
            const parts = pairs[i].split(",");
            if (parts.length > 2) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALID_PLACEMENT", {move: m});
                return result;
            }
            const [light, dark] = parts;

            // valid cell
            if (!this.onBoard(light)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: light});
                return result;
            }
            // is empty
            if (local.has(light)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: light});
                return result;
            }
            // has at least one empty neighbour
            const neighbours = this.neighbours(light);
            const empties = neighbours.filter(n => !local.has(n));
            if (empties.length === 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.taiji.NO_NEIGHBOUR");
                return result;
            }

            if (dark === undefined) {
                // only the last pair may still be waiting for its dark piece
                if (i < pairs.length - 1) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALID_PLACEMENT", {move: m});
                    return result;
                }
                // in a single-pair turn, some dark placement must avoid a symmetric position
                if (this.noMirror && maxPairs === 1 && !empties.some(d => !this.pairIsSymmetric(local, light, d))) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.taiji.NO_MIRROR_DARK");
                    return result;
                }
                // valid partial
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.taiji.PARTIAL");
                return result;
            }

            // valid cell
            if (!this.onBoard(dark)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: dark});
                return result;
            }
            // is empty
            if (local.has(dark)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: dark});
                return result;
            }
            // is adjacent
            if (! neighbours.includes(dark)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.taiji.ADJACENT");
                return result;
            }
            local.set(light, 1);
            local.set(dark, 2);
        }

        // every pair is complete
        if (pairs.length < minPairs) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.taiji.SWAP21", {count: minPairs - pairs.length});
            return result;
        }
        const normalised = this.normalisePlacement(m);
        if (m !== normalised) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NORMALISE", {normalised});
            return result;
        }
        if (this.noMirror && this.isSymmetric(local)) {
            if (pairs.length < maxPairs) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.taiji.NO_MIRROR_CONTINUE");
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.taiji.NO_MIRROR");
            }
            return result;
        }
        if (pairs.length < maxPairs) {
            result.valid = true;
            result.complete = 0;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.taiji.SWAP22_PARTIAL");
            return result;
        }

        // valid full move
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {partial = false, trusted = false} = {}): TaijiGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:validation._general.MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            // A turn still missing placements can't be submitted. This matters for the swap-2
            // opening's turns of several pairs, which have no move list to check against.
            if (!partial && result.complete === -1) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (this.hasMoveGeneration()) {
                if ( (! partial) && (! this.moves().includes(m)) ) {
                    throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
                } else if ( (partial) && (this.moves().filter(x => x.startsWith(m)).length < 1) ) {
                    throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
                }
            }
        }

        this.results = [];
        if (m === "pass") {
            // the players exchange colours; the pieces stay as they are
            this.swapped = !this.swapped;
            this.results.push({type: "pie"});
        } else {
            const pairs = m.split(";");
            for (const pair of pairs) {
                const [left, right] = pair.split(",");
                this.board.set(left, 1);
                this.results.push({type: "place", where: left});
                if (right !== undefined) {
                    this.board.set(right, 2);
                    this.results.push({type: "place", where: right});
                }
            }
        }

        if (partial) { return this; }

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

    protected checkEOG(): TaijiGame {
        if (this.moves().length === 0) {
            this.gameover = true;
            const score1 = this.getPlayerScore(1)!;
            const score2 = this.getPlayerScore(2)!;
            if (score1 > score2) {
                this.winner = [1];
            } else if (score1 < score2) {
                this.winner = [2];
            } else {
                this.winner = [1, 2];
            }
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }

        return this;
    }

    public state(): ITaijiState {
        return {
            game: TaijiGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: TaijiGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            swapped: this.swapped,
        };
    }

    public render(opts?: IRenderOpts): APRenderRep {
        const marked = this.scoringPieces();
        const fade = this.hasDisplay(opts, "fade-nonscoring");
        // Build piece string
        let pstr = "";
        for (let row = 0; row < this.boardSize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < this.boardSize; col++) {
                const cell = TaijiGame.coords2algebraic(col, row, this.boardSize);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    if (contents === 1) {
                        pieces.push(marked.has(cell) ? "C" : "A");
                    } else {
                        pieces.push(marked.has(cell) ? "D" : "B");
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join("");
        }

        // with the fade display, pieces outside the scoring groups are drawn at 75% opacity
        const legend: {[k: string]: Glyph | [Glyph, ...Glyph[]]} = {
            A: {
                name: "piece-square",
                colour: 1,
                ...(fade ? { opacity: 0.75 } : {}),
            },
            B: {
                name: "piece-square",
                colour: 2,
                ...(fade ? { opacity: 0.75 } : {}),
            },
        };
        // pieces in groups that count towards the score carry the scoring operator
        if (marked.size > 0) {
            const symbol = this.variants.includes("products") ? "×" : this.variants.includes("squares") ? "x²" : "+";
            for (const [key, colour] of [["C", 1], ["D", 2]] as const) {
                legend[key] = [
                    {
                        name: "piece-square",
                        colour,
                    },
                    {
                        text: symbol,
                        colour: { func: "bestContrast", bg: colour, fg: ["#fff", "#000"] },
                        scale: 0.5,
                    },
                ];
            }
        }

        const board: BoardBasic = {
            style: "squares",
            width: this.boardSize,
            height: this.boardSize,
        };
        // Tonga: the long diagonals, drawn like the grid lines, as a reminder that diagonal placement is allowed
        if (this.variants.includes("tonga")) {
            const n = this.boardSize;
            const markers: MarkerLine[] = [
                { type: "line", points: [{ row: 0, col: 0 }, { row: n, col: n }] },
                { type: "line", points: [{ row: 0, col: n }, { row: n, col: 0 }] },
            ];
            board.markers = markers;
        }

        // Build rep
        const rep: APRenderRep =  {
            board,
            legend,
            pieces: pstr
        };

        // Add annotations
        if (this.results.length > 0) {
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = TaijiGame.algebraic2coords(move.where!, this.boardSize);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }

        return rep;
    }

    // When each piece was placed, as a running count over the game (later is more recent). Pieces
    // of a move still being entered come last; pieces set up outside of play count as oldest.
    private placementOrder(): Map<string, number> {
        const order = new Map<string, number>();
        const add = (results: APMoveResult[]) => {
            for (const r of results) {
                if (r.type === "place" && r.where !== undefined && !order.has(r.where)) {
                    order.set(r.where, order.size);
                }
            }
        };
        for (const state of this.stack) {
            add(state._results);
        }
        add(this.results);
        return order;
    }

    // A colour's orthogonal groups, largest first. Groups of the same size come in order of how
    // recently they last grew, so that exactly as many groups are marked as count towards the score.
    private getGroups(colour: playerid): Set<string>[] {
        const grid = new RectGrid(this.boardSize, this.boardSize);
        const seen: Set<string> = new Set();
        const groups: Set<string>[] = [];
        const pieces = [...this.board.entries()].filter(e => e[1] === colour).map(e => e[0]);
        for (const piece of pieces) {
            if (seen.has(piece)) {
                continue;
            }
            const group: Set<string> = new Set();
            const todo: string[] = [piece]
            while (todo.length > 0) {
                const cell = todo.pop()!;
                if (seen.has(cell)) {
                    continue;
                }
                group.add(cell);
                seen.add(cell);
                const [x, y] = TaijiGame.algebraic2coords(cell, this.boardSize);
                const neighbours = grid.adjacencies(x, y, false).map(n => TaijiGame.coords2algebraic(...n, this.boardSize));
                for (const n of neighbours) {
                    if (pieces.includes(n)) {
                        todo.push(n);
                    }
                }
            }
            groups.push(group);
        }
        const order = this.placementOrder();
        const ranked = groups.map(group => ({
            group,
            recency: Math.max(-1, ...[...group].map(cell => order.get(cell) ?? -1)),
            first: [...group].sort()[0],
        }));
        ranked.sort((a, b) => b.group.size - a.group.size || b.recency - a.recency || a.first.localeCompare(b.first));
        return ranked.map(r => r.group);
    }

    // How many of a player's largest groups count towards the score.
    private groupCount(): number {
        if (this.variants.includes("onegroup")) {
            return 1;
        } else if (this.variants.includes("threegroups")) {
            return 3;
        } else if (this.variants.includes("fivegroups")) {
            return 5;
        }
        return 2;
    }

    // The pieces of each colour in the groups that count towards the score.
    private scoringPieces(): Set<string> {
        const marked = new Set<string>();
        for (const colour of [1, 2] as playerid[]) {
            for (const group of this.getGroups(colour).slice(0, this.groupCount())) {
                group.forEach(cell => marked.add(cell));
            }
        }
        return marked;
    }

    public getPlayerScore(player: playerid): number {
        const scorable = this.getGroups(this.colourOf(player)).slice(0, this.groupCount());
        if (this.variants.includes("products")) {
            return scorable.reduce((product, value) => {return product * value.size;}, 1);
        } else if (this.variants.includes("squares")) {
            return scorable.reduce((sum, value) => {return sum + (value.size ** 2);}, 0);
        } else {
            return scorable.reduce((sum, value) => {return sum + value.size;}, 0);
        }
    }

    public sidebarScores(): IScores[] {
        return [{ name: this.neutralAreaLabel("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] }]
    }

    public collectChatLogLine(lines: ChatLogLine[], r: APMoveResult, ctx: ChatLogCollectContext): boolean {
        switch (r.type) {
            case "pie":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:_general.PIE.default", {});
                return true;
            default:
                return super.collectChatLogLine(lines, r, ctx);
        }
    }

    public clone(): TaijiGame {
        return new TaijiGame(this.serialize());
    }
}
