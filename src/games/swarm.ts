import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/build/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import { HexTriGraph } from "../common/graphs";
import i18next from "i18next";

export type playerid = 1|2;
export type cellcontents = [playerid, number];

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, cellcontents>;
    lastmove?: string;
};

export interface ISwarmState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class SwarmGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Swarm",
        uid: "swarm",
        playercounts: [2],
        version: "20260615",
        dateAdded: "2026-06-15",
        // i18next.t("apgames:descriptions.swarm")
        description: "apgames:descriptions.swarm",
        notes: "apgames:notes.swarm",
        urls: [
                "https://boardgamegeek.com/thread/3684281",
              ],
        people: [
            {
                type: "designer",
                name: "Kanare Kato",
                urls: ["https://kanare-abstract.com"],
                apid: "0998417b-d2b5-4a3f-8f5d-965e67b290b8",
            },
            {
                type: "coder",
                name: "João Pedro Neto",
                urls: ["https://boardgamegeek.com/boardgamedesigner/3829/joao-pedro-neto"],
                apid: "9228bccd-a1bd-452b-b94f-d05380e6638f",
            },
        ],
        categories: ["goal>score>eog", "mechanic>place", "mechanic>stack", "mechanic>capture", "board>shape>hex", "board>connect>hex", "components>simple>1per"],
        variants: [
            { uid: "#board", }, // hexhex3
            { uid: "size-4", group: "board" },
        ],
        flags: ["pie", "scores", "experimental"]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, cellcontents>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public boardSize = 3;

    constructor(state?: ISwarmState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: SwarmGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ISwarmState;
            }
            if (state.game !== SwarmGame.gameinfo.uid) {
                throw new Error(`The Swarm engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): SwarmGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.results = [...state._results];
        this.lastmove = state.lastmove;
        this.boardSize = this.getBoardSize();
        return this;
    }

    private getBoardSize(): number {
        // Get board size from variants.
        if ( (this.variants !== undefined) && (this.variants.length > 0) &&
             (this.variants[0] !== undefined) && (this.variants[0].length > 0) ) {
            const sizeVariants = this.variants.filter(v => v.includes("size"));
            if (sizeVariants.length > 0) {
                const size = sizeVariants[0].match(/\d+/);
                return parseInt(size![0], 10);
            }
            if (isNaN(this.boardSize)) {
                throw new Error(`Could not determine the board size from variant "${this.variants[0]}"`);
            }
        }
        return 3;
    }

    public get graph(): HexTriGraph {
        return new HexTriGraph(this.boardSize, this.boardSize * 2 - 1);
    }

    // Get all groups of pieces for `player`, sorted by decreasing size
    private getGroupSizes(player: playerid): number[] {
        const groups: Set<string>[] = [];
        const pieces = [...this.board.entries()].filter(e => e[1][0] === player).map(e => e[0]);
        const seen: Set<string> = new Set();
        const g = this.graph;

        for (const piece of pieces) {
            if (seen.has(piece)) {
                continue;
            }
            const group: Set<string> = new Set();
            const todo: string[] = [piece];
            while (todo.length > 0) {
                const cell = todo.pop()!;
                if (seen.has(cell)) {
                    continue;
                }
                group.add(cell);
                seen.add(cell);
                const neighbours = g.neighbours(cell);
                for (const n of neighbours) {
                    if (pieces.includes(n)) {
                        todo.push(n);
                    }
                }
            }
            groups.push(group);
        }

        return groups.map(g => g.size).sort((a, b) => b - a);
    }

    // get all friendly singletons adjacent to adversary stack `cell`
    private singletons(cell: string): string[] {
        const res = [];
        for (const neigh of this.graph.neighbours(cell)) {
            if ( this.board.has(neigh) &&
                 this.board.get(neigh)![0] === this.currplayer &&
                 this.board.get(neigh)![1] === 1) {
                res.push(neigh);
            }
        }
        return res;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        player ??= this.currplayer;
        const g = this.graph;
        const moves: string[] = [];

        // the captures involving the greater number of your singletons takes priority.
        // if the conditions are identical, the active player may choose which capture to perform
        const allCaptures: [string, number][] = []; // to decide later
        let maxCaptures = 0;
        for (const cell of g.graph.nodes()) {
            if ( this.board.has(cell) && this.board.get(cell)![0] !== player ) {
                // if N friendly singletons are adjacent to an opponent piece, which size < N,
                // the player can (eventually) capture it
                const N = this.singletons(cell).length;
                if ( N > this.board.get(cell)![1] ) {
                    allCaptures.push([cell, N]); // we'll decide later if this is a valid capture
                    maxCaptures = Math.max(maxCaptures, N);
                }
            }
        }
        // only select the captures with maximum singletons
        const validCaptures: string[] = allCaptures.filter(e => e[1] === maxCaptures).map(e => e[0]);
        moves.push(...validCaptures);

        if (moves.length === 0) {
            // no captures? Let's try placements on empty cells
            for (const cell of g.graph.nodes()) {
                if (! this.board.has(cell)) {
                    moves.push(cell);
                }
            }
        }

        return moves;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.graph.coords2algebraic(col, row);
            const result = this.validateMove(cell) as IClickResult;
            result.move = result.valid ? cell : move;
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
        const result: IValidationResult = {valid: false,
                                           message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.swarm.INSTRUCTIONS");
            return result;
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if ( this.board.has(m) && this.board.get(m)![0] === this.currplayer ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.swarm.FRIENDLY_PIECE", {move: m});
            return result;
        }

        const allMoves = this.moves();

        try { // check if valid cell
            this.graph.algebraic2coords(m);
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
            return result;
        }

        if ( this.board.has(m) && this.board.get(m)![0] !== this.currplayer ) {
            const N = this.singletons(m).length;
            if ( N <= this.board.get(m)![1] ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.swarm.CANNOT_CAPTURE", {move: m});
                return result;
            } else if (! allMoves.includes(m) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.swarm.NOT_MAX_CAPTURE");
                return result;
            }
        }

        if (! allMoves.includes(m) ) {
            result.valid = false;
            // if available moves are at adversary stacks, then probably the player is trying an illegal placement
            if ( this.board.has(allMoves[0]) && this.board.get(allMoves[0])![0] !== this.currplayer ) {
                result.message = i18next.t("apgames:validation.swarm.CAPTURES_MANDATORY", {move: allMoves[0]});
            } else {
                result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
            }
            return result;
        }

        result.valid = true;
        result.complete = 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {trusted = false} = {}): SwarmGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        if (m.length === 0) { return this; }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        this.results = [];

        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) { throw new UserFacingError("VALIDATION_GENERAL", result.message) }
        }

        if (! this.board.has(m) ) { // simple placement
            this.board.set(m, [this.currplayer,1]);
            this.results.push({type: "place", where: m});
        } else { // capture stack by merging singletons
            const singletons: string[] = this.singletons(m);
            this.board.set(m, [this.currplayer, singletons.length]);
            this.results.push({type: "capture", where: m, count: singletons.length});
            // now remove singletons
            for (const singleton of singletons) {
                this.board.delete(singleton);
                this.results.push({type: "move", from: singleton, to: m});
            }
        }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    // compare two lists using lexicographic order (+1 if a>b, -1 if a<b, 0 if a==b)
    private compare(a: number[], b: number[]): number {
        const len = Math.min(a.length, b.length);
        for (let i = 0; i < len; i++) {
            if (a[i] < b[i]) return -1;
            if (a[i] > b[i]) return  1;
        }
        // all equal so far, so shorter one is "smaller"
        if (a.length < b.length) return -1;
        if (a.length > b.length) return  1;
        return 0;
    }

    protected checkEOG(): SwarmGame {
        // game ends when a player is stalemated
        this.gameover = this.moves().length === 0;

        if (this.gameover) {
            const result = this.compare(this.getGroupSizes(1), this.getGroupSizes(2));
            if ( result === 0 ) {
                this.winner = [1,2]; // with regular hexhex boards, it never happens
            } else {
                this.winner = result > 0 ? [1] : [2];
            }
            this.results.push( {type: "eog"},
                               {type: "winners", players: [...this.winner]} );
        }
        return this;
    }

    public render(): APRenderRep {
        const g = this.graph;
        const pieces: string[][] = [];
        for (const row of g.listCells(true)) {
            const nodes: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const [player, size] = this.board.get(cell)!;
                    nodes.push(player===1 ? "A".repeat(size) : "B".repeat(size));
                } else {
                    nodes.push("-");
                }
            }
            pieces.push(nodes);
        }

        // Build rep
        const rep: APRenderRep =  {
            renderer: "stacking-offset",
            board: {
                style: "hex-of-hex",
                minWidth: this.boardSize,
                maxWidth: 2*this.boardSize - 1,
            },
            legend: {
                A: {name: "piece", colour: 1 },
                B: {name: "piece", colour: 2 },
            },
            pieces: pieces.map(r => r.join(",")).join("\n"),
        };

        // Add annotations
        rep.annotations = [];
        if ( this.results.length > 0 ) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = g.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                } else if (move.type === "move") {
                    const [fromX, fromY] = g.algebraic2coords(move.from);
                    const [toX, toY] = g.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}], arrow: false});
                } else if (move.type === "capture") {
                    const [x, y] = g.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                }
            }
        }
        return rep;
    }

    public sidebarScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.SCORES"),
              scores: [this.getGroupSizes(1).join(","),
                       this.getGroupSizes(2).join(",")] }
        ]
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "capture": // note that when chat() is invoked, the current player is already updated
                node.push(i18next.t("apresults:CAPTURE.swarm", { player, where: r.where, count: r.count}));
                resolved = true;
                break;
            case "eog":
                node.push(i18next.t("apresults:EOG.default"));
                resolved = true;
                break;
        }
        return resolved;
    }

    public state(): ISwarmState {
        return {
            game: SwarmGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    public moveState(): IMoveState {
        return {
            _version: SwarmGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    public clone(): SwarmGame {
        return new SwarmGame(this.serialize());
    }
}
