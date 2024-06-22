import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { randomInt, reviver, UserFacingError, SquareOrthGraph } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-var-requires
const deepclone = require("rfdc/default");

export type playerid = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, number>;
    roll: number;
    lastmove?: string;
};

export interface ITBTState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class TBTGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Take-Back-Toe",
        uid: "tbt",
        playercounts: [2],
        version: "20240209",
        dateAdded: "2024-02-13",
        // i18next.t("apgames:descriptions.tbt")
        description: "apgames:descriptions.tbt",
        // i18next.t("apgames:notes.tbt")
        notes: "apgames:notes.tbt",
        urls: ["https://static1.squarespace.com/static/5e1ce8815cb76d3000d347f2/t/642651dba939a00630eae0d7/1680232925727/TBTRules2023.pdf"],
        people: [
            {
                type: "designer",
                name: "James Ernest",
                urls: ["https://crabfragmentlabs.com/"],
            },
            {
                type: "publisher",
                name: "Crab Fragment Labs",
                urls: ["https://crabfragmentlabs.com/"],
            },
        ],
        categories: ["goal>align", "mechanic>share",  "mechanic>move", "mechanic>stack", "mechanic>random>play", "board>shape>rect", "board>connect>rect", "components>simple>1c"],
        flags: ["perspective", "automove", "no-explore"]
    };
    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 3);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 3);
    }
    public static clone(obj: TBTGame): TBTGame {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        const cloned: TBTGame = Object.assign(new TBTGame(), deepclone(obj) as TBTGame);
        return cloned;
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, number>;
    public gameover = false;
    public roll!: number;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: ITBTState | string) {
        super();
        if (state === undefined) {
            const d1 = randomInt(6);
            const board = new Map<string, number>([
                ["a2", 10],
                ["b2", 10],
                ["c2", 10],
                ["d2", 10],
            ]);
            const fresh: IMoveState = {
                _version: TBTGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                roll: d1,
            };
            this.results = [{type: "roll", values: [d1]}];
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as ITBTState;
            }
            if (state.game !== TBTGame.gameinfo.uid) {
                throw new Error(`The Take-Back-Toe engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): TBTGame {
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
        this.roll = state.roll;
        return this;
    }

    private boardId(): string {
        const g = new SquareOrthGraph(4, 3);
        const sizes: number[][] = [];
        for (const row of g.listCells(true) as string[][]) {
            const line: number[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    line.push(this.board.get(cell)!);
                } else {
                    line.push(0);
                }
            }
            sizes.push(line);
        }
        return sizes.map(lst => lst.join(",")).join("\n");
    }

    public moves(): string[] {
        if (this.gameover) { return []; }

        const moves: string[] = [];
        const g = new SquareOrthGraph(4, 3);
        for (const [cell, stack] of this.board.entries()) {
            if (stack >= this.roll) {
                for (const n of g.neighbours(cell)) {
                    moves.push(`${cell}-${n}`);
                }
            }
        }

        const validMoves = moves.filter(mv => {
            if (this.stack.length <= 2) {
                return true;
            }
            const old = TBTGame.clone(this);
            old.load(-2);
            const cloned = TBTGame.clone(this);
            cloned.move(mv, {trusted: true});
            if (cloned.boardId() === old.boardId()) {
                // console.log(`Mirror move found:\nMove: ${mv}\nOld: ${old.boardId()}\nNew: ${cloned.boardId()}`);
                return false;
            }
            return true;
        });

        if (validMoves.length === 0) {
            validMoves.push("pass");
        }
        return validMoves;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = TBTGame.coords2algebraic(col, row);
            let newmove = "";

            // fresh click
            if (move.length === 0) {
                if (this.board.has(cell)) {
                    newmove = cell;
                }
            }
            // continuation
            else {
                newmove = `${move}-${cell}`;
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

        m = m.toLowerCase().replace(/\s+/g, "");
        const g = new SquareOrthGraph(4, 3);

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.tbt.INITIAL_INSTRUCTIONS")
            return result;
        }

        // pass
        if (m === "pass") {
            if (! this.moves().includes("pass")) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.tbt.BAD_PASS");
                return result;
            } else {
                // all good
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
        }

        const [from, to] = m.split("-");

        // FROM
        // valid cell
        try {
            TBTGame.algebraic2coords(from);
        } catch {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: from});
            return result;
        }
        // has pieces
        if (! this.board.has(from)) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: from});
            return result;
        }
        // has enough pieces
        if (this.board.get(from)! < this.roll) {
            result.valid = false;
            result.message = i18next.t("apgames:validation.tbt.TOO_SHORT", {where: from, roll: this.roll});
            return result;
        }

        // TO
        if (to !== undefined) {
            // valid cell
            try {
                TBTGame.algebraic2coords(to);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: to});
                return result;
            }
            // orthogonally adjacent
            if (! g.neighbours(from).includes(to)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.tbt.NOT_ORTH", {from, to});
                return result;
            }

            // the only reason for the move to not be in the move list at this point
            // is if it's reverting the board state
            if (! this.moves().includes(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.tbt.NO_REVERSE");
                return result;
            }

            // all good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
        // valid partial
        else {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.tbt.PARTIAL")
            return result;
        }
    }

    public move(m: string, {trusted = false} = {}): TBTGame {
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
        if (m !== "pass") {
            const [from, to] = m.split("-");
            const fStack = this.board.get(from)!;
            let tStack = 0;
            if (this.board.has(to)) {
                tStack = this.board.get(to)!;
            }
            if (fStack - this.roll === 0) {
                this.board.delete(from);
            } else {
                this.board.set(from, fStack - this.roll);
            }
            this.board.set(to, tStack + this.roll);
            this.results.push({type: "move", from, to, what: this.roll.toString()});
        } else {
            this.results.push({type: "pass"});
        }

        this.lastmove = m;
        // reroll the dice
        const d1 = randomInt(6);
        this.roll = d1;
        this.results.push({type: "roll", values: [d1]});

        // update currplayer
        let newplayer = (this.currplayer as number) + 1;
        if (newplayer > this.numplayers) {
            newplayer = 1;
        }
        this.currplayer = newplayer as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): TBTGame {
        for (const p of [1,2] as playerid[]) {
            let homerow = 0;
            if (p === 1) {
                homerow = 2;
            }
            const cells: string[] = [];
            for (let x = 0; x < 4; x++) {
                cells.push(TBTGame.coords2algebraic(x, homerow));
            }
            const counts = new Map<number, number>();
            for (const cell of cells) {
                if (this.board.has(cell)) {
                    const height = this.board.get(cell)!;
                    if (counts.has(height)) {
                        const curr = counts.get(height)!;
                        counts.set(height, curr + 1);
                    } else {
                        counts.set(height, 1);
                    }
                }
            }
            if ([...counts.values()].includes(3)) {
                this.gameover = true;
                this.winner = [p];
                break;
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

    public state(): ITBTState {
        return {
            game: TBTGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: TBTGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            roll: this.roll,
        };
    }

    public render(): APRenderRep {
        // Build piece string
        const allSizes = new Set<number>();
        let pstr = "";
        const graph = new SquareOrthGraph(4, 3);
        const cells = graph.listCells(true);
        for (const row of cells) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const size = this.board.get(cell)!;
                    allSizes.add(size);
                    pieces.push(`P${size}`);
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join(",");
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares",
                width: 4,
                height: 3,
                startLight: true,
                markers: [
                    {
                        type: "edge",
                        "colour": 1,
                        "edge": "S"
                    },
                    {
                        type: "edge",
                        "colour": 2,
                        "edge": "N"
                    }
                ]
            },
            legend: {
                D601: {
                    name: "d6-1",
                    opacity: 0.25,
                    scale: 0.5
                },
                D602: {
                    name: "d6-2",
                    opacity: 0.25,
                    scale: 0.5
                },
                D603: {
                    name: "d6-3",
                    opacity: 0.25,
                    scale: 0.5
                },
                D604: {
                    name: "d6-4",
                    opacity: 0.25,
                    scale: 0.5
                },
                D605: {
                    name: "d6-5",
                    opacity: 0.25,
                    scale: 0.5
                },
                D606: {
                    name: "d6-6",
                    opacity: 0.25,
                    scale: 0.5
                },
                D1: {
                    name: `d6-${this.roll}`,
                },
            },
            pieces: pstr,
            areas: [
                {
                    type: "key",
                    list: [
                        {
                            piece: "D1",
                            name: ""
                        },
                    ],
                    position: "right",
                    clickable: false,
                    height: 1
                },
            ]
        };

        // expand legend with all the pieces
        for (const size of allSizes) {
            rep.legend![`P${size}`] = [
                {
                    name: "piece",
                    colour: "#fff",
                },
                {
                    text: size.toString(),
                    colour: "#000",
                    scale: 0.75,
                }
            ]
        }

        // add previous dice rolls
        if (this.stack.length > 1) {
            const prevRoll = this.stack[this.stack.length - 2].roll;
            rep.legend!.PD1 = {
                name: `d6-${prevRoll}`,
            }
            rep.areas!.push({
                type: "pieces",
                pieces: ["PD1"],
                label: i18next.t("apgames:validation.tbt.LABEL_PREVIOUS") || "local",
            });
        }

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = TBTGame.algebraic2coords(move.from);
                    const [toX, toY] = TBTGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
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
            case "move":
                node.push(i18next.t("apresults:MOVE.complete", {player, from: r.from, to: r.to, count: parseInt(r.what!, 10)}));
                resolved = true;
                break;
            case "roll":
                node.push(i18next.t("apresults:ROLL.single", {player, values: r.values.join(",")}));
                resolved = true;
                break;
            case "pass":
                node.push(i18next.t("apresults:PASS.forced", {player}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): TBTGame {
        return new TBTGame(this.serialize());
    }
}
