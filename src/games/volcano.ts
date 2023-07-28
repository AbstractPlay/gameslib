/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { reviver, shuffle, RectGrid, UserFacingError } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

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
export type Colour = "RD"|"BU"|"GN"|"YE"|"VT"|"OG"|"BN"|"PK";
export type CellContents = [Colour, Size];
const allColours: string[] = ["RD", "BU", "GN", "YE", "VT", "OG", "BN", "PK"];

// eslint-disable-next-line @typescript-eslint/no-unsafe-return
const clone = (items: Array<any>): Array<any> => items.map((item: any) => Array.isArray(item) ? clone(item) : item);

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    lastmove?: string;
    board: Array<Array<CellContents[]>>;
    caps: Set<string>;
    captured: [CellContents[], CellContents[]];
};

export interface IVolcanoState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

const hasContiguous = (inlst: string[], width = 5): boolean => {
    for (let i = 0; i < inlst.length; i++) {
        const iN = i - width;
        if ( (iN > 0) && (inlst[iN] === inlst[i]) ) {
            return true;
        }
        const iE = i + 1;
        if ( (iE < inlst.length) && (inlst[iE] === inlst[i]) ) {
            return true;
        }
        const iS = i + width;
        if ( (iS < inlst.length) && (inlst[iS] === inlst[i]) ) {
            return true;
        }
        const iW = i - 1;
        if ( (iW > 0) && (inlst[iW] === inlst[i]) ) {
            return true;
        }
    }
    return false;
}

