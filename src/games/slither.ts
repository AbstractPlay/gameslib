/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { Directions, RectGrid, reviver, UserFacingError } from "../common";
import { UndirectedGraph } from "graphology";
import { bidirectional } from "graphology-shortest-path/unweighted";
import i18next from "i18next";

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    connPath: string[];
    lastmove?: string;
};

export interface ISlitherState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

type PlayerLines = [string[],string[]];

export class SlitherGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Advanced Slither",
        uid: "slither",
        playercounts: [2],
        version: "20231217",
        dateAdded: "2023-12-20",
        // i18next.t("apgames:descriptions.slither")
        description: "apgames:descriptions.slither",
        urls: ["https://boardgamegeek.com/boardgame/75957/slither"],
        people: [
            {
                type: "designer",
                name: "Corey Clark",
                urls: ["https://boardgamegeek.com/boardgamedesigner/38921/corey-clark"],
            }
        ],
        variants: [
            {
                uid: "13x13",
                group: "board"
            },
            {
                uid: "classic",
                group: "movement"
            }
        ],
        categories: ["goal>connect", "mechanic>place",  "mechanic>move", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["pie", "automove", "multistep", "perspective", "rotate90"]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public connPath: string[] = [];
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public boardSize = 0;
    private grid: RectGrid;
    private lines: [PlayerLines,PlayerLines];

    constructor(state?: ISlitherState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            const board = new Map<string, playerid>();
            const fresh: IMoveState = {
                _version: SlitherGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                connPath: [],
            };
            this.stack = [fresh];
            if (variants !== undefined) {
                this.variants = [...variants];
            }
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ISlitherState;
            }
            if (state.game !== SlitherGame.gameinfo.uid) {
                throw new Error(`The Slither engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
        this.grid = new RectGrid(this.boardSize, this.boardSize);
        this.lines = this.getLines();
    }

    public load(idx = -1): SlitherGame {
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
        this.connPath = [...state.connPath];
        if (this.variants.includes("13x13")) {
            this.boardSize = 13;
        } else {
            this.boardSize = 9;
        }
        return this;
    }

    private getLines(): [PlayerLines,PlayerLines] {
        const lineN: string[] = [];
        const lineS: string[] = [];
        for (let x = 0; x < this.boardSize; x++) {
            const N = GameBase.coords2algebraic(x, 0, this.boardSize);
            const S = GameBase.coords2algebraic(x, this.boardSize-1, this.boardSize);
            lineN.push(N);
            lineS.push(S);
        }
        const lineE: string[] = [];
        const lineW: string[] = [];
        for (let y = 0; y < this.boardSize; y++) {
            const E = GameBase.coords2algebraic(this.boardSize-1, y, this.boardSize);
            const W = GameBase.coords2algebraic(0, y, this.boardSize);
            lineE.push(E);
            lineW.push(W);
        }
        return [[lineN,lineS],[lineE,lineW]];
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves: string[] = [];

        for (let y = 0; y < this.boardSize; y++) {
            for (let x = 0; x < this.boardSize; x++) {
                const cell = SlitherGame.coords2algebraic(x, y, this.boardSize);
                if (! this.board.has(cell)) {
                    if (this.isValid(this.currplayer, [cell])) {
                        moves.push(cell);
                    }
                } else if (this.board.get(cell) === this.currplayer && this.canMove(cell)) {
                    for (const n of this.grid.adjacencies(x, y)) {
                        const to = SlitherGame.coords2algebraic(...n, this.boardSize);
                        if (this.board.has(to)) {
                            continue;
                        }
                        const validFollowups = this.getValidFollowups(this.currplayer, cell, to);
                        if (validFollowups === undefined) {
                            for (let y2 = 0; y2 < this.boardSize; y2++) {
                                for (let x2 = 0; x2 < this.boardSize; x2++) {
                                    const place = SlitherGame.coords2algebraic(x2, y2, this.boardSize);
                                    if (place === to) { continue; }
                                    if ((place === cell || !this.board.has(place)) && this.isValid(player, [to, place], [cell])) {
                                        moves.push(`${cell}-${to}/${place}`);
                                    }
                                }
                            }
                        } else {
                            for (const place of validFollowups) {
                                moves.push(`${cell}-${to}/${place}`);
                            }
                        }
                    }
                }
            }
        }

        if (moves.length === 0) {
            moves.push("pass");
        }
        return moves.sort((a,b) => a.localeCompare(b))
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = SlitherGame.coords2algebraic(col, row, this.boardSize);
            const moves = move.split(/[\/-]+/);
            let newmove = "";
            if (move.length === 0) {
                newmove = cell;
            } else if (moves.length === 1) {
                newmove = move + `-${cell}`;
            } else {
                newmove = move + `/${cell}`
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
            result.message = i18next.t("apgames:validation.slither.INITIAL_INSTRUCTIONS")
            return result;
        }

        m = m.toLowerCase();

        if (m === "pass") {
            if (! this.moves().includes("pass")) {
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

        m = m.replace(/\s+/g, "");
        // Distinction is not made between separators.
        // They are just there to make it clearer what they mean.
        const moves = m.split(/[\/-]+/);

        // number of moves
        if (moves.length > 3) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.slither.PLACEMENT_MADE", {where: moves[2]});
            return result;
        }

        // valid cell
        let currentMove;
        try {
            for (const move of moves) {
                currentMove = move;
                SlitherGame.algebraic2coords(move, this.boardSize);
            }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: currentMove});
            return result;
        }

        if (moves.length === 1) {
            if (!this.board.has(moves[0])) {
                if (this.isValid(this.currplayer, moves)) {
                    result.valid = true;
                    result.complete = 1;
                    result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                    return result;
                } else {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.slither.DIAGONAL");
                    return result;
                }
            } else if (this.board.get(moves[0]) === this.currplayer) {
                const [x,y] = SlitherGame.algebraic2coords(moves[0], this.boardSize);
                if (!this.canMove(moves[0])) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.slither.CANNOT_MOVE");
                    return result;
                }
                let hasMoves = false;
                for (const n of this.grid.adjacencies(x, y)) {
                    const neighbour = SlitherGame.coords2algebraic(...n, this.boardSize);
                    if (!this.board.has(neighbour)) {
                        hasMoves = true;
                        break;
                    }
                }
                if (!hasMoves) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.NO_MOVES", {where: moves[0]});
                    return result;
                }
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation._general.NEED_DESTINATION", moves[0]);
                return result;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                return result;
            }
        }
        const [from, to, place] = moves;
        if (!this.board.has(from)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.PLACEMENT_MADE", {where: from});
            return result;
        } else if (this.board.get(from) !== this.currplayer) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
            return result;
        } else if (!this.canMove(from)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.slither.CANNOT_MOVE");
            return result;
        } else if (!this.isAdjacent(from, to) ) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.slither.NOT_ADJACENT");
            return result;
        } else if (this.board.has(to)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: to});
            return result;
        }
        if (!place) {
            if (!this.hasValidFollowup(this.currplayer, from, to)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.slither.NO_VALID_FOLLOWUP");
                return result;
            }
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.slither.NEED_PLACEMENT");
            return result;
        }
        if (this.board.has(place) && place !== from || place === to) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: place});
            return result;
        } else if (!this.isValid(this.currplayer, [to, place], [from])) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.slither.DIAGONAL");
            return result;
        }
        // A partial case not handled is if a player clicks on a piece where all
        // destinations result in an unfixable diagonal, but in practice, this should not
        // be a real problem.
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    private isValid(player: playerid, toAdd: string[], toRemove?: string[]): boolean {
        // Checks if board is valid after adding toAdd and removing toRemove.
        // Generally `to` and `place` are in toAdd, and `from` is in toRemove.
        // Assumes that toAdd are all empty, and toRemove are all owned by player.
        // Sometimes, a piece may be in both toAdd and toRemove.

        // We check for validity of state around all cells in toAdd,
        // as well as all cells orthogonally adjacent to cells in toRemove.
        const toCheck: Set<string> = new Set(toAdd);
        for (const cell of toRemove ?? []) {
            const [x,y] = SlitherGame.algebraic2coords(cell, this.boardSize);
            for (const n of this.grid.adjacencies(x, y, false)) {
                const place = SlitherGame.coords2algebraic(...n, this.boardSize);
                if (this.board.has(place) && this.board.get(place) === player) {
                    toCheck.add(place);
                }
            }
        }
        const nonos: [Directions,Directions][] = [["N","E"],["S","E"],["S","W"],["N","W"]];
        for (const cell of toCheck) {
            for (const [left,right] of nonos) {
                const [x,y] = SlitherGame.algebraic2coords(cell, this.boardSize);
                const dirDiag = (left + right) as Directions;
                const rayDiag = this.grid.ray(x, y, dirDiag).map(n => SlitherGame.coords2algebraic(...n, this.boardSize));
                if (rayDiag.length === 0) {
                    continue
                } else {
                    const check = rayDiag[0];
                    if ( !(toAdd.includes(check) || this.board.has(check) && this.board.get(check) === player && !(toRemove && toRemove.includes(check)))) {
                        continue;
                    }
                }
                const rayLeft = this.grid.ray(x, y, left).map(n => SlitherGame.coords2algebraic(...n, this.boardSize));
                if (rayLeft.length > 0) {
                    const check = rayLeft[0];
                    if (toAdd.includes(check) || this.board.has(check) && this.board.get(check) === player && !(toRemove && toRemove.includes(check))) {
                        continue;
                    }
                }
                const rayRight = this.grid.ray(x, y, right).map(n => SlitherGame.coords2algebraic(...n, this.boardSize));
                if (rayRight.length > 0) {
                    const check = rayRight[0];
                    if (toAdd.includes(check) || this.board.has(check) && this.board.get(check) === player && !(toRemove && toRemove.includes(check))) {
                        continue;
                    }
                }
                return false;
            }
        }
        return true;
    }

    private isAdjacent(from: string, to: string): boolean {
        // Check if cells are adjacent orthogonally or diagonally.
        const [x1,y1] = SlitherGame.algebraic2coords(from, this.boardSize);
        const [x2,y2] = SlitherGame.algebraic2coords(to, this.boardSize);
        const dx = Math.abs(x1 - x2);
        const dy = Math.abs(y1 - y2);
        if ( (dx === 1) && (dy === 0) || (dx === 0) && (dy === 1) ||  (dx === 1) && (dy === 1) ) {
            return true;
        }
        return false;
    }

    private hasValidFollowup(player: playerid, from: string, to: string): boolean {
        if (this.isValid(player, [to], [from])) {
            return true;
        }
        for (const cell of [from, to]) {
            const [x,y] = SlitherGame.algebraic2coords(cell, this.boardSize);
            for (const n of this.grid.adjacencies(x, y)) {
                const place = SlitherGame.coords2algebraic(...n, this.boardSize);
                if ((place === from || !this.board.has(place)) && this.isValid(player, [to, place], [from])) {
                    return true;
                }
            }
        }
        return false;
    }

    private getValidFollowups(player: playerid, from: string, to: string): Set<string> | undefined {
        // If moving results in already valid position, return null.
        // Otherwise, return the valid followups.
        if (this.isValid(player, [to], [from])) {
            return undefined;
        }
        const followups: Set<string> = new Set();
        for (const cell of [from, to]) {
            const [x,y] = SlitherGame.algebraic2coords(cell, this.boardSize);
            for (const n of this.grid.adjacencies(x, y)) {
                const place = SlitherGame.coords2algebraic(...n, this.boardSize);
                if ((place === from || !this.board.has(place)) && this.isValid(player, [to, place], [from])) {
                    followups.add(place);
                }
            }
        }
        return followups;
    }

    private canMove(from: string): boolean {
        if (this.variants.includes("classic")) {
            // For classic slither, all pieces can be moved as long as
            // the final position does not create a diagonal.
            return true;
        }
        // Check if a piece is in a group that is adjacent to an enemy piece.
        const seen: Set<string> = new Set();
        const todo: string[] = [from]
        while (todo.length > 0) {
            const cell = todo.pop()!;
            if (seen.has(cell)) {
                continue;
            }
            seen.add(cell);
            const [x,y] = SlitherGame.algebraic2coords(cell, this.boardSize);
            for (const n of this.grid.adjacencies(x, y, false)) {
                const piece = SlitherGame.coords2algebraic(...n, this.boardSize);
                if (this.board.has(piece)) {
                    if (this.board.get(piece) !== this.currplayer) {
                        return true;
                    } else {
                        todo.push(piece);
                    }
                }
            }
        }
        return false;
    }

    public move(m: string, {partial = false, trusted = false} = {}): SlitherGame {
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
            if ( (! partial) && (! this.moves().includes(m)) ) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        if (m === "pass") {
            this.results = [{ type: "pass" }];
        } else {
            const moves = m.split(/[\/-]+/);
            if (moves.length === 1) {
                if (!this.board.has(moves[0])) {
                    this.board.set(moves[0], this.currplayer);
                    this.results = [{type: "place", where: moves[0]}];
                }
            } else {
                // Note that for simplicity, we do currently not normalise the moves
                // such that `place` === `from` is same as single placement at `to`.
                const [from, to, place] = moves;
                this.board.delete(from);
                this.board.set(to, this.currplayer);
                this.results = [{type: "move", from: moves[0], to: moves[1]}]
                if (place) {
                    this.board.set(place, this.currplayer);
                    this.results.push({type: "place", where: moves[2]});
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

    private buildGraph(player: playerid): UndirectedGraph {
        const graph = new UndirectedGraph();
        // seed nodes
        [...this.board.entries()].filter(([,p]) => p === player).forEach(([cell,]) => {
            graph.addNode(cell);
        });
        // for each node, check neighbours
        // if any are in the graph, add an edge
        for (const node of graph.nodes()) {
            const [x,y] = SlitherGame.algebraic2coords(node, this.boardSize);
            const neighbours = this.grid.adjacencies(x, y, false).map(n => SlitherGame.coords2algebraic(...n, this.boardSize));
            for (const n of neighbours) {
                if ( (graph.hasNode(n)) && (! graph.hasEdge(node, n)) ) {
                    graph.addEdge(node, n);
                }
            }
        }
        return graph;
    }

    protected checkEOG(): SlitherGame {
        let prevPlayer: playerid = 1;
        if (this.currplayer === 1) {
            prevPlayer = 2;
        }

        const graph = this.buildGraph(prevPlayer);
        const [sources, targets] = this.lines[prevPlayer - 1];
        for (const source of sources) {
            for (const target of targets) {
                if ( (graph.hasNode(source)) && (graph.hasNode(target)) ) {
                    const path = bidirectional(graph, source, target);
                    if (path !== null) {
                        this.gameover = true;
                        this.winner = [prevPlayer];
                        this.connPath = [...path];
                        break;
                    }
                }
            }
            if (this.gameover) {
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

    public state(): ISlitherState {
        return {
            game: SlitherGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: SlitherGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            connPath: [...this.connPath],
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < this.boardSize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < this.boardSize; col++) {
                const cell = SlitherGame.coords2algebraic(col, row, this.boardSize);
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
        pstr = pstr.replace(new RegExp(`-{${this.boardSize}}`, "g"), "_");

        const markers: Array<any> = [
            { type:"edge", edge: "N", colour: 1 },
            { type:"edge", edge: "S", colour: 1 },
            { type:"edge", edge: "E", colour: 2 },
            { type:"edge", edge: "W", colour: 2 },
        ];

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "vertex",
                width: this.boardSize,
                height: this.boardSize,
                markers,
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
        rep.annotations = [];
        if (this.results.length > 0) {
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = SlitherGame.algebraic2coords(move.where!, this.boardSize);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
                if (move.type === "move") {
                    const [fx, fy] = SlitherGame.algebraic2coords(move.from, this.boardSize);
                    const [tx, ty] = SlitherGame.algebraic2coords(move.to, this.boardSize);
                    rep.annotations.push({type: "move", targets: [{row: fy, col: fx}, {row: ty, col: tx}]});
                }
            }
            if (this.connPath.length > 0) {
                type RowCol = {row: number; col: number;};
                const targets: RowCol[] = [];
                for (const cell of this.connPath) {
                    const [x,y] = SlitherGame.algebraic2coords(cell, this.boardSize);
                    targets.push({row: y, col: x})
                }
                rep.annotations.push({type: "move", targets: targets as [RowCol, ...RowCol[]], arrow: false});
            }
        }
        if (this.results.length === 1) {
            const move = this.results[0];
            // Draw forced followups.
            if (move.type === "move") {
                const followups = this.getValidFollowups(this.currplayer, move.from, move.to);
                const points = [];
                if (followups) {
                    for (const followup of followups) {
                        const [x, y] = SlitherGame.algebraic2coords(followup, this.boardSize);
                        points.push({row: y, col: x});
                    }
                    rep.annotations.push({type: "dots", targets: points as [{row: number; col: number}, ...{row: number; col: number}[]]});
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

    public clone(): SlitherGame {
        return new SlitherGame(this.serialize());
    }
}
