import { GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { HexTriGraph, RectGrid, reviver, UserFacingError } from "../common";
import i18next from "i18next";

type playerid = 1 | 2;

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
    pieceCounts: [number, number];
}

export interface IOustState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class OustGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Oust",
        uid: "oust",
        playercounts: [2],
        version: "20240505",
        dateAdded: "2024-05-13",
        // i18next.t("apgames:descriptions.oust")
        description: "apgames:descriptions.oust",
        urls: ["https://www.marksteeregames.com/Oust_rules.pdf"],
        people: [
            {
                type: "designer",
                name: "Mark Steere",
                urls: ["http://www.marksteeregames.com/"],
            }
        ],
        variants: [
            { uid: "hex-6", group: "board" },
            { uid: "hex-8", group: "board" },
            { uid: "square-11", group: "board" },
        ],
        categories: ["goal>annihilate", "mechanic>place", "board>shape>hex", "board>shape>rect", "board>shape>hex", "board>connect>rect", "components>simple>1per"],
        flags: ["scores", "multistep", "no-moves", "custom-randomization"],
        displays: [{uid: "hide-moves"}],
    };

    public coords2algebraic(x: number, y: number): string {
        if (this.geometry === "hex") {
            return this.hexTriGraph!.coords2algebraic(x, y);
        }
        return GameBase.coords2algebraic(x, y, this.boardSize);
    }
    public algebraic2coords(cell: string): [number, number] {
        if (this.geometry === "hex") {
            return this.hexTriGraph!.algebraic2coords(cell);
        }
        return GameBase.algebraic2coords(cell, this.boardSize);
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    public pieceCounts: [number, number] = [0, 0];
    private rectGrid: RectGrid | undefined;
    private hexTriGraph: HexTriGraph | undefined;
    private boardSize = 0;
    private geometry: "hex" | "square";

    constructor(state?: IOustState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: OustGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                pieceCounts: [0, 0],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IOustState;
            }
            if (state.game !== OustGame.gameinfo.uid) {
                throw new Error(`The Oust game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
        this.boardSize = this.getBoardSize();
        this.geometry = this.variants.some(x => x.includes("square")) ? "square" : "hex";
        this.rectGrid = this.getGrid();
        this.hexTriGraph = this.getHexTriGraph();
    }

    public load(idx = -1): OustGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        if (state === undefined) {
            throw new Error(`Could not load state index ${idx}`);
        }
        this.results = [...state._results];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.lastmove = state.lastmove;
        this.pieceCounts = [...state.pieceCounts];
        return this;
    }

    protected getBoardSize(): number {
        // Get board size from variants.
        if (this.variants !== undefined && this.variants.length > 0 && this.variants[0] !== undefined && this.variants[0].length > 0) {
            const sizeVariants = this.variants.filter(v => v.includes("hex") || v.includes("square"))
            if (sizeVariants.length > 0) {
                const size = sizeVariants[0].match(/\d+/);
                return parseInt(size![0], 10);
            }
            if (isNaN(this.boardSize)) {
                throw new Error(`Could not determine the board size from variant "${this.variants[0]}"`);
            }
        }
        return 7;
    }

    private getGrid(): RectGrid | undefined {
        // If it's a square board, return the grid. Else it's undefined.
        if (this.geometry === "square") {
            return new RectGrid(this.boardSize, this.boardSize);
        }
        return undefined;
    }

    private getHexTriGraph(): HexTriGraph | undefined {
        // If it's a hex board, return the graph. Else it's undefined.
        if (this.geometry === "hex") {
            return new HexTriGraph(this.boardSize, this.boardSize * 2 - 1);
        }
        return undefined;
    }

    public moves(player?: 1|2): string[] {
        // Move generation is disabled for this game, this function will never be called.
        // In the event that we remove the "no-moves" flag, this game will still work.
        // It will just put a placeholder item in the move list.
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves = ["No movelist"]
        if (!this.hasMoves(player)) {
            moves.push("pass");
        }
        return moves;
    }

    private hasMoves(player: playerid): boolean {
        // Check if a player has any moves left.
        for (const cell of this.allCells()) {
            if (this.board.has(cell)) { continue; }
            if (this.canPlace(cell, player, [], [])[0]) {
                return true;
            }
        }
        return false;
    }

    private legalPlacements(player: playerid, placed: string[], captured: string[][]): string[] {
        // Check if a player has any moves left.
        const cells: string[] = [];
        for (const cell of this.allCells()) {
            if (this.board.has(cell)) { continue; }
            if (this.canPlace(cell, player, placed, captured)[0]) {
                cells.push(cell);
            }
        }
        return cells;
    }

    private followupsFrom(place: string, player: playerid, placed: string[] = [], captured: string[][] = [], capturedCount: number | undefined = undefined): string[][] {
        // Get all follow-up moves after a placement.
        const followups: string[][] = [];
        const [canPlace, captures] = this.canPlace(place, player, placed, captured);
        if (!canPlace) { return followups; }
        const newPlaced = [...placed, place];
        if (captures === undefined) { return [newPlaced]; }
        const newCapturedCount = (capturedCount ?? captured.reduce((acc, val) => acc + val.length, 0)) + captures.reduce((acc, val) => acc + val.length, 0);
        if (newCapturedCount === this.pieceCounts[player % 2]) { return [newPlaced]; }
        const newCaptured = [...captured, ...captures];
        for (const cell of this.allCells()) {
            if (cell === place) { continue; }
            if (this.board.has(cell) && !newCaptured.some(x => x.includes(cell))) { continue; }
            if (placed.includes(cell)) { continue; }
            followups.push(...this.followupsFrom(cell, player, newPlaced, newCaptured, newCapturedCount));
        }
        return followups;
    }

    private allCells(): string[] {
        // Get all cells on the board.
        if (this.geometry === "hex") {
            return this.hexTriGraph!.listCells(false) as string[];
        }
        const cells: string[] = [];
        for (let row = 0; row < this.boardSize; row++) {
            for (let col = 0; col < this.boardSize; col++) {
                cells.push(this.coords2algebraic(col, row));
            }
        }
        return cells;
    }

    private getNeighbours(cell: string): string[] {
        // Get all neighbours of a cell.
        if (this.geometry === "hex") {
            return this.hexTriGraph!.neighbours(cell);
        }
        return this.rectGrid!.adjacencies(...this.algebraic2coords(cell), false).map(x => this.coords2algebraic(...x));
    }

    private canPlace(place: string, player: playerid, placed: string[], captured: string[][]): [boolean, string[][] | undefined] {
        // Check if a player can place a piece at a cell.
        // If there is a capture, return the captured pieces.
        const neighbours = this.getNeighbours(place);
        const seenSelfs: string[] = [];
        const seenOpps: string[] = [];
        for (const cell of neighbours) {
            if (placed.includes(cell)) {
                seenSelfs.push(cell);
            } else {
                if (this.board.has(cell)) {
                    if (this.board.get(cell) === player) {
                        seenSelfs.push(cell);
                    } else if (!captured.some(x => x.includes(cell))) {
                        seenOpps.push(cell);
                    }
                }
            }
        }
        if (seenSelfs.length === 0) { return [true, undefined]; }
        const captures = this.getCapturedGroups(place, player, placed, captured);
        if (captures.length === 0) { return [false, undefined]; }
        return [true, captures];
    }

    private getGroup(start: string, captured: string[][] = []): string[] {
        // Get a group of cells that are connected to a starting cell.
        // If earlyExit is provided, return empty array if the group intersects with any of the groups in earlyExit.
        const todo = [start];
        const seen: Set<string> = new Set();
        const player = this.board.get(start)!;
        while (todo.length > 0) {
            const cell = todo.pop()!;
            if (seen.has(cell)) { continue; }
            seen.add(cell);
            for (const n of this.getNeighbours(cell)) {
                if (this.board.has(n) && this.board.get(n) === player) {
                    // Early exit with empty array if the group intersects with any of the groups in captured.
                    if (captured.length > 0 && captured.some(x => x.includes(n))) { return []; }
                    todo.push(n);
                }
            }
        }
        return [...seen];
    }

    private getCapturedGroups(place: string, player: playerid, placed: string[], captured: string[][]): string[][] {
        // Get all groups of opponent pieces that are captured by placing a piece at a cell.
        const todo = [place];
        const seen: Set<string> = new Set();
        const enemyGroups: string[][] = [];
        while (todo.length > 0) {
            const cell = todo.pop()!;
            if (seen.has(cell)) { continue; }
            seen.add(cell);
            for (const n of this.getNeighbours(cell)) {
                if (placed.includes(n)) {
                    todo.push(n);
                } else if (this.board.has(n)) {
                    if (this.board.get(n) === player) {
                        todo.push(n);
                    } else if (!captured.some(x => x.includes(n)) && !enemyGroups.some(x => x.includes(n))) {
                        const group = this.getGroup(n, enemyGroups);
                        if (group.length > 0) {
                            enemyGroups.push(group);
                        }
                    }
                }
            }
        }
        if (enemyGroups.some(x => x.length >= seen.size)) { return []; }
        return enemyGroups;
    }

    public randomMove(): string {
        const moves = [];
        for (const cell of this.allCells()) {
            if (this.board.has(cell)) { continue; }
            moves.push(...this.followupsFrom(cell, this.currplayer).map(x => x.join(",")));
        }
        if (moves.length === 0) { return "pass"; }
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            let newmove;
            if (move === "") {
                newmove = cell;
            } else {
                newmove = move + "," + cell;
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
                message: i18next.t("apgames:validation._general.GENERIC", {move, row, col, piece, emessage: (e as Error).message})
            }
        }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        if (m === "No movelist") {
            result.valid = false;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.oust.NO_MOVELIST");
            return result;
        }
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.oust.INITIAL_INSTRUCTIONS");
            return result;
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (m === "pass") {
            if (this.hasMoves(this.currplayer)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.oust.ILLEGAL_PASS");
                return result;
            }
        } else {
            const moves = m.split(",");
            // Valid cell
            let currentMove;
            try {
                for (const p of moves) {
                    currentMove = p;
                    const [x, y] = this.algebraic2coords(p);
                    // `algebraic2coords` does not check if the cell is on the board fully.
                    if (this.geometry === "hex") {
                        if (y < 0) { throw new Error("Invalid cell."); }
                    } else {
                        if (x < 0 || x >= this.boardSize || y < 0 || y >= this.boardSize) {
                            throw new Error("Invalid cell");
                        }
                    }
                }
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: currentMove });
                return result;
            }
            const regex = new RegExp(`^([a-z]+[1-9][0-9]*)(,[a-z]+[1-9][0-9]*)*$`);
            if (!regex.test(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.oust.INVALID_MOVE_STRING", {move: m});
                return result;
            }
            const placed: string[] = [];
            const captured: string[][] = [];
            let captureCount = 0;
            for (const [i, move] of moves.entries()) {
                if (this.board.has(move) && !captured.some(x => x.includes(move)) || placed.includes(move)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.OCCUPIED", { where: move });
                    return result;
                }
                const [canPlace, captures] = this.canPlace(move, this.currplayer, placed, captured);
                if (!canPlace) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.oust.ILLEGAL_PLACEMENT", { where: move });
                    return result;
                }
                if (captures !== undefined) {
                    captured.push(...captures);
                    captureCount += captures.reduce((acc, val) => acc + val.length, 0);
                    placed.push(move);
                    if (i === moves.length - 1 && this.pieceCounts[this.currplayer % 2] !== captureCount) {
                        result.valid = true;
                        result.complete = -1;
                        result.canrender = true;
                        result.message = i18next.t("apgames:validation.oust.MORE");
                        return result;
                    }
                } else if (this.stack.length > 2 && this.pieceCounts[this.currplayer % 2] === captureCount) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.oust.ALREADY_WON");
                    return result;
                } else if (i !== moves.length - 1) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.oust.PLACEMENT_AFTER_NONCAPTURE", { where: move });
                    return result;
                }
            }
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {partial = false, trusted = false} = {}): OustGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        let result;
        if (m === "No movelist") {
            result = {valid: false, message: i18next.t("apgames:validation.oust.NO_MOVELIST")};
            throw new UserFacingError("VALIDATION_GENERAL", result.message);
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (!trusted) {
            result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
            // // This can potentially blow up so it's disabled.
            // if (!partial && !this.moves().includes(m)) {
            //     throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}));
            // }
        }
        if (m.length === 0) { return this; }
        if (m === "pass") {
            this.results = [{ type: "pass", who: this.currplayer }];
        } else {
            // Move valid, so change the state
            this.results = [];
            const moves = m.split(",");
            const captures: string[][] = [];
            const placed: string[] = [];
            for (const move of moves) {
                this.board.set(move, this.currplayer);
                this.results.push({ type: "place", where: move });
                placed.push(move);
                const [, captured] = this.canPlace(move, this.currplayer, placed, captures);
                if (captured !== undefined) {
                    captures.push(...captured);
                    for (const group of captured) {
                        for (const cell of group) {
                            this.board.delete(cell);
                        }
                        this.results.push({ type: "capture", count: group.length, where: group.join(",") });
                    }
                }
            }
            this.updatePieceCounts();
        }
        if (partial) { return this; }
        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    private updatePieceCounts(): void {
        // Update the scores with current piece count.
        const pieceCount1 = [...this.board].filter(x => x[1] === 1).length;
        const pieceCount2 = [...this.board].filter(x => x[1] === 2).length;
        this.pieceCounts = [pieceCount1, pieceCount2];
    }

    protected checkEOG(): OustGame {
        if (this.stack.length > 2 && this.pieceCounts[this.currplayer - 1] === 0) {
            this.gameover = true;
            this.winner = [this.currplayer % 2 + 1 as playerid];
        }
        if (this.gameover) {
            this.results.push({type: "eog"});
            this.results.push({type: "winners", players: [...this.winner]});
        }
        return this;
    }

    public getPlayerScore(player: playerid): number {
        return this.pieceCounts[player - 1];
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] },
        ]
    }

    public state(): IOustState {
        return {
            game: OustGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: OustGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            pieceCounts: [...this.pieceCounts]
        };
    }

    private isNewResult(): boolean {
        // Check if the `this.result` is new, or if it was copied from the previous state.
        return this.results.every(r => r !== this.stack[this.stack.length - 1]._results[0]);
    }

    public render(opts?: IRenderOpts): APRenderRep {
        let altDisplay: string | undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }
        let showMoves = true;
        if (altDisplay !== undefined) {
            if (altDisplay === "hide-moves") {
                showMoves = false;
            }
        }
        const rep = this.geometry === "hex" ? this.renderHexTri() : this.renderSquare();
        // Add annotations
        // @ts-ignore
        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                } else if (move.type === "capture") {
                    const targets: {row: number, col: number}[] = [];
                    for (const m of move.where!.split(",")) {
                        const [x, y] = this.algebraic2coords(m);
                        targets.push({row: y, col: x});
                    }
                    // @ts-ignore
                    rep.annotations.push({type: "exit", targets});
                }
            }
        }
        if (showMoves) {
            let moves: [number, number][] = [];
            if (this.isNewResult()) {
                const placedResults = this.results.filter(x => x.type === "place") as Extract<APMoveResult, { type: 'place' }>[];
                const capturedResults = this.results.filter(x => x.type === "capture") as Extract<APMoveResult, { type: 'capture' }>[];
                const placed = placedResults.map(x => x.where!);
                const captured = capturedResults.map(x => x.where).map(x => x!.split(","));
                moves = this.legalPlacements(this.currplayer, placed, captured).map(x => this.algebraic2coords(x));
            } else {
                moves = this.legalPlacements(this.currplayer, [], []).map(x => this.algebraic2coords(x));
            }
            if (moves.length) {
                const points = [];
                for (const cell of moves) {
                    points.push({row: cell[1], col: cell[0]});
                }
                // @ts-ignore
                rep.annotations.push({ type: "dots", targets: points, opacity: 0.2 });
            }
        }
        return rep;
    }

    private renderSquare(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < this.boardSize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell);
                    if (contents === 1) {
                        pstr += "A";
                    } else if (contents === 2) {
                        pstr += "B";
                    }
                } else {
                    pstr += "-";
                }
            }
        }
        pstr = pstr.replace(new RegExp(`-{${this.boardSize}}`, "g"), "_");
        // Build rep
        const rep: APRenderRep =  {
            options: ["hide-star-points"],
            board: {
                style: "vertex",
                width: this.boardSize,
                height: this.boardSize,
            },
            legend: {
                A: [{ name: "piece", player: 1 }],
                B: [{ name: "piece", player: 2 }],
            },
            pieces: pstr,
        };
        return rep;
    }

    private renderHexTri(): APRenderRep {
        // Build piece string
        const pstr: string[][] = [];
        const cells = this.hexTriGraph!.listCells(true);
        for (const row of cells) {
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const owner = this.board.get(cell)!;
                    if (owner === 1) {
                        pieces.push("A")
                    } else {
                        pieces.push("B");
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr.push(pieces);
        }
        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "hex-of-hex",
                minWidth: this.boardSize,
                maxWidth: (this.boardSize * 2) - 1,
            },
            legend: {
                A: [{ name: "piece", player: 1 }],
                B: [{ name: "piece", player: 2 }],
            },
            pieces: pstr.map(p => p.join("")).join("\n"),
        };
        return rep;
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Piece Counts**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const pieceCount = this.getPlayerScore(n as playerid);
            status += `Player ${ n }: ${ pieceCount }\n\n`;
        }

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.nowhat", { player, where: r.where }));
                resolved = true;
                break;
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.noperson.group_nowhere", { player, count: r.count }));
                resolved = true;
                break;
            case "pass":
                node.push(i18next.t("apresults:PASS.forced", { player }));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): OustGame {
        return new OustGame(this.serialize());
    }
}
