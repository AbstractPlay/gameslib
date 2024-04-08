/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { HexSlantedGraph } from "../common/graphs";
import { UndirectedGraph } from "graphology";
import { bidirectional } from "graphology-shortest-path/unweighted";

export type playerid = 1 | 2 | 3; // 3 is used for "the neural player"
const swapSymbol = "*";

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    connPath: string[];
    lastmove?: string;
};

export interface INexState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

type PlayerLines = [string[], string[]];

export class NexGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Nex",
        uid: "nex",
        playercounts: [2],
        version: "20240317",
        dateAdded: "2024-03-23",
        // i18next.t("apgames:descriptions.nex")
        description: "apgames:descriptions.nex",
        urls: ["https://boardgamegeek.com/boardgame/187651/nex"],
        people: [
            {
                type: "designer",
                name: "João Pedro Neto",
            },
        ],
        categories: ["goal>connect", "mechanic>place", "board>shape>rect", "board>connect>hex", "components>simple>3c"],
        flags: ["pie", "multistep", "rotate90"],
        variants: [
            { uid: "size-9", group: "board" },
        ]
    };

    public coords2algebraic(x: number, y: number): string {
        return this.graph.coords2algebraic(x, y);
    }

    public algebraic2coords(cell: string): [number, number] {
        return this.graph.algebraic2coords(cell);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public connPath: string[] = [];
    public graph: HexSlantedGraph;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private boardSize = 0;
    private lines: [PlayerLines,PlayerLines];
    private currMoveHighlight: string[] = [];

    constructor(state?: INexState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: NexGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                connPath: [],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as INexState;
            }
            if (state.game !== NexGame.gameinfo.uid) {
                throw new Error(`The Nex engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
        this.graph = this.getGraph();
        this.lines = this.getLines();
    }

    public load(idx = -1): NexGame {
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
        this.connPath = [...state.connPath];
        this.boardSize = this.getBoardSize();
        return this;
    }

    private getLines(): [PlayerLines,PlayerLines] {
        const lineN: string[] = [];
        const lineS: string[] = [];
        for (let x = 0; x < this.boardSize; x++) {
            const N = this.graph.coords2algebraic(x, 0);
            const S = this.graph.coords2algebraic(x, this.boardSize - 1);
            lineN.push(N);
            lineS.push(S);
        }
        const lineE: string[] = [];
        const lineW: string[] = [];
        for (let y = 0; y < this.boardSize; y++) {
            const E = this.graph.coords2algebraic(this.boardSize-1, y);
            const W = this.graph.coords2algebraic(0, y);
            lineE.push(E);
            lineW.push(W);
        }
        return [[lineN,lineS],[lineE,lineW]];
    }

    private getBoardSize(): number {
        // Get board size from variants.
        if ( (this.variants !== undefined) && (this.variants.length > 0) && (this.variants[0] !== undefined) && (this.variants[0].length > 0) ) {
            const sizeVariants = this.variants.filter(v => v.includes("size"))
            if (sizeVariants.length > 0) {
                const size = sizeVariants[0].match(/\d+/);
                return parseInt(size![0], 10);
            }
            if (isNaN(this.boardSize)) {
                throw new Error(`Could not determine the board size from variant "${this.variants[0]}"`);
            }
        }
        return 11;
    }

    private getGraph(): HexSlantedGraph {
        return new HexSlantedGraph(this.boardSize, this.boardSize);
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves: string[] = [];
        const empties = (this.graph.listCells() as string[]).filter(c => !this.board.has(c));
        // Placements
        for (const cell1 of empties) {
            for (const cell2 of empties) {
                if (cell1 === cell2) { continue; }
                moves.push(cell1 + "," + cell2);
            }
        }
        // Swaps
        const playerCells = [...this.board.entries()].filter(([,p]) => p === player).map(([c,]) => c);
        const neutralCells = [...this.board.entries()].filter(([,p]) => p === 3).map(([c,]) => c);
        for (let i = 0; i < neutralCells.length; i++) {
            for (let j = i + 1; j < neutralCells.length; j++) {
                for (const playerCell of playerCells) {
                    moves.push(this.normaliseMove(swapSymbol + playerCell + "," + neutralCells[i] + "," + neutralCells[j]));
                }
            }
        }
        if (empties.length === 1 && neutralCells.length < 2) {
            moves.push(empties[0]);
        }
        if (empties.length === 0 && neutralCells.length === 1) {
            moves.push(swapSymbol + neutralCells[0]);
        }
        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    private sort(a: string, b: string): number {
        // Sort two cells. This is necessary because "a10" should come after "a9".
        const [ax, ay] = this.algebraic2coords(a);
        const [bx, by] = this.algebraic2coords(b);
        if (ax < bx) { return -1; }
        if (ax > bx) { return 1; }
        if (ay < by) { return -1; }
        if (ay > by) { return 1; }
        return 0;
    }

    private normaliseMove(move: string): string {
        // Sort the move list so that there is a unique representation.
        move = move.toLowerCase();
        move = move.replace(/\s+/g, "");
        if (move[0] === swapSymbol) {
            const prefix = move[0] === swapSymbol ? swapSymbol : "";
            const moves = prefix === swapSymbol ? move.slice(1).split(",") : move.split(",");
            const neutrals: string[] = [];
            const players: string[] = [];
            for (const m of moves) {
                if (this.board.get(m) === 3) {
                    neutrals.push(m);
                } else {
                    players.push(m);
                }
            }
            const combined = [...players.sort((a, b) => this.sort(a, b)), ...neutrals.sort((a, b) => this.sort(a, b))];
            return prefix + combined.sort((a, b) => this.sort(a, b)).join(",");
        }
        return move;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = "";
            const cell = this.graph.coords2algebraic(col, row);
            if (move === "") {
                if (this.board.has(cell)) {
                    newmove = swapSymbol + cell;
                } else {
                    newmove = cell;
                }
            } else {
                const prefix = move[0] === swapSymbol ? swapSymbol : "";
                const moves = prefix === swapSymbol ? move.slice(1).split(",") : move.split(",");
                if (moves.includes(cell)) {
                    if (moves.length === 1) {
                        newmove = "";
                    } else {
                        newmove = this.normaliseMove(prefix + moves.filter(m => m !== cell).join(","));
                    }
                } else {
                    newmove = this.normaliseMove(prefix + [...moves, cell].join(","));
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
            result.message = i18next.t("apgames:validation.nex.INITIAL_INSTRUCTIONS");
            return result;
        }

        const isSwap = m[0] === swapSymbol;
        const moves = isSwap ? m.slice(1).split(",") : m.split(",");
        let currentMove;
        try {
            for (const p of moves) {
                currentMove = p;
                const [x, y] = this.algebraic2coords(p);
                // `algebraic2coords` does not check if the cell is on the board.
                if (x < 0 || x >= this.boardSize || y < 0 || y >= this.boardSize) {
                    throw new Error("Invalid cell");
                }
            }
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: currentMove});
            return result;
        }
        const emptyOnBoardCount = (this.graph.listCells() as string[]).filter(c => !this.board.has(c)).length;
        const neutralOnBoardCount = [...this.board.values()].filter(p => p === 3).length;
        if (isSwap) {
            for (const move of moves) {
                if (!this.board.has(move)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.NONEXISTENT", { where: move });
                    return result;
                }
                const player = this.board.get(move);
                if (player === this.currplayer % 2 + 1) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.nex.SWAP_UNCONTROLLED", { move });
                    return result;
                }
            }
            const neutralCount = moves.filter(p => this.board.get(p) === 3).length;
            const playerCount = moves.filter(p => this.board.get(p) === this.currplayer).length;
            if (playerCount > 1) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.nex.SWAP_TOO_MANY_PLAYER");
                return result;
            }
            if (neutralCount > 2) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.nex.SWAP_TOO_MANY_NEUTRAL");
                return result;
            }
            if (neutralOnBoardCount < 2) {
                if (neutralOnBoardCount === 1 && emptyOnBoardCount === 0) {
                    // Edge case: if there is only one neutral cell and no empty cell, just convert that neutral stone.
                    if (moves.length > 1) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.nex.SWAP_EDGE_CASE_TOO_MANY");
                        return result;
                    }
                    if (this.board.get(moves[0]) !== 3) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.nex.SWAP_EDGE_CASE_NOT_NEUTRAL");
                        return result;
                    }
                    result.valid = true;
                    result.complete = 1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                    return result;
                }
                result.valid = false;
                result.message = i18next.t("apgames:validation.nex.SWAP_INSUFFICIENT_NEUTRAL");
                return result;
            }
            if (moves.length < 3) {
                if (neutralCount === 0) {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.nex.PARTIAL_SWAP_TWO_NEUTRAL");
                    return result;
                }
                if (neutralCount === 1) {
                    if (playerCount === 0) {
                        result.valid = true;
                        result.complete = -1;
                        result.canrender = true;
                        result.message = i18next.t("apgames:validation.nex.PARTIAL_SWAP_ONE_EACH");
                        return result;
                    }
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.nex.PARTIAL_SWAP_ONE_NEUTRAL");
                    return result;
                }
                if (playerCount === 0) {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.nex.PARTIAL_SWAP_ONE_PLAYER");
                    return result;
                }
            }
        } else {
            for (const move of moves) {
                if (this.board.has(move)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.OCCUPIED", { where: move });
                    return result;
                }
            }
            if (moves.length > 2) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.nex.PLACE_TOO_MANY");
                return result;
            }
            if (emptyOnBoardCount === 1) {
                if (neutralOnBoardCount > 1) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.nex.EDGE_CASE_ONE_EMPTY_NEUTRAL");
                    return result;
                } else {
                    // Edge case: if there is only one empty cell and no swaps possible, just place the stone there.
                    result.valid = true;
                    result.complete = 1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                    return result;

                }
            }
            if (moves.length < 2) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.nex.PARTIAL_PLACE");
                return result;
            }
        }
        const normalised = this.normaliseMove(m);
        if (normalised !== m) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.nex.NORMALISE", { normalised });
            return result;
        }

        // we're good
        result.valid = true;
        result.complete = 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");

        return result;
    }

    public move(m: string, {partial = false, trusted = false } = {}): NexGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (! trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (!partial && !this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }
        this.results = [];
        this.currMoveHighlight = [];
        if (m.length === 0) { return this; }
        if (m[0] === swapSymbol) {
            const moves = m.slice(1).split(",");
            for (const move of moves) {
                const player = this.board.get(move);
                if (player === 3) {
                    this.board.set(move, this.currplayer);
                    this.results.push({type: "swap", where: move, who: 3});
                } else {
                    this.board.set(move, 3);
                    this.results.push({type: "swap", where: move, who: this.currplayer});
                }
                this.currMoveHighlight.push(move);
            }
        } else {
            const [m0, m1] = m.split(",");
            this.board.set(m0, this.currplayer);
            this.results.push({type: "place", where: m0, who: this.currplayer});
            this.currMoveHighlight.push(m0);
            if (m1 !== undefined) {
                this.board.set(m1, 3);
                this.results.push({type: "place", where: m1, who: 3});
                this.currMoveHighlight.push(m1);
            }
        }
        if (partial) { return this; }
        this.currMoveHighlight = [];

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
            const neighbours = this.graph.neighbours(node);
            for (const n of neighbours) {
                if (graph.hasNode(n) && !graph.hasEdge(node, n)) {
                    graph.addEdge(node, n);
                }
            }
        }
        return graph;
    }

    protected checkEOG(): NexGame {
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

    public state(): INexState {
        return {
            game: NexGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: NexGame.gameinfo.version,
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
        const pstr: string[][] = [];
        const cells = this.graph.listCells(true);
        for (const row of cells) {
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const owner = this.board.get(cell)!;
                    if (owner === 1) {
                        pieces.push("A")
                    } else if (owner === 2) {
                        pieces.push("B");
                    } else {
                        pieces.push("C");
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr.push(pieces);
        }

        const markers: Array<any> = [
            { type: "edge", edge: "N", colour: 1 },
            { type: "edge", edge: "S", colour: 1 },
            { type: "edge", edge: "W", colour: 2 },
            { type: "edge", edge: "E", colour: 2 },
        ]
        const points: { row: number, col: number }[] = [];
        for (const cell of this.currMoveHighlight) {
            const [x, y] = this.graph.algebraic2coords(cell);
            points.push({ row: y, col: x });
        }
        if (points.length > 0) {
            markers.push({ type: "flood", colour: "#FFFF00", opacity: 0.25, points })
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "hex-slanted",
                width: this.boardSize,
                height: this.boardSize,
                // @ts-ignore
                markers,
            },
            options: ["reverse-letters"],
            legend: {
                A: { name: "piece", player: 1 },
                B: { name: "piece", player: 2 },
                C: { name: "piece", player: 3 },
            },
            pieces: pstr.map(p => p.join("")).join("\n"),
            key: []

        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place" || move.type === "swap") {
                    const [x, y] = this.graph.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
            if (this.connPath.length > 0) {
                type RowCol = {row: number; col: number;};
                const targets: RowCol[] = [];
                for (const cell of this.connPath) {
                    const [x, y] = this.graph.algebraic2coords(cell);
                    targets.push({row: y, col: x})
                }
                // @ts-ignore
                rep.annotations.push({type: "move", targets, arrow: false});
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

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                if (r.who === 3) {
                    node.push(i18next.t("apresults:PLACE.nex_neutral", { player, where: r.where }));
                } else {
                    node.push(i18next.t("apresults:PLACE.nex", { player, where: r.where }));
                }
                resolved = true;
                break;
            case "swap":
                if (r.who === 3) {
                    node.push(i18next.t("apresults:SWAP.nex_neutral", { player, where: r.where }));
                } else {
                    node.push(i18next.t("apresults:SWAP.nex", { player, where: r.where }));
                }
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): NexGame {
        return new NexGame(this.serialize());
    }
}
