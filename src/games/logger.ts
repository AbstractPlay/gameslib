/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IRenderOpts, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { RectGrid, shuffle, SquareOrthGraph } from "../common";
import { APRenderRep, AreaPieces, Glyph } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const clone = require("rfdc/default");

export type playerid = 1|2|3|4;

interface ILegendObj {
    [key: string]: Glyph|[Glyph, ...Glyph[]];
}

export type CellContents = "S"|"M"|"L"|"X"|"P1"|"P2"|"P3"|"P4";

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    lastmove?: string;
    scores: number[];
    protestors: number[];
}

export interface ILoggerState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class LoggerGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Logger",
        uid: "logger",
        playercounts: [2,3,4],
        version: "20240908",
        dateAdded: "2024-09-08",
        // i18next.t("apgames:descriptions.logger")
        description: "apgames:descriptions.logger",
        urls: ["https://boardgamegeek.com/boardgame/36985/logger"],
        people: [
            {
                type: "designer",
                name: "Eric Dresner",
                urls: ["https://boardgamegeek.com/boardgamedesigner/10753/erik-dresner"]
            }
        ],
        categories: ["goal>score>eog", "mechanic>place", "mechanic>move", "mechanic>block", "mechanic>share", "mechanic>capture", "board>shape>rect", "board>connect>rect", "components>pyramids"],
        flags: ["experimental", "scores", "no-moves", "custom-randomization", "perspective"]
    };

    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 5);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 5);
    }

    public numplayers!: number;
    public currplayer!: playerid;
    public board!: Map<string, CellContents>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public scores!: number[];
    public protestors!: number[];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = []
    public highlights: string[] = [];

    constructor(state: number | ILoggerState | string) {
        super();
        if (typeof state === "number") {
            const scores: number[] = [];
            const protestors: number[] = [];
            for (let i = 0; i < state; i++) {
                scores.push(0);
                if (state === 2) {
                    protestors.push(2);
                } else {
                    protestors.push(1);
                }
            }
            this.numplayers = state;
            const fresh: IMoveState = {
                _version: LoggerGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map([["c3", "S"]]),
                scores,
                protestors,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ILoggerState;
            }
            if (state.game !== LoggerGame.gameinfo.uid) {
                throw new Error(`The Logger game code cannot process a game of '${state.game}'.`);
            }
            this.numplayers = state.numplayers;
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): LoggerGame {
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
        this.scores = [...state.scores];
        this.protestors = [...state.protestors];
        return this;
    }

    public getSpawns(locus: string, decided: [string,string][] = []): [string, string[]][] {
        const graph = new SquareOrthGraph(5, 5);
        const spawns: [string, string[]][] = [];
        const [lx, ly] = LoggerGame.algebraic2coords(locus);
        for (let y = 0; y < 5; y++) {
            const cell = LoggerGame.coords2algebraic(lx, y);
            if (this.board.has(cell) && (this.board.get(cell) === "L" || this.board.get(cell) === "X") && (!decided.map(([l,]) => l).includes(cell))) {
                const empties: string[] = [];
                for (const n of graph.neighbours(cell)) {
                    if (! this.board.has(n) && n !== locus) {
                        empties.push(n);
                    }
                }
                if (empties.length > 0) {
                    spawns.push([cell, empties]);
                }
            }
        }
        for (let x = 0; x < 5; x++) {
            const cell = LoggerGame.coords2algebraic(x, ly);
            if (this.board.has(cell) && (this.board.get(cell) === "L" || this.board.get(cell) === "X") && (!decided.map(([l,]) => l).includes(cell))) {
                const empties: string[] = [];
                for (const n of graph.neighbours(cell)) {
                    if (! this.board.has(n) && n !== locus) {
                        empties.push(n);
                    }
                }
                if (empties.length > 0) {
                    spawns.push([cell, empties]);
                }
            }
        }
        return spawns;
    }

    public randomMove(): string {
        const currPlayerPc = [...this.board.entries()].find(([,pc]) => pc === `P${this.currplayer}`);
        if (currPlayerPc === undefined) {
            const corners = ["a1", "a5", "e1", "e5"].filter(cell => !this.board.has(cell));
            return (shuffle(corners) as string[])[0];
        } else {
            // movement
            const moves = this.getMoves(currPlayerPc[0]);
            const to = (shuffle(moves) as string[])[0];
            const partMove = `${currPlayerPc[0]}-${to}`;
            const cloned = this.clone();
            cloned.board.delete(currPlayerPc[0]);
            cloned.board.set(to, currPlayerPc[1]);

            // spawns
            const partSpawns: [string,string][] = [];
            let allSpawns = cloned.getSpawns(to);
            while (allSpawns.length > 0) {
                const [tree, plots] = allSpawns[0];
                partSpawns.push([tree, (shuffle(plots) as string[])[0]]);
                allSpawns = cloned.getSpawns(to, partSpawns);
            }

            // plant spawned saplings
            const spawned: string[] = [];
            for (const [,p] of partSpawns) {
                spawned.push(p);
                cloned.board.set(p, "S");
            }

            // grow all trees
            const graph = new SquareOrthGraph(5,5);
            const [pcx, pcy] = graph.algebraic2coords(to);
            const allTrees = (graph.listCells(false) as string[])
                // keep cells with small or medium trees
                .filter(c => cloned.board.has(c) && (cloned.board.get(c) === "S" || cloned.board.get(c) === "M"))
                // but ignore cells that were spawned this turn
                .filter(c => !spawned.includes(c))
                // convert to coords
                .map(c => graph.algebraic2coords(c))
                // only keep coordinates in the same row or col
                .filter (([tx, ty]) => tx === pcx || ty === pcy)
                // convert back to cells
                .map(coord => graph.coords2algebraic(...coord));
            for (const tree of allTrees) {
                const type = cloned.board.get(tree)!;
                if (type === "S") {
                    cloned.board.set(tree, "M");
                } else {
                    cloned.board.set(tree, "L");
                }
            }

            // action
            // first determine what actions are possible
            const possible: ("plant"|"chop"|"protest")[] = [];
            const adj = graph.neighbours(to);
            if (adj.filter(cell => !cloned.board.has(cell)).length > 0) {
                possible.push("plant");
            }
            if (adj.filter(cell => cloned.board.has(cell) && cloned.board.get(cell) === "L").length > 0) {
                possible.push("chop");
            }
            if (cloned.protestors[cloned.currplayer - 1] > 0 && [...cloned.board.values()].filter(pc => pc === "L").length > 0) {
                possible.push("protest");
            }
            let action: "plant"|"chop"|"protest"|undefined;
            if (possible.length > 0) {
                action = (shuffle(possible) as ("plant"|"chop"|"protest")[])[0];
            }

            // now finalize the action
            let partAction = "";
            if (action !== undefined) {
                if (action === "plant") {
                    const plots = adj.filter(cell => !cloned.board.has(cell));
                    partAction = `+${(shuffle(plots) as string[])[0]}`
                } else if (action === "chop") {
                    const trees = adj.filter(cell => cloned.board.has(cell) && cloned.board.get(cell) === "L");
                    partAction = `x${(shuffle(trees) as string[])[0]}`;
                } else {
                    const trees = adj.filter(cell => cloned.board.has(cell) && cloned.board.get(cell) === "L");
                    partAction = `*${(shuffle(trees) as string[])[0]}`;
                }
            }
            return [partMove, partSpawns.map(([t,p]) => `${t}+${p}`).join(","), partAction].join(";");
        }
    }

    private getMode(move: string): "place"|"move"|"spawn"|"act" {
        if (move === undefined) {
            move = "";
        }
        const [mv, spawn,] = move.split(/\s*;\s*/);
        const currPlayerPc = [...this.board.entries()].find(([,pc]) => pc === `P${this.currplayer}`);
        // determine mode
        if (mv === undefined || mv.length <= 2) {
            if (currPlayerPc === undefined) {
                return "place";
            } else {
                return "move";
            }
        } else {
            const [,locus] = mv.split("-");
            const decided: [string,string][] = [];
            if (spawn !== undefined && spawn.length > 0) {
                for (const choice of spawn.split(/\s*,\s*/)) {
                    const [l,r] = choice.split("+");
                    // if the last node is a partial, abort
                    if (r === undefined) { break; }
                    decided.push([l,r]);
                }
            }
            const cloned = this.clone();
            cloned.board.delete(currPlayerPc![0]);
            cloned.board.set(locus, currPlayerPc![1]);
            // add all spawned trees
            for (const [,p] of decided) {
                cloned.board.set(p, "S");
            }
            const spawns = cloned.getSpawns(locus, decided);
            if (spawns.length === 0) {
                return "act"
            } else {
                return "spawn";
            }
        }
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            if (move === undefined) {
                move = "";
            }
            let newmove = "";
            let cell = "";
            if (row >= 0 && col >= 0) {
                cell = LoggerGame.coords2algebraic(col, row);
            }

            const mode = this.getMode(move);
            let [mv, spawn, act] = move.split(/\s*;\s*/);
            if (spawn === undefined) {
                spawn = "";
            }
            const currPlayerPc = [...this.board.entries()].find(([,pc]) => pc === `P${this.currplayer}`);
            if (mode === "place") {
                newmove = cell;
            } else if (mode === "move") {
                newmove = `${currPlayerPc![0]}-${cell}`;
            } else if (mode === "spawn") {
                let decided = spawn.split(/\s*,\s*/);
                if (decided.length > 0 && decided[0] !== "") {
                    // is the last decision a partial
                    if (decided[decided.length - 1].length === 2) {
                        decided[decided.length - 1] += `+${cell}`;
                    } else {
                        const [,to] = mv.split("-");
                        const cloned = this.clone();
                        cloned.board.delete(currPlayerPc![0]);
                        cloned.board.set(to, currPlayerPc![1]);
                        const spawns = cloned.getSpawns(to);
                        const match = spawns.find(([c,]) => c === cell);
                        if (match !== undefined && match[1].length === 1) {
                            decided.push(`${cell}+${match[1][0]}`);
                        } else {
                            decided.push(cell);
                        }
                    }
                } else {
                    decided = [cell];
                }
                newmove = `${mv};${decided.join(",")}`
            } else {
                if (act === undefined || act === "") {
                    if (row === -1) {
                        newmove = `${mv};${spawn};*`;
                    } else if (this.board.has(cell) && this.board.get(cell) !== `P${this.currplayer}`) {
                        newmove = `${mv};${spawn};x${cell}`;
                    } else {
                        newmove = `${mv};${spawn};+${cell}`;
                    }
                } else {
                    if (act.startsWith("*")) {
                        const protests = act.split(/\s*,\s*/);
                        if (row === -1) {
                            protests.push("*");
                        } else {
                            protests[protests.length - 1] = `*${cell}`;
                        }
                        newmove = `${mv};${spawn};${protests.join(",")}`;
                    } else {
                        newmove = move;
                    }
                }
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
                message: i18next.t("apgames:validation._general.GENERIC", {move, row, col, piece, emessage: (e as Error).message})
            }
        }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        const mode = this.getMode(m);
        const grid = new SquareOrthGraph(5, 5);

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.logger.INITIAL_INSTRUCTIONS", {context: mode})
            return result;
        }

        // placements
        if (mode === "place") {
            // must be corner
            if (!["a1", "a5", "e1", "e5"].includes(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.logger.PLACE_CORNER")
                return result;
            } else {
                // Looks good
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
        } else {
            const [mv, spawn, act] = m.split(/\s*;\s*/);
            const currPlayerPc = [...this.board.entries()].find(([,pc]) => pc === `P${this.currplayer}`)!;
            const moves = this.getMoves(currPlayerPc[0]);
            const [, to] = mv.split("-");
            if (!moves.includes(to)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.logger.INVALID_TO")
                return result;
            }
            const cloned = this.clone();
            cloned.board.delete(currPlayerPc[0]);
            cloned.board.set(to, currPlayerPc[1]);
            let spawnsFound = cloned.getSpawns(to);
            let decided: [string,string][] = [];
            if (spawn !== undefined && spawn.length > 0) {
                decided = spawn.split(/\s*,\s*/).map(str => str.split("+", 2) as [string,string])
            }
            if (decided.length > spawnsFound.length) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.logger.TOO_MANY_SPAWNS", {spawns: spawnsFound.length, decisions: decided.length})
                return result;
            }
            const trees = new Set<string>();
            const plots = new Set<string>();
            for (const [tree, plot] of decided) {
                // if partial, then, then return
                if (plot === undefined || plot.length === 0) {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.logger.PARTIAL_SPAWN", {context: "incomplete", tree});
                    return result;
                }

                if (trees.has(tree) || plots.has(plot)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.logger.DUPE_SPAWN", {tree, plot})
                    return result;
                }
                const mSpawn = spawnsFound.find(([t,]) => t === tree);
                if (mSpawn === undefined) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.logger.INVALID_SPAWN", {context: "tree", tree})
                    return result;
                }
                if (!mSpawn[1].includes(plot)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.logger.INVALID_SPAWN", {context: "plot", tree, plot})
                    return result;
                }
                trees.add(tree);
                plots.add(plot);

                // prune any spawns that also contain this plot
                let idx = spawnsFound.findIndex(([t,p]) => t !== tree && p.includes(plot));
                while (idx !== -1) {
                    spawnsFound[idx][1] = spawnsFound[idx][1].filter(x => x !== plot);
                    spawnsFound = spawnsFound.filter(([,ps]) => ps.length > 0);
                    idx = spawnsFound.findIndex(([t,p]) => t !== tree && p.includes(plot));
                }
            }

            // if the number of assignments is less than the number of spawns found, incomplete
            if (trees.size === plots.size && trees.size < spawnsFound.length) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.logger.PARTIAL_SPAWN", {context: "complete"});
                return result;
            }

            // now plant the new trees before the next step
            for (const plot of plots) {
                cloned.board.set(plot, "S");
            }

            // now grow all the trees
            const graph = new SquareOrthGraph(5,5);
            const [pcx, pcy] = graph.algebraic2coords(to);
            const allTrees = (graph.listCells(false) as string[])
                // keep cells with small or medium trees
                .filter(c => this.board.has(c) && (this.board.get(c) === "S" || this.board.get(c) === "M"))
                // but ignore cells that were spawned this turn
                .filter(c => !plots.has(c))
                // convert to coords
                .map(c => graph.algebraic2coords(c))
                // only keep coordinates in the same row or col
                .filter (([tx, ty]) => tx === pcx || ty === pcy)
                // convert back to cells
                .map(coord => graph.coords2algebraic(...coord));
            for (const tree of allTrees) {
                const type = cloned.board.get(tree)!;
                if (type === "S") {
                    cloned.board.set(tree, "M");
                } else {
                    cloned.board.set(tree, "L");
                }
            }

            // if no action, return incomplete
            if (act === undefined || act.length === 0) {
                const canPlant = grid.neighbours(to).filter(c => !cloned.board.has(c)).length > 0;
                const canChop = grid.neighbours(to).filter(c => cloned.board.has(c) && cloned.board.get(c) === "L").length > 0;
                const matureTrees = [...cloned.board.values()].filter(pc => pc === "L").length;
                const canProtest = matureTrees > 0 && cloned.protestors[this.currplayer - 1] > 0

                // if you *can* act, you must
                if (canPlant || canChop || canProtest) {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.logger.ACT");
                    return result;
                } else {
                    // the move is complete, which is rare, but can happen
                    result.valid = true;
                    result.complete = 1;
                    result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                    return result;
                }
            }

            // planting
            if (act.startsWith("+")) {
                const cell = act.substring(1);
                // adjacent to logger and empty
                if (!grid.neighbours(to).includes(cell) || cloned.board.has(cell)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.logger.INVALID_PLANT", {cell})
                    return result;
                }
            }
            // chopping
            else if (act.startsWith("x")) {
                const cell = act.substring(1);
                // adjacent to logger and unprotested mature tree
                if (!grid.neighbours(to).includes(cell) || !cloned.board.has(cell) || cloned.board.get(cell) !== "L") {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.logger.INVALID_CHOP", {cell})
                    return result;
                }
            }
            // protesting
            else {
                const protests = act.split(/\s*,\s*/);
                const protested = new Set<string>();
                for (const str of protests) {
                    if (str === "*") {
                        result.valid = true;
                        result.complete = -1;
                        result.canrender = true;
                        result.message = i18next.t("apgames:validation.logger.PARTIAL_PROTEST");
                        return result;
                    }
                    const tree = str.substring(1);
                    if (protested.has(tree)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.logger.DUPE_PROTEST", {tree})
                        return result;
                    }
                    protested.add(tree);
                    if (!cloned.board.has(tree) || cloned.board.get(tree) !== "L") {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.logger.INVALID_PROTEST", {tree})
                        return result;
                    }
                }
                if (protested.size > cloned.protestors[this.currplayer - 1]) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.logger.TOO_MANY_PROTESTS")
                    return result;
                }

                // apply protests
                for (const tree of protested) {
                    cloned.board.set(tree, "X");
                    cloned.protestors[cloned.currplayer - 1]--;
                }

                // as long as you have protestors in your supply and trees you can place them on,
                // then the move will never be marked as complete
                if (cloned.protestors[this.currplayer - 1] > 0 && [...cloned.board.values()].filter(x => x === "L").length > 0) {
                    result.valid = true;
                    result.complete = 0;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                    return result;
                }
            }

            // if we make it here, we're good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
    }

    private getMoves(cell: string): string[] {
        const moves = new Set<string>([cell]);
        const graph = new SquareOrthGraph(5,5);
        for (let i = 0; i < 2; i++) {
            for (const start of [...moves]) {
                for (const adj of graph.neighbours(start).filter(c => !this.board.has(c))) {
                    moves.add(adj)
                }
            }
        }
        return [...moves];
    }

    public move(m: string, {trusted = false, partial = false} = {}): LoggerGame {
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
        this.highlights = [];
        const mode = this.getMode(m);
        const [mv, spawn, act] = m.split(/\s*;\s*/);
        const currPlayerPc = [...this.board.entries()].find(([,pc]) => pc === `P${this.currplayer}`)!;

        // placement
        if (mode === "place") {
            if (mv.length > 0) {
                this.board.set(mv, `P${this.currplayer}`);
                this.results.push({type: "place", what: "logger", where: mv});
            }
        } else {
            const [,to] = mv.split("-");
            if (to !== undefined && to.length > 0) {
                this.board.delete(currPlayerPc[0]);
                this.board.set(to, currPlayerPc[1]);
                this.results.push({type: "move", from: currPlayerPc[0], to});

                // spawning
                let decisions: [string,string][] = [];
                if (spawn !== undefined && spawn.length > 0) {
                    decisions = spawn.split(/\s*,\s*/).map(str => str.split("+", 2) as [string,string]);
                    for (const [tree, plot] of decisions) {
                        if (plot !== undefined && plot.length > 0) {
                            this.board.set(plot, "S");
                            this.results.push({type: "place", what: "spawn", where: plot});
                        } else {
                            this.highlights = new SquareOrthGraph(5,5).neighbours(tree).filter(c => !this.board.has(c));
                        }
                    }
                }
                // only highlight remaining spawns if the last decision was complete
                if (this.highlights.length === 0) {
                    const allSpawns = this.getSpawns(to, decisions);
                    if (allSpawns.length > 0) {
                        this.highlights = allSpawns.map(([t,]) => t);
                    }
                }

                // if all spawning is done, grow all the non-spawned trees
                if (this.highlights.length === 0) {
                    const spawned = decisions.map(([,p]) => p);
                    const graph = new SquareOrthGraph(5,5);
                    const [pcx, pcy] = graph.algebraic2coords(to);
                    const trees = (graph.listCells(false) as string[])
                        // keep cells with small or medium trees
                        .filter(c => this.board.has(c) && (this.board.get(c) === "S" || this.board.get(c) === "M"))
                        // but ignore cells that were spawned this turn
                        .filter(c => !spawned.includes(c))
                        // convert to coords
                        .map(c => graph.algebraic2coords(c))
                        // only keep coordinates in the same row or col
                        .filter (([tx, ty]) => tx === pcx || ty === pcy)
                        // convert back to cells
                        .map(coord => graph.coords2algebraic(...coord));
                    for (const tree of trees) {
                        const type = this.board.get(tree)!;
                        if (type === "S") {
                            this.board.set(tree, "M");
                        } else {
                            this.board.set(tree, "L");
                        }
                        this.results.push({type: "add", where: tree});
                    }
                }

                // actions
                if (act !== undefined && act.length > 0) {
                    // planting
                    if (act.startsWith("+")) {
                        const cell = act.substring(1);
                        this.board.set(cell, "S");
                        this.results.push({type: "place", what: "plant", where: cell});
                    }
                    // chopping
                    else if (act.startsWith("x")) {
                        const cell = act.substring(1);
                        const grid = new RectGrid(5,5);
                        const graph = new SquareOrthGraph(5,5);
                        const [lx,ly] = graph.algebraic2coords(to);
                        const [tx,ty] = graph.algebraic2coords(cell);
                        const bearing = RectGrid.bearing(lx, ly, tx, ty)!;
                        const ray = grid.ray(tx, ty, bearing).map(coord => graph.coords2algebraic(...coord));
                        let stop = ray.findIndex(c => !this.board.has(c) || (this.board.get(c) !== "L") && (this.board.get(c) !== "X") );
                        if (stop === -1) {
                            stop = ray.length;
                        }
                        const dominos = ray.slice(0, stop);
                        let pts = 0;
                        for (const chop of [cell, ...dominos]) {
                            const type = this.board.get(chop);
                            this.board.delete(chop);
                            pts++;
                            this.results.push({type: "destroy", where: chop});
                            if (type === "X") {
                                this.protestors[this.currplayer - 1]++;
                                this.results.push({type: "claim", where: chop});
                            }
                        }
                        if (pts > 0) {
                            this.scores[this.currplayer - 1] += pts;
                            this.results.push({type: "deltaScore", delta: pts});
                        }
                    }
                    // protesting
                    else {
                        for (const protest of act.split(/\s*,\s*/)) {
                            const cell = protest.substring(1);
                            this.board.set(cell, "X");
                            this.protestors[this.currplayer - 1]--;
                            this.results.push({type: "block", where: cell});
                        }
                    }
                }
            } else {
                this.highlights = this.getMoves(currPlayerPc[0]);
            }
        }

        if (partial) { return this; }

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

    protected checkEOG(): LoggerGame {
        // game can only end if it's the first player's turn
        if (this.currplayer === 1) {
            // someone must also have at least 10 points
            const maxPts = Math.max(...this.scores);
            if (maxPts >= 10) {
                this.gameover = true;
                this.winner = [];
                for (let i = 0; i < this.numplayers; i++) {
                    if (this.scores[i] === maxPts) {
                        this.winner.push(i+1 as playerid);
                    }
                }
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

    public state(): ILoggerState {
        return {
            game: LoggerGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: LoggerGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: clone(this.board) as Map<string, CellContents>,
            scores: [...this.scores],
            protestors: [...this.protestors],
        };
    }

    public render({perspective}: IRenderOpts = {perspective: undefined}): APRenderRep {
        // Build piece object
        const pieces: string[][][] = [];
        const graph = new SquareOrthGraph(5,5);
        for (let row = 0; row < 5; row++) {
            const rownode: string[][] = [];
            for (let col = 0; col < 5; col++) {
                const cellnode: string[] = [];
                const cell = graph.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const pc = this.board.get(cell)!;
                    switch (pc) {
                        case "P1":
                            cellnode.push("A");
                            break;
                        case "P2":
                            cellnode.push("B");
                            break;
                        case "P3":
                            cellnode.push("C");
                            break;
                        case "P4":
                            cellnode.push("D");
                            break;
                        case "S":
                            cellnode.push("G1");
                            break;
                        case "M":
                            cellnode.push("G1");
                            cellnode.push("G2");
                            break;
                        case "L":
                            cellnode.push("G1");
                            cellnode.push("G2");
                            cellnode.push("G3");
                            break;
                        case "X":
                            cellnode.push("G1");
                            cellnode.push("G2");
                            cellnode.push("G3");
                            cellnode.push("X");
                            break;
                    }
                }
                rownode.push(cellnode);
            }
            pieces.push(rownode);
        }

        const myLegend: ILegendObj = {
            "X": {
                "name": "pyramid-up-small-3D",
                "colour": "#000"
            },
            "G1": {
                "name": "pyramid-up-small-3D",
                "colour": 3
            },
            "G2": {
                "name": "pyramid-up-medium-3D",
                "colour": 3
            },
            "G3": {
                "name": "pyramid-up-large-3D",
                "colour": 3
            },
            "A": {
                "name": "piece",
                "colour": 1,
                "scale": 0.5,
            },
            "B": {
                "name": "piece",
                "colour": 2,
                "scale": 0.5,
            },
            "C": {
                "name": "piece",
                "colour": 4,
                "scale": 0.5,
            },
            "D": {
                "name": "piece",
                "colour": 5,
                "scale": 0.5,
            }
        };

        const areas: AreaPieces[] = [];
        for (let p = 1; p <= this.numplayers; p++) {
            const pcs: string[] = [];
            for (let i = 0; i < this.protestors[p-1]; i++) {
                pcs.push("X");
            }
            if (pcs.length > 0) {
                areas.push({
                    type: "pieces",
                    pieces: pcs as [string, ...string[]],
                    label: i18next.t("apgames:validation.logger.PROTESTOR_LABEL", {playerNum: p}) || "local"
                });
            }
        }

        // Build rep
        const rep: APRenderRep =  {
            renderer: "stacking-3D",
            board: {
                style: "squares",
                width: 5,
                height: 5
            },
            legend: myLegend,
            pieces: pieces as [string[][], ...string[][][]],
            areas,
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place" || move.type === "block") {
                    const [toX, toY] = LoggerGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: toY, col: toX}]});
                } else if (move.type === "destroy") {
                    const [toX, toY] = LoggerGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: toY, col: toX}]});
                } else if (move.type === "move") {
                    if (move.from !== move.to) {
                        const [fromX, fromY] = LoggerGame.algebraic2coords(move.from);
                        const [toX, toY] = LoggerGame.algebraic2coords(move.to);
                        rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                    }
                }
            }
            if (rep.annotations.length === 0) {
                delete rep.annotations;
            }
        }

        // add highlighting
        if (this.highlights.length > 0) {
            rep.annotations = [];
            for (const cell of this.highlights) {
                const [toX, toY] = LoggerGame.algebraic2coords(cell);
                rep.annotations.push({type: "enter", targets: [{row: toY, col: toX}], colour: this.currplayer});
            }
        }
        // only proactively show placement options for currplayer
        else if (perspective !== undefined && perspective === this.currplayer && [...this.board.values()].find(pc => pc === `P${this.currplayer}`) === undefined) {
            if (! ("annotations" in rep)) {
                rep.annotations = [];
            }
            const corners = ["a1", "a5", "e1", "e5"].filter(c => !this.board.has(c));
            for (const cell of corners) {
                const [toX, toY] = LoggerGame.algebraic2coords(cell);
                rep.annotations!.push({type: "enter", targets: [{row: toY, col: toX}], colour: this.currplayer});
            }
        }
        // only proactively show movement options for currplayer
        else if (perspective !== undefined && perspective === this.currplayer && this.getMode("") === "move") {
            if (! ("annotations" in rep)) {
                rep.annotations = [];
            }
            const pc = [...this.board.keys()].find(c => this.board.has(c) && this.board.get(c) === `P${this.currplayer}`);
            if (pc !== undefined) {
                const moves = this.getMoves(pc);
                for (const cell of moves) {
                    const [toX, toY] = LoggerGame.algebraic2coords(cell);
                    rep.annotations!.push({type: "enter", targets: [{row: toY, col: toX}], colour: this.currplayer});
                }
            }
        }

        return rep;
    }

    public status(): string {
        let status = super.status();

        status += "**Scores**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const score = this.scores[n - 1];
            status += `Player ${n}: ${score}\n\n`;
        }

        status += "**Protestors**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const score = this.protestors[n - 1];
            status += `Player ${n}: ${score}\n\n`;
        }

        return status;
    }

    public getPlayerScore(player: number): number | undefined {
        return this.scores[player - 1];
    }

    public getPlayersScores(): IScores[] {
        return [{ name: i18next.t("apgames:status.SCORES"), scores: this.scores}];
    }

    protected getMoveList(): any[] {
        return this.getMovesAndResults(["move", "place", "destroy", "add", "winners", "eog", "deltaScore"]);
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        // move, place, destroy, claim, deltaScore
        if (r.type === "move") {
            node.push(i18next.t("apresults:MOVE.nowhat", {player, from: r.from, to: r.to}));
            return true;
        }
        else if (r.type === "place") {
            // logger, spawn, plant
            if (r.what === "logger") {
                node.push(i18next.t("apresults:PLACE.logger", {context: r.what, player, where: r.where}));
                return true;
            } else if (r.what === "spawn") {
                node.push(i18next.t("apresults:PLACE.logger", {context: r.what, player, where: r.where}));
                return true;
            } else if (r.what === "plant") {
                node.push(i18next.t("apresults:PLACE.logger", {context: r.what, player, where: r.where}));
                return true;
            }
        } else if (r.type === "add") {
            node.push(i18next.t("apresults:ADD.logger", {where: r.where}));
            return true;
        } else if (r.type === "destroy") {
            node.push(i18next.t("apresults:DESTROY.logger", {player, where: r.where}));
            return true;
        } else if (r.type === "claim") {
            node.push(i18next.t("apresults:CLAIM.logger", {player, where: r.where}));
            return true;
        } else if (r.type === "deltaScore") {
            node.push(i18next.t("apresults:DELTA_SCORE_GAIN", {count: r.delta, delta: r.delta, player}));
            return true;
        }
        return false;
    }

    public clone(): LoggerGame {
        return Object.assign(new LoggerGame(this.numplayers), clone(this) as LoggerGame);
    }
}
