import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult, IScores } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, SquareDiagGraph, UserFacingError } from "../common";
import i18next from "i18next";

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid[]>;
    lastmove?: string;
    scores: [number,number];
};

export interface IByteState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class ByteGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Byte",
        uid: "byte",
        playercounts: [2],
        version: "20231223",
        dateAdded: "2023-12-24",
        // i18next.t("apgames:descriptions.byte")
        description: "apgames:descriptions.byte",
        urls: [
            "https://www.marksteeregames.com/Byte_rules.pdf",
            "https://boardgamegeek.com/boardgame/19360/byte",
        ],
        people: [
            {
                type: "designer",
                name: "Mark Steere",
                urls: ["https://www.marksteeregames.com"],
                apid: "e7a3ebf6-5b05-4548-ae95-299f75527b3f",
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        categories: ["goal>score>race", "mechanic>capture", "mechanic>coopt", "mechanic>move", "mechanic>stack", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["scores", "pie", "automove"],
        variants: [
            {
                uid: "10x10",
                group: "board"
            }
        ],
    };

    public static buildGraph(size = 8): SquareDiagGraph {
        return new SquareDiagGraph(size, size);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid[]>;
    public boardsize = 8;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public scores: [number,number] = [0,0];

    constructor(state?: IByteState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
                if (this.variants.includes("10x10")) {
                    this.boardsize = 10;
                }
            }
            const graph = this.getGraph();
            const board = new Map<string, playerid[]>();
            for (let row = 1; row < this.boardsize; row++) {
                if (row === 0 || row === this.boardsize - 1) {
                    continue;
                }
                let player: playerid = 1;
                if (row % 2 !== 0) {
                    player = 2;
                }
                for (let col = 0; col < this.boardsize; col++) {
                    if ( row % 2 !== col % 2) {
                        const cell = graph.coords2algebraic(col, row);
                        board.set(cell, [player]);
                    }
                }
            }
            const fresh: IMoveState = {
                _version: ByteGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                scores: [0,0],
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IByteState;
            }
            if (state.game !== ByteGame.gameinfo.uid) {
                throw new Error(`The Byte engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): ByteGame {
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
        return this;
    }

    private getGraph(): SquareDiagGraph {
        if (this.variants.includes("10x10")) {
            return ByteGame.buildGraph(10);
        } else {
            return ByteGame.buildGraph(8);
        }
    }

    public moves(player?: playerid, {permissive = false} = {}): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves: string[] = [];

        const graph = this.getGraph();
        // moves first
        for (const [cell, stack] of this.board.entries()) {
            if (stack[0] !== player) {
                continue;
            }
            const neighbours = graph.neighbours(cell);
            let hasNeighbour = false;
            for (const node of neighbours) {
                if (this.board.has(node)) {
                    hasNeighbour = true;
                    break;
                }
            }
            if (! hasNeighbour) {
                // get closest cells
                const dists = new Map<number, string[]>();
                for (const other of this.board.keys()) {
                    if (other === cell) { continue; }
                    const path = graph.path(cell, other)!;
                    if (dists.has(path.length)) {
                        const val = dists.get(path.length)!;
                        val.push(other);
                        dists.set(path.length, [...val]);
                    } else {
                        dists.set(path.length, [other]);
                    }
                }
                if (dists.size > 0) {
                    const closestDist = Math.min(...[...dists.keys()]);
                    const closest = dists.get(closestDist)!;
                    for (const node of neighbours) {
                        for (const close of closest) {
                            if (graph.path(node, close)!.length < closestDist) {
                                moves.push(`${cell}-${node}`);
                                break;
                            }
                        }
                    }
                }
            }
        }

        // now merges
        for (const [cell, stack] of this.board.entries()) {
            if (! stack.includes(player)) {
                continue;
            }
            const idxs: number[] = [];
            for (let i = 0; i < stack.length; i++) {
                if (stack[i] === player) {
                    idxs.push(i);
                }
            }
            for (const n of graph.neighbours(cell)) {
                if (this.board.has(n)) {
                    const nstack = this.board.get(n)!;
                    for (const idx of idxs) {
                        // Must merge to higher altitude
                        const substack = stack.slice(idx);
                        if ( (substack.length + nstack.length <= 8) && (idx < nstack.length) ) {
                            if (idx > 0) {
                                moves.push(`${cell}:${idx+1}-${n}`);
                            } else {
                                moves.push(`${cell}-${n}`);
                            }
                            if ( (permissive) && (idx === 0) ) {
                                moves.push(`${cell}:${idx+1}-${n}`);
                            }
                        }
                    }
                }
            }
        }

        if (moves.length === 0) {
            moves.push("pass");
        }
        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const graph = this.getGraph();
            const cell = graph.coords2algebraic(col, row);
            let idx: number|undefined;
            if ( (piece !== undefined) && (/^\d+$/.test(piece)) ) {
                idx = parseInt(piece, 10);
                // the renderer counts from top of stack down
                // we need to count in the opposite direction
                if (this.board.has(cell)) {
                    const stack = this.board.get(cell)!;
                    idx = stack.length - idx + 1;
                }
            }
            // this function relies on the move list for smart handling
            const moves = this.moves();

            let newmove = "";
            // previous move text
            if (move.length > 0) {
                // just assume movement
                newmove = `${move}-${cell}`;
            // fresh move, occupied space
            } else if (this.board.has(cell)) {
                if ( (idx !== undefined) && (idx !== 1) ) {
                    newmove = `${cell}:${idx}`;
                } else {
                    newmove = cell;
                }
            }

            // autocomplete moves when there is only one option
            const starts = moves.filter(m => m.startsWith(newmove));
            if (starts.length === 1) {
                newmove = starts[0];
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

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.byte.INITIAL_INSTRUCTIONS")
            return result;
        }

        const moves = this.moves();
        if ( (m === "pass") && (moves.length !== 1) && (moves[0] !== "pass") ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.byte.INVALID_PASS");
            return result;
        } else if (m === "pass") {
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        const [left, to] = m.split("-");
        const [from, idxStr] = left.split(":");
        let idx: number|undefined;
        if (idxStr !== undefined) {
            idx = parseInt(idxStr, 10) - 1;
            if ( (isNaN(idx)) || (idx === 0) ) {
                idx = undefined;
            }
        }
        const graph = this.getGraph();

        // FROM has to be defined
        // valid cell
        try {
            graph.algebraic2coords(from);
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: from});
            return result;
        }
        // contains pieces
        if (! this.board.has(from)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: from});
            return result;
        }
        // contains at least one of your pieces
        if (! this.board.get(from)!.includes(this.currplayer)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
            return result;
        }

        if (idx !== undefined) {
            // checker exists
            if (idx >= this.board.get(from)!.length) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.byte.INVALID_INDEX", {where: from, index: idx + 1});
                return result;
            }
            // checker is yours
            if (this.board.get(from)![idx] !== this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.byte.UNOWNED_INDEX", {where: from, index: idx + 1});
                return result;
            }
        } else {
            // bottom cheker is yours
            if (this.board.get(from)![0] !== this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.byte.UNOWNED_INDEX", {where: from, index: 1});
                return result;
            }
        }

        if (to !== undefined) {
            let realidx = idx;
            if (realidx === undefined) {
                realidx = 0;
            }
            // valid cell
            try {
                graph.algebraic2coords(to);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: to});
                return result;
            }
            // can't be the same cell
            if (from === to) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.SAME_FROM_TO");
                return result;
            }
            // must be adjacent
            if (!graph.neighbours(from).includes(to)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.byte.ADJ_ONLY");
                return result;
            }
            // can only move diagonally
            const [tox, toy] = graph.algebraic2coords(to);
            if (tox % 2 === toy % 2) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.byte.DIAG_ONLY");
                return result;
            }
            // if empty with index
            if ( (! this.board.has(to)) && (realidx > 0) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.byte.INVALID_MVMT");
                return result;
            }
            // // if occupied with no index or index === 0
            // if ( (this.board.has(to)) && ( (idx === undefined) || (idx === 0) ) ) {
            //     result.valid = false;
            //     result.message = i18next.t("apgames:validation.byte.INVALID_MERGE");
            //     return result;
            // }
            // stack height
            const substack = this.board.get(from)!.slice(realidx);
            if ( (this.board.has(to)) && (substack.length + this.board.get(to)!.length > 8) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.byte.TOO_HIGH", {count: substack.length, from, to});
                return result;
            }
            // must merge up
            if ( (this.board.has(to)) && (realidx >= this.board.get(to)!.length) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.byte.MUST_CLIMB");
                return result;
            }

            // if we're moving to an empty cell, and move is not in the move list,
            // then we're moving in the wrong direction.
            if ( (! this.board.has(to)) && (! this.moves(this.currplayer, {permissive: true}).includes(m)) ) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.byte.MUST_APPROACH");
                return result;
            }

            // we're good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
        // valid partial
        else {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation._general.NEED_DESTINATION");
            return result;
        }
    }

    public move(m: string, {trusted = false} = {}): ByteGame {
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
            if (! this.moves(this.currplayer, {permissive: true}).includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];
        if (m === "pass") {
            this.results.push({type: "pass"});
        } else {
            const [left, to] = m.split("-");
            const [from, idxStr] = left.split(":");
            let idx = 0;
            if (idxStr !== undefined) {
                idx = parseInt(idxStr, 10) - 1;
            }

            // movement
            if (! this.board.has(to)) {
                const stack = this.board.get(from)!;
                this.board.set(to, [...stack]);
                this.board.delete(from);
                this.results.push({type: "move", from, to})
            }
            // merges
            else {
                const stack = this.board.get(from)!;
                const substack = stack.slice(idx);
                if (this.board.has(to)) {
                    const destStack = this.board.get(to)!;
                    const newstack = [...destStack, ...substack];
                    this.board.set(to, newstack);
                } else {
                    this.board.set(to, [...substack]);
                }
                const remaining = stack.slice(0, idx);
                if (remaining.length === 0) {
                    this.board.delete(from);
                } else {
                    this.board.set(from, remaining);
                }
                this.results.push({type: "move", from, to, count: substack.length});

                // check for capture
                const finalStack = this.board.get(to)!;
                if (finalStack.length === 8) {
                    const owner = finalStack[finalStack.length - 1];
                    this.scores[owner - 1]++;
                    this.board.delete(to);
                    this.results.push({type: "capture", where: to});
                    this.results.push({type: "deltaScore", delta: 1, who: owner});
                }
            }
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

    protected checkEOG(): ByteGame {
        let goal = 2;
        if (this.variants.includes("10x10")) {
            goal = 3;
        }
        for (const player of [1,2] as const) {
            if (this.scores[player - 1] === goal) {
                this.gameover = true;
                this.winner = [player];
                break;
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

    public state(): IByteState {
        return {
            game: ByteGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: ByteGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            scores: [...this.scores],
        };
    }

    public render(): APRenderRep {
        let boardsize = 8;
        if (this.variants.includes("10x10")) {
            boardsize = 10;
        }
        const graph = this.getGraph();
        // Build piece string
        let pstr = "";
        for (let row = 0; row < boardsize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < boardsize; col++) {
                const cell = graph.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    pieces.push(contents.join(""));
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join(",");
        }
        // pstr = pstr.replace(/-{8}/g, "_");

        // Build rep
        const rep: APRenderRep =  {
            renderer: "stacking-tiles",
            board: {
                style: "squares-checkered",
                width: boardsize,
                height: boardsize,
                stackMax: 8
            },
            pieces: pstr
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = graph.algebraic2coords(move.from);
                    const [toX, toY] = graph.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "capture") {
                    const [x, y] = graph.algebraic2coords(move.where as string);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                }
            }
        }

        return rep;
    }

    public getPlayerScore(player: number): number {
        return this.scores[player - 1];
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.SCORES"), scores: [...this.scores] },
        ]
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Scores**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const pieces = this.scores[n - 1];
            status += `Player ${n}: ${pieces}\n\n`;
        }

        return status;
    }

    protected getMoveList(): any[] {
        return this.getMovesAndResults(["move", "capture", "deltaScore", "eog", "winners"]);
    }

    public chatLog(players: string[]): string[][] {
        const result: string[][] = [];
        for (const state of this.stack) {
            if ( (state._results !== undefined) && (state._results.length > 0) ) {
                const node: string[] = [(state._timestamp && new Date(state._timestamp).toISOString()) || "unknown"];
                let otherPlayer = state.currplayer as number - 1;
                if (otherPlayer < 1) {
                    otherPlayer = this.numplayers;
                }
                let name = `Player ${otherPlayer}`;
                if (otherPlayer <= players.length) {
                    name = players[otherPlayer - 1];
                }
                for (const r of state._results) {
                    if (!this.chat(node, name, state._results, r)) {
                        switch (r.type) {
                            case "move":
                                if ("count" in r) {
                                    node.push(i18next.t("apresults:MOVE.byte.partial", {player: name, from: r.from, to: r.to, count: r.count as number}));
                                } else {
                                    node.push(i18next.t("apresults:MOVE.byte.full", {player: name, from: r.from, to: r.to}));
                                }
                                break;
                            case "pass":
                                node.push(i18next.t("apresults:PASS.simple", {player: name}));
                                break;
                            case "capture":
                                node.push(i18next.t("apresults:CAPTURE.noperson.simple", {what: "stack", where: r.where}));
                                break;
                            case "deltaScore":
                                const scorer = players[(r.who as number) - 1];
                                node.push(i18next.t("apresults:DELTA_SCORE_GAIN", {player: scorer, delta: r.delta as number, count: r.delta as number}));
                                node.push(i18next.t("apresults:SCORE_REPORT", {player: scorer, score: (state.scores as number[])[(r.who as number) - 1]}));
                                break;
                            case "eog":
                                node.push(i18next.t("apresults:EOG.default"));
                                break;
                            case "resigned":
                                let rname = `Player ${r.player}`;
                                if (r.player <= players.length) {
                                    rname = players[r.player - 1]
                                }
                                node.push(i18next.t("apresults:RESIGN", {player: rname}));
                                break;
                            case "timeout":
                                let tname = `Player ${r.player}`;
                                if (r.player <= players.length) {
                                    tname = players[r.player - 1]
                                }
                                node.push(i18next.t("apresults:TIMEOUT", {player: tname}));
                                break;
                            case "gameabandoned":
                                node.push(i18next.t("apresults:ABANDONED"));
                                break;
                            case "drawagreed":
                                node.push(i18next.t("apresults:DRAWAGREED"));
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
                                if (r.players.length === 0)
                                    node.push(i18next.t("apresults:WINNERSNONE"));
                                else
                                    node.push(i18next.t("apresults:WINNERS", {count: r.players.length, winners: names.join(", ")}));
                            break;
                        }
                    }
                }
                result.push(node);
            }
        }
        return result;
    }

    public clone(): ByteGame {
        return new ByteGame(this.serialize());
    }
}
