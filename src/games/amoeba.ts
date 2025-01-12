/* eslint-disable @typescript-eslint/no-unsafe-call */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { HexTriGraph, reviver, UserFacingError } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-var-requires
const deepclone = require("rfdc/default");

export type playerid = 1|2;
export type Piece = "kernel"|"piece";

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, [playerid, Piece][]>;
    lastmove?: string;
};

export interface IAmoebaState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class AmoebaGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Amoeba",
        uid: "amoeba",
        playercounts: [2],
        version: "20250112",
        dateAdded: "2023-06-18",
        // i18next.t("apgames:descriptions.amoeba")
        description: "apgames:descriptions.amoeba",
        urls: ["https://boardgamegeek.com/boardgame/143387/amoeba"],
        people: [
            {
                type: "designer",
                name: "Masahiro Nakajima",
                urls: ["https://boardgamegeek.com/boardgamedesigner/68359/masahiro-nakajima"],
            },
        ],
        categories: ["goal>royal>capture", "goal>immobilize", "mechanic>move", "mechanic>coop", "mechanic>stack", "mechanic>move>sow", "board>shape>hex", "board>connect>hex", "components>simple>1per"],
        flags: ["experimental", "pie", "automove"]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, [playerid, Piece][]>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IAmoebaState | string) {
        super();
        if (state === undefined) {
            const board = new Map<string, [playerid, Piece][]>([
                ["g1", [[2, "piece"]]], ["g2", [[2, "piece"]]], ["g3", [[2, "piece"]]], ["g4", [[2, "piece"]]],
                ["f3", [[2, "kernel"]]],
                ["e1", [[2, "piece"]]], ["e2", [[2, "piece"]]], ["e3", [[2, "piece"]]], ["e4", [[2, "piece"]]], ["e5", [[2, "piece"]]], ["e6", [[2, "piece"]]],
                ["c1", [[1, "piece"]]], ["c2", [[1, "piece"]]], ["c3", [[1, "piece"]]], ["c4", [[1, "piece"]]], ["c5", [[1, "piece"]]], ["c6", [[1, "piece"]]],
                ["b3", [[1, "kernel"]]],
                ["a1", [[1, "piece"]]], ["a2", [[1, "piece"]]], ["a3", [[1, "piece"]]], ["a4", [[1, "piece"]]],
            ]);
            const fresh: IMoveState = {
                _version: AmoebaGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IAmoebaState;
            }
            if (state.game !== AmoebaGame.gameinfo.uid) {
                throw new Error(`The Amoeba engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): AmoebaGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = deepclone(state.board) as Map<string, [playerid, Piece][]>;
        this.lastmove = state.lastmove;
        return this;
    }

    public moves(): string[] {
        if (this.gameover) { return []; }

        const moves: string[] = [];

        const g = new HexTriGraph(4, 7);
        const mine = [...this.board.entries()].filter(([,stack]) => stack[stack.length - 1][0] === this.currplayer);
        for (const [from, stack] of mine) {
            const [fx, fy] = g.algebraic2coords(from);
            for (const dir of HexTriGraph.directions) {
                const ray = g.ray(fx, fy, dir);
                if (ray.length >= stack.length) {
                    const to = g.coords2algebraic(...ray[stack.length - 1]);
                    moves.push(`${from}-${to}`);
                    if (stack.length > 1) {
                        moves.push(`${from}>${to}`);
                    }
                }
            }
        }

        return moves.sort((a,b) => a.localeCompare(b));
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        const g = new HexTriGraph(4, 7);
        try {
            const cell = g.coords2algebraic(col, row);
            let newmove: string;
            if (move === "") {
                newmove = cell;
            } else {
                // we need to do some processing to determine if it's a move a sow
                // if the stack height is > 1 but we're clicking right next to the
                // other cell, then it's a sow; otherwise it's a move
                const [left,] = move.split(/[-\>]/);
                const fstack = this.board.get(left);
                if (fstack === undefined) {
                    newmove = cell;
                } else {
                    const [fx, fy] = g.algebraic2coords(left);
                    let isAdj = false;
                    if (g.neighbours(left).includes(cell)) {
                        isAdj = true;
                    }
                    // this is a sowing move
                    if (isAdj && fstack.length > 1) {
                        const bearing = g.bearing(left, cell);
                        if (bearing === undefined) {
                            newmove = cell;
                        } else {
                            const ray = g.ray(fx, fy, bearing).map(c => g.coords2algebraic(...c));
                            newmove = `${left}>${ray[fstack.length - 1]}`;
                        }
                    }
                    // direct move
                    else {
                        newmove = `${left}-${cell}`;
                    }
                }
            }

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
            result.message = i18next.t("apgames:validation.amoeba.INITIAL_INSTRUCTIONS")
            return result;
        }

        const g = new HexTriGraph(4, 7);
        const allmoves = this.moves();
        const [from, to] = m.split(/[-\>]/);

        // from must be a valid cell
        if (!g.graph.hasNode(from)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: from});
            return result;
        }
        // it must be occupied
        if (!this.board.has(from)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: from});
            return result;
        }
        // must be controlled by you
        const fstack = this.board.get(from)!;
        if (fstack[fstack.length - 1][0] !== this.currplayer) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
            return result;
        }
        // the selected piece must have at least one move
        if (allmoves.filter(mv => mv.startsWith(from)).length === 0) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NO_MOVES", {where: from});
            return result;
        }

        // validate to if present
        if (to === undefined || to === "") {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.amoeba.PARTIAL");
            return result;
        } else {
            // must be a valid cell
            if (!g.graph.hasNode(to)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: to});
                return result;
            }
            // must be the correct distance
            const path = g.path(from, to);
            if (path === null || fstack.length !== path.length - 1) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.amoeba.BAD_DISTANCE");
                return result;
            }

            // TODO: If we ever make immobile stacks illegal, this is where we'd check that

            // Looks good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
    }

    public move(m: string, {trusted = false} = {}): AmoebaGame {
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
        const g = new HexTriGraph(4, 7);
        const [from, to] = m.split(/[-\>]/);
        const fstack = this.board.get(from)!;
        // direct movement
        if (m.includes("-")) {
            const tstack = this.board.get(to);
            if (tstack === undefined) {
                this.board.set(to, [...fstack]);
            } else {
                this.board.set(to, [...tstack, ...fstack]);
            }
            this.board.delete(from);
            this.results.push({type: "move", from, to, count: fstack.length});
        }
        // sowing
        else {
            const bearing = g.bearing(from, to)!;
            const [fx, fy] = g.algebraic2coords(from);
            const ray = g.ray(fx, fy, bearing).map(c => g.coords2algebraic(...c));
            for (let i = 0; i < fstack.length; i++) {
                const next = ray[i];
                const nstack = this.board.get(next);
                if (nstack === undefined) {
                    this.board.set(next, [fstack[i]]);
                } else {
                    this.board.set(next, [...nstack, fstack[i]]);
                }
            }
            this.board.delete(from);
            this.results.push({type: "unfurl", from, to, count: fstack.length});
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

    protected checkEOG(): AmoebaGame {
        const prevPlayer = this.currplayer === 1 ? 2 : 1;

        // kernel control
        const owned = [...this.board.values()].filter(stack => stack[stack.length - 1][0] === prevPlayer);
        for (const stack of owned) {
            const kernel = stack.find(pc => pc[0] === this.currplayer && pc[1] === "kernel");
            if (kernel !== undefined) {
                this.gameover = true;
                this.winner = [prevPlayer];
                break;
            }
        }
        // no moves
        if (!this.gameover) {
            if (this.moves().length === 0) {
                this.gameover = true;
                this.winner = [prevPlayer];
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

    public state(): IAmoebaState {
        return {
            game: AmoebaGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: AmoebaGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: deepclone(this.board) as Map<string, [playerid, Piece][]>,
        };
    }

    public render(): APRenderRep {
        const g = new HexTriGraph(4, 7);
        // Build piece string
        let pstr = "";
        for (const row of g.listCells(true) as string[][]) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (const cell of row) {
                const stack = this.board.get(cell);
                if (stack === undefined) {
                    pieces.push("-");
                } else {
                    pieces.push(stack.map(pc => pc[1] === "kernel" ? pc[0] === 1 ? "X" : "Y" : pc[0] === 1 ? "A" : "B").join(""));
                }
            }
            pstr += pieces.join(",");
        }

        // Build rep
        const rep: APRenderRep =  {
            renderer: "stacking-offset",
            board: {
                style: "hex-of-tri",
                minWidth: 4,
                maxWidth: 7,
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
                X: {
                    name: "piece-cog",
                    colour: 1,
                },
                Y: {
                    name: "piece-cog",
                    colour: 2,
                }
            },
            pieces: pstr
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move" || move.type === "unfurl") {
                    const [fromX, fromY] = g.algebraic2coords(move.from);
                    const [toX, toY] = g.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
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
            case "unfurl":
                node.push(i18next.t("apresults:UNFURL.amoeba", {player, from: r.from, to: r.to, count: r.count}));
                resolved = true;
                break;
            case "move":
                node.push(i18next.t("apresults:MOVE.complete", {player, from: r.from, to: r.to, count: r.count}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): AmoebaGame {
        return Object.assign(new AmoebaGame(), deepclone(this) as AmoebaGame);
    }
}
