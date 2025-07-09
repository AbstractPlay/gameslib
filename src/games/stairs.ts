import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { SquareGraph } from "../common/graphs";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const deepclone = require("rfdc/default");

export type PlayerId = 1|2;

export interface IMoveState extends IIndividualState {
    currplayer: PlayerId;
    board: Map<string, PlayerId[]>;
    lastmove?: string;
    tiebreaker: PlayerId;
};

export interface IStairsState extends IAPGameState {
    winner: PlayerId[];
    stack: Array<IMoveState>;
};

export class StairsGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Stairs",
        uid: "stairs",
        playercounts: [2],
        version: "20250619",
        dateAdded: "2025-06-19",
        // i18next.t("apgames:descriptions.stairs")
        description: "apgames:descriptions.stairs",
        urls: [
            "https://kanare-abstract.com/en/pages/stairs",
            "https://boardgamegeek.com/boardgame/383703/stairs"
        ],
        people: [
            {
                type: "designer",
                name: "Kanare Kato",
                urls: ["https://kanare-abstract.com/en"],
            },
            {
                type: "coder",
                name: "mcd",
                urls: ["https://mcdemarco.net/games/"],
                apid: "4bd8317d-fb04-435f-89e0-2557c3f2e66c",
            },
        ],
        categories: ["goal>score>eog", "mechanic>move", "mechanic>stack", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["experimental", "pie", "autopass", "scores"],
        variants: []
    };

    public numplayers = 2;
    public currplayer: PlayerId = 1;
    public board!: Map<string, PlayerId[]>;
    public graph?: SquareGraph;
    public gameover = false;
    public winner: PlayerId[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private tiebreaker: PlayerId = 1;
    private boardSize = 0;
    private _points: [number, number][] = [];
    private _highlight: string | undefined;

    constructor(state?: IStairsState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            this.boardSize = this.getBoardSize();
            const board: Map<string, PlayerId[]> = new Map();
            let color = 2 as PlayerId;
            for (let x = 0; x < this.boardSize; x++) {
                for (let y = 0; y < this.boardSize; y++) {
                    board.set(GameBase.coords2algebraic(x, y, this.boardSize), [color]);
                    color = (color === 1) ? 2 : 1;
                }
                color = (color === 1) ? 2 : 1;
            }

            const fresh: IMoveState = {
                _version: StairsGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                tiebreaker: 1,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IStairsState;
            }
            if (state.game !== StairsGame.gameinfo.uid) {
                throw new Error(`The Stairs engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.boardSize = this.getBoardSize();
        this.load();
        this.buildGraph();
    }

    public load(idx = -1): StairsGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;

        this.board = deepclone(state.board) as Map<string, PlayerId[]>;
        this.lastmove = state.lastmove;
        this.results = [...state._results];
        this.tiebreaker = state.tiebreaker;
        return this;
    }

    private buildGraph(): SquareGraph {
        this.graph = new SquareGraph(this.boardSize, this.boardSize);
        return this.graph;
    }

    private getGraph(boardSize?: number): SquareGraph {
        if (boardSize === undefined) {
            return (this.graph === undefined) ? this.buildGraph() : this.graph;
        } else {
            return new SquareGraph(boardSize, boardSize);
        }
    }

    // Fixes known issue with some edge cases not calling load
    private listCells(ordered = false): string[] | string[][] {
        try {
            if (ordered === undefined) {
                return this.getGraph().listCells();
            } else {
                return this.getGraph().listCells(ordered);
            }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (e) {
            return this.buildGraph().listCells(ordered);
        }
    }

    private getBoardSize(): number {
        // Get board size from variants.
        if ( (this.variants !== undefined) && (this.variants.length > 0) && (this.variants[0] !== undefined) && (this.variants[0].length > 0) ) {
            const sizeVariants = this.variants.filter(v => v.includes("size"))
            if (sizeVariants.length > 0) {
                const size = sizeVariants[0].match(/\d+/);
                return parseInt(size![0], 10);
            }
            if (isNaN(this.boardSize)) {
                throw new Error(`Could not determine the board size from variant "${this.variants[0]}"`);
            }
        }
        return 6;
    }

    private getStacks(p?: PlayerId): number[] {
        if (p === undefined) {
            p = this.currplayer;
        }
        const stackSizeArray: number[] = [];
        for (const cell of (this.listCells() as string[]).filter(c => this.board.has(c) && this.board.get(c)!.at(-1) === p)) {
            const height = this.board.get(cell)!.length;
            stackSizeArray.push(height);
        }
        return stackSizeArray.sort((a, b) => b - a);
    }

    private getStackSizes(p?: PlayerId): number[] {
        if (p === undefined) {
            p = this.currplayer;
        }
        const stacks = this.getStacks(p);
        const ones = stacks.indexOf(1) > -1 ? stacks.indexOf(1) + 1 : stacks.length;
        return stacks.slice(0,ones);
    }

    private getItemCount(sizeArray: number[], item: number): number {
        return sizeArray.filter(x => x === item).length;
    }

    private getHighCounts(sizeArray: number[]): number {
        return this.getItemCount(sizeArray, sizeArray[0]);
    }

    private truncateStackCounts(sizeArray: number[]): string {
        const uniqueSizeSet = new Set(sizeArray);
        const uniqueSizeArray = [...uniqueSizeSet].sort((a, b) => b - a);
        let truncatedStackCounts = "";
        for (let s = 0; s<uniqueSizeArray.length; s++) {
            truncatedStackCounts += (s > 0 ? ", " : "") + uniqueSizeArray[s] + "(" + this.getItemCount(sizeArray,uniqueSizeArray[s])  + ")";
        }
        return truncatedStackCounts;
    }

    public getPlayersScores(): IScores[] {
        const stackSizes1 = this.getStackSizes(1);
        const stackSizes2 = this.getStackSizes(2);
        return [
            { name: i18next.t("apgames:status.STACKSIZES"), scores: [this.truncateStackCounts(stackSizes1), this.truncateStackCounts(stackSizes2)] },
        ]
    }

    public getUpperHand(player: PlayerId): PlayerId {
	// Check whether the upper hand has passed from the previous holder (player) to currplayer, for tiebreaking.
	// Necessary because ties are broken by who got there first, not by counts of shorter stacks.
        const stackSizes1 = this.getStackSizes(1);
        const stackSizes2 = this.getStackSizes(2);
        let hasUpperHand = player;

	if (stackSizes1[0] !== stackSizes2[0]) {
            // Stack tie determined by heights.
            hasUpperHand = (stackSizes1[0] > stackSizes2[0] ? 1 : 2);
        } else {
            const count1 = this.getHighCounts(stackSizes1);
            const count2 = this.getHighCounts(stackSizes2);
            if (count1 !== count2) {
                // Stack tie determined by counts.
                hasUpperHand = (count1 > count2 ? 1 : 2);
            } else {
                // The currplayer only evened up the stack score or made an irrelevant play.
                hasUpperHand = player;
            }
        }

        return hasUpperHand;
    }

    public moves(player?: PlayerId): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        let moves: string[] = [];
        let lowest = 100;
        for (const cell of (this.listCells() as string[]).filter(c => this.board.has(c) && this.board.get(c)!.at(-1) === this.currplayer)) {
            const height = this.board.get(cell)!.length;
            if (height > lowest)
                continue;
            const neighbors = this.getGraph().neighbours(cell);
            for (const cell0 of neighbors) {
                if (this.board.has(cell0)) {
                    if (height === this.board.get(cell0)!.length) {
                        if (height < lowest) {
                            lowest = height;
                            //Reset the move array when we find a lower stair.
                            moves = [`${cell}-${cell0}`];
                        } else {
                            moves.push(`${cell}-${cell0}`);
                        }
                    }
                }
            }
        }

        if (moves.length === 0) {
            moves.push("pass");
        }

        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = this.getGraph().coords2algebraic(col, row);
            let newmove = "";
            if (move.length === 0 && this.board.has(cell) && this.board.get(cell)!.at(-1) === this.currplayer) {
                newmove = cell;
            } else if (this.board.has(move) && this.board.get(move)!.at(-1) === this.currplayer && this.board.has(cell)) {
                newmove = `${move}-${cell}`;
            }
            const result = this.validateMove(newmove) as IClickResult;
            if (!result.valid || newmove === "") {
                result.move = move;
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
        const result: IValidationResult = {valid: false, complete: -1, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        if (m.length === 0) {
            result.valid = true;
            result.message = i18next.t("apgames:validation.stairs.NORMAL_MOVE");
            return result;
        }

        const moves = this.moves();
        if (moves.includes("pass") && m !== "pass") {
            result.valid = false;
            result.message = i18next.t("apgames:validation.stairs.MUST_PASS");
            return result;
        } else if (!moves.includes(m)) {
            if (this.board.has(m) && moves.filter(move => move.startsWith(m)).length > 0) {
                result.valid = true;
                result.canrender = true;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            } else {
                result.message = i18next.t("apgames:validation.stairs.INVALID_MOVE");
            }
            return result;
        }

        // we're good
        result.valid = true;
        result.complete = 1;
        result.canrender = true;
        result.message = i18next.t("apgames:validation._general.VALID_MOVE");

        return result;
    }

    public move(m: string, { trusted = false } = {}): StairsGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        if (m.length === 0) return this;

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");

        const moves = this.moves();

        let complete = false;
        const result = this.validateMove(m);
        if (result.complete === 1) complete = true;
        if (!trusted && !result.valid) throw new UserFacingError("VALIDATION_GENERAL", result.message);

        this.results = [];
        this._points = [];
        this._highlight = undefined;

        if (complete) {
            if (m === "pass") {
                this.results.push({type: "pass"});
            } else {
                const cells: string[] = m.split("-");
                const oldStack = [...this.board.get(cells[0])!];
                const piece = oldStack.pop()!;
                if (oldStack.length === 0) this.board.delete(cells[0]);
                else this.board.set(cells[0], oldStack);
                const newStack = [...this.board.get(cells[1])!];
                newStack.push(piece);
                this.board.set(cells[1], newStack);
                // update tiebreaker
                this.results.push({type: "move", from: cells[0], to: cells[1]});
                const newTiebreaker = this.getUpperHand(this.tiebreaker);
		if (this.tiebreaker !== newTiebreaker) {
		    this.results.push({type: "lead"});
		}
                this.tiebreaker = newTiebreaker;
            }

            // update currplayer
            this.lastmove = m;
            this.currplayer = this.getOtherPlayer(this.currplayer);

            this.checkEOG();
            this.saveState();
        } else {
            this._highlight = m;
            for (const move of moves.filter(mv => mv.startsWith(m))) {
                const cells = move.split("-");
                const coords = this.getGraph().algebraic2coords(cells[1]);
                this._points.push(coords);
            }
        }

        return this;
    }

    private getOtherPlayer(player: PlayerId): PlayerId {
        const otherplayer = (player as number) + 1;
        if (otherplayer > this.numplayers) return 1;
        return otherplayer as PlayerId;
    }

    protected checkEOG(): StairsGame {
        if (this.stack.length > 1 && this.lastmove === "pass" && this.stack[this.stack.length - 1].lastmove === "pass") {
            this.gameover = true;
            this.winner = [this.tiebreaker];
        }
        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IStairsState {
        return {
            game: StairsGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: StairsGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            tiebreaker: this.tiebreaker,

            board: deepclone(this.board) as Map<string, PlayerId[]>
        };
    }

    public render(): APRenderRep {
        let pstr = "";
        for (const row of this.listCells(true)) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            let pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    let str = "";
                    for (const player of this.board.get(cell)!) {
                        if (player === 1) {
                            str += this._highlight === cell ? "C" : "A";
                        } else {
                            str += this._highlight === cell ? "D" : "B";
                        }
                    }
                    pieces.push(str);
                } else {
                    pieces.push("-");
                }

            }
            // If all elements are "-", replace with "_"
            if (pieces.every(p => p === "-")) {
                pieces = ["_"];
            }
            pstr += pieces.join(",");
        }

        // Build rep
        const rep: APRenderRep =  {
            renderer: "stacking-offset",
            board: {
                style: "squares",
                width: this.boardSize,
                height: this.boardSize
            },
            legend: {
                A: { name: "piece", colour: 1 },
                B: { name: "piece", colour: 2 },
                C: { name: "piece-horse", colour: 1 },
                D: { name: "piece-horse", colour: 2 }
            },
            pieces: pstr
        };

        rep.annotations = [];
        for (const move of this.stack[this.stack.length - 1]._results) {
            if (move.type === "move") {
                const [fromX, fromY] = this.getGraph().algebraic2coords(move.from);
                const [toX, toY] = this.getGraph().algebraic2coords(move.to);
                rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
            }
        }
        if (this._points.length > 0) {
            const points = [];
            for (const coords of this._points) {
                points.push({ row: coords[1], col: coords[0] });
            }
            rep.annotations.push({type: "dots", targets: points as [{row: number; col: number;}, ...{row: number; col: number;}[]]});
        }

        if (rep.annotations.length === 0) {
            delete rep.annotations;
        }

        return rep;
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Stacks**: " + this.getPlayersScores()[0].scores.join(", ") + "\n\n";

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "lead":
                node.push(i18next.t("apresults:LEAD", { player }));
                resolved = true;
                break;
            case "move":
                node.push(i18next.t("apresults:MOVE.complete", { player, from: r.from, to: r.to, what: "piece" }));
                resolved = true;
                break;
            case "pass":
                node.push(i18next.t("apresults:PASS.forced", { player }));
                resolved = true;
                break;
            case "eog":
                node.push(i18next.t("apresults:EOG.default"));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): StairsGame {
        return new StairsGame(this.serialize());
    }

}
