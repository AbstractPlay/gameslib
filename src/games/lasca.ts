import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { DirectionDiagonal, RectGrid, reviver, SquareDiagGraph, UserFacingError } from "../common";
import i18next from "i18next";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const deepclone = require("rfdc/default");

export type playerid = 1|2;
export type Size = 1|2;
export type CellContents = [playerid, Size];

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents[]>;
    lastmove?: string;
};

export interface ILascaState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class LascaGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Lasca",
        uid: "lasca",
        playercounts: [2],
        version: "20251123",
        dateAdded: "2025-11-23",
        // i18next.t("apgames:descriptions.lasca")
        description: "apgames:descriptions.lasca",
        urls: [
            "https://en.wikipedia.org/wiki/Lasca",
            "https://www.boardgamegeek.com/game/6862",
        ],
        people: [
            {
                type: "designer",
                name: "Emanuel Lasker",
                urls: ["https://en.wikipedia.org/wiki/Emanuel_Lasker"],
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        variants: [
        ],
        categories: ["goal>immobilize", "mechanic>capture", "mechanic>differentiate", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["experimental", "perspective", "automove"]
    };

    public static clone(obj: LascaGame): LascaGame {
        const cloned = Object.assign(new LascaGame(), deepclone(obj) as LascaGame);
        return cloned;
    }

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 7);
    }
    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 7);
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
        return 7;
    }

    constructor(state?: ILascaState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            this.variants = variants === undefined ? [] : [...variants];
            const board = new Map<string, CellContents[]>([
                ["a7", [[2,1]]], ["c7", [[2,1]]], ["e7", [[2,1]]], ["g7", [[2,1]]],
                ["b6", [[2,1]]], ["d6", [[2,1]]], ["f6", [[2,1]]],
                ["a5", [[2,1]]], ["c5", [[2,1]]], ["e5", [[2,1]]], ["g5", [[2,1]]],

                ["a1", [[1,1]]], ["c1", [[1,1]]], ["e1", [[1,1]]], ["g1", [[1,1]]],
                ["b2", [[1,1]]], ["d2", [[1,1]]], ["f2", [[1,1]]],
                ["a3", [[1,1]]], ["c3", [[1,1]]], ["e3", [[1,1]]], ["g3", [[1,1]]],
            ]);
            const fresh: IMoveState = {
                _version: LascaGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ILascaState;
            }
            if (state.game !== LascaGame.gameinfo.uid) {
                throw new Error(`The Lasca engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): LascaGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.lastmove = state.lastmove;
        return this;
    }

    private movesFor(cell: string): string[] {
        if (!this.board.has(cell)) {
            throw new Error(`No piece at ${cell}.`);
        }
        const moves: string[] = [];
        const g = new SquareDiagGraph(7, 7);
        const stack = this.board.get(cell)!;
        const [owner, type] = stack[stack.length - 1];

        let dirs: DirectionDiagonal[];
        if (type === 2) {
            dirs = ["NE", "NW", "SE", "SW"];
        } else {
            if (owner === 1) {
                dirs = ["NE", "NW"];
            } else {
                dirs = ["SE", "SW"];
            }
        }

        // captures first
        for (const dir of dirs) {
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

        // moves only if there are no captures
        if (moves.length === 0) {
            for (const dir of dirs) {
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
            const cloned = LascaGame.clone(this);
            cloned.move(mv, {partial: true, trusted: true});
            const parts = mv.split("x");
            const last = parts[parts.length - 1];
            const moves = cloned.movesFor(last);
            if (moves.length === 0 || moves.join(",").includes("-")) {
                complete.push(mv);
            } else {
                for (const m of moves) {
                    const [,next] = m.split("x");
                    toVisit.push(`${mv}x${next}`);
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

        let moves: string[] = [];
        // At this point I have a list of unique starting moves,
        // either all captures or all moves. If no captures, then we're done.
        if (!canCap) {
            moves = moveSets.flat();
        }
        // Otherwise, iterate until there are no more captures found.
        else {
            this.recurseCaps(moveSets.flat(), moves);
        }

        return moves.sort();
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
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
            if (newmove.includes("x")) {
                const matches = this.moves().filter(mv => mv.startsWith(newmove));
                if (matches.length === 1) {
                    newmove = matches[0];
                }
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
            result.message = i18next.t("apgames:validation.lasca.INITIAL_INSTRUCTIONS")
            return result;
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        m = m.replace(/\*/g, "");

        const cells = m.split(/[-x]/);

        // basics
        for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            // valid cell
            try {
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
                const [owner,] = stack[stack.length - 1];
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
        const allMoves = this.moves();
        if (! allMoves.includes(m)) {
            if (allMoves.filter(mv => mv.startsWith(m)).length > 0) {
                // valid partial
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.lasca.VALID_PARTIAL");
                return result;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.lasca.INVALID_MOVE", {move: m});
                return result;
            }
        }

        // Looks good
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

    public move(m: string, {trusted = false, partial = false} = {}): LascaGame {
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
        const startStack = this.board.get(cells[0])!;
        const [,startsize] = startStack[startStack.length - 1];
        let promoted: string|undefined;
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
                // add top piece to the bottom of the toStack
                this.board.set(to, [top, ...toStack])
                // save the new enemyStack
                if (enemyStack.length > 0) {
                    this.board.set(enemy, [...enemyStack]);
                } else {
                    this.board.delete(enemy);
                }
                const [, capSize] = top;
                this.results.push({type: "capture", where: enemy, what: capSize === 1 ? "soldier" : "officer"});
            }

            // check for promotion
            if (startsize === 1 && promoted === undefined) {
                const last = this.currplayer === 1 ? 0 : this.boardsize - 1;
                if (ty === last) {
                    const stack = this.board.get(to)!;
                    stack[stack.length - 1][1] = 2;
                    this.board.set(to, [...stack]);
                    this.results.push({type: "promote", where: to, to: "officer"});
                    promoted = to;
                }
            }
        }

        if (partial) { return this; }

        // update currplayer
        if (promoted !== undefined) {
            m = m.replace(promoted, `${promoted}*`);
        }
        this.lastmove = m;
        let newplayer = (this.currplayer as number) + 1;
        if (newplayer > this.numplayers) {
            newplayer = 1;
        }
        this.currplayer = newplayer as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): LascaGame {
        let otherPlayer: playerid = 1;
        if (this.currplayer === 1) {
            otherPlayer = 2;
        }

        // otherPlayer wins if current player has no moves
        const moves = this.moves();
        if (moves.length === 0) {
            this.gameover = true;
            this.winner = [otherPlayer];
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): ILascaState {
        return {
            game: LascaGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: LascaGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
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

        // Build rep
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
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.lasca", {player, where: r.where!, context: r.what!}));
                resolved = true;
                break;
            case "promote":
                node.push(i18next.t("apresults:PROMOTE.basicWhere", {player, where: r.where!}));
                resolved = true;
                break;
        }
        return resolved;
    }

    // // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // protected getMoveList(): any[] {
    //     return this.getMovesAndResults(["move", "winners", "eog"]);
    // }

    public clone(): LascaGame {
        return new LascaGame(this.serialize());
    }
}
