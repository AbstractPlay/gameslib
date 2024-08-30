import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, MarkerFlood, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";

type playerid = 1 | 2;

const columnLabels = "abcdefghijklmnopqrstuvwxyz".split("");

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: number[][];
    lastmove?: string;
    scores: [number, number];
}

export interface IBukuState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class BukuGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Buku",
        uid: "buku",
        playercounts: [2],
        version: "20240811",
        dateAdded: "2024-08-26",
        // i18next.t("apgames:descriptions.buku")
        description: "apgames:descriptions.buku",
        urls: ["https://mancala.fandom.com/wiki/Buku"],
        people: [
            {
                type: "designer",
                name: "Jorge Gomez Arrausi",
                urls: ["https://boardgamegeek.com/boardgamedesigner/1544/jorge-gomez-arrausi"]
            },
        ],
        variants: [
            {uid: "size-6", group: "board"},
            {uid: "size-10", group: "board"},
        ],
        categories: ["goal>score>race", "mechanic>capture",  "mechanic>move>sow", "board>shape>rect", "board>connect>rect", "components>simple>1c"],
        flags: ["scores", "no-moves", "custom-randomization"],
    };

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardSize);
    }

    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardSize);
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: number[][];
    public scores!: [number, number];
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private boardSize = 0;
    private dots: string[] = [];

    constructor(state?: IBukuState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            this.boardSize = this.getBoardSize();
            const fresh: IMoveState = {
                _version: BukuGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: this.getInitialBoard(),
                scores: [0, 0],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IBukuState;
            }
            if (state.game !== BukuGame.gameinfo.uid) {
                throw new Error(`The Buku game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
            this.boardSize = this.getBoardSize();
        }
        this.load();
    }

    public load(idx = -1): BukuGame {
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
        this.board = state.board.map((row) => row.slice());
        this.scores = [state.scores[0], state.scores[1]];
        this.lastmove = state.lastmove;
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
        return 8;
    }

    private getInitialBoard(): number[][] {
        // Create initial board.
        const board: number[][] = [];
        for (let row = 0; row < this.boardSize; row++) {
            board.push(Array.from({ length: this.boardSize }, () => 1));
        }
        return board;
    }

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }
        const moves: string[] = [];
        return moves;
    }

    private getNeighbours(cell: string): string[] {
        // Get the orthogonal neighbours of a cell.
        const [x, y] = this.algebraic2coords(cell);
        const neighbours: string[] = [];
        const deltas = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        for (const [dx, dy] of deltas) {
            const [nx, ny] = [x + dx, y + dy];
            if (nx >= 0 && nx < this.boardSize && ny >= 0 && ny < this.boardSize) {
                neighbours.push(this.coords2algebraic(nx, ny));
            }
        }
        return neighbours;
    }

    public randomMove(): string {
        const rowColIndex = Math.floor(Math.random() * this.boardSize);
        const rowCol = this.currplayer === 1 ? this.boardSize - rowColIndex : columnLabels[rowColIndex];
        const count = this.stack.length === 1 ? this.boardSize + 1: this.collectCount(this.currplayer, rowColIndex);
        if (count === 0) { return `${rowCol}(${count}):`; }
        outer:
        while (true) {
            const startCell = this.coords2algebraic(Math.floor(Math.random() * this.boardSize), Math.floor(Math.random() * this.boardSize));
            const sows: string[] = [startCell];
            let remaining = count - 1;
            let currCell = startCell;
            while (remaining > 0) {
                const neighbours = this.getNeighbours(currCell).filter(cell => !sows.includes(cell));
                if (neighbours.length === 0) { continue outer; }
                currCell = neighbours[Math.floor(Math.random() * neighbours.length)];
                sows.push(currCell);
                remaining--;
            }
            return this.normaliseMove(`${rowCol}(${count}):${sows.join(",")}`);
        }
    }

    private collectCount(player: playerid, rowCol: number) {
        // Count the number of pieces in a row or column based on the player.
        // If player is 1, collect the row. If player is 2, collect the column.
        let count = 0;
        if (player === 1) {
            for (let col = 0; col < this.boardSize; col++) {
                count += this.board[rowCol][col];
            }
        } else {
            for (let row = 0; row < this.boardSize; row++) {
                count += this.board[row][rowCol];
            }
        }
        return count;
    }

    private getLine(cells: string[]): string[] {
        // Expand the cells.
        // The normalised move notation omits intermediate cells when sowing in the same direction.
        // This functions expands the cells to get the full line.
        // If the cells listed cannot be expanded such that all subsequent cells are neighbours,
        // we just directly append the invalid cells to the line, so that the validation can handle it later.
        if (cells.length === 0) { return []; }
        const line = [cells[0]];
        for (let i = 1; i < cells.length; i++) {
            const prev = cells[i - 1];
            const curr = cells[i];
            const [x1, y1] = this.algebraic2coords(prev);
            const [x2, y2] = this.algebraic2coords(curr);
            if (x1 === x2) {
                if (y1 === y2) {
                    line.push(prev);
                }
                const direction = y1 < y2 ? 1 : -1;
                for (let j = y1 + direction; j !== y2 + direction; j += direction) {
                    const cell = this.coords2algebraic(x1, j);
                    if (line.includes(cell)) {
                        line.push(curr);
                        break;
                    }
                    line.push(cell);
                }
            } else if (y1 === y2) {
                const direction = x1 < x2 ? 1 : -1;
                for (let j = x1 + direction; j !== x2 + direction; j += direction) {
                    const cell = this.coords2algebraic(j, y1);
                    if (line.includes(cell)) {
                        line.push(curr);
                        break;
                    }
                    line.push(cell);
                }
            } else {
                line.push(curr);
            }
        }
        return line;
    }

    private normaliseMove(move: string): string {
        // Normalise the move string.
        // We don't actually do much here except to remove unnecessary cells
        // when sowing in the same direction.
        move = move.toLowerCase().replace(/\s+/g, "");
        const [collectStr, sowStr] = move.split(":");
        const line = this.getLine(sowStr.split(","));
        // Indices that need to be removed.
        const toRemove: number[] = [];
        for (let i = 2; i < line.length; i++) {
            const prev = line[i - 2];
            const curr = line[i - 1];
            const next = line[i];
            const [x1, y1] = this.algebraic2coords(prev);
            const [x2, y2] = this.algebraic2coords(curr);
            const [x3, y3] = this.algebraic2coords(next);
            if (x1 === x2 && x2 === x3 && (y1 < y2 && y2 < y3 || y1 > y2 && y2 > y3) || y1 === y2 && y2 === y3 && (x1 < x2 && x2 < x3 || x1 > x2 && x2 > x3)) {
                toRemove.push(i - 1);
            }
        }
        const newLine: string[] = [];
        for (let i = 0; i < line.length; i++) {
            if (toRemove.includes(i)) { continue; }
            newLine.push(line[i]);
        }
        return `${collectStr}:${newLine.join(",")}`;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = "";
            if (move === "") {
                if (this.currplayer === 1) {
                    const first = this.boardSize - row;
                    const count = this.collectCount(1, row);
                    if (this.stack.length === 1) {
                        newmove = `${first}(${count + 1}):`;
                    } else {
                        newmove = `${first}(${count}):`;
                    }
                } else {
                    const first = columnLabels[col];
                    const count = this.collectCount(2, col);
                    newmove = `${first}(${count}):`;
                }
            } else {
                const cell = this.coords2algebraic(col, row);
                const stripped = move.replace(/\s+/g, "");
                if (stripped.endsWith(":")) {
                    newmove = `${stripped}${cell}`;
                } else {
                    const [collectStr, sowStr] = stripped.split(":");
                    if (sowStr === cell) {
                        newmove = `${collectStr}:`;
                    } else {
                        const sowed = sowStr.split(",");
                        const line = this.getLine(sowed);
                        if (line.includes(cell)) {
                            // Slice off the cells after cell including cell.
                            const idx = line.indexOf(cell);
                            if (idx < line.length - 1) {
                                line.splice(idx + 1);
                            }
                            newmove = this.normaliseMove(`${collectStr}:${line.join(",")}`);
                        } else {
                            newmove = this.normaliseMove(`${move},${cell}`);
                        }
                    }
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
            if (this.currplayer === 1) {
                result.message = i18next.t("apgames:validation.buku.INITIAL_INSTRUCTIONS_ROW");
            } else {
                result.message = i18next.t("apgames:validation.buku.INITIAL_INSTRUCTIONS_COL");
            }
            return result;
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const [collectStr, sowStr] = m.split(":");
        // Just a quick regex check for the collection before checking anything else.
        if (!/^(([a-zA-Z]+|\d+)\(\d+\))$/.test(collectStr)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.buku.INVALID_COLLECT", { move: collectStr });
            return result;
        }
        const [collect, rest] = collectStr.split("(");
        // Parse the collection.
        const collectCount = parseInt(rest.split(")")[0], 10);
        if (this.currplayer === 1) {
            const row = this.boardSize - parseInt(collect, 10);
            if (isNaN(row) || row < 0 || row >= this.boardSize) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.buku.INVALID_COLLECT_ROW", { row: collect });
                return result;
            }
            const collected = this.collectCount(1, row);
            if (this.stack.length === 1) {
                if (collected + 1 !== collectCount) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.buku.WRONG_COLLECT_COUNT_ROW_FIRST", { row: collect, count: collected + 1 });
                    return result;
                }
            } else if (collected !== collectCount) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.buku.WRONG_COLLECT_COUNT_ROW", { row: collect, count: collected });
                return result;
            }
        } else {
            if (!columnLabels.includes(collect)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.buku.INVALID_COLLECT_COL", { col: collect });
                return result;
            }
            const col = columnLabels.indexOf(collect);
            if (col < 0 || col >= this.boardSize) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.buku.INVALID_COLLECT_COL", { col: collect });
                return result;
            }
            const collected = this.collectCount(2, col);
            if (collected !== collectCount) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.buku.WRONG_COLLECT_COUNT_COL", { col: collect, count: collected });
                return result;
            }
        }
        // Now parse the sowing.
        const sows = sowStr ? sowStr.split(",") : [];
        const line = this.getLine(sows);
        if (line.length > collectCount) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.buku.TOO_MANY_SOWS", { count: collectCount });
            return result;
        }
        const seen: Set<string> = new Set();
        for (const sow of line) {
            // valid cell
            try {
                const [x, y] = this.algebraic2coords(sow);
                // `algebraic2coords` does not check if the cell is on the board.
                if (x < 0 || x >= this.boardSize || y < 0 || y >= this.boardSize) {
                    throw new Error("Invalid cell");
                }
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: sow });
                return result;
            }
            if (seen.has(sow)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.buku.DUPLICATE_SOW", { where: sow });
                return result;
            }
            seen.add(sow);
        }
        for (let i = 1; i < line.length; i++) {
            const prev = line[i - 1];
            const curr = line[i];
            if (!this.isNeighbour(prev, curr)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.buku.NOT_NEIGHBOURS", { prev, curr });
                return result;
            }
        }
        // Final regex validation.
        if (!/^(([a-zA-Z]+|\d+)\(\d+\)):([a-z]\d+(,[a-z]\d+)*)?$/.test(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.buku.INVALID_MOVE", { move: m });
            return result;
        }
        if (line.length < collectCount) {
            if (line.length === 0) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.buku.START_SOWING", { count: collectCount });
                return result;
            }
            if (this.getNeighbours(line[line.length - 1]).filter(cell => !line.includes(cell)).length === 0) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.buku.GO_BACK", { count: collectCount - line.length });
                return result;
            }
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.buku.CONTINUE", { count: collectCount - line.length });
            return result;
        }

        // Check if the move is normalised.
        const normalised = this.normaliseMove(m);
        if (m !== normalised) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.buku.NORMALISE", { normalised });
            return result;
        }

        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private isNeighbour(cell1: string, cell2: string): boolean {
        // Check if two cells are orthogonal neighbours.
        const [x1, y1] = this.algebraic2coords(cell1);
        const [x2, y2] = this.algebraic2coords(cell2);
        return Math.abs(x1 - x2) + Math.abs(y1 - y2) === 1;
    }

    private getDots(where: string, sowCount: number, sowed: string[]): string[] {
        // Get the possible places to sow to in an orthogonal direction.
        const [x, y] = this.algebraic2coords(where);
        const dots: string[] = [];
        const deltas = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        for (const [dx, dy] of deltas) {
            let [nx, ny] = [x, y];
            for (let i = 1; i <= sowCount; i++) {
                nx += dx;
                ny += dy;
                if (nx < 0 || nx >= this.boardSize || ny < 0 || ny >= this.boardSize) { break; }
                const cell = this.coords2algebraic(nx, ny);
                if (sowed.includes(cell)) { break; }
                dots.push(cell);
            }
        }
        return dots;
    }

    private getCaptures(player: playerid): [string, number][] {
        // Get the cells where capture has occured, and the counts.
        // We count as capture if the cell has 3 or more pieces.
        const captures: [string, number][] = [];
        for (let row = 0; row < this.boardSize; row++) {
            for (let col = 0; col < this.boardSize; col++) {
                if (player === 1 && row % 2 !== col % 2 || player === 2 && row % 2 === col % 2) { continue; }
                const count = this.board[row][col];
                if (count >= 3) {
                    captures.push([this.coords2algebraic(col, row), count]);
                }
            }
        }
        return captures;
    }

    public move(m: string, { partial = false, trusted = false } = {}): BukuGame {
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
            // // No move list
            // if (!partial && !this.moves().includes(m)) {
            //     throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", { move: m }));
            // }
        }
        if (m.length === 0) { return this; }
        this.dots = [];
        this.results = [];
        const [collectStr, sowStr] = m.split(":");
        const sows = sowStr ? sowStr.split(",") : [];
        const line = this.getLine(sows);
        const collect = collectStr.split("(")[0];
        let collectCount: number | undefined;
        if (this.currplayer === 1) {
            const row = this.boardSize - parseInt(collect, 10);
            let [c1, c2] = [0, 0];
            for (let col = 0; col < this.boardSize; col++) {
                if (this.board[row][col] === 0) { continue; }
                if (row % 2 === col % 2) {
                    c1 += this.board[row][col];
                } else {
                    c2 += this.board[row][col];
                }
                this.board[row][col] = 0;
            }
            collectCount = c1 + c2;
            if (this.stack.length === 1) {
                collectCount += 1;
                this.results.push({ type: "take", from: collect, count: collectCount, what: `${c1},${c2}`, how: "row_bonus" });
            } else {
                this.results.push({ type: "take", from: collect, count: collectCount, what: `${c1},${c2}`, how: "row" });
            }
        } else {
            const col = columnLabels.indexOf(collect);
            let [c1, c2] = [0, 0];
            for (let row = 0; row < this.boardSize; row++) {
                if (this.board[row][col] === 0) { continue; }
                if (row % 2 === col % 2) {
                    c1 += this.board[row][col];
                } else {
                    c2 += this.board[row][col];
                }
                this.board[row][col] = 0;
            }
            collectCount = c1 + c2;
            this.results.push({ type: "take", from: collect, count: collectCount, what: `${c1},${c2}`, how: "col" });
        }
        for (const sow of line) {
            const [x, y] = this.algebraic2coords(sow);
            this.board[y][x] += 1;
        }
        if (line.length > 0) {
            this.results.push({ type: "sow", pits: line });
        }
        const remaining = collectCount - line.length;
        if (remaining === 0) {
            const captures = this.getCaptures(this.currplayer);
            if (captures.length > 0) {
                let totalCaptures = 0;
                for (const [cell, count] of captures) {
                    const [x, y] = this.algebraic2coords(cell);
                    this.board[y][x] = 0;
                    this.results.push({ type: "capture", where: cell, count });
                    totalCaptures += count;
                }
                this.scores[this.currplayer - 1] += totalCaptures;
            }
            this.dots = [];
        } else if (line.length > 0) {
            this.dots = this.getDots(line[line.length - 1], remaining, line);
        }
        if (partial) { return this; }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    private hasMoreThanOne(): boolean {
        // Check if any cell has more than one piece.
        for (let row = 0; row < this.boardSize; row++) {
            for (let col = 0; col < this.boardSize; col++) {
                if (this.board[row][col] > 1) {
                    return true;
                }
            }
        }
        return false;
    }

    private pieceCounts(): [number, number] {
        // Get the count of pieces on each player's cells.
        let [c1, c2] = [0, 0];
        for (let row = 0; row < this.boardSize; row++) {
            for (let col = 0; col < this.boardSize; col++) {
                if (row % 2 === col % 2) {
                    c1 += this.board[row][col];
                } else {
                    c2 += this.board[row][col];
                }
            }
        }
        return [c1, c2];
    }

    protected checkEOG(): BukuGame {
        if (!this.hasMoreThanOne()) {
            const pieceCounts = this.pieceCounts();
            this.gameover = true;
            this.scores[0] += pieceCounts[0];
            this.scores[1] += pieceCounts[1];
            this.results.push({ type: "eog", reason: "singletons" });
            this.results.push({ type: "claim", count: pieceCounts[0], who: 1, how: "singletons" });
            this.results.push({ type: "claim", count: pieceCounts[1], who: 2, how: "singletons" });
            this.winner = this.scores[0] > this.scores[1] ? [1] : this.scores[0] < this.scores[1] ? [2] : [1, 2];
        }
        if (!this.gameover && this.scores.some(s => s > this.boardSize * this.boardSize / 2)) {
            this.gameover = true;
            this.winner = this.scores[0] > this.scores[1] ? [1] : this.scores[0] < this.scores[1] ? [2] : [1, 2];
            this.results.push({ type: "eog" });
        }
        if (!this.gameover) {
            const stateCount = this.stateCount(new Map<string, any>([["board", this.board]]));
            if (stateCount >= 1) {
                this.gameover = true;
                const remainingCount = this.board.flat().reduce((acc, val) => acc + val, 0);
                this.scores[this.currplayer - 1] += remainingCount;
                this.results.push({ type: "eog", reason: "repetition" });
                this.results.push({ type: "claim", count: remainingCount, who: this.currplayer, how: "repetition" });
                this.winner = this.scores[0] > this.scores[1] ? [1] : this.scores[0] < this.scores[1] ? [2] : [1, 2];
            }
        }
        if (this.gameover) {
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public state(): IBukuState {
        return {
            game: BukuGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: BukuGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: this.board.map((row) => row.slice()),
            scores: [this.scores[0], this.scores[1]],
        };
    }

    private isNewResult(): boolean {
        // Check if the `this.result` is new, or if it was copied from the previous state.
        return this.results.every(r => r !== this.stack[this.stack.length - 1]._results[0]);
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        let ended: "singletons" | "repetition" | undefined;
        if (this.gameover) {
            if (this.results.some(r => r.type === "eog" && r.reason === "singletons")) {
                ended = "singletons";
            } else if (this.results.some(r => r.type === "eog" && r.reason === "repetition")) {
                ended = "repetition";
            }
        }
        for (let row = 0; row < this.boardSize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            let pieces: string[] = [];
            for (let col = 0; col < this.boardSize; col++) {
                const count = this.board[row][col];
                if (count > 0) {
                    if (ended === "singletons") {
                        if (row % 2 === col % 2) {
                            pieces.push("A".repeat(count));
                        } else {
                            pieces.push("B".repeat(count));
                        }
                    } else if (ended === "repetition") {
                        if (this.currplayer === 1) {
                            pieces.push("A".repeat(count));
                        } else {
                            pieces.push("B".repeat(count));
                        }
                    } else {
                        pieces.push("C".repeat(count));
                    }
                } else {
                    pieces.push("-");
                }
            }
            if (pieces.every(p => p === "-")) {
                pieces = ["_"];
            }
            pstr += pieces.join(",");
        }

        const markers: MarkerFlood[] = [];
        const cells1: RowCol[] = [];
        const cells2: RowCol[] = [];
        for (let row = 0; row < this.boardSize; row++) {
            for (let col = 0; col < this.boardSize; col++) {
                if (row % 2 === col % 2) {
                    cells1.push({ row, col });
                } else {
                    cells2.push({ row, col });
                }
            }
        }
        markers.push({ type: "flood", points: cells1 as [RowCol, ...RowCol[]], colour: 1, opacity: 0.5 });
        markers.push({ type: "flood", points: cells2 as [RowCol, ...RowCol[]], colour: 2, opacity: 0.5 });

        // Build rep
        const rep: APRenderRep =  {
            renderer: "stacking-offset",
            board: {
                style: "squares",
                width: this.boardSize,
                height: this.boardSize,
                markers,
            },
            legend: {
                A: [{ name: "piece", colour: 1 }],
                B: [{ name: "piece", colour: 2 }],
                C: [{ name: "piece", colour: 3 }],
            },
            pieces: pstr,
        };

        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "take") {
                    if (move.how === "row" || move.how === "row_bonus") {
                        const row = this.boardSize - parseInt(move.from, 10);
                        rep.annotations.push({ type: "move", targets: [{ row, col: 0 }, { row, col: this.boardSize - 1 }], dashed: [4], arrow: false, opacity: 0.8, colour: 1 });
                    } else {
                        const col = columnLabels.indexOf(move.from);
                        rep.annotations.push({ type: "move", targets: [{ row: 0, col }, { row: this.boardSize - 1, col }], dashed: [4], arrow: false, opacity: 0.8, colour: 2 });
                    }
                } else if (move.type === "capture") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({ type: "exit", targets: [{ row: y, col: x }] });
                } else if (move.type === "sow") {
                    if (move.pits.length > 1) {
                        const targets: RowCol[] = [];
                        for (const cell of move.pits) {
                            const [x, y] = this.algebraic2coords(cell);
                            targets.push({ row: y, col: x })
                        }
                        rep.annotations.push({ type: "move", targets: targets as [RowCol, ...RowCol[]] });
                    }
                }
            }
        }
        const prevBoard = this.stack.length === 1 ? this.getInitialBoard() : this.isNewResult() ? this.stack[this.stack.length - 1].board : this.stack[this.stack.length - 2].board;
        const deltas: { row: number; col: number; delta: number }[] = [];
        for (let row = 0; row < this.boardSize; row++) {
            for (let col = 0; col < this.boardSize; col++) {
                const diff = this.board[row][col] - prevBoard[row][col];
                if (diff !== 0) {
                    deltas.push({ row, col, delta: diff });
                }
            }
        }
        if (deltas.length > 0) {
            rep.annotations.push({ type: "deltas", deltas });
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

    public chatLog(players: string[]): string[][] {
        // Use `chatLog` to determine if capture is self-capture.
        const result: string[][] = [];
        for (const state of this.stack) {
            if (state._results !== undefined && state._results.length > 0) {
                const node: string[] = [(state._timestamp && new Date(state._timestamp).toISOString()) || "unknown"];
                let otherPlayer = state.currplayer as number - 1;
                if (otherPlayer < 1) {
                    otherPlayer = this.numplayers;
                }
                let name = `Player ${otherPlayer}`;
                if (otherPlayer <= players.length) {
                    name = players[otherPlayer - 1];
                }
                for (const r of state._results) {
                    if (!this.chat(node, name, state._results, r)) {
                        switch (r.type) {
                            case "take":
                                if (r.how === "row_bonus") {
                                    node.push(i18next.t("apresults:TAKE.buku_row_bonus", { player: name, row: r.from, count: r.count! - 1 }));
                                } else if (r.how === "row") {
                                    node.push(i18next.t("apresults:TAKE.buku_row", { player: name, row: r.from, count: r.count }));
                                } else {
                                    node.push(i18next.t("apresults:TAKE.buku_col", { player: name, col: r.from, count: r.count }));
                                }
                                break;
                            case "sow":
                                node.push(i18next.t("apresults:SOW.into", { player: name, pits: r.pits.join(", ") }));
                                break;
                            case "capture":
                                node.push(i18next.t("apresults:CAPTURE.buku", { player: name, where: r.where, count: r.count }));
                                break;
                            case "claim":
                                const who = r.who !== this.currplayer ? name : players.filter(p => p !== name)[0];
                                if (r.how === "singletons") {
                                    node.push(i18next.t("apresults:CLAIM.buku_singletons", { player: who, count: r.count }));
                                } else {
                                    node.push(i18next.t("apresults:CLAIM.buku_repetition", { player: who, count: r.count }));
                                }
                                break;
                            case "eog":
                                if (r.reason === "singletons") {
                                    node.push(i18next.t("apresults:EOG.buku_singletons"));
                                } else if (r.reason === "repetition") {
                                    node.push(i18next.t("apresults:EOG.repetition_positional", { count: 1 }));
                                } else {
                                    node.push(i18next.t("apresults:EOG.default"));
                                }
                                break;
                            case "resigned":
                                let rname = `Player ${r.player}`;
                                if (r.player <= players.length) {
                                    rname = players[r.player - 1]
                                }
                                node.push(i18next.t("apresults:RESIGN", { player: rname }));
                                break;
                            case "timeout":
                                let tname = `Player ${r.player}`;
                                if (r.player <= players.length) {
                                    tname = players[r.player - 1]
                                }
                                node.push(i18next.t("apresults:TIMEOUT", { player: tname }));
                                break;
                            case "gameabandoned":
                                node.push(i18next.t("apresults:ABANDONED"));
                                break;
                            case "winners":
                                const names: string[] = [];
                                for (const w of r.players) {
                                    if (w <= players.length) {
                                        names.push(players[w - 1]);
                                    } else {
                                        names.push(`Player ${w}`);
                                    }
                                }
                                if (r.players.length === 0)
                                    node.push(i18next.t("apresults:WINNERSNONE"));
                                else
                                    node.push(i18next.t("apresults:WINNERS", { count: r.players.length, winners: names.join(", ") }));
                            break;
                        }
                    }
                }
                result.push(node);
            }
        }
        return result;
    }

    public getPlayerScore(player: playerid): number {
        return this.scores[player - 1];
    }

    public getPlayersScores(): IScores[] {
        const pieceCounts = this.gameover ? [0, 0] : this.pieceCounts();
        return [
            { name: i18next.t("apgames:status.buku.SCORES_ONBOARD"), scores: [`${this.getPlayerScore(1)} / ${pieceCounts[0]}`, `${this.getPlayerScore(2)} / ${pieceCounts[1]}`] },
        ]
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Scores / On board**\n\n";
        const scores = this.getPlayersScores()[0];
        for (let n = 1; n <= this.numplayers; n++) {
            status += `Player ${n}: ${scores.scores[n - 1]}\n\n`;
        }

        return status;
    }

    public clone(): BukuGame {
        return new BukuGame(this.serialize());
    }
}
