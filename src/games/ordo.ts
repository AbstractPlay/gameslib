import { GameBase, IAPGameState, IIndividualState } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, UserFacingError, Directions } from "../common";
import i18next from "i18next";
// tslint:disable-next-line: no-var-requires
const deepclone = require("rfdc/default");

const gameDesc:string = `# Ordo

Ordo is a "get to your opponent's home row" game in which you must always keep your pieces connected. Pieces can move singly, but also as a group in certain situations. You can also win by breaking up your opponent's group in such a way that they can't reconnect it.
`;

export type playerid = 1|2;

const dirsForward: Directions[][] = [["W", "NW", "N", "NE", "E"], ["E", "SE", "S", "SW", "W"]];
const dirsBackward: Directions[][] = [["SW", "S", "SE"], ["NE", "N", "NW"]];
const dirsOrthForward: Directions[] = ["N", "S"];
const dirsOrthBackward: Directions[] = ["S", "N"];
// Brought over from Perl code
// Doing the cells in this order lets us only look for ordos North and East
const cellsByDist = ["a1","a2","b1","b2","a3","b3","c1","c2","c3","a4","b4","c4","d1","d2","d3","d4","a5","b5","c5","d5","e1","e2","e3","e4","e5","a6","b6","c6","d6","e6","f1","f2","f3","f4","f5","f6","a7","b7","c7","d7","e7","f7","g1","g2","g3","g4","g5","g6","g7","a8","b8","c8","d8","e8","f8","g8","h1","h2","h3","h4","h5","h6","h7","h8","i1","i2","i3","i4","i5","i6","i7","i8","j1","j2","j3","j4","j5","j6","j7","j8"];

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
};

