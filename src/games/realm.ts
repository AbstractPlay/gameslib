/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-var-requires */
import { GameBase, IAPGameState, IClickResult, IIndividualState, IStashEntry, IScores, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { RectGrid, reviver, UserFacingError } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const deepclone = require("rfdc/default");

export type playerid = 1|2;
export type Piece = "B"|"P"|"E"|"Ex";
export type Facing = "N"|"E"|"S"|"W"|undefined
export type CellContents = [playerid, Piece, Facing];

type NumBases = number;
type NumPowers = number;
type NumEnforcers = number;
type GamePhase = "initialBase"|"initialPower"|"play";

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    lastmove?: string;
    pieces: [[NumBases,NumPowers,NumEnforcers],[NumBases,NumPowers,NumEnforcers]];
    captured: [NumBases,NumBases];
    phase: GamePhase;
    // Records which realm is being rearranged what what pieces are still in hand
    inhand: [string, CellContents[]]|undefined;
};

export interface IRealmState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

const reCompleteMoves: RegExp[] = [
    // /^[PB][a-l]\d+$/,                                   // Initial placement
    /^\-[a-l]\d+$/,                                     // Rearrange, trigger
    /^P[12][a-l]\d+$/,                                  // Rearrange, replace, no orientation
    /^(Ex|E)[12][a-l]\d+[NESW]$/,                       // Rearrange, replace, required orientation
    /^P([a-l]\d+){2}$/,                                 // Move power, no action
    /^P([a-l]\d+){2}\(B[a-l]\d+\)$/,                    // Move power, create base
    /^P([a-l]\d+){2}\(E[a-l]\d+[NESW]\)$/,              // Move power, create enforcer
    /^E([a-l]\d+){2}$/,                                 // Move enforcer
    /^E([a-l]\d+){2}\(x[EB][a-l]\d+(,xE[a-l]\d+)?\)$/,  // Move enforcer, immobilize or capture
];

