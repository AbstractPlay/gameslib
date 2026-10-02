import { GameBase, IAPGameState, IClickResult, ICustomButton, IIndividualState, IScores, IValidationResult, type ChatLogCollectContext, type ChatLogLine } from "./_base.js";
import type { APGamesInformation } from "../schemas/gameinfo.js";
import { APRenderRep } from "@abstractplay/renderer/build/schemas/schema";
import type { APMoveResult } from "../schemas/moveresults.js";
import { HexTriGraph, SquareOrthGraph, reviver, shuffle, UserFacingError } from "../common/index.js";
import type { IGraph } from "../common/graphs/index.js";
import i18next from "i18next";

export type playerid = 1 | 2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
}

export interface IYoddState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
}

export class YoddGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Yodd",
        uid: "yodd",
        playercounts: [2],
        version: "20260930",
        dateAdded: "2026-09-30",
        // i18next.t("apgames:descriptions.yodd")
        description: "apgames:descriptions.yodd",
        notes: "apgames:notes.yodd",
        urls: [
            "https://boardgamegeek.com/boardgame/105173/yodd",
            "https://boardgamegeek.com/boardgame/112111/xodd",
        ],
        bggid: "105173",
        people: [
            {
                type: "designer",
                name: "Luis Bolaños Mures",
                urls: ["https://boardgamegeek.com/boardgamedesigner/47001/luis-bolanos-mures"],
                apid: "6b518a3f-7f63-47b8-b92b-a04792fba8e7",
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        categories: [
            "goal>score>eog",
            "mechanic>place",
            "mechanic>coopt",
            "board>shape>hex",
            "board>shape>rect",
            "board>connect>hex",
            "board>connect>rect",
            "components>simple>1c",
        ],
        variants: [
            { uid: "hex-6", group: "board" },
            { uid: "hex-7", group: "board" },
            { uid: "#board", },
            { uid: "hex-9", group: "board" },
            { uid: "hex-10", group: "board" },
            { uid: "square-9", group: "board" },
            { uid: "square-10", group: "board" },
            { uid: "square-13", group: "board" },
            { uid: "square-14", group: "board" },
            { uid: "square-15", group: "board" },
            { uid: "yopp" },
        ],
        flags: ["experimental", "no-moves", "custom-buttons", "custom-randomization", "scores"],
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public boardSize = 8;
    private geometry: "hex" | "square" = "hex";
    private graph!: IGraph;

    constructor(state?: IYoddState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: YoddGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IYoddState;
            }
            if (state.game !== YoddGame.gameinfo.uid) {
                throw new Error(`The Yodd engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): YoddGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if (idx < 0 || idx >= this.stack.length) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.lastmove = state.lastmove;
        this.results = [...state._results];
        this.boardSize = this.getBoardSize();
        this.geometry = this.variants.some(v => v.includes("square")) ? "square" : "hex";
        this.graph = this.buildGraph();
        return this;
    }

    private getBoardSize(): number {
        if (this.variants !== undefined && this.variants.length > 0) {
            const boardVariant = this.variants.find(v =>
                v.startsWith("hex-") || v.startsWith("square-") || v === "#board");
            if (boardVariant !== undefined) {
                if (boardVariant === "#board") {
                    return 8;
                }
                const size = boardVariant.match(/\d+/);
                if (size !== null) {
                    return parseInt(size[0], 10);
                }
            }
        }
        return 8;
    }

    private buildGraph(): IGraph {
        if (this.geometry === "square") {
            return new SquareOrthGraph(this.boardSize, this.boardSize);
        }
        return new HexTriGraph(this.boardSize, this.boardSize * 2 - 1);
    }

    private sort(a: string, b: string): number {
        if (a[0] < b[0]) { return -1; }
        if (a[0] > b[0]) { return +1; }

        const [ax, ay] = this.graph.algebraic2coords(a.slice(1));
        const [bx, by] = this.graph.algebraic2coords(b.slice(1));
        if (ay < by) { return 1; }
        if (ay > by) { return -1; }
        if (ax < bx) { return -1; }
        if (ax > bx) { return 1; }
        return 0;
    }

    public countGroups(colour: playerid, board: Map<string, playerid> = this.board): number {
        const pieces = [...board.entries()].filter(e => e[1] === colour).map(e => e[0]);
        const seen: Set<string> = new Set();
        let groups = 0;
        for (const piece of pieces) {
            if (seen.has(piece)) {
                continue;
            }
            groups++;
            const todo: string[] = [piece];
            while (todo.length > 0) {
                const cell = todo.pop()!;
                if (seen.has(cell)) {
                    continue;
                }
                seen.add(cell);
                for (const n of this.graph.neighbours(cell)) {
                    if (pieces.includes(n) && !seen.has(n)) {
                        todo.push(n);
                    }
                }
            }
        }
        return groups;
    }

    private totalGroups(board: Map<string, playerid> = this.board): number {
        return this.countGroups(1, board) + this.countGroups(2, board);
    }

    private isOddPosition(board: Map<string, playerid> = this.board): boolean {
        return this.totalGroups(board) % 2 === 1;
    }

    private isYopp(): boolean {
        return this.variants.includes("yopp");
    }

    private hasValidCompletePlacement(): boolean {
        const empty = (this.graph.listCells(false) as string[]).filter(c => !this.board.has(c));
        const p = this.currplayer;
        const stoneColours = (): playerid[] => (this.isYopp() ? [p] : [1, 2]);

        if (this.stack.length === 1) {
            for (const cell of empty) {
                for (const colour of stoneColours()) {
                    if (this.tryCompleteMove(`${colour}${cell}`) !== undefined) {
                        return true;
                    }
                }
            }
            return false;
        }

        for (const cell of empty) {
            for (const colour of stoneColours()) {
                if (this.tryCompleteMove(`${colour}${cell}`) !== undefined) {
                    return true;
                }
            }
        }
        for (let i = 0; i < empty.length; i++) {
            for (let j = i + 1; j < empty.length; j++) {
                for (const c1 of stoneColours()) {
                    for (const c2 of stoneColours()) {
                        if (this.tryCompleteMove(`${c1}${empty[i]!},${c2}${empty[j]!}`) !== undefined) {
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    }

    private canPass(): boolean {
        if (this.stack.length === 1) {
            return false;
        }
        if (this.hasUncommittedPlacements()) {
            return false;
        }
        if (!this.isOddPosition()) {
            return false;
        }
        if (this.isYopp() && this.hasValidCompletePlacement()) {
            return false;
        }
        return true;
    }

    private committedBoard(): Map<string, playerid> {
        return this.stack[this.stack.length - 1]!.board;
    }

    private hasUncommittedPlacements(): boolean {
        const committed = this.committedBoard();
        if (this.board.size !== committed.size) {
            return true;
        }
        for (const [cell, owner] of this.board) {
            if (committed.get(cell) !== owner) {
                return true;
            }
        }
        return false;
    }

    private boardFull(): boolean {
        const cells = this.graph.listCells(false) as string[];
        return this.board.size >= cells.length;
    }

    private resolveWinners(): void {
        const g1 = this.countGroups(1);
        const g2 = this.countGroups(2);
        if (g1 < g2) {
            this.winner = [1];
        } else if (g2 < g1) {
            this.winner = [2];
        } else {
            // Drawless in theory; equal group counts should be extremely rare.
            this.winner = [1, 2];
        }
    }

    private boardAfterPlacements(m: string): Map<string, playerid> {
        const board = new Map(this.board);
        for (const part of m.split(",")) {
            const cell = part.slice(1);
            const owner = part[0] === "1" ? 1 : 2;
            board.set(cell, owner as playerid);
        }
        return board;
    }

    private normaliseMove(move: string): string {
        move = move.toLowerCase();
        move = move.replace(/\s+/g, "");
        return move.split(",").sort((a, b) => this.sort(a, b)).join(",");
    }

    public sameMove(move1: string, move2: string): boolean {
        return this.normaliseMove(move1) === this.normaliseMove(move2);
    }

    private processMoves(coordinates: string[], newCoord: string, currentPlayer: playerid): string[] {
        if (this.isYopp()) {
            const existingEntry = coordinates.find(c => c.slice(1) === newCoord);
            if (existingEntry === undefined) {
                return [...coordinates, `${currentPlayer}${newCoord}`];
            }
            return coordinates.filter(c => c.slice(1) !== newCoord);
        }

        const enemyPlayer: playerid = currentPlayer === 1 ? 2 : 1;
        const existingEntry = coordinates.find(c => c.endsWith(newCoord));

        if (!existingEntry) {
            return [...coordinates, `${currentPlayer}${newCoord}`];
        }

        const currentPrefix = existingEntry[0];
        const otherCoordinates = coordinates.filter(c => !c.endsWith(newCoord));

        if (currentPrefix === currentPlayer.toString()) {
            return [...otherCoordinates, `${enemyPlayer}${newCoord}`];
        }
        return otherCoordinates;
    }

    private tryCompleteMove(raw: string): string | undefined {
        const m = this.normaliseMove(raw);
        if (m.length === 0) {
            return undefined;
        }
        const validation = this.validateMove(m);
        if (!validation.valid) {
            return undefined;
        }
        if (this.stack.length === 1 && m.split(",").length !== 1) {
            return undefined;
        }
        if (!this.isOddPosition(this.boardAfterPlacements(m))) {
            return undefined;
        }
        return m;
    }

    private randomStoneColour(): playerid {
        return Math.random() < 0.5 ? 1 : 2;
    }

    public randomMove(): string {
        const empty = (this.graph.listCells(false) as string[]).filter(c => !this.board.has(c));
        const shuffled = shuffle(empty);

        const p = this.currplayer;
        const tryOneStone = (): string | undefined => {
            for (const cell of shuffled) {
                if (this.isYopp()) {
                    const found = this.tryCompleteMove(`${p}${cell}`);
                    if (found !== undefined) {
                        return found;
                    }
                } else {
                    const colour = this.randomStoneColour();
                    let found = this.tryCompleteMove(`${colour}${cell}`);
                    if (found === undefined) {
                        const other: playerid = colour === 1 ? 2 : 1;
                        found = this.tryCompleteMove(`${other}${cell}`);
                    }
                    if (found !== undefined) {
                        return found;
                    }
                }
            }
            return undefined;
        };

        const tryTwoStones = (): string | undefined => {
            for (let i = 0; i < shuffled.length; i++) {
                for (let j = i + 1; j < shuffled.length; j++) {
                    let found: string | undefined;
                    if (this.isYopp()) {
                        found = this.tryCompleteMove(`${p}${shuffled[i]!},${p}${shuffled[j]!}`);
                    } else {
                        const c1 = this.randomStoneColour();
                        const c2 = this.randomStoneColour();
                        found = this.tryCompleteMove(`${c1}${shuffled[i]!},${c2}${shuffled[j]!}`);
                    }
                    if (found !== undefined) {
                        return found;
                    }
                }
            }
            return undefined;
        };

        if (this.stack.length === 1) {
            const opening = tryOneStone();
            if (opening !== undefined) {
                return opening;
            }
        } else {
            const wantTwo = Math.random() < 0.5 && shuffled.length >= 2;
            if (wantTwo) {
                const pair = tryTwoStones();
                if (pair !== undefined) {
                    return pair;
                }
            }
            const single = tryOneStone();
            if (single !== undefined) {
                return single;
            }
        }

        if (this.canPass()) {
            return "pass";
        }
        return "pass";
    }

    public moves(): string[] {
        if (this.gameover) { return []; }
        const moves: string[] = [];
        if (this.canPass()) {
            moves.push("pass");
        }
        return moves;
    }

    public getButtons(): ICustomButton[] {
        const pass = this.validateMove("pass");
        if (pass.valid && pass.complete === 1) {
            return [{ label: "apgames:buttons.pass", move: "pass" }];
        }
        return [];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            if (piece === "_btn_pass") {
                const result = this.validateMove("pass") as IClickResult;
                result.move = result.valid ? "pass" : move;
                return result;
            }
            const cell = this.graph.coords2algebraic(col, row);
            let newmove: string;
            if (move === "") {
                newmove = `${this.currplayer}${cell}`;
            } else {
                const moves = move.split(",");
                newmove = this.processMoves(moves, cell, this.currplayer)
                    .sort((a, b) => this.sort(a, b))
                    .join(",");
            }
            const result = this.validateMove(newmove) as IClickResult;
            if (!result.valid) {
                result.move = move;
                if (move.length > 0) {
                    const kept = this.validateMove(move);
                    if (kept.valid) {
                        result.complete = kept.complete;
                    }
                    if (kept.canrender === true) {
                        result.canrender = true;
                    }
                }
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
        const maxPlacements = 2;
        const result: IValidationResult = {
            valid: false,
            message: i18next.t("apgames:validation._general.DEFAULT_HANDLER"),
        };

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            if (this.stack.length === 1) {
                result.message = i18next.t("apgames:validation.yodd.INITIAL_INSTRUCTIONS", {
                    context: this.isYopp() ? "yopp" : "",
                });
            } else {
                result.message = i18next.t("apgames:validation.yodd.INSTRUCTIONS", {
                    context: this.isYopp() ? "yopp" : "",
                });
            }
            return result;
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (m === "pass") {
            if (this.stack.length === 1) {
                result.message = i18next.t("apgames:validation.yodd.NO_PASS_OPENING");
                return result;
            }
            if (this.hasUncommittedPlacements()) {
                result.message = i18next.t("apgames:validation.yodd.INVALID_PASS_PARTIAL");
                return result;
            }
            if (!this.isOddPosition()) {
                result.message = i18next.t("apgames:validation.yodd.ODD_GROUPS_REQUIRED");
                return result;
            }
            if (this.isYopp() && this.hasValidCompletePlacement()) {
                result.message = i18next.t("apgames:validation.yodd.INVALID_PASS");
                return result;
            }
            result.valid = true;
            result.complete = 1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        const placementMessage = (): string => {
            const after = this.boardAfterPlacements(m);
            if (!this.isOddPosition(after)) {
                return i18next.t("apgames:validation.yodd.INSTRUCTIONS_ODD");
            }
            return i18next.t("apgames:validation.yodd.VALID_MOVE");
        };

        const moves = m.split(",");

        if (moves.length > maxPlacements) {
            result.message = i18next.t("apgames:validation.yodd.TOO_MANY_MOVES");
            return result;
        }

        let currentMove: string | undefined;
        try {
            for (const move of moves) {
                currentMove = move.slice(1);
                if (!(this.graph.listCells() as string[]).includes(currentMove)) {
                    throw new Error("Invalid cell.");
                }
            }
        } catch {
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: currentMove });
            return result;
        }

        let notEmpty: string | undefined;
        for (const move of moves) {
            if (this.board.has(move.slice(1))) {
                notEmpty = move.slice(1);
                break;
            }
        }
        if (notEmpty !== undefined) {
            result.message = i18next.t("apgames:validation._general.OCCUPIED", { where: notEmpty });
            return result;
        }

        const regex = /^[12][a-z]\d+(,[12][a-z]\d+)?$/;
        if (!regex.test(m)) {
            result.message = i18next.t("apgames:validation.yodd.INVALID_PLACEMENT", { move: m });
            return result;
        }

        if (this.isYopp()) {
            for (const move of moves) {
                const owner = move[0] === "1" ? 1 : 2;
                if (owner !== this.currplayer) {
                    result.message = i18next.t("apgames:validation.yodd.OWN_COLOUR_ONLY");
                    return result;
                }
            }
        }

        const normalised = this.normaliseMove(m);
        if (!this.sameMove(m, normalised)) {
            result.message = i18next.t("apgames:validation.yodd.NORMALISED", { normalised });
            return result;
        }

        if (this.stack.length === 1) {
            if (moves.length !== 1) {
                result.message = i18next.t("apgames:validation.yodd.TOO_MANY_MOVES_START");
                return result;
            }
            const after = this.boardAfterPlacements(m);
            if (!this.isOddPosition(after)) {
                result.message = i18next.t("apgames:validation.yodd.ODD_GROUPS_REQUIRED");
                return result;
            }
            result.valid = true;
            result.complete = 0;
            result.canrender = true;
            result.message = placementMessage();
            return result;
        }

        const after = this.boardAfterPlacements(m);
        if (moves.length === 2 && !this.isOddPosition(after)) {
            result.message = i18next.t("apgames:validation.yodd.ODD_GROUPS_REQUIRED");
            return result;
        }

        result.valid = true;
        result.complete = 0;
        result.canrender = true;
        result.message = placementMessage();
        return result;
    }

    public move(m: string, { partial = false, trusted = false } = {}): YoddGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        if (m.length === 0) { return this; }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (!trusted) {
            const validation = this.validateMove(m);
            if (!validation.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", validation.message);
            }
            if (!partial) {
                const completeOk = m === "pass" ? validation.complete === 1 : validation.complete === 0;
                if (!completeOk) {
                    throw new UserFacingError("VALIDATION_GENERAL", validation.message);
                }
            }
        }

        this.results = [];

        if (m === "pass") {
            this.results.push({ type: "pass" });
            this.lastmove = m;
            if (partial) { return this; }
            this.currplayer = (this.currplayer % 2 + 1) as playerid;
            this.checkEOG();
            this.saveState();
            return this;
        }

        m = this.normaliseMove(m);
        const moves = m.split(",");

        for (const move of moves) {
            const owner = move[0] === "1" ? 1 : 2;
            const where = move.slice(1);
            this.board.set(where, owner as playerid);
            this.results.push({ type: "place", where });
        }
        this.lastmove = m;

        if (partial) { return this; }

        if (this.stack.length === 1) {
            if (moves.length !== 1) {
                throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation.yodd.TOO_MANY_MOVES_START"));
            }
        } else if (!this.isOddPosition()) {
            throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation.yodd.ODD_GROUPS_REQUIRED"));
        }

        this.currplayer = (this.currplayer % 2 + 1) as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): YoddGame {
        const doublePass =
            this.lastmove === "pass" &&
            this.stack[this.stack.length - 1].lastmove === "pass";
        this.gameover = this.boardFull() || doublePass;

        if (this.gameover) {
            this.resolveWinners();
            this.results.push(
                { type: "eog" },
                { type: "winners", players: [...this.winner] },
            );
        }
        return this;
    }

    public state(): IYoddState {
        return {
            game: YoddGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    public moveState(): IMoveState {
        return {
            _version: YoddGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    public render(): APRenderRep {
        const rep = this.geometry === "hex" ? this.renderHexTri() : this.renderSquare();
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
                    const [x, y] = this.graph.algebraic2coords(move.where!);
                    rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                }
            }
        }
        return rep;
    }

    private renderSquare(): APRenderRep {
        let pstr = "";
        for (let row = 0; row < this.boardSize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.graph.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    pstr += this.board.get(cell) === 1 ? "A" : "B";
                } else {
                    pstr += "-";
                }
            }
        }
        pstr = pstr.replace(new RegExp(`-{${this.boardSize}}`, "g"), "_");
        return {
            options: ["hide-star-points"],
            board: {
                style: "vertex",
                width: this.boardSize,
                height: this.boardSize,
            },
            legend: {
                A: [{ name: "piece", colour: 1 }],
                B: [{ name: "piece", colour: 2 }],
            },
            pieces: pstr,
        };
    }

    private renderHexTri(): APRenderRep {
        const pstr: string[][] = [];
        const cells = (this.graph as HexTriGraph).listCells(true);
        for (const row of cells) {
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    pieces.push(this.board.get(cell) === 1 ? "A" : "B");
                } else {
                    pieces.push("-");
                }
            }
            pstr.push(pieces);
        }
        return {
            board: {
                style: "hex-of-tri",
                minWidth: this.boardSize,
                maxWidth: this.boardSize * 2 - 1,
            },
            legend: {
                A: { name: "piece", colour: 1 },
                B: { name: "piece", colour: 2 },
            },
            pieces: pstr.map(p => p.join("")).join("\n"),
        };
    }

    public sidebarScores(): IScores[] {
        return [
            {
                name: this.neutralAreaLabel("apgames:status.GROUPCOUNT"),
                scores: [this.countGroups(1).toString(), this.countGroups(2).toString()],
            },
        ];
    }

    public collectChatLogLine(lines: ChatLogLine[], r: APMoveResult, ctx: ChatLogCollectContext): boolean {
        switch (r.type) {
            case "place":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:PLACE.complete", {
                    where: r.where!,
                    what: this.board.get(r.where!)! !== this.currplayer ? "friendly piece" : "opponent piece",
                });
                return true;
            case "eog":
                this.pushNeutralChatLine(lines, "apresults:EOG.default");
                return true;
            default:
                return super.collectChatLogLine(lines, r, ctx);
        }
    }

    public clone(): YoddGame {
        return new YoddGame(this.serialize());
    }
}