export interface IOrdoState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class OrdoGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Ordo",
        uid: "ordo",
        playercounts: [2],
        version: "20211114",
        description: gameDesc,
        urls: ["https://spielstein.com/games/ordo"],
        people: [
            {
                type: "designer",
                name: "Dieter Stein",
                urls: ["https://spielstein.com/"]
            }
        ]
    };
    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 8);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 8);
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

    constructor(state?: IOrdoState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            const board = new Map<string, playerid>();
            const cols = [[2,3,6,7], [0,1,2,3,4,5,6,7,8,9], [0,1,4,5,8,9]];
            const rows = [[7, 6, 5], [0, 1, 2]];
            for (const player of [1, 2] as const) {
                const rowset = rows[player - 1];
                for (let i = 0; i < rowset.length; i++) {
                    const row = rowset[i];
                    for (const col of cols[i]) {
                        board.set(OrdoGame.coords2algebraic(col, row), player)
                    }
                }
            }
            const fresh: IMoveState = {
                _version: OrdoGame.gameinfo.version,
                _results: [],
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IOrdoState;
            }
            if (state.game !== OrdoGame.gameinfo.uid) {
                throw new Error(`The Ordo engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx: number = -1): OrdoGame {
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

    public moves(player?: playerid, permissive: boolean = false): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves: string[] = [];

        const playerPieces = [...this.board.entries()].filter(e => e[1] === player).map(e => e[0]);
        if (playerPieces.length === 0) { return []; }
        const grid = new RectGrid(10, 8);
        const connected = this.isConnected(player);

        // Single moves first
        const dirsSingle = [...dirsForward[player - 1]];
        if (! connected) {
            dirsSingle.push(...dirsBackward[player - 1]);
        }
        for (const cell of playerPieces) {
            const [xStart, yStart] = OrdoGame.algebraic2coords(cell);
            for (const dir of dirsSingle) {
                const ray = grid.ray(xStart, yStart, dir);
                for (const [xNext, yNext] of ray) {
                    const next = OrdoGame.coords2algebraic(xNext, yNext);
                    if (! this.board.has(next)) {
                        moves.push(`${cell}-${next}`);
                    } else {
                        if (! playerPieces.includes(next)) {
                            moves.push(`${cell}x${next}`);
                        }
                        break;
                    }
                }
            }
        }

        // Horizontal ordos
        for (const start of cellsByDist) {
            if (! playerPieces.includes(start)) { continue; }
            const [xStart, yStart] = OrdoGame.algebraic2coords(start);
            const ray = grid.ray(xStart, yStart, "E");
            for (let len = 0; len < ray.length; len++) {
                const [xNext, yNext] = ray[len];
                const next = OrdoGame.coords2algebraic(xNext, yNext);
                if (! playerPieces.includes(next)) { break; }
                const ordo: [number, number][] = [[xStart, yStart], ...ray.slice(0, len + 1)];
                const dirs: Directions[] = [dirsOrthForward[player - 1]];
                if (! connected) {
                    dirs.push(dirsOrthBackward[player - 1]);
                }
                for (const dir of dirs) {
                    const rays = ordo.map(p => grid.ray(...p, dir));
                    for (let dist = 0; dist < rays[0].length; dist++) {
                        let blocked = false;
                        for (const r of rays) {
                            if (this.board.has(OrdoGame.coords2algebraic(...r[dist]))) {
                                blocked = true;
                                break;
                            }
                        }
                        if (! blocked) {
                            const dest = OrdoGame.coords2algebraic(...rays[0][dist]);
                            moves.push(`${start}:${next}-${dest}`);
                            if (permissive) {
                                const otherDest = OrdoGame.coords2algebraic(...rays[rays.length - 1][dist]);
                                moves.push(`${next}:${start}-${otherDest}`);
                            }
                        } else {
                            break;
                        }
                    }
                }
            }
        }

        // Vertical ordos
        for (const start of cellsByDist) {
            if (! playerPieces.includes(start)) { continue; }
            const [xStart, yStart] = OrdoGame.algebraic2coords(start);
            const ray = grid.ray(xStart, yStart, "N");
            for (let len = 0; len < ray.length; len++) {
                const [xNext, yNext] = ray[len];
                const next = OrdoGame.coords2algebraic(xNext, yNext);
                if (! playerPieces.includes(next)) { break; }
                const ordo: [number, number][] = [[xStart, yStart], ...ray.slice(0, len + 1)];
                const dirs: Directions[] = ["E", "W"];
                for (const dir of dirs) {
                    const rays = ordo.map(p => grid.ray(...p, dir));
                    for (let dist = 0; dist < rays[0].length; dist++) {
                        let blocked = false;
                        for (const r of rays) {
                            if (this.board.has(OrdoGame.coords2algebraic(...r[dist]))) {
                                blocked = true;
                                break;
                            }
                        }
                        if (! blocked) {
                            const dest = OrdoGame.coords2algebraic(...rays[0][dist]);
                            moves.push(`${start}:${next}-${dest}`);
                            if (permissive) {
                                const otherDest = OrdoGame.coords2algebraic(...rays[rays.length - 1][dist]);
                                moves.push(`${next}:${start}-${otherDest}`);
                            }
                        } else {
                            break;
                        }
                    }
                }
            }
        }

        // Test each move to make sure the group is still connected
        return moves.filter(m => {
            const g: OrdoGame = Object.assign(new OrdoGame(), deepclone(this));
            const p = g.currplayer;
            g.move(m, true);
            return g.isConnected(p);
        });
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

    // The partial flag enabled dynamic connection checking.
    // It leaves the object in an invalid state, so only use it on cloned objects, or call `load()` before submitting again.
    public move(m: string, partial: boolean = false): OrdoGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if ( (! partial) && (! this.moves(undefined, true).includes(m)) ) {
            throw new UserFacingError("MOVES_INVALID", i18next.t("apgames:MOVES_INVALID", {move: m}));
        }

        this.results = [];

        // Single moves first
        if (! m.includes(":")) {
            const [from, to] = m.split(/[-x]/);
            this.results.push({type: "move", from, to});
            this.board.delete(from);
            this.board.set(to, this.currplayer);
            if (m.includes("x")) {
                this.results.push({type: "capture", where: to});
            }
        } else {
            const [start, end, dest] = m.split(/[:-]/);
            const [xStart, yStart] = OrdoGame.algebraic2coords(start);
            const [xEnd, yEnd] = OrdoGame.algebraic2coords(end);
            const [xDest, yDest] = OrdoGame.algebraic2coords(dest);
            const ptsOrdo: [number, number][] = [[xStart, yStart], ...RectGrid.between(xStart, yStart, xEnd, yEnd), [xEnd, yEnd]];
            const ordo = ptsOrdo.map(p => OrdoGame.coords2algebraic(...p));
            const bearing = RectGrid.bearing(xStart, yStart, xDest, yDest);
            const distance = RectGrid.distance(xStart, yStart, xDest, yDest);
            const ptsTargets = ptsOrdo.map(p => RectGrid.move(...p, bearing!, distance));
            const targets = ptsTargets.map(p => OrdoGame.coords2algebraic(...p));
            for (let i = 0; i < ordo.length; i++) {
                const from = ordo[i];
                const to = targets[i];
                this.board.delete(from);
                this.board.set(to, this.currplayer);
                this.results.push({type: "move", from, to});
            }
        }

        // Stop here if only requesting partial processing
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

    protected checkEOG(): OrdoGame {
        let prevPlayer: playerid = 1;
        if (this.currplayer === 1) {
            prevPlayer = 2;
        }
        // Current player has no moves (nothing they can do to reconnect their group)
        if (this.moves().length === 0) {
            this.gameover = true;
            this.winner = [prevPlayer];
        // Previous player has a piece on their opponent's home row
        } else {
            const targetRows = ["8", "1"];
            const homePieces = [...this.board.entries()].filter(e => e[0].endsWith(targetRows[prevPlayer - 1]) && e[1] === prevPlayer);
            if (homePieces.length > 0) {
                this.gameover = true;
                this.winner = [prevPlayer];
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

    public isConnected(player: playerid): boolean {
        const pieces = [...this.board.entries()].filter(e => e[1] === player).map(e => e[0]);
        const grid = new RectGrid(10, 8);
        const seen: Set<string> = new Set();
        const todo: string[] = [pieces[0]];
        while (todo.length > 0) {
            const cell = todo.pop();
            seen.add(cell!);
            const [x, y] = OrdoGame.algebraic2coords(cell!);
            const neighbours = grid.adjacencies(x, y);
            for (const n of neighbours) {
                const nCell = OrdoGame.coords2algebraic(...n);
                if (pieces.includes(nCell)) {
                    if (! seen.has(nCell)) {
                        todo.push(nCell);
                    }
                }
            }
        }
        return seen.size === pieces.length;
    }

    public resign(player: playerid): OrdoGame {
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

    public state(): IOrdoState {
        return {
            game: OrdoGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: OrdoGame.gameinfo.version,
            _results: [...this.results],
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr: string = "";
        for (let row = 0; row < 8; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < 10; col++) {
                const cell = OrdoGame.coords2algebraic(col, row);
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
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join("");
        }
        pstr = pstr.replace(/-{10}/g, "_");

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-checkered",
                width: 10,
                height: 8,
            },
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
                    const [fromX, fromY] = OrdoGame.algebraic2coords(move.from);
                    const [toX, toY] = OrdoGame.algebraic2coords(move.to);
                    rep.annotations!.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "capture") {
                    const [x, y] = OrdoGame.algebraic2coords(move.where!);
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
            for (const rec of OrdoGame.gameinfo.variants!) {
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

    public clone(): OrdoGame {
        return new OrdoGame(this.serialize());
    }
}
