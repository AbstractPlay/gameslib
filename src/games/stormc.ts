import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { Direction, reviver, SquareDirectedGraph, UserFacingError } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const deepclone = require("rfdc/default");

type playerid = 1 | 2;

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
}

export interface IStormCState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class StormCGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Storm Clouds",
        uid: "stormc",
        playercounts: [2],
        version: "20250422",
        dateAdded: "2025-03-21",
        // i18next.t("apgames:descriptions.stormc")
        description: "apgames:descriptions.stormc",
        urls: ["https://boardgamegeek.com/boardgame/429340/storm-clouds"],
        people: [
            {
                type: "designer",
                name: "Corey Clark",
                urls: ["https://boardgamegeek.com/boardgamedesigner/38921/corey-clark"],
                apid: "d1cd6092-7429-4241-826b-bbc157d08d93",
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        variants: [
        ],
        categories: ["goal>annihilate", "mechanic>move", "mechanic>capture", "mechanic>asymmetry", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["experimental", "automove"],
    };

    public coords2algebraic(x: number, y: number): string {
        return this.graph.coords2algebraic(x, y);
    }
    public algebraic2coords(cell: string): [number, number] {
        return this.graph.algebraic2coords(cell);
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    private dots: string[] = [];

    constructor(state?: IStormCState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const board = new Map<string, playerid>([
                ["a8", 1],["a7", 1],["a6", 1],["a5", 1],["a4", 1],["a3", 1],
                ["b8", 1],["b7", 1],["b6", 1],["b5", 1],["b4", 1],["b3", 1],
                ["c1", 2],["d1", 2],["e1", 2],["f1", 2],["g1", 2],["h1", 2],
                ["c2", 2],["d2", 2],["e2", 2],["f2", 2],["g2", 2],["h2", 2],
            ]);
            const fresh: IMoveState = {
                _version: StormCGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IStormCState;
            }
            if (state.game !== StormCGame.gameinfo.uid) {
                throw new Error(`The StormC game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): StormCGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        if (state === undefined) {
            throw new Error(`Could not load state index ${idx}`);
        }
        this.results = [...state._results];
        this.currplayer = state.currplayer;
        this.board = new Map([...state.board.entries()]);
        this.lastmove = state.lastmove;
        return this;
    }

    protected get boardSize(): number {
        return 8;
    }

    private get graph(): SquareDirectedGraph {
        return new SquareDirectedGraph(this.boardSize, this.boardSize);
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];

        const g = this.graph;
        const mine = [...this.board.entries()].filter(([,v]) => v === player).map(([k,]) => k);
        const nonCapDirs: Direction[] = player === 1 ? ["N", "NE", "E", "SE"] : ["E", "NE", "N", "NW"];
        const capDirs: Direction[] = player === 1 ? ["S", "SW", "W", "NW"] : ["SE", "S", "SW", "W"];
        for (const start of mine) {
            // noncapturing
            for (const dir of nonCapDirs) {
                const ray = g.ray(start, dir);
                if (ray.length > 0) {
                    const next = ray[0];
                    if (!this.board.has(next)) {
                        moves.push(`${start}-${next}`);
                    }
                }
            }
            // capturing
            for (const dir of capDirs) {
                const ray = g.ray(start, dir);
                const occ = ray.find(c => this.board.has(c));
                if (occ !== undefined) {
                    const contents = this.board.get(occ)!;
                    if (contents !== player) {
                        moves.push(`${start}x${occ}`)
                    }
                }
            }
        }

        if (moves.length === 0) {
            moves.push("pass");
        }
        return moves.sort((a,b) => a.localeCompare(b));
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            let newmove: string;
            // empty move, selecting a piece
            if (move === "") {
                newmove = cell;
            }
            // otherwise, continuation
            else {
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell);
                    // if own pawn, reset
                    if (contents === this.currplayer) {
                        newmove = cell;
                    } else {
                        const [start,] = move.split(/[-x]/);
                        newmove = `${start}x${cell}`;
                    }
                } else {
                    const [start,] = move.split(/[-x]/);
                    newmove = `${start}-${cell}`;
                }
            }

            // autocomplete
            const matches = this.moves().filter(mv => mv.startsWith(newmove));
            if (matches.length === 1) {
                newmove = matches[0];
            }

            const result = this.validateMove(newmove) as IClickResult;
            if (!result.valid) {
                result.move = move;
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

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.stormc.INITIAL_INSTRUCTIONS");
            return result;
        }

        const allMoves = this.moves();
        if (allMoves.includes(m)) {
            // we're good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
        // otherwise look for partials
        else {
            const matches = allMoves.filter(mv => mv.startsWith(m));
            if (matches.length > 0) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.stormc.PARTIAL");
                return result;
            } else {
                if (m.length === 2) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.NO_MOVES", {where: m});
                    return result;
                } else {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
                    return result;
                }
            }
        }
    }

    public move(m: string, {partial = false, trusted = false} = {}): StormCGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const allMoves = this.moves();
        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
            if (!partial && !allMoves.includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];
        this.dots = [];

        if (partial) {
            if (m.length === 2) {
                const matches = new Set<string>(allMoves.filter(mv => mv.startsWith(m)).map(mv => {
                    const [,end] = mv.split(/[-x]/);
                    return end;
                }));
                this.dots = [...matches];
            }
            return this;
        }

        if (m === "pass") {
            this.results.push({ type: "pass", who: this.currplayer });
        } else {
            const [from, to] = m.split(/[-x]/);
            this.board.delete(from);
            this.board.set(to, this.currplayer);
            this.results.push({type: "move", from, to});
            if (m.includes("x")) {
                this.results.push({type: "capture", where: to});
            }
        }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): StormCGame {
        // game only ends if one player has no pieces on the board
        const count1 = [...this.board.values()].filter(p => p === 1).length;
        const count2 = [...this.board.values()].filter(p => p === 2).length;
        if (count1 === 0) {
            this.gameover = true;
            this.winner = [2];
        } else if (count2 === 0) {
            this.gameover = true;
            this.winner = [1];
        }

        if (this.gameover) {
            this.results.push({type: "eog"});
            this.results.push({type: "winners", players: [...this.winner]});
        }
        return this;
    }

    public state(): IStormCState {
        return {
            game: StormCGame.gameinfo.uid,
            numplayers: 2,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: StormCGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map([...this.board.entries()]),
        };
    }

    public render(): APRenderRep {
        const g = this.graph;
        // Build piece string
        const pstr: string[][] = [];
        const cells = g.listCells(true) as string[][];
        for (const row of cells) {
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const owner = this.board.get(cell)!;
                    if (owner === 1) {
                        pieces.push("A")
                    } else {
                        pieces.push("B");
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr.push(pieces);
        }
        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-checkered",
                width: this.boardSize,
                height: this.boardSize,
            },
            legend: {
                A: [{ name: "piece", colour: 1 }],
                B: [{ name: "piece", colour: 2 }],
            },
            pieces: pstr.map(p => p.join("")).join("\n"),
        };

        // Add annotations
        if (this.results.length > 0) {
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "move") {
                    const [fx, fy] = g.algebraic2coords(move.from);
                    const [tx, ty] = g.algebraic2coords(move.to);
                    rep.annotations.push({ type: "move", targets: [{ row: fy, col: fx }, { row: ty, col: tx }] });
                } else if (move.type === "capture") {
                    const targets: RowCol[] = [];
                    for (const m of move.where!.split(", ")) {
                        const [x, y] = g.algebraic2coords(m);
                        targets.push({row: y, col: x});
                    }
                    rep.annotations.push({type: "exit", targets: targets as [RowCol, ...RowCol[]]});
                }
            }
        }

        // add dots
        if (this.dots.length > 0) {
            if (!("annotations" in rep)) {
                rep.annotations = [];
            }
            const coords: RowCol[] = [];
            for (const dot of this.dots) {
                const [x, y] = this.algebraic2coords(dot);
                coords.push({row: y, col: x});
            }
            rep.annotations!.push({type: "dots", targets: coords as [RowCol, ...RowCol[]]});
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

    // public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
    //     let resolved = false;
    //     switch (r.type) {
    //         case "capture":
    //             node.push(i18next.t("apresults:CAPTURE.group", { player, count: r.count, cells: r.where }));
    //             resolved = true;
    //             break;
    //         case "pass":
    //             node.push(i18next.t("apresults:PASS.forced", { player }));
    //             resolved = true;
    //             break;
    //     }
    //     return resolved;
    // }

    public clone(): StormCGame {
        return Object.assign(new StormCGame(), deepclone(this) as StormCGame);
    }
}
