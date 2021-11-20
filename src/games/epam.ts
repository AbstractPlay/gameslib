import { GameBase, IAPGameState, IIndividualState } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, UserFacingError, Directions, AllDirections, OppositeDirections } from "../common";
import i18next from "i18next";

const gameDesc:string = `# Epaminondas

Epaminondas is an elegant 2-player game in which you try to overwhelm your opponent's home row. Pieces move as phalanxes a number of spaces up to their length. The rules are exceedingly simple, but the result is something deep and complex.
`;

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
    stones: string[];
};

export interface IEpamState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class EpamGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Epaminondas",
        uid: "epam",
        playercounts: [2],
        version: "20211117",
        description: gameDesc,
        urls: ["http://www.logicmazes.com/games/epam.html"],
        people: [
            {
                type: "designer",
                name: "Robert Abbott",
                urls: ["https://www.logicmazes.com/"]
            }
        ],
        variants: [
            {
                uid: "stones",
                name: "Stumbling Blocks",
                group: "setup",
                description: "In this variant, the players place three impassable stones in the middle of the board."
            }
        ]
    };
    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 12);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 12);
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
    public stones: string[] = [];

    constructor(state?: IEpamState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            const board = new Map<string, playerid>();
            for (let row = 0; row < 2; row++) {
                for (let col = 0; col < 14; col++) {
                    board.set(EpamGame.coords2algebraic(col, row), 2);
                }
            }
            for (let row = 10; row < 12; row++) {
                for (let col = 0; col < 14; col++) {
                    board.set(EpamGame.coords2algebraic(col, row), 1);
                }
            }
            if ( (variants !== undefined) && (variants.length === 1) && (variants[0] === "stones") ) {
                this.variants = ["stones"];
            }
            const fresh: IMoveState = {
                _version: EpamGame.gameinfo.version,
                _results: [],
                currplayer: 1,
                board,
                stones: []
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IEpamState;
            }
            if (state.game !== EpamGame.gameinfo.uid) {
                throw new Error(`The Epaminondas engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx: number = -1): EpamGame {
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
        this.stones = [...state.stones];
        return this;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];

        if ( (this.variants.includes("stones")) && (this.stones.length < 3) ) {
            for (let row = 3; row <= 8; row++) {
                for (let col = 0; col < 14; col++) {
                    const cell = EpamGame.coords2algebraic(col, row);
                    if (! this.stones.includes(cell)) {
                        moves.push(cell);
                    }
                }
            }
            return moves;
        }

        // For each piece, look for valid phalanxes in each direction
        const grid = new RectGrid(14, 12);
        const pieces = [...this.board.entries()].filter(e => e[1] === player).map(e => e[0]);
        for (const cell of pieces) {
            for (const dir of AllDirections) {
                const phalanx = this.phalanx(cell, dir);
                if (phalanx !== undefined) {
                    const head = phalanx[phalanx.length - 1];
                    const [xHead, yHead] = EpamGame.algebraic2coords(head);
                    const ray = grid.ray(xHead, yHead, dir);
                    for (let i = 0; i < phalanx.length; i++) {
                        // If index is in range, get the possible destination
                        if (ray.length <= i) {
                            break;
                        }
                        const next = EpamGame.coords2algebraic(...ray[i]);
                        // if it's occupied by a stone, then abort
                        if (this.stones.includes(next)) {
                            break;
                        // If it's empty, this is a valid move
                        // Add it to the list and continue
                        } else if (! this.board.has(next)) {
                            moves.push(`${cell}-${next}`);
                        } else {
                            // If it's occupied by a friendly, abort
                            if (this.board.get(next)! === player) {
                                break;
                            // If it's occupied by an enemy, see if a capture is possible
                            } else {
                                const enemyPhalanx = this.phalanx(next, dir, false)!;
                                if (enemyPhalanx.length < phalanx.length) {
                                    moves.push(`${cell}x${next}`);
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }

        return moves;
    }

    /**
     * A valid phalanx is the starting piece, followed optionally by an unroken line of friendly pieces.
     * For movement purposes, the phalanx must be terminated, meaning followed by an empty space.
     * For capturing purposes, though, you want to identify phalanxes even if they are against a board edge.
     * If `wantmoves` is true, then it only returns phalanxes terminated with an empty space.
     *
     * @private
     * @param {string} start
     * @param {Directions} dir
     * @param {boolean} [wantmoves=false]
     * @returns {(string[] | undefined)}
     * @memberof EpamGame
     */
    private phalanx(start: string, dir: Directions, wantmoves: boolean = true): string[] | undefined {
        const phalanx: string[] = [start];
        const player = this.board.get(start)!;
        const grid = new RectGrid(14, 12);
        const ray = grid.ray(...EpamGame.algebraic2coords(start), dir).map(p => EpamGame.coords2algebraic(...p));
        for (const cell of ray) {
            // If the cell is empty, phalanx is complete
            if (! this.board.has(cell)) {
                return [...phalanx];
            } else {
                // If the cell is a stone, respect `wantmoves`
                if (this.stones.includes(cell)) {
                    if (wantmoves) {
                        return;
                    } else {
                        return [...phalanx];
                    }
                // If the cell is occupied by an enemy piece, phalanx is complete
                } else if (this.board.get(cell)! !== player) {
                    return [...phalanx];
                // Otherwise it's friendly; add it to the phalanx and keep going
                } else {
                    phalanx.push(cell);
                }
            }
        }
        // If we got here, then we've hit the edge of the board. Respect `wantmoves`.
        if (wantmoves) {
            return;
        } else {
            return [...phalanx];
        }
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public click(row: number, col: number, piece: string): string {
        return EpamGame.coords2algebraic(col, row);
    }

    public clicked(move: string, coord: string | [number, number]): string {
        try {
            let x: number | undefined;
            let y: number | undefined;
            let cell: string | undefined;
            if (typeof coord === "string") {
                cell = coord;
                [x, y] = EpamGame.algebraic2coords(cell);
            } else {
                [x, y] = coord;
                cell = EpamGame.coords2algebraic(x, y);
            }
            if (move === "") {
                if (this.board.has(cell)) {
                    return cell;
                } else if ( (this.variants.includes("stones")) && (this.stones.length < 3) ) {
                    return cell;
                } else {
                    return "";
                }
            } else {
                const [prev,rest] = move.split(/[-x]/);
                if ( (cell === prev) || (cell === rest) ) {
                    return cell;
                } else if (this.board.has(cell)) {
                    return `${prev}x${cell}`;
                } else {
                    return `${prev}-${cell}`;
                }
            }
        } catch {
            // tslint:disable-next-line: no-console
            console.info(`The click handler couldn't process the click:\nMove: ${move}, Coord: ${coord}.`);
            return move;
        }
    }

    public move(m: string): EpamGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (! this.moves().includes(m)) {
            throw new UserFacingError("MOVES_INVALID", i18next.t("apgames:MOVES_INVALID", {move: m}));
        }

        this.results = [];

        if ( (m.includes("-")) || (m.includes("x")) ) {
            const grid = new RectGrid(14, 12);
            const [from, to] = m.split(/[-x]/);
            const [xFrom, yFrom] = EpamGame.algebraic2coords(from);
            const [xTo, yTo] = EpamGame.algebraic2coords(to);
            const dir = RectGrid.bearing(xFrom, yFrom, xTo, yTo)!;
            const oppDir = OppositeDirections.get(dir)!;
            const reverseRay = [to, ...grid.ray(xTo, yTo, oppDir).map(r => EpamGame.coords2algebraic(...r))];
            const phalanx = this.phalanx(from, dir)!;
            let enemyPhalanx: string[] | undefined;
            if (this.board.has(to)) {
                enemyPhalanx = this.phalanx(to, dir, false);
            }

            // If there's an enemy phalanx, capture it
            if (enemyPhalanx !== undefined) {
                for (const cell of enemyPhalanx) {
                    this.board.delete(cell);
                    this.results.push({type: "capture", where: cell})
                }
            }

            // Now delete the moving phalanx
            for (const cell of phalanx) {
                this.board.delete(cell);
            }

            // Place the new phalanx starting from the target, moving in the opposite direction
            for (let i = 0; i < phalanx.length; i++) {
                this.board.set(reverseRay[i], this.currplayer);
            }
            this.results.push({type: "move", from, to});
        } else {
            this.stones.push(m);
            this.results.push({type: "place", what: "stone", where: m});
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

    protected checkEOG(): EpamGame {
        const targets = [/12$/, /\D1$/];
        let prevPlayer = 1 as playerid;
        if (this.currplayer === 1) {
            prevPlayer = 2 as playerid;
        }
        const mytarget = targets[this.currplayer - 1];
        const theirtarget = targets[prevPlayer - 1];
        const mypieces = [...this.board.entries()].filter(e => (mytarget.test(e[0])) && (e[1] === this.currplayer));
        const theirpieces = [...this.board.entries()].filter(e => (theirtarget.test(e[0])) && (e[1] === prevPlayer));
        // Current player has no moves (they have no pieces left, which almost never happens)
        if (this.moves().length === 0) {
            this.gameover = true;
            this.winner = [prevPlayer];
        // Current player has more pieces on opponent's home row than they have on his
        } else if (mypieces.length > theirpieces.length) {
            this.gameover = true;
            this.winner = [this.currplayer];
        }
        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public resign(player: playerid): EpamGame {
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

    public state(): IEpamState {
        return {
            game: EpamGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: EpamGame.gameinfo.version,
            _results: [...this.results],
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            stones: [...this.stones],
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr: string = "";
        for (let row = 0; row < 12; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < 14; col++) {
                const cell = EpamGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    if (contents === 1) {
                        pieces.push("A");
                    } else {
                        pieces.push("B");
                    }
                } else if (this.stones.includes(cell)) {
                    pieces.push("X");
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join("");
        }
        pstr = pstr.replace(/-{14}/g, "_");

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-checkered",
                width: 14,
                height: 12,
                markers: [
                    {
                        type: "shading",
                        colour: 2,
                        points: [
                            {row: 0, col: 0},
                            {row: 0, col: 14},
                            {row: 1, col: 14},
                            {row: 1, col: 0}
                        ]
                    },
                    {
                        type: "shading",
                        colour: 1,
                        points: [
                            {row: 11, col: 0},
                            {row: 11, col: 14},
                            {row: 12, col: 14},
                            {row: 12, col: 0}
                        ]
                    }
                ]
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
                    name: "piece-square",
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
                    const [fromX, fromY] = EpamGame.algebraic2coords(move.from);
                    const [toX, toY] = EpamGame.algebraic2coords(move.to);
                    rep.annotations!.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "capture") {
                    const [x, y] = EpamGame.algebraic2coords(move.where!);
                    rep.annotations!.push({type: "exit", targets: [{row: y, col: x}]});
                } else if (move.type === "place") {
                    const [x, y] = EpamGame.algebraic2coords(move.where!);
                    rep.annotations!.push({type: "enter", targets: [{row: y, col: x}]});
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
            for (const rec of EpamGame.gameinfo.variants!) {
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
                let captureCount = 0;
                for (const r of state._results) {
                    switch (r.type) {
                        case "move":
                            node.push(i18next.t("apresults:MOVE.nowhat", {player: name, from: r.from, to: r.to}));
                            break;
                        case "capture":
                            captureCount++;
                            break;
                        case "place":
                            node.push(i18next.t("apresults:PLACE.complete", {player: name, what: r.what, where: r.where}));
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
                if (captureCount > 0) {
                    node.push(i18next.t("apresults:CAPTURE.multiple", {count: captureCount}));
                }
                result.push(node);
            }
        }
        return result;
    }

    public clone(): EpamGame {
        return new EpamGame(this.serialize());
    }
}
