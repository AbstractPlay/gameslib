import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, Colourfuncs } from "@abstractplay/renderer/build/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { allDirections, SquareGraph, reviver, UserFacingError } from "../common";
import i18next from "i18next";

export type playerid = 1 | 2 | 3; // 3 is the ball

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface ISoccolotState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class SoccolotGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Soccolot",
        uid: "soccolot",
        playercounts: [2],
        version: "20260509",
        dateAdded: "2026-05-27",
        // i18next.t("apgames:descriptions.soccolot")
        description: "apgames:descriptions.soccolot",
        // i18next.t("apgames:notes.soccolot")
        notes: "apgames:notes.soccolot",
        urls: [
            "https://www.zillions-of-games.com/cgi-bin/zilligames/submissions.cgi?do=show;id=802",        ],
        people: [
            {
                type: "designer",
                name: "David Wilson",
            },
            {
                type: "coder",
                name: "João Pedro Neto",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3829/joao-pedro-neto"],
                apid: "9228bccd-a1bd-452b-b94f-d05380e6638f",
            },
        ],
        categories: ["goal>breakthrough", "mechanic>move", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        variants: [
            { uid: "#board", }, // Speed Soccolot
            { uid: "original", group: "ruleset" },
            { uid: "swap",     group: "ruleset" }, // adds swap dribble
        ],
        flags: []
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private ruleset: "default" | "original" | "swap";
    private _points: [number, number][] = []; // if there are points here, the renderer will show them

    constructor(state?: ISoccolotState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if ( (variants !== undefined) && (variants.length > 0) ) {
                this.variants = [...variants];
            }
            this.ruleset = this.getRuleset();
            let board: Map<string, playerid>;
            if ( this.ruleset === "original" ) {
                board = new Map<string, playerid>([ // initial setup
                    ["b1", 1], ["c1", 1], ["d1", 1], ["e1", 1], ["f1", 1], ["g1", 1],
                    ["b8", 2], ["c8", 2], ["d8", 2], ["e8", 2], ["f8", 2], ["g8", 2],
                    ["e5", 3],
                ]);
            } else {
                board = new Map<string, playerid>([ // initial setup
                    ["b2", 1], ["c2", 1], ["d2", 1], ["e2", 1], ["f2", 1],
                    ["b6", 2], ["c6", 2], ["d6", 2], ["e6", 2], ["f6", 2],
                    ["d4", 3],
                ]);
            }
            const fresh: IMoveState = {
                _version: SoccolotGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ISoccolotState;
            }
            if (state.game !== SoccolotGame.gameinfo.uid) {
                throw new Error(`The Soccolot engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
        this.ruleset = this.getRuleset();
    }

    public load(idx = -1): SoccolotGame {
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
        this.results = [...state._results];
        return this;
    }

    private getRuleset(): "default" | "original" | "swap" {
        if (this.variants.includes("original")) { return "original"; }
        if (this.variants.includes("swap")) { return "swap"; }
        return "default";
    }

    public get boardsize(): number {
        return this.ruleset === "original" ? 8 : 7;
    }

    private get graph(): SquareGraph {
        return new SquareGraph(this.boardsize, this.boardsize);
    }

    // return the coordinates where the ball is
    private getBall(): string {
        return [...this.board.entries()].filter(e => e[1] === 3).map(e => e[0])[0];
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) { player = this.currplayer; }
        const grid = this.graph;
        const moves = [];

        // there are three types of moves,
        //  a) run: moves a Man to any empty adjacent square (eg, man-newman)
        //  b) dribble: Ball and adjacent Man both move is the same direction to empty cell (eg, man,ball-newman)
        //  c) kick: move the Ball in the direction away from the adjacent Man (eg, ball,man>newball)

        // run
        for (const cell of this.graph.graph.nodes()) {
            if ( !this.board.has(cell) || this.board.get(cell)! !== player ) { continue; }
            for (const adj of grid.neighbours(cell)) {
                if (! this.board.has(adj) ) {
                    moves.push(`${cell}-${adj}`);
                }
            }
        }

        // dribble
        const ball = this.getBall();
        const g = this.graph;
        const [xb, yb] = g.algebraic2coords(ball);
        for (const man of grid.neighbours(ball)) {
            // find adjacent friendly Men
            if ( this.board.has(man) && this.board.get(man)! === player ) {
                const [xm, ym] = g.algebraic2coords(man);
                for (const dir of allDirections) {
                    const rayBall = g.ray(xb, yb, dir);
                    const rayMan  = g.ray(xm, ym, dir);
                    // if both next cells, in the current direction, exist and are empty, add dribble move
                    if ( rayBall.length > 0 && rayMan.length > 0 ) {
                        const cellNewBall = g.coords2algebraic(...rayBall[0]);
                        const cellNewMan  = g.coords2algebraic(...rayMan[0]);
                        // It is also possible for the ball (or man) to move into the man's (or ball's)
                        // current position (if the other moves to an empty cell).
                        if ( (!this.board.has(cellNewBall) || cellNewBall === man ) &&
                             (!this.board.has(cellNewMan)  || cellNewMan === ball ) ) {
                            moves.push(`${man},${ball}-${cellNewMan}`);
                        }
                    }
                }
            }
        }

        // kick
        for (const man of grid.neighbours(ball)) {
            // find adjacent friendly Men
            if ( this.board.has(man) && this.board.get(man)! === player ) {
                const [xm, ym] = g.algebraic2coords(man);
                for (const dir of allDirections) {
                    const ray = this.graph.ray(xm, ym,  dir);
                    if ( ray.length > 0 ) {
                        // the only direction is the one towards the ball
                        let nextCell = g.coords2algebraic(...ray[0]);
                        if (nextCell !== ball) { continue; }
                        for (let i=1; i<ray.length; i++) {
                            nextCell = g.coords2algebraic(...ray[i]);
                            // we can kick the ball while there are empty cells in that direction
                            if ( this.board.has(nextCell) ) { break; }
                            moves.push(`${ball},${man}>${nextCell}`);
                        }
                        break;
                    }
                }
            }
        }

        if ( this.ruleset === "swap" ) {
            for (const man of grid.neighbours(ball)) {
                // find adjacent friendly Men
                if ( this.board.has(man) && this.board.get(man)! === player ) {
                    moves.push(`${man},${ball}@`); // swap pieces
                }
            }
        }

        return moves.sort((a,b) => a.localeCompare(b));
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.graph.coords2algebraic(col, row);
            const moves: string[] = move.split(/[,>-]/);
            let newmove = "";

            if ( move === "" ) {
                newmove = cell;
            } else if ( move === cell ) { // reclick resets the move
                newmove = "";
            } else if (moves.length === 1) {
                if ( this.board.has(cell) ) {
                    newmove = `${move},${cell}`; // kick or dribble (partial)
                } else {
                    newmove = `${move}-${cell}`; // run (final)
                }
            } else if (moves.length === 2) {
                if ( moves[0] === this.getBall() ) { // it is a kick (final)
                    newmove = `${move}>${cell}`;
                } else { // it is a dribble (final)
                    if ( this.ruleset === "swap" && cell === moves[0]) {
                        newmove = `${move}@`;        // swap the ball with the man
                    } else {
                        newmove = `${move}-${cell}`; // move the ball with the man
                    }
                }
            } else {
                newmove = ""; // something went wrong, reset move
            }

            const result = this.validateMove(newmove) as IClickResult;
            result.move = result.valid ? newmove : move;
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", {move, row, col, piece, emessage: (e as Error).message})
            }
        }
    }

    private hasPrefix(moves: string[], partial: string): boolean {
        return moves.some(str => str.startsWith(partial));
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.soccolot.INITIAL_INSTRUCTIONS");
            return result;
        }

        const prevplayer = this.currplayer % 2 + 1 as playerid;
        const moves: string[] = m.split(/[,>@-]/);

        if ( moves.length === 1 ) {
            if ( !this.board.has(m) || this.board.get(m)! === prevplayer ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.soccolot.ERROR_SELECT");
                return result
            }
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            if (this.board.get(m)! === this.currplayer) {
                result.message = i18next.t("apgames:validation.soccolot.MAN_INSTRUCTIONS");
            } else {
                result.message = i18next.t("apgames:validation.soccolot.BALL_INSTRUCTIONS");
            }
            return result;
        }

        const allMoves = this.moves();

        if ( moves.length === 2 ) {
            if (! this.hasPrefix(allMoves, m) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.soccolot.ERROR_KICK_DRIBBLE");
                return result
            }

            if ( m.includes('-') ) { // a run is a complete valid move
                result.valid = true;
                result.complete = 1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }

            // otherwise it is either a dribble or a kick
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            if (this.board.get(moves[0])! === this.currplayer) {
                if ( this.ruleset === "swap" ) {
                    result.message = i18next.t("apgames:validation.soccolot.DRIBBLE_SWAP_INSTRUCTIONS");
                } else {
                    result.message = i18next.t("apgames:validation.soccolot.DRIBBLE_INSTRUCTIONS");
                }
            } else {
                result.message = i18next.t("apgames:validation.soccolot.KICK_INSTRUCTIONS");
            }
            return result;
        }

        if (! allMoves.includes(m) ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
            return result
        }

        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    // return the list of cells the current move can go to
    private findPoints(move: string): string[] {
        const moves = move.split(/[,>@-]/);
        const allMoves = this.moves();
        const ball = this.getBall();
        const res = [];

        if ( !move.includes('-') && !move.includes(',') && this.board.get(move) === this.currplayer ) {
            // show available runs
            res.push(...allMoves.filter(m => !m.includes(','))
                                .map(m => m.split('-'))
                                .filter(([from,]) => from === move)
                                .map(([, to]) => to));
            if (this.hasPrefix(allMoves, `${move},${ball}`)) {
                res.push(ball);
            }
        } else if ( !move.includes('-') && !move.includes(',') && move === ball ) {
            // show available men to kick (select moves starting as ball,man>newball)
            res.push(...allMoves.filter(m => m.startsWith(ball))
                                .map(m => m.split(/[,>]/)[1]));
        } else if ( moves[0] === ball || moves[1] === ball ) {
            // show available places to dribble (select moves like man,ball-newman)
            //                       or to kick (select moves like ball,man>newball)
            res.push(...allMoves.filter(m => m.startsWith(move))
                                .filter(m => !m.includes('@'))
                                .map(m => m.split(/[,>-]/)[2]));
            if ( this.ruleset === "swap" && moves[1] === ball ) { // include swap option
                res.push(moves[0]); // swap by clicking in the man again
            }
        }

        return res;
    }

    public move(m: string, {partial = false, trusted = false} = {}): SoccolotGame {
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
        }

        this.results = [];
        const moves = m.split(/[,>@-]/);

        if ( partial ) { // if partial, set the points to be shown
            const g = this.graph;
            this._points = this.findPoints(m).map(c => g.algebraic2coords(c));
            return this;
        } else {
            this._points = []; // otherwise delete the points and process the full move
        }

        if ( moves.length === 2 && m.includes('-') ) { // a run
            this.board.delete(moves[0]);
            this.board.set(moves[1], this.currplayer);
            this.results.push({ type: "move", from: moves[0], to: moves[1] });
        } else if ( m.includes('-') ) { // a dribble (man,ball-newball)
            const g = this.graph;
            const [xm0, ym0] = g.algebraic2coords(moves[0]); // man old coord
            const [xm1, ym1] = g.algebraic2coords(moves[2]); // man new coord
            const dx = xm1 - xm0; // compute direction of dribble
            const dy = ym1 - ym0;
            const [xb, yb] = g.algebraic2coords(moves[1]);        // ball old coord
            const newBall = g.coords2algebraic(xb + dx, yb + dy); // ball new cell
            //move the man and the ball
            this.board.delete(moves[0]); // remove old man
            this.board.delete(moves[1]); // remove old ball
            this.board.set(moves[2], this.currplayer);
            this.results.push({ type: "move", from: moves[0], to: moves[2] });
            this.board.set(newBall, 3);
            this.results.push({ type: "move", from: moves[1], to: newBall });
        } else if ( m.includes('@') ) { // only for swap variant
            this.board.set(moves[0], 3); // swap ball with man
            this.results.push({ type: "move", from: moves[0], to: moves[1] });
            this.board.set(moves[1], this.currplayer);
            this.results.push({ type: "move", from: moves[1], to: moves[0] });
        } else { // a kick (ball,man>newball)
            this.board.delete(moves[0]);
            this.board.set(moves[2], 3); // moving the ball
            this.results.push({ type: "move", from: moves[0], to: moves[2] });
        }

        if (partial) { return this; }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): SoccolotGame {
        const ball = this.getBall();

        if (Number(ball.slice(1)) === this.boardsize) {
            this.gameover = true;
            this.winner = [1];
        }

        if (ball.slice(1) === '1') {
            this.gameover = true;
            this.winner = [2];
        }

        if ( this.gameover ) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }

        return this;
    }

    public state(): ISoccolotState {
        return {
            game: SoccolotGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: SoccolotGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    public render(): APRenderRep {
        const g = this.graph;
        // Build piece string
        let pstr = "";
        for (const row of g.listCells(true) as string[][]) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell);
                    if (contents === 1) {
                        pieces.push("A");
                    } else if (contents === 2) {
                        pieces.push("B");
                    } else {
                        pieces.push("C");
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join("");
        }

        const ballColour: Colourfuncs = {
            func: "custom",
            default: "#FFDF00", // gold yellow
            palette: 3
        };

        const size = this.boardsize;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const markers: Array<any> = [
            {
                type: "shading",
                colour: 1,
                points: [{row:size, col:0}, {row:size, col:size}, {row:size-1, col:size}, {row:size-1, col:0} ]
            },
            {
                type: "shading",
                colour: 2,
                points: [{row:0, col:0}, {row:0, col:size}, {row:1, col:size}, {row:1, col:0} ]
            }
        ];

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-checkered",
                width: this.boardsize,
                height: this.boardsize,
                markers
            },
            legend: {
                A: { name: "piece", colour: 1 },
                B: { name: "piece", colour: 2 },
                C: { name: "piece", colour: ballColour },
            },
            pieces: pstr
        };

        rep.annotations = [];
        for (const move of this.results) {
            if (move.type === "move") {
                const [fromX, fromY] = g.algebraic2coords(move.from);
                const [toX, toY] = g.algebraic2coords(move.to);
                rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
            }
        }

        // show the dots where the selected piece can move to
        if (this._points.length > 0) {
            const points = [];
            for (const [x,y] of this._points) {
                points.push({row: y, col: x});
            }
            rep.annotations.push({type: "dots",
                                  targets: points as [{row: number; col: number;}, ...{row: number; col: number;}[]]});
        }

        return rep;
    }

    public clone(): SoccolotGame {
        return new SoccolotGame(this.serialize());
    }
}
