import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult, IScores, type ChatLogCollectContext, type ChatLogLine } from "./_base.js";
import type { APGamesInformation } from "../schemas/gameinfo.js";
import { APRenderRep, RowCol } from "@abstractplay/renderer/build/schemas/schema";
import type { APMoveResult } from "../schemas/moveresults.js";
import { reviver, UserFacingError } from "../common/index.js";
import i18next from "i18next";
import { HexTriGraph } from "../common/graphs/index.js";
import type { HexDir } from "../common/graphs/hextri.js";

export type PlayerId = 1|2;
export type PieceType = 1|2;
export type Piece = [PlayerId, PieceType, HexDir|undefined, boolean];

export interface IMoveState extends IIndividualState {
    currplayer: PlayerId;
    board: Map<string, Piece>;
    lastmove?: string;
    scores: [number, number];
    bridges: [number[], number[]];
};

export interface IBridgesState extends IAPGameState {
    winner: PlayerId[];
    stack: Array<IMoveState>;
};

export class BridgesGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Bridges",
        uid: "bridges",
        playercounts: [2],
        version: "20260817",
        dateAdded: "2026-08-17",
        // i18next.t("apgames:descriptions.bridges")
        description: "apgames:descriptions.bridges",
        urls: [
            "https://boardgamegeek.com/thread/3746400/new-game-bridges"
        ],
        people: [
            {
                type: "designer",
                name: "Marc Rebillet",
                apid: "f4a8b6bc-c4ab-4b34-bd9d-bb65235154ac"
            },
            {
                type: "coder",
                name: "ManaT",
                urls: [],
                apid: "a82c4aa8-7d43-4661-b027-17afd1d1586f",
            },
        ],
        categories: ["goal>score>eog", "mechanic>place", "board>shape>hex", "board>connect>hex"],
        flags: ["automove", "experimental"]
    };

    public numplayers = 2;
    public currplayer: PlayerId = 1;
    public board!: Map<string, Piece>;
    public boardSize = 8;
    public graph = new HexTriGraph(this.boardSize, (this.boardSize * 2) - 1);
    public gameover = false;
    public winner: PlayerId[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public scores: [number, number] = [0, 0];
    public bridges = [[], []] as [number[], number[]];
    public _selected: string | undefined;
    public forbiddenCell = "h8";

    constructor(state?: IBridgesState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: BridgesGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                scores: [0, 0],
                bridges: [[], []] as [number[], number[]]
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IBridgesState;
            }
            if (state.game !== BridgesGame.gameinfo.uid) {
                throw new Error(`The Bridges engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): BridgesGame {
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
        this.boardSize = 8;
        this.graph = new HexTriGraph(this.boardSize, (this.boardSize * 2) - 1);
        this.scores = [...state.scores];
        this.bridges = state.bridges;
        return this;
    }

    private getGraph(): HexTriGraph {
        if (this.graph === undefined) {
            this.graph = new HexTriGraph(this.boardSize, (this.boardSize * 2) - 1);
        }
        return this.graph;
    }

    public moves(player?: PlayerId): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = ["pass"];

        const graph = this.getGraph();
        const placementMoves: string[] = [];
        const empties = (graph.listCells() as string[])
            .filter(c => !this.board.has(c))
            .sort();
        for (const cell of empties) {
            if (cell === this.forbiddenCell) continue;
            const occupiedNeighbors = graph.neighbours(cell)
                .filter(c => this.board.has(c) && this.board.get(c)![1] === 1);
            if (occupiedNeighbors.length === 0) {
                placementMoves.push(cell);
            }
        }
        moves.push(...placementMoves);

        const bridgeMoves: string[] = [];
        const bridgePaths = new Map<string, string[]>();
        const pieces = [...this.board.entries()]
            .filter(([, [owner, type, , usedBase]]) => owner === player && type === 1 && !usedBase)
            .map(([cell]) => cell)
            .sort();
        for (let i = 0; i < pieces.length - 1; i++) {
            for (let j = i + 1; j < pieces.length; j++) {
                const direction = graph.bearing(pieces[i], pieces[j]);
                if (direction === undefined) { continue; }

                const ray = graph.ray(...graph.algebraic2coords(pieces[i]), direction)
                    .map(coords => graph.coords2algebraic(...coords));
                const target = ray.indexOf(pieces[j]);
                const path = ray.slice(0, target);
                if (path.some(cell => this.board.has(cell))) { continue; }

                const forward = `${pieces[i]}-${pieces[j]}`;
                const reverse = `${pieces[j]}-${pieces[i]}`;
                bridgePaths.set(forward, path);
                bridgePaths.set(reverse, path);
                bridgeMoves.push(forward);
                bridgeMoves.push(reverse);
            }
        }
        moves.push(...bridgeMoves);

        if (this.stack.length > 1) {
            for (let i = 0; i < placementMoves.length - 1; i++) {
                for (let j = i + 1; j < placementMoves.length; j++) {
                    if (graph.neighbours(placementMoves[i]).includes(placementMoves[j])) continue;
                    moves.push(`${placementMoves[i]},${placementMoves[j]}`);
                    moves.push(`${placementMoves[j]},${placementMoves[i]}`);
                }
            }
            for (let i = 0; i < bridgeMoves.length - 1; i++) {
                for (let j = i + 1; j < bridgeMoves.length; j++) {
                    const [fromA, toA] = bridgeMoves[i].split("-");
                    const [fromB, toB] = bridgeMoves[j].split("-");
                    const bridgeSet = new Set([fromA, toA, fromB, toB]);
                    const bridgeArray = [fromA, toA, fromB, toB];

                    // Only add if there is no overlap and all endpoints were unique
                    if (bridgeSet.size !== bridgeArray.length) continue;

                    const pathA = bridgePaths.get(bridgeMoves[i]);
                    const pathB = bridgePaths.get(bridgeMoves[j]);
                    if (pathA === undefined || pathB === undefined) continue;

                    for (const cell of pathA) {
                        bridgeArray.push(cell);
                        bridgeSet.add(cell);
                    }
                    for (const cell of pathB) {
                        bridgeArray.push(cell);
                        bridgeSet.add(cell);
                    }

                    // Only add if there is no overlap and all cells were unique
                    if (bridgeSet.size !== bridgeArray.length) continue;

                    moves.push(`${bridgeMoves[i]},${bridgeMoves[j]}`);
                    moves.push(`${bridgeMoves[j]},${bridgeMoves[i]}`);
                }
            }
            for (let i = 0; i < placementMoves.length; i++) {
                for (let j = 0; j < bridgeMoves.length; j++) {
                    const bridgeSet = new Set([placementMoves[i]]);
                    const bridgeArray = [placementMoves[i]];

                    const path = bridgePaths.get(bridgeMoves[j]);
                    if (path === undefined) continue;

                    for (const cell of path) {
                        bridgeArray.push(cell);
                        bridgeSet.add(cell);
                    }

                    // Only add if there is no overlap and all cells were unique
                    if (bridgeSet.size !== bridgeArray.length) continue;

                    moves.push(`${placementMoves[i]},${bridgeMoves[j]}`);
                    moves.push(`${bridgeMoves[j]},${placementMoves[i]}`);
                }

                // Need to include bridges that connect to the new placement
                for (let j = 0; j < pieces.length; j++) {
                    const direction = graph.bearing(placementMoves[i], pieces[j]);
                    if (direction === undefined) { continue; }

                    const ray = graph.ray(...graph.algebraic2coords(placementMoves[i]), direction)
                        .map(coords => graph.coords2algebraic(...coords));
                    const target = ray.indexOf(pieces[j]);
                    if (ray.slice(0, target).some(cell => this.board.has(cell))) { continue; }
                    moves.push(`${placementMoves[i]},${placementMoves[i]}-${pieces[j]}`);
                    moves.push(`${placementMoves[i]},${pieces[j]}-${placementMoves[i]}`);
                }
            }
        }

        return moves;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.getGraph().coords2algebraic(col, row);
            const [move1, move2] = move.split(",");
            const latestMove = move2 === undefined ? move1 : move2;
            const selected = latestMove.endsWith("-") ? latestMove.slice(0, -1) : undefined;
            const owner = move1 === cell ? this.currplayer : this.board.get(cell)?.[0];
            let newmove: string;

            if (owner === this.currplayer) {
                if (selected === undefined) {
                    if (move1 === "") newmove = `${cell}-`;
                    else newmove = `${move1},${cell}-`;
                } else if (this.getGraph().bearing(selected, cell) === undefined) {
                    if (move2 === undefined) newmove = `${cell}-`;
                    else newmove = `${move1},${cell}-`;
                } else {
                    if (move2 === undefined) newmove = `${selected}-${cell}`;
                    else newmove = `${move1},${selected}-${cell}`;
                }
            } else if (!this.board.has(cell)) {
                if (move2 !== undefined && selected !== undefined) newmove = `${move1},${cell}`;
                else if (move2 !== undefined) newmove = `${move1},${cell}`;
                else if (selected !== undefined) newmove = `${cell}`;
                else if (move1 !== "") newmove = `${move1},${cell}`;
                else newmove = `${cell}`;
            } else {
                return {move, message: ""} as IClickResult;
            }

            let result = this.validateMove(newmove) as IClickResult;
            if (result.autocomplete !== undefined) {
                newmove = result.autocomplete;
                result = this.validateMove(newmove) as IClickResult;
            }
            if (!result.valid) {
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

    private completedMoves(m: string): number {
        if (m.length === 0) { return 0; }
        if (m === "pass") { return 1; }
        return m.split(",").filter(part => !part.endsWith("-")).length;
    }

    private movesRemaining(m: string): number {
        const maxMoves = this.stack.length === 1 ? 1 : 2;
        if (m === "pass") { return 0; }
        return Math.max(0, maxMoves - this.completedMoves(m));
    }

    private partialBaseRejectReason(m: string): "already_used" | "no_los" | undefined {
        const parts = m.split(",");
        const part = parts[parts.length - 1];
        if (part === undefined || !part.endsWith("-")) { return undefined; }

        const cell = part.slice(0, -1);
        const piece = this.board.get(cell);
        if (piece === undefined || piece[0] !== this.currplayer || piece[1] !== 1) {
            return undefined;
        }

        if (piece[3]) {
            return "already_used";
        }

        const graph = this.getGraph();
        const availableBases = [...this.board.entries()]
            .filter(([, [owner, type, , usedBase]]) => owner === this.currplayer && type === 1 && !usedBase)
            .map(([c]) => c);
        for (const other of availableBases) {
            if (other === cell) { continue; }
            const direction = graph.bearing(cell, other);
            if (direction === undefined) { continue; }

            const ray = graph.ray(...graph.algebraic2coords(cell), direction)
                .map(coords => graph.coords2algebraic(...coords));
            const target = ray.indexOf(other);
            if (target >= 0 && !ray.slice(0, target).some(c => this.board.has(c))) {
                return undefined;
            }
        }

        return "no_los";
    }

    private bridgeCompletions(m: string, legalMoves: string[]): string[] {
        if (!m.endsWith("-")) { return []; }

        const completions = new Set<string>();
        for (const mv of legalMoves) {
            if (!mv.startsWith(m)) { continue; }
            const rest = mv.slice(m.length);
            const commaIdx = rest.indexOf(",");
            const bridgeEnd = commaIdx === -1 ? rest : rest.slice(0, commaIdx);
            if (bridgeEnd.length === 0) { continue; }
            completions.add(m + bridgeEnd);
        }
        return [...completions];
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, complete: -1, canrender: true, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (m.length === 0) {
            result.valid = true;
            if (this.stack.length > 1) {
                result.message = i18next.t("apgames:validation.bridges.INITIAL_INSTRUCTIONS");
            } else {
                result.message = i18next.t("apgames:validation.bridges.INITIAL_INSTRUCTIONS_FIRST_TURN");
            }
            return result;
        }

        if (m !== "pass") {
            const legalMoves = this.moves();
            if (m.endsWith("-")) {
                const bridgeOptions = this.bridgeCompletions(m, legalMoves);
                if (bridgeOptions.length === 1) {
                    result.valid = true;
                    result.complete = -1;
                    result.autocomplete = bridgeOptions[0];
                    return result;
                }
                if (bridgeOptions.length > 1) {
                    result.valid = true;
                    result.message = i18next.t("apgames:validation.bridges.SELECT_BRIDGE_END");
                    return result;
                }
                const reason = this.partialBaseRejectReason(m);
                if (reason !== undefined) {
                    const count = this.movesRemaining(m);
                    if (reason === "already_used") {
                        if (count === 1) {
                            result.message = i18next.t("apgames:validation.bridges.BASE_HAS_BRIDGE_one");
                        } else {
                            result.message = i18next.t("apgames:validation.bridges.BASE_HAS_BRIDGE_other", {count});
                        }
                    } else if (count === 1) {
                        result.message = i18next.t("apgames:validation.bridges.NO_LINE_OF_SIGHT_one");
                    } else {
                        result.message = i18next.t("apgames:validation.bridges.NO_LINE_OF_SIGHT_other", {count});
                    }
                    return result;
                }
            }
            const matches = legalMoves.filter(mv => mv.startsWith(m));
            if (matches.length === 1 && matches[0] !== m) {
                result.valid = true;
                result.complete = -1;
                result.autocomplete = matches[0];
                return result;
            }
            if (!legalMoves.includes(m)) {
                if (this.stack.length > 1) {
                    result.message = i18next.t("apgames:validation.bridges.INITIAL_INSTRUCTIONS");
                } else {
                    result.message = i18next.t("apgames:validation.bridges.INITIAL_INSTRUCTIONS_FIRST_TURN");
                }
                return result;
            }
        }

        result.valid = true;
        result.complete = (this.stack.length === 1 || m === "pass" || m.includes(",")) ? 1 : -1;
        if (result.complete === -1) {
            result.message = i18next.t("apgames:validation.bridges.ONE_MORE");
        } else {
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        }
        return result;
    }

    public move(m: string, {trusted = false} = {}): BridgesGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const result = this.validateMove(m);
        if (!trusted && !result.valid) throw new UserFacingError("VALIDATION_GENERAL", result.message);

        this.results = [];
        this._selected = undefined;

        for (const move of m.split(",")) {
            if (move === "pass") {
                this.results.push({type: "pass"});
            } else if (move.endsWith("-")) {
                this._selected = move.slice(0, -1);
            } else if (move.includes("-")) {
                const [from, to] = move.split("-");
                const graph = this.getGraph();
                const direction = graph.bearing(from, to)!;
                const ray = graph.ray(...graph.algebraic2coords(from), direction)
                    .map(coords => graph.coords2algebraic(...coords));
                const target = ray.indexOf(to);
                const between: string[] = [];
                let bridgeLength = 0;
                for (const cell of ray.slice(0, target)) {
                    bridgeLength++;
                    between.push(cell);
                    this.board.set(cell, [this.currplayer, 2, direction, false]);
                }
                this.board.set(from, [this.currplayer, 1, undefined, true]);
                this.board.set(to, [this.currplayer, 1, undefined, true]);
                this.bridges[this.currplayer-1].push(bridgeLength);
                this.bridges[this.currplayer-1].sort((a, b) => b-a);
                this.results.push(
                    between.length > 0
                        ? {type: "connect", p1: from, p2: to, between: between as [string, ...string[]]}
                        : {type: "connect", p1: from, p2: to},
                );
            } else {
                this.board.set(move, [this.currplayer, 1, undefined, false]);
                this.results.push({type: "place", where: move});
            }
        }

        this.updateScores();

        // update currplayer
        this.lastmove = m;
        let newplayer = (this.currplayer as number) + 1;
        if (newplayer > this.numplayers) {
            newplayer = 1;
        }
        this.currplayer = newplayer as PlayerId;

        this.checkEOG();
        this.saveState();


        return this;
    }

    private updateScores(): BridgesGame {
        const player1Score: number = this.bridges[0].reduce((accumulator, currentValue) => accumulator + currentValue, 0);
        const player2Score: number = this.bridges[1].reduce((accumulator, currentValue) => accumulator + currentValue, 0);
        this.scores = [player1Score, player2Score];
        return this;
    }

    protected checkEOG(): BridgesGame {
        if (this.lastmove === "pass" && this.stack[this.stack.length - 1].lastmove === "pass") {
            this.gameover = true;
            if (this.scores[0] === this.scores[1]) {
                const maxLength = Math.max(this.bridges[0].length, this.bridges[1].length);
                let i = 0;
                for (; i < maxLength; i++) {
                    if (this.bridges[0][i] !== this.bridges[1][i]) break;
                }
                if (i >= maxLength) this.winner = this.bridges[0].length > this.bridges[1].length ? [1] : this.bridges[0].length < this.bridges[1].length ? [2] : [1,2];
                else this.winner = this.bridges[0][i] > this.bridges[1][i] ? [1] : [2];
            } else {
                this.winner = this.scores[0] > this.scores[1] ? [1] : [2];
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

    public state(): IBridgesState {
        return {
            game: BridgesGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: BridgesGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            scores: [...this.scores],
            bridges: this.bridges
        };
    }

    public render(): APRenderRep {
        // Build piece string
        const pstr: string[][] = [];
        const bridgeGlyphs: Record<PlayerId, Record<HexDir, string>> = {
            1: { E: "C", W: "C", NE: "D", SW: "D", SE: "E", NW: "E" },
            2: { E: "F", W: "F", NE: "G", SW: "G", SE: "H", NW: "H" },
        };
        const playerOneFill: {row: number, col: number}[] = [];
        const playerTwoFill: {row: number, col: number}[] = [];
        const floodFill: {row: number, col: number}[] = [];
        const cells = this.getGraph().listCells(true);
        for (const row of cells) {
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const [owner, type, orientation] = this.board.get(cell)!;
                    if (owner === 1) {
                        pieces.push(type !== 1 ? bridgeGlyphs[owner][orientation!] : this._selected === cell ? "I" : "A");
                        const [x, y] = this.getGraph().algebraic2coords(cell);
                        const cellCoords = {row: y, col: x};
                        playerOneFill.push(cellCoords);
                    } else {
                        pieces.push(type !== 1 ? bridgeGlyphs[owner][orientation!] : this._selected === cell ? "J" : "B");
                        const [x, y] = this.getGraph().algebraic2coords(cell);
                        const cellCoords = {row: y, col: x};
                        playerTwoFill.push(cellCoords);
                    }
                } else {
                    pieces.push("-");
                    if (cell === this.forbiddenCell || this.getGraph().neighbours(cell).filter(c => this.board.has(c) && this.board.get(c)![1] === 1).length > 0) {
                        const [x, y] = this.getGraph().algebraic2coords(cell);
                        const cellCoords = {row: y, col: x};
                        floodFill.push(cellCoords);
                    }
                }
            }
            pstr.push(pieces);
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const markers: Array<any> | undefined = [];
        if (playerOneFill.length > 0) {
            markers.push({ type: "flood", colour: 1, opacity: 0.2, points: playerOneFill as [RowCol, ...RowCol[]] });
        }
        if (playerTwoFill.length > 0) {
            markers.push({ type: "flood", colour: 2, opacity: 0.2, points: playerTwoFill as [RowCol, ...RowCol[]] });
        }
        if (floodFill.length > 0) {
            markers.push({ type: "flood", colour: 5, opacity: 0.2, points: floodFill as [RowCol, ...RowCol[]] });
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "hex-of-hex",
                minWidth: this.boardSize,
                maxWidth: (this.boardSize * 2) - 1,
                markers
            },
            legend: {
                A: { name: "piece", colour: 1 },
                B: { name: "piece", colour: 2 },
                C: { name: "hline", colour: 1 },
                D: { name: "hline", colour: 1, rotate: 120 },
                E: { name: "hline", colour: 1, rotate: 60 },
                F: { name: "hline", colour: 2 },
                G: { name: "hline", colour: 2, rotate: 120 },
                H: { name: "hline", colour: 2, rotate: 60 },
                I: { name: "piece-horse", colour: 1 },
                J: { name: "piece-horse", colour: 2 }
            },
            pieces: pstr.map(p => p.join("")).join("\n")
        };

        // Add annotations
        if (this.results.length > 0) {
            rep.annotations = [];

            // highlight last-placed piece
            // this has to happen after eog annotations to appear correctly
            for (const move of this.results) {
                if (move.type === "connect") {
                    const cells = [move.p1, ...(move.between ?? []), move.p2];
                    for (const cell of cells) {
                        const [x, y] = this.getGraph().algebraic2coords(cell);
                        rep.annotations.push({ type: "enter", targets: [{row: y, col: x}] });
                    }
                } else if (move.type === "place") {
                    const [x, y] = this.getGraph().algebraic2coords(move.where!);
                    rep.annotations.push({ type: "enter", targets: [{row: y, col: x}] });
                }
            }

            if (rep.annotations.length === 0) {
                delete rep.annotations;
            }
        }

        return rep;
    }

    public getPlayerScore(player: PlayerId): number {
        return this.scores[player-1];
    }

    public collectChatLogLine(lines: ChatLogLine[], r: APMoveResult, ctx: ChatLogCollectContext): boolean {
        if (r.type === "connect") {
            this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:CONNECT.bridges", {left: r.p1!, right: r.p2!});
            return true;
        }
        return super.collectChatLogLine(lines, r, ctx);
    }

    public sidebarScores(): IScores[] {
        return [{
            name: this.neutralAreaLabel("apgames:status.SCORES"),
            scores: [this.scores[0], this.scores[1]]
        }];
    }

    public clone(): BridgesGame {
        return new BridgesGame(this.serialize());
    }
}
