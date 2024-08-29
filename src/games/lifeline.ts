import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { HexTriGraph, reviver, UserFacingError } from "../common";
import i18next from "i18next";

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface ILifelineState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class LifelineGame extends GameBase {

    public static readonly gameinfo: APGamesInformation = {
        name: "Lifeline",
        uid: "lifeline",
        playercounts: [2],
        version: "1.0",
        dateAdded: "2024-08-29",
        description: "apgames:descriptions.lifeline",
        urls: ["https://boardgamegeek.com/boardgame/358196/lifeline"],
        people: [
            {
                type: "designer",
                name: "Michael Amundsen",
                urls: ["https://boardgamegeek.com/boardgamedesigner/133389/michael-amundsen"],
            },
            {
                type: "designer",
                name: "Luis Bolaños Mures",
                urls: ["https://boardgamegeek.com/boardgamedesigner/47001/luis-bolanos-mures"],
            }
        ],
        flags: ["experimental"],
        categories: ["goal>annihilating", "mechanic>place","board>shape>hex"]
    };

    public coords2algebraic(x: number, y: number): string {
        return this.graph.coords2algebraic(x, y);
    }
    public algebraic2coords(cell: string): [number, number] {
        return this.graph.algebraic2coords(cell);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public boardsize = 5;
    public graph: HexTriGraph = this.getGraph();
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: ILifelineState | string) {
        super();
        if (state === undefined) {
            const fresh: IMoveState = {
                _version: LifelineGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map<string, playerid>(),
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ILifelineState;
            }
            if (state.game !== LifelineGame.gameinfo.uid) {
                throw new Error(`The Lifeline engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): LifelineGame {
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

        return this;
    }

    public getGraph(): HexTriGraph {
        return new HexTriGraph(this.boardsize, this.boardsize * 2 - 1);
    }

    public moves(): string[] {
        if (this.gameover) { return []; }

        const moves = [];
        for (const cell of this.graph.listCells(false) as string[]) {
            if (!this.board.has(cell)) {
                moves.push(cell);
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
            const newmove = this.coords2algebraic(col, row);
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
            result.message = i18next.t("apgames:validation.lifeline.INITIAL_INSTRUCTIONS")
            return result;
        }

        if (this.board.has(m)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
            return result;
        }

        // Looks good
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    /**
     * This is where you actually execute a move. You can use `validateMove()` and `moves()` to make triple sure you've received a valid move, and that frees you from excessive error checking and handling in your execution code. More comments below.
     */
    public move(m: string, {trusted = false} = {}): LifelineGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        /**
         * This validates the move and then does a failsafe check to make sure the move is also found by the move generator. You don't necessarily need both, but it's useful when first testing a game.
         */
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        // The front end often needs to make moves that it knows are valid, so to save time, it can pass `trusted: true` to skip the validation step.
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (! this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        const cell = m;

        this.results = [];
        this.board.set(cell, this.currplayer);
        this.results.push({type: "place", where: cell});

        this.lastmove = m;
        this.currplayer = this.currplayer === 1 ? 2 : 1;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): LifelineGame {
        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): ILifelineState {
        return {
            game: LifelineGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: LifelineGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    public render(): APRenderRep {

        const pstr: string[][][] = [];
        const cells = this.graph.listCells(true);
        for (const row of cells) {
            const pieces: string[][] = [];
            for (const cell of row) {
                const piece: string[] = [];
                if (this.board.has(cell)) {
                    const player = this.board.get(cell)!;
                    piece.push(player === 1 ? "A" : "B");
                }
                pieces.push(piece);
            }
            pstr.push(pieces);
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "hex-of-hex",
                minWidth: this.boardsize,
                maxWidth: this.boardsize * 2 - 1
            },
            legend: {
                A: {
                    name: "piece",
                    colour: 1
                },
                B: {
                    name: "piece",
                    colour: 2
                }
            },
            pieces: pstr as [string[][], ...string[][][]]
        };

        return rep;
    }

    /**
     * This function is only for the local playground.
     */
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
            case "place":
                node.push(i18next.t("apresults:PLACE.nowhat", {player, where: r.where}));
                resolved = true;
                break;
            case "move":
                resolved = true;
                break;
        }
        return resolved;
    }

    /**
     * Just leave this. You very, very rarely need to do anything here.
     */
    public clone(): LifelineGame {
        return new LifelineGame(this.serialize());
    }
}