export class VolcanoGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Volcano",
        uid: "volcano",
        playercounts: [2],
        version: "20211104",
        // i18next.t("apgames:descriptions.volcano")
        description: "apgames:descriptions.volcano",
        urls: ["https://www.looneylabs.com/content/volcano"],
        people: [
            {
                type: "designer",
                name: "Kristin Looney",
                urls: ["http://www.wunderland.com/WTS/Kristin/Kristin.html"]
            }
        ],
        flags: ["shared-pieces", "stacking-expanding", "no-moves", "multistep", "random-start"],
        displays: [{uid: "expanding"}]
    };

    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 5);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 5);
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
        let order: string[] = shuffle([...allColours, ...allColours, ...allColours]) as string[];
        order.push(order[12]);
        order[12] = "-";
        while (hasContiguous(order)) {
            order = shuffle([...allColours, ...allColours, ...allColours]) as string[];
            order.push(order[12]);
            order[12] = "-";
        }
        order.splice(12, 1);
        const board: Array<Array<CellContents[]>> = [];
        for (let row = 0; row < 5; row++) {
            const node: Array<CellContents[]> = [];
            for (let col = 0; col < 5; col++) {
                if ( (row === 2) && (col === 2) ) {
                    node.push([]);
                } else {
                    const colour = order.pop() as Colour;
                    node.push([[colour, 1], [colour, 2], [colour, 3]]);
                }
            }
            board.push(node);
        }
        return board;
    }

    constructor(state?: IVolcanoState | string) {
        super();
        if (state === undefined) {
            this.board = VolcanoGame.newBoard();
            this.caps = new Set();
            for (let row = 0; row < 5; row++) {
                for (let col = 0; col < 5; col++) {
                    const cell = this.board[row][col];
                    if ( (cell !== undefined) && (cell.length > 0) && ( (cell[0][0] === "RD") || (cell[0][0] === "OG") ) ) {
                        this.caps.add(VolcanoGame.coords2algebraic(col, row));
                    }
                }
            }
            const fresh: IMoveState = {
                _version: VolcanoGame.gameinfo.version,
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
                state = JSON.parse(state, reviver) as IVolcanoState;
            }
            if (state.game !== VolcanoGame.gameinfo.uid) {
                throw new Error(`The Volcano engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): VolcanoGame {
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
            let cell: string | undefined;
            if ( (row >= 0) && (col >= 0) ) {
                cell = VolcanoGame.coords2algebraic(col, row);
            } else {
                if (piece === undefined) {
                    throw new Error("Piece is undefined.");
                } else {
                    piece = piece.slice(0, 3);
                }
            }
            const grid = new RectGrid(5, 5);
            const moves = move.split(/\s*[\n,;\/\\]\s*/);
            let lastmove = moves.pop();
            if (lastmove === undefined) {
                lastmove = "";
            } else if (lastmove.includes("-")) {
                moves.push(lastmove);
                lastmove = "";
            }
            // Assume all previous moves are valid
            // Update the caps, ignoring any power plays
            const cloned: VolcanoGame = Object.assign(new VolcanoGame(), deepclone(this) as VolcanoGame);
            for (const m of moves) {
                const [from, to] = m.split("-");
                if (from.length === 2) {
                    cloned.caps.delete(from);
                    cloned.caps.add(to);
                }
            }
            let newmove = "";
            if (lastmove.length === 0) {
                // if a power play
                if (cell === undefined) {
                    newmove = piece!;
                // if regular cap mvmt
                } else {
                    // cell has a cap
                    if (cloned.caps.has(cell)) {
                        newmove = cell;
                    } else {
                        return {move, message: i18next.t("apgames:validation.volcano.MOVES_CAPS_ONLY")} as IClickResult;
                    }
                }
            } else {
                const [from,] = lastmove.split("-");
                if (from === cell) {
                    return {move: moves.join(","), message: ""} as IClickResult;
                } else {
                    // power play
                    if (cell === undefined) {
                        // You can't click on a captured piece as the second half of a move
                        return {move, message: ""} as IClickResult;
                    // regular cell being clicked on
                    } else {
                        if (from.length === 2) {
                            const neighbours = grid.adjacencies(...VolcanoGame.algebraic2coords(from), true).map(pt => VolcanoGame.coords2algebraic(...pt));
                            if ( (neighbours.includes(cell)) && (! cloned.caps.has(cell)) ) {
                                newmove = `${from}-${cell}`;
                            } else {
                                return {move, message: ""} as IClickResult;
                            }
                        } else {
                            newmove = `${from}-${cell}`;
                        }
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
            result.message = i18next.t("apgames:validation.volcano.INITIAL_INSTRUCTIONS");
            return result;
        }

        const cloned: VolcanoGame = Object.assign(new VolcanoGame(), deepclone(this) as VolcanoGame);
        const moves = m.split(/\s*[\n,;\/\\]\s*/);
        const grid = new RectGrid(5, 5);
        let erupted = false;
        let powerplay = false;
        for (const move of moves) {
            const [from, to] = move.split("-");
            if (from !== undefined) {
                // regular cap movement
                if (from.length === 2) {
                    // valid cell
                    try {
                        VolcanoGame.algebraic2coords(from);
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
                // otherwise a power play
                } else {
                    if (powerplay) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.volcano.MOVES_ONE_POWERPLAY");
                        return result;
                    }
                    if (from.length < 3) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.volcano.BAD_FROM", {from: `${from}`});
                        return result;
                    }
                    const colour = (from[0] + from[1]).toUpperCase();
                    const size = parseInt(from[2], 10);
                    const idx = (cloned.captured[cloned.currplayer - 1]).findIndex(p => p[0] === colour && p[1] === size);
                    if (idx < 0) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.volcano.MOVES_NOPIECE", {piece: `${from}`});
                        return result;
                    }
                    powerplay = true;
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
                        [xTo, yTo] = VolcanoGame.algebraic2coords(to);
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
                    // the following only get checked on cap moves, not power plays
                    if (from.length === 2) {
                        const [xFrom, yFrom] = VolcanoGame.algebraic2coords(from);
                        // only one space
                        const neighbours = grid.adjacencies(xFrom, yFrom).map(pt => VolcanoGame.coords2algebraic(...pt));
                        if (! neighbours.includes(to)) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.volcano.MOVES_ONE_SPACE");
                            return result;
                        }
                        // detect eruption
                        const dir = RectGrid.bearing(xFrom, yFrom, xTo, yTo)!;
                        const ray = grid.ray(xTo, yTo, dir);
                        if ( (ray.length > 0) && (! cloned.caps.has(VolcanoGame.coords2algebraic(...ray[0]))) && (cloned.board[yFrom][xFrom].length > 0) ) {
                            erupted = true;
                        }
                    }
                }
            }
            // If we get here, this move is valid, so move the caps (if not a power play) and try the next one
            if (from.length === 2) {
                cloned.caps.delete(from);
                cloned.caps.add(to);
            } else {
                const [x, y] = VolcanoGame.algebraic2coords(to);
                cloned.board[y][x].push([from.slice(0, 2) as Colour, parseInt(from[3], 10) as Size]);
            }
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
     public move(m: string, partial = false): VolcanoGame {
        if ( (this.gameover) && (! partial) ) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const result = this.validateMove(m);
        if (! result.valid) {
            throw new UserFacingError("VALIDATION_GENERAL", result.message)
        }

        const moves = m.split(/\s*[\n,;\/\\]\s*/);
        const grid = new RectGrid(5, 5);
        this.erupted = false;
        let powerPlay = false;
        this.results = [];
        for (const move of moves) {
            const [from, to] = move.split("-");
            const [toX, toY] = VolcanoGame.algebraic2coords(to);
            if ( (from === undefined) || (to === undefined) || (to.length !== 2) || (from.length < 2) || (from.length > 3) ) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
            // This is a regular cap move
            if (from.length === 2) {
                if (this.erupted) {
                    throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
                }
                const [fromX, fromY] = VolcanoGame.algebraic2coords(from);
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
                if ( (ray.length > 0) && (! this.caps.has(VolcanoGame.coords2algebraic(...ray[0]))) && (this.board[fromY][fromX].length > 0) ) {
                    // Eruption triggered
                    for (const r of ray ) {
                        const cell = VolcanoGame.coords2algebraic(...r);
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
            // This is a power play
            } else {
                if (powerPlay) {
                    throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
                }
                const colour = (from[0] + from[1]).toUpperCase();
                const size = parseInt(from[2], 10);
                const idx = (this.captured[this.currplayer - 1]).findIndex(p => p[0] === colour && p[1] === size);
                if (idx < 0) {
                    throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
                }
                this.captured[this.currplayer - 1].splice(idx, 1);
                if (this.caps.has(to)) {
                    throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
                }
                this.board[toY][toX].push([colour as Colour, size as Size]);
                this.results.push({type: "place", what: from, where: to});
                powerPlay = true;
            }
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
        // if (this.lastmove !== move1) {
        if ( (this.lastmove !== undefined) && (this.lastmove.toLowerCase().replace(/\s+/g, "") !== move1.toLowerCase().replace(/\s+/g, "")) ) {
            throw new Error(`To compare moves the current state must be the one after move1 was made ${move1.toLowerCase().replace(/\s+/g, "")} !== ${this.lastmove.toLowerCase().replace(/\s+/g, "")}`);
        }
        if (move1.toLowerCase().replace(/\s+/g, "") === move2.toLowerCase().replace(/\s+/g, "")) {
            return true;
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const cloned: VolcanoGame = Object.assign(new VolcanoGame(), deepclone(this));
        cloned.stack.pop();
        cloned.load(-1);
        cloned.gameover = false;
        cloned.winner = [];
        cloned.move(move2);
        // Compare state
        const board1 = this.board;
        const board2 = cloned.board;
        for (let row = 0; row < 5; row++) {
            for (let col = 0; col < 5; col++) {
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

    protected checkEOG(): VolcanoGame {
        let prevplayer = this.currplayer - 1;
        if (prevplayer < 1) {
            prevplayer = this.numplayers;
        }
        const org = this.organizeCaps(prevplayer as playerid);
        if ( (org.triosMono.length === 3) || (org.triosMono.length + org.triosMixed.length === 5) ) {
            this.gameover = true;
            this.winner = [prevplayer as playerid];
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public organizeCaps(player: playerid = 1): IOrganizedCaps {
        const org: IOrganizedCaps = {
            triosMono: [],
            partialsMono: [],
            triosMixed: [],
            partialsMixed: [],
            miscellaneous: []
        };

        const pile = [...this.captured[player - 1]];
        const stacks: CellContents[][] = [];

        const lgs = pile.filter(x => x[1] === 3);
        const mds = pile.filter(x => x[1] === 2);
        const sms = pile.filter(x => x[1] === 1);
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

        // Validate that all the pieces in the original pile are now found in the stack structure
        const pieces: CellContents[] = stacks.reduce((accumulator, value) => accumulator.concat(value), []);
        if (pieces.length !== this.captured[player - 1].length) {
            throw new Error("Stack lengths don't match.");
        }

        // Categorize each stack
        for (const stack of stacks) {
            if (stack.length === 3) {
                if ((new Set(stack.map(c => c[0]))).size === 1) {
                    org.triosMono.push(stack);
                } else {
                    org.triosMixed.push(stack);
                }
            } else if (stack.length === 2) {
                if ((new Set(stack.map(c => c[0]))).size === 1) {
                    org.partialsMono.push(stack);
                } else {
                    org.partialsMixed.push(stack);
                }
            } else {
                org.miscellaneous.push(...stack);
            }
        }

        return org;
    }

    public state(): IVolcanoState {
        return {
            game: VolcanoGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: VolcanoGame.gameinfo.version,
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
        for (let row = 0; row < 5; row++) {
            const rownode: string[][] = [];
            for (let col = 0; col < 5; col++) {
                let cellnode: string[] = [];
                if (this.board[row][col] !== undefined) {
                    cellnode = [...this.renderPiecesHelper(this.board[row][col], altDisplay)];
                    const cell = VolcanoGame.coords2algebraic(col, row);
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
                }
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

        // Build rep
        const rep: APRenderRep =  {
            renderer: altDisplay === 'expanding' ? "stacking-expanding" : "stacking-3D",
            board: {
                style: "squares",
                width: 5,
                height: 5
            },
            legend: myLegend,
            // @ts-ignore
            pieces
        };

        const areas: any[] = [];

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
                    const [fromX, fromY] = VolcanoGame.algebraic2coords(move.from);
                    const [toX, toY] = VolcanoGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "eject") {
                    const [fromX, fromY] = VolcanoGame.algebraic2coords(move.from);
                    const [toX, toY] = VolcanoGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "eject", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "place") {
                    const [x, y] = VolcanoGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                } else if (move.type === "capture") {
                    const [x, y] = VolcanoGame.algebraic2coords(move.where!);
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
        const cellname = VolcanoGame.coords2algebraic(col, row);
        if (this.caps.has(cellname)) {
            cell.push("XN")
        }
        if (cell !== undefined) {
            areas.push({
                type: "expandedColumn",
                cell: VolcanoGame.coords2algebraic(col, row),
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
            const player = allColours.findIndex(c => c === piece[0]) + 1;
            myLegend[key] = {name,player};
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
        const status = super.status();

        return status;
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
                const moves = state._results.filter(r => r.type === "move" || r.type === "place");
                node.push(i18next.t("apresults:MOVE.multiple", {player: name, moves: moves.map(m => {
                    if (m.type === "move") {
                        return `${m.from}-${m.to}`;
                    } else if (m.type === "place") {
                        return `${m.what!}-${m.where!}`;
                    } else {
                        throw new Error("Should never happen.");
                    }
                }).join(", ")}));
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
        return this.stack[0].board.map(row => row.map(col => col.length > 0 ? col[0][0] : "-").join(",")).join(",");
    }

    public clone(): VolcanoGame {
        return new VolcanoGame(this.serialize());
    }
}
