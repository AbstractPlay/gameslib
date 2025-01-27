import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, MarkerFlood, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { allDirections, diagDirections, Direction, reviver, SquareDirectedGraph, UserFacingError } from "../common";
import i18next from "i18next";

export type playerid = 1|2;
export type Tile = "W"|"B"|"N";

const cell2tile = new Map<string, Tile>([
    ["a5", "N"], ["b5", "W"], ["c5", "B"], ["d5", "W"], ["e5", "N"],
    ["a4", "W"], ["b4", "B"], ["c4", "W"], ["d4", "B"], ["e4", "W"],
    ["a3", "B"], ["b3", "W"], ["c3", "N"], ["d3", "W"], ["e3", "B"],
    ["a2", "W"], ["b2", "B"], ["c2", "W"], ["d2", "B"], ["e2", "W"],
    ["a1", "N"], ["b1", "W"], ["c1", "B"], ["d1", "W"], ["e1", "N"],
]);

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
    pieces: [number,number];
};

export interface IYonmoqueState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class YonmoqueGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Yonmoque",
        uid: "yonmoque",
        playercounts: [2],
        version: "20250126",
        dateAdded: "2025-01-27",
        // i18next.t("apgames:descriptions.yonmoque")
        description: "apgames:descriptions.yonmoque",
        urls: [
            "http://www.logygames.com/english/yonmoque.html",
            "https://boardgamegeek.com/boardgame/86170/yonmoque"
        ],
        people: [
            {
                type: "designer",
                name: "Mitsuo Yamamoto",
            },
        ],
        categories: ["goal>align", "mechanic>place", "mechanic>move", "mechanic>convert", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["limited-pieces", "custom-colours"]
    };
    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 5);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 5);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public pieces!: [number,number];
    private graph!: SquareDirectedGraph;
    private dots: string[] = [];

    constructor(state?: IYonmoqueState | string) {
        super();
        if (state === undefined) {
            const board = new Map<string, playerid>();
            const fresh: IMoveState = {
                _version: YonmoqueGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                pieces: [6,6],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IYonmoqueState;
            }
            if (state.game !== YonmoqueGame.gameinfo.uid) {
                throw new Error(`The Yonmoque engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): YonmoqueGame {
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
        this.pieces = [...state.pieces];
        this.graph = new SquareDirectedGraph(5, 5);
        return this;
    }

    public moves(): string[] {
        if (this.gameover) { return []; }

        const moves: string[] = [];

        // if you have pieces, you can place them in any empty space
        if (this.pieces[this.currplayer - 1] > 0) {
            moves.push(...this.graph.graph.nodes().filter(c => !this.board.has(c)));
        }

        // if you have pieces on the board, then you can probably move something
        for (const cell of [...this.board.entries()].filter(([,p]) => p === this.currplayer).map(([c,]) => c)) {
            let effTile: Tile = "N";
            const currTile = cell2tile.get(cell)!;
            if ( (currTile === "B" && this.currplayer === 1) || (currTile === "W" && this.currplayer === 2) ) {
                effTile = currTile;
            }
            // can always move to empty neighbours
            for (const n of this.graph.neighbours(cell)) {
                if (!this.board.has(n)) {
                    moves.push(`${cell}-${n}`);
                }
            }
            // can sometimes move further diagonally
            for (const dir of diagDirections) {
                let ray = this.graph.ray(cell, dir);
                // find first cell that's either occupied or a different tile type
                const idx = ray.findIndex(c => this.board.has(c) || cell2tile.get(c)! !== effTile);
                // slice it down, dropping the first cell because that's included above
                if (idx >= 0) {
                    ray = ray.slice(1, idx);
                } else {
                    ray = ray.slice(1);
                }
                for (const next of ray) {
                    moves.push(`${cell}-${next}`);
                }
            }
        }

        return moves.sort((a,b) => a.localeCompare(b));
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = YonmoqueGame.coords2algebraic(col, row);
            let newmove: string;

            // empty move means placing or starting a move
            if (move === "") {
                newmove = cell;
            } else {
                const [from,] = move.split("-");
                newmove = `${from}-${cell}`;
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

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const allMoves = this.moves();

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.yonmoque.INITIAL_INSTRUCTIONS")
            return result;
        }

        if (allMoves.includes(m)) {
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        } else {
            const matches = allMoves.filter(mv => mv.startsWith(m));
            if (matches.length > 0) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.yonmoque.PARTIAL");
                return result;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
                return result;
            }
        }
    }

    public move(m: string, {trusted = false, partial = false} = {}): YonmoqueGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const allMoves = this.moves();
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (!partial && !allMoves.includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];
        this.dots = [];

        if (partial) {
            const matches = allMoves.filter(mv => mv.startsWith(m)).filter(mv => mv.length > 2);
            if (matches.length > 0) {
                this.dots = [...new Set<string>(matches.map(mv => mv.split("-")[1])).values()];
            }
            return this;
        }

        let didMove: string|undefined;
        // placements (no side-effects)
        if (!m.includes("-")) {
            this.board.set(m, this.currplayer);
            this.results.push({type: "place", where: m});
            this.pieces[this.currplayer - 1]--;
        }
        // moves (all the side-effects)
        else {
            const [from, to] = m.split("-");
            this.board.delete(from);
            this.board.set(to, this.currplayer);
            this.results.push({type: "move", from, to});
            didMove = to;
            // check all directions for possible flipping
            for (const dir of allDirections) {
                let ray = this.graph.ray(to, dir);
                // find the first cell that contains a friendly piece
                const idxFriendly = ray.findIndex(c => this.board.has(c) && this.board.get(c) === this.currplayer);
                // if there is one, next step
                if (idxFriendly >= 0) {
                    ray = ray.slice(0, idxFriendly);
                    // there has to be at least one cell left to test
                    if (ray.length > 0) {
                        // this ray can't contain any spaces
                        const idxSpace = ray.findIndex(c => !this.board.has(c));
                        if (idxSpace === -1) {
                            // everything in this ray is an enemy piece
                            // flip them
                            for (const cell of ray) {
                                this.board.set(cell, this.currplayer);
                                this.results.push({type: "convert", where: cell, what: this.currplayer === 1 ? "2" : "1", into: this.currplayer.toString()});
                            }
                        }
                    }
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

        this.checkEOG(didMove);
        this.saveState();
        return this;
    }

    public checkLines(len: number, player: playerid, mustHave?: string): boolean {
        const collate = (cells: string[], dir: Direction): string[] => {
            const localLines: string[] = [];
            for (const cell of cells) {
                const ray = g.ray(cell, dir, true);
                if (mustHave !== undefined && !ray.includes(mustHave)) {
                    continue;
                }
                const line = ray.map(n => this.board.has(n) ? this.board.get(n)! : "-")
                                .join("");
                localLines.push(line);
            }
            return localLines;
        }

        const g = this.graph;
        const lines: string[] = [];
        // N-E
        lines.push(...collate(["a1", "a2", "a3", "a4", "a5"], "E"));
        // S-W
        lines.push(...collate(["a5", "b5", "c5", "d5", "e5"], "S"));
        // NW-SE
        lines.push(...collate(["a4", "a5", "b5"], "SE"));
        // NE-SW
        lines.push(...collate(["d5", "e5", "e4"], "SW"));

        const target = Array.from({length: len}, () => player).join("");
        for (const line of lines) {
            if (line.includes(target)) {
                return true;
            }
        }
        return false;
    }

    protected checkEOG(didMove?: string): YonmoqueGame {
        const prev: playerid = this.currplayer === 1 ? 2 : 1;
        let reason: string|undefined;

        // regardless of didMove, 5 in a row is a loss
        if (this.checkLines(5, prev)) {
            this.gameover = true;
            this.winner = [this.currplayer];
            reason = "five";
        }
        // if didMove, then 4 in a row wins
        else if (didMove !== undefined) {
            if (this.checkLines(4, prev, didMove)) {
                this.gameover = true;
                this.winner = [prev];
                reason = "four";
            }
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog", reason},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IYonmoqueState {
        return {
            game: YonmoqueGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: YonmoqueGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            pieces: [...this.pieces],
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < 5; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < 5; col++) {
                const cell = YonmoqueGame.coords2algebraic(col, row);
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
        pstr = pstr.replace(/-{5}/g, "_");

        const markers: MarkerFlood[] = [];
        for (const tile of ["B", "N"] as const) {
            const points = [...cell2tile.keys()].filter(c => cell2tile.get(c) === tile).map(c => {
                const [x, y] = YonmoqueGame.algebraic2coords(c);
                return {col: x, row: y} as RowCol;
            });
            markers.push({
                type: "flood",
                points: points as [RowCol, ...RowCol[]],
                colour: tile === "B" ? 2 : {
                    "func": "flatten",
                    "fg": "_context_fill",
                    "bg": "_context_background",
                    "opacity": 0.25
                },
            });
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares",
                width: 5,
                height: 5,
                markers,
            },
            legend: {
                A: {
                    name: "piece",
                    colour: 2
                },
                B: {
                    name: "piece",
                    colour: "_context_background"
                }
            },
            pieces: pstr
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = YonmoqueGame.algebraic2coords(move.from);
                    const [toX, toY] = YonmoqueGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "place" || move.type === "convert") {
                    const [x, y] = YonmoqueGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }

        if (this.dots.length > 0) {
            if (!("annotations" in rep)) {
                rep.annotations = [];
            }
            const targets: RowCol[] = [];
            for (const cell of this.dots) {
                const [x, y] = YonmoqueGame.algebraic2coords(cell);
                targets.push({col: x, row: y});
            }
            rep.annotations!.push({
                type: "dots",
                targets: targets as [RowCol, ...RowCol[]],
            });
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
            case "move":
                node.push(i18next.t("apresults:MOVE.nowhat", {player, from: r.from, to: r.to}));
                resolved = true;
                break;
            case "convert":
                node.push(i18next.t("apresults:CONVERT.simple", {player, where: r.where}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.PIECESINHAND"), scores: this.pieces }
        ]
    }

    public getPlayerColour(p: playerid): number|string {
        if (p === 1) {
            return 2;
        } else {
            return "_context_background";
        }
    }

    public clone(): YonmoqueGame {
        return new YonmoqueGame(this.serialize());
    }
}
