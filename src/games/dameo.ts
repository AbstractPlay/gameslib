import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult, IScores } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { allDirections, RectGrid, reviver, UserFacingError } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-var-requires
const deepclone = require("rfdc/default");

export type playerid = 1|2;
export type Size = 1|2;
export type CellContents = [playerid, Size];

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    lastmove?: string;
    countdown: number;
};

export interface IDameoState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class DameoGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Dameo",
        uid: "dameo",
        playercounts: [2],
        version: "20240219",
        dateAdded: "2024-02-19",
        // i18next.t("apgames:descriptions.dameo")
        description: "apgames:descriptions.dameo",
        urls: [
            "https://mindsports.nl/index.php/arena/dameo/",
            "https://boardgamegeek.com/boardgame/24698/dameo",
        ],
        people: [
            {
                type: "designer",
                name: "Christian Freeling",
            },
        ],
        variants: [
            { uid: "size-10", group: "board" }
        ],
        categories: ["goal>annihilate", "mechanic>capture", "mechanic>differentiate", "mechanic>move>group", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["perspective", "automove", "limited-pieces"]
    };

    public static clone(obj: DameoGame): DameoGame {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        const cloned = Object.assign(new DameoGame(), deepclone(obj) as DameoGame);
        return cloned;
    }

    public coords2algebraic(x: number, y: number): string {
        let boardsize = 8;
        if (this.variants.includes("size-10")) {
            boardsize = 10;
        }
        return GameBase.coords2algebraic(x, y, boardsize);
    }
    public algebraic2coords(cell: string): [number, number] {
        let boardsize = 8;
        if (this.variants.includes("size-10")) {
            boardsize = 10;
        }
        return GameBase.algebraic2coords(cell, boardsize);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, CellContents>;
    public gameover = false;
    public countdown = 0;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private _points: [number, number][] = [];

    public get boardsize(): number {
        if (this.variants.includes("size-10")) {
            return 10;
        }
        return 8;
    }

    constructor(state?: IDameoState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            this.variants = variants === undefined ? [] : [...variants];
            const board = new Map<string, CellContents>();
            const half = this.boardsize / 2;
            for (let deltaRow = 0; deltaRow < half - 1; deltaRow++) {
                for (const row of [0 + deltaRow, this.boardsize - 1 - deltaRow]) {
                    for (let col = deltaRow; col < this.boardsize - deltaRow; col++) {
                        const owner: playerid = row < half ? 2 : 1;
                        const cell = this.coords2algebraic(col, row);
                        board.set(cell, [owner, 1]);
                    }
                }
            }
            const fresh: IMoveState = {
                _version: DameoGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                countdown: 0,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IDameoState;
            }
            if (state.game !== DameoGame.gameinfo.uid) {
                throw new Error(`The Dameo engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): DameoGame {
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
        this.countdown = state.countdown;
        return this;
    }

    // Notation is only movement
    // Captures are not represented in the move notation itself
    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        let forward = "N";
        if (player === 2) {
            forward = "S";
        }

        const moves: string[] = [];

        const men = [...this.board.entries()].filter(([,piece]) => piece[0] === player && piece[1] === 1).map(([cell,]) => cell);
        const kings = [...this.board.entries()].filter(([,piece]) => piece[0] === player && piece[1] === 2).map(([cell,]) => cell);
        const grid = new RectGrid(this.boardsize, this.boardsize);

        // first, find all captures
        const allcaps: string[][] = [];
        // men
        for (const man of men) {
            allcaps.push(...this.allManCaptures(man));
        }
        // kings
        for (const king of kings) {
            allcaps.push(...this.allKingCaptures(king));
        }

        const maxlen = Math.max(...allcaps.map(cap => cap.length));
        if (maxlen > 1) {
            const maxcaps = allcaps.filter(cap => cap.length === maxlen).map(cap => cap.join('-'));
            moves.push(...maxcaps);
        }
        // only calculate movement if there are no captures available
        if (moves.length === 0) {
            for (const man of men) {
                const [fx, fy] = this.algebraic2coords(man);
                for (const dir of allDirections.filter(d => d.startsWith(forward))) {
                    const ray = grid.ray(fx, fy, dir).map(pt => this.coords2algebraic(...pt));
                    // find the first cell that's empty, has a friendly king or is occupied by the enemy
                    const idx = ray.findIndex(n => ! this.board.has(n) || this.board.get(n)![1] === 2 || this.board.get(n)![0] !== player);
                    if (idx !== -1) {
                        const next = ray[idx];
                        if (! this.board.has(next)) {
                            moves.push(`${man}-${next}`);
                        }
                    }
                }
            }
            for (const king of kings) {
                const [fx, fy] = this.algebraic2coords(king);
                for (const dir of allDirections) {
                    const ray = grid.ray(fx, fy, dir).map(pt => this.coords2algebraic(...pt));
                    let empty: string[];
                    // find the first cell that's occupied
                    const idx = ray.findIndex(n => this.board.has(n));
                    if (idx !== -1) {
                        empty = ray.slice(0, idx);
                    } else {
                        empty = [...ray];
                    }
                    for (const next of empty) {
                        moves.push(`${king}-${next}`);
                    }
                }
            }
        }

        return moves.sort();
    }

    public allManCaptures(start: string): string[][] {
        if (! this.board.has(start)) {
            throw new Error(`There's no piece at ${start}, so targets cannot be found.`);
        }
        const [player, size] = this.board.get(start)!;
        if (size !== 1) {
            throw new Error("The buildShortGraphFrom() function should only be used for soldiers.");
        }
        return this.moreManCaptures(player, start, start, []);
    }

    private moreManCaptures(player: number, first: string, start: string, jumped: string[]): string[][] {
        const grid = new RectGrid(this.boardsize, this.boardsize);
        const [x,y] = this.algebraic2coords(start);
        const ret: string[][] = [];
        for (const dir of ["N","E","S","W"] as const) {
            const ray = grid.ray(x, y, dir).map(node => this.coords2algebraic(...node));
            // must be at least two cells in the ray
            if (ray.length >= 2) {
                const adj = ray[0];
                // the adjacent cell must be occupied, opposing, and not previously jumped
                if (this.board.has(adj) && this.board.get(adj)![0] !== player && ! jumped.includes(adj)) {
                    const far = ray[1];
                    // if empty and not already explored, you can move there
                    // and we should explore possible moves from there
                    if (! this.board.has(far) || far === first) {
                        const more = this.moreManCaptures(player, first, far, [...jumped, adj]);
                        ret.push(...more.map(m => [start, ...m]));
                    }
                } // if adjacent occupied by enemy
            } // if ray.length >= 2
        } // foreach dir
        if (ret.length === 0) {
            ret.push([start]);
        }
        return ret;
    }

    public allKingCaptures(start: string): string[][] {
        if (! this.board.has(start)) {
            throw new Error(`There's no piece at ${start}, so targets cannot be found.`);
        }
        const [player, size] = this.board.get(start)!;
        if (size !== 2) {
            throw new Error("The buildAllKingCaptures() function should only be used for kings.");
        }
        return this.moreKingCaptures(player, start, start, []);
    }

    private moreKingCaptures(player: number, first: string, start: string, jumped: string[]): string[][] {
        const grid = new RectGrid(this.boardsize, this.boardsize);
        const ret: string[][] = []
        const [x,y] = this.algebraic2coords(start);
        for (const dir of ["N","E","S","W"] as const) {
            const ray = grid.ray(x, y, dir).map(node => this.coords2algebraic(...node));
            // must be at least two cells in the ray
            if (ray.length >= 2) {
                // find first occupied cell
                const idx = ray.findIndex(n => this.board.has(n));
                if (idx === -1) {
                    continue;
                }
                const adj = ray[idx];
                // the adjacent cell must be opposing and not previously jumped
                if (this.board.get(adj)![0] !== player && ! jumped.includes(adj)) {
                    // get ray of cells after piece
                    let rayAfter = ray.slice(idx+1);
                    // find next occupied cell
                    const idxAfter = rayAfter.findIndex(n => this.board.has(n));
                    if (idxAfter !== -1) {
                        rayAfter = rayAfter.slice(0, idxAfter);
                    }
                    for (const far of rayAfter) {
                        // if empty and not already explored, you can move there
                        // and we should explore possible moves from there
                        if (! this.board.has(far) || far === first) {
                            const more = this.moreKingCaptures(player, first, far, [...jumped, adj]);
                            ret.push(...more.map(m => [start, ...m]));
                        }
                    } // for empty far
                } // if adjacent occupied by enemy
            } // if ray.length >= 2
        } // foreach dir
        if (ret.length === 0) {
            ret.push([start]);
        }
        return ret;
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
            } else {
                // clicking on an occupied cell resets
                if (this.board.has(cell)) {
                    newmove = cell;
                }
                // otherwise, assume movement
                else {
                    newmove = `${move}-${cell}`;
                }
            }

            // autocomplete if possible
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
            result.message = i18next.t("apgames:validation.dameo.INITIAL_INSTRUCTIONS")
            return result;
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        const cells = m.split("-");

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
                const [owner,] = this.board.get(cell)!;
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
                result.message = i18next.t("apgames:validation.dameo.VALID_PARTIAL");
                return result;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.dameo.INVALID_MOVE", {move: m});
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
        const [start,] = partial.split("-");
        if (! this.board.has(start)) {
            return undefined;
        }
        const moves = this.moves().filter(mv => mv.startsWith(`${partial}-`));
        const points: string[] = [];
        for (const m of moves) {
            const remainder = m.substring(`${partial}-`.length);
            const cells = remainder.split("-");
            points.push(cells[0]);
        }
        return points;
    }

    public move(m: string, {trusted = false, partial = false} = {}): DameoGame {
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

        // if partial, set the movement indicator points
        if (partial) {
            const pts = this.findPoints(m);
            if (pts !== undefined) {
                this._points = pts.map(c => this.algebraic2coords(c));
            } else {
                this._points = [];
            }
            // return this;
        // otherwise delete the points and process the full move
        } else {
            this._points = [];
        }

        this.results = [];
        const cells = m.split("-");
        const [,startsize] = this.board.get(cells[0])!;
        for (let i = 1; i < cells.length; i++) {
            const from = cells[i-1];
            const [fx, fy] = this.algebraic2coords(from);
            const to = cells[i];
            const [tx, ty] = this.algebraic2coords(to);
            // move the piece
            const piece = this.board.get(from)!;
            this.board.set(to, [...piece]);
            this.board.delete(from);
            this.results.push({type: "move", from, to});
            // if the in-between cells contain an enemy piece, capture it
            const between = RectGrid.between(fx, fy, tx, ty).map(pt => this.coords2algebraic(...pt));
            let enemy: string|undefined;
            for (const cell of between) {
                if (this.board.has(cell) && this.board.get(cell)![0] !== this.currplayer) {
                    enemy = cell;
                    break;
                }
            }
            if (enemy !== undefined) {
                const [owner, capSize] = this.board.get(enemy)!;
                if (owner !== this.currplayer) {
                    this.board.delete(enemy);
                    this.results.push({type: "capture", where: enemy, what: capSize === 1 ? "soldier" : "king"});
                }
            }
        }

        // check for promotion
        const last = cells[cells.length - 1];
        const [, ly] = this.algebraic2coords(last);
        const [,size] = this.board.get(last)!;
        let farRow = 0;
        if (this.currplayer === 2) {
            farRow = this.boardsize - 1;
        }
        if (ly === farRow && size === 1) {
            this.board.set(last, [this.currplayer, 2]);
            this.results.push({type: "promote", where: last, to: "king"});
        }

        // manage countdown
        if (startsize === 1 || this.results.find(r => r.type === "capture") !== undefined) {
            this.countdown = 0;
        } else {
            this.countdown++;
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

    protected checkEOG(): DameoGame {
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

        // draw if all that remains is 1 king vs 1 king
        const men = [...this.board.entries()].filter(([,piece]) => piece[1] === 1).map(([,piece]) => piece[0]);
        const kings = [...this.board.entries()].filter(([,piece]) => piece[1] === 2).map(([,piece]) => piece[0]);
        if (men.length === 0 && kings.length === 2 && kings.includes(1) && kings.includes(2)) {
            // check to see if next move captures the king
            let capped = false;
            for (const move of moves) {
                const cells = move.split("-");
                const [fx, fy] = this.algebraic2coords(cells[0]);
                const [tx, ty] = this.algebraic2coords(cells[1]);
                capped = RectGrid.between(fx, fy, tx, ty)
                    .map(pt => this.coords2algebraic(...pt))
                    .some(cell => this.board.has(cell) && this.board.get(cell)![0] !== this.currplayer);
                if (capped) {
                    break;
                }
            }
            if (! capped) {
                this.gameover = true;
                this.winner = [1,2];
            }
        }

        // draw if countdown reaches threshold
        if (this.countdown >= 50) {
            this.gameover = true;
            this.winner = [1,2];
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IDameoState {
        return {
            game: DameoGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: DameoGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            countdown: this.countdown,
        };
    }

    public render(): APRenderRep {
        const labels = [["A","B"],["X","Y"]];
        // Build piece string
        let pstr = "";
        for (let row = 0; row < this.boardsize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < this.boardsize; col++) {
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
        if (this.boardsize === 8) {
            pstr = pstr.replace(/-{8}/g, "_");
        } else {
            pstr = pstr.replace(/-{10}/g, "_");
        }

        // Build rep
        const rep: APRenderRep =  {
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
                    name: "piece-chariot",
                    colour: 1
                },
                X: {
                    name: "piece",
                    colour: 2
                },
                Y: {
                    name: "piece-chariot",
                    colour: 2
                },
            },
            pieces: pstr
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
                node.push(i18next.t("apresults:CAPTURE.dameo", {player, where: r.where!, context: r.what!}));
                resolved = true;
                break;
            case "promote":
                node.push(i18next.t("apresults:PROMOTE.basicWhere", {player, where: r.where!}));
                resolved = true;
                break;
        }
        return resolved;
    }

    protected getMoveList(): any[] {
        return this.getMovesAndResults(["move", "winners", "eog"]);
    }

    public getPlayerPieces(player: number): number {
        return [...this.board.values()].filter(p => p[0] === player).length;
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.PIECESREMAINING"), scores: [this.getPlayerPieces(1), this.getPlayerPieces(2)] }
        ]
    }

    public clone(): DameoGame {
        return new DameoGame(this.serialize());
    }
}
