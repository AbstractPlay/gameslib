import { GameBase, IAPGameState, IIndividualState } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { RectGrid } from "../common";
import { APRenderRep } from "@abstractplay/renderer/src/schema";
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
                name: "Of Knights and Kings",
                group: "movement",
                // i18next.t("apgames:variants.mchess.ofkk")
                description: "Pawns move like Chess kings, and drones move like Chess knights."
            }
        ],
        flags: ["scores"],
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
    public lastmove?: string;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public scores!: number[];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IMchessState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            const fresh: IMoveState = {
                _version: MchessGame.gameinfo.version,
                _results: [],
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
                    // Default, move in straight lines like a Chess rook
                    if ( (this.variants === undefined) || (! this.variants.includes("ofkk")) ) {
                        for (const dir of ["N", "E", "S", "W"]) {
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
        if ( (this.lastmove !== undefined) && ( (this.lastmove.includes("-")) || (this.lastmove.includes("x")) ) ) {
            const cells = this.lastmove.split(/[\-x]/);
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

    public click(row: number, col: number, piece: string): string {
        if (piece === '')
            return String.fromCharCode(97 + col) + (8 - row).toString();
        else
            return 'x' + String.fromCharCode(97 + col) + (8 - row).toString();
    }

    public clicked(move: string, coord: string): string {
        if (move.length > 0 && move.length < 3) {
            if (coord.length === 2)
                return move + '-' + coord;
            else
                return move + coord;
        }
        else {
            if (coord.length === 2)
                return coord;
            else
                return coord.substring(1, 3);
        }
    }

    public move(m: string): MchessGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        if (! this.moves().includes(m)) {
            throw new UserFacingError("MOVES_INVALID", i18next.t("apgames:MOVES_INVALID", {move: m}));
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

    public resign(player: playerid): MchessGame {
        this.gameover = true;
        if (player === 1) {
            this.winner = [2];
        } else {
            this.winner = [1];
        }
        this.results.push(
            {type: "resigned", player},
            {type: "eog"},
            {type: "winners", players: [...this.winner]}
        );
        this.saveState();
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
        if (this.lastmove !== undefined) {
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

    protected getVariants(): string[] | undefined {
        if ( (this.variants === undefined) || (this.variants.length === 0) ) {
            return undefined;
        }
        const vars: string[] = [];
        for (const v of this.variants) {
            for (const rec of MchessGame.gameinfo.variants!) {
                if (v === rec.uid) {
                    vars.push(rec.name);
                    break;
                }
            }
        }
        return vars;
    }

    protected getMoveList(): any[] {
        return this.getMovesAndResults(["move", "capture"]);
    }

    public getPlayerScore(player: number): number | undefined {
        return this.scores[player - 1];
    }

    public chatLog(players: string[]): string[][] {
        // eog, resign, winners, move, capture, promote, deltaScore
        const result: string[][] = [];
        for (const state of this.stack) {
            if ( (state._results !== undefined) && (state._results.length > 0) ) {
                const node: string[] = [];
                let otherPlayer = state.currplayer + 1;
                if (otherPlayer > this.numplayers) {
                    otherPlayer = 1;
                }
                let name = `Player ${otherPlayer}`;
                if (otherPlayer <= players.length) {
                    name = players[otherPlayer - 1];
                }
                for (const r of state._results) {
                    switch (r.type) {
                        case "move":
                            node.push(i18next.t("apresults:MOVE.complete", {player: name, what: r.what, from: r.from, to: r.to}));
                            break;
                        case "promote":
                            node.push(i18next.t("apresults:PROMOTE.mchess", {into: r.to}));
                            break;
                        case "capture":
                            node.push(i18next.t("apresults:CAPTURE.noperson.nowhere", {what: r.what}));
                            break;
                        case "eog":
                            node.push(i18next.t("apresults:EOG"));
                            break;
                            case "resigned":
                                let rname = `Player ${r.player}`;
                                if (r.player <= players.length) {
                                    rname = players[r.player - 1]
                                }
                                node.push(i18next.t("apresults:RESIGN", {player: rname}));
                                break;
                            case "winners":
                                const names: string[] = [];
                                for (const w of r.players) {
                                    if (w <= players.length) {
                                        names.push(players[w - 1]);
                                    } else {
                                        names.push(`Player ${w}`);
                                    }
                                }
                                node.push(i18next.t("apresults:WINNERS", {count: r.players.length, winners: names.join(", ")}));
                                break;
                        }
                }
                if (state._results.find(r => r.type === "deltaScore") !== undefined) {
                    node.push(i18next.t("apresults:SCORE_REPORT", {player: name, score: state.scores[otherPlayer - 1]}));
                }
                result.push(node);
            }
        }
        return result;
    }


    public clone(): MchessGame {
        return new MchessGame(this.serialize());
    }
}
