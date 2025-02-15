import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IStatus, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { deg2dir, dir2deg, Direction, normDeg, oppositeDirections, RectGrid, replacer, reviver, rotateFacing, shuffle, smallestDegreeDiff, UserFacingError } from "../common";
import i18next from "i18next";
import { PacruGraph } from "./pacru/graph";
import { Glyph } from "@abstractplay/renderer/build";
// eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-var-requires
const Buffer = require('buffer/').Buffer  // note: the trailing slash is important!
import pako, { Data } from "pako";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-var-requires
const deepclone = require("rfdc/default");

export type playerid = 1|2|3|4;
export type Chevron = {
    owner: playerid;
    facing: Direction;
};
export type CellContents = {
    tile?: playerid;
    chevron?: Chevron;
};

// meetings are not detected here for reasons
export type SideEffect = "blChange"|"blTransform"|"connChange";

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    lastmove?: string;
};

export interface IPacruState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

const start2p: [string, CellContents][] = [
    ["a3", {chevron: {owner: 1, facing: "E"}}],
    ["e1", {chevron: {owner: 1, facing: "N"}}],
    ["i3", {chevron: {owner: 1, facing: "W"}}],
    ["i9", {chevron: {owner: 1, facing: "SW"}}],
    ["a7", {chevron: {owner: 2, facing: "E"}}],
    ["e9", {chevron: {owner: 2, facing: "S"}}],
    ["i7", {chevron: {owner: 2, facing: "W"}}],
    ["a1", {chevron: {owner: 2, facing: "NE"}}],
];
const start3p: [string, CellContents][] = [
    ["c9", {chevron: {owner: 2, facing: "S"}}],
    ["e9", {chevron: {owner: 3, facing: "S"}}],
    ["g9", {chevron: {owner: 1, facing: "S"}}],
    ["a7", {chevron: {owner: 3, facing: "E"}}],
    ["i7", {chevron: {owner: 3, facing: "W"}}],
    ["a5", {chevron: {owner: 2, facing: "E"}}],
    ["i5", {chevron: {owner: 1, facing: "W"}}],
    ["c1", {chevron: {owner: 2, facing: "N"}}],
    ["g1", {chevron: {owner: 1, facing: "N"}}],
];
const start4p: [string, CellContents][] = [
    ["c9", {chevron: {owner: 2, facing: "S"}}],
    ["e9", {chevron: {owner: 3, facing: "S"}}],
    ["g9", {chevron: {owner: 1, facing: "S"}}],
    ["a7", {chevron: {owner: 3, facing: "E"}}],
    ["i7", {chevron: {owner: 3, facing: "W"}}],
    ["a5", {chevron: {owner: 2, facing: "E"}}],
    ["i5", {chevron: {owner: 1, facing: "W"}}],
    ["a3", {chevron: {owner: 4, facing: "E"}}],
    ["i3", {chevron: {owner: 4, facing: "W"}}],
    ["c1", {chevron: {owner: 2, facing: "N"}}],
    ["e1", {chevron: {owner: 4, facing: "N"}}],
    ["g1", {chevron: {owner: 1, facing: "N"}}],
];

