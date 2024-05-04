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
    tuz: [string|undefined, string|undefined];
    kazna: [number,number];
    deltas: number[][];
};

export interface IToguzState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class ToguzGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Toguz Kumalak",
        uid: "toguz",
        playercounts: [2],
        version: "20231224",
        dateAdded: "2023-12-25",
        // i18next.t("apgames:descriptions.toguz")
        description: "apgames:descriptions.toguz",
        // i18next.t("apgames:notes.toguz")
        notes: "apgames:notes.toguz",
        urls: ["https://en.wikipedia.org/wiki/Toguz_korgol"],
        categories: ["goal>score>race", "mechanic>capture",  "mechanic>move>sow", "mechanic>traditional", "board>mancala", "components>simple>1c"],
        flags: ["perspective", "scores", "automove"],
        displays: [{uid: "pips"}]
    };


    public static clone(obj: ToguzGame): ToguzGame {
        const cloned: ToguzGame = Object.assign(new ToguzGame(), deepclone(obj) as ToguzGame);
        return cloned;
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: number[][];
    public tuz!: [string|undefined,string|undefined];
    public deltas: number[][] = [[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,0],];
    public kazna: [number,number] = [0,0];
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IToguzState | string) {
        super();
        if (state === undefined) {
            const fresh: IMoveState = {
                _version: ToguzGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: [
                    [9, 9, 9, 9, 9, 9, 9, 9, 9],
                    [9, 9, 9, 9, 9, 9, 9, 9, 9],
                ],
                kazna: [0,0],
                tuz: [undefined, undefined],
                deltas: [[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,0],],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IToguzState;
            }
            if (state.game !== ToguzGame.gameinfo.uid) {
                throw new Error(`The Toguz engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): ToguzGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = [...state.board.map(r => [...r])];
        this.kazna = [...state.kazna];
        this.tuz = [...state.tuz];
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
        let myrow = 1;
        if (player === 2) {
            myrow = 0;
        }

        const moves: string[] = [];
        const g = new SowingNoEndsGraph(9);
        for (let col = 0; col < 9; col++) {
            if (this.board[myrow][col] > 0) {
                const cell = g.coords2algebraic(col, myrow);
                if (! this.tuz.includes(cell)) {
                    moves.push(cell);
                }
            }
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
            const g = new SowingNoEndsGraph(9);
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
            result.message = i18next.t("apgames:validation.toguz.INITIAL_INSTRUCTIONS");
            return result;
        }

        const g = new SowingNoEndsGraph(9);
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
        // is not a tuz
        if (this.tuz.includes(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.toguz.NO_TUZ");
            return result;
        }

        // we're good
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {trusted = false} = {}): ToguzGame {
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
        const g = new SowingNoEndsGraph(9);
        let myrow = 1;
        if (this.currplayer === 2) {
            myrow = 0;
        }

        // annotate initial move
        const from = m;
        const [fx, fy] = g.algebraic2coords(from);
        const to = g.sow(from, "CCW", 1)[0];
        this.results.push({type: "move", from, to});

        // store board in advance for comparison
        const before = this.cloneBoard();
        const kaznaBefore = [...this.kazna];

        // make the move
        const inhand = this.board[fy][fx];
        let sown: string[];
        // if only one stone, it moves to next pit
        if (inhand === 1) {
            sown = g.sow(from, "CCW", 1);
        }
        // otherwise, we start in the initial pit
        else {
            sown = [from, ...g.sow(from, "CCW", inhand - 1)];
        }
        this.results.push({type: "sow", pits: [from]});
        // delete `from` and then add one stone in each pit of `sown`
        this.board[fy][fx] = 0;
        for (const pit of sown) {
            const [tx, ty] = g.algebraic2coords(pit);
            this.board[ty][tx]++;
        }

        const last = sown[sown.length - 1];
        const [lx, ly] = g.algebraic2coords(last);
        // check for capture
        if (ly !== myrow && this.board[ly][lx] > 0 && this.board[ly][lx] % 2 === 0) {
            this.results.push({type: "capture", where: last, count: this.board[ly][lx]});
            this.kazna[this.currplayer - 1] += this.board[ly][lx];
            this.board[ly][lx] = 0;
        }
        // check for tuz
        let otherPlayer = 2;
        if (this.currplayer === 2) {
            otherPlayer = 1;
        }
        let theirRight = 0;
        if (otherPlayer === 1) {
            theirRight = 8;
        }
        if (ly !== myrow && lx !== theirRight &&
            this.board[ly][lx] === 3 && (this.tuz[this.currplayer - 1] === undefined || this.tuz[this.currplayer - 1] === null) ) {
            // only thing left to check is that it's not symmetrical to a tuz on our side
            let theirTuzCol: number|undefined;
            if ( (this.tuz[otherPlayer - 1] !== undefined) && (this.tuz[otherPlayer - 1] !== null) ) {
                [theirTuzCol,] = g.algebraic2coords(this.tuz[otherPlayer - 1]!);
            }
            if (theirTuzCol === undefined || theirTuzCol !== 8 - lx) {
                this.results.push({type: "claim", where: last});
                this.tuz[this.currplayer - 1] = last;
            }
        }
        // move any pieces in a tuz to the appropriate kazna
        for (const player of [1,2] as playerid[]) {
            if ( (this.tuz[player - 1] !== undefined) && (this.tuz[player - 1] !== null) ) {
                const [tuzx, tuzy] = g.algebraic2coords(this.tuz[player - 1]!);
                this.kazna[player - 1] += this.board[tuzy][tuzx];
                this.board[tuzy][tuzx] = 0;
            }
        }

        // now calculate deltas
        this.deltas = [];
        for (let y = 0; y < 2; y++) {
            const row: number[] = [];
            for (let x = 0; x < 9; x++) {
                row.push(this.board[y][x] - before[y][x]);
            }
            this.deltas.push([...row]);
        }
        this.deltas.push([this.kazna[0] - kaznaBefore[0], this.kazna[1] - kaznaBefore[1]]);

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

    protected checkEOG(): ToguzGame {
        // has someone reached >= 82 pieces
        for (const player of [1,2] as playerid[]) {
            if (this.kazna[player - 1] >= 82) {
                this.gameover = true;
                this.winner = [player];
                break;
            }
        }
        // does the current player have no moves left
        if ( (! this.gameover) && (this.moves().length === 0) ) {
            this.gameover = true;
            const p1score = this.kazna[0] + this.board[1].reduce((prev, curr) => prev + curr, 0);
            const p2score = this.kazna[1] + this.board[0].reduce((prev, curr) => prev + curr, 0);
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

    public state(): IToguzState {
        return {
            game: ToguzGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: ToguzGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: this.cloneBoard(),
            tuz: [...this.tuz],
            kazna: [...this.kazna],
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
            for (let col = 0; col < 9; col++) {
                pieces.push(this.board[row][col]);
            }
            pstr += pieces.join(",");
        }
        pstr += "\n" + [...this.kazna].reverse().join(",");

        // Build rep
        const rep: APRenderRep =  {
            renderer: altDisplay === "pips" ? "sowing-pips" : "sowing-numerals",
            board: {
                style: "sowing",
                width: 9,
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
        // Mark houses
        const g = new SowingNoEndsGraph(9);
        const tuz: {row: number; col: number;}[] = [];
        for (const h of this.tuz) {
            if ( ( h !== undefined) && (h !== null) ) {
                const [col, row] = g.algebraic2coords(h);
                tuz.push({row, col});
            }
        }
        if (tuz.length > 0) {
            // @ts-ignore
            rep.board.squarePits = tuz
        }

        // record deltas
        // @ts-ignore
        rep.annotations = [];
        const deltas: {row: number; col: number; delta: number}[] = [];
        for (let y = 0; y < 2; y++) {
            for (let x = 0; x < 9; x++) {
                if (this.deltas[y][x] !== 0) {
                    deltas.push({row: y, col: x, delta: this.deltas[y][x]});
                }
            }
        }
        deltas.push({row: 2, col: 0, delta: this.deltas[2][1]});
        deltas.push({row: 2, col: 1, delta: this.deltas[2][0]});
        // @ts-ignore
        rep.annotations.push({type: "deltas", deltas});

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
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
                    // @ts-ignore
                    rep.annotations.push({type: "exit", targets});
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
        status += "**Scores**: " + this.kazna.join(", ") + "\n\n";

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
            case "claim":
                node.push(i18next.t("apresults:CLAIM_TOGUZ", {pit: r.where}));
                resolved = true;
                break;
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.mancala", {player, pit: r.where, count: r.count}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public getPlayersScores(): IScores[] {
        if (this.kazna.reduce((prev, curr) => prev + curr, 0) > 0) {
            return [
                { name: i18next.t("apgames:status.SCORES"), scores: this.kazna }
            ]
        } else {
            return [];
        }
    }

    public clone(): ToguzGame {
        return new ToguzGame(this.serialize());
    }

    protected cloneBoard(): number[][] {
        return [...this.board.map(l => [...l])];
    }
}
