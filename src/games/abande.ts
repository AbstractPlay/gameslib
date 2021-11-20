import { GameBase, IAPGameState, IIndividualState } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { IGraph, SquareGraph, SnubSquareGraph, HexTriGraph } from "../common/graphs";
// tslint:disable-next-line: no-var-requires
const deepclone = require("rfdc/default");

const gameDesc:string = `# Abande

Abande is the second game in Dieter Stein's stacking trilogy. Place or move pieces and stacks to generate the highest score you can whilst always keeping the board connected. The square, snubsquare, and hex boards are available.
`;

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid[]>;
    lastmove?: string;
    pieces: [number, number];
};

export interface IAbandeState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class AbandeGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Abande",
        uid: "abande",
        playercounts: [2],
        version: "20211112",
        description: gameDesc,
        urls: ["https://spielstein.com/games/abande/rules"],
        people: [
            {
                type: "designer",
                name: "Dieter Stein",
                urls: ["https://spielstein.com/"]
            }
        ],
        variants: [
            {
                uid: "snub",
                name: "Board: Snub Square",
                group: "board",
                description: "A hybrid orthogonal/hexagonal board shape with unique connection characteristics."
            },
            {
                uid: "hex",
                name: "Board: Hexagonal",
                group: "board",
                description: "A 37-space hexagonal board."
            }
        ],
        flags: ["limited-pieces", "scores"]
    };

    public numplayers: number = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid[]>;
    public pieces!: [number, number];
    public lastmove?: string;
    public graph!: IGraph;
    public gameover: boolean = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IAbandeState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            const fresh: IMoveState = {
                _version: AbandeGame.gameinfo.version,
                _results: [],
                currplayer: 1,
                board: new Map(),
                pieces: [18, 18],
            };
            if ( (variants !== undefined) && (variants.length === 1) ) {
                if (variants[0] === "snub") {
                    this.variants = ["snub"];
                } else if (variants[0] === "hex") {
                    this.variants = ["hex"];
                }
            }
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IAbandeState;
            }
            if (state.game !== AbandeGame.gameinfo.uid) {
                throw new Error(`The Abande engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx: number = -1): AbandeGame {
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
        this.pieces = [...state.pieces];
        this.buildGraph();
        return this;
    }

    private buildGraph(): AbandeGame {
        if (this.variants.includes("snub")) {
            this.graph = new SnubSquareGraph(7, 7);
        } else if (this.variants.includes("hex")) {
            this.graph = new HexTriGraph(4, 7);
        } else {
            this.graph = new SquareGraph(7, 7);
        }
        return this;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        // If the board is empty, place a piece anywhere
        if (this.board.size === 0) {
            return this.graph.listCells() as string[];
        }

        const moves: string[] = [];
        // If you still have pieces, place a piece next to any existing piece
        if (this.pieces[player - 1] > 0) {
            for (const cell of this.board.keys()) {
                const neighbours = this.graph.neighbours(cell);
                for (const n of neighbours) {
                    if (! this.board.has(n)) {
                        moves.push(n);
                    }
                }
            }
        // If you don't have any pieces in hand, then passing is allowed
        } else {
            moves.push("pass");
        }

        // If the first player has placed two pieces, then movements are allowed
        if (this.pieces[0] <= 16) {
            const playerPieces = [...this.board.entries()].filter(e => e[1][e[1].length - 1] === player);
            for (const [cell, stack] of playerPieces) {
                const neighbours = this.graph.neighbours(cell);
                for (const n of neighbours) {
                    const cloned: AbandeGame = Object.assign(new AbandeGame(), deepclone(this));
                    cloned.buildGraph();
                    // You can't move to empty spaces, only spaces occupied by opponents
                    if (cloned.board.has(n)) {
                        const contents = cloned.board.get(n);
                        if (contents === undefined) {
                            throw new Error("Cell was undefined");
                        }
                        // If it's an enemy stack and the stack is no more than 3, try it
                        if ( (stack.length + contents.length <= 3) && (contents[contents.length - 1] !== player) ) {
                            cloned.board.delete(cell);
                            cloned.board.set(n, [...contents, ...stack]);
                            // If connected, this is a possible move
                            if (cloned.isConnected()) {
                                moves.push(`${cell}-${n}`);
                            }
                        }
                    }
                }
            }
        }

        return moves;
    }

    public isConnected(): boolean {
        const seen: Set<string> = new Set();
        const todo: string[] = [[...this.board.keys()][0]];
        while (todo.length > 0) {
            const cell = todo.pop();
            if (cell === undefined) {
                throw new Error("Cell was undefined.");
            }
            seen.add(cell);
            const neighbours = this.graph.neighbours(cell);
            for (const n of neighbours) {
                if ( (this.board.has(n)) && (! seen.has(n)) ) {
                    todo.push(n);
                }
            }
        }
        return seen.size === this.board.size;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public click(row: number, col: number, piece: string): string {
        return this.graph.coords2algebraic(col, row);
    }

    public clicked(move: string, coord: string | [number, number]): string {
        try {
            let x: number | undefined;
            let y: number | undefined;
            let cell: string | undefined;
            if (typeof coord === "string") {
                cell = coord;
                [x, y] = this.graph.algebraic2coords(cell);
            } else {
                [x, y] = coord;
                cell = this.graph.coords2algebraic(x, y);
            }
            if (move.length > 0) {
                if (move.includes("-")) {
                    return cell;
                }
                const [xPrev, yPrev] = this.graph.algebraic2coords(move);
                if (Math.max(Math.abs(x - xPrev), Math.abs(y - yPrev)) === 1) {
                    return `${move}-${cell}`;
                } else {
                    return cell;
                }
            } else {
                return cell;
            }
        } catch {
            // tslint:disable-next-line: no-console
            console.info(`The click handler couldn't process the click:\nMove: ${move}, Coord: ${coord}.`);
            return move;
        }
    }

    public move(m: string): AbandeGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (! this.moves().includes(m)) {
            throw new UserFacingError("MOVES_INVALID", i18next.t("apgames:MOVES_INVALID", {move: m}));
        }

        this.results = [];
        // placement
        if (m.length === 2) {
            this.board.set(m, [this.currplayer]);
            this.pieces[this.currplayer - 1]--;
            this.results.push({type: "place", where: m});
        // movement
        } else if (m.includes("-")) {
            const [from, to] = m.split("-");
            const fContents = this.board.get(from);
            if (fContents === undefined) {
                throw new Error("Could not fetch board contents");
            }
            this.board.delete(from);
            if (this.board.has(to)) {
                const tContents = this.board.get(to);
                if (tContents === undefined) {
                    throw new Error(`Could not fetch board contents.`);
                }
                this.board.set(to, [...tContents, ...fContents]);
            } else {
                this.board.delete(from);
                this.board.set(to, [...fContents]);
            }
            this.results.push({type: "move", from, to});
        // otherwise this was a "pass" and we can just move on
        } else {
            this.results.push({type: "pass"});
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

    protected checkEOG(): AbandeGame {
        if ( (this.lastmove === "pass") && (this.stack[this.stack.length - 1].lastmove === "pass") ) {
            this.gameover = true;
            const score1 = this.getPlayerScore(1);
            const score2 = this.getPlayerScore(2);
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

    public resign(player: playerid): AbandeGame {
        this.gameover = true;
        if (player === 1) {
            this.winner = [2];
        } else {
            this.winner = [1];
        }
        this.results.push(
            {type: "resigned", player},
            {type: "eog"},
            {type: "winners", players: [...this.winner]}
        );
        this.saveState();
        return this;
    }

    public state(): IAbandeState {
        return {
            game: AbandeGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: AbandeGame.gameinfo.version,
            _results: [...this.results],
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: deepclone(this.board),
            pieces: [...this.pieces],
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr: string = "";
        const cells = this.graph.listCells(true);
        for (const row of cells) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    let str = this.board.get(cell)!.join("");
                    str = str.replace(/1/g, "A");
                    str = str.replace(/2/g, "B");
                    pieces.push(str);
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join(",");
        }

        // Build rep
        let board = {
            style: "vertex-cross",
            width: 7,
            height: 7,
        }
        if (this.variants.includes("hex")) {
            board = {
                style: "hex-of-tri",
                // @ts-ignore
                minWidth: 4,
                maxWidth: 7,
            };
        } else if (this.variants.includes("snub")) {
            board = {
                style: "snubsquare",
                width: 7,
                height: 7,
            };
        }
        const rep: APRenderRep =  {
            renderer: "stacking-offset",
            // @ts-ignore
            board,
            legend: {
                A: {
                    name: "piece",
                    player: 1
                },
                B: {
                    name: "piece",
                    player: 2
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
                    const [fromX, fromY] = this.graph.algebraic2coords(move.from);
                    const [toX, toY] = this.graph.algebraic2coords(move.to);
                    rep.annotations!.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "place") {
                    const [x, y] = this.graph.algebraic2coords(move.where!);
                    rep.annotations!.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
            if (rep.annotations!.length === 0) {
                delete rep.annotations;
            }
        }

        return rep;
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Pieces In Hand**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const pieces = this.pieces[n - 1];
            status += `Player ${n}: ${pieces}\n\n`;
        }

        status += "**Scores**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const score = this.getPlayerScore(n);
            status += `Player ${n}: ${score}\n\n`;
        }

        return status;
    }

    protected getVariants(): string[] | undefined {
        if ( (this.variants === undefined) || (this.variants.length === 0) ) {
            return undefined;
        }
        const vars: string[] = [];
        for (const v of this.variants) {
            for (const rec of AbandeGame.gameinfo.variants!) {
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

    public getPlayerPieces(player: number): number {
        return this.pieces[player - 1];
    }

    public getPlayerScore(player: number): number {
        let score = 0;
        for (const cell of this.board.keys()) {
            const contents = this.board.get(cell);
            if (contents === undefined) {
                throw new Error("Could not fetch cell contents");
            }
            if (contents[contents.length - 1] === player) {
                const neighbours = this.graph.neighbours(cell);
                for (const n of neighbours) {
                    const nContents = this.board.get(n);
                    if ( (nContents !== undefined) && (nContents[nContents.length - 1] !== player) ) {
                        score += contents.length;
                        break;
                    }
                }
            }
        }
        return score;
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
                        case "place":
                            node.push(i18next.t("apresults:PLACE.nowhat", {player: name, where: r.where}));
                            break;
                        case "pass":
                            node.push(i18next.t("apresults:PASS.simple", {player: name}));
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

    public clone(): AbandeGame {
        return new AbandeGame(this.serialize());
    }
}
