import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { HexTriGraph, reviver, SquareOrthGraph, UserFacingError } from "../common";
import i18next from "i18next";
import { IGraph } from "../common/graphs";
import { connectedComponents } from "graphology-components";

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface IRampartState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class RampartGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Rampart",
        uid: "rampart",
        playercounts: [2],
        version: "20260106",
        dateAdded: "2023-12-20",
        // i18next.t("apgames:descriptions.rampart")
        description: "apgames:descriptions.rampart",
        urls: [
            "https://boardgamegeek.com/boardgame/133923/rampart",
            "https://boardgamegeek.com/boardgame/134259/hex-rampart",
        ],
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
            { uid: "13x13", group: "board" },
            { uid: "hex7", group: "board" },
            { uid: "custom", group: "setup", unrated: true },
        ],
        categories: ["goal>annihilate", "mechanic>place",  "mechanic>capture", "board>shape>rect", "board>connect>rect", "board>shape>hex", "board>connect>hex", "components>simple>1per"],
        flags: ["experimental", "automove"]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IRampartState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            let board = new Map<string, playerid>();
            if (!this.variants.includes("custom")) {
                if (this.variants.includes("13x13")) {
                    board = new Map<string, playerid>([
                        ["c13", 2], ["g13", 2], ["k13", 2],
                        ["c9", 2], ["g9", 2], ["k9", 2],
                        ["c5", 2], ["g5", 2], ["k5", 2],
                        ["c1", 2], ["g1", 2], ["k1", 2],
                        ["a11", 1], ["e11", 1], ["i11", 1], ["m11", 1],
                        ["a7", 1], ["e7", 1], ["i7", 1], ["m7", 1],
                        ["a3", 1], ["e3", 1], ["i3", 1], ["m3", 1],
                    ]);
                } else if (this.variants.includes("hex7")) {
                    board = new Map<string, playerid>([
                        ["c1", 2], ["c8", 2], ["d6", 2], ["e11", 2],
                        ["f2", 2], ["h4", 2], ["i8", 2], ["m3", 2], ["l6", 2],
                        ["a5", 1], ["b3", 1], ["e4", 1], ["f9", 1],
                        ["h11", 1], ["i1", 1], ["j5", 1], ["k2", 1], ["k9", 1],
                    ]);
                }
                // otherwise default 11x11
                else {
                    board = new Map<string, playerid>([
                        ["a11", 2], ["e11", 2], ["i11", 2],
                        ["c9", 1], ["g9", 1], ["k9", 1],
                        ["a7", 2], ["e7", 2], ["i7", 2],
                        ["c5", 1], ["g5", 1], ["k5", 1],
                        ["a3", 2], ["e3", 2], ["i3", 2],
                        ["c1", 1], ["g1", 1], ["k1", 1],
                    ]);
                }
            }

            const fresh: IMoveState = {
                _version: RampartGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IRampartState;
            }
            if (state.game !== RampartGame.gameinfo.uid) {
                throw new Error(`The Rampart engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): RampartGame {
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

    public get graph(): IGraph {
        if (this.variants.includes("hex7")) {
            return new HexTriGraph(7, 13);
        } else if (this.variants.includes("13x13")) {
            return new SquareOrthGraph(13, 13);
        } else {
            return new SquareOrthGraph(11, 11);
        }
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const opp = player === 1 ? 2 : 1;
        const moves: string[] = [];

        // ignore setup
        if (this.variants.includes("custom") && this.stack.length <= 2) {
            return [];
        }

        const g = this.graph;
        // placements first
        const mine = [...this.board.entries()].filter(([,p]) => p === player).map(([cell,]) => cell);
        const uniques = new Set<string>();
        for (const cell of mine) {
            const ns = g.neighbours(cell);
            for (const n of ns) {
                if (!this.board.has(n)) {
                    uniques.add(n);
                }
            }
        }
        moves.push(...uniques);

        // captures
        const theirs = [...this.board.entries()].filter(([,p]) => p === opp).map(([cell,]) => cell);
        for (const cell of theirs) {
            if (this.isDead(cell, g)) {
                moves.push(`x${cell}`);
            }
        }

        if (moves.length === 0) {
            moves.push("pass");
        }
        return moves.sort((a,b) => a.localeCompare(b))
    }

    public isDead(cell: string, g?: IGraph): boolean {
        if (!this.board.has(cell)) {
            return false;
        }
        const player = this.board.get(cell)!;
        const opp = player === 1 ? 2 : 1;
        if (g === undefined) {
            g = this.graph;
        }
        let surrounded = true;
        const surrBy = new Set<playerid>();
        for (const n of g.neighbours(cell)) {
            if (!this.board.has(n)) {
                surrounded = false;
                break;
            } else {
                surrBy.add(this.board.get(n)!);
            }
        }
        if (surrounded) {
            // in default 11x11, one of the surrounding pieces must be opposing
            // all `board` variants need to be in the following array
            if (!["13x13", "hex7"].some(v => this.variants.includes(v))) {
                if (surrBy.has(opp)) {
                    return true;
                }
                return false;
            }
            // everything else, it just needs to be surrounded
            else {
                return surrounded;
            }
        }
        return false;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const g = this.graph;
            const cell = g.coords2algebraic(col, row);
            let newmove = "";
            // setup first
            if (this.variants.includes("custom") && this.stack.length <= 2) {
                const moves = new Set<string>(move.split(",").filter(Boolean));
                if (!this.board.has(cell)) {
                    moves.add(cell);
                } else {
                    moves.delete(cell);
                }
                newmove = [...moves].join(",");
            }
            // regular play
            else {
                // empty cell
                if (!this.board.has(cell)) {
                    newmove = cell;
                }
                // occupied enemy
                else if (this.board.get(cell) !== this.currplayer) {
                    newmove = `x${cell}`;
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

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.rampart.INITIAL_INSTRUCTIONS", {context: (this.variants.includes("custom") && this.stack.length <= 2) ? "setup": "play"});
            return result;
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const g = this.graph;

        // setup
        if (this.variants.includes("custom") && this.stack.length <= 2) {
            const allcells = new Set<string>(g.listCells() as string[]);
            const moves = [...new Set<string>(m.split(",").filter(Boolean))];
            if (moves.some(cell => this.board.has(cell)) || moves.some(cell => !allcells.has(cell))) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.rampart.BAD_PLACEMENT");
                return result;
            }
            // you must place at least one
            if (moves.length === 0) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.rampart.PLACE_ONE");
                return result;
            }
            // otherwise, always 0
            result.valid = true;
            result.complete = 0;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.rampart.PARTIAL_PLACE");
            return result;
        }
        // regular play
        else {
            const allMoves = this.moves();
            if (m === "pass") {
                if (! allMoves.includes("pass")) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALID_PASS")
                    return result;
                } else {
                    result.valid = true;
                    result.complete = 1;
                    result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                    return result;
                }
            }
            if (! allMoves.includes(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALID_MOVE");
                return result;
            }

            // we're good
            result.valid = true;
            result.complete = 1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
    }

    public move(m: string, {partial = false, trusted = false} = {}): RampartGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        let result;
        if (! trusted) {
            result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            // all partial moves should still be in the move list
            const allmoves = this.moves();
            if ( (! partial) && (allmoves.length > 0) && (! this.moves().includes(m)) ) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }
        if (m === "") { return this; }

        // setup first
        if (this.variants.includes("custom") && this.stack.length <= 2) {
            const moves = new Set<string>(m.split(",").filter(Boolean));
            for (const cell of moves) {
                this.board.set(cell, this.currplayer);
                this.results.push({type: "place", where: cell});
            }
        }
        // regular play
        else {
            if (m === "pass") {
                this.results = [{ type: "pass" }];
            } else {
                // captures
                if (m.startsWith("x")) {
                    const cell = m.substring(1);
                    const g = this.graph.graph;
                    const opp = this.currplayer === 1 ? 2 : 1;
                    const theirs = new Set<string>([...this.board.entries()].filter(([,p]) => p === opp).map(([cell,]) => cell));
                    for (const node of [...g.nodes()]) {
                        if (!theirs.has(node)) {
                            g.dropNode(node);
                        }
                    }
                    const conn = connectedComponents(g);
                    const capped = conn.find(grp => grp.includes(cell));
                    if (capped === undefined) {
                        throw new Error(`Could not find a group that contains the cell ${cell}.`);
                    }
                    capped.forEach(cell => {
                        this.board.delete(cell);
                        this.results.push({type: "capture", where: cell});
                    });
                }
                // placements
                else {
                    this.board.set(m, this.currplayer);
                    this.results.push({type: "place", where: m});
                }
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

    protected checkEOG(): RampartGame {
        const one = [...this.board.entries()].filter(([,p]) => p === 1).map(([cell,]) => cell);
        const two = [...this.board.entries()].filter(([,p]) => p === 2).map(([cell,]) => cell);
        if (one.length === 0) {
            this.gameover = true;
            this.winner = [2];
        } else if (two.length === 0) {
            this.gameover = true;
            this.winner = [1];
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IRampartState {
        return {
            game: RampartGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: RampartGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    public render(): APRenderRep {
        // Build piece string
        const g = this.graph;
        let pstr = "";
        for (const row of g.listCells(true) as string[][]) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    if (contents === 1) {
                        if (this.isDead(cell)) {
                            pieces.push("Y");
                        } else {
                            pieces.push("A");
                        }
                    } else {
                        if (this.isDead(cell)) {
                            pieces.push("Z");
                        } else {
                            pieces.push("B");
                        }
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join("");
        }

        // Build rep
        const rep: APRenderRep =  {
            board: (this.variants.includes("13x13")) ? {
                style: "vertex",
                width: 13,
                height: 13,
            }
            : this.variants.includes("hex7") ? {
                style: "hex-of-hex",
                minWidth: 7,
                maxWidth: 13,
            } : {
                style: "vertex",
                width: 11,
                height: 11,
            },
            legend: {
                A: { name: "piece", colour: 1 },
                B: { name: "piece", colour: 2 },
                // Dead pieces
                Y: { name: "piece", colour: 1, opacity: 0.75 },
                Z: { name: "piece", colour: 2, opacity: 0.75 },
            },
            pieces: pstr
        };

        // Add annotations
        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = g.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
                if (move.type === "capture") {
                    const [x, y] = g.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
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

    public clone(): RampartGame {
        return new RampartGame(this.serialize());
    }
}
