import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
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
}

export interface IAyuState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class AyuGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Ayu",
        uid: "ayu",
        playercounts: [2],
        // version: "20240517",
        // Changed win condition so that the losing player must still make a final move
        // even if no matter what they do they will lose the game.
        version: "20241010",
        dateAdded: "2024-05-26",
        // i18next.t("apgames:descriptions.ayu")
        description: "apgames:descriptions.ayu",
        urls: ["https://boardgamegeek.com/boardgame/114484/ayu"],
        people: [
            {
                type: "designer",
                name: "Luis Bolaños Mures",
                urls: ["https://boardgamegeek.com/boardgamedesigner/47001/luis-bolanos-mures"],
                apid: "6b518a3f-7f63-47b8-b92b-a04792fba8e7",
            },
            {
                type: "coder",
                name: "ypaul",
                urls: [],
                apid: "46f6da78-be02-4469-94cb-52f17078e9c1",
            },
        ],
        variants: [
            { uid: "size-9", group: "board" },
            { uid: "size-11", group: "board" },
            { uid: "#board" },
            { uid: "size-15", group: "board" },
            { uid: "size-17", group: "board" },
        ],
        categories: ["goal>unify", "mechanic>move>group", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["pie"],
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
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private boardSize = 0;
    private dots: string[] = [];
    private selected: string | undefined;

    constructor(state?: IAyuState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            this.boardSize = this.getBoardSize();
            const board = this.initBoard();
            const fresh: IMoveState = {
                _version: AyuGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IAyuState;
            }
            if (state.game !== AyuGame.gameinfo.uid) {
                throw new Error(`The Ayu game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
            this.boardSize = this.getBoardSize();
        }
        this.load();
    }

    public load(idx = -1): AyuGame {
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
        return 13;
    }

    private initBoard(): Map<string, playerid> {
        // Get the initial board.
        const board = new Map<string, playerid>();
        for (let row = 0; row < Math.ceil(this.boardSize / 2); row++) {
            for (let col = 0; col < Math.ceil(this.boardSize / 2); col++) {
                if (2 * col + 1 < this.boardSize) { board.set(this.coords2algebraic(2 * col + 1, 2 * row), 1); }
                if (2 * row + 1 < this.boardSize) { board.set(this.coords2algebraic(2 * col, 2 * row + 1), 2); }
            }
        }
        return board;
    }

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }
        const moves: string[] = [];
        const allPieces = [...this.board.entries()].filter(([, contents]) => contents === player);
        for (const [cell] of allPieces) {
            const tos = this.getTos(cell);
            for (const to of tos) {
                moves.push(cell + "-" + to);
            }
        }
        return moves;
    }

    public hasMoves(player?: playerid): boolean {
        // Check if the player has any moves.
        // Same as `moves` but returns exits early if any moves are found.
        if (player === undefined) {
            player = this.currplayer;
        }
        const allPieces = [...this.board.entries()].filter(([, contents]) => contents === player);
        for (const [cell] of allPieces) {
            const tos = this.getTos(cell);
            if (tos.length > 0) { return true; }
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
            if (move === cell) {
                newmove = "";
            } else if (this.board.has(cell) || move.length === 0) {
                newmove = cell;
            } else {
                newmove = move + "-" + cell;
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
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.ayu.INITIAL_INSTRUCTIONS");
            return result;
        }
        const [from, to] = m.split("-");
        // valid cell
        let currentMove;
        try {
            for (const p of [from, to]) {
                if (p === undefined || p.length === 0) { continue; }
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
        if (!this.board.has(from)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NONEXISTENT", { where: from });
            return result;
        }
        if (this.board.get(from) !== this.currplayer) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.UNCONTROLLED", { where: from });
            return result;
        }
        const tos = this.getTos(from);
        if (tos.length === 0) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.ayu.NO_MOVES", { where: from });
            return result;
        }
        if (to === undefined || to === "") {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation._general.NEED_DESTINATION");
            return result;
        }
        if (to === from) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.SAME_FROM_TO");
            return result;
        }
        if (this.board.has(to)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", { where: to });
            return result;
        }
        if (!tos.includes(to)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.ayu.INVALID_TO", { from, to });
            return result;
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private getNeighbours(cell: string): string[] {
        // Get all orthogonally adjacent cells that are on the board.
        const [x, y] = this.algebraic2coords(cell);
        const neighbors = [];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (x + dx < 0 || x + dx >= this.boardSize || y + dy < 0 || y + dy >= this.boardSize) {
                continue;
            }
            neighbors.push(this.coords2algebraic(x + dx, y + dy));
        }
        return neighbors;
    }

    private getGroup(cell: string): Set<string> {
        // Get the group of cells that are connected to the given cell.
        const player = this.board.get(cell);
        const seen = new Set<string>();
        const todo = [cell];
        while (todo.length > 0) {
            const current = todo.pop()!;
            if (seen.has(current)) { continue; }
            seen.add(current);
            for (const neighbour of this.getNeighbours(current)) {
                if (this.board.has(neighbour) && this.board.get(neighbour) === player) {
                    todo.push(neighbour);
                }
            }
        }
        return seen;
    }

    private getMovableToCells(group: Set<string>): string[] {
        // Get the cells that are adjacent `group` that when moved to will.
        // approach a friendly cell outside fo the group.
        // The strategy is to get all the nearest friendly cells to the group and bound for the search.
        // Then check all adjacent free cells to see which ones approach any of these in that number of steps.
        const player = this.board.get([...group][0]);
        const seen = new Set<string>([...group]);
        const todo = [...group];
        const nearestFriendlies: Set<string> = new Set();
        let stepCount = 0;
        while (todo.length > 0 && nearestFriendlies.size === 0) {
            stepCount++;
            const levelSize = todo.length;
            for (let i = 0; i < levelSize; i++) {
                const current = todo.shift()!;
                for (const neighbour of this.getNeighbours(current)) {
                    if (seen.has(neighbour)) { continue; }
                    seen.add(neighbour);
                    if (!this.board.has(neighbour)) {
                        todo.push(neighbour);
                    } else if (this.board.get(neighbour) === player) {
                        nearestFriendlies.add(neighbour);
                    }
                }
            }
        }
        const adjacentFreeCells: string[] = [];
        for (const cell of group) {
            for (const neighbour of this.getNeighbours(cell)) {
                if (!this.board.has(neighbour)) {
                    adjacentFreeCells.push(neighbour);
                }
            }
        }
        const movableToCells: string[] = [];
        // Now check all adjacent free cells to see which ones
        // approach any of these nearest friendly cells within `stepCount` steps.
        for (const cell of adjacentFreeCells) {
            const seen2 = new Set<string>();
            const todo2 = [cell];
            let stepCount2 = 1;
            while (todo2.length > 0 && stepCount2 < stepCount) {
                stepCount2++;
                const levelSize = todo2.length;
                for (let i = 0; i < levelSize; i++) {
                    const current = todo2.shift()!;
                    for (const neighbour of this.getNeighbours(current)) {
                        if (seen2.has(neighbour)) { continue; }
                        seen2.add(neighbour);
                        if (nearestFriendlies.has(neighbour)) {
                            movableToCells.push(cell);
                            break;
                        }
                        if (!this.board.has(neighbour)) {
                            todo2.push(neighbour);
                        }
                    }
                }
            }
        }
        return movableToCells;
    }

    private oneGroup(cells: Set<string>) {
        // Check if the cells are all in one group.
        const seen = new Set<string>();
        const todo = [cells.values().next().value as string];
        while (todo.length > 0) {
            const current = todo.pop()!;
            if (seen.has(current)) { continue; }
            seen.add(current);
            for (const neighbour of this.getNeighbours(current)) {
                if (cells.has(neighbour)) {
                    todo.push(neighbour);
                }
            }
        }
        return seen.size === cells.size;
    }

    // private allOneGroup(player: playerid): boolean {
    //     // Check if all the cells are in one group.
    //     return this.oneGroup(new Set([...this.board.entries()].filter(([, contents]) => contents === player).map(([cell]) => cell)));
    // }

    private getTos(from: string): string[] {
        // Get the cells that a piece at `from` can move to.
        // Remember that the piece cannot break the group upon movement.
        const group = this.getGroup(from);
        const movableToCells = this.getMovableToCells(group);
        // Check if the piece can move to the movable cells without breaking the group.
        const tos: string[] = [];
        for (const cell of movableToCells) {
            const newGroup = new Set([...group]);
            newGroup.delete(from);
            newGroup.add(cell);
            if (this.oneGroup(newGroup)) {
                tos.push(cell);
            }
        }
        return tos;
    }

    public move(m: string, {partial = false, trusted = false} = {}): AyuGame {
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
        this.dots = [];
        this.selected = undefined;
        if (m.length === 0) { return this; }
        const [from, to] = m.split("-");
        if (to === undefined || to === "") {
            this.dots = this.getTos(from);
            this.selected = from;
        } else {
            this.results = [{ type: "move", from, to }];
            this.board.delete(from);
            this.board.set(to, this.currplayer);
        }
        if (partial) { return this; }
        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): AyuGame {
        // const otherPlayer = this.currplayer % 2 + 1 as playerid;
        if (!this.hasMoves(this.currplayer)) {
            this.gameover = true;
            this.winner = [this.currplayer];
            this.results.push({ type: "eog" });
        // } else if (this.allOneGroup(otherPlayer)) {
        //     this.gameover = true;
        //     this.winner = [otherPlayer];
        //     this.results.push({ type: "eog" });
        }
        if (!this.gameover) {
            const count = this.stateCount(new Map<string, any>([["board", this.board], ["currplayer", this.currplayer]]));
            if (count >= 1) {
                this.gameover = true;
                this.winner = [this.currplayer];
                this.results.push({ type: "eog", reason: "repetition" });
            }
        }
        if (this.gameover) {
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public state(): IAyuState {
        return {
            game: AyuGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: AyuGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
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
                        if (this.selected === cell) {
                            pstr += "C";
                        } else {
                            pstr += "A";
                        }
                    } else {
                        if (this.selected === cell) {
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
        pstr = pstr.replace(new RegExp(`-{${this.boardSize}}`, "g"), "_");

        // Build rep
        const rep: APRenderRep =  {
            options: ["hide-star-points"],
            board: {
                style: "vertex",
                width: this.boardSize,
                height: this.boardSize,
            },
            legend: {
                A: [{ name: "piece", colour: 1 }],
                B: [{ name: "piece", colour: 2 }],
                // Selected pieces
                C: [{ name: "piece", colour: "#FFF" }, { name: "piece", colour: 1, opacity: 0.5 }],
                D: [{ name: "piece", colour: "#FFF" }, { name: "piece", colour: 2, opacity: 0.5 }],
            },
            pieces: pstr,
        };

        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                } else if (move.type === "move") {
                    const [fromX, fromY] = this.algebraic2coords(move.from);
                    const [toX, toY] = this.algebraic2coords(move.to);
                    rep.annotations.push({ type: "move", targets: [{ row: fromY, col: fromX }, { row: toY, col: toX }] });
                }
            }
        }
        if (this.dots.length > 0) {
            type RowCol = {row: number; col: number};
            const points: RowCol[] = [];
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

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "move":
                node.push(i18next.t("apresults:MOVE.nowhat", { player, from: r.from, to: r.to }));
                resolved = true;
                break;
            case "eog":
                if (r.reason === "repetition") {
                    node.push(i18next.t("apresults:EOG.repetition", { count: 1 }));
                } else {
                    node.push(i18next.t("apresults:EOG.default"));
                }
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): AyuGame {
        return new AyuGame(this.serialize());
    }
}
