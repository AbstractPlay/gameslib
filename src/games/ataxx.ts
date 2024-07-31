import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { Directions, HexTriGraph, RectGrid, reviver, UserFacingError } from "../common";
import i18next from "i18next";

type playerid = 1 | 2;
type HexDirection = "NE" | "E"| "SE" | "SW" | "W" | "NW"
const allDirections: Directions[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const allHexDirections: HexDirection[] = ["NE", "E", "SE", "SW", "W", "NW"];

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
    scores: [number, number];
}

export interface IAtaxxState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class AtaxxGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Ataxx",
        uid: "ataxx",
        playercounts: [2],
        version: "20240728",
        dateAdded: "2024-07-28",
        // i18next.t("apgames:descriptions.ataxx")
        description: "apgames:descriptions.ataxx",
        // i18next.t("apgames:notes.ataxx")
        notes: "apgames:notes.ataxx",
        urls: ["https://boardgamegeek.com/boardgame/91313/ataxx"],
        people: [
            {
                type: "designer",
                name: "Dave Crummack",
            },
            {
                type: "designer",
                name: "Craig Galley",
            },
        ],
        variants: [
            { uid: "standard-5", group: "board" },
            { uid: "standard-9", group: "board", experimental: true },
            { uid: "hex-5", group: "board" },
            { uid: "hex-6", group: "board", experimental: true },
            { uid: "orth-jump-only" },
            { uid: "blocked-near-centre", group: "blocked", experimental: true }, // Just for testing blocked spaces.
        ],
        categories: ["goal>majority", "mechanic>move",  "mechanic>convert", "board>shape>rect", "board>connect>rect", "board>shape>hex", "board>connect>hex", "components>simple>1per"],
        flags: ["experimental", "scores"],
    };

    public coords2algebraic(x: number, y: number): string {
        if (this.boardShape === "hex") {
            return this.hexTriGraph!.coords2algebraic(x, y);
        }
        return GameBase.coords2algebraic(x, y, this.boardSize);
    }
    public algebraic2coords(cell: string): [number, number] {
        if (this.boardShape === "hex") {
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
    public scores: [number, number] = [0, 0];
    private rectGrid: RectGrid | undefined;
    private hexTriGraph: HexTriGraph | undefined;
    private boardSize = 0;
    private centreCell: string | undefined;
    private holes: string[] = [];
    private boardShape: "square" | "hex";
    private dots: string[] = [];

    constructor(state?: IAtaxxState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            this.boardShape = this.variants.some(v => v.includes("hex")) ? "hex" : "square";
            this.boardSize = this.getBoardSize();
            this.rectGrid = this.getGrid();
            this.hexTriGraph = this.getHexTriGraph();
            const board = this.initBoard();
            const fresh: IMoveState = {
                _version: AtaxxGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                scores: this.getNewScores(this.currplayer, board),
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IAtaxxState;
            }
            if (state.game !== AtaxxGame.gameinfo.uid) {
                throw new Error(`The Ataxx game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
            this.boardShape = this.variants.some(v => v.includes("hex")) ? "hex" : "square";
            this.boardSize = this.getBoardSize();
            this.rectGrid = this.getGrid();
            this.hexTriGraph = this.getHexTriGraph();
        }
        this.load();
        this.centreCell = this.boardShape === "hex" ? this.coords2algebraic(this.boardSize - 1, this.boardSize - 1) : this.coords2algebraic((this.boardSize - 1) / 2, (this.boardSize - 1) / 2);
        this.holes = this.getHoles();
    }

    public load(idx = -1): AtaxxGame {
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
        this.scores = [...state.scores];
        return this;
    }

    private setupString(): string[] {
        // Get the board setup for a new game.
        if (this.variants.includes("standard-5")) {
            return [
                "1---2",
                "-----",
                "-----",
                "-----",
                "2---1",
            ];
        }
        if (this.variants.includes("standard-9")) {
            return [
                "1-------2",
                "---------",
                "---------",
                "---------",
                "---------",
                "---------",
                "---------",
                "---------",
                "2-------1",
            ];
        }
        if (this.variants.includes("hex-4")) {
            return [
                "   1 - - 2   ",
                "  - - - - -  ",
                " - - - - - - ",
                "2 - - - - - 1",
                " - - - - - - ",
                "  - - - - -  ",
                "   1 - - 2   ",
            ].map((x) => x.replace(/ /g, ""));
        }
        if (this.variants.includes("hex-5")) {
            return [
                "    1 - - - 2    ",
                "   - - - - - -   ",
                "  - - - - - - -  ",
                " - - - - - - - - ",
                "2 - - - - - - - 1",
                " - - - - - - - - ",
                "  - - - - - - -  ",
                "   - - - - - -   ",
                "    1 - - - 2    ",
            ].map((x) => x.replace(/ /g, ""));
        }
        if (this.variants.includes("hex-6")) {
            return [
                "     1 - - - - 2     ",
                "    - - - - - - -    ",
                "   - - - - - - - -   ",
                "  - - - - - - - - -  ",
                " - - - - - - - - - - ",
                "2 - - - - - - - - - 1",
                " - - - - - - - - - - ",
                "  - - - - - - - - -  ",
                "   - - - - - - - -   ",
                "    - - - - - - -    ",
                "     1 - - - - 2     ",
            ].map((x) => x.replace(/ /g, ""));
        }
        // else standard-7
        return [
            "1-----2",
            "-------",
            "-------",
            "-------",
            "-------",
            "-------",
            "2-----1",
        ];
    }

    private getHoles(): string[] {
        // For the octagon variants, the corners are blocked.
        // If variant
        if (this.variants.includes("blocked-near-centre")) {
            const centre = this.algebraic2coords(this.centreCell!);
            if (this.boardShape === "hex") {
                return [
                    this.coords2algebraic(...this.hexTriGraph!.move(...centre, "NE")!),
                    this.coords2algebraic(...this.hexTriGraph!.move(...centre, "W")!),
                    this.coords2algebraic(...this.hexTriGraph!.move(...centre, "SE")!),
                ];
            } else {
                const [x, y] = centre;
                return [
                    this.coords2algebraic(x - 1, y - 1),
                    this.coords2algebraic(x + 1, y - 1),
                    this.coords2algebraic(x - 1, y + 1),
                    this.coords2algebraic(x + 1, y + 1),
                ]
            }
        }
        return [];
    }

    private initBoard(): Map<string, playerid> {
        // Get the initial board setup.
        const setup = this.setupString();
        const board = new Map<string, playerid>();
        if (this.boardShape === "hex") {
            for (const row of this.hexTriGraph!.listCells(true) as string[][]) {
                for (const cell of row) {
                    const [x, y] = this.algebraic2coords(cell);
                    const contents = setup[y][x];
                    if (contents === "1") {
                        board.set(cell, 1);
                    } else if (contents === "2") {
                        board.set(cell, 2);
                    }
                }
            }
        } else {
            for (let y = 0; y < this.boardSize; y++) {
                for (let x = 0; x < this.boardSize; x++) {
                    const cell = this.coords2algebraic(x, y);
                    const contents = setup[y][x];
                    if (contents === "1") {
                        board.set(cell, 1);
                    } else if (contents === "2") {
                        board.set(cell, 2);
                    }
                }
            }
        }
        return board;
    }

    private getBoardSize(): number {
        // Get the board size based on the variants.
        if (this.variants.some(x => x.includes("4"))) {
            return 4;
        }
        if (this.variants.some(x => x.includes("5"))) {
            return 5;
        }
        if (this.variants.some(x => x.includes("6"))) {
            return 6;
        }
        if (this.variants.some(x => x.includes("9"))) {
            return 9;
        }
        return 7;
    }

    private getGrid(): RectGrid | undefined {
        // If it's a square board, return the grid. Else it's undefined.
        if (this.boardShape === "hex") {
            return undefined;
        }
        return new RectGrid(this.boardSize, this.boardSize);
    }

    private getHexTriGraph(): HexTriGraph | undefined {
        // If it's a hex board, return the graph. Else it's undefined.
        if (this.boardShape === "hex") {
            return new HexTriGraph(this.boardSize, this.boardSize * 2 - 1);
        }
        return undefined;
    }

    private ray(cell: string, direction: Directions): string[] {
        // A ray function that works for the different board types.
        const coords = this.algebraic2coords(cell);
        if (this.boardShape === "hex") {
            const ray = this.hexTriGraph!.ray(...coords, direction as HexDirection).map(x => this.coords2algebraic(...x));
            if (ray.includes(this.centreCell!)) {
                ray.splice(ray.indexOf(this.centreCell!));
            }
            return ray;
        } else {
            const ray = this.rectGrid!.ray(...coords, direction).map(x => this.coords2algebraic(...x));
            return ray.filter(x => !this.holes.includes(x));
        }
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        player ??= this.currplayer;
        const moves: string[] = [];
        const playerFroms = [...this.board].filter(x => x[1] === player).map(x => x[0]);
        for (const from of playerFroms) {
            const tos = this.getTos(from);
            for (const to of tos) {
                moves.push(`${from}-${to}`);
            }
        }
        return moves;
    }

    private hasMoves(player: playerid, board?: Map<string, playerid>): boolean {
        // Check if the player has any moves.
        board ??= this.board;
        player ??= this.currplayer;
        const playerFroms = [...board].filter(x => x[1] === player).map(x => x[0]);
        for (const from of playerFroms) {
            const tos = this.getTos(from);
            if (tos.length > 0) {
                return true;
            }
        }
        return false;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            let newmove = "";
            if (move === "") {
                newmove = cell;
            } else {
                if (cell === move) {
                    newmove = "";
                } else {
                    newmove = `${move}-${cell}`;
                }
            }
            const result = this.validateMove(newmove) as IClickResult;
            if (!result.valid) {
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
        const result: IValidationResult = { valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER") };
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.ataxx.INITIAL_INSTRUCTIONS");
            return result;
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const [from, ...rest] = m.split("-");
        const to = rest.join("-");

        // Valid cell
        try {
            this.algebraic2coords(from);
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: from });
            return result;
        }
        if (!this.board.has(from)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NONEXISTENT", { where: from });
            return result;
        }
        if (this.board.get(from) !== this.currplayer) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.UNCONTROLLED", { where: from });
            return result;
        }
        const tos = this.getTos(from);
        if (tos.length === 0) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.ataxx.NO_TOS", { from });
            return result;
        }
        if (to === "") {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.ataxx.SELECT_TO");
            return result;
        }
        // Valid cell
        try {
            this.algebraic2coords(to);
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: to });
            return result;
        }
        if (to === from) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.SAME_FROM_TO");
            return result;
        }
        if (this.board.has(to)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", { where: to });
            return result;
        }
        if (this.holes.includes(to)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.ataxx.HOLE");
            return result;
        }
        if (!tos.includes(to)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.ataxx.INVALID_TO", { from, to });
            return result;
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private getNeighbours(cell: string): string[] {
        // Get the neighbours of a cell.
        if (this.boardShape === "hex") {
            return this.hexTriGraph!.neighbours(cell);
        } else {
            return this.rectGrid!.adjacencies(...this.algebraic2coords(cell)).map(x => this.coords2algebraic(...x));
        }
    }

    private getTos(from: string): string[] {
        // Get all possible tos for a from cell.
        const tos: string[] = [];
        if (this.boardShape === "hex") {
            for (const dir of allHexDirections) {
                const ray = this.ray(from, dir).slice(0, 2);
                for (const cell of ray) {
                    if (this.board.has(cell)) { continue; }
                    if (this.holes.includes(cell)) { continue; }
                    tos.push(cell);
                }
            }
            if (!this.variants.includes("orth-jump-only")) {
                const clockwiseCheck: HexDirection[] = ["E", "SE", "SW", "W", "NW", "NE"];
                for (const [i, dir] of allHexDirections.entries()) {
                    const next = this.hexTriGraph!.move(...this.algebraic2coords(from), dir);
                    if (next === undefined) { continue; }
                    const next2 = this.hexTriGraph!.move(...next, clockwiseCheck[i]);
                    if (next2 === undefined) { continue; }
                    const cell = this.coords2algebraic(...next2);
                    if (this.board.has(cell)) { continue; }
                    if (this.holes.includes(cell)) { continue; }
                    tos.push(cell);
                }
            }
        } else {
            for (const dir of allDirections) {
                const ray = this.ray(from, dir).slice(0, 2);
                for (const cell of ray) {
                    if (this.board.has(cell)) { continue; }
                    if (this.holes.includes(cell)) { continue; }
                    tos.push(cell);
                }
            }
            if (!this.variants.includes("orth-jump-only")) {
                // Add knight moves
                const [x, y] = this.algebraic2coords(from);
                const deltas = [
                    [-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1],
                ];
                for (const [dx, dy] of deltas) {
                    const [nx, ny] = [x + dx, y + dy];
                    if (!this.rectGrid!.inBounds(nx, ny)) { continue; }
                    const cell = this.coords2algebraic(nx, ny);
                    if (this.board.has(cell)) { continue; }
                    if (this.holes.includes(cell)) { continue; }
                    tos.push(cell);
                }
            }
        }
        return tos;
    }

    private getCaptures(cell: string, player: playerid): string[] {
        // Get all possible cells when `player` moves a piece to `cell`.
        const captures: string[] = [];
        for (const neighbour of this.getNeighbours(cell)) {
            if (!this.board.has(neighbour)) { continue; }
            if (this.board.get(neighbour) === player) { continue; }
            captures.push(neighbour);
        }
        return captures;
    }

    public move(m: string, { partial = false, trusted = false } = {}): AtaxxGame {
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
        const [from, to] = m.split("-");
        if (to === undefined || to === "") {
            this.dots = this.getTos(from);
        } else {
            let jump = false;
            if (!this.getNeighbours(from).includes(to)) {
                this.board.delete(from);
                jump = true;
            }
            this.board.set(to, this.currplayer);
            this.results = [{ type: "move", from, to, how: jump ? "jump" : "split"}];
            const captures = this.getCaptures(to, this.currplayer);
            if (captures.length > 0) {
                for (const capture of captures) {
                    this.board.set(capture, this.currplayer);
                }
                this.results.push({ type: "capture", where: captures.join(","), count: captures.length });
            }
        }
        this.scores = this.getNewScores(this.currplayer);
        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    private getNewScores(player: playerid, board?: Map<string, playerid>): [number, number] {
        // Update the scores with current piece count.
        board ??= this.board;
        const pieceCount1 = [...board].filter(x => x[1] === 1).length;
        const pieceCount2 = [...board].filter(x => x[1] === 2).length;
        if (!this.hasMoves(player % 2 + 1 as playerid, board)) {
            if (player === 1) {
                return [pieceCount1 + this.emptyCellCount(board), pieceCount2];
            } else {
                return [pieceCount1, pieceCount2 + this.emptyCellCount(board)];
            }
        }
        return [pieceCount1, pieceCount2];
    }

    private emptyCellCount(board?: Map<string, playerid>): number {
        // Count the number of empty cells.
        board ??= this.board;
        if (this.boardShape === "hex") {
            return this.hexTriGraph!.listCells().flat().filter(x => !board!.has(x) && !this.holes.includes(x)).length;
        }
        return this.boardSize * this.boardSize - this.holes.length - board.size;
    }

    protected checkEOG(): AtaxxGame {
        const stateCount = this.stateCount();
        if (!this.hasMoves(this.currplayer)) {
            const emptyCellCount = this.emptyCellCount();
            if (emptyCellCount > 0) {
                this.results.push({ type: "claim", count: emptyCellCount });
            }
            this.results.push({ type: "eog"});
            this.gameover = true;
        } else if (stateCount >= 2) {
            this.results.push({ type: "eog", reason: "repetition" });
            this.gameover = true;
        }
        if (this.gameover) {
            const p1Score = this.getPlayerScore(1);
            const p2Score = this.getPlayerScore(2);
            this.winner = p1Score > p2Score ? [1] : p1Score < p2Score ? [2] : [1, 2];
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public getPlayerScore(player: playerid): number {
        return this.scores[player - 1];
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] },
        ]
    }

    public state(): IAtaxxState {
        return {
            game: AtaxxGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: AtaxxGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            scores: [...this.scores],
        };
    }

    public render(): APRenderRep {
        const rep = this.boardShape === "hex" ? this.renderHexTri() : this.renderSquare();
        // Add annotations
        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "move") {
                    const [fromX, fromY] = this.algebraic2coords(move.from);
                    const [toX, toY] = this.algebraic2coords(move.to);
                    rep.annotations.push({ type: "move", targets: [{ row: fromY, col: fromX }, { row: toY, col: toX }] });
                    if (move.how === "split") {
                        rep.annotations.push({ type: "enter", targets: [{ row: toY, col: toX }] });
                    }
                } else if (move.type === "capture") {
                    for (const cell of move.where!.split(",")) {
                        const [x, y] = this.algebraic2coords(cell);
                        rep.annotations.push({ type: "exit", targets: [{ row: y, col: x }] });
                    }
                }
            }
        }
        if (this.dots.length > 0) {
            const points: RowCol[] = [];
            for (const cell of this.dots) {
                const [x, y] = this.algebraic2coords(cell);
                points.push({ row: y, col: x });
            }
            rep.annotations.push({ type: "dots", targets: points as [RowCol, ...RowCol[]] });
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
        let markers: Array<any> | undefined = []
        if (this.variants.includes("orth-jump-only")) {
            markers.push({
                    type: "shading", colour: "#FFA500", opacity: 0.1,
                    points: [{ row: 0, col: 0 }, { row: 0, col: this.boardSize }, { row: this.boardSize, col: this.boardSize }, { row: this.boardSize, col: 0 }],
            });
        }
        if (this.holes.length > 0) {
            const holes: RowCol[] = [];
            for (const cell of this.holes) {
                const [x, y] = this.algebraic2coords(cell);
                holes.push({ row: y, col: x });
            }
            markers.push({ type: "flood", colour: "#444", opacity: 0.6, points: holes })
        }
        if (markers.length === 0) {
            markers = undefined;
        }


        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares",
                width: this.boardSize,
                height: this.boardSize,
                markers,
            },
            legend: {
                A: [{ name: "piece", colour: 1 }],
                B: [{ name: "piece", colour: 2 }],
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
        let markers: Array<any> | undefined = [];
        const points: Array<any> | undefined = [];
        if (this.variants.includes("orth-jump-only")) {
            for (const cell of this.hexTriGraph!.listCells() as string[]) {
                if (cell === this.centreCell) { continue; }
                const [x, y] = this.algebraic2coords(cell);
                points.push({ row: y, col: x });
            }
            markers.push({ type: "flood", colour: "#FFA500", opacity: 0.1, points });
        }
        if (this.holes.length > 0) {
            const holes: RowCol[] = [];
            for (const cell of this.holes) {
                const [x, y] = this.algebraic2coords(cell);
                holes.push({ row: y, col: x });
            }
            markers.push({ type: "flood", colour: "#444", opacity: 0.6, points: holes })
        }
        if (markers.length === 0) {
            markers = undefined;
        }
        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "hex-of-hex",
                minWidth: this.boardSize,
                maxWidth: this.boardSize * 2 - 1,
                markers,
            },
            legend: {
                A: [{ name: "piece", colour: 1 }],
                B: [{ name: "piece", colour: 2 }],
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
            case "move":
                if (r.how === "split") {
                    node.push(i18next.t("apresults:MOVE.ataxx_split", { player, from: r.from, to: r.to }));
                } else {
                    node.push(i18next.t("apresults:MOVE.ataxx_jump", { player, from: r.from, to: r.to }));
                }
                resolved = true;
                break;
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.ataxx", { count: r.count }));
                resolved = true;
                break;
            case "claim":
                node.push(i18next.t("apresults:CLAIM.ataxx", { player, count: r.count }));
                resolved = true;
                break;
            case "eog":
                if (r.reason === "repetition") {
                    node.push(i18next.t("apresults:EOG.repetition", { count: 1 }));
                } else {
                    node.push(i18next.t("apresults:EOG.default"));
                }
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): AtaxxGame {
        return new AtaxxGame(this.serialize());
    }
}
