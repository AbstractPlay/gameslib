/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import { GameBase, IAPGameState, IIndividualState } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, UserFacingError } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

interface ILooseObj {
    [key: string]: any;
}

export type playerid = 1|2;
export type Size = 1|2|3;
export type Facing = "N"|"NE"|"E"|"SE"|"S"|"SW"|"W"|"NW"|"U";
export type CellContents = [playerid, Size, Facing];

const orientations = ["N","NE","E","SE","S","SW","W","NW","U"];

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    lastmove?: string;
    scores: number[];
};

export interface IPikemenState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class PikemenGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Pikemen",
        uid: "pikemen",
        playercounts: [2],
        version: "20211114",
        // i18next.t("apgames:descriptions.pikemen")
        description: "apgames:descriptions.pikemen",
        urls: ["http://playagaingames.com/games/pikemen/"],
        people: [
            {
                type: "designer",
                name: "Jacob Davenport",
                urls: ["http://brightestbulb.net/"]
            }
        ],
        variants: [
            {
                uid: "15pts",
                name: "Longer Game: 15 points",
                group: "eog",
                // i18next.t("apgames:variants.pikemen.15pts")
                description: "apgames:variants.pikemen.15pts"
            }
        ],
        flags: ["scores"]
    };
    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 8);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 8);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, CellContents>;
    public lastmove?: string;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public scores!: number[];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IPikemenState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            const fresh: IMoveState = {
                _version: PikemenGame.gameinfo.version,
                _results: [],
                currplayer: 1,
                board: new Map([
                    ["a8", [2, 3, "U"]], ["b8", [2, 3, "U"]], ["c8", [2, 3, "U"]], ["d8", [2, 2, "U"]], ["e8", [2, 1, "U"]],
                    ["a7", [2, 3, "U"]], ["b7", [2, 2, "U"]], ["c7", [2, 2, "U"]], ["d7", [2, 1, "U"]],
                    ["a6", [2, 3, "U"]], ["b6", [2, 2, "U"]], ["c6", [2, 1, "U"]],
                    ["a5", [2, 2, "U"]], ["b5", [2, 1, "U"]],
                    ["a4", [2, 1, "U"]],
                    ["h1", [1, 3, "U"]], ["g1", [1, 3, "U"]], ["f1", [1, 3, "U"]], ["e1", [1, 2, "U"]], ["d1", [1, 1, "U"]],
                    ["h2", [1, 3, "U"]], ["g2", [1, 2, "U"]], ["f2", [1, 2, "U"]], ["e2", [1, 1, "U"]],
                    ["h3", [1, 3, "U"]], ["g3", [1, 2, "U"]], ["f3", [1, 1, "U"]],
                    ["h4", [1, 2, "U"]], ["g4", [1, 1, "U"]],
                    ["h5", [1, 1, "U"]],
                ]),
                scores: [0, 0]
            };
            if ( (variants !== undefined) && (variants.length === 1) && (variants[0] === "15pts") ) {
                this.variants = ["15pts"];
            }
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IPikemenState;
            }
            if (state.game !== PikemenGame.gameinfo.uid) {
                throw new Error(`The Pikemen engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): PikemenGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = deepclone(state.board) as Map<string, CellContents>;
        this.lastmove = state.lastmove;
        this.scores = [...state.scores];
        return this;
    }


    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const allmoves: string[] = [];
        const grid = new RectGrid(8, 8);
        const pieces = [...this.board.entries()].filter(e => e[1][0] === player);
        for (const [cell, piece] of pieces) {
            // You're always allowed to do nothing but reorient, so add just the current cell to the move list
            const moves: string[] = [cell];
            const [xStart, yStart] = PikemenGame.algebraic2coords(cell);
            // If you're not facing up, you're also allowed to move/capture
            if (piece[2] !== "U") {
                const ray = grid.ray(xStart, yStart, piece[2]);
                for (const [xNext, yNext] of ray) {
                    const next = PikemenGame.coords2algebraic(xNext, yNext);
                    if (! this.board.has(next)) {
                        moves.push(`${cell}-${next}`);
                    } else {
                        const contents = this.board.get(next);
                        if (contents![0] !== player) {
                            if ( (contents![2] !== "U") || (contents![1] < piece[1]) ) {
                                moves.push(`${cell}x${next}`);
                            }
                        }
                        break;
                    }
                }
            }
            // Now add all possible reorientations to each of the valid moves
            const reos = orientations.filter(o => o !== piece[2])
            for (const m of moves) {
                // movement/capture moves don't have to reorient if you don't want to
                if (m.length > 2) {
                    allmoves.push(m);
                }
                for (const reo of reos) {
                    allmoves.push(`${m}(${reo})`);
                }
            }
        }

        return allmoves;
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

    public move(m: string): PikemenGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        m = m.replace(/\([a-z]+\)$/, (match) => {return match.toUpperCase();});
        if (! this.moves().includes(m)) {
            throw new UserFacingError("MOVES_INVALID", i18next.t("apgames:MOVES_INVALID", {move: m}));
        }

        this.results = [];
        const [move, reo] = m.split("(");
        let target = move;
        // check for movement/capture first
        if (move.length > 2) {
            const [from, to] = move.split(/[-x]/);
            const fContents = this.board.get(from);
            this.results.push({type: "move", what: fContents![1].toString(), from, to});
            if (this.board.has(to)) {
                const tContents = this.board.get(to);
                this.scores[this.currplayer - 1] += tContents![1];
                this.results.push(
                    {type: "capture", what: tContents![1].toString(), where: to},
                    {type: "deltaScore", delta: tContents![1]}
                )
            }
            this.board.delete(from);
            this.board.set(to, [...fContents!])
            target = to;
        }
        // Now reorient
        if ( (reo !== undefined) && (reo !== "") ) {
            const dir = reo.slice(0, reo.length - 1);
            const contents = this.board.get(target);
            contents![2] = dir as Facing;
            this.results.push({type: "orient", where: target, facing: dir});
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

    protected checkEOG(): PikemenGame {
        let target = 12;
        if (this.variants.includes("15pts")) {
            target = 15;
        }
        if ( (this.scores[0] >= target) || (this.scores[1] >= target)) {
            this.gameover = true;
            if (this.scores[0] > this.scores[1]) {
                this.winner = [1];
            } else {
                this.winner = [2];
            }
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public resign(player: playerid): PikemenGame {
        this.gameover = true;
        if (player === 1) {
            this.winner = [2];
        } else {
            this.winner = [1];
        }
        this.results = [
            {type: "resigned", player},
            {type: "eog"},
            {type: "winners", players: [...this.winner]}
        ];
        this.saveState();
        return this;
    }

    public state(): IPikemenState {
        return {
            game: PikemenGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: PikemenGame.gameinfo.version,
            _results: [...this.results],
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: deepclone(this.board) as Map<string, CellContents>,
            scores: [...this.scores]
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < 8; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < 8; col++) {
                const cell = PikemenGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell);
                    if (contents === undefined) {
                        throw new Error("Malformed cell contents.");
                    }
                    let owner = "X";
                    if (contents[0] === 2) {
                        owner = "Y";
                    }
                    pieces.push(owner + contents[1].toString() + contents[2]);
                } else {
                    pieces.push("");
                }
            }
            pstr += pieces.join(",");
        }
        pstr = pstr.replace(/\n,{7}\n/g, "\n_\n");

        const myLegend: ILooseObj = {};
        const rotations: Map<string, number> = new Map([
            ["N", 0],
            ["NE", 45],
            ["E", 90],
            ["SE", 135],
            ["S", 180],
            ["SW", -135],
            ["W", -90],
            ["NW", -45],
        ]);
        const playerNames = ["X", "Y"];
        const sizeNames = ["small", "medium", "large"]
        for (const player of [1, 2]) {
            for (const size of [1, 2, 3]) {
                for (const dir of rotations.entries()) {
                    // eslint-disable-next-line no-shadow,@typescript-eslint/no-shadow
                    const node: ILooseObj = {
                        name: "pyramid-flat-" + sizeNames[size - 1],
                        player,
                        rotate: dir[1],
                    };
                    myLegend[playerNames[player - 1] + size.toString() + dir[0]] = node;
                }
                const node: ILooseObj = {
                    name: "pyramid-up-" + sizeNames[size - 1],
                    player,
                };
                myLegend[playerNames[player - 1] + size.toString() + "U"] = node;
            }
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-checkered",
                width: 8,
                height: 8,
            },
            legend: myLegend,
            pieces: pstr
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = PikemenGame.algebraic2coords(move.from);
                    const [toX, toY] = PikemenGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "capture") {
                    const [x, y] = PikemenGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                }
            }
            // Only if there were no moves or captures do I want to signal a reorientation
            if (rep.annotations.length === 0) {
                for (const move of this.stack[this.stack.length - 1]._results) {
                    if (move.type === "orient") {
                        const [x, y] = PikemenGame.algebraic2coords(move.where!);
                        rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                    }
                }
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
            for (const rec of PikemenGame.gameinfo.variants!) {
                if (v === rec.uid) {
                    vars.push(rec.name);
                    break;
                }
            }
        }
        return vars;
    }

    protected getMoveList(): any[] {
        return this.getMovesAndResults(["move", "capture", "orient"]);
    }

    public getPlayerScore(player: number): number {
        return this.scores[player - 1];
    }

    public chatLog(players: string[]): string[][] {
        // eog, resign, winners, move, capture, orient, deltaScore
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
                        case "orient":
                            node.push(i18next.t("apresults:ORIENT.nowhat", {player: name, facing: r.facing, where: r.where}));
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

    public clone(): PikemenGame {
        return new PikemenGame(this.serialize());
    }
}

