import { GameBase, IAPGameState, IClickResult, IIndividualState, IStatus, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, RowCol } from "@abstractplay/renderer/build/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { diagDirections, reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { SquareDiagGraph, SquareDiamondsDirectedGraph, SquareOrthGraph } from "../common/graphs";

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    insurgents: number;
    lastmove?: string;
};

export interface IGuerrillaState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class GuerrillaGame extends GameBase {
    private static readonly BOARD_SIZE = 8;
    private static readonly DIAMOND_SIZE = 7;
    private static readonly squareGraph = new SquareDiagGraph(GuerrillaGame.BOARD_SIZE, GuerrillaGame.BOARD_SIZE);
    private static readonly diamondGraph = new SquareOrthGraph(GuerrillaGame.DIAMOND_SIZE, GuerrillaGame.DIAMOND_SIZE);

    public static readonly gameinfo: APGamesInformation = {
        name: "Guerrilla Checkers",
        uid: "guerrilla",
        playercounts: [2],
        version: "20260807",
        dateAdded: "2026-08-25",
        // i18next.t("apgames:descriptions.guerrilla")
        description: "apgames:descriptions.guerrilla",
        // i18next.t("apgames:notes.guerrilla")
        notes: "apgames:notes.guerrilla",
        urls: [
            "https://brtrain.wordpress.com/wp-content/uploads/2018/03/gcheck-2sided.docx",
            "https://boardgamegeek.com/boardgame/71035/guerrilla-checkers",
        ],
        bggid: "71035",
        people: [
            {
                type: "designer",
                name: "Brian Train",
                urls: ["https://brtrain.wordpress.com/free-games/"],
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        categories: ["goal>annihilate", "mechanic>place", "mechanic>move", "mechanic>capture", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: []
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public insurgents = 66;
    private dots: string[] = [];
    private partialPlacement?: string;

    constructor(state?: IGuerrillaState | string) {
        super();
        if (state === undefined) {
            const board = new Map<string, playerid>([
                ["f4", 2],
                ["e3", 2], ["e5", 2],
                ["d4", 2], ["d6", 2],
                ["c5", 2],
            ]);
            const fresh: IMoveState = {
                _version: GuerrillaGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                insurgents: 66,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IGuerrillaState;
            }
            if (state.game !== GuerrillaGame.gameinfo.uid) {
                throw new Error(`The Guerrilla Checkers engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): GuerrillaGame {
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
        this.insurgents = state.insurgents;
        this.dots = [];
        this.partialPlacement = undefined;
        return this;
    }

    public get graph(): SquareDiamondsDirectedGraph {
        return new SquareDiamondsDirectedGraph(GuerrillaGame.BOARD_SIZE, GuerrillaGame.BOARD_SIZE);
    }

    /** Internal diamond at orth-grid (col, row) → `{topLeft}|{bottomRight}` square ids. */
    private static diamondAt(col: number, row: number): string {
        const g = GuerrillaGame.squareGraph;
        const tl = g.coords2algebraic(col, row);
        const br = g.coords2algebraic(col + 1, row + 1);
        return `${tl}|${br}`;
    }

    private static diamondOrthCoords(diamond: string): [number, number] {
        const [tl] = diamond.split("|");
        return GuerrillaGame.squareGraph.algebraic2coords(tl);
    }

    private static orthNodeToDiamond(node: string): string {
        const [col, row] = GuerrillaGame.diamondGraph.algebraic2coords(node);
        return GuerrillaGame.diamondAt(col, row);
    }

    private static diamondToOrthNode(diamond: string): string {
        const [col, row] = GuerrillaGame.diamondOrthCoords(diamond);
        return GuerrillaGame.diamondGraph.coords2algebraic(col, row);
    }

    private static orthNeighbours(diamond: string): string[] {
        const orth = GuerrillaGame.diamondToOrthNode(diamond);
        return GuerrillaGame.diamondGraph.neighbours(orth).map(n => GuerrillaGame.orthNodeToDiamond(n));
    }

    private static allDiamonds(): string[] {
        const diamonds: string[] = [];
        for (let row = 0; row < GuerrillaGame.DIAMOND_SIZE; row++) {
            for (let col = 0; col < GuerrillaGame.DIAMOND_SIZE; col++) {
                diamonds.push(GuerrillaGame.diamondAt(col, row));
            }
        }
        return diamonds;
    }

    private static isDiamond(cell: string): boolean {
        return cell.includes("|");
    }

    private pieceCount(player: playerid): number {
        return [...this.board.values()].filter(v => v === player).length;
    }

    private insurgentCells(): string[] {
        return [...this.board.entries()].filter(([, owner]) => owner === 1).map(([cell]) => cell);
    }

    private static parseP2Squares(m: string): string[] {
        const squares = m.match(/[a-h][1-8]/g);
        if (squares === null) {
            return [];
        }
        return squares;
    }

    private adjacentDiamonds(square: string): string[] {
        return this.graph.neighbours(square).filter(n => GuerrillaGame.isDiamond(n));
    }

    private isP2Surrounded(square: string, board: Map<string, playerid> = this.board): boolean {
        const diamonds = this.adjacentDiamonds(square);
        if (diamonds.length === 0) {
            return false;
        }
        return diamonds.every(d => GuerrillaGame.isInsurgent(board, d));
    }

    private captureSurroundedP2(): void {
        const captured = [...this.board.entries()]
            .filter(([cell, owner]) => owner === 2 && this.isP2Surrounded(cell))
            .map(([cell]) => cell);

        for (const cell of captured) {
            this.board.delete(cell);
            this.results.push({type: "capture", where: cell});
        }
    }

    private static crossedDiamond(from: string, to: string): string | undefined {
        const g = GuerrillaGame.squareGraph;
        const [fx, fy] = g.algebraic2coords(from);
        const [tx, ty] = g.algebraic2coords(to);
        const dx = tx - fx;
        const dy = ty - fy;
        if (Math.abs(dx) !== 1 || Math.abs(dy) !== 1) {
            return undefined;
        }
        if (dx === 1 && dy === 1) {
            return GuerrillaGame.diamondAt(fx, fy);
        }
        if (dx === 1 && dy === -1) {
            return GuerrillaGame.diamondAt(fx, fy - 1);
        }
        if (dx === -1 && dy === 1) {
            return GuerrillaGame.diamondAt(fx - 1, fy);
        }
        return GuerrillaGame.diamondAt(fx - 1, fy - 1);
    }

    private static isInsurgent(board: Map<string, playerid>, diamond: string): boolean {
        return board.get(diamond) === 1;
    }

    private static isEmptySquare(board: Map<string, playerid>, square: string): boolean {
        return !board.has(square);
    }

    private movesP1(): string[] {
        if (this.insurgents < 2) {
            return [];
        }

        const insurgents = this.insurgentCells();
        const firstMove = insurgents.length === 0;
        const emptyDiamonds = new Set(
            GuerrillaGame.allDiamonds().filter(d => !this.board.has(d))
        );

        const firstCandidates = new Set<string>();
        if (firstMove) {
            for (const d of emptyDiamonds) {
                firstCandidates.add(d);
            }
        } else {
            for (const insurgent of insurgents) {
                for (const n of GuerrillaGame.orthNeighbours(insurgent)) {
                    if (emptyDiamonds.has(n)) {
                        firstCandidates.add(n);
                    }
                }
            }
        }

        const moves: string[] = [];
        for (const first of firstCandidates) {
            for (const second of GuerrillaGame.orthNeighbours(first)) {
                if (emptyDiamonds.has(second)) {
                    moves.push(`${first},${second}`);
                }
            }
        }
        return moves.sort((a, b) => a.localeCompare(b));
    }

    private movesForP2(cell: string, board: Map<string, playerid>): string[] {
        if (board.get(cell) !== 2) {
            return [];
        }

        const g = GuerrillaGame.squareGraph;
        const moves: string[] = [];
        const [fx, fy] = g.algebraic2coords(cell);

        for (const dir of diagDirections) {
            const dest = g.move(fx, fy, dir);
            if (dest === undefined) {
                continue;
            }
            const to = g.coords2algebraic(...dest);
            if (!GuerrillaGame.isEmptySquare(board, to)) {
                continue;
            }
            const diamond = GuerrillaGame.crossedDiamond(cell, to);
            if (diamond === undefined) {
                continue;
            }
            if (GuerrillaGame.isInsurgent(board, diamond)) {
                moves.push(`${cell}x${to}`);
            } else if (!board.has(diamond)) {
                moves.push(`${cell}-${to}`);
            }
        }
        return moves;
    }

    private capturesForP2(cell: string, board: Map<string, playerid>): string[] {
        return this.movesForP2(cell, board).filter(mv => mv.includes("x"));
    }

    private static applyP2Move(mv: string, board: Map<string, playerid>): Map<string, playerid> {
        const next = new Map(board);
        const parts = mv.split(/[-x]/);
        for (let i = 1; i < parts.length; i++) {
            const from = parts[i - 1]!;
            const to = parts[i]!;
            const diamond = GuerrillaGame.crossedDiamond(from, to);
            if (diamond !== undefined) {
                next.delete(diamond);
            }
            next.delete(from);
            next.set(to, 2);
        }
        return next;
    }

    private recurseCaps(stubs: string[], complete: string[], board: Map<string, playerid>): void {
        const toVisit = [...stubs];
        while (toVisit.length > 0) {
            const mv = toVisit.shift()!;
            const after = GuerrillaGame.applyP2Move(mv, board);
            const last = mv.split("x").pop()!;
            const more = this.capturesForP2(last, after);
            if (more.length === 0) {
                complete.push(mv);
            } else {
                for (const m of more) {
                    const [, next] = m.split("x");
                    toVisit.push(`${mv}x${next}`);
                }
            }
        }
    }

    private movesP2(): string[] {
        const board = this.board;
        const pieces = [...board.entries()].filter(([, owner]) => owner === 2).map(([cell]) => cell);
        const moves: string[] = [];

        for (const cell of pieces) {
            const cellMoves = this.movesForP2(cell, board);
            for (const mv of cellMoves) {
                if (mv.includes("-")) {
                    moves.push(mv);
                } else {
                    this.recurseCaps([mv], moves, board);
                }
            }
        }

        return [...new Set(moves)].sort((a, b) => a.localeCompare(b));
    }

    public moves(): string[] {
        if (this.gameover) { return []; }

        if (this.currplayer === 1) {
            return this.movesP1();
        }
        return this.movesP2();
    }

    private matchingMoves(m: string, allMoves: string[]): string[] {
        if (this.currplayer === 1 && !m.includes(",")) {
            return allMoves.filter(mv => mv.startsWith(`${m},`));
        }
        return allMoves.filter(mv => mv.startsWith(m) && (mv.length === m.length || "-x".includes(mv[m.length]!)));
    }

    private findPoints(partial: string): string[] {
        const moves = this.matchingMoves(partial, this.moves());
        if (this.currplayer === 1) {
            return [...new Set(moves.map(mv => mv.split(",")[1]!))];
        }

        const points: string[] = [];
        for (const mv of moves) {
            if (mv.length <= partial.length) {
                continue;
            }
            const sep = mv[partial.length];
            if (sep !== "-" && sep !== "x") {
                continue;
            }
            const next = mv.substring(partial.length + 1).match(/^[a-h][1-8]/)?.[0];
            if (next !== undefined) {
                points.push(next);
            }
        }
        return [...new Set(points)];
    }

    private extendPartialMove(partial: string, cell: string): string | undefined {
        for (const mv of this.matchingMoves(partial, this.moves())) {
            if (mv.length <= partial.length) {
                continue;
            }
            const sep = mv[partial.length];
            if (sep !== "-" && sep !== "x") {
                continue;
            }
            const next = mv.substring(partial.length + 1).match(/^[a-h][1-8]/)?.[0];
            if (next === cell) {
                return `${partial}${sep}${cell}`;
            }
        }
        return undefined;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const g = this.graph;
            const cell = g.coords2algebraic(col, row);
            let newmove = "";

            if (this.currplayer === 1) {
                if (!GuerrillaGame.isDiamond(cell)) {
                    newmove = move;
                } else if (move.length === 0 || move.includes(",")) {
                    newmove = cell;
                } else {
                    newmove = `${move},${cell}`;
                }
            } else {
                if (move.length === 0) {
                    if (this.board.get(cell) === 2) {
                        newmove = cell;
                    }
                } else if (this.board.get(cell) === 2) {
                    newmove = cell;
                } else {
                    const extended = this.extendPartialMove(move, cell);
                    newmove = extended ?? move;
                }
            }

            const matches = this.matchingMoves(newmove, this.moves());
            if (matches.length === 1) {
                newmove = matches[0]!;
            }

            const result = this.validateMove(newmove) as IClickResult;
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

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.guerrilla.INITIAL_INSTRUCTIONS", {
                context: this.currplayer === 1 ? "p1" : "p2",
            });
            return result;
        }

        const allMoves = this.moves();
        if (allMoves.includes(m)) {
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        const matches = this.matchingMoves(m, allMoves);
        if (matches.length > 0) {
            const cancap = matches.some(mv => mv.includes("x"));
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            if (this.currplayer === 1) {
                result.message = i18next.t("apgames:validation.guerrilla.PARTIAL", {context: "p1second"});
            } else {
                result.message = i18next.t("apgames:validation.guerrilla.PARTIAL", {context: cancap ? "p2cap" : "p2move"});
            }
            return result;
        }

        result.valid = false;
        result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
        return result;
    }

    public move(m: string, {trusted = false, partial = false} = {}): GuerrillaGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const allMoves = this.moves();
        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (!partial && !allMoves.includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];
        this.dots = [];
        this.partialPlacement = undefined;

        if (partial) {
            this.dots = this.findPoints(m);
            if (this.currplayer === 1 && !m.includes(",")) {
                this.partialPlacement = m;
            }
            return this;
        }

        if (this.currplayer === 1) {
            const [first, second] = m.split(",");
            this.board.set(first, 1);
            this.board.set(second, 1);
            this.insurgents -= 2;
            this.results.push({type: "place", where: first});
            this.results.push({type: "place", where: second});
            this.captureSurroundedP2();
        } else {
            const squares = GuerrillaGame.parseP2Squares(m);
            for (let i = 1; i < squares.length; i++) {
                const from = squares[i - 1]!;
                const to = squares[i]!;
                const diamond = GuerrillaGame.crossedDiamond(from, to);
                const isCap = m.includes(`${from}x${to}`);
                this.board.delete(from);
                if (isCap && diamond !== undefined) {
                    this.board.delete(diamond);
                    this.results.push({type: "capture", where: diamond});
                }
                this.board.set(to, 2);
                this.results.push({type: "move", from, to});
            }
        }

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

    protected checkEOG(): GuerrillaGame {
        const p1count = this.pieceCount(1);
        const p2count = this.pieceCount(2);

        if (p1count === 0) {
            this.gameover = true;
            this.winner = [2];
        } else if (p2count === 0) {
            this.gameover = true;
            this.winner = [1];
        } else if (this.currplayer === 1 && this.movesP1().length === 0) {
            this.gameover = true;
            this.winner = [2];
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public sidebarStatuses(): IStatus[] {
        return [
            { key: i18next.t("apgames:status.guerrilla.INSURGENTS"), value: [this.insurgents.toString()] },
        ];
    }

    public state(): IGuerrillaState {
        return {
            game: GuerrillaGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: GuerrillaGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            insurgents: this.insurgents,
        };
    }

    public render(): APRenderRep {
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
                    pieces.push(contents === 1 ? "A" : "B");
                } else if (cell === this.partialPlacement) {
                    pieces.push("A");
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join("");
        }

        const rep: APRenderRep = {
            board: {
                style: "squares-diamonds",
                width: GuerrillaGame.BOARD_SIZE,
                height: GuerrillaGame.BOARD_SIZE,
            },
            legend: {
                A: {
                    name: "piece",
                    colour: 1,
                    scale: 0.4,
                },
                B: {
                    name: "piece",
                    colour: 2,
                    scale: 0.95,
                },
            },
            pieces: pstr,
        };

        if (this.results.length > 0) {
            rep.annotations = [];
            for (const r of this.results) {
                if (r.type === "move") {
                    const [fromX, fromY] = g.algebraic2coords(r.from);
                    const [toX, toY] = g.algebraic2coords(r.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (r.type === "place") {
                    const [x, y] = g.algebraic2coords(r.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                } else if (r.type === "capture") {
                    const [x, y] = g.algebraic2coords(r.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                }
            }
        }

        if (this.partialPlacement !== undefined) {
            if (!("annotations" in rep)) {
                rep.annotations = [];
            }
            const [x, y] = g.algebraic2coords(this.partialPlacement);
            rep.annotations!.push({type: "enter", targets: [{row: y, col: x}]});
        }

        if (this.dots.length > 0) {
            if (!("annotations" in rep)) {
                rep.annotations = [];
            }
            const coords: RowCol[] = [];
            for (const dot of this.dots) {
                const [x, y] = g.algebraic2coords(dot);
                coords.push({row: y, col: x});
            }
            rep.annotations!.push({type: "dots", targets: coords as [RowCol, ...RowCol[]]});
        }

        return rep;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.nowhat", {player, where: r.where}));
                resolved = true;
                break;
            case "move":
                resolved = true;
                break;
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.nowhat", {player, where: r.where}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): GuerrillaGame {
        return new GuerrillaGame(this.serialize());
    }
}
