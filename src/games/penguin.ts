import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, AreaPieces, Glyph, MarkerFlood, MarkerGlyph } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, SquareDirectedGraph, UserFacingError, Directions as Direction, allDirections, normDeg, smallestDegreeDiff } from "../common";
import i18next from "i18next";

export type playerid = 1|2;
export type Size = 1|2|3;
export type Facing = Direction | "U"
export type CellContents = [playerid, Size, Facing];
type ExecutionResults = {
    valid: boolean;
    endCell?: string;
};
interface ILegendObj {
    [key: string]: Glyph|[Glyph, ...Glyph[]];
}

const deg2dir = new Map<number, Direction>([
    [0, "N"],
    [45, "NE"],
    [90, "E"],
    [135, "SE"],
    [180, "S"],
    [225, "SW"],
    [270, "W"],
    [315, "NW"],
]);

const dir2deg = new Map<Direction, number>([
    ["N", 0],
    ["NE", 45],
    ["E", 90],
    ["SE", 135],
    ["S", 180],
    ["SW", 225],
    ["W", 270],
    ["NW", 315],
]);

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    ball?: string;
    lastmove?: string;
};

export interface IPenguinState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class PenguinGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Penguin Soccer",
        uid: "penguin",
        playercounts: [2],
        version: "20250120",
        dateAdded: "2023-06-18",
        // i18next.t("apgames:descriptions.penguin")
        description: "apgames:descriptions.penguin",
        urls: [
            "https://boardgamegeek.com/boardgame/30760/penguin-soccer",
            "https://boardgamegeek.com/thread/559441/penguin-soccer-faq",
        ],
        people: [
            {
                type: "designer",
                name: "Avri Klemer",
                urls: [
                    "https://linktr.ee/nycavri"
                ],
            },
        ],
        categories: ["goal>breakthrough", "mechanic>place", "mechanic>displace", "mechanic>move", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["perspective"],
    };

    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 8);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 8);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, CellContents>;
    public ball?: string;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private highlights: string[] = [];

    constructor(state?: IPenguinState | string) {
        super();
        if (state === undefined) {
            const board = new Map<string, CellContents>();
            const fresh: IMoveState = {
                _version: PenguinGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IPenguinState;
            }
            if (state.game !== PenguinGame.gameinfo.uid) {
                throw new Error(`The Penguin engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): PenguinGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = new Map([...state.board.entries()].map(([cell,pc]) => [cell, [...pc]]));
        this.lastmove = state.lastmove;
        this.ball = state.ball;
        return this;
    }

    public moves(): string[] {
        if (this.gameover) { return []; }
        const enterDirs: Direction[] = this.currplayer === 1 ? ["N", "NE", "E"] : ["W", "SW", "S"];
        const enterCell = this.currplayer === 1 ? "a1" : "h8";
        const g = new SquareDirectedGraph(8, 8);

        const moves: string[] = [];

        const onboard = [...this.board.entries()].filter(([,pc]) => pc[0] === this.currplayer);
        const offboard: Size[] = ([1,2,3] as Size[]).filter(s => onboard.find(([,pc]) => pc[1] === s) === undefined)

        // entering pieces
        // only possible if your home cell is empty
        if (!this.board.has(enterCell)) {
            for (const size of offboard) {
                for (const dir of enterDirs) {
                    const ray = g.ray(enterCell, dir, true);
                    const dist = 4 - size;
                    let isValid = true;
                    let isTackle = false;
                    for (let i = 0; i < dist; i++) {
                        if (this.board.has(ray[i]) && (this.board.get(ray[i])![0] === this.currplayer || this.ball !== ray[i])) {
                            isValid = false;
                            break;
                        } else if (this.board.has(ray[i]) && this.ball === ray[i] && this.board.get(ray[i])![0] !== this.currplayer) {
                            isTackle = true;
                            break;
                        }
                    }
                    if (isValid) {
                        const move = `${size}${dir}`;
                        moves.push(move + ".");
                        if (!isTackle) {
                            for (let i = 1; i <= dist; i++) {
                                const l = Array.from({length: i}, () => "L").join("");
                                const r = Array.from({length: i}, () => "R").join("");
                                moves.push([move, ...l].join(""));
                                moves.push([move, ...r].join(""));
                            }
                        }
                    }
                }
            }
        }

        // sliding and kicking
        for (const [cell, pc] of onboard) {
            // sliding only (can turn)
            if (this.ball !== cell) {
                const possDirs: Direction[] = [];
                if (pc[2] === "U") {
                    possDirs.push(...allDirections);
                } else {
                    possDirs.push(pc[2]);
                }
                for (const dir of possDirs) {
                    let ray = g.ray(cell, dir);
                    const dist = 4 - pc[1];
                    ray = ray.slice(0, dist);
                    let isValid = true;
                    for (const next of ray) {
                        if (this.ball === next || (this.ball === undefined && (next === "d4" || next === "d5" || next === "e4" || next === "e5"))) {
                            break;
                        }
                        else if (this.board.has(next) && this.ball !== next) {
                            isValid = false;
                            break;
                        }
                    }
                    if (isValid) {
                        const move = `${cell}${dir}`;
                        moves.push(move + ".");
                        for (let i = 1; i <= dist; i++) {
                            const l = Array.from({length: i}, () => "L").join("");
                            const r = Array.from({length: i}, () => "R").join("");
                            moves.push([move, ...l].join(""));
                            moves.push([move, ...r].join(""));
                        }
                    }
                }
                // can always choose to stand
                if (pc[2] !== "U") {
                    moves.push(`${cell}U`)
                }
            }
            // kicking (can't turn)
            else {
                for (const dir of allDirections) {
                    const ray = g.ray(cell, dir);
                    // can't kick off the board from the edge of the board
                    if (ray.length === 0) {
                        continue;
                    }
                    moves.push(`${cell}${dir}`);
                }
            }
        }

        return moves
            .filter(mv => {
                const cloned = this.clone();
                return cloned.executeMove(mv).valid === true;
            })
            .sort((a,b) => a.localeCompare(b));
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let newmove: string;
            const enterCell = this.currplayer === 1 ? "a1" : "h8";
            const g = new SquareDirectedGraph(8,8);

            // empty move means selecting a piece to slide or enter
            if (move === "") {
                if (row === -1 && col === -1 && piece !== undefined) {
                    const chars = piece.split("");
                    newmove = chars[2];
                } else {
                    const cell = PenguinGame.coords2algebraic(col, row);
                    newmove = cell;
                }
            }
            // otherwise, continuation
            else {
                // error condition
                if (row === -1 || col === -1) {
                    newmove = move;
                }
                // otherwise process
                else {
                    const parsed = this.parseMove(move);
                    // if no dir, then we're selecting a dir
                    if (parsed.dir === undefined) {
                        const [fx, fy] = g.algebraic2coords(parsed.cell || enterCell);
                        const bearing = RectGrid.bearing(fx, fy, col, row);
                        // same cell means standing up
                        if (bearing === undefined) {
                            newmove = move + "U";
                        }
                        // otherwise sliding
                        else {
                            newmove = move + bearing;
                            const cloned = this.clone();
                            const results = cloned.executeMove(newmove);
                            if (results.endCell === undefined) {
                                newmove = move;
                            } else {
                                const [,,facing] = cloned.board.get(results.endCell)!;
                                if (facing === "U") {
                                    newmove += ".";
                                }
                            }
                        }
                    }
                    // if no turns, then we're selecting a direction
                    else if (parsed.turnDir === undefined || parsed.turnNum === undefined) {
                        const cloned = this.clone();
                        const results = cloned.executeMove(move);
                        if (results.endCell === undefined) {
                            newmove = move;
                        } else {
                            const [,,facing] = cloned.board.get(results.endCell)!;
                            if (facing === "U") {
                                newmove = move + ".";
                            } else {
                                const [fx, fy] = g.algebraic2coords(results.endCell);
                                const bearing = RectGrid.bearing(fx, fy, col, row);
                                // error condition
                                if (bearing === undefined || bearing === facing) {
                                    newmove = move + ".";
                                }
                                // other cell
                                else {
                                    const degStart = dir2deg.get(facing)!
                                    const degEnd = dir2deg.get(bearing)!;
                                    const diff = smallestDegreeDiff(degEnd, degStart);
                                    const dir = diff < 0 ? "L" : "R";
                                    newmove = move;
                                    for (let i = 0; i < Math.abs(diff / 45); i++) {
                                        newmove += dir;
                                    }
                                }
                            }
                        }
                    }
                    // otherwise we're in an error state
                    else {
                        newmove = move;
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

        const parsed = this.parseMove(m);
        if (parsed.normalized === undefined) {
            throw new Error("Unable to parse move");
        }
        m = parsed.normalized;

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.penguin.INITIAL_INSTRUCTIONS")
            return result;
        }

        const allMoves = this.moves();
        // full move found
        if (allMoves.includes(m)) {
            // good and compete because of the added period to show no turns
            result.valid = true;
            result.complete = 1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;
        }
        // at least partial match found
        else if (allMoves.filter(mv => mv.startsWith(m)).length > 0) {
            // no direction provided
            if (parsed.dir === undefined) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.penguin.PARTIAL_DIRECTION", {context: this.ball !== undefined && parsed.cell !== undefined && this.ball === parsed.cell ? "kick" : "penguin"});
                return result;
            }

            // no turns provided
            if (parsed.turnDir === undefined || parsed.turnNum === undefined) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.penguin.PARTIAL_ORIENTATION");
                return result;
            }

            // catchall: this should never be called because missing turns are caught earlier
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
            return result;
        }
        // otherwise, full error state
        else {
            result.valid = false;
            result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
            return result;
        }
    }

    public parseMove(m: string): {cell?: string; size?: Size; dir?: Facing, turnDir?: "L"|"R", turnNum?: number, normalized?: string} {
        const result: {cell?: string, size?: Size, dir?: Facing, turnDir?: "L"|"R", turnNum?: number, normalized?: string} = {};

        let working = m.toUpperCase();
        working = working.replace(/\s+/g, "");
        if (/^[123]/.test(working)) {
            result.size = parseInt(working[0], 10) as Size;
            working = working.substring(1);
        } else {
            result.cell = working.substring(0, 2).toLowerCase();
            working = working.substring(2);
        }
        if (/[LR\.]$/.test(working)) {
            if (working.endsWith("L")) {
                const idx = working.indexOf("L");
                const str = working.substring(idx);
                result.turnDir = "L";
                result.turnNum = str.length;
                working = working.substring(0, idx);
            } else if (working.endsWith("R")) {
                const idx = working.indexOf("R");
                const str = working.substring(idx);
                result.turnDir = "R";
                result.turnNum = str.length;
                working = working.substring(0, idx);
            } else {
                const idx = working.indexOf(".");
                result.turnNum = 0;
                working = working.substring(0, idx);
            }
        }
        if (working.length > 0) {
            result.dir = working as Facing;
        }
        result.normalized = `${result.size || result.cell}${result.dir || ""}${result.turnDir !== undefined ? Array.from({length: result.turnNum!}, () => result.turnDir).join("") : result.turnNum === 0 ? "." : ""}`

        return result;
    }

    // limited validation
    // assumes that it's only being passed moves that have been mostly vetted
    private executeMove(m: string): ExecutionResults {
        const results = this.parseMove(m);

        // do nothing if the move isn't at least partially actionable
        if (results.cell === undefined && results.size === undefined) {
            return {valid: false};
        }

        const g = new SquareDirectedGraph(8, 8);
        // const enterDirs: Direction[] = this.currplayer === 1 ? ["N", "NE", "E"] : ["W", "SW", "S"];
        const enterCell = this.currplayer === 1 ? "a1" : "h8";
        // const goalCell = this.currplayer === 1 ? "h8" : "a1";

        // highlight cells where necessary
        if (results.dir === undefined) {
            if (results.size !== undefined) {
                this.highlights = g.neighbours(enterCell);
                return {valid: true};
            } else {
                const contents = this.board.get(results.cell!)
                if (contents === undefined) {
                    return {valid: false};
                }
                if (contents[2] === "U") {
                    this.highlights = g.neighbours(results.cell!);
                    return {valid: true};
                } else {
                    this.highlights = [results.cell!];
                    const ray = g.ray(results.cell!, contents[2]);
                    if (ray.length > 0) {
                        this.highlights.push(ray[0]);
                    }
                    return {valid: true};
                }
            }
        }

        // entering a piece
        let endCell: string;
        let canTurn: boolean;
        let kicked = false;
        if (results.size !== undefined) {
            if (results.dir === "U") {
                return {valid: false};
            }
            const dist = 4 - results.size;
            let ray = g.ray(enterCell, results.dir, true);
            ray = ray.slice(0, dist);
            const idx = ray.findIndex(c => this.board.has(c) || this.ball === c);
            // is tackle
            if (idx >= 0) {
                // if not a valid tackle, reject
                if (this.board.has(ray[idx]) && (this.ball !== ray[idx] || this.board.get(ray[idx])![0] === this.currplayer)) {
                    return {valid: false};
                }
                endCell = ray[idx];
                canTurn = false;
            // if you hit the edge of the board, then you can't turn
            } else if (ray.length < dist) {
                endCell = ray[ray.length - 1];
                canTurn = false;
            } else {
                endCell = ray[ray.length - 1];
                canTurn = true;
            }
        }
        // sliding or kicking
        else {
            if (!this.board.has(results.cell!)) {
                return {valid: false};
            }
            const [,size,] = this.board.get(results.cell!)!;
            // kick
            if (this.ball === results.cell) {
                if (results.dir === "U") {
                    return {valid: false};
                }
                kicked = true;
                canTurn = false;
                const dist = size;
                let ray = g.ray(results.cell!, results.dir);
                // can't kick off the edge of the board
                if (ray.length === 0) {
                    return {valid: false};
                }
                ray = ray.slice(0, dist);
                const idx = ray.findIndex(c => this.board.has(c));
                // pass
                if (idx >= 0) {
                    endCell = ray[idx];
                }
                // otherwise open ball
                else {
                    endCell = ray[ray.length - 1];
                }
            }
            // everything else
            else {
                // standing up
                if (results.dir === "U") {
                    endCell = results.cell!;
                    canTurn = false;
                }
                // sliding
                else {
                    const dist = 4 - size;
                    let ray = g.ray(results.cell!, results.dir);
                    ray = ray.slice(0, dist);
                    // can't slide off the edge of the board
                    if (ray.length === 0) {
                        return {valid: false};
                    }
                    const idx = ray.findIndex(c => this.board.has(c) || this.ball === c || (this.ball === undefined && (c === "d4" || c === "d5" || c === "e4" || c === "e5")));
                    // is tackle
                    if (idx >= 0) {
                        // if not a valid tackle, reject
                        if (this.board.has(ray[idx]) && (this.ball !== ray[idx] || this.board.get(ray[idx])![0] === this.currplayer)) {
                            return {valid: false};
                        }
                        endCell = ray[idx];
                        canTurn = false;
                    // if you hit the edge of the board, then you can't turn
                    } else if (ray.length < dist) {
                        endCell = ray[ray.length - 1];
                        canTurn = false;
                    } else {
                        endCell = ray[ray.length - 1];
                        canTurn = true;
                    }
                }
            }
        }

        // if turns are provided but not allowed, reject
        // (last chance to do this before actually mutating anything)
        if (!canTurn && results.turnDir !== undefined) {
            return {valid: false};
        }

        // execute move
        // tackle
        if (this.board.has(endCell) && endCell !== results.cell && this.ball !== results.cell) {
            if (results.dir === "U") {
                return {valid: false};
            }
            let tContents = this.board.get(endCell)!;
            const from = results.cell || enterCell;
            if (results.size !== undefined) {
                this.board.set(endCell, [this.currplayer, results.size, "U"]);
            } else {
                const contents = this.board.get(results.cell!)!;
                this.board.set(endCell, [this.currplayer, contents[1], "U"]);
                this.board.delete(results.cell!);
            }
            this.results.push({type: "move", from, to: endCell});
            this.results.push({type: "claim", where: endCell});
            const afterRay = g.ray(endCell, results.dir);
            for (let i = 0; i < afterRay.length; i++) {
                // empty space to push things into
                if (!this.board.has(afterRay[i])) {
                    this.board.set(afterRay[i], [tContents[0], tContents[1], results.dir]);
                    this.results.push({type: "eject", from: i === 0 ? endCell : afterRay[i-1], to: afterRay[i]})
                    break;
                }
                // edge of the board
                else if (i === afterRay.length - 1) {
                    this.board.set(afterRay[i], [tContents[0], tContents[1], results.dir]);
                    this.results.push({type: "eject", from: afterRay[i], to: "off"})
                    break;
                }
                // otherwise keep pushing
                else {
                    const pushed = this.board.get(afterRay[i])!;
                    this.board.set(afterRay[i], [tContents[0], tContents[1], results.dir]);
                    this.results.push({type: "eject", from: i === 0 ? endCell : afterRay[i-1], to: afterRay[i]});
                    tContents = [...pushed];
                }
            }
        }
        // picking up a free ball
        else if (this.ball === endCell || (this.ball === undefined && (endCell === "d4" || endCell === "d5" || endCell === "e4" || endCell === "e5"))) {
            const from = results.cell || enterCell;
            if (results.size !== undefined) {
                this.board.set(endCell, [this.currplayer, results.size, "U"]);
            } else {
                const contents = this.board.get(results.cell!)!;
                this.board.set(endCell, [this.currplayer, contents[1], "U"]);
                this.board.delete(results.cell!);
            }
            this.results.push({type: "move", from, to: endCell});
            this.results.push({type: "claim", where: endCell});
            if (this.ball === undefined) {
                this.ball = endCell;
            }
        }
        // plain sliding/kicking
        else {
            if (kicked) {
                this.ball = endCell;
                this.results.push({type: "eject", from: results.cell!, to: endCell, what: "ball"});
                const [owner, size, ] = this.board.get(results.cell!)!;
                this.board.set(results.cell!, [owner, size, results.dir]);
                if (this.board.has(endCell)) {
                    const tContents = this.board.get(endCell)!;
                    this.board.set(endCell, [tContents[0], tContents[1], "U"])
                    this.results.push({type: "claim", where: endCell});
                }
            } else {
                const from = results.cell || enterCell;
                if (results.size !== undefined) {
                    this.board.set(endCell, [this.currplayer, results.size, results.dir]);
                } else {
                    const contents = this.board.get(results.cell!)!;
                    this.board.set(endCell, [this.currplayer, contents[1], !canTurn ? "U" : results.dir]);
                    if (from !== endCell) {
                        this.board.delete(results.cell!);
                    }
                }
                this.results.push({type: "move", from, to: endCell});
            }
        }

        // check if a penguin has ended up in their opponent's home square
        if (
            (this.board.has("a1") && this.board.get("a1")![0] === 2) ||
            (this.board.has("h8") && this.board.get("h8")![0] === 1)
        ) {
            return {valid: false};
        }

        // final turns
        if (canTurn) {
            // if no turns are given, highlight
            if (results.turnDir === undefined || results.turnNum === undefined) {
                const [,sz,facing] = this.board.get(endCell)!;
                if (facing === "U") {
                    return {valid: false};
                }
                const initDeg = dir2deg.get(facing)!;
                const maxTurns = 4 - sz;
                const valid: number[] = [0];
                for (let i = 1; i <= maxTurns; i++) {
                    valid.push(45 * i)
                    valid.push(-45 * i);
                }
                const cells = valid.map(delta => {
                    const newdeg = normDeg(initDeg + delta);
                    const newdir = deg2dir.get(newdeg)!;
                    const cell = g.move(endCell, newdir);
                    if (cell !== undefined) {
                        return cell;
                    }
                    return null;
                }).filter(c => c !== null);
                this.highlights = cells as string[];
                return {valid: true, endCell};
            }
            if (results.dir === "U") {
                return {valid: false};
            }
            const degCurr = dir2deg.get(results.dir)!
            const inc = results.turnDir === "L" ? -45 : 45;
            const degNew = normDeg(degCurr + (inc * results.turnNum));
            const dirNew = deg2dir.get(degNew)!;
            const [owner, size,] = this.board.get(endCell)!;
            this.board.set(endCell, [owner, size, dirNew]);
            this.results.push({type: "orient", where: endCell, facing: dirNew});
        }

        return {valid: true, endCell};
    }

    public move(m: string, {trusted = false, partial = false} = {}): PenguinGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        const parsed = this.parseMove(m);
        if (parsed.normalized === undefined) {
            throw new Error("Unable to parse move");
        }
        if (! trusted) {
            const result = this.validateMove(parsed.normalized);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
            if (!partial && !this.moves().includes(parsed.normalized)) {
                throw new UserFacingError("VALIDATION_FAILSAFE", i18next.t("apgames:validation._general.FAILSAFE", {move: parsed.normalized}))
            }
        }

        this.results = [];
        this.highlights = [];
        this.executeMove(m);
        // const res = this.executeMove(m);
        // console.log(JSON.stringify(res));
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

    protected checkEOG(): PenguinGame {
        if (this.ball === "a1" || this.ball === "h8") {
            this.gameover = true;
            if (this.ball === "a1") {
                this.winner = [2];
            } else {
                this.winner = [1];
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

    public state(): IPenguinState {
        return {
            game: PenguinGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: PenguinGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map([...this.board.entries()].map(([cell,pc]) => [cell, [...pc]])),
            ball: this.ball,
        };
    }

    private inHand(player?: playerid): Size[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        const mine = [...this.board.values()].filter(([p,,]) => p === player).map(([,size,]) => size);
        return ([1,2,3] as Size[]).filter(s => !mine.includes(s));
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < 8; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < 8; col++) {
                const cell = PenguinGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const [owner, size, facing] = this.board.get(cell)!;
                    if (this.ball === cell) {
                        pieces.push(`p${owner === 1 ? "A" : "B"}${size}${facing}x`)
                    } else {
                        pieces.push(`p${owner === 1 ? "A" : "B"}${size}${facing}`)
                    }
                } else if (this.ball === cell) {
                    pieces.push("BALL");
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join(",");
        }

        const myLegend: ILegendObj = {
            "BALL": {
                name: "pyramid-up-small",
                colour: "_context_fill",
            }
        };
        const rotations: Map<string, number> = new Map([
            ["N", 0],
            ["NE", 45],
            ["E", 90],
            ["SE", 135],
            ["S", 180],
            ["SW", -135],
            ["W", -90],
            ["NW", -45],
        ]);
        const playerNames = ["A", "B"];
        const sizeNames = ["small", "medium", "large"]
        for (const player of [1, 2]) {
            for (const size of [1, 2, 3]) {
                for (const dir of rotations.entries()) {
                    // eslint-disable-next-line no-shadow,@typescript-eslint/no-shadow
                    const node: Glyph = {
                        name: "pyramid-flat-" + sizeNames[size - 1],
                        colour: player,
                        rotate: dir[1],
                    };
                    myLegend["p" + playerNames[player - 1] + size.toString() + dir[0]] = node;
                }
                const node: Glyph = {
                    name: "pyramid-up-" + sizeNames[size - 1],
                    colour: player,
                };
                myLegend["p" + playerNames[player - 1] + size.toString() + "U"] = node;
                myLegend["p" + playerNames[player - 1] + size.toString() + "Ux"] = [
                    node,
                    {
                        name: "pyramid-up-small",
                        colour: "_context_fill",
                        scale: size === 1 ? 0.5 : 1,
                    }
                ];
            }
        }

        const areas: AreaPieces[] = [];
        for (const p of [1,2] as playerid[]) {
            const inhand = this.inHand(p);
            if (inhand.length > 0) {
                areas.push({
                    type: "pieces",
                    label: `Player ${p}'s stash`,
                    pieces: inhand.map(size => `p${p === 1 ? "A" : "B"}${size}U`) as [string, ...string[]],
                });
            }
        }

        const markers: (MarkerFlood|MarkerGlyph)[] = [
            {
                type: "flood",
                colour: 1,
                points: [{row: 7, col: 0}],
            },
            {
                type: "flood",
                colour: 2,
                points: [{row: 0, col: 7}],
            }
        ];
        if (this.ball === undefined) {
            myLegend.ghost = {
                name: "pyramid-up-small",
                colour: {
                    func: "flatten",
                    fg: "_context_fill",
                    bg: "_context_background",
                    opacity: 0.5,
                }
            };
            markers.push({
                type: "glyph",
                glyph: "ghost",
                points: [
                    {row: 3, col: 3},
                    {row: 3, col: 4},
                    {row: 4, col: 3},
                    {row: 4, col: 4},
                ],
            });
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-checkered",
                width: 8,
                height: 8,
                rotate: -45,
                markers,
            },
            legend: myLegend,
            pieces: pstr,
            areas: areas.length > 0 ? areas : undefined,
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move" || move.type === "eject") {
                    if (move.from === move.to) {
                        const [x, y] = PenguinGame.algebraic2coords(move.from);
                        rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                    } else {
                        const [fromX, fromY] = PenguinGame.algebraic2coords(move.from);
                        const [toX, toY] = PenguinGame.algebraic2coords(move.to);
                        rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                    }
                } else if (move.type === "claim") {
                    const [x, y] = PenguinGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
        }

        // highlight cells
        if (this.highlights.length > 0) {
            if (!("annotations" in rep)) {
                rep.annotations = [];
            }
            for (const cell of this.highlights) {
                const [x, y] = PenguinGame.algebraic2coords(cell);
                rep.annotations!.push({type: "enter", targets: [{row: y, col: x}]});
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
            case "claim":
                node.push(i18next.t("apresults:CLAIM.penguin", {player, where: r.where}));
                resolved = true;
                break;
            case "move":
                node.push(i18next.t("apresults:MOVE.nowhat", {player, from: r.from, to: r.to}));
                resolved = true;
                break;
            case "eject":
                node.push(i18next.t("apresults:EJECT.penguin", {context: r.what !== undefined ? "ball" : "penguin", player, from: r.from, to: r.to}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): PenguinGame {
        return new PenguinGame(this.serialize());
    }
}
