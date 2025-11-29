import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { DirectionDiagonal, RectGrid, reviver, SquareDiagGraph, UserFacingError } from "../common";
import i18next from "i18next";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const deepclone = require("rfdc/default");

export type playerid = 1|2;
export type CellContents = playerid;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents[]>;
    lastmove?: string;
};

export interface IEmergoState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class EmergoGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Emergo",
        uid: "emergo",
        playercounts: [2],
        version: "20251125",
        dateAdded: "2025-11-25",
        // i18next.t("apgames:descriptions.emergo")
        description: "apgames:descriptions.emergo",
        urls: [
            "https://www.mindsports.nl/index.php/arena/emergo/88-rules",
            "https://boardgamegeek.com/boardgame/14438/emergo",
        ],
        people: [
            {
                type: "designer",
                name: "Christian Freeling",
                urls: ["https://www.mindsports.nl/"],
                apid: "b12bd9cd-59cf-49c7-815f-af877e46896a",
            },
            {
                type: "designer",
                name: "Ed van Zon",
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
        categories: ["goal>annihilate", "mechanic>capture", "mechanic>move", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["experimental", "perspective", "automove", "limited-pieces"]
    };

    public static clone(obj: EmergoGame): EmergoGame {
        const cloned = Object.assign(new EmergoGame(), deepclone(obj) as EmergoGame);
        return cloned;
    }

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 9);
    }
    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 9);
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
        return 9;
    }

    constructor(state?: IEmergoState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            this.variants = variants === undefined ? [] : [...variants];
            const board = new Map<string, CellContents[]>();
            const fresh: IMoveState = {
                _version: EmergoGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IEmergoState;
            }
            if (state.game !== EmergoGame.gameinfo.uid) {
                throw new Error(`The Emergo engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): EmergoGame {
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

    public get inhand(): [number,number] {
        let a = 0;
        let b = 0;
        for (const stack of this.board.values()) {
            for (const pc of stack) {
                if (pc === 1) {
                    a++;
                } else {
                    b++;
                }
            }
        }
        return [12 - a, 12 - b];
    }

    private get blackSquares(): string[] {
        const g = new SquareDiagGraph(this.boardsize, this.boardsize);
        const cells: string[] = [];
        for (let row = 0; row < this.boardsize; row++) {
            for (let col = 0; col < this.boardsize; col++) {
                const rowEven = row % 2 === 0;
                const colEven = col % 2 === 0;
                if ( (rowEven && colEven) || (!rowEven && !colEven) ) {
                    cells.push(g.coords2algebraic(col, row));
                }
            }
        }
        return cells;
    }

    private movesFor(cell: string): string[] {
        if (!this.board.has(cell)) {
            throw new Error(`No piece at ${cell}.`);
        }
        const moves: string[] = [];
        const g = new SquareDiagGraph(this.boardsize, this.boardsize);
        const stack = this.board.get(cell)!;
        const owner = stack[stack.length - 1];
        const dirs: DirectionDiagonal[] = ["NE", "NW", "SE", "SW"];

        // captures first
        for (const dir of dirs) {
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
            const cloned = EmergoGame.clone(this);
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

    public moves(player?: playerid, capOnly = false): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const other = player === 1 ? 2 : 1;

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
        // console.log(JSON.stringify({moveSets}));

        let moves: string[] = [];
        // Regardless of pieces in hand, if captures are available, they must be taken.
        if (canCap) {
            this.recurseCaps(moveSets.flat(), moves);
            // get maximum length
            const max = Math.max(...moves.map(mv => mv.length));
            // console.log(JSON.stringify({moves, max}));
            // filter out anything shorter
            moves = moves.filter(mv => mv.length === max);
            // console.log(JSON.stringify({moves}));
        }
        // If no captures, then there are a few different options.
        else {
            const inhand = this.inhand;
            // if this is the first player's first move, anywhere but e5
            if (player === 1 && inhand[0] === 12) {
                moves = this.blackSquares.filter(cell => cell !== "e5");
            }
            // if the player still has pieces in hand, then they must enter
            else if (inhand[player - 1] > 0) {
                // get list of empty cells
                let empties = this.blackSquares.filter(cell => !this.board.has(cell));
                // determine if the opponent must already capture
                const oppMustCap = this.moves(other, true).join(",").includes("x");
                // if feeding is not allowed, filter the empties to where caps do not occur
                if (!oppMustCap) {
                    empties = empties.filter(cell => {
                        const cloned = EmergoGame.clone(this);
                        cloned.board.set(cell, [player]);
                        const causesCap = cloned.moves(other, true).join(",").includes("x");
                        if (causesCap) {
                            return false;
                        }
                        return true;
                    });
                }
                // otherwise we can leave empties alone and they can place anywhere
                // the `move()` function detects and notates the shadowpiece

                moves = [...empties];
            }
            // otherwise go with the list of calculated moves
            else {
                moves = moveSets.flat();
            }
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
            const allMoves = this.moves();
            if (move.length === 0) {
                // if entering, look for empty cells
                if (allMoves[0].length === 2) {
                    if (!this.board.has(cell)) {
                        newmove = cell;
                    }
                }
                // otherwise occupied
                else {
                    if (this.board.has(cell)) {
                        newmove = cell;
                    }
                }
            } else {
                // if entering
                if (allMoves[0].length === 2) {
                    // clicking on an empty cell resets
                    if (!this.board.has(cell)) {
                        newmove = cell;
                    }
                }
                // otherwise
                else {
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
            }

            // autocomplete if possible
            const matches = allMoves.filter(mv => mv.startsWith(newmove));
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

        const allMoves = this.moves();
        const inhand = this.inhand;
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.emergo.INITIAL_INSTRUCTIONS", {context: inhand[this.currplayer - 1] > 0 ? "enter" : "play"});
            return result;
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        m = m.replace(/\*/g, "");

        const cells = m.split(/[-x]/);

        // entry first
        if (cells.length === 1 && allMoves[0].length === 2) {
            const cell = cells[0];
            try {
                this.algebraic2coords(cell)
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                return result;
            }
            if (this.board.has(cell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: cell});
                return result;
            }
            if (!this.blackSquares.includes(cell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.emergo.WHITE_SQUARE");
                return result;
            }
            if (this.currplayer === 1 && inhand[0] === 12 && cell === "e5") {
                result.valid = false;
                result.message = i18next.t("apgames:validation.emergo.FIRST_MOVE");
                return result;
            }
        }
        // otherwise move/capture
        else {
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
        }

        // compare against move list
        if (! allMoves.includes(m)) {
            if (allMoves.filter(mv => mv.startsWith(m)).length > 0) {
                // valid partial
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.emergo.VALID_PARTIAL");
                return result;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.emergo.INVALID_MOVE", {context: inhand[this.currplayer - 1] > 0 ? "enter" : "play"});
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

    public move(m: string, {trusted = false, partial = false} = {}): EmergoGame {
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

        const inhand = this.inhand;
        this.results = [];
        const cells = m.split(/[-x]/);
        // detect entry first
        if (cells.length === 1 && !this.board.has(cells[0])) {
            const other = this.currplayer === 1 ? 2 : 1;
            // if other player has no pieces in hand, place all your remaining pieces
            if (inhand[other - 1] === 0) {
                this.board.set(m, Array.from({length: inhand[this.currplayer - 1]}, () => this.currplayer));
                this.results.push({type: "add", where: m, num: inhand[this.currplayer - 1]});
            }
            // otherwise just place one
            else {
                this.board.set(m, [this.currplayer]);
                this.results.push({type: "add", where: m, num: 1});
            }
        }
        // otherwise movement/capture (partial or otherwise)
        else {
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
        }

        if (partial) { return this; }

        // update currplayer
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

    protected checkEOG(): EmergoGame {
        const otherPlayer: playerid = this.currplayer === 1 ? 2 : 1;
        const inhand = this.inhand.reduce((acc, curr) => acc + curr, 0);

        // otherPlayer wins if current player has no pieces
        if (inhand === 0) {
            const mine = [...this.board.entries()].filter(([,v]) => v[v.length - 1] === this.currplayer).map(([k,]) => k);
            if (mine.length === 0) {
                this.gameover = true;
                this.winner = [otherPlayer];
            }
            // if the current player has pieces but no moves, it's a draw
            else {
                const moves = this.moves();
                if (moves.length === 0) {
                    this.gameover = true;
                    this.winner = [1, 2];
                }
            }
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IEmergoState {
        return {
            game: EmergoGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: EmergoGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: deepclone(this.board),
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
                A: {
                    name: "piece",
                    colour: 1
                },
                B: {
                    name: "piece",
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
                } else if (move.type === "add") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
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
        const inhand = this.inhand;
        if (inhand.reduce((acc, curr) => acc + curr, 0) > 0) {
            status += "**Pieces In Hand**\n\n";
            for (let n = 1; n <= this.numplayers; n++) {
                const pieces = inhand[n - 1];
                status += `Player ${n}: ${pieces}\n\n`;
            }
        }

        return status;
    }

    public getPlayersScores(): IScores[] {
        const inhand = this.inhand;
        if (inhand.reduce((acc, curr) => acc + curr, 0) > 0) {
            return [
                { name: i18next.t("apgames:status.PIECESINHAND"), scores: this.inhand }
            ]
        }
        return [];
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

    // // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // protected getMoveList(): any[] {
    //     return this.getMovesAndResults(["move", "winners", "eog"]);
    // }

    public clone(): EmergoGame {
        return new EmergoGame(this.serialize());
    }
}
