import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { allDirections, RectGrid, reviver, UserFacingError } from "../common";
import { DirectedGraph } from "graphology";
import { allSimplePaths } from "graphology-simple-path";
import i18next from "i18next";

export type playerid = 1|2;
export type Size = 1|2;
export type CellContents = [playerid, Size];

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    lastmove?: string;
};

export interface IHensState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class HensGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Hens and Chicks",
        uid: "hens",
        playercounts: [2],
        version: "20240205",
        // i18next.t("apgames:descriptions.hens")
        description: "apgames:descriptions.hens",
        urls: ["https://crabfragmentlabs.com/verdigris-pawn"],
        people: [
            {
                type: "designer",
                name: "James Ernest",
                urls: ["https://crabfragmentlabs.com/"],
            },
        ],
        variants: [
            { uid: "size-10" }
        ],
        flags: ["multistep", "perspective", "limited-pieces"]
    };

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

    constructor(state?: IHensState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            this.variants = variants === undefined ? [] : [...variants];
            const board = new Map<string, CellContents>();
            for (const row of [0, 1, this.boardsize-1, this.boardsize-2]) {
                let player: playerid = 2;
                if (row > 1) {
                    player = 1;
                }
                for (let col = 0; col < this.boardsize; col++) {
                    const cell = this.coords2algebraic(col, row);
                    if ( (row === 0 || row === this.boardsize - 1) && col !== 0 && col !== this.boardsize - 1) {
                        board.set(cell, [player, 2]);
                    } else {
                        board.set(cell, [player, 1]);
                    }
                }
            }
            const fresh: IMoveState = {
                _version: HensGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IHensState;
            }
            if (state.game !== HensGame.gameinfo.uid) {
                throw new Error(`The Hens and Chicks engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): HensGame {
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

        const chicks = [...this.board.entries()].filter(([,piece]) => piece[0] === player && piece[1] === 1).map(([cell,]) => cell);
        const hens = [...this.board.entries()].filter(([,piece]) => piece[0] === player && piece[1] === 2).map(([cell,]) => cell);

        // first assemble all the jump moves for hens
        for (const hen of hens) {
            const graph = this.buildGraphFrom(hen);
            const paths: string[][] = [];
            for (const node of graph.nodes()) {
                if (node === hen) { continue; }
                paths.push(...allSimplePaths(graph, hen, node).filter(path => path.length <= 3));
            }
            for (const path of paths) {
                moves.push(path.join("-"));
            }
        }

        const grid = new RectGrid(this.boardsize, this.boardsize);
        // then look for simple moves for hens
        for (const hen of hens) {
            const [fx, fy] = this.algebraic2coords(hen);
            for (const dir of allDirections.filter(d => d.startsWith(forward))) {
                let ray = grid.ray(fx, fy, dir).map(pt => this.coords2algebraic(...pt));
                // can only move two spaces
                ray = ray.slice(0, 2);
                if (ray.length > 0) {
                    if (! this.board.has(ray[0])) {
                        moves.push(`${hen}-${ray[0]}`);
                        if ( (ray.length > 1) && (! this.board.has(ray[1])) ) {
                            moves.push(`${hen}-${ray[1]}`);
                        }
                    }
                }
            }
        }

        // then look for simple moves for chicks
        for (const chick of chicks) {
            const [fx, fy] = this.algebraic2coords(chick);
            for (const dir of allDirections.filter(d => d.length === 2 && d.startsWith(forward))) {
                let ray = grid.ray(fx, fy, dir).map(pt => this.coords2algebraic(...pt));
                const idx = ray.findIndex(cell => this.board.has(cell));
                if (idx !== -1) {
                    ray = ray.slice(0, idx);
                }
                for (const cell of ray) {
                    moves.push(`${chick}-${cell}`);
                }
            }
        }

        return moves.sort((a,b) => a.localeCompare(b));
    }

    // build a graph of all legal jumps from a given start location
    public buildGraphFrom(start: string): DirectedGraph {
        if (! this.board.has(start)) {
            throw new Error(`There's no piece at ${start}, so targets cannot be found.`);
        }
        const [player,] = this.board.get(start)!;
        let forward = "N";
        if (player === 2) {
            forward = "S";
        }

        const grid = new RectGrid(this.boardsize, this.boardsize);
        const graph = new DirectedGraph();
        graph.addNode(start);
        const toVisit = [start];
        const visited = new Set<string>();
        while (toVisit.length > 0) {
            const cell = toVisit.pop()!;
            if (visited.has(cell)) { continue; }
            visited.add(cell);
            const [x,y] = this.algebraic2coords(cell);
            for (const dir of allDirections.filter(d => d.startsWith(forward))) {
                const ray = grid.ray(x, y, dir).map(node => this.coords2algebraic(...node));
                // must be at least two cells in the ray
                if (ray.length >= 2) {
                    const adj = ray[0];
                    // the adjacent cell must be occupied
                    if (this.board.has(adj)) {
                        const far = ray[1];
                        // if empty and not already explored, you can move there
                        // and we should explore possible moves from there
                        if (! this.board.has(far)) {
                            if (! graph.hasNode(far)) {
                                graph.addNode(far);
                            }
                            graph.addDirectedEdge(cell, far);
                            toVisit.push(far);
                        }
                    }
                } // if ray.length >= 2
            } // foreach dir
        }
        return graph;
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
                if (! this.board.has(cell)) {
                    return {move: "", message: i18next.t("apgames:validation.hens.INITIAL_INSTRUCTIONS")} as IClickResult;
                } else {
                    const [owner,] = this.board.get(cell)!;
                    if (owner !== this.currplayer) {
                        return {move: "", message: i18next.t("apgames:validation.hens.INITIAL_INSTRUCTIONS")} as IClickResult;
                    }
                    newmove = cell;
                }
            } else {
                // clicking on an occupied cell resets
                if (this.board.has(cell)) {
                    newmove = cell;
                }
                // otherwise, assume movement
                else {
                    const [start,] = move.split("-");
                    if (this.board.has(start)) {
                        const [, size] = this.board.get(start)!;
                        // if it's a hen, just append the new cell
                        if (size === 2) {
                            newmove = `${move}-${cell}`;
                        }
                        // otherwise, just change the TO portion
                        else {
                            newmove = `${start}-${cell}`;
                        }
                    }
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
            result.message = i18next.t("apgames:validation.hens.INITIAL_INSTRUCTIONS")
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
                if (this.board.has(cell)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.MOVE4CAPTURE", {where: cell});
                    return result;
                }
            }
        }

        if (cells.length > 1) {
            const start = cells[0];
            const [owner, size] = this.board.get(start)!;

            // only hens can make multiple jumps
            if ( (cells.length > 2) && (size !== 2) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.hens.ONLY_HENS");
                return result;
            }

            for (let i = 1; i < cells.length; i++) {
                const from = cells[i-1];
                const [fx, fy] = this.algebraic2coords(from);
                const to = cells[i];
                const [tx, ty] = this.algebraic2coords(to);

                // moving in correct direction
                let forward = "N";
                if (owner === 2) {
                    forward = "S";
                }
                const bearing = RectGrid.bearing(fx, fy, tx, ty);
                if (! bearing?.startsWith(forward)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.hens.ONLY_FORWARD");
                    return result;
                }

                let between: string[];
                try {
                    between = RectGrid.between(fx, fy, tx, ty).map(pt => this.coords2algebraic(...pt));
                } catch {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.hens.STRAIGHT_LINES");
                    return result;
                }

                // if it's a hen jump
                if (size === 2 && between.length === 1 && this.board.has(between[0])) {
                    // totally valid move; skip ahead
                    continue;
                }
                // all other simple movement
                else {
                    // no obstructions
                    for (const cell of between) {
                        if (this.board.has(cell)) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation._general.OBSTRUCTED", {from, to, obstruction: cell});
                            return result;
                        }
                    }
                    // hens can only move up to two spaces
                    if (size === 2 && RectGrid.distance(fx, fy, tx, ty) > 2) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.hens.ONLY_TWO");
                        return result;
                    }
                    // chicks can only move diagonally
                    if (size === 1 && ! RectGrid.isDiag(fx, fy, tx, ty)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.hens.ONLY_DIAG");
                        return result;
                    }
                }
            }
        } else {
            // valid partial
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.hens.VALID_PARTIAL");
            return result;
        }

        // final check for weird moves like moving then jumping
        const allMoves = this.moves();
        if (! allMoves.includes(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
            return result;
        }

        // Looks good
        result.valid = true;
        result.complete = 0;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        const longerMoves = allMoves.filter(mv => mv.startsWith(m) && mv !== m);
        if (longerMoves.length === 0) {
            result.complete = 1;
        }
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

    public move(m: string, {trusted = false, partial = false} = {}): HensGame {
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
        const grid = new RectGrid(this.boardsize, this.boardsize);
        const cells = m.split("-");
        const [,size] = this.board.get(cells[0])!
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
            // if it's a hen, check for jump
            if (size === 2) {
                const between = RectGrid.between(fx, fy, tx, ty).map(pt => this.coords2algebraic(...pt));
                if (between.length === 1 && this.board.has(between[0])) {
                    const [owner, capSize] = this.board.get(between[0])!;
                    if (owner !== this.currplayer) {
                        this.board.delete(between[0]);
                        this.results.push({type: "capture", where: between[0], what: capSize === 1 ? "chick" : "hen"});
                    }
                }
            }
            // otherwise, check for pins
            else {
                // get cell to east and west
                let east: string|undefined;
                let west: string|undefined;
                if (tx + 1 < this.boardsize) {
                    east = this.coords2algebraic(tx + 1, ty);
                }
                if (tx - 1 >= 0) {
                    west = this.coords2algebraic(tx - 1, ty);
                }
                // determine if either or both are occupied by enemies
                let pinEast = false;
                let pinWest = false;
                if (east !== undefined && this.board.has(east)) {
                    const [capOwner,] = this.board.get(east)!;
                    if (capOwner !== this.currplayer) {
                        pinEast = true;
                    }
                }
                if (west !== undefined && this.board.has(west)) {
                    const [capOwner,] = this.board.get(west)!;
                    if (capOwner !== this.currplayer) {
                        pinWest = true;
                    }
                }
                // XOR equivalent: Captures can only happen if only one of the
                // directions can be captured.
                if (pinEast !== pinWest) {
                    const pinned = pinEast ? east! : west!;
                    const [px, py] = this.algebraic2coords(pinned);
                    const [,capSize] = this.board.get(pinned)!;
                    // hens can only be captured with at least two pieces
                    if (capSize === 2) {
                        const neighbours = grid.adjacencies(px, py, false).map(pt => this.coords2algebraic(...pt));
                        let count = 0;
                        for (const n of neighbours) {
                            if (this.board.has(n)) {
                                const [capOwner,] = this.board.get(n)!;
                                if (capOwner === this.currplayer) {
                                    count++;
                                }
                            }
                        }
                        if (count >= 2) {
                            this.results.push({type: "capture", where: pinned, what: "hen"});
                            this.board.delete(pinned);
                        }
                    }
                    // chicks just get captured
                    else {
                        this.results.push({type: "capture", where: pinned, what: "chick"});
                        this.board.delete(pinned);
                    }
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

    protected checkEOG(): HensGame {
        let otherPlayer: playerid = 1;
        if (this.currplayer === 1) {
            otherPlayer = 2;
        }

        // otherPlayer wins if they are on opposing front row
        let target = 0;
        if (otherPlayer === 2) {
            target = this.boardsize - 1;
        }
        const onTarget = [...this.board.entries()].filter(([, [owner, ]]) => owner === otherPlayer).map(([cell,]) => this.algebraic2coords(cell)).filter(([,y]) => y === target);
        if (onTarget.length > 0) {
            this.gameover = true;
            this.winner = [otherPlayer];
        }

        // currplayer loses if they have no hens left
        if (! this.gameover) {
            const hens = [...this.board.values()].filter(([owner, size]) => owner === this.currplayer && size === 2);
            if (hens.length === 0) {
                this.gameover = true;
                this.winner = [otherPlayer];
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

    public state(): IHensState {
        return {
            game: HensGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: HensGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
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
                markers: [
                    {
                        type: "edge",
                        edge: "N",
                        colour: 2,
                    },
                    {
                        type: "edge",
                        edge: "S",
                        colour: 1,
                    },
                ]
            },
            legend: {
                A: {
                    name: "piece",
                    player: 1
                },
                B: {
                    name: "piece-chariot",
                    player: 1
                },
                X: {
                    name: "piece",
                    player: 2
                },
                Y: {
                    name: "piece-chariot",
                    player: 2
                },
            },
            pieces: pstr
        };

        // Add annotations
        if ( (this.stack[this.stack.length - 1]._results.length > 0) || (this._points.length > 0) ) {
            // @ts-ignore
            rep.annotations = [];

            if (this._points.length > 0) {
                const points = [];
                for (const cell of this._points) {
                    points.push({row: cell[1], col: cell[0]});
                }
                // @ts-ignore
                rep.annotations.push({type: "dots", targets: points});
            }

            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = this.algebraic2coords(move.from);
                    const [toX, toY] = this.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "capture") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }

        return rep;
    }

    public getPlayerPieces(player: number): number {
        return [...this.board.values()].filter(([owner,]) => owner === player).length;
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.PIECESREMAINING"), scores: [this.getPlayerPieces(1), this.getPlayerPieces(2)] }
        ]
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Pieces On Board:**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            status += `Player ${n}: ${this.getPlayerPieces(n)}\n\n`;
        }

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.hens", {player, where: r.where!, context: r.what!}));
                resolved = true;
                break;
        }
        return resolved;
    }

    protected getMoveList(): any[] {
        return this.getMovesAndResults(["move", "winners", "eog"]);
    }

    public clone(): HensGame {
        return new HensGame(this.serialize());
    }
}
