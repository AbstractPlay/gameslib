/* eslint-disable no-console */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, AreaKey, BoardBasic } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { HexTriGraph } from "../common/graphs";

export type playerid = 1|2;
export type tileid = 1|2;
const tileNames = ["plain", "dotted"];  // For tileid 1 and 2

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, [playerid, tileid]>;
    lastmove?: string;
    scores: number[];
};

export interface IOonpiaState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class OonpiaGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Oonpia",
        uid: "oonpia",
        playercounts: [2],
        version: "20251216",
        dateAdded: "2025-12-16",
        // i18next.t("apgames:descriptions.oonpia")
        description: "apgames:descriptions.oonpia",
        // i18next.t("apgames:notes.oonpia")
        notes: "apgames:notes.oonpia",
        urls: ["https://boardgamegeek.com/thread/3251219/oonpia-new-4-colour-hexagonal-go-like"],
        people: [
            {
                type: "designer",
                name: "Hoembla",
                urls: ["https://boardgamegeek.com/boardgamedesigner/148212/hoembla"],
                apid: "36926ace-08c0-417d-89ec-15346119abf2",
            },
            {
                type: "coder",
                name: "hoembla",
                urls: [],
                apid: "36926ace-08c0-417d-89ec-15346119abf2",
            },
        ],
        categories: ["mechanic>place", "mechanic>capture", "mechanic>enclose", "board>shape>hex", "board>connect>hex", "components>simple>2per"],
        variants: [
            { uid: "size-5", group: "board" },
            { uid: "#board", },
            { uid: "size-7", group: "board" },
            { uid: "size-8", group: "board" },
            { uid: "size-9", group: "board" },
            { uid: "size-10", group: "board" },
            { uid: "size-11", group: "board" },
            { uid: "size-12", group: "board" }
        ]
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
    private boardSize = 0;

    constructor(state?: IOonpiaState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: OonpiaGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                scores: [0, 0],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IOonpiaState;
            }
            if (state.game !== OonpiaGame.gameinfo.uid) {
                throw new Error(`The Oonpia engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): OonpiaGame {
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

    private getGraph(): HexTriGraph {
        return new HexTriGraph(this.boardSize, this.boardSize * 2 - 1);
    }

    private buildGraph(): OonpiaGame {
        this.graph = this.getGraph();
        return this;
    }

    public otherPlayer(): playerid {
        return this.currplayer === 1 ? 2 : 1;
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

    public validateMove(m: string): IValidationResult {
        // the stone type (1 or 2) comes before the coordinate, e.g. 1c3 or 2c3
        if (m.length === 0) {
            return {
                valid: true,
                complete: -1,
                canrender: true,
                message: i18next.t("apgames:validation.oonpia.INITIAL_INSTRUCTIONS"),
            }
        } else if (m.length === 1) {
            if (m === '1' || m === '2') {
                return {
                    valid: true,
                    complete: -1,
                    canrender: true,
                    message: i18next.t("apgames:validation.oonpia.DESTINATION")
                }
            } else {
                return {
                    valid: false,
                    message: i18next.t("apgames:validation._general.INVALID_MOVE", { move: m })
                }
            }
        } else {
            const coord = m.slice(1);
            try {
                this.graph.algebraic2coords(coord);
            } catch {
                return {
                    valid: false,
                    message: i18next.t("apgames:validation._general.INVALIDCELL", { move: m })
                }
            }
            if (this.board.has(coord)) {
                return {
                    valid: false,
                    message: i18next.t("apgames:validation._general.OCCUPIED", {where: coord})
                }
            }
        }

        return {
            valid: true,
            complete: 1,
            message: i18next.t("apgames:validation._general.VALID_MOVE")
        }
    }

    public move(m: string, { partial = false, trusted = false } = {}): OonpiaGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

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
        const [tile, cell] = this.splitTileCell(m);
        this.board.set(cell, [this.currplayer, tile]);
        this.results.push({type: "place", where: cell, what: tile === 1 ? tileNames[0] : tileNames[1]});

        if (partial) { return this; }

        // First capture other player's groups, then your own (if any)

        for (const group of this.deadGroups(this.otherPlayer())) {
            for (const cell of group) {
                this.board.delete(cell);
            }
            this.results.push({type: "capture", where: Array.from(group).join(","), count: group.size});
            this.scores[this.currplayer - 1] += group.size;
        }
        
        for (const group of this.deadGroups(this.currplayer)) {
            for (const cell of group) {
                this.board.delete(cell);
            }
            this.results.push({type: "capture", where: Array.from(group).join(","), count: group.size});
            this.scores[this.currplayer - 1] += group.size;
        }


        this.lastmove = m;
        this.currplayer = this.currplayer % 2 + 1 as playerid;
        this.checkEOG();
        this.saveState();
        return this;
    }

    // private piecesByTile(player: playerid, tile: tileid): string[] {
    //     // Get all pieces owned by `player` and is `tile`.
    //     return [...this.board.entries()].filter(e => (e[1][0] === player) && (e[1][1] === tile)).map(e => e[0]);
    // }

    private pieces(player: playerid): string[] {
        // Get all pieces owned by `player`
        return [...this.board.entries()].filter(e => (e[1][0] === player)).map(e => e[0]);
    }

    private getGroups(player: playerid): Set<string>[] {
        // In oonpia only alternating types are connected, so dotted pieces only connect with undotted, and vice versa.

        // Get groups of cells that are connected to `cell` and owned by `player`.
        const groups: Set<string>[] = [];
        const pieces = this.pieces(player);
        // /* eslint-disable no-console */ console.log(pieces);
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
                const myTile = this.board.get(cell)![1];
                for (const n of neighbours) {
                    if (pieces.includes(n) && this.board.get(n)![1] != myTile) {
                        todo.push(n);
                    }
                }
            }
            groups.push(group);
        }
        return groups;
    }

    private blockedCells(): {1: Set<string>, 2: Set<string>} {
        // Return all cells blocked for playing plain resp. dotted stones (by the placement restriction
        // that no 4-arc of same-type stones may occur)

        // - Iterate over all cells
        // - For each cell look at the neighbours in clockwise direction
        // - For each of these neighbours check whether it forms an arc together with the previous
        //    and/or subsequent neighbours

        const cells = this.graph.listCells() as string[];
        const blockedPlain: Set<string> = new Set();
        const blockedDotted: Set<string> = new Set();
        for (const cell of cells) {
            const neighbours = this.graph.neighbours(cell);
            if (neighbours.length < 4 || neighbours.filter(n => this.board.has(n)).length < 3) {
                continue;
            }
            for (const type of [1, 2] as tileid[]){
                for (const [baseI, baseDir] of HexTriGraph.directions.entries()) {
                    const nbCoords = this.graph.move(...this.graph.algebraic2coords(cell), baseDir);
                    if (nbCoords === undefined) { continue; }
                    const nb = this.graph.coords2algebraic(...nbCoords);
                    if (this.board.has(nb)) { continue; }
                    // Checking for 4-arcs in the circular (clockwise) neighbours around this cell at all offsets
                    let arc = false;
                    for (let offsetI = 3; offsetI <= 6; offsetI++) { // going from 3 to 6 instead of -3 to 0, because modulo of negative numbers in js is bugged
                        let arcAtOffset = true;
                        for (let i = 0; i < 4; i++) {
                            const iterDir = HexTriGraph.directions[(baseI + offsetI + i) % 6];
                            if (iterDir === baseDir) { continue; }
                            const offsetNbCoords = this.graph.move(...this.graph.algebraic2coords(cell), iterDir);
                            if (offsetNbCoords === undefined) {
                                arcAtOffset = false;
                                break;
                            } else {
                                const iCell = this.graph.coords2algebraic(...offsetNbCoords);
                                if (!this.board.has(iCell) || this.board.get(iCell)![1] !== type) {
                                    arcAtOffset = false;
                                    break;
                                }
                            }
                        }
                        if (arcAtOffset) {
                            arc = true;
                            break;
                        }
                    }
                    if (arc) {
                        (type === 1 ? blockedPlain : blockedDotted).add(nb);
                    }
                }
            }
        }
        return {1: blockedPlain, 2: blockedDotted};
    }

    private deadGroups(player: playerid): Set<string>[] {
        // Get all groups owned by `player` that are captured.
        const captured: Set<string>[] = [];
        const groups = this.getGroups(player);
        const blocked = this.blockedCells();
        loop:
        for (const group of groups) {
            for (const cell of group) {
                for (const n of this.graph.neighbours(cell)) {
                    if (!this.board.has(n)) {
                        const myTile = this.board.get(cell)![1];
                        const needTile = myTile === 1 ? 2 : 1;
                        if (!blocked[needTile].has(n)) {
                            continue loop;
                        }
                    }
                }
            }
            captured.push(group);
        }
        return captured;
    }

    protected checkEOG(): OonpiaGame {
        // Two passes

        // const prevPlayer = this.currplayer % 2 + 1 as playerid;
        // if (this.scores[prevPlayer - 1] >= this.threshold) {
        //     this.gameover = true;
        //     this.winner = [prevPlayer];
        // }

        // if (this.gameover) {
        //     this.results.push(
        //         {type: "eog"},
        //         {type: "winners", players: [...this.winner]}
        //     );
        // }

        return this;
    }

    public state(): IOonpiaState {
        return {
            game: OonpiaGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    public moveState(): IMoveState {
        return {
            _version: OonpiaGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            scores: [...this.scores],
        };
    }

    public render(): APRenderRep {
        // Build piece string
        const pstr: string[][] = [];
        const cells = this.graph.listCells(true);
        for (const row of cells) {
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const [player, tile] = this.board.get(cell)!;
                    if (player === 1) {
                        if (tile === 1) {
                            pieces.push("A");
                        } else {
                            pieces.push("B");
                        }
                    } else {
                        if (tile === 1) {
                            pieces.push("C");
                        } else {
                            pieces.push("D");
                        }
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr.push(pieces);
        }

        const s = this.boardSize - 1;
        const boardcol = "#e0bb6c"; // colours from besogo viewer together with #252525,  #eeeeee and #0165fc
        const boardEdgeW = 55;

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "hex-of-tri",
                minWidth: this.boardSize,
                maxWidth: this.boardSize * 2 - 1,
                strokeWeight: 0.5,
                markers: [
                    {
                        type: "shading",
                        belowGrid: true,
                        points: [
                            { row: 0, col: 0 },
                            { row: 0, col: s },
                            { row: s, col: s*2 },
                            { row: s*2, col: s },
                            { row: s*2, col: 0 },
                            { row: s, col: 0 },
                        ],
                        colour: boardcol,
                        opacity: 1,
                    },
                    {
                        type: "line",
                        belowGrid: true,
                        points: [
                            { row: 0, col: 0 },
                            { row: 0, col: s}
                        ],
                        colour: boardcol,
                        width: boardEdgeW,
                    },
                    {
                        type: "line",
                        belowGrid: true,
                        points: [
                            { row: 0, col: s },
                            { row: s, col: s*2 },
                        ],
                        colour: boardcol,
                        width: boardEdgeW,
                    },
                    {
                        type: "line",
                        belowGrid: true,
                        points: [
                            { row: s, col: s*2 },
                            { row: s*2, col: s },
                        ],
                        colour: boardcol,
                        width: boardEdgeW,
                    },
                    {
                        type: "line",
                        belowGrid: true,
                        points: [
                            { row: s*2, col: s },
                            { row: s*2, col: 0 },
                        ],
                        colour: boardcol,
                        width: boardEdgeW,
                    },
                    {
                        type: "line",
                        belowGrid: true,
                        points: [
                            { row: s*2, col: 0 },
                            { row: s, col: 0 },
                        ],
                        colour: boardcol,
                        width: boardEdgeW,
                    },
                    {
                        type: "line",
                        belowGrid: true,
                        points: [
                            { row: s, col: 0 },
                            { row: 0, col: 0 },
                        ],
                        colour: boardcol,
                        width: boardEdgeW,
                    }
                ]
            },
            legend: {
                A: {name: "piece-borderless", colour: 1, scale: 1.1},
                B: [
                    {name: "piece-borderless", colour: 1, scale: 1.1},
                    {name: "piece-borderless", colour: {
                            func: "bestContrast",
                            bg: 1,
                            fg: ["#000000", "#ffffff"],
                        }, scale: 0.363, opacity: 0.5}
                ],
                C: {name: "piece-borderless", colour: 2, scale: 1.1},
                D: [
                    {name: "piece-borderless", colour: 2, scale: 1.1},
                    {name: "piece-borderless", colour: {
                            func: "bestContrast",
                            bg: 2,
                            fg: ["#000000", "#ffffff"],
                        }, scale: 0.363, opacity: 0.5}
                ],
            },
            pieces: pstr.map(p => p.join("")).join("\n"),
        };

        // Add key so the user can click to select the color to place
        const key: AreaKey = {
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
        const {1: blockedPlain, 2: blockedDotted} = this.blockedCells();
        for (const cell of blockedPlain) {
            const [x, y] = this.graph.algebraic2coords(cell);
            if ("markers" in (rep.board! as BoardBasic)) { // make the compiler happy
                ((rep.board! as BoardBasic).markers!).push({
                            type: "dots",
                            points: [{row: y, col: x}],
                            colour: "#000",
                            opacity: 0.3,
                            size: 0.3
                        })
            }
        }
        for (const cell of blockedDotted) {
            const [x, y] = this.graph.algebraic2coords(cell);
            if ("markers" in (rep.board! as BoardBasic)) { // make the compiler happy
                ((rep.board! as BoardBasic).markers!).push({
                            type: "dots",
                            points: [{row: y, col: x}],
                            colour: "#000",
                            opacity: 0.3,
                            size: 0.9
                        })
            }
        }
        console.log("yep");

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
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
                    rep.annotations.push({type: "exit", targets: targets as [{row: number; col: number;}, ...{row: number; col: number;}[]]});
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

        status += "**Score**:\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            status += `Player ${n}: ${this.scores[n - 1]}\n\n`;
        }

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.oonpia", {player, where: r.where, what: r.what}));
                resolved = true;
                break;
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.oonpia", {player, count: r.count, what: r.what}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): OonpiaGame {
        return new OonpiaGame(this.serialize());
    }
}
