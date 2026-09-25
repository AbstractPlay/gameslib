import {  GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult, IScores, type ChatLogCollectContext, type ChatLogLine } from "./_base.js";
import type { APGamesInformation } from "../schemas/gameinfo.js";
import { APRenderRep } from "@abstractplay/renderer/build/schemas/schema";
import type { APMoveResult } from "../schemas/moveresults.js";
import { DirectionDiagonal, RectGrid, reviver, SquareDiagGraph, UserFacingError, cloneState } from "../common/index.js";
import i18next from "i18next";


const BOARD_SIZE = 8;
const SETUP_ROWS = 3;
const STAGNATION_DRAW = 15;

export type playerid = 1|2;
export type Size = 1|2;
export type CellContents = [playerid, Size];

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents[]>;
    lastmove?: string;
    stagnant: number;
};

export interface IBashniState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class BashniGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Bashni",
        uid: "bashni",
        playercounts: [2],
        version: "20260925",
        dateAdded: "2026-09-25",
        // i18next.t("apgames:descriptions.bashni")
        description: "apgames:descriptions.bashni",
        // i18next.t("apgames:notes.bashni")
        notes: "apgames:notes.bashni",
        urls: [
            "https://en.wikipedia.org/wiki/Bashni",
            "https://boardgamegeek.com/boardgame/36550/bashni",
        ],
        bggid: "36550",
        people: [
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        variants: [
        ],
        categories: ["goal>immobilize", "mechanic>capture", "mechanic>move", "mechanic>stack", "other>traditional", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["experimental", "perspective", "automove", ]
    };

    public static clone(obj: BashniGame): BashniGame {
        const cloned = Object.assign(new BashniGame(), cloneState(obj) as BashniGame);
        return cloned;
    }

    private static compositionKey(board: Map<string, CellContents[]>): string {
        const stacks = [...board.values()].map((stack) => JSON.stringify(stack)).sort();
        return stacks.join("|");
    }

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, BOARD_SIZE);
    }
    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, BOARD_SIZE);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, CellContents[]>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public stagnant = 0;
    private _points: [number, number][] = [];

    public get boardsize(): number {
        return BOARD_SIZE;
    }

    constructor(state?: IBashniState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            this.variants = variants === undefined ? [] : [...variants];
            const g = new SquareDiagGraph(BOARD_SIZE, BOARD_SIZE);
            const board = new Map<string, CellContents[]>();
            for (let row = 0; row < SETUP_ROWS; row++) {
                for (let col = 0; col < BOARD_SIZE; col++) {
                    const rowEven = row % 2 === 0;
                    const colEven = col % 2 === 0;
                    if ( (rowEven && colEven) || (!rowEven && !colEven) ) {
                        const cell = g.coords2algebraic(col, row);
                        board.set(cell, [[2, 1]]);
                    }
                }
            }
            for (let row = BOARD_SIZE - SETUP_ROWS; row < BOARD_SIZE; row++) {
                for (let col = 0; col < BOARD_SIZE; col++) {
                    const rowEven = row % 2 === 0;
                    const colEven = col % 2 === 0;
                    if ( (rowEven && colEven) || (!rowEven && !colEven) ) {
                        const cell = g.coords2algebraic(col, row);
                        board.set(cell, [[1, 1]]);
                    }
                }
            }
            const fresh: IMoveState = {
                _version: BashniGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                stagnant: 0,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IBashniState;
            }
            if (state.game !== BashniGame.gameinfo.uid) {
                throw new Error(`The Bashni engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): BashniGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = cloneState(state.board);
        this.lastmove = state.lastmove;
        this.stagnant = state.stagnant ?? 0;
        return this;
    }

    private kingRow(player: playerid): number {
        return player === 1 ? 0 : BOARD_SIZE - 1;
    }

    private maybePromoteTop(to: string, player: playerid): string|undefined {
        const [, ty] = this.algebraic2coords(to);
        if (ty !== this.kingRow(player)) {
            return undefined;
        }
        const stack = this.board.get(to)!;
        const top = stack[stack.length - 1];
        if (top[1] !== 1) {
            return undefined;
        }
        stack[stack.length - 1] = [top[0], 2];
        this.board.set(to, cloneState(stack));
        this.results.push({type: "promote", where: to, to: "king"});
        return to;
    }

    private movesFor(cell: string): string[] {
        if (!this.board.has(cell)) {
            throw new Error(`No piece at ${cell}.`);
        }
        const moves: string[] = [];
        const g = new SquareDiagGraph(this.boardsize, this.boardsize);
        const stack = this.board.get(cell)!;
        const [owner, type] = stack[stack.length - 1];

        const captureDirs: DirectionDiagonal[] = ["NE", "NW", "SE", "SW"];
        let moveDirs: DirectionDiagonal[];
        if (type === 2) {
            moveDirs = ["NE", "NW", "SE", "SW"];
        } else if (owner === 1) {
            moveDirs = ["NE", "NW"];
        } else {
            moveDirs = ["SE", "SW"];
        }

        for (const dir of captureDirs) {
            const ray = g.ray(...g.algebraic2coords(cell), dir).map(c => g.coords2algebraic(...c));
            if (ray.length >= 2) {
                const [next, far] = [...ray];
                if (this.board.has(next) && !this.board.has(far)) {
                    const nStack = this.board.get(next)!;
                    const [nOwner,] = nStack[nStack.length - 1];
                    if (nOwner !== owner) {
                        moves.push(`${cell}x${far}`);
                    }
                }
            }
        }

        if (moves.length === 0) {
            for (const dir of moveDirs) {
                const coords = g.move(...g.algebraic2coords(cell), dir);
                if (coords !== undefined) {
                    const next = g.coords2algebraic(...coords);
                    if (!this.board.has(next)) {
                        moves.push(`${cell}-${next}`);
                    }
                }
            }
        }

        return moves;
    }

    private static captured(g: SquareDiagGraph, parts: string[]): string[] {
        const capped: string[] = [];
        for (let i = 1; i < parts.length; i++) {
            const from = parts[i-1];
            const to = parts[i];
            const [fx, fy] = g.algebraic2coords(from);
            const [tx, ty] = g.algebraic2coords(to);
            const between = RectGrid.between(fx, fy, tx, ty).map(c => g.coords2algebraic(...c));
            capped.push(between[0]);
        }
        return capped;
    }

    private recurseCaps(stubs: string[], complete: string[]): void {
        const g = new SquareDiagGraph(this.boardsize, this.boardsize);
        const toVisit: string[] = [...stubs];
        while (toVisit.length > 0) {
            const mv = toVisit.shift()!;
            const cloned = BashniGame.clone(this);
            cloned.move(mv, {partial: true, trusted: true});
            const parts = mv.split("x");
            const capped = BashniGame.captured(g, parts);
            const last = parts[parts.length - 1];
            const moves = cloned.movesFor(last);
            if (moves.length === 0 || moves.join(",").includes("-")) {
                complete.push(mv);
            } else {
                for (const m of moves) {
                    const [,next] = m.split("x");
                    const toCap = BashniGame.captured(g, [last, next]);
                    if (!capped.includes(toCap[0])) {
                        toVisit.push(`${mv}x${next}`);
                    } else {
                        complete.push(mv);
                    }
                }
            }
        }
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        let moveSets: string[][] = [];
        let canCap = false;
        const mine = [...this.board.entries()].filter(([,v]) => v[v.length - 1][0] === player).map(([k,]) => k);
        for (const cell of mine) {
            const mvs = this.movesFor(cell);
            if (mvs.join(",").includes("x")) {
                if (!canCap) {
                    moveSets = [];
                    canCap = true;
                }
                moveSets.push(mvs);
            }
            else if (!canCap) {
                moveSets.push(mvs);
            }
        }

        let moves: string[] = [];
        if (!canCap) {
            moves = moveSets.flat();
        }
        else {
            this.recurseCaps(moveSets.flat(), moves);
            const sorted = [...moves].sort((a,b) => a.length - b.length);
            const clean: string[] = [];
            for (let i = 0; i < sorted.length; i++) {
                const mv = sorted[i];
                const subset = sorted.slice(i+1);
                if (subset.filter(m => m.startsWith(mv)).length === 0) {
                    clean.push(mv);
                }
            }
            moves = [...clean];
        }

        return moves.sort();
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const g = new SquareDiagGraph(this.boardsize, this.boardsize);
            const cell = this.coords2algebraic(col, row);
            let newmove = "";
            if (move.length === 0) {
                if (this.board.has(cell)) {
                    newmove = cell;
                }
            } else {
                const parts = move.split(/[-x]/);
                const last = parts[parts.length - 1];
                const [lx, ly] = g.algebraic2coords(last);
                const jump = Math.abs(lx - col) > 1 || Math.abs(ly - row) > 1;
                if (this.board.has(cell)) {
                    if (this.findPoints(move)?.includes(cell)) {
                        newmove = jump ? `${move}x${cell}` : `${move}-${cell}`;
                    } else {
                        newmove = cell;
                    }
                } else if (jump) {
                    newmove = `${move}x${cell}`;
                } else {
                    newmove = `${move}-${cell}`;
                }
            }

            const matches = this.moves().filter(mv => mv.startsWith(newmove));
            if (matches.length === 1) {
                newmove = matches[0];
            }

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
            result.message = i18next.t("apgames:validation.bashni.INITIAL_INSTRUCTIONS")
            return result;
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        m = m.replace(/\*/g, "");

        const cells = m.split(/[-x]/);

        for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            try {
                this.algebraic2coords(cell)
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                return result;
            }

            if (i === 0) {
                if (! this.board.has(cell)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: cell});
                    return result;
                }
                const stack = this.board.get(cell)!;
                const [owner,] = stack[stack.length - 1];
                if (owner !== this.currplayer) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                    return result;
                }
            }
            else {
                if (this.board.has(cell) && cell !== cells[0]) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.MOVE4CAPTURE", {where: cell});
                    return result;
                }
            }
        }

        const allMoves = this.moves();
        if (! allMoves.includes(m)) {
            if (allMoves.filter(mv => mv.startsWith(m)).length > 0) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.bashni.VALID_PARTIAL");
                return result;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.bashni.INVALID_MOVE", {move: m});
                return result;
            }
        }

        result.valid = true;
        result.complete = 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private findPoints(partial: string): string[]|undefined {
        const [start,] = partial.split(/[-x]/);
        if (! this.board.has(start)) {
            return undefined;
        }
        const moves = this.moves().filter(mv => mv.startsWith(`${partial}`));
        const points: string[] = [];
        for (const m of moves) {
            const remainder = m.substring(`${partial}-`.length);
            const cells = remainder.split(/[-x]/);
            if (cells.length > 0 && cells[0] !== "") {
                points.push(cells[0]);
            }
        }
        return points;
    }

    public move(m: string, {trusted = false, partial = false} = {}): BashniGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if ( (! partial) && (! this.moves().includes(m)) ) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        const g = new SquareDiagGraph(this.boardsize, this.boardsize);
        if (partial && !trusted) {
            const pts = this.findPoints(m);
            if (pts !== undefined) {
                try {
                    this._points = pts.map(c => g.algebraic2coords(c));
                } catch {
                    // eslint-disable-next-line no-console
                    console.error(`An error occurred while generating points. The array looked like this:`, pts);
                }
            } else {
                this._points = [];
            }
        } else {
            this._points = [];
        }

        const compositionBefore = BashniGame.compositionKey(this.board);
        this.results = [];
        const cells = m.split(/[-x]/);
        const promotedCells = new Set<string>();
        for (let i = 1; i < cells.length; i++) {
            const from = cells[i-1];
            const [fx, fy] = g.algebraic2coords(from);
            const to = cells[i];
            const [tx, ty] = g.algebraic2coords(to);
            const stack = this.board.get(from)!;
            this.board.set(to, cloneState(stack));
            this.board.delete(from);
            this.results.push({type: "move", from, to});
            const between = RectGrid.between(fx, fy, tx, ty).map(pt => g.coords2algebraic(...pt));
            let enemy: string|undefined;
            for (const cell of between) {
                if (this.board.has(cell)) {
                    const stackBetween = this.board.get(cell)!;
                    if (stackBetween[stackBetween.length - 1][0] !== this.currplayer) {
                        enemy = cell;
                        break;
                    }
                }
            }
            if (enemy !== undefined) {
                const toStack = this.board.get(to)!;
                const enemyStack = this.board.get(enemy)!;
                const top = enemyStack.pop()!;
                this.board.set(to, cloneState([top, ...toStack]))
                if (enemyStack.length > 0) {
                    this.board.set(enemy, cloneState(enemyStack));
                } else {
                    this.board.delete(enemy);
                }
                const [, capSize] = top;
                this.results.push({type: "capture", where: enemy, what: capSize === 1 ? "soldier" : "officer"});
            }

            const promoted = this.maybePromoteTop(to, this.currplayer);
            if (promoted !== undefined) {
                promotedCells.add(promoted);
            }
        }

        if (partial) { return this; }

        for (const cell of promotedCells) {
            m = m.replace(cell, `${cell}*`);
        }
        this.lastmove = m;

        const compositionAfter = BashniGame.compositionKey(this.board);
        if (compositionBefore === compositionAfter) {
            this.stagnant++;
        } else {
            this.stagnant = 0;
        }

        let newplayer = (this.currplayer as number) + 1;
        if (newplayer > this.numplayers) {
            newplayer = 1;
        }
        this.currplayer = newplayer as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): BashniGame {
        let otherPlayer: playerid = 1;
        if (this.currplayer === 1) {
            otherPlayer = 2;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const repetitions = this.stateCount(new Map<string, any>([["board", this.board], ["currplayer", this.currplayer]]));
        if (repetitions >= 2) {
            this.gameover = true;
            this.winner = [1, 2];
        } else if (this.stagnant >= STAGNATION_DRAW) {
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
                this.results.push({type: "eog", reason: "repetition"});
            } else if (this.stagnant >= STAGNATION_DRAW) {
                this.results.push({type: "eog", reason: "stagnation"});
            } else {
                this.results.push({type: "eog"});
            }
            this.results.push({type: "winners", players: [...this.winner]});
        }
        return this;
    }

    public state(): IBashniState {
        return {
            game: BashniGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: BashniGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: cloneState(this.board),
            stagnant: this.stagnant,
        };
    }

    public render(): APRenderRep {
        const g = new SquareDiagGraph(this.boardsize, this.boardsize);
        const pstr: string[][][] = [];
        const cells = g.listCells(true) as string[][];
        for (const row of cells) {
            const pieces: string[][] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const str = this.board.get(cell)!.map(e =>
                        e[0] === 1 ? (e[1] === 1 ? "A" : "B") :
                                     (e[1] === 1 ? "X" : "Y")
                    );
                    pieces.push([...str]);
                } else {
                    pieces.push([]);
                }
            }
            pstr.push(pieces);
        }

        const rep: APRenderRep =  {
            renderer: "stacking-offset",
            board: {
                style: "squares-checkered",
                width: this.boardsize,
                height: this.boardsize,
                markers: [
                    {
                        type: "edge",
                        colour: 1,
                        edge: "S",
                    },
                    {
                        type: "edge",
                        colour: 2,
                        edge: "N",
                    }
                ],
            },
            legend: {
                A: {
                    name: "piece",
                    colour: 1
                },
                B: {
                    name: "piece-horse",
                    colour: 1
                },
                X: {
                    name: "piece",
                    colour: 2
                },
                Y: {
                    name: "piece-horse",
                    colour: 2
                },
            },
            pieces: pstr as [string[][], ...string[][][]]
        };

        if ( (this.stack[this.stack.length - 1]._results.length > 0) || (this._points.length > 0) ) {
            rep.annotations = [];

            if (this._points.length > 0) {
                const points = [];
                for (const cell of this._points) {
                    points.push({row: cell[1], col: cell[0]});
                }
                rep.annotations.push({type: "dots", targets: points as [{row: number; col: number;}, ...{row: number; col: number;}[]]});
            }

            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = this.algebraic2coords(move.from);
                    const [toX, toY] = this.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "capture") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                }
            }
        }

        return rep;
    }

    private getStepsToOfficer(player?: playerid): number {
        if (player === undefined) {
            player = this.currplayer;
        }
        const startRank = player === 1 ? this.boardsize - 1 : 0;
        const g = new SquareDiagGraph(this.boardsize, this.boardsize);
        const mine = [...this.board.entries()].filter(([,v]) => v[v.length - 1][0] === player).map(([k,v]) => {
            const [col, row] = g.algebraic2coords(k);
            return {col, row, stack: v};
        });
        let steps = 0;
        for (const {row, stack} of mine) {
            const top = stack[stack.length - 1];
            if (top[1] === 2) {
                steps += this.boardsize;
            } else {
                steps += (Math.abs(startRank - row) + 1);
            }
        }
        return steps;
    }

    private getMaterial(player?: playerid): number {
        if (player === undefined) {
            player = this.currplayer;
        }
        const mine = [...this.board.entries()].filter(([,v]) => v[v.length - 1][0] === player).map(([,v]) => v);
        let score = 0;
        for (const stack of mine) {
            stack.forEach(pc => {
                if (pc[0] === player) {
                    score++;
                }
            });
            const top = stack[stack.length - 1];
            if (top[1] === 2) {
                score++;
            }
        }
        return score;
    }

    public sidebarScores(): IScores[] {
        return [
            { name: this.neutralAreaLabel("apgames:status.bashni.STEPS"), scores: [this.getStepsToOfficer(1), this.getStepsToOfficer(2)] },
            { name: this.neutralAreaLabel("apgames:status.bashni.MATERIAL"), scores: [this.getMaterial(1), this.getMaterial(2)] },
        ]
    }


    public collectChatLogLine(lines: ChatLogLine[], r: APMoveResult, ctx: ChatLogCollectContext): boolean {
        switch (r.type) {
            case "capture":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:CAPTURE.lasca", {where: r.where!, context: r.what!});
                return true;
            case "promote":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:PROMOTE.basicWhere", {where: r.where!});
                return true;
            case "eog":
                if (r.reason === "repetition") {
                    this.pushNeutralChatLine(lines, "apresults:EOG.repetition", {count: 3});
                } else if (r.reason === "stagnation") {
                    this.pushNeutralChatLine(lines, "apresults:EOG.bashni_stagnation", {count: STAGNATION_DRAW});
                } else {
                    this.pushNeutralChatLine(lines, "apresults:EOG.default");
                }
                return true;
            default:
                return super.collectChatLogLine(lines, r, ctx);
        }
    }

    public sameMove(move1: string, move2: string): boolean {
        move1 = move1.toLowerCase().replace("*", "");
        move2 = move2.toLowerCase().replace("*", "");
        return move1 === move2;
    }

    public clone(): BashniGame {
        return new BashniGame(this.serialize());
    }
}
