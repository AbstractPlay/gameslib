import { GameBase, IAPGameState, IIndividualState } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { IGraph, HexTriGraph } from "../common/graphs";
// tslint:disable-next-line: no-var-requires
const deepclone = require("rfdc/default");

const gameDesc:string = `# Accasta

Accasta is the first of Dieter Stein's stacking trilogy. The goal is to get three of your own stacks into the enemy's castle area. There are three different types of pieces in the base version. In the "Pari" variant, the movement is determined by how many friendly pieces are in the stack.
`;

export type playerid = 1|2;
export type Piece = "C"|"H"|"S";
export type CellContents = [Piece, playerid]

const distances: Map<string, number> = new Map([["S", 1], ["H", 2], ["C", 3]]);
const castles = [["a1", "a2", "a3", "a4", "b2", "b3", "b4", "c3", "c4"], ["g1", "g2", "g3", "g4", "f2", "f3", "f4", "e3", "e4"]];

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents[]>;
    lastmove?: string;
};

export interface IAccastaState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class AccastaGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Accasta",
        uid: "accasta",
        playercounts: [2],
        version: "20211116",
        description: gameDesc,
        urls: ["https://spielstein.com/games/accasta"],
        people: [
            {
                type: "designer",
                name: "Dieter Stein",
                urls: ["https://spielstein.com/"]
            }
        ],
        variants: [
            {
                uid: "pari",
                name: "Accasta Pari",
                description: "Instead of having individual piece types, pieces move depending on how many friendly pieces are in the stack. The top piece of a stack with three of your pieces will move like a chariot, two pieces like a horse, and one piece like a shield."
            },
        ],
    };

    public numplayers: number = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, CellContents[]>;
    public lastmove?: string;
    public graph: IGraph = new HexTriGraph(4, 7);
    public gameover: boolean = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IAccastaState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            const fresh: IMoveState = {
                _version: AccastaGame.gameinfo.version,
                _results: [],
                currplayer: 1,
                board: new Map([
                    ["a1", [["S", 1], ["H", 1], ["C", 1]]],
                    ["a2", [["S", 1], ["H", 1], ["C", 1]]],
                    ["a3", [["S", 1], ["H", 1], ["C", 1]]],
                    ["a4", [["S", 1], ["H", 1], ["C", 1]]],
                    ["b2", [["S", 1], ["H", 1]]],
                    ["b3", [["S", 1], ["H", 1]]],
                    ["b4", [["S", 1], ["H", 1]]],
                    ["c3", [["S", 1]]], ["c4", [["S", 1]]],

                    ["g1", [["S", 2], ["H", 2], ["C", 2]]],
                    ["g2", [["S", 2], ["H", 2], ["C", 2]]],
                    ["g3", [["S", 2], ["H", 2], ["C", 2]]],
                    ["g4", [["S", 2], ["H", 2], ["C", 2]]],
                    ["f2", [["S", 2], ["H", 2]]],
                    ["f3", [["S", 2], ["H", 2]]],
                    ["f4", [["S", 2], ["H", 2]]],
                    ["e3", [["S", 2]]], ["e4", [["S", 2]]],
                ]),
            };
            if ( (variants !== undefined) && (variants.length === 1) && (variants[0] === "pari") ) {
                this.variants = ["pari"];
                fresh.board = new Map([
                    ["a1", [["S", 1], ["S", 1], ["S", 1]]],
                    ["a2", [["S", 1], ["S", 1], ["S", 1]]],
                    ["a3", [["S", 1], ["S", 1], ["S", 1]]],
                    ["a4", [["S", 1], ["S", 1], ["S", 1]]],
                    ["b2", [["S", 1], ["S", 1]]],
                    ["b3", [["S", 1], ["S", 1]]],
                    ["b4", [["S", 1], ["S", 1]]],
                    ["c3", [["S", 1]]], ["c4", [["S", 1]]],

                    ["g1", [["S", 2], ["S", 2], ["S", 2]]],
                    ["g2", [["S", 2], ["S", 2], ["S", 2]]],
                    ["g3", [["S", 2], ["S", 2], ["S", 2]]],
                    ["g4", [["S", 2], ["S", 2], ["S", 2]]],
                    ["f2", [["S", 2], ["S", 2]]],
                    ["f3", [["S", 2], ["S", 2]]],
                    ["f4", [["S", 2], ["S", 2]]],
                    ["e3", [["S", 2]]], ["e4", [["S", 2]]],
                ]);
            }
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IAccastaState;
            }
            if (state.game !== AccastaGame.gameinfo.uid) {
                throw new Error(`The Accasta engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx: number = -1): AccastaGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = deepclone(state.board);
        this.lastmove = state.lastmove;
        return this;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];

        const playerPieces = [...this.board.entries()].filter(e => e[1][e[1].length - 1][1] === player);
        for (const [cell,] of playerPieces) {
            const movelsts = this.recurseMoves(deepclone(this.board), this.graph as HexTriGraph, player, cell, this.variants.includes("pari"));
            for (const move of movelsts) {
                moves.push(`${cell}:${move.join(",")}`)
            }
        }

        return moves;
    }

    private recurseMoves(board: Map<string, CellContents[]>, graph: HexTriGraph, player: playerid, cell: string, pari: boolean = false): string[][] {
        const moves: string[][] = [];
        // If the stack is now empty, we're done
        if (board.has(cell)) {
            const stack = board.get(cell)!;
            const [x, y] = graph.algebraic2coords(cell);
            // You can only move stacks you control
            const top = stack[stack.length - 1];
            if (top[1] === player) {
                let maxDistance = distances.get(top[0])!;
                if (pari) {
                    maxDistance = stack.filter(p => p[1] === player).length;
                }
                for (let len = 1; len <= stack.length; len++) {
                    const substack = stack.slice(stack.length - len);
                    for (const dir of ["NE", "E", "SE", "SW", "W", "NW"] as const) {
                        let ray = graph.ray(x, y, dir);
                        if (ray.length > maxDistance) {
                            ray = ray.slice(0, maxDistance);
                        }
                        for (const [xNext, yNext] of ray) {
                            const next = graph.coords2algebraic(xNext, yNext);
                            let step: string | undefined;
                            // If it's empty, movement is allowed
                            if (! board.has(next)) {
                                if (len === stack.length) {
                                    step = `-${next}`;
                                } else {
                                    step = `${len}-${next}`;
                                }
                            // Otherwise we have to validate that the stacking move is legal
                            } else {
                                const contents = board.get(next)!;
                                if (substack.length + contents.length <= 6) {
                                    const mylen = [...contents, ...substack].filter(p => p[1] === player).length;
                                    const theirlen = substack.length + contents.length - mylen;
                                    // tslint:disable-next-line: no-console
                                    if ( (mylen <= 3) && (theirlen <= 3) ) {
                                        if (len === stack.length) {
                                            step = `+${next}`;
                                        } else {
                                            step = `${len}+${next}`;
                                        }
                                    }
                                }
                            }
                            // If we found a valid move, we need to recurse
                            if (step !== undefined) {
                                // Make the move on a cloned board, which you will pass when recursing
                                const newboard = deepclone(board);
                                const remaining = stack.slice(0, stack.length - substack.length);
                                if (remaining.length > 0) {
                                    newboard.set(cell, [...remaining])
                                } else {
                                    newboard.delete(cell);
                                }
                                if (newboard.has(next)) {
                                    const contents = newboard.get(next)!;
                                    newboard.set(next, [...contents, ...substack]);
                                } else {
                                    newboard.set(next, [...substack]);
                                }
                                moves.push([step]);
                                const followups = this.recurseMoves(newboard, graph, player, cell, pari);
                                for (const fu of followups) {
                                    moves.push([step, ...fu]);
                                }
                            }
                            // If we didn't find a valid move, or we just moved on top of another stack, stop searching in this direction
                            if ( (step === undefined) || (step.includes("+")) ) {
                                break;
                            }
                        }
                    }
                }
            }
        }
        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    // Will need to be made aware of the different board types
    public click(row: number, col: number, piece: string): string {
        if (piece === '')
            return String.fromCharCode(97 + col) + (8 - row).toString();
        else
            return 'x' + String.fromCharCode(97 + col) + (8 - row).toString();
    }

    public clicked(move: string, coord: string): string {
        if (move.length > 0 && move.length < 3) {
            if (coord.length === 2)
                return move + '-' + coord;
            else
                return move + coord;
        }
        else {
            if (coord.length === 2)
                return coord;
            else
                return coord.substring(1, 3);
        }
    }

    public move(m: string): AccastaGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (! this.moves().includes(m)) {
            throw new UserFacingError("MOVES_INVALID", i18next.t("apgames:MOVES_INVALID", {move: m}));
        }

        this.results = [];
        const [cell, moves] = m.split(":");
        const steps = moves.split(",");
        for (const step of steps) {
            const fromStack = this.board.get(cell)!;
            const rStep = /^(\d*)[-+]([a-z]\d+)$/;
            const match = step.match(rStep);
            if (match === null) {
                throw new Error("Invalid move format");
            }
            let substack = [...fromStack];
            if (match[1] !== "") {
                const len = parseInt(match[1], 10);
                substack = fromStack.slice(substack.length - len);
            }
            const remaining = [...fromStack].slice(0, fromStack.length - substack.length)
            const destination = match[2];
            const toStack = this.board.get(destination);
            if (toStack === undefined) {
                this.board.set(destination, [...substack]);
            } else {
                this.board.set(destination, [...toStack, ...substack]);
            }
            if (remaining.length > 0) {
                this.board.set(cell, [...remaining]);
            } else {
                this.board.delete(cell);
            }
            this.results.push({type: "move", from: cell, to: destination});
        }

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

    protected checkEOG(): AccastaGame {
        let prevPlayer = 1;
        if (this.currplayer === 1) {
            prevPlayer = 2;
        }
        if (this.moves().length === 0) {
            this.gameover = true;
            this.winner = [prevPlayer as playerid];
        } else {
            let count = 0;
            for (const cell of castles[prevPlayer - 1]) {
                const contents = this.board.get(cell);
                if ( (contents !== undefined) && (contents[contents.length - 1][1] === this.currplayer) ) {
                    count++;
                }
            }
            if (count >= 3) {
                this.gameover = true;
                this.winner = [this.currplayer];
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

    public resign(player: playerid): AccastaGame {
        this.gameover = true;
        if (player === 1) {
            this.winner = [2];
        } else {
            this.winner = [1];
        }
        this.results = [
            {type: "resigned", player},
            {type: "eog"},
            {type: "winners", players: [...this.winner]}
        ];
        this.saveState();
        return this;
    }

    public state(): IAccastaState {
        return {
            game: AccastaGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: AccastaGame.gameinfo.version,
            _results: [...this.results],
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: deepclone(this.board),
        };
    }

    public render(): APRenderRep {
        // Build piece string
        const pstr: string[][][] = [];
        const cells = this.graph.listCells(true);
        for (const row of cells) {
            const pieces: string[][] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const str = this.board.get(cell)!.map(e => e.join(""));
                    pieces.push([...str]);
                } else {
                    pieces.push([]);
                }
            }
            pstr.push(pieces);
        }

        // Build rep
        const rep: APRenderRep =  {
            renderer: "stacking-offset",
            board: {
                style: "hex-of-tri",
                minWidth: 4,
                maxWidth: 7,
                markers: [
                    {
                        type: "shading",
                        points: [
                            {row: 0, col: 0},
                            {row: 0, col: 3},
                            {row: 2, col: 3},
                            {row: 2, col: 2},
                        ],
                        colour: 2
                    },
                    {
                        type: "shading",
                        points: [
                            {row: 6, col: 0},
                            {row: 6, col: 3},
                            {row: 4, col: 3},
                            {row: 4, col: 2},
                        ],
                        colour: 1
                    }
                ]
            },
            legend: {
                S1: {
                    name: "piece",
                    player: 1
                },
                S2: {
                    name: "piece",
                    player: 2
                },
                H1: {
                    name: "piece-horse",
                    player: 1
                },
                H2: {
                    name: "piece-horse",
                    player: 2
                },
                C1: {
                    name: "piece-chariot",
                    player: 1
                },
                C2: {
                    name: "piece-chariot",
                    player: 2
                },
            },
            // @ts-ignore
            pieces: pstr
        };
        if (this.variants.includes("pari")) {
            delete rep.legend!.H1;
            delete rep.legend!.H2;
            delete rep.legend!.C1;
            delete rep.legend!.C2;
        }

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = this.graph.algebraic2coords(move.from);
                    const [toX, toY] = this.graph.algebraic2coords(move.to);
                    rep.annotations!.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
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

    protected getVariants(): string[] | undefined {
        if ( (this.variants === undefined) || (this.variants.length === 0) ) {
            return undefined;
        }
        const vars: string[] = [];
        for (const v of this.variants) {
            for (const rec of AccastaGame.gameinfo.variants!) {
                if (v === rec.uid) {
                    vars.push(rec.name);
                    break;
                }
            }
        }
        return vars;
    }

    protected getMoveList(): any[] {
        return this.getMovesAndResults(["move", "place"]);
    }

    public chatLog(players: string[]): string[][] {
        // eog, resign, winners, place, move
        const result: string[][] = [];
        for (const state of this.stack) {
            if ( (state._results !== undefined) && (state._results.length > 0) ) {
                const node: string[] = [];
                let otherPlayer = state.currplayer + 1;
                if (otherPlayer > this.numplayers) {
                    otherPlayer = 1;
                }
                let name: string = `Player ${otherPlayer}`;
                if (otherPlayer <= players.length) {
                    name = players[otherPlayer - 1];
                }
                for (const r of state._results) {
                    switch (r.type) {
                        case "move":
                            node.push(i18next.t("apresults:MOVE.nowhat", {player: name, from: r.from, to: r.to}));
                            break;
                        case "eog":
                            node.push(i18next.t("apresults:EOG"));
                            break;
                            case "resigned":
                                let rname = `Player ${r.player}`;
                                if (r.player <= players.length) {
                                    rname = players[r.player - 1]
                                }
                                node.push(i18next.t("apresults:RESIGN", {player: rname}));
                                break;
                            case "winners":
                                const names: string[] = [];
                                for (const w of r.players) {
                                    if (w <= players.length) {
                                        names.push(players[w - 1]);
                                    } else {
                                        names.push(`Player ${w}`);
                                    }
                                }
                                node.push(i18next.t("apresults:WINNERS", {count: r.players.length, winners: names.join(", ")}));
                                break;
                        }
                }
                result.push(node);
            }
        }
        return result;
    }

    public clone(): AccastaGame {
        return new AccastaGame(this.serialize());
    }
}
