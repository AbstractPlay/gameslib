import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { Directions, HexTriGraph, RectGrid, reviver, UserFacingError } from "../common";
import i18next from "i18next";

type playerid = 1 | 2;
type HexDirections = "NE" | "E"| "SE" | "SW" | "W" | "NW"
const allDirections: Directions[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const allHexDirections: HexDirections[] = ["NE", "E", "SE", "SW", "W", "NW"];

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
    scores: [number, number];
}

export interface IReversiState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class ReversiGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Reversi",
        uid: "reversi",
        playercounts: [2],
        version: "20240225",
        // i18next.t("apgames:descriptions.reversi")
        description: "apgames:descriptions.reversi",
        urls: ["https://en.wikipedia.org/wiki/Reversi"],
        people: [
            {
                type: "designer",
                name: "John W. Mollett",
            },
            {
                type: "designer",
                name: "Lewis Waterman",
            },
        ],
        variants: [
            {uid: "standard-6", group: "board"},
            {uid: "standard-10", group: "board"},
            {uid: "octagon-8", group: "board"},
            {uid: "octagon-10", group: "board"},
            {uid: "hexagon-5", group: "board"},
            {uid: "hexagon-6", group: "board"},
            {uid: "anti", group: "objective"},
        ],
        flags: ["scores", "automove"],
        displays: [{uid: "hide-moves"}],
    };

    public coords2algebraic(x: number, y: number): string {
        if (this.variants.some(v => v.includes("hex"))) {
            return this.hexTriGraph!.coords2algebraic(x, y);
        }
        return GameBase.coords2algebraic(x, y, this.boardSize);
    }
    public algebraic2coords(cell: string): [number, number] {
        if (this.variants.some(v => v.includes("hex"))) {
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
    private blockedCorners: string[] = [];
    private renderBlockedCorners: any[] | undefined;

    constructor(state?: IReversiState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            this.boardSize = this.getBoardSize();
            this.rectGrid = this.getGrid();
            this.hexTriGraph = this.getHexTriGraph();
            const fresh: IMoveState = {
                _version: ReversiGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: this.initBoard(),
                scores: [0, 0],
                lastEnds: [],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IReversiState;
            }
            if (state.game !== ReversiGame.gameinfo.uid) {
                throw new Error(`The Reversi game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
            this.boardSize = this.getBoardSize();
            this.rectGrid = this.getGrid();
            this.hexTriGraph = this.getHexTriGraph();
        }
        this.load();
        this.centreCell = this.variants.some(x => x.includes("hex")) ? this.coords2algebraic(this.boardSize - 1, this.boardSize - 1) : undefined;
        this.blockedCorners = this.getBlockedCorners();
        this.renderBlockedCorners = [];
        if (this.variants.some(x => x.includes("octagon"))) {
            for (const cell of this.blockedCorners) {
                const [x, y] = this.algebraic2coords(cell);
                this.renderBlockedCorners.push({ row: y, col: x });
            }
        }
        if (this.renderBlockedCorners.length === 0) {
            this.renderBlockedCorners = undefined;
        }
        this.updateScores();
    }

    public load(idx = -1): ReversiGame {
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
        if (this.variants.includes("standard-6")) {
            return [
                "------",
                "------",
                "--21--",
                "--12--",
                "------",
                "------",
            ];
        }
        if (this.variants.includes("standard-10") || this.variants.includes("octagon-10")) {
            return [
                "----------",
                "----------",
                "----------",
                "----------",
                "----21----",
                "----12----",
                "----------",
                "----------",
                "----------",
                "----------",
            ];
        }
        if (this.variants.includes("hexagon-5")) {
            return [
                "     - - - - -     ",
                "    - - - - - -    ",
                "   - - - - 1 - -   ",
                "  - - - 1 2 - - -  ",
                " - - - 2 - 1 - - - ",
                "  - - - 1 2 - - -  ",
                "   - - 2 - - - -   ",
                "    - - - - - -    ",
                "     - - - - -     ",
            ].map((x) => x.replace(/ /g, ""));
        }
        if (this.variants.includes("hexagon-6")) {
            return [
                "     - - - - - -     ",
                "    - - - - - - -    ",
                "   - - - - - - - -   ",
                "  - - - - - 1 - - -  ",
                " - - - - 1 2 - - - - ",
                "- - - - 2 - 1 - - - -",
                " - - - - 1 2 - - - - ",
                "  - - - 2 - - - - -  ",
                "   - - - - - - - -   ",
                "    - - - - - - -    ",
                "     - - - - - -     ",
            ].map((x) => x.replace(/ /g, ""));
        }
        // else standard-8
        return [
            "--------",
            "--------",
            "--------",
            "---21---",
            "---12---",
            "--------",
            "--------",
            "--------",
        ];
    }

    private getBlockedCorners(): string[] {
        // For the octagon variants, the corners are blocked.
        if (this.variants.some(x => x.includes("octagon"))) {
            return [
                this.coords2algebraic(0, 0),
                this.coords2algebraic(0, 1),
                this.coords2algebraic(1, 0),
                this.coords2algebraic(this.boardSize - 1, 0),
                this.coords2algebraic(this.boardSize - 1, 1),
                this.coords2algebraic(this.boardSize - 2, 0),
                this.coords2algebraic(0, this.boardSize - 1),
                this.coords2algebraic(0, this.boardSize - 2),
                this.coords2algebraic(1, this.boardSize - 1),
                this.coords2algebraic(this.boardSize - 1, this.boardSize - 1),
                this.coords2algebraic(this.boardSize - 1, this.boardSize - 2),
                this.coords2algebraic(this.boardSize - 2, this.boardSize - 1),
            ];
        }
        return [];
    }

    private initBoard(): Map<string, playerid> {
        // Get the initial board setup.
        const setup = this.setupString();
        const board = new Map<string, playerid>();
        if (this.variants.some(x => x.includes("hex"))) {
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
        if (this.variants.some(x => x.includes("5"))) {
            return 5;
        }
        if (this.variants.some(x => x.includes("6"))) {
            return 6;
        }
        if (this.variants.some(x => x.includes("10"))) {
            return 10;
        }
        return 8;
    }

    private getGrid(): RectGrid | undefined {
        // If it's a square board, return the grid. Else it's undefined.
        if (this.variants.some(x => x.includes("hex"))) {
            return undefined;
        }
        return new RectGrid(this.boardSize, this.boardSize);
    }

    private getHexTriGraph(): HexTriGraph | undefined {
        // If it's a hex board, return the graph. Else it's undefined.
        if (this.variants.some(x => x.includes("hex"))) {
            return new HexTriGraph(this.boardSize, this.boardSize * 2 - 1);
        }
        return undefined;
    }

    private ray(cell: string, direction: Directions): string[] {
        // A ray function that works for the different board types.
        const coords = this.algebraic2coords(cell);
        if (this.variants.some(x => x.includes("hex"))) {
            const ray = this.hexTriGraph!.ray(...coords, direction as HexDirections).map(x => this.coords2algebraic(...x));
            if (ray.includes(this.centreCell!)) {
                ray.splice(ray.indexOf(this.centreCell!));
            }
            return ray;
        } else {
            const ray = this.rectGrid!.ray(...coords, direction).map(x => this.coords2algebraic(...x));
            return ray.filter(x => !this.blockedCorners.includes(x));
        }
    }

    public moves(player?: 1|2): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves = this.legalPlacements(player);
        if (moves.length === 0) {
            moves.push("pass");
        }
        return moves;
    }

    private legalPlacements(player: playerid): string[] {
        // Get all legal placements for a player.
        const moves: string[] = [];
        const pieces = [...this.board].filter(x => x[1] === player).map(x => x[0]);
        const directionsToCheck = this.variants.some(x => x.includes("hex")) ? allHexDirections : allDirections;
        for (const piece of pieces) {
            for (const dir of directionsToCheck) {
                const ray = this.ray(piece, dir);
                let hasOpponent = false;
                for (const cell of ray) {
                    if (!this.board.has(cell)) {
                        if (hasOpponent) { moves.push(cell); }
                        break;
                    }
                    const owner = this.board.get(cell);
                    if (owner === player) {
                        break;
                    } else {
                        hasOpponent = true;
                    }
                }
            }
        }
        return moves;
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
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.reversi.INITIAL_INSTRUCTIONS");
            return result;
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (m === "pass") {
            if (this.legalPlacements(this.currplayer).length > 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.reversi.ILLEGAL_PASS");
                return result;
            }
        } else {
            // Valid cell
            try {
                this.algebraic2coords(m);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: m });
                return result;
            }
            if (m === this.centreCell) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.reversi.CENTRE_CELL");
                return result;
            }
            if (this.blockedCorners.includes(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.reversi.CORNER_CELL");
                return result;
            }
            if (this.board.has(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", { where: m });
                return result;
            }
            if (!this.moves().includes(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.reversi.INVALID_MOVE", { move: m });
                return result;
            }
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private getFlips(cell: string): [string[], string[]] {
        // Returns an array of the list of flipped pieces, and the list of ends for annotation purposes.
        const flips: string[] = [];
        const ends: string[] = [];
        const player = this.board.get(cell);
        const directionsToCheck = this.variants.some(x => x.includes("hex")) ? allHexDirections : allDirections;
        for (const dir of directionsToCheck) {
            const ray = this.ray(cell, dir);
            let flipped = false;
            const tentative: string[] = [];
            for (const next of ray) {
                if (!this.board.has(next)) {
                    break;
                }
                const owner = this.board.get(next);
                if (owner === player) {
                    if (flipped) {
                        flips.push(...tentative);
                        ends.push(next);
                    }
                    break;
                } else {
                    tentative.push(next);
                    flipped = true;
                }
            }
        }
        return [flips, ends];
    }

    public move(m: string, {partial = false, trusted = false} = {}): ReversiGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        let result;
        if (m === "No movelist in placement phase") {
            result = {valid: false, message: i18next.t("apgames:validation.reversi.NO_MOVELIST")};
            throw new UserFacingError("VALIDATION_GENERAL", result.message);
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (!trusted) {
            result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
            if (!partial && !this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}));
            }
        }
        if (m.length === 0) { return this; }
        if (m === "pass") {
            this.results = [{ type: "pass", who: this.currplayer }];
        } else {
            // Move valid, so change the state
            this.board.set(m, this.currplayer);
            this.results = [{ type: "place", where: m }];
            const [flips, ends] = this.getFlips(m);
            for (const flip of flips) {
                this.board.set(flip, this.currplayer);
            }
            // Abusing the "how" to store the ends for annotation purposes.
            this.results.push({type: "capture", where: flips.join(","), count: flips.length, how: ends.join(",")});
            this.updateScores();
        }
        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    private updateScores(): void {
        // Update the scores with current piece count.
        const pieceCount1 = [...this.board].filter(x => x[1] === 1).length;
        const pieceCount2 = [...this.board].filter(x => x[1] === 2).length;
        this.scores = [pieceCount1, pieceCount2];
    }

    protected checkEOG(): ReversiGame {
        if (this.legalPlacements(1).length === 0 && this.legalPlacements(2).length === 0) {
            this.gameover = true;
            const p1Score = this.getPlayerScore(1);
            const p2Score = this.getPlayerScore(2);
            if (this.variants.includes("anti")) {
                this.winner = p1Score < p2Score ? [1] : p1Score > p2Score ? [2] : [1, 2];
            } else {
                this.winner = p1Score > p2Score ? [1] : p1Score < p2Score ? [2] : [1, 2];
            }
        }
        if (this.gameover) {
            this.results.push({type: "eog"});
            this.results.push({type: "winners", players: [...this.winner]});
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

    public state(): IReversiState {
        return {
            game: ReversiGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: ReversiGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            scores: [...this.scores],
        };
    }

    public render(opts?: { altDisplay: string | undefined }): APRenderRep {
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
        const rep = this.variants.some(x => x.includes("hex")) ? this.renderHexTri() : this.renderSquare();
        // Add annotations
        // @ts-ignore
        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                } else if (move.type === "capture") {
                    const place = this.results.find(x => x.type === "place") as Extract<APMoveResult, { type: 'place' }>;
                    const [xF, yF] = this.algebraic2coords(place.where!);
                    for (const m of move.how!.split(",")) {
                        const [xT, yT] = this.algebraic2coords(m);
                        const targets = [{ row: yF, col: xF }, { row: yT, col: xT }];
                        // @ts-ignore
                        rep.annotations.push({type: "move", style: "dashed", targets, arrow: false});
                    }
                }
            }
        }
        if (showMoves) {
            const moves = this.legalPlacements(this.currplayer).map(x => this.algebraic2coords(x));
            if (moves.length) {
                const points = [];
                for (const cell of moves) {
                    points.push({row: cell[1], col: cell[0]});
                }
                // @ts-ignore
                rep.annotations.push({type: "dots", targets: points});
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
        let markers: Array<any> | undefined = []
        if (this.variants.includes("anti")) {
            markers.push({
                    type: "shading", colour: "#FFA500", opacity: 0.1,
                    points: [{row: 0, col: 0}, {row: 0, col: this.boardSize}, {row: this.boardSize, col: this.boardSize}, {row: this.boardSize, col: 0}],
            });
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
                blocked: this.renderBlockedCorners === undefined ? undefined : this.renderBlockedCorners as [{row: number; col: number}, ...{row: number; col: number}[]],
                markers,
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
        const points: Array<any> | undefined = []
        let markers: Array<any> | undefined;
        if (this.variants.includes("anti")) {
            for (const cell of this.hexTriGraph!.listCells() as string[]) {
                if (cell === this.centreCell) { continue; }
                const [x, y] = this.algebraic2coords(cell);
                points.push({ row: y, col: x });
            }
            markers = [{ type: "flood", colour: "#FFA500", opacity: 0.1, points }];
        }
        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "hex-of-hex",
                minWidth: this.boardSize,
                maxWidth: (this.boardSize * 2) - 1,
                // blocked removed because it messes with markers.
                // blocked: [{ row: this.boardSize - 1, col: this.boardSize - 1 }],
                // @ts-ignore
                markers,
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
                node.push(i18next.t("apresults:PLACE.nowhat", {player, where: r.where}));
                resolved = true;
                break;
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.reversi", {count: r.count}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): ReversiGame {
        return new ReversiGame(this.serialize());
    }
}
