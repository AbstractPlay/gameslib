import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult, IScores, type ChatLogCollectContext, type ChatLogLine } from "./_base.js";
import type { APGamesInformation } from "../schemas/gameinfo.js";
import { APRenderRep } from "@abstractplay/renderer/build/schemas/schema";
import type { APMoveResult } from "../schemas/moveresults.js";
import { DirectionCardinal, orthDirections, oppositeDirections, RectGrid, reviver, UserFacingError, cloneState } from "../common/index.js";
import i18next from "i18next";

const BOARD_SIZE = 8;

export type playerid = 1|2;
export type Size = 1|2;
export type CellContents = [playerid, Size];

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    crownsPending: string[];
    lastmove?: string;
};

export interface IDamaState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class DamaGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Dama",
        uid: "dama",
        playercounts: [2],
        version: "20260927",
        dateAdded: "2026-09-27",
        // i18next.t("apgames:descriptions.dama")
        description: "apgames:descriptions.dama",
        urls: [
            "https://en.wikipedia.org/wiki/Turkish_draughts",
            "https://boardgamegeek.com/boardgame/26920/turkish-checkers",
        ],
        bggid: "26920",
        people: [
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        variants: [],
        categories: ["goal>immobilize", "mechanic>capture", "mechanic>differentiate", "mechanic>move", "other>traditional", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["perspective", "automove"],
    };

    public static clone(obj: DamaGame): DamaGame {
        return Object.assign(new DamaGame(), cloneState(obj) as DamaGame);
    }

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, BOARD_SIZE);
    }

    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, BOARD_SIZE);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, CellContents>;
    public crownsPending: string[] = [];
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private _points: [number, number][] = [];

    public get boardsize(): number {
        return BOARD_SIZE;
    }

    private static startingBoard(): Map<string, CellContents> {
        const board = new Map<string, CellContents>();
        const placeRow = (algebraicRow: number, player: playerid) => {
            const y = BOARD_SIZE - algebraicRow;
            for (let col = 0; col < BOARD_SIZE; col++) {
                board.set(GameBase.coords2algebraic(col, y, BOARD_SIZE), [player, 1]);
            }
        };
        placeRow(1, 2);
        placeRow(2, 2);
        placeRow(5, 1);
        placeRow(6, 1);
        return board;
    }

    private static promotionRow(player: playerid): number {
        return player === 1 ? 0 : 7;
    }

    private static manDirections(player: playerid): DirectionCardinal[] {
        if (player === 1) {
            return ["N", "E", "W"];
        }
        return ["S", "E", "W"];
    }

    private isPromotionRank(player: playerid, y: number): boolean {
        return y === DamaGame.promotionRow(player);
    }

    /** Apply pending crowns on a board copy (move generation). Mutates `pending` in place. */
    private applyCrownsPendingOnBoard(board: Map<string, CellContents>, pending: string[], player: playerid): void {
        for (let i = pending.length - 1; i >= 0; i--) {
            const cell = pending[i]!;
            if (!board.has(cell)) {
                pending.splice(i, 1);
                continue;
            }
            const [owner, size] = board.get(cell)!;
            const [, y] = this.algebraic2coords(cell);
            if (owner === player && size === 1 && this.isPromotionRank(player, y)) {
                board.set(cell, [owner, 2]);
                pending.splice(i, 1);
            }
        }
    }

    /** Crown pending men for `player` (called when their turn begins). */
    private applyCrownsPendingForPlayer(player: playerid): void {
        for (let i = this.crownsPending.length - 1; i >= 0; i--) {
            const cell = this.crownsPending[i]!;
            if (!this.board.has(cell)) {
                this.crownsPending.splice(i, 1);
                continue;
            }
            const [owner, size] = this.board.get(cell)!;
            const [, y] = this.algebraic2coords(cell);
            if (owner === player && size === 1 && this.isPromotionRank(player, y)) {
                this.board.set(cell, [player, 2]);
                this.crownsPending.splice(i, 1);
                this.results.push({ type: "promote", where: cell, to: "king" });
            }
        }
    }

    private boardForMoves(player: playerid): { board: Map<string, CellContents>; pending: string[] } {
        const board = new Map(this.board);
        const pending = [...this.crownsPending];
        if (player === this.currplayer) {
            this.applyCrownsPendingOnBoard(board, pending, player);
        }
        return { board, pending };
    }

    constructor(state?: IDamaState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            this.variants = variants === undefined ? [] : [...variants];
            const fresh: IMoveState = {
                _version: DamaGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: DamaGame.startingBoard(),
                crownsPending: [],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IDamaState;
            }
            if (state.game !== DamaGame.gameinfo.uid) {
                throw new Error(`The Dama engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): DamaGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ((idx < 0) || (idx >= this.stack.length)) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.crownsPending = [...state.crownsPending];
        this.lastmove = state.lastmove;
        this._points = [];
        this.results = [];
        this.applyCrownsPendingForPlayer(this.currplayer);
        return this;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        player ??= this.currplayer;

        const { board } = this.boardForMoves(player);
        const moves: string[] = [];
        const men = [...board.entries()].filter(([, piece]) => piece[0] === player && piece[1] === 1).map(([cell]) => cell);
        const kings = [...board.entries()].filter(([, piece]) => piece[0] === player && piece[1] === 2).map(([cell]) => cell);

        const allcaps: string[][] = [];
        for (const man of men) {
            allcaps.push(...this.allManCaptures(board, man));
        }
        for (const king of kings) {
            allcaps.push(...this.allKingCaptures(board, king));
        }

        if (allcaps.length > 0) {
            const maxlen = Math.max(...allcaps.map(cap => cap.length));
            if (maxlen > 1) {
                moves.push(...allcaps.filter(cap => cap.length === maxlen).map(cap => cap.join("-")));
            }
        }

        if (moves.length === 0) {
            const grid = new RectGrid(BOARD_SIZE, BOARD_SIZE);
            for (const man of men) {
                const [fx, fy] = this.algebraic2coords(man);
                for (const dir of DamaGame.manDirections(player)) {
                    const ray = grid.ray(fx, fy, dir);
                    if (ray.length >= 1) {
                        const next = this.coords2algebraic(...ray[0]);
                        if (!board.has(next)) {
                            moves.push(`${man}-${next}`);
                        }
                    }
                }
            }
            for (const king of kings) {
                const [fx, fy] = this.algebraic2coords(king);
                for (const dir of orthDirections) {
                    const ray = grid.ray(fx, fy, dir).map(pt => this.coords2algebraic(...pt));
                    const idx = ray.findIndex(n => board.has(n));
                    const empty = idx === -1 ? ray : ray.slice(0, idx);
                    for (const next of empty) {
                        moves.push(`${king}-${next}`);
                    }
                }
            }
        }

        return moves.sort();
    }

    private allManCaptures(board: Map<string, CellContents>, start: string): string[][] {
        const [player, size] = board.get(start)!;
        if (size !== 1) {
            throw new Error("allManCaptures() is only for men.");
        }
        return this.moreManCaptures(board, player, start, start);
    }

    private moreManCaptures(
        board: Map<string, CellContents>,
        player: playerid,
        first: string,
        start: string,
    ): string[][] {
        const grid = new RectGrid(BOARD_SIZE, BOARD_SIZE);
        const [x, y] = this.algebraic2coords(start);
        const ret: string[][] = [];
        for (const dir of DamaGame.manDirections(player)) {
            const ray = grid.ray(x, y, dir).map(node => this.coords2algebraic(...node));
            if (ray.length < 2) {
                continue;
            }
            const adj = ray[0];
            const far = ray[1];
            if (!board.has(adj) || board.get(adj)![0] === player) {
                continue;
            }
            if (board.has(far) && far !== first) {
                continue;
            }
            const nextBoard = new Map(board);
            const piece = nextBoard.get(start)!;
            nextBoard.delete(start);
            nextBoard.delete(adj);
            nextBoard.set(far, piece);
            const more = this.moreManCaptures(nextBoard, player, first, far);
            ret.push(...more.map(m => [start, ...m]));
        }
        if (ret.length === 0) {
            ret.push([start]);
        }
        return ret;
    }

    private allKingCaptures(board: Map<string, CellContents>, start: string): string[][] {
        const [, size] = board.get(start)!;
        if (size !== 2) {
            throw new Error("allKingCaptures() is only for kings.");
        }
        const [player] = board.get(start)!;
        return this.moreKingCaptures(board, player, start, start);
    }

    private moreKingCaptures(
        board: Map<string, CellContents>,
        player: playerid,
        first: string,
        start: string,
        lastDir?: DirectionCardinal,
    ): string[][] {
        const grid = new RectGrid(BOARD_SIZE, BOARD_SIZE);
        const ret: string[][] = [];
        const [x, y] = this.algebraic2coords(start);
        for (const dir of orthDirections) {
            if (lastDir !== undefined && dir === oppositeDirections.get(lastDir)) {
                continue;
            }
            const ray = grid.ray(x, y, dir).map(node => this.coords2algebraic(...node));
            if (ray.length < 1) {
                continue;
            }
            const idx = ray.findIndex(n => board.has(n));
            if (idx === -1) {
                continue;
            }
            const adj = ray[idx];
            if (board.get(adj)![0] === player) {
                continue;
            }
            let rayAfter = ray.slice(idx + 1);
            const idxAfter = rayAfter.findIndex(n => board.has(n) && n !== first);
            if (idxAfter !== -1) {
                rayAfter = rayAfter.slice(0, idxAfter);
            }
            for (const far of rayAfter) {
                if (board.has(far) && far !== first) {
                    continue;
                }
                const nextBoard = new Map(board);
                const piece = nextBoard.get(start)!;
                nextBoard.delete(start);
                nextBoard.delete(adj);
                nextBoard.set(far, piece);
                const more = this.moreKingCaptures(nextBoard, player, first, far, dir);
                ret.push(...more.map(m => [start, ...m]));
            }
        }
        if (ret.length === 0) {
            ret.push([start]);
        }
        return ret;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            let newmove = "";
            if (move.length === 0) {
                newmove = cell;
            } else {
                const extended = `${move}-${cell}`;
                if (this.moves().some(mv => mv.startsWith(extended))) {
                    newmove = extended;
                } else if (this.board.has(cell)) {
                    newmove = cell;
                } else {
                    newmove = extended;
                }
            }

            const matches = this.moves().filter(mv => DamaGame.moveMatchesPrefix(mv, newmove));
            if (matches.length === 1) {
                newmove = matches[0];
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
                message: i18next.t("apgames:validation._general.GENERIC", { move, row, col, piece, emessage: (e as Error).message }),
            };
        }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = { valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER") };

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.dama.INITIAL_INSTRUCTIONS");
            return result;
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        const cells = m.split("-");

        for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            try {
                this.algebraic2coords(cell);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell });
                return result;
            }

            if (i === 0) {
                if (!this.board.has(cell)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.NONEXISTENT", { where: cell });
                    return result;
                }
                const [owner] = this.board.get(cell)!;
                if (owner !== this.currplayer) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                    return result;
                }
            } else if (this.board.has(cell) && cell !== cells[0]) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.MOVE4CAPTURE", { where: cell });
                return result;
            }
        }

        const allMoves = this.moves();
        if (!allMoves.includes(m)) {
            const extensions = allMoves.filter(mv => DamaGame.moveMatchesPrefix(mv, m) && mv !== m);
            if (extensions.length > 0) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.dama.VALID_PARTIAL");
                return result;
            }
            result.valid = false;
            result.message = i18next.t("apgames:validation.dama.INVALID_MOVE", { move: m });
            return result;
        }

        result.valid = true;
        result.complete = 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private static moveMatchesPrefix(mv: string, prefix: string): boolean {
        return mv === prefix || mv.startsWith(`${prefix}-`);
    }

    private findPoints(partial: string): string[] | undefined {
        const [start] = partial.split("-");
        if (!this.board.has(start)) {
            return undefined;
        }
        const moves = this.moves().filter(mv => DamaGame.moveMatchesPrefix(mv, partial) && mv !== partial);
        const points: string[] = [];
        for (const mv of moves) {
            const suffix = mv === partial ? "" : mv.substring(partial.length + 1);
            const nextCells = suffix.split("-");
            if (nextCells[0] !== "") {
                points.push(nextCells[0]);
            }
        }
        return [...new Set(points)];
    }

    private setPartialDots(partial: string): void {
        const pts = this.findPoints(partial);
        this._points = pts !== undefined ? pts.map(c => this.algebraic2coords(c)) : [];
    }

    public move(m: string, { trusted = false, partial = false } = {}): DamaGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
            if ((!partial) && (!this.moves().includes(m))) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", { move: m }));
            }
        }

        if (partial) {
            this.setPartialDots(m);
            return this;
        }
        this._points = [];

        this.results = [];
        const cells = m.split("-");
        for (let i = 1; i < cells.length; i++) {
            const from = cells[i - 1];
            const [fx, fy] = this.algebraic2coords(from);
            const to = cells[i];
            const [tx, ty] = this.algebraic2coords(to);
            const piece = this.board.get(from)!;
            this.board.set(to, [...piece]);
            this.board.delete(from);
            this.results.push({ type: "move", from, to });

            const between = RectGrid.between(fx, fy, tx, ty).map(pt => this.coords2algebraic(...pt));
            for (const cell of between) {
                if (this.board.has(cell) && this.board.get(cell)![0] !== this.currplayer) {
                    const [, capSize] = this.board.get(cell)!;
                    this.board.delete(cell);
                    this.results.push({ type: "capture", where: cell, what: capSize === 1 ? "soldier" : "king" });
                    break;
                }
            }
        }

        const last = cells[cells.length - 1];
        const [, ly] = this.algebraic2coords(last);
        const [owner, size] = this.board.get(last)!;
        if (size === 1 && this.isPromotionRank(owner, ly) && !this.crownsPending.includes(last)) {
            this.crownsPending.push(last);
        }

        this.lastmove = m;
        let newplayer = (this.currplayer as number) + 1;
        if (newplayer > this.numplayers) {
            newplayer = 1;
        }
        this.currplayer = newplayer as playerid;
        this.applyCrownsPendingForPlayer(this.currplayer);

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): DamaGame {
        const otherPlayer: playerid = this.currplayer === 1 ? 2 : 1;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const repetitions = this.stateCount(new Map<string, any>([
            ["board", this.board],
            ["currplayer", this.currplayer],
            ["crownsPending", [...this.crownsPending].sort()],
        ]));

        if (repetitions >= 2) {
            this.gameover = true;
            this.winner = [1, 2];
        } else if (this.isKingVsManDraw()) {
            this.gameover = true;
            this.winner = [1, 2];
        } else {
            const legal = this.moves();
            if (legal.length === 0) {
                this.gameover = true;
                this.winner = [otherPlayer];
            }
        }

        if (this.gameover) {
            if (repetitions >= 2) {
                this.results.push({ type: "eog", reason: "repetition" });
            } else {
                this.results.push({ type: "eog" });
            }
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    private isKingVsManDraw(): boolean {
        const entries = [...this.board.entries()];
        if (entries.length !== 2) {
            return false;
        }
        const [[, a], [, b]] = entries;
        if (a[0] === b[0]) {
            return false;
        }
        const sizes = new Set([a[1], b[1]]);
        return sizes.has(1) && sizes.has(2);
    }

    public state(): IDamaState {
        return {
            game: DamaGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    public moveState(): IMoveState {
        return {
            _version: DamaGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            crownsPending: [...this.crownsPending],
        };
    }

    public render(): APRenderRep {
        const labels = [["A", "B"], ["X", "Y"]];
        let pstr = "";
        for (let row = 0; row < BOARD_SIZE; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < BOARD_SIZE; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const [player, size] = this.board.get(cell)!;
                    pieces.push(labels[player - 1][size - 1]);
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join("");
        }
        pstr = pstr.replace(/-{8}/g, "_");

        const rep: APRenderRep = {
            board: {
                style: "squares",
                width: BOARD_SIZE,
                height: BOARD_SIZE,
            },
            legend: {
                A: { name: "piece", colour: 1 },
                B: { name: "piece-chariot", colour: 1 },
                X: { name: "piece", colour: 2 },
                Y: { name: "piece-chariot", colour: 2 },
            },
            pieces: pstr,
        };

        if ((this.stack[this.stack.length - 1]._results.length > 0) || (this._points.length > 0)) {
            rep.annotations = [];

            if (this._points.length > 0) {
                const points = this._points.map(cell => ({ row: cell[1], col: cell[0] }));
                rep.annotations.push({ type: "dots", targets: points as [{ row: number; col: number }, ...{ row: number; col: number }[]] });
            }

            for (const r of this.stack[this.stack.length - 1]._results) {
                if (r.type === "move") {
                    const [fromX, fromY] = this.algebraic2coords(r.from);
                    const [toX, toY] = this.algebraic2coords(r.to);
                    rep.annotations.push({ type: "move", targets: [{ row: fromY, col: fromX }, { row: toY, col: toX }] });
                } else if (r.type === "capture") {
                    const [x, y] = this.algebraic2coords(r.where!);
                    rep.annotations.push({ type: "exit", targets: [{ row: y, col: x }] });
                }
            }
        }

        return rep;
    }

    public collectChatLogLine(lines: ChatLogLine[], r: APMoveResult, ctx: ChatLogCollectContext): boolean {
        switch (r.type) {
            case "capture":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:CAPTURE.dameo", {
                    where: r.where!, context: r.what!,
                });
                return true;
            case "promote":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:PROMOTE.basicWhere", {
                    where: r.where!,
                });
                return true;
            case "eog":
                if (r.reason === "repetition") {
                    this.pushNeutralChatLine(lines, "apresults:EOG.repetition", { count: 3 });
                } else {
                    this.pushNeutralChatLine(lines, "apresults:EOG.default");
                }
                return true;
            default:
                return super.collectChatLogLine(lines, r, ctx);
        }
    }

    public getPlayerPieces(player: number): number {
        return [...this.board.values()].filter(p => p[0] === player).length;
    }

    public sidebarScores(): IScores[] {
        return [
            { name: this.neutralAreaLabel("apgames:status.PIECESREMAINING"), scores: [this.getPlayerPieces(1), this.getPlayerPieces(2)] },
        ];
    }

    public clone(): DamaGame {
        return new DamaGame(this.serialize());
    }
}
