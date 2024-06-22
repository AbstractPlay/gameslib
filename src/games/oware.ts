/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable jsdoc/check-indentation */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { SowingNoEndsGraph, reviver, UserFacingError } from "../common";
import type { IRenderOpts, IScores } from "./_base";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-var-requires
const deepclone = require("rfdc/default");

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    lastmove?: string;
    board: number[][];
    scores: [number,number];
    deltas: number[][];
};

export interface IOwareState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class OwareGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Oware",
        uid: "oware",
        playercounts: [2],
        version: "20240513",
        dateAdded: "2024-05-13",
        // i18next.t("apgames:descriptions.oware")
        description: "apgames:descriptions.oware",
        // i18next.t("apgames:notes.oware")
        notes: "apgames:notes.oware",
        urls: ["https://en.wikipedia.org/wiki/Oware"],
        categories: ["goal>score>race", "mechanic>capture",  "mechanic>move>sow", "mechanic>traditional", "board>mancala", "components>simple>1c"],
        flags: ["perspective", "scores", "automove"],
        displays: [{uid: "pips"}]
    };

    public static clone(obj: OwareGame): OwareGame {
        const cloned: OwareGame = Object.assign(new OwareGame(), deepclone(obj) as OwareGame);
        return cloned;
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: number[][];
    public deltas: number[][] = [[0,0,0,0,0,0],[0,0,0,0,0,0],[0,0],];
    public scores: [number,number] = [0,0];
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IOwareState | string) {
        super();
        if (state === undefined) {
            const fresh: IMoveState = {
                _version: OwareGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: [
                    [4, 4, 4, 4, 4, 4],
                    [4, 4, 4, 4, 4, 4],
                ],
                scores: [0,0],
                tuz: [undefined, undefined],
                deltas: [[0,0,0,0,0,0],[0,0,0,0,0,0],[0,0],],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IOwareState;
            }
            if (state.game !== OwareGame.gameinfo.uid) {
                throw new Error(`The Oware engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): OwareGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = [...state.board.map(r => [...r])];
        this.scores = [...state.scores];
        this.lastmove = state.lastmove;
        if ( (state.deltas !== undefined) && (state.deltas !== null) ) {
            this.deltas = [...state.deltas.map(l => [...l])];
        }
        return this;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        let otherRow = 0
        let myRow = 1;
        if (player === 2) {
            otherRow = 1;
            myRow = 0;
        }

        const moves: string[] = [];
        const g = new SowingNoEndsGraph(6);
        for (let col = 0; col < 6; col++) {
            if (this.board[myRow][col] > 0) {
                const cell = g.coords2algebraic(col, myRow);
                moves.push(cell);
            }
        }

        // If opponent started with no pieces, then
        // the only legal moves are those that give them pieces.
        const start = this.board[otherRow].reduce((prev, curr) => prev + curr, 0);
        if (start === 0) {
            const legal: string[] = [];
            for (const move of moves) {
                const cloned = OwareGame.clone(this);
                cloned.move(move, {trusted: true});
                const end = cloned.board[otherRow].reduce((prev, curr) => prev + curr, 0);
                if (end > 0) {
                    legal.push(move);
                }
            }
            return legal.sort((a, b) => a.localeCompare(b));
        }

        return moves.sort((a,b) => a.localeCompare(b));
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    // Couldn't be simpler!
    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const g = new SowingNoEndsGraph(6);
            const cell = g.coords2algebraic(col, row);
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
            result.message = i18next.t("apgames:validation.oware.INITIAL_INSTRUCTIONS");
            return result;
        }

        const g = new SowingNoEndsGraph(6);
        // valid cell
        if (! g.graph.hasNode(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: m});
            return result;
        }
        // yours
        let myrow = 1;
        if (this.currplayer === 2) {
            myrow = 0;
        }
        const [x,y] = g.algebraic2coords(m);
        if (y !== myrow) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
            return result;
        }
        // has pieces
        if (this.board[y][x] === 0) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: m});
            return result;
        }

        // If after making the move your opponent has no pieces,
        // then the move is illegal. This should only happen if your
        // opponent had no pieces at the *start* of your turn.
        const cloned = OwareGame.clone(this);
        cloned.move(m, {trusted: true});
        let theirRow = 0;
        if (this.currplayer === 2) {
            theirRow = 1
        }
        const end = cloned.board[theirRow].reduce((prev, curr) => prev + curr, 0);
        if (end === 0) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.oware.NO_PIECES", {where: m});
            return result;
        }

        // we're good
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {trusted = false} = {}): OwareGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (! this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];
        const g = new SowingNoEndsGraph(6);
        let theirRow = 0;
        let myRow = 1;
        if (this.currplayer === 2) {
            myRow = 0;
            theirRow = 1;
        }

        // annotate initial move
        const from = m;
        const [fx, fy] = g.algebraic2coords(from);
        const to = g.sow(from, "CCW", 1)[0];
        this.results.push({type: "move", from, to});

        // store board in advance for comparison
        const before = this.cloneBoard();
        const scoresBefore = [...this.scores];

        // make the move
        const inhand = this.board[fy][fx];
        const sown = g.sow(from, "CCW", inhand + (Math.floor(inhand / 12)));
        this.results.push({type: "sow", pits: [from]});
        // delete `from` and then add one stone in each pit of `sown`,
        // skipping any recurrences of `from` (12+ stones)
        this.board[fy][fx] = 0;
        for (const pit of sown) {
            if (pit === from) {
                continue;
            }
            const [tx, ty] = g.algebraic2coords(pit);
            this.board[ty][tx]++;
        }

        const sownCoords = sown.map(c => g.algebraic2coords(c));
        const caps: [number,number][] = [];
        let last = sownCoords.pop();
        while (last !== undefined &&
               last[1] !== myRow &&
               this.board[last[1]][last[0]] >= 2 &&
               this.board[last[1]][last[0]] <= 3
              ) {
            caps.push(last);
            last = sownCoords.pop();
        }
        // check for grand slam
        const cloned = this.cloneBoard();
        for (const cap of caps) {
            cloned[cap[1]][cap[0]] = 0;
        }
        const slammed = cloned[theirRow].reduce((prev, curr) => prev + curr, 0) === 0;
        // if not a slam, capture all the pieces
        if (! slammed) {
            for (const [lx, ly] of caps) {
                const cell = g.coords2algebraic(lx, ly);
                this.results.push({type: "capture", where: cell, count: this.board[ly][lx]});
                this.scores[this.currplayer - 1] += this.board[ly][lx];
                this.board[ly][lx] = 0;
            }
        }

        // now calculate deltas
        this.deltas = [];
        for (let y = 0; y < 2; y++) {
            const row: number[] = [];
            for (let x = 0; x < 6; x++) {
                row.push(this.board[y][x] - before[y][x]);
            }
            this.deltas.push([...row]);
        }
        this.deltas.push([this.scores[0] - scoresBefore[0], this.scores[1] - scoresBefore[1]]);

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

    protected checkEOG(): OwareGame {
        // has someone reached >= 82 pieces
        for (const player of [1,2] as playerid[]) {
            if (this.scores[player - 1] >= 25) {
                this.gameover = true;
                this.winner = [player];
                break;
            }
        }

        // does the current player have no moves left
        if ( (! this.gameover) && (this.moves().length === 0) ) {
            this.gameover = true;
            const p1score = this.scores[0] + this.board[1].reduce((prev, curr) => prev + curr, 0);
            const p2score = this.scores[1] + this.board[0].reduce((prev, curr) => prev + curr, 0);
            if (p1score > p2score) {
                this.winner = [1];
            } else if (p2score > p1score) {
                this.winner = [2];
            } else { // draw
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

    public state(): IOwareState {
        return {
            game: OwareGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: OwareGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: this.cloneBoard(),
            scores: [...this.scores],
            deltas: [...this.deltas.map(l => [...l])],
        };
    }

    public render(opts?: IRenderOpts): APRenderRep {
        let altDisplay: string|undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }

        // Build piece string
        let pstr = "";
        for (let row = 0; row < 2; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: number[] = [];
            for (let col = 0; col < 6; col++) {
                pieces.push(this.board[row][col]);
            }
            pstr += pieces.join(",");
        }
        pstr += "\n" + [...this.scores].reverse().join(",");

        // Build rep
        const rep: APRenderRep =  {
            renderer: altDisplay === "pips" ? "sowing-pips" : "sowing-numerals",
            board: {
                style: "sowing",
                width: 6,
                height: 2,
                showEndPits: true,
                markers: [
                    {
                        type:"edge",
                        edge:"N",
                        colour:2
                    },
                    {
                        type:"edge",
                        edge:"S",
                        colour:1
                    },
                    {
                        type: "outline",
                        colour: 1,
                        points: [{row: 2, col: 1}],
                    },
                    {
                        type: "outline",
                        colour: 2,
                        points: [{row: 2, col: 0}],
                    },
                ],
            },
            pieces: pstr
        };

        // record deltas
        rep.annotations = [];
        const deltas: {row: number; col: number; delta: number}[] = [];
        for (let y = 0; y < 2; y++) {
            for (let x = 0; x < 6; x++) {
                if (this.deltas[y][x] !== 0) {
                    deltas.push({row: y, col: x, delta: this.deltas[y][x]});
                }
            }
        }
        deltas.push({row: 2, col: 0, delta: this.deltas[2][1]});
        deltas.push({row: 2, col: 1, delta: this.deltas[2][0]});
        rep.annotations.push({type: "deltas", deltas});

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            const g = new SowingNoEndsGraph(6);
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = g.algebraic2coords(move.from);
                    const [toX, toY] = g.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "capture") {
                    let wherestr = move.where!;
                    wherestr = wherestr.replace(/ /g, "");
                    const targets: {row: number; col: number;}[] = [];
                    for (const where of wherestr.split(",")) {
                        const [x, y] = g.algebraic2coords(where);
                        targets.push({row: y, col: x});
                    }
                    rep.annotations.push({type: "exit", targets: targets as [{row: number; col: number}, ...{row: number; col: number}[]]});
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
        status += "**Scores**: " + this.scores.join(", ") + "\n\n";

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "move":
                resolved = true;
                break;
            case "sow":
                node.push(i18next.t("apresults:SOW.general", {player, pits: r.pits.join(", "), count: r.pits.length}));
                resolved = true;
                break;
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.mancala", {player, pit: r.where, count: r.count}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public getPlayerScore(player: playerid): number {
        return this.scores[player - 1];
    }

    public getPlayersScores(): IScores[] {
        if (this.scores.reduce((prev, curr) => prev + curr, 0) > 0) {
            return [
                { name: i18next.t("apgames:status.SCORES"), scores: this.scores }
            ]
        } else {
            return [];
        }
    }

    public clone(): OwareGame {
        return new OwareGame(this.serialize());
    }

    protected cloneBoard(): number[][] {
        return [...this.board.map(l => [...l])];
    }
}
