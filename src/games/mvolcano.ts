/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, shuffle, RectGrid, UserFacingError } from "../common";
import { CartesianProduct } from "js-combinatorics";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const clone = require("rfdc/default");

interface ILooseObj {
    [key: string]: any;
}

interface ILocalStash {
    [k: string]: unknown;
    type: "localStash";
    label: string;
    stash: string[][];
}

interface IOrganizedCaps {
    triosMono: CellContents[][];
    partialsMono: CellContents[][];
    triosMixed: CellContents[][];
    partialsMixed: CellContents[][];
    miscellaneous: CellContents[];
}

export type playerid = 1|2;
export type Size = 1|2|3;
export type Colour = "RD"|"BU"|"GN"|"YE"|"VT"|"OG"|"BN"|"WH";
export type CellContents = [Colour, Size];
const allColours: string[] = ["RD", "BU", "GN", "YE", "VT", "OG", "BN"];

// const clone = (items: any) => items.map((item: any) => Array.isArray(item) ? clone(item) : item);

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    lastmove?: string;
    board: Array<Array<CellContents[]>>;
    caps: Set<string>;
    captured: [CellContents[], CellContents[]];
};

export interface IMvolcanoState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class MvolcanoGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Mega-Volcano",
        uid: "mvolcano",
        playercounts: [2],
        version: "20211107",
        dateAdded: "2023-05-01",
        // i18next.t("apgames:descriptions.mvolcano")
        description: "apgames:descriptions.mvolcano",
        urls: ["http://www.wunderland.com/WTS/Kristin/Games/Volcano.html#MegaVolcano"],
        people: [
            {
                type: "designer",
                name: "Kristin Looney",
                urls: ["http://www.wunderland.com/WTS/Kristin/Kristin.html"]
            }
        ],
        categories: ["goal>score>eog", "mechanic>displace",  "mechanic>move", "mechanic>set", "mechanic>share", "mechanic>stack", "mechanic>random>setup", "board>shape>rect", "board>connect>rect", "components>pyramids"],
        flags: ["shared-pieces", "scores", "stacking-expanding", "no-moves", "multistep", "random-start"],
        displays: [{uid: "expanding"}]
    };

    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 6);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 6);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Array<Array<CellContents[]>>;
    public caps!: Set<string>;
    public erupted = false;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public captured: [CellContents[], CellContents[]] = [[], []];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    public static newBoard(): Array<Array<CellContents[]>> {
        const order: string[] = shuffle([...allColours, ...allColours, ...allColours, ...allColours, ...allColours, "WH"]) as string[];
        const board: Array<Array<CellContents[]>> = [];
        for (let row = 0; row < 6; row++) {
            const node: Array<CellContents[]> = [];
            for (let col = 0; col < 6; col++) {
                const colour = order.pop() as Colour;
                node.push([[colour, 1], [colour, 2], [colour, 3]]);
            }
            board.push(node);
        }
        return board;
    }

    constructor(state?: IMvolcanoState | string) {
        super();
        if (state === undefined) {
            this.board = MvolcanoGame.newBoard();
            this.caps = new Set();
            for (let row = 0; row < 6; row++) {
                for (let col = 0; col < 6; col++) {
                    const cell = this.board[row][col];
                    if ( (cell !== undefined) && (cell.length > 0) && (cell[0][0] === "RD") ) {
                        this.caps.add(MvolcanoGame.coords2algebraic(col, row));
                    }
                }
            }
            const fresh: IMoveState = {
                _version: MvolcanoGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: this.board,
                caps: this.caps,
                captured: [[], []]
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IMvolcanoState;
            }
            if (state.game !== MvolcanoGame.gameinfo.uid) {
                throw new Error(`The Mega-Volcano engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): MvolcanoGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = clone(state.board) as Array<Array<CellContents[]>>;
        this.lastmove = state.lastmove;
        this.captured = clone(state.captured) as [CellContents[], CellContents[]];
        this.caps = new Set(state.caps);
        this.results = [...state._results];
        return this;
    }

    // Because of how many moves are possible and all the rerendering that is happening,
    // be super conservative with error handling. Don't nuke entire move strings if you can help it.
    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = MvolcanoGame.coords2algebraic(col, row);
            const grid = new RectGrid(6, 6);
            const moves = move.split(/\s*[\n,;\/\\]\s*/);
            let lastmove = moves.pop();
            if (lastmove === undefined) {
                lastmove = "";
            } else if (lastmove.includes("-")) {
                moves.push(lastmove);
                lastmove = "";
            }
            // Assume all previous moves are valid
            // Update the caps
            const cloned: MvolcanoGame = Object.assign(new MvolcanoGame(), clone(this) as MvolcanoGame);
            for (const m of moves) {
                const [from, to] = m.split("-");
                cloned.caps.delete(from);
                cloned.caps.add(to);
            }
            let newmove = "";
            if (lastmove.length === 0) {
                // cell has a cap
                if (cloned.caps.has(cell)) {
                    newmove = cell;
                } else {
                    return {move, message: ""} as IClickResult;
                }
            } else {
                const [from,] = lastmove.split("-");
                if (from === cell) {
                    return {move: moves.join(","), message: ""} as IClickResult;
                } else {
                    const neighbours = grid.adjacencies(...MvolcanoGame.algebraic2coords(from), true).map(pt => MvolcanoGame.coords2algebraic(...pt));
                    if ( (neighbours.includes(cell)) && (! cloned.caps.has(cell)) ) {
                        newmove = `${from}-${cell}`;
                    } else {
                        return {move, message: ""} as IClickResult;
                    }
                }
            }
            const result = this.validateMove([...moves, newmove].join(",")) as IClickResult;
            if (! result.valid) {
                result.move = move;
            } else {
                if (newmove.length > 0) {
                    result.move = [...moves, newmove].join(",");
                } else {
                    result.move = moves.join(",");
                }
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
            result.message = i18next.t("apgames:validation.mvolcano.INITIAL_INSTRUCTIONS");
            return result;
        }

        const cloned: MvolcanoGame = Object.assign(new MvolcanoGame(), clone(this) as MvolcanoGame);
        const moves = m.split(/\s*[\n,;\/\\]\s*/);
        const grid = new RectGrid(6, 6);
        let erupted = false;
        for (const move of moves) {
            const [from, to] = move.split("-");
            if (from !== undefined) {
                let xFrom: number; let yFrom: number;
                // valid cell
                try {
                    [xFrom, yFrom] = MvolcanoGame.algebraic2coords(from);
                } catch {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: from});
                    return result;
                }
                // already erupted
                if (erupted) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.volcano.MOVES_AFTER_ERUPTION");
                    return result;
                }
                // moving a cap
                if (! cloned.caps.has(from)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.volcano.MOVES_CAPS_ONLY");
                    return result;
                }
                if (to === undefined) {
                    // valid partial
                    result.valid = true;
                    result.complete = -1;
                    result.message = i18next.t("apgames:validation.volcano.PARTIAL_MOVE");
                    return result;
                } else {
                    // valid cell
                    let xTo: number; let yTo: number;
                    try {
                        [xTo, yTo] = MvolcanoGame.algebraic2coords(to);
                    } catch {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: to});
                        return result;
                    }
                    // no pre-existing cap
                    if (cloned.caps.has(to)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.volcano.MOVES_DOUBLE_CAP");
                        return result;
                    }
                    // only one space
                    const neighbours = grid.adjacencies(xFrom, yFrom).map(pt => MvolcanoGame.coords2algebraic(...pt));
                    if (! neighbours.includes(to)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.volcano.MOVES_ONE_SPACE");
                        return result;
                    }
                    // detect eruption
                    const dir = RectGrid.bearing(xFrom, yFrom, xTo, yTo)!;
                    const ray = grid.ray(xTo, yTo, dir);
                    if ( (ray.length > 0) && (! cloned.caps.has(MvolcanoGame.coords2algebraic(...ray[0]))) && (cloned.board[yFrom][xFrom].length > 0) ) {
                        erupted = true;
                    }
                }
            }
            // If we get here, this move is valid, so move the caps and try the next one
            cloned.caps.delete(from);
            cloned.caps.add(to);
        }
        // If we get here, all the moves are valid
        if (erupted) {
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        } else {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.volcano.PARTIAL_ERUPTION");
            return result;
        }
    }

    // Giving up on move generation for now. It simply takes too long, even after
    // eliminating obvious circularity.

    /**
     * The `partial` flag leaves the object in an invalid state. It should only be used on a disposable object,
     * or you should call `load()` before finalizing the move.
     *
     * @param m The move string itself
     * @param partial A signal that you're just exploring the move; don't do end-of-move processing
     * @returns [VolcanoGame]
     */
    public move(m: string, {partial = false, trusted = false} = {}): MvolcanoGame {
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
        }

        const moves = m.split(/\s*[\n,;\/\\]\s*/);
        const grid = new RectGrid(6, 6);
        this.erupted = false;
        this.results = [];
        for (const move of moves) {
            if ( (partial) && (! move.includes("-")) ) { continue; }
            const [from, to] = move.split("-");
            const [toX, toY] = MvolcanoGame.algebraic2coords(to);
            if ( (from === undefined) || (to === undefined) || (to.length !== 2) || (from.length !== 2) ) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
            if (this.erupted) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
            const [fromX, fromY] = MvolcanoGame.algebraic2coords(from);
            if (! this.caps.has(from)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
            if (this.caps.has(to)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
            if ( (Math.abs(fromX - toX) > 1) || (Math.abs(fromY - toY) > 1) ) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
            this.results.push({type: "move", from, to});
            // detect eruption
            const dir = RectGrid.bearing(fromX, fromY, toX, toY);
            if (dir === undefined) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
            const ray = grid.ray(toX, toY, dir);
            if ( (ray.length > 0) && (! this.caps.has(MvolcanoGame.coords2algebraic(...ray[0]))) && (this.board[fromY][fromX].length > 0) ) {
                // Eruption triggered
                for (const r of ray ) {
                    const cell = MvolcanoGame.coords2algebraic(...r);
                    if (this.caps.has(cell)) {
                        break;
                    }
                    const piece = this.board[fromY][fromX].pop();
                    if (piece === undefined) {
                        break;
                    }
                    // check for capture
                    const boardTo = this.board[r[1]][r[0]];
                    this.results.push({type: "eject", from, to: cell, what: piece.join("")});
                    // captured
                    if ( (boardTo.length > 0) && (boardTo[boardTo.length - 1][1] === piece[1]) ) {
                        this.captured[this.currplayer - 1].push(piece);
                        this.results.push({type: "capture", what: piece.join(""), where: cell});
                    // otherwise just move the piece
                    } else {
                        boardTo.push(piece);
                    }
                }
                this.erupted = true;
            }
            this.caps.delete(from);
            this.caps.add(to);
        }

        if (partial) {
            return this;
        }

        if (! this.erupted) {
            throw new UserFacingError("MOVES_MUST_ERUPT", i18next.t("apgames:validation.volcano.MOVES_MUST_ERUPT"));
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

    public sameMove(move1: string, move2: string): boolean {
        if (this.lastmove !== move1) {
            throw new Error(`To compare moves the current state must be the one after move1 was made ${move1} !== ${this.lastmove}`);
        }
        if (move1.toLowerCase().replace(/\s+/g, "") === move2.toLowerCase().replace(/\s+/g, "")) {
            return true;
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const cloned: MvolcanoGame = Object.assign(new MvolcanoGame(), clone(this));
        cloned.stack.pop();
        cloned.load(-1);
        cloned.gameover = false;
        cloned.winner = [];
        cloned.move(move2);
        // Compare state
        const board1 = this.board;
        const board2 = cloned.board;
        for (let row = 0; row < 6; row++) {
            for (let col = 0; col < 6; col++) {
                if (board1[row][col].length !== board2[row][col].length) {
                    return false;
                }
                for (let i = 0; i < board1[row][col].length; i++) {
                    if (board1[row][col][i][0] !== board2[row][col][i][0] || board1[row][col][i][1] !== board2[row][col][i][1]) {
                        return false;
                    }
                }
            }
        }
        const caps1 = this.caps;
        const caps2 = cloned.caps;
        if (caps1.size !== caps2.size) {
            return false;
        }
        for (const c of caps1) {
            if (!caps2.has(c)) {
                return false;
            }
        }
        const captured1 = this.captured;
        const captured2 = cloned.captured;
        for (let i = 0; i < 2; i++) {
            if (captured1[i].length !== captured2[i].length) {
                return false;
            }
            const cap1 = [...captured1[i]].sort();
            const cap2 = [...captured2[i]].sort();
            for (let j = 0; j < cap1.length; j++) {
                if (cap1[j][0] !== cap2[j][0] || cap1[j][1] !== cap2[j][1]) {
                    return false;
                }
            }
        }
        return true;
    }

    protected checkEOG(): MvolcanoGame {
        let prevplayer = this.currplayer - 1;
        if (prevplayer < 1) {
            prevplayer = this.numplayers;
        }
        const pile = this.captured[prevplayer - 1];
        // Check for all white pieces
        const whites = pile.filter(p => p[0] === "WH");
        if (whites.length === 3) {
            this.gameover = true;
            this.winner = [prevplayer as playerid];
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        } else {
            const coloursCapped = new Set<Colour>(pile.map(p => p[0]));
            coloursCapped.delete("WH");
            if (coloursCapped.size === 7) {
                this.gameover = true;
                this.results.push({type: "eog"});
                const score1 = this.getPlayerScore(1);
                const score2 = this.getPlayerScore(2);
                if ( (score1 === undefined) || (score2 === undefined) ) {
                    throw new Error("Scores could not be determined after the game ended.");
                }
                if (score1 > score2) {
                    this.winner = [1];
                } else if (score1 < score2) {
                    this.winner = [2];
                } else {
                    this.winner = [1, 2];
                }
                this.results.push({type: "winners", players: [...this.winner]});
            }
        }
        return this;
    }

    public getPlayerScore(indata: number | IOrganizedCaps): number {
        let org: IOrganizedCaps;
        if (typeof indata === "number") {
            org = this.organizeCaps(indata as playerid);
        } else {
            org = indata;
        }
        let score = 0;
        score += 7 * org.triosMono.length;
        score += 5 * org.triosMixed.length;
        for (const stack of org.partialsMono) {
            score += stack.length;
        }
        for (const stack of org.partialsMixed) {
            score += stack.length;
        }
        score += org.miscellaneous.length;
        return score;
    }

    public organizeCaps(indata: playerid | CellContents[] = 1): IOrganizedCaps {
        let pile: CellContents[];
        if (Array.isArray(indata)) {
            pile = [...indata];
        } else {
            pile = [...(this.captured[indata - 1])];
        }

        let org: IOrganizedCaps = {
            triosMono: [],
            partialsMono: [],
            triosMixed: [],
            partialsMixed: [],
            miscellaneous: []
        };
        const stacks: CellContents[][] = [];

        const whites = pile.filter(x => x[0] === "WH");
        const lgs = pile.filter(x => x[1] === 3 && x[0] !== "WH");
        const mds = pile.filter(x => x[1] === 2 && x[0] !== "WH");
        const sms = pile.filter(x => x[1] === 1 && x[0] !== "WH");
        // Put each large in a stack and then look for a matching medium and small
        // This will find all monochrome trios
        while (lgs.length > 0) {
            const stack: CellContents[] = [];
            const next = lgs.pop();
            stack.push(next!);
            const mdIdx = mds.findIndex(x => x[0] === next![0]);
            if (mdIdx >= 0) {
                stack.push(mds[mdIdx]);
                mds.splice(mdIdx, 1);
                const smIdx = sms.findIndex(x => x[0] === next![0]);
                if (smIdx >= 0) {
                    stack.push(sms[smIdx]);
                    sms.splice(smIdx, 1);
                }
            }
            stacks.push(stack);
        }
        // Look at each stack that has only a large and find any leftover mediums and stack them
        for (const stack of stacks) {
            if (stack.length === 1) {
                const mdIdx = mds.findIndex(x => x[1] === 2);
                if (mdIdx >= 0) {
                    stack.push(mds[mdIdx]);
                    mds.splice(mdIdx, 1);
                }
            }
        }
        // Look at each stack that has a large and a medium and add any loose smalls
        for (const stack of stacks) {
            if (stack.length === 2) {
                const smIdx = sms.findIndex(x => x[1] === 1);
                if (smIdx >= 0) {
                    stack.push(sms[smIdx]);
                    sms.splice(smIdx, 1);
                }
            }
        }
        // All remaning mediums now form the basis of their own stack and see if there is a matching small
        while (mds.length > 0) {
            const stack: CellContents[] = [];
            const next = mds.pop();
            stack.push(next!);
            const smIdx = sms.findIndex(x => x[0] === next![0]);
            if (smIdx >= 0) {
                stack.push(sms[smIdx]);
                sms.splice(smIdx, 1);
            }
            stacks.push(stack);
        }
        // Find stacks with just a medium and put any loose smalls on top of them
        for (const stack of stacks) {
            if ( (stack.length === 1) && (stack[0][1] === 2) ) {
                const smIdx = sms.findIndex(x => x[1] === 1);
                if (smIdx >= 0) {
                    stack.push(sms[smIdx]);
                    sms.splice(smIdx, 1);
                }
            }
        }
        // Now all you should have are loose smalls, add those
        stacks.push(...sms.map(x => [x]));

        // And add any whites to this as well
        stacks.push(...whites.map(x => [x]));

        // // Validate that all the pieces in the original pile are now found in the stack structure
        // const pieces: CellContents[] = stacks.reduce((accumulator, value) => accumulator.concat(value), []);
        // if (pieces.length !== pile.length) {
        //     throw new Error("Stack lengths don't match. This should never happen.");
        // }

        // Categorize each stack
        for (const stack of stacks) {
            if (stack.length === 3) {
                if ((new Set(stack.map(c => c[0]))).size === 1) {
                    org.triosMono.push(clone(stack) as CellContents[]);
                } else {
                    org.triosMixed.push(clone(stack) as CellContents[]);
                }
            } else if (stack.length === 2) {
                if ((new Set(stack.map(c => c[0]))).size === 1) {
                    org.partialsMono.push(clone(stack) as CellContents[]);
                } else {
                    org.partialsMixed.push(clone(stack) as CellContents[]);
                }
            } else {
                org.miscellaneous.push(...clone(stack) as CellContents[]);
            }
        }

        if (whites.length > 0) {
            let highestScore = this.getPlayerScore(org);
            const colourSet: string[][] = [];
            // eslint-disable-next-line @typescript-eslint/prefer-for-of
            for (let i = 0; i < whites.length; i++) {
                colourSet.push([...allColours]);
            }
            const replacements = [...new CartesianProduct(...colourSet)];
            const sizes = whites.map(w => w[1]);
            for (const r of replacements) {
                const newpieces: CellContents[] = [];
                for (let i = 0; i < r.length; i++) {
                    newpieces.push([r[i] as Colour, sizes[i]])
                }
                const newpile = [...pile.filter(p => p[0] !== "WH"), ...newpieces];
                const neworg = this.organizeCaps(newpile);
                const newscore = this.getPlayerScore(neworg);
                if (newscore > highestScore) {
                    // Find the replacement pieces and make them white again
                    for (const newpiece of newpieces) {
                        let found = false;
                        for (const key of ["triosMono", "triosMixed", "partialsMono", "partialsMixed"] as const) {
                            for (const stack of neworg[key]) {
                                const i = stack.findIndex(p => p[0] === newpiece[0] && p[1] === newpiece[1]);
                                if (i >= 0) {
                                    found = true;
                                    stack[i][0] = "WH";
                                    break;
                                }
                            }
                            if (found) {
                                break;
                            }
                        }
                        // If still not found, check the miscellaneous key
                        if (! found) {
                            const i = neworg.miscellaneous.findIndex(p => p[0] === newpiece[0] && p[1] === newpiece[1]);
                            if (i >= 0) {
                                found = true;
                                neworg.miscellaneous[i][0] = "WH";
                            }
                        }
                        // At this point, something has gone horribly wrong
                        if (! found) {
                            throw new Error("Could not find the replacement piece.");
                        }
                    }

                    org = clone(neworg) as IOrganizedCaps;
                    highestScore = newscore;
                }
            }
        }

        return org;
    }

    public state(): IMvolcanoState {
        return {
            game: MvolcanoGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: MvolcanoGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: clone(this.board) as Array<Array<CellContents[]>>,
            caps: new Set(this.caps),
            captured: clone(this.captured) as [CellContents[], CellContents[]]
        };
    }

    private renderStashHelper(s: CellContents[], altDisplay: string | undefined): string[] {
        if (altDisplay !== 'expanding') {
            const ret: string[] = [];
            for (let i = 0; i < s.length; i++) {
                for (let j = i; j < s[s.length - i - 1][1] - i - 1; j++)
                    ret.push("-");
                ret.push(s[s.length - i - 1].join(""));
            }
            return ret;
        } else {
            return s.map((t) => t.join("") + "c");
        }
    }

    private renderPiecesHelper(s: CellContents[], altDisplay: string | undefined): string[] {
        if (altDisplay !== 'expanding') {
            const ret: string[] = [];
            for (let i = 0; i < s.length; i++) {
                for (let j = 0; j < s[i][1] - i - 1; j++)
                    ret.push("-");
                ret.push(s[i].join(""));
            }
            return ret;
        } else {
            return s.map((t) => t.join(""));
        }
    }

    public render(opts?: { altDisplay: string | undefined} ): APRenderRep {
        let altDisplay: string|undefined;
        if (opts !== undefined) {
            altDisplay = opts.altDisplay;
        }
        // Build piece object
        const pieces: string[][][] = [];
        for (let row = 0; row < 6; row++) {
            const rownode: string[][] = [];
            for (let col = 0; col < 6; col++) {
                let cellnode: string[] = [];
                if (this.board[row][col] !== undefined) {
                    cellnode = [...this.renderPiecesHelper(this.board[row][col], altDisplay)];
                    const cell = MvolcanoGame.coords2algebraic(col, row);
                    if (this.caps.has(cell)) {
                        cellnode.push("X");
                    }
                }
                rownode.push(cellnode);
            }
            pieces.push(rownode);
        }

        // build legend based on number of players
        const myLegend: ILooseObj = altDisplay === 'expanding' ?
            {
                "X": {
                    "name": "pyramid-up-small",
                    "colour": "#000"
                },
                "XN": {
                    "name": "pyramid-flat-small",
                    "colour": "#000"
                },
            }
            :
            {
                "X": {
                    "name": "pyramid-up-small-3D",
                    "colour": "#000"
                }
            };

        const opacity = 0.75;
        for (let n = 0; n < allColours.length; n++) {
            myLegend[allColours[n] + "1"] = {
                name: altDisplay === 'expanding' ? "pyramid-up-small-upscaled" : "pyramid-up-small-3D",
                player: n+1,
                opacity
            };
            myLegend[allColours[n] + "2"] = {
                name: altDisplay === 'expanding' ? "pyramid-up-medium-upscaled" : "pyramid-up-medium-3D",
                player: n+1,
                opacity
            };
            myLegend[allColours[n] + "3"] = {
                name: altDisplay === 'expanding' ? "pyramid-up-large-upscaled" : "pyramid-up-large-3D",
                player: n+1,
                opacity
            };
            if (altDisplay === 'expanding') {
                myLegend[allColours[n] + "1N"] = {
                    name: "pyramid-flat-small",
                    player: n+1
                };
                myLegend[allColours[n] + "2N"] = {
                    name: "pyramid-flat-medium",
                    player: n+1
                };
                myLegend[allColours[n] + "3N"] = {
                    name: "pyramid-flat-large",
                    player: n+1
                };
                myLegend[allColours[n] + "1c"] = {
                    name: "pyramid-flattened-small",
                    player: n+1
                };
                myLegend[allColours[n] + "2c"] = {
                    name: "pyramid-flattened-medium",
                    player: n+1
                };
                myLegend[allColours[n] + "3c"] = {
                    name: "pyramid-flattened-large",
                    player: n+1
                };
            }
        }
        // Now add the white pieces
        myLegend.WH1 = {
            name: altDisplay === 'expanding' ? "pyramid-up-small-upscaled" : "pyramid-up-small-3D",
            colour: "#fff",
            opacity
        };
        myLegend.WH2 = {
            name: altDisplay === 'expanding' ? "pyramid-up-medium-upscaled" : "pyramid-up-medium-3D",
            colour: "#fff",
            opacity
        };
        myLegend.WH3 = {
            name: altDisplay === 'expanding' ? "pyramid-up-large-upscaled" : "pyramid-up-large-3D",
            colour: "#fff",
            opacity
        };
        if (altDisplay === 'expanding') {
            myLegend.WH1N = {
                name: "pyramid-flat-small",
                colour: "#fff"
            };
            myLegend.WH2N = {
                name: "pyramid-flat-medium",
                colour: "#fff"
            };
            myLegend.WH3N = {
                name: "pyramid-flat-large",
                colour: "#fff"
            };
            myLegend.WH1c = {
                name: "pyramid-flattened-small",
                colour: "#fff"
            };
            myLegend.WH2c = {
                name: "pyramid-flattened-medium",
                colour: "#fff"
            };
            myLegend.WH3c = {
                name: "pyramid-flattened-large",
                colour: "#fff"
            };
        }

        // Build rep
        const rep: APRenderRep =  {
            renderer: altDisplay === 'expanding' ? "stacking-expanding" : "stacking-3D",
            board: {
                style: "squares",
                width: 6,
                height: 6
            },
            legend: myLegend,
            // @ts-ignore
            pieces
        };

        const areas = [];

        // Add captured stashes
        for (let player = 0; player < 2; player++) {
            if (this.captured[player].length > 0) {
                const node: ILocalStash = {
                    type: "localStash",
                    label: `Player ${player + 1}: Captured Pieces`,
                    stash: []
                };
                const org = this.organizeCaps((player + 1) as playerid);
                node.stash.push(...org.triosMono.map((s) => this.renderStashHelper(s, altDisplay)));
                node.stash.push(...org.triosMixed.map((s) => this.renderStashHelper(s, altDisplay)));
                node.stash.push(...org.partialsMono.map((s) => this.renderStashHelper(s, altDisplay)));
                node.stash.push(...org.partialsMixed.map((s) => this.renderStashHelper(s, altDisplay)));
                node.stash.push(...org.miscellaneous.map((s) => this.renderStashHelper([s], altDisplay)));
                areas.push(node);
            }
        }
        if (areas.length > 0) {
            // @ts-ignore
            rep.areas = areas;
        }

        // Add annotations
        // if (this.stack[this.stack.length - 1]._results.length > 0) {
        if (this.results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            // for (const move of this.stack[this.stack.length - 1]._results) {
            for (const move of this.results) {
                if (move.type === "move") {
                    const [fromX, fromY] = MvolcanoGame.algebraic2coords(move.from);
                    const [toX, toY] = MvolcanoGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "eject") {
                    const [fromX, fromY] = MvolcanoGame.algebraic2coords(move.from);
                    const [toX, toY] = MvolcanoGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "eject", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "capture") {
                    const [x, y] = MvolcanoGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                }
            }
        }

        return rep;
    }

    public renderColumn(col: number, row: number): APRenderRep {
        const areas = [];
        const pieces = this.board[row][col];
        const cell: string[] = pieces.map(c => `${c.join("")}N`);
        const cellname = MvolcanoGame.coords2algebraic(col, row);
        if (this.caps.has(cellname)) {
            cell.push("XN")
        }
        if (cell !== undefined) {
            areas.push({
                type: "expandedColumn",
                cell: MvolcanoGame.coords2algebraic(col, row),
                stack: cell
            });
        }

        const myLegend: ILooseObj = {
            "XN": {
                "name": "pyramid-flat-small",
                "colour": "#000"
            },
        };
        const seen: Set<string> = new Set();
        for(const piece of pieces) {
            const key = piece.join("") + "N";
            if (seen.has(key)) { continue; }
            seen.add(key);
            let name: string;
            if (piece[1] === 1) {
                name = "pyramid-flat-small";
            } else if (piece[1] === 2) {
                name = "pyramid-flat-medium";
            } else {
                name = "pyramid-flat-large";
            }
            if (piece[0] !== ("WH" as Colour)) {
                const player = allColours.findIndex(c => c === piece[0]) + 1;
                myLegend[key] = {name, player};
            } else {
                myLegend[key] = {name, colour: "#fff"};
            }
        }

        // Build rep
        const rep: APRenderRep =  {
            renderer: "stacking-expanding",
            board: null,
            legend: myLegend,
            pieces: null,
            // @ts-ignore
            areas
        };

        return rep;
    }

    public status(): string {
        let status = super.status();

        status += "**Scores**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const score = this.getPlayerScore(n);
            status += `Player ${n}: ${score}\n\n`;
        }

        return status;
    }

    public getPlayersScores(): IScores[] {
        return [{ name: i18next.t("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] }]
    }

    protected getMoveList(): any[] {
        return this.getMovesAndResults(["move", "eog", "winners"]);
    }

    public chatLog(players: string[]): string[][] {
        // move, eject, capture, eog, resign, winners
        const result: string[][] = [];
        for (const state of this.stack) {
            if ( (state._results !== undefined) && (state._results.length > 0) ) {
                const node: string[] = [(state._timestamp && new Date(state._timestamp).toISOString()) || "unknown"];
                let otherPlayer = state.currplayer + 1;
                if (otherPlayer > this.numplayers) {
                    otherPlayer = 1;
                }
                let name = `Player ${otherPlayer}`;
                if (otherPlayer <= players.length) {
                    name = players[otherPlayer - 1];
                }
                const moves = state._results.filter(r => r.type === "move");
                // @ts-ignore
                node.push(i18next.t("apresults:MOVE.multiple", {player: name, moves: moves.map(m => `${m.from as string}-${m.to as string}`).join(", ")}));
                const eruptions = state._results.filter(r => r.type === "eject");
                // @ts-ignore
                node.push(i18next.t("apresults:ERUPTIONS", {eruptions: eruptions.map(m => m.what as string).join(", ")}));
                const captures = state._results.filter(r => r.type === "capture");
                if (captures.length > 0) {
                    // @ts-ignore
                    node.push(i18next.t("apresults:CAPTURE.noperson.multiple", {capped: captures.map(m => m.what as string).join(", ")}));
                }
                for (const r of state._results) {
                    switch (r.type) {
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
                            if (r.players.length === 0)
                                node.push(i18next.t("apresults:WINNERSNONE"));
                            else
                                node.push(i18next.t("apresults:WINNERS", {count: r.players.length, winners: names.join(", ")}));

                            break;
                    }
                }
                result.push(node);
            }
        }
        return result;
    }

    public getStartingPosition(): string {
        return this.stack[0].board.map(row => row.map(col => col[0][0])).flat().join(",");
    }

    public clone(): MvolcanoGame {
        return new MvolcanoGame(this.serialize());
    }
}
