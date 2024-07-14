import { GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IStashEntry, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";

type playerid = 1|2;
const columnLabels = "abcdefghijklmnopqrstuvwxyz".split("");

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    playerLocs: string[][];
    lastmove?: string;
    hWalls: [number, number];
    vWalls: [number, number];
}

export interface IBlockadeState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class BlockadeGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Blockade",
        uid: "blockade",
        playercounts: [2],
        version: "20240227",
        dateAdded: "2024-03-10",
        // i18next.t("apgames:descriptions.blockade")
        description: "apgames:descriptions.blockade",
        urls: ["https://boardgamegeek.com/boardgame/2559/blockade"],
        people: [
            {
                type: "designer",
                name: "Philip Slater",
            }
        ],
        variants: [
            { uid: "optional-wall", group: "wall-placement" },
            { uid: "exclusive-wall", group: "wall-placement" },
            { uid: "back-rank", group: "goal" },
            { uid: "single-step", group: "step-count" }
        ],
        categories: ["goal>breakthrough", "mechanic>place", "mechanic>move", "mechanic>block", "board>shape>rect", "board>connect>rect", "components>special"],
        flags: ["multistep", "perspective", "player-stashes"],
        displays: [{uid: "differentiated-walls"}],
    };

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, playerid>;
    public playerLocs!: string[][];
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    public hWalls: [number, number] = [0, 0];
    public vWalls: [number, number] = [0, 0];
    private winningSpaces: string[][] = [];
    private width = 0;
    private height = 0;
    private partialWall: string | undefined;
    private completableWalls: string[] = [];
    private dots: string[] = [];

    constructor(state?: IBlockadeState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: BlockadeGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                playerLocs: this.getStartingPlayerLocs(),
                hWalls: [9, 9],
                vWalls: [9, 9],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IBlockadeState;
            }
            if (state.game !== BlockadeGame.gameinfo.uid) {
                throw new Error(`The Blockade game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
        [this.width, this.height] = this.getBoardDimensions();
        this.winningSpaces = this.getWinningSpaces();
    }

    public load(idx = -1): BlockadeGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
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
        this.playerLocs = [[...state.playerLocs[0]], [...state.playerLocs[1]]];
        this.hWalls = [...state.hWalls];
        this.vWalls = [...state.vWalls];
        return this;
    }

    private coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.height);
    }

    private algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.height);
    }

    private getBoardDimensions(): [number, number] {
        // Get the board dimensions
        return [11, 14]
    }

    private getHomes(player: playerid): string[] {
        // Get the home cells for `player`.
        if (player === 1) {
            return ["d4", "h4"];
        } else {
            return ["d11", "h11"];
        }
    }

    private getWinningSpaces(): string[][] {
        // Get the winning spaces for each player.
        const winningSpaces: string[][] = [[], []];
        if (this.variants.includes("back-rank")) {
            for (let i = 0; i < this.width; i++) {
                winningSpaces[0].push(this.coords2algebraic(i, 0));
                winningSpaces[1].push(this.coords2algebraic(i, this.height - 1));
            }
        } else {
            winningSpaces[0].push(...this.getHomes(2));
            winningSpaces[1].push(...this.getHomes(1));
        }
        return winningSpaces;
    }

    private getStartingPlayerLocs(): string[][] {
        // Get the starting locations for each player.
        const playerLocs: string[][] = [];
        playerLocs.push(this.getHomes(1));
        playerLocs.push(this.getHomes(2));
        return playerLocs;
    }

    public moves(player?: 1|2): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }
        const moves: string[] = [];
        if (this.variants.includes("exclusive-wall")) {
            for (const from of this.playerLocs[player - 1]) {
                for (const to of this.getTos(from)) {
                    moves.push(from + "-" + to);
                }
            }
            for (let i = 0; i < this.width - 1; i++) {
                for (let j = 1; j < this.height; j++) {
                    const wallH = this.coords2algebraic(i, j) + "h";
                    const wallV = this.coords2algebraic(i, j) + "v";
                    // We need a better algorithm to determine if a wall blocks a player's path to a goal.
                    // if (this.hWalls[player - 1] > 0 && !this.wallIntersects(wallH) && !this.wallBlocks(wallH, this.playerLocs)) { moves.push(wallH); }
                    // if (this.vWalls[player - 1] > 0 && !this.wallIntersects(wallV) && !this.wallBlocks(wallV, this.playerLocs)) { moves.push(wallV); }
                    if (this.hWalls[player - 1] > 0 && !this.wallIntersects(wallH)) { moves.push(wallH); }
                    if (this.vWalls[player - 1] > 0 && !this.wallIntersects(wallV)) { moves.push(wallV); }
                }
            }
            return moves;
        }
        // We need a better algorithm to determine if a wall blocks a player's path to a goal.
        // for (const from of this.playerLocs[player - 1]) {
        //     for (const to of this.getTos(from)) {
        //         if (this.variants.includes("optional-wall")) {
        //             moves.push(from + "-" + to);
        //         }
        //         const playerLocs = this.getNewPlayerLocs(player, from, to);
        //         for (let i = 0; i < this.width - 1; i++) {
        //             for (let j = 1; j < this.height; j++) {
        //                 const wallH = this.coords2algebraic(i, j) + "h";
        //                 const wallV = this.coords2algebraic(i, j) + "v";
        //                 if (this.hWalls[player - 1] > 0 && !this.wallIntersects(wallH) && !this.wallBlocks(wallH, playerLocs)) {
        //                     moves.push(from + "-" + to + "/" + wallH);
        //                 }
        //                 if (this.vWalls[player - 1] > 0 && !this.wallIntersects(wallV) && !this.wallBlocks(wallV, playerLocs)) {
        //                     moves.push(from + "-" + to + "/" + wallV);
        //                 }
        //             }
        //         }
        //     }
        // }
        const fromTos: string[] = [];
        for (const from of this.playerLocs[player - 1]) {
            for (const to of this.getTos(from)) {
                if (!(this.variants.includes("optional-wall") || this.hWalls[player - 1] === 0 && this.vWalls[player - 1] === 0) &&
                        this.winningSpaces[player - 1].includes(to)) {
                    moves.push(from + "-" + to);
                }
                fromTos.push(from + "-" + to);
            }
        }
        const walls: string[] = [];
        for (let i = 0; i < this.width - 1; i++) {
            for (let j = 1; j < this.height; j++) {
                const wallH = this.coords2algebraic(i, j) + "h";
                const wallV = this.coords2algebraic(i, j) + "v";
                if (this.hWalls[player - 1] > 0 && !this.wallIntersects(wallH)) { walls.push(wallH); }
                if (this.vWalls[player - 1] > 0 && !this.wallIntersects(wallV)) { walls.push(wallV); }
            }
        }
        if (this.variants.includes("optional-wall") || this.hWalls[player - 1] === 0 && this.vWalls[player - 1] === 0) {
            moves.push(...fromTos);
        }
        for (const fromTo of fromTos) {
            for (const wall of walls) {
                moves.push(fromTo + "/" + wall);
            }
        }
        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
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

    private wall2render(cell: string): [number, number, string] {
        // Converts wall notation back to a form that is understood by the renderer.
        const letter = cell[0];
        const pair: string[] = cell.split("");
        const numStr = pair.slice(1, pair.length - 1).join("");
        const num = Number(numStr);
        const orientation = pair[pair.length - 1];
        const x = letter === "z" ? 0 :columnLabels.indexOf(letter);
        if (x === undefined || x < 0) {
            throw new Error(`The column label is invalid: ${pair[0]}`);
        }
        const y = orientation === "h" && num !== this.height ? num + 1 : num;
        if (y === undefined || isNaN(y) || numStr === "" ) {
            throw new Error(`The row label is invalid: ${numStr}`);
        }
        let newOrientation;
        if (orientation === "v") {
            newOrientation = letter === "z" ? "W" : "E";
        } else {
            newOrientation = num === this.height ? "N" : "S";
        }
        return [x, this.height - y, newOrientation];
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

    private createWall(x: number, y: number, orient: string): string {
        // Create a wall from its components.
        return this.coords2algebraic(x, y) + orient;
    }

    private getCompletableWalls(partialWall: string): string[] {
        // Get the placeable walls that are adjacent to `partialWall`.
        const [x, y, orient] = this.splitWall(partialWall);
        const walls: string[] = [];
        if (orient === "h") {
            if (x > 0) {
                const wall = this.createWall(x - 1, y, "h");
                if (!this.boardHas(wall) && !this.board.has(this.createWall(x - 1, y, "v"))) { walls.push(wall); }
            }
            if (x < this.width - 1) {
                const wall = this.createWall(x + 1, y, "h");
                if (!this.boardHas(wall) && !this.board.has(this.createWall(x, y, "v"))) { walls.push(wall); }
            }
        } else {
            if (y > 0) {
                const wall = this.createWall(x, y - 1, "v");
                if (!this.boardHas(wall) && !this.board.has(this.createWall(x, y, "h"))) { walls.push(wall); }
            }
            if (y < this.height - 1) {
                const wall = this.createWall(x, y + 1, "v");
                if (!this.boardHas(wall) && !this.board.has(this.createWall(x, y + 1, "h"))) { walls.push(wall); }
            }
        }
        return walls;
    }

    private combineWalls(wall1: string, wall2: string): string {
        // Combine two adjacent walls into a single wall.
        // We always take the southern or eastern wall.
        const [x1, y1, orient1] = this.splitWall(wall1);
        const [x2, y2, orient2] = this.splitWall(wall2);
        if (orient1 !== orient2) { throw new Error("Walls must be of the same orientation."); }
        if (orient1 === "h") {
            if (y1 !== y2) { throw new Error("Walls must be on the same row."); }
            if (x1 > x2) { return wall2; }
            return wall1;
        } else {
            if (x1 !== x2) { throw new Error("Walls must be on the same column."); }
            if (y1 < y2) { return wall2; }
            return wall1;
        }
    }

    private secondWall(wall: string): string {
        // Given a wall in contracted form, return the second wall in the pair.
        const [x, y, orient] = this.splitWall(wall);
        if (orient === "h") {
            return this.createWall(x + 1, y, "h");
        } else {
            return this.createWall(x, y - 1, "v");
        }
    }

    private firstWall(wall: string): string {
        // Given a wall in contracted form, return the first wall in the pair.
        const [x, y, orient] = this.splitWall(wall);
        if (orient === "h") {
            return this.createWall(x - 1, y, "h");
        } else {
            return this.createWall(x, y + 1, "v");
        }
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = "";
            const cell = this.coords2algebraic(col, row);
            if (piece === undefined || !["N", "E", "S", "W"].includes(piece)) {
                if (move === "") {
                    newmove = cell + "-";
                } else {
                    const playerLocs = this.playerLocs[this.currplayer - 1];
                    if (playerLocs.includes(cell)) {
                        // Clicking on the player's piece will reset the entire move.
                        newmove = cell + "-";
                    } else if (move[move.length - 1] === "-" && playerLocs.includes(move.slice(0, move.length - 1))) {
                        newmove = move + cell;
                    } else {
                        newmove = move;
                    }
                }
            } else {
                if (move[move.length - 1] === "-") {
                    const newWall = this.render2wall(row, col, piece);
                    const split = move.split("/");
                    if (this.endsWithHV(move[move.length - 2])) {
                        const prefix = split.length === 1 ? "" : split[0] + "/";
                        const prevWall = split.length === 1 ? move.slice(0, move.length - 1) : split[1].slice(0, split[1].length - 1);
                        if (prevWall === newWall) {
                            newmove = prefix + newWall;
                        } else if (this.getCompletableWalls(prevWall).includes(newWall)) {
                            newmove = prefix + this.combineWalls(prevWall, newWall);
                        } else {
                            if (this.variants.includes("exclusive-wall")) {
                                newmove = "";
                            } else {
                                newmove = split[0];
                            }
                        }
                    } else {
                        if (this.variants.includes("exclusive-wall")) {
                            newmove = "";
                        } else {
                            newmove = split[0];
                        }
                    }
                } else {
                    const split = move.split("/");
                    const prefix = move === "" ? "" : split[0] + "/";
                    const wall = this.render2wall(row, col, piece);
                    const completableWalls = this.getCompletableWalls(wall);
                    if (completableWalls.length === 1) {
                        newmove = prefix + this.combineWalls(wall, completableWalls[0]);
                    } else {
                        newmove = prefix + wall + "-";
                    }
                }
            }
            const result = this.validateMove(newmove) as IClickResult;
            if (!result.valid) {
                if (newmove.includes("/")) {
                    result.move = newmove.split("/")[0];
                } else if (newmove.includes("-")) {
                    result.move = move;
                } else {
                    result.move = "";
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

    private endsWithHV(cell: string): boolean {
        // Check if the cell ends with an "h" or "v".
        const lastChar = cell[cell.length - 1];
        return lastChar === "h" || lastChar === "v";
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
        const head = wall.slice(0, wall.length - 1);
        if (!this.validCell(head)) { return false; }
        try {
            const [x, y] = this.algebraic2coords(head);
            // `algebraic2coords` does not check if the cell is on the board.
            if (x < 0 || x >= this.width - 1 || y < 1 || y >= this.height) {
                throw new Error("Invalid cell");
            }
        } catch {
            return false;
        }
        return true;
    }

    private boardHas(halfWall: string, newWall?: string): boolean {
        // Check if board has a half wall.
        // This is useful because `this.board` is a one-sided map.
        return this.board.has(halfWall) || this.board.has(this.firstWall(halfWall)) ||
            newWall !== undefined && (halfWall === newWall || halfWall === this.secondWall(newWall));
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        if (m.length === 0) {
            const message = this.variants.includes("exclusive-wall")
                ? "apgames:validation.blockade.INITIAL_INSTRUCTIONS_EXCLUSIVE"
                : this.variants.includes("optional-wall")
                ? "apgames:validation.blockade.INITIAL_INSTRUCTIONS_OPTIONAL"
                : "apgames:validation.blockade.INITIAL_INSTRUCTIONS";
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t(message);
            return result;
        }
        let [first, second] = m.split("/");
        if (second !== undefined && this.variants.includes("exclusive-wall")) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.blockade.EXCLUSIVE");
            return result;
        }
        // To streamline the checks, we make `first` always be the movement and `second` always be the wall placement.
        // For exclusive-walls variant, we can have wall placement as `first`.
        // In that case, we make `second` equal to `first`, and skip checks for `first`.
        let skipFirstCheck = false;
        if (this.variants.includes("exclusive-wall") && this.endsWithHV(first.split("-")[0])) {
            second = first;
            skipFirstCheck = true;
        }
        let playerLocs = this.playerLocs;
        if (!skipFirstCheck) {
            const moveSplit = first.split("-");
            for (const cell of moveSplit) {
                if (cell === "") { continue; }
                if (!this.validCell(cell)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.blockade.INVALID_CELL", { cell });
                    return result;
                }
            }
            if (moveSplit.length === 1) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.blockade.MISSING_DASH", { move: first });
                return result;
            }
            if (moveSplit[1] === "") { moveSplit.pop(); }
            const [from, to] = moveSplit;
            if (this.playerLocs[this.currplayer % 2].includes(from)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                return result;
            }
            if (!this.playerLocs[this.currplayer - 1].includes(from)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NONEXISTENT", { where: from });
                return result;
            }
            if (first[first.length - 1] === "-") {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.blockade.SELECT_TO");
                return result;
            }
            if (from === to) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.SAME_FROM_TO");
                return result;
            }
            if (this.playerLocs[this.currplayer - 1].includes(to)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", { where: to });
                return result;
            }
            const tos = this.getTos(from);
            if (tos.length === 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.blockade.NO_VALID_MOVES", { where: from });
                return result;
            }
            if (!tos.includes(to)) {
                if (this.playerLocs[this.currplayer % 2].includes(to)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.OCCUPIED", { where: to });
                    return result;
                }
                result.valid = false;
                result.message = i18next.t("apgames:validation.blockade.INVALID_TO", { from, to });
                return result;
            }
            // If it's a winning move, we don't need to place walls.
            if (second === undefined && this.winningSpaces[this.currplayer - 1].includes(to)) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
            playerLocs = this.getNewPlayerLocs(this.currplayer, from, to);
        }
        if (second === undefined) {
            if (this.variants.includes("exclusive-wall")) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
            if (this.hWalls[this.currplayer - 1] === 0 && this.vWalls[this.currplayer - 1] === 0) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
            if (this.variants.includes("optional-wall")) {
                result.valid = true;
                result.complete = 0;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.blockade.NO_WALL_OPTIONAL");
                return result;
            }
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.blockade.NO_WALL");
            return result;
        }
        if (second[second.length - 1] === "-") {
            const withoutDash = second.slice(0, second.length - 1);
            if (!this.validWall(withoutDash)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.blockade.INVALID_WALL", { wall: withoutDash });
                return result;
            }
            if (this.boardHas(withoutDash)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.blockade.OCCUPIED_WALL", { wall: withoutDash });
                return result;
            }
            const [, , orientPartial] = this.splitWall(withoutDash);
            if (orientPartial === "h" && this.hWalls[this.currplayer - 1] === 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.blockade.INSUFFICIENT_HWALL");
                return result;
            }
            if (orientPartial === "v" && this.vWalls[this.currplayer - 1] === 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.blockade.INSUFFICIENT_VWALL");
                return result;
            }
            if (this.getCompletableWalls(withoutDash).length === 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.blockade.NO_COMPLETEABLE_WALL", { wall: withoutDash });
                return result;
            }
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.blockade.SELECT_SECOND_WALL", { wall: withoutDash });
            return result;
        }
        if (!this.validWall(second)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.blockade.INVALID_WALL", { wall: second });
            return result;
        }
        const [, , orient] = this.splitWall(second);
        if (orient === "h" && this.hWalls[this.currplayer - 1] === 0) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.blockade.INSUFFICIENT_HWALL");
            return result;
        }
        if (orient === "v" && this.vWalls[this.currplayer - 1] === 0) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.blockade.INSUFFICIENT_VWALL");
            return result;
        }
        if (this.wallIntersects(second)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.blockade.OCCUPIED_WALL", { wall: second });
            return result;
        }
        if (!playerLocs[this.currplayer - 1].some((cell) => this.winningSpaces[this.currplayer - 1].includes(cell)) &&
                this.wallBlocks(second, playerLocs)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.blockade.BLOCKS_GOAL", { wall: second });
            return result;
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private getNewPlayerLocs(player: playerid, from: string, to: string): string[][] {
        // Return the new playerLocs after a move.
        // This is mainly used for the `wallBlocks` check, where we need may need to
        // check if a wall placement blocks a player's path to a goal before the move is committed.
        const newPlayerLocs = [this.playerLocs[0].slice(), this.playerLocs[1].slice()];
        const index = newPlayerLocs[player - 1].indexOf(from);
        newPlayerLocs[player - 1][index] = to;
        return newPlayerLocs;
    }

    private wallBlocks(wall: string, playerLocs: string[][]): boolean {
        // Check if a wall placement does not block any player's path to any goal.
        // This is very hacky because it was retrofitted to allow back-rank wall block check.
        // Basically, in the normal variant, both pieces must have a path to both goals, so we check
        // that from a piece's location, there is a path to both goals AND the other piece of that colour.
        // For the back-rank variant, there needs to be a path to any back-rank square.
        // This means that it's possible to cut off the player's pieces from each other as long as
        // both pieces individually have a path to one of the back-rank squares.
        outer:
        for (const [i, locs] of playerLocs.entries()) {
            const startPoints: string[] = this.variants.includes("back-rank") ? locs : [locs[0]]
            inner:
            for (const [j, startPoint] of startPoints.entries()) {
                const mandatory: string[] = this.variants.includes("back-rank") ? [] : locs.slice(1);
                const oneOf: string[] = [];
                if (this.variants.includes("back-rank")) {
                    oneOf.push(...this.winningSpaces[i]);
                } else {
                    mandatory.push(...this.winningSpaces[i]);
                }
                let oneOfSatisfied = oneOf.length === 0 ? true : false;
                const seen: Set<string> = new Set();
                const todo: string[] = [startPoint];
                while (todo.length > 0) {
                    const cell = todo.pop()!;
                    if (seen.has(cell)) { continue; }
                    seen.add(cell);
                    for (const to of this.getTos(cell, i + 1 as playerid, wall, false)) {
                        if (mandatory.includes(to)) { mandatory.splice(mandatory.indexOf(to), 1); }
                        if (!oneOfSatisfied && oneOf.includes(to)) { oneOfSatisfied = true; }
                        if (mandatory.length === 0 && oneOfSatisfied) {
                            if (j === startPoints.length - 1) { continue outer; }
                            continue inner;
                        }
                        if (!seen.has(to)) { todo.push(to); }
                    }
                }
                return true;
            }
        }
        return false;
    }

    private wallIntersects(wall: string): boolean {
        // Check if a wall placement intersects any other wall.
        if (this.boardHas(wall)) { return true; }
        if (this.boardHas(this.secondWall(wall))) { return true; }
        const [x, y, orient] = this.splitWall(wall);
        if (orient === "h") {
            if (this.board.has(this.createWall(x, y, "v"))) { return true; }
        } else {
            if (this.board.has(this.createWall(x, y, "h"))) { return true; }
        }
        return false;
    }

    private blocked(from: string, delta: [number, number], newWall?: string): boolean {
        // Check if the path from `from` to `to` is blocked.
        // This only works for single- and double-step movements.
        const [x, y] = this.algebraic2coords(from);
        const magnitudeX = Math.abs(delta[0]);
        const signX = Math.sign(delta[0]);
        const magnitudeY = Math.abs(delta[1]);
        const signY = Math.sign(delta[1]);
        const diagonal = magnitudeX > 0 && magnitudeY > 0;
        if (diagonal) {
            const wallH1 = this.createWall(x + signX + (signX > 0 ? -1 : 0), y, "v");
            const wallH2 = this.createWall(x + signX, y + signY + (signY < 0 ? 1 : 0), "h")
            const wallV1 = this.createWall(x, y + signY + (signY < 0 ? 1 : 0), "h");
            const wallV2 = this.createWall(x + signX + (signX > 0 ? -1 : 0), y + signY, "v");
            return (this.boardHas(wallH1, newWall) || this.boardHas(wallH2, newWall)) &&
            (this.boardHas(wallV1, newWall) || this.boardHas(wallV2, newWall));
        } else {
            for (let i = 1; i <= magnitudeX; i++) {
                const wall = this.createWall(x + i * signX + (signX > 0 ? -1 : 0), y, "v");
                if (this.boardHas(wall, newWall)) { return true; }
            }
            for (let i = 1; i <= magnitudeY; i++) {
                const wall = this.createWall(x, y + i * signY + (signY < 0 ? 1 : 0), "h");
                if (this.boardHas(wall, newWall)) { return true; }
            }
            return false;
        }
    }

    private getTos(from: string, player?: playerid, newWall?: string, playerBlocking = true): string[] {
        // Get all valid spaces that a piece can move to from `from`.
        if (player === undefined) { player = this.currplayer; }
        const [x, y] = this.algebraic2coords(from);
        const tos: string[] = [];
        if (this.variants.includes("single-step")) {
            const deltas: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            for (const delta of deltas.slice()) {
                const [dx, dy] = delta;
                const toX = x + dx;
                const toY = y + dy;
                const signX = Math.sign(delta[0]);
                const signY = Math.sign(delta[1]);
                if (this.playerLocs[player % 2].includes(this.coords2algebraic(toX, toY))) {
                    // If opponent is blocking, and f the space directly behind the opponent
                    // exists and is not blocked,
                    // player can move to the space behind the opponent.
                    const behindX = x + 2 * signX;
                    const behindY = y + 2 * signY;
                    if (signX !== 0) {
                        const inBounds = behindX >= 0 && behindX < this.width;
                        if (inBounds && !this.boardHas(this.createWall(behindX + (signX > 0 ? -1 : 0), y, "v"), newWall)) {
                            deltas.push([2 * signX, 0]);
                        } else {
                            deltas.push([signX, -1]);
                            deltas.push([signX, 1]);
                        }
                    } else {
                        const inBounds = behindY >= 0 && behindY < this.height;
                        if (inBounds && !this.boardHas(this.createWall(x, behindY + (signY < 0 ? 1 : 0), "h"), newWall)) {
                            deltas.push([0, 2 * signY]);
                        } else {
                            deltas.push([-1, signY]);
                            deltas.push([1, signY]);
                        }
                    }
                }
            }
            for (const delta of deltas) {
                const [dx, dy] = delta;
                const toX = x + dx;
                const toY = y + dy;
                const magnitude = Math.abs(dx) + Math.abs(dy);
                if (toX >= 0 && toX < this.width && toY >= 0 && toY < this.height && !this.blocked(from, delta, newWall)) {
                    const to = this.coords2algebraic(toX, toY);
                    if (
                        !playerBlocking ||
                        this.winningSpaces[player - 1].includes(to) ||
                        !this.playerLocs[0].includes(to) && !this.playerLocs[1].includes(to) ||
                        // allow capture if opponent is double-blocking.
                        !this.playerLocs[player - 1].includes(to) && magnitude > 1
                    ) { tos.push(to); }
                }
            }
        } else {
            const deltas: [number, number][] = [
                [-2, 0], [2, 0], [0, -2], [0, 2],
                [-1, -1], [-1, 1], [1, -1], [1, 1],
            ];
            const check: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            for (const delta of deltas) {
                const [dx, dy] = delta;
                const toX = x + dx;
                const toY = y + dy;
                if (toX >= 0 && toX < this.width && toY >= 0 && toY < this.height && !this.blocked(from, delta, newWall)) {
                    const to = this.coords2algebraic(toX, toY);
                    if (!playerBlocking || !this.playerLocs[0].includes(to) && !this.playerLocs[1].includes(to)) {
                        tos.push(to);
                    }
                }
            }
            // Single step possible only if it is to a goal.
            for (const delta of check) {
                const [dx, dy] = delta;
                const toX = x + dx;
                const toY = y + dy;
                if (toX >= 0 && toX < this.width && toY >= 0 && toY < this.height && !this.blocked(from, delta, newWall)) {
                    const to = this.coords2algebraic(toX, toY);
                    if (this.winningSpaces[player - 1].includes(to) && !tos.includes(to)) {
                        tos.push(to);
                    }
                }
            }
        }
        return tos;
    }

    public move(m: string, {partial = false, trusted = false} = {}): BlockadeGame {
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
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}));
            }
        }
        if (m.length === 0) { return this; }
        this.results = [];
        const split = m.split("/");
        for (const move of split) {
            if (move[move.length - 1] === "-") { break; }
            if (this.endsWithHV(move)) {
                const [, , orient] = this.splitWall(move);
                this.results.push({ type: "place", where: move, what: orient });
                this.board.set(move, this.currplayer);
                if (orient === "h") {
                    this.hWalls[this.currplayer - 1]--;
                } else {
                    this.vWalls[this.currplayer - 1]--;
                }
            } else {
                const [from, to] = move.split("-");
                const index = this.playerLocs[this.currplayer - 1].indexOf(from);
                this.playerLocs[this.currplayer - 1][index] = to;
                if (this.playerLocs[this.currplayer % 2].includes(to)) {
                    const index2 = this.playerLocs[this.currplayer % 2].indexOf(to);
                    this.playerLocs[this.currplayer % 2].splice(index2, 1);
                    this.results.push({ type: "capture", where: to });
                }
                this.results.push({ type: "move", from, to });
            }
        }
        const endMove = split[split.length - 1];
        if (endMove[endMove.length - 1] === "-") {
            const withoutDash = endMove.slice(0, endMove.length - 1);
            if (!this.endsWithHV(withoutDash)) {
                this.dots = this.getTos(withoutDash);
                this.partialWall = undefined;
                this.completableWalls = [];
            } else {
                this.partialWall = withoutDash;
                this.completableWalls = this.getCompletableWalls(withoutDash);
                this.dots = [];
            }
        } else {
            this.dots = [];
            this.partialWall = undefined;
            this.completableWalls = [];
        }
        if (partial) { return this; }
        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): BlockadeGame {
        if (this.playerLocs[this.currplayer % 2].some((cell) => this.winningSpaces[this.currplayer % 2].includes(cell))){
            this.gameover = true;
            this.winner = [this.currplayer % 2 + 1 as playerid];
        }
        if (this.gameover) {
            this.results.push({type: "eog"});
            this.results.push({type: "winners", players: [...this.winner]});
        }
        return this;
    }

    public state(): IBlockadeState {
        return {
            game: BlockadeGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: BlockadeGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            playerLocs: [[...this.playerLocs[0]], [...this.playerLocs[1]]],
            hWalls: [...this.hWalls],
            vWalls: [...this.vWalls],
        };
    }

    public render(opts?: IRenderOpts): APRenderRep {
        let altDisplay: string | undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }
        let differentiatedWalls = false;
        if (altDisplay !== undefined) {
            if (altDisplay === "differentiated-walls") {
                differentiatedWalls = true;
            }
        }
        // Build piece string
        let pstr = "";
        for (let row = 0; row < this.height; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            for (let col = 0; col < this.width; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.playerLocs[0].includes(cell)) {
                    pstr += "A";
                } else if (this.playerLocs[1].includes(cell)) {
                    pstr += "B";
                } else {
                    pstr += "-";
                }
            }
        }
        pstr = pstr.replace(new RegExp(`-{${this.width}}`, "g"), "_");

        const markers: any[] = []
        for (const [i, spaces] of this.winningSpaces.entries()) {
            const points: any[] = [];
            for (const cell of spaces) {
                const [x, y] = this.algebraic2coords(cell);
                points.push({row: y, col: x});
            }
            markers.push({ type: "flood", points, colour: (i + 1) % 2 + 1, opacity: 0.4 });
        }
        for (const wall of this.completableWalls) {
            const [x, y, side] = this.wall2render(wall);
            markers.push({ type: "fence", cell: {row: y, col: x}, side, colour: "#888", width: 1.5, dashed: [2, 9] });
        }
        if (this.partialWall !== undefined) {
            const [x, y, orient] = this.splitWall(this.partialWall);
            const colour: playerid = differentiatedWalls ? this.currplayer : 3 as playerid;
            if (orient === "h") {
                markers.push({ type: "line", points: [{row: y, col: x}, {row: y, col: x + 1}], colour, width: 6, shorten: 0.15 });
                markers.push({ type: "line", points: [{row: y, col: x}, {row: y, col: x + 1}], colour: "#FFFF00", width: 6, shorten: 0.15, opacity: 0.5 });
            } else {
                markers.push({ type: "line", points: [{row: y + 1, col: x + 1}, {row: y, col: x + 1}], colour, width: 6, shorten: 0.15 });
                markers.push({ type: "line", points: [{row: y + 1, col: x + 1}, {row: y, col: x + 1}], colour: "#FFFF00", width: 8, shorten: 0.15, opacity: 0.5 });
            }
        }
        for (const [wall, player] of this.board.entries()) {
            const [x, y, orient] = this.splitWall(wall);
            const colour: playerid = differentiatedWalls ? player : 3 as playerid;
            if (orient === "h") {
                markers.push({ type: "line", points: [{row: y, col: x}, {row: y, col: x + 2}], colour, width: 6, shorten: 0.075 });
            } else {
                markers.push({ type: "line", points: [{row: y + 1, col: x + 1}, {row: y - 1, col: x + 1}], colour, width: 6, shorten: 0.075 });
            }
        }

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
                if (move.type === "move") {
                    const [fromX, fromY] = this.algebraic2coords(move.from);
                    const [toX, toY] = this.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                }
            }
        }
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
                    const [x, y, orient] = this.splitWall(move.where!);
                    if (orient === "h") {
                        markers.push({ type: "line", points: [{row: y, col: x}, {row: y, col: x + 2}], colour: "#FFFF00", width: 6, shorten: 0.075, opacity: 0.5 });
                    } else {
                        markers.push({ type: "line", points: [{row: y + 1, col: x + 1}, {row: y - 1, col: x + 1}], colour: "#FFFF00", width: 6, shorten: 0.075, opacity: 0.5 });
                    }
                }
                if (move.type === "capture") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                }
            }
        }
        if (this.dots.length > 0) {
            const points = [];
            for (const cell of this.dots) {
                const [x, y] = this.algebraic2coords(cell);
                points.push({row: y, col: x});
            }
            rep.annotations.push({type: "dots", targets: points as [{row: number; col: number;}, ...{row: number; col: number;}[]]});
        }
        return rep;
    }

    public getPlayerStash(player: number): IStashEntry[] | undefined {
        return [
            {count: this.hWalls[player - 1], glyph: { name: "hline", colour: 3 }, movePart: ""},
            {count: this.vWalls[player - 1], glyph: { name: "vline", colour: 3 }, movePart: ""},
        ];
    }

    public status(): string {
        let status = super.status();
        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Pieces In Hand**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            status += `Player ${n}: h - ${this.hWalls[n - 1]}, v - ${this.vWalls[n - 1]}\n\n`;
        }

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "move":
                node.push(i18next.t("apresults:MOVE.blockade", { player, from: r.from, to: r.to, count: r.count }));
                resolved = true;
                break;
            case "place":
                if (r.what === "h") {
                    node.push(i18next.t("apresults:PLACE.blockade_h", { player, where: r.where }));
                } else {
                    node.push(i18next.t("apresults:PLACE.blockade_v", { player, where: r.where }));
                }
                resolved = true;
                break;
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.blockade", { player, where: r.where }));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): BlockadeGame {
        return new BlockadeGame(this.serialize());
    }
}
