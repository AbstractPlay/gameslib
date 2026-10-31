import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult, type ChatLogCollectContext, type ChatLogLine } from "./_base.js";
import { APGamesInformation } from "../schemas/gameinfo.js";
import { APRenderRep, RowCol } from "@abstractplay/renderer/build/schemas/schema";
import { APMoveResult } from "../schemas/moveresults.js";
import { reviver, UserFacingError } from "../common/index.js";
import i18next from "i18next";
export const gameApgamesEn = {
    validation: {
        INITIAL_INSTRUCTIONS: "Place a stone on an empty point. A point vital to your opponent is only allowed if it is also vital to you, or if your placement completes your connection.",
        INVALIDCELL: "The point {{cell}} does not exist.",
        OCCUPIED: "The point {{where}} is already occupied.",
        VITAL: "You may not place a stone on {{where}}. It is vital to your opponent but not to you, and a stone there would not complete your connection.",
        NO_PASS: "You may not pass while you have a legal placement.",
        MUST_PASS: "You have no legal placement. Your turn is skipped.",
    },
    variants: {
        "size-7": {
            name: "7x7 board",
        },
        "#board": {
            name: "9x9 board",
        },
        "size-11": {
            name: "11x11 board",
        },
        "size-13": {
            name: "13x13 board",
        },
        "size-15": {
            name: "15x15 board",
        },
        "size-19": {
            name: "19x19 board",
        },
    },
};

export const gameApresultsEn = {
    EOG: {
        cutoff: "{{player}} no longer has any possible connecting path.",
    },
};

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
}

export interface IClearPathState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
}

/*
 * Rule helpers.
 *
 * These work on a flat array of cells: 0 = empty, 1 = red stone, 2 = blue stone.
 * A point (x, y) has index y * width + x, with y = 0 being the top row.
 * Red (player 1) connects the top row to the bottom row.
 * Blue (player 2) connects the left column to the right column.
 *
 * They are exported so that they can be tested directly, but the game class
 * is the only consumer inside the library.
 */

/**
 * Is there a chain of orthogonally adjacent points joining the two edges of
 * `player`, using only points that hold a stone of `player` and, when
 * `allowEmpty` is set, empty points?  The point `blocked` (if any) may not be used.
 */
export function cpConnects(cells: Uint8Array, width: number, height: number, player: playerid, allowEmpty: boolean, blocked = -1): boolean {
    const size = width * height;
    const usable = (idx: number): boolean => {
        if (idx === blocked) { return false; }
        const c = cells[idx];
        return c === player || (allowEmpty && c === 0);
    };
    const visited = new Uint8Array(size);
    const queue = new Int32Array(size);
    let head = 0;
    let tail = 0;
    // seed the search with the player's first edge
    if (player === 1) {
        for (let x = 0; x < width; x++) {
            if (usable(x)) { visited[x] = 1; queue[tail++] = x; }
        }
    } else {
        for (let y = 0; y < height; y++) {
            const idx = y * width;
            if (usable(idx)) { visited[idx] = 1; queue[tail++] = idx; }
        }
    }
    while (head < tail) {
        const idx = queue[head++];
        const x = idx % width;
        const y = (idx - x) / width;
        if (player === 1) {
            if (y === height - 1) { return true; }
        } else {
            if (x === width - 1) { return true; }
        }
        // orthogonal neighbours
        if (x > 0) {
            const n = idx - 1;
            if (visited[n] === 0 && usable(n)) { visited[n] = 1; queue[tail++] = n; }
        }
        if (x < width - 1) {
            const n = idx + 1;
            if (visited[n] === 0 && usable(n)) { visited[n] = 1; queue[tail++] = n; }
        }
        if (y > 0) {
            const n = idx - width;
            if (visited[n] === 0 && usable(n)) { visited[n] = 1; queue[tail++] = n; }
        }
        if (y < height - 1) {
            const n = idx + width;
            if (visited[n] === 0 && usable(n)) { visited[n] = 1; queue[tail++] = n; }
        }
    }
    return false;
}

