import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { allDirections, reviver, SquareGraph, UserFacingError } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const deepclone = require("rfdc/default");

export type playerid = 1|2;
export type ConnectionStatus = "enemy"|"self"|"isolated";

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface IEnsoState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class EnsoGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Enso",
        uid: "enso",
        playercounts: [2],
        version: "20260108",
        dateAdded: "2026-01-12",
        // i18next.t("apgames:descriptions.enso")
        description: "apgames:descriptions.enso",
        urls: [
            "https://spielstein.com/games/enso",
            "https://boardgamegeek.com/boardgame/460838/enso",
        ],
        people: [
            {
                type: "designer",
                name: "Dieter Stein",
                apid: "e7f53920-5be9-406a-9d5c-baa0316ab4f4",
                urls: ["https://spielstein.com/"]
            },
            {
                type: "publisher",
                name: "Kanare Kato",
                urls: ["https://kanare-abstract.com/en"],
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        categories: ["goal>isolate", "mechanic>move", "mechanic>capture", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["automove"]
    };

    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 6);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 6);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private _dots: string[] = [];

    constructor(state?: IEnsoState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const board = new Map<string, playerid>([
                ["a6", 1], ["b6", 1], ["c6", 1], ["d6", 2], ["e6", 2], ["f6", 2],
                ["a5", 1], ["b5", 1], ["c5", 1], ["d5", 2], ["e5", 2], ["f5", 2],
                ["a4", 1], ["b4", 1],                       ["e4", 2], ["f4", 2],
                ["a3", 2], ["b3", 2],                       ["e3", 1], ["f3", 1],
                ["a2", 2], ["b2", 2], ["c2", 2], ["d2", 1], ["e2", 1], ["f2", 1],
                ["a1", 2], ["b1", 2], ["c1", 2], ["d1", 1], ["e1", 1], ["f1", 1],
            ]);
            const fresh: IMoveState = {
                _version: EnsoGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IEnsoState;
            }
            if (state.game !== EnsoGame.gameinfo.uid) {
                throw new Error(`The Enso engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): EnsoGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = deepclone(state.board) as Map<string, playerid>;
        this.lastmove = state.lastmove;
        this.results = [...state._results];
        return this;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];

        const g = new SquareGraph(6, 6);
        const mine = [...this.board.entries()].filter(e => e[1] === player).map(e => e[0]);
        for (const pc of mine) {
            const status = this.connStatus(pc);
            // disconnected pieces can't move
            if (status === "isolated") {
                continue;
            }
            // enemy connected must capture
            else if (status === "enemy") {
                const [fx, fy] = g.algebraic2coords(pc);
                for (const dir of allDirections) {
                    const ray = g.ray(fx, fy, dir).map(c => g.coords2algebraic(...c));
                    const next = ray.find(cell => this.board.has(cell));
                    if (next !== undefined) {
                        if (this.board.get(next)! !== player) {
                            moves.push(`${pc}x${next}`);
                        }
                    }
                }
            }
            // self connected must move
            else {
                const [fx, fy] = g.algebraic2coords(pc);
                for (const dir of allDirections) {
                    let ray = g.ray(fx, fy, dir).map(c => g.coords2algebraic(...c));
                    const idx = ray.findIndex(cell => this.board.has(cell));
                    if (idx >= 0) {
                        // this ray only contains contiguous empty spaces leading up
                        // to the first occupied space
                        ray = ray.slice(0, idx);
                    }
                    for (const next of ray) {
                        const cloned = this.clone();
                        cloned.board.delete(pc);
                        cloned.board.set(next, player);
                        const status = cloned.connStatus(next);
                        if (status === "isolated" || status === "enemy") {
                            moves.push(`${pc}-${next}`);
                        }
                    }
                }
            }
        }

        return [...moves].sort((a,b) => a.localeCompare(b));
    }

    public connStatus(cell: string): ConnectionStatus {
        const g = new SquareGraph(6, 6);
        const player = this.board.get(cell);
        if (player === undefined) {
            throw new Error(`Cannot determine the connection status of empty cells (${cell}).`);
        }
        let adjEnemy = false;
        let adjSelf = false;
        for (const n of g.neighbours(cell)) {
            if (this.board.has(n)) {
                if (this.board.get(n)! === player) {
                    adjSelf = true;
                } else {
                    adjEnemy = true;
                }
            }
        }

        if (!adjEnemy && !adjSelf) {
            return "isolated";
        } else if (adjEnemy) {
            return "enemy";
        } else {
            return "self";
        }
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = EnsoGame.coords2algebraic(col, row);
            const contents = this.board.get(cell);
            let newmove = "";
            // clicking on your own piece always resets the move
            if (contents === this.currplayer) {
                newmove = cell;
            }
            // if a move is started, clicking empty or enemy pieces completes a move
            else if (move.length > 0) {
                if (contents === undefined) {
                    newmove = `${move}-${cell}`;
                } else {
                    newmove = `${move}x${cell}`;
                }
            }
            // otherwise, don't change anything
            else {
                newmove = move;
            }

            const result = this.validateMove(newmove) as IClickResult;
            if (! result.valid) {
                result.move = move;
            } else {
                result.move = newmove;
            }
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", {move, row, col, piece, emessage: (e as Error).message, estack: (e as Error).stack})
            }
        }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.enso.INITIAL_INSTRUCTIONS");
            return result;
        }

        const allmoves = this.moves();
        const [from, to] = m.split(/[-x]/);
        if (from !== undefined && allmoves.filter(mv => mv.startsWith(from)).length > 0) {
            if (to === undefined) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.enso.PARTIAL");
                return result;
            }
            else if (allmoves.includes(m)) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
                return result;
            }
        } else {
            result.valid = false;
            result.message = i18next.t("apgames:validation.enso.NO_MOVES", {cell: from});
            return result;
        }

    }

    // The partial flag enabled dynamic connection checking.
    // It leaves the object in an invalid state, so only use it on cloned objects, or call `load()` before submitting again.
    public move(m: string, {partial = false, trusted = false} = {}): EnsoGame {
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
            if (!partial && !this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        // dots first if partial
        if (partial) {
            this._dots = [...new Set<string>(this.moves().filter(mv => mv.startsWith(m)).map(mv => mv.split(/[-x]/)).map(parts => parts[parts.length - 1])).values()];
            return this;
        }

        this.results = [];

        const [from, to] = m.split(/[-x]/);
        this.results.push({type: "move", from, to});
        if (this.board.has(to)) {
            this.results.push({type: "capture", where: to});
        }
        this.board.delete(from);
        this.board.set(to, this.currplayer);

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

    protected checkEOG(): EnsoGame {
        const g = new SquareGraph(6, 6);
        let ensoOne = false;
        let ensoTwo = false;
        for (const [cell, player] of this.board) {
            // only care about first enso
            if (player === 1 && !ensoOne) {
                const ns = g.neighbours(cell);
                if (ns.length === 8) {
                    let enso = true;
                    for (const n of ns) {
                        if (this.board.has(n)) {
                            enso = false;
                            break;
                        }
                    }
                    ensoOne = enso;
                }
            }
            else if (player === 2 && !ensoTwo) {
                const ns = g.neighbours(cell);
                if (ns.length === 8) {
                    let enso = true;
                    for (const n of ns) {
                        if (this.board.has(n)) {
                            enso = false;
                            break;
                        }
                    }
                    ensoTwo = enso;
                }
            }
        }

        if (ensoOne && ensoTwo) {
            this.gameover = true;
            this.winner = [this.currplayer === 1 ? 2 : 1];
        } else if (ensoOne) {
            this.gameover = true;
            this.winner = [1];
        } else if (ensoTwo) {
            this.gameover = true;
            this.winner = [2];
        } else if (this.moves().length === 0) {
            this.gameover = true;
            this.winner = [this.currplayer === 1 ? 2 : 1];
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IEnsoState {
        return {
            game: EnsoGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: EnsoGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: deepclone(this.board),
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < 6; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < 6; col++) {
                const cell = EnsoGame.coords2algebraic(col, row);
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
        pstr = pstr.replace(/\n,{6}(?=\n)/g, "\n_");

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-checkered",
                width: 6,
                height: 6,
            },
            legend: {
                A: {
                    name: "piece",
                    colour: 1
                },
                B: {
                    name: "piece",
                    colour: 2
                },
            },
            pieces: pstr
        };

        rep.annotations = [];

        // add dots, if present
        if (this._dots.length > 0) {
            const points: RowCol[] = [];
            for (const cell of this._dots) {
                const [col, row] = EnsoGame.algebraic2coords(cell);
                points.push({row, col});
            }
            rep.annotations.push({type: "dots", targets: points as [RowCol, ...RowCol[]]});
        }

        // Add annotations
        // if (this.stack[this.stack.length - 1]._results.length > 0) {
        if (this.results.length > 0) {
            // for (const move of this.stack[this.stack.length - 1]._results) {
            for (const move of this.results) {
                if (move.type === "move") {
                    const [fromX, fromY] = EnsoGame.algebraic2coords(move.from);
                    const [toX, toY] = EnsoGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", colour: 3, targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "capture") {
                    const [x, y] = EnsoGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                }
            }
        }
        if (rep.annotations.length === 0) {
            delete rep.annotations;
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

    public clone(): EnsoGame {
        const cloned = Object.assign(new EnsoGame(), deepclone(this) as EnsoGame);
        return cloned;
    }
}
