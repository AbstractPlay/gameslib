import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { allDirections, RectGrid, reviver, SquareDirectedGraph, UserFacingError } from "../common";
import i18next from "i18next";

export type playerid = 1|2;


export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface ISquaredanceState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class SquaredanceGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Squaredance",
        uid: "squaredance",
        playercounts: [2],
        version: "20250125",
        dateAdded: "2023-06-18",
        // i18next.t("apgames:descriptions.squaredance")
        description: "apgames:descriptions.squaredance",
        urls: ["https://www.di.fc.ul.pt/~jpn/gv/squaredance.htm"],
        people: [
            {
                type: "designer",
                name: "Karl Scherer",
            },
        ],
        categories: ["goal>immobilize", "mechanic>move>group", "mechanic>capture", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["experimental", "pie", "perspective", "automove"]
    };
    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 10);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 10);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private graph!: SquareDirectedGraph;
    private dots: string[] = [];
    private line: [string, string]|undefined;

    constructor(state?: ISquaredanceState | string) {
        super();
        if (state === undefined) {
            const board = new Map<string, playerid>();
            for (const row of [10, 9, 8]) {
                for (const col of ["c", "d", "e", "f", "g", "h"]) {
                    board.set(`${col}${row}`, 2);
                }
            }
            for (const row of [3, 2, 1]) {
                for (const col of ["c", "d", "e", "f", "g", "h"]) {
                    board.set(`${col}${row}`, 1);
                }
            }
            const fresh: IMoveState = {
                _version: SquaredanceGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ISquaredanceState;
            }
            if (state.game !== SquaredanceGame.gameinfo.uid) {
                throw new Error(`The Squaredance engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): SquaredanceGame {
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
        this.graph = new SquareDirectedGraph(10, 10);
        return this;
    }

    public moves(): string[] {
        if (this.gameover) { return []; }

        const moves: string[] = [];

        const mine = [...this.board.entries()].filter(([,p]) => p === this.currplayer).map(([c,]) => c);
        for (const cell of mine) {
            for (const dir of allDirections) {
                let ray = this.graph.ray(cell, dir);
                const idx = ray.findIndex(c => !this.board.has(c) || this.board.get(c)! !== this.currplayer);
                if (idx >= 0) {
                    ray = ray.slice(0, idx);
                }
                // we have a valid line of stones
                if (ray.length > 0) {
                    // for each subset of length, try to move them
                    for (let len = 1; len <= ray.length; len++) {
                        for (const nextDir of allDirections) {
                            if (nextDir === dir) { continue; }
                            let nextRay = this.graph.ray(cell, nextDir);
                            if (nextRay.length >= len) {
                                nextRay = nextRay.slice(0, len);
                                // abort if there are any friendly stones in this ray
                                const friendlyIdx = nextRay.findIndex(c => this.board.has(c) && this.board.get(c) === this.currplayer);
                                if (friendlyIdx >= 0) { continue; }
                                // if we make it here, it's a legal move
                                moves.push(`${cell}:${ray[len-1]}-${nextRay[len-1]}`);
                            }
                        }
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
        try {
            const cell = SquaredanceGame.coords2algebraic(col, row);
            let newmove: string;

            // blank move means choosing a pivot stone
            if (move === "") {
                newmove = cell;
            }
            // otherwise a continuation
            else {
                // no colon means choosing end stone
                if (!move.includes(":")) {
                    newmove = move + ":" + cell;
                }
                // otherwise choosing destination
                else {
                    const [left,] = move.split("-");
                    newmove = left + "-" + cell;
                }
            }

            // autocomplete
            const matches = this.moves().filter(mv => mv.startsWith(newmove));
            if (matches.length === 1) {
                newmove = matches[0];
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

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const allMoves = this.moves();

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.squaredance.INITIAL_INSTRUCTIONS")
            return result;
        }

        if (allMoves.includes(m)) {
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        } else {
            if (allMoves.filter(mv => mv.startsWith(m)).length > 0) {
                // need an end stone
                if (!m.includes(":")) {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.squaredance.PARTIAL_ENDSTONE");
                    return result;
                } else if (!m.includes("-")) {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.squaredance.PARTIAL_DESTINATION");
                    return result;
                }
                // catchall error state
                else {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
                    return result;
                }
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
                return result;
            }
        }
    }

    public move(m: string, {trusted = false, partial = false} = {}): SquaredanceGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const allMoves = this.moves();
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (!partial && !allMoves.includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];
        this.dots = [];
        this.line = undefined;

        if (partial) {
            if (!m.includes(":")) {
                this.dots.push(m);
            } else {
                // eslint-disable-next-line @typescript-eslint/no-shadow
                const [left, ] = m.split("-");
                // eslint-disable-next-line @typescript-eslint/no-shadow
                const [pivot, end] = left.split(":");
                this.line = [pivot, end];
                this.dots = [...new Set<string>(allMoves.filter(mv => mv.startsWith(left)).map(mv => mv.split("-")).map(parts => parts[parts.length - 1])).values()];
            }
            return this;
        }

        const [left, to] = m.split("-");
        const [pivot, end] = left.split(":");
        const [px, py] = this.graph.algebraic2coords(pivot);
        const [ex, ey] = this.graph.algebraic2coords(end);
        const [tx, ty] = this.graph.algebraic2coords(to);
        const fBetween = RectGrid.between(px, py, ex, ey).map(c => this.graph.coords2algebraic(...c));
        for (const moved of [end, ...fBetween]) {
            this.board.delete(moved);
        }
        let capped = 0;
        const tBetween = RectGrid.between(px, py, tx, ty).map(c => this.graph.coords2algebraic(...c));
        for (const covered of [to, ...tBetween]) {
            if (this.board.has(covered)) {
                capped++;
            }
            this.board.set(covered, this.currplayer);
        }
        this.results.push({type: "move", from: end, to, what: left});
        if (capped > 0) {
            this.results.push({type: "capture", count: capped});
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

    protected checkEOG(): SquaredanceGame {
        const prev = this.currplayer === 1 ? 2 : 1;
        if (this.moves().length === 0) {
            this.gameover = true;
            this.winner = [prev];
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): ISquaredanceState {
        return {
            game: SquaredanceGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: SquaredanceGame.gameinfo.version,
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
        for (let row = 0; row < 10; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < 10; col++) {
                const cell = SquaredanceGame.coords2algebraic(col, row);
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
        pstr = pstr.replace(/-{10}/g, "_");

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "vertex-cross",
                width: 10,
                height: 10,
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
            pieces: pstr
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = SquaredanceGame.algebraic2coords(move.from);
                    const [toX, toY] = SquaredanceGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                }
            }
        }

        if (this.line !== undefined || this.dots.length > 0) {
            if (!("annotations" in rep)) {
                rep.annotations = [];
            }
            if (this.line !== undefined) {
                const [[lx, ly], [rx, ry]] = this.line.map(c => this.graph.algebraic2coords(c));
                rep.annotations!.push({type: "move", targets: [{row: ly, col: lx}, {row: ry, col: rx}], arrow: false});
            }
            if (this.dots.length > 0) {
                const targets: RowCol[] = [];
                for (const cell of this.dots) {
                    const [col, row] = this.graph.algebraic2coords(cell);
                    targets.push({row, col});
                }
                rep.annotations!.push({
                    type: "dots",
                    targets: targets as [RowCol, ...RowCol[]],
                });
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
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.multiple", {player, count: r.count}));
                resolved = true;
                break;
            case "move":
                node.push(i18next.t("apresults:MOVE.nowhat", {player, count: r.count, from: r.from, to: r.to}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): SquaredanceGame {
        return new SquaredanceGame(this.serialize());
    }
}
