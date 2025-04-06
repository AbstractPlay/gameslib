/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import {
    GameBase,
    IAPGameState,
    IClickResult,
    IIndividualState,
    IValidationResult,
} from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, UserFacingError, Direction } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment

export type playerid = 1 | 2;
export type Piece = "W" | "WB" | "WX" | "B" | "BB" | "BX";
export type CellContents = [playerid, Piece];

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    previousPositions: [number, number][];
    lastmove?: string;
}

export interface IRazzleState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
}

export class RazzleGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Razzle Dazzle",
        uid: "razzle",
        playercounts: [2],
        version: "20230825",
        dateAdded: "2023-09-16",
        description: "apgames:descriptions.razzle",
        urls: [
            "https://boardgamegeek.com/thread/169556/review-razzle-dazzle",
            "https://boardgamegeek.com/filepage/14788/razzledazzlextxt",
        ],
        people: [
            {
                type: "designer",
                name: "Don Green",
                urls: ["http://www.donaldgreen.com/"],
            },
            {
                type: "coder",
                name: "fritzd",
                urls: [],
                apid: "a96b36a2-2c9d-4597-8c4a-f926062a45b6",
            },
        ],
        categories: ["goal>breakthrough", "mechanic>move", "board>shape>rect", "board>connect>rect", "components>simple>3c"],
        flags: ["perspective", "automove"],
    };

    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 8);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 8);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, CellContents>;
    public previousPositions: [number, number][] = [];
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IRazzleState | string) {
        super();
        if (state === undefined) {
            const board = new Map<string, CellContents>();
            board.set("b1", [1, "W"]);
            board.set("c1", [1, "W"]);
            board.set("d1", [1, "WB"]);
            board.set("e1", [1, "W"]);
            board.set("f1", [1, "W"]);
            board.set("b8", [2, "B"]);
            board.set("c8", [2, "B"]);
            board.set("d8", [2, "BB"]);
            board.set("e8", [2, "B"]);
            board.set("f8", [2, "B"]);
            const fresh: IMoveState = {
                _version: RazzleGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                previousPositions: [],
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IRazzleState;
            }
            if (state.game !== RazzleGame.gameinfo.uid) {
                throw new Error(
                    `The RazzleDazzle engine cannot process a game of '${state.game}'.`
                );
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): RazzleGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if (idx < 0 || idx >= this.stack.length) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.previousPositions = [...state.previousPositions];
        this.lastmove = state.lastmove;
        this.results = [...state._results];
        return this;
    }

    private numericPosition(c: string): number {
        const coord = RazzleGame.algebraic2coords(c);
        return 7 * coord[0] + coord[1];
    }

    // Basically base 56 of the white position, then base 56 of the black position. Ball first, the rest sorted.
    private encodePosition(): [number, number] {
        const b1 = this.numericPosition(
            [...this.board.entries()].find((e) => e[1][1] === "WB")![0]
        );
        const p1 = [...this.board.entries()]
            .filter((e) => e[1][0] === 1 && e[1][1] !== "WB")
            .map((e) => e[0])
            .sort()
            .map((c) => this.numericPosition(c));
        const b2 = this.numericPosition(
            [...this.board.entries()].find((e) => e[1][1] === "BB")![0]
        );
        const p2 = [...this.board.entries()]
            .filter((e) => e[1][0] === 2 && e[1][1] !== "BB")
            .map((e) => e[0])
            .sort()
            .map((c) => this.numericPosition(c));
        return [
            b1 + 56 * (p1[0] + 56 * (p1[1] + 56 * (p1[2] + 56 * p1[3]))),
            b2 + 56 * (p2[0] + 56 * (p2[1] + 56 * (p2[2] + 56 * p2[3]))),
        ];
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) {
            return [];
        }
        if (player === undefined) {
            player = this.currplayer;
        }
        const color = player === 1 ? "W" : "B";
        const moves: string[] = [];

        const grid = new RectGrid(7, 8);
        const playerPieces = [...this.board.entries()]
            .filter((e) => e[1][0] === player && e[1][1][1] !== "B")
            .map((e) => e[0]);
        let ball = [...this.board.entries()].find(
            (e) => e[1][0] === player && e[1][1][1] === "B"
        )![0];

        // First ball moves
        const work: Direction[][] = [];
        const balls = [];
        work.push(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]);
        const kickList = [ball];
        while (work.length > 0) {
            if (work[work.length - 1].length > 0) {
                const dir = work[work.length - 1].pop()!;
                const next = grid
                    .ray(...RazzleGame.algebraic2coords(ball), dir)
                    .map((pt) => RazzleGame.coords2algebraic(...pt))
                    .find((c) => this.board.has(c));
                if (
                    next &&
                    this.board.get(next)![0] === player &&
                    this.board.get(next)![1].length === 1
                ) {
                    this.board.set(ball, [player, `${color}X`]);
                    this.board.set(next, [player, `${color}B`]);
                    const enc = this.encodePosition();
                    if (this.previousPositions.findIndex(p => p[0] === enc[0] && p[1] === enc[1]) !== -1) {
                        this.board.set(ball, [player, `${color}B`]);
                        this.board.set(next, [player, `${color}`]);
                    } else {
                        kickList.push(next);
                        moves.push(kickList.join("-"));
                        balls.push(ball);
                        ball = next;
                        work.push(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]);
                    }
                }
            } else {
                work.pop();
                if (work.length > 0) {
                    const prev = balls.pop();
                    kickList.pop();
                    this.board.set(ball, [player, color]);
                    this.board.set(prev!, [player, `${color}B`]);
                    ball = prev!;
                }
            }
        }

        let canMove = true;
        if (moves.length > 0) {
            if (this.lastmove) {
                const lastDestination = this.lastmove.substring(
                    this.lastmove.length - 2
                );
                if (this.board.get(lastDestination)![1][1] !== "B") {
                    const adjacencies = grid
                        .adjacencies(...RazzleGame.algebraic2coords(lastDestination))
                        .map((pt) => RazzleGame.coords2algebraic(...pt));
                    if (adjacencies.includes(ball)) {
                        canMove = false;
                    }
                }
            }
        }

        if (canMove) {
            for (const from of playerPieces) {
                for (const knightmove of grid.knights(
                    ...RazzleGame.algebraic2coords(from)
                )) {
                    const next = RazzleGame.coords2algebraic(...knightmove);
                    if (!this.board.has(next)) {
                        const cell = this.board.get(from)!;
                        this.board.set(next, [player, `${color}`]);
                        this.board.delete(from);
                        const enc = this.encodePosition();
                        if (this.previousPositions.findIndex(p => p[0] === enc[0] && p[1] === enc[1]) === -1) {
                            moves.push(
                                `${from}-${RazzleGame.coords2algebraic(...knightmove)}`
                            );
                        }
                        this.board.set(from, cell);
                        this.board.delete(next);
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

    public handleClick(
        move: string,
        row: number,
        col: number,
        piece?: string
    ): IClickResult {
        try {
            const cell = RazzleGame.coords2algebraic(col, row);
            let newmove;
            if (move.length > 0)
                newmove = `${move}-${cell}`;
            else
                newmove = cell;
            const result = this.validateMove(newmove) as IClickResult;
            if (!result.valid) {
                result.move = "";
            } else {
                result.move = newmove;
            }
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", {
                    move,
                    row,
                    col,
                    piece,
                    emessage: (e as Error).message,
                }),
            };
        }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {
            valid: false,
            message: i18next.t("apgames:validation._general.DEFAULT_HANDLER"),
        };

        if (m === "") {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t(
                "apgames:validation.razzle.INITIAL_INSTRUCTIONS"
            );
            return result;
        }

        const cells = m.split(/[-]/);
        const first = cells[0];
        const coords: [number, number][] = [];
        for (const cell of cells) {
            try {
                coords.push(RazzleGame.algebraic2coords(cell));
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {
                    cell,
                });
                return result;
            }
        }

        if (!this.board.has(first)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.SELECT_OWN", {
                cell: first,
            });
            return result;
        } else {
            if (this.board.get(first)![0] !== this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                return result;
            }
            const grid = new RectGrid(7, 8);
            const color = this.currplayer === 1 ? "W" : "B";
            if (this.board.get(first)![1][1] === "B") {
                // Ball move
                for (let i = 1; i < cells.length; i++) {
                    const from = coords[i - 1];
                    const to = coords[i];
                    if ((! RectGrid.isOrth(...from, ...to)) && (! RectGrid.isDiag(...from, ...to))) {
                        result.valid = false;
                        result.message = i18next.t(
                            "apgames:validation.razzle.BAD_DIRECTION",
                            { from: cells[i - 1], to: cells[i] }
                        );
                        return result;
                    }
                    // Eligible receiver
                    if (this.board.has(cells[i])) {
                        if (this.board.get(cells[i])![0] !== this.currplayer) {
                            result.valid = false;
                            result.message = i18next.t(
                                "apgames:validation.razzle.OWN_RECEIVER",
                                { cell: cells[i] }
                            );
                            return result;
                        }
                        if (this.board.get(cells[i])![1][1] === "X") {
                            result.valid = false;
                            result.message = i18next.t(
                                "apgames:validation.razzle.INELIGBLE_RECEIVER",
                                { cell: cells[i] }
                            );
                            return result;
                        }
                        if (cells.indexOf(cells[i]) < i) {
                            result.valid = false;
                            result.message = i18next.t(
                                "apgames:validation.razzle.REPEAT_RECEIVER",
                                { cell: cells[i] }
                            );
                            return result;
                        }
                        const obs = RectGrid.between(...from, ...to).find((pt) =>
                            this.board.has(RazzleGame.coords2algebraic(...pt))
                        );
                        if (obs) {
                            result.valid = false;
                            result.message = i18next.t(
                                "apgames:validation.razzle.OBSTRUCTED",
                                {
                                    from: cells[i - 1],
                                    to: cells[i],
                                    obstruction: RazzleGame.coords2algebraic(...obs),
                                }
                            );
                            return result;
                        }
                    } else {
                        result.valid = false;
                        result.message = i18next.t(
                            "apgames:validation.razzle.NO_RECEIVER",
                            { cell: cells[i] }
                        );
                        return result;
                    }
                }
                // apply move
                for (let i = 0; i < cells.length - 1; i++)
                    this.board.set(cells[i], [this.currplayer, `${color}X`]);
                this.board.set(cells[cells.length - 1], [this.currplayer, `${color}B`]);
                // repeated position?
                const enc = this.encodePosition();
                const repeat = this.previousPositions.findIndex(p => p[0] === enc[0] && p[1] === enc[1]) !== -1;
                // Can move ball further?
                let more = false;
                for (const dir of [
                    "N",
                    "NE",
                    "E",
                    "SE",
                    "S",
                    "SW",
                    "W",
                    "NW",
                ] as Direction[]) {
                    const next = grid
                        .ray(...coords[cells.length - 1], dir)
                        .map((pt) => RazzleGame.coords2algebraic(...pt))
                        .find((c) => this.board.has(c));
                    if (
                        next &&
                        this.board.get(next)![0] === this.currplayer &&
                        this.board.get(next)![1].length === 1
                    ) {
                        more = true;
                        break;
                    }
                }
                // unapply move
                for (let i = 1; i < cells.length; i++)
                    this.board.set(cells[i], [this.currplayer, `${color}`]);
                this.board.set(cells[0], [this.currplayer, `${color}B`]);

                if (repeat) {
                    if (more) {
                        result.valid = true;
                        result.complete = -1;
                        result.canrender = true;
                        result.message = i18next.t(
                            "apgames:validation.razzle.INCOMPLETE_BALL_MOVE"
                        );
                        return result;
                    } else {
                        result.valid = false;
                        result.message = i18next.t(
                            "apgames:validation.razzle.REPEATED_POSITION"
                        );
                        return result;
                    }
                } else {
                    if (more) {
                        if (cells.length === 1) {
                            result.valid = true;
                            result.complete = -1;
                            result.message = i18next.t(
                                "apgames:validation.razzle.START_BALL_MOVE"
                            );
                            return result;
                        }
                        result.valid = true;
                        result.complete = 0;
                        result.canrender = true;
                        result.message = i18next.t(
                            "apgames:validation.razzle.PARTIAL_BALL_MOVE"
                        );
                        return result;
                    } else {
                        if (cells.length === 1) {
                            result.valid = false;
                            result.message = i18next.t(
                                "apgames:validation.razzle.NO_AVAILABLE_RECEIVERS"
                            );
                        } else {
                            result.valid = true;
                            result.complete = 1;
                            result.message = i18next.t(
                                "apgames:validation._general.VALID_MOVE"
                            );
                        }
                        return result;
                    }
                }
            } else {
                // Move a piece
                // But are we allowed?
                // Opponent approached?
                let approached = false;
                const ball = [...this.board.entries()].find(
                    (e) => e[1][0] === this.currplayer && e[1][1][1] === "B"
                )![0];
                if (this.lastmove) {
                    const lastDestination = this.lastmove.substring(
                        this.lastmove.length - 2
                    );
                    if (this.board.get(lastDestination)![1][1] !== "B") {
                        const adjacencies = grid
                            .adjacencies(...RazzleGame.algebraic2coords(lastDestination))
                            .map((pt) => RazzleGame.coords2algebraic(...pt));
                        if (adjacencies.includes(ball)) {
                            approached = true;
                        }
                    }
                }
                // Can move ball?
                let canMoveBall = false;
                if (approached) {
                    const ballCoords = RazzleGame.algebraic2coords(ball);
                    for (const dir of [
                        "N",
                        "NE",
                        "E",
                        "SE",
                        "S",
                        "SW",
                        "W",
                        "NW",
                    ] as Direction[]) {
                        const next = grid
                            .ray(...ballCoords, dir)
                            .map((pt) => RazzleGame.coords2algebraic(...pt))
                            .find((c) => this.board.has(c));
                        if (
                            next &&
                            this.board.get(next)![0] === this.currplayer &&
                            this.board.get(next)![1].length === 1
                        ) {
                            canMoveBall = true;
                            break;
                        }
                    }
                }
                if (approached && canMoveBall) {
                    result.valid = false;
                    result.message = i18next.t(
                        "apgames:validation.razzle.MUST_MOVE_BALL"
                    );
                    return result;
                }

                if (cells.length === 1) {
                    result.valid = true;
                    result.complete = -1;
                    result.message = i18next.t(
                        "apgames:validation.razzle.PARTIAL_PIECE_MOVE"
                    );
                    return result;
                }
                if (cells.length > 2) {
                    result.valid = false;
                    result.message = i18next.t(
                        "apgames:validation.razzle.MOVE_ONE_PIECE"
                    );
                    return result;
                }
                if (this.board.has(cells[1])) {
                    result.valid = false;
                    result.message = i18next.t(
                        "apgames:validation.razzle.NOT_EMPTY",
                        { cell: cells[1] }
                    );
                    return result;
                }
                if (grid.knights(...coords[0]).findIndex(e => e[0] === coords[1][0] && e[1] === coords[1][1]) === -1) {
                    result.valid = false;
                    result.message = i18next.t(
                        "apgames:validation.razzle.NOT_KNIGHT_MOVE",
                        { from: cells[0], to: cells[1] }
                    );
                    return result;
                }
                // apply move
                this.board.set(cells[1], [this.currplayer, color]);
                const content = this.board.get(cells[0])!;
                this.board.delete(cells[0]);
                const enc = this.encodePosition();
                const repeat = this.previousPositions.findIndex(p => p[0] === enc[0] && p[1] === enc[1]) !== -1;
                this.board.delete(cells[1]);
                this.board.set(cells[0], content);
                if (repeat) {
                    result.valid = false;
                    result.message = i18next.t(
                        "apgames:validation.razzle.REPEATED_POSITION"
                    );
                    return result;
                }
            }
        }
        // valid move
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string, {partial = false, trusted = false} = {}): RazzleGame {
        if (this.gameover) {
            throw new UserFacingError(
                "MOVES_GAMEOVER",
                i18next.t("apgames:MOVES_GAMEOVER")
            );
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (! trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
            if (!partial && !this.moves().includes(m)) {
                throw new UserFacingError(
                    "VALIDATION_FAILSAFE",
                    i18next.t("apgames:validation._general.FAILSAFE", { move: m })
                );
            } else if (
                partial &&
                this.moves().filter((x) => x.startsWith(m)).length < 1
            ) {
                throw new UserFacingError(
                    "VALIDATION_FAILSAFE",
                    i18next.t("apgames:validation._general.FAILSAFE", { move: m })
                );
            }
        }

        this.results = [];

        const enc = this.encodePosition();
        const cells = m.split(/[-]/);
        const color = this.currplayer === 1 ? "W" : "B";
        if (this.board.get(cells[0])![1][1] === "B") {
            for (let i = 0; i < cells.length - 1; i++) {
                this.board.set(cells[i], [this.currplayer, `${color}X`]);
                this.results.push({ type: "move", from: cells[i], to: cells[i + 1], what: "ball" });
            }
            this.board.set(cells[cells.length - 1], [this.currplayer, `${color}B`]);
        } else {
            this.board.set(cells[1], [this.currplayer, `${color}`]);
            this.board.delete(cells[0]);
            this.results.push({ type: "move", from: cells[0], to: cells[1], what: "player" });
        }

        // Stop here if only requesting partial processing
        if (partial) {
            return this;
        }

        // update currplayer
        this.lastmove = m;
        let newplayer = (this.currplayer as number) + 1;
        if (newplayer > this.numplayers) {
            newplayer = 1;
        }
        this.currplayer = newplayer as playerid;
        this.previousPositions.push(enc);

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): RazzleGame {
        let prevPlayer: playerid = 1;
        if (this.currplayer === 1) {
            prevPlayer = 2;
        }
        const ball = RazzleGame.algebraic2coords([...this.board.entries()].find(
            (e) => e[1][0] === prevPlayer && e[1][1][1] === "B"
        )![0]);
        if (prevPlayer === 1 && ball[1] === 0) {
            this.gameover = true;
            this.winner = [prevPlayer];
        } else if (prevPlayer === 2 && ball[1] === 7) {
            this.gameover = true;
            this.winner = [prevPlayer];
        }
        if (this.gameover) {
            this.results.push(
                { type: "eog" },
                { type: "winners", players: [...this.winner] }
            );
        }
        return this;
    }

    public state(): IRazzleState {
        return {
            game: RazzleGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    public moveState(): IMoveState {
        return {
            _version: RazzleGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            previousPositions: [...this.previousPositions],
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        const oneCharacterPieces: Map<Piece, string> = new Map([['W', 'A'], ['B', 'B'], ['WB', 'C'], ['BB', 'D'], ['WX', 'X'], ['BX', 'Y']]);
        for (let row = 0; row < 8; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < 7; col++) {
                const cell = RazzleGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    pieces.push(oneCharacterPieces.get(this.board.get(cell)![1])!);
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join("");
        }

        // Build rep
        const rep: APRenderRep = {
            board: {
                style: "squares",
                width: 7,
                height: 8,
            },
            legend: {
                A: {
                    name: "piece",
                    colour: 1,
                },
                B: {
                    name: "piece",
                    colour: 2,
                },
                C: [
                    {
                        name: "piece",
                        colour: 1
                    },
                    {
                        name: "piece",
                        scale: 0.5,
                        colour: "#faed27"
                    }
                ],
                D: [
                    {
                        name: "piece",
                        colour: 2
                    },
                    {
                        name: "piece",
                        scale: 0.5,
                        colour: "#faed27"
                    }
                ],
                X: [
                    {
                        name: "piece",
                        colour: 1
                    },
                    {
                        name: "x",
                        scale: 0.5
                    }
                ],
                Y: [
                    {
                        name: "piece",
                        colour: 2
                    },
                    {
                        name: "x",
                        scale: 0.5
                    }
                ]
            },
            pieces: pstr,
        };

        // Add annotations
        if (this.results.length > 0) {
            rep.annotations = [];
            // for (const move of this.stack[this.stack.length - 1]._results) {
            for (const move of this.results) {
                if (move.type === "move") {
                    const [fromX, fromY] = RazzleGame.algebraic2coords(move.from);
                    const [toX, toY] = RazzleGame.algebraic2coords(move.to);
                    rep.annotations.push({
                        type: "move",
                        targets: [
                            { row: fromY, col: fromX },
                            { row: toY, col: toX },
                        ],
                    });
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

    public clone(): RazzleGame {
        return new RazzleGame(this.serialize());
    }
}
