import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, UserFacingError } from "../common";
import i18next from "i18next";

export type playerid = 1|2;


export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface IComplicaState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class ComplicaGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Complica",
        uid: "complica",
        playercounts: [2],
        version: "20230617",
        dateAdded: "2023-06-18",
        // i18next.t("apgames:descriptions.complica")
        description: "apgames:descriptions.complica",
        urls: ["https://www.di.fc.ul.pt/~jpn/gv/complica.htm"],
        people: [
            {
                type: "designer",
                name: "Reiner Knizia",
            },
        ],
        categories: ["goal>align", "mechanic>place", "mechanic>displace", "board>shape>rect", "board>connect>rect", "components>simple"],
        flags: []
    };
    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 7);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 7);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IComplicaState | string) {
        super();
        if (state === undefined) {
            const board = new Map<string, playerid>();
            const fresh: IMoveState = {
                _version: ComplicaGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IComplicaState;
            }
            if (state.game !== ComplicaGame.gameinfo.uid) {
                throw new Error(`The Complica engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): ComplicaGame {
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

    public moves(): string[] {
        if (this.gameover) { return []; }
        return ["a","b","c","d"];
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = ComplicaGame.coords2algebraic(col, row);
            const newmove = cell[0];
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
            result.message = i18next.t("apgames:validation.complica.INITIAL_INSTRUCTIONS")
            return result;
        }

        if (! ["a","b","c","d"].includes(m)) {
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

    public move(m: string, {trusted = false} = {}): ComplicaGame {
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
        let placed = false;
        for (const row of [1,2,3,4,5,6,7]) {
            const cell = m + row.toString();
            if (! this.board.has(cell)) {
                this.board.set(cell, this.currplayer);
                this.results.push({type: "place", where: cell});
                if (row < 7) {
                    this.results.push({type: "move", from: `${m}7`, to: cell});
                }
                placed = true;
                break;
            }
        }
        // push column down
        if (! placed) {
            for (let row = 1; row <= 6; row++) {
                const lower = m + row.toString();
                const upper = m + (row + 1).toString();
                this.board.set(lower, this.board.get(upper)!);
            }
            this.results.push({type: "move", from: `${m}6`, to: `${m}1`});
            this.board.set(`${m}7`, this.currplayer);
            this.results.push({type: "place", where: `${m}7`});
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

    private hasFours(player: playerid): boolean {
        const grid = new RectGrid(4,7);
        for (let y = 0; y < 7; y++) {
            for (let x = 0; x < 4; x++) {
                for (const dir of ["W","SW","S","SE","E"] as const) {
                    const ray = [[x,y] as [number,number], ...grid.ray(x, y, dir)].map(node => ComplicaGame.coords2algebraic(...node));
                    if (ray.length >= 4) {
                        let four = true;
                        for (const cell of ray.slice(0,4)) {
                            if ( (! this.board.has(cell)) || (this.board.get(cell)! !== player) ) {
                                four = false;
                                break;
                            }
                        }
                        if (four) {
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    }

    protected checkEOG(): ComplicaGame {
        const conn1 = this.hasFours(1);
        const conn2 = this.hasFours(2);
        // only one person has four in a row
        if ( (conn1 || conn2) && (conn1 !== conn2) ) {
            this.gameover = true;
            if (conn1) {
                this.winner = [1];
            } else {
                this.winner = [2];
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

    public state(): IComplicaState {
        return {
            game: ComplicaGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: ComplicaGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < 7; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < 4; col++) {
                const cell = ComplicaGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
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
        pstr = pstr.replace(/-{4}/g, "_");

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-checkered",
                width: 4,
                height: 7,
            },
            legend: {
                A: {
                    name: "piece",
                    player: 1
                },
                B: {
                    name: "piece",
                    player: 2
                }
            },
            pieces: pstr
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = ComplicaGame.algebraic2coords(move.from);
                    const [toX, toY] = ComplicaGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "place") {
                    const [x, y] = ComplicaGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
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

    public clone(): ComplicaGame {
        return new ComplicaGame(this.serialize());
    }
}
