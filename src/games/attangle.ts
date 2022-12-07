/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { HexTriGraph } from "../common/graphs";
import { Combination } from "js-combinatorics";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

export type playerid = 1|2;
const voids: string[][] = [["d4"], ["h4", "g2", "f7", "e5", "d2", "c6", "b3"]]

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid[]>;
    lastmove?: string;
    pieces: [number, number];
};

export interface IAttangleState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class AttangleGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Attangle",
        uid: "attangle",
        playercounts: [2],
        version: "20211114",
        // i18next.t("apgames:descriptions.attangle")
        description: "apgames:descriptions.attangle",
        urls: ["https://spielstein.com/games/attangle/rules", "https://spielstein.com/games/attangle/rules/grand-attangle"],
        people: [
            {
                type: "designer",
                name: "Dieter Stein",
                urls: ["https://spielstein.com/"]
            }
        ],
        variants: [
            {
                uid: "grand",
                group: "board",
            },
        ],
        flags: ["limited-pieces", "scores"]
    };
    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid[]>;
    public pieces!: [number, number];
    public graph!: HexTriGraph;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IAttangleState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            const fresh: IMoveState = {
                _version: AttangleGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                pieces: [18, 18],
            };
            if ( (variants !== undefined) && (variants.length === 1) && (variants[0] === "grand") ) {
                this.variants = ["grand"];
                fresh.pieces = [27, 27];
                fresh.board = new Map([
                    ["h3", [2]], ["g6", [1]], ["f2", [1]],
                    ["d7", [2]], ["c2", [2]], ["b4", [1]],
                ]);
            }
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IAttangleState;
            }
            if (state.game !== AttangleGame.gameinfo.uid) {
                throw new Error(`The Attangle engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): AttangleGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = deepclone(state.board) as Map<string, playerid[]>;
        this.lastmove = state.lastmove;
        this.pieces = [...state.pieces];
        this.buildGraph();
        return this;
    }

    private buildGraph(): AttangleGame {
        if (this.variants.includes("grand")) {
            this.graph = new HexTriGraph(5, 9);
        } else {
            this.graph = new HexTriGraph(4, 7);
        }
        return this;
    }

    public moves(player?: playerid, permissive = false): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];

        // You may always place a piece
        if (this.pieces[player - 1] > 0) {
            let vs = voids[0];
            if (this.variants.includes("grand")) {
                vs = voids[1];
            }
            const empties = (this.graph.listCells() as string[]).filter(c => (! this.board.has(c)) && (! vs.includes(c)));
            moves.push(...empties);
        }

        // Check for captures
        // For each enemy stack, draw rays in all directions
        // Examine each ray looking for visible pieces belonging to the current player and assemble them in a list
        const enemies = [...this.board.entries()].filter(e => e[1][e[1].length - 1] !== player).map(e => e[0]);
        for (const enemy of enemies) {
            const [xEnemy, yEnemy] = this.graph.algebraic2coords(enemy);
            const potentials: string[] = [];
            for (const dir of ["NE", "E", "SE", "SW", "W", "NW"] as const) {
                const ray = this.graph.ray(xEnemy, yEnemy, dir);
                for (const [x, y] of ray) {
                    const cell = this.graph.coords2algebraic(x, y);
                    if (this.board.has(cell)) {
                        const contents = this.board.get(cell);
                        if (contents![contents!.length - 1] === player) {
                            potentials.push(cell)
                        }
                        break;
                    }
                }
            }
            // For each pair of potential capturers, see if the capture is valid
            if (potentials.length > 1) {
                const pairs: Combination<string> = new Combination(potentials, 2);
                for (const pair of pairs) {
                    const stackEnemy = this.board.get(enemy);
                    const stack1 = this.board.get(pair[0]);
                    const stack2 = this.board.get(pair[1]);
                    const combined = stackEnemy!.length + stack1!.length + stack2!.length - 1;
                    // If it is, store it
                    if (combined <= 3) {
                        moves.push(`${pair[0]},${pair[1]}-${enemy}`);
                        if (permissive) {
                            moves.push(`${pair[1]},${pair[0]}-${enemy}`);
                        }
                    }
                }
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
            const cell = this.graph.coords2algebraic(col, row);
            let newmove = "";
            // If you click on an empty cell, that overrides everything
            if (! this.board.has(cell)) {
                newmove = cell;
            } else if (move.length > 0) {
                const [one, two, target] = move.split(/[,-]/);
                // If you've clicked on an empty cell and are now clicking on an existing one, start fresh
                if ( (one !== undefined) && (! this.board.has(one)) ) {
                    newmove = cell;
                // If the existing cell has a piece, then compose
                } else if ( (one !== undefined) && (this.board.has(one)) && (two === undefined) && (this.board.has(cell)) ) {
                    newmove = `${one},${cell}`;
                // If you have two existing pieces and are clicking on a third, compose
                } else if ( (one !== undefined) && (this.board.has(one)) && (two !== undefined) && (this.board.has(two)) && (this.board.has(cell)) ) {
                    newmove = `${one},${two}-${cell}`;
                } else if ( (target !== undefined) && (this.board.has(cell)) ) {
                    newmove = `${one},${two}-${cell}`;
                } else {
                    newmove = move;
                }
            } else {
                newmove = cell;
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
        const allcells = this.graph.listCells() as string[];
        let vs = voids[0];
        if (this.variants.includes("grand")) {
            vs = voids[1];
        }

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.attangle.INITIAL_INSTRUCTIONS")
            return result;
        }

        const [one, two, target] = m.split(/[,-]/);
        // validate coordinates
        for (const cell of [one, two, target]) {
            if (cell !== undefined) {
                if (! allcells.includes(cell)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                    return result
                }
            }
        }
        // placements & partial captures
        if (one !== undefined) {
            // possible start of a capture
            if (this.board.has(one)) {
                const c1 = this.board.get(one)!;
                // you don't control the stack
                if (c1[c1.length - 1] !== this.currplayer) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                    return result;
                }
                // the stack is too large
                if (c1.length > 2) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.attangle.TRIPLESTACK");
                    return result;
                }
                if (two === undefined) {
                    // possible start of capture
                    result.valid = true;
                    result.complete = -1;
                    result.message = i18next.t("apgames:validation.attangle.POTENTIAL_ONE");
                    return result;
                } else {
                    if (this.board.has(two)) {
                        const c2 = this.board.get(two)!;
                        // you don't control the stack
                        if (c2[c2.length - 1] !== this.currplayer) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                            return result;
                        }
                        // the stack is too large
                        if (c2.length > 2) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.attangle.TRIPLESTACK");
                            return result;
                        }
                        if (target === undefined) {
                            // possible start of capture
                            result.valid = true;
                            result.complete = -1;
                            result.message = i18next.t("apgames:validation.attangle.POTENTIAL_TWO");
                            return result;
                        } else {
                            if (! this.board.has(target)) {
                                result.valid = false;
                                result.message = i18next.t("apgames:validation.attangle.MOVE2EMPTY");
                                return result;
                            }
                            const c3 = this.board.get(target)!;
                            // unobstructed line of sight
                            for (const cell of [one, two]) {
                                const [x, y] = this.graph.algebraic2coords(cell);
                                // Doing indiscrimnate ray casting because I'm tired today and can't
                                // figure out how to make a `bearing` function work in a HexTri graph.
                                let seen = false;
                                let ray: string[] = [];
                                for (const dir of ["NE","E","SE","SW","W","NW"] as const) {
                                    ray = this.graph.ray(x, y, dir).map(pt => this.graph.coords2algebraic(...pt));
                                    if (ray.includes(target)) {
                                        seen = true;
                                        break;
                                    }
                                }
                                if (! seen) {
                                    result.valid = false;
                                    result.message = i18next.t("apgames:validation._general.NOLOS", {from: cell, to: target});
                                    return result;
                                }
                                for (const next of ray) {
                                    if (next === target) {break;}
                                    if (this.board.has(next)) {
                                        result.valid = false;
                                        result.message = i18next.t("apgames:validation._general.OBSTRUCTED", {from: cell, to: target, obstruction: next});
                                        return result;
                                    }
                                }
                            }
                            // you control the target
                            if (c3[c3.length - 1] === this.currplayer) {
                                result.valid = false;
                                result.message = i18next.t("apgames:validation._general.SELFCAPTURE");
                                return result;
                            }
                            // combined stack is too large
                            if (c1.length + c2.length + c3.length > 4) {
                                result.valid = false;
                                result.message = i18next.t("apgames:validation.attangle.TOOHIGH");
                                return result;
                            }
                            // valid capture
                            result.valid = true;
                            result.complete = 1;
                            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                            return result;
                        }
                    } else {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.attangle.EMPTYCAPTURE", {where: two});
                        return result;
                    }
                }
            } else {
                // placing on a void
                if (vs.includes(one)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.attangle.ONVOID");
                    return result;
                }
                // no more pieces to place
                if (this.pieces[this.currplayer - 1] < 1) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.NOPIECES");
                    return result;
                }
                if (two === undefined) {
                    // must be a placement
                    result.valid = true;
                    result.complete = 1;
                    result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                    return result;
                } else {
                    // the first cell can't be empty if the second is defined
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.attangle.EMPTYCAPTURE", {where: one});
                    return result;
                }
            }
        }
        return result;
    }

    public move(m: string): AttangleGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        const result = this.validateMove(m);
        if (! result.valid) {
            throw new UserFacingError("VALIDATION_GENERAL", result.message)
        }
        if (! this.moves(undefined, true).includes(m)) {
            throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
        }

        this.results = [];
        if (m.includes("-")) {
            const [from, to] = m.split("-")
            const [f1, f2] = from.split(",");
            const toContents = this.board.get(to);
            const f1Contents = this.board.get(f1);
            const f2Contents = this.board.get(f2);
            if ( (toContents === undefined) || (f1Contents === undefined) || (f2Contents === undefined) ) {
                throw new Error("Could not fetch board contents.");
            }
            let newstack: playerid[] = [];
            if (f1Contents.length > f2Contents.length) {
                newstack = [...toContents, ...f1Contents, ...f2Contents];
            } else {
                newstack = [...toContents, ...f2Contents, ...f1Contents];
            }
            newstack.pop();
            this.pieces[this.currplayer - 1]++;
            this.board.delete(f1);
            this.board.delete(f2);
            this.board.set(to, newstack);
            this.results.push({type: "move", from: f1, to}, {type: "move", from: f2, to});
        } else {
            this.board.set(m, [this.currplayer]);
            this.pieces[this.currplayer - 1]--;
            this.results.push({type: "place", where: m});
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

    protected checkEOG(): AttangleGame {
        let prevPlayer = 1;
        if (this.currplayer === 1) {
            prevPlayer = 2;
        }
        // Over if current player has no moves
        if (this.moves().length === 0) {
            this.gameover = true;
            this.winner = [prevPlayer as playerid];
        } else {
            let target = 3;
            if (this.variants.includes("grand")) {
                target = 5;
            }
            const triples = [...this.board.entries()].filter(e => (e[1].length === 3) && (e[1][e[1].length - 1] === prevPlayer));
            if (triples.length >= target) {
                this.gameover = true;
                this.winner = [prevPlayer as playerid];
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

    public state(): IAttangleState {
        return {
            game: AttangleGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: AttangleGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: deepclone(this.board) as Map<string, playerid[]>,
            pieces: [...this.pieces],
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        const cells = this.graph.listCells(true);
        for (const row of cells) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    let str = this.board.get(cell)!.join("");
                    str = str.replace(/1/g, "A");
                    str = str.replace(/2/g, "B");
                    pieces.push(str);
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join(",");
        }

        // Build rep
        let board = {
            style: "hex-of-tri",
            minWidth: 4,
            maxWidth: 7,
            markers: [{type: "dots", points: [{row: 3, col: 3}]}]
        }
        if (this.variants.includes("grand")) {
            const markers = voids[1].map(v => {
                const [x, y] = this.graph.algebraic2coords(v);
                return {row: y, col: x};
            });
            board = {
                style: "hex-of-tri",
                minWidth: 5,
                maxWidth: 9,
                markers: [
                    {type: "dots", points: markers}
                ]
            };
        }
        const rep: APRenderRep =  {
            renderer: "stacking-offset",
            // @ts-ignore
            board,
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
                    const [fromX, fromY] = this.graph.algebraic2coords(move.from);
                    const [toX, toY] = this.graph.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "place") {
                    const [x, y] = this.graph.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
            if (rep.annotations.length === 0) {
                delete rep.annotations;
            }
        }

        return rep;
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Pieces In Hand**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const pieces = this.pieces[n - 1];
            status += `Player ${n}: ${pieces}\n\n`;
        }

        return status;
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.PIECESINHAND"), scores: this.pieces }
        ]
    }

    protected getMoveList(): any[] {
        return this.getMovesAndResults(["move", "place"]);
    }

    public getPlayerPieces(player: number): number {
        return this.pieces[player - 1];
    }

    public clone(): AttangleGame {
        return new AttangleGame(this.serialize());
    }
}
