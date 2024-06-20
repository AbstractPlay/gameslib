import { GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";

type playerid = 1 | 2;
type sideid = "N" | "S" | "W" | "E";

const columnLabels = "abcdefghijklmnopqrstuvwxyz".split("");

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
    scores: [number, number];
    corridor: Set<string>;
    scored: Set<string>;
}

export interface ICairoCorridorState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class CairoCorridorGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Cairo Corridor",
        uid: "ccorridor",
        playercounts: [2],
        version: "20240319",
        dateAdded: "2024-03-15",
        // i18next.t("apgames:descriptions.ccorridor")
        description: "apgames:descriptions.ccorridor",
        urls: ["https://boardgamegeek.com/boardgame/137173/cairo-corridor"],
        people: [
            {
                type: "designer",
                name: "Markus Hagenauer",
                urls: ["http://www.planundspiele.de"]
            }
        ],
        variants: [
            { uid: "size-8", group: "board" },
        ],
        categories: ["goal>score>eog", "mechanic>place", "mechanic>enclose", "board>shape>rect", "board>connect>pent", "components>simple>1per"],
        flags: ["scores", "rotate90"],
        displays: [{uid: "hide-markers"}],
    };

    public coords2algebraic(x: number, y: number): string {
        // We break the x values into columns that come in pairs.
        const col = Math.floor(x / 2);
        const side = this.getSide(x, y)
        return columnLabels[col] + (this.boardSize - y).toString() + side;
    }

    public algebraic2coords(cell: string): [number, number] {
        const pair: string[] = cell.split("");
        const num = (pair.slice(1, pair.length - 1)).join("");
        const side = pair[pair.length - 1];
        const col = columnLabels.indexOf(pair[0]);
        if (col === undefined || col < 0) {
            throw new Error(`The column label is invalid: ${pair[0]}`);
        }
        const row = Number(num);
        if (row === undefined || isNaN(row) || num === "") {
            throw new Error(`The row label is invalid: ${pair[1]}`);
        }
        const x = col * 2 + (side === "S" || side === "E" ? 1 : 0);
        const y = this.boardSize - row;
        if (side !== this.getSide(x, y)) {
            throw new Error(`The side is invalid: ${side}`);
        }
        return [x, y];
    }

    private getSide(x: number, y: number): string {
        // Get the side given x and y.
        const col = Math.floor(x / 2);
        if (y % 2) {
            if (col % 2) {
                if (x % 2) {
                    return "E";
                } else {
                    return "W";
                }
            } else {
                if (x % 2) {
                    return "S";
                } else {
                    return "N";
                }
            }
        } else {
            if (col % 2) {
                if (x % 2) {
                    return "S";
                } else {
                    return "N";
                }
            } else {
                if (x % 2) {
                    return "E";
                } else {
                    return "W";
                }
            }
        }
    }

    private parseCell(cell: string): [number, number, sideid] {
        // Break a cell in algebraic notation into col, row and side
        // Note that in this script, col and row are different from x and y.
        // Notably, col and row start from 1 and the y axis is increasing in the upwards direction.
        const pair: string[] = cell.split("");
        const num = (pair.slice(1, pair.length - 1)).join("");
        const side = pair[pair.length - 1] as sideid;
        const col = columnLabels.indexOf(pair[0]) + 1;
        const row = Number(num);
        return [col, row, side];
    }

    private buildCell(col: number, row: number, side: sideid): string {
        // Create algebraic notation given col, row and side.
        return columnLabels[col - 1] + row.toString() + side;
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    public scores: [number, number] = [0, 0];
    public corridor: Set<string> = new Set();
    public scored: Set<string> = new Set();
    private boardSize = 0;
    private edges: Map<string, Set<string>>;

    constructor(state?: ICairoCorridorState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: CairoCorridorGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                scores: [0, 0],
                corridor: new Set(),
                scored: new Set(),
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ICairoCorridorState;
            }
            if (state.game !== CairoCorridorGame.gameinfo.uid) {
                throw new Error(`The CairoCorridor game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
        this.edges = this.getEdges();
    }

    public load(idx = -1): CairoCorridorGame {
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
        this.scores = [...state.scores];
        this.corridor = new Set(state.corridor);
        this.scored = new Set(state.scored);
        this.lastmove = state.lastmove;
        this.boardSize = this.getBoardSize();
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
        return 6;
    }

    private getEdges(): Map<string, Set<string>> {
        // Create the edge mapping that will be used throughout the game.
        const edges = new Map<string, Set<string>>([
            ["N", new Set()], ["S", new Set()], ["W", new Set()], ["E", new Set()]
        ]);
        for (let j = 0; j < this.boardSize; j++) {
            if (this.getSide(0, j) !== "E") {
                edges.get("W")!.add(this.coords2algebraic(0, j));
            }
            if (this.getSide(1, j) !== "E") {
                edges.get("W")!.add(this.coords2algebraic(1, j));
            }
            if (this.getSide(this.boardSize * 2 - 1, j) !== "W") {
                edges.get("E")!.add(this.coords2algebraic(this.boardSize * 2 - 1, j));
            }
            if (this.getSide(this.boardSize * 2 - 2, j) !== "W") {
                edges.get("E")!.add(this.coords2algebraic(this.boardSize * 2 - 2, j));
            }
        }
        for (let i = 0; i < this.boardSize * 2; i++) {
            if (this.getSide(i, 0) !== "S") {
                edges.get("N")!.add(this.coords2algebraic(i, 0));
            }
            if (this.getSide(i, this.boardSize - 1) !== "N") {
                edges.get("S")!.add(this.coords2algebraic(i, this.boardSize - 1));
            }
        }
        return edges;
    }


    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }
        const moves: string[] = [];
        for (let j = 0; j < this.boardSize; j++) {
            for (let i = 0; i < this.boardSize * 2; i++) {
                const cell = this.coords2algebraic(i, j);
                if (!this.board.has(cell) && this.legalPlacement(cell) && (this.stack.length === 1 || this.corridor.has(cell))) {
                    moves.push(cell);
                }
            }
        }
        return moves;
    }

    private legalPlacement(place: string): boolean {
        // Check if a placement blocks the corridor.
        const northEdge: string[] = [...this.edges.get("N")!].filter(c => !this.board.has(c) && c !== place);
        if (northEdge.length === 0) { return false; }
        while (northEdge.length > 0) {
            let seenSouth = false;
            let seenWest = false;
            let seenEast = false;
            const seen: Set<string> = new Set();
            const start = northEdge.pop()!;
            const todo: string[] = [start];
            while (todo.length > 0) {
                const cell = todo.pop()!;
                if (seen.has(cell)) { continue; }
                seen.add(cell);
                if (this.edges.get("S")?.has(cell)) { seenSouth = true; }
                if (this.edges.get("W")?.has(cell)) { seenWest = true; }
                if (this.edges.get("E")?.has(cell)) { seenEast = true; }
                if (seenSouth && seenWest && seenEast) { return true; }
                for (const n of this.getNeighbours(cell)) {
                    if (northEdge.includes(n)) { northEdge.splice(northEdge.indexOf(n), 1); }
                    if (!this.board.has(n) && n !== place) { todo.push(n); }
                }
            }
        }
        return false;
    }

    private getCorridorRegion(place?: string): Set<string> {
        // Get a region of the corridor after placement.
        // This is similar to `legalPlacement` but it returns the region instead of a boolean.
        // We assume that the placement is legal.
        const northEdge: string[] = [...this.edges.get("N")!].filter(c => !this.board.has(c) && c !== place);
        while (northEdge.length > 0) {
            let seenSouth = false;
            let seenWest = false;
            let seenEast = false;
            const seen: Set<string> = new Set();
            const start = northEdge.pop()!;
            const todo: string[] = [start];
            while (todo.length > 0) {
                const cell = todo.pop()!;
                if (seen.has(cell)) { continue; }
                seen.add(cell);
                if (this.edges.get("S")?.has(cell)) { seenSouth = true; }
                if (this.edges.get("W")?.has(cell)) { seenWest = true; }
                if (this.edges.get("E")?.has(cell)) { seenEast = true; }
                for (const n of this.getNeighbours(cell)) {
                    if (northEdge.includes(n)) { northEdge.splice(northEdge.indexOf(n), 1); }
                    if (!this.board.has(n) && n !== place) { todo.push(n); }
                }
            }
            if (seenSouth && seenWest && seenEast) { return seen; }
        }
        throw new Error("Board has no corridor.");
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            let newmove = "";
            newmove = cell;
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
                message: i18next.t("apgames:validation._general.GENERIC", { move, row, col, piece, emessage: (e as Error).message })
            }
        }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.ccorridor.INITIAL_INSTRUCTIONS");
            return result;
        }
        m = m.replace(/\s+/g, "");
        // Valid cell.
        try {
            const [x, y] = this.algebraic2coords(m);
            // `algebraic2coords` does not check if the cell is on the board.
            if (x < 0 || x >= this.boardSize * 2 || y < 0 || y >= this.boardSize) {
                throw new Error("Invalid cell");
            }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", { move: m });
            return result;
        }
        // Cell is already occupied.
        if (this.board.has(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", { where: m });
            return result;
        }
        // Cell is not a legal placement.
        if (!this.legalPlacement(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.ccorridor.ILLEGAL_PLACEMENT", { where: m });
            return result;
        }
        // Dead zone.
        if (this.stack.length > 1 && !this.corridor.has(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.ccorridor.DEAD_ZONE", { where: m });
            return result;
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private getNeighbours(cell: string): string[] {
        // Get all neighbours on board given a cell.
        // Remember that col and row start from 1 and row is positive upwards.
        const [col, row, side] = this.parseCell(cell);
        const neighbours: string[] = [];
        if (side === "N") {
            neighbours.push(this.buildCell(col, row, "S"));
            if (col > 1) { neighbours.push(this.buildCell(col - 1, row, "E")) };
            if (col < this.boardSize) { neighbours.push(this.buildCell(col + 1, row, "W")) };
            if (row < this.boardSize) {
                neighbours.push(this.buildCell(col, row + 1, "E"))
                neighbours.push(this.buildCell(col, row + 1, "W"))
            }
        } else if (side === "S") {
            neighbours.push(this.buildCell(col, row, "N"));
            if (col > 1) { neighbours.push(this.buildCell(col - 1, row, "E")) };
            if (col < this.boardSize) { neighbours.push(this.buildCell(col + 1, row, "W")) };
            if (row > 1) {
                neighbours.push(this.buildCell(col, row - 1, "E"))
                neighbours.push(this.buildCell(col, row - 1, "W"))
            }
        } else if (side === "W") {
            neighbours.push(this.buildCell(col, row, "E"));
            if (row > 1) { neighbours.push(this.buildCell(col, row - 1, "N")) };
            if (row < this.boardSize) { neighbours.push(this.buildCell(col, row + 1, "S")) };
            if (col > 1) {
                neighbours.push(this.buildCell(col - 1, row, "N"))
                neighbours.push(this.buildCell(col - 1, row, "S"))
            }
        } else /* if (side === "E") */ {
            neighbours.push(this.buildCell(col, row, "W"));
            if (row > 1) { neighbours.push(this.buildCell(col, row - 1, "N")) };
            if (row < this.boardSize) { neighbours.push(this.buildCell(col, row + 1, "S")) };
            if (col < this.boardSize) {
                neighbours.push(this.buildCell(col + 1, row, "N"))
                neighbours.push(this.buildCell(col + 1, row, "S"))
            }
        }
        return neighbours;
    }

    public move(m: string, {partial = false, trusted = false} = {}): CairoCorridorGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        let result;
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
        this.results.push({ type: "place", where: m });
        this.board.set(m, this.currplayer);
        this.corridor = this.getCorridorRegion();
        [this.scores, this.scored] = this.calculateScores(this.corridor);

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    private hasCorridor(corridorRegion?: Set<string>): boolean {
        // Check if the board has a corridor.
        if (corridorRegion === undefined) { corridorRegion = this.getCorridorRegion(); }
        for (const cell of corridorRegion) {
            if (this.legalPlacement(cell)) { return false; }
        }
        return true;
    }

    private blockingMoves(corridorRegion?: Set<string>): Set<string> {
        // Get all illegal moves that block the corridor.
        if (corridorRegion === undefined) { corridorRegion = this.getCorridorRegion(); }
        const blocks: Set<string> = new Set();
        for (const cell of corridorRegion) {
            if (!this.legalPlacement(cell)) { blocks.add(cell) };
        }
        return blocks;
    }

    private calculateScores(corridorRegion?: Set<string>): [[number, number], Set<string>] {
        // Get the scores for player 1 and player 2 and the cells that have been scored.
        if (corridorRegion === undefined) { corridorRegion = this.getCorridorRegion(); }
        const scores: [number, number] = [0, 0];
        const scored: Set<string> = new Set();
        for (const cell of this.blockingMoves(corridorRegion)) {
            for (const n of this.getNeighbours(cell)) {
                if (this.board.has(n) && !scored.has(n)) {
                    scores[this.board.get(n)! - 1]++;
                    scored.add(n);
                }
            }
        }
        return [scores, scored];
    }

    private nonDeadRegion(corridorRegion?: Set<string>): Set<string> {
        // Get the non-dead region of the corridor.
        if (corridorRegion === undefined) { corridorRegion = this.getCorridorRegion(); }
        const nonDead: Set<string> = new Set();
        for (const cell of corridorRegion) {
            for (const n of this.getNeighbours(cell)) {
                if (this.board.has(n) && !nonDead.has(n)) {
                    nonDead.add(n);
                }
            }
        }
        return nonDead;
    }


    protected checkEOG(): CairoCorridorGame {
        const corridorRegion = this.getCorridorRegion();
        if (this.hasCorridor(corridorRegion)) {
            this.corridor = corridorRegion;
            this.gameover = true;
            // Tiebreakker: last player to move loses.
            this.winner = this.scores[0] > this.scores[1] ? [1] : this.scores[0] < this.scores[1] ? [2] : [this.currplayer];
        }
        if (this.gameover) {
            this.results.push({ type: "eog" });
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public state(): ICairoCorridorState {
        return {
            game: CairoCorridorGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: CairoCorridorGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            scores: [...this.scores],
            corridor: new Set(this.corridor),
            scored: new Set(this.scored),
        };
    }

    public render(opts?: IRenderOpts): APRenderRep {
        let altDisplay: string | undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }
        let showMarkers = true;
        if (altDisplay !== undefined) {
            if (altDisplay === "hide-markers") {
                showMarkers = false;
            }
        }
        // Build piece string
        let pstr = "";
        const nonDead: Set<string> | undefined = showMarkers ? this.nonDeadRegion() : undefined;
        for (let row = 0; row < this.boardSize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            if (!showMarkers) {
                pstr += "_";
                continue;
            }
            for (let col = 0; col < 2 * this.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.scored.has(cell)) {
                    if (this.board.get(cell) === 1) {
                        pstr += "A";
                    } else {
                        pstr += "B";
                    }
                } else if (this.stack.length > 1 && !this.corridor.has(cell) && !nonDead!.has(cell)) {
                    pstr += "X";
                } else {
                    pstr += "-";
                }
            }
        }
        pstr = pstr.replace(new RegExp(`-{${2 * this.boardSize}}`, "g"), "_");
        const spaces1 = [];
        const spaces2 = [];
        const highlight = [];
        for (const [space, player] of this.board.entries()) {
            const [x, y] = this.algebraic2coords(space);
            if (player === 1) {
                spaces1.push({ row: y, col: x });
            } else {
                spaces2.push({ row: y, col: x });
            }
        }
        if (showMarkers) {
            for (const cell of this.blockingMoves(this.corridor)) {
                const [x, y] = this.algebraic2coords(cell);
                highlight.push({ row: y, col: x });
            }
        }
        let markers: Array<any> | undefined = [];
        if (spaces1.length > 0) {
            markers.push({ type: "flood", points: spaces1, colour: 1, opacity: 0.5 });
        }
        if (spaces2.length > 0) {
            markers.push({ type: "flood", points: spaces2, colour: 2, opacity: 0.5 });
        }
        if (highlight.length > 0) {
            markers.push({ type: "flood", points: highlight, colour: "#FFFF00", opacity: 0.3 });
        }
        if (markers.length === 0) {
            markers = undefined;
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "cairo-collinear",
                width: this.boardSize,
                height: this.boardSize,
                markers,
            },
            legend: {
                A: [{ name: "piece", colour: 1, scale: 0.5 }],
                B: [{ name: "piece", colour: 2, scale: 0.5 }],
                X: [{ name: "x", scale: 0.25, colour: "_context_strokes" }],
            },
            pieces: pstr,
        };

        // @ts-ignore
        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                }
            }
        }
        return rep;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.ccorridor", { player, where: r.where }));
                resolved = true;
                break;
        }
        return resolved;
    }

    public getPlayerScore(player: playerid): number {
        return this.scores[player - 1];
    }

    public getPlayersScores(): IScores[] {
        return [{ name: i18next.t("apgames:status.SCORES"), scores: [this.scores[0], this.scores[1]] }];
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        if (this.scores !== undefined) {
            status += "**Scores**: " + this.scores.join(" - ") + "\n\n";
        }

        return status;
    }

    public clone(): CairoCorridorGame {
        return new CairoCorridorGame(this.serialize());
    }
}
