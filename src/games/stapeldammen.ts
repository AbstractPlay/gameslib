import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { DirectionDiagonal, RectGrid, reviver, SquareDiagGraph, UserFacingError } from "../common";
import i18next from "i18next";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const deepclone = require("rfdc/default");

const BOARD_SIZE = 10;

export type playerid = 1|2;
export type CellContents = playerid;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents[]>;
    lastmove?: string;
};

export interface IStapeldammenState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class StapeldammenGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Stapeldammen II",
        uid: "stapeldammen",
        playercounts: [2],
        version: "20260621",
        dateAdded: "2026-06-21",
        // i18next.t("apgames:descriptions.stapeldammen")
        description: "apgames:descriptions.stapeldammen",
        notes: "apgames:notes.stapeldammen",
        urls: [
            "https://boardgamegeek.com/boardgame/124716/stapeldammen",
            "https://boardgamegeek.com/thread/1566423/stapeldammen-variant-ii-the-review",
        ],
        people: [
            {
                type: "designer",
                name: "Tim ter Kuile",
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
            {
                type: "coder",
                name: "João Pedro Neto",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3829/joao-pedro-neto"],
                apid: "9228bccd-a1bd-452b-b94f-d05380e6638f",
            },
        ],
        variants: [
        ],
        categories: ["goal>score>eog", "mechanic>capture", "mechanic>move", "mechanic>stack", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["perspective", "automove", "experimental"]
    };

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
    private _points: [number, number][] = [];

    public get boardsize(): number {
        return BOARD_SIZE;
    }

    constructor(state?: IStapeldammenState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            const board = new Map<string, CellContents[]>([  // initial setup
                ["a1", [1,1]], ["c1", [1,1]], ["e1", [1,1]], ["g1", [1,1]], ["i1", [1,1]],
                     ["b2", [1,1]],  ["d2", [1,1]],  ["f2", [1,1]],  ["h2", [1,1]],  ["j2", [1,1]],

                     ["b10", [2,2]], ["d10", [2,2]], ["f10", [2,2]], ["h10", [2,2]], ["j10", [2,2]],
                ["a9", [2,2]], ["c9", [2,2]], ["e9", [2,2]], ["g9", [2,2]], ["i9", [2,2]],
            ]);

            this.variants = variants === undefined ? [] : [...variants];
            const fresh: IMoveState = {
                _version: StapeldammenGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IStapeldammenState;
            }
            if (state.game !== StapeldammenGame.gameinfo.uid) {
                throw new Error(`The Stapeldammen engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): StapeldammenGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = deepclone(state.board);
        this.lastmove = state.lastmove;
        return this;
    }

    private movesFor(cell: string): string[] {
        if (!this.board.has(cell)) {
            throw new Error(`No piece at ${cell}.`);
        }
        const moves: string[] = [];
        const g = new SquareDiagGraph(this.boardsize, this.boardsize);
        const stack = this.board.get(cell)!;
        const owner = stack[stack.length - 1];
        const captureDirs: DirectionDiagonal[] = ["NE", "NW", "SE", "SW"];

        // captures first
        for (const dir of captureDirs) {
            const ray = g.ray(...g.algebraic2coords(cell), dir).map(c => g.coords2algebraic(...c));
            if (ray.length >= 2) {
                const [next, far] = [...ray];
                if (this.board.has(next) && !this.board.has(far)) {
                    const nStack = this.board.get(next)!;
                    const nOwner = nStack[nStack.length - 1];
                    if (nOwner !== owner) {
                        moves.push(`${cell}x${far}`);
                    }
                }
            }
        }

        // moves only if there are no captures
        if (moves.length === 0) {
            const moveDirs: DirectionDiagonal[] = this.currplayer === 1 ? ["NE", "NW"] : ["SE", "SW"];

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

    private recurseCaps(stubs: string[], complete: string[]): void {
        const toVisit: string[] = [...stubs];
        while (toVisit.length > 0) {
            const mv = toVisit.shift()!;
            const cloned = StapeldammenGame.clone(this);
            cloned.move(mv, {partial: true, trusted: true});
            const parts = mv.split("x");
            const last = parts[parts.length - 1];
            const penult = parts[parts.length - 2];
            const moves = cloned.movesFor(last);
            if (moves.length === 0 || moves.join(",").includes("-")) {
                complete.push(mv);
            } else {
                for (const m of moves) {
                    const [,next] = m.split("x");
                    // forbid 180deg jumps
                    if (next !== penult) {
                        toVisit.push(`${mv}x${next}`);
                    } else {
                        complete.push(mv);
                    }
                }
            }
        }
    }

    public moves(player?: playerid, capOnly = false): string[] {
        if (this.gameover) { return []; }
        player ??= this.currplayer;

        let moveSets: string[][] = [];
        let canCap = false;
        const mine = [...this.board.entries()].filter(([,v]) => v[v.length - 1] === player).map(([k,]) => k);
        for (const cell of mine) {
            const mvs = this.movesFor(cell);
            if (mvs.join(",").includes("x")) {
                // first time captures are detected, truncate moveSets and set canCap
                if (!canCap) {
                    moveSets = [];
                    canCap = true;
                }
                moveSets.push(mvs);
            }
            // if mvs includes no captures, only save if canCap is false
            else if (!canCap) {
                moveSets.push(mvs);
            }
        }
        // At this point I have a list of unique starting moves,
        // either all captures or all moves.
        if (capOnly) {
            return moveSets.flat();
        }

        let moves: string[] = [];
        // Regardless of pieces in hand, if captures are available, they must be taken.
        if (canCap) {
            this.recurseCaps(moveSets.flat(), moves);
            // get maximum length
            const max = Math.max(...moves.map(mv => mv.length));
            // filter out anything shorter
            moves = moves.filter(mv => mv.length === max);
        }
        // If no captures, then there are a few different options.
        else {
            moves = moveSets.flat();
        }

        return moves.sort();
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const g = new SquareDiagGraph(this.boardsize, this.boardsize);
            const cell = this.coords2algebraic(col, row);
            let newmove = "";
            const allMoves = this.moves();
            if (move.length === 0) {
                if (this.board.has(cell)) {
                    newmove = cell;
                }
            } else {
                // clicking on an occupied cell resets
                if (this.board.has(cell)) {
                    newmove = cell;
                }
                // otherwise, assume movement or capture
                else {
                    const parts = move.split(/[-x]/);
                    const last = parts[parts.length - 1];
                    const [lx, ly] = g.algebraic2coords(last);
                    // if jumping more than one space, capture
                    if (Math.abs(lx - col) > 1 || Math.abs(ly - row) > 1) {
                        newmove = `${move}x${cell}`;
                    }
                    // otherwise movement
                    else {
                        newmove = `${move}-${cell}`;
                    }
                }
            }

            // autocomplete if possible
            const matches = allMoves.filter(mv => mv.startsWith(newmove));
            if (matches.length === 1) {
                newmove = matches[0];
            }

            const result = this.validateMove(newmove) as IClickResult;
            result.move = result.valid ? newmove : move;
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
        const allMoves = this.moves();

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.stapeldammen.INITIAL_INSTRUCTIONS");
            return result;
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        m = m.replace(/\*/g, "");

        const cells = m.split(/[-x]/);

        for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];

            try { // // check if valid cell
                this.algebraic2coords(cell)
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                return result;
            }

            // if first cell
            if (i === 0) {
                // occupied
                if (! this.board.has(cell)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: cell});
                    return result;
                }
                // owned
                const stack = this.board.get(cell)!;
                const owner = stack[stack.length - 1];
                if (owner !== this.currplayer) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                    return result;
                }
            }
            // otherwise
            else {
                // empty
                if (this.board.has(cell) && cell !== cells[0]) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.MOVE4CAPTURE", {where: cell});
                    return result;
                }
            }
        }

        // compare against move list
        if (! allMoves.includes(m)) {
            if (allMoves.filter(mv => mv.startsWith(m)).length > 0) {
                // valid partial
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.stapeldammen.VALID_PARTIAL");
                return result;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.stapeldammen.INVALID_MOVE");
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

    public move(m: string, {trusted = false, partial = false} = {}): StapeldammenGame {
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
        // if partial, set the movement indicator points
        // don't do this if trusted, or we get caught in a recurse loop
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
            // return this;
        // otherwise delete the points and process the full move
        } else {
            this._points = [];
        }

        this.results = [];
        const cells = m.split(/[-x]/);

        for (let i = 1; i < cells.length; i++) {
            const from = cells[i-1];
            const [fx, fy] = g.algebraic2coords(from);
            const to = cells[i];
            const [tx, ty] = g.algebraic2coords(to);
            // move the piece
            const stack = this.board.get(from)!;
            this.board.set(to, [...stack]);
            this.board.delete(from);
            this.results.push({type: "move", from, to});
            // if the in-between cells contain an enemy piece, capture it
            const between = RectGrid.between(fx, fy, tx, ty).map(pt => g.coords2algebraic(...pt));
            let enemy: string|undefined;
            for (const cell of between) {
                if (this.board.has(cell)) {
                    const stackBetween = this.board.get(cell)!;
                    if (stackBetween[stackBetween.length - 1] !== this.currplayer) {
                        enemy = cell;
                        break;
                    }
                }
            }
            if (enemy !== undefined) {
                const toStack = this.board.get(to)!;
                const enemyStack = this.board.get(enemy)!;
                const top = enemyStack.pop()!;
                // add top piece to the bottom of the toStack
                this.board.set(to, [top, ...toStack])
                // save the new enemyStack
                if (enemyStack.length > 0) {
                    this.board.set(enemy, [...enemyStack]);
                } else {
                    this.board.delete(enemy);
                }
                this.results.push({type: "capture", where: enemy});
            }
        }

        if (partial) { return this; }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): StapeldammenGame {
        // the game ends when the current player does not have any moves left
        if ( this.moves().length === 0 ) {
            this.gameover = true;
            const scores1 = this.getPlayerScore(1);
            const scores2 = this.getPlayerScore(2);

            if ( scores1 === scores2 ) {
                this.winner = [1, 2];
            } else {
                this.winner = scores1 > scores2 ? [1] : [2];
            }
        }

        if (this.gameover) {
            this.results.push( {type: "eog"},
                               {type: "winners", players: [...this.winner]} );
        }
        return this;
    }

    public render(): APRenderRep {
        const g = new SquareDiagGraph(this.boardsize, this.boardsize);
        // Build piece string
        const pstr: string[][][] = [];
        const cells = g.listCells(true) as string[][];
        for (const row of cells) {
            const pieces: string[][] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const str = this.board.get(cell)!.map(e => e === 1 ? "A" : "B");
                    pieces.push([...str]);
                } else {
                    pieces.push([]);
                }
            }
            pstr.push(pieces);
        }

        // Build rep
        const rep: APRenderRep =  {
            renderer: "stacking-offset",
            board: {
                style: "squares-checkered",
                width: this.boardsize,
                height: this.boardsize,
            },
            legend: {
                A: { name: "piece", colour: 1 },
                B: { name: "piece", colour: 2 },

            },
            pieces: pstr as [string[][], ...string[][][]]
        };

        // Add annotations
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

    public sidebarScores(): IScores[] {
        return [ {name: i18next.t("apgames:status.SCORES"),
                  scores: [this.getPlayerScore(1), this.getPlayerScore(2)]} ];
    }

    public getPlayerScore(player: playerid): number {
        const scoreCells = player === 1 ? ["b10", "d10", "f10", "h10", "j10"] :
                                          ["a1",  "c1",  "e1",  "g1",  "i1" ];
        let score = 0;
        for (const cell of scoreCells) {
            if (! this.board.has(cell) ) { continue; }
            const stack = this.board.get(cell)!;
            const owner = stack[stack.length - 1];
            score += owner === player ? stack.length : 0;
        }
        return score;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "add":
                node.push(i18next.t("apresults:ADD.add", {player, where: r.where!, count: r.num}));
                resolved = true;
                break;
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.nowhat", {player, where: r.where!}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public state(): IStapeldammenState {
        return {
            game: StapeldammenGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: StapeldammenGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: deepclone(this.board),
        };
    }

    public static clone(obj: StapeldammenGame): StapeldammenGame {
        const cloned = Object.assign(new StapeldammenGame(), deepclone(obj) as StapeldammenGame);
        return cloned;
    }

    public clone(): StapeldammenGame {
        return new StapeldammenGame(this.serialize());
    }
}
