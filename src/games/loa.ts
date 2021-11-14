import { GameBase, IAPGameState, IIndividualState } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, UserFacingError, Directions } from "../common";
import i18next from "i18next";

const gameDesc:string = `# Lines of Action

A classic game where you try to gather all your pieces into a single connected group. Pieces can only move the exact number of spaces as the number of pieces that lie along the line of movement. This implementation uses a 9x9 board and has a "black hole" in the centre of it. Landing on the black hole means the piece is removed from the game. Simultaneous connections are scored as a draw. The "Scrambled Eggs" initial layout variant is supported.
`;

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface ILinesOfActionState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class LinesOfActionGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Lines of Action",
        uid: "loa",
        playercounts: [2],
        version: "20211113",
        description: gameDesc,
        urls: ["https://en.wikipedia.org/wiki/Lines_of_Action"],
        people: [
            {
                type: "designer",
                name: "Claude Soucie",
            }
        ],
        variants: [
            {
                uid: "scrambled",
                name: "Scrambled Eggs",
                group: "setup",
                description: "Pieces are interspersed with each other instead of starting together on opposite sides of the board."
            }
        ]
    };
    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 9);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 9);
    }

    public numplayers: number = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public lastmove?: string;
    public gameover: boolean = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: ILinesOfActionState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            let board = new Map<string, playerid>([
                ["b9", 1], ["c9", 1], ["d9", 1], ["e9", 1], ["f9", 1], ["g9", 1], ["h9", 1],
                ["b1", 1], ["c1", 1], ["d1", 1], ["e1", 1], ["f1", 1], ["g1", 1], ["h1", 1],
                ["a2", 2], ["a3", 2], ["a4", 2], ["a5", 2], ["a6", 2], ["a7", 2], ["a8", 2],
                ["i2", 2], ["i3", 2], ["i4", 2], ["i5", 2], ["i6", 2], ["i7", 2], ["i8", 2],
            ]);
            if ( (variants !== undefined) && (variants.length === 1) && (variants[0] === "scrambled") ) {
                this.variants = ["scrambled"];
                board = new Map<string, playerid>([
                    ["b9", 1], ["c9", 2], ["d9", 1], ["e9", 2], ["f9", 1], ["g9", 2], ["h9", 1],
                    ["b1", 1], ["c1", 2], ["d1", 1], ["e1", 2], ["f1", 1], ["g1", 2], ["h1", 1],
                    ["a2", 2], ["a3", 1], ["a4", 2], ["a5", 1], ["a6", 2], ["a7", 1], ["a8", 2],
                    ["i2", 2], ["i3", 1], ["i4", 2], ["i5", 1], ["i6", 2], ["i7", 1], ["i8", 2],
                ]);
            }
            const fresh: IMoveState = {
                _version: LinesOfActionGame.gameinfo.version,
                _results: [],
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ILinesOfActionState;
            }
            if (state.game !== LinesOfActionGame.gameinfo.uid) {
                throw new Error(`The Lines of Action engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx: number = -1): LinesOfActionGame {
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
        return this;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves: string[] = [];

        const grid = new RectGrid(9, 9);
        const dirPairs: [Directions, Directions][] = [["N", "S"], ["E", "W"], ["NE", "SW"], ["NW", "SE"]];
        const pieces = [...this.board.entries()].filter(e => e[1] === player).map(e => e[0]);
        for (const cell of pieces) {
            const [x, y] = LinesOfActionGame.algebraic2coords(cell);
            for (const pair of dirPairs) {
                const rays: [number, number][][] = [];
                let magnitude = 1;
                for (const d of pair) {
                    const ray = grid.ray(x, y, d);
                    for (const point of ray) {
                        if (this.board.has(LinesOfActionGame.coords2algebraic(...point))) {
                            magnitude++;
                        }
                    }
                    rays.push(ray);
                }
                for (const ray of rays) {
                    if (ray.length >= magnitude) {
                        let valid = true;
                        for (let i = 0; i < magnitude - 1; i++) {
                            const next = ray[i];
                            const nextCell = LinesOfActionGame.coords2algebraic(...next);
                            if (this.board.has(nextCell)) {
                                const contents = this.board.get(nextCell);
                                if (contents !== player) {
                                    valid = false;
                                    break;
                                }
                            }
                        }
                        if (valid) {
                            const next = ray[magnitude - 1];
                            const nextCell = LinesOfActionGame.coords2algebraic(...next);
                            if (this.board.has(nextCell)) {
                                const contents = this.board.get(nextCell);
                                if (contents !== player) {
                                    moves.push(`${cell}x${nextCell}`);
                                }
                            } else {
                                moves.push(`${cell}-${nextCell}`);
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

    public move(m: string): LinesOfActionGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (! this.moves().includes(m)) {
            throw new UserFacingError("MOVES_INVALID", i18next.t("apgames:MOVES_INVALID", {move: m}));
        }

        this.results = [];
        const [from, to] = m.split(/[-x]/);
        this.board.delete(from);
        if (to !== "e5") {
            this.board.set(to, this.currplayer);
        }
        this.results.push({type: "move", from, to});
        if (to === "e5") {
            this.results.push({type: "capture", where: "e5"})
        } else if (m.includes("x")) {
            this.results.push({type: "capture", where: to})
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

    protected checkEOG(): LinesOfActionGame {
        const connected1 = this.isConnected(1);
        const connected2 = this.isConnected(2);

        if ( (connected1) || (connected2) ) {
            this.gameover = true;
            if ( (connected1) && (connected2) ) {
                this.winner = [1, 2];
            } else if (connected1) {
                this.winner = [1];
            } else {
                this.winner = [2];
            }
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }

        return this;
    }

    private isConnected(player: playerid): boolean {
        const pieces = [...this.board.entries()].filter(e => e[1] === player).map(e => e[0]);
        const grid = new RectGrid(9, 9);
        const seen: Set<string> = new Set();
        const todo: string[] = [pieces[0]];
        while (todo.length > 0) {
            const cell = todo.pop();
            seen.add(cell!);
            const [x, y] = LinesOfActionGame.algebraic2coords(cell!);
            const neighbours = grid.adjacencies(x, y);
            for (const n of neighbours) {
                const nCell = LinesOfActionGame.coords2algebraic(...n);
                if (pieces.includes(nCell)) {
                    if (! seen.has(nCell)) {
                        todo.push(nCell);
                    }
                }
            }
        }
        return seen.size === pieces.length;
    }

    public resign(player: playerid): LinesOfActionGame {
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

    public state(): ILinesOfActionState {
        return {
            game: LinesOfActionGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: LinesOfActionGame.gameinfo.version,
            _results: [...this.results],
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr: string = "";
        for (let row = 0; row < 9; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < 9; col++) {
                const cell = LinesOfActionGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell);
                    if (contents === undefined) {
                        throw new Error("Malformed cell contents.");
                    }
                    if (contents === 1) {
                        pieces.push("A");
                    } else {
                        pieces.push("B");
                    }
                } else if (cell === "e5") {
                    pieces.push("X");
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join("");
        }
        pstr = pstr.replace(/-{9}/g, "_");

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-checkered",
                width: 9,
                height: 9,
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
                X: {
                    name: "piecepack-number-void",
                    colour: "#000"
                }
            },
            pieces: pstr
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = LinesOfActionGame.algebraic2coords(move.from);
                    const [toX, toY] = LinesOfActionGame.algebraic2coords(move.to);
                    rep.annotations!.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "capture") {
                    const [x, y] = LinesOfActionGame.algebraic2coords(move.where!);
                    rep.annotations!.push({type: "exit", targets: [{row: y, col: x}]});
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
            for (const rec of LinesOfActionGame.gameinfo.variants!) {
                if (v === rec.uid) {
                    vars.push(rec.name);
                    break;
                }
            }
        }
        return vars;
    }

    protected getMoveList(): any[] {
        return this.getMovesAndResults(["move", "capture"]);
    }

    public chatLog(players: string[]): string[][] {
        // eog, resign, winners, move, capture, promote, deltaScore
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
                        case "capture":
                            node.push(i18next.t("apresults:CAPTURE.minimal"));
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

    public clone(): LinesOfActionGame {
        return new LinesOfActionGame(this.serialize());
    }
}
