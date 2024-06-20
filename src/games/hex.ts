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

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    connPath: string[];
    lastmove?: string;
};

export interface IHexState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

type PlayerLines = [string[], string[]];

export class HexGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Hex",
        uid: "hex",
        playercounts: [2],
        version: "20240101",
        dateAdded: "2024-01-03",
        // i18next.t("apgames:descriptions.hex")
        description: "apgames:descriptions.hex",
        urls: ["https://en.wikipedia.org/wiki/Hex_(board_game)"],
        people: [
            {
                type: "designer",
                name: "Piet Hein",
            },
            {
                type: "designer",
                name: "John Nash",
            },
        ],
        categories: ["goal>connect", "mechanic>place", "board>shape>rect", "board>connect>hex", "components>simple>1per"],
        flags: ["pie"],
        variants: [
            {
                uid: "size-11",
                group: "board",
            },
            {
                uid: "size-15",
                group: "board",
            },
            {
                uid: "size-19",
                group: "board",
            },
        ]
    };

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

    constructor(state?: IHexState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: HexGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new Map(),
                connPath: [],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IHexState;
            }
            if (state.game !== HexGame.gameinfo.uid) {
                throw new Error(`The Hex engine cannot process a game of '${state.game}'.`);
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

    public load(idx = -1): HexGame {
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
        return 13;
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
        for (const cell of empties) {
            moves.push(cell);
        }

        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove = "";
            const cell = this.graph.coords2algebraic(col, row);
            // If you click on an occupied cell, clear the entry
            if (this.board.has(cell)) {
                return {move: "", message: ""} as IClickResult;
            } else {
                newmove = cell;
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
            result.message = i18next.t("apgames:validation.hex.INITIAL_INSTRUCTIONS");
            return result;
        }

        const cell = m;
        // valid cell
        try {
            this.graph.algebraic2coords(cell);
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
            return result;
        }
        // cell is empty
        if (this.board.has(cell)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: cell});
            return result;
        }

        // we're good
        result.valid = true;
        result.complete = 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");

        return result;
    }

    public move(m: string, {trusted = false} = {}): HexGame {
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
            if (! this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];
        this.board.set(m, this.currplayer);
        this.results.push({type: "place", where: m});

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

    protected checkEOG(): HexGame {
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

    public state(): IHexState {
        return {
            game: HexGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: HexGame.gameinfo.version,
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
                    } else {
                        pieces.push("B");
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr.push(pieces);
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "hex-slanted",
                width: this.boardSize,
                height: this.boardSize,
                markers: [
                    { type: "edge", edge: "N", colour: 1 },
                    { type: "edge", edge: "S", colour: 1 },
                    { type: "edge", edge: "W", colour: 2 },
                    { type: "edge", edge: "E", colour: 2 },
                ],
            },
            options: ["reverse-letters"],
            legend: {
                A: {
                    name: "piece",
                    colour: 1
                },
                B: {
                    name: "piece",
                    colour: 2
                },
            },
            pieces: pstr.map(p => p.join("")).join("\n"),
            key: []

        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
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

    public clone(): HexGame {
        return new HexGame(this.serialize());
    }
}
