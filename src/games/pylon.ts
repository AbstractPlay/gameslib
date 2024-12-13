/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { shuffle, SquareGraph, SquareOrthGraph } from "../common";
import { APRenderRep, AreaPieces, Glyph } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, UserFacingError } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const clone = require("rfdc/default");

export type playerid = 1|2|3|4;
type Stash = [number, number, number];
export type Size = 1|2|3;
export type CellContents = [playerid, Size][];

interface ILegendObj {
    [key: string]: Glyph|[Glyph, ...Glyph[]];
}

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    lastmove?: string;
}

export interface IPylonState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

/**
 * @param s1 - the stack that is moving (top stack)
 * @param s2 - the stack being moved to (bottom stack)
 * @returns whether s1 can be placed on top of s2
 */
const canStack = (s1: CellContents, s2: CellContents): boolean => {
    return s1[0][1] <= s2[s2.length - 1][1];
}

export class PylonGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Pylon",
        uid: "pylon",
        playercounts: [2],
        version: "20241204",
        dateAdded: "2024-12-13",
        // i18next.t("apgames:descriptions.pylon")
        description: "apgames:descriptions.pylon",
        urls: [
            "https://looneypyramids.wiki/wiki/Pylon",
            "https://boardgamegeek.com/boardgame/34811/pylon",
        ],
        people: [
            {
                type: "designer",
                name: "Doug Orleans",
                urls: ["https://boardgamegeek.com/boardgamedesigner/10202/doug-orleans"]
            }
        ],
        variants: [
            {
                uid: "quickStart",
                group: "setup",
            }
        ],
        categories: ["goal>score>eog", "mechanic>place", "mechanic>move", "mechanic>stack", "mechanic>share", "board>shape>rect", "board>connect>rect", "components>pyramids"],
        flags: ["scores", "random-start", "automove"]
    };

    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 5);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 5);
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: Map<string, CellContents>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = []

    constructor(state?: IPylonState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const board = new Map<string, CellContents>();
            if (this.variants.includes("quickStart")) {
                const pcs: CellContents[] = [];
                for (let p = 1; p <= 2; p++) {
                    for (let size = 1; size <= 3; size++) {
                        for (let i = 0; i < 5; i++) {
                            pcs.push([[p as playerid, size as Size]]);
                        }
                    }
                }
                const shuffled = shuffle(pcs) as CellContents[];
                for (let y = 0; y < 5; y++) {
                    for (let x = 0; x < 6; x++) {
                        const cell = PylonGame.coords2algebraic(x, y);
                        const pc = shuffled.shift();
                        if (pc === undefined) {
                            throw new Error("Something terrible happened when randomly placing starting pieces.");
                        }
                        board.set(cell, pc);
                    }
                }
            }

            const fresh: IMoveState = {
                _version: PylonGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IPylonState;
            }
            if (state.game !== PylonGame.gameinfo.uid) {
                throw new Error(`The Pylon game code cannot process a game of '${state.game}'.`);
            }
            this.numplayers = state.numplayers;
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): PylonGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = clone(state.board) as Map<string, CellContents>;
        this.lastmove = state.lastmove;
        return this;
    }

    public getStash(player: playerid): Stash {
        const stash: Stash = [5,5,5];
        const owned = [...this.board.values()].flat().filter(pc => pc[0] === player)
        for (const [,size] of owned) {
            stash[size-1]--;
        }
        return stash;
    }

    private get mode(): "place"|"stack" {
        let hasStacks = false;
        for (const pcs of this.board.values()) {
            if (pcs.length > 1) {
                hasStacks = true;
                break;
            }
        }
        if ([...this.board.keys()].length === 30 || hasStacks) {
            return "stack";
        }
        return "place";
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) {
            return [];
        }

        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];
        // if placing
        if (this.mode === "place") {
            const g = new SquareGraph(6, 5);
            const empty = (g.listCells(false) as string[]).filter(c => !this.board.has(c));
            const stash = this.getStash(player);
            for (let i = 0; i < 3; i++) {
                if (stash[i] > 0) {
                    for (const cell of empty) {
                        moves.push(`${i+1}${cell}`);
                    }
                }
            }
        }
        // otherwise stacking
        else {
            const g = new SquareOrthGraph(6, 5);
            for (const from of this.board.keys()) {
                const sTop = this.board.get(from)!;
                for (const to of g.neighbours(from)) {
                    if (this.board.has(to)) {
                        const sBottom = this.board.get(to)!;
                        if (canStack(sTop, sBottom)) {
                            moves.push(`${from}-${to}`);
                        }
                    }
                }
            }
        }

        if (moves.length === 0) {
            moves.push("pass");
        }
        return moves.sort((a,b) => a.localeCompare(b));
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove: string;

            // if clicking the board
            if (row >= 0 && col >= 0) {
                const cell = PylonGame.coords2algebraic(col, row);
                // if move is empty, the must be selecting a stack to move
                if (move === "") {
                    newmove = cell;
                }
                // if it's a single character, you must be be placing a piece
                else if (move.length === 1) {
                    newmove = `${move}${cell}`;
                }
                // otherwise you must be completing a move
                else {
                    newmove = `${move}-${cell}`;
                }
            }
            // otherwise the stash
            else {
                if (piece !== undefined) {
                    newmove = piece[1];
                } else {
                    newmove = "";
                }
            }

            // autocomplete
            const possible = this.moves().filter(m => m.startsWith(newmove));
            if (possible.length === 1) {
                newmove = possible[0];
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

        const g = new SquareGraph(6, 5);

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.pylon.INITIAL_INSTRUCTIONS", {context: this.mode})
            return result;
        }

        if (m === "pass") {
            if (!this.moves().includes("pass")) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pylon.BAD_PASS")
                return result;
            } else {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
        }

        // movement
        // partial first
        if (m.length === 2) {
            // valid cell
            if (!(g.listCells(false) as string[]).includes(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: m})
                return result;
            }
            // occupied
            if (!this.board.has(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: m})
                return result;
            }
            // has legal moves
            if (this.moves().filter(mv => mv.startsWith(m)).length === 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NO_MOVES", {where: m})
                return result;
            }

            // valid partial
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.pylon.PARTIAL_MOVEMENT");
            return result;
        }
        // full move
        else if (m.includes("-") && m.length === 5) {
            const [from, to] = m.split("-");
            for (const cell of [from, to]) {
                // valid cell
                if (!(g.listCells(false) as string[]).includes(cell)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell})
                    return result;
                }
            }
            // occupied from
            if (!this.board.has(from)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: from})
                return result;
            }
            // occupied to
            if (!this.board.has(to)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pylon.MUST_STACK")
                return result;
            }

            const sTop = this.board.get(from)!;
            const sBottom = this.board.get(to)!;
            if (!canStack(sTop, sBottom)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pylon.BAD_STACK", {from, to})
                return result;
            }

            // we're good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
        // placement
        // partial first
        else if (m.length === 1) {
            const size = parseInt(m, 10);
            // valid size
            if (![1,2,3].includes(size)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pylon.INVALID_SIZE")
                return result;
            }
            // enough pieces
            if (this.getStash(this.currplayer)[size-1] < 1) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pylon.NO_PIECE", {size})
                return result;
            }

            // valid partial
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.pylon.PARTIAL_PLACEMENT", {size: size === 1 ? "small" : size === 2 ? "medium" : "large"});
            return result;
        }
        // full placement
        else if (m.length === 3) {
            const size = parseInt(m[0], 10);
            const cell = m.substring(1);

            // valid size
            if (![1,2,3].includes(size)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pylon.INVALID_SIZE")
                return result;
            }
            // enough pieces
            if (this.getStash(this.currplayer)[size-1] < 1) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pylon.NO_PIECE", {size})
                return result;
            }
            // valid space
            if (!(g.listCells(false) as string[]).includes(cell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                return result;
            }
            // the space is empty
            if (this.board.has(cell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: cell});
                return result;
            }

            // looks good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }

        // at this point, it's an invalid move
        result.valid = false;
        result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m})
        return result;
    }

    public move(m: string, {trusted = false, partial = false} = {}): PylonGame {
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
            if ( (! partial) && (! this.moves().includes(m)) ) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            } else if ( (partial) && (this.moves().filter(x => x.startsWith(m)).length < 1) ) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        this.results = [];

        // pass first
        if (m === "pass") {
            this.results.push({type: "pass"});
        }
        // placement
        else if (this.mode === "place") {
            if (m.length === 3) {
                const size = parseInt(m[0], 10) as Size;
                const cell = m.substring(1);
                this.board.set(cell, [[this.currplayer, size]]);
                this.results.push({type: "place", what: size.toString(), where: cell});
            }
        } else {
            const [from, to] = m.split("-");
            const sTop = this.board.get(from) || [];
            const sBottom = this.board.get(to) || [];
            const sNew: CellContents = [...sBottom, ...sTop];
            this.board.delete(from);
            this.board.set(to, sNew);
            this.results.push({type: "move", from, to});
        }

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

    protected checkEOG(): PylonGame {
        // If two passes in a row, we need to end
        if ( (this.lastmove === "pass") && (this.stack[this.stack.length - 1].lastmove === "pass") ) {
            this.gameover = true;
            const s1 = this.getPlayerScore(1);
            const s2 = this.getPlayerScore(2);
            if (s1 > s2) {
                this.winner = [1];
            } else if (s2 > s1) {
                this.winner = [2];
            } else {
                this.winner = [1,2];
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

    public state(): IPylonState {
        return {
            game: PylonGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: PylonGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: clone(this.board) as Map<string, CellContents>,
        };
    }

    private renderPiecesHelper(s: CellContents): string[] {
        const ret: string[] = [];
        for (const piece of s) {
            const maxj = piece[1] - ret.length - 1;
            for (let j = 0; j < maxj; j++)
                ret.push("-");
            ret.push(`${piece[0] === 1 ? "A" : "B"}${piece[1]}`);
        }
        return ret;
    }

    public render(): APRenderRep {
        // Build piece object
        const pieces: string[][][] = [];
        for (let row = 0; row < 5; row++) {
            const rownode: string[][] = [];
            for (let col = 0; col < 6; col++) {
                let cellnode: string[] = [];
                const cell = PylonGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    cellnode = [...this.renderPiecesHelper(this.board.get(cell)!)];
                }
                rownode.push(cellnode);
            }
            pieces.push(rownode);
        }


        const prefixes = ["A", "B"]
        const myLegend: ILegendObj = {
            "SPACER": {
                name: "piece-square-borderless",
                colour: "_context_background",
            }
        };
        for (let n = 0; n < this.numplayers; n++) {
            myLegend[prefixes[n] + "1"] = {
                name: "pyramid-up-small-3D",
                colour: n+1,
            };
            myLegend[prefixes[n] + "2"] = {
                name: "pyramid-up-medium-3D",
                colour: n+1,
            };
            myLegend[prefixes[n] + "3"] = {
                name: "pyramid-up-large-3D",
                colour: n+1,
            };
            // myLegend["PC" + prefixes[n] + "1"] = {
            //     name: "pyramid-up-small-upscaled",
            //     colour: n+1,
            // };
            // myLegend["PC" + prefixes[n] + "2"] = {
            //     name: "pyramid-up-medium-upscaled",
            //     colour: n+1,
            // };
            // myLegend["PC" + prefixes[n] + "3"] = {
            //     name: "pyramid-up-large-upscaled",
            //     colour: n+1,
            // };
        }

        const areas: AreaPieces[] = [];
        for (let p = 1; p <= this.numplayers; p++) {
            const stash = this.getStash(p as playerid);
            // don't render any stash if it's empty
            if (stash.reduce((prev, curr) => prev + curr, 0) === 0) {
                continue;
            }
            const pcs: string[] = [];
            for (let size = 1; size <= 3; size++) {
                // skip empty rows
                if (stash[size-1] === 0) { continue; }
                for (let i = 0; i < 5; i++) {
                    if (stash[size-1] > i) {
                        pcs.push(`${prefixes[p-1]}${size}`);
                    } else {
                        pcs.push("SPACER");
                    }
                }
            }
            if (pcs.length > 0) {
                areas.push({
                    type: "pieces",
                    pieces: pcs as [string, ...string[]],
                    width: 5,
                    label: i18next.t("apgames:validation.subdivision.LABEL_STASH", {playerNum: p}) || "local"
                });
            }
        }

        // Build rep
        const rep: APRenderRep =  {
            renderer: "stacking-3D",
            board: {
                style: "squares",
                width: 6,
                height: 5
            },
            legend: myLegend,
            pieces: pieces as [string[][], ...string[][][]],
            areas,
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place" ) {
                    const [toX, toY] = PylonGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: toY, col: toX}]});
                } else if (move.type === "move") {
                    const [fromX, fromY] = PylonGame.algebraic2coords(move.from);
                    const [toX, toY] = PylonGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                }
            }
            if (rep.annotations.length === 0) {
                delete rep.annotations;
            }
        }

        return rep;
    }

    public status(): string {
        let status = super.status();

        status += "**Scores**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            status += `Player ${n}: ${this.getPlayerScore(n)}\n\n`;
        }

        return status;
    }

    public getPlayerScore(player: number): number {
        let score = 0;
        for (const stack of this.board.values()) {
            if (stack[stack.length - 1][0] === player) {
                score += stack.length;
            }
        }
        return score;
    }

    public getPlayersScores(): IScores[] {
        return [{ name: i18next.t("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)]}];
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        if (r.type === "move") {
            node.push(i18next.t("apresults:MOVE.nowhat", {player, from: r.from, to: r.to}));
            return true;
        }
        else if (r.type === "place") {
            node.push(i18next.t("apresults:PLACE.PYRAMID", {context: r.what, player, where: r.where}));
            return true;
        }
        return false;
    }

    public getStartingPosition(): string {
        const pcs: string[] = [];
        const board = this.stack[0].board;
        const g = new SquareGraph(6, 5);
        for (const row of g.listCells(true) as string[][]) {
            for (const cell of row) {
                if (board.has(cell)) {
                    const pc = board.get(cell)![0];
                    pcs.push(`${pc[0] === 1 ? "A" : "B"}${pc[1]}`);
                }
            }
        }
        return pcs.join(",");
    }

    public clone(): PylonGame {
        return Object.assign(new PylonGame(this.state()), clone(this) as PylonGame);
    }
}
