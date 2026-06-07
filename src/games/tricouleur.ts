import { GameBase, IAPGameState, IClickResult, ICustomButton, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { HexTriGraph, reviver, UserFacingError } from "../common";
import i18next from "i18next";

type playerid = 1 | 2;
export type cellcontents = [playerid, number]; // 1--Rock (o), 2--Paper ([]), 3--Scissor (x)

type HexDirection = "NE" | "E"| "SE" | "SW" | "W" | "NW";
const allHexDirections: HexDirection[] = ["NE", "E", "SE", "SW", "W", "NW"];

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, cellcontents>;
    lastmove?: string;
    scores: [number, number];
}

export interface ITricouleurState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class TricouleurGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Tricouleur",
        uid: "tricouleur",
        playercounts: [2],
        version: "20260606",
        dateAdded: "2026-06-06",
        // i18next.t("apgames:descriptions.tricouleur")
        description: "apgames:descriptions.tricouleur",
        notes: "apgames:notes.tricouleur",
        urls: ["https://jpneto.github.io/world_abstract_games/tri_hexxagon.htm"],
        people: [
            {
                type: "designer",
                name: "Bill Taylor",
                urls: ["https://boardgamegeek.com/boardgamedesigner/9249/bill-taylor"],
            },
            {
                type: "coder",
                name: "João Pedro Neto",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3829/joao-pedro-neto"],
                apid: "9228bccd-a1bd-452b-b94f-d05380e6638f",
            },
        ],
        variants: [
            { uid: "hex-7",  group: "board" },
            { uid: "#board", }, // hexhex8
            { uid: "hex-9",  group: "board" },
            { uid: "hex-10", group: "board" },
        ],
        categories: ["goal>majority", "mechanic>move", "mechanic>convert",  "board>shape>hex", "board>connect>hex", "components>simple>1per"],
        flags: ["no-moves", "custom-buttons", "scores", "experimental"],
    };

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, cellcontents>;
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    public scores: [number, number] = [0, 0];
    private hexTriGraph: HexTriGraph | undefined;
    private boardSize = 0;
    private dots: string[] = [];

    constructor(state?: ITricouleurState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            this.boardSize = this.getBoardSize();
            this.hexTriGraph = this.getGraph();
            const board = this.initBoard();
            const fresh: IMoveState = {
                _version: TricouleurGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                scores: this.getNewScores(board),
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ITricouleurState;
            }
            if (state.game !== TricouleurGame.gameinfo.uid) {
                throw new Error(`The Tricouleur game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
            this.boardSize = this.getBoardSize();
            this.hexTriGraph = this.getGraph();
        }
        this.load();
    }

    public load(idx = -1): TricouleurGame {
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

    public coords2algebraic(x: number, y: number): string {
        return this.hexTriGraph!.coords2algebraic(x, y);
    }

    public algebraic2coords(cell: string): [number, number] {
        return this.hexTriGraph!.algebraic2coords(cell);
    }

    private setupString(): string[] {
        // Get the board setup for a new game.
        if (this.variants.includes("hex-7")) {
            return [
                "       C A - - - a b       ",
                "      B - - - - - - c      ",
                "     - - - - - - - - -     ",
                "    - - - - - - - - - -    ",
                "   - - - - - - - - - - -   ",
                "  b - - - - - - - - - - C  ",
                " a - - - - - - - - - - - A ",
                "  c - - - - - - - - - - B  ",
                "   - - - - - - - - - - -   ",
                "    - - - - - - - - - -    ",
                "     - - - - - - - - -     ",
                "      C - - - - - - b      ",
                "       B A - - - a c       ",
            ].map((x) => x.replace(/ /g, ""));
        }
        if (this.variants.includes("hex-9")) {
            return [
                "        - A - - - - - a -        ",
                "       B - - - - - - - - c       ",
                "      - - - - - - - - - - -      ",
                "     - - - - - - - - - - - -     ",
                "    - - - - - - b - - - - - -    ",
                "   - - - - - - - - - - - - - -   ",
                "  - - - C - - - - - - - A - - -  ",
                " b - - - - - - - - - - - - - - C ",
                "- - - - - - - - - - - - - - - - -",
                " c - - - - - - - - - - - - - - B ",
                "  - - - a - - - - - - - c - - -  ",
                "   - - - - - - - - - - - - - -  ",
                "    - - - - - - B - - - - - -   ",
                "     - - - - - - - - - - - -    ",
                "      - - - - - - - - - - -     ",
                "       C - - - - - - - - b      ",
                "        - A - - - - - a -      ",
            ].map((x) => x.replace(/ /g, ""));
        }
        if (this.variants.includes("hex-10")) {
            return [
                "         - - A - - - - a - -         ",
                "        B - - - - - - - - - c        ",
                "       - - - - - - - - - - - -       ",
                "      - - - - - - b - - - - - -      ",
                "     - - - - - - - - - - - - - -     ",
                "    - - - - - - - c - - - - - - -    ",
                "   - - - C - - - - - - - - A - - -   ",
                "  - - - - - - - - b - - - - - - - -  ",
                " b - - - - A - - - - - - - - - - - C ",
                "- - - - - - - - - - - - - - - - - - -",
                " c - - - - - - - - - - - a - - - - B ",
                "  - - - - - - - - B - - - - - - - -  ",
                "   - - - a - - - - - - - - c - - -   ",
                "    - - - - - - - C - - - - - - -    ",
                "     - - - - - - - - - - - - - -     ",
                "      - - - - - - B - - - - - -      ",
                "       - - - - - - - - - - - -       ",
                "        C - - - - - - - - - b        ",
                "         - A - - - - - - a -         ",
            ].map((x) => x.replace(/ /g, ""));
        }
        // else hexhex-8
        return [
            "       - A - - - - a -       ",
            "      B - - - - - - - c      ",
            "     - - - - - - - - - -     ",
            "    - - - - - b - - - - -    ",
            "   - - - - - - - - - - - -   ",
            "  - - - C - - - - - A - - -  ",
            " b - - - - - - - - - - - - C ",
            "- - - - - - - - - - - - - - -",
            " c - - - - - - - - - - - - B ",
            "  - - - a - - - - - c - - -  ",
            "   - - - - - - - - - - - -   ",
            "    - - - - - B - - - - -    ",
            "     - - - - - - - - - -     ",
            "      C - - - - - - - b      ",
            "       - A - - - - a -       ",
        ].map((x) => x.replace(/ /g, ""));
    }

    // get the initial board setup
    private initBoard(): Map<string, cellcontents> {
        const setup = this.setupString();
        const board = new Map<string, cellcontents>();

        for (const row of this.hexTriGraph!.listCells(true) as string[][]) {
            for (const cell of row) {
                const [x, y] = this.algebraic2coords(cell);
                const contents = setup[y][x];
                     if (contents === "A") { board.set(cell, [1, 1]); }
                else if (contents === "B") { board.set(cell, [1, 2]); }
                else if (contents === "C") { board.set(cell, [1, 3]); }
                else if (contents === "a") { board.set(cell, [2, 1]); }
                else if (contents === "b") { board.set(cell, [2, 2]); }
                else if (contents === "c") { board.set(cell, [2, 3]); }
            }
        }

        return board;
    }

    private getBoardSize(): number {
        for (const variant of this.variants) {
            const match = variant.match(new RegExp(`hex-(\\d+)`));
            if (match) return parseInt(match[1], 10);
        }
        return 8;
    }

    // update the scores with current piece count.
    private getNewScores(board?: Map<string, cellcontents>): [number, number] {
        board ??= this.board;
        const pieceCount1 = [...board].filter(x => x[1][0] === 1).length;
        const pieceCount2 = [...board].filter(x => x[1][0] === 2).length;
        return [pieceCount1, pieceCount2];
    }

    private getGraph(): HexTriGraph | undefined {
        return new HexTriGraph(this.boardSize, this.boardSize * 2 - 1);
    }

    private ray(cell: string, direction: HexDirection): string[] {
        const coords = this.algebraic2coords(cell);
        return this.hexTriGraph!.ray(...coords, direction).map(x => this.coords2algebraic(...x));
    }

    private getNeighbours(cell: string): string[] {
        return this.hexTriGraph!.neighbours(cell);
    }

    // get all possible tos for a from cell
    // the first array is the normal moves, the second array is the jumps
    private getSplitsJumps(from: string): [string[], string[]] {
        const splits: string[] = [];
        const jumps: string[] = [];

        for (const dir of allHexDirections) {
            const ray = this.ray(from, dir).slice(0, 2);
            for (const [i, cell] of ray.entries()) {
                if (this.board.has(cell)) { continue; }
                if (i === 0) {
                    splits.push(cell);
                } else {
                    jumps.push(cell);
                }
            }
        }
        // get non-straight jumps
        const clockwiseCheck: HexDirection[] = ["E", "SE", "SW", "W", "NW", "NE"];
        for (const [i, dir] of allHexDirections.entries()) {
            const next = this.hexTriGraph!.move(...this.algebraic2coords(from), dir);
            if (next === undefined) { continue; }
            const next2 = this.hexTriGraph!.move(...next, clockwiseCheck[i]);
            if (next2 === undefined) { continue; }
            const cell = this.coords2algebraic(...next2);
            if (this.board.has(cell)) { continue; }
            jumps.push(cell);
        }

        return [splits, jumps];
    }

    // get all possible tos for a `from` cell
    private getTos(from: string): string[] {
        const [splits, jumps] = this.getSplitsJumps(from);
        return [...splits, ...jumps];
    }

    // get all adjacent enemy pieces when `player` moves to `cell`
    private getCaptures(cell: string, player: playerid): string[] {
        const captures: string[] = [];

        for (const neighbour of this.getNeighbours(cell)) {
            if (!this.board.has(neighbour)) { continue; }
            if (this.board.get(neighbour)![0] === player) { continue; }
            captures.push(neighbour);
        }
        return captures;
    }

    public moves(): string[] {
        return []; // too many moves
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            let newmove = "";

            if (move === "") {
                newmove = cell;
            } else {
                const moves = move.split(/[,^-]/);
                if ( moves.length === 1 ) {
                    if ( cell === move ) {
                        newmove = "";
                    } else if ( this.board.has(cell) && this.board.get(cell)![0] === this.currplayer ) {
                        newmove = cell;
                    } else {
                        const neighs = this.getNeighbours(move);
                        newmove = neighs.includes(cell) ? `${move}-${cell}` : `${move}^${cell}`;
                    }
                } else { // first move already concluded
                    if (! move.includes(",") ) { // second move just starting
                        newmove = `${move},${cell}`;
                    } else { // otherwise, the player is clicking where the 2nd piece will go
                        if ( cell === moves[2] ) {
                            newmove = move.split(',')[0]; // reset 2nd move
                        } else {
                            const neighs = this.getNeighbours(move.split(',')[1]);
                            newmove = neighs.includes(cell) ? `${move}-${cell}` : `${move}^${cell}`;
                        }
                    }
                }
            }

            const result = this.validateMove(newmove) as IClickResult;
            result.move = result.valid ? newmove : move;
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", { move, row, col, piece, emessage: (e as Error).message })
            };
        }
    }

    // check if the player has any moves
    private hasMoves(player: playerid, board?: Map<string, cellcontents>): boolean {
        board ??= this.board;
        player ??= this.currplayer;
        const playerFroms = [...board].filter(x => x[1][0] === player).map(x => x[0]);

        for (const from of playerFroms) {
            if (this.getTos(from).length > 0) {
                return true;
            }
        }
        return false;
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = { valid: false,
                                            message: i18next.t("apgames:validation._general.DEFAULT_HANDLER") };
        const canMove = this.hasMoves(this.currplayer);

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            if ( canMove ) {
                result.message = i18next.t("apgames:validation.tricouleur.INITIAL_INSTRUCTIONS");
            } else {
                result.message = i18next.t("apgames:validation.tricouleur.INITIAL_INSTRUCTIONS_PASS");
            }
            return result;
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (m === "pass") {
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        // need to execute the first move, to check if the second is ok
        // so let's use a clone for that effect
        const clone = this.clone();
        // pieces that cannot be used in the second movement
        const taboo: string[] = []

        for (const move of m.split(',')) {
            if ( move === "pass" ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.tricouleur.ILLEGAL_PASS");
                return result;
            }

            const [from, to] = move.includes("^") ? move.split("^") : move.split("-");

            try {
                this.algebraic2coords(from); // is valid cell?
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: from });
                return result;
            }
            if (! clone.board.has(from) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NONEXISTENT", { where: from });
                return result;
            }
            if ( clone.board.get(from)![0] !== this.currplayer ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.UNCONTROLLED", { where: from });
                return result;
            }
            if ( taboo.includes(from) ) { // the 2nd piece must be different from the 1st move
                result.valid = false;
                result.message = i18next.t("apgames:validation.tricouleur.SAME_PIECE");
                return result;
            }

            const [splits, jumps] = clone.getSplitsJumps(from);
            const tos = [...splits, ...jumps];
            if ( tos.length === 0 ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.tricouleur.NO_TOS", { from });
                return result;
            }
            if ( to === undefined || to === "" ) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.tricouleur.SELECT_TO");
                return result;
            }

            try {
                this.algebraic2coords(to); // is valid cell?
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
            if (clone.board.has(to)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", { where: to });
                return result;
            }
            if (!tos.includes(to)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.tricouleur.INVALID_TO", { from, to });
                return result;
            }
            if (move.includes("-") && jumps.includes(to)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.tricouleur.SPLIT4JUMP", { move: `${from}^${to}` });
                return result;
            } else if (move.includes("^") && splits.includes(to)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.tricouleur.JUMP4SPLIT", { move: `${from}-${to}` });
                return result;
            }

            //// apply action in clone
            const pieceType = clone.board.get(from)![1];
            if (move.includes('^')) {
                clone.board.delete(from); // it was a jump, original position becomes empty
            } else {
                taboo.push(from); // if it was a move, this piece cannot be played in the 2nd movement
            }
            clone.board.set(to, [clone.currplayer, pieceType]);
            taboo.push(to);

            const opponentNeighbors = clone.getCaptures(to, clone.currplayer);
            if (opponentNeighbors.length > 0) {
                for (const neigh of opponentNeighbors) {
                    const opponentType = clone.board.get(neigh)![1];
                    if ( opponentType === pieceType ) { // neighbor pieces of equal type get captured
                        clone.board.delete(neigh);
                    } else if ( clone.isStronger(pieceType, opponentType) ) { // weaker pieces get flipped
                        clone.board.set(neigh, [clone.currplayer, pieceType]);
                        taboo.push(neigh);
                    }
                }
            }
            //// end apply action
        }

        result.valid = true;
        const scores = this.getNewScores();
        const totalHexes = 3 * this.boardSize * this.boardSize - 3 * this.boardSize + 1
        
        result.complete = this.stack.length === 1 ||              // if at ply 1, just one move is allowed
                          m.split(/[,^-]/).length === 4 ||        // if both moves were made
                          scores[this.currplayer-1] === 1 ||      // if there's only one friendly piece left
                          (canMove && !m.includes('^') && 
                           scores[0] + scores[1] === totalHexes - 1) // if there is only one hex left, a non-jump is final
                          ? 1 : -1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    // check if piece of type `t1` is stronger than piece of type `t2`
    // the strength relation is: 1 < 2 < 3 < 1
    private isStronger(t1: number, t2: number): boolean {
        return (t1 === 2 && t2 === 1) || (t1 === 3 && t2 === 2) || (t1 === 1 && t2 === 3);
    }

    public move(m: string, { partial = false, trusted = false } = {}): TricouleurGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) { throw new UserFacingError("VALIDATION_GENERAL", result.message); }
        }

        if (m.length === 0) { return this; }
        this.results = [];

        if (m === "pass") {
            this.results = [{ type: "pass" }];
        } else {
            for (const move of m.split(',')) {
                const [from, to] = move.includes("^") ? move.split("^") : move.split("-");
                const pieceType = this.board.get(from)![1];

                if (to === undefined || to === "") {
                    this.dots = this.getTos(from);
                } else {
                    let jump = false;
                    if (!this.getNeighbours(from).includes(to)) {
                        this.board.delete(from); // it was a jump, original position becomes empty
                        jump = true;
                    }

                    this.board.set(to, [this.currplayer, pieceType]);
                    this.results.push( { type: "move", from, to, how: jump ? "jump" : "split" } );

                    const opponentNeighbors = this.getCaptures(to, this.currplayer);
                    const showChanges = [];
                    if (opponentNeighbors.length > 0) {
                        for (const neigh of opponentNeighbors) {
                            const opponentType = this.board.get(neigh)![1];
                            if ( opponentType === pieceType ) { // neighbor pieces of equal type get captured
                                this.board.delete(neigh);
                                showChanges.push(neigh);
                            } else if ( this.isStronger(pieceType, opponentType) ) { // weaker pieces get flipped
                                this.board.set(neigh, [this.currplayer, pieceType]);
                                showChanges.push(neigh);
                            }
                        }
                        if ( showChanges.length > 0 ) {
                            this.results.push({ type: "capture", where: showChanges.join(","), count: showChanges.length });
                        }
                    }
                }
            } // for (moves)
        }

        this.scores = this.getNewScores();

        if ( partial ) { return this; }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): TricouleurGame {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stateCount = this.stateCount(new Map<string, any>([["board", this.board], ["currplayer", this.currplayer]]));

        // game ends if two consecutive passes occurred
        if ( this.lastmove === "pass" && this.stack[this.stack.length - 1].lastmove === "pass" ) {
            this.results.push({ type: "eog", reason: "two passes" });
            this.gameover = true;
        } else if (this.scores[this.currplayer - 1] === 0) {
            this.results.push({ type: "eog", reason: "elimination" });
            this.gameover = true;
        } else if (!this.hasMoves(1) && !this.hasMoves(2)) {
            this.results.push({ type: "eog", reason: "full board" });
            this.gameover = true
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

    public render(): APRenderRep {
        const pstr: string[][] = [];
        const cells = this.hexTriGraph!.listCells(true);
        for (const row of cells) {
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const [owner, piece] = this.board.get(cell)!;
                    if (owner === 1 && piece === 1) { pieces.push("A") }
                    if (owner === 1 && piece === 2) { pieces.push("B") }
                    if (owner === 1 && piece === 3) { pieces.push("C") }
                    if (owner === 2 && piece === 1) { pieces.push("D") }
                    if (owner === 2 && piece === 2) { pieces.push("E") }
                    if (owner === 2 && piece === 3) { pieces.push("F") }
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
                maxWidth: this.boardSize * 2 - 1,
            },
            legend: {
                A: [ { name: "piece",                   colour: 1 },
                     { name: "circle",                  colour: "#ffffff", scale: 0.6, opacity: 0.6 } ],
                B: [ { name: "piece",                   colour: 1 },
                     { name: "d6-empty",                colour: "#ffffff", scale: 0.5, opacity: 0.6 } ],
                C: [ { name: "piece",                   colour: 1 },
                     { name: "chess-ex-solid-millenia", colour: "#ffffff", scale: 0.5, opacity: 0.6 } ],
                D: [ { name: "piece",                   colour: 2 },
                     { name: "circle"   ,               colour: "#aaaaaa", scale: 0.6, opacity: 0.6 } ],
                E: [ { name: "piece",                   colour: 2 },
                     { name: "d6-empty",                colour: "#aaaaaa", scale: 0.5, opacity: 0.6 } ],
                F: [ { name: "piece",                   colour: 2 },
                     { name: "chess-ex-solid-millenia", colour: "#aaaaaa", scale: 0.5, opacity: 0.6 } ],
            },
            pieces: pstr.map(p => p.join("")).join("\n"),
        };

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
            case "pass":
                node.push(i18next.t("apresults:PASS.forced", { player }));
                resolved = true;
                break;
            case "eog":
                if (r.reason === "repetition") {
                    node.push(i18next.t("apresults:EOG.repetition", { count: 3 }));
                } else {
                    node.push(i18next.t("apresults:EOG.default"));
                }
                resolved = true;
                break;
        }
        return resolved;
    }

    public getButtons(): ICustomButton[] {
        return [ { label: "pass", move: "pass" } ];
    }

    public getPlayerScore(player: playerid): number {
        return this.scores[player - 1];
    }

    public sidebarScores(): IScores[] {
        return [ { name: i18next.t("apgames:status.SCORES"),
                   scores: [this.getPlayerScore(1), this.getPlayerScore(2)] } ];
    }

    public state(): ITricouleurState {
        return {
            game: TricouleurGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: TricouleurGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            scores: [...this.scores],
        };
    }

    public clone(): TricouleurGame {
        return new TricouleurGame(this.serialize());
    }
}