export class RealmGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Realm",
        uid: "realm",
        playercounts: [2],
        version: "20230521",
        // i18next.t("apgames:descriptions.realm")
        description: "apgames:descriptions.realm",
        urls: ["https://boardgamegeek.com/boardgame/3024/realm"],
        people: [
            {
                type: "designer",
                name: "Phil Orbanes, Sr."
            }
        ],
        variants: [
            {
                uid: "moreBase",
                group: "bases"
            },
            {
                uid: "lessBase",
                group: "bases"
            },
            {
                uid: "moreEnforcer",
                group: "enforcers"
            },
            {
                uid: "lessEnforcer",
                group: "enforcers"
            },
            {
                uid: "morePower",
                group: "powers"
            },
            {
                uid: "capturedBases",
                group: "ties"
            },
            {
                uid: "lastFirst",
            },
            {
                uid: "replacement",
            },
            {
                uid: "checkpoint",
            },
            {
                uid: "control",
            },
            {
                uid: "relaxed",
            },
        ],
        flags: ["multistep", "player-stashes", "scores", "limited-pieces", "no-moves"]
    };

    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 12);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 12);
    }
    public static newFacing(from: string, to: string): Facing {
        const [x1, y1] = this.algebraic2coords(from);
        const [x2, y2] = this.algebraic2coords(to);
        // Naive and simple
        // Doesn't try to deal with error edge cases
        if (y2 < y1) {
            return "N";
        } else if (y2 > y1) {
            return "S";
        } else if (x2 < x1) {
            return "W";
        } else if (x2 > x1) {
            return "E";
        }
        return undefined;
    }

    public static getBorderCells(ctr: string): string[] {
        const [cx, cy] = this.algebraic2coords(ctr);
        if (! this.isCentreSpace(ctr)) {
            throw new Error(`${ctr} is not a centre space`);
        }
        const cells: string[] = [];
        for (const dx of [-1, 0, 1]) {
            for (const dy of [-1, 0, 1]) {
                const border = this.coords2algebraic(cx + dx, cy + dy);
                if (border !== ctr) {
                    cells.push(border);
                }
            }
        }
        return cells;
    }

    public static cell2realm(cell: string): string {
        const ctrs = [1, 4, 7, 10];
        const [x, y] = this.algebraic2coords(cell);
        for (const dx of [0, -1, 1]) {
            for (const dy of [0, -1, 1]) {
                if ( (ctrs.includes(x + dx)) && (ctrs.includes(y + dy)) ) {
                    return this.coords2algebraic(x + dx, y + dy);
                }
            }
        }
        throw new Error(`The given cell does not exist in any realm: ${cell}`);
    }

    public static isCentreSpace(cell: string): boolean {
        const ctrs = [1, 4, 7, 10];
        const [x, y] = this.algebraic2coords(cell);
        return ( (ctrs.includes(x)) && (ctrs.includes(y)) );
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, CellContents>;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    public pieces!: [[NumBases,NumPowers,NumEnforcers],[NumBases,NumPowers,NumEnforcers]];
    public captured: [NumBases,NumBases] = [0,0];
    public phase: GamePhase = "initialBase";
    public inhand: [string, CellContents[]]|undefined;

    constructor(state?: IRealmState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            const board = new Map<string, CellContents>();
            const fresh: IMoveState = {
                _version: RealmGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                pieces: [[12,3,8], [12,3,8]],
                captured: [0,0],
                phase: "initialBase",
                inhand: undefined
            };
            if ( (variants !== undefined) && (variants.length > 0) ) {
                let numBases = 12;
                let numPowers = 3;
                let numEnforcers = 8;
                for (const v of variants) {
                    switch (v) {
                        case "moreBase":
                            numBases++;
                            break;
                        case "lessBase":
                            numBases--;
                            break;
                        case "morePower":
                            numPowers++;
                            break;
                        case "moreEnforcer":
                            numEnforcers++
                            break;
                        case "lessEnforcer":
                            numEnforcers--;
                            break;
                        default:
                            this.variants.push(v);
                            break;
                    }
                }
                fresh.pieces = [[numBases,numPowers,numEnforcers], [numBases,numPowers,numEnforcers]]
            }
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IRealmState;
            }
            if (state.game !== RealmGame.gameinfo.uid) {
                throw new Error(`The Realm engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = [...state.variants];
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): RealmGame {
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
        this.phase = state.phase;
        this.captured = [...state.captured];
        this.inhand = deepclone(state.inhand) as [string, CellContents[]]|undefined;
        this.pieces = deepclone(state.pieces) as [[number,number,number],[number,number,number]];
        this.results = [...state._results];
        return this;
    }

    private getAllPieces(cell: string): [string, CellContents][] {
        const border = RealmGame.getBorderCells(cell);
        const contents: [string, CellContents][] = [];
        for (const c of [...border, cell]) {
            if (this.board.has(c)) {
                contents.push([c, deepclone(this.board.get(c)!) as CellContents]);
            }
        }
        return contents;
    }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            let cell: string | undefined;
            if ( (row >= 0) && (col >= 0) ) {
                cell = RealmGame.coords2algebraic(col, row);
            } else {
                if (piece === undefined) {
                    throw new Error("Piece is undefined.");
                } else {
                    if (piece.startsWith("En")) {
                        piece = piece[0] + piece.substring(2);
                    }
                }
            }
            let newmove = "";

            if (this.phase === "initialBase") {
                if (cell === undefined) {
                    return {move: "", message: ""} as IClickResult;
                }
                const realm = RealmGame.cell2realm(cell);
                if (realm === undefined) {
                    return {move: "", message: ""} as IClickResult;
                }
                newmove = `B${realm}`;
            } else if (this.phase === "initialPower") {
                if (cell === undefined) {
                    return {move: "", message: ""} as IClickResult;
                }
                if (this.board.has(cell)) {
                    return {move: "", message: ""} as IClickResult;
                }
                newmove = `P${cell}`;
            } else {
                // split any submoves
                const moves = move.split(/\s*;\s*/);
                let lastmove = moves.pop();
                if (lastmove === undefined) {
                    lastmove = "";
                }
                // Check if lastmove is complete
                let complete = false;
                for (const re of reCompleteMoves) {
                    if (re.test(lastmove)) {
                        complete = true;
                        break;
                    }
                }
                // If so, push it back on the list and start fresh
                if (complete) {
                    moves.push(lastmove);
                    lastmove = "";
                }

                const cloned = Object.assign(new RealmGame(), deepclone(this) as RealmGame);
                if (moves.length > 0) {
                    cloned.move(moves.join(";"), true);
                }

                // If lastmove is empty, then the click is starting a new submove
                if (lastmove.length === 0) {
                    // The only new moves would be those that click on an existing piece, either on the board or in hand, or potentially an empty centre cell
                    if (cell === undefined) {
                        // Must be placing a piece in hand
                        // If the first move in the chain isn't a rearrangement trigger, then abort
                        if ( (moves.length === 0) || (! moves[0].startsWith("-")) ) {
                            return {move: moves.join(";"), message: ""} as IClickResult;
                        }
                        let pcstr = piece!;
                        if (pcstr.startsWith("E")) {
                            pcstr = pcstr.substring(0, pcstr.length-1);
                        }
                        newmove = pcstr; // if cell is undefined, piece can't be
                    } else {
                        if (move.startsWith("-")) {
                            return {move: moves.join(";"), message: ""} as IClickResult;
                        } else {
                            // Empty centre spaces can be clicked
                            if (! cloned.board.has(cell)) {
                                if (RealmGame.isCentreSpace(cell)) {
                                    newmove = `-${cell}`;
                                } else {
                                    return {move: moves.join(";"), message: ""} as IClickResult;
                                }
                            } else {
                                // Touching a piece on the board
                                const contents = cloned.board.get(cell)!;
                                // Unless it's a base, it must be your own piece
                                if ( (contents[1] !== "B") && (contents[0] !== cloned.currplayer) ) {
                                    return {move: moves.join(";"), message: ""} as IClickResult;
                                }
                                switch (contents[1]) {
                                    case "B":
                                        newmove = `-${cell}`;
                                        break;
                                    case "E":
                                    case "P":
                                        newmove = `${contents[1]}${cell}`;
                                        break;
                                    default:
                                        return {move: moves.join(";"), message: ""} as IClickResult;
                                }
                            }
                        }
                    }
                // Otherwise, partial move; determine what the coordinates represent
                } else {
                    if (cell === undefined) {
                        return {move: moves.join(";"), message: ""} as IClickResult;
                    }
                    // special effect (open parenthesis without a closing one)
                    if ( (lastmove.includes("(")) && (! lastmove.includes(")")) ) {
                        // enforcer
                        if (lastmove.startsWith("E")) {
                            // current coordinates must be an existing, enemy enforcer
                            if (! cloned.board.has(cell)) {
                                return {move: moves.join(";"), message: ""} as IClickResult;
                            }
                            const contents = cloned.board.get(cell)!;
                            if ( (contents[0] === cloned.currplayer) || (contents[1] !== "E") ) {
                                return {move: moves.join(";"), message: ""} as IClickResult;
                            }
                            newmove = lastmove + `xE${cell}`;
                            // check for self immobilization
                            const pieces = cloned.getAllPieces(RealmGame.cell2realm(cell));
                            const myPowers = pieces.filter(p => p[1][0] === cloned.currplayer && p[1][1] === "P").length;
                            const theirPowers = pieces.filter(p => p[1][0] !== cloned.currplayer && p[1][1] === "P").length;
                            if (myPowers > theirPowers) {
                                newmove += ")";
                            } else {
                                const m = lastmove.match(/^E[a-l]\d+([a-l]\d+)/);
                                if (m === null) {
                                    throw new Error(`In-progress Enforcer move is malformed: ${lastmove}`);
                                }
                                newmove += `,xE${m[1]})`;
                            }
                        // otherwise power
                        } else {
                            // Only option is the creation of an enforcer
                            // If coordinate is already present, then we're setting facing
                            const m = lastmove.match(/E([a-l]\d+)$/);
                            if (m !== null) {
                                const src = m[1];
                                const dir = RealmGame.newFacing(src, cell);
                                if (dir !== undefined) {
                                    newmove = lastmove + `${dir})`;
                                } else {
                                    newmove = lastmove;
                                }
                            // Otherwise, we're placing the initial piece
                            } else {
                                if (cloned.board.has(cell)) {
                                    return {move: moves.join(";"), message: ""} as IClickResult;
                                }
                                newmove = lastmove + `E${cell}`;
                            }
                        }
                    // rearrange (no coordinates in the move)
                    } else if (! /[a-l]\d+$/.test(lastmove)) {
                        // must be a rearrangement
                        if (! moves[0].startsWith("-")) {
                            return {move: moves.join(";"), message: ""} as IClickResult;
                        }
                        // cell must be in the realm being rearranged
                        const realm = moves[0].substring(1);
                        const border = RealmGame.getBorderCells(realm);
                        if (! border.includes(cell)) {
                            return {move: moves.join(";"), message: ""} as IClickResult;
                        }
                        // cell must be empty
                        if (cloned.board.has(cell)) {
                            return {move: moves.join(";"), message: ""} as IClickResult;
                        }
                        newmove = lastmove + cell;
                        // Don't waste players' time with asking them to orient immobile enforcers
                        if (lastmove.startsWith("Ex")) {
                            newmove += "N";
                        }

                    // rearranging and need to orient an enforcer
                    } else if (/^E[12][a-l]\d+$/.test(lastmove)) {
                        const m = lastmove.match(/^E[12]([a-l]\d+)$/)!;
                        const src = m[1];
                        const facing = RealmGame.newFacing(src, cell);
                        if (facing !== undefined) {
                            newmove = lastmove + facing;
                        }
                    // other (completing a move, possibly triggering an event)
                    } else {
                        // This function does not test line of sight or other movement restrictions!
                        // It simply assumes the move is valid and does the special effect work.
                        // The `validateMove` function will yell if the core movement is impossible.
                        // It has to be this way because `validateMove` can't change the move string.

                        // Cell must be empty
                        if (cloned.board.has(cell)) {
                            return {move: moves.join(";"), message: ""} as IClickResult;
                        }
                        newmove = lastmove + cell;

                        // Check for special effects
                        const realm = RealmGame.cell2realm(cell);
                        const pieces = cloned.getAllPieces(realm);
                        if (lastmove.startsWith("P")) {
                            // power creates base
                            if (! cloned.board.has(realm)) {
                                const theirPowers = pieces.filter(p => p[1][0] !== cloned.currplayer && p[1][1] === "P").length;
                                if (theirPowers === 0) {
                                    newmove += `(B${realm})`;
                                }
                            // power creates enforcer
                            } else {
                                const base = cloned.board.get(realm)!;
                                if (base[0] === cloned.currplayer) {
                                    const allmobile = pieces.filter(p => p[1][1] === "E").length;
                                    if (allmobile === 0) {
                                        const empties: string[] = [];
                                        for (const c of RealmGame.getBorderCells(realm)) {
                                            if ( (! cloned.board.has(c)) && (c !== cell) ) {
                                                empties.push(c);
                                            }
                                        }
                                        if (empties.length === 1) {
                                            newmove += `(E${empties[0]}`;
                                        } else if (empties.length > 1) {
                                            newmove += "(";
                                        }
                                    }
                                }
                            }
                        } else {
                            // Enforcer caps enforcer
                            const theirEnforcers = pieces.filter(p => p[1][0] !== cloned.currplayer && p[1][1] === "E");
                            const myPowers = pieces.filter(p => p[1][0] === cloned.currplayer && p[1][1] === "P").length;
                            const theirPowers = pieces.filter(p => p[1][0] !== cloned.currplayer && p[1][1] === "P").length;
                            if (theirEnforcers.length > 0) {
                                if (theirEnforcers.length === 1) {
                                    newmove += `(xE${theirEnforcers[0][0]}`;
                                    if (myPowers <= theirPowers) {
                                        newmove += `,xE${cell})`;
                                    } else {
                                        newmove += ")";
                                    }
                                } else {
                                    newmove += `(`;
                                }
                            // Enforcer caps base
                            } else { // 0 mobile enemy enforcers
                                // contains opposing base
                                if ( (pieces.filter(p => p[1][0] !== cloned.currplayer && p[1][1] === "B").length === 1) && (myPowers > theirPowers) ) {
                                    newmove += `(xB${realm}`;
                                    if (myPowers - theirPowers > 1) {
                                        newmove += ")";
                                    } else {
                                        newmove += `,xE${cell})`;
                                    }
                                }
                            }
                        }
                    }
                }
                newmove = [...moves, newmove].join(";");
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
                message: i18next.t("apgames:validation._general.GENERIC", {move, row, col, piece, emessage: (e as Error).message, estack: (e as Error).stack})
            }
        }
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        const ctrs = [1,4,7,10];
        const ctrCells: string[] = [];
        for (const cx of ctrs) {
            for (const cy of ctrs) {
                ctrCells.push(RealmGame.coords2algebraic(cx, cy));
            }
        }

        let cloned: RealmGame = Object.assign(new RealmGame(), deepclone(this) as RealmGame);

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            if (cloned.phase === "initialBase") {
                result.message = i18next.t("apgames:validation.realm.INITIAL_INSTRUCTIONS", {context: "bases"});
            } else if (cloned.phase === "initialPower") {
                result.message = i18next.t("apgames:validation.realm.INITIAL_INSTRUCTIONS", {context: "powers"});
            } else {
                result.message = i18next.t("apgames:validation.realm.INITIAL_INSTRUCTIONS", {context: "play"});
            }
            return result;
        }

        if (cloned.phase === "initialBase") {
            // check well-formedness
            if (! /^b[a-l]\d+$/.test(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
                return result;
            }
            const cell = m.substring(1);
            // must be a centre space
            if (! RealmGame.isCentreSpace(cell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.realm.NOT_CENTRE", {where: cell});
                return result;
            }
            // must be unoccupied
            if (cloned.board.has(cell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: cell});
                return result;
            }
            // Must not be in line with existing friendly base unless relaxed or no other option
            if (! cloned.variants.includes("relaxed")) {
                // get list of friendly bases, converted to xy coordinates
                const myBases = [...cloned.board.entries()].filter(e => e[1][0] === cloned.currplayer && e[1][1] === "B").map(e => RealmGame.algebraic2coords(e[0]));
                // get list of unclaimed realms as xy coordinates
                const emptyBases = ctrCells.filter(c => ! cloned.board.has(c)).map(c => RealmGame.algebraic2coords(c));
                // get list of unclaimed realms that do NOT share x or y coordinates with owned bases, as algebraic coordinates
                const unaligned = emptyBases.filter(b => ( (! myBases.map(mb => mb[0]).includes(b[0])) && (! myBases.map(mb => mb[1]).includes(b[1])) ) ).map(b => RealmGame.coords2algebraic(...b));
                // If there are indeed options and your requested move is not one of them
                if ( (unaligned.length > 0) && (! unaligned.includes(cell)) ) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.realm.ALIGNED_BASE");
                    return result;
                }
            }
            // we're good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;

        } else if (cloned.phase === "initialPower") {
            // check well-formedness
            if (! /^p[a-l]\d+$/.test(m)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move: m});
                return result;
            }
            const cell = m.substring(1);
            // must not be a centre space
            if (RealmGame.isCentreSpace(cell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.realm.ONLY_BORDERS");
                return result;
            }
            const realm = RealmGame.cell2realm(cell);
            const pieces = cloned.getAllPieces(realm);
            // must be in a realm you control
            if (pieces.filter(p => p[1][0] === cloned.currplayer && p[1][1] === "B").length === 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.realm.UNCONTROLLED", {realm});
                return result;
            }
            // must not already contain a power
            if (pieces.filter(p => p[1][0] === cloned.currplayer && p[1][1] === "P").length > 0) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.realm.DOUBLE_POWER", {realm});
                return result;
            }
            // cell must be unoccupied
            if (cloned.board.has(cell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: m});
                return result;
            }
            // we're good
            result.valid = true;
            result.complete = 1;
            result.message = i18next.t("apgames:validation._general.VALID_MOVE");
            return result;

        } else {
            const moves = m.split(";");
            for (let i = 0; i < moves.length; i++) {
            // for (const move of moves) {
                const move = moves[i];
                // if starts with hyphen, then rearrangement
                if (move.startsWith("-")) {
                    // check well-formedness
                    if (! /^\-[a-l]\d+$/.test(move)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move});
                        return result;
                    }
                    const cell = move.substring(1);
                    // Must be a centre space
                    if (! RealmGame.isCentreSpace(cell)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.realm.NOT_CENTRE", {where: cell});
                        return result;
                    }
                    const realm = RealmGame.cell2realm(cell);
                    const pieces = cloned.getAllPieces(realm);
                    // There must be pieces to rearrange
                    let hasPieces = pieces.filter(p => p[1][0] === cloned.currplayer && p[1][1] !== "B").length > 0;
                    if ( (! hasPieces) && (cloned.variants.includes("control")) ) {
                        hasPieces = pieces.filter(p => p[1][1] !== "B").length > 0;
                    }
                    if (! hasPieces) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.realm.EMPTY_REARRANGE", {realm});
                        return result;
                    }
                // otherwise, everything else
                } else {
                    // if there are pieces in hand, then only placement moves are acceptable
                    if ( (cloned.inhand !== undefined) && (cloned.inhand[1].length > 0) ) {
                        // must start with piece and owner
                        if (! /^(ex|e|p)[12]/.test(move)) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.realm.INHAND");
                            return result;
                        }
                        // piece must exist in your hand
                        const [, pc, owner] = move.match(/^(ex|e|p)([12])/)!; // not null because tested above
                        const pcstr = pc[0].toUpperCase() + pc.substring(1);
                        const idx = cloned.inhand[1].findIndex(p => p[1] === pcstr && p[0] === parseInt(owner, 10) as playerid);
                        if (idx === -1) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.realm.NOT_IN_HAND", {piece: pcstr});
                            return result;
                        }

                        let match = move.match(/^(ex|e|p)[12](.+)$/);
                        // no destination provided
                        if (match === null) {
                            result.valid = true;
                            result.complete = -1;
                            result.message = i18next.t("apgames:validation.realm.PLACE_IN_REALM", {realm: cloned.inhand[0]});
                            return result;
                        }
                        // destination is invalid
                        let rest = match[2];
                        if (! /^[a-l]\d+/.test(rest)) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.realm.PLACE_IN_REALM", {realm: cloned.inhand[0]});
                            return result;
                        }
                        match = rest.match(/^([a-l]\d+)(.*)$/)!;
                        const cell = match[1];
                        rest = match[2];
                        // cell must be empty
                        if (cloned.board.has(cell)) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: cell});
                            return result;
                        }
                        // cell must be in the realm being rearranged
                        if (RealmGame.cell2realm(cell) !== cloned.inhand[0]) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.realm.WRONG_REALM", {context: "rearrange", realm: RealmGame.cell2realm(cell)});
                            return result;
                        }
                        // if this is an enforcer placement, then orientation is required
                        if (move.startsWith("e")) {
                            if ( (rest === undefined) || (rest.length === 0) ) {
                                result.valid = true;
                                result.complete = -1;
                                result.canrender = true;
                                result.message = i18next.t("apgames:validation.realm.ORIENT_ENFORCER");
                                return result;
                            }
                            if (! /^[nesw]$/.test(rest)) {
                                result.valid = false;
                                result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move});
                                return result;
                            }
                        }

                        // if we made it this far, we're good
                        result.valid = true;
                        result.complete = 1;
                        result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                        return result;
                    }

                    // Movement
                    const rePartial = /^([pe])([a-l]\d+)?([a-l]\d+)?(\((.*?)\)?)?$/;
                    if (! rePartial.test(move)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move});
                        return result;
                    }
                    const [,piece, from, to, parens, specials] = [...move.match(rePartial)!];
                    // If provided, validate `from`
                    if (from !== undefined) {
                        // the piece exists
                        if (! cloned.board.has(from)) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: from});
                            return result;
                        }
                        const contents = cloned.board.get(from)!;
                        // it is yours
                        if (contents[0] !== cloned.currplayer) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation._general.UNCONTROLLED");
                            return result;
                        }
                        // it's the right type
                        if (contents[1] !== piece.toUpperCase()) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.realm.PIECE_MISMATCH", {where: from});
                            return result;
                        }
                    } else {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move});
                        return result;
                    } // validate `from`

                    const triggered: ("createBase"|"createEnforcer"|"capBase"|"immobEnforcer"|"immobSelf")[] = [];
                    // If provided, validate `to`, including determining required special actions
                    if (to !== undefined) {
                        // the spaces are different
                        if (from === to) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation._general.SAME_FROM_TO");
                            return result;
                        }
                        // the realms are different (you may not move a piece within a realm)
                        if (RealmGame.cell2realm(from) === RealmGame.cell2realm(to)) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.realm.MUST_LEAVE_REALM");
                            return result;
                        }
                        // the space is empty
                        if (cloned.board.has(to)) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: to});
                            return result;
                        }
                        // the space is not a centre space
                        if (RealmGame.isCentreSpace(to)) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.realm.ONLY_BORDERS");
                            return result;
                        }
                        const [fx, fy] = RealmGame.algebraic2coords(from);
                        const [tx, ty] = RealmGame.algebraic2coords(to);
                        // cells are orthogonal
                        const dir = RectGrid.bearing(fx, fy, tx, ty);
                        if ( (dir === undefined) || (dir.length > 1) ) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation._general.NOT_ORTH", {from, to});
                            return result;
                        }
                        // If enforcer, direction is not in opposite direction
                        if (piece === "e") {
                            const contents = cloned.board.get(from)!;
                            if (
                                ( (contents[2] === "N") && (dir === "S") ) ||
                                ( (contents[2] === "E") && (dir === "W") ) ||
                                ( (contents[2] === "S") && (dir === "N") ) ||
                                ( (contents[2] === "W") && (dir === "E") )
                            ) {
                                result.valid = false;
                                result.message = i18next.t("apgames:validation.realm.ENFORCER_180");
                                return result;
                            }
                        }
                        // line of sight
                        const between = RectGrid.between(fx, fy, tx, ty).map(pts => RealmGame.coords2algebraic(...pts));
                        for (const cell of between) {
                            if (cloned.board.has(cell)) {
                                result.valid = false;
                                result.message = i18next.t("apgames:validation._general.OBSTRUCTED", {from, to, obstruction: cell});
                                return result;
                            }
                        }
                        // if "checkpoint" variant, make sure you stop in first enemy realm
                        if (cloned.variants.includes("checkpoint")) {
                            // get list of realms passed through
                            const fRealm = RealmGame.cell2realm(from);
                            const tRealm = RealmGame.cell2realm(to);
                            const realms: string[] = [];
                            for (const b of between) {
                                const bRealm = RealmGame.cell2realm(b);
                                if (bRealm === fRealm) { continue; }
                                if (realms.includes(bRealm)) { continue; }
                                if (bRealm === tRealm) { break; }
                                realms.push(bRealm);
                            }
                            // `realms` now contains a list of realms *between* from and to
                            // (exclusive, meaning it will be empty if from and to realms are adjacent)
                            // If any of the realms listed here are enemy controlled, then we've broken the rule
                            for (const br of realms) {
                                if (cloned.board.has(br)) {
                                    const contents = cloned.board.get(br)!;
                                    if (contents[0] !== cloned.currplayer) {
                                        result.valid = false;
                                        result.message = i18next.t("apgames:validation.realm.CHECKPOINT_CHARLEY", {realm: br});
                                        return result;
                                    }
                                }
                            }
                        }

                        // generate special actions
                        const realm = RealmGame.cell2realm(to);
                        const pieces = cloned.getAllPieces(realm);
                        const numBases = pieces.filter(p => p[1][1] === "B").length;
                        const myBases = pieces.filter(p => p[1][1] === "B" && p[1][0] === cloned.currplayer).length;
                        const myPowers = pieces.filter(p => p[1][1] === "P" && p[1][0] === cloned.currplayer).length;
                        const theirPowers = pieces.filter(p => p[1][1] === "P" && p[1][0] !== cloned.currplayer).length;
                        const myMobile = pieces.filter(p => p[1][1] === "E" && p[1][0] === cloned.currplayer).length;
                        const theirMobile = pieces.filter(p => p[1][1] === "E" && p[1][0] !== cloned.currplayer).length;
                        if (piece === "p") {
                            // power creates base
                            if ( (numBases === 0) && (theirPowers === 0) && (cloned.pieces[cloned.currplayer - 1][0] > 0) ) {
                                triggered.push("createBase");
                            }
                            // power creates enforcer
                            if ( (myBases === 1) && (myMobile + theirMobile === 0) && (cloned.pieces[cloned.currplayer - 1][2] > 0) ) {
                                triggered.push("createEnforcer");
                            }
                        } else {
                            if (theirMobile > 0) {
                                triggered.push("immobEnforcer");
                                if (theirPowers >= myPowers) {
                                    triggered.push("immobSelf");
                                }
                            }
                            if ( (theirMobile === 0) && (numBases === 1) && (myBases === 0) && (myPowers > theirPowers) ) {
                                triggered.push("capBase");
                                if (myPowers - theirMobile < 2) {
                                    triggered.push("immobSelf");
                                }
                            }
                        }
                    } else {
                        result.valid = true;
                        result.complete = -1;
                        result.message = i18next.t("apgames:validation._general.NEED_DESTINATION", {move});
                        return result;
                    } // validate `to`

                    // Validate special actions, if provided
                    if (parens !== undefined) {
                        // Specials must have been triggered
                        if (triggered.length === 0) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.realm.NO_SPECIALS");
                            return result;
                        }
                        // Only do full validation once the special actions are fully specified
                        // But provide hints where possible
                        if (! parens.endsWith(")")) {
                            if (specials !== undefined) {
                                // Need to orient a new enforcer
                                if (/e[a-l]\d+$/.test(specials)) {
                                    result.valid = true;
                                    result.complete = -1;
                                    result.canrender = true;
                                    result.message = i18next.t("apgames:validation.realm.ORIENT_ENFORCER");
                                    return result;
                                }
                            }
                            // Give hints on what still needs to be done
                            result.valid = true;
                            result.complete = -1;
                            result.canrender = true;
                            if (triggered.includes("createBase")) {
                                result.message = i18next.t("apgames:validation.realm.SPECIAL_CREATE_BASE");
                            } else if (triggered.includes("createEnforcer")) {
                                result.message = i18next.t("apgames:validation.realm.SPECIAL_CREATE_ENFORCER");
                            } else if (triggered.includes("capBase")) {
                                result.message = i18next.t("apgames:validation.realm.SPECIAL_CAP_BASE");
                            } else if (triggered.includes("immobEnforcer")) {
                                result.message = i18next.t("apgames:validation.realm.SPECIAL_IMMOB_ENFORCER");
                            }
                            if (triggered.includes("immobSelf")) {
                                result.message += " " + i18next.t("apgames:validation.realm.SPECIAL_IMMOB_SELF");
                            }
                            return result;
                        } else {
                            // The special events section is complete
                            // Do full validation
                            if (triggered.includes("createBase")) {
                                if (! /^b[a-l]\d+$/.test(specials)) {
                                    result.valid = false;
                                    result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move});
                                    return result;
                                }
                                const cell = specials.substring(1);
                                // must be empty
                                if (cloned.board.has(cell)) {
                                    result.valid = false;
                                    result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: cell});
                                    return result;
                                }
                                // must be a centre space
                                if (! RealmGame.isCentreSpace(cell)) {
                                    result.valid = false;
                                    result.message = i18next.t("apgames:validation.realm.NOT_CENTRE", {where: cell});
                                    return result;
                                }
                                // must be the realm you moved to
                                const realm = RealmGame.cell2realm(to);
                                if (RealmGame.cell2realm(cell) !== realm) {
                                    result.valid = false;
                                    result.message = i18next.t("apgames:validation.realm.WRONG_REALM", {context: "createBase", realm});
                                    return result;
                                }
                            } else if (triggered.includes("createEnforcer")) {
                                if (! /^e[a-l]\d+[nesw]$/.test(specials)) {
                                    result.valid = false;
                                    result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move});
                                    return result;
                                }
                                const cell = specials.substring(1, specials.length - 1);
                                // must be empty
                                if (cloned.board.has(cell)) {
                                    result.valid = false;
                                    result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: cell});
                                    return result;
                                }
                                // must not be a centre space
                                if (RealmGame.isCentreSpace(cell)) {
                                    result.valid = false;
                                    result.message = i18next.t("apgames:validation.realm.ONLY_BORDERS", {where: cell});
                                    return result;
                                }
                                // must be in the realm you just moved to
                                const realm = RealmGame.cell2realm(to);
                                if (RealmGame.cell2realm(cell) !== realm) {
                                    result.valid = false;
                                    result.message = i18next.t("apgames:validation.realm.WRONG_REALM", {context: "createEnforcer", realm});
                                    return result;
                                }
                            } else if (triggered.includes("capBase")) {
                                if (! /^xb[a-l]\d+/.test(specials)) {
                                    result.valid = false;
                                    result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move});
                                    return result;
                                }
                                const [,cell] = specials.match(/^xb([a-l]\d+)/)!;
                                // must be a centre space
                                if (! RealmGame.isCentreSpace(cell)) {
                                    result.valid = false;
                                    result.message = i18next.t("apgames:validation.realm.NOT_CENTRE", {where: cell});
                                    return result;
                                }
                                // must be occupied
                                if (! cloned.board.has(cell)) {
                                    result.valid = false;
                                    result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: cell});
                                    return result;
                                }
                                // must belong to your opponent
                                const contents = cloned.board.get(cell)!;
                                if (contents[0] === cloned.currplayer) {
                                    result.valid = false;
                                    result.message = i18next.t("apgames:validation._general.SELFCAPTURE");
                                    return result;
                                }
                                // must be in the realm you just moved to
                                const realm = RealmGame.cell2realm(to);
                                if (RealmGame.cell2realm(cell) !== realm) {
                                    result.valid = false;
                                    result.message = i18next.t("apgames:validation.realm.WRONG_REALM", {context: "capBase", realm});
                                    return result;
                                }
                            } else if (triggered.includes("immobEnforcer")) {
                                if (! /^xe[a-l]\d+/.test(specials)) {
                                    result.valid = false;
                                    result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move});
                                    return result;
                                }
                                const [,cell] = specials.match(/^xe([a-l]\d+)/)!;
                                // must be occupied
                                if (! cloned.board.has(cell)) {
                                    result.valid = false;
                                    result.message = i18next.t("apgames:validation._general.NONEXISTENT", {where: cell});
                                    return result;
                                }
                                // must belong to your opponent
                                const contents = cloned.board.get(cell)!;
                                if (contents[0] === cloned.currplayer) {
                                    result.valid = false;
                                    result.message = i18next.t("apgames:validation._general.SELFCAPTURE");
                                    return result;
                                }
                                // must be an enforcer
                                if (contents[1] !== "E") {
                                    result.valid = false;
                                    result.message = i18next.t("apgames:validation.realm.ONLY_ENFORCERS");
                                    return result;
                                }
                                // must be in the realm you just moved to
                                const realm = RealmGame.cell2realm(to);
                                if (RealmGame.cell2realm(cell) !== realm) {
                                    result.valid = false;
                                    result.message = i18next.t("apgames:validation.realm.WRONG_REALM", {context: "capBase", realm});
                                    return result;
                                }
                            } // for each special event
                            if (triggered.includes("immobSelf")) {
                                if (! /,xe[a-l]\d+$/.test(specials)) {
                                    result.valid = false;
                                    result.message = i18next.t("apgames:validation._general.INVALID_MOVE", {move});
                                    return result;
                                }
                                const [,cell] = specials.match(/,xe([a-l]\d+)$/)!;
                                // cell must be the same as to
                                if (cell !== to) {
                                    result.valid = false;
                                    result.message = i18next.t("apgames:validation.realm.SPECIAL_IMMOB_SELF");
                                    return result;
                                }
                            }
                        }
                    } // validate specials
                } // move type (rearrangement or movement)

                cloned = Object.assign(new RealmGame(), deepclone(this) as RealmGame);
                cloned.move(moves.slice(0, i+1).join(";"), true);
            } // for each submove

            // we're good
            if ( (cloned.inhand !== undefined) && (cloned.inhand[1].length > 0) ) {
                result.valid = true;
                result.complete = -1;
                result.canrender = true;
                result.message = i18next.t("apgames:validation.realm.INHAND");
                return result;
            } else {
                // If we made it here, then all submoves are individually valid and complete
                // Let's make sure they meet the concentration/dispersal requirements
                if (moves.length > 1) {
                    const starts = new Set<string>();
                    const ends = new Set<string>();
                    for (const move of moves) {
                        // Can rule out null result because of previous validation
                        const [,from,to] = move.match(/^[pe]([a-l]\d+)([a-l]\d+).*?$/)!;
                        starts.add(RealmGame.cell2realm(from));
                        ends.add(RealmGame.cell2realm(to));
                    }
                    // In dispersal mode, all start from one realm
                    // In concentration mode, all end in the same realm
                    if ( (starts.size > 1) && (ends.size > 1) ) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.realm.BAD_MULTIMOVE");
                        return result;
                    }
                }

                result.valid = true;
                result.complete = 0;
                result.canrender = true;
                result.message = i18next.t("apgames:validation._general.VALID_MOVE");
                return result;
            }
        } // if game phase === play
    }

    // The partial flag enabled dynamic connection checking.
    // It leaves the object in an invalid state, so only use it on cloned objects, or call `load()` before submitting again.
    // This function offloads all validation to `validateMove`!
    // If the move is flagged as partial, no validation is done at all. NO FAILSAFES!
    // This means it silently ignores nonsensical movement parts.
    public move(m: string, partial = false): RealmGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.replace(/\s+/g, "");
        const origMove =m;
        m = m.toLowerCase();
        if (! partial) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
        }
        this.results = [];

        let justStarted = false;
        if (this.phase === "initialBase") {
            const reMove = /^b[a-l]\d+$/;
            if (reMove.test(m)) {
                const cell = m.substring(1);
                this.board.set(cell, [this.currplayer, "B", undefined]);
                this.pieces[this.currplayer - 1][0]--;
                this.results.push({type: "place", what: "base", where: cell});
                // Next phase if number of pieces is twice the number of initial powers
                if ([...this.board.keys()].length === this.pieces[this.currplayer - 1][1] * 2) {
                    this.phase = "initialPower";
                }
            }
        } else if (this.phase === "initialPower") {
            const reMove = /^p[a-l]\d+$/;
            if (reMove.test(m)) {
                const cell = m.substring(1);
                this.board.set(cell, [this.currplayer, "P", undefined]);
                this.pieces[this.currplayer - 1][1]--;
                this.results.push({type: "place", what: "power", where: cell});
                // Next phase if all powers have been placed
                if (this.pieces[0][1] + this.pieces[1][1] === 0) {
                    this.phase = "play";
                    justStarted = true;
                }
            }
        } else {
            // If move starts with a hyphen, it's a rearrangement
            if (m.startsWith("-")) {
                const parts = m.split(";");
                const realm = parts.shift()!.substring(1);
                const border = RealmGame.getBorderCells(realm);
                this.inhand = [realm, [] as CellContents[]];
                for (const cell of border) {
                    if (this.board.has(cell)) {
                        const contents = this.board.get(cell)!;
                        if ( (contents[0] === this.currplayer) || (this.variants.includes("control")) ) {
                            this.inhand[1].push([...contents]);
                            this.results.push({type: "take", what: `${contents[1]}${contents[0]}`, from: cell});
                            this.board.delete(cell);
                        }
                    }
                }
                const rePart = /^(ex|e|p|b)([12])([a-l]\d+)?([nesw]?)$/;
                for (const part of parts) {
                    const p = part.match(rePart);
                    if (p !== null) {
                        const [, piece, owner, dest, dir] = p;
                        if (dest !== undefined) {
                            const pcstr = piece[0].toUpperCase() + piece.substring(1);
                            const idx = this.inhand[1].findIndex(x => x[1] === pcstr && x[0] === parseInt(owner, 10) as playerid);
                            if (idx !== -1) {
                                let calcDir: Facing;
                                if ( (dir !== undefined) && (dir.length > 0) ) {
                                    calcDir = dir as Facing;
                                }
                                if ( (piece.startsWith("e")) && ( (dir === undefined) || (dir.length === 0) ) ) {
                                    calcDir = "N";
                                }
                                this.inhand[1].splice(idx, 1);
                                this.board.set(dest, [parseInt(owner, 10) as playerid, pcstr as Piece, calcDir]);
                                this.results.push({type: "place", what: pcstr, where: dest});
                            }
                        }
                    }
                }
                // If all pieces placed, delete `inhand`
                if (this.inhand[1].length === 0) {
                    this.inhand = undefined;
                }
            // Otherwise movement and special events
            } else {
                // Moves must be separated by semicolons because special actions can contain commas
                const parts = m.split(";");
                const rePart = /^([pe])([a-l]\d+)([a-l]\d+)(\((.*?)\)?)?$/;
                for (const part of parts) {
                    const p = part.match(rePart);
                    if (p !== null) {
                        const [, piece, from, to,, special] = p;
                        // if enforcer, get new facing
                        let newfacing: Facing;
                        if (piece === "e") {
                            newfacing = RealmGame.newFacing(from, to);
                        }
                        this.board.delete(from);
                        this.board.set(to, [this.currplayer, piece.toUpperCase() as Piece, newfacing]);
                        this.results.push({type: "move", from, to});
                        if (special !== undefined) {
                            const reCap = /^x([eb])([a-l]\d+)$/;
                            const reCreate = /^([eb])([a-l]\d+)([nesw])?$/;
                            const specials = special.split(",");
                            for (const s of specials) {
                                if (reCap.test(s)) {
                                    const cap = s.match(reCap);
                                    if (cap !== null) {
                                        const [, pc, cell] = cap;
                                        if (pc === "b") {
                                            this.board.delete(cell);
                                            this.captured[this.currplayer - 1]++;
                                            this.results.push({type: "capture", what: "base", where: cell});
                                            if (this.variants.includes("replacement")) {
                                                if (this.pieces[this.currplayer - 1][0] > 0) {
                                                    this.pieces[this.currplayer - 1][0]--;
                                                    this.board.set(cell, [this.currplayer, "B", undefined]);
                                                    this.results.push({type: "place", what: "base", where: cell});
                                                }
                                            }
                                        } else {
                                            if (this.board.has(cell)) {
                                                this.board.get(cell)![1] = "Ex";
                                                this.results.push({type: "immobilize", where: cell});
                                            }
                                        }
                                    }
                                } else if (reCreate.test(s)) {
                                    const create = s.match(reCreate);
                                    if (create !== null) {
                                        const [, pc, cell, facing] = create;
                                        let calcDir: Facing;
                                        if ( (facing !== undefined) && (facing.length > 0) ) {
                                            calcDir = facing.toUpperCase() as Facing;
                                        }
                                        if ( (pc.startsWith("e")) && ( (facing === undefined) || (facing.length === 0) ) ) {
                                            calcDir = "N";
                                        }
                                        this.board.set(cell, [this.currplayer, pc.toUpperCase() as Piece, calcDir]);
                                        if (pc === "b") {
                                            this.pieces[this.currplayer - 1][0]--;
                                            this.results.push({type: "place", what: "base", where: cell});
                                        } else {
                                            this.pieces[this.currplayer - 1][2]--;
                                            this.results.push({type: "place", what: "enforcer", where: cell});
                                        }
                                    } // if a create special action
                                } // process special actions
                            } // for each special
                        } // if there are specials
                    } // if the submove can be processed
                } // for each submove
            } // process different move types
        } // process different game modes

        // Stop here if only requesting partial processing
        if (partial) { return this; }

        // update currplayer
        this.lastmove = origMove;
        if ( (! justStarted) || (! this.variants.includes("lastFirst")) ) {
            let newplayer = (this.currplayer as number) + 1;
            if (newplayer > this.numplayers) {
                newplayer = 1;
            }
            this.currplayer = newplayer as playerid;
        }

        this.checkEOG();
        this.saveState();
        return this;
    }

    protected checkEOG(): RealmGame {
        // Game ends if one player has no bases left
        if ( (this.pieces[0][0] === 0) || (this.pieces[1][0] === 0) ) {
            this.gameover = true;
            const score1 = this.getPlayerScore(1)!;
            const score2 = this.getPlayerScore(2)!;
            if (score1 > score2) {
                this.winner = [1]
            } else if (score1 < score2) {
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

    public getPlayerScore(player: playerid): number {
        let score = 0;

        // count controlled realms
        score += [...this.board.values()].filter(c => c[0] === player && c[1] === "B").length;

        // count mobile and uncreated enforcers (/10)
        const count = this.pieces[player - 1][2] + [...this.board.values()].filter(c => c[0] === player && c[1] === "E").length;
        score += count / 10;

        // if variant given, count captured bases (/100)
        // ONLY COUNTS FIRST 9 CAPTURED BASES!
        if (this.variants.includes("capturedBases")) {
            score += Math.min(9, this.captured[player - 1]) / 100;
        }

        return score;
    }

    public state(): IRealmState {
        return {
            game: RealmGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: [...this.variants],
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: RealmGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            pieces: deepclone(this.pieces) as [[number,number,number],[number,number,number]],
            phase: this.phase,
            captured: deepclone(this.captured) as [number,number],
            inhand: deepclone(this.inhand) as [string, CellContents[]]|undefined,
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr = "";
        for (let row = 0; row < 12; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < 12; col++) {
                const cell = RealmGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell);
                    if (contents === undefined) {
                        throw new Error("Malformed cell contents.");
                    }
                    let piece = `${contents[1] === "E" ? "En" : contents[1]}${contents[0]}`;
                    if ( (contents[2] !== undefined) && (contents[2] !== null) ) {
                        piece += contents[2];
                    }
                    pieces.push(piece);
                } else {
                    pieces.push("");
                }
            }
            pstr += pieces.join(",");
        }
        pstr = pstr.replace(/\n,{11}(?=\n)/g, "\n_");

        // build markers
        type MarkerPoints = [{row: number; col: number}, ...{row: number; col: number}[]];
        // @ts-ignore
        const markers: MarkerPoints = [];
        const ctrs = [1, 4, 7, 10];
        for (const x of ctrs) {
            for (const y of ctrs) {
                markers.push({col: x, row: y});
            }
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares",
                width: 12,
                height: 12,
                tileHeight: 3,
                tileWidth: 3,
                markers: [{
                    "type": "glyph",
                    "glyph": "circle",
                    "points": markers
                }],
            },
            legend: {
                circle: {
                    name: "piece",
                    scale: 0.95
                },
                B1: {
                    name: "piece-square",
                    player: 1,
                    scale: 0.75
                },
                B2: {
                    name: "piece-square",
                    player: 2,
                    scale: 0.75
                },
                P1: {
                    name: "piece",
                    player: 1
                },
                P2: {
                    name: "piece",
                    player: 2
                },
                En1N: {
                    name: "piece-triangle",
                    player: 1
                },
                En1E: {
                    name: "piece-triangle",
                    player: 1,
                    rotate: 90
                },
                En1S: {
                    name: "piece-triangle",
                    player: 1,
                    rotate: 180
                },
                En1W: {
                    name: "piece-triangle",
                    player: 1,
                    rotate: 270
                },
                En2N: {
                    name: "piece-triangle",
                    player: 2
                },
                En2E: {
                    name: "piece-triangle",
                    player: 2,
                    rotate: 90
                },
                En2S: {
                    name: "piece-triangle",
                    player: 2,
                    rotate: 180
                },
                En2W: {
                    name: "piece-triangle",
                    player: 2,
                    rotate: 270
                },
                Ex1N: {
                    name: "piece-triangle-dot",
                    player: 1,
                    opacity: 0.25,
                },
                Ex1E: {
                    name: "piece-triangle-dot",
                    player: 1,
                    opacity: 0.25,
                    rotate: 90,
                },
                Ex1S: {
                    name: "piece-triangle-dot",
                    player: 1,
                    opacity: 0.25,
                    rotate: 180,
                },
                Ex1W: {
                    name: "piece-triangle-dot",
                    player: 1,
                    opacity: 0.25,
                    rotate: 270,
                },
                Ex2N: {
                    name: "piece-triangle-dot",
                    player: 2,
                    opacity: 0.25
                },
                Ex2E: {
                    name: "piece-triangle-dot",
                    player: 2,
                    opacity: 0.25,
                    rotate: 90,
                },
                Ex2S: {
                    name: "piece-triangle-dot",
                    player: 2,
                    opacity: 0.25,
                    rotate: 180,
                },
                Ex2W: {
                    name: "piece-triangle-dot",
                    player: 2,
                    opacity: 0.25,
                    rotate: 270,
                },
            },
            pieces: pstr
        };

        if (this.inhand !== undefined) {
            // highlight the realm being rearranged with the current player's colour
            const [cx, cy] = RealmGame.algebraic2coords(this.inhand[0]);
            const corners: MarkerPoints = [
                {
                    col: cx-1,
                    row: cy-1
                },
                {
                    col: cx+2,
                    row: cy-1
                },
                {
                    col: cx+2,
                    row: cy+2
                },
                {
                    col: cx-1,
                    row: cy+2
                },
            ];
            // @ts-ignore
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            rep.board.markers.push({
                type: "shading",
                colour: this.currplayer,
                points: corners
            });

            // Put any inhand pieces in the bar
            // @ts-ignore
            rep.areas = [{
                type: "pieces",
                pieces: [...this.inhand[1].map(p => `${p[1] === "E" ? "En" : p[1]}${p[0]}${p[1].startsWith("E") ? "N" : ""}`)] as [string, ...string[]],
                label: i18next.t("apgames:validation.realm.INHAND_LABEL", {realm: this.inhand[0]})
            }];
        }

        // Add annotations
        // if (this.stack[this.stack.length - 1]._results.length > 0) {
        if (this.results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            // for (const move of this.stack[this.stack.length - 1]._results) {
            for (const move of this.results) {
                if (move.type === "move") {
                    const [fromX, fromY] = RealmGame.algebraic2coords(move.from);
                    const [toX, toY] = RealmGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", player: 3, targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "place") {
                    const [x, y] = RealmGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                } else if ( (move.type === "capture") || (move.type === "immobilize") ) {
                    const [x, y] = RealmGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
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

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += `**Game phase:** ${this.phase}\n\n`;

        status += "**Stashes**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const stash = this.pieces[n - 1];
            if (stash === undefined) {
                throw new Error("Malformed stash.");
            }
            status += `Player ${n}: ${stash[0]} bases, ${stash[1]} powers, ${stash[2]} enforcers, ${this.captured[n - 1]} captured bases\n\n`;
        }

        status += "**Scores**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            status += `Player ${n}: ${this.getPlayerScore(n as playerid)}\n\n`;
        }

        return status;
    }

    public getPlayersScores(): IScores[] {
        return [{ name: i18next.t("apgames:status.SCORES"), scores: [this.getPlayerScore(1), this.getPlayerScore(2)] }]
    }

    protected getMoveList(): any[] {
        return this.getMovesAndResults(["move", "capture"]);
    }

    public chat(node: string[], name: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "immobilize":
                node.push(i18next.t("apresults:IMMOBILIZE.realm", {player: name, where: r.where}));
                resolved = true;
                break;
        }
        return resolved;
    }

    public getPlayerStash(player: number): IStashEntry[] | undefined {
        const stash = this.pieces[player - 1];
        if (stash !== undefined) {
            return [
                {count: stash[0], glyph: { name: "piece-square",  player }, movePart: ",1"},
                {count: stash[1], glyph: { name: "piece", player }, movePart: ",2"},
                {count: stash[2], glyph: { name: "piece-triangle",  player }, movePart: ",3"}
            ];
        }
        return;
    }

    public clone(): RealmGame {
        return new RealmGame(this.serialize());
    }
}
