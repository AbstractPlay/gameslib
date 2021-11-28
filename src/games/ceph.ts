import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { IGraph, SquareOrthGraph, SnubSquareGraph } from "../common/graphs";
import { Permutation, PowerSet } from "js-combinatorics";

type playerid = 1|2;
type Value = 1|2|3|4|5|6;
type CellContents = [playerid, Value];

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    lastmove?: string;
};

export interface ICephalopodState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class CephalopodGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Cephalopod",
        uid: "ceph",
        playercounts: [2],
        version: "20211113",
        // i18next.t("apgames:descriptions.ceph")
        description: "apgames:descriptions.ceph",
        urls: ["http://www.marksteeregames.com/Cephalopod_rules.pdf"],
        people: [
            {
                type: "designer",
                name: "Mark Steere",
                urls: ["http://www.marksteeregames.com/"]
            }
        ],
        variants: [
            {
                uid: "snub",
                name: "Board: Snub Square",
                group: "board",
                // i18next.t("apgames:variants.ceph.snub")
                description: "apgames:variants.ceph.snub"
            },
        ],
        flags: ["scores", "multistep"]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, CellContents>;
    public pieces!: [number, number];
    public lastmove?: string;
    public graph!: IGraph;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: ICephalopodState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            const fresh: IMoveState = {
                _version: CephalopodGame.gameinfo.version,
                _results: [],
                currplayer: 1,
                board: new Map(),
            };
            if ( (variants !== undefined) && (variants.length === 1) ) {
                if (variants[0] === "snub") {
                    this.variants = ["snub"];
                }
            }
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ICephalopodState;
            }
            if (state.game !== CephalopodGame.gameinfo.uid) {
                throw new Error(`The Cephalopod engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): CephalopodGame {
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
        this.buildGraph();
        return this;
    }

    private buildGraph(): CephalopodGame {
        if (this.variants.includes("snub")) {
            this.graph = new SnubSquareGraph(5, 5);
        } else {
            this.graph = new SquareOrthGraph(5, 5);
        }
        return this;
    }

    public moves(player?: playerid, permissive = false): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];
        // Look at each empty cell
        const cells = this.graph.listCells() as string[];
        for (const cell of cells) {
            if (! this.board.has(cell)) {
                const captures: string[] = [];
                // Get list of occupied neighbours
                const nCells = this.graph.neighbours(cell);
                const neighbours = [...this.board.entries()].filter(e => nCells.includes(e[0])).map(e => [e[0], e[1][1]] as [string, number]);
                // Build a powerset of those neighbours
                const pset = new PowerSet(neighbours);
                for (const set of pset) {
                    // Every set that is length 2 or longer and that sums to <=6 is a capture
                    if (set.length > 1) {
                        const sum = set.map(e => e[1]).reduce((a, b) => a + b);
                        if (sum <= 6) {
                            // If `permissive`, then add every permutation of captured pieces
                            if (permissive) {
                                const caps = [...set.map(e => e[0])];
                                const perms = new Permutation(caps);
                                for (const p of perms) {
                                    captures.push(`${cell}=${p.join("+")}`);
                                }
                            } else {
                                captures.push(`${cell}=${set.map(e => e[0]).join("+")}`);
                            }
                        }
                    }
                }
                // If there are no captures, just place a 1
                if (captures.length > 0) {
                    moves.push(...captures);
                } else {
                    moves.push(cell);
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
            if (move === "") {
                if (this.board.has(cell)) {
                    return {move: "", message: ""} as IClickResult;
                } else {
                    newmove = cell;
                }
            } else {
                // Reset entire move by clicking on empty cell
                if (! this.board.has(cell)) {
                    newmove = cell;
                } else {
                    const [prev, rest] = move.split("=");
                    if (rest === undefined) {
                        newmove = `${prev}=${cell}`;
                    } else {
                        newmove = `${prev}=${rest}+${cell}`;
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
        const allcells = this.graph.listCells(false) as string[];

        // partial: precapture
        if (! m.includes("=")) {
            // cell is valid
            if (! allcells.includes(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: m});
                return result;
            }
            // cell is empty
            if (this.board.has(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: m});
                return result;
            }
            // are captures possible
            let cancap = false;
            // Get list of occupied neighbours
            const nCells = this.graph.neighbours(m);
            const neighbours = [...this.board.entries()].filter(e => nCells.includes(e[0])).map(e => [e[0], e[1][1]] as [string, number]);
            // Build a powerset of those neighbours
            const pset = new PowerSet(neighbours);
            for (const set of pset) {
                // Every set that is length 2 or longer and that sums to <=6 is a capture
                if (set.length > 1) {
                    const sum = set.map(e => e[1]).reduce((a, b) => a + b);
                    if (sum <= 6) {
                        cancap = true;
                        break;
                    }
                }
            }
            if (cancap) {
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.ceph.PARTIAL_PRECAP");
                return result;
            } else {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
        // capture in progress
        } else {
            const [source, rest] = m.split("=");
            const caps = rest.split("+");
            // validate caps
            let pipcount = 0;
            const allcaps = new Set();
            const nCells = this.graph.neighbours(source);
            for (const cap of caps) {
                // valid cell
                if (! allcells.includes(cap)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: cap});
                    return result;
                }
                // is a neighbour
                if (! nCells.includes(cap)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.ceph.NOTADJACENT", {cell: cap});
                    return result;
                }
                // occupied
                if (! this.board.has(cap)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.CAPTURE4MOVE", {cell: m});
                    return result;
                }
                // pipcount <= 6
                pipcount += this.board.get(cap)![1];
                // Not duplicated
                if (allcaps.has(cap)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.ceph.DUPLICATECAP", {cell: m});
                    return result;
                } else {
                    allcaps.add(cap);
                }
            }
            if (pipcount > 6) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.ceph.TOOHIGH");
                return result;
            }

            // only one die so far
            if (caps.length < 2) {
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.ceph.PARTIAL_ONECAP");
                return result;
            }
            let capcount = 0;
            // Get list of occupied neighbours
            const neighbours = [...this.board.entries()].filter(e => nCells.includes(e[0])).map(e => [e[0], e[1][1]] as [string, number]);
            // Build a powerset of those neighbours
            const pset = new PowerSet(neighbours);
            for (const set of pset) {
                // Every set that is length 2 or longer and that sums to <=6 is a capture
                if (set.length > 1) {
                    const sum = set.map(e => e[1]).reduce((a, b) => a + b);
                    if (sum <= 6) {
                        capcount++;
                    }
                }
            }
            // complete but more are possible
            if (capcount > 1) {
                result.valid = true;
                result.complete = 0;
                result.canrender = true;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            // fully complete
            } else {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
        }

        return result;
    }

    public move(m: string, partial = false): CephalopodGame {
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
        if (partial) {
            if ( (result.complete === undefined) || (result.complete < 0) || ( (result.canrender !== undefined) && (result.canrender === false) ) ) {
                throw new Error(`The move '${m}' is not a valid partial.`)
            }
        }

        this.results = [];
        // capture
        if (m.includes("=")) {
            const [cell, rest] = m.split("=");
            const caps = rest.split("+");
            const sum = [...this.board.entries()].filter(e => caps.includes(e[0])).map(e => e[1][1] as number).reduce((a, b) => a + b);
            if (sum > 6) {
                throw new Error("Invalid capture. Sum greater than 6.");
            }
            this.board.set(cell, [this.currplayer, sum as Value]);
            this.results.push({type: "place", what: sum.toString(), where: cell});
            for (const cap of caps) {
                const contents = this.board.get(cap);
                this.results.push({type: "capture", what: contents![1].toString(), where: cap});
                this.board.delete(cap);
            }
        // placement
        } else {
            this.board.set(m, [this.currplayer, 1]);
            this.results.push({type: "place", what: "1", where: m});
        }

        if (partial) {return this;}

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

    protected checkEOG(): CephalopodGame {
        if (this.board.size === this.graph.listCells().length) {
            this.gameover = true;
            const score1 = this.getPlayerScore(1);
            const score2 = this.getPlayerScore(2);
            if (score1 > score2) {
                this.winner = [1];
            } else if (score1 < score2) {
                this.winner = [2];
            } else {
                throw new Error("Draws shouldn't be possible.");
            }
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }

        return this;
    }

    public resign(player: playerid): CephalopodGame {
        this.gameover = true;
        if (player === 1) {
            this.winner = [2];
        } else {
            this.winner = [1];
        }
        this.results.push(
            {type: "resigned", player},
            {type: "eog"},
            {type: "winners", players: [...this.winner]}
        );
        this.saveState();
        return this;
    }

    public state(): ICephalopodState {
        return {
            game: CephalopodGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: CephalopodGame.gameinfo.version,
            _results: [...this.results],
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    public render(): APRenderRep {
        // Build piece string
        const pieces: string[][] = [];
        const letters = "AB";
        const cells = this.graph.listCells(true);
        for (const row of cells) {
            const node: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const [owner, value] = this.board.get(cell)!;
                    node.push(`${letters[owner - 1]}${value}`);
                } else {
                    node.push("");
                }
            }
            pieces.push(node);
        }
        let pstr: string = pieces.map(r => r.join(",")).join("\n");
        pstr = pstr.replace(/\n,{4}\n/g, "\n_\n");

        // Build rep
        let board = {
            style: "squares",
            width: 5,
            height: 5,
        }
        if (this.variants.includes("snub")) {
            board = {
                style: "snubsquare",
                width: 5,
                height: 5,
            };
        }
        const rep: APRenderRep =  {
            // @ts-ignore
            board,
            legend: {
                A1: {
                    name: "d6-1",
                    player: 1
                },
                A2: {
                    name: "d6-2",
                    player: 1
                },
                A3: {
                    name: "d6-3",
                    player: 1
                },
                A4: {
                    name: "d6-4",
                    player: 1
                },
                A5: {
                    name: "d6-5",
                    player: 1
                },
                A6: {
                    name: "d6-6",
                    player: 1
                },
                B1: {
                    name: "d6-1",
                    player: 2
                },
                B2: {
                    name: "d6-2",
                    player: 2
                },
                B3: {
                    name: "d6-3",
                    player: 2
                },
                B4: {
                    name: "d6-4",
                    player: 2
                },
                B5: {
                    name: "d6-5",
                    player: 2
                },
                B6: {
                    name: "d6-6",
                    player: 2
                },
            },
            pieces: pstr
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "capture") {
                    const [x, y] = this.graph.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                } else if (move.type === "place") {
                    const [x, y] = this.graph.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
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

        status += "**Scores**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const score = this.getPlayerScore(n);
            status += `Player ${n}: ${score}\n\n`;
        }

        return status;
    }

    protected getVariants(): string[] | undefined {
        if ( (this.variants === undefined) || (this.variants.length === 0) ) {
            return undefined;
        }
        const vars: string[] = [];
        for (const v of this.variants) {
            for (const rec of CephalopodGame.gameinfo.variants!) {
                if (v === rec.uid) {
                    vars.push(rec.name);
                    break;
                }
            }
        }
        return vars;
    }

    protected getMoveList(): any[] {
        return this.getMovesAndResults(["move", "place"]);
    }

    public getPlayerScore(player: number): number {
        return [...this.board.values()].filter(v => v[0] === player).length;
    }

    public chatLog(players: string[]): string[][] {
        // eog, resign, winners, place, capture
        const result: string[][] = [];
        for (const state of this.stack) {
            if ( (state._results !== undefined) && (state._results.length > 0) ) {
                const node: string[] = [];
                let otherPlayer = state.currplayer + 1;
                if (otherPlayer > this.numplayers) {
                    otherPlayer = 1;
                }
                let name = `Player ${otherPlayer}`;
                if (otherPlayer <= players.length) {
                    name = players[otherPlayer - 1];
                }
                for (const r of state._results) {
                    switch (r.type) {
                        case "place":
                            node.push(i18next.t("apresults:PLACE.complete", {player: name, what: r.what, where: r.where}));
                            break;
                        case "capture":
                            node.push(i18next.t("apresults:CAPTURE.noperson.simple", {what: r.what, where: r.where}));
                            break;
                        case "eog":
                            node.push(i18next.t("apresults:EOG"));
                            break;
                            case "resigned":
                                let rname = `Player ${r.player}`;
                                if (r.player <= players.length) {
                                    rname = players[r.player - 1]
                                }
                                node.push(i18next.t("apresults:RESIGN", {player: rname}));
                                break;
                            case "winners":
                                const names: string[] = [];
                                for (const w of r.players) {
                                    if (w <= players.length) {
                                        names.push(players[w - 1]);
                                    } else {
                                        names.push(`Player ${w}`);
                                    }
                                }
                                node.push(i18next.t("apresults:WINNERS", {count: r.players.length, winners: names.join(", ")}));
                                break;
                        }
                }
                result.push(node);
            }
        }
        return result;
    }

    public clone(): CephalopodGame {
        return new CephalopodGame(this.serialize());
    }
}
