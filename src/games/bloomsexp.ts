/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { HexTriGraph } from "../common/graphs";
import { IKey } from "@abstractplay/renderer/build/renderers/_base";

export type playerid = 1|2;
export type tileid = 1|2;
const tileNames = ["dark", "light"];  // For tileid 1 and 2

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, [playerid, tileid]>;
    lastmove?: string;
    scores: number[];
};

export interface IBloomsExpState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class BloomsExpGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "BloomsExp",
        uid: "bloomsexp",
        playercounts: [2],
        version: "20240114",
        dateAdded: "2024-01-18",
        // i18next.t("apgames:descriptions.blooms")
        description: "apgames:descriptions.blooms",
        // i18next.t("apgames:notes.blooms")
        notes: "apgames:notes.blooms",
        // urls: ["https://www.nickbentley.games/blooms-rules/"],
        urls: ["https://boardgamegeek.com/boardgame/249095/blooms"],
        people: [
            {
                type: "designer",
                name: "Nick Bentley",
                urls: ["https://boardgamegeek.com/boardgamedesigner/7958/nick-bentley"],
                // urls: ["https://www.nickbentley.games/"],
            }
        ],
        flags: ["multistep", "scores", "no-moves", "custom-randomization", "experimental"],
        categories: ["goal>score>race", "mechanic>place", "mechanic>capture", "mechanic>enclose", "board>shape>hex", "board>connect>hex", "components>simple>2per"],
        variants: [
            {
                uid: "size-8",
                group: "board",
            },
            {
                uid: "size-10",
                group: "board",
            },
            {
                uid: "size-13",
                group: "board",
            }
        ],
        displays: [{uid: "hide-threatened"}],
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, [playerid, tileid]>;
    public graph: HexTriGraph = new HexTriGraph(7, 13);
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public scores: number[] = [0, 0];
    private threshold = 0;
    private boardSize = 0;
    private captured: Set<string>[] = [];
    private currMoveHighlight: string[] = [];

    constructor(state?: IBloomsExpState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: BloomsExpGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                scores: [0, 0],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IBloomsExpState;
            }
            if (state.game !== BloomsExpGame.gameinfo.uid) {
                throw new Error(`The BloomsExp engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): BloomsExpGame {
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
        this.scores = [...state.scores];
        this.boardSize = this.getBoardSize();
        this.threshold = this.getThreshold();
        this.buildGraph();
        return this;
    }

    private getBoardSize(): number {
        // Get board size from variants.
        if ( (this.variants !== undefined) && (this.variants.length > 0) && (this.variants[0] !== undefined) && (this.variants[0].length > 0) ) {
            const sizeVariants = this.variants.filter(v => v.includes("size"));
            if (sizeVariants.length > 0) {
                const size = sizeVariants[0].match(/\d+/);
                return parseInt(size![0], 10);
            }
            if (isNaN(this.boardSize)) {
                throw new Error(`Could not determine the board size from variant "${this.variants[0]}"`);
            }
        }
        return 6;
    }

    private getThreshold(): number {
        return 100;
    }

    private getGraph(): HexTriGraph {
        return new HexTriGraph(this.boardSize, this.boardSize * 2 - 1);
    }

    private buildGraph(): BloomsExpGame {
        this.graph = this.getGraph();
        return this;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];
        const empties = (this.graph.listCells() as string[]).filter(c => ! this.board.has(c)).sort();
        // Get singles
        for (const cell of empties) {
            moves.push("1" + cell);
            moves.push("2" + cell);
        }
        // Get doubles
        if (this.stack.length > 1) {
            for (let i = 0; i < empties.length; i++) {
                for (let j = 0; j < empties.length; j++) {
                    if (i === j) { continue; }
                    moves.push(`1${empties[i]},2${empties[j]}`);
                }
            }
        }
        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    private splitTileCell(move: string): [tileid, string] {
        // Split the move into tile and cell.
        const tile = parseInt(move[0], 10);
        const cell = move.slice(1);
        if (tile !== 1 && tile !== 2) {
            throw new Error(`Invalid tile: ${tile}`);
        }
        return [tile as tileid, cell];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = "";
            const cell = this.graph.coords2algebraic(col, row);
            if ((piece === "1" || piece === "2") && row === -1) {
                newmove = piece;
            } else if (move === "") {
                newmove = `1${cell}`;
            } else if (move === "1" || move === "2") {
                if (row === -1) {
                    newmove = move;
                } else {
                    newmove = `${move}${cell}`;
                }
            } else {
                const moves = move.split(",");
                if (moves.length === 1) {
                    const [tile, oldCell] = this.splitTileCell(moves[0]);
                    if (oldCell === cell) {
                        // Swap tile.
                        newmove = `${tile % 2 + 1}${cell}`;
                    } else if (tile === 1) {
                        newmove = `${moves[0]},2${cell}`;
                    } else {
                        newmove = `1${cell},${moves[0]}`;
                    }
                } else {
                    const [, cell1] = this.splitTileCell(moves[0]);
                    const [, cell2] = this.splitTileCell(moves[1]);
                    if (cell1 === cell || cell2 === cell) {
                        // Swap tiles.
                        newmove = `1${cell2},2${cell1}`;
                    } else {
                        return {
                            move,
                            valid: false,
                            message: i18next.t("apgames:validation.blooms.TOO_MANY_MOVES"),
                        };
                    }
                }
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
            };
        }
    }

    private normaliseMove(move: string): string {
        // Normalise a move by sorting the cells.
        move = move.toLowerCase();
        move = move.replace(/\s+/g, "");
        const moves = move.split(",").sort();
        return moves.join(",");
    }

    public sameMove(move1: string, move2: string): boolean {
        // Check if two moves are the same.
        return this.normaliseMove(move1) === this.normaliseMove(move2);
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        if (m.length === 0) {
            if (this.stack.length === 1) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.blooms.INITIAL_INSTRUCTIONS_FIRST");
                return result;
            }
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.blooms.INITIAL_INSTRUCTIONS");
            return result;
        }

        if (m.length === 1) {
            if (m === '1' || m === '2') {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.blooms.DESTINATION");
                return result;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.blooms.INVALID_PIECE", { piece: m });
                return result;
            }
        }
        m = this.normaliseMove(m);
        const moves = m.split(",");
        // Don't exceed count
        if (moves.length > 2) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.blooms.TOO_MANY_MOVES");
            return result;
        }
        if (this.stack.length === 1 && moves.length > 1) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.blooms.TOO_MANY_MOVES_FIRST");
            return result;
        }

        // Valid tile
        let badTile;
        for (const move of moves) {
            const tile = move[0];
            if (tile !== "1" && tile !== "2") {
                badTile = tile;
                break;
            }
        }
        if (badTile) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.blooms.INVALIDTILE", {cell: badTile});
            return result;
        }

        // Valid cell
        let currentMove;
        try {
            for (const move of moves) {
                currentMove = move
                const [, checkCell] = this.splitTileCell(move);
                this.graph.algebraic2coords(checkCell);
            }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: currentMove});
            return result;
        }

        // Cell is empty
        let notEmpty;
        for (const move of moves) {
            const [, checkCell] = this.splitTileCell(move);
            if (this.board.has(checkCell)) { notEmpty = checkCell; break; }
        }
        if (notEmpty) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: notEmpty});
            return result;
        }

        // No duplicate cells.
        const [move1, move2] = moves;
        if (move2 === undefined) {
            if (this.stack.length > 1) {
                result.valid = true;
                result.complete = 0;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.blooms.PLACE_NEXT");
                return result;
            } else {
                result.valid = true;
                // We can also make complete = 0 here to allow swapping tile type on first move
                // but for now, I've decided to just set complete = 1 because there's no real reason
                // to prefer tile 2 over tile 1 on the first move.
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
        } else {
            const [tile1, cell1] = this.splitTileCell(move1);
            const [tile2, cell2] = this.splitTileCell(move2);
            if (cell1 === cell2) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.blooms.SAME_CELL", {where: cell1});
                return result;
            }
            if (tile1 === tile2) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.blooms.SAME_TILE", {tile: tile1});
                return result;
            }
        }

        // we're good
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, { partial = false, trusted = false } = {}): BloomsExpGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = this.normaliseMove(m);
        const moves = m.split(",");

        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (!partial && !this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        if (m.length === 0 || m === "1" || m === "2") { return this; }

        this.results = [];
        for (const move of moves) {
            const [tile, cell] = this.splitTileCell(move);
            this.board.set(cell, [this.currplayer, tile]);
            this.results.push({type: "place", where: cell, what: tile === 1 ? tileNames[0] : tileNames[1]});
            this.currMoveHighlight.push(cell);
        }
        this.captured = this.toCapture(this.currplayer % 2 + 1 as playerid);
        if (partial) { return this; }
        this.currMoveHighlight = [];
        const threatenedGroups = this.captured;
        for (const group of threatenedGroups) {
            // get tile of arbitrary member
            const [, tile] = this.board.get(group.values().next().value as string)!;
            for (const cell of group) {
                this.board.delete(cell);
            }
            this.results.push({type: "capture", where: Array.from(group).join(","), what: tile === 1 ? tileNames[0] : tileNames[1], count: group.size});
            this.scores[this.currplayer - 1] += group.size;
        }

        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    private pieces(player: playerid, tile: tileid): string[] {
        // Get all pieces owned by `player` and is `tile`.
        return [...this.board.entries()].filter(e => (e[1][0] === player) && (e[1][1] === tile)).map(e => e[0]);
    }

    private getGroups(player: playerid, tile: tileid): Set<string>[] {
        // Get groups of cells that are connected to `cell` and owned by `player` and is `tile`.
        const groups: Set<string>[] = [];
        const pieces = this.pieces(player, tile);
        const seen: Set<string> = new Set();
        for (const piece of pieces) {
            if (seen.has(piece)) {
                continue;
            }
            const group: Set<string> = new Set();
            const todo: string[] = [piece]
            while (todo.length > 0) {
                const cell = todo.pop()!;
                if (seen.has(cell)) {
                    continue;
                }
                group.add(cell);
                seen.add(cell);
                const neighbours = this.graph.neighbours(cell);
                for (const n of neighbours) {
                    if (pieces.includes(n)) {
                        todo.push(n);
                    }
                }
            }
            groups.push(group);
        }
        return groups;
    }

    private toCapture(player: playerid): Set<string>[] {
        // Get all pieces owned by `player` that are captured.
        const captured: Set<string>[] = [];
        for (const tile of [1, 2] as tileid[]) {
            const groups = this.getGroups(player, tile);
            loop:
            for (const group of groups) {
                for (const cell of group) {
                    for (const n of this.graph.neighbours(cell)) {
                        if (!this.board.has(n)) { continue loop; }
                    }
                }
                captured.push(group);
            }
        }
        return captured;
    }

    protected checkEOG(): BloomsExpGame {
        const prevPlayer = this.currplayer % 2 + 1 as playerid;
        if (this.scores[prevPlayer - 1] >= this.threshold) {
            this.gameover = true;
            this.winner = [prevPlayer];
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }

        return this;
    }

    public state(): IBloomsExpState {
        return {
            game: BloomsExpGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    public moveState(): IMoveState {
        return {
            _version: BloomsExpGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            scores: [...this.scores],
        };
    }

    public render(opts?: { altDisplay: string | undefined }): APRenderRep {
        let altDisplay: string | undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }
        let showThreatened = true;
        if (altDisplay !== undefined) {
            if (altDisplay === "hide-threatened") {
                showThreatened = false;
            }
        }
        // Build piece string
        const captured: Set<string> = showThreatened ? this.captured.reduce((a, b) => new Set([...a, ...b]), new Set()) : new Set();
        const pstr: string[][] = [];
        const cells = this.graph.listCells(true);
        for (const row of cells) {
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const [player, tile] = this.board.get(cell)!;
                    if (player === 1) {
                        if (showThreatened && captured.has(cell)) {
                            if (tile === 1) {
                                pieces.push("E");
                            } else {
                                pieces.push("F");
                            }
                        } else {
                            if (tile === 1) {
                                pieces.push("A");
                            } else {
                                pieces.push("B");
                            }

                        }
                    } else {
                        if (showThreatened && captured.has(cell)) {
                            if (tile === 1) {
                                pieces.push("G");
                            } else {
                                pieces.push("H");
                            }
                        } else {
                            if (tile === 1) {
                                pieces.push("C");
                            } else {
                                pieces.push("D");
                            }

                        }
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr.push(pieces);
        }

        const points: { row: number, col: number }[] = [];
        for (const cell of this.currMoveHighlight) {
            const [x, y] = this.graph.algebraic2coords(cell);
            points.push({ row: y, col: x });
        }
        const markers: Array<any> | undefined = points.length !== 0 ? [{ type: "flood", colour: "#FFFF00", opacity: 0.25, points }] : undefined;

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "hex-of-hex",
                minWidth: this.boardSize,
                maxWidth: (this.boardSize * 2) - 1,
                // @ts-ignore
                markers,
            },
            legend: {
                A: [{ name: "piece", player: 1 }],
                B: [{ name: "piece", colour: "#FFF" }, { name: "piece-horse", player: 1, opacity: 0.5 }],
                C: [{ name: "piece", player: 2 }],
                D: [{ name: "piece", colour: "#FFF" }, { name: "piece-horse", player: 2, opacity: 0.5 }],
                // threatened pieces
                E: [{ name: "piece", player: 1 }, { name: "x" }],
                F: [{ name: "piece", colour: "#FFF" }, { name: "piece-horse", player: 1, opacity: 0.5 }, { name: "x" }],
                G: [{ name: "piece", player: 2 }, { name: "x" }],
                H: [{ name: "piece", colour: "#FFF" }, { name: "piece-horse", player: 2, opacity: 0.5 }, { name: "x" }],
            },
            pieces: pstr.map(p => p.join("")).join("\n"),
            key: []

        };

        // Add key so the user can click to select the color to place
        const key: IKey = {
            type: "key",
            position: "left",
            height: 0.7,
            list: [
                { piece: this.currplayer === 1 ? "A" : "C", name: "", value: "1" },
                { piece: this.currplayer === 1 ? "B" : "D", name: "", value: "2" },
            ],
            clickable: true,
        };
        rep.areas = [key];

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
                    const [x, y] = this.graph.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                } else if (move.type === "capture") {
                    const targets: {row: number, col: number}[] = [];
                    for (const m of move.where!.split(",")) {
                        const [x, y] = this.graph.algebraic2coords(m);
                        targets.push({row: y, col: x});
                    }
                    // @ts-ignore
                    rep.annotations.push({type: "exit", targets});
                }
            }
        }
        return rep;
    }

    public getPlayerScore(player: playerid): number {
        return this.scores[player - 1];
    }

    public getPlayersScores(): IScores[] {
        return [{ name: i18next.t("apgames:status.SCORES"), scores: [`${this.scores[0]} / ${this.threshold}`, `${this.scores[1]} / ${this.threshold}`] }];
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Score**:\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            status += `Player ${n}: ${this.scores[n - 1]} / ${this.threshold}\n\n`;
        }

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.blooms", {player, where: r.where, what: r.what}));
                resolved = true;
                break;
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.blooms", {player, count: r.count, what: r.what}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): BloomsExpGame {
        return new BloomsExpGame(this.serialize());
    }
}
