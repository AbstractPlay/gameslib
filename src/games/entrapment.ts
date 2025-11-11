import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, MarkerLine } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";

type playerid = 1 | 2;
const columnLabels = "abcdefghijklmnopqrstuvwxyz".split("");
const splitSymbol = ";";

const SETUP_PLIES = 6;

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    // Maps to [player, jumped]
    boardEdge: Map<string, [playerid, boolean]>;
    boardCell: Map<string, playerid>;
    wallCounts: [number, number];
    lastmove?: string;
}

export interface IEntrapmentState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class EntrapmentGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Entrapment",
        uid: "entrapment",
        playercounts: [2],
        version: "20240227",
        dateAdded: "2024-07-14",
        // i18next.t("apgames:descriptions.entrapment")
        description: "apgames:descriptions.entrapment",
        urls: ["https://boardgamegeek.com/boardgame/12533/entrapment"],
        people: [
            {
                type: "designer",
                name: "Rich Gowell",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3936/rich-gowell"]
            },
            {
                type: "coder",
                name: "ypaul",
                urls: [],
                apid: "46f6da78-be02-4469-94cb-52f17078e9c1",
            },
        ],
        variants: [
            { uid: "size-7x7", group: "board" },
        ],
        categories: ["goal>annihilate", "mechanic>place", "mechanic>move", "mechanic>block", "board>shape>rect", "board>connect>rect", "components>special"],
        flags: ["limited-pieces"],
    };

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.height);
    }

    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.height);
    }

    private splitWall(wall: string): [number, number, string] {
        // Split the wall into its components.
        // To distinguish between the output from this method and the render output
        // we call the third element "orient" for orientation instead of "side".
        const cell = wall.slice(0, wall.length - 1);
        const orient = wall[wall.length - 1];
        const [x, y] = this.algebraic2coords(cell);
        return [x, y, orient];
    }

    private render2wall(row: number, col: number, side: string): string {
        // Converts click results from renderer into wall notation.
        // For games with interior-only walls, we use the north and east edges.
        // For games with exterior walls (like Dots and Boxes), we use the south and west edges.
        const orientation = side === "S" || side === "N" ? "h" : "v";
        const rowLabel = side === "S" ? this.height - row - 1 : this.height - row;
        const colNumber = side === "W" ? col - 1 : col;
        const colLabel = colNumber < 0 ? "z" : columnLabels[colNumber];
        return colLabel + rowLabel.toString() + orientation;
    }

    private endsWithHV(cell: string): boolean {
        // Check if the cell ends with an "h" or "v".
        const lastChar = cell[cell.length - 1];
        return lastChar === "h" || lastChar === "v";
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public boardEdge!: Map<string, [playerid, boolean]>;
    public boardCell!: Map<string, playerid>;
    public wallCounts!: [number, number];
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private width = 0;
    private height = 0;
    private dots: string[] = [];

    constructor(state?: IEntrapmentState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: EntrapmentGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                boardEdge: new Map(),
                boardCell: new Map(),
                wallCounts: [25, 25],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IEntrapmentState;
            }
            if (state.game !== EntrapmentGame.gameinfo.uid) {
                throw new Error(`The Entrapment game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        [this.width, this.height] = this.getBoardDimensions();
        this.load();
    }

    public load(idx = -1): EntrapmentGame {
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
        this.boardEdge = new Map(Array.from(state.boardEdge, ([key, value]) => [key, [...value]]));
        this.boardCell = new Map(state.boardCell);
        this.wallCounts = [...state.wallCounts];
        this.lastmove = state.lastmove;
        return this;
    }

    private getBoardDimensions(): [number, number] {
        // Get board size from variants.
        if (this.variants !== undefined && this.variants.length > 0 && this.variants[0] !== undefined && this.variants[0].length > 0) {
            const sizeVariants = this.variants.filter(v => v.includes("size"))
            if (sizeVariants.length > 0) {
                // Extract the size from the variant.
                // Variant is expected to be in the format "size-6-7".
                const size = sizeVariants[0].match(/size-(\d+)x(\d+)/);
                if (size !== null && size.length === 3) {
                    return [parseInt(size[1], 10), parseInt(size[2], 10)];
                }
            }
        }
        return [6, 7]
    }

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }
        const moves: string[] = [];
        if (this.stack.length <= SETUP_PLIES) {
            for (let i = 0; i < this.width; i++) {
                for (let j = 0; j < this.height; j++) {
                    const cell = this.coords2algebraic(i, j);
                    if (this.boardCell.has(cell)) { continue; }
                    moves.push(cell);
                }
            }
        } else if (this.stack.length === SETUP_PLIES + 1) {
            // First move after setup phase only allows one action.
            const froms: string[] = [...this.boardCell.keys()].filter(cell => this.boardCell.get(cell) === player);
            for (const from of froms) {
                const tos = this.getTos(player, from);
                for (const to of tos.keys()) {
                    moves.push(from + "-" + to);
                }
            }
            for (let i = 0; i < this.width - 1; i++) {
                for (let j = 0; j < this.height; j++) {
                    const wallV = this.coords2algebraic(i, j) + "v";
                    if (this.boardEdge.has(wallV)) { continue; }
                    moves.push(wallV);
                }
            }
            for (let i = 0; i < this.width; i++) {
                for (let j = 1; j < this.height; j++) {
                    const wallH = this.coords2algebraic(i, j) + "h";
                    if (this.boardEdge.has(wallH)) { continue; }
                    moves.push(wallH);
                }
            }
        } else {
            // A regular move.
            const forced = this.getForced(player);
            const froms: string[] = [...this.boardCell.keys()].filter(cell => this.boardCell.get(cell) === player);
            for (const from of froms) {
                let canMove: boolean | undefined;
                if (forced === undefined || forced === from) {
                    // If there is no forced move present, any piece can be moved.
                    // If there is a forced move, then the forced piece is a piece that can be moved.
                    // Other pieces can be moved if they relieve the forced piece.
                    canMove = true;
                }
                const tos = this.getTos(player, from);
                for (const [to, jumped] of tos.entries()) {
                    if (canMove === undefined) {
                        // If we haven't established if the piece can move yet, we check if moving this piece
                        // to this location will relieve the forced piece.
                        if (this.checkForced(player, forced!, [from], new Map([[to, player]]), jumped === undefined ? [] : [jumped])) {
                            canMove = false;
                        } else {
                            canMove = true;
                        }
                    }
                    if (!canMove) { break; }
                    const jumpedWalls = jumped === undefined ? [] : [jumped];
                    // Information about the forced positions for each player is used when
                    // retrieving the pieces that are captured as a result of an action.
                    const forceds: [string | undefined, string | undefined] = [
                        this.getForced(1),
                        this.getForced(2),
                    ];
                    const captures = this.getCapturesRoamer(player, to, [from], new Map([[to, player]]), jumpedWalls, forceds);
                    // In the event that either player's last roamer is captured, we do not need to perform the second action.
                    if (!this.stillHasRoamersAny([from, ...captures], new Map([[to, player]]))) {
                        moves.push(from + "-" + to);
                        continue;
                    }
                    // If an action results in multiple forced position for either player,
                    // the moving player must choose one of them to retain, and the other(s) are removed.
                    const multipleForced = this.getMultipleForced([from, ...captures], new Map([[to, player]]), jumpedWalls);
                    const firstMoves: string[] = [];
                    if (multipleForced.length > 0) {
                        for (const cell of multipleForced) {
                            firstMoves.push(from + "-" + to + "/" + cell);
                        }
                    } else {
                        firstMoves.push(from + "-" + to);
                    }
                    const toAdd: Map<string, playerid> = new Map([[to, player]]);
                    for (const firstMove of firstMoves) {
                        // Setting some things up for checks used in the second action.
                        const toRemove: string[] = [from, ...captures, ...multipleForced.filter(cell => cell !== firstMove.split("/")[1])];
                        const forceds2: [string | undefined, string | undefined] = [
                            this.getForced(1, toRemove, toAdd, jumpedWalls),
                            this.getForced(2, toRemove, toAdd, jumpedWalls),
                        ];
                        if (this.wallCounts[player - 1] > 0) {
                            // If the player still has barriers in their stash, they can place a barriers.
                            // Vertical barriers.
                            for (let i = 0; i < this.width - 1; i++) {
                                for (let j = 0; j < this.height; j++) {
                                    const wallV = this.coords2algebraic(i, j) + "v";
                                    if (this.boardEdge.has(wallV)) { continue; }
                                    const captures2 = this.getCapturesWall(player, wallV, toRemove, toAdd, undefined, wallV, forceds2);
                                    const toRemove2 = [...toRemove, ...captures2];
                                    const multipleForced2 = this.getMultipleForced(toRemove2, toAdd, jumpedWalls, undefined, wallV, player);
                                    if (multipleForced2.length > 0) {
                                        for (const mf of multipleForced2) {
                                            moves.push(firstMove + splitSymbol + wallV + "/" + mf);
                                        }
                                    } else {
                                        moves.push(firstMove + splitSymbol + wallV);
                                    }
                                }
                            }
                            // Horizontal barriers.
                            for (let i = 0; i < this.width; i++) {
                                for (let j = 1; j < this.height; j++) {
                                    const wallH = this.coords2algebraic(i, j) + "h";
                                    if (this.boardEdge.has(wallH)) { continue; }
                                    const captures2 = this.getCapturesWall(player, wallH, toRemove, toAdd, undefined, wallH, forceds2);
                                    const toRemove2 = [...toRemove, ...captures2];
                                    const multipleForced2 = this.getMultipleForced(toRemove2, toAdd, jumpedWalls, undefined, wallH, player);
                                    if (multipleForced2.length > 0) {
                                        for (const mf of multipleForced2) {
                                            moves.push(firstMove + splitSymbol + wallH + "/" + mf);
                                        }
                                    } else {
                                        moves.push(firstMove + splitSymbol + wallH);
                                    }
                                }
                            }
                        } else {
                            // If the player has run out of barriers, they move an existing unjumped barrier.
                            const walls = [...this.boardEdge.keys()].filter(wall => this.boardEdge.get(wall)![0] === player && !this.boardEdge.get(wall)![1]);
                            for (const wall of walls) {
                                // Vertical barriers.
                                for (let i = 0; i < this.width - 1; i++) {
                                    for (let j = 0; j < this.height; j++) {
                                        const wallV = this.coords2algebraic(i, j) + "v";
                                        if (wall === wallV) { continue; }
                                        if (this.boardEdge.has(wallV)) { continue; }
                                        const captures2 = this.getCapturesWall(player, wallV, toRemove, toAdd, wall, wallV, forceds2);
                                        const toRemove2 = [...toRemove, ...captures2];
                                        const multipleForced2 = this.getMultipleForced(toRemove2, toAdd, jumpedWalls, wall, wallV, player);
                                        if (multipleForced2.length > 0) {
                                            for (const mf of multipleForced2) {
                                                moves.push(firstMove + splitSymbol + wall + "-" + wallV + "/" + mf);
                                            }
                                        } else {
                                            moves.push(firstMove + splitSymbol + wall + "-" + wallV);
                                        }
                                    }
                                }
                                // Horizontal barriers.
                                for (let i = 0; i < this.width; i++) {
                                    for (let j = 1; j < this.height; j++) {
                                        const wallH = this.coords2algebraic(i, j) + "h";
                                        if (wall === wallH) { continue; }
                                        if (this.boardEdge.has(wallH)) { continue; }
                                        const captures2 = this.getCapturesWall(player, wallH, toRemove, toAdd, wall, wallH, forceds2);
                                        const toRemove2 = [...toRemove, ...captures2];
                                        const multipleForced2 = this.getMultipleForced(toRemove2, toAdd, jumpedWalls, wall, wallH, player);
                                        if (multipleForced2.length > 0) {
                                            for (const mf of multipleForced2) {
                                                moves.push(firstMove + splitSymbol + wall + "-" + wallH + "/" + mf);
                                            }
                                        } else {
                                            moves.push(firstMove + splitSymbol + wall + "-" + wallH);
                                        }
                                    }
                                }
                            }
                        }
                        // And finally, we get all possible movements by roamers.
                        const froms2: string[] = [...this.boardCell.keys()].filter(cell => this.boardCell.get(cell) === player && !toRemove.includes(cell));
                        froms2.push(...[...toAdd.keys()].filter(cell => toAdd.get(cell) === player && !toRemove.includes(cell)));
                        const forced2 = forceds2[player - 1];
                        for (const from2 of froms2) {
                            for (const [to2, jumped2] of this.getTos(player, from2, toRemove, toAdd, jumpedWalls)) {
                                const jumpedWalls2 = [jumped, jumped2].filter(j => j !== undefined) as string[];
                                const captures2 = this.getCapturesRoamer(player, to2, toRemove, toAdd, jumpedWalls2, forceds2);
                                const toRemove2 = from2 === to ? [...toRemove, ...captures2] : [...toRemove, from2, ...captures2];
                                const toAdd2 = from2 === to ? new Map([[to2, player]]) :new Map([...toAdd, [to2, player]]);
                                const multipleForced2 = this.getMultipleForced(toRemove2, toAdd2, jumpedWalls2);
                                // If we have a forced position, we need to check if the forced position is relieved.
                                if (forced2 !== undefined && forced2 !== from2 && this.checkForced(player, forced2, toRemove2, toAdd2, jumpedWalls2)) { continue; }
                                if (multipleForced2.length > 0) {
                                    for (const mf of multipleForced2) {
                                        moves.push(firstMove + splitSymbol + from2 + "-" + to2 + "/" + mf);
                                    }
                                } else {
                                    moves.push(firstMove + splitSymbol + from2 + "-" + to2);
                                }
                            }
                        }
                    }
                }
            }
        }
        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    private stillHasWalls(player: playerid): boolean {
        // Check if the current player still has walls.
        return this.wallCounts[player - 1] > 0;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = "";
            const cell = this.coords2algebraic(col, row);
            if (piece === undefined || !["N", "E", "S", "W"].includes(piece)) {
                if (this.stack.length <= SETUP_PLIES) {
                    newmove = cell;
                } else if (move === "") {
                    newmove = cell + "-";
                } else if (move.endsWith("-")) {
                    newmove = move + cell;
                } else {
                    const moveSplit = move.split(splitSymbol);
                    if (moveSplit.length === 1) {
                        const [,choice] = moveSplit[0].split("/");
                        if (choice === undefined) {
                            const [from, to] = moveSplit[0].split("-");
                            const jumped = this.getTos(this.currplayer, from).get(to);
                            const jumpedWalls = jumped === undefined ? [] : [jumped];
                            const forceds: [string | undefined, string | undefined] = [
                                this.getForced(1),
                                this.getForced(2),
                            ];
                            const captures = this.getCapturesRoamer(this.currplayer, to, [from], new Map([[to, this.currplayer]]), jumpedWalls, forceds);
                            const multipleForced = this.getMultipleForced([from, ...captures], new Map([[to, this.currplayer]]));
                            if (multipleForced.length > 0 && multipleForced.includes(cell)) {
                                newmove = move + "/" + cell;
                            } else {
                                newmove = move + splitSymbol + cell + "-";
                            }
                        } else {
                            newmove = move + splitSymbol + cell + "-";
                        }
                    } else {
                        newmove = move + "/" + cell;
                    }
                }
            } else {
                const newWall = this.render2wall(row, col, piece);
                if (move === "") {
                    if (this.boardEdge.has(newWall)) {
                        newmove = newWall + "-";
                    } else {
                        newmove = newWall;
                    }
                } else if (move.endsWith("-")) {
                    newmove = move + newWall;
                } else if (this.boardEdge.has(newWall)) {
                    newmove = move + splitSymbol + newWall + "-";
                } else {
                    newmove = move + splitSymbol + newWall;
                }
            }
            let result = this.validateMove(newmove) as IClickResult;
            if (!result.valid) {
                const revert = newmove.includes(splitSymbol) ? newmove.split(splitSymbol)[0] : "";
                result = this.validateMove(revert) as IClickResult;
                if (!result.valid) {
                    result.move = "";
                } else {
                    result.move = revert;
                }
            } else {
                result.move = newmove;
            }
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", {move, row, col, piece, emessage: (e as Error).message})
            };
        }
    }

    private validCell(cell: string): boolean {
        // Check if the cell is a valid cell on the board.
        try {
            const [x, y] = this.algebraic2coords(cell);
            // `algebraic2coords` does not check if the cell is on the board.
            if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
                throw new Error("Invalid cell");
            }
        } catch {
            return false;
        }
        return true;
    }

    private validWall(wall: string): boolean {
        // Check if the wall is a valid wall on the board.
        if (!this.endsWithHV(wall)) { return false; }
        const orient = wall[wall.length - 1];
        const head = wall.slice(0, wall.length - 1);
        if (!this.validCell(head)) { return false; }
        try {
            const [x, y] = this.algebraic2coords(head);
            // `algebraic2coords` does not check if the cell is on the board.
            if (orient === "h") {
                if (x < 0 || x >= this.width || y < 1 || y >= this.height) {
                    throw new Error("Invalid cell");
                }
            } else {
                if (x < 0 || x >= this.width - 1 || y < 0 || y >= this.height) {
                    throw new Error("Invalid cell");
                }
            }
        } catch {
            return false;
        }
        return true;
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            if (this.stack.length <= SETUP_PLIES) {
                result.message = i18next.t("apgames:validation.entrapment.INITIAL_INSTRUCTIONS_SETUP");
            } else if (this.stack.length === SETUP_PLIES + 1) {
                result.message = i18next.t("apgames:validation.entrapment.INITIAL_INSTRUCTIONS_FIRST");
            } else {
                const forced = this.getForced(this.currplayer);
                if (forced !== undefined) {
                    result.message = i18next.t("apgames:validation.entrapment.INITIAL_INSTRUCTIONS_FORCED", { where: forced });
                } else {
                    result.message = i18next.t("apgames:validation.entrapment.INITIAL_INSTRUCTIONS");
                }
            }
            return result;
        }
        // These are some variables that are used to keep track of the state of the game.
        // They are updated as we go through the actions.
        // This is needed because we do not commit any changes to the actual game board in the validation process.
        const toRemove: string[] = []
        const toAdd: Map<string, playerid> = new Map();
        const jumpedWalls: string[] = [];
        let wallFrom: string | undefined;
        let wallTo: string | undefined;
        let wallPlacer: playerid | undefined;
        if (this.stack.length <= SETUP_PLIES) {
            if (!this.validCell(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: m });
                return result;
            }
            // Already occupied cell.
            if (this.boardCell.has(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.entrapment.OCCUPIED", { cell: m });
                return result;
            }
        } else {
            const split = m.split(splitSymbol);
            // Excess action count.
            if (this.stack.length === SETUP_PLIES + 1 && split.length > 1) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.entrapment.TOO_MANY_ACTIONS_FIRST");
                return result;
            }
            if (split.length > 2) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.entrapment.TOO_MANY_ACTIONS");
                return result;
            }
            // We check each of the two actions in a loop.
            for (const [i, move] of split.entries()) {
                const [normal, choice] = move.split("/");
                const [from, to] = normal.split("-");
                // Taking an action after game has ended.
                if (i === 1 && !this.stillHasRoamersAny(toRemove, toAdd)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.entrapment.ENDED");
                    return result;
                }
                if (this.endsWithHV(from)) {
                    // If the action was to place or move a wall.
                    // Wall placement/movement cannot be the first action.
                    if (i === 0 && this.stack.length !== SETUP_PLIES + 1) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.entrapment.MOVE_FIRST");
                        return result;
                    }
                    if (!this.validWall(from)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.entrapment.INVALID_BARRIER", { wall: from });
                        return result;
                    }
                    if (this.stillHasWalls(this.currplayer)) {
                        // If we still have barriers in stash, we place a barrier.
                        if (normal.includes("-")) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.entrapment.STILL_HAVE_BARRIERS");
                            return result;
                        }
                        // There is no `to`, so the wall is actually placed at `from`.
                        if (this.boardEdge.has(from)) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.entrapment.BARRIER_EXISTS", { wall: from });
                            return result;
                        }
                        const forceds: [string | undefined, string | undefined] = [
                            this.getForced(1, toRemove, toAdd, jumpedWalls),
                            this.getForced(2, toRemove, toAdd, jumpedWalls),
                        ];
                        const captures = this.getCapturesWall(this.currplayer, from, toRemove, toAdd, undefined, from, forceds);
                        for (const capture of captures) {
                            this.updateToRemoveAdd(toRemove, toAdd, capture);
                        }
                        wallTo = from;
                        wallPlacer = this.currplayer;
                    } else {
                        // If we run out of barriers, we move an existing barrier.
                        if (!this.boardEdge.has(from)) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.entrapment.NONEXISTENT_BARRIER", { where: from });
                            return result;
                        }
                        if (this.boardEdge.get(from)![0] !== this.currplayer) {
                            if (this.boardCell.get(to) !== this.currplayer) {
                                result.valid = false;
                                result.message = i18next.t("apgames:validation.entrapment.UNCONTROLLED_BARRIER");
                                return result;
                            }
                        }
                        if (to === undefined || to === "") {
                            if (!normal.endsWith("-")) {
                                result.valid = false;
                                result.message = i18next.t("apgames:validation.entrapment.MISSING_DASH");
                                return result;
                            }
                            result.valid = true;
                            result.complete = -1;
                            result.canrender = true;
                            result.message = i18next.t("apgames:validation.entrapment.SELECT_TO_BARRIER");
                            return result;
                        }
                        if (from === to) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation._general.SAME_FROM_TO");
                            return result;
                        }
                        if (!this.validWall(to)) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.entrapment.INVALID_BARRIER", { wall: to });
                            return result;
                        }
                        if (this.boardEdge.has(to)) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.entrapment.BARRIER_EXISTS", { wall: to });
                            return result;
                        }
                        const forceds: [string | undefined, string | undefined] = [
                            this.getForced(1, toRemove, toAdd, jumpedWalls),
                            this.getForced(2, toRemove, toAdd, jumpedWalls),
                        ];
                        const captures = this.getCapturesWall(this.currplayer, from, toRemove, toAdd, from, to, forceds);
                        for (const capture of captures) {
                            this.updateToRemoveAdd(toRemove, toAdd, capture);
                        }
                        wallFrom = from;
                        wallTo = to;
                        wallPlacer = this.currplayer;
                    }
                } else {
                    // Roamer move action.
                    if (!this.validCell(from)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: from });
                        return result;
                    }
                    if ((!this.boardCell.has(from) || this.boardCell.has(from) && toRemove.includes(from)) && !toAdd.has(from)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.NONEXISTENT", { where: from });
                        return result;
                    }
                    if (!toAdd.has(from) && this.boardCell.get(from) !== this.currplayer) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.UNCONTROLLED", { where: from });
                        return result;
                    }
                    if (to === undefined || to === "") {
                        if (!normal.endsWith("-")) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.entrapment.MISSING_DASH");
                            return result;
                        }
                        result.valid = true;
                        result.complete = -1;
                        result.canrender = true;
                        result.message = i18next.t("apgames:validation.entrapment.SELECT_TO_PIECE");
                        return result;
                    }
                    if (from === to) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.SAME_FROM_TO");
                        return result;
                    }
                    if (this.boardCell.has(to) && !toRemove.includes(to)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.OCCUPIED", { where: to });
                        return result;
                    }
                    const tos = this.getTos(this.currplayer, from, toRemove, toAdd, jumpedWalls);
                    if (!tos.has(to)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.entrapment.INVALID_TO", { from, to });
                        return result;
                    }
                    const forceds: [string | undefined, string | undefined] = [
                        this.getForced(1, toRemove, toAdd, jumpedWalls),
                        this.getForced(2, toRemove, toAdd, jumpedWalls),
                    ];
                    const forced = forceds[this.currplayer - 1];
                    if (tos.get(to) !== undefined) { jumpedWalls.push(tos.get(to)!); }
                    this.updateToRemoveAdd(toRemove, toAdd, from, to);
                    const captures = this.getCapturesRoamer(this.currplayer, to, toRemove, toAdd, jumpedWalls, forceds);
                    for (const capture of captures) {
                        this.updateToRemoveAdd(toRemove, toAdd, capture);
                    }
                    if (forced !== undefined && this.checkForced(this.currplayer, forced, toRemove, toAdd, jumpedWalls)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.entrapment.FORCED_FREE", { where: forced });
                        return result;
                    }
                }
                // Now we check if the result of this action is a multiple-forced position.
                const multipleForced = this.getMultipleForced(toRemove, toAdd, jumpedWalls, wallFrom, wallTo, wallPlacer);
                if (multipleForced.length > 0) {
                    // If it is, the user has to choose which roamer to retain.
                    if (choice === undefined) {
                        if (i !== split.length - 1) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.entrapment.CHOOSE_SPARE", { where: multipleForced.join(", ") });
                            return result;
                        }
                        result.valid = true;
                        result.complete = -1;
                        result.canrender = true;
                        result.message = i18next.t("apgames:validation.entrapment.CHOOSE_SPARE", { where: multipleForced.join(", ") });
                        return result;
                    }
                    if (!multipleForced.includes(choice)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.entrapment.INVALID_SPARE", { where: multipleForced.join(", ") });
                        return result;
                    }
                    for (const cell of multipleForced) {
                        if (cell !== choice) {
                            this.updateToRemoveAdd(toRemove, toAdd, cell);
                        }
                    }
                } else if (choice !== undefined) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.entrapment.NO_SPARE");
                    return result;
                }
            }
            // Await second mandatory action.
            if (this.stack.length > SETUP_PLIES + 1 && split.length === 1 && this.stillHasRoamersAny(toRemove, toAdd)) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                if (this.stillHasWalls(this.currplayer)) {
                    result.message = i18next.t("apgames:validation.entrapment.SECOND_ACTION");
                } else {
                    result.message = i18next.t("apgames:validation.entrapment.SECOND_ACTION_MOVE_WALL");
                }
                return result;
            }
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private stillHasRoamersAny(toRemove: string[], toAdd: Map<string, playerid>): boolean {
        // Check if one player is out of roamers.
        for (const player of [1, 2] as playerid[]) {
            if (!this.stillHasRoamers(player, toRemove, toAdd)) {
                return false;
            }
        }
        return true;
    }

    private stillHasRoamers(player: playerid, toRemove: string[], toAdd: Map<string, playerid>): boolean {
        // Check if the current player still has roamers.
        // This is used to determine if the game has ended before the move is committed.
        const piecesBoard = [...this.boardCell].filter(([cell, p]) => p === player && !toRemove.includes(cell));
        const piecesToAdd = [...toAdd].filter(([cell, p]) => p === player && !toRemove.includes(cell));
        return piecesBoard.length + piecesToAdd.length > 0;
    }

    private updateToRemoveAdd(toRemove: string[], toAdd: Map<string, playerid>, remove: string, add?: string): void {
        // A quick function to update the toRemove and toAdd.
        // If `remove` and `add` are both given, we assume that the piece at `remove` is moving to `add`.
        // If only `remove` is given, we assume that the piece at `remove` is captured.
        // We do not currently support adding a piece without removing one.
        let p: playerid | undefined;
        if (toAdd.has(remove)) {
            p = toAdd.get(remove);
            toAdd.delete(remove);
        } else {
            p = this.boardCell.get(remove);
            toRemove.push(remove);
        }
        if (add !== undefined) {
            if (toRemove.includes(add)) {
                toRemove.splice(toRemove.indexOf(add), 1);
            }
            toAdd.set(add, p!);
        }
    }

    private blockedWall(
        player: playerid,
        from: string,
        dx: number,
        dy: number,
        jumpedWalls: string[] = [],
        wallFrom?: string,
        wallTo?: string,
        wallPlacer?: playerid,
        selfBlocking = false,
    ): [boolean, string | undefined] {
        // Check if path in a direction is blocked by a wall.
        // We assume that only one of dx or dy is non-zero.
        // If `selfBlocking` is true, the piece is not allowed to jump over friendly pieces or barriers;
        // this is used for checking for forced moves.
        // Returns a tuple with the first element being a boolean indicating if the path is blocked,
        // and the second element being the barrier that is jumped over, if any.
        const [x, y] = this.algebraic2coords(from);
        const isHorizontal = dx !== 0;
        const range = isHorizontal ? dx : dy;
        let newJumpedWall: string | undefined;
        for (let i = 0; i < Math.abs(range); i++) {
            const wallX = x + (isHorizontal ? (range > 0 ? i : -i - 1) : 0);
            const wallY = y + (!isHorizontal ? (range > 0 ? i + 1 : -i) : 0);
            if (wallX < 0 || wallY < 0 || wallX >= this.width || wallY >= this.height) { continue; }
            const wall = this.coords2algebraic(wallX, wallY) + (isHorizontal ? 'v' : 'h');
            if (jumpedWalls.includes(wall)) { return [true, undefined]; }
            if (this.boardEdge.has(wall) && wall !== wallFrom) {
                const [p, jumped] = this.boardEdge.get(wall)!;
                if (p !== player) { return [true, undefined]; }
                if (selfBlocking) { return [true, undefined]; }
                if (jumped) { return [true, undefined]; }
                if (newJumpedWall !== undefined) { return [true, undefined]; }
                newJumpedWall = wall;
            } else if (wall === wallTo) {
                if (selfBlocking || wallPlacer !== player) { return [true, undefined]; }
                newJumpedWall = wall;
            }
        }
        return [false, newJumpedWall];
    }

    private getTos(
        player: playerid,
        from: string,
        toRemove: string[] = [],
        toAdd: Map<string, playerid> = new Map(),
        jumpedWalls: string[] = [],
        wallFrom?: string,
        wallTo?: string,
        wallPlacer?: playerid,
        selfBlocking = false,
    ): Map<string, string | undefined> {
        // Get the possible destinations for a piece move.
        // Returns a map with the destination cell as key and the jumped barrier as value.
        // If no barrier is jumped over, the value is undefined.
        // Remember that only one barrier can be jumped over in a single move action.
        // If `selfBlocking` is true, the piece is not allowed to jump over friendly pieces or barriers;
        // this is used for checking for forced moves.
        const [x, y] = this.algebraic2coords(from);
        const tos: Map<string, string | undefined> = new Map();
        const directions = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        for (const [dx, dy] of directions) {
            // A piece may only jump over one unjumped wall or one other piece of the player.
            let seenPassableObstacle = false;
            // If we see an unjumped wall of the player, and we make it to the last line of the inner
            // for loop, we add it as a value to the `tos` map that corresponds to the cell that it can move to.
            let seenWall: string | undefined;
            for (let i = 1; i <= 2; i++) {
                const [nx, ny] = [x + i * dx, y + i * dy];
                if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) { continue; }
                const [b, jumped] = this.blockedWall(player, from, i * dx, i * dy, jumpedWalls, wallFrom, wallTo, wallPlacer, selfBlocking);
                if (b) { break; }
                if (jumped !== undefined && jumped !== seenWall) {
                    if (seenPassableObstacle) { break; }
                    seenPassableObstacle = true;
                    seenWall = jumped;
                }
                const cell = this.coords2algebraic(nx, ny);
                if (this.boardCell.has(cell) && !toRemove.includes(cell) ) {
                    if (!selfBlocking && this.boardCell.get(cell) === player) {
                        if (seenPassableObstacle) { break; }
                        seenPassableObstacle = true;
                        continue;
                    } else {
                        break;
                    }
                } else if (toAdd.has(cell) && !toRemove.includes(cell)) {
                    if (!selfBlocking && toAdd.get(cell) === player) {
                        if (seenPassableObstacle) { break; }
                        seenPassableObstacle = true;
                        continue;
                    } else {
                        break;
                    }
                }
                tos.set(cell, jumped);
            }
        }
        return tos;
    }

    private isRoamerCapture(
        cell: string,
        toRemove: string[],
        toAdd: Map<string, playerid>,
        jumpedWalls: string[],
        forced: [string | undefined, string | undefined] = [undefined, undefined],
        notForcedOverride = false,
    ): boolean {
        if (!this.boardCell.has(cell) && !toAdd.has(cell) || toRemove.includes(cell)) { return false; }
        const cellPlayer = this.boardCell.get(cell) ?? toAdd.get(cell)!;
        const notForced = notForcedOverride || cellPlayer === 1 && forced[0] === undefined || cellPlayer === 2 && forced[1] === undefined;
        return (notForced && this.getTos(cellPlayer, cell, toRemove, toAdd, jumpedWalls).size === 0) ||
            (!notForced && this.getTos(cellPlayer, cell, toRemove, toAdd, jumpedWalls, undefined, undefined, undefined, true).size === 0);
    }

    private getCapturesRoamer(
        player: playerid,
        at: string,
        toRemove: string[] = [],
        toAdd?: Map<string, playerid> | undefined,
        jumpedWalls: string[] = [],
        forced: [string | undefined, string | undefined] = [undefined, undefined],
    ): string[] {
        // Get all captures assuming that a piece of `player` is now at `at`.
        // Also checks for suicide.
        // If there is a suicide, there will be no further captures.
        // `forced` are the forced piece of both players before the move.
        // Note that we do not store where the roamer is coming from, so for the purpose of
        // checking if there is a removal due to excess forced positions, the `toRemove` array
        // must contain the cell that the roamer comes from.
        // This is usually the case in most of the code, but in the actual `move` method,
        // we need to deliberately add it.
        toAdd ??= new Map([[at, player]]);
        // If this results in multiple forced of the moving player, we can just remove the moving piece.
        const forceds = this.getAllForced(player, toRemove, toAdd, jumpedWalls);
        if (forceds.length > 1 && forceds.includes(at)) { return [at]; }
        const captures: string[] = [];
        const [x, y] = this.algebraic2coords(at);
        // The forced cell, if present, should be checked after the other cells.
        let forcedCell: string | undefined;
        for (const [c, [dx, dy]] of [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0]].entries()) {
            for (let i = 1; i <= (c === 0 ? 1 : 2); i++) {
                const [nx, ny] = [x + i * dx, y + i * dy];
                if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) { break; }
                const cell = this.coords2algebraic(nx, ny);
                if (forced[0] === cell || forced[1] === cell) {
                    forcedCell = cell;
                    continue;
                }
                // This is a check to see if the piece moved is the forced piece.
                // If it is, we do not want to enable self-blocking.
                const notForcedOverride = c === 0 && (player === 1 && forced[0] !== undefined && toRemove.includes(forced[0]) ||
                    player === 2 && forced[1] !== undefined && toRemove.includes(forced[1]))
                if (!this.isRoamerCapture(cell, toRemove, toAdd, jumpedWalls, forced, notForcedOverride)) { continue; }
                captures.push(cell);
            }
            // Suicide takes priority over captures, so if there is a suicide, it will be the only capture.
            if (c === 0 && captures.length > 0) { return captures; }
        }
        if (forcedCell !== undefined) {
            // This is actually only used in the setup phase.
            // Normally, as a result of moving a roamer, the `at` will never be the forced cell.
            if (this.isRoamerCapture(forcedCell, [...toRemove, ...captures], toAdd, jumpedWalls, forced, true)) {
                captures.push(forcedCell);
            }
        }
        return captures;
    }

    private isWallCapture(
        cell: string,
        player: playerid,
        toRemove: string[],
        toAdd: Map<string, playerid>,
        wallFrom?: string,
        wallTo?: string,
        forced: [string | undefined, string | undefined] = [undefined, undefined],
        notForcedOverride = false,
    ): boolean {
        // Check if `cell` is captured when `player` places a wall at `wallTo`.
        // If player we're checking for is also in a forced position,
        // we automatically turn on `selfBlocking` in `getTos` length check.
        // If we wish to override this, we turn on the `notForcedOverride` flag.
        // This is used when we're having different resolution priority for the actual forced piece.
        if (!this.boardCell.has(cell) && !toAdd.has(cell) || toRemove.includes(cell)) return false;
        const cellPlayer = this.boardCell.get(cell) ?? toAdd.get(cell)!;
        const notForced = notForcedOverride || cellPlayer === 1 && forced[0] === undefined || cellPlayer === 2 && forced[1] === undefined;
        return (notForced && this.getTos(cellPlayer, cell, toRemove, toAdd, undefined, wallFrom, wallTo, player).size === 0) ||
            (!notForced && this.getTos(cellPlayer, cell, toRemove, toAdd, undefined, wallFrom, wallTo, player, true).size === 0);
    }

    private getCapturesWall(
        player: playerid,
        at: string,
        toRemove: string[] = [],
        toAdd: Map<string, playerid> = new Map(),
        wallFrom?: string,
        wallTo?: string,
        forced: [string | undefined, string | undefined] = [undefined, undefined],
    ): string[] {
        // Get all captures when `player` places a wall at `at`.
        const captures: string[] = [];
        const [x, y, orient] = this.splitWall(at);
        const offsets = orient === "h" ? [-2, -1, 0, 1] : [-1, 0, 1, 2];
        // The forced cell, if present, should be checked after the other cells.
        let forcedCell: string | undefined;
        for (const i of offsets) {
            const [nx, ny] = orient === "h" ? [x, y + i] : [x + i, y];
            if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) { continue; };
            const cell = this.coords2algebraic(nx, ny);
            if (forced[0] === cell || forced[1] === cell) {
                forcedCell = cell;
                continue;
            }
            if (!this.isWallCapture(cell, player, toRemove, toAdd, wallFrom, wallTo, forced)) { continue; }
            captures.push(cell);
        }
        if (forcedCell !== undefined) {
            // When checking if the forced cell is captured, we have to first remove all captured pieces,
            // and then we check it with `notForcedOverride` set to true.
            if (this.isWallCapture(forcedCell, player, [...toRemove, ...captures], toAdd, wallFrom, wallTo, forced, true)) {
                captures.push(forcedCell);
            }
        }
        return captures;
    }

    private checkForced(
        player: playerid,
        at: string,
        toRemove: string[] = [],
        toAdd: Map<string, playerid> = new Map(),
        jumpedWalls: string[] = [],
        wallFrom?: string,
        wallTo?: string,
        wallPlacer?: playerid,
    ): boolean {
        // Check if `player`'s piece at `at` is forced to move.
        // This happens when the piece has no tos with selfBlocking check.
        // We also check if there is a piece present at `at`.
        if (toRemove.includes(at)) { return false; }
        if (!this.boardCell.has(at) && !toAdd.has(at)) { return false; }
        return this.getTos(player, at, toRemove, toAdd, jumpedWalls, wallFrom, wallTo, wallPlacer, true).size === 0;
    }

    private getForced(
        player: playerid,
        toRemove: string[] = [],
        toAdd: Map<string, playerid> = new Map(),
        jumpedWalls: string[] = [],
        wallFrom?: string,
        wallTo?: string,
        wallPlacer?: playerid,
    ): string | undefined {
        // Get the piece that is forced to move for `player`.
        // This method is called usually at the start of an action, and there must never be
        // more than one forced piece at the end of any action if the logic is correctly implemented.
        // An error is thrown if the assumption that there is only one forced piece is violated to help debugging.
        // If we're lucky, it should also prevent an action that results in an invalid state from being committed.
        const forced = this.getAllForced(player, toRemove, toAdd, jumpedWalls, wallFrom, wallTo, wallPlacer);
        if (forced.length > 1) {
            throw new Error("More than one forced in this position. Something is wrong.");
        }
        return forced.length === 0 ? undefined : forced[0];
    }

    private getAllForced(
        player: playerid,
        toRemove: string[] = [],
        toAdd: Map<string, playerid> = new Map(),
        jumpedWalls: string[] = [],
        wallFrom?: string,
        wallTo?: string,
        wallPlacer?: playerid,
    ): string[] {
        // Get all pieces that are forced for `player`.
        const forced: string[] = [];
        const boardRoamers = [...this.boardCell.keys()].filter(cell => this.boardCell.get(cell) === player);
        const toAddRoamers = [...toAdd.keys()].filter(cell => toAdd.get(cell) === player);
        for (const from of boardRoamers.concat(toAddRoamers)) {
            if (toRemove.includes(from)) { continue; }
            if (forced.includes(from)) { continue; }
            if (this.checkForced(player, from, toRemove, toAdd, jumpedWalls, wallFrom, wallTo, wallPlacer)) {
                forced.push(from);
            }
        }
        return forced;
    }

    private getMultipleForced(
        toRemove: string[] = [],
        toAdd: Map<string, playerid> = new Map(),
        jumpedWalls: string[] = [],
        wallFrom?: string,
        wallTo?: string,
        wallPlacer?: playerid,
    ): string[] {
        // If a player has more than one forced move, return all of them.
        // It's not possible for this to happen for both players at the same time,
        // so this function does not return whose pieces are returned.
        const forced1 = this.getAllForced(1, toRemove, toAdd, jumpedWalls, wallFrom, wallTo, wallPlacer);
        if (forced1.length > 1) { return forced1; }
        const forced2 = this.getAllForced(2, toRemove, toAdd, jumpedWalls, wallFrom, wallTo, wallPlacer);
        if (forced2.length > 1) { return forced2; }
        return [];
    }

    public move(m: string, { partial = false, trusted = false } = {}): EntrapmentGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        let result;
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (!trusted) {
            result = this.validateMove(m);
            if (!result.valid) {
                throw new Error(result.message);
                // throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
            if (!partial && !this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", { move: m }));
            }
        }
        if (m.length === 0) { return this; }
        // Dots are used to indicate where a roamer can move
        // or a required choice of which roamer to keep when there is more than one forced move.
        this.dots = [];
        this.results = [];
        // A move consists of one or two actions separated by a semi-colon.
        // An action looks like this:
        // * {cell}
        // * {fromCell}-{toCell}
        // * {edge}
        // * {fromEdge}-{toEdge}
        // It can also contain a choice, which is the action with /{choice} at the end.
        // The choice is used when two pieces are simultaneously placed in a forced position,
        // and the player has to choose which one to keep.
        // We choose the one to keep instead of the one to delete because sometimes in the extreme
        // case, we can have a triple-forced position, and only one should remain.
        for (const move of m.split(splitSymbol)) {
            const [normal, choice] = move.split("/");
            const forced: [string | undefined, string | undefined] = [this.getForced(1), this.getForced(2)];
            // We always end the partial move with a "-" if it is meant to be a movement action.
            if (normal.includes("-")) {
                const [from, to] = normal.split("-");
                if (this.endsWithHV(from)) {
                    // Moving a barrier from one edge to another.
                    if (to !== undefined && to !== "") {
                        this.boardEdge.delete(from);
                        this.boardEdge.set(to, [this.currplayer, false]);
                        this.results.push({ type: "move", from, to, what: "barrier" });
                        const captures = this.getCapturesWall(this.currplayer, to, undefined, undefined, from, to, forced);
                        for (const capture of captures) {
                            const whose = this.boardCell.get(capture);
                            this.boardCell.delete(capture);
                            this.results.push({ type: "capture", where: capture, whose, what: whose === this.currplayer ? "self" : "opponent" });
                        }
                        const multipleForced = this.getMultipleForced();
                        if (multipleForced.length > 0 && choice === undefined) {
                            this.dots = [...multipleForced];
                        }
                    }
                } else {
                    // Moving a roamer from one cell to another.
                    if (to !== undefined && to !== "") {
                        const tos = this.getTos(this.currplayer, from);
                        const jumpedWall = tos.get(to);
                        this.boardCell.delete(from);
                        this.boardCell.set(to, this.currplayer);
                        if (jumpedWall !== undefined) {
                            this.boardEdge.set(jumpedWall, [this.currplayer, true]);
                            this.results.push({ type: "set", where: jumpedWall });
                        }
                        this.results.push({ type: "move", from, to, what: "roamer", how: jumpedWall });
                        const captures = this.getCapturesRoamer(this.currplayer, to, [from], undefined, undefined, forced);
                        for (const capture of captures) {
                            const whose = this.boardCell.get(capture);
                            this.boardCell.delete(capture);
                            this.results.push({ type: "capture", where: capture, whose, what: whose === this.currplayer ? "self" : "opponent" });
                        }
                        const multipleForced = this.getMultipleForced();
                        if (multipleForced.length > 0 && choice === undefined) {
                            this.dots = [...multipleForced];
                        }
                    } else {
                        this.dots = [...this.getTos(this.currplayer, from).keys()];
                    }
                }
            } else {
                if (this.endsWithHV(normal)) {
                    // Placing a barrier.
                    this.boardEdge.set(normal, [this.currplayer, false]);
                    this.results.push({ type: "place", where: normal, what: "barrier" });
                    this.wallCounts[this.currplayer - 1]--;
                    const captures = this.getCapturesWall(this.currplayer, normal, undefined, undefined, undefined, normal, forced);
                    for (const capture of captures) {
                        const whose = this.boardCell.get(capture);
                        this.boardCell.delete(capture);
                        this.results.push({ type: "capture", where: capture, whose, what: whose === this.currplayer ? "self" : "opponent" });
                    }
                    const multipleForced = this.getMultipleForced();
                    if (multipleForced.length > 0 && choice === undefined) {
                        this.dots = [...multipleForced];
                    }
                } else {
                    // Placing a roamer.
                    this.boardCell.set(normal, this.currplayer);
                    this.results.push({ type: "place", where: normal, what: "roamer" });
                    const captures = this.getCapturesRoamer(this.currplayer, normal, undefined, undefined, undefined, forced);
                    for (const capture of captures) {
                        const whose = this.boardCell.get(capture);
                        this.boardCell.delete(capture);
                        this.results.push({ type: "capture", where: capture, whose, what: whose === this.currplayer ? "self" : "opponent" });
                    }
                }
            }
            // We now handle the choice at the end of the action if it is given.
            if (choice !== undefined && choice !== "") {
                const multipleForced = this.getMultipleForced();
                for (const mf of multipleForced) {
                    if (mf === choice) { continue; }
                    const p = this.boardCell.get(mf);
                    this.boardCell.delete(mf);
                    this.results.push({ type: "remove", where: mf, whose: p, what: p === this.currplayer ? "self" : "opponent", how: choice });
                }
            }
        }

        if (partial) { return this; }
        this.dots = [];

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    private outOfMoves(player: playerid): boolean {
        // Check if a player has no more walls to place or move.
        if (this.wallCounts[player - 1] > 0) { return false; }
        if ([...this.boardEdge.values()].find(p => p[0] === player && !p[1]) !== undefined) { return false; }
        return true;
    }

    protected checkEOG(): EntrapmentGame {
        if (this.stack.length < SETUP_PLIES) { return this; }
        const otherPlayer = this.currplayer % 2 + 1 as playerid;
        if ([...this.boardCell.values()].filter(p => p === otherPlayer).length === 0) {
            this.gameover = true;
            this.winner = [this.currplayer];
            this.results.push({ type: "eog" });
        } else if ([...this.boardCell.values()].filter(p => p === this.currplayer).length === 0) {
            this.gameover = true;
            this.winner = [otherPlayer];
            this.results.push({ type: "eog" });
        } else if (this.outOfMoves(this.currplayer)) {
            // Not in the rules, but if one player is out of walls to place and move,
            // we consider it a stalemate and it is a tie.
            this.gameover = true;
            this.winner = [1, 2];
            this.results.push({ type: "eog", reason: "stalemate" });
        }
        if (this.gameover) {
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public state(): IEntrapmentState {
        return {
            game: EntrapmentGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: EntrapmentGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            boardEdge: new Map(Array.from(this.boardEdge, ([key, value]) => [key, [...value]])),
            boardCell: new Map(this.boardCell),
            wallCounts: [...this.wallCounts],
        }
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
                if (this.boardCell.has(cell)) {
                    const player = this.boardCell.get(cell);
                    if (player === 1) {
                        pstr += "A";
                    } else {
                        pstr += "B";
                    }
                } else {
                    pstr += "-";
                }
            }
        }
        pstr = pstr.replace(new RegExp(`-{${this.width}}`, "g"), "_");

        // Markers are declared here, but this list will be appended to later.
        // We do this because we want the markers related to annotating previous moves
        // to be drawn below the actual barriers.
        const markers: (MarkerLine)[] = []

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-beveled",
                width: this.width,
                height: this.height,
                strokeWeight: 1,
                markers,
            },
            options: ["clickable-edges"],
            legend: {
                A: [{ name: "piece", colour: 1 }],
                B: [{ name: "piece", colour: 2 }],
            },
            pieces: pstr,
        };

        // Add annotations
        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") {
                    if (move.what === "roamer") {
                        const [x, y] = this.algebraic2coords(move.where!);
                        rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                    } else {
                        const [x, y, orient] = this.splitWall(move.where!);
                        if (orient === "h") {
                            markers.push({ type: "line", points: [{ row: y, col: x }, { row: y, col: x + 1 }], colour: "#FFFF00", width: 7, shorten: 0.075, opacity: 0.9 });
                        } else {
                            markers.push({ type: "line", points: [{ row: y + 1, col: x + 1 }, { row: y, col: x + 1 }], colour: "#FFFF00", width: 7, shorten: 0.075, opacity: 0.9 });
                        }
                    }
                } else if (move.type === "move") {
                    if (move.what === "roamer") {
                        const [fromX, fromY] = this.algebraic2coords(move.from);
                        const [toX, toY] = this.algebraic2coords(move.to);
                        rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                        if (move.how !== undefined) {
                            const [x, y, orient] = this.splitWall(move.how);
                            if (orient === "h") {
                                markers.push({ type: "line", points: [{ row: y, col: x }, { row: y, col: x + 1 }], colour: "#FFFF00", width: 7, shorten: 0.075, opacity: 0.9 });
                            } else {
                                markers.push({ type: "line", points: [{ row: y + 1, col: x + 1 }, { row: y, col: x + 1 }], colour: "#FFFF00", width: 7, shorten: 0.075, opacity: 0.9 });
                            }
                        }
                    } else {
                        const [fromX, fromY, fromOrient] = this.splitWall(move.from);
                        const [toX, toY, toOrient] = this.splitWall(move.to);
                        if (fromOrient === "h") {
                            markers.push({ type: "line", points: [{ row: fromY, col: fromX }, { row: fromY, col: fromX + 1 }], colour: "#FFFF00", width: 7, shorten: 0.075, opacity: 0.9 });
                        } else {
                            markers.push({ type: "line", points: [{ row: fromY + 1, col: fromX + 1 }, { row: fromY, col: fromX + 1 }], colour: "#FFFF00", width: 7, shorten: 0.075, opacity: 0.9 });
                        }
                        if (toOrient === "h") {
                            markers.push({ type: "line", points: [{ row: toY, col: toX }, { row: toY, col: toX + 1 }], colour: "#FFFF00", width: 7, shorten: 0.075, opacity: 0.9 });
                        } else {
                            markers.push({ type: "line", points: [{ row: toY + 1, col: toX + 1 }, { row: toY, col: toX + 1 }], colour: "#FFFF00", width: 7, shorten: 0.075, opacity: 0.9 });
                        }
                    }
                } else if (move.type === "capture" || move.type === "remove") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({ type: "exit", targets: [{ row: y, col: x }] });
                }
            }
        }

        // Draw the barriers.
        for (const [wall, [player, jumped]] of this.boardEdge.entries()) {
            const [x, y, orient] = this.splitWall(wall);
            if (orient === "h") {
                markers.push({ type: "line", points: [{ row: y, col: x }, { row: y, col: x + 1 }], colour: player, width: 5, shorten: 0.15 });
            } else {
                markers.push({ type: "line", points: [{ row: y + 1, col: x + 1 }, { row: y, col: x + 1 }], colour: player, width: 5, shorten: 0.15 });
            }
            if (jumped) {
                if (orient === "h") {
                    markers.push({ type: "line", points: [{ row: y, col: x }, { row: y, col: x + 1 }], colour: "_context_fill", width: 5, shorten: 0.15, opacity: 0.7 });
                } else {
                    markers.push({ type: "line", points: [{ row: y + 1, col: x + 1 }, { row: y, col: x + 1 }], colour: "_context_fill", width: 5, shorten: 0.15, opacity: 0.7 });
                }
            }
        }

        if (this.dots.length > 0) {
            type RowCol = {row: number; col: number;};
            const points = [];
            for (const cell of this.dots) {
                const [x, y] = this.algebraic2coords(cell);
                points.push({ row: y, col: x });
            }
            rep.annotations.push({ type: "dots", targets: points as [RowCol, ...RowCol[]] });
        }
        return rep;
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Walls In Hand**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const pieces = this.wallCounts[n - 1];
            status += `Player ${n}: ${pieces}\n\n`;
        }

        return status;
    }

    public getPlayerPieces(player: number): number {
        return this.wallCounts[player - 1];
    }

    public getPlayersScores(): IScores[] {
        if (this.stack.length < SETUP_PLIES) {
            const pieceCount1 = [...this.boardCell.values()].filter(p => p === 1).length;
            const pieceCount2 = [...this.boardCell.values()].filter(p => p === 2).length;
            return [
                { name: i18next.t("apgames:status.TOPLACE"), scores: [SETUP_PLIES / 2 - pieceCount1, SETUP_PLIES / 2 - pieceCount2]},
            ]
        }
        return [
            { name: i18next.t("apgames:status.entrapment.BARRIERS_REMAINING"), scores: [this.getPlayerPieces(1), this.getPlayerPieces(2)] }
        ]
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                if (r.what === "roamer") {
                    node.push(i18next.t("apresults:PLACE.entrapment_roamer", { player, where: r.where }));
                } else {
                    node.push(i18next.t("apresults:PLACE.entrapment_barrier", { player, where: r.where }));
                }
                resolved = true;
                break;
            case "move":
                if (r.what === "roamer") {
                    if (r.how !== undefined) {
                        node.push(i18next.t("apresults:MOVE.entrapment_roamer_jump", { player, from: r.from, to: r.to, jumped: r.how }));
                    } else {
                        node.push(i18next.t("apresults:MOVE.entrapment_roamer", { player, from: r.from, to: r.to }));
                    }
                } else {
                    node.push(i18next.t("apresults:MOVE.entrapment_barrier", { player, from: r.from, to: r.to }));
                }
                resolved = true;
                break;
            case "capture":
                if (r.what === "self") {
                    node.push(i18next.t("apresults:CAPTURE.entrapment_self", { player, where: r.where }));
                } else {
                    node.push(i18next.t("apresults:CAPTURE.entrapment_opponent", { player, where: r.where }));
                }
                resolved = true;
                break;
            case "remove":
                if (r.what === "self") {
                    node.push(i18next.t("apresults:REMOVE.entrapment_self", { player, where: r.where, how: r.how }));
                } else {
                    node.push(i18next.t("apresults:REMOVE.entrapment_opponent", { player, where: r.where, how: r.how }));

                }
                resolved = true;
                break;
            case "eog":
                if (r.reason === "stalemate") {
                    node.push(i18next.t("apresults:EOG.stalemate"));
                } else {
                    node.push(i18next.t("apresults:EOG.default"));
                }
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): EntrapmentGame {
        return new EntrapmentGame(this.serialize());
    }
}
