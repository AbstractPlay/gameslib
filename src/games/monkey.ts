/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, UserFacingError, allDirections } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

export type playerid = 1|2;
type CellContents = [playerid, number];

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    lastmove?: string;
};

export interface IMonkeyQueenState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class MonkeyQueenGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Monkey Queen",
        uid: "monkey",
        playercounts: [2],
        version: "20211213",
        // i18next.t("apgames:descriptions.monkey")
        description: "apgames:descriptions.monkey",
        urls: ["http://www.marksteeregames.com/Monkey_Queen_rules.html"],
        people: [
            {
                type: "designer",
                name: "Mark Steere",
                urls: ["http://www.marksteeregames.com/"]
            },
        ],
        flags: ["pie","perspective", "check"]
    };

    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 12);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 12);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, CellContents>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IMonkeyQueenState | string) {
        super();
        if (state === undefined) {
            const board = new Map<string, CellContents>([
                ["g1", [1, 20]], ["f12", [2, 20]]
            ]);
            const fresh: IMoveState = {
                _version: MonkeyQueenGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IMonkeyQueenState;
            }
            if (state.game !== MonkeyQueenGame.gameinfo.uid) {
                throw new Error(`The Monkey Queen engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): MonkeyQueenGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = deepclone(state.board) as Map<string, CellContents>;
        this.lastmove = state.lastmove;
        this.results = [...state._results];
        return this;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        const moves: string[] = [];

        const grid = new RectGrid(12, 12);
        const pieces = [...this.board.entries()].filter(e => e[1][0] === player);
        const enemyqueen = [...this.board.entries()].filter(e => e[1][0] !== player && e[1][1] > 1).map(e => e[0]);
        if (enemyqueen.length !== 1) {
            throw new Error("Could not find enemy queen.");
        }
        const [xEQ, yEQ] = MonkeyQueenGame.algebraic2coords(enemyqueen[0]);

        for (const piece of pieces) {
            const from = piece[0];
            const [x, y] = MonkeyQueenGame.algebraic2coords(from);
            const stack = piece[1][1];
            for (const dir of allDirections) {
                const ray = grid.ray(x, y, dir).map(pt => MonkeyQueenGame.coords2algebraic(...pt));
                for (const to of ray) {
                    // non-capturing
                    if (! this.board.has(to)) {
                        // queens can only do non-capturing moves if the stack is greater than 2 high
                        if (stack > 2) {
                            moves.push(`${from}-${to}`);
                        // singletons have to move closer to enemy queen
                        } else if (stack === 1) {
                            const fromDist = RectGrid.trueDistance(x, y, xEQ, yEQ);
                            const toDist = RectGrid.trueDistance(...MonkeyQueenGame.algebraic2coords(to), xEQ, yEQ);
                            if (toDist < fromDist) {
                                moves.push(`${from}-${to}`);
                            }
                        }
                    // capturing
                    } else {
                        if (this.board.get(to)![0] !== player) {
                            moves.push(`${from}x${to}`);
                        }
                        break;
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

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = MonkeyQueenGame.coords2algebraic(col, row);
            let newmove = "";
            if (move.length > 0) {
                let prev = move;
                if (move.includes("-")) {
                    prev = move.split("-")[0];
                }
                if (this.board.has(cell)) {
                    if (this.board.get(cell)![0] !== this.currplayer) {
                        newmove = `${prev}x${cell}`;
                    } else {
                        newmove = cell;
                    }
                } else {
                    newmove = `${prev}-${cell}`;
                }
            } else if ( (this.board.has(cell)) && (this.board.get(cell)![0] === this.currplayer) ) {
                newmove = cell;
            } else {
                return {move: "", message: ""} as IClickResult;
            }
            const result = this.validateMove(newmove) as IClickResult;
            if (! result.valid) {
                result.move = "";
            } else {
                result.move = newmove;
            }
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", {move, row, col, piece, emessage: (e as Error).message})
            }
        }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.monkey.INITIAL_INSTRUCTIONS")
            return result;
        }

        const [from, to] = m.split(/[-x]/);
        let xFrom: number; let yFrom: number;
        try {
            [xFrom, yFrom] = MonkeyQueenGame.algebraic2coords(from);
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: from});
            return result;
        }
        // `from` has a piece
        if (! this.board.has(from)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: from});
            return result;
        }
        // that piece belongs to you
        if (this.board.get(from)![0] !== this.currplayer) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
            return result;
        }

        // valid partial, if no `to`
        if ( (to === undefined) || (to.length === 0) ) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.monkey.PARTIAL");
            return result;
        } else {
            let xTo: number; let yTo: number;
            try {
                [xTo, yTo] = MonkeyQueenGame.algebraic2coords(to);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: to});
                return result;
            }
            // cells are different
            if (from === to) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: to});
                return result;
            }
            // line of sight
            const bearing = RectGrid.bearing(xFrom, yFrom, xTo, yTo)!;
            const grid = new RectGrid(12, 12);
            const ray = grid.ray(xFrom, yFrom, bearing).map(pt => MonkeyQueenGame.coords2algebraic(...pt));
            if (! ray.includes(to)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NOLOS", {from, to});
                return result;
            }
            // obstruction
            let obstruction: string|undefined;
            for (const cell of ray) {
                if (cell === to) {
                    break;
                }
                if (this.board.has(cell)) {
                    obstruction = cell;
                    break;
                }
            }
            if (obstruction !== undefined) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OBSTRUCTED", {from, to, obstruction});
                return result;
            }

            // correct operator
            if (m.includes("-")) {
                // is the space empty
                if (this.board.has(to)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.MOVE4CAPTURE", {where: to});
                    return result;
                }
                // queens can only do noncapturing moves if the stack is higer than 2
                if (this.board.get(from)![1] === 2) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.monkey.QUEEN_DEPLETED");
                    return result;
                // singletons can only do noncapturing moves if they move closer to the enemy queen
                } else if (this.board.get(from)![1] === 1) {
                    const enemyqueen = [...this.board.entries()].filter(e => e[1][0] !== this.currplayer && e[1][1] > 1).map(e => e[0]);
                    if (enemyqueen.length !== 1) {
                        throw new Error("Could not find enemy queen.");
                    }
                    const [xEQ, yEQ] = MonkeyQueenGame.algebraic2coords(enemyqueen[0]);
                    const fromDist = RectGrid.trueDistance(xFrom, yFrom, xEQ, yEQ);
                    const toDist = RectGrid.trueDistance(xTo, yTo, xEQ, yEQ);
                    if (toDist >= fromDist) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.monkey.MOVE_CLOSER");
                        return result;
                    }
                }
            } else {
                // is there a piece to capture
                if (! this.board.has(to)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.CAPTURE4MOVE", {where: to});
                    return result;
                }
                // is it an enemy piece
                if (this.board.get(to)![0] === this.currplayer) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.SELFCAPTURE");
                    return result;
                }
            }

            // Looks good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
    }

    public move(m: string, {trusted = false} = {}): MonkeyQueenGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (! this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];
        const [from, to] = m.split(/[-x]/);
        const stack = this.board.get(from)![1];
        // noncapturing moves first
        if (m.includes("-")) {
            if (stack > 2) {
                this.board.set(from, [this.currplayer, 1]);
                this.board.set(to, [this.currplayer, stack - 1]);
                this.results.push({type: "move", from, to, what: "queen"});
            } else if (stack === 1) {
                this.board.delete(from);
                this.board.set(to, [this.currplayer, 1]);
                this.results.push({type: "move", from, to, what: "single"});
            } else {
                throw new Error("Tried to do a noncapturing move with a size-two queen.");
            }
        // capturing moves
        } else {
            const capped = this.board.get(to)![1];
            this.board.delete(from);
            this.board.set(to, [this.currplayer, stack]);
            if (stack > 1) {
                this.results.push({type: "move", from, to, what: "queen"});
            } else {
                this.results.push({type: "move", from, to, what: "single"});
            }
            if (capped > 1) {
                this.results.push({type: "capture", where: to, what: "queen"})
            } else {
                this.results.push({type: "capture", where: to, what: "single"})
            }
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

    protected checkEOG(): MonkeyQueenGame {
        let prevPlayer: playerid = 1;
        if (this.currplayer === 1) {
            prevPlayer = 2;
        }
        // No moves or no queen, you lose
        if (this.moves().length === 0) {
            this.gameover = true;
            this.winner = [prevPlayer];
        } else if ([...this.board.entries()].filter(e => e[1][0] === this.currplayer && e[1][1] > 1).length === 0) {
            this.gameover = true;
            this.winner = [prevPlayer];
        }
        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IMonkeyQueenState {
        return {
            game: MonkeyQueenGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: MonkeyQueenGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < 12; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < 12; col++) {
                const cell = MonkeyQueenGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    if (contents[0] === 1) {
                        if (contents[1] > 1) {
                            pieces.push("AQ");
                        } else {
                            pieces.push("A");
                        }
                    } else if (contents[0] === 2) {
                        if (contents[1] > 1) {
                            pieces.push("BQ");
                        } else {
                            pieces.push("B");
                        }
                    }
                } else {
                    pieces.push("");
                }
            }
            pstr += pieces.join(",");
        }
        pstr = pstr.replace(/\n,{11}(?=\n)/g, "\n_");

        let aSize = 0; let bSize = 0;
        const queens = [...this.board.entries()].filter(e => e[1][1] > 1).map(e => e[1]);
        for (const q of queens) {
            if (q[0] === 1) {
                aSize = q[1];
            } else if (q[0] === 2) {
                bSize = q[1];
            }
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-checkered",
                width: 12,
                height: 12,
            },
            legend: {
                A: {
                    name: "piece",
                    player: 1
                },
                AQ: [
                    {
                        name: "piece",
                        player: 1
                    },
                    {
                        text: aSize.toString(),
                        colour: "#000",
                        scale: 0.75,
                    }
                ],
                B: {
                    name: "piece",
                    player: 2
                },
                BQ: [
                    {
                        name: "piece",
                        player: 2
                    },
                    {
                        text: bSize.toString(),
                        colour: "#000",
                        scale: 0.75,
                    }
                ]
            },
            pieces: pstr
        };

        // Add annotations
        if (this.results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "move") {
                    const [fromX, fromY] = MonkeyQueenGame.algebraic2coords(move.from);
                    const [toX, toY] = MonkeyQueenGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "capture") {
                    const [x, y] = MonkeyQueenGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                }
            }
        }

        return rep;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "move":
                if (r.what === "queen") {
                    node.push(i18next.t("apresults:MOVE.monkey", {context: "queen", player, from: r.from, to: r.to}));
                } else {
                    node.push(i18next.t("apresults:MOVE.monkey", {context: "single", player, from: r.from, to: r.to}));
                }
                resolved = true;
                break;
            case "capture":
                if (r.what === "queen") {
                    node.push(i18next.t("apresults:CAPTURE.monkey", {context: "queen"}));
                } else {
                    node.push(i18next.t("apresults:CAPTURE.monkey", {context: "single"}));
                }
                resolved = true;
                break;
        }
        return resolved;
    }

    public inCheck(): number[] {
        const checked: number[] = [];
        const grid = new RectGrid(12, 12);
        // check each queen
        const queens = [...this.board.entries()].filter(([,[,size]]) => size > 1);
        for (const [cell, [player,]] of queens) {
            // if it can see an enemy piece, it's in check
            let canSee = false;
            const [x,y] = MonkeyQueenGame.algebraic2coords(cell);
            for (const dir of allDirections) {
                const ray = grid.ray(x,y,dir).map(n => MonkeyQueenGame.coords2algebraic(...n)).filter(c => this.board.has(c));
                if (ray.length > 0) {
                    if (this.board.get(ray[0])![0] !== player) {
                        canSee = true;
                        break;
                    }
                }
            }
            if (canSee) {
                checked.push(player);
            }
        }
        return checked;
    }

    public clone(): MonkeyQueenGame {
        return new MonkeyQueenGame(this.serialize());
    }
}
