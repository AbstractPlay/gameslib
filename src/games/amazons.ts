// import { IGame } from "./IGame";
import { GameBase } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { RectGrid } from "../common";
import { APRenderRep } from "@abstractplay/renderer/src/schema";
import { Directions } from "../common";
import { UndirectedGraph } from "graphology";
import bidirectional from 'graphology-shortest-path/unweighted';

const gameDesc:string = `# Amazons

A two-player game played on a 10x10 board. Each player has four queens (the eponymous amazons). Each turn, you move one of the queens and then shoot an arrow from your final square. The arrow causes that square to become blocked for the rest of the game. Queens and arrows cannot cross blocked squares or squares occupied by other queens. The winner is the last person who is able to move.

The game tree for Amazons, especially early in the game, is enormous, so the AI is very rudimentary.
`;

type CellContents = 0 | 1 | 2;

export interface IAmazonsState {
    currplayer: 1|2;
    board: Map<string, CellContents>;
    lastmove?: string;
    gameover: boolean;
    winner?: 1|2;
};
const columnLabels = "abcdefghijklmnopqrstuvwxyz".split("");

export class AmazonsGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Amazons",
        uid: "amazons",
        playercounts: [2],
        version: "20211005",
        description: gameDesc,
        urls: ["https://en.wikipedia.org/wiki/Amazons_%28game%29"],
        people: [
            {
                type: "designer",
                name: "Walter Zamkauskas"
            }
        ]
    };

    private buildGraph(): UndirectedGraph {
        // Build the graph
        const graph = new UndirectedGraph();
        // Nodes
        for (let row = 0; row < 10; row++) {
            for (let col = 0; col < 10; col++) {
                graph.addNode(AmazonsGame.coords2algebraic(col, row));
            }
        }
        // Edges
        for (let row = 0; row < 10; row++) {
            for (let col = 0; col < 10; col++) {
                const fromCell = AmazonsGame.coords2algebraic(col, row);
                // Connect to the right
                if (col < 9) {
                    graph.addEdge(fromCell, AmazonsGame.coords2algebraic(col + 1, row));
                }
                // Connect up
                if (row > 0) {
                    graph.addEdge(fromCell, AmazonsGame.coords2algebraic(col, row - 1));
                }
                // Up right
                if ( (row > 0) && (col < 9) ) {
                    graph.addEdge(fromCell, AmazonsGame.coords2algebraic(col + 1, row - 1));
                }
                // Up left
                if ( (row > 0) && (col > 0) ) {
                    graph.addEdge(fromCell, AmazonsGame.coords2algebraic(col - 1, row - 1));
                }
            }
        }
        // Remove blocked nodes
        this.board.forEach((v, k) => {
            if (v === 0) {
                graph.dropNode(k);
            }
        });
        return graph;
    }

    public static coords2algebraic(x: number, y: number): string {
        return columnLabels[x] + (10 - y).toString();
    }

    public static algebraic2coords(cell: string): [number, number] {
        const pair: string[] = cell.split("");
        const num = (pair.slice(1)).join("");
        const x = columnLabels.indexOf(pair[0]);
        if ( (x === undefined) || (x < 0) ) {
            throw new Error(`The column label is invalid: ${pair[0]}`);
        }
        const y = parseInt(num, 10);
        if ( (y === undefined) || (isNaN(y)) ) {
            throw new Error(`The row label is invalid: ${pair[1]}`);
        }
        return [x, 10 - y];
    }

    public currplayer: 1|2;
    public board: Map<string, CellContents>;
    public lastmove?: string;
    public gameover: boolean = false;
    public winner?: 1|2;
    public graph: UndirectedGraph;

    constructor(state?: IAmazonsState) {
        super();
        if (state !== undefined) {
            this.currplayer = state.currplayer;
            this.board = new Map(state.board);
            this.lastmove = state.lastmove;
            this.gameover = state.gameover;
        } else {
            this.currplayer = 1;
            this.board = new Map([
                ["d10", 2],
                ["g10", 2],
                ["a7", 2],
                ["j7", 2],
                ["a4", 1],
                ["j4", 1],
                ["d1", 1],
                ["g1", 1]
            ]);
        }
        this.graph = this.buildGraph();
    }

    public moves(player?: 1|2): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        const grid = new RectGrid(10, 10);
        const dirs: Directions[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
        // Find the player's pieces
        const from: string[] = [];
        this.board.forEach((v, k) => {
            if (v === player) {
                from.push(k);
            }
        });
        const moves: Array<[string, string]> = [];
        from.forEach((fromCell) => {
            dirs.forEach((dir) => {
                const [x, y] = AmazonsGame.algebraic2coords(fromCell);
                const ray = grid.ray(x, y, dir);
                for (const cell of ray) {
                    const toCell = AmazonsGame.coords2algebraic(cell[0], cell[1]);
                    if (this.board.has(toCell)) {
                        break;
                    }
                    moves.push([fromCell, toCell]);
                }
            });
        });
        // For each move
        const finals: Array<[string, string, string]> = [];
        moves.forEach((m) => {
            dirs.forEach((dir) => {
                const [x, y] = AmazonsGame.algebraic2coords(m[1]);
                const ray = grid.ray(x, y, dir);
                for (const cell of ray) {
                    const toCell = AmazonsGame.coords2algebraic(cell[0], cell[1]);
                    if ( (this.board.has(toCell)) && (toCell !== m[0]) ) {
                        break;
                    }
                    finals.push([m[0], m[1], toCell]);
                }
            });
        });
        const allmoves: string[] = [];
        finals.forEach((move) => {
            allmoves.push(move[0] + "-" + move[1] + "/" + move[2]);
        });
        return allmoves;
    }

    public move(m: string): AmazonsGame {
        const moves = this.moves();
        if (! moves.includes(m)) {
            throw new Error(`Invalid move: ${m}\nRender rep:\n${JSON.stringify(this.render())}`);
        }
        const cells: string[] = m.split(new RegExp('[\-\/]'));
        this.board.delete(cells[0]);
        this.board.set(cells[1], this.currplayer);
        this.board.set(cells[2], 0);
        this.graph.dropNode(cells[2]);
        this.lastmove = m;
        if (this.currplayer === 1) {
            this.currplayer = 2;
        } else {
            this.currplayer = 1;
        }

        return this;
    }

    public checkEOG(): boolean {
        if (this.moves().length === 0) {
            this.gameover = true;
            if (this.currplayer === 1) {
                this.winner = 2;
            } else {
                this.winner = 1;
            }
        }
        return this.gameover;
    }

    public resign(player: 1|2): AmazonsGame {
        this.gameover = true;
        if (player === 1) {
            this.winner = 2;
        } else {
            this.winner = 1;
        }
        return this;
    }

    public state(): IAmazonsState {
        return {
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            gameover: this.gameover,
            winner: this.winner
        };
    }

    public findPieces(): string[] {
        const pieces: string[] = [];
        this.board.forEach((v, k) => {
            if (v !== 0) {
                pieces.push(k);
            }
        });
        return pieces;
    }

    public areIsolated(): boolean {
        const pieces = this.findPieces();
        // Test if any queens are connected
        for (let from = 0; from < pieces.length - 1; from++) {
            for (let to = from + 1; to < pieces.length; to++) {
                const path = bidirectional(this.graph, pieces[from], pieces[to]);
                if (path !== null) {
                    return false;
                }
            }
        }
        return true;
    }

    public territory(): [number, number] {
        const t: [number, number] = [0, 0];
        const pieces = this.findPieces();
        pieces.forEach((start) => {
            const player = this.board.get(start);
            const counted: Set<string> = new Set();
            const toCheck: Set<string> = new Set([start]);
            const visited: Set<string> = new Set();
            while (toCheck.size > 0) {
                const cell = toCheck.values().next().value;
                toCheck.delete(cell);
                if (! visited.has(cell)) {
                    visited.add(cell);
                    const adjs = this.graph.neighbors(cell);
                    adjs.forEach((adj) => {
                        if (! this.board.has(adj)) {
                            toCheck.add(adj);
                            counted.add(adj);
                        }
                    });
                }
            }
            if (player === 1) {
                t[0] += counted.size;
            } else if (player === 2) {
                t[1] += counted.size;
            } else {
                throw new Error("Could not attribute territory to a single player. This should never happen.");
            }
        });
        return t;
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr: string = "";
        for (let row = 0; row < 10; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            for (let col = 0; col < 10; col++) {
                const cell = AmazonsGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell);
                    switch (contents) {
                        case 0:
                            pstr += "X";
                            break;
                        case 1:
                            pstr += "R";
                            break;
                        case 2:
                            pstr += "B";
                            break;
                        default:
                            throw new Error("Unrecognized cell contents. This should never happen.");
                    }
                } else {
                    pstr += "-";
                }
            }
        }
        pstr = pstr.replace(/\-{10}/g, "_");

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-checkered",
                width: 10,
                height: 10
            },
            legend: {
                R: {
                    name: "chess-queen-solid-millenia",
                    player: 1
                },
                B: {
                    name: "chess-queen-solid-millenia",
                    player: 2
                },
                X: {
                    name: "piece-square",
                    colour: "#000"
                }
            },
            pieces: pstr
        };

        // Add annotations
        if (this.lastmove !== undefined) {
            const cells: string[] = this.lastmove.split(new RegExp('[\-\/]'));
            if (cells.length !== 3) {
                throw new Error(`Malformed last move: ${this.lastmove}`);
            }
            const [xFrom, yFrom] = AmazonsGame.algebraic2coords(cells[0]);
            const [xTo, yTo] = AmazonsGame.algebraic2coords(cells[1]);
            const [xArrow, yArrow] = AmazonsGame.algebraic2coords(cells[2]);
            rep.annotations = [
                {
                    type: "move",
                    targets: [
                        {col: xTo, row: yTo},
                        {col: xArrow, row: yArrow}
                    ],
                    style: "dashed"
                },
                {
                    type: "move",
                    targets: [
                        {col: xFrom, row: yFrom},
                        {col: xTo, row: yTo}
                    ]
                }
            ];
        }

        return rep;
    }
}