/**
 * Does `player` have a winning path, that is, a chain of their own stones
 * joining their two edges?
 */
export function cpHasWinningPath(cells: Uint8Array, width: number, height: number, player: playerid): boolean {
    return cpConnects(cells, width, height, player, false);
}

/**
 * A chain of `player`'s stones joining the two edges of `player`, as a list
 * of point indices from one edge to the other, or an empty list if there is
 * none.  With `diagonal` unset the chain is orthogonally connected (a
 * winning path).  With `diagonal` set the chain may also step diagonally.
 * Such a chain exists exactly when the opponent has no possible connecting
 * path: it is the chain that cuts the opponent off.
 */
export function cpEdgeChain(cells: Uint8Array, width: number, height: number, player: playerid, diagonal: boolean): number[] {
    const boardCells = width * height;
    const parent = new Int32Array(boardCells).fill(-2); // -2 = unvisited, -1 = start
    const queue = new Int32Array(boardCells);
    let head = 0;
    let tail = 0;
    if (player === 1) {
        for (let x = 0; x < width; x++) {
            if (cells[x] === player) { parent[x] = -1; queue[tail++] = x; }
        }
    } else {
        for (let y = 0; y < height; y++) {
            const idx = y * width;
            if (cells[idx] === player) { parent[idx] = -1; queue[tail++] = idx; }
        }
    }
    while (head < tail) {
        const idx = queue[head++];
        const x = idx % width;
        const y = (idx - x) / width;
        if ((player === 1 && y === height - 1) || (player === 2 && x === width - 1)) {
            const chain: number[] = [];
            for (let cur = idx; cur !== -1; cur = parent[cur]) {
                chain.push(cur);
            }
            return chain.reverse();
        }
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) { continue; }
                if (!diagonal && dx !== 0 && dy !== 0) { continue; }
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= width || ny >= height) { continue; }
                const nidx = ny * width + nx;
                if (parent[nidx] === -2 && cells[nidx] === player) {
                    parent[nidx] = idx;
                    queue[tail++] = nidx;
                }
            }
        }
    }
    return [];
}

/**
 * The vital points of `player`: a mask (1 = vital) over all points.
 * An empty point is vital to a player if every possible connecting path for
 * that player passes through it.  A player with no possible connecting path
 * has no vital points.
 */
export function cpVitalPoints(cells: Uint8Array, width: number, height: number, player: playerid): Uint8Array {
    const size = width * height;
    const vital = new Uint8Array(size);
    if (!cpConnects(cells, width, height, player, true)) {
        return vital;
    }
    for (let idx = 0; idx < size; idx++) {
        if (cells[idx] !== 0) { continue; }
        if (!cpConnects(cells, width, height, player, true, idx)) {
            vital[idx] = 1;
        }
    }
    return vital;
}

/**
 * Would placing a stone of `player` on the empty point `idx` complete a winning path?
 */
export function cpWinsAt(cells: Uint8Array, width: number, height: number, player: playerid, idx: number): boolean {
    if (cells[idx] !== 0) { return false; }
    cells[idx] = player;
    const wins = cpConnects(cells, width, height, player, false);
    cells[idx] = 0;
    return wins;
}

/**
 * The legal placements of `player`: a mask (1 = legal) over all points.
 * A placement on an empty point is legal unless the point is vital to the
 * opponent and not vital to the player, and the placement does not form a
 * winning path for the player.
 */
export function cpLegalPlacements(cells: Uint8Array, width: number, height: number, player: playerid): Uint8Array {
    const size = width * height;
    const opponent: playerid = player === 1 ? 2 : 1;
    const vitalOpp = cpVitalPoints(cells, width, height, opponent);
    const vitalOwn = cpVitalPoints(cells, width, height, player);
    const legal = new Uint8Array(size);
    for (let idx = 0; idx < size; idx++) {
        if (cells[idx] !== 0) { continue; }
        if (vitalOpp[idx] === 0 || vitalOwn[idx] === 1 || cpWinsAt(cells, width, height, player, idx)) {
            legal[idx] = 1;
        }
    }
    return legal;
}

