import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import { InARowBase } from "./in_a_row/InARowBase";
import { APRenderRep } from "@abstractplay/renderer";

import i18next from "i18next";

type playerid = 1 | 2;

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
    winningLines: string[][];
    swapped: boolean;
    lastDaggerUse : number[];
}

export interface IStilettoState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class StilettoGame extends InARowBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Stiletto",
        uid: "stiletto",
        playercounts: [2],
        version: "20260221",
        dateAdded: "2026-02-21",
        // i18next.t("apgames:descriptions.Stiletto")
        description: "apgames:descriptions.stiletto",
        urls: ["https://jpneto.github.io/world_abstract_games/dagger_gomoku.htm"],
        people: [
            {
                type: "designer",
                name: "Bill Taylor",
                urls: ["https://boardgamegeek.com/boardgamedesigner/9249/bill-taylor"],
            },
            {
                type: "designer",
                name: "João Pedro Neto",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3829/joao-pedro-neto"],
                apid: "9228bccd-a1bd-452b-b94f-d05380e6638f",
            },
            {
                type: "coder",
                name: "João Pedro Neto",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3829/joao-pedro-neto"],
                apid: "9228bccd-a1bd-452b-b94f-d05380e6638f",
            },
        ],
        categories: ["goal>align", "mechanic>place", "board>shape>rect",
                     "board>connect>rect", "components>simple>1per"],
        flags: ["no-moves", "custom-colours", "experimental"],
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
    public winningLineLength = 5;
    public defaultBoardSize = 19;
    public boardSize = 0;
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    public lastDaggerUse = [0, -1]; // last #turn each player used the dagger
    public swapped = false; // abstract attribute of InARowBase

    constructor(state?: IStilettoState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: StilettoGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                winningLines: [],
                swapped: false,
                lastDaggerUse : [0, -1] // second player starts with dagger
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IStilettoState;
            }
            if (state.game !== StilettoGame.gameinfo.uid) {
                throw new Error(`The Stiletto game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): StilettoGame {
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
        this.boardSize = this.getBoardSize();
        this.lastDaggerUse = [...state.lastDaggerUse];
        return this;
    }

    private currentTurn(): number {
        return this.stack.length;
    }

    private whoHasDagger(): playerid {
        // the last player to have used the dagger has a higher lastDaggerUse turn
        const [turn_p1, turn_p2] = this.lastDaggerUse;
        return turn_p1 > turn_p2 ? 2 : 1;
    }

    private hasDagger(): boolean {
        return this.currplayer == this.whoHasDagger();
    }

    private hasActiveDagger(): boolean {
        // an active dagger means the player must have the dagger...
        if (! this.hasDagger() ) {
            return false;
        }

        // ...and the player must not have used it in his previous turn...
        const lastDaggerUsePlayer = this.lastDaggerUse[this.currplayer - 1];
        if (lastDaggerUsePlayer < this.currentTurn() - 2) {
            return true;
        }

        /* ..._unless_ there are immediate loss threats!
         * We'll cycle thru all cells (x,y) and count how many hasInARow(x,y) result
         * in a winning line; if there are more than one, the dagger becomes active
         * note: if there are more than two threats, the dagger is not enough,
         *       but the player can use it nonetheless
         * Use: InARowBase.hasInARow(x: number, y: number, player: playerid,
         *                           inARow: number, exact: boolean): boolean
         */
        const otherplayer  = (this.currplayer % 2 + 1) as playerid;
        let countThreats = 0;

        for (let row = 0; row < this.boardSize; row++) {
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) { continue; }
                if (this.hasInARow(col, row, otherplayer, this.winningLineLength, false)) {
                    countThreats += 1;
                }
            }
        }
        return countThreats > 1;
    }

    private isIllegalExtension(moves : string[]): boolean {
        // check if moves extend three stones in the same line, to make a 5 in-a-row
        const [cell1, cell2] = moves;

        // temporarily add stones so that a InARowBase method can return all
        // winning patterns that these new two stones could be part
        this.board.set(cell1, this.currplayer); // temporary add cell1 and cell2
        this.board.set(cell2, this.currplayer);
        const winningLinesMap = this.getWinningLinesMap();
        this.board.delete(cell1);               // remove them
        this.board.delete(cell2);

        if (winningLinesMap.get(this.currplayer)!.length > 0) {
            const winningLines : string[][] = [...winningLinesMap.get(this.currplayer)!];
            for (const winningLine of winningLines) {
                if (winningLine.includes(cell1) && winningLine.includes(cell2)) {
                    // if both stones are part of a winning line,
                    // it's an illegal use of the dagger
                    return true;
                }
            }
        }

        return false;
    }

    private shuffle(xs: string[]): void {
        // Fisher-Yates Shuffle
        for (let i = xs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [xs[i], xs[j]] = [xs[j], xs[i]];
        }
    }

    public moves(): string[] {
        const moves: string[] = [];

        // players can always place one stone
        for (let row = 0; row < this.boardSize; row++) {
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                if (this.board.has(cell)) { continue; }
                moves.push(this.normaliseMove(cell));
            }
        }

        if (this.hasActiveDagger()) { // player can also place two stones
            // select a fraction of available moves (too costly to find them all)
            // this will only used by randomMove() since the no-moves flag is on
            const emptyCells: string[] = [];
            for (let row = 0; row < this.boardSize; row++) {
                for (let col = 0; col < this.boardSize; col++) {
                    const cell = this.coords2algebraic(col, row);
                    if (! this.board.has(cell)) {
                        emptyCells.push(cell);
                    }
                }
            }
            let nDaggerMoves = Math.floor(this.boardSize * this.boardSize / 2);
            while (nDaggerMoves-- > 0) {
                this.shuffle(emptyCells);
                const cell1 = emptyCells[0];
                const cell2 = emptyCells[1];
                if (this.isIllegalExtension([cell1, cell2])) { continue; }
                moves.push(this.normaliseMove(cell1 + "," + cell2));
            }
        }

        /* complete moves: too slow
        if (this.hasActiveDagger()) { // player can also place two stones
            for (let row = 0; row < this.boardSize; row++) {
                for (let col = 0; col < this.boardSize; col++) {
                    const cell = this.coords2algebraic(col, row);
                    if (this.board.has(cell)) { continue; }
                    for (let row1 = row; row1 < this.boardSize; row1++) {
                        for (let col1 = row1 === row ? col + 1 : 0; col1 < this.boardSize; col1++) {
                            const cell1 = this.coords2algebraic(col1, row1);
                            if (this.board.has(cell1)) { continue; }
                            if (this.isIllegalExtension([cell, cell1])) { continue; }
                            moves.push(this.normaliseMove(cell + "," + cell1));
                        }
                    }
                }
            }
        }
        */

        return moves.sort((a,b) => a.localeCompare(b));
    }

    public randomMove(): string {
        const moves: string[] = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    private sort(a: string, b: string): number {
        // Sort two cells; necessary because "a10" should come after "a9".
        const [ax, ay] = this.algebraic2coords(a);
        const [bx, by] = this.algebraic2coords(b);
        if (ax < bx) { return -1; }
        if (ax > bx) { return  1; }
        if (ay < by) { return  1; }
        if (ay > by) { return -1; }
        return 0;
    }

    private normaliseMove(move: string): string {
        move = move.toLowerCase();
        move = move.replace(/\s+/g, "");
        // sort the move list so that there is a unique representation.
        return move.split(",").sort((a, b) => this.sort(a, b)).join(",");
    }

    public sameMove(move1: string, move2: string): boolean {
        return this.normaliseMove(move1) === this.normaliseMove(move2);
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = "";
            const cell = this.renderCoords2algebraic(col, row);
            if (move === "") {
                newmove = cell;
            } else {
                newmove = this.normaliseMove(move + "," + cell);
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
        const result: IValidationResult =
                {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (m.length === 0) {
            let message = i18next.t("apgames:validation.stiletto.INITIAL_INSTRUCTIONS");
            if (this.stack.length > 1) {
                if (this.hasActiveDagger()) {
                    message = i18next.t("apgames:validation.stiletto.INSTRUCTIONS_DAGGER");
                } else if (this.hasDagger()) {
                    message = i18next.t("apgames:validation.stiletto.INSTRUCTIONS_INACTIVE_DAGGER");
                } else {
                    message = i18next.t("apgames:validation.stiletto.INSTRUCTIONS");
                }
            }
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = message;
            return result;
        }

        const moves = m.split(",");

        // are all valid cells?
        let currentMove;
        try {
            for (const cell of moves) {
                currentMove = cell;
                const [x, y] = this.algebraic2coords(cell);
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

        // is move normalised? (sanity check, in case user types the move)
        const normalised = this.normaliseMove(m);
        if (! this.sameMove(m, normalised)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.product.NORMALISED", {move: normalised});
            return result;
        }

        // are all placements on empty cells?
        let notEmpty;
        for (const cell of moves) {
            if (this.board.has(cell)) { notEmpty = cell; break; }
        }
        if (notEmpty) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", { where: notEmpty });
            return result;
        }

        // at ply 1 only one placement is legal
        if (this.currentTurn() === 1 && moves.length > 1) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.stiletto.EXCESS_FIRST");
            return result;
        }

        if (moves.length == 2) {
            if (moves[0] == moves[1]) { // placements must be on different cells
                result.valid = false;
                result.message = i18next.t("apgames:validation._inarow.DUPLICATE",
                                           { where: moves[0] });
                return result;
            }
            if (! this.hasActiveDagger()) { // two placements are only valid with an active dagger
                result.valid = false;
                result.message = i18next.t("apgames:validation.stiletto.EXCESS");
                return result;
            }

            if (this.isIllegalExtension(moves)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.stiletto.EXTENSION");
                return result;
            }
        }

        // no more than two placements is possible
        if (moves.length > 2) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.stiletto.EXCESS");
            return result;
        }

        // one placement on an empty cell is always valid
        if (moves.length == 1) {
            // but the player can still decide to use his dagger (if active)
            // otherwise, the move is complete
            result.complete = this.hasActiveDagger() ? 0 : 1;
        } else { // two legal placements were made
            result.complete = 1;
        }

        result.valid = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        result.canrender = true;
        return result;
    }

    public move(m: string, {partial = false, trusted = false} = {}): StilettoGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
        }

        if (m.length === 0) { return this; }

        const moves = m.split(",");

        this.results = [];
        for (const cell of moves) {
            this.results.push({ type: "place", where: cell });
            this.board.set(cell, this.currplayer);
        }

        if (partial) { return this; }

        if (moves.length === 2) {
            // update state regarding current player's last use of dagger
            this.lastDaggerUse[this.currplayer - 1] = this.currentTurn();
        }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): StilettoGame {
        const winner: playerid[] = [];
        const winningLinesMap = this.getWinningLinesMap();
        this.winningLines = [];

        for (const player of [1, 2] as playerid[]) {
            if (winningLinesMap.get(player)!.length > 0) {
                winner.push(player);
                this.winningLines.push(...winningLinesMap.get(player)!);
            }
        }

        if (winner.length === 0) {
            if (! this.hasEmptySpace()) { // board is full and there's no 5 in-a-row
                this.gameover = true;
                this.winner = [1, 2]; // it is a draw
            }
        } else { // there's at least one 5 in-a-row --> game ends with a winner
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
        const renderBoardSize = this.boardSize;
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

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "vertex",
                width: renderBoardSize,
                height: renderBoardSize,
            },
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
                    const coordsAll = this.renderAlgebraic2coords(move.where!);
                    for (const [x, y] of coordsAll) {
                        rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
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

        return rep;
    }

    public state(): IStilettoState {
        return {
            game: StilettoGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: StilettoGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            winningLines: this.winningLines.map(a => [...a]),
            swapped: this.swapped,
            lastDaggerUse: [...this.lastDaggerUse],
        };
    }

    public status(): string {
        let status = super.status();
        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }
        return status;
    }

    public clone(): StilettoGame {
        return new StilettoGame(this.serialize());
    }
}
