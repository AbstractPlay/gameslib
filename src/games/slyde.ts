import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";

const changeSymbol = "*";
type playerid = 1 | 2;

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    // Maps to [player, fixed]
    board: Map<string, [playerid, boolean]>;
    lastmove?: string;
    sizes: [number[], number[]];
}

export interface ISlydeState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class SlydeGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Slyde",
        uid: "slyde",
        playercounts: [2],
        version: "20240617",
        dateAdded: "2024-07-14",
        // i18next.t("apgames:descriptions.slyde")
        description: "apgames:descriptions.slyde",
        urls: ["https://boardgamegeek.com/boardgame/308111/slyde"],
        people: [
            {
                type: "designer",
                name: "Mike Zapawa",
                urls: ["https://boardgamegeek.com/boardgamedesigner/126470/mike-zapawa"],
            }
        ],
        variants: [
            { uid: "size-8", group: "board" },
            { uid: "size-10", group: "board" },
            // { uid: "size-16", group: "board" },
        ],
        categories: ["goal>score>eog", "mechanic>move", "board>shape>rect", "board>connect>rect", "components>simple>3c"],
        flags: ["scores"],
    };

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardSize);
    }

    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardSize);
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, [playerid, boolean]>;
    public sizes: [number[], number[]] = [[], []];
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private boardSize = 0;
    private dots: string[] = [];

    constructor(state?: ISlydeState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            this.boardSize = this.getBoardSize();
            const board = this.initBoard();
            const fresh: IMoveState = {
                _version: SlydeGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                sizes: this.newSizes(board),
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ISlydeState;
            }
            if (state.game !== SlydeGame.gameinfo.uid) {
                throw new Error(`The Slyde game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
            this.boardSize = this.getBoardSize();
        }
        this.load();
    }

    public load(idx = -1): SlydeGame {
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
        this.board = new Map(Array.from(state.board, ([key, value]) => [key, [...value]]));
        this.sizes = [[...state.sizes[0]], [...state.sizes[1]]];
        this.lastmove = state.lastmove;
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
        return 12;
    }

    private initBoard(): Map<string, [playerid, boolean]> {
        // Get the initial board.
        const board = new Map<string, [playerid, boolean]>();
        // Set up board in a checkerboard pattern.
        for (let row = 0; row < this.boardSize; row++) {
            for (let col = 0; col < this.boardSize; col++) {
                if ((row + col) % 2 === 0) {
                    board.set(this.coords2algebraic(col, row), [1, false]);
                } else {
                    board.set(this.coords2algebraic(col, row), [2, false]);
                }
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
        for (const [cell, [p, f]] of this.board) {
            if (p === player && !f) {
                for (const to of this.getTos(cell, player)) {
                    moves.push(`${cell}-${to}`);
                }
            }
        }
        if (this.stack.length > 1 && this.isSymmetric()) {
            for (const cell of this.board.keys()) {
                moves.push(`${changeSymbol}${cell}`);
            }
        }
        return moves;
    }

    private hasMoves(player?: playerid): boolean {
        if (player === undefined) {
            player = this.currplayer;
        }
        for (const [cell, [p, f]] of this.board) {
            if (p === player && !f && this.getTos(cell, player).length > 0) {
                return true;
            }
        }
        if (this.stack.length > 1 && this.isSymmetric()) { return true; }
        return false;
    }

    private horizontalSymmetry(): boolean {
        // Check for horizontal symmetry.
        for (let i = 0; i < Math.ceil(this.boardSize / 2); i++) {
            for (let j = 0; j < this.boardSize; j++) {
                const cell = this.coords2algebraic(i, j);
                const cellOpp = this.coords2algebraic(this.boardSize - i - 1, j);
                const [p, f] = this.board.get(cell)!;
                const [pOpp, fOpp] = this.board.get(cellOpp)!;
                if (p === pOpp || f !== fOpp) { return false; }
            }
        }
        return true;
    }

    private verticalSymmetry(): boolean {
        // Check for vertical symmetry.
        for (let i = 0; i < Math.ceil(this.boardSize / 2); i++) {
            for (let j = 0; j < this.boardSize; j++) {
                const cell = this.coords2algebraic(j, i);
                const cellOpp = this.coords2algebraic(j, this.boardSize - i - 1);
                const [p, f] = this.board.get(cell)!;
                const [pOpp, fOpp] = this.board.get(cellOpp)!;
                if (p === pOpp || f !== fOpp) { return false; }
            }
        }
        return true;
    }

    private isSymmetric(): boolean {
        // Check for symmetry.
        return this.horizontalSymmetry() || this.verticalSymmetry();
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            let newmove = "";
            if (move.length === 0) {
                newmove = cell;
            } else if (move === cell) {
                if (this.stack.length > 1 && this.isSymmetric()) {
                    newmove = `${changeSymbol}${move}`;
                } else {
                    newmove = "";
                }
            } else if (this.board.has(cell) && this.board.get(cell)![0] === this.currplayer && !this.board.get(cell)![1]) {
                newmove = cell;
            } else {
                newmove = `${move}-${cell}`;
            }
            const result = this.validateMove(newmove) as IClickResult;
            if (!result.valid) {
                result.move = "";
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
            if (this.isSymmetric()) {
                result.message = i18next.t("apgames:validation.slyde.INITIAL_INSTRUCTIONS_SYMMETRIC");
            } else {
                result.message = i18next.t("apgames:validation.slyde.INITIAL_INSTRUCTIONS");
            }
            return result;
        }
        if (m.startsWith(changeSymbol)) {
            if (this.stack.length === 1) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.slyde.NO_CHANGE_FIRST_MOVE");
                return result;
            }
            if (!this.isSymmetric()) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.slyde.NON_SYMMETRIC");
                return result;
            }
        } else {
            const [from, to] = m.split("-");
            const isSymmetric = this.isSymmetric();
            if (!this.board.has(from)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: from });
                return result;
            }
            const [pF, fF] = this.board.get(from)!;
            let canSwap = true;
            if (pF !== this.currplayer) {
                if (isSymmetric) {
                    canSwap = false;
                } else {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.UNCONTROLLED", { where: from });
                    return result;
                }
            }
            if (fF) {
                if (isSymmetric) {
                    canSwap = false;
                } else {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.slyde.FIXED_PIECE_FROM", { from });
                    return result;
                }
            }
            const tos = canSwap ? this.getTos(from, this.currplayer) : [];
            if (tos.length === 0) {
                if (isSymmetric) {
                    canSwap = false;
                } else {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.slyde.NO_MOVES_FROM", { from });
                    return result;
                }
            }
            if (to === undefined || to === "") {
                if (this.stack.length > 1 && isSymmetric) {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    if (canSwap) {
                        result.message = i18next.t("apgames:validation.slyde.SELECT_DESTINATION_OR_CHANGE");
                    } else {
                        result.message = i18next.t("apgames:validation.slyde.SELECT_CHANGE");
                    }
                    return result;
                } else {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.slyde.SELECT_DESTINATION");
                    return result;
                }
            }
            if (!canSwap) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.slyde.ONLY_CHANGE", { from });
                return result;
            }
            if (!this.board.has(to)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: to });
                return result;
            }
            const [pT, fT] = this.board.get(to)!;
            if (pT === this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.slyde.SAME_PLAYER", { from, to });
                return result;
            }
            if (fT) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.slyde.FIXED_PIECE_TO", { to });
                return result;
            }
            if (!tos.includes(to)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.slyde.NOT_ADJACENT", { from, to });
                return result;
            }
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private getTos(cell: string, player: playerid): string[] {
        // Get the neighbours of a cell that a piece can be moved to.
        const [x, y] = this.algebraic2coords(cell);
        const neighbours: string[] = [];
        if (x > 0) {
            const left = this.coords2algebraic(x - 1, y);
            const [p, f] = this.board.get(left)!;
            if (p !== player && !f) {
                neighbours.push(this.coords2algebraic(x - 1, y));
            }
        }
        if (x < this.boardSize - 1) {
            const right = this.coords2algebraic(x + 1, y);
            const [p, f] = this.board.get(right)!;
            if (p !== player && !f) {
                neighbours.push(this.coords2algebraic(x + 1, y));
            }
        }
        if (y > 0) {
            const up = this.coords2algebraic(x, y - 1);
            const [p, f] = this.board.get(up)!;
            if (p !== player && !f) {
                neighbours.push(this.coords2algebraic(x, y - 1));
            }
        }
        if (y < this.boardSize - 1) {
            const down = this.coords2algebraic(x, y + 1);
            const [p, f] = this.board.get(down)!;
            if (p !== player && !f) {
                neighbours.push(this.coords2algebraic(x, y + 1));
            }
        }
        return neighbours;
    }

    private getNeighbours(cell: string): string[] {
        // Get the neighbours of a cell.
        const [x, y] = this.algebraic2coords(cell);
        const neighbours: string[] = [];
        if (x > 0) {
            neighbours.push(this.coords2algebraic(x - 1, y));
        }
        if (x < this.boardSize - 1) {
            neighbours.push(this.coords2algebraic(x + 1, y));
        }
        if (y > 0) {
            neighbours.push(this.coords2algebraic(x, y - 1));
        }
        if (y < this.boardSize - 1) {
            neighbours.push(this.coords2algebraic(x, y + 1));
        }
        return neighbours;
    }

    private getGroupSizes(player: playerid, board?: Map<string, [playerid, boolean]>): number[] {
        // Get the sizes of all groups of pieces for `player`.
        // Singleton groups are aggregated and appended to the end of the sorted list.
        board ??= this.board;
        const groups: Set<string>[] = [];
        const pieces = [...board.entries()].filter(e => e[1][0] === player).map(e => e[0]);
        const seen: Set<string> = new Set();
        let singleCount = 0;
        for (const piece of pieces) {
            if (seen.has(piece)) {
                continue;
            }
            const group: Set<string> = new Set();
            const todo: string[] = [piece];
            while (todo.length > 0) {
                const cell = todo.pop()!;
                if (seen.has(cell)) {
                    continue;
                }
                group.add(cell);
                seen.add(cell);
                for (const n of this.getNeighbours(cell)) {
                    if (pieces.includes(n)) {
                        todo.push(n);
                    }
                }
            }
            if (group.size === 1) {
                singleCount++;
            } else {
                groups.push(group);
            }
        }
        return [...groups.map(g => g.size).sort((a, b) => b - a), singleCount];
    }

    private newSizes(board?: Map<string, [playerid, boolean]>): [number[], number[]] {
        // Get the sizes of all groups of pieces for both players.
        board ??= this.board;
        const sizes: [number[], number[]] = [[], []];
        for (let i = 1; i <= this.numplayers; i++) {
            sizes[i - 1] = this.getGroupSizes(i as playerid, board);
        }
        return sizes;
    }

    public move(m: string, {partial = false, trusted = false} = {}): SlydeGame {
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
        this.dots = [];
        if (m.startsWith(changeSymbol)) {
            // Swap the state
            const [where] = m.slice(1).split("-");
            const [player, fixed] = this.board.get(where)!;
            this.board.set(where, [player, !fixed]);
            this.results.push({ type: "select", where, who: player, what: !fixed ? "fixed": "mobile", how: player === this.currplayer ? "self" : "opponent" });
        } else {
            const [from, to] = m.split("-");
            if (to === undefined || to === "") {
                const [player, fixed] = this.board.get(from)!;
                if (player === this.currplayer && !fixed) {
                    this.dots = this.getTos(from, this.currplayer);
                }
            } else {
                this.board.set(to, [this.currplayer, true]);
                this.board.set(from, [this.currplayer % 2 + 1 as playerid, false]);
                this.results.push({ type: "move", from, to });
            }
            this.sizes = this.newSizes();
        }

        if (partial) { return this; }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    private getWinner(): playerid | undefined {
        // Get the winning player.
        const player1 = this.sizes[0];
        const player2 = this.sizes[1];
        // Loop through the shorter array
        const minLen = Math.min(player1.length, player2.length);
        for (let i = 0; i < minLen; i++) {
            if (player1[i] > player2[i]) {
                return 1;
            } else if (player1[i] < player2[i]) {
                return 2;
            }
        }
        // If the loop ends, compare the lengths of the arrays
        if (player1.length > player2.length) {
            return 1;
        } else if (player1.length < player2.length) {
            return 2;
        } else {
            return undefined;
        }
    }

    protected checkEOG(): SlydeGame {
        if (!this.hasMoves(this.currplayer)) {
            this.gameover = true;
            const winner = this.getWinner();
            this.winner = winner === undefined ? [1, 2] : [winner];
        }
        if (this.gameover) {
            this.results.push({ type: "eog" });
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public state(): ISlydeState {
        return {
            game: SlydeGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: SlydeGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(Array.from(this.board, ([key, value]) => [key, [...value]])),
            sizes: [[...this.sizes[0]], [...this.sizes[1]]],
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
                    const [player, fixed] = this.board.get(cell)!;
                    if (player === 1) {
                        if (fixed) {
                            pstr += "C";
                        } else {
                            pstr += "A";
                        }
                    } else if (player === 2) {
                        if (fixed) {
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
            board: {
                style: "squares",
                width: this.boardSize,
                height: this.boardSize,
            },
            legend: {
                A: [{ name: "piece-square", colour: 1, scale: 1.1, opacity: 0.95 }],
                B: [{ name: "piece-square", colour: 2, scale: 1.1, opacity: 0.95 }],
                C: [
                    { name: "piece-square", colour: 1, scale: 1.1, opacity: 0.95 },
                    { name: "piece", colour: 3, scale: 0.3 },
                ],
                D: [
                    { name: "piece-square", colour: 2, scale: 1.1, opacity: 0.95 },
                    { name: "piece", colour: 3, scale: 0.3 },
                ],
            },
            pieces: pstr,
        };

        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "select") {
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
            const points = [];
            for (const cell of this.dots) {
                const [x, y] = this.algebraic2coords(cell);
                points.push({ row: y, col: x });
            }
            rep.annotations.push({ type: "dots", targets: points as [{row: number; col: number}, ...{row: number; col: number}[]] });
        }
        return rep;
    }

    public getPlayerScore(player: playerid): number {
        // Ideally it should return the entire group size string.
        // return scores.join("-");
        // But because this method has to return a number, we just take the
        // effective group as score, which may be harder to interpret.
        const scores = this.sizes[player - 1];
        if (scores.length === 0) { return 0; }
        const scoresOther = this.sizes[player % 2];
        if (scoresOther.length > scores.length) {
            return 0;
        }
        if (scoresOther.length < scores.length) {
            return scores[scoresOther.length];
        }
        for (let i = 0; i < scores.length; i++) {
            if (scores[i] !== scoresOther[i]) {
                return scores[i];
            }
        }
        return 0;
    }

    public getPlayersScores(): IScores[] {
        return [{
            name: i18next.t("apgames:status.GROUPSIZES"),
            scores: [
                `${this.sizes[0].join(",")}${this.sizes[0][this.sizes[0].length - 1] === 0 ? "" : "×1"}`,
                `${this.sizes[1].join(",")}${this.sizes[1][this.sizes[1].length - 1] === 0 ? "" : "×1"}`,
            ]
        }];
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Sizes**\n\n";
        const scores = this.getPlayersScores()[0];
        for (let n = 1; n <= this.numplayers; n++) {
            status += `Player ${n}: ${scores.scores[n - 1]}\n\n`;
        }

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "move":
                node.push(i18next.t("apresults:MOVE.slyde", { player, from: r.from, to: r.to }));
                resolved = true;
                break;
            case "select":
                if (r.what === "fixed") {
                    if (r.how === "self") {
                        node.push(i18next.t("apresults:SELECT.slyde_fixed_self", { player, where: r.where }));
                    } else {
                        node.push(i18next.t("apresults:SELECT.slyde_fixed_opponent", { player, where: r.where }));
                    }
                } else {
                    if (r.how === "self") {
                        node.push(i18next.t("apresults:SELECT.slyde_mobile_self", { player, where: r.where }));
                    } else {
                        node.push(i18next.t("apresults:SELECT.slyde_mobile_opponent", { player, where: r.where }));
                    }
                }
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): SlydeGame {
        return new SlydeGame(this.serialize());
    }
}
