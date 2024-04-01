import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { InARowBase } from "./in_a_row/InARowBase";
import { APRenderRep } from "@abstractplay/renderer";

type playerid = 1 | 2;

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
    captureCounts: [number, number];
    winningLines: string[][];
    swapped: boolean;
    tiebreaker?: playerid;
}

export interface IConnect6State extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class Connect6Game extends InARowBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Connect6",
        uid: "connect6",
        playercounts: [2],
        version: "20240328",
        dateAdded: "2024-03-28",
        // i18next.t("apgames:descriptions.connect6")
        description: "apgames:descriptions.connect6",
        urls: ["https://boardgamegeek.com/boardgame/22847/connect6"],
        people: [
            {
                type: "designer",
                name: "Professor I-Chen Wu",
            },
        ],
        variants: [
            { uid: "toroidal-15", group: "board" },
            { uid: "pass", group: "tiebreaker" },
        ],
        categories: ["goal>align", "mechanic>place", "board>shape>rect", "board>connect>rect", "components>simple"],
        flags: ["experimental", "multistep", "custom-colours", "rotate90"],
    };

    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardSize);
    }

    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardSize);
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
    public captureCounts: [number, number] = [0, 0];
    public swapped = false;
    public boardSize = 0;
    private openingProtocol: "centre";
    public toroidal = false;
    public winningLineLength = 6;
    public overline = "win" as "win" | "ignored" | "forbidden";
    private passTiebreaker = false;
    private tiebreaker?: playerid;

    constructor(state?: IConnect6State | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: Connect6Game.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                captureCounts: [0, 0],
                winningLines: [],
                swapped: false,
                tiebreaker: undefined,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IConnect6State;
            }
            if (state.game !== Connect6Game.gameinfo.uid) {
                throw new Error(`The Connect6 game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
        this.openingProtocol = this.getOpeningProtocol();
        this.toroidal = this.variants.some(v => v.startsWith("toroidal"));
        this.passTiebreaker = this.variants.includes("pass");
    }

    public load(idx = -1): Connect6Game {
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
        this.captureCounts = [...state.captureCounts];
        this.winningLines  = state.winningLines.map(a => [...a]);
        this.swapped = state.swapped;
        this.tiebreaker = state.tiebreaker;
        this.lastmove = state.lastmove;
        this.boardSize = this.getBoardSize();
        return this;
    }

    private getOpeningProtocol(): "centre" {
        return "centre";
    }

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        if (this.gameover) { return []; }
        if (this.stack.length === 1 && this.openingProtocol === "centre") {
            return [this.coords2algebraic((this.boardSize - 1) / 2, (this.boardSize - 1) / 2)];
        }
        const moves: string[] = [];
        for (let row = 0; row < this.boardSize; row++) {
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) { continue; }
                for (let row1 = row; row1 < this.boardSize; row1++) {
                    for (let col1 = row1 === row ? col + 1 : 0; col1 < this.boardSize; col1++) {
                        const cell1 = this.coords2algebraic(col1, row1);
                        if (this.board.has(cell1)) { continue; }
                        moves.push(this.normalisePlacement(cell + "," + cell1));
                    }
                }
            }
        }
        if (this.passTiebreaker && this.tiebreaker === undefined && this.pastOpening()) {
            moves.push("pass");
        }
        return moves;
    }

    private pastOpening(): boolean {
        // If pass tiebreaker is enabled, we can pass after the opening phase.
        if (this.stack.length > 1) { return true; }
        return false;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    private sort(a: string, b: string): number {
        // Sort two cells. This is necessary because "a10" should come after "a9".
        const [ax, ay] = this.algebraic2coords(a);
        const [bx, by] = this.algebraic2coords(b);
        if (ax < bx) { return -1; }
        if (ax > bx) { return 1; }
        if (ay < by) { return 1; }
        if (ay > by) { return -1; }
        return 0;
    }

    private normalisePlacement(m: string): string {
        // Normalise placement string for swap2 opening.
        // If there are three placements, sort the first and third placements.
        const moves = m.split(",");
        return moves.sort((a, b) => this.sort(a, b)).join(",");
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = "";
            const cell = this.renderCoords2algebraic(col, row);
            if (move === "") {
                newmove = cell;
            } else {
                newmove = this.normalisePlacement(move + "," + cell);
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
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        if (m.length === 0) {
            let message = i18next.t("apgames:validation.connect6.INITIAL_INSTRUCTIONS");
            if (this.openingProtocol === "centre") {
                if (this.stack.length === 1) {
                    message += i18next.t("apgames:validation.connect6.INITIAL_INSTRUCTIONS_CENTRE1");
                }
            }
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = message;
            return result;
        }
        if (m === "pass") {
            if (this.passTiebreaker && this.pastOpening()) {
                if (this.tiebreaker !== undefined) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.connect6.TIEBREAKER_TAKEN");
                    return result;
                }
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.connect6.CANNOT_PASS");
                return result;
            }
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
        const moves = m.split(",");
        // Valid cell
        let currentMove;
        try {
            for (const p of moves) {
                currentMove = p;
                const [x, y] = this.algebraic2coords(p);
                // `algebraic2coords` does not check if the cell is on the board.
                if (x < 0 || x >= this.boardSize || y < 0 || y >= this.boardSize) {
                    throw new Error("Invalid cell");
                }
            }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", { cell: currentMove });
            return result;
        }
        // Cell is empty
        let notEmpty;
        for (const p of moves) {
            if (this.board.has(p)) { notEmpty = p; break; }
        }
        if (notEmpty) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", { where: notEmpty });
            return result;
        }
        if (this.stack.length === 1) {
            if (moves.length > 1) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.connect6.EXCESS_FIRST");
                return result;
            }
            if (this.openingProtocol === "centre" && !this.isNearCentre(moves[0], 0)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.connect6.CENTRE_FIRST");
                return result;
            }
        } else {
            if (moves.length === 1) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.connect6.ONE_MORE");
                return result;
            }
            if (moves.length > 2) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.connect6.EXCESS");
                return result;
            }
        }
        // No duplicate cells.
        if (moves.length > 1) {
            const seen: Set<string> = new Set();
            const duplicates: Set<string> = new Set();
            for (const move of moves) {
                if (seen.has(move)) {
                    duplicates.add(move);
                }
                seen.add(move);
            }
            if (duplicates.size > 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.connect6.DUPLICATE", { where: [...duplicates].join(",") });
                return result;
            }
        }
        // Since there is no move list for placement phase, we have to do some extra validation.
        const regex = new RegExp(`^([a-z]+[1-9][0-9]*)(,[a-z]+[1-9][0-9]*)*$`);
        if (!regex.test(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.connect6.INVALID_PLACEMENT", {move: m});
            return result;
        }
        const normalised = this.normalisePlacement(m);
        if (m !== normalised) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.connect6.NORMALISE", {normalised});
            return result;
        }
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {partial = false, trusted = false} = {}): Connect6Game {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        let result;
        if (m === "No movelist in swap2 opening") {
            result = {valid: false, message: i18next.t("apgames:validation.connect6.NO_MOVELIST")};
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
        this.results = [];
        if (m === "pass") {
            this.tiebreaker = this.currplayer;
            this.results.push({ type: "pass" });
        } else {
            const moves = m.split(",");
            for (const move of moves) {
                this.results.push({ type: "place", where: move });
                this.board.set(move, this.currplayer);
            }
        }
        if (partial) { return this; }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): Connect6Game {
        const winningLinesMap = this.getWinningLinesMap();
        const winner: playerid[] = [];
        this.winningLines = [];
        for (const player of [1, 2] as playerid[]) {
            if (winningLinesMap.get(player)!.length > 0) {
                winner.push(player);
                this.winningLines.push(...winningLinesMap.get(player)!);
            }
        }
        if (winner.length === 0) {
            const allMoves = this.moves();
            if (this.passTiebreaker) {
                if (allMoves.length === 0 || allMoves.length === 1 && allMoves[0] === "pass") {
                    if (this.tiebreaker === undefined) {
                        winner.push(this.swapped ? 1 : 2);
                    } else {
                        winner.push(this.tiebreaker);
                    }
                }
            } else {
                if (allMoves.length === 0) {
                    winner.push(1);
                    winner.push(2);
                }
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

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        const renderBoardSize = this.toroidal ? this.boardSize + 2 * this.toroidalPadding : this.boardSize;
        for (let row = 0; row < renderBoardSize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            for (let col = 0; col < renderBoardSize; col++) {
                const cell = this.renderCoords2algebraic(col, row);
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
        pstr = pstr.replace(new RegExp(`-{${renderBoardSize}}`, "g"), "_");
        let markers: Array<any> | undefined = []
        if (this.stack.length === 1 && this.openingProtocol === "centre") {
            markers.push({
                type: "dots", points: [{ row: (renderBoardSize - 1) / 2, col: (renderBoardSize - 1) / 2 }]
            });
        }
        if (this.toroidal) {
            const end = this.boardSize + 2 * this.toroidalPadding;
            markers.push(...[
                {
                    type: "shading", colour: "#000", opacity: 0.2,
                    points: [{row: 0, col: 0}, {row: 0, col: this.toroidalPadding}, {row: end - 1, col: this.toroidalPadding}, {row: end - 1, col: 0}],
                },
                {
                    type: "shading", colour: "#000", opacity: 0.2,
                    points: [{row: 0, col: end - 1 - this.toroidalPadding}, {row: 0, col: end - 1}, {row: end - 1, col: end - 1}, {row: end - 1, col: end - 1 - this.toroidalPadding}],
                },
                {
                    type: "shading", colour: "#000", opacity: 0.2,
                    points: [{row: 0, col: this.toroidalPadding}, {row: 0, col: end - 1 - this.toroidalPadding}, {row: this.toroidalPadding, col: end - 1 - this.toroidalPadding}, {row: this.toroidalPadding, col: this.toroidalPadding}],
                },
                {
                    type: "shading", colour: "#000", opacity: 0.2,
                    points: [{row: end - 1 - this.toroidalPadding, col: this.toroidalPadding}, {row: end - 1 - this.toroidalPadding, col: end - 1 - this.toroidalPadding}, {row: end - 1, col: end - 1 - this.toroidalPadding}, {row: end - 1, col: this.toroidalPadding}],
                },
            ]);
        }
        if (markers.length === 0) {
            markers = undefined;
        }
        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "vertex",
                width: renderBoardSize,
                height: renderBoardSize,
                rowLabels: this.toroidal ? this.renderRowLabels() : undefined,
                columnLabels: this.toroidal ? this.renderColLabels() : undefined,
                markers,
            },
            legend: {
                A: [{ name: "piece", player: this.getPlayerColour(1) as playerid }],
                B: [{ name: "piece", player: this.getPlayerColour(2) as playerid }],
            },
            pieces: pstr,
        };

        // @ts-ignore
        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const coordsAll = this.renderAlgebraic2coords(move.where!);
                    for (const [x, y] of coordsAll) {
                        rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                    }
                } else if (move.type === "capture") {
                    for (const cell of move.where!.split(",")) {
                        const coordsAll = this.renderAlgebraic2coords(cell);
                        for (const [x, y] of coordsAll) {
                            rep.annotations.push({ type: "exit", targets: [{ row: y, col: x }] });
                        }
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
                    // @ts-ignore
                    rep.annotations.push({type: "move", targets, arrow: false});
                }
            }
        }
        return rep;
    }

    public state(): IConnect6State {
        return {
            game: Connect6Game.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: Connect6Game.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            captureCounts: [...this.captureCounts],
            winningLines: this.winningLines.map(a => [...a]),
            swapped: this.swapped,
            tiebreaker: this.tiebreaker,
        };
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        return status;
    }

    public clone(): Connect6Game {
        return new Connect6Game(this.serialize());
    }
}