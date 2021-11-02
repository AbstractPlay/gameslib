// import { IGame } from "./IGame";
import { GameBase, IAPGameState, IIndividualState } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schema";
import { RectGrid } from "../common";
import { Directions } from "../common";
import { APMoveResult } from "../schemas/moveresults";
import { reviver } from "../common/serialization";
import { shuffle } from "../common/shuffle";

const gameDesc:string = `# Entropy

Entropy is a 2-player game representing the struggle between Order and Chaos. The Order player tries to organize their board in such a way to score the highest amount. Chaos, of course, attempts to thwart Order whenever possible.

This implementation provides a simultaneous environment where each player has their own Order board. Each player places a piece on their opponent's Order board and then makes a move on their own board, players acting as both Order and Chaos at the same time. The player with the greatest score wins! Since both players share the same randomized pool of pieces, this approach gives the cleanest measure of skill.
`;

type playerid = 1|2;
type CellContents = "A"|"B"|"C"|"D"|"E"|"F"|"G";
type Phases = "order"|"chaos";
const startBag: string = "AAAAAAABBBBBBBCCCCCCCDDDDDDDEEEEEEEFFFFFFFGGGGGGG";

interface ICountObj {
    [key: string]: number;
}

export interface IMoveState extends IIndividualState {
    board1: Map<string, CellContents>;
    board2: Map<string, CellContents>;
    phase: Phases;
    bag: CellContents[];
    lastmove: string[];
};

