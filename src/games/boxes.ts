import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { shuffle } from "lodash";

type playerid = 1 | 2;
const columnLabels = "abcdefghijklmnopqrstuvwxyz".split("");

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    boardEdge: Map<string, playerid>;
    boardCell: Map<string, playerid>;
    lastmove?: string;
}

export interface IBoxesState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class BoxesGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Dots and Boxes",
        uid: "boxes",
        playercounts: [2],
        version: "20240908",
        dateAdded: "2024-09-14",
        // i18next.t("apgames:descriptions.boxes")
        description: "apgames:descriptions.boxes",
        urls: ["https://en.wikipedia.org/wiki/Dots_and_Boxes"],
        people: [
            {
                type: "designer",
                name: "Édouard Lucas",
            }
        ],
        variants: [
            { uid: "size-4x4", group: "board" },
            { uid: "size-5x7", group: "board" },
            { uid: "size-7x7", group: "board" },
        ],
        categories: ["goal>majority", "mechanic>place", "board>shape>rect", "board>connect>rect", "components>special"],
        flags: ["scores", "custom-randomization", "no-moves"],
    };

    public coords2algebraic(x: number, y: number): string {
        if (y === -1) {
            // For move generation. In dots and boxes, we can have coordinates
            // beyond the board edges.
            return GameBase.coords2algebraic(x, 0, this.height + 1);
        }
        return GameBase.coords2algebraic(x, y, this.height);
    }

    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.height);
    }

    private splitWall(wall: string): [number, number, string] {
        // Split the wall into its components.
        // To distinguish between the output from this method and the render output
        // we call the third element "orient" for orientation instead of "side".
        const cell = wall.slice(0, wall.length - 1);
        const orient = wall[wall.length - 1];
        const [x, y] = this.algebraic2coords(cell);
        return [x, y, orient];
    }

    private render2wall(row: number, col: number, side: string): string {
        // Converts click results from renderer into wall notation.
        // For games with interior-only walls, we use the north and east edges.
        // For games with exterior walls (like Dots and Boxes), we use the south and west edges.
        const orientation = side === "S" || side === "N" ? "h" : "v";
        const rowLabel = side === "N" ? this.height - row + 1 : this.height - row;
        const colNumber = side !== "E" ? col : col + 1;
        const colLabel = columnLabels[colNumber];
        return colLabel + rowLabel.toString() + orientation;
    }

    private endsWithHV(cell: string): boolean {
        // Check if the cell ends with an "h" or "v".
        const lastChar = cell[cell.length - 1];
        return lastChar === "h" || lastChar === "v";
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public boardEdge!: Map<string, playerid>;
    public boardCell!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private width = 0;
    private height = 0;
    private dots: string[] = [];

    constructor(state?: IBoxesState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: BoxesGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                boardEdge: new Map(),
                boardCell: new Map(),
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IBoxesState;
            }
            if (state.game !== BoxesGame.gameinfo.uid) {
                throw new Error(`The Boxes game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        [this.width, this.height] = this.getBoardDimensions();
        this.load();
    }

    public load(idx = -1): BoxesGame {
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
        this.boardEdge = new Map(state.boardEdge);
        this.boardCell = new Map(state.boardCell);
        this.lastmove = state.lastmove;
        return this;
    }

    private getBoardDimensions(): [number, number] {
        // Get board size from variants.
        if (this.variants !== undefined && this.variants.length > 0 && this.variants[0] !== undefined && this.variants[0].length > 0) {
            const sizeVariants = this.variants.filter(v => v.includes("size"));
            if (sizeVariants.length > 0) {
                // Extract the size from the variant.
                // Variant is expected to be in the format "size-6x7".
                const size = sizeVariants[0].match(/size-(\d+)x(\d+)/);
                if (size !== null && size.length === 3) {
                    return [parseInt(size[1], 10), parseInt(size[2], 10)];
                }
            }
        }
        return [5, 5]
    }

    public moves(): string[] {
        // This method returns all possible wall placements.
        // There is no move generation in this game.
        if (this.gameover) { return []; }
        const moves: string[] = [];
        for (let i = 0; i < this.width + 1; i++) {
            for (let j = 0; j < this.height; j++) {
                const wallV = this.coords2algebraic(i, j) + "v";
                if (this.boardEdge.has(wallV)) { continue; }
                moves.push(wallV);
            }
        }
        for (let i = 0; i < this.width; i++) {
            for (let j = -1; j < this.height; j++) {
                const wallH = this.coords2algebraic(i, j) + "h";
                if (this.boardEdge.has(wallH)) { continue; }
                moves.push(wallH);
            }
        }
        return moves;
    }

    private hasMove(): boolean {
        // Check if the current player has any moves left.
        for (let i = 0; i < this.width + 1; i++) {
            for (let j = 0; j < this.height; j++) {
                const wallV = this.coords2algebraic(i, j) + "v";
                if (!this.boardEdge.has(wallV)) { return true; }
            }
        }
        for (let i = 0; i < this.width; i++) {
            for (let j = -1; j < this.height; j++) {
                const wallH = this.coords2algebraic(i, j) + "h";
                if (!this.boardEdge.has(wallH)) { return true; }
            }
        }
        return false;
    }

    public randomMove(): string {
        const available = shuffle(this.moves());
        let curr = available.pop()!;
        const moves: string[] = [curr];
        while (available.length > 0 && this.getEnclosed(curr, moves).length > 0) {
            curr = available.pop()!;
            moves.push(curr);
        }
        return moves.join(",");
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = "";
            if (piece !== undefined && piece !== "") {
                const newWall = this.render2wall(row, col, piece);
                if (move === "") {
                    newmove = newWall;
                } else {
                    const walls = move.split(",");
                    if (walls[walls.length - 1] === newWall) {
                        newmove = walls.slice(0, -1).join(",");
                    } else {
                        newmove = move + "," + newWall;
                    }
                }
            } else {
                newmove = move;
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
            };
        }
    }

    private validWall(wall: string): boolean {
        // Check if the wall is a valid wall on the board.
        if (!this.endsWithHV(wall)) { return false; }
        const [x, y, orient] = this.splitWall(wall);
        if (orient === "h") {
            return x >= 0 && x < this.width && y >= -1 && y < this.height;
        }
        return x >= 0 && x <= this.width && y >= 0 && y < this.height;
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = { valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER") };
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.boxes.INITIAL_INSTRUCTIONS");
            return result;
        }

        const walls = m.split(",");
        // Valid wall.
        let currentMove;
        try {
            for (const p of walls) {
                if (p === undefined || p.length === 0) { continue; }
                currentMove = p;
                if (!this.validWall(p)) {
                    throw new Error("Invalid cell");
                }
            }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation.boxes.INVALID_WALL", { wall: currentMove });
            return result;
        }
        // No duplicate cells.
        const seen: Set<string> = new Set();
        const duplicates: Set<string> = new Set();
        for (const f of walls) {
            if (seen.has(f)) { duplicates.add(f); }
            seen.add(f);
        }
        if (duplicates.size > 0) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.boxes.DUPLICATE", { where: [...duplicates].join(", ") });
            return result;
        }
        const placed = [];
        const remainingCount = this.moves().length;
        for (const [i, wall] of walls.entries()) {
            if (this.boardEdge.has(wall)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.boxes.OCCUPIED", { where: wall });
                return result;
            }
            placed.push(wall);
            if (i === walls.length - 1) {
                if (remainingCount > walls.length && this.getEnclosed(wall, placed).length > 0) {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.boxes.CONTINUE");
                    return result;
                }
            } else {
                if (this.getEnclosed(wall, placed).length === 0) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.boxes.INVALID_CONTINUE");
                    return result;
                }
            }
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private checkEnclosed(cell: string, placed: string[]): boolean {
        // Check if a cell is enclosed by walls.
        const [x, y] = this.algebraic2coords(cell);
        // Left wall
        const left = cell + "v";
        if (!this.boardEdge.has(left) && !placed.includes(left)) { return false; }
        // Right wall
        const right = this.coords2algebraic(x + 1, y) + "v";
        if (!this.boardEdge.has(right) && !placed.includes(right)) { return false; }
        // Bottom wall
        const bottom = cell + "h";
        if (!this.boardEdge.has(bottom) && !placed.includes(bottom)) { return false; }
        // Top wall
        const top = this.coords2algebraic(x, y - 1) + "h";
        if (!this.boardEdge.has(top) && !placed.includes(top)) { return false; }
        return true;
    }

    private getEnclosed(where: string, placed: string[] = []): string[] {
        // Get all enclosed cells if a wall is placed at `where`
        // It can return 0, 1, or 2 cells.
        // Assumes that all walls in `placed` are placed.
        // Does not assume that `where` is placed, so make sure that it's included in `placed`
        // if the wall is not yet added to the board.
        const enclosed: string[] = [];
        const [x, y, orient] = this.splitWall(where);
        if (orient === "h") {
            if (y >= 0) {
                const cell = this.coords2algebraic(x, y);
                if (this.checkEnclosed(cell, placed)) {
                    enclosed.push(cell);
                }
            }
            if (y < this.height) {
                const cell = this.coords2algebraic(x, y + 1);
                if (this.checkEnclosed(cell, placed)) {
                    enclosed.push(cell);
                }
            }
        } else {
            if (x > 0) {
                const cell = this.coords2algebraic(x - 1, y);
                if (this.checkEnclosed(cell, placed)) {
                    enclosed.push(cell);
                }
            }
            if (x < this.width) {
                const cell = this.coords2algebraic(x, y);
                if (this.checkEnclosed(cell, placed)) {
                    enclosed.push(cell);
                }
            }
        }
        return enclosed;
    }

    public move(m: string, { partial = false, trusted = false } = {}): BoxesGame {
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
            // if (!partial && !this.moves().includes(m)) {
            //     throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", { move: m }));
            // }
        }
        if (m.length === 0) { return this; }
        this.dots = [];
        this.results = [];
        const walls = m.split(",");
        for (const wall of walls) {
            this.boardEdge.set(wall, this.currplayer);
            const [, , orient] = this.splitWall(wall);
            const enclosed = this.getEnclosed(wall, walls);
            for (const cell of enclosed) {
                this.boardCell.set(cell, this.currplayer);
            }
            if (enclosed.length === 0) {
                this.results.push({ type: "place", where: wall, what: orient });
            } else {
                this.results.push({ type: "place", where: wall, what: orient, how: enclosed.join(","), count: enclosed.length });
            }
        }
        if (partial) { return this; }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): BoxesGame {
        if (!this.hasMove()) {
            this.gameover = true;
            const p1Score = this.getPlayerScore(1);
            const p2Score = this.getPlayerScore(2);
            this.winner = p1Score > p2Score ? [1] : p1Score < p2Score ? [2] : [1, 2];
        }
        if (this.gameover) {
            this.results.push({ type: "eog" });
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public state(): IBoxesState {
        return {
            game: BoxesGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: BoxesGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            boardEdge: new Map(this.boardEdge),
            boardCell: new Map(this.boardCell),
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < this.height; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            for (let col = 0; col < this.width; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.boardCell.has(cell)) {
                    const player = this.boardCell.get(cell);
                    if (player === 1) {
                        pstr += "A";
                    } else {
                        pstr += "B";
                    }
                } else {
                    pstr += "-";
                }
            }
        }
        pstr = pstr.replace(new RegExp(`-{${this.width}}`, "g"), "_");

        const markers: any[] = []
        for (const [wall, player] of this.boardEdge.entries()) {
            const [x, y, orient] = this.splitWall(wall);
            if (orient === "h") {
                markers.push({ type: "line", points: [{ row: y + 1, col: x }, { row: y + 1, col: x + 1 }], colour: player, width: 6, shorten: 0.075 });
            } else {
                markers.push({ type: "line", points: [{ row: y + 1, col: x }, { row: y, col: x }], colour: player, width: 6, shorten: 0.075 });
            }
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-beveled",
                width: this.width,
                height: this.height,
                strokeWeight: 1,
                markers,
            },
            options: ["clickable-edges"],
            legend: {
                A: [{ name: "piece", colour: 1 }],
                B: [{ name: "piece", colour: 2 }],
            },
            pieces: pstr,
        };

        // Add annotations
        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y, orient] = this.splitWall(move.where!);
                    if (orient === "h") {
                        markers.push({ type: "line", points: [{ row: y + 1, col: x }, { row: y + 1, col: x + 1 }], colour: "#FFFF00", width: 6, shorten: 0.075, opacity: 0.5 });
                    } else {
                        markers.push({ type: "line", points: [{ row: y + 1, col: x }, { row: y, col: x }], colour: "#FFFF00", width: 6, shorten: 0.075, opacity: 0.5 });
                    }
                    if (move.how !== undefined) {
                        const cells = move.how.split(",");
                        for (const cell of cells) {
                            const [x1, y1] = this.algebraic2coords(cell);
                            rep.annotations.push({ type: "enter", targets: [{ row: y1, col: x1 }] });
                        }
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

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] },
        ]
    }

    public getPlayerScore(player: number): number {
        return [...this.boardCell.values()].filter(n => n === player).length;
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Scores**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const score = this.getPlayerScore(n as playerid);
            status += `Player ${n}: ${score}\n\n`;
        }

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                if (r.count === undefined) {
                    node.push(i18next.t("apresults:PLACE.boxes", { player, where: r.where }));
                } else if (r.count === 1) {
                    node.push(i18next.t("apresults:PLACE.boxes_claim1", { player, where: r.where, box: r.how }));
                } else {
                    const cells = r.how!.split(",");
                    node.push(i18next.t("apresults:PLACE.boxes_claim2", { player, where: r.where, box1: cells[0], box2: cells[1] }));
                }
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): BoxesGame {
        return new BoxesGame(this.serialize());
    }
}
