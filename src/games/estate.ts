import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, RowCol } from "@abstractplay/renderer/build/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { cartesianProduct, HexTriGraph, intersects, mergePaths, permute, reviver, shuffle, UserFacingError } from "../common";
import i18next from "i18next";
import { connectedComponents } from "graphology-components";
import { UndirectedGraph } from "graphology";
import { bidirectional } from 'graphology-shortest-path/unweighted';

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
    connPath?: string[];
};

export interface IEstateState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class EstateGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Estate",
        uid: "estate",
        playercounts: [2],
        version: "20260805",
        dateAdded: "2026-08-05",
        // i18next.t("apgames:descriptions.estate")
        description: "apgames:descriptions.estate",
        urls: [
            "https://kanare-abstract.com/en-ca/pages/estate",
            "https://boardgamegeek.com/boardgame/383705/estate",
        ],
        bggid: "383705",
        people: [
            {
                type: "designer",
                name: "Kanare Kato",
                urls: ["https://kanare-abstract.com"],
                apid: "0998417b-d2b5-4a3f-8f5d-965e67b290b8",
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        customizations: [
            {
                explanation: "The colour of the concentric ring highlighting.",
                default: "#ccc",
                num: 3,
            },
            {
                explanation: "The colour of the connection path.",
                default: 3,
                num: 4,
            },
        ],
        categories: ["goal>connect", "mechanic>place", "board>shape>hex", "board>connect>hex", "components>simple>1per"],
        flags: ["experimental", "no-moves", "pie", "custom-randomization"]
    };

    public static winningEdges: string[][][] = [
        // first, pairs of opposite edges
        [
            ["i1", "i2", "i3", "i4", "i5"],
            ["a1", "a2", "a3", "a4", "a5"],
        ],
        [
            ["i5", "h6", "g7", "f8", "e9"],
            ["a1", "b1", "c1", "d1", "e1"],
        ],
        [
            ["e9", "d8", "c7", "b6", "a5"],
            ["e1", "f1", "g1", "h1", "i1"],
        ],
        // now triples of nonadjacent sides
        [
            ["i1", "i2", "i3", "i4", "i5"],
            ["e9", "d8", "c7", "b6", "a5"],
            ["a1", "b1", "c1", "d1", "e1"],
        ],
        [
            ["i5", "h6", "g7", "f8", "e9"],
            ["a1", "a2", "a3", "a4", "a5"],
            ["e1", "f1", "g1", "h1", "i1"],
        ],
    ];

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public connPath?: string[];

    constructor(state?: IEstateState | string) {
        super();
        if (state === undefined) {
            const board = new Map<string, playerid>();
            const fresh: IMoveState = {
                _version: EstateGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IEstateState;
            }
            if (state.game !== EstateGame.gameinfo.uid) {
                throw new Error(`The Estate engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): EstateGame {
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
        this.connPath = state.connPath === undefined ? undefined : [...state.connPath];
        return this;
    }

    public get graph(): HexTriGraph {
        return new HexTriGraph(5, 9);
    }

    public get ptsPerTurn(): number {
        return 5;
    }

    public randomMove(): string {
        const g = this.graph;
        const cells = g.listCells() as string[];
        const emptyCells = shuffle(cells.filter(cell => !this.board.has(cell)));
        const move: string[] = [];
        for (const cell of emptyCells) {
            const costSoFar = move.reduce((acc, cell) => acc + g.distFromEdge(cell) + 1, 0);
            if (costSoFar + g.distFromEdge(cell) + 1 <= this.ptsPerTurn) {
                move.push(cell);
            }
        }
        return move.join(",");
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        const g = this.graph;
        try {
            const cell = g.coords2algebraic(col, row);
            let sofar: string[] = [];
            if (move.length > 0) {
                sofar = move.split(",");
            }
            // if the clicked cell is already in the sofar array, remove it
            if (sofar.includes(cell)) {
                sofar = sofar.filter(c => c !== cell);
            } else {
                // if clicked cell is occupied, ignore click, otherwise add it
                if (!this.board.has(cell)) {
                    sofar.push(cell);
                }
            }
            const newmove = sofar.join(",");
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

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const g = this.graph;

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.estate.INITIAL_INSTRUCTIONS", {count: this.ptsPerTurn});
            return result;
        }

        const cells = m.split(",");
        // each cell must be empty
        for (const cell of cells) {
            if (this.board.has(cell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: cell});
                return result;
            }
        }
        // total cost may not exceed ptsPerTurn
        const cost = cells.reduce((acc, cell) => acc + g.distFromEdge(cell) + 1, 0);
        if (cost > this.ptsPerTurn) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.estate.EXCEEDS", {budget: this.ptsPerTurn, cost});
            return result;
        }

        // Looks good
        result.valid = true;
        result.canrender = true;
        result.complete = 0;
        result.message = i18next.t("apgames:validation.estate.INITIAL_INSTRUCTIONS", {count: this.ptsPerTurn - cost});
        return result;
    }

    public move(m: string, {trusted = false, partial = false} = {}): EstateGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const g = this.graph;
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
        }

        this.results = [];
        if (m.length > 0) {
            const cells = m.split(",");
            for (const cell of cells) {
                if (! this.board.has(cell)) {
                    this.board.set(cell, this.currplayer);
                    this.results.push({type: "place", where: cell, what: (g.distFromEdge(cell) + 1).toString()});
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

    /** Shortest witness path touching one cell on each edge set within a winning component. */
    private recordConnPath(graph: UndirectedGraph, edgeSets: string[][]): void {
        let bestPath: string[] = [];
        for (const comp of connectedComponents(graph)) {
            const touchCandidates = edgeSets.map(edge =>
                edge.filter(c => graph.hasNode(c) && comp.includes(c)),
            );
            if (touchCandidates.some(candidates => candidates.length === 0)) {
                continue;
            }
            for (const perm of permute(touchCandidates.map((_, i) => i))) {
                const ordered = perm.map(i => touchCandidates[i]);
                for (const cells of cartesianProduct(ordered)) {
                    let path: string[] = [];
                    let valid = true;
                    for (let i = 0; i < cells.length; i++) {
                        if (i === 0) {
                            path = [cells[0]];
                            continue;
                        }
                        const seg = bidirectional(graph, cells[i - 1], cells[i]);
                        if (seg === null) {
                            valid = false;
                            break;
                        }
                        path = mergePaths(path, seg);
                    }
                    if (valid && (bestPath.length === 0 || path.length < bestPath.length)) {
                        bestPath = path;
                    }
                }
            }
            if (bestPath.length > 0) {
                this.connPath = bestPath;
                return;
            }
        }
    }

    public edgesConnected(player?: playerid): boolean {
        if (player === undefined) {
            player = this.currplayer;
        }
        // start with the full board graph
        const graph = this.graph.graph;
        // drop any nodes not occupied by currplayer
        for (const node of [...graph.nodes()]) {
            if (! this.board.has(node)) {
                graph.dropNode(node);
            } else {
                const owner = this.board.get(node)!;
                if (owner !== player) {
                    graph.dropNode(node);
                }
            }
        }

        for (const g of connectedComponents(graph)) {
            for (const edges of EstateGame.winningEdges) {
                let connected = true;
                for (const edge of edges) {
                    if (! intersects(g, edge)) {
                        connected = false;
                        break;
                    }
                }
                if (connected) {
                    this.recordConnPath(graph, edges);
                    return true;
                }
            }
        }
        return false;
    }

    protected checkEOG(): EstateGame {
        const other = (this.currplayer === 1) ? 2 : 1;
        const isConn = this.edgesConnected(other);
        if (isConn) {
            this.gameover = true;
            this.winner = [other];
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IEstateState {
        return {
            game: EstateGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: EstateGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            connPath: this.connPath === undefined ? undefined : [...this.connPath],
        };
    }

    public render(): APRenderRep {
        const g = this.graph;
        const cells = g.listCells(true) as string[][];
        // Build piece string
        let pstr = "";
        for (const row of cells) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (const cell of row) {
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

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "hex-of-hex",
                minWidth: 5,
                maxWidth: 9,
                markers: [
                    {
                        type: "flood",
                        colour: {
                            func: "custom",
                            default: "#ccc",
                            palette: 3,
                        },
                        opacity: 0.5,
                        points: [
                            {row: 1, col: 1},
                            {row: 1, col: 2},
                            {row: 1, col: 3},
                            {row: 1, col: 4},
                            {row: 2, col: 1},
                            {row: 2, col: 5},
                            {row: 3, col: 1},
                            {row: 3, col: 6},
                            {row: 4, col: 1},
                            {row: 4, col: 7},
                            {row: 5, col: 1},
                            {row: 5, col: 6},
                            {row: 6, col: 1},
                            {row: 6, col: 5},
                            {row: 7, col: 1},
                            {row: 7, col: 2},
                            {row: 7, col: 3},
                            {row: 7, col: 4},
                            {row: 3, col: 3},
                            {row: 3, col: 4},
                            {row: 4, col: 3},
                            {row: 4, col: 5},
                            {row: 5, col: 3},
                            {row: 5, col: 4},
                        ],
                    },
                ],
            },
            legend: {
                A: {
                    name: "hex-pointy",
                    colour: 1,
                    scale: 1.2,
                },
                B: {
                    name: "hex-pointy",
                    colour: 2,
                    scale: 1.2,
                }
            },
            pieces: pstr
        };

        // Add annotations
        if (this.results.length > 0) {
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = g.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }

        if (this.connPath !== undefined && this.connPath.length > 0) {
            if (!("annotations" in rep)) {
                rep.annotations = [];
            }
            const targets: RowCol[] = [];
            for (const cell of this.connPath) {
                const [x,y] = g.algebraic2coords(cell);
                targets.push({ row: y, col: x })
            }
            rep.annotations!.push({ type: "move", targets: targets as [RowCol, ...RowCol[]], arrow: false, colour: {func: "custom", default: 3, palette: 4} });
        }


        return rep;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.estate", {player, where: r.where, what: r.what, count: Number(r.what)}));
                resolved = true;
                break;
            case "move":
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): EstateGame {
        return new EstateGame(this.serialize());
    }
}
