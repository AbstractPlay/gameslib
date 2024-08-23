import { GameBase, IAPGameState, IClickResult, ICustomButton, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, MarkerFlood, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { Directions, RectGrid, reviver, UserFacingError } from "../common";
import i18next from "i18next";

type playerid = 1 | 2;
// 1 = Men, 2 = Knight
type pieceid = 1 | 2;
const allDirections: Directions[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export type CellContents = [playerid, pieceid]

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    castleMoveCounts: [number, number];
    lastmove?: string;
    countdown: number;
}

export interface ICamelotState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class CamelotGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Camelot",
        uid: "camelot",
        playercounts: [2],
        version: "20240817",
        dateAdded: "2024-08-17",
        // i18next.t("apgames:descriptions.camelot")
        description: "apgames:descriptions.camelot",
        urls: [
            "http://www.worldcamelotfederation.com",
            "https://boardgamegeek.com/boardgame/5251/camelot",
        ],
        people: [
            {
                type: "designer",
                name: "George S. Parker",
            }
        ],
        variants: [
            { uid: "cam", group: "board" },
            { uid: "chivalry", group: "board" },
        ],
        categories: ["goal>breakthrough", "goal>annihilate", "mechanic>capture", "mechanic>differentiate", "mechanic>move>group", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["experimental", "perspective", "limited-pieces", "custom-buttons"],
    };

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.height);
    }

    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.height);
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, CellContents>;
    public castleMoveCounts: [number, number] = [0, 0];
    public countdown = 0;
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private width = 0;
    private height = 0;
    private dots: string[] = [];
    private blockedCells: string[] = [];
    private castleCells: [string[], string[]] = [[], []];
    private grid: RectGrid;

    constructor(state?: ICamelotState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            [this.width, this.height] = this.getBoardSize();
            const board = this.getInitialBoard();
            const fresh: IMoveState = {
                _version: CamelotGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                castleMoveCounts: [0, 0],
                countdown: 0,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ICamelotState;
            }
            if (state.game !== CamelotGame.gameinfo.uid) {
                throw new Error(`The Camelot game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
            [this.width, this.height] = this.getBoardSize();
        }
        this.load();
        this.blockedCells = this.getBlockedCells();
        this.castleCells = this.getCastleCells();
        this.grid = new RectGrid(this.width, this.height);
    }

    public load(idx = -1): CamelotGame {
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
        this.board = [...state.board].reduce((m, [k, v]) => m.set(k, [v[0], v[1]]), new Map<string, CellContents>());
        this.castleMoveCounts = [state.castleMoveCounts[0], state.castleMoveCounts[1]];
        this.countdown = state.countdown;
        this.lastmove = state.lastmove;
        return this;
    }

    private getBoardSize(): [number, number] {
        // Get width and height of board.
        if (this.variants.includes("chivalry")) {
            return [14, 16];
        } else if (this.variants.includes("cam")) {
            return [7, 13];
        } else {
            return [12, 16];
        }
    }

    private getBlockedCells(): string[] {
        // Get blocked cells around the board.
        if (this.variants.includes("chivalry")) {
            return [
                "a1", "b1", "c1", "d1", "e1", "f1", "i1", "j1", "k1", "l1", "m1", "n1",
                "a2", "b2", "c2", "l2", "m2", "n2", "a3", "b3", "m3", "n3", "a4", "n4",
                "a16", "b16", "c16", "d16", "e16", "f16", "i16", "j16", "k16", "l16", "m16", "n16",
                "a15", "b15", "c15", "l15", "m15", "n15", "a14", "b14", "m14", "n14", "a13", "n13",
            ];
        } else if (this.variants.includes("cam")) {
            return [
                "a1", "b1", "c1", "e1", "f1", "g1",
                "a2", "b2", "f2", "g2", "a3", "g3",
                "a13", "b13", "c13", "e13", "f13", "g13",
                "a12", "b12", "f12", "g12", "a11", "g11",
            ];
        } else {
            return [
                "a1", "b1", "c1", "d1", "e1", "h1", "i1", "j1", "k1", "l1",
                "a2", "b2", "k2", "l2", "a3", "l3",
                "a16", "b16", "c16", "d16", "e16", "h16", "i16", "j16", "k16", "l16",
                "a15", "b15", "k15", "l15", "a14", "l14",
            ];
        }
    }

    private getCastleCells(): [string[], string[]] {
        // Get castle cells for each player.
        if (this.variants.includes("chivalry")) {
            return [["g1", "h1"], ["g16", "h16"]];
        } else if (this.variants.includes("cam")) {
            return [["d1"], ["d13"]];
        } else {
            return [["f1", "g1"], ["f16", "g16"]];
        }
    }

    private getInitialBoard(): Map<string, CellContents> {
        // Get initial board state.
        if (this.variants.includes("chivalry")) {
            return new Map([
                ["c6", [1, 2]], ["d6", [1, 2]], ["e6", [1, 1]], ["f6", [1, 1]], ["g6", [1, 1]], ["h6", [1, 1]], ["i6", [1, 1]], ["j6", [1, 1]], ["k6", [1, 2]], ["l6", [1, 2]],
                ["c7", [1, 2]], ["d7", [1, 2]], ["e7", [1, 1]], ["f7", [1, 1]], ["g7", [1, 1]], ["h7", [1, 1]], ["i7", [1, 1]], ["j7", [1, 1]], ["k7", [1, 2]], ["l7", [1, 2]],
                ["c9", [2, 2]], ["d9", [2, 2]], ["e9", [2, 1]], ["f9", [2, 1]], ["g9", [2, 1]], ["h9", [2, 1]], ["i9", [2, 1]], ["j9", [2, 1]], ["k9", [2, 2]], ["l9", [2, 2]],
                ["c10", [2, 2]], ["d10", [2, 2]], ["e10", [2, 1]], ["f10", [2, 1]], ["g10", [2, 1]], ["h10", [2, 1]], ["i10", [2, 1]], ["j10", [2, 1]], ["k10", [2, 2]], ["l10", [2, 2]],
            ]);
        } else if (this.variants.includes("cam")) {
            return new Map([
                ["c4", [1, 2]], ["e4", [1, 2]],
                ["b5", [1, 1]], ["c5", [1, 1]], ["d5", [1, 1]], ["e5", [1, 1]], ["f5", [1, 1]],
                ["b8", [2, 1]], ["c8", [2, 1]], ["d8", [2, 1]], ["e8", [2, 1]], ["f8", [2, 1]],
                ["c9", [2, 2]], ["e9", [2, 2]],
            ]);
        } else {
            return new Map([
                ["c6", [1, 2]], ["d6", [1, 1]], ["e6", [1, 1]], ["f6", [1, 1]], ["g6", [1, 1]], ["h6", [1, 1]], ["i6", [1, 1]], ["j6", [1, 2]],
                ["d7", [1, 2]], ["e7", [1, 1]], ["f7", [1, 1]], ["g7", [1, 1]], ["h7", [1, 1]], ["i7", [1, 2]],
                ["d10", [2, 2]], ["e10", [2, 1]], ["f10", [2, 1]], ["g10", [2, 1]], ["h10", [2, 1]], ["i10", [2, 2]],
                ["c11", [2, 2]], ["d11", [2, 1]], ["e11", [2, 1]], ["f11", [2, 1]], ["g11", [2, 1]], ["h11", [2, 1]], ["i11", [2, 1]], ["j11", [2, 2]],
            ]);
        }
    }

    private getAllMoves(from: string): string[] {
        // Get all possible sequences of moves from a given cell.
        // We assume that by the time this function is called, the from does not have a forced jump.
        // This is because there is a separate check that runs to find all pieces with forced jumps.
        const [player, piece] = this.board.get(from)!;
        const plainMoves = this.getPlain(from, this.currplayer).map(x => from + "-" + x);
        const [canters, chargeIndices] = this.getAllCanters(from, [], [from], player, piece === 2);
        const canterMoves: string[] = [];
        for (let i = 0; i < canters.length; i++) {
            if (chargeIndices[i] === 0) {
                canterMoves.push(from + "^" + canters[i].join("^"));
            } else {
                const canterPart = canters[i].slice(0, chargeIndices[i]);
                const chargePart = canters[i].slice(chargeIndices[i]);
                canterMoves.push(from + "^" + canterPart.join("^") + "x" + chargePart.join("x"));
            }
        }
        return [...plainMoves, ...canterMoves];
    }

    public getAllJumps(from: string, jumpSequence: string[], removed: string[], player: playerid): string[][] {
        // Get all possible sequences of jumps from a given cell.
        const jumpsMap = this.getJumps(from, removed, player);
        if (jumpsMap.size === 0) {
            if (jumpSequence.length === 0) { return []; }
            return [jumpSequence];
        }
        const tos: string[][] = [];
        for (const [to, captured] of jumpsMap) {
            tos.push(...this.getAllJumps(to, [...jumpSequence, to], [...removed, captured], player));
        }
        return tos;
    }

    public getAllCanters(from: string, canterSequence: string[], excluded: string[], player: playerid, charge: boolean): [string[][], number[]] {
        // Get all possible sequences of canters from a given cell.
        // If charge is true, the piece is a knight and can perform a knight's charge.
        // Returns a list of sequences, and a list of numbers corresponding to when the charge is activated.
        const tos: string[][] = [];
        const idx: number[] = [];
        if (canterSequence.length > 0) {
            if (charge) {
                const jumps = this.getAllJumps(from, [], [excluded[0]], player);
                if (jumps.length > 0) {
                    const charges: string[][] = [];
                    for (const jump of jumps) {
                        charges.push([...canterSequence, ...jump]);
                    }
                    return [charges, Array(charges.length).fill(canterSequence.length) as number[]];
                } else {
                    tos.push(canterSequence);
                    idx.push(0);
                }
            } else {
                tos.push(canterSequence);
                idx.push(0);
            }
        }
        const canters = this.getCanters(from, excluded, player);
        if (canters.length === 0) {
            if (canterSequence.length === 0) { return [[], []]; }
            return [tos, [0]];
        }
        for (const cell of canters) {
            const [tos2, idx2] = this.getAllCanters(cell, [...canterSequence, cell], [...excluded, cell], player, charge);
            tos.push(...tos2);
            idx.push(...idx2);
        }
        return [tos, idx];
    }

    private jumpPieces(player?: playerid, pieces?: string[]): string[] {
        // Get all pieces that have a forced jump.
        // If there are no pieces with forced jumps, return an empty list.
        player ??= this.currplayer;
        pieces ??= [...this.board].filter(([, v]) => v[0] === player).map(([k, ]) => k);
        const piecesToJump: string[] = [];
        for (const piece of pieces) {
            const jumpsMap = this.getJumps(piece, [], player);
            if (jumpsMap.size > 0) { piecesToJump.push(piece); }
        }
        return piecesToJump;
    }

    private inOwnCastlePieces(player?: playerid, pieces?: string[]): string[] {
        // Get all pieces that are in their own castle.
        player ??= this.currplayer;
        pieces ??= [...this.board].filter(([, v]) => v[0] === player).map(([k, ]) => k);
        return pieces.filter(p => this.castleCells[player! - 1].includes(p));
    }

    public moves(player?: playerid): string[] {
        player ??= this.currplayer;
        if (this.gameover) { return []; }
        const moves: string[] = [];
        const pieces = [...this.board].filter(([, v]) => v[0] === player).map(([k, ]) => k);
        // If a player has pieces in their own castle, they must move them.
        const piecesInOwnCastle = this.inOwnCastlePieces(player, pieces);
        if (piecesInOwnCastle.length > 0) {
            for (const from of piecesInOwnCastle) {
                moves.push(...this.getAllMoves(from));
            }
        } else {
            // If a player has pieces that can jump, they must jump.
            const piecesToJump = this.jumpPieces(player, pieces);
            if (piecesToJump.length > 0) {
                for (const from of piecesToJump) {
                    const jumps = this.getAllJumps(from, [], [from], player);
                    moves.push(...jumps.map(x => from + "x" + x.join("x")));
                }
            } else {
                // Otherwise, the player can make any move.
                for (const from of piecesToJump.length > 0 ? piecesToJump : pieces) {
                    moves.push(...this.getAllMoves(from));
                }
            }
        }
        // Check if the player can claim a draw.
        if (this.countdown >= 50 || this.stateCount(new Map<string, any>([["board", this.board], ["currplayer", this.currplayer]])) > 3) {
            moves.push("claim-draw");
        }
        return moves;
    }

    public getButtons(): ICustomButton[] {
        if (this.countdown >= 50 || this.stateCount(new Map<string, any>([["board", this.board], ["currplayer", this.currplayer]])) > 3) {
            return [{
                label: "Claim draw",
                move: "claim-draw"
            }];
        }
        return [];
    }

    private hasMoves(player?: playerid): boolean {
        // Check if a player has any moves.
        player ??= this.currplayer;
        if (this.gameover) { return false; }
        const pieces = [...this.board].filter(([, v]) => v[0] === player);
        for (const [from, ] of pieces) {
            if (this.getAllMoves(from).length > 0) { return true; }
        }
        return false;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            let newmove = "";
            if (move === "") {
                newmove = cell;
            } else {
                if (move === cell) {
                    newmove = "";
                } else {
                    const split = move.split(/-|\^|x/);
                    const last = split[split.length - 1];
                    if (last === cell) {
                        // Remove the last action.
                        const lastSplitIndex = move.split('').reduceRight((acc, char, index) => acc === -1 && /[-^x]/.test(char) ? index : acc, -1);
                        newmove = move.slice(0, lastSplitIndex);
                    } else {
                        const others = split.slice(0, -1);
                        const canters = this.getCanters(last, others, this.currplayer);
                        const jumpsMap = this.getJumps(last, others, this.currplayer);
                        if (canters.includes(cell)) {
                            newmove = `${move}^${cell}`;
                        } else if (jumpsMap.has(cell)) {
                            newmove = `${move}x${cell}`;
                        } else {
                            newmove = `${move}-${cell}`;
                        }
                    }
                }
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
        const result: IValidationResult = { valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER") };
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            const pieces = [...this.board].filter(([, v]) => v[0] === this.currplayer).map(([k, ]) => k);
            const inOwnCastle = this.inOwnCastlePieces(this.currplayer, pieces);
            if (inOwnCastle.length > 0) {
                result.message = i18next.t("apgames:validation.camelot.INITIAL_INSTRUCTIONS_OWN_CASTLE", { where: inOwnCastle[0] });
            } else if (this.jumpPieces(this.currplayer, pieces).length > 0) {
                result.message = i18next.t("apgames:validation.camelot.INITIAL_INSTRUCTIONS_JUMP");
            } else {
                result.message = i18next.t("apgames:validation.camelot.INITIAL_INSTRUCTIONS");
            }
            return result;
        }
        if (m === "claim-draw") {
            // Check for claim draw.
            if (this.countdown < 50 && this.stateCount(new Map<string, any>([["board", this.board], ["currplayer", this.currplayer]])) <= 3) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.camelot.CANNOT_CLAIM_DRAW");
                return result;
            }
        } else {
            const split = m.split(/-|\^|x/);
            const moveTypes: ("-" | "x" | "^")[] = m.match(/-|\^|x/g) as ("-" | "x" | "^")[];
            // Valid cell
            let currentMove;
            try {
                for (const p of split) {
                    currentMove = p;
                    const [x, y] = this.algebraic2coords(p);
                    // `algebraic2coords` does not check if the cell is on the board.
                    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
                        throw new Error("Invalid cell");
                    }
                }
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: currentMove });
                return result;
            }
            const from = split[0];
            // The first piece selected exists.
            if (!this.board.has(from)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NONEXISTENT", { where: from });
                return result;
            }
            // The first piece selected is owned by the current player.
            if (this.board.get(from)![0] !== this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.UNCONTROLLED", { where: from });
                return result;
            }
            // Check if it's a castle move and if the player has already made castle moves twice.
            if (this.castleCells[this.currplayer % 1].includes(from) && this.castleMoveCounts[this.currplayer - 1] >= 2) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.camelot.CASTLE_LIMIT");
                return result;
            }
            // For jump check, we remove the cell that is being moved from.
            const allRemoved = [from];
            const pieces = [...this.board].filter(([, v]) => v[0] === this.currplayer).map(([k, ]) => k);
            // If a player has pieces in their own castle, they must it now.
            const inOwnCastle = this.inOwnCastlePieces(this.currplayer, pieces);
            if (inOwnCastle.length > 0 && !inOwnCastle.includes(from)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.camelot.IN_CASTLE", { where: inOwnCastle.join(", ") });
                return result;
            }
            // If a player has pieces that can jump, they must jump.
            const mustJump = this.jumpPieces(this.currplayer, pieces);
            if (mustJump.length > 0 && !mustJump.includes(from)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.camelot.MUST_JUMP", { where: mustJump.join(", ") });
                return result;
            }
            // Check if the piece selected has any moves.
            if (this.getAllMoves(from).length === 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NO_MOVES", { where: from });
                return result;
            }
            const [, piece] = this.board.get(from)!;
            let hasPlained = false;
            let hasJumped = false;
            if (split.length > 1) {
                for (const [i, move] of split.entries()) {
                    if (i === 0) { continue; }
                    const prev = split[i - 1];
                    // Check if a move is a jump.
                    const jumpsMap = this.getJumps(prev, allRemoved, this.currplayer);
                    if (jumpsMap.size > 0 && (i === 1 || (piece === 2 || piece === 1 && hasJumped))) {
                        if (!jumpsMap.has(move)) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.camelot.MUST_JUMP_SELECTED", { where: prev });
                            return result;
                        } else if (moveTypes[i - 1] !== "x") {
                            // Check that the move is correctly represented by the notation.
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.camelot.JUMP_NOTATION", { from: prev, to: move });
                            return result;
                        }
                        allRemoved.push(jumpsMap.get(move)!);
                        hasJumped = true;
                    } else {
                        // Check if a move is a plain move.
                        const plain = this.getPlain(prev, this.currplayer);
                        if (plain.includes(move)) {
                            if (moveTypes[i - 1] !== "-") {
                                // Check that the move is correctly represented by the notation.
                                result.valid = false;
                                result.message = i18next.t("apgames:validation.camelot.PLAIN_NOTATION", { from: prev, to: move });
                                return result;
                            }
                            hasPlained = true;
                        } else {
                            // Check if a move is a canter.
                            const canters = this.getCanters(prev, split.slice(0, i), this.currplayer);
                            if (canters.includes(move)) {
                                if (moveTypes[i - 1] !== "^") {
                                    // Check that the move is correctly represented by the notation.
                                    result.valid = false;
                                    result.message = i18next.t("apgames:validation.camelot.CANTER_NOTATION", { from: prev, to: move });
                                    return result;
                                }
                            } else {
                                // If we reach this point, the move is neither a jump, a plain move, nor a canter.
                                result.valid = false;
                                result.message = i18next.t("apgames:validation.camelot.INVALID_TO", { from: prev, to: move });
                                return result;
                            }
                        }
                    }
                }
            }
            // A single selected piece.
            if (split.length === 1) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation._general.NEED_DESTINATION");
                return result;
            }
            // If a piece has a jump move, it must take it.
            if (!hasPlained && (piece === 2 || hasJumped)) {
                const jumpsMap = this.getJumps(split[split.length - 1], allRemoved, this.currplayer);
                if (jumpsMap.size > 0) {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.camelot.NEED_TO_JUMP");
                    return result;
                }
            }
            // If a piece does not have a jump move and it has canters, it may canter.
            if (!hasJumped && !hasPlained) {
                const canters = this.getCanters(split[split.length - 1], split, this.currplayer);
                if (canters.length > 0) {
                    result.valid = true;
                    result.complete = 0;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.camelot.CAN_CANTER");
                    return result;
                }
            }
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private getPlain(from: string, player: playerid): string[] {
        // Get all plain moves.
        if (this.castleCells[player % 2].includes(from)) {
            // Castle moves are considered plain moves in this implementation.
            if (this.castleMoveCounts[player - 1] >= 2) { return []; }
            const otherCastle = this.castleCells[player % 2].find(c => c !== from);
            if (otherCastle === undefined) { return []; }
            if (this.board.has(otherCastle)) { return []; }
            return [otherCastle];
        }
        const tos: string[] = [];
        const neighbours = this.grid.adjacencies(...this.algebraic2coords(from)).map(c => this.coords2algebraic(...c));
        for (const to of neighbours) {
            if (this.board.has(to)) { continue; }
            if (this.castleCells[player - 1].includes(to)) { continue; }
            if (this.blockedCells.includes(to)) { continue; }
            tos.push(to);
        }
        return tos;
    }

    private getCanters(from: string, exclude: string[], player: playerid): string[] {
        // Get all canters.
        if (this.castleCells[player % 2].includes(from)) { return []; }
        const tos: string[] = [];
        const coordsFrom = this.algebraic2coords(from);
        for (const dir of allDirections) {
            const ray = this.grid.ray(...coordsFrom, dir).map(c => this.coords2algebraic(...c));
            if (ray.length < 2) { continue; }
            if (exclude.includes(ray[1])) { continue; }
            if (!this.board.has(ray[0])) { continue; }
            if (this.board.has(ray[1])) { continue; }
            if (this.blockedCells.includes(ray[1])) { continue; }
            if (this.board.get(ray[0])![0] !== player) { continue; }
            if (this.castleCells[player - 1].includes(ray[1])) { continue; }
            tos.push(ray[1]);
        }
        return tos;
    }

    private getJumps(from: string, removed: string[], player: playerid): Map<string, string> {
        // Get all jumps that capture.
        // Return a map of to with the corresponding captured cell.
        const toCaptures: Map<string, string> = new Map();
        if (this.castleCells[player % 2].includes(from)) { return toCaptures; }
        const coordsFrom = this.algebraic2coords(from);
        for (const dir of allDirections) {
            const ray = this.grid.ray(...coordsFrom, dir).map(c => this.coords2algebraic(...c));
            if (ray.length < 2) { continue; }
            if (removed.includes(ray[0])) { continue; }
            if (!this.board.has(ray[0])) { continue; }
            if (this.board.has(ray[1]) && !removed.includes(ray[1])) { continue; }
            if (this.blockedCells.includes(ray[1])) { continue; }
            if (this.board.get(ray[0])![0] === player) { continue; }
            toCaptures.set(ray[1], ray[0]);
        }
        return toCaptures;
    }

    public move(m: string, { partial = false, trusted = false } = {}): CamelotGame {
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
        this.dots = [];
        this.results = [];
        if (m === "claim-draw") {
            // Player has claimed a draw. We record the reason.
            if (this.countdown < 50) {
                this.results.push({ type: "claim", what: "draw", how: "repetition" });
            } else {
                this.results.push({ type: "claim", what: "draw", how: "progression" });
            }
        } else {
            const split = m.split(/-|\^|x/);
            // We determine move type based on the separator.
            const moveTypes: ("-" | "x" | "^")[] = m.match(/-|\^|x/g) as ("-" | "x" | "^")[];
            const from = split[0];
            let hasJumped = false;
            let hasPlained = false;
            const [, piece] = this.board.get(from)!;
            const pieceStr = piece === 1 ? "man" : "knight";
            if (split.length > 1) {
                for (const [i, move] of split.entries()) {
                    if (i === 0) { continue; }
                    const prev = split[i - 1];
                    if (moveTypes[i - 1] === "-") {
                        // For plain moves.
                        this.board.delete(prev);
                        this.board.set(move, [this.currplayer, piece]);
                        if (this.castleCells[this.currplayer % 2].includes(from) && this.castleCells[this.currplayer % 2].includes(move)) {
                            // For castle moves, we record it separately.
                            this.castleMoveCounts[this.currplayer - 1]++;
                            this.results.push({ type: "move", from: prev, to: move, how: "castle", what: pieceStr });
                            this.results.push({ type: "use", what: "castle-move", remaining: this.castleMoveCounts[this.currplayer - 1] });
                        } else {
                            this.results.push({ type: "move", from: prev, to: move, how: "plain", what: pieceStr });
                        }
                        hasPlained = true;
                    } else if (moveTypes[i - 1] === "^") {
                        // For canters.
                        this.board.delete(prev);
                        this.board.set(move, [this.currplayer, piece]);
                        this.results.push({ type: "move", from: prev, to: move, how: "canter", what: pieceStr });
                    } else if (moveTypes[i - 1] === "x") {
                        // For jumps.
                        const jumpsMap = this.getJumps(prev, [], this.currplayer);
                        this.board.delete(prev);
                        this.board.delete(jumpsMap.get(move)!);
                        this.board.set(move, [this.currplayer, piece]);
                        this.results.push({ type: "move", from: prev, to: move, how: "jump", what: pieceStr, by: jumpsMap.get(move) });
                        this.results.push({ type: "capture", where: jumpsMap.get(move) });
                        hasJumped = true;
                    }
                }
            }
            const last = split[split.length - 1];
            // Manage countdown
            if (!this.castleCells[this.currplayer % 2].includes(from) && this.castleCells[this.currplayer % 2].includes(last) || this.results.find(r => r.type === "capture") !== undefined) {
                this.countdown = 0;
            } else {
                this.countdown++;
            }
            if (partial) {
                // Draw dots to indicate possible moves.
                if (split.length === 1) {
                    // Check for jumps before anything else.
                    const jumpsMap = this.getJumps(last, [], this.currplayer);
                    if (jumpsMap.size > 0) {
                        this.dots = [...jumpsMap.keys()];
                    } else {
                        const plain = this.getPlain(last, this.currplayer);
                        const canters = this.getCanters(last, [], this.currplayer);
                        this.dots = [...plain, ...canters];
                    }
                } else if (hasPlained) {
                    // If the move was a plain move, there are no followups.
                } else if (hasJumped) {
                    // If a piece has jumped, it can only continue to jump.
                    this.dots = [...this.getJumps(last, [], this.currplayer).keys()];
                } else if (piece === 1) {
                    // If the piece is a man and it has not jumped, then it can only canter.
                    this.dots = this.getCanters(last, split, this.currplayer);
                } else if (piece === 2) {
                    // A knight must jump if it can
                    const [jumps, ] = this.getJumps(last, [], this.currplayer);
                    if (jumps.length > 0) {
                        this.dots = jumps;
                    } else {
                        // If it cannot jump, then it may continue to canter.
                        this.dots = this.getCanters(last, split, this.currplayer);
                    }
                }
                return this;
            }
        }
        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    private materialEnd(): boolean {
        // Check that both players have only one piece left and none of them is threatening to capture the other.
        const pieces1 = [...this.board].filter(([, v]) => v[0] === 1).map(([k, ]) => k);
        if (pieces1.length > 1) { return false; }
        const pieces2 = [...this.board].filter(([, v]) => v[0] === 2).map(([k, ]) => k);
        if (pieces2.length > 1) { return false; }
        if (this.getJumps(pieces1[0], [], 1).size > 0) { return false; }
        if (this.getJumps(pieces2[0], [], 2).size > 0) { return false; }
        return true;
    }

    protected checkEOG(): CamelotGame {
        const otherPlayer = this.currplayer % 2 + 1 as playerid;
        if (this.lastmove === "claim-draw") {
            // Player claimed a draw.
            this.gameover = true;
            this.winner = [1, 2];
            const move = this.results.find(r => r.type === "claim") as Extract<APMoveResult, { type: "claim" }>;
            if (move.how === "repetition") {
                this.results.push({ type: "eog", reason: "claim-draw-repetition" });
            } else {
                this.results.push({ type: "eog", reason: "claim-draw-progression" });
            }
        } else if (this.castleCells[this.currplayer - 1].every(c => this.board.has(c) && this.board.get(c)![0] === otherPlayer)) {
            // Player has both pieces in the opponent's castle.
            this.gameover = true;
            this.winner = [otherPlayer];
            this.results.push({ type: "eog", reason: "breakthrough" });
        } else if (!this.hasMoves(this.currplayer)) {
            // Player has run out of moves.
            this.gameover = true;
            this.winner = [otherPlayer];
            this.results.push({ type: "eog", reason: "stalemate" });
        } else if (!this.variants.includes("cam") && this.materialEnd()) {
            // Each player has one piece remaining so they cannot capture both castle cells.
            this.gameover = true;
            this.winner = [1, 2];
            this.results.push({ type: "eog", reason: "material" });
        }
        if (this.gameover) {
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public state(): ICamelotState {
        return {
            game: CamelotGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: CamelotGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: [...this.board].reduce((m, [k, v]) => m.set(k, [v[0], v[1]]), new Map<string, CellContents>()),
            castleMoveCounts: [this.castleMoveCounts[0], this.castleMoveCounts[1]],
            countdown: this.countdown,
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < this.height; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            for (let col = 0; col < this.width; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const [player, piece] = this.board.get(cell)!;
                    if (player === 1) {
                        if (piece === 1) {
                            pstr += "A";
                        } else if (piece === 2) {
                            pstr += "C";
                        }
                    } else if (player === 2) {
                        if (piece === 1) {
                            pstr += "B";
                        } else if (piece === 2) {
                            pstr += "D";
                        }
                    }
                } else {
                    pstr += "-";
                }
            }
        }
        pstr = pstr.replace(new RegExp(`-{${this.width}}`, "g"), "_");

        const blocked: RowCol[] = [];
        for (const cell of this.blockedCells) {
            const [x, y] = this.algebraic2coords(cell);
            blocked.push({ row: y, col: x });
        }

        const markers: MarkerFlood[] = [];
        // Mark castles.
        const castle1: RowCol[] = [];
        for (const cell of this.castleCells[0]) {
            const [x, y] = this.algebraic2coords(cell);
            castle1.push({ row: y, col: x });
        }
        markers.push({ type: "flood", points: castle1 as [RowCol, ...RowCol[]], colour: 1, opacity: 0.2 });
        const castle2: RowCol[] = [];
        for (const cell of this.castleCells[1]) {
            const [x, y] = this.algebraic2coords(cell);
            castle2.push({ row: y, col: x });
        }
        markers.push({ type: "flood", points: castle2 as [RowCol, ...RowCol[]], colour: 2, opacity: 0.2 });

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares",
                width: this.width,
                height: this.height,
                blocked: blocked as [RowCol, ...RowCol[]],
                markers,
            },
            legend: {
                A: [{ name: "piece", colour: 1 }],
                B: [{ name: "piece", colour: 2 }],
                C: [{ name: "piece-horse", colour: 1 }],
                D: [{ name: "piece-horse", colour: 2 }],
            },
            pieces: pstr,
        };

        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "capture") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({ type: "exit", targets: [{ row: y, col: x }] });
                } else if (move.type === "move") {
                    const [fromX, fromY] = this.algebraic2coords(move.from);
                    const [toX, toY] = this.algebraic2coords(move.to);
                    rep.annotations.push({ type: "move", targets: [{ row: fromY, col: fromX }, { row: toY, col: toX }] });
                }
            }
        }
        if (this.dots.length > 0) {
            const points = [];
            for (const cell of this.dots) {
                const [x, y] = this.algebraic2coords(cell);
                points.push({ row: y, col: x });
            }
            rep.annotations.push({ type: "dots", targets: points as [RowCol, ...RowCol[]] });
        }
        return rep;
    }

    public getPlayerPieces(player: number): number {
        return [...this.board.values()].filter(p => p[0] === player).length;
    }

    public getPlayersScores(): IScores[] {
        if (this.variants.includes("cam")) {
            // The cam variant only has one castle cell so we don't need to show the castle move counts.
            return [
                { name: i18next.t("apgames:status.PIECESREMAINING"), scores: [this.getPlayerPieces(1), this.getPlayerPieces(2)] },
            ];
        }
        return [
            { name: i18next.t("apgames:status.PIECESREMAINING"), scores: [this.getPlayerPieces(1), this.getPlayerPieces(2)] },
            { name: i18next.t("apgames:status.camelot.CASTLE_MOVE_COUNTS"), scores: this.castleMoveCounts }
        ]
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Pieces On Board:**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            status += `Player ${n}: ${this.getPlayerPieces(n)}\n\n`;
        }

        status += "**Castle Move Counts:**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            status += `Player ${n}: ${this.castleMoveCounts[n - 1]}\n\n`;
        }

        status += "**Countdown:** ";
        status += this.countdown;
        status += "\n\n";

        const stateCount = this.stateCount(new Map<string, any>([["board", this.board], ["currplayer", this.currplayer]]));

        status += "**State Count:** ";
        status += stateCount;
        status += "\n\n";

        status += "**Can Claim Draw:** ";
        status += this.countdown >= 50 || stateCount > 3 ? "Yes" : "No";
        status += "\n\n";

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "capture":
                resolved = true;
                break;
            case "move":
                if (r.how === "castle") {
                    if (r.what === "knight") {
                        node.push(i18next.t("apresults:MOVE.camelot_castle_knight", { player, from: r.from, to: r.to }));
                    } else {
                        node.push(i18next.t("apresults:MOVE.camelot_castle", { player, from: r.from, to: r.to }));
                    }
                } else if (r.how === "plain") {
                    if (r.what === "knight") {
                        node.push(i18next.t("apresults:MOVE.camelot_plain_knight", { player, from: r.from, to: r.to }));
                    } else {
                        node.push(i18next.t("apresults:MOVE.camelot_plain", { player, from: r.from, to: r.to }));
                    }
                } else if (r.how === "canter") {
                    if (r.what === "knight") {
                        node.push(i18next.t("apresults:MOVE.camelot_canter_knight", { player, from: r.from, to: r.to }));
                    } else {
                        node.push(i18next.t("apresults:MOVE.camelot_canter", { player, from: r.from, to: r.to }));
                    }
                } else if (r.how === "jump") {
                    if (r.what === "knight") {
                        node.push(i18next.t("apresults:MOVE.camelot_jump_knight", { player, from: r.from, to: r.to, captured: r.by }));
                    } else {
                        node.push(i18next.t("apresults:MOVE.camelot_jump", { player, from: r.from, to: r.to, captured: r.by }));
                    }
                }
                resolved = true;
                break;
            case "use":
                if (r.remaining === 0) {
                    node.push(i18next.t("apresults:USE.camelot_castle_move_none", { player, count: r.remaining }));
                } else {
                    node.push(i18next.t("apresults:USE.camelot_castle_move", { player, count: r.remaining }));
                }
                resolved = true;
            case "claim":
                resolved = true;
                break;
            case "eog":
                if (r.reason === "claim-draw-repetition") {
                    node.push(i18next.t("apresults:EOG.camelot_claim_draw_repetition", { player }));
                } else if (r.reason === "claim-draw-progression") {
                    node.push(i18next.t("apresults:EOG.camelot_claim_draw_progression", { player }));
                } else if (r.reason === "stalemate") {
                    node.push(i18next.t("apresults:EOG.stalemate"));
                } else if (r.reason === "material") {
                    node.push(i18next.t("apresults:EOG.material"));
                } else if (r.reason === "breakthrough") {
                    node.push(i18next.t("apresults:EOG.default"));
                }
                resolved = true;
        }
        return resolved;
    }

    public clone(): CamelotGame {
        return new CamelotGame(this.serialize());
    }
}
