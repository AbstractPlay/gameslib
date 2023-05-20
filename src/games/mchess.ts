import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { RectGrid } from "../common";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { Directions } from "../common";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";

interface ILooseObj {
    [key: string]: any;
}

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, number>;
    lastmove?: string;
    scores: number[];
};

export interface IMchessState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

const isMine = (row: number | string, player: playerid): boolean => {
    let y: number;
    if (typeof row === "string") {
        [,y] = MchessGame.algebraic2coords(row);
    } else {
        y = row;
    }
    if ( (y < 4) && (player === 2) ) {
        return true;
    } else if ( (y >= 4) && (player === 1) ) {
        return true;
    }
    return false;
}

export class MchessGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Martian Chess",
        uid: "mchess",
        playercounts: [2],
        version: "20211012",
        // i18next.t("apgames:descriptions.mchess")
        description: "apgames:descriptions.mchess",
        urls: ["https://www.looneylabs.com/rules/martian-chess", "http://www.wunderland.com/icehouse/MartianChess.html"],
        people: [
            {
                type: "designer",
                name: "Andrew Looney",
                urls: ["http://www.wunderland.com/WTS/Andy/Andy.html"]
            }
        ],
        variants: [
            {
                uid: "ofkk",
                group: "movement"
            }
        ],
        flags: ["scores", "multistep","perspective"],
    };

    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 8);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 8);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, number>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public scores!: number[];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private _points: [number, number][] = []; // if there are points here, the renderer will show them

    constructor(state?: IMchessState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            const fresh: IMoveState = {
                _version: MchessGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map([
                    ["a8", 3], ["b8", 3], ["c8", 2],
                    ["a7", 3], ["b7", 2], ["c7", 1],
                    ["a6", 2], ["b6", 1], ["c6", 1],
                    ["d1", 3], ["c1", 3], ["b1", 2],
                    ["d2", 3], ["c2", 2], ["b2", 1],
                    ["d3", 2], ["c3", 1], ["b3", 1]
                ]),
                scores: [0, 0]
            };
            if ( (variants !== undefined) && (variants.length === 1) && (variants[0] === "ofkk") ) {
                this.variants = ["ofkk"];
            }
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IMchessState;
            }
            if (state.game !== MchessGame.gameinfo.uid) {
                throw new Error(`The Martian Chess engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): MchessGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.lastmove = state.lastmove;
        this.scores = [...state.scores];
        return this;
    }

    /**
     * Returns the number of pieces of a particular size owned by a particular player
     *
     * @private
     * @param {number} piece
     * @param {playerid} [owner=this.currplayer]
     * @returns {number}
     * @memberof MchessGame
     */
    private countPieces(piece: number, owner: playerid = this.currplayer): number {
        let myrows = ["1", "2", "3", "4"];
        if (owner === 2) {
            myrows = ["5", "6", "7", "8"];
        }
        let count = 0;
        this.board.forEach((v, k) => {
            if ( (v === piece) && (myrows.includes(k.slice(1))) ) {
                count++;
            }
        });
        return count;
    }

    /**
     * A helper method to try to minimize repetition. It determines the type of move based on various criteria.
     *
     * @private
     * @param {string} currCell
     * @param {string} nextCell
     * @param {number} currContents
     * @param {playerid} player
     * @returns {(string|undefined)}
     * @memberof MchessGame
     */
    private moveType(currCell: string, nextCell: string, currContents: number, player: playerid): string|undefined {
        let myrows = ["1", "2", "3", "4"];
        if (player === 2) {
            myrows = ["5", "6", "7", "8"];
        }

        // If empty, move to it
        if (! this.board.has(nextCell)) {
            return `${currCell}-${nextCell}`;
        // If occupied by an enemy piece, capture it
        } else if (! myrows.includes(nextCell.slice(1))) {
            return `${currCell}x${nextCell}`;
        // If occupied by a friendly piece, see if a promotion is possible
        } else {
            const nextContents = this.board.get(nextCell);
            if (nextContents === undefined) {
                throw new Error("Could not find cell contents.");
            }
            for (const size of [2, 3]) {
                if ( (currContents + nextContents === size) && (this.countPieces(size, player) === 0) ) {
                    return `${currCell}+${nextCell}`;
                }
            }
        }
        return undefined;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves: string[] = [];
        const grid = new RectGrid(4, 8);

        let myrows = ["1", "2", "3", "4"];
        if (player === 2) {
            myrows = ["5", "6", "7", "8"];
        }

        this.board.forEach((v, k) => {
            if (myrows.includes(k.slice(1))) {
                const curr = MchessGame.algebraic2coords(k);
                if (v === 1) {
                    // Default, move diagonally one space
                    if ( (this.variants === undefined) || (! this.variants.includes("ofkk")) ) {
                        for (const dir of ["NE", "NW", "SE", "SW"]) {
                            const next = RectGrid.move(...curr, dir as Directions);
                            const nextCell = MchessGame.coords2algebraic(...next);
                            if (grid.inBounds(...next)) {
                                const move = this.moveType(k, nextCell, v, player!);
                                if (move !== undefined) {
                                    moves.push(move);
                                }
                            }
                        }
                    // Otherwise like a Chess king
                    } else if (this.variants.includes("ofkk")) {
                        grid.adjacencies(...curr).forEach((adj) => {
                            const nextCell = MchessGame.coords2algebraic(...adj);
                            const move = this.moveType(k, nextCell, v, player!);
                            if (move !== undefined) {
                                moves.push(move);
                            }
                        });
                    } else {
                        throw new Error("Unrecognized game mode.");
                    }
                } else if (v === 2) {
                    // Default, move in straight lines like a Chess rook, 1 or 2 spaces only
                    if ( (this.variants === undefined) || (! this.variants.includes("ofkk")) ) {
                        for (const dir of ["N", "E", "S", "W"]) {
                            const ray = grid.ray(...curr, dir as Directions).slice(0, 2);
                            for (const next of ray) {
                                const nextCell = MchessGame.coords2algebraic(...next);
                                const move = this.moveType(k, nextCell, v, player!);
                                if (move !== undefined) {
                                    moves.push(move);
                                }
                                // We can't jump over pieces, so regardless of whether a valid move was found,
                                // if there's a piece here, we have to stop moving in this direction.
                                if (this.board.has(nextCell)) {
                                    break;
                                }
                            }
                        }
                    // Otherwise like a Chess knight
                    } else if (this.variants.includes("ofkk")) {
                        grid.knights(...curr).forEach((adj) => {
                            const nextCell = MchessGame.coords2algebraic(...adj);
                            const move = this.moveType(k, nextCell, v, player!);
                            if (move !== undefined) {
                                moves.push(move);
                            }
                        });
                    } else {
                        throw new Error("Unrecognized game mode.");
                    }
                } else if (v === 3) {
                    for (const dir of ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]) {
                        const ray = grid.ray(...curr, dir as Directions);
                        for (const next of ray) {
                            const nextCell = MchessGame.coords2algebraic(...next);
                            const move = this.moveType(k, nextCell, v, player!);
                            if (move !== undefined) {
                                moves.push(move);
                            }
                            // We can't jump over pieces, so regardless of whether a valid move was found,
                            // if there's a piece here, we have to stop moving in this direction.
                            if (this.board.has(nextCell)) {
                                break;
                            }
                        }
                    }
                } else {
                    throw new Error("Unrecognized piece.")
                }
            }
        });

        // Eliminate the mirror move
        if ( (this.lastmove !== undefined) && this.lastmove.includes("-") ) {
            const cells = this.lastmove.split("-");
            if ( (cells === undefined) || (cells.length !== 2) ) {
                throw new Error("Malformed move encountered.");
            }
            const mirror = `${cells[1]}-${cells[0]}`;
            const idx = moves.indexOf(mirror);
            if (idx >= 0) {
                moves.splice(idx, 1);
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
            const cell = MchessGame.coords2algebraic(col, row);
            let newmove = "";
            if (move.length === 0) {
                if ( (! this.board.has(cell)) || (! isMine(row, this.currplayer)) ) {
                    return {move: "", message: ""} as IClickResult;
                } else {
                    newmove = cell;
                }
            } else {
                const [from,] = move.split(/[-x\+]/);
                if (from === cell) {
                    return {move: "", message: ""} as IClickResult;
                }
                if (! this.board.has(cell)) {
                    newmove = `${from}-${cell}`;
                } else if (isMine(cell, this.currplayer)) {
                    newmove = `${from}+${cell}`;
                } else {
                    newmove = `${from}x${cell}`;
                }
            }
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
            result.message = i18next.t("apgames:validation.mchess.INITIAL_INSTRUCTIONS");
            return result;
        }

        const [from, to] = m.split(/[-x\+]/);

        if (from !== undefined) {
            // valid cell
            try {
                MchessGame.algebraic2coords(from);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: from});
                return result;
            }
            // occupied
            if (! this.board.has(from)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: from});
                return result;
            }
            // yours
            if (! isMine(from, this.currplayer)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                return result;
            }

            if (to === undefined) {
                // are there valid targets for this piece
                const pts = this.findPoints(from).map(pt => MchessGame.coords2algebraic(...pt));
                if (pts.length === 0) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.NO_MOVES", {where: from});
                    return result;
                }

                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.mchess.PARTIAL");
                return result;
            } else {
                // valid cell
                try {
                    MchessGame.algebraic2coords(to);
                } catch {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: to});
                    return result;
                }
                // make sure target is valid
                const pts = this.findPoints(from).map(pt => MchessGame.coords2algebraic(...pt));
                if (! pts.includes(to)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.mchess.INVALID_MOVE", {move: m});
                    return result;
                }
                // if empty, we're good
                if (! this.board.has(to)) {
                    // make sure correct operator was used
                    if ( (m.includes("x")) || (m.includes("+")) ) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.CAPTURE4MOVE", {where: to});
                        return result;
                    }

                    // valid move
                    result.valid = true;
                    result.complete = 1;
                    result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                    return result;
                } else {
                    // correct operator
                    if (m.includes("-")) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.MOVE4CAPTURE", {where: to});
                        return result;
                    }

                    // if it's an enemy piece, we're good
                    if (! isMine(to, this.currplayer)) {
                        result.valid = true;
                        result.complete = 1;
                        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                        return result;
                    } else {
                        // valid promotion
                        const calcMove = this.moveType(from, to, this.board.get(from)!, this.currplayer);
                        if ( (calcMove === undefined) || (! calcMove.includes("+")) ) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.mchess.INVALID_PROMOTION", {where: to});
                            return result;
                        }

                        // we're good
                        result.valid = true;
                        result.complete = 1;
                        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                        return result;
                    }
                }
            }
        }

        return result;
    }

    private findPoints(cell: string): [number, number][] {
        const points: [number, number][] = [];
        if (this.board.has(cell)) {
            const grid = new RectGrid(4, 8);
            const [x, y] = MchessGame.algebraic2coords(cell);
            const piece = this.board.get(cell)!;
            if (this.variants.includes("ofkk")) {
                switch (piece) {
                    case 1:
                        // chess king
                        for (const next of grid.adjacencies(x, y, true)) {
                            const move = this.moveType(cell, MchessGame.coords2algebraic(...next), piece, this.currplayer);
                            if (move !== undefined) {
                                points.push(next)
                            }
                        }
                        break;
                    case 2:
                        // chess knights
                        for (const next of grid.knights(x, y)) {
                            const move = this.moveType(cell, MchessGame.coords2algebraic(...next), piece, this.currplayer);
                            if (move !== undefined) {
                                points.push(next)
                            }
                        }
                        break;
                    case 3:
                        // chess queen
                        for (const dir of ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const) {
                            for (const next of grid.ray(x, y, dir)) {
                                const nextCell = MchessGame.coords2algebraic(...next);
                                if (! this.board.has(nextCell)) {
                                    points.push(next);
                                } else {
                                    const move = this.moveType(cell, nextCell, piece, this.currplayer);
                                    if (move !== undefined) {
                                        points.push(next)
                                    }
                                    break;
                                }
                            }
                        }
                        break;
                }
            } else {
                switch (piece) {
                    case 1:
                        // just diagonal adjacencies
                        for (const next of grid.adjacencies(x, y, true).filter(pt => (pt[0] !== x) && (pt[1] !== y))) {
                            const move = this.moveType(cell, MchessGame.coords2algebraic(...next), piece, this.currplayer);
                            if (move !== undefined) {
                                points.push(next)
                            }
                        }
                        break;
                    case 2:
                        // orthogonally 2 or 3 spaces
                        for (const dir of ["N", "E", "S", "W"] as const) {
                            const ray = grid.ray(x, y, dir).slice(0, 2);
                            for (const next of ray) {
                                const nextCell = MchessGame.coords2algebraic(...next);
                                if (! this.board.has(nextCell)) {
                                    points.push(next);
                                } else {
                                    const move = this.moveType(cell, nextCell, piece, this.currplayer);
                                    if (move !== undefined) {
                                        points.push(next)
                                    }
                                    break;
                                }
                            }
                        }
                        break;
                    case 3:
                        // chess queen
                        for (const dir of ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const) {
                            for (const next of grid.ray(x, y, dir)) {
                                const nextCell = MchessGame.coords2algebraic(...next);
                                if (! this.board.has(nextCell)) {
                                    points.push(next);
                                } else {
                                    const move = this.moveType(cell, nextCell, piece, this.currplayer);
                                    if (move !== undefined) {
                                        points.push(next)
                                    }
                                    break;
                                }
                            }
                        }
                        break;
                }
            }
        }
        return points;
    }

    public move(m: string, partial = false): MchessGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const result = this.validateMove(m);
        if (! result.valid) {
            throw new UserFacingError("VALIDATION_GENERAL", result.message)
        }
        if ( (! partial) && (! this.moves().includes(m)) ) {
            throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
        } else if ( (partial) && (this.moves().filter(x => x.startsWith(m)).length < 1) ) {
            throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
        }

        // if partial, just set the points and get out
        if ( (partial) && (! m.includes("-")) && (! m.includes("x")) && (! m.includes("+")) ) {
            const pts = this.findPoints(m);
            if (pts !== undefined) {
                this._points = pts;
            } else {
                this._points = [];
            }
            return this;
        // otherwise delete the points and process the full move
        } else {
            this._points = [];
        }

        const rMove = /^([a-d]\d+)([\-\+x])([a-d]\d+)$/;
        const match = m.match(rMove);
        if (match === null) {
            throw new Error("Malformed move encountered.");
        }
        const fromCell = match[1];
        const operator = match[2];
        const toCell = match[3];
        const fromContents = this.board.get(fromCell);
        if (fromContents === undefined) {
            throw new Error("Malformed cell contents.");
        }
        const toContents = this.board.get(toCell);

        switch (operator) {
            case "x":
                if (toContents === undefined) {
                    throw new Error("Malformed cell contents.");
                }
                this.scores[this.currplayer - 1] += toContents;
                this.results = [
                    {type: "move", what: fromContents.toString(), from: fromCell, to: toCell},
                    {type: "capture", what: toContents.toString()},
                    {type: "deltaScore", delta: toContents}
                ];
                this.board.set(toCell, fromContents);
                this.board.delete(fromCell);
                break;
            case "-":
                this.board.set(toCell, fromContents);
                this.board.delete(fromCell);
                this.results = [{type: "move", what: fromContents.toString(), from: fromCell, to: toCell}];
                break;
            case "+":
                if (toContents === undefined) {
                    throw new Error("Malformed cell contents.");
                }
                if (fromContents + toContents > 3) {
                    throw new Error("Invalid field promotion.");
                }
                this.board.set(toCell, fromContents + toContents);
                this.board.delete(fromCell);
                this.results = [
                    {type: "move", what: fromContents.toString(), from: fromCell, to: toCell},
                    {type: "promote", to: (fromContents + toContents).toString()}
                ];
                break;
            default:
                throw new Error("Invalid move operator.");
        }

        // update currplayer
        this.lastmove = m;
        let newplayer = (this.currplayer as number) + 1;
        if (newplayer > this.numplayers) {
            newplayer = 1;
        }
        this.currplayer = newplayer as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): MchessGame {
        const rowsTop = ["5", "6", "7", "8"];
        let countTop = 0;
        let countBottom = 0;
        for (const cell of this.board.keys()) {
            if (rowsTop.includes(cell.slice(1))) {
                countTop++;
            } else {
                countBottom++;
            }
        }
        if ( (countBottom === 0) || (countTop === 0)) {
            this.gameover = true;
            if (this.scores[0] > this.scores[1]) {
                this.winner = [1];
            } else if (this.scores[1] > this.scores[0]) {
                this.winner = [2];
            } else {
                // In a tie, the player to last move wins
                if (this.currplayer === 1) {
                    this.winner = [2];
                } else {
                    this.winner = [1];
                }
            }
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }

        return this;
    }

    public state(): IMchessState {
        return {
            game: MchessGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: MchessGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            scores: [...this.scores]
        };
    }

    public render(): APRenderRep {
        const rowsTop = ["5", "6", "7", "8"];
        // Build piece string
        let pstr = "";
        for (let row = 0; row < 8; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < 4; col++) {
                const cell = MchessGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell);
                    if (contents === undefined) {
                        throw new Error("Malformed cell contents.");
                    }
                    let owner = "1";
                    if (rowsTop.includes(cell.slice(1))) {
                        owner = "2";
                    }
                    pieces.push("P" + owner + contents.toString());
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join(",");
        }
        pstr = pstr.replace(/\-,\-,\-,\-/g, "_");

        // build legend based on number of players
        const myLegend: ILooseObj = {};
        for (let n = 1; n <= this.numplayers; n++) {
            myLegend["P" + n.toString() + "1"] = {
                name: "pyramid-up-small-upscaled",
                player: n
            };
            myLegend["P" + n.toString() + "2"] = {
                name: "pyramid-up-medium-upscaled",
                player: n
            };
            myLegend["P" + n.toString() + "3"] = {
                name: "pyramid-up-large-upscaled",
                player: n
            };
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-checkered",
                width: 4,
                height: 8,
                tileHeight: 4
            },
            legend: myLegend,
            pieces: pstr
        };

        // Add annotations
        if ( (this.lastmove !== undefined) && (this.lastmove !== "resign") ) {
            const rMove = /^([a-d]\d+)([\-\+x])([a-d]\d+)$/;
            const match = this.lastmove.match(rMove);
            if (match === null) {
                throw new Error("Malformed move encountered.");
            }
            const fromCell = match[1];
            const fromxy = MchessGame.algebraic2coords(fromCell);
            const operator = match[2];
            const toCell = match[3];
            const toxy = MchessGame.algebraic2coords(toCell);

            switch (operator) {
                case "x":
                    rep.annotations = [
                        {
                            type: "exit",
                            targets: [
                                {col: toxy[0], row: toxy[1]}
                            ]
                        },
                        {
                            type: "move",
                            targets: [
                                {col: fromxy[0], row: fromxy[1]},
                                {col: toxy[0], row: toxy[1]}
                            ]
                        }                    ];
                    break;
                case "-":
                    rep.annotations = [
                        {
                            type: "move",
                            targets: [
                                {col: fromxy[0], row: fromxy[1]},
                                {col: toxy[0], row: toxy[1]}
                            ]
                        }
                    ];
                    break;
                case "+":
                    rep.annotations = [
                        {
                            type: "enter",
                            targets: [
                                {col: toxy[0], row: toxy[1]}
                            ]
                        },
                        {
                            type: "move",
                            targets: [
                                {col: fromxy[0], row: fromxy[1]},
                                {col: toxy[0], row: toxy[1]}
                            ]
                        }
                    ];
                    break;
                default:
                    throw new Error("Invalid move operator.");
            }
        }

        if (this._points.length > 0) {
            const points = [];
            for (const cell of this._points) {
                points.push({row: cell[1], col: cell[0]});
            }
            if (rep.hasOwnProperty("annotations")) {
                // @ts-ignore
                rep.annotations.push({type: "dots", targets: points});
            } else {
                // @ts-ignore
                rep.annotations = [{type: "dots", targets: points}];
            }
        }

        return rep;
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Scores**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const score = this.scores[n - 1];
            status += `Player ${n}: ${score}\n\n`;
        }

        return status;
    }

    public getPlayersScores(): IScores[] {
        return [{ name: i18next.t("apgames:status.SCORES"), scores: this.scores }]
    }

    protected getMoveList(): any[] {
        return this.getMovesAndResults(["move", "capture"]);
    }

    public getPlayerScore(player: number): number | undefined {
        return this.scores[player - 1];
    }

    public clone(): MchessGame {
        return new MchessGame(this.serialize());
    }
}