export interface IEntropyState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class EntropyGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Entropy",
        uid: "entropy",
        playercounts: [2],
        version: "20211101",
        description: gameDesc,
        urls: [
            "https://boardgamegeek.com/boardgame/1329/hyle",
        ],
        people: [
            {
                type: "designer",
                name: "Eric Solomon"
            }
        ]
    };
    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 7);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 7);
    }

    public numplayers: number = 2;
    public board1!: Map<string, CellContents>;
    public board2!: Map<string, CellContents>;
    public bag!: CellContents[];
    public phase!: Phases;
    public lastmove: string[] = [];
    public gameover: boolean = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = []
    public variants: string[] = [];

    constructor(state?: IEntropyState | string) {
        super();
        if (state !== undefined) {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IEntropyState;
            }
            if (state.game !== EntropyGame.gameinfo.uid) {
                throw new Error(`The Entropy game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.stack = [...state.stack];
        } else {
            const fresh: IMoveState = {
                _version: EntropyGame.gameinfo.version,
                _results: [],
                lastmove: [],
                bag: shuffle(startBag.split("")),
                board1: new Map(),
                board2: new Map(),
                phase: "chaos"
            };
            this.stack = [fresh];
        }
        this.load();
    }

    public load(idx: number = -1): EntropyGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.board1 = new Map(state.board1);
        this.board2 = new Map(state.board2);
        this.bag = [...state.bag];
        this.phase = state.phase;
        this.lastmove = state.lastmove;
        return this;
    }

    public moves(player: 1|2): string[] {
        if (this.gameover) {
            return [];
        }
        const moves: string[] = [];
        if (this.phase === "chaos") {
            let theirBoard: Map<string, CellContents> = this.board2;
            if (player === 2) {
                theirBoard = this.board1;
            }
            for (let row = 0; row < 7; row++) {
                for (let col = 0; col < 7; col++) {
                    const cell = EntropyGame.coords2algebraic(col, row);
                    if (! theirBoard.has(cell)) {
                        moves.push(cell);
                    }
                }
            }
        } else {
            let myBoard: Map<string, CellContents> = this.board1;
            if (player === 2) {
                myBoard = this.board2;
            }
            const grid = new RectGrid(7, 7);
            for (const cell of myBoard.keys()) {
                const coords = EntropyGame.algebraic2coords(cell);
                for (const dir of ["N" as Directions, "E" as Directions, "S" as Directions, "W" as Directions]) {
                    let ray = grid.ray(...coords, dir);
                    while ( (ray.length > 0) && (! myBoard.has(EntropyGame.coords2algebraic(...ray[0]))) ) {
                        moves.push(`${cell}-${EntropyGame.coords2algebraic(...ray[0])}`);
                        ray = ray.slice(1);
                    }
                }
            }
            moves.push("pass");
        }
        return moves;
    }

    public randomMove(): string {
        const moves1 = this.moves(1);
        const move1 = moves1[Math.floor(Math.random() * moves1.length)];
        const moves2 = this.moves(2);
        const move2 = moves2[Math.floor(Math.random() * moves2.length)];
        return `${move1}, ${move2}`;
    }

    public move(m: string): EntropyGame {
        if (this.gameover) {
            throw new Error("You cannot make moves in concluded games.");
        }
        const moves: string[] = m.split(/,\s*/);
        if (moves.length !== 2) {
            throw new Error("Did not find moves for both players. Moves must be submitted simultaneously.");
        }
        for (let i = 0; i < moves.length; i++) {
            if (! this.moves((i + 1) as playerid).includes(moves[i])) {
                throw new Error(`Invalid move ${moves[i]}`);
            }
        }
        this.lastmove = [...moves];
        const myboard = [this.board1, this.board2];
        const theirboard = [this.board2, this.board1];
        this.results = [];
        let next: CellContents | undefined;
        if (this.phase === "chaos") {
            next = this.bag.pop();
        }
        for (let i = 0; i < moves.length; i++) {
            if (moves[i] === "pass") {
                this.results.push({type: "pass"});
                continue;
            } else if (moves[i].includes("-")) {
                const [from, to] = moves[i].split("-");
                const piece = myboard[i].get(from);
                if (piece === undefined) {
                    throw new Error(`Could not find a piece at ${from}`);
                }
                myboard[i].set(to, piece);
                myboard[i].delete(from);
                this.results.push({type: "move", from, to});
            } else {
                if (next === undefined) {
                    throw new Error("Could not find a piece to place. This should never happen.");
                }
                theirboard[i].set(moves[i], next);
                this.results.push({type: "place", what: next, where: moves[i]});
                this.lastmove[i] = `(${next})` + this.lastmove[i];
            }
        }

        if (this.phase === "chaos") {
            this.phase = "order";
        } else {
            this.phase = "chaos";
        }
        // shuffle bag after placing
        this.bag = shuffle(this.bag);

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): EntropyGame {
        if ( (this.board1.size === 49) && (this.board2.size === 49) ) {
            this.gameover = true;
            this.results.push({type: "eog"});
            const score1 = this.score(1);
            const score2 = this.score(2);
            if (score1 > score2) {
                this.winner = [1];
                this.results.push({type: "winners", players: [1]});
            } else if (score2 > score1) {
                this.winner = [2];
                this.results.push({type: "winners", players: [2]});
            } else {
                this.winner = [1, 2];
                this.results.push({type: "winners", players: [1, 2]});
            }
        }
        return this;
    }

    private score(player: playerid): number {
        let score = 0;
        let board = this.board1;
        if (player === 2) {
            board = this.board2;
        }
        for (let row = 0; row < 7; row++) {
            score += this.scoreLine(this.getLine(board, [0, row], "E"));
        }
        for (let col = 0; col < 7; col++) {
            score += this.scoreLine(this.getLine(board, [col, 0], "S"));
        }
        return score;
    }

    private getLine(board: Map<string, CellContents>, start: [number, number], dir: Directions): string[] {
        const grid = new RectGrid(7, 7);
        const ray = [start, ...grid.ray(...start, dir)];
        // Convert coords to algebraic
        const cells = ray.map(c => EntropyGame.coords2algebraic(...c));
        // Convert cells into contents
        const pieces = cells.map(c => {
            if (board.has(c)) {
                return board.get(c) as string;
            } else {
                return "-";
            }
        });
        return [...pieces];
    }

    private scoreLine(line: string[]): number {
        if (line.length < 2) {
            return 0;
        }
        let score = 0;
        for (let len = 2; len <= line.length; len++) {
            for (let idx = 0; idx <= line.length - len; idx++) {
                const substr = line.slice(idx, idx + len);
                if (substr.includes("-")) {
                    continue;
                }
                if (substr.join("") === substr.reverse().join("")) {
                    score += substr.length;
                }
            }
        }
        return score;
    }

    public resign(player: 1|2): EntropyGame {
        this.gameover = true;
        if (player === 1) {
            this.winner = [2];
        } else {
            this.winner = [1];
        }
        this.results = [
            {type: "eog"},
            {type: "winners", players: [...this.winner]}
        ];
        this.saveState();
        return this;
    }

    public state(): IEntropyState {
        return {
            game: EntropyGame.gameinfo.uid,
            numplayers: 2,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: EntropyGame.gameinfo.version,
            _results: [...this.results],
            lastmove: [...this.lastmove],
            board1: new Map(this.board1),
            board2: new Map(this.board2),
            phase: this.phase,
            bag: [...this.bag]
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr: string = "";
        for (let row = 0; row < 7; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            let contents1: string = "";
            let contents2: string = "";
            for (let col = 0; col < 7; col++) {
                const cell = EntropyGame.coords2algebraic(col, row);
                if (this.board1.has(cell)) {
                    contents1 += this.board1.get(cell);
                } else {
                    contents1 += "-";
                }
                if (this.board2.has(cell)) {
                    contents2 += this.board2.get(cell);
                } else {
                    contents2 += "-";
                }
            }
            pstr += contents1 + contents2;
        }
        pstr = pstr.replace(/\-{14}/g, "_");

        // Build rep
        const rep: APRenderRep =  {
            renderer: "entropy",
            board: {
                style: "entropy",
                orientation: "vertical"
            },
            legend: {
                A: {
                    name: "piece",
                    player: 1
                },
                B: {
                    name: "piece",
                    player: 2
                },
                C: {
                    name: "piece",
                    player: 3
                },
                D: {
                    name: "piece",
                    player: 4
                },
                E: {
                    name: "piece",
                    player: 5
                },
                F: {
                    name: "piece",
                    player: 6
                },
                G: {
                    name: "piece",
                    player: 7
                }
            },
            pieces: pstr
        };

        // Add annotations
        if ( (this.lastmove !== undefined) && (this.lastmove.length === 2) ) {
            // @ts-ignore
            rep.annotations = [];
            for (let i = 0; i < 2; i++) {
                const move = this.lastmove[i];
                if (move !== "pass") {
                    if (move.includes("-")) {
                        const [from, to] = move.split("-");
                        // tslint:disable-next-line: prefer-const
                        let [xFrom, yFrom] = EntropyGame.algebraic2coords(from);
                        if (i === 1) { xFrom += 7; }
                        // tslint:disable-next-line: prefer-const
                        let [xTo, yTo] = EntropyGame.algebraic2coords(to);
                        if (i === 1) { xTo += 7; }
                        rep.annotations!.push({
                            type: "move",
                            targets: [
                                {col: xFrom, row: yFrom},
                                {col: xTo, row: yTo}
                            ]
                        });
                    } else {
                        // tslint:disable-next-line: prefer-const
                        let [x, y] = EntropyGame.algebraic2coords(move);
                        if (i === 0) { x += 7; }
                        rep.annotations!.push({
                            type: "enter",
                            targets: [
                                {col: x, row: y}
                            ]
                        });
                    }
                }
            }
        }
        return rep;
    }

    public nextPiece(): CellContents {
        return this.bag[this.bag.length - 1];
    }

    public bagContents(): ICountObj {
        return this.bag.reduce((obj, item) => {
            obj[item] = (obj[item] || 0) + 1;
            return obj;
          }, {} as ICountObj);
    }

    public status(): string {
        let status = super.status();

        status += `**Current phase**: ${this.phase}\n\n`;

        if (this.phase === "chaos") {
            status += `**Piece being placed**: ${this.nextPiece()}\n\n`;
        }

        status += `**Pieces still in the bag**: ${Object.entries(this.bagContents()).sort((a, b) => { return a[0].localeCompare(b[0]); }).map(p => p.join(": ")).join(", ")}\n\n`;

        status += "**Scores**\n\n";
        status += `Player 1: ${this.score(1)}\n\n`;
        status += `Player 2: ${this.score(2)}\n\n`;
        return status;
    }
}
