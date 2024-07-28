import { GameBase, IAPGameState, IClickResult, ICustomButton, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { HexTriGraph } from "../common/graphs";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-var-requires
const deepclone = require("rfdc/default");

type PlayerId = 1|2|3|4;
type CellContent = [PlayerId, boolean];

export interface IMoveState extends IIndividualState {
    currplayer: PlayerId;
    board: Map<string, CellContent>;
    lastmove?: string;
    scores: [number, number];
    flips: [number, number];
    remainingPieces: [number, number];
    grayPieces: number;
};

export interface IDragonEyesState extends IAPGameState {
    winner: PlayerId[];
    stack: Array<IMoveState>;
};

export class DragonEyesGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Dragon Eyes",
        uid: "dragoneyes",
        playercounts: [2],
        version: "20240726",
        dateAdded: "2024-07-26",
        // i18next.t("apgames:descriptions.dragoneyes")
        description: "apgames:descriptions.dragoneyes",
        urls: ["https://www.chess.com/blog/Pokshtya/dragon-eyes"],
        people: [{
            type: "designer",
            name: "Vadrya Pokshtya",
        }],
        categories: ["goal>score>eog", "mechanic>capture", "mechanic>move", "board>shape>hex", "board>connect>hex", "components>simple>1per"],
        flags: ["automove", "limited-pieces", "custom-buttons"],
        variants: [{uid: "claimdraw", group: "rules"}]
    };

    public numplayers = 2;
    public boardsize = 6;
    public playerPieceCount = 42;
    public eyes: string[] = ["a1", "a6", "f1", "f6", "f11", "k1", "k6"];

    public currplayer: PlayerId = 1;
    public board!: Map<string, CellContent>;
    public graph?: HexTriGraph;
    public gameover = false;
    public winner: PlayerId[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public scores: [number, number] = [0, 0];
    public flips: [number, number] = [0, 0];
    public remainingPieces: [number, number] = [this.playerPieceCount, this.playerPieceCount];
    public grayPieces: number = 2*this.playerPieceCount;
    public _points: string[] = [];

    constructor(state?: IDragonEyesState | string, variants?: string[]) {
        super();
        this.buildGraph();
        if (state === undefined) {
            this.variants = variants === undefined ? [] : [...variants];
            const board = new Map<string, CellContent>();
            for (const cell of (this.listCells() as string[]).filter(c => !this.eyes.includes(c))) {
                board.set(cell, [3, false]);
            }
            const fresh: IMoveState = {
                _version: DragonEyesGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                scores: [0,0],
                flips: [0,0],
                remainingPieces: [42,42],
                grayPieces: 84
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IDragonEyesState;
            }
            if (state.game !== DragonEyesGame.gameinfo.uid) {
                throw new Error(`The Dragon Eyes engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): DragonEyesGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        this.board = deepclone(state.board) as Map<string, CellContent>;
        this.lastmove = state.lastmove;
        this.results = [...state._results];
        this.scores = [...state.scores];
        this.flips = [...state.flips];
        this.remainingPieces = [...state.remainingPieces];
        this.grayPieces = state.grayPieces;
        return this;
    }

    private buildGraph(): HexTriGraph {
        this.graph = new HexTriGraph(this.boardsize, (this.boardsize * 2) - 1);
        return this.graph;
    }

    private getGraph(): HexTriGraph {
        return (this.graph === undefined) ? this.buildGraph() : this.graph;
    }

    // Known issue with some edge cases not calling load
    private listCells(ordered = false): string[] | string[][] {
        try {
            if (ordered === undefined) return this.getGraph().listCells();
            else return this.getGraph().listCells(ordered);
        } catch (e) {
            return this.buildGraph().listCells(ordered);
        }
    }

    public getButtons(): ICustomButton[] {
        if (this.canDraw() && this.isClaimDraw()) {
            return [{ label: "draw", move: "draw" }];
        }
        return [];
    }

    private canDraw(): boolean {
        const otherPlayer = ((this.currplayer as number) % this.numplayers) + 1 as PlayerId;
        const captureCount = this.getAllCaptureMoves(this.currplayer).length;
        return this.scores[this.currplayer-1] > 0 &&
                this.scores[this.currplayer-1] === this.scores[otherPlayer-1] &&
                captureCount === 0 &&
                this.grayPieces === 0;
    }

    private isClaimDraw(): boolean {
        return this.variants !== undefined && this.variants.length !== 0 && this.variants.includes("claimdraw");
    }

    public moves(player?: PlayerId): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];
        moves.push(...this.getAllCaptureMoves(player));

        if (moves.length === 0) {
            moves.push(...(this.listCells() as string[]).filter(c => this.board.has(c) && this.board.get(c)![0] === 3));

            if (moves.length === 0) {
                for (const cell of (this.listCells() as string[]).filter(c => this.board.has(c) && this.board.get(c)![0] === player)) {
                    for (const target of this.getGraph().neighbours(cell).filter(c => !this.board.has(c))) {
                        moves.push(`${cell}-${target}`);
                    }
                }
            }
        }

        return moves;
    }

    private getAllCaptureMoves(player: PlayerId): string[] {
        const captures: string[] = [];
        for (const start of (this.listCells() as string[]).filter(c => this.board.has(c) && this.board.get(c)![0] === player)) {
            const jumps = this.getCaptureMoves(player, start, this.board);
            for (const jump of jumps) {
                captures.push(`${start}${jump}`);
            }
        }
        return captures;
    }

    private getVisibleEnemies(player: PlayerId, start: string, board: Map<string, CellContent>): string[] {
        if (!board.has(start)) return [];
        const enchanted = board.get(start)![1];
        if (enchanted) {
            const ret: string[] = [];
            const [x, y] = this.getGraph().algebraic2coords(start)!;
            for (const dir of HexTriGraph.directions) {
                for (const [i, j] of this.getGraph().ray(x, y, dir)) {
                    const cell = this.getGraph().coords2algebraic(i, j);
                    if (this.eyes.includes(cell)) break;
                    if (board.has(cell)) {
                        if (board.get(cell)![0] === (player === 1 ? 2 : 1)) {
                            ret.push(cell);
                        }
                        break;
                    }
                }
            }
            return ret;
        } else {
            return this.getGraph().neighbours(start).filter(c => board.has(c) && board.get(c)![0] === (player === 1 ? 2 : 1));
        }
    }

    private getLandingCells(start: string, enemy: string, board: Map<string, CellContent>): string[] {
        const ret: string[] = [];
        if (!board.has(start) || !board.has(enemy)) return ret;

        const enchanted = board.get(start)![1];
        const dir = this.getGraph().bearing(start, enemy)!;
        const [x, y] = this.getGraph().algebraic2coords(enemy)!;
        for (const [i, j] of this.getGraph().ray(x, y, dir)) {
            const cell = this.getGraph().coords2algebraic(i, j);
            if (board.has(cell) || (enchanted && this.eyes.includes(cell))) break;
            ret.push(cell);
            if (!enchanted) break;
        }
        return ret;
    }

    private getCaptureMoves(player: PlayerId, start: string, board: Map<string, CellContent>): string[] {
        const ret: string[] = [];
        if (!board.has(start)) return ret;

        const enemies = this.getVisibleEnemies(player, start, board);
        for (const enemy of enemies) {
            const landings = this.getLandingCells(start, enemy, board);
            for (const empty of landings) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-call
                const boardClone = deepclone(board) as Map<string, CellContent>;
                const enchanted = boardClone.get(start)![1] || this.eyes.includes(empty);
                boardClone.set(empty, [boardClone.get(start)![0], enchanted]);
                boardClone.delete(start);
                boardClone.delete(enemy);
                const nextJumps = this.getCaptureMoves(player, empty, boardClone);
                if (nextJumps.length === 0) {
                    ret.push(`-${empty}`);
                } else {
                    for (const jump of nextJumps) ret.push(`-${empty}${jump}`);
                }
            }
        }
        return ret;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    private getInstructions(): string {
        if (this.getAllCaptureMoves(this.currplayer).length > 0) {
            return i18next.t("apgames:validation.dragoneyes.INITIAL_INSTRUCTIONS_CAPTURE");
        } else if (this.grayPieces === 0) {
            return i18next.t("apgames:validation.dragoneyes.INITIAL_INSTRUCTIONS_TWO");
        } else {
            return i18next.t("apgames:validation.dragoneyes.INITIAL_INSTRUCTIONS_ONE");
        }
    }

    public handleClick(move: string, row: number, col: number): IClickResult {
        const result: IClickResult = { move: "", message: this.getInstructions(), valid: false, canrender: true, complete: -1 };
        const cell = this.getGraph().coords2algebraic(col, row);

        let newMove = "";
        if (move.length === 0) {
            newMove = cell;
        } else {
            newMove = `${move}-${cell}`;
        }

        const matches = this.moves().filter(mv => mv.startsWith(newMove));
        if (matches.length === 1) {
            result.move = matches[0];
            result.valid = true;
            result.complete = 1;
        } else if (matches.length > 1 && !matches[0].includes("-")) {
            result.move = newMove;
            result.valid = true;
            result.complete = 1;
        } else if (matches.length > 1) {
            for (let i = newMove.length; i < matches[0].length; i++) {
                const match = matches[0].substring(0, i+1);
                if (matches.length === matches.filter(mv => mv.startsWith(match)).length) {
                    newMove = match;
                } else {
                    break;
                }
            }
            newMove = newMove.substring(0, newMove.lastIndexOf("-"));
            result.move = newMove;
            result.valid = true;
        } else {
            result.canrender = false;
            result.move = move;
        }
        return result;
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = { message: this.getInstructions(), valid: false, canrender: false, complete: -1 };

        if (m.length === 0) {
            result.valid = true;
            result.canrender = true;
            return result;
        }

        if (m === "draw") {
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        const moves = this.moves();
        if (moves.includes(m)) {
            result.valid = true;
            result.canrender = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        for (const move of moves) {
            if (move.startsWith(m)) {
                const cells = m.split("-");
                for (const cell of cells) {
                    try {
                        this.getGraph().algebraic2coords(cell);
                    } catch (e) {
                        result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                        return result;
                    }
                }
                result.valid = true;
                result.canrender = true;
                return result;
            }
        }

        return result;
    }

    public move(m: string, {trusted = false, partial = false, emulation = false} = {}): DragonEyesGame {
        if (m === "") return this;
        if (this.gameover) throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));

        this.results = [];

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (m === "draw" && this.canDraw() && this.isClaimDraw()) {
            this.gameover = true;
            this.winner = [1,2];
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
            this.saveState();
            return this;
        }

        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
        }

        const moves = this.moves();
        const cells: string[] = m.split("-");
        if (cells.length === 1 && this.board.has(cells[0]) && this.board.get(cells[0])![0] === 3) {
            if (emulation) {
                this.board.set(cells[0], [4, false]);
            } else {
                if (Math.floor(Math.random()*this.grayPieces) < (this.playerPieceCount-this.flips[0])) {
                    this.flips[0]++;
                    this.grayPieces--;
                    this.board.set(cells[0], [1, false]);
                    this.results.push({ type: "flip", where: cells[0], revealed: "red" });
                } else {
                    this.flips[1]++;
                    this.grayPieces--;
                    this.board.set(cells[0], [2, false]);
                    this.results.push({ type: "flip", where: cells[0], revealed: "blue" });
                }
            }
        }

        while (cells.length >= 2 && this.board.has(cells[0]) && this.board.get(cells[0])![0] === this.currplayer && !this.board.has(cells[1])) {
            this.board.set(cells[1], [this.currplayer, this.board.get(cells[0])![1] || this.eyes.includes(cells[1])]);
            this.board.delete(cells[0]);
            this.results.push({type: "move", from: cells[0], to: cells[1]});

            const path = this.getGraph().path(cells[0], cells[1]);
            if (path !== null) {
                for (const step of path) {
                    if (this.board.has(step) && this.board.get(step)![0] === (this.currplayer === 1 ? 2 : 1)) {
                        if (this.board.get(step)![0] === 1) this.remainingPieces[0]--;
                        else this.remainingPieces[1]--;
                        this.board.delete(step);
                        this.results.push({type: "capture", where: step});
                    }
                }
            }
            cells.shift();
        }

        this._points = [];
        if (partial) {
            const matches = moves.filter(mv => mv.startsWith(m));
            for (const match of matches) {
                const jumpCells: string[] = match.substring(m.length+1).split("-");
                if (jumpCells[0].length !== 0 && !this._points.includes(jumpCells[0])) this._points.push(jumpCells[0]);
            }
        } else {
            for (const cell of (this.listCells() as string[]).filter(c => this.board.has(c) && this.board.get(c)![1] && !this.eyes.includes(c))) {
                this.board.set(cell, [this.board.get(cell)![0], false]);
            }
        }

        this.scores[0] = this.eyes.filter(c => this.board.has(c) && this.board.get(c)![0] === 1).length;
        this.scores[1] = this.eyes.filter(c => this.board.has(c) && this.board.get(c)![0] === 2).length;

        this.lastmove = m;
        this.currplayer = ((this.currplayer as number) % this.numplayers) + 1 as PlayerId;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): DragonEyesGame {
        if (this.grayPieces !== 0) return this;

        const otherPlayer = ((this.currplayer as number) % this.numplayers) + 1 as PlayerId;

        if (this.remainingPieces[this.currplayer-1] === 0 ||
                (this.grayPieces === 0 && this.moves().length === 0)) {
            this.gameover = true;
            this.winner = [otherPlayer];
        } else if (this.grayPieces === 0) {
            const captureCount = this.getAllCaptureMoves(this.currplayer).length;
            if (this.scores[this.currplayer-1] > this.scores[otherPlayer-1] && captureCount === 0) {
                this.gameover = true;
                this.winner = [this.currplayer];
            } else if (this.canDraw() && !this.isClaimDraw()) {
                this.gameover = true;
                this.winner = [1,2];
            }
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }

        return this;
    }

    public state(): IDragonEyesState {
        return {
            game: DragonEyesGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: DragonEyesGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            board: deepclone(this.board) as Map<string, CellContent>,
            scores: [...this.scores],
            flips: [...this.flips],
            remainingPieces: [...this.remainingPieces],
            grayPieces: this.grayPieces
        };
    }

    public render(): APRenderRep {
        const pstr: string[][] = [];
        for (const row of (this.listCells(true) as string[][])) {
            const pieces: string[] = [];
            for (const cell of row) {
                if (!this.board.has(cell)) {
                    pieces.push("-");
                } else if (this.board.get(cell)![0] === 1) {
                    pieces.push(this.board.get(cell)![1] ? "D" : "A");
                } else if (this.board.get(cell)![0] === 2) {
                    pieces.push(this.board.get(cell)![1] ? "E" : "B");
                } else if (this.board.get(cell)![0] === 4) {
                    pieces.push("F");
                } else {
                    pieces.push("C");
                }
            }
            pstr.push(pieces);
        }

        let floodMarkers: [{ row: number; col: number; }, ...{ row: number; col: number; }[]] | undefined;
        for (const eye of this.eyes) {
            const [col, row] = this.getGraph().algebraic2coords(eye);
            if (floodMarkers === undefined) {
                floodMarkers = [{row, col}];
            } else {
                floodMarkers.push({row, col});
            }
        }

        const rep: APRenderRep = {
            board: {
                style: "hex-of-hex",
                minWidth: this.boardsize,
                maxWidth: (this.boardsize * 2) - 1,
                markers: floodMarkers === undefined ? undefined : [{
                    type: "flood",
                    colour: 3,
                    opacity: 0.6,
                    points: floodMarkers
                }]
            },
            legend: {
                A: { name: "piece", colour: 1 },
                B: { name: "piece", colour: 2 },
                C: { name: "piece", colour: 9 },
                D: { name: "piece-horse", colour: 1 },
                E: { name: "piece-horse", colour: 2 },
                F: { name: "piece", colour: 5 }
            },
            pieces: pstr.map(p => p.join("")).join("\n")
        };

        // Add annotations
        rep.annotations = [];

        // Highlight capture starts
        if (this._points.length === 0) {
            for (const move of this.getAllCaptureMoves(this.currplayer)) {
                const moveCells = move.split("-");
                if (moveCells.length > 1 && !this._points.includes(moveCells[0])) {
                    this._points.push(moveCells[0]);
                }
            }
        }

        if (this.results.length > 0) {
            // highlight last-placed piece
            // this has to happen after eog annotations to appear correctly
            for (const move of this.results) {
                if (move.type === "flip") {
                    const [x, y] = this.getGraph().algebraic2coords(move.where);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                } else if (move.type === "move") {
                    const [fromX, fromY] = this.getGraph().algebraic2coords(move.from);
                    const [toX, toY] = this.getGraph().algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "capture") {
                    const [x, y] = this.getGraph().algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                }
            }
        }

        const points = [];
        for (const cell of this._points) {
            const [col, row] = this.getGraph().algebraic2coords(cell)!;
            points.push({row, col});
        }
        if (points.length > 0) {
            rep.annotations.push({type: "dots", targets: points as [{row: number; col: number;}, ...{row: number; col: number;}[]]});
        }

        if (rep.annotations.length === 0) {
            delete rep.annotations;
        }

        return rep;
    }

    public getPlayerScore(player: PlayerId): number {
        return this.scores[player - 1];
    }

    public getPlayersScores(): IScores[] {
        return [{
            name: i18next.t("apgames:status.SCORES"),
            scores: [this.scores[0], this.scores[1]]
        }];
    }

    public status(): string {
        let status = super.status();
        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }
        status += `**Scores**: ${this.getPlayerScore(1)}-${this.getPlayerScore(2)}\n\n`;
        status += `**Remaining Pieces**: ${this.remainingPieces[0]}-${this.remainingPieces[1]}\n\n`;
        return status;
    }

    public clone(): DragonEyesGame {
        return new DragonEyesGame(this.serialize());
    }
}
