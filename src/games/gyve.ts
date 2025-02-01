import { GameBase, IAPGameState, IClickResult, ICustomButton, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { HexTriGraph, reviver, setsIntersect, shuffle, UserFacingError } from "../common";
import i18next from "i18next";
import { connectedComponents } from "graphology-components";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-var-requires
const deepclone = require("rfdc/default");

export type playerid = 1|2;


export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface IGyveState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class GyveGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Gyve",
        uid: "gyve",
        playercounts: [2],
        version: "20250201",
        dateAdded: "2023-06-18",
        // i18next.t("apgames:descriptions.gyve")
        description: "apgames:descriptions.gyve",
        urls: ["https://boardgamegeek.com/boardgame/379461/gyve"],
        people: [
            {
                type: "designer",
                name: "Luis Bolaños Mures",
                urls: ["https://boardgamegeek.com/boardgamedesigner/47001/luis-bolanos-mures"]
            },
        ],
        variants: [
            {uid: "size-6", group: "board"},
            {uid: "size-7", group: "board"},
            {uid: "size-10", group: "board"},
            {uid: "size-12", group: "board"},
        ],
        categories: ["goal>unify", "mechanic>place", "board>shape>hex", "board>connect>hex", "components>simple>1per"],
        flags: ["experimental", "pie", "scores", "no-moves", "custom-randomization", "custom-buttons"]
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

    constructor(state?: IGyveState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const board = new Map<string, playerid>();
            const fresh: IMoveState = {
                _version: GyveGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IGyveState;
            }
            if (state.game !== GyveGame.gameinfo.uid) {
                throw new Error(`The Gyve engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): GyveGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.results = [...state._results];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.lastmove = state.lastmove;
        return this;
    }

    public get boardsize(): number {
        const found = this.variants.find(v => v.startsWith("size-"));
        if (found !== undefined) {
            const [,numStr] = found.split("-");
            return parseInt(numStr, 10);
        } else {
            return 8;
        }
    }

    public get graph(): HexTriGraph {
        return new HexTriGraph(this.boardsize, (this.boardsize * 2) - 1);
    }

    private getGroups(p?: playerid): Set<string>[] {
        if (p === undefined) {
            p = this.currplayer;
        }
        const g = this.graph.graph;
        for (const node of g.nodes()) {
            if (!this.board.has(node) || this.board.get(node)! !== p) {
                g.dropNode(node);
            }
        }
        return connectedComponents(g).map(grp => new Set<string>(grp));
    }

    private calcN(cell: string, p?: playerid): number {
        if (p === undefined) {
            p = this.currplayer;
        }
        const groups = this.getGroups(p);
        const g = this.graph;
        const adj = new Set<string>(g.neighbours(cell));
        let n = 0;
        for (const grp of groups) {
            if (setsIntersect(adj, grp)) {
                n++;
            }
        }
        return n;
    }

    // public moves(): string[] {
    //     if (this.gameover) { return []; }

    //     const moves = new Set<string>();
    //     const g = this.graph;

    //     // on first move, only place a single stone
    //     if (this.stack.length === 1) {
    //         g.graph.nodes().forEach(cell => moves.add(cell));
    //     }
    //     // otherwise 2
    //     else {
    //         const empties = g.graph.nodes().filter(cell => !this.board.has(cell));
    //         for (const cell of empties) {
    //             const n1 = this.calcN(cell);
    //             const cloned = this.clone();
    //             cloned.board.set(cell, this.currplayer);
    //             g.graph.nodes().filter(n => !cloned.board.has(n)).forEach(next => {
    //                 if (cloned.calcN(next) === n1) {
    //                     moves.add(`${cell},${next}`);
    //                 }
    //             });
    //         }
    //     }

    //     // if no moves, pass
    //     if (moves.size === 0) {
    //         moves.add("pass");
    //     }

    //     return [...moves].sort((a,b) => a.localeCompare(b));
    // }

    public getButtons(): ICustomButton[] {
        if (this.randomMove() === "pass") {
            return [{ label: "pass", move: "pass" }];
        }
        return [];
    }

    public randomMove(): string {
        const g = this.graph;
        const mt1 = shuffle(g.graph.nodes().filter(n => !this.board.has(n))) as string[];
        if (this.stack.length === 1) {
            return mt1[0];
        } else {
            for (const m1 of mt1) {
                const n1 = this.calcN(m1);
                const cloned = this.clone();
                cloned.board.set(m1, this.currplayer);
                const mt2 = shuffle(g.graph.nodes().filter(n => !cloned.board.has(n))) as string[];
                for (const m2 of mt2) {
                    const n2 = cloned.calcN(m2);
                    if (n1 === n2) {
                        return `${m1},${m2}`;
                    }
                }
            }
        }
        return "pass";
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.graph.coords2algebraic(col, row);
            let newmove: string;

            if (move === "") {
                newmove = cell;
            } else {
                newmove = move + "," + cell;
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

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const g = this.graph;

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.gyve.INITIAL_INSTRUCTIONS");
            return result;
        }

        // process passing first
        if (m === "pass") {
            if (this.randomMove() !== "pass") {
                result.valid = false;
                result.message = i18next.t("apgames:validation.gyve.BAD_PASS");
                return result;
            } else {
                // Looks good
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
        }
        // all other moves
        else {
            const cells = m.split(",");
            // valid, empty cells
            for (const cell of cells) {
                if (!g.graph.hasNode(cell)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                    return result;
                }
                if (this.board.has(cell)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: cell});
                    return result;
                }
            }
            // handle single-cell moves
            if (cells.length === 1) {
                // on first turn, this is a complete move
                if (this.stack.length === 1) {
                    result.valid = true;
                    result.complete = 1;
                    result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                    return result;
                }
                // otherwise it's partial
                else {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.gyve.PARTIAL");
                    return result;
                }
            }
            // two-stone moves
            else if (cells.length === 2) {
                // if first turn, not legal
                if (this.stack.length === 1) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.gyve.BAD_FIRST");
                    return result;
                }
                // ns match
                const n1 = this.calcN(cells[0]);
                const cloned = this.clone();
                cloned.board.set(cells[0], this.currplayer);
                const n2 = cloned.calcN(cells[1]);
                if (n1 !== n2) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.gyve.BAD_N", {n1, n2});
                    return result;
                }

                // we're good
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
            // anything else is an error
            else {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
                return result;
            }
        }
    }

    public move(m: string, {trusted = false, partial = false} = {}): GyveGame {
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
            // if (!partial && !allMoves.includes(m)) {
            //     throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            // }
        }

        this.results = [];

        if (m === "pass") {
            this.results.push({type: "pass"});
        } else {
            const cells = m.split(",");
            for (const cell of cells) {
                this.board.set(cell, this.currplayer);
                this.results.push({type: "place", where: cell});
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

    protected checkEOG(): GyveGame {
        let passedOut = false;
        if ( (this.lastmove === "pass") && (this.stack[this.stack.length - 1].lastmove === "pass") ) {
            passedOut = true;
        }
        if (passedOut) {
            this.gameover = true;
            const s1 = this.getGroups(1);
            const s2 = this.getGroups(2);
            if (s1 < s2) {
                this.winner = [1];
            } else if (s2 < s1) {
                this.winner = [2];
            } else {
                this.winner = [1,2];
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

    public state(): IGyveState {
        return {
            game: GyveGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: GyveGame.gameinfo.version,
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
        for (const row of this.graph.listCells(true) as string[][]) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (const cell of row) {
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

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "hex-of-tri",
                minWidth: this.boardsize,
                maxWidth: (this.boardsize * 2) - 1,
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
        if (this.results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
                    const [x, y] = g.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }

        // add dots if present
        if (this.dots.length > 0) {
            if (!("annotations" in rep)) {
                rep.annotations = [];
            }
            for (const cell of this.dots) {
                const [x, y] = g.algebraic2coords(cell);
                rep.annotations!.push({type: "dots", targets: [{row: y, col: x}]});
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
        }
        return resolved;
    }

    public getPlayerScore(player: playerid): number {
        return this.getGroups(player).length;
    }

    public getPlayersScores(): IScores[] {
        const scores: number[] = [this.getPlayerScore(1), this.getPlayerScore(2)];
        return [{ name: i18next.t("apgames:status.GROUPCOUNT"), scores}];
    }

    public clone(): GyveGame {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        return Object.assign(new GyveGame(), deepclone(this) as GyveGame);
    }
}
