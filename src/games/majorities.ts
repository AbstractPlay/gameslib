import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, MarkerFlood, MarkerGlyph, MarkerLine, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { HexTriGraph, reviver, UserFacingError } from "../common";
import i18next from "i18next";

type playerid = 1 | 2;
type Direction = "NE" | "E" | "SE" | "SW" | "W" | "NW";
// Map index to direction (horizontal, ascending, descending)
const directionMap: Map<number, string> = new Map([
    [0, "H"],
    [1, "A"],
    [2, "D"],
]);

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    // Winners for each line in each direction. null means it is not claimed yet.
    lineWinners: [(playerid | null)[], (playerid | null)[], (playerid | null)[]];
    // Winners for each direction.
    directionWinners: [playerid | null, playerid | null, playerid | null];
    lastmove?: string;
}

export interface IMajoritiesState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class MajoritiesGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Majorities",
        uid: "majorities",
        playercounts: [2],
        version: "20240720",
        dateAdded: "2024-08-07",
        // i18next.t("apgames:descriptions.majorities")
        description: "apgames:descriptions.majorities",
        urls: ["https://boardgamegeek.com/boardgame/84153/majorities"],
        people: [
            {
                type: "designer",
                name: "Bill Taylor",
                urls: ["https://boardgamegeek.com/boardgamedesigner/9249/bill-taylor"],
            }
        ],
        variants: [
            { uid: "size-3", group: "board" },
            { uid: "size-7", group: "board" },
            { uid: "no-blocked" },
            { uid: "capture" },
        ],
        categories: ["goal>majority", "mechanic>place", "board>shape>hex", "board>connect>hex", "components>simple"],
        flags: ["experimental", "pie"],
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
    public lineWinners: [(playerid | null)[], (playerid | null)[], (playerid | null)[]] = [[], [], []];
    public directionWinners: [playerid | null, playerid | null, playerid | null] = [null, null, null];
    public graph: HexTriGraph = new HexTriGraph(7, 13);
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private boardSize = 0;
    private corners: Map<Direction, string>;
    private dispScoreCoords: [number, number][][];
    private blockedCoords: [number, number][];
    private holes: string[];
    private allRays: string[][][];
    private allThresholds: number[][];
    private cell2lines: Map<string, string[]> = new Map();

    constructor(state?: IMajoritiesState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            this.boardSize = this.getBoardSize();
            const fresh: IMoveState = {
                _version: MajoritiesGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                lineWinners: Array.from({ length: 3 }, () => Array.from({ length: 2 * this.boardSize - 1 }, () => null)) as [(playerid | null)[], (playerid | null)[], (playerid | null)[]],
                directionWinners: [null, null, null],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IMajoritiesState;
            }
            if (state.game !== MajoritiesGame.gameinfo.uid) {
                throw new Error(`The Majorities game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
            this.boardSize = this.getBoardSize();
        }
        this.load();
        this.corners = this.getCorners();
        this.dispScoreCoords = this.getDispScoreCoords();
        this.blockedCoords = this.getBlockedCoords();
        this.holes = this.getHoles();
        this.allRays = this.getAllRays();
        this.allThresholds = this.getAllThresholds();
        this.cell2lines = this.getCell2Lines();
    }

    public load(idx = -1): MajoritiesGame {
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
        this.lineWinners = state.lineWinners.map(a => [...a]) as [(playerid | null)[], (playerid | null)[], (playerid | null)[]];
        this.directionWinners = [...state.directionWinners];
        this.lastmove = state.lastmove;
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
        return 5;
    }

    private getGraph(): HexTriGraph {
        return new HexTriGraph(this.boardSize, this.boardSize * 2 - 1);
    }

    private buildGraph(): MajoritiesGame {
        this.graph = this.getGraph();
        return this;
    }

    private getCorners(): Map<Direction, string> {
        // Get algebraic notation for the corners of the board.
        return new Map([
            ["NE", this.coords2algebraic(this.boardSize - 1, 0)],
            ["E", this.coords2algebraic(2 * this.boardSize - 2, this.boardSize - 1)],
            ["SE", this.coords2algebraic(this.boardSize - 1, 2 * this.boardSize - 2)],
            ["SW", this.coords2algebraic(0, 2 * this.boardSize - 2)],
            ["W", this.coords2algebraic(0, this.boardSize - 1)],
            ["NW", this.coords2algebraic(0, 0)],
        ]);
    }

    private getDispScoreCoords(): [number, number][][] {
        // Get coordinates for displaying scores in order.
        const coords: [number, number][][] = [
            // Horizontal
            [
                ...this.graph.ray(...this.algebraic2coords(this.corners.get("NE")!), "SE", true),
                ...this.graph.ray(...this.algebraic2coords(this.corners.get("E")!), "SW", false),
            ].map(x => [x[0] + 2, x[1] + 1]),
            // Ascending
            [
                ...this.graph.ray(...this.algebraic2coords(this.corners.get("SE")!), "W", true),
                ...this.graph.ray(...this.algebraic2coords(this.corners.get("SW")!), "NW", false),
            ].map(x => [x[0], x[1] + 2]),
            // Descending
            [
                ...this.graph.ray(...this.algebraic2coords(this.corners.get("W")!), "NE", true),
                ...this.graph.ray(...this.algebraic2coords(this.corners.get("NW")!), "E", false),
            ],
        ];
        return coords;
    }

    private getBlockedCoords(): [number, number][] {
        // This will be the ring of cells around the board to track which player has claimed which line.
        // Get the coordinates of the blocked cells.
        const blocked: [number, number][] = [[this.boardSize, 0], [0, this.boardSize], [this.boardSize, 2 * this.boardSize]];
        this.dispScoreCoords.forEach(coords => blocked.push(...coords));
        return blocked;
    }

    private getHoles(): string[] {
        // Get the holes in the board.
        // Holes are used to make the number of cells in each line odd.
        // In the "no-blocked" variant, there are no holes.
        if (this.variants.includes("no-blocked")) { return []; }
        if (this.boardSize === 3) {
            return ["b2", "c3", "c4", "d2"];

        } else if (this.boardSize === 7) {
            return ["b2", "d4", "f6", "g7", "g8", "g10", "g12", "h6", "j4", "l2"];
        }
        return ["b2", "d4", "e6", "e8", "f4", "h2"];
    }

    private getAllRays(): string[][][] {
        // Get all rays. This returns rays for each line in each of the three directions.
        const rayH: string[][] = [];
        for (let i = 0; i < 2 * this.boardSize - 1; i++) {
            rayH.push(this.graph.ray(0, i, "E", true).map(x => this.coords2algebraic(...x)));
        }
        const rayA: string[][] = [];
        for (const coords of [
                ...this.graph.ray(...this.algebraic2coords(this.corners.get("SE")!), "W", true),
                ...this.graph.ray(...this.algebraic2coords(this.corners.get("SW")!), "NW", false),
        ]) {
            rayA.push(this.graph.ray(...coords, "NE", true).map(x => this.coords2algebraic(...x)));
        }
        const rayD: string[][] = [];
        for (const coords of [
            ...this.graph.ray(...this.algebraic2coords(this.corners.get("W")!), "NE", true),
            ...this.graph.ray(...this.algebraic2coords(this.corners.get("NW")!), "E", false),
        ]) {
            rayD.push(this.graph.ray(...coords, "SE", true).map(x => this.coords2algebraic(...x)));
        }
        return [rayH, rayA, rayD];
    }

    private getAllThresholds(): number[][] {
        // Get the lengths of all rays.
        const allThresholds: number[][] = [];
        for (const rays of this.allRays) {
            const thresholds: number[] = [];
            for (const ray of rays) {
                thresholds.push(Math.ceil(ray.filter(cell => !this.holes.includes(cell)).length / 2));
            }
            allThresholds.push(thresholds);
        }
        return allThresholds;
    }

    private getCell2Lines(): Map<string, string[]> {
        // Get the lines that each cell is part of.
        const cell2lines: Map<string, string[]> = new Map();
        for (const [i, rays] of this.allRays.entries()) {
            for (const [j, ray] of rays.entries()) {
                for (const cell of ray) {
                    if (!cell2lines.has(cell)) {
                        cell2lines.set(cell, []);
                    }
                    cell2lines.get(cell)!.push(this.indices2line(i, j));
                }
            }
        }
        return cell2lines;
    }

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }
        const moves: string[] = [];
        const emptyCells = (this.graph.listCells(false) as string[]).filter(cell => !this.board.has(cell) && !this.holes.includes(cell));
        if (this.stack.length === 1) {
            for (const cell of emptyCells) {
                moves.push(cell);
            }
            return moves;
        }
        if (emptyCells.length === 1) {
            moves.push(emptyCells[0]);
        } else if (this.variants.includes("capture")) {
            const moveSet: Set<string> = new Set();
            const allCells = (this.graph.listCells(false) as string[]).filter(cell => !this.holes.includes(cell));
            for (const cell1 of emptyCells) {
                for (const cell2 of allCells) {
                    if (cell1 === cell2) {
                        if (moveSet.has(`${cell1},${cell1}`)) { continue; }
                        const wonLines = this.getWonLines(player, [cell1]);
                        if (wonLines.length > 0) {
                            moveSet.add(`${cell1},${cell1}`);
                        }
                    } else {
                        if (this.board.has(cell2)) {
                            // Check if second placement is possible even if cell was occupied.
                            // This happens if a capture happened on that cell.
                            const wonLines = this.getWonLines(player, [cell1]);
                            if (wonLines.length === 0) { continue; }
                            const captures: string[] = [];
                            for (const line of wonLines) {
                                captures.push(...this.getCaptures(line));
                            }
                            if (!captures.includes(cell2)) { continue; }
                            moveSet.add(`${cell1},${cell2}`);
                        } else {
                            moveSet.add(this.normaliseMove(`${cell1},${cell2}`));
                        }
                    }
                }
            }
            return Array.from(moveSet).sort();
        } else {
            for (let i = 0; i < emptyCells.length; i++) {
                for (let j = i + 1; j < emptyCells.length; j++) {
                    moves.push(this.normaliseMove(`${emptyCells[i]},${emptyCells[j]}`));
                }
            }
        }
        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    private normaliseMove(move: string): string {
        // Sort the move list so that there is a unique representation.
        move = move.toLowerCase();
        move = move.replace(/\s+/g, "");
        const moves = move.split(",");
        if (moves.length === 1) {
            return move;
        }
        if (this.variants.includes("capture")) {
            // We don't normalise if there is a capture because it's too much of a pain.
            const wonLines = this.getWonLines(this.currplayer, moves);
            if (wonLines.length > 0) {
                return move;
            }
        }
        return move.split(",").sort((a, b) => this.sort(a, b)).join(",");
    }

    private sort(a: string, b: string): number {
        // Sort two cells. This is necessary because "a10" should come after "a9".
        const [ax, ay] = this.algebraic2coords(a);
        const [bx, by] = this.algebraic2coords(b);
        if (ay < by) { return 1; }
        if (ay > by) { return -1; }
        if (ax < bx) { return -1; }
        if (ax > bx) { return 1; }
        return 0;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = "";
            const cell = this.coords2algebraic(col - 1, row - 1);
            if (!this.graph.graph.hasNode(cell)) {
                newmove = "edge";
            } else if (move === "") {
                newmove = cell;
            } else {
                if (move === cell) {
                    if (this.variants.includes("capture")) {
                        const wonLines = this.getWonLines(this.currplayer, [move]);
                        if (wonLines.length > 0) {
                            newmove = this.normaliseMove(`${move},${move}`);
                        } else {
                            newmove = "";
                        }
                    } else {
                        newmove = "";
                    }
                } else {
                    newmove = this.normaliseMove(`${move},${cell}`);
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
            if (this.stack.length === 1) {
                result.message = i18next.t("apgames:validation.majorities.INITIAL_INSTRUCTIONS_FIRST");
            } else {
                result.message = i18next.t("apgames:validation.majorities.INITIAL_INSTRUCTIONS");
            }
            return result;
        }
        const moves = m.split(",");
        if (moves.length > 2) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.majorities.TOO_MANY_MOVES");
            return result;
        }
        if (this.stack.length === 1 && moves.length > 1) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.majorities.TOO_MANY_MOVES_FIRST");
            return result;
        }
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
        const captured: string[] = [];
        for (const [i, move] of moves.entries()) {
            if (this.board.has(move) && !captured.includes(move)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", { where: move });
                return result;
            }
            if (this.holes.includes(move)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.majorities.HOLE", { where: move });
                return result;
            }
            if (this.variants.includes("capture") && i === 0) {
                const wonLines = this.getWonLines(this.currplayer, [move]);
                for (const line of wonLines) {
                    captured.push(...this.getCaptures(line));
                }
            }
        }
        if (moves.length === 2 && moves[0] === moves[1] && captured.length === 0) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.majorities.OCCUPIED", { where: moves[0] });
            return result;
        }
        if (moves.length === 1 && this.stack.length > 1) {
            const emptyCells = (this.graph.listCells(false) as string[]).filter(cell => !this.board.has(cell) && !this.holes.includes(cell));
            if (emptyCells.length > 1) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.majorities.ANOTHER");
                return result;
            }
        }
        const normalised = this.normaliseMove(m);
        if (m !== normalised) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.majorities.NORMALISE", { normalised });
            return result;
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private getDirectionWinners(): [[playerid | null, playerid | null, playerid | null], number[]] {
        // Get the winners of each direction.
        // If a direction is yet to be claimed, there will be a null in its place.
        const directionWinners: [playerid | null, playerid | null, playerid | null] = [null, null, null];
        const newDirectionWinners: number[] = [];
        for (const [i, directionWinner] of this.directionWinners.entries()) {
            if (directionWinner !== null) {
                directionWinners[i] = directionWinner;
            } else {
                const directionLineWinners = this.lineWinners[i];
                const score: [number, number] = [0, 0];
                for (const winner of directionLineWinners) {
                    if (winner === 1) {
                        score[0]++;
                    } else if (winner === 2) {
                        score[1]++;
                    }
                }
                if (score[0] >= Math.ceil(directionLineWinners.length / 2)) {
                    directionWinners[i] = 1;
                    newDirectionWinners.push(i);
                } else if (score[1] >= Math.ceil(directionLineWinners.length / 2)) {
                    directionWinners[i] = 2;
                    newDirectionWinners.push(i);
                }
            }
        }
        return [directionWinners, newDirectionWinners];
    }

    private getWonLines(player: playerid, ats: string[]): string[] {
        // Get the new line winners after a move.
        const wonLines: Set<string> = new Set();
        for (const at of ats) {
            for (const line of this.cell2lines.get(at)!) {
                const [i, j] = this.line2indices(line);
                const existingWinner = this.lineWinners[i][j];
                if (existingWinner === null) {
                    const ray = this.allRays[i][j];
                    const threshold = this.allThresholds[i][j];
                    let score = 0;
                    for (const cell of ray) {
                        if (ats.includes(cell) || this.board.has(cell) && this.board.get(cell) === player) { score++; }
                    }
                    if (score >= threshold) { wonLines.add(line); }
                }
            }
        }
        return Array.from(wonLines);
    }

    private line2indices(line: string): [number, number] {
        // Get the indices of the line in the scores array.
        const dir = line[0];
        const num = parseInt(line.slice(1), 10);
        const index = dir === "H" ? 0 : dir === "A" ? 1 : 2;
        return [index, num - 1];
    }

    private indices2line(dirIndex: number, lineIndex: number): string {
        // Get the line from the indices.
        // dirIndex indexes in the order of horizontal, ascending, descending.
        // lineIndex indexes the lines in the clockwise direction.
        return `${directionMap.get(dirIndex)}${lineIndex + 1}`;
    }

    private getCaptures(line: string): string[] {
        // Get the cells that have been captured in a line.
        if (!this.variants.includes("capture")) { return []; }
        const [d, l] = this.line2indices(line);
        const ray = this.allRays[d][l];
        const captures: string[] = [];
        for (const cell of ray) {
            if (this.board.has(cell)) {
                captures.push(cell);
            }
        }
        return captures;
    }

    private getNewLineWinners(wonLines: string[], player: playerid): [(playerid | null)[], (playerid | null)[], (playerid | null)[]] {
        // Get the new line winners after a move.
        const newLineWinners = this.lineWinners.map(a => [...a]) as [(playerid | null)[], (playerid | null)[], (playerid | null)[]];
        for (const line of wonLines) {
            const [i, j] = this.line2indices(line);
            newLineWinners[i][j] = player;
        }
        return newLineWinners;
    }

    public move(m: string, { partial = false, trusted = false } = {}): MajoritiesGame {
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
            if (!partial && !this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", { move: m }));
            }
        }
        if (m.length === 0) { return this; }
        this.results = [];
        const moves = m.split(",");
        for (const move of moves) {
            this.results.push({ type: "place", where: move });
            this.board.set(move, this.currplayer);
            const wonLines = this.getWonLines(this.currplayer, [move]);
            if (wonLines.length > 0) {
                this.lineWinners = this.getNewLineWinners(wonLines, this.currplayer);
                for (const line of wonLines) {
                    this.results.push({ type: "claim", where: line, what: "line" });
                    const captures = this.getCaptures(line);
                    if (captures.length > 0) {
                        for (const cell of captures) {
                            this.board.delete(cell);
                        }
                        this.results.push({ type: "capture", where: captures.join(","), count: captures.length });
                    }
                }
                const [directionWinners, newDirectionWinners] = this.getDirectionWinners();
                if (newDirectionWinners.length > 0) {
                    this.directionWinners = directionWinners;
                    for (const i of newDirectionWinners) {
                        this.results.push({ type: "claim", where: directionMap.get(i), what: "direction" });
                    }
                }
            }
        }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): MajoritiesGame {
        const otherPlayer = this.currplayer % 2 + 1 as playerid;
        if (this.directionWinners.filter(w => w === otherPlayer).length > 1) {
            this.gameover = true;
            this.winner = [otherPlayer];
        }
        if (this.gameover) {
            this.results.push({ type: "eog" });
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public state(): IMajoritiesState {
        return {
            game: MajoritiesGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: MajoritiesGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            lineWinners: this.lineWinners.map(a => [...a]) as [(playerid | null)[], (playerid | null)[], (playerid | null)[]],
            directionWinners: [...this.directionWinners],
        };
    }

    private line2dispCoords(line: string): [[number, number], string] {
        // Get the display coordinates given a line identifier.
        const dir = line[0];
        const num = line.slice(1);
        const index = dir === "H" ? 0 : dir === "A" ? 1 : 2;
        return [this.dispScoreCoords[index][parseInt(num, 10) - 1], dir];
    }

    public render(): APRenderRep {
        // Build piece string
        const pstr: string[][] = [new Array(this.boardSize + 1).fill("-") as string[]]
        const cells = this.graph.listCells(true);
        for (const row of cells) {
            const pieces: string[] = ["-"];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const owner = this.board.get(cell)!;
                    if (owner === 1) {
                        pieces.push("A");
                    } else {
                        pieces.push("B");
                    }
                } else {
                    pieces.push("-");
                }
            }
            pieces.push("-");
            pstr.push(pieces);
        }
        pstr.push(new Array(this.boardSize + 1).fill("-") as string[]);
        const blocked: RowCol[] = [];
        for (const [x, y] of this.blockedCoords) {
            blocked.push({ row: y, col: x });
        }

        const markers: Array<MarkerGlyph | MarkerLine | MarkerFlood > = [];
        // For the markers around the board to show the claimed lines.
        const coordsHN: RowCol[] = [];
        const coordsH1: RowCol[] = [];
        const coordsH2: RowCol[] = [];
        for (const [i, [x, y]] of this.dispScoreCoords[0].entries()) {
            if (this.lineWinners[0][i] === 1) {
                coordsH1.push({ row: y, col: x });
            } else if (this.lineWinners[0][i] === 2) {
                coordsH2.push({ row: y, col: x });
            } else {
                coordsHN.push({ row: y, col: x });
            }
        }
        const coordsAN: RowCol[] = [];
        const coordsA1: RowCol[] = [];
        const coordsA2: RowCol[] = [];
        for (const [i, [x, y]] of this.dispScoreCoords[1].entries()) {
            if (this.lineWinners[1][i] === 1) {
                coordsA1.push({ row: y, col: x });
            } else if (this.lineWinners[1][i] === 2) {
                coordsA2.push({ row: y, col: x });
            } else {
                coordsAN.push({ row: y, col: x });
            }
        }
        const coordsDN: RowCol[] = [];
        const coordsD1: RowCol[] = [];
        const coordsD2: RowCol[] = [];
        for (const [i, [x, y]] of this.dispScoreCoords[2].entries()) {
            if (this.lineWinners[2][i] === 1) {
                coordsD1.push({ row: y, col: x });
            } else if (this.lineWinners[2][i] === 2) {
                coordsD2.push({ row: y, col: x });
            } else {
                coordsDN.push({ row: y, col: x });
            }
        }
        if (coordsHN.length > 0) {
            markers.push({ type: "glyph", glyph: "HN", points: coordsHN as [RowCol, ...RowCol[]] });
        }
        if (coordsH1.length > 0) {
            markers.push({ type: "glyph", glyph: "H1", points: coordsH1 as [RowCol, ...RowCol[]] });
        }
        if (coordsH2.length > 0) {
            markers.push({ type: "glyph", glyph: "H2", points: coordsH2 as [RowCol, ...RowCol[]] });
        }
        if (coordsAN.length > 0) {
            markers.push({ type: "glyph", glyph: "AN", points: coordsAN as [RowCol, ...RowCol[]] });
        }
        if (coordsA1.length > 0) {
            markers.push({ type: "glyph", glyph: "A1", points: coordsA1 as [RowCol, ...RowCol[]] });
        }
        if (coordsA2.length > 0) {
            markers.push({ type: "glyph", glyph: "A2", points: coordsA2 as [RowCol, ...RowCol[]] });
        }
        if (coordsDN.length > 0) {
            markers.push({ type: "glyph", glyph: "DN", points: coordsDN as [RowCol, ...RowCol[]] });
        }
        if (coordsD1.length > 0) {
            markers.push({ type: "glyph", glyph: "D1", points: coordsD1 as [RowCol, ...RowCol[]] });
        }
        if (coordsD2.length > 0) {
            markers.push({ type: "glyph", glyph: "D2", points: coordsD2 as [RowCol, ...RowCol[]] });
        }
        // To show the claimed directions.
        if (this.directionWinners[0] !== null) {
            markers.push({ type: "line", colour: this.directionWinners[0], width: 6, shorten: 0.1, points: [{ row: 0, col: this.boardSize }, { row: 2, col: this.boardSize + 2 }] });
            markers.push({ type: "line", colour: this.directionWinners[0], width: 6, shorten: 0.1, points: [{ row: 2 * this.boardSize - 2, col: this.boardSize + 2 }, { row: 2 * this.boardSize, col: this.boardSize }] });
            markers.push({ type: "line", colour: this.directionWinners[0], width: 6, points: [{ row: 1, col: this.boardSize + 1 }, { row: this.boardSize, col: 2 * this.boardSize }] });
            markers.push({ type: "line", colour: this.directionWinners[0], width: 6, points: [{ row: this.boardSize, col: 2 * this.boardSize }, { row: 2 * this.boardSize - 1, col: this.boardSize + 1 }] });
        }
        if (this.directionWinners[1] !== null) {
            markers.push({ type: "line", colour: this.directionWinners[1], width: 6, shorten: 0.1, points: [{ row: this.boardSize, col: 0 }, { row: this.boardSize + 2, col: 0 }] });
            markers.push({ type: "line", colour: this.directionWinners[1], width: 6, shorten: 0.1, points: [{ row: 2 * this.boardSize, col: this.boardSize - 2 }, { row: 2 * this.boardSize, col: this.boardSize }] });
            markers.push({ type: "line", colour: this.directionWinners[1], width: 6, points: [{ row: this.boardSize + 1, col: 0 }, { row: 2 * this.boardSize, col: 0 }] });
            markers.push({ type: "line", colour: this.directionWinners[1], width: 6, points: [{ row: 2 * this.boardSize, col: 0 }, { row: 2 * this.boardSize, col: this.boardSize - 1 }] });
        }
        if (this.directionWinners[2] !== null) {
            markers.push({ type: "line", colour: this.directionWinners[2], width: 6, shorten: 0.1, points: [{ row: this.boardSize, col: 0 }, { row: this.boardSize - 2, col: 0 }] });
            markers.push({ type: "line", colour: this.directionWinners[2], width: 6, shorten: 0.1, points: [{ row: 0, col: this.boardSize - 2 }, { row: 0, col: this.boardSize }] });
            markers.push({ type: "line", colour: this.directionWinners[2], width: 6, points: [{ row: this.boardSize - 1, col: 0 }, { row: 0, col: 0 }] });
            markers.push({ type: "line", colour: this.directionWinners[2], width: 6, points: [{ row: 0, col: 0 }, { row: 0, col: this.boardSize - 1 }] });
        }
        // For the holes in the board.
        if (this.holes.length > 0) {
            const holes: RowCol[] = [];
            for (const cell of this.holes) {
                const [x, y] = this.algebraic2coords(cell);
                holes.push({ row: y + 1, col: x + 1 });
            }
            markers.push({ type: "flood", colour: "#444", opacity: 0.6, points: holes as [RowCol, ...RowCol[]] });
        }

        // Build rep
        const rep: APRenderRep =  {
            options: ["hide-labels"],
            board: {
                style: "hex-of-hex",
                minWidth: this.boardSize + 1,
                maxWidth: 2 * this.boardSize + 1,
                markers,
                blocked: blocked as [RowCol, ...RowCol[]],
            },
            legend: {
                A: { name: "piece", colour: 1 },
                B: { name: "piece", colour: 2 },
                HN: { name: "hline", colour: "_context_strokes", opacity: 0.2 },
                H1: { name: "hline", colour: 1 },
                H2: { name: "hline", colour: 2 },
                HH: { name: "hline", colour: "#FFFF00", opacity: 0.5 },
                AN: { name: "hline", colour: "_context_strokes", opacity: 0.2, rotate: 120 },
                A1: { name: "hline", colour: 1, rotate: 120 },
                A2: { name: "hline", colour: 2, rotate: 120 },
                AH: { name: "hline", colour: "#FFFF00", opacity: 0.5, rotate: 120 },
                DN: { name: "hline", colour: "_context_strokes", opacity: 0.2, rotate: 60 },
                D1: { name: "hline", colour: 1, rotate: 60 },
                D2: { name: "hline", colour: 2, rotate: 60 },
                DH: { name: "hline", colour: "#FFFF00", opacity: 0.5, rotate: 60 },
            },
            pieces: pstr.map(p => p.join("")).join("\n"),
        };

        // Add annotations
        rep.annotations = [];
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
                    const [x, y] = this.graph.algebraic2coords(move.where!);
                    rep.annotations.push({ type: "enter", targets: [{ row: y + 1, col: x + 1 }] });
                } else if (move.type === "capture") {
                    for (const cell of move.where!.split(",")) {
                        const [x, y] = this.graph.algebraic2coords(cell);
                        rep.annotations.push({ type: "exit", targets: [{ row: y + 1, col: x + 1 }] });
                    }
                } else if (move.type === "claim") {
                    if (move.what === "line") {
                        const [[x, y], dir] = this.line2dispCoords(move.where!);
                        if (dir === "H") {
                            rep.annotations.push({ type: "glyph", glyph: "HH", targets: [{ row: y, col: x }] });
                        } else if (dir === "A") {
                            rep.annotations.push({ type: "glyph", glyph: "AH", targets: [{ row: y, col: x }] });
                        } else {
                            rep.annotations.push({ type: "glyph", glyph: "DH", targets: [{ row: y, col: x }] });
                        }
                    } else {
                        if (move.where === "H") {
                            rep.annotations.push({
                                type: "move",
                                targets: [{ row: 0, col: this.boardSize }, { row: this.boardSize, col: 2 * this.boardSize }, { row: 2 * this.boardSize, col: this.boardSize }],
                                opacity: 0.5,
                                // strokeWidth: 0.1,
                                colour: "#FFFF00",
                                arrow: false,
                            });
                        } else if (move.where === "A") {
                            rep.annotations.push({
                                type: "move",
                                targets: [{ row: this.boardSize, col: 0 }, { row: 2 * this.boardSize, col: 0 }, { row: 2 * this.boardSize, col: this.boardSize }],
                                opacity: 0.5,
                                // strokeWidth: 0.1,
                                colour: "#FFFF00",
                                arrow: false,
                            });
                        } else {
                            rep.annotations.push({
                                type: "move",
                                targets: [{ row: this.boardSize, col: 0 }, { row: 0, col: 0 }, { row: 0, col: this.boardSize }],
                                opacity: 0.5,
                                // strokeWidth: 0.1,
                                colour: "#FFFF00",
                                arrow: false,
                            });
                        }
                    }
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
            case "place":
                node.push(i18next.t("apresults:PLACE.nowhat", { player, where: r.where }));
                resolved = true;
                break;
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.majorities", { player, where: r.where, count: r.count }));
                resolved = true;
                break;
            case "claim":
                if (r.what === "line") {
                    node.push(i18next.t("apresults:CLAIM.majorities_line", { player, where: r.where }));
                } else {
                    if (r.where === "H") {
                        node.push(i18next.t("apresults:CLAIM.majorities_H", { player }));
                    } else if (r.where === "A") {
                        node.push(i18next.t("apresults:CLAIM.majorities_A", { player }));
                    } else {
                        node.push(i18next.t("apresults:CLAIM.majorities_D", { player }));
                    }
                }
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): MajoritiesGame {
        return new MajoritiesGame(this.serialize());
    }
}
