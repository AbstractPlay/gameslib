/* eslint-disable @typescript-eslint/no-require-imports */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult, IScores } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, BoardBasic, MarkerFlood } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { replacer, reviver, UserFacingError, x2uid } from "../common";
import { generateField } from "../common/hexes";
import i18next from "i18next";
import { StorisendeHex } from "./storisende/hex";
import { StorisendeBoard } from "./storisende/board";
import { shuffle } from "../common";
const Buffer = require('buffer/').Buffer  // note: the trailing slash is important!
import pako, { Data } from "pako";
const deepclone = require("rfdc/default");

export type playerid = 1|2;
export type Tile = undefined|"virgin"|"territory"|"wall";

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: StorisendeHex[];
    lastmove?: string;
}

export interface IStorisendeState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class StorisendeGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Storisende",
        uid: "storisende",
        playercounts: [2],
        version: "20250109",
        dateAdded: "2025-01-18",
        // i18next.t("apgames:descriptions.storisende")
        description: "apgames:descriptions.storisende",
        // notes: "apgames:notes.storisende",
        urls: [
            "https://mindsports.nl/index.php/arena/storisende/747-storisende-rules",
            "https://boardgamegeek.com/boardgame/255427/storisende",
        ],
        people: [
            {
                type: "designer",
                name: "Christian Freeling",
                urls: ["https://www.mindsports.nl/"],
                apid: "b12bd9cd-59cf-49c7-815f-af877e46896a",
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        variants: [
            // default is hex5 board
            {uid: "board-hex4", group: "board"},
            { uid: "#board", },
            {uid: "board-hex6", group: "board"},
            {uid: "board-hex7", group: "board"},
            {uid: "board-modular-13", group: "board"},
            {uid: "board-modular-18", group: "board"},
        ],
        categories: ["goal>area", "mechanic>coopt", "mechanic>move", "mechanic>place", "mechanic>stack", "mechanic>capture", "board>dynamic", "board>connect>hex", "components>special"],
        flags: ["pie", "scores", "automove", "custom-rotation", "random-start", "custom-randomization"],
    };

    public static clone(obj: StorisendeGame): StorisendeGame {
        const cloned: StorisendeGame = Object.assign(new StorisendeGame(), deepclone(obj) as StorisendeGame);
        cloned.board = obj.board.clone();
        return cloned;
    }

    public numplayers = 2;
    public currplayer!: playerid;
    public board!: StorisendeBoard;
    public gameover = false;
    public winner: playerid[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public variants: string[] = [];
    public startpos!: string;
    private dots: string[] = [];

    constructor(state?: IStorisendeState | string, variants?: string[]) {
        super();
        if (state !== undefined) {
            if (typeof state === "string") {
                // is the state a raw JSON obj
                if (state.startsWith("{")) {
                    state = JSON.parse(state, reviver) as IStorisendeState;
                }
                // or is it a b64 encoded gzip
                else {
                    const decoded = Buffer.from(state, "base64") as Data;
                    const decompressed = pako.ungzip(decoded, {to: "string"});
                    state = JSON.parse(decompressed, reviver) as IStorisendeState;
                }
            }
            if (state.game !== StorisendeGame.gameinfo.uid) {
                throw new Error(`The Storisende game code cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.variants = [...state.variants];
            this.winner = [...state.winner];
            this.stack = [...state.stack];
        } else {
            if ( (variants !== undefined) && (variants.length > 0) ) {
                this.variants = [...variants];
            }

            const ctrs: {q: number; r: number}[] = [];
            if (this.variants.includes("board-hex4")) {
                ctrs.push({q: 0, r: 0}, {q: 0, r: -2}, {q: 2, r: -2}, {q: 2, r: 0}, {q: 0, r: 2}, {q: -2, r: 2}, {q: -2, r: 0});
            } else if (this.variants.includes("board-hex6")) {
                ctrs.push(
                    {q: 2, r: -4}, {q: 4, r: -4}, {q: 0, r: -4},
                    {q: 1, r: -2}, {q: 4, r: -2}, {q: -2, r: -2},
                    {q: 0, r: 0}, {q: 2, r: 0}, {q: 4, r: 0}, {q: -2, r: 0}, {q: -4, r: 0},
                    {q: -1, r: 2}, {q: 2, r: 2}, {q: -4, r: 2},
                    {q: -2, r: 4}, {q: 0, r: 4}, {q: -4, r: 4},
                );
            } else if (this.variants.includes("board-hex7")) {
                ctrs.push(
                    {q: 0, r: -5}, {q: 2, r: -5}, {q: 3, r: -5}, {q: 5, r: -5},
                    {q: -2, r: -3}, {q: 5, r: -3},
                    {q: 0, r: -2}, {q: -3, r: -2}, {q: 2, r: -2}, {q: 5, r: -2},
                    {q: 0, r: 0}, {q: 2, r: 0}, {q: 5, r: 0}, {q: -2, r: 0}, {q: -5, r: 0},
                    {q: 0, r: 2}, {q: 3, r: 2}, {q: -2, r: 2}, {q: -5, r: 2},
                    {q: -5, r: 3}, {q: 2, r: 3},
                    {q: 0, r: 5}, {q: -2, r: 5}, {q: -3, r: 5}, {q: -5, r: 5},
                );
            } else if (this.variants.includes("board-modular-13")) {
                ctrs.push(...generateField(13));
            } else if (this.variants.includes("board-modular-18")) {
                ctrs.push(...generateField(18));
            } else {
                ctrs.push(
                    {q: 3, r: -3}, {q: 0, r: -3}, {q: 1, r: -3},
                    {q: 1, r: -2},
                    {q: 2, r: -1}, {q: -1, r: -1},
                    {q: -2, r: -1}, {q: 3, r: -1},
                    {q: 0, r: 0}, {q: 3, r: 0}, {q: -3, r: 0},
                    {q: -3, r: 1}, {q: 2, r: 1},
                    {q: 1, r: 1}, {q: -2, r: 1},
                    {q: -1, r: 2},
                    {q: 0, r: 3}, {q: -3, r: 3}, {q: -1, r: 3},
                );
            }

            const fresh: IMoveState = {
                _version: StorisendeGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board: new StorisendeBoard({centres: ctrs}).serialize(),
            };
            this.stack = [fresh];
        }
        this.load();
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public serialize(opts?: {strip?: boolean, player?: number}): string {
        const json = JSON.stringify(this.state(), replacer);
        const compressed = pako.gzip(json);
        return Buffer.from(compressed).toString("base64") as string;
    }

    public load(idx = -1): StorisendeGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        if (state === undefined) {
            throw new Error(`Could not load state index ${idx}`);
        }
        this.results = [...state._results];
        this.currplayer = state.currplayer;
        this.board = StorisendeBoard.deserialize(state.board);
        this.lastmove = state.lastmove;
       return this;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        // no move list for the first two moves of the game
        if (this.stack.length < 3) {
            return [];
        }

        // In this case, just compile a naive list of moves
        // and then run them all through the validator,
        // only returning moves that pass.
        // This avoids duplicating validation logic.
        const moves: string[] = ["pass"];
        const g = this.board.graph;
        const mine = this.board.hexes.filter(h => h.stack.includes(this.currplayer));
        for (const hex of mine) {
            for (let dist = 1; dist <= hex.stack.length; dist++) {
                const from = this.board.hex2algebraic(hex);
                for (const dir of g.allDirs) {
                    let to: string|undefined;
                    const ray = g.ray(from, dir);
                    if (ray.length >= dist) {
                        to = ray[dist-1];
                    }
                    if (to !== undefined) {
                        // if moving entire stack, notation is simpler
                        if (dist === hex.stack.length) {
                            moves.push(`${from}-${to}`);
                        }
                        // otherwise do the subset
                        else {
                            moves.push(`${from}:${dist}-${to}`);
                        }
                    }

                }
            }
        }

        const valid = moves.filter(mv => this.validateMove(mv).valid);
        return valid.sort((a, b) => a.localeCompare(b));
    }

    public randomMove(): string {
        if (this.stack.length >= 3) {
            const moves = this.moves();
            return moves[Math.floor(Math.random() * moves.length)];
        } else {
            // this randomizer only ever places two doubles
            const empties = shuffle(this.board.hexes.filter(h => h.stack.length === 0)) as StorisendeHex[];
            return [this.board.hex2algebraic(empties[0]), this.board.hex2algebraic(empties[0]), this.board.hex2algebraic(empties[1]), this.board.hex2algebraic(empties[1])].join(",")
        }
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        move = move.toLowerCase();
        move = move.replace(/\s+/g, "");

        try {
            const cell = this.board.graph.coords2algebraic(col, row);
            let newmove = "";

            // if first moves, just keep a list of clicked cells
            if (this.stack.length < 3) {
                if (move === "") {
                    newmove = cell;
                } else {
                    newmove = move + "," + cell;
                }
            }
            // otherwise all other moves
            else {
                // empty move means clicking on an occupied cell to start a move
                if (move === "") {
                    newmove = cell;
                }
                // otherwise you're selecting a destination
                // autocomplete happens here
                else {
                    // if you click the same cell, deselect
                    if (move === cell) {
                        newmove = "";
                    } else {
                        const matches = this.moves().filter(m => m.startsWith(move) && m.endsWith(cell));
                        if (matches.length === 1) {
                            newmove = matches[0];
                        } else {
                            newmove = move + "-" + cell;
                        }
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
        const g = this.board.graph;

        // check for early-game scenarios first
        if (this.stack.length === 1) {
            if (m.length === 0) {
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.storisende.INITIAL_INSTRUCTIONS", {context: "first"});
                return result;
            }
            const placed = m.split(",")
            // all placements must be on valid hexes
            for (const cell of placed) {
                const hex = this.board.getHexAtAlgebraic(cell);
                if (hex === undefined) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.storisende.BAD_PLACEMENT");
                    return result;
                }
            }
            if (placed.length > 5) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.storisende.TOO_MANY");
                return result;
            }
            const remaining = 5 - placed.length;
            if (placed.length < 2) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.storisende.PARTIAL_PLACE_FIRST_MORE");
                return result;
            } else if (placed.length < 5) {
                result.valid = true;
                result.complete = 0;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.storisende.PARTIAL_PLACE_FIRST", {count: remaining});
                return result;
            }

            // if we make it here, it's exactly 5
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        } else if (this.stack.length === 2) {
            if (m.length === 0) {
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.storisende.INITIAL_INSTRUCTIONS", {context: "second"});
                return result;
            }
            const target = this.board.hexes.map(h => h.stack.length).reduce((prev, curr) => prev + curr, 0);
            const placed = m.split(",")
            // all placements must be on valid hexes
            for (const cell of placed) {
                const hex = this.board.getHexAtAlgebraic(cell);
                if (hex === undefined) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.storisende.BAD_PLACEMENT");
                    return result;
                }
                if (hex.stack.length > 0 && !hex.stack.includes(this.currplayer)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.storisende.BAD_PLACEMENT");
                    return result;
                }
            }
            const remaining = target - placed.length;
            if (placed.length > target) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.storisende.TOO_MANY");
                return result;
            } else if (placed.length === target) {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            } else {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.storisende.PARTIAL_PLACE_SECOND", {count: remaining});
                return result;
            }
        }
        // regular moves
        else {
            if (m.length === 0) {
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.storisende.INITIAL_INSTRUCTIONS", {context: "rest"});
                return result;
            }

            // passing is always valid
            if (m === "pass") {
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }

            const [left, to] = m.split("-");
            const [from, heightStr] = left.split(":");

            // validate from first
            // hex must exist
            const fhex = this.board.getHexAtAlgebraic(from);
            if (fhex === undefined || fhex.stack.length === 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: from});
                return result;
            }
            // must be yours
            if (!fhex.stack.includes(this.currplayer)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                return result;
            }
            // substack notation is correct (reject overcomplicated full-stack movement)
            let height = fhex.stack.length;
            if (left.includes(":")) {
                const h = parseInt(heightStr, 10);
                if (h >= fhex.stack.length) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.storisende.INVALID_SUBSTACK");
                    return result;
                }
                height = h;
            }

            // validate to if present
            if (to === undefined || to === "") {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation._general.NEED_DESTINATION");
                return result;
            } else {
                // hex must exist
                const thex = this.board.getHexAtAlgebraic(to);
                if (thex === undefined) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: to});
                    return result;
                }
                let isStraight = false;
                let distance: number|undefined;
                let intervening: string[]|undefined;
                for (const dir of g.allDirs) {
                    const ray = g.ray(from, dir);
                    const idx = ray.findIndex(c => c === to);
                    if (idx !== -1) {
                        isStraight = true;
                        distance = idx+1;
                        // so no source or destination, only the in between cells
                        intervening = ray.slice(0, idx);
                        break;
                    }
                }
                // is straightline
                if (!isStraight) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.storisende.STRAIGHT_ONLY");
                    return result;
                } else {
                    // distance is right
                    if (distance! !== height) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.storisende.BAD_DISTANCE");
                        return result;
                    }
                }
                // restrictions when moving from the ground
                if (fhex.tile !== "wall") {
                    // can't land on a wall
                    if (thex.tile === "wall") {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.storisende.WALL_CLIMB");
                        return result;
                    }
                    // can jump over wall tiles unless one of your pieces are there
                    let blocked = false;
                    for (const cell of intervening!) {
                        const hex = this.board.getHexAtAlgebraic(cell);
                        if (hex !== undefined && hex.tile === "wall" && !hex.stack.includes(this.currplayer)) {
                            blocked = true;
                            break;
                        }
                    }
                    if (blocked) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.storisende.WALL_JUMP");
                        return result;
                    }
                }

                // if we make it here, we're good!
                result.valid = true;
                result.complete = 1;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
        }
    }

    public move(m: string, {partial = false, trusted = false} = {}): StorisendeGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        // Normalize
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const g = this.board.graph;

        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
        }

        this.results = [];
        this.dots = [];

        // if partial and after the opening, show dots and get out
        if (partial && this.stack.length >= 3) {
            const [left,] = m.split("-");
            const [from,] = left.split(":");
            this.dots = this.moves().filter(mv => mv.startsWith(from)).map(mv => mv.split("-")[1]);
            return this;
        }

        // handle openings first
        if (this.stack.length < 3) {
            const cells = m.split(",");
            for (const cell of cells) {
                const hex = this.board.getHexAtAlgebraic(cell)!;
                this.board.updateHexStack(hex, [...hex.stack, this.currplayer]);
                this.results.push({type: "place", where: cell});
            }
        }
        // all other moves
        else {
            if (m === "pass") {
                this.results.push({type: "pass"});
            }
            else {
                const [left, to] = m.split("-");
                const [from, heightStr] = left.split(":");
                const fhex = this.board.getHexAtAlgebraic(from);
                const thex = this.board.getHexAtAlgebraic(to);
                if (fhex === undefined || thex === undefined) {
                    throw new Error(`Could not process the move "${m}" because at least one of the hexes doesn't exist.`);
                }
                // moving substack (no tile side effects)
                if (left.includes(":")) {
                    const height = parseInt(heightStr, 10);
                    if (isNaN(height)) {
                        throw new Error(`Could not interpret the substack height from "${m}."`);
                    }
                    this.board.updateHexStack(fhex, fhex.stack.slice(0, height * -1));
                    // new Array(height).map... doesn't work
                    const newstack = Array.from({length: height}, () => this.currplayer);
                    if (thex.stack.includes(this.currplayer)) {
                        this.board.updateHexStack(thex, [...thex.stack, ...newstack]);
                    } else {
                        this.board.updateHexStack(thex, newstack);
                    }
                    this.results.push({type: "move", from, to, count: height});
                    if (thex.stack.length > 0 && !thex.stack.includes(this.currplayer)) {
                        this.results.push({type: "capture", where: to, count: thex.stack.length});
                    }
                }
                // moving entire stack
                else {
                    this.board.updateHexStack(fhex, []);
                    if (thex.stack.includes(this.currplayer)) {
                        this.board.updateHexStack(thex, [...thex.stack, ...fhex.stack]);
                    } else {
                        this.board.updateHexStack(thex, [...fhex.stack]);
                    }
                    this.results.push({type: "move", from, to, count: fhex.stack.length});
                    if (thex.stack.length > 0 && !thex.stack.includes(this.currplayer)) {
                        this.results.push({type: "capture", where: to, count: thex.stack.length});
                    }
                    if (fhex.tile === "virgin") {
                        const cell = this.board.hex2algebraic(fhex);
                        const terr = this.board.territories;
                        const terrNeighbours = new Set<string>();
                        for (const n of g.neighbours(cell)) {
                            const found = terr.find(t => t.includes(n));
                            if (found !== undefined) {
                                terrNeighbours.add(x2uid(found));
                            }
                        }
                        if (terrNeighbours.size > 1) {
                            this.board.updateHexTile(fhex, "wall");
                            this.results.push({type: "convert", what: from, into: "wall"});
                        } else {
                            this.board.updateHexTile(fhex, "territory");
                            this.results.push({type: "convert", what: from, into: "territory"});
                        }
                    }
                    if (fhex.stack.length === 2 && fhex.tile === "virgin") {
                        this.board.updateHexStack(fhex, [this.currplayer]);
                        this.results.push({type: "place", where: from});
                    }
                }
            }
        }

        if (partial) { return this; }

        this.lastmove = m;
        if (this.currplayer === 1) {
            this.currplayer = 2;
        } else {
            this.currplayer = 1;
        }

        this.checkEOG();
        this.saveState();
        return this;
    }

    public getPlayerScore(player: playerid): number {
        const other = player === 1 ? 2 : 1;

        // build graph
        const nations = this.board.nations
                        .map(nation => nation.map(cell => this.board.getHexAtAlgebraic(cell)!)
                        .map(hex => hex.stack.length === 0 ? 0 : hex.stack.includes(1) ? 1 : 2));

        // tabulate
        let score = 0;
        for (const nation of nations) {
            if (nation.includes(player) && !nation.includes(other)) {
                score += nation.length;
            }
        }
        return score;
    }

    public getPlayersScores(): IScores[] {
        return [
            { name: i18next.t("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] },
        ]
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Scores**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const score = this.getPlayerScore(n as playerid);
            status += `Player ${n}: ${score}\n\n`;
        }

        return status;
    }

    public countPieces(player?: playerid): number {
        if (player === undefined) {
            player = this.currplayer;
        }
        let count = 0;
        for (const hex of this.board.hexes) {
            if (hex.stack.length > 0 && hex.stack.includes(player)) {
                count += hex.stack.length;
            }
        }
        return count;
    }

    public playerOnWall(player?: playerid): boolean {
        if (player === undefined) {
            player = this.currplayer;
        }
        for (const hex of this.board.hexes) {
            if (hex.stack.length > 0 && hex.stack.includes(player)) {
                if (hex.tile === "wall") {
                    return true;
                }
            }
        }
        return false;
    }

    public playerHasStack(player?: playerid): boolean {
        if (player === undefined) {
            player = this.currplayer;
        }
        for (const hex of this.board.hexes) {
            if (hex.stack.length > 1 && hex.stack.includes(player)) {
                return true;
            }
        }
        return false;
    }

    // Does the player have more than one piece in any given nation
    public playerIsSparse(player?: playerid): boolean {
        if (player === undefined) {
            player = this.currplayer;
        }
        const nations = this.board.nations;
        if (nations.length === 1) {
            return false;
        }
        const stacks = nations
                       .map(nation => nation.map(cell => this.board.getHexAtAlgebraic(cell)!)
                       .map(hex => hex.stack.length === 0 ? 0 : hex.stack.includes(1) ? 1 : 2));
        for (const stack of stacks) {
            const relevant = stack.filter(n => n === player);
            if (relevant.length > 1) {
                return false;
            }
        }
        return true;
    }

    // Edited to also reset with a capture
    public get pliesWithoutConversion(): number {
        const results = [...this.stack].reverse().map(s => s._results);
        let count = 0;
        for (const batch of results) {
            const found = batch.find(r => r.type === "convert" || r.type === "capture");
            if (found === undefined) {
                count++;
            } else {
                break;
            }
        }
        return count;
    }

    protected checkEOG(): StorisendeGame {
        // game can't end until after initial placement
        if (this.stack.length > 3) {
            const otherPlayer = this.currplayer === 1 ? 2 : 1;
            let passedOut = false;
            if ( (this.lastmove === "pass") && (this.stack[this.stack.length - 1].lastmove === "pass") ) {
                passedOut = true;
            }
            const numPieces = this.countPieces(this.currplayer);

            // If you don't have any pieces on the wall, and you have no double stacks, and there are no nations where you have more than a single piece, then you can never get more points than you already have
            const canCatchUp = this.playerOnWall() || this.playerHasStack() || !this.playerIsSparse()
            // console.log({canCatchUp, plies: this.pliesWithoutConversion});

            // if consecutive passes, or 100 plies without conversion, then normal score comparison
            if (passedOut || this.pliesWithoutConversion >= 100) {
                // console.log("passed out || plies")
                const myScore = this.getPlayerScore(this.currplayer);
                const otherScore = this.getPlayerScore(otherPlayer);
                this.gameover = true;
                if (myScore > otherScore) {
                    this.winner = [this.currplayer];
                } else if (otherScore > myScore) {
                    this.winner = [otherPlayer];
                } else {
                    this.winner = [1,2];
                }
            }
            // if current player has no pieces, they lose
            else if (numPieces === 0) {
                this.gameover = true;
                this.winner = [otherPlayer];
            }
            // if current player is losing and only has a single piece or can't catch up, they lose
            else if (numPieces === 1 || !canCatchUp) {
                // console.log("numPieces || !canCatchUp");
                const myScore = this.getPlayerScore(this.currplayer);
                const otherScore = this.getPlayerScore(otherPlayer);
                if (myScore < otherScore) {
                    this.gameover = true;
                    this.winner = [otherPlayer];
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

    public state(): IStorisendeState {
        return {
            game: StorisendeGame.gameinfo.uid,
            numplayers: 2,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    protected moveState(): IMoveState {
        return {
            _version: StorisendeGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: this.board.serialize(),
        };
    }

    public render(): APRenderRep {
        const g = this.board.graph;
        const width = this.board.width;
        const height = this.board.height;
        const originHex = this.board.getHexAtAxial(0, 0)!;
        const [, oRow] = this.board.hex2coords(originHex);

        const blocked: {row: number; col: number}[] = [];
        for (let row = 0; row < height; row++) {
            for (let col = 0; col < width; col++) {
                const hex = this.board.getHexAtAlgebraic(g.coords2algebraic(col, row));
                if (hex === undefined) {
                    blocked.push({row, col})
                }
            }
        }

        // virgin territory is unflooded
        // territories are green
        // walls are "filled" and then patterned
        const markers: MarkerFlood[] = [];
        const wallMarker1: MarkerFlood = {
            type: "flood",
            colour: {
                func: "flatten",
                fg: "_context_fill",
                bg: "_context_background",
                opacity: 0.5
            },
            // @ts-expect-error (because I will add them incrementally)
            points: [],
        };
        const wallMarker2: MarkerFlood = {
            type: "flood",
            pattern: "slant",
            // @ts-expect-error (because I will add them incrementally)
            points: []
        };
        const terrMarker: MarkerFlood = {
            type: "flood",
            colour: 3,
            // @ts-expect-error (because I will add them incrementally)
            points: [],
        };
        for (const hex of this.board.hexes) {
            const [col, row] = this.board.hex2coords(hex);
            if (hex.tile === "territory") {
                terrMarker.points.push({row, col});
            } else if (hex.tile === "wall") {
                wallMarker1.points.push({row, col});
                wallMarker2.points.push({row, col});
            }
        }
        if (terrMarker.points.length > 0) {
            markers.push(terrMarker);
        }
        if (wallMarker1.points.length > 0) {
            markers.push(wallMarker1, wallMarker2)
        }

        // Build piece string
        const pieces: string[][] = [];
        for (let row = 0; row < height; row++) {
            const node: string[] = [];
            for (let col = 0; col < width; col++) {
                const hex = this.board.getHexAtAlgebraic(g.coords2algebraic(col, row));
                if (hex === undefined || hex.stack.length === 0) {
                    node.push("-")
                } else {
                    node.push(hex.stack.map(p => p === 1 ? "A" : "B").join(""))
                }
            }
            pieces.push(node);
        }
        const pstr = pieces.map(row => row.join(",")).join("\n");

        // Build rep
        const rep: APRenderRep =  {
            options: ["reverse-letters"],
            renderer: "stacking-offset",
            board: {
                style: oRow % 2 === 0 ? "hex-even-p" : "hex-odd-p",
                width,
                height,
                strokeColour: {
                    func: "flatten",
                    fg: "_context_strokes",
                    bg: "_context_background",
                    opacity: 0.25,
                },
                strokeOpacity: 1,
                labelColour: {
                    func: "flatten",
                    fg: "_context_strokes",
                    bg: "_context_background",
                    opacity: 0.5,
                },
                blocked: blocked as [{row: number; col: number},...{row: number; col: number}[]],
                markers: markers.length > 0 ? markers : undefined,
            },
            legend: {
                A: {
                    name: "piece",
                    colour: 1
                },
                B: {
                    name: "piece",
                    colour: 2
                },
            },
            pieces: pstr
        };
        if ((rep.board as BoardBasic).blocked!.length === 0) {
            delete (rep.board as BoardBasic).blocked;
        }

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "place") {
                    const [x, y] = g.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                } else if (move.type === "capture") {
                    const [x, y] = g.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                } else if (move.type === "convert") {
                    const [x, y] = g.algebraic2coords(move.what);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                } else if (move.type === "move") {
                    const [fromX, fromY] = g.algebraic2coords(move.from);
                    const [toX, toY] = g.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                }
            }
        }

        if (this.dots.length > 0) {
            if (!("annotations" in rep)) {
                rep.annotations = [];
            }
            for (const cell of this.dots) {
                const [x, y] = g.algebraic2coords(cell);
                rep.annotations!.push({type: "dots", targets: [{row: y, col: x}]});
            }
        }

        return rep;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "move":
                node.push(i18next.t("apresults:MOVE.complete", {player, from: r.from, to: r.to, count: r.count}));
                resolved = true;
                break;
            case "capture":
                node.push(i18next.t("apresults:CAPTURE.multiple", {player, count: r.count}));
                resolved = true;
                break;
            case "convert":
                node.push(i18next.t("apresults:CONVERT.storisende", {player, where: r.what, context: r.into}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public getCustomRotation(): number | undefined {
        return 0;
    }

    // public getStartingPosition(): string {
    //     if (this.stack.length > 1) {
    //         const cells: string[][] = this.graph.listCells(true) as string[][];
    //         const contents = cells.map(row => row.map(cell => this.board.get(cell)!));
    //         return contents.map(row => row.join(",")).join("\n");
    //     }
    //     return "";
    // }

    public clone(): StorisendeGame {
        return new StorisendeGame(this.serialize());
    }
}
