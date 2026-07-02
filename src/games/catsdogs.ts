import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, Colourfuncs } from "@abstractplay/renderer/build/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError, SquareOrthGraph } from "../common";
import i18next from "i18next";

export type playerid = 1 | 2; // regarding pieces: 1 is the ball, 2 are the walls

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface ICatsDogsState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class CatsDogsGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Cats and Dogs",
        uid: "catsdogs",
        playercounts: [2],
        version: "20260508",
        dateAdded: "2026-05-13",
        // i18next.t("apgames:descriptions.catsdogs")
        description: "apgames:descriptions.catsdogs",
        // i18next.t("apgames:notes.catsdogs")
        notes: "apgames:notes.catsdogs",
        urls: [
            "https://boardgamegeek.com/boardgame/151888/snort",        ],
        people: [
            {
                type: "designer",
                name: "Simon Norton",
                urls: ["https://boardgamegeek.com/boardgamedesigner/72293/simon-norton"],
            },
            {
                type: "designer",
                name: "Chris Huntoon",
                urls: ["https://boardgamegeek.com/boardgamedesigner/8259/chris-huntoon"],
            },
            {
                type: "coder",
                name: "João Pedro Neto",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3829/joao-pedro-neto"],
                apid: "9228bccd-a1bd-452b-b94f-d05380e6638f",
            },
        ],
        categories: ["goal>immobilize", "mechanic>move", "board>shape>rect", "components>simple>1per"],
        variants: [
            { uid: "#board", },  // Huntoon's variant
            { uid: "original",   group: "ruleset" },
            { uid: "tournament", group: "ruleset" }, // 8x8 Portuguese tournament rules
            { uid: "misere", group: "ruleset" }, // misÈre version of original 8x8
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
    private ruleset: "default" | "original" | "tournament" | "misere";

    constructor(state?: ICatsDogsState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if ( (variants !== undefined) && (variants.length > 0) ) {
                this.variants = [...variants];
            }
            const board = new Map<string, playerid>();
            const fresh: IMoveState = {
                _version: CatsDogsGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ICatsDogsState;
            }
            if (state.game !== CatsDogsGame.gameinfo.uid) {
                throw new Error(`The Cats and Dogs engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
        this.ruleset = this.getRuleset();
    }

    public load(idx = -1): CatsDogsGame {
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
        if (this.ruleset === "original" || this.ruleset === "tournament" || this.ruleset === "misere") {
            return 8;
        }
        return 11;
    }

    public get graph(): SquareOrthGraph {
        return new SquareOrthGraph(this.boardsize, this.boardsize);
    }

    private getRuleset(): "default" | "original" | "tournament" | "misere" {
        if (this.variants.includes("original"))   { return "original"; }
        if (this.variants.includes("tournament")) { return "tournament"; }
        if (this.variants.includes("misere"))     { return "misere"; }
        return "default";
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) { player = this.currplayer; }
        const grid = this.graph;
        const moves = [];

        if (this.ruleset === "tournament" && this.stack.length === 1) {
            // at ply 1, it's only possible to play at the 2x2 center area
            return ["d4", "d5", "e4", "e5"];
        }

        if (this.ruleset === "tournament" && this.stack.length === 2) {

            // at ply 2, it's only possible to play outside the 2x2 center area
            for (const cell of this.graph.graph.nodes()) {
                if ( this.board.has(cell) ) { continue; }
                if (["d4", "d5", "e4", "e5"].includes(cell))  { continue; }
                let ok = true;
                for (const adj of grid.neighbours(cell)) {
                    if ( this.board.has(adj) && this.board.get(adj)! !== player ) {
                        ok = false;
                    }
                }
                if (ok) { moves.push(cell); }
            }

        } else {

            for (const cell of this.graph.graph.nodes()) {
                if ( this.board.has(cell) ) { continue; }
                let ok = true;
                for (const adj of grid.neighbours(cell)) {
                    if ( this.board.has(adj) && this.board.get(adj)! !== player ) {
                        ok = false;
                    }
                }
                if (ok) { moves.push(cell); }
            }

            if (this.ruleset === "default" && this.stack.length === 1) {
                // remove the option of playing at the center at ply 1
                const idxCenter = moves.indexOf("f6"); // center of a 11x11 board
                moves.splice(idxCenter, 1);
            }
        }

        return moves.sort((a,b) => a.localeCompare(b));
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
            result.message = i18next.t("apgames:validation.catsdogs.INITIAL_INSTRUCTIONS");
            return result;
        }

        if (this.ruleset === "default" && this.stack.length === 1 && m === "f6") {
            result.valid = false;
            result.message = i18next.t("apgames:validation.catsdogs.INIT_NO_CENTER");
            return result
        }

        if (this.ruleset === "tournament" && this.stack.length === 1 && !["d4", "d5", "e4", "e5"].includes(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.catsdogs.INIT_CENTER");
            return result
        }

        if (this.ruleset === "tournament" && this.stack.length === 2 && ["d4", "d5", "e4", "e5"].includes(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.catsdogs.PLY_2_NO_CENTER");
            return result
        }

        const allMoves = this.moves();
        if (! allMoves.includes(m) ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.catsdogs.INVALID_MOVE");
            return result
        }

        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {partial = false, trusted = false} = {}): CatsDogsGame {
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
        this.board.set(m, this.currplayer);
        this.results.push({ type: "place", where: m });

        if (partial) { return this; }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): CatsDogsGame {

        if ( this.moves().length === 0 ) {
            const prevPlayer: playerid = this.currplayer % 2 + 1 as playerid;
            this.gameover = true;
            if ( this.ruleset === "misere" ) {
                this.winner = [this.currplayer]; // a stalemated player wins the game
            } else {
                this.winner = [prevPlayer]; // a stalemated player loses the game
            }
        }

        if ( this.gameover ) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }

        return this;
    }

    public state(): ICatsDogsState {
        return {
            game: CatsDogsGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: CatsDogsGame.gameinfo.version,
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

        const centerColour: Colourfuncs = { func: "custom", default: "#90EE90", palette: 4 };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const markers: Array<any> = [
            {
                type: "shading",
                colour: centerColour,
                points: [{row:3, col:3}, {row:3, col:5}, {row:5, col:5}, {row:5, col:3} ]
            }
        ];

        // Build rep
        const rep: APRenderRep =  {
            board: this.ruleset === "tournament" ?
                    { style: "squares-checkered", width: this.boardsize, height: this.boardsize, markers } :
                    { style: "squares-checkered", width: this.boardsize, height: this.boardsize },
            legend: {
                A: [{ name: "piece", colour: this.getPlayerColour(1) },
                    { name: "arimaa-cat", colour: "#ffffff", scale: 0.8, opacity: 0.6 }],
                B: [{ name: "piece", colour: this.getPlayerColour(2) },
                    { name: "arimaa-dog", colour: "#aaaaaa", scale: 0.8, opacity: 0.6 }]
            },
            pieces: pstr
        };

        rep.annotations = [];
        for (const move of this.results) {
            if (move.type === "place") {
                const [toX, toY] = g.algebraic2coords(move.where!);
                rep.annotations.push({type: "enter", targets: [{row: toY, col: toX}]});
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

    public clone(): CatsDogsGame {
        return new CatsDogsGame(this.serialize());
    }
}
