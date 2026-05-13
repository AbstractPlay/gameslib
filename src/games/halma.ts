import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, RowCol, Colourfuncs } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { allDirections, reviver, UserFacingError, SquareGraph, Direction } from "../common";
import i18next from "i18next";

export type playerid = 1 |2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface IHalmaState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class HalmaGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Halma",
        uid: "halma",
        playercounts: [2],
        version: "20260513",
        dateAdded: "2026-05-13",
        // i18next.t("apgames:descriptions.halma")
        description: "apgames:descriptions.halma",
        // i18next.t("apgames:notes.halma")
        notes: "apgames:notes.halma",
        urls: [
            "https://en.wikipedia.org/wiki/Halma",
            "https://boardgamegeek.com/boardgame/38950/halma",
            "https://www.abstractgames.org/uploads/1/1/6/4/116462923/abstract_games_issue_15.pdf#page=11",
            "https://blackandwhite.develz.org/games/SuperHalma.pdf",
        ],
        people: [
            {
                type: "designer",
                name: "George Howard Monks",
                urls: ["https://en.wikipedia.org/wiki/George_Howard_Monks"],
            },
            {
                type: "coder",
                name: "João Pedro Neto",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3829/joao-pedro-neto"],
                apid: "9228bccd-a1bd-452b-b94f-d05380e6638f",
            },
        ],
        variants: [
            { uid: "#board", },
            { uid: "superhalma", group: "ruleset" },
        ],
        categories: ["goal>evacuate", "other>traditional", "mechanic>move", "board>shape>rect", "components>simple>1per", "other>2+players"],
        flags: ["no-moves", "experimental"]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private dots: string[] = [];
    private ruleset: "default" | "superhalma";

    constructor(state: IHalmaState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if ( (variants !== undefined) && (variants.length > 0) ) {
                this.variants = [...variants];
            }

            const board = new Map<string, playerid>([
                ["p1", 1], ["p2", 1], ["p3", 1], ["p4", 1], ["p5", 1],
                ["o1", 1], ["o2", 1], ["o3", 1], ["o4", 1], ["o5", 1],
                ["n1", 1], ["n2", 1], ["n3", 1], ["n4", 1],
                ["m1", 1], ["m2", 1], ["m3", 1],
                ["l1", 1], ["l2", 1],                                     ["e15", 2], ["e16", 2],
                                                              ["d14", 2], ["d15", 2], ["d16", 2],
                                                  ["c13", 2], ["c14", 2], ["c15", 2], ["c16", 2],
                                      ["b12", 2], ["b13", 2], ["b14", 2], ["b15", 2], ["b16", 2],
                                      ["a12", 2], ["a13", 2], ["a14", 2], ["a15", 2], ["a16", 2],
            ]);

            const fresh: IMoveState = {
                _version: HalmaGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IHalmaState;
            }
            if (state.game !== HalmaGame.gameinfo.uid) {
                throw new Error(`The Halma engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
        this.ruleset = this.getRuleset();
    }

    public load(idx = -1): HalmaGame {
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
        return 16;
    }

    public get graph(): SquareGraph {
        return new SquareGraph(this.boardsize, this.boardsize);
    }

    private getRuleset(): "default" | "superhalma" {
        if (this.variants.includes("superhalma"))   { return "superhalma"; }
        return "default";
    }

    private homeBase(player?: playerid): string[] {
        if (player === undefined) { player = this.currplayer; }
        return player === 1 ?
               ["p1", "p2", "p3", "p4", "p5", "o1", "o2", "o3", "o4", "o5",
                "n1", "n2", "n3", "n4", "m1", "m2", "m3", "l1", "l2"] :
               ["a12", "a13", "a14", "a15", "a16", "b12", "b13", "b14", "b15", "b16",
                "c13", "c14", "c15", "c16", "d14", "d15", "d16", "e15", "e16"];
    }

    private enemyBase(player?: playerid): string[] {
        if (player === undefined) { player = this.currplayer; }
        return this.homeBase(player % 2 + 1 as playerid);
    }

    // Check the base movement's requirements:
    // * No stone inside the opponent's home-base can leave again
    // * No stone can return to his home-base.
    private respectBases(start: string, end: string): boolean {
        if (!this.homeBase().includes(start) && this.homeBase().includes(end)) {
            return false;
        }
        if (this.enemyBase().includes(start) && !this.enemyBase().includes(end)) {
            return false;
        }
        return true
    }

    private jumpNeighbors(cell: string): string[] {
        if (this.ruleset === "superhalma") {
            return this.jumpNeighborsSuperHalma(cell);
        } else {
            return this.jumpNeighborsHalma(cell);
        }
    }

    private jumpNeighborsHalma(cell: string): string[] {
        const res: string[] = [];
        const g = this.graph;
        const [x, y] = g.algebraic2coords(cell);

        for (const dir of allDirections) {
            const ray = g.ray(x, y, dir).map(c => g.coords2algebraic(...c));
            if (ray.length >= 2) {
                if (this.board.has(ray[0]) && !this.board.has(ray[1])) {
                    if ( this.respectBases(cell, ray[1]) ) {
                        res.push(ray[1]);
                    }
                }
            }
        }
        return res;
    }

    private jumpNeighborsSuperHalma(cell: string): string[] {
        const res: string[] = [];
        const g = this.graph;
        const [x, y] = g.algebraic2coords(cell);

        for (const dir of allDirections) {
            const ray = g.ray(x, y, dir).map(c => g.coords2algebraic(...c));
            if (ray.length >= 2) {
                for (let delta=0; delta<Math.floor(ray.length/2); delta++) { // consider all possible long-jumps
                    const start = cell;
                    const pivot = ray[delta];
                    const end   = ray[2*delta+1];
                    if (! this.respectBases(start, end) ) { continue; } // base movements must be respected
                    if (! this.board.has(pivot) ) { continue; } // the pivot cell must be occupied
                    if (  this.board.has(end) ) { continue; }   // the final cell must be empty
                    // all cell in-between must be empty
                    if (! ray.slice(0, delta).every(c => !this.board.has(c)) ) { continue; }
                    if (! ray.slice(delta+1, 2*delta+1).every(c => !this.board.has(c)) ) { continue; }
                    res.push(end);
                }
            }
        }
        return res;
    }

    // Any piece in a player's home-base must make progress towards the enemy camp whenever
    // this is possible by jumping over an enemy piece (Zillions' rule quoting Sid Sackson)
    // This method returns all mandatory jumps (in any)
    private mandatoryMoves(player?: playerid): string[] {
        if (player === undefined) { player = this.currplayer; }
        const g = this.graph;
        const prevplayer = player % 2 + 1 as playerid;
        const res = [];

        // select all friendly pieces from the home-base
        const base = this.homeBase(player);
        const homePieces = [...this.board.entries()].filter(e => e[1] === player)
                                                    .filter(e => base.includes(e[0]))
                                                    .map(e => e[0]);

        // check if there are neighbor opponent pieces in the forward directions
        const dirs: Direction[] = player === 1 ? ["N", "NW", "W"] : ["S", "SE", "E"];
        for (const cell of homePieces) {
            const [x, y] = g.algebraic2coords(cell);
            for (const dir of dirs) {
                const ray = g.ray(x, y, dir).map(c => g.coords2algebraic(...c));
                if (ray.length >= 2) {
                    if (this.ruleset === "superhalma") {
                        for (let delta=0; delta<Math.floor(ray.length/2); delta++) { // consider all possible long-jumps
                            const pivot = ray[delta]; // the pivot cell must be occupied by an enemy stone
                            const end   = ray[2*delta+1]; // the final cell must be empty
                            if ( !this.board.has(pivot) || this.board.get(pivot) !== prevplayer) { continue; }
                            if (  this.board.has(end) ) { continue; }
                            // all cell in-between must be empty
                            if (! ray.slice(0, delta).every(c => !this.board.has(c)) ) { continue; }
                            if (! ray.slice(delta+1, 2*delta+1).every(c => !this.board.has(c)) ) { continue; }
                            res.push(`${cell}-${end}`);
                        }
                    } else { // in the original ruleset, just check the adjacent cells
                        if (this.board.has(ray[0]) && this.board.get(ray[0]) === prevplayer && !this.board.has(ray[1])) {
                           res.push(`${cell}-${ray[1]}`);
                        }
                    }

                }
            }
        }
        return res;
    }

    private trimIfRepeated(moves: string[]): string[] {
        if (moves.length === 0) { return []; }
        const last = moves[moves.length - 1];
        const firstIndex = moves.indexOf(last);

        if (firstIndex !== moves.length - 1) { // if the last element appears earlier
            return moves.slice(0, firstIndex+1);
        }
        return moves;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const g = this.graph;
            const cell = g.coords2algebraic(col, row);
            let newmove:string;

            if (move === "" || this.board.has(cell)) {
                newmove = cell;
            } else {
                // if a cell appears again, remove all jumps after its first occurrence
                newmove = this.trimIfRepeated(`${move}-${cell}`.split("-")).join("-");
            }

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

    private hasPrefix(moves: string[], partial: string): boolean {
        return moves.some(str => str.startsWith(partial));
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.halma.INITIAL_INSTRUCTIONS")
            return result;
        }

        const mandatory = this.mandatoryMoves();
        if ( mandatory.length > 0 ) { // mandatory moves take precedence!
            if ( !this.hasPrefix(mandatory, m) && !mandatory.some(move => m.startsWith(move)) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.halma.FORCED_MOVES", {forced: mandatory});
                return result;
            }
        }

        // drop or start of move
        if (!m.includes("-")) {

            if (!this.board.has(m)) { // must be occupied
                result.valid = false;
                result.message = i18next.t("apgames:validation.halma.NONEXISTENT", {where: m});
                return result;
            }

            if (this.board.get(m)! !== this.currplayer) { // must be a friendly stone
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                return result;
            }
            // valid partial
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation._general.NEED_DESTINATION");
            return result;

        } else {

            const cells = m.split("-");
            let isJump = true;
            if ( cells.length === 2 ) {
                const g = this.graph;
                const emptyNeighbors = g.graph.neighbors(cells[0]).filter(c => !this.board.has(c));
                if ( emptyNeighbors.includes(cells[1]) ) {
                    isJump = false; // it is a move
                }
                if (! this.respectBases(cells[0], cells[1]) ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.halma.ILLEGAL_MOVE");
                    return result;
                }
            }
            if ( isJump ) {
                for (let i = 0; i < cells.length - 1; i++) {
                    const from = cells[i];
                    const to = cells[i+1];
                    if (! this.jumpNeighbors(from).includes(to) ) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.halma.BAD_MOVE", {from, to});
                        return result;
                    }
                }
                const last = cells.at(-1)!;
                const penultimate = cells.at(-2)!;
                const neighborsLast = this.jumpNeighbors(last);
                if ( (neighborsLast.length === 0) ||
                     (neighborsLast.length === 1 && neighborsLast.includes(penultimate)) ) {
                    isJump = false; // ie, this last jump is final; let's pretend it is a move to finish the sequence
                }
            }

            result.valid = true;
            result.complete = isJump ? 0 : 1; // moves are final, jumps can be multiple
            result.canrender = true;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
    }

    public move(m: string, {trusted = false, partial = false} = {}): HalmaGame {
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
        this.dots = [];

        if (m === "") { return this;}

        if (partial) { // if partial, populate dots and get out
            const mandatory = this.mandatoryMoves();
            if ( mandatory.length > 0 ) { // mandatory moves take precedence!
                if ( this.hasPrefix(mandatory, m) ) {
                    this.dots.push(...mandatory.filter(move => move.startsWith(m))
                                               .map(move => move.split('-')[1]) );
                }
                if (! mandatory.some(move => m.startsWith(move)) ) {
                    return this;
                }
            }

            const cells = m.split("-");
            // if just starting, add simple moves
            if (cells.length === 1) {
                const g = this.graph;
                this.dots.push(...g.graph.neighbors(cells[0]).filter(c => !this.board.has(c))
                                                             .filter(c => this.respectBases(m, c)));
            }
            // now add jumps
            this.dots.push(...this.jumpNeighbors(cells[cells.length - 1]));

            // go ahead and move the piece so the display updates
            this.board.delete(cells[0]);
            this.board.set(cells[cells.length - 1], this.currplayer);
            return this;
        }

        if (m.includes("-")) {
            const steps = m.split("-");
            const from = steps[0];
            const to = steps[steps.length - 1];
            this.board.delete(from);
            this.board.set(to, this.currplayer);
            for (let i = 0; i < steps.length-1; i++) {
                this.results.push({type: "move", from: steps[i], to: steps[i+1]});
            }
        } else {
            this.board.set(m, this.currplayer);
            this.results.push({type: "place", where: m});
        }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): HalmaGame {
        const prevplayer = this.currplayer % 2 + 1 as playerid;
        // a player wins if opponent's base is full and he has at least one stone there (Parlett's win condition)
        const isEnemyFull = this.enemyBase(prevplayer).every(c => this.board.has(c));
        const haveOneThere = this.enemyBase(prevplayer).some(c => this.board.has(c) && this.board.get(c) === prevplayer);

        if ( isEnemyFull && haveOneThere ) {
            this.gameover = true;
            this.winner = [prevplayer];
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IHalmaState {
        return {
            game: HalmaGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: HalmaGame.gameinfo.version,
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
        for (let row = 0; row < this.boardsize; row++) {
            if (pstr.length > 0) { pstr += "\n"; }
            const pieces: string[] = [];
            for (let col = 0; col < this.boardsize; col++) {
                const cell = g.coords2algebraic(col, row);
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

        const base: Colourfuncs = {
            func: "custom",
            default: "#FFDF00", // gold yellow
            palette: 3
        };

        const size = this.boardsize;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const markers: Array<any> = [  // shade home-bases
            {
                type: "shading",
                colour: this.getPlayerColour(1),
                points: [ {row:size  , col:size-5}, {row:size  , col:size  }, {row:size-5, col:size  },
                          {row:size-5, col:size-2}, {row:size-4, col:size-2}, {row:size-4, col:size-3},
                          {row:size-3, col:size-3}, {row:size-3, col:size-4}, {row:size-2, col:size-4},
                          {row:size-2, col:size-5}, {row:size  , col:size-5}]
            },
            {
                type: "shading",
                colour: this.getPlayerColour(2),
                points: [ {row:0, col:0}, {row:0, col:5}, {row:2, col:5}, {row:2, col:4}, {row:3, col:4},
                          {row:3, col:3}, {row:4, col:3}, {row:4, col:2}, {row:5, col:2}, {row:5, col:0},
                          {row:0, col:0}
                ]
            },
            // draw home-base frontier of player 1
            { type: "line", colour: base, points: [ {row:size  , col:size-5}, {row:size-2, col:size-5} ], width: 3, opacity: 0.5 },
            { type: "line", colour: base, points: [ {row:size-2, col:size-5}, {row:size-2, col:size-4} ], width: 3, opacity: 0.5 },
            { type: "line", colour: base, points: [ {row:size-2, col:size-4}, {row:size-3, col:size-4} ], width: 3, opacity: 0.5 },
            { type: "line", colour: base, points: [ {row:size-3, col:size-4}, {row:size-3, col:size-3} ], width: 3, opacity: 0.5 },
            { type: "line", colour: base, points: [ {row:size-3, col:size-3}, {row:size-4, col:size-3} ], width: 3, opacity: 0.5 },
            { type: "line", colour: base, points: [ {row:size-4, col:size-3}, {row:size-4, col:size-2} ], width: 3, opacity: 0.5 },
            { type: "line", colour: base, points: [ {row:size-4, col:size-2}, {row:size-5, col:size-2} ], width: 3, opacity: 0.5 },
            { type: "line", colour: base, points: [ {row:size-5, col:size-2}, {row:size-5, col:size  } ], width: 3, opacity: 0.5 },
            // draw home-base frontier of player 2
            { type: "line", colour: base, points: [ {row:0, col:5},           {row:2, col:5} ],           width: 3, opacity: 0.5 },
            { type: "line", colour: base, points: [ {row:2, col:5},           {row:2, col:4} ],           width: 3, opacity: 0.5 },
            { type: "line", colour: base, points: [ {row:2, col:4},           {row:3, col:4} ],           width: 3, opacity: 0.5 },
            { type: "line", colour: base, points: [ {row:3, col:4},           {row:3, col:3} ],           width: 3, opacity: 0.5 },
            { type: "line", colour: base, points: [ {row:3, col:3},           {row:4, col:3} ],           width: 3, opacity: 0.5 },
            { type: "line", colour: base, points: [ {row:4, col:3},           {row:4, col:2} ],           width: 3, opacity: 0.5 },
            { type: "line", colour: base, points: [ {row:4, col:2},           {row:5, col:2} ],           width: 3, opacity: 0.5 },
            { type: "line", colour: base, points: [ {row:5, col:2},           {row:5, col:0} ],           width: 3, opacity: 0.5 },
        ];

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-checkered",
                width: this.boardsize,
                height: this.boardsize,
                markers,
            },
            legend: {
                A: { name: "piece", colour: this.getPlayerColour(1) },
                B: { name: "piece", colour: this.getPlayerColour(2) },
            },
            pieces: pstr
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = g.algebraic2coords(move.from);
                    const [toX, toY] = g.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "place") {
                    const [x, y] = g.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }

        if (this.dots.length > 0) {
            if (!("annotations" in rep) || rep.annotations === undefined) {
                rep.annotations = [];
            }
            rep.annotations.push({
                type: "dots",
                targets: this.dots.map(cell => {
                    const [x, y] = g.algebraic2coords(cell);
                    return {row: y, col: x};
                }) as [RowCol, ...RowCol[]],
            });
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

    public clone(): HalmaGame {
        return new HalmaGame(this.serialize());
    }
}