export class ClearPathGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Clear Path",
        uid: "clearpath",
        playercounts: [2],
        version: "20261014",
        dateAdded: "2026-09-10",
        description: "An orthogonal connection game on the points of a square grid. Red connects the top and bottom edges, Blue the left and right edges, with a chain of orthogonally adjacent stones. Each turn you place one stone. A point is vital to a player if every possible connection of theirs passes through it. You may not place on a point vital to your opponent unless it is also vital to you, or your placement completes your connection. Crosscuts are allowed.",
        notes: "Clear Path was designed by Mark Steere in September 2026, in collaboration with Claude Fable 5.1, an AI model made by Anthropic.\n\nThe dots mark the points where the player to move may not place. Each dotted point is vital to the opponent (every possible connection of the opponent passes through it), not vital to the player to move, and not a winning placement. A point vital to both players is not dotted, since either player may take it, and neither is a point where the player to move completes a winning path. The dots are drawn in the opponent's colour. A player who no longer has any possible connection has no vital points.\n\nA placement that leaves the opponent without any possible connecting path ends the game at once, and the player who placed wins: the opponent can never connect and can never take the winner's vital points, so the winner's connection can no longer be stopped. The chain of stones that cuts the opponent off is drawn on the board, as is a completed winning path.\n\nPassing is not allowed, but a player with no legal placement has their turn skipped. The pass is submitted automatically.",
        urls: [
            "https://www.marksteeregames.com/Clear_Path_rules.pdf",
            "https://www.marksteeregames.com",
        ],
        people: [
            {
                type: "designer",
                name: "Mark Steere",
                urls: ["https://www.marksteeregames.com"],
            },
            {
                type: "coder",
                name: "Claude Fable 5.1 (Anthropic)",
            },
        ],
        variants: [
            { uid: "size-7", group: "board" },
            { uid: "#board" },
            { uid: "size-11", group: "board" },
            { uid: "size-13", group: "board" },
            { uid: "size-15", group: "board" },
            { uid: "size-19", group: "board" },
        ],
        categories: ["goal>connect", "mechanic>place", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["pie", "autopass", "experimental"],
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public boardsize = 9;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IClearPathState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = this.applyVariantConstraints(variants);
            }
            const board = new Map<string, playerid>();
            const fresh: IMoveState = {
                _version: ClearPathGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IClearPathState;
            }
            if (state.game !== ClearPathGame.gameinfo.uid) {
                throw new Error(`The Clear Path engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): ClearPathGame {
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
        this.results = [...state._results];
        this.boardsize = this.getBoardSize();
        return this;
    }

    private getBoardSize(): number {
        if (this.variants !== undefined && this.variants.length > 0) {
            const sizeVariant = this.variants.find(v => v.startsWith("size-"));
            if (sizeVariant !== undefined) {
                const size = parseInt(sizeVariant.slice(5), 10);
                if (!isNaN(size) && size > 1) {
                    return size;
                }
            }
        }
        return 9;
    }

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardsize);
    }

    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardsize);
    }

    private idx2cell(idx: number): string {
        const x = idx % this.boardsize;
        const y = (idx - x) / this.boardsize;
        return this.coords2algebraic(x, y);
    }

    private cell2idx(cell: string): number {
        const [x, y] = this.algebraic2coords(cell);
        return y * this.boardsize + x;
    }

    /** The board as a flat array of cells for the rule helpers. */
    private toCells(): Uint8Array {
        const cells = new Uint8Array(this.boardsize * this.boardsize);
        for (const [cell, contents] of this.board) {
            cells[this.cell2idx(cell)] = contents;
        }
        return cells;
    }

    /** All legal placements of `player` on the current board, in algebraic notation. */
    private legalPlacements(player: playerid): string[] {
        const n = this.boardsize;
        const legal = cpLegalPlacements(this.toCells(), n, n, player);
        const cells: string[] = [];
        for (let idx = 0; idx < legal.length; idx++) {
            if (legal[idx] === 1) {
                cells.push(this.idx2cell(idx));
            }
        }
        return cells;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves = this.legalPlacements(player);
        if (moves.length === 0) {
            // Passing is not allowed, but a player with no available
            // placement has their turn skipped.  The `autopass` flag
            // makes the front end submit this pass automatically.
            return ["pass"];
        }
        return moves.sort((a, b) => a.localeCompare(b));
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            const newmove = cell;
            const result = this.validateMove(newmove) as IClickResult;
            if (! result.valid) {
                result.move = "";
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

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.clearpath.INITIAL_INSTRUCTIONS");
            return result;
        }

        const legal = this.legalPlacements(this.currplayer);

        if (m === "pass") {
            if (legal.length > 0) {
                result.message = i18next.t("apgames:validation.clearpath.NO_PASS");
                return result;
            }
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        // valid cell
        try {
            const [x, y] = this.algebraic2coords(m);
            if (x < 0 || y < 0 || x >= this.boardsize || y >= this.boardsize) {
                throw new Error("off board");
            }
        } catch {
            result.message = i18next.t("apgames:validation.clearpath.INVALIDCELL", {cell: m});
            return result;
        }

        // is empty
        if (this.board.has(m)) {
            result.message = i18next.t("apgames:validation.clearpath.OCCUPIED", {where: m});
            return result;
        }

        // is not a point vital to the opponent only
        if (!legal.includes(m)) {
            if (legal.length === 0) {
                result.message = i18next.t("apgames:validation.clearpath.MUST_PASS");
            } else {
                result.message = i18next.t("apgames:validation.clearpath.VITAL", {where: m});
            }
            return result;
        }

        // Looks good
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {trusted = false} = {}): ClearPathGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:validation._general.MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (! this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];
        if (m === "pass") {
            this.results.push({type: "pass"});
        } else {
            this.board.set(m, this.currplayer);
            this.results.push({type: "place", where: m});
        }

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

    protected checkEOG(): ClearPathGame {
        // the player who just moved
        const prev: playerid = this.currplayer === 1 ? 2 : 1;
        const n = this.boardsize;
        const cells = this.toCells();
        if (cpHasWinningPath(cells, n, n, prev)) {
            this.gameover = true;
            this.winner = [prev];
        } else if (!cpConnects(cells, n, n, this.currplayer, true)) {
            // The placement left the opponent without any possible
            // connecting path.  The opponent can never connect, and can
            // never take a point vital to the placer (a cut-off player has
            // no vital points of their own and no winning placement), so
            // the placer's connection can no longer be stopped.  The game
            // ends here instead of playing out the forced finish.
            this.gameover = true;
            this.winner = [prev];
            this.results.push({type: "eog", reason: "cutoff"});
        } else if (this.board.size === n * n) {
            // Under the rules this cannot happen (the board never fills
            // without a winning path being formed), but the game must
            // still be able to finish if it ever did.  Treat it as a draw.
            this.gameover = true;
            this.winner = [1, 2];
        } else if (cpLegalPlacements(cells, n, n, 1).every(v => v === 0) && cpLegalPlacements(cells, n, n, 2).every(v => v === 0)) {
            // Likewise impossible under the rules (at least one player
            // always has a legal placement).  Defensive only.
            this.gameover = true;
            this.winner = [1, 2];
        }
        if (this.gameover) {
            if (!this.results.some(r => r.type === "eog")) {
                this.results.push({type: "eog"});
            }
            this.results.push({type: "winners", players: [...this.winner]});
        }
        return this;
    }

    protected eogChatLineOverride(r: Extract<APMoveResult, { type: "eog" }>, ctx: ChatLogCollectContext): ChatLogLine | undefined {
        if (r.reason === "cutoff") {
            const loser = this.resolveChatPlayerName(ctx.currplayer, ctx.players);
            return {
                actor: { kind: "none" },
                textKey: "apresults:clearpath.EOG.cutoff",
                textParams: { player: loser },
            };
        }
        return undefined;
    }

    public isPieTurn(): boolean {
        return this.stack.length === 2;
    }

    public state(): IClearPathState {
        return {
            game: ClearPathGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: ClearPathGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    public render(): APRenderRep {
        const n = this.boardsize;
        // Build piece string
        const pstr: string[] = [];
        for (let row = 0; row < n; row++) {
            let line = "";
            for (let col = 0; col < n; col++) {
                const cell = this.coords2algebraic(col, row);
                const contents = this.board.get(cell);
                if (contents === 1) {
                    line += "A";
                } else if (contents === 2) {
                    line += "B";
                } else {
                    line += "-";
                }
            }
            if (line === "-".repeat(n)) {
                line = "_";
            }
            pstr.push(line);
        }

        // Mark the points where the player to move may not place: every
        // empty point that is vital to the opponent, not vital to the mover,
        // and not a winning placement for the mover.  The dots are drawn in
        // the opponent's colour, since they are the opponent's vital points.
        // A point vital to both players gets no dot (either player may take
        // it), nor does a winning placement.  Nothing is marked once the
        // game is over.
        const illegal: RowCol[] = [];
        const opponent: playerid = this.currplayer === 1 ? 2 : 1;
        if (!this.gameover) {
            const cells = this.toCells();
            const legal = cpLegalPlacements(cells, n, n, this.currplayer);
            for (let idx = 0; idx < cells.length; idx++) {
                if (cells[idx] === 0 && legal[idx] === 0) {
                    const x = idx % n;
                    const y = (idx - x) / n;
                    illegal.push({row: y, col: x});
                }
            }
        }

        // Build rep
        const rep: APRenderRep =  {
            options: ["hide-star-points"],
            board: {
                style: "vertex",
                width: n,
                height: n,
                markers: [
                    { type: "edge", edge: "N", colour: 1 },
                    { type: "edge", edge: "S", colour: 1 },
                    { type: "edge", edge: "E", colour: 2 },
                    { type: "edge", edge: "W", colour: 2 },
                    ...(illegal.length > 0 ? [{ type: "dots" as const, colour: opponent, size: 0.35, points: illegal as [RowCol, ...RowCol[]] }] : []),
                ],
            },
            legend: {
                A: { name: "piece", colour: 1 },
                B: { name: "piece", colour: 2 },
            },
            pieces: pstr.join("\n"),
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
            if (rep.annotations.length === 0) {
                delete rep.annotations;
            }
        }

        // When the game is over, draw the winner's decisive chain: the
        // winning path, or, after a cut-off, the chain of stones (diagonal
        // steps allowed) that leaves the loser without any possible
        // connecting path.
        if (this.gameover && this.winner.length === 1) {
            const cells = this.toCells();
            const winner = this.winner[0];
            let chain = cpEdgeChain(cells, n, n, winner, false);
            if (chain.length === 0) {
                chain = cpEdgeChain(cells, n, n, winner, true);
            }
            if (chain.length > 1) {
                const targets = chain.map(idx => {
                    const x = idx % n;
                    return {row: (idx - x) / n, col: x};
                });
                if (rep.annotations === undefined) {
                    rep.annotations = [];
                }
                rep.annotations.push({type: "move", targets: targets as [RowCol, ...RowCol[]], arrow: false});
            }
        }

        return rep;
    }

    public clone(): ClearPathGame {
        return new ClearPathGame(this.serialize());
    }
}

