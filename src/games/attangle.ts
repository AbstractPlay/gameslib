import { GameBase, IAPGameState, IIndividualState } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { IGraph, HexTriGraph } from "../common/graphs";
import { Combination } from "js-combinatorics";
// tslint:disable-next-line: no-var-requires
const deepclone = require("rfdc/default");

const gameDesc:string = `# Attangle

Attangle is the final entry in Dieter Stein's stacking trilogy. Place and move pieces to build stacks. First person to build three triple stacks wins. The "Grand Attangle" variant is also implemented.
`;

export type playerid = 1|2;
const voids: string[][] = [["d4"], ["h4", "g2", "f7", "e5", "d2", "c6", "b3"]]

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid[]>;
    lastmove?: string;
    pieces: [number, number];
};

export interface IAttangleState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class AttangleGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Attangle",
        uid: "attangle",
        playercounts: [2],
        version: "20211114",
        description: gameDesc,
        urls: ["https://spielstein.com/games/attangle/rules", "https://spielstein.com/games/attangle/rules/grand-attangle"],
        people: [
            {
                type: "designer",
                name: "Dieter Stein",
                urls: ["https://spielstein.com/"]
            }
        ],
        variants: [
            {
                uid: "grand",
                name: "Grand Attangle",
                group: "board",
                description: "Played on a larger board, with more voids, and the goal now is to create five triple stacks."
            },
        ],
        flags: ["limited-pieces"]
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

    constructor(state?: IAttangleState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            const fresh: IMoveState = {
                _version: AttangleGame.gameinfo.version,
                _results: [],
                currplayer: 1,
                board: new Map(),
                pieces: [18, 18],
            };
            if ( (variants !== undefined) && (variants.length === 1) && (variants[0] === "grand") ) {
                this.variants = ["grand"];
                fresh.pieces = [27, 27];
                fresh.board = new Map([
                    ["h3", [2]], ["g6", [1]], ["f2", [1]],
                    ["d7", [2]], ["c2", [2]], ["b4", [1]],
                ]);
            }
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IAttangleState;
            }
            if (state.game !== AttangleGame.gameinfo.uid) {
                throw new Error(`The Attangle engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx: number = -1): AttangleGame {
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

    private buildGraph(): AttangleGame {
        if (this.variants.includes("grand")) {
            this.graph = new HexTriGraph(5, 9);
        } else {
            this.graph = new HexTriGraph(4, 7);
        }
        return this;
    }

    public moves(player?: playerid, permissive: boolean = false): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];

        // You may always place a piece
        if (this.pieces[player - 1] > 0) {
            let vs = voids[0];
            if (this.variants.includes("grand")) {
                vs = voids[1];
            }
            const empties = (this.graph.listCells() as string[]).filter(c => (! this.board.has(c)) && (! vs.includes(c)));
            moves.push(...empties);
        }

        // Check for captures
        // For each enemy stack, draw rays in all directions
        // Examine each ray looking for visible pieces belonging to the current player and assemble them in a list
        const enemies = [...this.board.entries()].filter(e => e[1][e[1].length - 1] !== player).map(e => e[0]);
        for (const enemy of enemies) {
            const [xEnemy, yEnemy] = this.graph.algebraic2coords(enemy);
            const potentials: string[] = [];
            for (const dir of ["NE", "E", "SE", "SW", "W", "NW"] as const) {
                const ray = (this.graph as HexTriGraph).ray(xEnemy, yEnemy, dir);
                for (const [x, y] of ray) {
                    const cell = this.graph.coords2algebraic(x, y);
                    if (this.board.has(cell)) {
                        const contents = this.board.get(cell);
                        if (contents![contents!.length - 1] === player) {
                            potentials.push(cell)
                        }
                        break;
                    }
                }
            }
            // For each pair of potential capturers, see if the capture is valid
            if (potentials.length > 1) {
                const pairs: Combination<string> = new Combination(potentials, 2);
                for (const pair of pairs) {
                    const stackEnemy = this.board.get(enemy);
                    const stack1 = this.board.get(pair[0]);
                    const stack2 = this.board.get(pair[1]);
                    const combined = stackEnemy!.length + stack1!.length + stack2!.length - 1;
                    // If it is, store it
                    if (combined <= 3) {
                        moves.push(`${pair[0]},${pair[1]}-${enemy}`);
                        if (permissive) {
                            moves.push(`${pair[1]},${pair[0]}-${enemy}`);
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

    public move(m: string): AttangleGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (! this.moves(undefined, true).includes(m)) {
            throw new UserFacingError("MOVES_INVALID", i18next.t("apgames:MOVES_INVALID", {move: m}));
        }

        this.results = [];
        if (m.includes("-")) {
            const [from, to] = m.split("-")
            const [f1, f2] = from.split(",");
            const toContents = this.board.get(to);
            const f1Contents = this.board.get(f1);
            const f2Contents = this.board.get(f2);
            if ( (toContents === undefined) || (f1Contents === undefined) || (f2Contents === undefined) ) {
                throw new Error("Could not fetch board contents.");
            }
            let newstack: playerid[] = [];
            if (f1Contents.length > f2Contents.length) {
                newstack = [...toContents, ...f1Contents, ...f2Contents];
            } else {
                newstack = [...toContents, ...f2Contents, ...f1Contents];
            }
            newstack.pop();
            this.pieces[this.currplayer - 1]++;
            this.board.delete(f1);
            this.board.delete(f2);
            this.board.set(to, newstack);
            this.results.push({type: "move", from: f1, to}, {type: "move", from: f2, to});
        } else {
            this.board.set(m, [this.currplayer]);
            this.pieces[this.currplayer - 1]--;
            this.results.push({type: "place", where: m});
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

    protected checkEOG(): AttangleGame {
        let prevPlayer = 1;
        if (this.currplayer === 1) {
            prevPlayer = 2;
        }
        // Over if current player has no moves
        if (this.moves().length === 0) {
            this.gameover = true;
            this.winner = [prevPlayer as playerid];
        } else {
            let target = 3;
            if (this.variants.includes("grand")) {
                target = 5;
            }
            const triples = [...this.board.entries()].filter(e => (e[1].length === 3) && (e[1][e[1].length - 1] === prevPlayer));
            if (triples.length >= target) {
                this.gameover = true;
                this.winner = [prevPlayer as playerid];
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

    public resign(player: playerid): AttangleGame {
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

    public state(): IAttangleState {
        return {
            game: AttangleGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: AttangleGame.gameinfo.version,
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
            style: "hex-of-tri",
            minWidth: 4,
            maxWidth: 7,
            markers: [{type: "dots", points: [{row: 3, col: 3}]}]
        }
        if (this.variants.includes("grand")) {
            const markers = voids[1].map(v => {
                const [x, y] = this.graph.algebraic2coords(v);
                return {row: y, col: x};
            });
            board = {
                style: "hex-of-tri",
                minWidth: 5,
                maxWidth: 9,
                markers: [
                    {type: "dots", points: markers}
                ]
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

        return status;
    }

    protected getVariants(): string[] | undefined {
        if ( (this.variants === undefined) || (this.variants.length === 0) ) {
            return undefined;
        }
        const vars: string[] = [];
        for (const v of this.variants) {
            for (const rec of AttangleGame.gameinfo.variants!) {
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

    public clone(): AttangleGame {
        return new AttangleGame(this.serialize());
    }
}
