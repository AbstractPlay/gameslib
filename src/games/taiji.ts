import { GameBase, IAPGameState, IIndividualState } from "./_base";
import { APGamesInformation, Variant } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, UserFacingError } from "../common";
import i18next from "i18next";

const gameDesc = `# Taiji

Two players take turns placing one piece of each colour next to each other. The winner is the one who forms the largest orthogonal groups of their own colour.

**Variants**

- The default board size is 9x9, but 7x7 and 11x11 versions are also available.
- The default win condition is the size of your two largest groups, but at the beginning of the game you can agree on looking at only one or three groups.
- The default rule is no diagonal placement. The "Tonga" variant allows it, however.
`;

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface ITaijiState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class TaijiGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Taiji",
        uid: "taiji",
        playercounts: [2],
        version: "20211118",
        description: gameDesc,
        urls: ["https://boardgamegeek.com/boardgame/31926/taiji", "https://nestorgames.com/rulebooks/TAIJIDELUXE_EN.pdf"],
        people: [
            {
                type: "designer",
                name: "Néstor Romeral Andrés",
            }
        ],
        variants: [
            {
                uid: "7x7",
                name: "Smaller board: 7x7",
                group: "board"
            },
            {
                uid: "11x11",
                name: "Larger board: 11x11",
                group: "board"
            },
            {
                uid: "onegroup",
                name: "Scoring: Single largest group",
                group: "scoring"
            },
            {
                uid: "threegroups",
                name: "Scoring: Largest three groups",
                group: "scoring"
            },
            {
                uid: "tonga",
                name: "Tonga (Diagonal Placement)"
            },
        ],
        flags: ["scores"]
    };

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public lastmove?: string;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public boardSize = 9;

    constructor(state?: ITaijiState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            const board = new Map<string, playerid>();
            if ( (variants !== undefined) && (variants.length > 0) && (variants[0] !== "") ) {
                const varInfo: (Variant|undefined)[] = variants.map(v => TaijiGame.gameinfo.variants!.find(n => n.uid === v));
                if (varInfo.includes(undefined)) {
                    throw new Error("Invalid variant passed.");
                }
                if (varInfo.filter(v => v?.group === "board").length > 1) {
                    throw new Error("You can't select two board variants.")
                }
                if (varInfo.filter(v => v?.group === "scoring").length > 1) {
                    throw new Error("You can't select two scoring variants.")
                }
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: TaijiGame.gameinfo.version,
                _results: [],
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ITaijiState;
            }
            if (state.game !== TaijiGame.gameinfo.uid) {
                throw new Error(`The Lines of Action engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): TaijiGame {
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
        this.boardSize = 9;
        if (this.variants.includes("7x7")) {
            this.boardSize = 7;
        } else if (this.variants.includes("11x11")) {
            this.boardSize = 11;
        }
        return this;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves: string[] = [];

        const grid = new RectGrid(this.boardSize, this.boardSize);
        for (let row = 0; row < this.boardSize; row++) {
            for (let col = 0; col < this.boardSize; col++) {
                const cell = TaijiGame.coords2algebraic(col, row, this.boardSize);
                if (! this.board.has(cell)) {
                    let neighbours: [number, number][] = [];
                    if (this.variants.includes("tonga")) {
                        neighbours = grid.adjacencies(col, row);
                    } else {
                        neighbours = grid.adjacencies(col, row, false);
                    }
                    for (const [x, y] of neighbours) {
                        const next = TaijiGame.coords2algebraic(x, y, this.boardSize);
                        if (! this.board.has(next)) {
                            moves.push(`${cell},${next}`);
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

    public move(m: string): TaijiGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (! this.moves().includes(m)) {
            throw new UserFacingError("MOVES_INVALID", i18next.t("apgames:MOVES_INVALID", {move: m}));
        }

        this.results = [];
        const [left, right] = m.split(",");
        this.board.set(left, 1);
        this.board.set(right, 2);
        this.results.push(
            {type: "place", where: left},
            {type: "place", where: right},
        );

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

    protected checkEOG(): TaijiGame {
        if (this.moves().length === 0) {
            this.gameover = true;
            const score1 = this.getPlayerScore(1)!;
            const score2 = this.getPlayerScore(2)!;
            if (score1 > score2) {
                this.winner = [1];
            } else if (score1 < score2) {
                this.winner = [2];
            } else {
                this.winner = [1, 2];
            }
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }

        return this;
    }

    public resign(player: playerid): TaijiGame {
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

    public state(): ITaijiState {
        return {
            game: TaijiGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: TaijiGame.gameinfo.version,
            _results: [...this.results],
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < this.boardSize; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < this.boardSize; col++) {
                const cell = TaijiGame.coords2algebraic(col, row, this.boardSize);
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
        // pstr = pstr.replace(/-{9}/g, "_");

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares",
                width: this.boardSize,
                height: this.boardSize,
            },
            legend: {
                A: {
                    name: "piece-square",
                    player: 1
                },
                B: {
                    name: "piece-square",
                    player: 2
                },
            },
            pieces: pstr
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
                    const [x, y] = TaijiGame.algebraic2coords(move.where!, this.boardSize);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }

        return rep;
    }

    public getPlayerScore(player: playerid): number {
        const grid = new RectGrid(this.boardSize, this.boardSize);
        const seen: Set<string> = new Set();
        const groups: Set<string>[] = [];
        const pieces = [...this.board.entries()].filter(e => e[1] === player).map(e => e[0]);
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
                const [x, y] = TaijiGame.algebraic2coords(cell, this.boardSize);
                const neighbours = grid.adjacencies(x, y, false).map(n => TaijiGame.coords2algebraic(...n, this.boardSize));
                for (const n of neighbours) {
                    if (pieces.includes(n)) {
                        todo.push(n);
                    }
                }
            }
            groups.push(group);
        }

        groups.sort((a, b) => b.size - a.size);
        let counts = 2;
        if (this.variants.includes("onegroup")) {
            counts = 1;
        } else if (this.variants.includes("threegroups")) {
            counts = 3;
        }
        return groups.slice(0, counts).reduce((sum, value) => {return sum + value.size;}, 0);
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Scores**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            status += `Player ${n}: ${this.getPlayerScore(n as playerid)}\n\n`;
        }

        return status;
    }

    protected getVariants(): string[] | undefined {
        if ( (this.variants === undefined) || (this.variants.length === 0) ) {
            return undefined;
        }
        const vars: string[] = [];
        for (const v of this.variants) {
            for (const rec of TaijiGame.gameinfo.variants!) {
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
                let name = `Player ${otherPlayer}`;
                if (otherPlayer <= players.length) {
                    name = players[otherPlayer - 1];
                }
                for (const r of state._results) {
                    switch (r.type) {
                        case "place":
                            node.push(i18next.t("apresults:PLACE.nowhat", {player: name, where: r.where}));
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

    public clone(): TaijiGame {
        return new TaijiGame(this.serialize());
    }
}