export class PacruGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Pacru",
        uid: "pacru",
        playercounts: [2,3,4],
        version: "20250205",
        dateAdded: "2023-06-18",
        // i18next.t("apgames:descriptions.pacru")
        description: "apgames:descriptions.pacru",
        // i18next.t("apgames:notes.pacru")
        notes: "apgames:notes.pacru",
        urls: ["https://boardgamegeek.com/boardgame/6803/pacru"],
        people: [
            {
                type: "designer",
                name: "Mike Wellman",
                urls: ["http://www.pacru.com/"],
            },
        ],
        categories: ["goal>area", "mechanic>place", "mechanic>move", "mechanic>convert", "mechanic>capture", "board>shape>rect", "board>connect>rect", "components>special"],
        flags: ["experimental", "no-moves", "custom-randomization", "scores"]
    };

    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 9);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 9);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, CellContents>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private highlights: string[] = [];
    private buffers: Direction[] = [];

    constructor(state: IPacruState | string | number, variants?: string[]) {
        super();
        if (typeof state === "number") {
            this.numplayers = state;
            if (variants !== undefined) {
                this.variants = [...variants];
            }
            const board = new Map<string, CellContents>(
                this.numplayers === 2 ? start2p :
                this.numplayers === 3 ? start3p :
                start4p
            );
            const fresh: IMoveState = {
                _version: PacruGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                // is the state a raw JSON obj
                if (state.startsWith("{")) {
                    state = JSON.parse(state, reviver) as IPacruState;
                }
                // or is it a b64 encoded gzip
                else {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
                    const decoded = Buffer.from(state, "base64") as Data;
                    const decompressed = pako.ungzip(decoded, {to: "string"});
                    state = JSON.parse(decompressed, reviver) as IPacruState;
                }
            }
            if (state.game !== PacruGame.gameinfo.uid) {
                throw new Error(`The Pacru engine cannot process a game of '${state.game}'.`);
            }
            this.numplayers = state.numplayers;
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public serialize(opts?: {strip?: boolean, player?: number}): string {
        const json = JSON.stringify(this.state(), replacer);
        const compressed = pako.gzip(json);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        return Buffer.from(compressed).toString("base64") as string;
    }

    public load(idx = -1): PacruGame {
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
        this.results = [...state._results];
        return this;
    }

    // public moves(): string[] {
    //     if (this.gameover) { return []; }
    //     return ["a","b","c","d"];
    // }

    // The randomizer never reorients and always chooses the connection change option
    public randomMove(): string {
        // there will always be a move if it's this player's turn
        const moves = shuffle(this.baseMoves()) as string[];
        const baseMove = moves[0];
        const {from, to} = this.parseMove(baseMove);
        const effects = this.getSideEffects(from!, to!, baseMove.includes("x"));
        const g = new PacruGraph();
        const ctr = g.cell2ctr(to!);
        const blCells = g.ctr2cells(ctr);
        const cells: string[] = [];
        if (effects.has("connChange")) {
            cells.push("*");
        } else if (effects.has("blTransform")) {
            const poss: string[] = [];
            for (const cell of blCells) {
                // ignore to
                if (cell === to) { continue; }
                const contents = this.board.get(cell)!;
                if (contents.tile !== this.currplayer) {
                    poss.push(cell);
                }
            }
            cells.push((shuffle(poss) as string[])[0]);
        } else if (effects.has("blChange")) {
            const poss: string[] = [];
            for (const cell of blCells) {
                // ignore to
                if (cell === to) { continue; }
                if (!this.board.has(cell)) {
                    poss.push(cell);
                }
            }
            cells.push((shuffle(poss) as string[])[0]);
        }
        // now execute and look for meetings
        const interim = baseMove + (cells.length > 0 ? `(${cells.join(",")})` : "");
        const cloned = this.clone();
        cloned.executeMove(interim);
        if (cloned.isMeeting(to!)) {
            const poss: string[] = [];
            for (const cell of g.graph.nodes()) {
                const contents = cloned.board.get(cell);
                if (contents === undefined || (contents.tile !== this.currplayer && contents.chevron === undefined)) {
                    poss.push(cell);
                }
            }
            cells.push((shuffle(poss) as string[])[0]);
        }
        return baseMove + (cells.length > 0 ? `(${cells.join(",")})` : "");
    }

    // This function only determines which chevrons can move where.
    // Special effect handling is done elsewhere.
    public baseMoves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];
        const enemy2attackers = new Map<string, string[]>();
        const g = new PacruGraph();

        const mine = [...this.board.entries()].filter(([,{chevron}]) => chevron !== undefined && chevron.owner === player);
        // basic moves first
        for (const [cell, {tile, chevron}] of mine) {
            const pom = this.calcMvPower(cell);
            for (const dir of g.facing2dirs(chevron!.facing)) {
                const ray = g.ray(cell, dir).slice(0, pom);
                let blocked = false; // whether we've encountered another chevron in this direction
                for (const next of ray) {
                    const contents = this.board.get(next);
                    // once blocked is true, only connection jumps should be considered
                    if (blocked) {
                        if (tile === player && contents !== undefined && contents.tile === player && contents.chevron === undefined) {
                            moves.push(`${cell}-${next}`);
                        }
                    }
                    // otherwise
                    else {
                        // if there's a chevron
                        if (contents !== undefined && contents.chevron !== undefined) {
                            // no matter what, mark blocked
                            blocked = true;
                            // if it's an enemy, add it to the attacked list
                            if (contents.chevron.owner !== player) {
                                if (enemy2attackers.has(next)) {
                                    const curr = enemy2attackers.get(next)!;
                                    enemy2attackers.set(next, [...curr, cell]);
                                } else {
                                    enemy2attackers.set(next, [cell]);
                                }
                            }
                        }
                        // otherwise, move if possible
                        else if ((contents === undefined || contents.tile === undefined || contents.tile === player)) {
                            moves.push(`${cell}-${next}`);
                        }
                    }
                }
            }
        }

        // now pincers
        // console.log(JSON.stringify(enemy2attackers, replacer));
        const pincers = [...enemy2attackers.entries()].filter(([,atkrs]) => atkrs.length >= 2);
        for (const [atkd, atkrs] of pincers) {
            for (const atkr of atkrs) {
                moves.push(`${atkr}x${atkd}`);
            }
        }

        return moves;
    }

    public calcMvPower(cell: string): number {
        const contents = this.board.get(cell);
        if (contents === undefined || contents.chevron === undefined) {
            throw new Error(`No chevron at ${cell}`);
        }
        const player = contents.chevron.owner;
        const g = new PacruGraph();
        const ctr = g.cell2ctr(cell);
        let power = 0;
        for (const node of g.ctr2cells(ctr)) {
            const cont = this.board.get(node);
            if (cont !== undefined) {
                if (cont.tile === player) {
                    power++;
                }
            }
        }
        return Math.max(power, 1);
    }

    // Meetings are problematic because they can be created after a pincer
    // and invalidated after claiming cells after a bl or connection change.
    // See `isMeeting` function.
    public getSideEffects(from: string, to: string, isCapture = false): Set<SideEffect> {
        const g = new PacruGraph();
        const set = new Set<SideEffect>();
        const fContents = this.board.get(from);
        if (fContents === undefined || fContents.chevron === undefined) {
            throw new Error(`No chevron at ${from}`);
        }
        const player = fContents.chevron.owner;
        const tContents = this.board.get(to);
        const [fx, fy] = g.algebraic2coords(from);
        const [tx, ty] = g.algebraic2coords(to);

        // did we change borderlands
        const fCtr = g.cell2ctr(from);
        const tCtr = g.cell2ctr(to);
        if (fCtr !== tCtr) {
            const neutrals: string[] = [];
            const opposing: string[] = [];
            for (const cell of (g.ctr2cells(tCtr))) {
                // if this is a capture, then `to` is neither neutral nor opposing
                if (isCapture && cell === to) { continue; }
                const contents = this.board.get(cell);
                if (contents === undefined || contents.tile === undefined) {
                    // might still be occupied
                    neutrals.push(cell);
                } else if (contents.tile !== player) {
                    opposing.push(cell);
                }
            }
            // if neutrals are avaialable, then blChange is the only option
            if (neutrals.length > 0) {
                // but only return the effect if at least one is unoccupied
                // (remember that you can place a tile into the cell you just moved into)
                for (const n of neutrals) {
                    const cont = this.board.get(n);
                    if (n === to || cont === undefined || cont.chevron === undefined) {
                        set.add("blChange");
                        break;
                    }
                }
            } else if (opposing.length > 0) {
                // same here, only return effect if at least one is unoccupied
                for (const n of opposing) {
                    // ignore to
                    if (n === to) { continue; }
                    const cont = this.board.get(n);
                    if (cont === undefined || cont.chevron === undefined) {
                        set.add("blTransform");
                        break;
                    }
                }
            }
        }

        // are we connecting
        if (fContents.tile === player && tContents !== undefined && tContents.tile === player) {
            // only applies if no intervening chevrons
            const between = RectGrid.between(fx, fy, tx, ty).map(c => g.coords2algebraic(...c));
            let blocked = false;
            for (const cell of between) {
                const contents = this.board.get(cell);
                if (contents !== undefined && contents.chevron !== undefined) {
                    blocked = true;
                    break;
                }
            }
            // don't bother signalling connection changes unless there's at least one cell in between
            if (!blocked && between.length > 0) {
                set.add("connChange");
            }
        }

        return set;
    }

    // Meetings are problematic because they can be created after a pincer
    // and invalidated after claiming cells after a bl or connection change.
    // This should only called on cloned objects after all other side effects have been resolved.
    public isMeeting(to: string): boolean {
        const tContents = this.board.get(to);
        if (tContents === undefined || tContents.chevron === undefined) {
            throw new Error(`There is no chevron or tile at ${to}.`);
        }
        // if there's no tile at `to`, then no meeting is possible
        if (tContents.tile === undefined) {
            return false;
        }
        const g = new PacruGraph();
        const next = g.move(to, tContents.chevron.facing, 1);
        // if facing edge of board, false
        if (next === undefined) {
            return false;
        }
        const nContents = this.board.get(next);
        // if next cell is empty, unclaimed, or unoccupied, false
        if (nContents === undefined || nContents.tile === undefined || nContents.chevron === undefined) {
            return false;
        }
        const oppDir = oppositeDirections.get(tContents.chevron.facing)!;
        // if tile and chevron belong to player, is facing the correct direction, and
        // at least one opponent has at least 9 tiles, true
        if (nContents.tile === tContents.tile && nContents.chevron.owner === tContents.tile && nContents.chevron.facing === oppDir && this.mostTiles(tContents.tile) >= 9) {
            return true;
        }
        // all other situations, false
        return false;
    }

    // returns the highest number of markers on the board for any player except the one specified
    public mostTiles(excluded: playerid): number {
        const counts = new Map<playerid, number>();
        for (let p = 1; p <= this.numplayers; p++) {
            if (p === excluded) {
                continue;
            }
            counts.set(p as playerid, 0);
        }
        for (const contents of this.board.values()) {
            if (contents.tile !== undefined && contents.tile !== excluded) {
                const curr = counts.get(contents.tile)!;
                counts.set(contents.tile, curr + 1);
            }
        }
        return Math.max(...counts.values());
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const g = new PacruGraph();
            let cell: string|undefined;
            if (row >= 0 && col >= 0) {
                cell = PacruGame.coords2algebraic(col, row);
            }
            let newmove: string;

            // empty move means selecting a chevron to move
            if (move === "" && cell !== undefined) {
                const contents = this.board.get(cell);
                if (contents !== undefined && contents.chevron !== undefined && contents.chevron.owner === this.currplayer) {
                    newmove = cell;
                } else {
                    newmove = "";
                }
            }
            // otherwise
            else {
                // reorientation mode
                if (move.endsWith("*")) {
                    let xClick: number;
                    let yClick: number;
                    // if we clicked on a buffer
                    if (cell === undefined) {
                        if (piece === undefined) {
                            throw new Error("No direction was passed to the click handler.");
                        }
                        [xClick, yClick] = piece.split(",").map(str => parseInt(str, 10));
                    }
                    // otherwise a cell
                    else {
                        xClick = col;
                        yClick = row;
                    }
                    const src = move.substring(0, 2);
                    // if we clicked the cell again, deselect
                    if (cell !== undefined && cell === src) {
                        newmove = "";
                    }
                    // otherwise, derive facing
                    else {
                        const contents = this.board.get(src);
                        if (contents === undefined || contents.chevron === undefined) {
                            throw new Error(`No chevron found at ${src}`);
                        }
                        const [sx, sy] = PacruGame.algebraic2coords(src);
                        let newdir = "";
                        if (yClick < sy) {
                            newdir = "N";
                        } else if (yClick > sy) {
                            newdir = "S";
                        }
                        if (xClick < sx) {
                            newdir += "W";
                        } else if (xClick > sx) {
                            newdir += "E";
                        }
                        if (newdir.length < 1 || newdir.length > 2) {
                            throw new Error("Could not determine bearing");
                        }
                        const delta = smallestDegreeDiff(dir2deg.get(newdir as Direction)!, dir2deg.get(contents.chevron.facing)!);
                        newmove = src;
                        for (let i = 0; i < Math.abs(delta / 45); i++) {
                            newmove += delta < 0 ? "<" : ">";
                        }
                    }
                }
                // all other scenarios
                else {
                    if (cell === undefined) {
                        throw new Error("Cell should not be undefined at this point!");
                    }
                    // click the cell again to trigger reorientation or to deselect
                    if (move.length === 2 && move === cell) {
                        if (move.length === 2) {
                            newmove = cell + "*";
                        } else {
                            newmove = "";
                        }
                    }
                    // select a destination
                    else if (move.length === 2) {
                        let operator = "-";
                        let isOwn = false;
                        if (this.board.has(cell)) {
                            const contents = this.board.get(cell)!;
                            if (contents.chevron !== undefined) {
                                if (contents.chevron.owner === this.currplayer) {
                                    isOwn = true;
                                }
                                operator = "x";
                            }
                        }
                        if (isOwn) {
                            newmove = cell;
                        } else {
                            newmove = move + operator + cell;
                            // if only a connection change, then auto-add the asterisk
                            const sideEffects = this.getSideEffects(move, cell, operator === "x");
                            if (sideEffects.has("connChange") && sideEffects.size === 1) {
                                newmove += "(*)";
                            }
                            // and if only blChange, check to see if only one neutral remains
                            else if (sideEffects.has("blChange") && sideEffects.size === 1) {
                                const neutrals: string[] = [];
                                const ctr = g.cell2ctr(cell);
                                for (const c of g.ctr2cells(ctr)) {
                                    const contents = this.board.get(c);
                                    if (contents === undefined) {
                                        neutrals.push(c);
                                    }
                                }
                                if (neutrals.length === 1) {
                                    newmove += `(${neutrals[0]})`;
                                }
                            }
                        }
                    }
                    // otherwise we're selecting side effected cells
                    else {
                        // at this point, if you click the starting cell, assume
                        // you're requesting a connection change
                        const src = move.substring(0, 2);
                        if (cell === src) {
                            newmove = move + "(*)";
                        } else {
                            const idx = move.indexOf("(");
                            if (idx >= 0) {
                                const cellStr = move.substring(idx+1, move.length - 1);
                                const cells = new Set<string>(cellStr.split(","));
                                if (cells.has(cell)) {
                                    cells.delete(cell);
                                } else {
                                    cells.add(cell);
                                }
                                newmove = move.substring(0, idx) + (cells.size > 0 ? "(" + [...cells].join(",") + ")" : "");
                            } else {
                                newmove = move + "(" + cell + ")";
                            }
                        }
                    }
                }
            }

            // auto-trigger reorientation if the selected piece has no base moves
            if (newmove.length === 2) {
                const matches = this.baseMoves().filter(mv => mv.startsWith(newmove));
                if (matches.length === 0) {
                    newmove += "*";
                }
            }

            const result = this.validateMove(newmove) as IClickResult;
            if (! result.valid) {
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
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};

        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const g = new PacruGraph();

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.pacru.INITIAL_INSTRUCTIONS")
            return result;
        }

        // check for reorientation trigger
        if (m.length === 3 && m.endsWith("*")) {
            if (this.numTiles() < 2) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pacru.NOT_ENOUGH");
                return result;
            }

            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.pacru.REORIENT")
            return result;
        }

        const {from, to, cells, isCapture, orientation} = this.parseMove(m);
        if (from === undefined) { throw new Error("Can't happen"); }
        // console.log(`from: ${from}, to: ${to}, cells: ${cells?.join(",")}, isCapture: ${isCapture}, orientation: ${orientation}`);

        // validate reorientation
        // never have to check for available moves because elimination happens before this
        if (orientation !== undefined) {
            // valid cell
            if (!g.graph.hasNode(from)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: from});
                return result;
            }
            // is occupied
            if (!this.board.has(from) || this.board.get(from)!.chevron === undefined) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: from});
                return result;
            }
            // is yours
            if (this.board.get(from)!.chevron!.owner !== this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                return result;
            }
            // isn't too far
            if (orientation.length > 2 || orientation.length === 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pacru.OVER_ORIENT");
                return result;
            }
            // you can afford it
            if (this.numTiles() < 2 * orientation.length) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.pacru.NOT_ENOUGH");
                return result;
            }

            // validate cells that have been passed, if present
            if (cells !== undefined) {
                for (const cell of cells) {
                    // valid cell
                    if (!g.graph.hasNode(cell)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                        return result;
                    }
                    const cContents = this.board.get(cell);
                    // is present
                    if (cContents === undefined) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: cell});
                        return result;
                    }
                    // your tile
                    if (cContents.tile !== this.currplayer) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.pacru.RELINQUISH_OWN", {where: cell});
                        return result;
                    }
                    // no chevron
                    if (cContents.chevron !== undefined) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.pacru.RELINQUISH_EMPTY", {where: cell});
                        return result;
                    }
                }
            }

            const target = orientation.length * 2;
            // now ensure they've selected enough cells to relinquish
            if (cells === undefined || cells.length < target) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.pacru.SELECT_CELL", {context: "orientation", count: cells === undefined ? target : target - cells.length});
                return result;
            }

            // we're good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
        // everything else
        else {
            const baseMoves = this.baseMoves();

            // validate from
            // valid cell
            if (!g.graph.hasNode(from)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: from});
                return result;
            }
            // is occupied
            if (!this.board.has(from) || this.board.get(from)!.chevron === undefined) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: from});
                return result;
            }
            // is yours
            if (this.board.get(from)!.chevron!.owner !== this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                return result;
            }
            // CAN'T DO THE FOLLOWING BECAUSE YOU STILL NEED TO BE ABLE TO REORIENT
            // // has legal moves
            // if (baseMoves.filter(mv => mv.startsWith(from)).length === 0) {
            //     result.valid = false;
            //     result.message = i18next.t("apgames:validation._general.NO_MOVES", {where: from});
            //     return result;
            // }

            // if no to, return partial
            if (to === undefined) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.pacru.NEED_DESTINATION")
                return result;
            } else {
                // validate to
                // valid cell
                if (!g.graph.hasNode(to)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: to});
                    return result;
                }
                // not the same
                if (from === to) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.SAME_FROM_TO");
                    return result;
                }
                const tContents = this.board.get(to);
                // if to is occupied, validate constraints
                if (tContents !== undefined) {
                    // if chevron is present
                    if (tContents.chevron !== undefined) {
                        // can't be yours
                        if (tContents.chevron.owner === this.currplayer) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation._general.SELFCAPTURE");
                            return result;
                        }
                        // must be correct operator
                        if (!isCapture) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation._general.MOVE4CAPTURE", {where: to});
                            return result;
                        }
                    }
                    // if no chevron
                    else {
                        // can't land on enemy tiles
                        if (tContents.tile !== undefined && tContents.tile !== this.currplayer) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.pacru.ENEMY_TILE");
                            return result;
                        }
                        // must use correct operator
                        if (isCapture) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation._general.CAPTURE4MOVE", {where: to});
                            return result;
                        }
                    }
                }
                // if basic move, make sure you're using the correct operator
                else {
                    if (isCapture) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.CAPTURE4MOVE", {where: to});
                        return result;
                    }
                }
                // check that move is in the base move list
                if (!baseMoves.includes(`${from}${isCapture ? "x" : "-"}${to}`)) {
                    // give better error message for captures
                    if (isCapture) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.pacru.BAD_CAPTURE", {move: `${from}${isCapture ? "x" : "-"}${to}`});
                        return result;
                    } else {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: `${from}${isCapture ? "x" : "-"}${to}`});
                        return result;
                    }
                }

                // if no cells, return either partial or complete, depending on side effects
                if (cells === undefined) {
                    const sideEffects = this.getSideEffects(from, to, isCapture);
                    // if no side effects, move might be complete
                    if (sideEffects.size === 0) {
                        // but we need to look for meetings first
                        const cloned = this.clone();
                        cloned.executeMove(m);
                        const isMeeting = cloned.isMeeting(to);
                        // if no meeting, then we're truly done
                        if (!isMeeting) {
                            result.valid = true;
                            result.complete = 1;
                            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                            return result;
                        }
                        // otherwise we need one more cell
                        else {
                            result.valid = true;
                            result.complete = -1;
                            result.canrender = true;
                            result.message = i18next.t("apgames:validation.pacru.SELECT_CELL", {context: "meeting"});
                            return result;
                        }
                    }
                    // select a cell to convert
                    else {
                        result.valid = true;
                        result.complete = -1;
                        result.canrender = true;
                        result.message = i18next.t("apgames:validation.pacru.SELECT_CELL", {context: (sideEffects.has("connChange") && sideEffects.size > 1) ? "both" : sideEffects.has("blChange") ? "blChange" : "blTransform"});
                        return result;
                    }
                }
                // otherwise validate the side effected cells
                else {
                    const sideEffects = this.getSideEffects(from, to, isCapture);
                    // I originally looped through all the cells, but this becomes a problem when
                    // there are multiple effects because the order of the cells is not certain.
                    // Instead, go with the "at least one" approach.

                    // `*` is only valid in connection changes
                    if (cells.includes("*") && !sideEffects.has("connChange")) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.pacru.BAD_CONNECTION");
                        return result;
                    }
                    // make sure all cells are well-formed
                    for (const cell of cells) {
                        if (cell !== "*" && !g.graph.hasNode(cell)) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                            return result;
                        }
                    }
                    const ctr = g.cell2ctr(to);
                    const blCells = g.ctr2cells(ctr);
                    if (sideEffects.has("blChange") || sideEffects.has("blTransform")) {
                        // need to validate that selected cells are within the bls where necessary
                        const within = cells.filter(c => blCells.includes(c) || c === "*");
                        if (within.length === 0) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.pacru.WITHIN_BL");
                            return result;
                        }
                        // blChange: at least one is neutral
                        if (sideEffects.has("blChange") && !cells.includes("*")) {
                            const neutral = cells.filter(c =>this.board.get(c) === undefined || (c === to && !isCapture));
                            if (neutral.length === 0) {
                                result.valid = false;
                                result.message = i18next.t("apgames:validation.pacru.ONLY_NEUTRAL");
                                return result;
                            }
                        }
                        // blTransform: at least one is opposing
                        else if (!cells.includes("*")) {
                            const opposing = cells.filter(c => this.board.has(c) && this.board.get(c)!.tile !== undefined && this.board.get(c)!.tile !== this.currplayer && this.board.get(c)!.chevron === undefined);
                            if (opposing.length === 0) {
                                result.valid = false;
                                result.message = i18next.t("apgames:validation.pacru.ONLY_OPPOSING");
                                return result;
                            }
                        }
                    }
                    for (const cell of cells) {
                        if (cell === "*") { continue; }
                        const contents = this.board.get(cell);
                        // none of the cells may have a chevron, except `to`
                        if (contents !== undefined && contents.chevron !== undefined) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.pacru.ONLY_UNOCCUPIED");
                            return result;
                        }
                        // none of the cells may have your own tile
                        if (contents !== undefined && contents.tile !== undefined && contents.tile === this.currplayer) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.pacru.ONLY_OPPOSING");
                            return result;
                        }
                    }

                    // see if there's a meeting
                    // usually you don't pass the cells to avoid changing the meeting threshold
                    // but if the first cell is the same as `to`, then you have to pass it
                    // or the meeting similarly won't trigger
                    const cloned = this.clone();
                    const cellIsTo = cells[0] === to;
                    cloned.executeMove(`${from}${isCapture ? "x" : "-"}${to}${cellIsTo ? `(${to})` : ""}`);
                    const isMeeting = cloned.isMeeting(to);
                    let target = 0;
                    if (sideEffects.size > 0) {
                        target++;
                    }
                    if (isMeeting) {
                        target++;
                    }
                    // see if enough cells have been provided
                    if (cells.length > target) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.pacru.TOO_MANY_CELLS");
                        return result;
                    }
                    else if (cells.length < target) {
                        result.valid = true;
                        result.complete = -1;
                        result.canrender = true;
                        result.message = i18next.t("apgames:validation.pacru.SELECT_CELL", {context: "meeting"});
                        return result;
                    }
                    // if so, we're good
                    else {
                        result.valid = true;
                        result.complete = 1;
                        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                        return result;
                    }
                }
            }
        }
    }

    public parseMove(m: string): {from?: string, to?: string, cells?: string[], isCapture: boolean, orientation?: string, isOrienting: boolean} {
        let from: string|undefined;
        let orientation: string|undefined;
        let to: string|undefined;
        let isCapture = false;
        let isOrienting = false;
        let cells: string[]|undefined

        if (m.length > 0) {
            from = m.substring(0, 2);
            // check for orientation first
            if (m.includes(">") || m.includes("<")) {
                let oIdx = m.indexOf(">");
                if (oIdx < 0) {
                    oIdx = m.indexOf("<");
                }
                const pIdx = m.indexOf("(");
                if (pIdx < 0) {
                    orientation = m.substring(oIdx);
                } else {
                    orientation = m.substring(oIdx, pIdx);
                    const cellStr = m.substring(pIdx + 1, m.length - 1);
                    cells = [...new Set<string>(cellStr.split(","))];
                }
            }
            // is orientation signalled
            else if (m.endsWith("*")) {
                isOrienting = true;
            }
            // if not orientation, must be a move of some kind
            else {
                let opIdx = m.indexOf("-");
                if (opIdx < 0) {
                    opIdx = m.indexOf("x");
                    if (opIdx >= 0) {
                        isCapture = true;
                    }
                }
                if (opIdx >= 0) {
                    to = m.substring(opIdx+1, opIdx + 3);
                    const pIdx = m.indexOf("(");
                    if (pIdx >= 0) {
                        const cellStr = m.substring(pIdx + 1, m.length - 1);
                        cells = [...new Set<string>(cellStr.split(","))];
                    }
                }
            }
        }

        return {from, to, cells, isCapture, orientation, isOrienting};
    }

    // should only be run on normalized, validated inputs
    // only executes what it receives so it can be used during partial moves
    public executeMove(m: string): void {
        const {from, to, orientation, cells, isCapture} = this.parseMove(m);
        // console.log(`Executing move "${m}"`);
        // console.log(`from: ${from}, to: ${to}, orientation: ${orientation}, cells: ${cells}, isCapture: ${isCapture}`);
        // actual movement
        if (from !== undefined && to !== undefined) {
            const fContents = this.board.get(from)!;
            const tContents = this.board.get(to);
            const [fx, fy] = PacruGame.algebraic2coords(from);
            const [tx, ty] = PacruGame.algebraic2coords(to);
            const bearing = RectGrid.bearing(fx, fy, tx, ty)!;
            // delete from
            if (fContents.tile === undefined) {
                this.board.delete(from);
            } else {
                this.board.set(from, {tile: fContents.tile})
            }
            // set to with the new heading
            let toTile: playerid|undefined;
            if ((tContents !== undefined && tContents.tile !== undefined) || isCapture) {
                toTile = this.currplayer;
            }
            this.board.set(to, {tile: toTile, chevron: {owner: this.currplayer, facing: bearing}});
            this.results.push({type: "move", from, to});
            if (isCapture) {
                this.results.push({type: "capture", where: to});
            }
        }
        // reorientation
        else if (from !== undefined && orientation !== undefined) {
            const fContents = this.board.get(from)!;
            const startFacing = fContents.chevron!.facing;
            const startDeg = dir2deg.get(startFacing)!;
            let newDeg: number;
            if (orientation.includes(">")) {
                newDeg = normDeg(startDeg + (45 * orientation.length));
            } else {
                newDeg = normDeg(startDeg - (45 * orientation.length));
            }
            const newFacing = deg2dir.get(newDeg)!;
            this.board.set(from, {tile: fContents.tile, chevron: {owner: this.currplayer, facing: newFacing}});
            this.results.push({type: "orient", where: from, facing: newFacing});
        }

        // process side effects
        if (cells !== undefined) {
            // if orienting, relinquish (delete) the passed cells
            if (orientation !== undefined) {
                for (const cell of cells) {
                    if (cell === "*") { continue; }
                    this.board.delete(cell);
                    this.results.push({type: "sacrifice", where: cell, what: this.currplayer.toString()});
                }
            }
            // otherwise just set the tile as belonging to you
            // this code used to clobber chevrons, but it can't because you may
            // also claim the neutral cell you just moved into on a blChange
            else {
                // check for connection change
                if (cells.includes("*")) {
                    if (from === undefined || to === undefined) {
                        throw new Error(`Invalid state. Connection change triggered but from or to is undefined.`);
                    }
                    const [fx, fy] = PacruGame.algebraic2coords(from);
                    const [tx, ty] = PacruGame.algebraic2coords(to);
                    const between = RectGrid.between(fx, fy, tx, ty).map(c => PacruGame.coords2algebraic(...c));
                    cells.push(...between);
                }
                for (const cell of cells) {
                    if (cell === "*") { continue; }
                    const contents = this.board.get(cell);
                    this.board.set(cell, {tile: this.currplayer, chevron: contents?.chevron})
                    if (contents === undefined || (cell === to && contents.tile === undefined)) {
                        this.results.push({type: "claim", where: cell});
                    } else {
                        this.results.push({type: "convert", what: contents.tile?.toString() || "neutral", into: this.currplayer.toString(), where: cell});
                    }
                }
            }
        }
    }

    public numChevrons(p?: playerid): number {
        if (p === undefined) {
            p = this.currplayer;
        }
        let count = 0;
        for (const {chevron} of this.board.values()) {
            if (chevron !== undefined && chevron.owner === p) {
                count++;
            }
        }
        return count;
    }

    public numTiles(p?: playerid): number {
        if (p === undefined) {
            p = this.currplayer;
        }
        return [...this.board.values()].filter(({tile}) => tile === p).length;
    }

    public move(m: string, {trusted = false, partial = false} = {}): PacruGame {
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
            // if (! this.moves().includes(m)) {
            //     throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            // }
        }

        const g = new PacruGraph();
        this.results = [];
        this.highlights = [];
        this.buffers = [];

        const {from, to, orientation, cells, isOrienting, isCapture} = this.parseMove(m);
        if (from === undefined) { return this; }
        // console.log(`from: ${from}, to: ${to}, orientation: ${orientation}, cells: ${cells?.join(",")}, isOrienting: ${isOrienting}`);

        // add highlighting if partial and necessary
        if (partial) {
            // orienting first
            if (isOrienting) {
                // add neighbouring cells
                const {chevron} = this.board.get(from)!;
                const dirs = [-90, -45, 45, 90].map(d => rotateFacing(chevron!.facing, d));
                for (const dir of dirs) {
                    const ray = g.ray(from, dir);
                    if (ray.length > 0) {
                        this.highlights.push(ray[0]);
                    }
                }
                const [fx, fy] = g.algebraic2coords(from);
                if (fx === 0) {
                    this.buffers.push("W");
                } else if (fx === 8) {
                    this.buffers.push("E");
                }
                if (fy === 0) {
                    this.buffers.push("N");
                } else if (fy === 8) {
                    this.buffers.push("S");
                }
            }
            // move highlighting (including `from` if you want to trigger reorientation)
            else if (to === undefined && orientation === undefined) {
                const baseMoves = this.baseMoves();
                this.highlights = [...baseMoves.filter(mv => mv.startsWith(from)).map(mv => mv.substring(3)), from];
            }
            // highlighting bl and connection changes and meetings
            else if (to !== undefined) {
                const sideEffects = this.getSideEffects(from, to, isCapture);
                // no cells provided but side effects, then highlight
                if (cells === undefined && sideEffects.size > 0) {
                    this.executeMove(m);
                    const toHasTile = this.board.get(to)!.tile !== undefined;
                    const ctr = g.cell2ctr(to);
                    const blcells = g.ctr2cells(ctr);
                    for (const cell of blcells) {
                        if (sideEffects.has("blChange") && (!this.board.has(cell) || (cell === to && !toHasTile))) {
                            this.highlights.push(cell);
                        } else if (sideEffects.has("blTransform")) {
                            const contents = this.board.get(cell)!;
                            if (contents.tile !== this.currplayer && contents.chevron === undefined) {
                                this.highlights.push(cell);
                            }
                        }
                    }
                    if (sideEffects.has("connChange")) {
                        this.highlights.push(from);
                    }
                }
                // if no cells but also no side effects
                // or if a cell was provided, look for meetings
                if ((cells === undefined && sideEffects.size === 0) || (cells !== undefined && cells.length > 0)) {
                    this.executeMove(m);
                    // VISUALLY OVERWHELMING
                    // SKIPPING MEETING HIGHLIGHTS FOR NOW
                    // if (this.isMeeting(to)) {
                    //     for (const cell of g.graph.nodes()) {
                    //         const contents = this.board.get(cell);
                    //         if (contents === undefined || (contents.tile !== this.currplayer && contents.chevron === undefined)) {
                    //             this.highlights.push(cell);
                    //         }
                    //     }
                    // }
                }
            }
            // highlight relinquishments
            else if (orientation !== undefined) {
                this.executeMove(m);
                for (const cell of g.graph.nodes()) {
                    const contents = this.board.get(cell);
                    if (contents !== undefined && contents.tile === this.currplayer && contents.chevron === undefined) {
                        this.highlights.push(cell);
                    }
                }
            }

            return this;
        }

        // fully execute the move
        this.executeMove(m);
        this.lastmove = m;

        // update currplayer
        let newplayer = (this.currplayer as number) + 1;
        if (newplayer > this.numplayers) {
            newplayer = 1;
        }
        this.currplayer = newplayer as playerid;

        this.checkEOG();
        this.saveState();

        // auto pass or eliminate here, if the game isn't already over
        while (
            !this.gameover &&
            (
                this.numChevrons(this.currplayer) === 0 ||
                this.baseMoves(this.currplayer).length === 0
            )
        ) {
            // you have to pass no matter what
            this.results = [{type: "pass"}];
            this.lastmove = "pass";
            // but if you have pieces, then signal the elimination and remove existing pieces
            if (this.numChevrons(this.currplayer) > 0) {
                this.results.push({type: "eliminated", who: this.currplayer.toString()});
                for (const [cell, contents] of [...this.board.entries()]) {
                    if (contents.chevron !== undefined && contents.chevron.owner === this.currplayer) {
                        this.results.push({type: "remove", where: cell});
                        if (contents.tile === undefined) {
                            this.board.delete(cell);
                        } else {
                            this.board.set(cell, {tile: contents.tile});
                        }
                    }
                }
            }

            // update currplayer
            newplayer = (this.currplayer as number) + 1;
            if (newplayer > this.numplayers) {
                newplayer = 1;
            }
            this.currplayer = newplayer as playerid;

            this.checkEOG();
            this.saveState();
        }

        return this;
    }

    public get targetScore(): number {
        return this.numplayers === 2 ? 42 : this.numplayers === 3 ? 28 : 24;
    }

    public getPlayerScore(player: number): number {
        return this.numTiles(player as playerid);
    }

    public getPlayersScores(): IScores[] {
        const scores: number[] = [];
        for (let p = 1; p <= this.numplayers; p++) {
            scores.push(this.getPlayerScore(p));
        }
        return [{ name: i18next.t("apgames:status.pacru.TILES"), scores }];
    }

    public statuses(): IStatus[] {
        return [{ key: i18next.t("apgames:status.pacru.TARGET"), value: [this.targetScore.toString()] }];
    }

    protected checkEOG(): PacruGame {
        let reason = "";
        // check scores first
        for (let p = 1; p <= this.numplayers; p++) {
            if (this.getPlayerScore(p) >= this.targetScore) {
                this.gameover = true;
                this.winner = [p as playerid];
                reason = "score";
                break;
            }
        }

        // now check for last man standing
        if (!this.gameover) {
            const chevrons: number[] = [];
            for (let p = 1; p <= this.numplayers; p++) {
                chevrons.push(this.numChevrons(p as playerid));
            }
            if (chevrons.filter(n => n > 0).length === 1) {
                this.gameover = true;
                const idx = chevrons.findIndex(n => n > 0);
                this.winner = [(idx+1) as playerid];
                reason = "lastManStanding"
            }
        }

        if (this.gameover) {
            this.results.push(
                {type: "eog", reason},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IPacruState {
        return {
            game: PacruGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: PacruGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            board: deepclone(this.board) as Map<string, CellContents>,
        };
    }

    public render(): APRenderRep {
        const labels = ["A","B","C","D"];
        // Build piece string
        let pstr = "";
        const allPcs = new Set<string>();
        for (let row = 0; row < 9; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < 9; col++) {
                const cell = PacruGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    const tile = contents.tile === undefined ? "x" : labels[contents.tile - 1];
                    const chevron = contents.chevron === undefined ? "x" : [labels[contents.chevron.owner - 1], contents.chevron.facing].join("_");
                    const pc = [tile, chevron].join("_");
                    pieces.push(pc);
                    allPcs.add(pc);
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join(",");
        }

        const legend: {[key: string]: Glyph|[Glyph, ...Glyph[]]} = {};
        for (const pc of allPcs) {
            const [tile, owner, facing] = pc.split("_");
            // just tile
            if (owner === "x") {
                legend[pc] = {
                    name: "piece",
                    scale: 0.33,
                    colour: labels.indexOf(tile) + 1,
                };
            }
            // just chevron
            else if (tile === "x") {
                legend[pc] = {
                    name: "arrowhead",
                    colour: labels.indexOf(owner) + 1,
                    rotate: dir2deg.get(facing as Direction),
                };
            }
            // both
            else {
                legend[pc] = [
                    {
                        name: "piece",
                        scale: 0.33,
                        colour: labels.indexOf(tile) + 1,
                    },
                    {
                        name: "arrowhead",
                        colour: labels.indexOf(owner) + 1,
                        rotate: dir2deg.get(facing as Direction),
                    },
                ];
            }
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-checkered",
                width: 9,
                height: 9,
                tileWidth: 3,
                tileHeight: 3,
                tileLineMult: 5,
                buffer: this.buffers.length === 0 ? undefined : {
                    separated: true,
                    width: 0.2,
                    pattern: "slant",
                    show: [...this.buffers] as ("N" | "E" | "S" | "W")[],
                },
            },
            legend,
            pieces: pstr
        };

        // Add annotations
        if (this.results.length > 0) {
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "move") {
                    const [fromX, fromY] = PacruGame.algebraic2coords(move.from);
                    const [toX, toY] = PacruGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "orient" || move.type === "claim" || move.type === "convert") {
                    const [x, y] = PacruGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                } else if (move.type === "capture" || move.type === "sacrifice" || move.type === "remove") {
                    const [x, y] = PacruGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                }
            }
        }

        // add highlighting if requested
        if (this.highlights.length > 0) {
            if (!("annotations" in rep)) {
                rep.annotations = [];
            }
            const targets: RowCol[] = [];
            for (const cell of this.highlights) {
                const [x, y] = PacruGame.algebraic2coords(cell);
                targets.push({row: y, col: x});
            }
            rep.annotations!.push({type: "enter", targets: targets as [RowCol, ...RowCol[]], colour: this.currplayer});
        }

        return rep;
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        const scores: number[] = [];
        for (let p = 1; p <= this.numplayers; p++) {
            scores.push(this.getPlayerScore(p));
        }
        status += "**Scores**: " + scores.join(", ") + "\n\n";

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "sacrifice":
                node.push(i18next.t("apresults:SACRIFICE.nowhat", {player, where: r.where}));
                resolved = true;
                break;
            case "convert":
                node.push(i18next.t("apresults:CONVERT.simple", {player, where: r.where}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): PacruGame {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        const cloned = Object.assign(new PacruGame(this.numplayers), deepclone(this) as PacruGame);
        return cloned;
    }
}
