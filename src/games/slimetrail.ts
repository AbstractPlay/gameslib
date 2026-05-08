import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, Colourfuncs } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { SquareGraph, reviver, UserFacingError } from "../common";
import { HexSlantedGraph } from "../common/graphs";
import i18next from "i18next";

export type playerid = 1 | 2; // regarding pieces: 1 is the ball, 2 are the walls

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface ISlimetrailState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class SlimetrailGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Slimetrail",
        uid: "slimetrail",
        playercounts: [2],
        version: "20260508",
        dateAdded: "2026-05-08",
        // i18next.t("apgames:descriptions.slimetrail")
        description: "apgames:descriptions.slimetrail",
        // i18next.t("apgames:notes.slimetrail")
        notes: "apgames:notes.slimetrail",
        urls: [
            "https://boardgamegeek.com/boardgame/31467/slimetrail",
            "https://jpneto.github.io/world_abstract_games/slimetrail.htm",
        ],
        people: [
            {
                name: "Bill Taylor",
                urls: ["https://boardgamegeek.com/boardgamedesigner/9249/bill-taylor"],
            },
            {
                type: "coder",
                name: "João Pedro Neto",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3829/joao-pedro-neto"],
                apid: "9228bccd-a1bd-452b-b94f-d05380e6638f",
            },
        ],
        variants: [
            { uid: "#board" },
            { uid: "rhombus11", group: "board" },
        ],
        categories: ["goal>breakthrough", "mechanic>move", "mechanic>block",
                     "board>shape>rect", "board>shape>hex", "components>simple>1per"],
        flags: ["automove", "experimental"]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: ISlimetrailState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if ( (variants !== undefined) && (variants.length > 0) ) {
                this.variants = [...variants];
            }
            const ball = this.variants.includes("rhombus11") ? "g5" : "e5";
            const board: Map<string, playerid> = new Map<string, playerid>([ [ball, 1] ]);

            const fresh: IMoveState = {
                _version: SlimetrailGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ISlimetrailState;
            }
            if (state.game !== SlimetrailGame.gameinfo.uid) {
                throw new Error(`The Slimetrail engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): SlimetrailGame {
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

    public get boardsize(): number {
        if (this.variants.includes("rhombus11")) {
            return 11;
        }
        return 8;
    }

    public get graph(): SquareGraph | HexSlantedGraph {
        if (this.variants.includes("rhombus11")) {
            return new HexSlantedGraph(this.boardsize, this.boardsize);
        } else {
            return new SquareGraph(this.boardsize, this.boardsize);
        }
    }

    // return the coordinates where the ball is
    private getBall(): string {
        return [...this.board.entries()].filter(e => e[1] === 1).map(e => e[0])[0];
    }

    private neighborsBall(): string[] {
        /*const neigh: string[] = [];
        const grid = this.graph;

        for (const adj of grid.neighbours(this.getBall())) {
            if ( !this.board.has(adj) ) {
                neigh.push(adj);
            }
        }
        return neigh;*/
        return [...this.graph.neighbours(this.getBall())].filter(c => !this.board.has(c));
    }

    // get the goal cell for the given player
    private getGoal(player: playerid): string {
        if (this.variants.includes("rhombus11")) {
            return player === 1 ? "a11" : "k1";
        } else {
            return player === 1 ? "a1" : "h8";
        }
    }

    public moves(): string[] {
        if (this.gameover) { return []; }
        return this.neighborsBall();
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const newmove = this.graph.coords2algebraic(col, row);
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

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.slimetrail.INITIAL_INSTRUCTIONS");
            return result;
        }

        const allMoves = this.moves();
        if (! allMoves.includes(m) ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.slimetrail.INVALID_MOVE");
            return result
        }

        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {partial = false, trusted = false} = {}): SlimetrailGame {
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
            if ( (! partial) && (! this.moves().includes(m)) ) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];
        const ball = this.getBall();
        this.board.set(ball, 2); // where the ball was becomes a wall...
        this.board.set(m, 1);    // and the ball moves to the new cell
        this.results.push({ type: "move", from: ball, to: m });

        if (partial) { return this; }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): SlimetrailGame {
        const prevPlayer: playerid = this.currplayer % 2 + 1 as playerid;
        const ball = this.getBall();

        if ( ball === this.getGoal(1) ) {
            this.gameover = true;
            this.winner = [1];
        } else if ( ball === this.getGoal(2) ) {
            this.gameover = true;
            this.winner = [2];
        } else if ( this.neighborsBall().length === 0 ) {
            this.gameover = true;
            this.winner = [prevPlayer];
        }

        if ( this.gameover ) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }

        return this;
    }

    public state(): ISlimetrailState {
        return {
            game: SlimetrailGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: SlimetrailGame.gameinfo.version,
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
                    } else {
                        pieces.push("B");
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

        const wallColour: Colourfuncs = {
            func: "custom",
            default: "#999",
            palette: 4
        };

        const isHex = this.variants.includes("rhombus11");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let markers : Array<any> = [];
        if ( isHex ) {
            markers = [
              {
                type: "flood",
                colour: this.getPlayerColour(1),
                points: [{row:10, col:0} ]
              },
              {
                type: "flood",
                colour: this.getPlayerColour(2),
                points: [{row:0, col:10} ]
              },
            ];
        } else {
            markers = [
              {
                type: "shading",
                colour: this.getPlayerColour(1),
                points: [{row:8, col:0}, {row:8, col:1}, {row:7, col:1}, {row:7, col:0} ]
              },
              {
                type: "shading",
                colour: this.getPlayerColour(2),
                points: [{row:1, col:7}, {row:1, col:8}, {row:0, col:8}, {row:0, col:7} ]
              },
            ];
        }

        // Build rep
        const rep: APRenderRep =  {
            board: isHex ? { style: "hex-slanted",       width: this.boardsize, height: this.boardsize, markers } :
                           { style: "squares-checkered", width: this.boardsize, height: this.boardsize, markers },
            legend: {
                A: { name: "piece", colour: ballColour },
                B: { name: "piece", colour: wallColour },
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

        return rep;
    }

    public getPlayerColour(p: playerid): Colourfuncs {
        if (p === 1) {
            return { func: "custom", default: 1, palette: 1 };
        } else {
            return { func: "custom", default: 2, palette: 2 };
        }
    }

    public clone(): SlimetrailGame {
        return new SlimetrailGame(this.serialize());
    }
}
