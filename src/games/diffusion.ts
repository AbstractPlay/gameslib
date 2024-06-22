/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable jsdoc/check-indentation */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-var-requires
const deepclone = require("rfdc/default");

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    lastmove?: string;
    board: number[][];
    deltas: number[][];
};

export interface IDiffusionState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class DiffusionGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Diffusion",
        uid: "diffusion",
        playercounts: [2],
        version: "20231228",
        dateAdded: "2023-12-29",
        // i18next.t("apgames:descriptions.diffusion")
        description: "apgames:descriptions.diffusion",
        urls: ["https://marksteeregames.com/Diffusion_rules.pdf"],
        people: [
            {
                type: "designer",
                name: "Mark Steere",
                urls: ["http://www.marksteeregames.com/"]
            },
        ],
        categories: ["goal>evacuate", "mechanic>bearoff", "mechanic>move>sow", "mechanic>coopt", "board>mancala", "components>simple>1c"],
        flags: ["pie", "automove", "perspective"],
        variants: [
            {uid: "topBottom"}
        ],
        displays: [{uid: "pips"}]
    };


    public static clone(obj: DiffusionGame): DiffusionGame {
        const cloned: DiffusionGame = Object.assign(new DiffusionGame(), deepclone(obj) as DiffusionGame);
        return cloned;
    }

    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 2);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 2);
    }


    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: number[][];
    public deltas: number[][] = [[0,0,0,0,0,0,],[0,0,0,0,0,0],[0,0],];
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IDiffusionState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined && variants.length > 0) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: DiffusionGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: [
                    [4,4,4,4,4,4],
                    [4,4,4,4,4,4],
                    [0,0],
                ],
                deltas: [[0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0],[0,0],],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IDiffusionState;
            }
            if (state.game !== DiffusionGame.gameinfo.uid) {
                throw new Error(`The Diffusion engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): DiffusionGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = [...state.board.map(r => [...r])];
        this.lastmove = state.lastmove;
        if ( (state.deltas !== undefined) && (state.deltas !== null) ) {
            this.deltas = [...state.deltas.map(l => [...l])];
        }
        return this;
    }

    protected getOwned(player: playerid): string[] {
        if (this.variants !== undefined && this.variants.includes("topBottom")) {
            return [["a1","b1","c1","d1","e1","f1"],["a2","b2","c2","d2","e2","f2"]][player - 1];
        } else {
            return [["a1","a2","b1","b2","c1","c2"],["d1","d2","e1","e2","f1","f2"]][player - 1];
        }
    }

    protected getShaded(player: playerid): [{row: number; col: number}, {row: number; col: number}, {row: number; col: number}, ...{row: number; col: number}[]] {
        if (this.variants !== undefined && this.variants.includes("topBottom")) {
            return [[
                {"row": 1, "col": 0},
                {"row": 1, "col": 6},
                {"row": 2, "col": 6},
                {"row": 2, "col": 0}
            ],[
                {"row": 0, "col": 0},
                {"row": 0, "col": 6},
                {"row": 1, "col": 6},
                {"row": 1, "col": 0}
            ]][player - 1] as [{row: number; col: number}, {row: number; col: number}, {row: number; col: number}, ...{row: number; col: number}[]];
        } else {
            return [[
                {"row": 0, "col": 0},
                {"row": 0, "col": 3},
                {"row": 2, "col": 3},
                {"row": 2, "col": 0}
            ],[
                {"row": 0, "col": 3},
                {"row": 0, "col": 6},
                {"row": 2, "col": 6},
                {"row": 2, "col": 3}
            ]][player - 1] as [{row: number; col: number}, {row: number; col: number}, {row: number; col: number}, ...{row: number; col: number}[]];
        }
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];
        for (let row = 0; row < 2; row++) {
            for (let col = 0; col < 6; col++) {
                const cell = DiffusionGame.coords2algebraic(col, row);
                if (this.board[row][col] > 0) {
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
            const cell = DiffusionGame.coords2algebraic(col, row);
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
            result.message = i18next.t("apgames:validation.diffusion.INITIAL_INSTRUCTIONS");
            return result;
        }

        // valid cell
        try {
            DiffusionGame.algebraic2coords(m)
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: m});
            return result;
        }

        // contains stones
        const [x,y] = DiffusionGame.algebraic2coords(m);
        if (this.board[y][x] <= 0) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: m});
            return result;
        }

        // we're good
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {trusted = false} = {}): DiffusionGame {
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

        // annotate initial move
        const from = m;
        this.results.push({type: "sow", pits: [from]});

        // store board in advance for comparison
        const before = this.cloneBoard();

        // make the move
        const [fx, fy] = DiffusionGame.algebraic2coords(from);
        const endpit = Math.round(fx / 6) === 0 ? 1 : 0;
        const allSurrounding = [
            [[-1,0],[-1,1],[0,1],[1,1],[1,0]],
            [[1,0],[1,-1],[0,-1],[-1,-1],[-1,0]],
        ];
        const surrounding = allSurrounding[fy];
        const inhand = this.board[fy][fx];
        this.board[fy][fx] = 0;
        for (let i = 0; i < inhand; i++) {
            const [dx,dy] = surrounding[i];
            const nx = fx + dx;
            const ny = fy + dy;
            // if off the board, drop a stone in the end pit
            if (nx < 0 || nx >= 6) {
                this.board[2][endpit]++;
            }
            // if new pit already has 5 stones, drop in the end pit
            else if (this.board[ny][nx] === 5) {
                this.board[2][endpit]++;
            }
            // otherwise, drop it in the next pit
            else {
                this.board[ny][nx]++;
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
        this.deltas.push([this.board[2][0] - before[2][0], this.board[2][1] - before[2][1]]);

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

    protected checkEOG(): DiffusionGame {
        // does someone's area have no stones
        for (const p of [1,2] as playerid[]) {
            const home = this.getOwned(p).map(c => DiffusionGame.algebraic2coords(c));
            if (home.reduce((prev, [x,y]) => prev + this.board[y][x], 0) === 0) {
                this.gameover = true;
                this.winner = [p];
                break;
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

    public state(): IDiffusionState {
        return {
            game: DiffusionGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: DiffusionGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: this.cloneBoard(),
            deltas: [...this.deltas.map(l => [...l])],
        };
    }

    public render(opts?:IRenderOpts): APRenderRep {
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
        pstr += "\n" + [...this.board[2]].reverse().join(",");

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
                        "type": "shading",
                        "belowGrid": true,
                        "opacity": 0.15,
                        "colour": 1,
                        "points": this.getShaded(1)
                    },
                    {
                        "type": "shading",
                        "belowGrid": true,
                        "opacity": 0.15,
                        "colour": 2,
                        "points": this.getShaded(2)
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
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "sow") {
                    const [fromX, fromY] = DiffusionGame.algebraic2coords(move.pits[0]);
                    rep.annotations.push({type: "exit", targets: [{row: fromY, col: fromX}]});
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

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "sow":
                node.push(i18next.t("apresults:SOW.general", {player, pits: r.pits.join(", "), count: r.pits.length}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): DiffusionGame {
        return new DiffusionGame(this.serialize());
    }

    protected cloneBoard(): number[][] {
        return [...this.board.map(l => [...l])];
    }
}
