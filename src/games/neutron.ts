import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base.js";
import type { APGamesInformation } from "../schemas/gameinfo.js";
import { APRenderRep, Colourfuncs, MarkerShading } from "@abstractplay/renderer/build/schemas/schema";
import type { APMoveResult } from "../schemas/moveresults.js";
import { allDirections, RectGrid, reviver, UserFacingError, cloneState } from "../common/index.js";
import i18next from "i18next";

export type playerid = 1 | 2;
export type PieceId = 1 | 2 | 3; // 3 = neutron

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, PieceId>;
    lastmove?: string;
}

export interface INeutronState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
}

export class NeutronGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Neutron",
        uid: "neutron",
        playercounts: [2],
        version: "20260925",
        dateAdded: "2026-09-25",
        // i18next.t("apgames:descriptions.neutron")
        description: "apgames:descriptions.neutron",
        // i18next.t("apgames:notes.neutron")
        notes: "apgames:notes.neutron",
        urls: [
            "http://www.gamerz.net/pbmserv/neutron.html",
            "http://www.gamerz.net/pbmserv/coneutron.html",
            "https://boardgamegeek.com/boardgame/6978/neutron",
        ],
        bggid: "6978",
        people: [
            {
                type: "designer",
                name: "Robert A. Kraus",
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        variants: [
            { uid: "coneutron" },
            { uid: "restricted", group: "mobility" },
            { uid: "doubleRestricted", group: "mobility" },
            { uid: "7x7", group: "board" },
            { uid: "5x7", group: "board" },
            { uid: "7x5", group: "board" },
        ],
        categories: [
            "goal>breakthrough",
            "goal>immobilize",
            "mechanic>move",
            "board>shape>rect",
            "board>connect>rect",
            "components>simple>1per",
        ],
        flags: ["experimental", "perspective"],
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, PieceId>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private _points: [number, number][] = [];

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardHeight);
    }
    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardHeight);
    }

    public get boardWidth(): number {
        if (this.variants.includes("7x5")) {
            return 7;
        }
        if (this.variants.includes("5x7")) {
            return 5;
        }
        if (this.variants.includes("7x7")) {
            return 7;
        }
        return 5;
    }

    public get boardHeight(): number {
        if (this.variants.includes("5x7")) {
            return 7;
        }
        if (this.variants.includes("7x5")) {
            return 5;
        }
        if (this.variants.includes("7x7")) {
            return 7;
        }
        return 5;
    }

    public homeRow(p: playerid): number {
        return p === 1 ? this.boardHeight - 1 : 0;
    }

    public isCoNeutron(): boolean {
        return this.variants.includes("coneutron");
    }

    /** Neutron rules: White's first turn is pawn-only (stack still at opening position). */
    public isOpeningPawnOnly(): boolean {
        return !this.isCoNeutron() && this.stack.length === 1 && this.currplayer === 1;
    }

    public getNeutronCell(board: Map<string, PieceId> = this.board): string {
        const found = [...board.entries()].find(([, pc]) => pc === 3);
        if (found === undefined) {
            throw new Error("Neutron not found on board.");
        }
        return found[0];
    }

    private grid(): RectGrid {
        return new RectGrid(this.boardWidth, this.boardHeight);
    }

    /** Furthest empty cell in each direction (slide-until-blocked movement). */
    public slideDestinations(from: string, board: Map<string, PieceId>): string[] {
        const grid = this.grid();
        const [fx, fy] = this.algebraic2coords(from);
        const dests: string[] = [];
        for (const dir of allDirections) {
            let ray = grid.ray(fx, fy, dir).map((pt) => this.coords2algebraic(...pt));
            const idx = ray.findIndex((cell) => board.has(cell));
            if (idx !== -1) {
                ray = ray.slice(0, idx);
            }
            if (ray.length > 0) {
                dests.push(ray[ray.length - 1]);
            }
        }
        return dests;
    }

    /**
     * Mobility variants apply to pawn landings only.
     * doubleRestricted: may not land on own home row unless the pawn starts on that row
     * (back-rank slides along the home row remain legal).
     */
    public isPawnLandingLegal(player: playerid, from: string, to: string): boolean {
        const [, ty] = this.algebraic2coords(to);
        const [, fy] = this.algebraic2coords(from);
        const opp = player === 1 ? 2 : 1;
        if (this.variants.includes("restricted") || this.variants.includes("doubleRestricted")) {
            if (ty === this.homeRow(opp)) {
                return false;
            }
        }
        if (this.variants.includes("doubleRestricted")) {
            if (ty === this.homeRow(player) && fy !== this.homeRow(player)) {
                return false;
            }
        }
        return true;
    }

    public neutronWinRowFor(player: playerid): number {
        if (this.isCoNeutron()) {
            const opp = player === 1 ? 2 : 1;
            return this.homeRow(opp);
        }
        return this.homeRow(player);
    }

    public neutronOnWinningRow(cell: string, player: playerid): boolean {
        const [, y] = this.algebraic2coords(cell);
        return y === this.neutronWinRowFor(player);
    }

    public pawnSlideMoves(player: playerid, board: Map<string, PieceId>): string[] {
        const moves: string[] = [];
        for (const [from, pc] of board.entries()) {
            if (pc !== player) {
                continue;
            }
            for (const to of this.slideDestinations(from, board)) {
                if (this.isPawnLandingLegal(player, from, to)) {
                    moves.push(`${from}-${to}`);
                }
            }
        }
        return moves;
    }

    private applySlide(board: Map<string, PieceId>, from: string, to: string): void {
        const pc = board.get(from)!;
        board.delete(from);
        board.set(to, pc);
    }

    private boardAfterNeutron(neutronTo: string): Map<string, PieceId> {
        const board = cloneState(this.board) as Map<string, PieceId>;
        const from = this.getNeutronCell(board);
        this.applySlide(board, from, neutronTo);
        return board;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) {
            return [];
        }
        if (player === undefined) {
            player = this.currplayer;
        }
        if (player !== this.currplayer) {
            return [];
        }

        const moves: string[] = [];

        if (this.isOpeningPawnOnly()) {
            return this.pawnSlideMoves(player, this.board).sort((a, b) => a.localeCompare(b));
        }

        const neutronFrom = this.getNeutronCell();
        for (const nTo of this.slideDestinations(neutronFrom, this.board)) {
            if (this.neutronOnWinningRow(nTo, player)) {
                moves.push(nTo);
                continue;
            }
            const afterN = this.boardAfterNeutron(nTo);
            for (const pawn of this.pawnSlideMoves(player, afterN)) {
                moves.push(`${nTo},${pawn}`);
            }
        }

        return moves.sort((a, b) => a.localeCompare(b));
    }

    public static initialBoard(width: number, height: number, coords: (x: number, y: number) => string): Map<string, PieceId> {
        const board = new Map<string, PieceId>();
        for (let col = 0; col < width; col++) {
            board.set(coords(col, 0), 2);
            board.set(coords(col, height - 1), 1);
        }
        const nx = Math.floor((width - 1) / 2);
        const ny = Math.floor((height - 1) / 2);
        board.set(coords(nx, ny), 3);
        return board;
    }

    constructor(state?: INeutronState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            this.variants = variants === undefined ? [] : this.applyVariantConstraints(variants);
            const board = NeutronGame.initialBoard(
                this.boardWidth,
                this.boardHeight,
                (x, y) => GameBase.coords2algebraic(x, y, this.boardHeight),
            );
            const fresh: IMoveState = {
                _version: NeutronGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as INeutronState;
            }
            if (state.game !== NeutronGame.gameinfo.uid) {
                throw new Error(`The Neutron engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): NeutronGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if (idx < 0 || idx >= this.stack.length) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = cloneState(state.board) as Map<string, PieceId>;
        this.lastmove = state.lastmove;
        this.results = [...state._results];
        this._points = [];
        return this;
    }

    public handleClick(move: string, row: number, col: number): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            let newmove = "";

            if (move === cell) {
                newmove = "";
            } else if (this.isOpeningPawnOnly()) {
                if (move.length === 0 && this.board.get(cell) === this.currplayer) {
                    newmove = cell;
                } else if (!move.includes("-") && this.board.get(move) === this.currplayer && !this.board.has(cell)) {
                    if (this.slideDestinations(move, this.board).includes(cell) && this.isPawnLandingLegal(this.currplayer, move, cell)) {
                        newmove = `${move}-${cell}`;
                    }
                }
            } else if (move.length === 0) {
                if (!this.board.has(cell) && this.slideDestinations(this.getNeutronCell(), this.board).includes(cell)) {
                    newmove = cell;
                } else if (this.board.get(cell) === this.currplayer) {
                    return {
                        move: "",
                        valid: false,
                        message: i18next.t("apgames:validation.neutron.NEUTRON_FIRST"),
                    };
                }
            } else if (move.length > 0 && !move.includes(",") && !move.includes("-")) {
                if (this.neutronOnWinningRow(move, this.currplayer)) {
                    if (cell === move) {
                        newmove = move;
                    }
                } else if (this.board.get(cell) === this.currplayer) {
                    newmove = `${move},${cell}`;
                }
            } else if (move.includes(",") && !move.includes("-")) {
                const [nTo, pawnFrom] = move.split(",", 2);
                if (!this.board.has(cell) && this.slideDestinations(pawnFrom, this.boardAfterNeutron(nTo)).includes(cell)) {
                    if (this.isPawnLandingLegal(this.currplayer, pawnFrom, cell)) {
                        newmove = `${nTo},${pawnFrom}-${cell}`;
                    }
                }
            }

            const result = this.validateMove(newmove) as IClickResult;
            result.move = result.valid ? newmove : move;
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", {
                    move,
                    row,
                    col,
                    piece: undefined,
                    emessage: (e as Error).message,
                }),
            };
        }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = { valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER") };

        m = m.toLowerCase().replace(/\s+/g, "");
        if (m.startsWith(",")) {
            result.message = i18next.t("apgames:validation.neutron.NEUTRON_FIRST");
            return result;
        }
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.neutron.INITIAL_INSTRUCTIONS");
            return result;
        }

        const allMoves = this.moves();

        if (this.isOpeningPawnOnly()) {
            if (!m.includes("-")) {
                if (this.board.has(m) && this.board.get(m) === this.currplayer) {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.neutron.PAWN_DEST");
                    return result;
                }
                result.message = i18next.t("apgames:validation.neutron.SELECT_OWN_PAWN");
                return result;
            }
            if (!allMoves.includes(m)) {
                result.message = i18next.t("apgames:validation._general.INVALID_MOVE", { move: m });
                return result;
            }
            result.valid = true;
            result.complete = 1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        if (!m.includes(",") && !m.includes("-")) {
            if (!this.slideDestinations(this.getNeutronCell(), this.board).includes(m)) {
                result.message = i18next.t("apgames:validation.neutron.INVALID_NEUTRON");
                return result;
            }
            if (this.neutronOnWinningRow(m, this.currplayer)) {
                if (!allMoves.includes(m)) {
                    result.message = i18next.t("apgames:validation._general.INVALID_MOVE", { move: m });
                    return result;
                }
                result.valid = true;
                result.complete = 1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.neutron.PAWN_SELECT");
            return result;
        }

        if (m.includes(",") && !m.includes("-")) {
            const [nTo, pawnFrom] = m.split(",", 2);
            if (!this.slideDestinations(this.getNeutronCell(), this.board).includes(nTo)) {
                result.message = i18next.t("apgames:validation.neutron.INVALID_NEUTRON");
                return result;
            }
            if (!this.board.has(pawnFrom) || this.board.get(pawnFrom) !== this.currplayer) {
                result.message = i18next.t("apgames:validation.neutron.SELECT_OWN_PAWN");
                return result;
            }
            const board = this.boardAfterNeutron(nTo);
            if (board.get(pawnFrom) !== this.currplayer) {
                result.message = i18next.t("apgames:validation.neutron.SELECT_OWN_PAWN");
                return result;
            }
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.neutron.PAWN_DEST");
            return result;
        }

        if (!allMoves.includes(m)) {
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", { move: m });
            return result;
        }
        result.valid = true;
        result.complete = 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, { partial = false, trusted = false } = {}): NeutronGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase().replace(/\s+/g, "");
        if (!trusted) {
            const v = this.validateMove(m);
            if (!v.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", v.message);
            }
            if (v.complete !== 1 && !partial) {
                throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation.neutron.INCOMPLETE"));
            }
            if (!partial && !this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", { move: m }));
            }
        }

        if (partial) {
            this.results = [];
            if (m.length > 0) {
                this.applyPartialPreview(m);
            }
            this._points = this.findPoints(m);
            return this;
        }
        this._points = [];

        this.applyPartialPreview(m);
        const player = this.currplayer;

        this.lastmove = m;

        const wonOnNeutron = !this.isOpeningPawnOnly() && this.neutronOnWinningRow(this.getNeutronCell(), player);

        if (wonOnNeutron) {
            this.gameover = true;
            this.winner = [player];
            this.results.push({ type: "eog" }, { type: "winners", players: [...this.winner] });
            this.saveState();
            return this;
        }

        this.currplayer = (player % 2 + 1) as playerid;
        this.checkStalemate();
        if (this.gameover) {
            this.saveState();
            return this;
        }

        this.saveState();
        return this;
    }

    /** Apply in-progress turn pieces to the board for partial render (does not save or flip player). */
    private applyPartialPreview(m: string): void {
        if (m.length === 0) {
            return;
        }
        this.results = [];
        if (this.isOpeningPawnOnly()) {
            if (m.includes("-")) {
                const [from, to] = m.split("-");
                this.applySlide(this.board, from, to);
                this.results.push({ type: "move", from, to });
            }
            return;
        }
        if (!m.includes(",")) {
            if (!m.includes("-") && m.length > 0) {
                const from = this.getNeutronCell();
                this.applySlide(this.board, from, m);
                this.results.push({ type: "move", from, to: m, what: "neutron" });
            }
            return;
        }
        const comma = m.indexOf(",");
        const nTo = m.slice(0, comma);
        const pawnPart = m.slice(comma + 1);
        const nFrom = this.getNeutronCell();
        this.applySlide(this.board, nFrom, nTo);
        this.results.push({ type: "move", from: nFrom, to: nTo, what: "neutron" });
        if (pawnPart.includes("-")) {
            const [pFrom, pTo] = pawnPart.split("-");
            this.applySlide(this.board, pFrom, pTo);
            this.results.push({ type: "move", from: pFrom, to: pTo });
        }
    }

    private findPoints(partial: string): [number, number][] {
        if (this.isOpeningPawnOnly() && partial.length > 0 && !partial.includes("-")) {
            return this.slideDestinations(partial, this.board)
                .filter((to) => this.isPawnLandingLegal(this.currplayer, partial, to))
                .map((c) => this.algebraic2coords(c));
        }
        if (!this.isOpeningPawnOnly() && partial.length === 0) {
            return this.slideDestinations(this.getNeutronCell(), this.board).map((c) => this.algebraic2coords(c));
        }
        if (partial.includes(",") && !partial.includes("-")) {
            const [, pawnFrom] = partial.split(",", 2);
            if (pawnFrom.length === 0) {
                return [];
            }
            return this.slideDestinations(pawnFrom, this.board)
                .filter((to) => this.isPawnLandingLegal(this.currplayer, pawnFrom, to))
                .map((c) => this.algebraic2coords(c));
        }
        return [];
    }

    protected checkStalemate(): void {
        if (this.moves().length === 0) {
            this.gameover = true;
            this.winner = [this.currplayer === 1 ? 2 : 1];
            this.results.push({ type: "eog" }, { type: "winners", players: [...this.winner] });
        }
    }

    public state(): INeutronState {
        return {
            game: NeutronGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    public moveState(): IMoveState {
        return {
            _version: NeutronGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: cloneState(this.board) as Map<string, PieceId>,
        };
    }

    public render(): APRenderRep {
        let pstr = "";
        for (let row = 0; row < this.boardHeight; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < this.boardWidth; col++) {
                const cell = this.coords2algebraic(col, row);
                if (!this.board.has(cell)) {
                    pieces.push("-");
                } else {
                    const pc = this.board.get(cell)!;
                    if (pc === 1) {
                        pieces.push("A");
                    } else if (pc === 2) {
                        pieces.push("B");
                    } else {
                        pieces.push("N");
                    }
                }
            }
            pstr += pieces.join("");
        }

        const neutronColour: Colourfuncs = {
            func: "custom",
            default: "#888888",
            palette: 3,
        };

        const w = this.boardWidth;
        const h = this.boardHeight;
        const markers: MarkerShading[] = [
            {
                type: "shading",
                colour: 2,
                points: [
                    { row: 0, col: 0 },
                    { row: 0, col: w },
                    { row: 1, col: w },
                    { row: 1, col: 0 },
                ],
            },
            {
                type: "shading",
                colour: 1,
                points: [
                    { row: h - 1, col: 0 },
                    { row: h - 1, col: w },
                    { row: h, col: w },
                    { row: h, col: 0 },
                ],
            },
        ];

        const rep: APRenderRep = {
            board: {
                style: "squares-checkered",
                width: this.boardWidth,
                height: this.boardHeight,
                markers,
            },
            legend: {
                A: { name: "piece", colour: 1 },
                B: { name: "piece", colour: 2 },
                N: { name: "piece", colour: neutronColour },
            },
            pieces: pstr,
        };

        if (this.results.length > 0 || this._points.length > 0) {
            rep.annotations = [];

            for (const move of this.results) {
                if (move.type === "move") {
                    const [fromX, fromY] = this.algebraic2coords(move.from);
                    const [toX, toY] = this.algebraic2coords(move.to);
                    rep.annotations.push({
                        type: "move",
                        targets: [{ row: fromY, col: fromX }, { row: toY, col: toX }],
                    });
                }
            }
            if (this._points.length > 0) {
                rep.annotations.push({
                    type: "dots",
                    targets: this._points.map(([x, y]) => ({ row: y, col: x })) as [
                        { row: number; col: number },
                        ...{ row: number; col: number }[],
                    ],
                });
            }
        }

        return rep;
    }

    public clone(): NeutronGame {
        return new NeutronGame(this.serialize());
    }
}
