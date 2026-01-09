/* eslint-disable no-console */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APMoveResult } from "../schemas/moveresults";
import { DirectionCardinal, reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { InARowBase } from "./in_a_row/InARowBase";
import { APRenderRep } from "@abstractplay/renderer";
import { MarkerEdge } from "@abstractplay/renderer/src/schemas/schema";

type playerid = 1 | 2;

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
    lastmoveSide?: DirectionCardinal;
    winningLines: string[][];
    swapped: boolean;
}

export interface IKrypteState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class KrypteGame extends InARowBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Krypte",
        uid: "krypte",
        playercounts: [2],
        version: "20260108",
        dateAdded: "2026-01-08",
        // i18next.t("apgames:descriptions.krypte")
        description: "apgames:descriptions.krypte",
        urls: ["https://boardgamegeek.com/boardgame/209858/krypte"],
        people: [
            {
                type: "designer",
                name: "Marino Carpignano",
                urls: ["https://boardgamegeek.com/boardgamedesigner/95427/marino-carpignano"],
                apid: "091df2d1-4e19-4916-8101-627a792b7c06",
            },
            {
                type: "coder",
                name: "hoembla",
                urls: [],
                apid: "36926ace-08c0-417d-89ec-15346119abf2",
            },
        ],
        categories: ["goal>align", "mechanic>place", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        displays: [ // default: All highlights enabled
            {uid: "moves_no_sides_yes"},
            {uid: "moves_yes_sides_no"},
            {uid: "moves_no_sides_no"},
        ]
    };

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardSize, true);
    }

    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardSize, true);
    }

    private clockwiseNextDirection(dir: DirectionCardinal): DirectionCardinal {
        return {"N": "E", "E": "S", "S": "W", "W": "N"}[dir] as DirectionCardinal
    }

    private side2dxdy(dir: DirectionCardinal): [number, number] {
        /* Convert the side at which the piece is entered (i.e. the *OPPOSITE* direction from the
        one in which the piece slides) to dcol, drow */
        return {
            "N": [0, 1],
            "E": [-1, 0],
            "S": [0, -1],
            "W": [1, 0]
        }[dir] as [number, number]
    }


    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, playerid>;
    public winningLines: string[][] = [];
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    public swapped = false;
    public boardSize = 8;
    public defaultBoardSize = 8;
    public winningLineLength = 4;
    public lastmoveSide?: DirectionCardinal = undefined;

    constructor(state?: IKrypteState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: KrypteGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                winningLines: [],
                swapped: false
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IKrypteState;
            }
            if (state.game !== KrypteGame.gameinfo.uid) {
                throw new Error(`The Krypte game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): KrypteGame {
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
        this.winningLines  = state.winningLines.map(a => [...a]);
        this.swapped = state.swapped;
        this.lastmove = state.lastmove;
        this.lastmoveSide = state.lastmoveSide;
        this.boardSize = this.getBoardSize();
        return this;
    }

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }
        const moves: string[] = [];
        for (const activeSide of this.activeSides()) {
            for (const entryCell of this.sideCells(activeSide)) {
                const move = this.slidePiece(entryCell, activeSide);
                if (move !== undefined && !this.isAmbiguousMove(move)) {
                    moves.push(move);
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
        // TODO convert click on entry cell to target cell
        try {
            let newmove = "";
            const cell = this.coords2algebraic(col, row);
            if (move === "") {
                newmove = cell;
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

    private outOfBounds(x: number, y: number): boolean {
        return x < 0 || x >= this.boardSize || y < 0 || y >= this.boardSize;
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.krypte.INITIAL_INSTRUCTIONS");
            return result;
        }

        // Valid cell
        try {
            const [x, y] = this.algebraic2coords(m);
            // `algebraic2coords` does not check if the cell is on the board.
            if (this.outOfBounds(x, y)) {
                throw new Error("Invalid cell");
            }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: m });
            return result;
        }
        // Cell is empty
        if (this.board.has(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", { where: m });
            return result;
        }
        if (!this.moves().includes(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", { move: m });
            return result;
        }

        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {partial = false, trusted = false} = {}): KrypteGame {
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
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}));
            }
        }
        if (m.length === 0) { return this; }

        /* Store side from which the move was made (must be computed before the board
        is updated) */
        const [side1, side2] = this.activeSides();
        const moveSide = this.isMoveFromSide(m, side1) ? side1 : side2;
        
        this.results = [];
        
        this.results.push({ type: "place", where: m });
        this.board.set(m, this.currplayer);
        
        if (partial) { return this; }
        
        this.lastmoveSide = moveSide;
        
        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    private activeSides(): DirectionCardinal[] {
        if (this.lastmoveSide === undefined) {
            return ["N"];
        } else {
            const next = this.clockwiseNextDirection(this.lastmoveSide);
            const nextnext = this.clockwiseNextDirection(next);
            return [next, nextnext];
        }
    }

    private sideCells(side: DirectionCardinal): string[] {
        const cells = [];
        switch (side) {
        case "N":
            for (let col = 0; col < this.boardSize; col++){
                cells.push(this.coords2algebraic(col, 0));
            }
            break;
        case "S":
            for (let col = 0; col < this.boardSize; col++){
                cells.push(this.coords2algebraic(col, this.boardSize - 1));
            }
            break;
        case "W":
            for (let row = 0; row < this.boardSize; row++){
                cells.push(this.coords2algebraic(0, row));
            }
            break;
        case "E":
            for (let row = 0; row < this.boardSize; row++){
                cells.push(this.coords2algebraic(this.boardSize - 1, row));
            }
            break;
        }
        return cells;
    }

    private slidePiece(cell: string, side: DirectionCardinal): string | undefined {
        let [col, row] = this.algebraic2coords(cell);
        const [dcol, drow] = this.side2dxdy(side);
        while (! this.outOfBounds(col, row)) {
            const newCell = this.coords2algebraic(col, row);
            if (! this.board.has(newCell)) {
                return newCell;
            } else {
                col += dcol;
                row += drow;
            }
        }
        return undefined;
    }

    private entryCellFromMove(cell: string, side: DirectionCardinal): string {
        /* Get the potential entry cell of a move (regardless of intervening pieces) */
        let [col, row] = this.algebraic2coords(cell);
        switch (side) {
        case "N":
            row = 0;
            break;
        case "S":
            row = this.boardSize - 1;
            break;
        case "W":
            col = 0;
            break;
        case "E":
            col = this.boardSize - 1;
            break;
        }
        return this.coords2algebraic(col, row);
    }

    private isMoveFromSide(cell: string, side: DirectionCardinal): boolean {
        return this.slidePiece(this.entryCellFromMove(cell, side), side) === cell;
    }

    private isAmbiguousMove(cell: string): boolean {
        if (this.activeSides().length !== 2) {
            return false;
        }
        const [side1, side2] = this.activeSides();
        return this.isMoveFromSide(cell, side1) && this.isMoveFromSide(cell, side2);
    }

    protected checkEOG(): KrypteGame {
        const winningLinesMap = this.getWinningLinesMap();
        const winner: playerid[] = [];
        this.winningLines = [];
        for (const player of [1, 2] as playerid[]) {
            if (winningLinesMap.get(player)!.length > 0) {
                winner.push(player);
                this.winningLines.push(...winningLinesMap.get(player)!);
            }
        }
        if (winner.length > 0) {
            this.gameover = true;
            this.winner = winner;
        }
        if (this.gameover) {
            this.results.push({ type: "eog" });
            this.results.push({ type: "winners", players: [...this.winner] });
        }
        return this;
    }

    public render(opts?: IRenderOpts): APRenderRep {
        let altDisplay: string | undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }
        let showMoves = true;
        let showSides = true;
        if (altDisplay !== undefined) {
            if (altDisplay === "moves_no_sides_yes") {
                showMoves = false;
                showSides = true;
            }
            if (altDisplay === "moves_yes_sides_no") {
                showMoves = true;
                showSides = false;
            }
            if (altDisplay === "moves_no_sides_no") {
                showMoves = false;
                showSides = false;
            }
        }

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

        const markers: MarkerEdge[] = [];

        if (showSides) {
            for (const side of this.activeSides()) {
                markers.push({
                    type: "edge",
                    edge: side,
                    colour: 3 // active player colour? or one of _context_fill, _context_background, _context_borders, _context_strokes?
                })
            }
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares",
                width: this.boardSize,
                height: this.boardSize,
                markers: markers
            },
            options: [
                "reverse-numbers"
            ],
            legend: {
                A: [{ name: "piece", colour: this.getPlayerColour(1) as playerid }],
                B: [{ name: "piece", colour: this.getPlayerColour(2) as playerid }],
            },
            pieces: pstr,
        };

        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                } else if (move.type === "capture") {
                    for (const cell of move.where!.split(",")) {
                        const [x, y] = this.algebraic2coords(cell);
                        rep.annotations.push({ type: "exit", targets: [{ row: y, col: x }] });
                    }
                }
            }
            const renderWinningLines = this.renderWinningLines(this.winningLines);
            if (renderWinningLines.length > 0) {
                for (const connPath of renderWinningLines) {
                    if (connPath.length === 1) { continue; }
                    type RowCol = {row: number; col: number;};
                    const targets: RowCol[] = [];
                    for (const coords of connPath) {
                        targets.push({row: coords[1], col: coords[0]})
                    }
                    rep.annotations.push({type: "move", targets: targets as [RowCol, ...RowCol[]], arrow: false});
                }
            }
        }
        if (showMoves) {
            for (const cell of this.moves()){
                const [x, y] = this.algebraic2coords(cell);
                rep.annotations.push({ type: "dots", targets: [{ row: y, col: x }] });
            }
        }
        return rep;
    }

    public state(): IKrypteState {
        return {
            game: KrypteGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: KrypteGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            lastmoveSide: this.lastmoveSide,
            board: new Map(this.board),
            winningLines: this.winningLines.map(a => [...a]),
            swapped: this.swapped
        };
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        return status;
    }

    public clone(): KrypteGame {
        return new KrypteGame(this.serialize());
    }
}
