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
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

export type playerid = 1 | 2;
export type CellContents = "" | "B" | "P"; // empty, ball or player

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Array<Array<CellContents>>;
    ball: [number, number];
    lastmove?: string;
}

export interface IPhutballState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
}

export class PhutballGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Phutball",
        uid: "phutball",
        playercounts: [2],
        version: "20230704",
        description: "apgames:descriptions.phutball",
        urls: ["https://en.wikipedia.org/wiki/Phutball"],
        people: [
            {
                type: "designer",
                name: "Elwyn Berlekamp, John Horton Conway, and Richard K. Guy",
            },
        ],
        flags: ["multistep", "perspective", "pie"],
    };
    public static coords2algebraic(x: number, y: number): string {
        if (x === 0) return "0" + (20 - y).toString();
        else return GameBase.coords2algebraic(x - 1, y, 20);
    }
    public static algebraic2coords(cell: string): [number, number] {
        if (cell.charAt(0) === "0") return [0, 20 - parseInt(cell.slice(1), 10)];
        const coords = GameBase.algebraic2coords(cell, 20);
        return [coords[0] + 1, coords[1]];
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    // 19 rows, row 0 being the top, 15 columns. But add a row and a column on all sides for the border.
    public board!: Array<Array<CellContents>>;
    public ball!: [number, number];
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IPhutballState | string) {
        super();
        if (state === undefined) {
            const board = [];
            for (let row = 0; row < 21; row++) {
                const node: Array<CellContents> = [];
                for (let col = 0; col < 17; col++) {
                    node.push("");
                }
                board.push(node);
            }
            board[10][8] = "B";
            const ball: [number, number] = [8, 10];
            const fresh: IMoveState = {
                _version: PhutballGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                ball,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IPhutballState;
            }
            if (state.game !== PhutballGame.gameinfo.uid) {
                throw new Error(
                    `The Phutball engine cannot process a game of '${state.game}'.`
                );
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): PhutballGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if (idx < 0 || idx >= this.stack.length) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = deepclone(state.board) as Array<Array<CellContents>>;
        this.ball = [...state.ball];
        this.lastmove = state.lastmove;
        this.results = [...state._results];
        return this;
    }

    public moves(): string[] {
        if (this.gameover) {
            return [];
        }
        const moves: string[] = [];
        // placements
        for (let row = 1; row < 20; row++) {
            for (let col = 1; col < 16; col++) {
                if (this.board[row][col] === "") {
                    moves.push(PhutballGame.coords2algebraic(col, row));
                }
            }
        }
        // jumps
        const clonedboard = this.board.map((a) => {
            return { ...a };
        });
        const dirs: [number, number][] = [
            [-1, 0],
            [-1, 1],
            [0, 1],
            [1, 1],
            [1, 0],
            [1, -1],
            [0, -1],
            [-1, -1],
        ];
        const work: [[number, number], number, number][] = [[this.ball, -1, 0]];
        const jumps: string[] = [
            PhutballGame.coords2algebraic(this.ball[0], this.ball[1]),
        ];
        let ind = 0;
        while (true) {
            let ball = work[ind][0];
            work[ind][1] = work[ind][1] + 1;
            if (work[ind][1] >= dirs.length) {
                ind--;
                if (ind < 0) break;
                work.pop();
                jumps.pop();
                ball = work[ind][0];
                const dir = dirs[work[ind][1]];
                for (let i = 1; i < work[ind][2]; i++) {
                    clonedboard[ball[1] + i * dir[1]][ball[0] + i * dir[0]] = "P";
                }
                clonedboard[ball[1] + work[ind][2] * dir[1]][
                    ball[0] + work[ind][2] * dir[0]
                ] = "";
                clonedboard[ball[1]][ball[0]] = "B";
            } else {
                const dir = dirs[work[ind][1]];
                let next: [number, number] = [ball[0] + dir[0], ball[1] + dir[1]];
                let dist = 1;
                while (true) {
                    if (!this.isLegalBallPosition(next)) {
                        break;
                    }
                    if (clonedboard[next[1]][next[0]] === "P") {
                        next = [next[0] + dir[0], next[1] + dir[1]];
                        dist += 1;
                    } else if (dist === 1) {
                        break;
                    } else {
                        for (let i = 0; i < dist; i++) {
                            clonedboard[ball[1] + i * dir[1]][ball[0] + i * dir[0]] = "";
                        }
                        clonedboard[next[1]][next[0]] = "B";
                        work[ind][2] = dist;
                        jumps.push(PhutballGame.coords2algebraic(next[0], next[1]));
                        moves.push(jumps.join("-"));
                        work.push([[...next], -1, 0]);
                        ind += 1;
                        break;
                    }
                }
            }
        }
        return moves.sort((a, b) => a.localeCompare(b));
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
            const cell = PhutballGame.coords2algebraic(col + 1, row + 1);
            let newmove = cell;
            let m = move.toLowerCase();
            m = m.replace(/\s+/g, "");
            if (m.length > 0) {
                const points = m.split("-");
                if (points.length === 1) {
                    const first = PhutballGame.algebraic2coords(points[0]);
                    if (first[0] === this.ball[0] && first[1] === this.ball[1]) {
                        newmove = m + "-" + cell;
                    } else {
                        newmove = cell;
                    }
                } else {
                    newmove = m + "-" + cell;
                }
            }
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

    private isLegalBallPosition(coords: [number, number]): boolean {
        return !(
            coords[0] < 0 ||
            coords[0] > 16 ||
            coords[1] < 0 ||
            coords[1] > 20 ||
            ((coords[0] === 0 || coords[0] === 16) &&
                coords[1] !== 0 &&
                coords[1] !== 20)
        );
    }

    private jumpPossible(
        board: Array<Array<CellContents>>,
        ballX: number,
        ballY: number
    ): boolean {
        const dirs: [number, number][] = [
            [-1, 0],
            [-1, 1],
            [0, 1],
            [1, 1],
            [1, 0],
            [1, -1],
            [0, -1],
            [-1, -1],
        ];
        for (const dir of dirs) {
            let next: [number, number] = [ballX + dir[0], ballY + dir[1]];
            let dist = 1;
            while (
                this.isLegalBallPosition(next) &&
                board[next[1]][next[0]] === "P"
            ) {
                next = [next[0] + dir[0], next[1] + dir[1]];
                dist += 1;
            }
            if (dist > 1 && this.isLegalBallPosition(next)) {
                return true;
            }
        }
        return false;
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {
            valid: false,
            message: i18next.t("apgames:validation._general.DEFAULT_HANDLER"),
        };

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t(
                "apgames:validation.phutball.INITIAL_INSTRUCTIONS"
            );
            return result;
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        const points = m.split("-");
        if (points.length === 1) {
            // placement, or start of capture
            // valid cell
            let coords;
            try {
                coords = PhutballGame.algebraic2coords(m);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {
                    cell: m,
                });
                return result;
            }
            if (coords[0] < 1 || coords[0] > 15 || coords[1] < 1 || coords[1] > 19) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {
                    cell: m,
                });
                return result;
            }
            if (this.board[coords[1]][coords[0]] === "B") {
                if (this.jumpPossible(this.board, coords[0], coords[1])) {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = false;
                    result.message = i18next.t("apgames:validation.phutball.CAN_JUMP", {
                        where: m,
                    });
                    return result;
                } else {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.phutball.CANT_JUMP", {
                        where: m,
                    });
                    return result;
                }
            }
            // empty cell
            if (this.board[coords[1]][coords[0]] !== "") {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", {
                    where: m,
                });
                return result;
            }
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        } else {
            // Capture sequence
            let coords;
            try {
                coords = PhutballGame.algebraic2coords(points[0]);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {
                    cell: m,
                });
                return result;
            }
            if (coords[0] < 1 || coords[0] > 15 || coords[1] < 1 || coords[1] > 19) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {
                    cell: m,
                });
                return result;
            }
            if (this.board[coords[1]][coords[0]] !== "B") {
                result.valid = false;
                result.message = i18next.t("apgames:validation.phutball.NO_BALL_HERE", {
                    cell: points[0],
                });
                return result;
            }
            const clonedboard = this.board.map((a) => {
                return { ...a };
            });
            clonedboard[coords[1]][coords[0]] = "";
            let coordsNext;
            for (let i = 1; i < points.length; i++) {
                try {
                    coordsNext = PhutballGame.algebraic2coords(points[i]);
                } catch {
                    result.valid = false;
                    result.message = i18next.t(
                        "apgames:validation._general.INVALIDCELL",
                        { cell: m }
                    );
                    return result;
                }
                if (!this.isLegalBallPosition(coordsNext)) {
                    result.valid = false;
                    result.message = i18next.t(
                        "apgames:validation._general.INVALIDCELL",
                        { cell: m }
                    );
                    return result;
                }
                if (clonedboard[coordsNext[1]][coordsNext[0]] !== "") {
                    result.valid = false;
                    result.message = i18next.t(
                        "apgames:validation.phutball.NOT_EMPTY_JUMP",
                        { to: points[i] }
                    );
                    return result;
                }
                const dx = Math.sign(coordsNext[0] - coords[0]);
                const dy = Math.sign(coordsNext[1] - coords[1]);
                const dist = Math.max(
                    Math.abs(coordsNext[0] - coords[0]),
                    Math.abs(coordsNext[1] - coords[1])
                );
                if (dist <= 1) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.phutball.NO_MOVE");
                    return result;
                }
                if (
                    coords[0] + dist * dx !== coordsNext[0] ||
                    coords[1] + dist * dy !== coordsNext[1]
                ) {
                    result.valid = false;
                    result.message = i18next.t(
                        "apgames:validation.phutball.BAD_DIRECTION",
                        { from: points[i - 1], to: points[i] }
                    );
                    return result;
                }
                for (let j = 1; j < dist; j++) {
                    if (clonedboard[coords[1] + j * dy][coords[0] + j * dx] !== "P") {
                        result.valid = false;
                        result.message = i18next.t(
                            "apgames:validation.phutball.MUST_JUMP_PLAYER",
                            {
                                cell: PhutballGame.coords2algebraic(
                                    coords[0] + j * dx,
                                    coords[1] + j * dy
                                ),
                            }
                        );
                        return result;
                    }
                    clonedboard[coords[1] + j * dy][coords[0] + j * dx] = "";
                }
                coords = coordsNext;
            }
            if (this.jumpPossible(clonedboard, coords[0], coords[1])) {
                result.valid = true;
                result.complete = 0;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.phutball.CAN_JUMP_MORE");
                return result;
            }
        }
        // Looks good
        result.valid = true;
        result.complete = 1;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
        return result;
    }

    public move(m: string): PhutballGame {
        if (this.gameover) {
            throw new UserFacingError(
                "MOVES_GAMEOVER",
                i18next.t("apgames:MOVES_GAMEOVER")
            );
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const result = this.validateMove(m);
        if (!result.valid) {
            throw new UserFacingError("VALIDATION_GENERAL", result.message);
        }
        if (!this.moves().includes(m)) {
            throw new UserFacingError(
                "VALIDATION_FAILSAFE",
                i18next.t("apgames:validation._general.FAILSAFE", { move: m })
            );
        }

        this.results = [];
        const points = m.split("-");
        if (points.length === 1) {
            // placement
            const coords = PhutballGame.algebraic2coords(m);
            this.board[coords[1]][coords[0]] = "P";
            this.results.push({ type: "place", where: m });
        } else {
            // Capture sequence
            let coords = PhutballGame.algebraic2coords(points[0]);
            this.board[coords[1]][coords[0]] = "";
            let count = 0;
            for (let i = 1; i < points.length; i++) {
                const coordsNext = PhutballGame.algebraic2coords(points[i]);
                const dx = Math.sign(coordsNext[0] - coords[0]);
                const dy = Math.sign(coordsNext[1] - coords[1]);
                const dist = Math.max(
                    Math.abs(coordsNext[0] - coords[0]),
                    Math.abs(coordsNext[1] - coords[1])
                );
                for (let j = 1; j < dist; j++) {
                    this.board[coords[1] + j * dy][coords[0] + j * dx] = "";
                }
                count += dist - 1;
                this.results.push({ type: "move", from: points[i - 1], to: points[i] });
                coords = coordsNext;
            }
            this.results.push({ type: "remove", num: count, where: points[points.length - 1] });
            this.board[coords[1]][coords[0]] = "B";
            this.ball = coords;
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

    protected checkEOG(): PhutballGame {

        if (this.ball[1] <= 1) {
            this.gameover = true;
            this.winner = [1];
        } else if (this.ball[1] >= 19) {
            this.gameover = true;
            this.winner = [2];
        }
        if (this.gameover) {
            this.results.push(
                { type: "eog" },
                { type: "winners", players: [...this.winner] }
            );
        }
        return this;
    }

    public state(): IPhutballState {
        return {
            game: PhutballGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    public moveState(): IMoveState {
        return {
            _version: PhutballGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: deepclone(this.board) as Array<Array<CellContents>>,
            ball: [...this.ball],
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 1; row < 20; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 1; col < 16; col++) {
                if (this.board[row][col] === "P") {
                    pieces.push("P");
                } else if (this.board[row][col] === "B") {
                    pieces.push("B");
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join("");
        }

        // Build rep
        const rep: APRenderRep = {
            board: {
                style: "vertex",
                width: 15,
                height: 19,
                clickDeltaX: 1,
                clickDeltaY: 1,
                markers: [
                    {
                        type: "shading",
                        belowGrid: true,
                        points: [
                            { row: 0, col: 0 },
                            { row: 0, col: 14 },
                            { row: 18, col: 14 },
                            { row: 18, col: 0 },
                        ],
                        colour: "#9ACD32",
                        opacity: 1,
                    },
                    {
                        type: "label",
                        belowGrid: true,
                        label: "⇧ player 1 ⇧",
                        points: [
                            { row: 15.1, col: 0 },
                            { row: 15.1, col: 14 },
                        ],
                        colour: "#83ae2b",
                        size: 50,
                        font: "font-family: Roboto; font-weight: Bold",
                    },
                    {
                        type: "label",
                        belowGrid: true,
                        label: "⇧ player 2 ⇧",
                        points: [
                            { row: 2.9, col: 14 },
                            { row: 2.9, col: 0 },
                        ],
                        colour: "#83ae2b",
                        size: 50,
                        font: "font-family: Roboto; font-weight: Bold",
                    },
                ],
            },
            legend: {
                P: {
                    name: "piece",
                    colour: "#000000",
                },
                B: {
                    name: "piece",
                    colour: "#ffffff",
                },
            },
            pieces: pstr,
        };

        // Add annotations
        if (this.results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "place") {
                    const [x, y] = PhutballGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y - 1, col: x - 1}]});
                } else if (move.type === "move") {
                    const [fromX, fromY] = PhutballGame.algebraic2coords(move.from);
                    const [toX, toY] = PhutballGame.algebraic2coords(move.to);
                    if (toY > 0 && toY < 20 && toX > 0 && toX < 16) {
                        rep.annotations.push({type: "move", strokeWidth: 0.04, targets: [{row: fromY - 1, col: fromX - 1}, {row: toY - 1, col: toX - 1}]});
                    } else if (toY === 0) {
                        const dx = Math.sign(toX - fromX);
                        rep.annotations.push({type: "move", strokeWidth: 0.04, targets: [{row: fromY - 1, col: fromX - 1}, {row: 0, col: toX - 1 - dx}]});
                    } else if (toY === 20) {
                        const dx = Math.sign(toX - fromX);
                        rep.annotations.push({type: "move", strokeWidth: 0.04, targets: [{row: fromY - 1, col: fromX - 1}, {row: 18, col: toX - 1 - dx}]});
                    }
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

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.phutball", {player, where: r.where}));
                resolved = true;
                break;
            case "move":
                if (results.length === 2) {
                    node.push(i18next.t("apresults:MOVE.phutball_last", {player, from: r.from, to: r.to}));
                } else if (node.length === 1) {
                    node.push(i18next.t("apresults:MOVE.phutball", {player, from: r.from, to: r.to}));
                } else if (node.length < results.length - 1) {
                    node.push(i18next.t("apresults:MOVE.phutball_to", {to: r.to}));
                } else {
                    node.push(i18next.t("apresults:MOVE.phutball_to_last", {to: r.to}));
                }
                resolved = true;
                break;
            case "remove":
                node.push(i18next.t("apresults:REMOVE.phutball", {count: r.num}));
                resolved = true;
                break;
        }
        return resolved;
    }

    protected getMoveList(): any[] {
        return this.getMovesAndResults(["place", "move"]);
    }

    public clone(): PhutballGame {
        return new PhutballGame(this.serialize());
    }
}
