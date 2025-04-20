import { GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { HexTriGraph, reviver, UserFacingError } from "../common";
import i18next from "i18next";

type playerid = 1 | 2;

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
}

export interface IBugState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class BugGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Bug",
        uid: "bug",
        playercounts: [2],
        version: "20240721",
        dateAdded: "2024-08-26",
        // i18next.t("apgames:descriptions.bug")
        description: "apgames:descriptions.bug",
        // i18next.t("apgames:notes.bug")
        notes: "apgames:notes.bug",
        urls: ["https://boardgamegeek.com/boardgame/240835/bug"],
        people: [
            {
                type: "designer",
                name: "Nick Bentley",
                urls: ["https://boardgamegeek.com/boardgamedesigner/7958/nick-bentley"],
            },
            {
                type: "coder",
                name: "ypaul",
                urls: [],
                apid: "46f6da78-be02-4469-94cb-52f17078e9c1",
            },
        ],
        variants: [
            { uid: "size-3", group: "board" },
            { uid: "#board", },
            { uid: "size-5", group: "board" },
        ],
        categories: ["goal>immobilize", "mechanic>place", "mechanic>capture", "board>shape>hex", "board>connect>hex", "components>simple"],
        flags: ["no-moves", "custom-randomization", "scores"],
        displays: [{uid: "hide-moves"}],
    };

    public coords2algebraic(x: number, y: number): string {
        return this.graph.coords2algebraic(x, y);
    }

    public algebraic2coords(cell: string): [number, number] {
        return this.graph.algebraic2coords(cell);
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, playerid>;
    public graph: HexTriGraph = new HexTriGraph(7, 13);
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private boardSize = 0;
    private dots: string[] = [];
    private pieceHighlight: string[] = [];
    private coords2cubicMap: Map<string, [number, number]>;
    private cubic2coordsMap: Map<string, [number, number]>;

    constructor(state?: IBugState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: BugGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IBugState;
            }
            if (state.game !== BugGame.gameinfo.uid) {
                throw new Error(`The Bug game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
        this.coords2cubicMap = this.getCoords2CubicMap();
        this.cubic2coordsMap = this.getCubic2coordsMap(this.coords2cubicMap);
    }

    public load(idx = -1): BugGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if (idx < 0 || idx >= this.stack.length) {
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
        this.boardSize = this.getBoardSize();
        this.buildGraph();
        return this;
    }

    private getBoardSize(): number {
        // Get board size from variants.
        if (this.variants !== undefined && this.variants.length > 0 && this.variants[0] !== undefined && this.variants[0].length > 0) {
            const sizeVariants = this.variants.filter(v => v.includes("size"));
            if (sizeVariants.length > 0) {
                const size = sizeVariants[0].match(/\d+/);
                return parseInt(size![0], 10);
            }
            if (isNaN(this.boardSize)) {
                throw new Error(`Could not determine the board size from variant "${this.variants[0]}"`);
            }
        }
        return 4;
    }

    private getGraph(): HexTriGraph {
        return new HexTriGraph(this.boardSize, this.boardSize * 2 - 1);
    }

    private buildGraph(): BugGame {
        this.graph = this.getGraph();
        return this;
    }

    private getCoords2CubicMap(): Map<string, [number, number]> {
        // Get a map of coordinates to cubic coordinates.
        // This should be run once at initialisation.
        const centre = this.coords2algebraic(this.boardSize - 1, this.boardSize - 1);
        const cubicMap: Map<string, [number, number]> = new Map();
        for (const cell of this.graph.listCells() as string[]) {
            const path = this.graph.path(centre, cell)!;
            let [r, q] = [0, 0];
            let curr = centre;
            for (const step of path) {
                const bearing = this.graph.bearing(curr, step)!;
                switch (bearing) {
                    case "NE":
                        q++;
                        r--;
                        break;
                    case "E":
                        q++;
                        break;
                    case "SE":
                        r++;
                        break;
                    case "SW":
                        q--;
                        r++;
                        break;
                    case "W":
                        q--;
                        break;
                    case "NW":
                        r--;
                        break;
                }
                curr = step;
            }
            cubicMap.set(this.algebraic2coords(cell).join(","), [r, q]);
        }
        return cubicMap;
    }

    private getCubic2coordsMap(coords2cubicMap: Map<string, [number, number]>) {
        // Get a map of cubic coordinates to coordinates.
        // Just reverse the keys and values of the coords2cubic map.
        // This should be run once at initialisation.
        const coordsMap: Map<string, [number, number]> = new Map();
        for (const [coords, cubic] of coords2cubicMap) {
            coordsMap.set(cubic.join(","), coords.split(",").map(x => parseInt(x, 10)) as [number, number]);
        }
        return coordsMap;
    }

    private coords2cubic(x: number, y: number): [number, number] {
        // Convert coordinates to cubic hex coordinates.
        return this.coords2cubicMap.get(`${x},${y}`)!;
    }

    private cubic2coords(r: number, q: number): [number, number] {
        // Convert cubic coordinates to hex coordinates.
        return this.cubic2coordsMap.get(`${r},${q}`)!;
    }

    private algebraic2cubic(cell: string): [number, number] {
        // Convert algebraic coordinates to cubic coordinates.
        return this.coords2cubic(...this.algebraic2coords(cell));
    }

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }
        const moves: string[] = [];
        return moves;
    }

    public randomMove(): string {
        // A simple random move generator that selects from available placements one at a time.
        const grow: string[] = [];
        const largestBug = this.getLargestBug();
        for (const cell of this.graph.listCells() as string[]) {
            if (this.board.has(cell)) { continue; }
            const adjacentGroups = this.getAdjacentGroups(this.currplayer, cell);
            if (adjacentGroups.length > 1) { continue; }
            if (adjacentGroups.length > 0 && adjacentGroups[0].size === largestBug) { continue; }
            grow.push(cell);
        }
        const choice = grow[Math.floor(Math.random() * grow.length)];
        const placed = [choice];
        const board = new Map(this.board);
        board.set(choice, this.currplayer);
        let captures = this.getCaptures(this.currplayer, board);
        while (captures.length > 0) {
            const [captureGroups, bug] = captures[Math.floor(Math.random() * captures.length)];
            const growable = this.growCells(this.currplayer, bug, board, captureGroups);
            const growChoice = growable[Math.floor(Math.random() * growable.length)];
            board.set(growChoice, this.currplayer);
            placed.push(growChoice);
            for (const captureGroup of captureGroups) {
                for (const capture of captureGroup) {
                    board.delete(capture);
                }
            }
            captures = this.getCaptures(this.currplayer, board);
        }
        return placed.join(",");
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            let newmove = "";
            if (move === "") {
                newmove = cell;
            } else {
                const moves = move.split(",");
                if (moves[moves.length - 1] === cell) {
                    newmove = moves.slice(0, -1).join(",");
                } else {
                    newmove = `${move},${cell}`;
                }
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
                message: i18next.t("apgames:validation._general.GENERIC", { move, row, col, piece, emessage: (e as Error).message })
            }
        }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = { valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER") };
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.bug.INITIAL_INSTRUCTIONS");
            return result;
        }
        const moves = m.split(",");
        // Valid cell
        let currentMove;
        try {
            for (const move of moves) {
                currentMove = move;
                const [, y] = this.graph.algebraic2coords(move);
                // `algebraic2coords` does not check if the cell is on the board fully.
                if (y < 0) { throw new Error("Invalid cell."); }
            }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: currentMove });
            return result;
        }
        const board = new Map(this.board);
        const largestBug = this.getLargestBug();
        for (const [i, move] of moves.entries()) {
            if (i === 0) {
                if (board.has(move)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.OCCUPIED", { where: move });
                    return result;
                }
                const adjacentGroups = this.getAdjacentGroups(this.currplayer, move, board);
                // No merging of bugs.
                if (adjacentGroups.length > 1) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.bug.MERGE", { where: move, count: adjacentGroups.length });
                    return result;
                }
                // No growing bigger than largest bug.
                if (adjacentGroups.length > 0 && adjacentGroups[0].size === largestBug) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.bug.TOO_BIG", { where: move, size: largestBug });
                    return result;
                }
            } else {
                // Remove the group that just grew.
                const captures = this.getCaptures(this.currplayer, board);
                const growables: string[] = [];
                for (const [captureGroups, bug] of captures) {
                    const growable = this.growCells(this.currplayer, bug, board, captureGroups);
                    growables.push(...growable);
                    if (!growable.includes(move)) { continue; }
                    for (const captureGroup of captureGroups) {
                        for (const capture of captureGroup) {
                            board.delete(capture);
                        }
                    }
                }
                if (!growables.includes(move)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.bug.BAD_GROW", { where: move });
                    return result;
                }
            }
            board.set(move, this.currplayer);

        }
        // Check if must continue capturing.
        if (this.getCaptures(this.currplayer, board).length > 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.bug.GROW");
            return result;
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private getFirstMoves(player: playerid): string[] {
        // Get the first moves for a player.
        const firstMoves: string[] = [];
        const largestBug = this.getLargestBug();
        for (const cell of this.graph.listCells() as string[]) {
            if (this.board.has(cell)) { continue; }
            const adjacentGroups = this.getAdjacentGroups(player, cell);
            if (adjacentGroups.length > 1) { continue; }
            if (adjacentGroups.length > 0 && adjacentGroups[0].size === largestBug) { continue; }
            firstMoves.push(cell);
        }
        return firstMoves;
    }

    private hasMoves(player: playerid): boolean {
        // Check if the player has any moves.
        const largestBug = this.getLargestBug();
        for (const cell of this.graph.listCells() as string[]) {
            if (this.board.has(cell)) { continue; }
            const adjacentGroups = this.getAdjacentGroups(player, cell);
            if (adjacentGroups.length > 1) { continue; }
            if (adjacentGroups.length > 0 && adjacentGroups[0].size === largestBug) { continue; }
            return true;
        }
        return false;
    }

    private getAdjacentGroups(player: playerid, cell: string, board?: Map<string, playerid>): Set<string>[] {
        // Get all groups adjacent to the given cell.
        // We make use of this function that we've already written.
        // We look for adjacent groups for the player if the enemy placed at the cell.
        return this.getAdjacentEnemyGroups(player % 2 + 1 as playerid, new Set([cell]), board);
    }

    private getLargestBug(board?: Map<string, playerid>): number {
        // Get the largest bug on the board.
        board ??= this.board;
        return Math.max(...[1, 2].flatMap(player => this.getAllGroups(player as playerid, board).map(g => g.size)));
    }

    private getAllGroups(player: playerid, board?: Map<string, playerid>): Set<string>[] {
        // Get all groups of pieces belonging to the given player.
        board ??= this.board;
        const groups: Set<string>[] = [];
        const pieces = [...board.entries()].filter(e => e[1] === player).map(e => e[0]);
        const seen: Set<string> = new Set();
        for (const piece of pieces) {
            if (seen.has(piece)) { continue; }
            const group: Set<string> = new Set();
            const todo: string[] = [piece];
            while (todo.length > 0) {
                const cell = todo.pop()!;
                if (seen.has(cell)) { continue; }
                group.add(cell);
                seen.add(cell);
                for (const n of this.graph.neighbours(cell)) {
                    if (!pieces.includes(n)) { continue; }
                    todo.push(n);
                }
            }
            groups.push(group);
        }
        return groups;
    }

    private getAdjacentEnemyGroups(player: playerid, bug: Set<string>, board?: Map<string, playerid>): Set<string>[] {
        // Get all enemy groups adjacent to the given bug.
        board ??= this.board;
        const enemyGroups: Set<string>[] = [];
        const todo: string[] = [];
        for (const cell of bug) {
            for (const n of this.graph.neighbours(cell)) {
                if (!board.has(n)) { continue; }
                if (board.get(n) === player) { continue; }
                todo.push(n);
            }
        }
        const seen: Set<string> = new Set();
        while (todo.length > 0) {
            const cell = todo.pop()!;
            if (seen.has(cell)) { continue; }
            const enemyGroup: Set<string> = new Set([cell]);
            const todo2: string[] = [cell];
            while (todo2.length > 0) {
                const cell2 = todo2.pop()!;
                if (seen.has(cell2)) { continue; }
                seen.add(cell2);
                for (const n of this.graph.neighbours(cell2)) {
                    if (!board.has(n)) { continue; }
                    if (board.get(n) === player) { continue; }
                    enemyGroup.add(cell2);
                    todo2.push(n);
                }
            }
            enemyGroups.push(enemyGroup);
        }
        return enemyGroups;
    }

    private getAllConfigs(group: Set<string>): Set<string> {
        // Get all unique representations of a group.
        // If the shape is completely asymmetric, there will be 12 unique configurations.
        if (group.size === 1) {
            return new Set(["1"]);
        } else if (group.size === 2) {
            return new Set(["2"]);
        }
        let currCubic = [...group].map(cell => this.algebraic2cubic(cell));
        const allCubics: [number, number][][] = [currCubic];
        for (let i = 0; i < 5; i++) {
            const newDeltas: [number, number][] = [];
            for (const delta of currCubic) {
                newDeltas.push([-delta[1], delta[1] + delta[0]]);
            }
            allCubics.push(newDeltas);
            currCubic = newDeltas;
        }
        // Reflecting across r-axis
        currCubic = currCubic.map(d => [d[0], -d[0] - d[1]] as [number, number]);
        allCubics.push(currCubic);
        for (let i = 0; i < 5; i++) {
            const newDeltas: [number, number][] = [];
            for (const delta of currCubic) {
                newDeltas.push([-delta[1], delta[1] + delta[0]]);
            }
            allCubics.push(newDeltas);
            currCubic = newDeltas;
        }
        return new Set(allCubics.map(d => this.cubic2string(d)));
    }

    private cubic2string(cubic: [number, number][]): string {
        // Normalise the cubic coordinates of a group to get a unique representation.
        // We first get the usual coordinates and sort by y, then x to get the reference cell.
        // Then, we shift all cubic coordinates so that the reference cell is at (0, 0).
        // We don't need the first cell since it is always (0, 0).
        // We then sort the rest in an arbitrarily consistent way, and then join everything into a string.
        const sorted = cubic.map(d => this.cubic2coords(...d)).sort((a, b) => a[1] - b[1] || a[0] - b[0]).map(c => this.coords2cubic(...c));
        const [x, y] = sorted[0];
        return sorted.slice(1).map(([a, b]) => [a - x, b - y]).map(d => d.join(",")).sort().join(";");
    }

    private getConfig(group: Set<string>): string {
        // Get a unique representation string for a group in a specific orientation.
        if (group.size === 1) {
            return "1";
        } else if (group.size === 2) {
            return "2";
        }
        return this.cubic2string([...group].map(cell => this.algebraic2cubic(cell)));
    }

    private getAdjacentFree(group: Set<string>, board?: Map<string, playerid>, captured: Set<string>[] = []): Set<string> {
        // Get all neighbours of a group.
        board ??= this.board;
        const neighbours: Set<string> = new Set();
        for (const cell of group) {
            for (const n of this.graph.neighbours(cell)) {
                if (board.has(n) && !captured.some(x => x.has(n))) { continue; }
                neighbours.add(n);
            }
        }
        return neighbours;
    }

    private growCells(player: playerid, bug: Set<string>, board?: Map<string, playerid>, captured: Set<string>[] = []): string[] {
        // Get a list of cells where a bug can grow after `captured` is removed.
        board ??= this.board;
        const growable: string[] = [];
        for (const cell of this.getAdjacentFree(bug, board, captured)) {
            if (this.graph.neighbours(cell).every(n => board!.get(n) !== player || bug.has(n))) {
                growable.push(cell);
            }
        }
        return growable;
    }

    private getCaptures(player: playerid, board?: Map<string, playerid>): [Set<string>[], Set<string>][] {
        // Get all possible captures for the given player, and which group captures them.
        board ??= this.board;
        const playerBugs = this.getAllGroups(player, board);
        const captures: [Set<string>[], Set<string>][] = [];
        for (const bug of playerBugs) {
            const configs = this.getAllConfigs(bug);
            const enemyGroups = this.getAdjacentEnemyGroups(player, bug, board);
            const tentativeCaptures: Set<string>[] = [];
            for (const enemyGroup of enemyGroups) {
                if (enemyGroup.size !== bug.size) { continue; }
                const config = this.getConfig(enemyGroup);
                if (!configs.has(config)) { continue; }
                tentativeCaptures.push(enemyGroup);
            }
            if (tentativeCaptures.length === 0) { continue; }
            const growable = this.growCells(player, bug, board, tentativeCaptures);
            if (growable.length === 0) { continue; }
            captures.push([tentativeCaptures, bug]);
        }
        return captures;
    }

    public move(m: string, {partial = false, trusted = false} = {}): BugGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        let result;
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (!trusted) {
            result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
            // This game does not generate moves.
            // if (!partial && !this.moves().includes(m)) {
            //     throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", { move: m }));
            // }
        }
        this.dots = [];
        this.pieceHighlight = [];
        this.results = [];
        if (m.length === 0) { return this; }
        const moves = m.split(",");
        for (const [i, move] of moves.entries()) {
            if (i === 0) {
                const adjacentGroups = this.getAdjacentGroups(this.currplayer, move);
                if (adjacentGroups.length === 0) {
                    this.results.push({ type: "place", where: move, count: 1, what: "new" });
                } else {
                    this.results.push({ type: "place", where: move, count: adjacentGroups[0].size + 1, what: "grow" });
                }
            } else {
                // Remove the group that just grew.
                const captures = this.getCaptures(this.currplayer);
                let newSize = 0;
                for (const [captureGroups, bug] of captures) {
                    const growable = this.growCells(this.currplayer, bug, undefined, captureGroups);
                    if (!growable.includes(move)) { continue; }
                    newSize = bug.size + 1;
                    for (const captureGroup of captureGroups) {
                        for (const capture of captureGroup) {
                            this.board.delete(capture);
                        }
                        this.results.push({ type: "capture", where: [...captureGroup].join(","), what: [...bug].join(","), count: captureGroup.size });
                    }
                    break;
                }
                this.results.push({ type: "place", where: move, count: newSize, what: "bonus-grow" });
            }
            this.board.set(move, this.currplayer);
        }
        // Update information for the renderer.
        const captures2 = this.getCaptures(this.currplayer);
        for (const [captureGroups, bug] of captures2) {
            captureGroups.forEach(capture => this.pieceHighlight.push(...capture));
            this.dots.push(...this.growCells(this.currplayer, bug, undefined, captureGroups));
        }
        if (partial) { return this; }
        this.pieceHighlight = [];
        this.dots = [];

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): BugGame {
        if (!this.hasMoves(this.currplayer)) {
            this.gameover = true;
            this.winner = [this.currplayer];
        }
        if (this.gameover) {
            this.results.push({ type: "eog" });
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public state(): IBugState {
        return {
            game: BugGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: BugGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
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
        // Build piece string
        const pstr: string[][] = [];
        const cells = this.graph.listCells(true);
        for (const row of cells) {
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const owner = this.board.get(cell)!;
                    if (owner === 1) {
                        if (this.pieceHighlight.includes(cell)) {
                            pieces.push("C");
                        } else {
                            pieces.push("A");
                        }
                    } else {
                        if (this.pieceHighlight.includes(cell)) {
                            pieces.push("D");
                        } else {
                            pieces.push("B");
                        }
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
                A: [{ name: "piece", colour: 1 }],
                B: [{ name: "piece", colour: 2 }],
                C: [{ name: "piece", colour: "#FFF" }, { name: "piece", colour: 1, opacity: 0.5 }],
                D: [{ name: "piece", colour: "#FFF" }, { name: "piece", colour: 2, opacity: 0.5 }],
            },
            pieces: pstr.map(p => p.join("")).join("\n"),
        };

        // Add annotations
        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.graph.algebraic2coords(move.where!);
                    rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                } else if (move.type === "capture") {
                    for (const cell of move.where!.split(",")) {
                        const [x, y] = this.graph.algebraic2coords(cell);
                        rep.annotations.push({ type: "exit", targets: [{ row: y, col: x }] });
                    }
                }
            }
        }
        if (showMoves) {
            const points = [];
            if (this.dots.length > 0) {
                for (const cell of this.dots) {
                    const [x, y] = this.algebraic2coords(cell);
                    points.push({ row: y, col: x });
                }
            } else {
                // This means that it's at the start of a move.
                for (const cell of this.getFirstMoves(this.currplayer)) {
                    const [x, y] = this.algebraic2coords(cell);
                    points.push({ row: y, col: x });
                }
            }
            if (points.length > 0) {
                rep.annotations.push({ type: "dots", targets: points as [RowCol, ...RowCol[]], opacity: 0.2, colour: "_context_fill" });
            }
        }
        return rep;
    }

    public getPlayerScore(player: number): number {
        return this.getFirstMoves(player as playerid).length;
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.bug.PLACEABLE_COUNT"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] },
        ]
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Placeable Counts**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const pieces = this.getPlayerScore(n);
            status += `Player ${n}: ${pieces}\n\n`;
        }

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                if (r.what === "new") {
                    node.push(i18next.t("apresults:PLACE.bug_new", { player, where: r.where }));
                } else if (r.what === "grow") {
                    node.push(i18next.t("apresults:PLACE.bug_grow", { player, where: r.where, size: r.count }));
                } else {
                    node.push(i18next.t("apresults:PLACE.bug_bonus_grow", { player, where: r.where, size: r.count }));
                }
                resolved = true;
                break;
            case "capture":
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): BugGame {
        return new BugGame(this.serialize());
    }
}
