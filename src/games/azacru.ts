import { GameBase, IAPGameState, IClickResult, IIndividualState, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, RowCol } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { deg2dir, dir2deg, Direction, normDeg, RectGrid, replacer, reviver, rotateFacing, smallestDegreeDiff, UserFacingError } from "../common";
import i18next from "i18next";
import { PacruGraph } from "./pacru/graph";
import { Glyph } from "@abstractplay/renderer/build";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Buffer = require('buffer/').Buffer  // note: the trailing slash is important!
import pako, { Data } from "pako";

// eslint-disable-next-line @typescript-eslint/no-require-imports
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
export type SideEffect = "blChange"|"connChange";

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    lastmove?: string;
    triggered?: playerid;
};

export interface IAzacruState extends IAPGameState {
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

export class AzacruGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Azacru",
        uid: "azacru",
        playercounts: [2,3,4],
        version: "20250215",
        dateAdded: "2025-02-19",
        // i18next.t("apgames:descriptions.azacru")
        description: "apgames:descriptions.azacru",
        // i18next.t("apgames:notes.azacru")
        notes: "apgames:notes.azacru",
        urls: ["https://boardgamegeek.com/boardgame/21065/azacru"],
        people: [
            {
                type: "designer",
                name: "Mike Wellman",
                urls: ["http://www.pacru.com/"],
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        categories: ["goal>area", "mechanic>place", "mechanic>move", "mechanic>convert", "board>shape>rect", "board>connect>rect", "components>special", "other>2+players"],
        flags: ["scores", "automove"]
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
    private triggered?: playerid;

    constructor(state: IAzacruState | string | number, variants?: string[]) {
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
                _version: AzacruGame.gameinfo.version,
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
                    state = JSON.parse(state, reviver) as IAzacruState;
                }
                // or is it a b64 encoded gzip
                else {

                    const decoded = Buffer.from(state, "base64") as Data;
                    const decompressed = pako.ungzip(decoded, {to: "string"});
                    state = JSON.parse(decompressed, reviver) as IAzacruState;
                }
            }
            if (state.game !== AzacruGame.gameinfo.uid) {
                throw new Error(`The Azacru engine cannot process a game of '${state.game}'.`);
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

        return Buffer.from(compressed).toString("base64") as string;
    }

    public load(idx = -1): AzacruGame {
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
        this.triggered = state.triggered;
        this.results = [...state._results];
        return this;
    }

    public moves(): string[] {
        if (this.gameover) { return []; }

        const moves: string[] = [];

        for (const mv of this.baseMoves()) {
            // check for borderland twist
            const [from, to] = mv.split("-");
            const effects = this.getSideEffects(from, to);
            if (effects.has("blChange")) {
                moves.push(mv + "^");
                moves.push(mv + "<");
                moves.push(mv + ">");
            } else {
                moves.push(mv);
            }
        }
        if (moves.length === 0) {
            moves.push("pass");
        }

        return moves.sort((a,b) => a.localeCompare(b));
    }

    // The randomizer never reorients and always chooses the connection change option
    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    // This function only determines which chevrons can move where.
    // Special effect handling is done elsewhere.
    public baseMoves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];
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
                            blocked = true;
                        }
                        // otherwise, move if possible
                        else if ((contents === undefined || contents.tile === undefined || contents.tile === player)) {
                            moves.push(`${cell}-${next}`);
                        }
                    }
                }
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

    public getSideEffects(from: string, to: string): Set<SideEffect> {
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
        let converting = false;

        // did we change borderlands?
        // (don't bother if endgame triggered)
        const fCtr = g.cell2ctr(from);
        const tCtr = g.cell2ctr(to);
        if (fCtr !== tCtr && this.triggered === undefined) {
            set.add("blChange");
        }

        // are we connecting
        if (fContents.tile === player && tContents !== undefined && tContents.tile === player) {
            // only applies if no intervening chevrons
            const between = RectGrid.between(fx, fy, tx, ty).map(c => g.coords2algebraic(...c));
            let blocked = false;
            for (const cell of between) {
                const contents = this.board.get(cell);
                // if this cell has an opposing tile, then set converting
                if (contents !== undefined && contents.tile !== undefined && contents.tile !== this.currplayer) {
                    converting = true;
                }
                if (contents !== undefined && contents.chevron !== undefined) {
                    blocked = true;
                    break;
                }
            }
            // don't bother signalling connection changes unless there's at least one cell in between
            if (!blocked && between.length > 0) {
                set.add("connChange");
                // if this is a converting connChange, delete blChange
                // because your chevron will die
                if (converting) {
                    set.delete("blChange");
                }
            }
        }

        return set;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let cell: string|undefined;
            if (row >= 0 && col >= 0) {
                cell = AzacruGame.coords2algebraic(col, row);
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
                    const src = move.substring(move.length - 3, move.length - 1);
                    // if we clicked the cell again, assume no direction change
                    if (cell !== undefined && cell === src) {
                        newmove = move.substring(0, move.length - 1) + "^";
                    }
                    // otherwise, derive facing
                    else {
                        const {from, to} = this.parseMove(move);
                        const cloned = this.clone();
                        cloned.executeMove(`${from}-${to}`);
                        const contents = cloned.board.get(src);
                        if (contents === undefined || contents.chevron === undefined) {
                            throw new Error(`No chevron found at ${src}`);
                        }
                        const [sx, sy] = AzacruGame.algebraic2coords(src);
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
                        if (delta === 0) {
                            newmove = move.substring(0, move.length - 1) + "^";
                        } else if (delta < 0) {
                            newmove = move.substring(0, move.length - 1) + "<";
                        } else {
                            newmove = move.substring(0, move.length - 1) + ">";
                        }
                    }
                }
                // all other scenarios
                else {
                    if (cell === undefined) {
                        throw new Error("Cell should not be undefined at this point!");
                    }
                    // click the cell again to deselect
                    if (move.length === 2 && move === cell) {
                        newmove = "";
                    }
                    // select a destination
                    else if (move.length === 2) {
                        let isOwn = false;
                        if (this.board.has(cell)) {
                            const contents = this.board.get(cell)!;
                            if (contents.chevron !== undefined) {
                                if (contents.chevron.owner === this.currplayer) {
                                    isOwn = true;
                                }
                            }
                        }
                        if (isOwn) {
                            newmove = cell;
                        } else {
                            newmove = move + "-" + cell;
                            // if blChange triggered, auto-add the orientation asterisk
                            const sideEffects = this.getSideEffects(move, cell);
                            if (sideEffects.has("blChange")) {
                                newmove += "*";
                            }
                        }
                    }
                    // otherwise error
                    else {
                        newmove = "";
                    }
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
            result.message = i18next.t("apgames:validation.azacru.INITIAL_INSTRUCTIONS")
            return result;
        }

        // pass first
        if (m === "pass") {
            if (this.moves().includes("pass")) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            } else {
                result.valid = false;
                result.message = i18next.t("apgames:validation.azacru.BAD_PASS");
                return result;
            }
        }

        // check for reorientation trigger
        if (m.endsWith("*")) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.azacru.REORIENT")
            return result;
        }

        const {from, to, orientation} = this.parseMove(m);
        if (from === undefined) { throw new Error("Can't happen"); }
        // console.log(`from: ${from}, to: ${to}, cells: ${cells?.join(",")}, isCapture: ${isCapture}, orientation: ${orientation}`);
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
        // has legal moves
        if (baseMoves.filter(mv => mv.startsWith(from)).length === 0) {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.NO_MOVES", {where: from});
            return result;
        }

        // if no to, return partial
        if (to === undefined) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.azacru.NEED_DESTINATION")
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
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.azacru.NO_CAPTURE");
                    return result;
                }
                // if no chevron
                else {
                    // can't land on enemy tiles
                    if (tContents.tile !== undefined && tContents.tile !== this.currplayer) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.azacru.ENEMY_TILE");
                        return result;
                    }
                }
            }

            if (orientation !== undefined && orientation !== "<" && orientation !== ">" && orientation !== "^") {
                result.valid = false;
                result.message = i18next.t("apgames:validation.azacru.BAD_ORIENTATION");
                return result;
            }

            const sideEffects = this.getSideEffects(from, to);
            // if no side effects, move is complete
            if (sideEffects.size === 0) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
            // select a cell to convert
            else {
                if (sideEffects.has("blChange") && orientation === undefined) {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.azacru.REORIENT")
                    return result;
                }

                // otherwise we're good
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
        }
    }

    public parseMove(m: string): {from?: string, to?: string, orientation?: string, isOrienting: boolean} {
        let from: string|undefined;
        let orientation: string|undefined;
        let to: string|undefined;
        let isOrienting = false;

        if (m.length > 0) {
            from = m.substring(0, 2);
            const opIdx = m.indexOf("-");
            if (opIdx >= 0) {
                to = m.substring(opIdx+1, opIdx+3);
            }
            if (m.endsWith("^")) {
                orientation = "^";
            } else if (m.endsWith("<")) {
                orientation = "<";
            } else if (m.endsWith(">")) {
                orientation = ">";
            } else if (m.endsWith("*")) {
                isOrienting = true;
            }
        }

        return {from, to, orientation, isOrienting};
    }

    // should only be run on normalized, validated inputs
    // only executes what it receives so it can be used during partial moves
    public executeMove(m: string): void {
        const {from, to, orientation} = this.parseMove(m);
        // console.log(`Executing move "${m}"`);
        // console.log(`from: ${from}, to: ${to}, orientation: ${orientation}`);
        // actual movement
        if (from !== undefined && to !== undefined) {
            const effects = this.getSideEffects(from, to);
            const fContents = this.board.get(from)!;
            const tContents = this.board.get(to);
            const [fx, fy] = AzacruGame.algebraic2coords(from);
            const [tx, ty] = AzacruGame.algebraic2coords(to);
            const bearing = RectGrid.bearing(fx, fy, tx, ty)!;
            // delete from
            if (fContents.tile === undefined) {
                this.board.delete(from);
            } else {
                this.board.set(from, {tile: fContents.tile})
            }
            // set to with the new heading
            this.board.set(to, {tile: this.currplayer, chevron: {owner: this.currplayer, facing: bearing}});
            this.results.push({type: "move", from, to});
            if (tContents === undefined) {
                this.results.push({type: "claim", where: to});
            }

            // handle connection change
            if (effects.has("connChange")) {
                let converted = false;
                const between = RectGrid.between(fx, fy, tx, ty).map(c => AzacruGame.coords2algebraic(...c));
                for (const cell of between) {
                    const contents = this.board.get(cell);
                    if (contents === undefined) {
                        this.results.push({type: "claim", where: cell});
                    } else if (contents.tile !== this.currplayer) {
                        converted = true;
                        this.results.push({type: "convert", what: contents.tile?.toString() || "neutral", into: this.currplayer.toString(), where: cell});
                    }
                    this.board.set(cell, {tile: this.currplayer});
                }
                if (converted) {
                    this.board.set(to, {tile: this.currplayer});
                    this.results.push({type: "sacrifice", what: "chevron", where: to});
                }
            }
            // reorientation
            if (orientation !== undefined) {
                const contents = this.board.get(to)!;
                const startFacing = contents.chevron!.facing;
                const startDeg = dir2deg.get(startFacing)!;
                let newDeg = startDeg;
                if (orientation.includes(">")) {
                    newDeg = normDeg(startDeg + 45);
                } else if (orientation.includes("<")) {
                    newDeg = normDeg(startDeg - 45);
                }
                if (newDeg !== startDeg) {
                    const newFacing = deg2dir.get(newDeg)!;
                    this.board.set(to, {tile: contents.tile, chevron: {owner: this.currplayer, facing: newFacing}});
                    this.results.push({type: "orient", where: from, facing: newFacing});
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

    public move(m: string, {trusted = false, partial = false} = {}): AzacruGame {
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
            if (!partial && !this.moves().includes(m)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: m}))
            }
        }

        const g = new PacruGraph();
        this.results = [];
        this.highlights = [];
        this.buffers = [];

        // pass first
        if (m === "pass") {
            this.results.push({type: "pass"});
            // if eog isn't already triggered, trigger it now
            if (this.triggered === undefined) {
                this.triggered = this.currplayer;
            }
        } else {
            const {from, to, orientation, isOrienting} = this.parseMove(m);
            if (from === undefined) { return this; }
            // console.log(`from: ${from}, to: ${to}, orientation: ${orientation}, cells: ${cells?.join(",")}, isOrienting: ${isOrienting}`);

            // add highlighting if partial and necessary
            if (partial) {
                // orienting first
                if (isOrienting && to !== undefined) {
                    this.executeMove(m);
                    // add neighbouring cells
                    const {chevron} = this.board.get(to)!;
                    const dirs = [-45, 45, 0].map(d => rotateFacing(chevron!.facing, d));
                    for (const dir of dirs) {
                        const ray = g.ray(to, dir);
                        if (ray.length > 0) {
                            this.highlights.push(ray[0]);
                        }
                    }
                    const [fx, fy] = g.algebraic2coords(to);
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
                // move highlighting
                else if (to === undefined && orientation === undefined) {
                    const baseMoves = this.baseMoves();
                    this.highlights = [...baseMoves.filter(mv => mv.startsWith(from)).map(mv => mv.substring(3))];
                }

                return this;
            }

            // fully execute the move
            this.executeMove(m);
        }

        this.lastmove = m;

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

    protected checkEOG(): AzacruGame {
        // game ends when someone passes and everyone else has had one turn
        if (this.triggered !== undefined && this.triggered === this.currplayer) {
            this.gameover = true;
            const scores = this.getPlayersScores()[0].scores as number[];
            const max = Math.max(...scores);
            for (let p = 1; p <= this.numplayers; p++) {
                if (scores[p-1] === max) {
                    this.winner.push(p as playerid);
                }
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

    public state(): IAzacruState {
        return {
            game: AzacruGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    public moveState(): IMoveState {
        return {
            _version: AzacruGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            triggered: this.triggered,

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
                const cell = AzacruGame.coords2algebraic(col, row);
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
                    const [fromX, fromY] = AzacruGame.algebraic2coords(move.from);
                    const [toX, toY] = AzacruGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "claim" || move.type === "convert" || move.type === "orient") {
                    const [x, y] = AzacruGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
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
                const [x, y] = AzacruGame.algebraic2coords(cell);
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

    public clone(): AzacruGame {

        const cloned = Object.assign(new AzacruGame(this.numplayers), deepclone(this) as AzacruGame);
        return cloned;
    }
}
