import { GameBase, IAPGameState, IClickResult, IIndividualState, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, UserFacingError, Direction, allDirections } from "../common";
import { Permutation } from "js-combinatorics";
import i18next from "i18next";

export type playerid = 1|2;
export type cellcontents = [playerid, number];

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, cellcontents>;
    lastmove?: string;
};

export interface IMurusState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class MurusGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Murus Gallicus",
        uid: "murus",
        playercounts: [2],
        version: "20231024",
        dateAdded: "2023-10-24",
        // i18next.t("apgames:descriptions.murus")
        description: "apgames:descriptions.murus",
        // i18next.t("apgames:notes.murus")
        notes: "apgames:notes.murus",
        urls: [
            "https://sites.google.com/site/theowlsnest02/home/murus-gallicus",
            "https://boardgamegeek.com/boardgame/55131/murus-gallicus",
        ],
        people: [
            {
                type: "designer",
                name: "Phil Leduc",
                urls: ["https://sites.google.com/site/theowlsnest02/home"]
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        variants: [
            {
                uid: "escape"
            },
            {
                uid: "static"
            },
            {
                uid: "basic"
            }
        ],
        categories: ["goal>breakthrough", "goal>immobilize", "mechanic>capture",  "mechanic>differentiate", "mechanic>move", "mechanic>stack", "board>shape>rect", "board>connect>rect", "components>simple>1per"],
        flags: ["pie", "perspective"]
    };

    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 7);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 7);
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, cellcontents>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IMurusState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            const board = new Map<string, cellcontents>([
                ["a1", [1,2]], ["b1", [1,2]], ["c1", [1,2]], ["d1", [1,2]],
                ["e1", [1,2]], ["f1", [1,2]], ["g1", [1,2]], ["h1", [1,2]],
                ["a7", [2,2]], ["b7", [2,2]], ["c7", [2,2]], ["d7", [2,2]],
                ["e7", [2,2]], ["f7", [2,2]], ["g7", [2,2]], ["h7", [2,2]],
            ]);
            if ( (variants !== undefined) && (variants.length > 0) ) {
                this.variants = [...variants];
            }
            const fresh: IMoveState = {
                _version: MurusGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IMurusState;
            }
            if (state.game !== MurusGame.gameinfo.uid) {
                throw new Error(`The Murusinondas engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): MurusGame {
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

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }
        let maxstack = 3;
        if (this.variants.includes("basic")) {
            maxstack = 2;
        }
        const moves: string[] = [];

        const pieces = [...this.board.entries()].filter(e => e[1][0] === player).map(e => [e[0], e[1][1]] as [string,number]);

        // check for redist move
        if ( (! this.variants.includes("static")) && (this.stack.length < 3) ) {
            let row = 5;
            if (player === 2) {
                row = 1;
            }
            const cells: string[] = [];
            for (let col = 0; col < 8; col++) {
                cells.push(MurusGame.coords2algebraic(col, row));
            }
            const pairs: Permutation<string> = new Permutation(cells, 2);
            for (const [cell,] of pieces) {
                for (const pair of pairs) {
                    moves.push(`${cell}-${pair.join(",")}`);
                }
            }
        }
        // Otherwise it's a standard move
        else {
            const grid = new RectGrid(8, 7);
            for (const [cell, height] of pieces) {
                const [x, y] = MurusGame.algebraic2coords(cell);
                // towers first
                if (height === 2) {
                    for (const dir of allDirections) {
                        const ray = grid.ray(x, y, dir).map(n => MurusGame.coords2algebraic(...n));
                        if (ray.length > 0) {
                            const adj = this.board.get(ray[0]);
                            // if adjacent cell is enemy wall, simple sacrifice allowed
                            if ( (adj !== undefined) && (adj[0] !== player) && (adj[1] === 1) ) {
                                moves.push(`${cell}x${ray[0]}`);
                            }
                            // if adjacent cell is enemy catapult, simple and compound sacrifice allowed
                            else if ( (adj !== undefined) && (adj[0] !== player) && (adj[1] === 3) ) {
                                moves.push(`${cell}x${ray[0]}`);
                                moves.push(`${cell}*${ray[0]}`);
                            }
                            // If there are at least two cells in the ray, check for mvmt
                            else if (ray.length >= 2) {
                                const far = this.board.get(ray[1]);
                                // can move if each destination cell is empty or contains a friendly wall (or tower, in AMG)
                                const canAdj = ( (adj === undefined) || ( (adj[0] === player) && (adj[1] < maxstack) ) );
                                const canFar = ( (far === undefined) || ( (far[0] === player) && (far[1] < maxstack) ) );
                                if (canAdj && canFar) {
                                    moves.push(`${cell}-${ray[1]}`);
                                }
                            }
                        }
                    }
                }
                // catapults
                else if (height === 3) {
                    let validDirs: Direction[] = ["W", "NW", "N", "NE", "E"];
                    if (this.currplayer === 2) {
                        validDirs = ["W", "SW", "S", "SE", "E"];
                    }
                    for (const dir of validDirs) {
                        const ray = grid.ray(x, y, dir).map(n => MurusGame.coords2algebraic(...n));
                        let nearCell: string|undefined;
                        let farCell: string|undefined;
                        if (ray.length >= 2) {
                            nearCell = ray[1];
                        }
                        if (ray.length >= 3) {
                            farCell = ray[2];
                        }
                        for (const next of [nearCell, farCell]) {
                            if (next !== undefined) {
                                const contents = this.board.get(next);
                                if (contents === undefined) {
                                    moves.push(`${cell}-${next}`);
                                } else if (contents[0] !== player) {
                                    moves.push(`${cell}x${next}`);
                                }
                            }
                        }
                    }
                }
            }
        }

        moves.sort((a, b) => a.localeCompare(b));
        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            const cell = MurusGame.coords2algebraic(col, row);
            const contents = this.board.get(cell);
            let newmove = "";
            // starting fresh
            if (move === "") {
                newmove = cell;
            } else {
                const [prev,rest] = move.split(/[-x\*]/);
                // if at any time you reclick the first cell, clear everything
                if (cell === prev) {
                    newmove = "";
                }
                // if only first part of move
                else if ( (rest === undefined) || (rest === "") ) {
                    if ( (contents === undefined) || (contents[0] === this.currplayer) ) {
                        newmove = `${prev}-${cell}`;
                    } else {
                        newmove = `${prev}x${cell}`;
                    }
                }
                // full move present
                else {
                    // If redistribution is allowed and this is a movement
                    if ( (! this.variants.includes("static")) && (this.stack.length <= 2) && (move.includes("-")) ) {
                        // at least `one` is guaranteed to be present
                        const [one, two] = rest.split(",");
                        // if clicked cell has already been selected, deselect it
                        if (cell === one) {
                            newmove = `${prev}${two !== undefined ? `-${two}` : ""}`;
                        } else if (cell === two) {
                            newmove = `${prev}-${one}`;
                        } else {
                            newmove = `${prev}-${one},${cell}`;
                        }
                    } else {
                        // if empty or friendly, new move command
                        if ( (contents === undefined) || (contents[0] === this.currplayer) ) {
                            newmove = `${prev}-${cell}`;
                        }
                        // otherwise it's a capture
                        else {
                            // Clicking the same target twice causes double capture
                            if (cell === rest) {
                                newmove = `${prev}*${cell}`;
                            }
                            // otherwise just change the capture target
                            else {
                                newmove = `${prev}x${cell}`;
                            }
                        }
                    }
                }
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
            if ( (this.variants.includes("static")) || (this.stack.length >= 3) ) {
                result.message = i18next.t("apgames:validation.murus.INITIAL_INSTRUCTIONS");
            } else {
                result.message = i18next.t("apgames:validation.murus.INITIAL_INSTRUCTIONS", {context: "redist"});
            }
            return result;
        }

        const grid = new RectGrid(8, 7);
        let maxStack = 3;
        if (this.variants.includes("basic")) {
            maxStack = 2;
        }

        // complete move
        if ( (m.includes("-")) || (m.includes("x")) || (m.includes("*")) ) {
            const [from, rest] = m.split(/[-x\*]/);
            const [to, other] = rest.split(",");

            // cells are valid
            for (const cell of [from, to, other]) {
                // this will skip `other` when it's not present (most of the time)
                if (cell !== undefined) {
                    try {
                        MurusGame.algebraic2coords(cell);
                    } catch {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                        return result;
                    }
                }
            }
            const [xFrom, yFrom] = MurusGame.algebraic2coords(from);
            const [xTo, yTo] = MurusGame.algebraic2coords(to);
            let yOther: number|undefined;
            if (other !== undefined) {
                [, yOther] = MurusGame.algebraic2coords(other);
            }

            // if redist is called for
            if ( (! this.variants.includes("static")) && (this.stack.length <= 2) ) {
                let redistRow = 1;
                if (this.currplayer === 1) {
                    redistRow = 5;
                }
                // to and other are on the correct row
                if (yTo !== redistRow) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.murus.REDIST_ROW");
                    return result;
                }
                // if `other` is defined
                if (other !== undefined) {
                    // to and other are different
                    if (to === other) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.murus.DIFF_REDIST");
                        return result;
                    }
                    // to and other are on the correct row
                    if (yOther !== redistRow) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.murus.REDIST_ROW");
                        return result;
                    }
                    // complete
                    result.valid = true;
                    result.complete = 1;
                    result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                    return result;
                }
                // incomplete
                else {
                    result.valid = true;
                    result.complete = -1;
                    result.canrender = true;
                    result.message = i18next.t("apgames:validation.murus.PARTIAL_REDIST");
                    return result;
                }
            }
            // else basic move/capture
            else {
                const fromContents = this.board.get(from);
                const toContents = this.board.get(to);
                const dist = RectGrid.distance(xFrom, yFrom, xTo, yTo);
                let validDirs: Direction[] = ["W", "NW", "N", "NE", "E"];
                if (this.currplayer === 2) {
                    validDirs = ["W", "SW", "S", "SE", "E"];
                }

                // both cells are different
                if (from === to) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.SAME_FROM_TO");
                    return result;
                }
                // from is occupied
                if (fromContents === undefined) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: from});
                    return result;
                }
                // from is yours
                if (fromContents[0] !== this.currplayer) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                    return result;
                }
                // from has at least two pieces in it
                if (fromContents[1] < 2) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.murus.WALLS_IMMOBILE");
                    return result;
                }
                // correct operator was used
                if ( (m.includes("-")) && (toContents !== undefined) && (toContents[0] !== this.currplayer) ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.MOVE4CAPTURE", {where: to});
                    return result;
                }
                if ( (m.includes("x")) && ( (toContents === undefined) || (toContents[0] === this.currplayer) ) ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.CAPTURE4MOVE", {where: to});
                    return result;
                }
                // cells are directly orthogonal or diagonal
                if ( (! RectGrid.isOrth(xFrom, yFrom, xTo, yTo)) && (! RectGrid.isDiag(xFrom, yFrom, xTo, yTo)) ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.murus.STRAIGHTLINE");
                    return result;
                }

                // (defined because of previous check)
                const dir = RectGrid.bearing(xFrom, yFrom, xTo, yTo)!;
                const ray = grid.ray(xFrom, yFrom, dir).map(n => MurusGame.coords2algebraic(...n));
                // for movement
                if (m.includes("-")) {
                    // catapults are special
                    if (fromContents[1] === 3) {
                        // target space must be empty
                        if (toContents !== undefined) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.murus.BAD_CATA_MOVE");
                            return result;
                        }
                        // target must be 2 or 3 away
                        if ( (dist !== 2) && (dist !== 3) ) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.murus.BAD_CATA_DIST");
                            return result;
                        }
                        // target must be in a valid direction
                        if (! validDirs.includes(dir)) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.murus.BAD_CATA_DIR");
                            return result;
                        }
                    }
                    // towers
                    else {
                        // ray must be at least two long
                        if (ray.length < 2) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.murus.NOROOM");
                            return result;
                        }
                        const first = this.board.get(ray[0]);
                        const second = this.board.get(ray[1]);
                        // `to` must be the second element
                        if (to !== ray[1]) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.murus.TOOFAR");
                            return result;
                        }
                        // both first and second element must be eligible
                        const canFirst = ( (first === undefined) || ( (first[0] === this.currplayer) && (first[1] < maxStack) ) );
                        const canSecond = ( (second === undefined) || ( (second[0] === this.currplayer) && (second[1] < maxStack) ) );
                        if ( (! canFirst) || (! canSecond) ) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.murus.INELIGIBLE");
                            return result;
                        }
                    }
                }
                // for captures
                else {
                    // if not adjacent
                    if (dist > 1) {
                        // `from` must be a catapult
                        if (fromContents[1] !== 3) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.murus.BAD_TOWER_CAP");
                            return result;
                        }
                        // target must be 2 or 3 away
                        if ( (dist !== 2) && (dist !== 3) ) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.murus.BAD_CATA_DIST");
                            return result;
                        }
                        // target must be in a valid direction
                        if (! validDirs.includes(dir)) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.murus.BAD_CATA_DIR");
                            return result;
                        }
                    }
                    else {
                        // if single cap, target must be a wall or a catapult
                        if (m.includes("x")) {
                            // `from` must be a tower, `to` must be a wall or catapult
                            if ( (fromContents[1] !== 2) || (toContents![1] === 2) ) {
                                result.valid = false;
                                result.message = i18next.t("apgames:validation.murus.BAD_CAP");
                                return result;
                            }
                        }
                        // if double cap
                        else if (m.includes("*")) {
                            // `from` must be a tower, `to` must be a catapult
                            if ( (fromContents[1] !== 2) || (toContents![1] !== 3) ) {
                                result.valid = false;
                                result.message = i18next.t("apgames:validation.murus.BAD_DBL_CAP");
                                return result;
                            }
                        }
                    }
                }

                if (m.includes("x")) {
                    const newmove = m.replace("x", "*");
                    const allMoves = this.moves();
                    if (allMoves.includes(newmove)) {
                        result.valid = true;
                        result.complete = 0;
                        result.canrender = true;
                        result.message = i18next.t("apgames:validation.murus.SACRIFICE_POSSIBLE");
                        return result;
                    } else {
                        result.valid = true;
                        result.complete = 1;
                        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                        return result;
                    }
                } else {
                    result.valid = true;
                    result.complete = 1;
                    result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                    return result;
                }
            }
        }
        // otherwise, partials
        else {
            // valid cell
            try {
                MurusGame.algebraic2coords(m);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: m});
                return result;
            }
            const contents = this.board.get(m);
            // space is occupied
            if (contents === undefined) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: m});
                return result;
            }
            // stone is yours
            if (contents[0] !== this.currplayer) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                return result;
            }
            // is not a wall
            if (contents[1] < 2) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.murus.WALLS_IMMOBILE");
                return result;
            }

            // if redist is called for
            if ( (! this.variants.includes("static")) && (this.stack.length <= 2) ) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.murus.PARTIAL_REDIST");
                return result;
            } else {
                result.valid = true;
                result.complete = -1;
                result.message = i18next.t("apgames:validation.murus.PARTIAL");
                return result;
            }
        }
    }

    public move(m: string, {partial = false, trusted = false} = {}): MurusGame {
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
            }
        }

        this.results = [];

        const grid = new RectGrid(8, 7);
        const [from, rest] = m.split(/[-x\*]/);
        // If it's just a single cell, nothing to do
        if (rest !== undefined) {
            const [to, other] = rest.split(",");
            const [xFrom, yFrom] = MurusGame.algebraic2coords(from);
            const [xTo, yTo] = MurusGame.algebraic2coords(to);
            // let xOther: number|undefined; let yOther: number|undefined;
            // if (other !== undefined) {
            //     [xOther, yOther] = MurusGame.algebraic2coords(other);
            // }

            // redistribution first (this is the only possible partial)
            if ( (! this.variants.includes("static")) && (this.stack.length <= 2) ) {
                // remove `from`
                this.board.delete(from);
                this.results.push({type: "take", from});
                // put a single piece in `to` and `other` (if present)
                this.board.set(to, [this.currplayer, 1]);
                this.results.push({type: "place", where: to});
                if (other !== undefined) {
                    this.board.set(other, [this.currplayer, 1]);
                    this.results.push({type: "place", where: other});
                }
            }
            // all other moves
            else {
                const fromContents = this.board.get(from)!;
                const toContents = this.board.get(to);
                const dir = RectGrid.bearing(xFrom, yFrom, xTo, yTo)!;
                const ray = grid.ray(xFrom, yFrom, dir).map(n => MurusGame.coords2algebraic(...n));
                // movement first
                if (m.includes("-")) {
                    // towers
                    if ( (fromContents[1] === 2) && (ray.length >= 2) ) {
                        const [near, far] = ray;
                        this.board.delete(from);
                        for (const next of [near, far]) {
                            if (! this.board.has(next)) {
                                this.board.set(next, [this.currplayer, 1]);
                            } else {
                                const curr = this.board.get(next)![1];
                                this.board.set(next, [this.currplayer, curr + 1]);
                            }
                        }
                        this.results.push({type: "move", from, to});
                    }
                    // catapults
                    else if (fromContents[1] === 3) {
                        this.board.set(from, [this.currplayer, 2]);
                        this.board.set(to, [this.currplayer, 1]);
                        this.results.push({type: "fire", from, to});
                        this.results.push({type: "place", where: to});
                    }
                }
                // normal capture
                else if (m.includes("x")) {
                    const curr = toContents![1];
                    // towers
                    if (fromContents[1] === 2) {
                        this.board.set(from, [this.currplayer, 1]);
                        if (curr === 1) {
                            this.board.delete(to);
                        } else {
                            this.board.set(to, [toContents![0], curr - 1]);
                        }
                        this.results.push({type: "move", from, to});
                        this.results.push({type: "capture", where: to});
                    }
                    // catapults
                    else if (fromContents[1] === 3) {
                        this.board.set(from, [this.currplayer, 2]);
                        if (curr === 1) {
                            this.board.delete(to);
                        } else {
                            this.board.set(to, [toContents![0], curr - 1]);
                        }
                        this.results.push({type: "fire", from, to});
                        this.results.push({type: "capture", where: to});
                    }
                }
                // double capture
                else if (m.includes("*")) {
                    // already certain that `from` is a tower and `to` is a cata
                    this.board.delete(from);
                    this.board.set(to, [toContents![0], 1]);
                    this.results.push({type: "move", from, to});
                    this.results.push({type: "capture", where: to, count: 2});
                }
            }
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

    /**
     * In the default (advanced) game, you win if you have a piece on your opponent's home row at the START of your turn.
     * In the basic game, you win as soon as you reach the home row.
     * In the escape game, you win if your opponent has no moves on their turn.
     *
     * Best to check for no moves first, since that condition applies regardless of game variant.
     */
    protected checkEOG(): MurusGame {
        const targets = ["7", "1"];
        let prevPlayer = 1 as playerid;
        if (this.currplayer === 1) {
            prevPlayer = 2 as playerid;
        }
        const mytarget = targets[this.currplayer - 1];
        const theirtarget = targets[prevPlayer - 1];
        const mypieces = [...this.board.entries()].filter(e => (e[0].endsWith(mytarget)) && (e[1][0] === this.currplayer));
        const theirpieces = [...this.board.entries()].filter(e => (e[0].endsWith(theirtarget)) && (e[1][0] === prevPlayer));

        // If not in `escape` variant, then check home rows
        if (! this.variants.includes("escape")) {
            // in basic, end immediately if stone on home row
            if (this.variants.includes("basic")) {
                if (theirpieces.length > 0) {
                    this.gameover = true;
                    this.winner = [prevPlayer];
                }
            }
            // otherwise check for stone at start of turn
            else {
                if (mypieces.length > 0) {
                    this.gameover = true;
                    this.winner = [this.currplayer];
                }
            }
        }
        if (! this.gameover) {
            // Current player has no legal moves
            if (this.moves().length === 0) {
                this.gameover = true;
                this.winner = [prevPlayer];
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

    public state(): IMurusState {
        return {
            game: MurusGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: MurusGame.gameinfo.version,
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
        for (let row = 0; row < 7; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < 8; col++) {
                const cell = MurusGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    let str = "";
                    for (let i = 0; i < contents[1]; i++) {
                        if (contents[0] === 1) {
                            str += "A";
                        } else {
                            str += "B";
                        }
                    }
                    pieces.push(str);
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join(",");
        }
        pstr = pstr.replace(/-{8}/g, "_");

        // Build rep
        const rep: APRenderRep =  {
            renderer: "stacking-offset",
            board: {
                style: "squares-checkered",
                width: 8,
                height: 7,
                markers: [
                    {
                        type: "shading",
                        colour: 2,
                        points: [
                            {row: 0, col: 0},
                            {row: 0, col: 8},
                            {row: 1, col: 8},
                            {row: 1, col: 0}
                        ]
                    },
                    {
                        type: "shading",
                        colour: 1,
                        points: [
                            {row: 6, col: 0},
                            {row: 6, col: 8},
                            {row: 7, col: 8},
                            {row: 7, col: 0}
                        ]
                    }
                ]
            },
            legend: {
                A: {
                    name: "piece",
                    colour: 1
                },
                B: {
                    name: "piece",
                    colour: 2
                }
            },
            pieces: pstr
        };

        // Add annotations
        if (this.results.length > 0) {
            rep.annotations = [];
            for (const move of this.results) {
                if ( (move.type === "move") || (move.type === "fire") ) {
                    const [fromX, fromY] = MurusGame.algebraic2coords(move.from!);
                    const [toX, toY] = MurusGame.algebraic2coords(move.to!);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "capture") {
                    const [x, y] = MurusGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                } else if (move.type === "take") {
                    const [x, y] = MurusGame.algebraic2coords(move.from);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                } else if (move.type === "place") {
                    const [x, y] = MurusGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
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
            case "fire":
                node.push(i18next.t("apresults:FIRE.murus", {player, from: r.from, to: r.to}));
                resolved = true;
                break;
            case "capture":
                if ("count" in r) {
                    node.push(i18next.t("apresults:CAPTURE.murus_double", {player, where: r.where}));
                } else {
                    node.push(i18next.t("apresults:CAPTURE.nowhat", {player, where: r.where}));
                }
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): MurusGame {
        return new MurusGame(this.serialize());
    }
}
