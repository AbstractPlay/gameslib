import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { HexTriGraph, reviver, UserFacingError } from "../common";
import i18next from "i18next";

type playerid = 1 | 2;
type Direction = "NE" | "E" | "SE" | "SW" | "W" | "NW";
const directions: Direction[] = ["NE", "E", "SE", "SW", "W", "NW"];

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
}

export interface IVoloState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class VoloGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Volo",
        uid: "volo",
        playercounts: [2],
        version: "20240705",
        dateAdded: "2024-07-14",
        // i18next.t("apgames:descriptions.volo")
        description: "apgames:descriptions.volo",
        urls: [
            "https://spielstein.com/games/volo/rules",
            "https://boardgamegeek.com/boardgame/83283/volo",
        ],
        people: [
            {
                type: "designer",
                name: "Dieter Stein",
                urls: ["https://spielstein.com/"]
            },
            {
                type: "coder",
                name: "ypaul",
                urls: [],
                apid: "46f6da78-be02-4469-94cb-52f17078e9c1",
            },
        ],
        variants: [
            { uid: "size-6", group: "board" },
            { uid: "size-8", group: "board" }
        ],
        categories: ["goal>unify", "mechanic>place", "mechanic>move>group", "board>shape>hex", "board>connect>hex", "components>simple>1per"],
        flags: ["scores", "automove"],
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
    private blocked: string[] = [];
    private selected: string[] = [];
    private allLines: string[][] = [];

    constructor(state?: IVoloState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            this.boardSize = this.getBoardSize();
            this.buildGraph();
            const board = this.getStartingBoard();
            const fresh: IMoveState = {
                _version: VoloGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IVoloState;
            }
            if (state.game !== VoloGame.gameinfo.uid) {
                throw new Error(`The Volo game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
            this.boardSize = this.getBoardSize();
            this.buildGraph();
        }
        this.load();
        this.blocked = this.getBlocked();
        this.allLines = this.getAllLines();
    }

    public load(idx = -1): VoloGame {
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
        return this;
    }

    private getBoardSize(): number {
        // Get board size from variants.
        if (this.variants !== undefined && this.variants.length > 0 && this.variants[0] !== undefined && this.variants[0].length > 0) {
            const sizeVariants = this.variants.filter(v => v.includes("size"))
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

    private getBlocked(): string[] {
        // Get all blocked vertices.
        return [
            this.coords2algebraic(0, 0),
            this.coords2algebraic(this.boardSize - 1, 0),
            this.coords2algebraic(0, this.boardSize - 1),
            this.coords2algebraic(this.boardSize * 2 - 2, this.boardSize - 1),
            this.coords2algebraic(0, this.boardSize * 2 - 2),
            this.coords2algebraic(this.boardSize - 1, this.boardSize * 2 - 2),
            this.coords2algebraic(this.boardSize - 1, this.boardSize - 1),
        ];
    }

    private getStartingBoard(): Map<string, playerid> {
        // Get the starting board position.
        return new Map([
            [this.coords2algebraic(1, 1), 1],
            [this.coords2algebraic(this.boardSize - 1, 1), 2],
            [this.coords2algebraic(this.boardSize * 2 - 3, this.boardSize - 1), 1],
            [this.coords2algebraic(this.boardSize - 1, this.boardSize * 2 - 3), 2],
            [this.coords2algebraic(1, this.boardSize * 2 - 3), 1],
            [this.coords2algebraic(1, this.boardSize - 1), 2],
        ]);
    }

    private getGraph(): HexTriGraph {
        return new HexTriGraph(this.boardSize, this.boardSize * 2 - 1);
    }

    private buildGraph(): VoloGame {
        this.graph = this.getGraph();
        return this;
    }

    private getAllLines(): string[][] {
        // Get cells in all lines. The cells are sorted.
        // This is used in the move generation.
        const lines: string[][] = [];
        for (let i = 0; i < this.boardSize - 1; i++) {
            lines.push(this.graph.ray(0, i, "E", true).map(x => this.coords2algebraic(...x)));
            lines.push(this.graph.ray(0, this.boardSize + i, "E", true).map(x => this.coords2algebraic(...x)));
            lines.push(this.graph.ray(0, i + 1, "SE", true).map(x => this.coords2algebraic(...x)));
            lines.push(this.graph.ray(i + 1, 0, "SE", true).map(x => this.coords2algebraic(...x)));
            lines.push(this.graph.ray(0, this.boardSize - 1 + i, "NE", true).map(x => this.coords2algebraic(...x)));
            lines.push(this.graph.ray(i + 1, 2 * this.boardSize - 2, "NE", true).map(x => this.coords2algebraic(...x)));
        }
        lines.push(this.graph.ray(0, this.boardSize - 1, "E", true).map(x => this.coords2algebraic(...x)));
        lines.push(this.graph.ray(0, 0, "SE", true).map(x => this.coords2algebraic(...x)));
        lines.push(this.graph.ray(0, 2 * this.boardSize - 2, "NE", true).map(x => this.coords2algebraic(...x)));
        return lines;
    }

    private getAllContiguousCombinations(player: playerid, line: string[]): string[][] {
        // Get all contiguous combinations of lines greater than 1.
        // `line` is a list of cell names.
        // We call `this.board.get(cell)` to get the playerid or undefined.
        // For example, if we want to get all combinations for player 1, and
        // we had a line = [j1, j2, j3, j4, j5, j6, j7, j8, j9, j10],
        // and if we call line.map(x => this.board.get(x)) to get,
        // the list [1, undefined, 1, 1, 1, undefined, undefined, 2, 2, undefined] we want to return
        // the result [[j3, j4, j5], [j3, j4], [j4, j5]].
        // If player was 2, we would return [[j8, j9]].
        const combinations: string[][] = [];
        let currentCombination: string[] = [];
        for (const [i, cell] of line.entries()) {
            if (this.board.get(cell) === player) { currentCombination.push(cell); }
            if (this.board.get(cell) !== player || i === line.length - 1) {
                if (currentCombination.length > 1) {
                    for (let start = 0; start < currentCombination.length; start++) {
                        for (let end = start + 1; end < currentCombination.length; end++) {
                            combinations.push(currentCombination.slice(start, end + 1));
                        }
                    }
                }
                currentCombination = [];
            }
        }
        return combinations;
    }

    private canPass(player?: playerid): boolean {
        // If birds can be added, but only in regions of your own.
        // This is equivalent to saying that there is a place to add
        // a bird that is in neither players' regions.
        player ??= this.currplayer;
        const regions1 = this.getOpponentRegions(1);
        const regions2 = this.getOpponentRegions(2);
        for (const cell of this.graph.listCells(false) as string[]) {
            if (this.board.has(cell)) { continue; }
            if (this.nextTo(player, cell)) { continue; }
            if (!this.canPlace(cell, regions1)) { continue; }
            if (!this.canPlace(cell, regions2)) { continue; }
            return false;
        }
        return true;

    }

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }
        const moves: string[] = [];
        const regions = this.getOpponentRegions(player % 2 + 1 as playerid);
        // Adding a bird.
        for (const cell of this.graph.listCells(false) as string[]) {
            if (this.board.has(cell)) { continue; }
            if (this.nextTo(player, cell)) { continue }
            if (!this.canPlace(cell, regions)) { continue; }
            moves.push(cell);
        }
        // Moving a flock.
        const froms = [...this.board.keys()].filter(x => this.board.get(x) === player).map(x => [x]);
        for (const line of this.allLines) {
            froms.push(...this.getAllContiguousCombinations(player, line));
        }
        for (const from of froms) {
            const toDirections = this.getToDirections(from);
            for (const dirDist of toDirections) {
                const moved = this.getMoved(from, dirDist[0], dirDist[1]);
                const newRegions = this.getOpponentRegions(player, moved);
                if (newRegions.length > 1 && !this.isOneGroup(player, moved)) {
                    const regionIdentifiers = this.getAllRegionIdentifiers(newRegions);
                    for (const regionIdentifier of regionIdentifiers) {
                        moves.push(`${this.cells2colons(from)}-${dirDist[0]}${dirDist[1]}/${regionIdentifier}`);
                    }
                } else {
                    moves.push(`${this.cells2colons(from)}-${dirDist[0]}${dirDist[1]}`);
                }
            }
        }
        if (moves.length === 0 || this.canPass(player)) {
            moves.push("pass");
        }
        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    private getMoved(froms: string[], dir: Direction, dist: number): Map<string, string> {
        // Given a group of cells, get the new positions after moving.
        const moved = new Map<string, string>();
        for (const from of froms) {
            const fromCoords = this.algebraic2coords(from);
            const toCoords = this.graph.move(...fromCoords, dir, dist);
            if (toCoords === undefined) { throw new Error("Invalid move."); }
            const to = this.coords2algebraic(...toCoords);
            moved.set(from, to);
        }
        return moved;
    }

    private normaliseMove(move: string): string {
        // Normalise a move.
        const [moves, choice] = move.split("/");
        const [moves2, dirDist] = moves.split("-");
        const rearranged = moves2.split(":").sort((a, b) => this.sort(a, b)).join(":");
        if (dirDist === undefined) {
            return rearranged;
        }
        if (choice === undefined) {
            return `${rearranged}-${dirDist}`;
        }
        return `${rearranged}-${dirDist}/${choice}`;
    }

    private cells2colons(cells: string[]): string {
        // Convert cells to colons.
        if (cells.length === 1) { return cells[0]; }
        const sorted = cells.sort((a, b) => this.sort(a, b));
        return sorted[0] + ":" + sorted[sorted.length - 1];
    }

    private colons2cells(move: string): string[] {
        // Convert colons to cells.
        if (!move.includes(":")) { return [move]; }
        const [start, end] = move.split(":");
        const dir = this.graph.bearing(start, end);
        if (dir === undefined) { return []; }
        const cells = [start];
        for (const coords of this.graph.ray(...this.algebraic2coords(start), dir)) {
            const cell = this.coords2algebraic(...coords);
            cells.push(cell);
            if (cell === end) { break; }
        }
        return cells;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            let newmove = "";
            if (move.length === 0) {
                newmove = cell;
            } else {
                if (!move.includes("-")) {
                    if (this.board.has(cell)) {
                        if (move.includes(":")) {
                            newmove = cell;
                        } else {
                            newmove = this.normaliseMove(move + ":" + cell);
                        }
                    } else {
                        const pieces = this.colons2cells(move);
                        const tos = this.displayTos(pieces, this.getToDirections(pieces));
                        if (tos.has(cell)) {
                            newmove = this.normaliseMove(`${move}-${tos.get(cell)![0]}${tos.get(cell)![1]}`);
                        } else {
                            newmove = `${move}-${cell}`;
                        }
                    }
                } else {
                    const [moves, dir, dist,] = this.splitMove(move);
                    const moved = this.getMoved(moves, dir!, dist!);
                    const regionIdentifier = this.getRegionIdentifier(cell, this.getOpponentRegions(this.currplayer, moved));
                    if (regionIdentifier === undefined) {
                        newmove = this.normaliseMove(move + "/" + cell);
                    } else {
                        newmove = this.normaliseMove(move + "/" + regionIdentifier);
                    }
                }
            }
            const result = this.validateMove(newmove) as IClickResult;
            if (!result.valid) {
                if (newmove.includes("/")) {
                    result.move = newmove.split("/")[0];
                } else if (newmove.includes("-")) {
                    result.move = newmove.split("-")[0];
                } else {
                    result.move = "";
                }
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
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        if (m.length === 0) {
            const moves = this.moves();
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            if (moves.includes("pass")) {
                if (moves.length === 1) {
                    result.message = i18next.t("apgames:validation.volo.INITIAL_INSTRUCTIONS_PASS_ONLY");
                } else {
                    result.message = i18next.t("apgames:validation.volo.INITIAL_INSTRUCTIONS_PASS");
                }
            } else {
                result.message = i18next.t("apgames:validation.volo.INITIAL_INSTRUCTIONS");
            }
            return result;
        }

        if (m === "pass") {
            if (!this.moves().includes("pass")) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.volo.INVALID_PASS");
                return result;
            }
        } else {
            const [move, choice] = m.split("/");
            const [move2, dirDist] = move.split("-");
            const [start, end] = move2.split(":");

            // Valid cell
            let currentMove;
            try {
                for (const c of [start, end, choice]) {
                    if (c === undefined) { continue; }
                    const [, y] = this.algebraic2coords(c);
                    // `algebraic2coords` does not check if the cell is on the board fully.
                    if (y < 0) { throw new Error("Invalid cell."); }
                    if (this.blocked.includes(c)) { throw new Error("Invalid cell."); }
                }
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: currentMove });
                return result;
            }
            if (end === undefined && !this.board.has(start)) {
                if (this.nextTo(this.currplayer, start)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.volo.PLACE_FRIENDLY_NEIGHBOUR", { where: start });
                    return result;
                }
                const regions = this.getOpponentRegions(this.currplayer % 2 + 1 as playerid);
                if (!this.canPlace(start, regions)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.volo.CONTROLLED_REGION", { where: start });
                    return result;
                }
            } else {
                if (!this.board.has(start)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.NONEXISTENT", { where: start });
                    return result;
                }
                if (this.board.get(start) !== this.currplayer) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.UNCONTROLLED", { where: start });
                    return result;
                }
                let cells: string[] | undefined;
                if (end !== undefined) {
                    if (start === end) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.volo.SAME_START_END", { move });
                        return result;
                    }
                    if (!this.board.has(end)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.NONEXISTENT", { where: end });
                        return result;
                    }
                    if (this.board.get(end) !== this.currplayer) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.UNCONTROLLED", { where: end });
                        return result;
                    }
                    cells = this.colons2cells(move2)
                    if (cells.length === 0) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.volo.BEARING", { range: move2 });
                        return result;
                    }
                    for (const cell of cells) {
                        if (!this.board.has(cell)) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.volo.SINGLE_LINE", { range: move2 });
                            return result;
                        }
                        if (this.board.get(cell) !== this.currplayer) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.volo.SINGLE_LINE", { range: move2 });
                            return result;
                        }
                    }
                } else {
                    cells = [start];
                }
                if (dirDist === undefined || dirDist === "") {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    if (end === undefined) {
                        result.message = i18next.t("apgames:validation.volo.END_OR_MOVE_DIRECTION");
                    } else {
                        result.message = i18next.t("apgames:validation.volo.MOVE_DIRECTION");
                    }
                    return result;
                }
                const tos = this.displayTos(cells, this.getToDirections(cells));
                const dirDists = new Set([...tos.values()].map(x => x.join("")));
                if (!dirDists.has(dirDist)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.volo.INVALID_DIRDIST", { dirDist });
                    return result;
                }
                const dir = dirDist.match(/[A-Z]+/)![0] as Direction;
                const dist = parseInt(dirDist.match(/\d+/)![0], 10);
                const moved = this.getMoved(cells, dir, dist)
                const regions = this.getOpponentRegions(this.currplayer, moved);
                if (regions.length > 1 && !this.isOneGroup(this.currplayer, moved)) {
                    const regionIdentifiers = this.getAllRegionIdentifiers(regions);
                    if (choice === undefined) {
                        result.valid = true;
                        result.complete = -1;
                        result.canrender = true;
                        result.message = i18next.t("apgames:validation.volo.CHOOSE_REGION", { count: regionIdentifiers.length });
                        return result;
                    }
                    if (!regionIdentifiers.includes(choice)) {
                        const tryRegionIdentifier = this.getRegionIdentifier(choice, regions);
                        if (tryRegionIdentifier !== undefined && regionIdentifiers.includes(tryRegionIdentifier)) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.volo.INVALID_REGION_NORMALISE", { choice, represent: tryRegionIdentifier, normalised: this.normaliseMove(`${move}/${tryRegionIdentifier}`) });
                            return result;
                        }
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.volo.INVALID_REGION", { choice, choices: regionIdentifiers.join(", ") });
                        return result;
                    }
                } else {
                    if (choice !== undefined) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.volo.NO_REGIONS_TO_SELECT");
                        return result;
                    }
                }
            }
            const normalised = this.normaliseMove(m);
            if (m !== normalised) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.volo.NORMALISE", { normalised });
                return result;
            }
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private getGroup(player: playerid, cell: string, moved: Map<string, string> = new Map()): Set<string> {
        // Get the group of a cell.
        // `moved` is a map of cells that have been moved to their new positions.
        const seen = new Set<string>();
        const todo = [cell];
        const movedValues = Array.from(moved.values());
        while (todo.length > 0) {
            const current = todo.pop()!;
            if (seen.has(current)) { continue; }
            seen.add(current);
            const neighbours = this.graph.neighbours(current);
            for (const n of neighbours) {
                if (seen.has(n)) { continue; }
                if (movedValues.includes(n)) {
                    todo.push(n);
                } else if (!moved.has(n) && this.board.has(n) && this.board.get(n) === player) {
                    todo.push(n);
                }
            }
        }
        return seen;
    }

    private nextTo(player: playerid, cell: string): boolean {
        // Check if a cell is next to a friendly piece.
        const neighbours = this.graph.neighbours(cell);
        for (const n of neighbours) {
            if (this.board.has(n) && this.board.get(n) === player) {
                return true;
            }
        }
        return false;
    }

    private getToDirections(froms: string[]): [Direction, number][] {
        // Get all possible destinations from a group.
        const toDirections: [Direction, number][] = [];
        const originalGroup = this.getGroup(this.currplayer, froms[0]);
        froms.forEach(x => originalGroup.delete(x));
        loop:
        for (const dir of directions) {
            for (let i = 1; true; i++) {
                const moved = new Map<string, string>();
                for (const from of froms) {
                    const toCoords = this.graph.move(...this.algebraic2coords(from), dir, i)
                    if (toCoords === undefined) { continue loop; }
                    const cell = this.coords2algebraic(...toCoords);
                    if (this.blocked.includes(cell)) { continue loop; }
                    if (this.board.has(cell) && !froms.includes(cell)) { continue loop; }
                    moved.set(from, cell);
                }
                const group = this.getGroup(this.currplayer, moved.get(froms[0])!, moved);
                if (!Array.from(originalGroup).every(x => group.has(x))) { continue; }
                if (originalGroup.size + moved.size >= group.size) { continue; }
                toDirections.push([dir, i]);
            }
        }
        return toDirections;
    }

    private displayTos(froms: string[], dirDists: [Direction, number][]): Map<string, [Direction, number]> {
        // Display the possible moves from a group.
        // This is used in the renderer and to convert clicks to the direction and distance.
        const tos = new Map<string, [Direction, number]>();
        const collision: Set<string> = new Set();
        for (const from of froms) {
            for (const dirDist of dirDists) {
                const [dir, dist] = dirDist;
                const fromCoords = this.algebraic2coords(from);
                const oneAheadCoords = this.graph.move(...fromCoords, dir, 1);
                if (oneAheadCoords === undefined) { continue; }
                if (this.board.has(this.coords2algebraic(...oneAheadCoords))) { continue; }
                const coords = this.graph.move(...fromCoords, dir, dist);
                if (coords === undefined) { continue; }
                const to = this.coords2algebraic(...coords);
                if (this.board.has(to)) { continue; }
                if (tos.has(to)) {
                    collision.add(to);
                } else {
                    tos.set(to, dirDist);
                }
            }
        }
        collision.forEach(x => tos.delete(x));
        return tos;
    }

    private getOpponentRegions(player: playerid, moved: Map<string, string> = new Map()): Set<string>[] {
        // Get all regions that contain the pieces of the opponent of `player`'s.
        // `moved` is a map of cells that have been moved by `player` to their new positions.
        const allEmpty = new Set<string>((this.graph.listCells(false) as string[]).filter(x => !this.blocked.includes(x) && !this.board.has(x)));
        const allOpponent = new Set<string>([...this.board.keys()].filter(x => this.board.get(x) !== player));
        const seen = new Set<string>();
        const regions:  Set<string>[] = [];
        const allFroms = [...moved.keys()];
        const allTos = [...moved.values()];
        for (const from of allFroms.filter(x => !allTos.includes(x))) {
            allEmpty.add(from);
        }
        for (const to of allTos.filter(x => !allFroms.includes(x))) {
            allEmpty.delete(to);
        }
        for (const cell of allOpponent) {
            if (seen.has(cell)) { continue; }
            const region: Set<string> = new Set();
            const todo = [cell];
            while (todo.length > 0) {
                const current = todo.pop()!;
                if (seen.has(current)) { continue; }
                seen.add(current);
                region.add(current);
                const neighbours = this.graph.neighbours(current);
                for (const n of neighbours) {
                    if (seen.has(n)) { continue; }
                    if (!allEmpty.has(n) && !allOpponent.has(n)) { continue; }
                    todo.push(n);
                }
            }
            regions.push(region);
        }
        return regions;
    }

    private canPlace(cell: string, regions: Set<string>[]): boolean {
        // Check if a cell can be placed into.
        for (const region of regions) {
            if (region.has(cell)) { return true; }
        }
        return false;
    }

    private sort(a: string, b: string): number {
        // Sort two cells. This is necessary because "a10" should come after "a9".
        const [ax, ay] = this.graph.algebraic2coords(a);
        const [bx, by] = this.graph.algebraic2coords(b);
        if (ay < by) { return 1; }
        if (ay > by) { return -1; }
        if (ax < bx) { return -1; }
        if (ax > bx) { return 1; }
        return 0;
    }

    private getRegionIdentifier(cell: string, regions: Set<string>[]): string | undefined {
        // Get the cell that identifies a region.
        for (const region of regions) {
            if (region.has(cell)) { return [...region].sort((a, b) => this.sort(a, b))[0]; }
        }
        return undefined;
    }

    private getAllRegionIdentifiers(regions: Set<string>[]): string[] {
        // Get all region identifiers.
        return regions.map(x => [...x].sort((a, b) => this.sort(a, b))[0]);
    }

    private deleteOtherRegions(player: playerid, regionIdentifier: string, regions: Set<string>[]): string[] {
        // Returns the pieces of the opponent of `player` that are deleted when
        // `regionIdentifier` is retained from `regions`.
        const regionIdentifiers = this.getAllRegionIdentifiers(regions);
        const deleted: string[] = [];
        for (const [i, region] of regions.entries()) {
            const identifier = regionIdentifiers[i];
            if (identifier === regionIdentifier) { continue; }
            for (const cell of region) {
                if (this.board.has(cell) && this.board.get(cell) !== player) { deleted.push(cell); }
            }
        }
        return deleted;
    }

    private splitMove(m: string): [string[], Direction | undefined, number | undefined, string | undefined] {
        // Get the components of a move.
        // Cells, direction, distance, choice.
        const [move, choice] = m.split("/");
        const [move2, dirDist] = move.split("-");
        const cells = this.colons2cells(move2);
        const dir = dirDist === undefined || dirDist === "" ? undefined : dirDist.match(/[A-Z]+/)![0] as Direction;
        const dist = dirDist === undefined || dirDist === "" ? undefined : parseInt(dirDist.match(/\d+/)![0], 10);
        return [cells, dir, dist, choice === undefined ? undefined : choice];
    }

    public move(m: string, {partial = false, trusted = false} = {}): VoloGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        let result;
        m = m.replace(/\s+/g, "");
        let allMoves: string[] | undefined;
        if (!trusted) {
            result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
            if (!partial) {
                allMoves = this.moves();
                if (!allMoves.includes(m)) {
                    throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", { move: m }));
                }
            }
        }
        if (m.length === 0) { return this; }
        this.dots = [];
        this.results = [];
        if (m === "pass") {
            if (allMoves!.length > 1) {
                this.results.push({ type: "pass" });
            } else {
                this.results.push({ type: "pass", why: "forced" });
            }
        } else {
            const [fromColon,] = m.split("-");
            const [moves, dir, dist, choice] = this.splitMove(m);
            if (!this.board.has(moves[0])) {
                this.board.set(m, this.currplayer);
                this.results.push({ type: "place", where: m });
            } else {
                if (dir === undefined) {
                    this.selected = moves;
                    this.dots = [...this.displayTos(moves, this.getToDirections(moves)).keys()];
                } else {
                    const tos: string[] = [];
                    for (const from of moves) {
                        const coords = this.graph.move(...this.algebraic2coords(from), dir, dist)!;
                        const to = this.coords2algebraic(...coords);
                        tos.push(to);
                        this.board.delete(from);
                    }
                    for (const to of tos) {
                        this.board.set(to, this.currplayer);
                    }
                    this.results.push({ type: "move", from: fromColon, to: this.cells2colons(tos), how: `${dir}${dist}`, count: tos.length });
                    if (choice !== undefined) {
                        this.results.push({ type: "select", where: choice });
                    }
                    if (choice !== undefined) {
                        const regions = this.getOpponentRegions(this.currplayer);
                        const deleted = this.deleteOtherRegions(this.currplayer, choice, regions);
                        for (const cell of deleted) {
                            this.board.delete(cell);
                        }
                        this.results.push({ type: "remove", where: deleted.join(","), how: choice, num: deleted.length });
                    }
                }
            }
        }
        if (partial) { return this; }
        this.selected = [];
        this.dots = [];

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    private isOneGroup(player: playerid, moved: Map<string, string> = new Map()): boolean {
        // Check if all cells are in one group.
        const cells = new Set([...this.board.keys()].filter(x => this.board.get(x) === player && !moved.has(x)));
        [...moved.values()].forEach(x => cells.add(x));
        const group = this.getGroup(player, cells.keys().next().value as string, moved);
        return cells.size === group.size;
    }

    protected checkEOG(): VoloGame {
        const otherPlayer = this.currplayer % 2 + 1 as playerid;
        if (this.isOneGroup(otherPlayer)) {
            this.gameover = true;
            this.winner = [otherPlayer];
            this.results.push({ type: "eog" });
        } else if (this.isOneGroup(this.currplayer)) {
            this.gameover = true;
            this.winner = [this.currplayer];
            this.results.push({ type: "eog" });
        } else if (this.stack.length > 1 && this.lastmove === "pass" && this.stack[this.stack.length - 1].lastmove === "pass") {
            this.gameover = true;
            this.winner = [1, 2];
            this.results.push({ type: "eog", reason: "pass" });
        }
        if (this.gameover) {
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public state(): IVoloState {
        return {
            game: VoloGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: VoloGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    public render(): APRenderRep {
        // Build piece string
        const pstr: string[][] = [];
        const cells = this.graph.listCells(true);
        for (const row of cells) {
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const owner = this.board.get(cell)!;
                    if (owner === 1) {
                        if (this.selected.includes(cell)) {
                            pieces.push("C");
                        } else {
                            pieces.push("A")
                        }
                    } else {
                        if (this.selected.includes(cell)) {
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

        const blocked: RowCol[] = [];
        for (const cell of this.blocked) {
            const [x, y] = this.algebraic2coords(cell);
            blocked.push({ row: y, col: x });
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "hex-of-tri",
                minWidth: this.boardSize,
                maxWidth: (this.boardSize * 2) - 1,
                blocked: blocked as [RowCol, ...RowCol[]],
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
                    rep.annotations.push({type: "enter", targets: [{ row: y, col: x }]});
                } else if (move.type === "move") {
                    const froms = this.colons2cells(move.from);
                    const tos = this.colons2cells(move.to);
                    for (let i = 0; i < froms.length; i++) {
                        const [fromX, fromY] = this.algebraic2coords(froms[i]);
                        const [toX, toY] = this.algebraic2coords(tos[i]);
                        rep.annotations.push({ type: "move", targets: [{ row: fromY, col: fromX }, { row: toY, col: toX }] });
                    }
                } else if (move.type === "remove") {
                    for (const cell of move.where.split(",")) {
                        const [x, y] = this.algebraic2coords(cell);
                        rep.annotations.push({ type: "exit", targets: [{ row: y, col: x }] });
                    }
                }
            }
        }
        if (this.dots.length > 0) {
            const points = [];
            for (const cell of this.dots) {
                const [x, y] = this.algebraic2coords(cell);
                points.push({ row: y, col: x });
            }
            rep.annotations.push({ type: "dots", targets: points as [RowCol, ...RowCol[]] });
        }
        return rep;
    }

    public getPlayerPieces(player: number): number {
        return [...this.board.values()].filter(x => x === player).length;
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
            case "move":
                node.push(i18next.t("apresults:MOVE.volo", { player, from: r.from, how: r.how, count: r.count }));
                resolved = true;
                break;
            case "place":
                node.push(i18next.t("apresults:PLACE.volo", { player, where: r.where }));
                resolved = true;
                break;
            case "remove":
                node.push(i18next.t("apresults:REMOVE.volo", { player, how: r.how, num: r.num }));
                resolved = true;
                break;
            case "pass":
                if (r.why === "forced") {
                    node.push(i18next.t("apresults:PASS.forced", { player }));
                } else {
                    node.push(i18next.t("apresults:PASS.simple", { player }));
                }
                resolved = true;
                break;
            case "eog":
                if (r.reason === "pass") {
                    node.push(i18next.t("apresults:EOG.consecutive_passes"));
                } else {
                    node.push(i18next.t("apresults:EOG.default"));
                }
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): VoloGame {
        return new VoloGame(this.serialize());
    }
}
