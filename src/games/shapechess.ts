import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult, IScores } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import { SquareGraph } from "../common/graphs";
import { connectedComponents } from 'graphology-components';
import i18next from "i18next";

export type playerid = 1 | 2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
    scores: [number, number];
};

export interface IShapeChessState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class ShapeChessGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Shape Chess",
        uid: "shapechess",
        playercounts: [2],
        version: "20260430",
        dateAdded: "2026-04-30",
        // i18next.t("apgames:descriptions.shapechess")
        description: "apgames:descriptions.shapechess",
        urls: [
            "https://boardgamegeek.com/boardgame/367618",
        ],
        people: [
            {
                type: "designer",
                name: "Richu"
            },
            {
                type: "coder",
                name: "João Pedro Neto",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3829/joao-pedro-neto"],
                apid: "9228bccd-a1bd-452b-b94f-d05380e6638f",
            },
        ],
        categories: ["goal>score>eog", "mechanic>place",  "board>shape>rect", "components>simple>1per"],
        variants: [
            { uid: "size-10", group: "board" },
            { uid: "#board", }, // 12x12
            { uid: "size-14", group: "board" },
            { uid: "size-16", group: "board" },
            { uid: "size-18", group: "board" },
            { uid: "5-pts",   group: "ruleset" },
            { uid: "6-pts",   group: "ruleset" },
            { uid: "7-pts",   group: "ruleset" },
            { uid: "8-pts",   group: "ruleset" },
            { uid: "9-pts",   group: "ruleset" },
        ],
        flags: ["scores", "no-moves", "experimental"],
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public scores: [number, number] = [0, 0];
    public boardSize = 12;
    private _points: [number, number][] = []; // if there are points here, the renderer will show them
    private _symmetryLine: number[][][] = []; // 1+ captures, each capture is defined by a line [[x0,y0],[x1,y1]]
    private _hadCaptures: boolean = false;    // true if captures already occurred in this turn
    private ruleset: "default" | "5-pts" | "6-pts" | "7-pts" | "8-pts" | "9-pts";

    constructor(state?: IShapeChessState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: ShapeChessGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map<string,playerid>(),
                scores: [0, 0],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IShapeChessState;
            }
            if (state.game !== ShapeChessGame.gameinfo.uid) {
                throw new Error(`The ShapeChess engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
        this.ruleset = this.getRuleset();
    }

    public load(idx = -1): ShapeChessGame {
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
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.lastmove = state.lastmove;
        this.results = [...state._results];
        this.scores = [...state.scores];
        this.boardSize = this.getBoardSize();
        return this;
    }

    private coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardSize);
    }

    private algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardSize);
    }

    private getGraph(): SquareGraph {
        return new SquareGraph(this.boardSize, this.boardSize);
    }

    private getBoardSize(): number {
        // Get board size from variants.
        if ( (this.variants !== undefined) && (this.variants.length > 0) && (this.variants[0] !== undefined) && (this.variants[0].length > 0) ) {
            const sizeVariants = this.variants.filter(v => v.includes("size"));
            if (sizeVariants.length > 0) {
                const size = sizeVariants[0].match(/\d+/);
                return parseInt(size![0], 10);
            }
            if (isNaN(this.boardSize)) {
                throw new Error(`Could not determine the board size from variant "${this.variants[0]}"`);
            }
        }
        return 12;
    }

    private getRuleset(): "default" | "5-pts" | "6-pts" | "7-pts" | "8-pts" | "9-pts" {
        if (this.variants.includes("5-pts")) { return "5-pts"; }
        if (this.variants.includes("6-pts")) { return "6-pts"; }
        if (this.variants.includes("7-pts")) { return "7-pts"; }
        if (this.variants.includes("8-pts")) { return "8-pts"; }
        if (this.variants.includes("9-pts")) { return "9-pts"; }
        return "default";
    }

    public moves(): string[] {
        return [];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.coords2algebraic(col, row);
            let newmove = "";

            if (move === "") {
                newmove = cell;
            } else {
                // an action might be 'cell' or 'cell-cell1'
                // a move is 1+ actions divided by commas, eg: a1,b1-c1,d2
                // a new action is only possible if the previous move resulted in a capture
                if ( this.hadCaptures(move.split(',').at(-1)!) ) { // a new action begins
                    newmove = `${move},${cell}`;
                } else { // it is the finishing of the current action
                    const actions: string[] = move.split(',');
                    if ( actions.at(-1) === cell ) { // if cell (of the current action) is reclicked, reset action
                        newmove = actions.slice(0,-1).join(',');
                    } else {
                        newmove = `${move}-${cell}`;
                    }
                }
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

    private emptyNeighbors(cell: string): string[] {
        return this.getGraph()
                   .neighbours(cell)
                   .filter(c => !this.board.has(c));
    }

    private hadCaptures(moves: string) {
        const cloned = this.clone();
        cloned.move(moves, {trusted: true, partial: true}); // simulate the move execution
        return cloned._hadCaptures;
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false,
                                           message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        if ( m.length === 0 ) {
            result.valid = true;
            result.canrender = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.shapechess.INITIAL_INSTRUCTIONS");
            return result;
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        // let's execute all previous moves on a clone, which were already validated
        // this is necessary, given that some cells might become empty
        const cloned = this.clone();
        const actions = m.split(',');
        cloned.move(actions.slice(0,-1).join(',')); // execute all but the last

        const moves = actions.at(-1)!.split("-"); // let's validate the last action
        if ( moves.length === 1 ) {
            result.valid = true;
            result.canrender = true;
            result.complete = -1;
            if (! cloned.board.has(moves[0]) ) {
                // if placed on an empty cell, this is a complete move
                result.complete = cloned.hadCaptures(m.split(',').at(-1)!) ? -1 : 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            } else if ( cloned.board.get(moves[0])! === this.currplayer ) {
                // or if placing over a friendly stone, this is a jump
                result.message = i18next.t("apgames:validation.shapechess.JUMP_INSTRUCTIONS");
            } else {
                // otherwise it is over an adversary stone, which is a push
                if ( cloned.emptyNeighbors(moves[0]).length === 0 ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.shapechess.PUSH_NO_FREEDOM");
                    return result;
                }
                result.message = i18next.t("apgames:validation.shapechess.PUSH_INSTRUCTIONS");
            }
            return result;
        }

        // reaching here, it is either a jump or a push

        if ( cloned.board.get(moves[0])! === this.currplayer ) { // so, we have a complete jump
            if ( cloned.board.has(moves[1]) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.shapechess.JUMP_OCCUPIED");
                return result;
            }
        }

        if ( cloned.board.get(moves[0])! !== this.currplayer ) { // so, we have a complete push
            if (! cloned.emptyNeighbors(moves[0]).includes(moves[1]) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.shapechess.PUSH_NEIGHBOR");
                return result;
            }
        }

        result.valid = true;
        result.complete = this.hadCaptures(m.split(',').at(-1)!) ? -1 : 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    // get all groups from a given player, with at least size 'minsize'
    private getGroups(p: playerid, minsize = 6): string[][] {
        const piecesOwned   = [...this.board.entries()].filter(e => e[1] === p).map(e => e[0]);

        // get groups of owned pieces (just owned pieces, no empty spaces)
        const gOwned = this.getGraph();
        for (const node of gOwned.graph.nodes()) {
            if (! piecesOwned.includes(node)) {
                gOwned.graph.dropNode(node);
            }
        }
        const groupsOwned = connectedComponents(gOwned.graph);
        return groupsOwned.filter(gp => gp.length >= minsize);
    }

    // returns the reflection of p over line (given by the coefs of equation ax+by + c == 0)
    private reflect(p: [number, number], line: [number, number, number]): [number, number] {
        const [x, y] = p;
        const [a, b, c] = line;

        const denom = a * a + b * b;
        if (denom === 0) { throw new Error("Invalid line: a and b cannot both be zero"); }

        const factor = 2 * (a * x + b * y + c) / denom;
        return [x - a * factor, y - b * factor];
    }

    // returns the line of symmetry of the given group, or [] if none exists
    // the output will be [a,b,c] defining the line equation ax+by + c == 0
    private computeSymmetry(group: string[]): number[] {
        const points = group.map(c => this.algebraic2coords(c));
        if (points.length === 0) { return []; }
        const descriptions: string[] = points.map(p => `${p[0]},${p[1]}`);
        const pointSet = new Set<string>(descriptions);

        // compute group's centroid
        const centerX = points.reduce((sum, p) => sum + p[0], 0) / points.length;
        const centerY = points.reduce((sum, p) => sum + p[1], 0) / points.length;

        const candidates = [
            { coefs: [1, 0, -centerX] }, // vertical line
            { coefs: [0, 1, -centerY] }, // horizontal line
            // diagonal 45°: y - centerY = x - centerX => y = x - centerX + centerY
            { coefs: [1, -1, centerY - centerX] },
            // diagonal -45°: y - centerY = - (x - centerX) => y = -x + centerX + centerY
            { coefs: [1, 1, - centerX - centerY] } ];

        for (const line of candidates) {
            const isSymmetric = points.every(p => {
                const rp = this.reflect(p, line.coefs as [number, number, number]); // reflected point
                rp[0] = Math.round(rp[0] * 1000) / 1000; // avoiding floating-point shenanigans
                rp[1] = Math.round(rp[1] * 1000) / 1000;
                return pointSet.has(`${rp[0]},${rp[1]}`);
            });
            if (isSymmetric) return line.coefs;
        }

        return [];
    }

    // find the segment to draw the symmetric line within the bounds of the symmetric group
    // at the end, it is added the current player, which is used at the render phase
    // (this is necessary, because when the turn ends, the currplayer is already updated)
    private getSymmetryLine(group: string[], line: [number, number, number], player: playerid): number[][] {
        const [a, b, c] = line
        const points = group.map(c => this.algebraic2coords(c));
        const centerX = points.reduce((sum, p) => sum + p[0], 0) / points.length;
        const centerY = points.reduce((sum, p) => sum + p[1], 0) / points.length;
        const minX = points.reduce((acc, p) => Math.min(acc, p[0]), this.boardSize);
        const maxX = points.reduce((acc, p) => Math.max(acc, p[0]), 0);
        const minY = points.reduce((acc, p) => Math.min(acc, p[1]), this.boardSize);
        const maxY = points.reduce((acc, p) => Math.max(acc, p[1]), 0);

        if ( b === 0 ) { // vertical line
            return [[centerX,minY], [centerX,maxY], [player]]
        } else if ( a == 0 ) { // horizontal line
            return [[minX,centerY], [maxX,centerY], [player]]
        } else if ( a == 1 && b == -1 ) { // diagonal 45º
            const y0 = (-c - a*minX) / b;
            const y1 = (-c - a*maxX) / b;
            return [[minX,y0], [maxX,y1], [player]];
        } else { // diagonal -45º
            const y0 = (-c - a*minX) / b;
            const y1 = (-c - a*maxX) / b;
            return [[minX,y1], [maxX,y0], [player]];
        }
    }

    public move(m: string, {trusted = false, partial = false} = {}): ShapeChessGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) { throw new UserFacingError("VALIDATION_GENERAL", result.message) }
        }

        if (m.length === 0) { return this; } // note: this allows the re-click cell reset

        this.results = [];
        this._symmetryLine = [];

        const actions: string[] = m.split(','); // we need to process all previous actions, in sequence

        for (let i=0; i<actions.length-1; i++) {
            const action = actions[i]
            const moves = action.split("-");

            if ( moves.length === 1 ) {
                this.board.set(moves[0], this.currplayer);
                this.results.push({type: "place", where: moves[0]});
            } else if ( this.board.get(moves[0])! === this.currplayer ) { // jump
                this.board.delete(moves[0]);
                this.board.set(moves[1], this.currplayer);
                this.results.push({ type: "move", from: moves[0], to: moves[1]});
            } else { // push
                this.board.set(moves[0], this.currplayer);
                this.board.set(moves[1], this.currplayer % 2 + 1 as playerid); // opponent's piece pushed to moves[1]
                this.results.push({ type: "move", from: moves[0], to: moves[1]});
            }

            for(const group of this.getGroups(this.currplayer)) {
                const symmetry = this.computeSymmetry(group);
                if ( symmetry.length === 3 ) { //this group is symmetric!
                    this.scores[this.currplayer - 1] += group.length - 5; // score N-5 points for a group with N pieces
                    this._symmetryLine.push(this.getSymmetryLine(group, symmetry as [number, number, number],
                                                                 this.currplayer));
                    for (const cell of group) { // symmetric groups must be deleted
                        this.board.delete(cell);
                        this.results.push({ type: "capture", where: cell });
                    }
                }
            }

            // now, do the same for the opponent's groups that might be formed due to currplayer's actions
            const prevplayer = this.currplayer % 2 + 1 as playerid;
            for(const group of this.getGroups(prevplayer)) {
                const symmetry = this.computeSymmetry(group);
                if ( symmetry.length === 3 ) { //this group is symmetric!
                    this.scores[prevplayer - 1] += group.length - 5; // score N-5 points for a group with N pieces
                    this._symmetryLine.push(this.getSymmetryLine(group, symmetry as [number, number, number],
                                                                 prevplayer));
                    for (const cell of group) { // symmetric groups must be deleted
                        this.board.delete(cell);
                        this.results.push({ type: "capture", where: cell });
                    }
                }
            }
        } // for (actions)

        this._hadCaptures = false;
        const moves = actions.at(-1)!.split("-");

        if ( partial && this.board.has(moves![0]) &&
                        this.board.get(moves![0])! !== this.currplayer) {
            this._points = this.emptyNeighbors(moves![0]).map(c => this.algebraic2coords(c));
            return this;
        } else {
            this._points = []; // otherwise delete the points and process the full move
        }

        if ( moves.length === 1 ) {
            this.board.set(moves[0], this.currplayer);
            this.results.push({type: "place", where: moves[0]});
        } else if ( this.board.get(moves[0])! === this.currplayer ) { // jump
            this.board.delete(moves[0]);
            this.board.set(moves[1], this.currplayer);
            this.results.push({ type: "move", from: moves[0], to: moves[1]});
        } else { // push
            this.board.set(moves[0], this.currplayer);
            this.board.set(moves[1], this.currplayer % 2 + 1 as playerid); // opponent's piece pushed to moves[1]
            this.results.push({ type: "move", from: moves[0], to: moves[1]});
        }

        // check for symmetrical groups, first from the currplayer, then from the opponent

        for(const group of this.getGroups(this.currplayer)) {
            const symmetry = this.computeSymmetry(group);
            if ( symmetry.length === 3 ) { // this group is symmetric!
                this.scores[this.currplayer - 1] += group.length - 5; // score N-5 points for a group with N pieces
                this._symmetryLine.push(this.getSymmetryLine(group, symmetry as [number, number, number],
                                                             this.currplayer));
                // if this._hadCaptures is true, the current player continues moving
                // however, if winning score was already achieved, no more further moves are needed
                this._hadCaptures = this.scores[this.currplayer - 1] < this.getWinningScore();
                for (const cell of group) { // symmetric groups must be deleted
                    this.board.delete(cell);
                    this.results.push({ type: "capture", where: cell });
                }
            }
        }

        const prevplayer = this.currplayer % 2 + 1 as playerid;
        for(const group of this.getGroups(prevplayer)) {
            const symmetry = this.computeSymmetry(group);
            if ( symmetry.length === 3 ) { // this group is symmetric!
                this.scores[prevplayer - 1] += group.length - 5; // score N-5 points for a group with N pieces
                this._symmetryLine.push(this.getSymmetryLine(group, symmetry as [number, number, number],
                                                             prevplayer));
                for (const cell of group) { // symmetric groups must be deleted
                    this.board.delete(cell);
                    this.results.push({ type: "capture", where: cell });
                }
            }
        }

        if (partial) { return this; }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    private getWinningScore() {
        if (this.ruleset === "5-pts") return 5;
        if (this.ruleset === "6-pts") return 6;
        if (this.ruleset === "7-pts") return 7;
        if (this.ruleset === "8-pts") return 8;
        if (this.ruleset === "9-pts") return 9;
        return 4;
    }

    protected checkEOG(): ShapeChessGame {
        const prevplayer: playerid = this.currplayer % 2 + 1 as playerid;
        const currScore = this.getPlayerScore(this.currplayer);
        const prevScore = this.getPlayerScore(prevplayer);

        if (prevScore >= this.getWinningScore() || currScore >= this.getWinningScore()) {
            this.gameover = true;
            if (prevScore  >  currScore) { this.winner = [prevplayer]; }
            if (prevScore  <  currScore) { this.winner = [this.currplayer]; }
            if (prevScore === currScore) { this.winner = [1, 2]; }
        } else {
            const graph = this.getGraph();
            const empties = [...graph.listCells() as string[]].filter(cell => ! this.board.has(cell));
            if (empties.length === 0) {
                this.gameover = true;
                this.winner = [1, 2]; // if the board gets full, the game is a draw
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

    public render(): APRenderRep {
        // Build piece string
        const pstr: string[][] = [];
        const cells = this.getGraph().listCells(true) as string[][];
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
                style: "vertex-cross",
                width: this.boardSize,
                height: this.boardSize,
            },
            legend: {
                A: { name: "piece", colour: 1 },
                B: { name: "piece", colour: 2 },
            },
            pieces: pstr.map(p => p.join("")).join("\n"),
        };

        rep.annotations = [];

        // show the current move
        if ( this.results.length > 0 ) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({ type: "enter", targets: [{ row: y, col: x }] });
                } else if (move.type === "move") {
                    const [fromX, fromY] = this.algebraic2coords(move.from);
                    const [toX, toY] = this.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "capture") {
                    const [x, y] = this.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                }
            }
        }

        // show the symmetry line when a capture occurs
        if ( this._symmetryLine.length > 0 ) {
            for (const line of this._symmetryLine) {
                const [fromX, fromY]:number[] = line[0];
                const [toX,   toY]  :number[] = line[1];
                const player = line[2][0] as playerid;
                rep.annotations.push({ type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}],
                                       opacity: 0.75, arrow: false, strokeWidth: 0.05, colour: player });
            }
        }

        // show the dots where the selected piece can move to
        if (this._points.length > 0) {
            const points = [];
            for (const [x,y] of this._points) {
                points.push({row: y, col: x});
            }
            rep.annotations.push({type: "dots",
                                  targets: points as [{row: number; col: number;}, ...{row: number; col: number;}[]]});
        }

        return rep;
    }

    public state(): IShapeChessState {
        return {
            game: ShapeChessGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: ShapeChessGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            scores: [...this.scores],
        };
    }

    public getPlayerScore(player: number): number {
        return this.scores[player-1];
    }

    public sidebarScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] },
        ]
    }

   public clone(): ShapeChessGame {
        return new ShapeChessGame(this.serialize());
    }
}