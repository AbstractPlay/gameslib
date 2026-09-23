import {  GameBase, IAPGameState, IClickResult, ICustomButton, IIndividualState, IStatus, IValidationResult, type ChatLogCollectContext, type ChatLogLine } from "./_base.js";
import type { APGamesInformation } from "../schemas/gameinfo.js";
import { APRenderRep, AreaPieces, BoardBasic, Colourfuncs, Glyph } from "@abstractplay/renderer/build/schemas/schema";
import type { APMoveResult } from "../schemas/moveresults.js";
import { randomInt, RectGrid, reviver, shuffle, SquareOrthGraph, UserFacingError, cloneState } from "../common/index.js";
import i18next from "i18next";
import { arrowToken, captureToken, isArrow, isLegacy, isMark, isHold, joinMove, normalize, parseMove, pieceChar, holdToken, tokenText, NotationError, type ParsedMove, type Token } from "./arimaa/notation.js";
import { hasAnyMove, inferred, resolve, serializeTurn, sqName, turnFromSteps, type Turn } from "./arimaa/turns.js";

export type playerid = 1|2;
export type Piece = "E" | "M" | "H" | "D" | "C" | "R";
export type CellContents = [Piece, playerid];

export const pc2name = new Map<Piece, string>([
    ["E", "Elephant"],
    ["M", "Camel"],
    ["H", "Horse"],
    ["D", "Dog"],
    ["C", "Cat"],
    ["R", "Rabbit"],
]);
const traps = ["f3", "f6", "c3", "c6"];

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, CellContents>;
    lastmove?: string;
    hands?: [Piece[], Piece[]];
};

export interface IArimaaState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

interface ILegendObj {
    [key: string]: Glyph|[Glyph, ...Glyph[]];
}

function isLower(character: string): boolean {
  return character === character.toLowerCase() && character !== character.toUpperCase();
}

export class ArimaaGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Arimaa",
        uid: "arimaa",
        playercounts: [2],
        version: "20251223",
        dateAdded: "2026-01-23",
        // i18next.t("apgames:descriptions.arimaa")
        description: "apgames:descriptions.arimaa",
        // i18next.t("apgames:notes.arimaa")
        notes: "apgames:notes.arimaa",
        urls: [
            "https://arimaa.com/arimaa/",
            "https://arimaa.com/arimaa/learn/rulesIntro.html",
            "https://boardgamegeek.com/boardgame/4616/arimaa",
        ],
        bggid: "4616",
        people: [
            {
                type: "designer",
                name: "Aamir Syed",
            },
            {
                type: "designer",
                name: "Omar Syed"
            },
            {
                type: "coder",
                name: "Aaron Dalton (Perlkönig)",
                urls: [],
                apid: "124dd3ce-b309-4d14-9c8e-856e56241dfe",
            },
        ],
        variants: [
            { uid: "eee", group: "setup" },
            { uid: "free", group: "setup", unrated: true },
        ],
        customizations: [
            {
                num: 1,
                default: "#bf9212",
                explanation: "Colour of player 1 (Gold)",
                player: 1
            },
            {
                num: 2,
                default: "#989898",
                explanation: "Colour of player 2 (Silver)",
                player: 2
            },
            {
                num: 3,
                default: "35% opacity",
                explanation: "Colour of Gold's frozen pieces"
            },
            {
                num: 4,
                default: "35% opacity",
                explanation: "Colour of Silver's frozen pieces"
            },
            {
                num: 5,
                default: "black/white",
                explanation: "Gold piece stroke colour"
            },
            {
                num: 6,
                default: "black/white",
                explanation: "Silver piece stroke colour"
            },
            {
                name: "fill",
                explanation: "Traps are the `fill` colour at 50% opacity"
            },
        ],
        categories: ["goal>breakthrough", "goal>cripple", "goal>immobilize", "mechanic>capture", "mechanic>move", "mechanic>coopt", "mechanic>random>setup", "board>shape>rect", "board>connect>rect", "components>chess"],
        flags: ["perspective", "no-moves", "custom-buttons", "random-start", "custom-colours"]
    };
    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 8);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 8);
    }
    public static strength(piece: Piece): number {
        const str = "EMHDCR";
        return str.length - str.indexOf(piece);
    }
    // the two ranks a player sets up on, in the order they get auto-filled
    private static homeCells(player: playerid): string[] {
        const cells: string[] = [];
        for (const row of (player === 1 ? [6,7] : [0,1])) {
            for (let col = 0; col < 8; col++) {
                cells.push(ArimaaGame.coords2algebraic(col, row));
            }
        }
        return cells;
    }
    public static EEE(): {gold: [Piece, string][], silver: [Piece, string][]} {
        const getRanks = (ranks: number[]): string[] => {
            const cells: string[] = [];
            for (const row of ranks) {
                for (let col = 0; col < 8; col++) {
                    cells.push(ArimaaGame.coords2algebraic(col, row));
                }
            }
            return cells;
        }

        let gold: Piece[];
        do {
            gold = ["E"];
            // camels
            let limit = randomInt(1, 0);
            for (let i = 0; i < limit; i++) {
                gold.push("M");
            }
            // horses, dogs, cats
            for (const pc of ["H","D","C"] as const) {
                limit = randomInt(2, 0);
                for (let i = 0; i < limit; i++) {
                    gold.push(pc);
                }
            }
            // rabbits
            limit = randomInt(8, 1);
            for (let i = 0; i < limit; i++) {
                gold.push("R");
            }
        } while (gold.length < 4 || gold.length > 12);
        const cellsGold = shuffle(getRanks([6,7]));
        const combinedGold: [Piece, string][] = [];
        for (let i = 0; i < gold.length; i++) {
            combinedGold.push([gold[i], cellsGold[i]]);
        }
        const flip = randomInt(1, 0);
        const combinedSilver: [Piece, string][] = [];
        combinedGold.forEach(([pc, cell]) => {
            const [col, row] = ArimaaGame.algebraic2coords(cell);
            // rows reverse no matter what
            let newRow: number;
            if (row === 6) {
                newRow = 1;
            } else {
                newRow = 0;
            }
            // reverse columns only if flip is 1
            let newCol = col;
            if (flip === 1) {
                newCol = 7 - col;
            }
            combinedSilver.push([pc, ArimaaGame.coords2algebraic(newCol, newRow)]);
        });
        return {gold: combinedGold, silver: combinedSilver};
    }

    // strip any parentheticals and just return the base move
    private static baseMove(mv: string): [Piece, playerid, string?, string?] {
        mv = mv.replace(/\s+/g, "");
        const idx = mv.indexOf("(");
        let base = mv;
        if (idx >= 0) {
            base = mv.slice(0, idx);
        }
        const pcStr = base[0];
        let player: playerid;
        if (isLower(pcStr)) {
            player = 2;
        } else {
            player = 1;
        }
        const pc = pcStr.toUpperCase() as Piece;
        let from: string|undefined;
        if (base.length > 1) {
            from = base.substring(1,3);
        }
        let to: string|undefined;
        if (base.length > 3) {
            to = base.substring(3);
        }
        return [pc, player, from, to];
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, CellContents>;
    public hands?: [Piece[], Piece[]];
    public lastmove?: string;
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private _selected: string|undefined;
    // the player's arrows, kept for drawing when they do not yet resolve to a move
    private _arrows: Array<[string, string]>|undefined;
    // the squares of the player's holds and capture marks, drawn whether or not the move resolves
    private _holds: string[]|undefined;
    private _marks: string[]|undefined;

    constructor(state?: IArimaaState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined) {
                this.variants = [...variants];
            }

            const board = new Map<string, CellContents>();
            let hands: [Piece[], Piece[]]|undefined;
            if (this.variants.includes("eee")) {
                const {gold, silver} = ArimaaGame.EEE();
                for (const [pc, cell] of gold) {
                    board.set(cell, [pc, 1]);
                }
                for (const [pc, cell] of silver) {
                    board.set(cell, [pc, 2]);
                }
            } else if (this.variants.includes("free")) {
                hands = [["E", "M", "H", "D", "C", "R"], ["E", "M", "H", "D", "C", "R"]]
            } else {
                hands = [
                    ["E", "M", "H", "H", "D", "D", "C", "C", "R", "R", "R", "R", "R", "R", "R", "R"],
                    ["E", "M", "H", "H", "D", "D", "C", "C", "R", "R", "R", "R", "R", "R", "R", "R"]
                ];
            }

            const fresh: IMoveState = {
                _version: ArimaaGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer: 1,
                board,
                hands,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IArimaaState;
            }
            if (state.game !== ArimaaGame.gameinfo.uid) {
                throw new Error(`The Arimaa engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): ArimaaGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = cloneState(state.board);
        this.lastmove = state.lastmove;
        this.hands = cloneState(state.hands);
        this.results = [...state._results];
        // what a turn did is drawn from its results; anything left over from a
        // partial move belongs to the entry being typed, not to this state
        this._selected = undefined;
        this._arrows = undefined;
        this._holds = undefined;
        this._marks = undefined;
        return this;
    }

    public getButtons(): ICustomButton[] {
        // base game, gold setup
        if (this.variants.length === 0 && this.stack.length === 1) {
            return [
                {
                    label: "arimaa.gold99",
                    move: "Ee2,Md2,Hb2,Hg2,Ra2,Ra1,Rb1,Rc1,Rf1,Rg1,Rh1,Rh2"
                }
            ];
        }
        // base game, silver setup
        else if (this.variants.length === 0 && this.stack.length === 2) {
            return [
                {
                    label: "arimaa.silver99e7",
                    move: "ee7,md7,hb7,hg7,ra7,ra8,rb8,rc8,rf8,rg8,rh8,rh7"
                },
                {
                    label: "arimaa.silver99d7",
                    move: "ed7,me7,hb7,hg7,ra7,ra8,rb8,rc8,rf8,rg8,rh8,rh7"
                },
            ];
        }
        return [];
    }

    // In standard setup, a player only needs to place their eight non-rabbits.
    // Once they have, the rest of their setup area gets filled with rabbits.
    // Returns the move untouched in every other circumstance.
    private fillRabbits(m: string): string {
        if (this.variants.length > 0 || this.hands === undefined || this.hands[this.currplayer - 1].length === 0) {
            return m;
        }
        const mvs = m.split(",").filter(Boolean);
        const steps = mvs.map(mv => ArimaaGame.baseMove(mv));
        const myhand = [...this.hands[this.currplayer - 1]];
        for (const [pc, , cell] of steps) {
            // a dangling piece selection or anything the validator will reject
            if (cell === undefined || !myhand.includes(pc)) {
                return m;
            }
            myhand.splice(myhand.indexOf(pc), 1);
        }
        // everything but the rabbits has to be placed already
        if (myhand.length === 0 || myhand.some(pc => pc !== "R")) {
            return m;
        }
        const placedCells = new Set<string>(steps.map(([,,cell,]) => cell!));
        const empty = ArimaaGame.homeCells(this.currplayer).filter(cell => !this.board.has(cell) && !placedCells.has(cell));
        if (empty.length !== myhand.length) {
            return m;
        }
        return [...mvs, ...empty.map(cell => `${this.currplayer === 1 ? "R" : "r"}${cell}`)].join(",");
    }

    // A very niche helper function to fix the "can't push pull at same time" issue
    // Looks at each move in a chain and determines the nature of each.
    // Naive. Just looks at the notation and sequence, not board context.
    public static classify(player: playerid, moves: string[]): ("placement"|"pusher"|"puller"|"pushee"|"pullee"|"mover"|undefined)[] {
        const classifications: ("placement"|"pusher"|"puller"|"pushee"|"pullee"|"mover"|undefined)[] = [];

        for (let i = 0; i < moves.length; i++) {
            const [, owner, from, to] = ArimaaGame.baseMove(moves[i]);
            // if mine:
            // - placement if to is undefined
            // - pusher if previous was pushed
            // - puller if next is enemy and moves into vacated space
            // - mover otherwise
            if (owner === player) {
                if (to === undefined) {
                    classifications.push("placement");
                } else if (i > 0 && classifications[i - 1] === "pushee") {
                    classifications.push("pusher");
                } else {
                    if (i < moves.length - 1) {
                        const [, nextOwner, , nextTo] = ArimaaGame.baseMove(moves[i + 1]);
                        if (nextOwner !== player && nextTo === from) {
                            classifications.push("puller");
                        } else {
                            classifications.push("mover");
                        }
                    } else {
                        classifications.push("mover");
                    }
                }
            }
            // if other:
            // - pullee if previous is puller
            // - pushee if previous is not puller and next is mine moving into space
            // - undefined otherwise
            else {
                if (i > 0 && classifications[i - 1] === "puller") {
                    classifications.push("pullee");
                } else {
                    if (i < moves.length - 1) {
                        const [, nextOwner, , nextTo] = ArimaaGame.baseMove(moves[i + 1]);
                        if (nextOwner === player && nextTo === from) {
                            classifications.push("pushee");
                        } else {
                            classifications.push(undefined);
                        }
                    } else {
                        classifications.push(undefined);
                    }
                }
            }
        }

        return classifications;
    }

    private isFrozen(cell: string): boolean {
        const g = new SquareOrthGraph(8, 8);
        if (!this.board.has(cell)) {
            throw new Error("You can't check the frozen status of a nonexistent piece.");
        }
        const [pc, owner] = this.board.get(cell)!;
        const friendlies: Piece[] = [];
        const enemies: Piece[] = [];
        for (const n of g.neighbours(cell)) {
            if (this.board.has(n)) {
                const [nPc, nOwner] = this.board.get(n)!;
                if (nOwner === owner) {
                    friendlies.push(nPc);
                } else {
                    enemies.push(nPc);
                }
            }
        }
        // only ever frozen if no friendlies and at least one stronger enemy
        if (friendlies.length === 0) {
            for (const enemy of enemies) {
                if (ArimaaGame.strength(enemy) > ArimaaGame.strength(pc)) {
                    return true;
                }
            }
        }
        // otherwise free
        return false;
    }

    private isAlone(cell: string): boolean {
        if (this.board.has(cell)) {
            const [, owner] = this.board.get(cell)!;
            const g = new SquareOrthGraph(8, 8);
            for (const n of g.neighbours(cell)) {
                if (this.board.has(n)) {
                    const [, nOwner] = this.board.get(n)!;
                    if (nOwner === owner) {
                        return false;
                    }
                }
            }
        }
        return true;
    }

    // chains together a random series of moves
    // won't always take the maximum number of legal moves
    // public randomMove(): string {
    //     const moves = this.moves();
    //     return moves[Math.floor(Math.random() * moves.length)];
    // }

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            // placing pieces:
            // - either still pieces in hand
            // - or we're in standard setup and ply 1 or 2, no matter the hands
            const placing = (this.hands !== undefined && this.hands[this.currplayer - 1].length > 0) ||
                (this.variants.length === 0 && this.stack.length <= 2);
            const newmove = placing ? this.setupClick(move, row, col, piece) : this.moveClick(move, row, col);
            let result = this.validateMove(newmove) as IClickResult;
            if (! result.valid) {
                result.move = move;
            } else {
                if (result.autocomplete !== undefined) {
                    const automove = result.autocomplete;
                    result = this.validateMove(automove) as IClickResult;
                    result.move = automove;
                } else {
                    result.move = newmove;
                }
            }
            return result;
        } catch (e) {
            // console.log(e);
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", {move, row, col, piece, emessage: (e as Error).message})
            }
        }
    }

    // Setup clicks work on the comma-separated placement list.
    private setupClick(move: string, row: number, col: number, piece?: string): string {
            let newmove = "";
            const steps = move.split(",").filter(Boolean).map(mv => ArimaaGame.baseMove(mv));
            let lastPc: Piece|undefined;
            let lastPlayer: playerid|undefined;
            let lastFrom: string|undefined;
            let lastTo: string|undefined;
            if (steps.length > 0) {
                [lastPc,lastPlayer,lastFrom,lastTo] = steps[steps.length - 1];
            }
            let lastmove = "";
            let stub = move;
            if (steps.length > 0) {
                // set lastmove and stub if move is incomplete
                // placement
                if (this.hands !== undefined && this.hands[this.currplayer - 1].length > 0 && lastFrom === undefined) {
                    lastmove = this.currplayer === 1 ? lastPc! : lastPc!.toLowerCase();
                    stub = move.substring(0, move.lastIndexOf(","));
                }
                // movement
                else if ((this.hands === undefined || this.hands[this.currplayer - 1].length === 0) && (lastFrom !== undefined && lastTo === undefined) ) {
                    lastmove = `${lastPlayer === 1 ? lastPc : lastPc!.toLowerCase()}${lastFrom}`;
                    stub = move.substring(0, move.lastIndexOf(","));
                }
            }
            // console.log(JSON.stringify({move, lastPc, lastFrom, lastTo, lastmove, stub}));
            // make the moves in the stub
            const cloned = this.clone();
            cloned.move(stub, {partial: true});

            // clicking off the board resets
            if (row === -1 || col === -1) {
                const [,pc, pstr] = piece!.split("");
                const p = parseInt(pstr, 10);
                newmove = `${stub}${stub.length > 0 ? "," : ""}${p === 1 ? pc : pc.toLowerCase()}`;
            } else {
                const cell = ArimaaGame.coords2algebraic(col, row);
                // clicking a placed cell unplaces it
                if (cloned.board.has(cell)) {
                    // clicking an occupied cell after selecting a piece to place
                    if (lastmove.length === 0) {
                        const idx = steps.findIndex(([pc,,f,]) => pc === piece![0] && f === cell);
                        if (idx >= 0) {
                            steps.splice(idx, 1);
                            newmove = steps.map(([pc, p, f,]) => `${p === 1 ? pc : pc.toLowerCase()}${f}`).join(",");
                        } else {
                            newmove = stub;
                        }
                    } else {
                        newmove = stub;
                    }
                } else {
                    // if just clicking directly on the board, choose a piece for them:
                    // in free setup the hand never empties, so default to a rabbit;
                    // otherwise take the strongest piece still in hand
                    if (lastmove === undefined || lastmove === "") {
                        let dflt: Piece;
                        if (this.variants.includes("free")) {
                            dflt = "R";
                        } else {
                            dflt = [...cloned.hands![cloned.currplayer - 1]].sort((a,b) => ArimaaGame.strength(b) - ArimaaGame.strength(a))[0];
                        }
                        lastmove = cloned.currplayer === 1 ? dflt : dflt.toLowerCase();
                    }
                    newmove = `${stub}${stub.length > 0 ? "," : ""}${lastmove}${cell}`;
                }
            }
        
        return newmove;
    }

    // Movement clicks work on the drawn tokens; the rules are in the branch
    // comments below. The move string holds destination tokens (arrows, and
    // holds: a piece sent to its own square), capture marks (a hold on a trap,
    // clicked once more), anything typed, and at most two trailing bare
    // squares: the selected piece awaiting a destination and, before it, the
    // selection that a second click on the current one completes an arrow from.
    private moveClick(move: string, row: number, col: number): string {
        let parsed: ParsedMove;
        try {
            parsed = parseMove(move, true);
        } catch {
            // unreadable typed input: start over from this click
            parsed = {tokens: []};
        }
        const clicked = ArimaaGame.coords2algebraic(col, row);
        const drawn = parsed.tokens.filter(t => isArrow(t) || isHold(t) || isMark(t));
        const others = parsed.tokens.filter(t => !drawn.includes(t));
        let pending = parsed.pending;
        let previous = parsed.previous;
        const tailOf = (sq: string): number => drawn.findIndex(t => isArrow(t) && t.spec.square === sq);
        const headOf = (sq: string): number => drawn.findIndex(t => isArrow(t) && (t.prop as {square: string}).square === sq);
        // every arrow ending on this square, latest first: more than one piece
        // can finish on a trap, the ones that died there and at most one alive
        const headsOf = (sq: string): Token[] => drawn.filter(t => isArrow(t) && (t.prop as {square: string}).square === sq).reverse();
        const holdOf = (sq: string): number => drawn.findIndex(t => isHold(t) && t.spec.square === sq);
        const markOf = (sq: string): number => drawn.findIndex(t => isMark(t) && t.spec.square === sq);
        // occupancy is judged at the start of the turn; a square whose piece
        // already has an arrow away from it counts as vacated
        const unvacatedPiece = (sq: string): boolean => this.board.has(sq) && tailOf(sq) < 0;
        const mkArrow = (from: string, to: string): Token => {
            const [pc, owner] = this.board.get(from)!;
            return arrowToken(pc, owner, from, to);
        };
        // a capture asserted of an arrow's piece rides with that arrow: it says
        // the piece dies where the arrow sends it, so it goes when the arrow does
        const dropMark = (origin: string): void => {
            const m = markOf(origin);
            if (m >= 0) {
                drawn.splice(m, 1);
            }
        };
        // send what is selected at `from` to `to`: a new arrow from a piece's
        // square, or the extension of the arrow whose head was re-opened
        const complete = (from: string, to: string): void => {
            if (unvacatedPiece(from)) {
                drawn.push(mkArrow(from, to));
                return;
            }
            const h = headOf(from);
            if (h >= 0) {
                const tail = drawn[h].spec.square!;
                dropMark(tail);
                if (tail === to) {
                    drawn.splice(headOf(from), 1);
                } else {
                    drawn[headOf(from)] = mkArrow(tail, to);
                }
            }
        };

        if (pending !== undefined) {
            if (clicked === pending) {
                if (previous !== undefined) {
                    // the second click on an occupied square sends the
                    // selection before it there; its occupant will have to move
                    complete(previous, clicked);
                } else if (traps.includes(clicked) && headOf(clicked) >= 0) {
                    // the second click on an arrow's head, when that head is a
                    // trap, says the piece dies there rather than surviving on
                    // it; the arrow stays, because it says which trap. This
                    // comes before holding, because whatever still stands on
                    // the trap cannot survive alongside what is arriving. The
                    // claim falls on the last arrow drawn to that trap that
                    // does not carry one yet, and once they all do, clicking
                    // again takes them all back.
                    const heads = headsOf(clicked);
                    const next = heads.find(t => markOf(t.spec.square!) < 0);
                    if (next === undefined) {
                        for (const t of heads) {
                            dropMark(t.spec.square!);
                        }
                    } else {
                        const [pc, owner] = this.board.get(next.spec.square!)!;
                        drawn.push(captureToken(pc, owner, next.spec.square!));
                    }
                } else if (unvacatedPiece(clicked) && holdOf(clicked) < 0 && markOf(clicked) < 0) {
                    // the second click on a selected piece holds it where it stands
                    const [pc, owner] = this.board.get(clicked)!;
                    drawn.push(holdToken(pc, owner, clicked));
                }
                // a re-opened arrow head is simply released
                pending = undefined;
                previous = undefined;
            } else if (unvacatedPiece(clicked)) {
                // re-selection rather than a destination; the selection it
                // replaces is kept in case the next click confirms this square
                previous = unvacatedPiece(pending) || headOf(pending) >= 0 ? pending : undefined;
                pending = clicked;
            } else {
                complete(pending, clicked);
                pending = undefined;
                previous = undefined;
            }
        } else {
            const t = tailOf(clicked);
            const p = holdOf(clicked);
            if (t >= 0) {
                // grabbing an arrow's tail removes it and starts a new one
                dropMark(clicked);
                drawn.splice(tailOf(clicked), 1);
                pending = clicked;
            } else if (p >= 0 && traps.includes(clicked)) {
                // on a trap a hold cannot tell survival from capture, so a
                // click on it turns the hold into a capture mark
                const [pc, owner] = this.board.get(clicked)!;
                drawn[p] = captureToken(pc, owner, clicked);
            } else if (p >= 0 || markOf(clicked) >= 0) {
                // a hold or a capture mark is lifted like an arrow's tail
                drawn.splice(p >= 0 ? p : markOf(clicked), 1);
                pending = clicked;
            } else if (this.board.has(clicked) || headOf(clicked) >= 0) {
                pending = clicked;
            } else {
                return move;
            }
        }
        return joinMove([...others, ...drawn], pending, previous);
    }

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        const setup = this.hands !== undefined && this.hands[this.currplayer - 1].length > 0;
        // placement and legacy step lists ignore whitespace; the notation is space-delimited
        if (setup || isLegacy(m)) {
            m = m.replace(/\s+/g, "");
        } else {
            m = normalize(m);
        }

        if (m.length === 0) {
            result.valid = true;
            result.complete = -1;
            // if in the setup phase, we need canrender, otherwise don't
            result.canrender = false;
            if (!this.variants.includes("eee") && this.stack.length <= 2) {
                result.canrender = true;
            }
            result.canrender = true;
            result.message = i18next.t("apgames:validation.arimaa.INITIAL_INSTRUCTIONS", {context: (this.hands !== undefined && this.hands[this.currplayer - 1].length > 0) ? "place" : "play"});
            return result;
        }

        if (setup) {
            return this.validateSetup(m);
        }
        if (isLegacy(m)) {
            return this.validateLegacyMovement(m);
        }
        return this.validateNotation(m);
    }

    private validateSetup(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        const g = new SquareOrthGraph(8, 8);
        // capture tokens written at the end of free setup carry no instruction
        const steps = m.split(",").filter(Boolean).filter(mv => !mv.startsWith("x")).map(mv => ArimaaGame.baseMove(mv));
            const cloned = this.clone();
            const myhand = [...cloned.hands![cloned.currplayer - 1]];
            for (const [pc, , cell] of steps) {
                // must have pc in hand
                if (!myhand.includes(pc)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.arimaa.NOPIECE", {piece: pc2name.get(pc)});
                    return result;
                }
                if (cell !== undefined) {
                    // cell must be valid
                    try {
                        ArimaaGame.algebraic2coords(cell);
                    } catch {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                        return result;
                    }
                    // cell must be empty, including of anything placed earlier in this move
                    if (cloned.board.has(cell)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: cell});
                        return result;
                    }
                    // in normal play, must be on home ranks
                    if (!this.variants.includes("free")) {
                        const homeRows = this.currplayer === 1 ? [6,7] : [0,1];
                        const [,y] = ArimaaGame.algebraic2coords(cell);
                        if (!homeRows.includes(y)) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.arimaa.HOME_ROW");
                            return result;
                        }
                    }
                    // fake place the piece
                    cloned.board.set(cell, [pc, cloned.currplayer]);
                    // remove the piece from the hand unless in free mode
                    if (!this.variants.includes("free")) {
                        myhand.splice(myhand.indexOf(pc), 1);
                    }
                }
                // if it's just a piece number, we need a cell
                else {
                    result.valid = true;
                    result.complete = -1;
                    result.message = i18next.t("apgames:validation.arimaa.PARTIAL_PLACE");
                    return result;
                }
            }

            // if we've gotten this far, everything is valid
            // now we just have to check completeness and return
            let complete: -1|0|1;
            let message: string;
            // in free mode:
            // - usually 0 with specific message
            // - but must have 1 rabbit and none on the goal row
            if (this.variants.includes("free")) {
                const rabbits = [...cloned.board.entries()].filter(e => e[1][1] === cloned.currplayer && e[1][0] === "R").map(e => e[0]);
                const goal = cloned.currplayer === 1 ? "8" : "1";
                if (rabbits.length === 0 || rabbits.filter(cell => cell.endsWith(goal)).length > 0) {
                    complete = -1;
                    message = i18next.t("apgames:validation.arimaa.PARTIAL_FREE_NO")
                } else {
                    complete = 0;
                    message = i18next.t("apgames:validation.arimaa.PARTIAL_FREE")
                }
            }
            // otherwise, you have to place all your pieces,
            // though the rabbits can be filled in for you
            else {
                const emptyHome = ArimaaGame.homeCells(cloned.currplayer).filter(c => !cloned.board.has(c));
                const autoRabbits = myhand.length > 0 && myhand.every(pc => pc === "R") && emptyHome.length === myhand.length;
                if (myhand.length > 0 && !autoRabbits) {
                    complete = -1;
                    message = i18next.t("apgames:validation.arimaa.PARTIAL_PLAY")
                } else {
                    // fake place the rabbits so the advice below sees the real setup
                    if (autoRabbits) {
                        for (const cell of emptyHome) {
                            cloned.board.set(cell, ["R", cloned.currplayer]);
                        }
                    }
                    // warnings go here
                    const warnings: string[] = [];
                    // same file (only silver)
                    if (this.currplayer === 2) {
                        const [e1, e2] = [...cloned.board.entries()].filter(e => e[1][0] === "E").map(e => e[0][0]);
                        if (e1 === e2) {
                            warnings.push(i18next.t("apgames:validation.arimaa.WARN_FILE") || "WARN");
                        }
                    }
                    // unbalanced (gold and silver)
                    const majors = [...cloned.board.entries()].filter(e => e[1][1] === this.currplayer && ["E", "M", "H"].includes(e[1][0])).map(e => ArimaaGame.algebraic2coords(e[0])[0]);
                    const oneSide = majors.filter(n => n < 5).length;
                    if (oneSide === 0 || oneSide === 4) {
                        warnings.push(i18next.t("apgames:validation.arimaa.WARN_BALANCE") || "WARN");
                    }
                    // hiding (gold and silver)
                    const frontRow = this.currplayer === 1 ? 6 : 1;
                    const backRow = this.currplayer === 1 ? 7 : 0;
                    for (let col = 0; col < 8; col++) {
                        const frontCell = g.coords2algebraic(col, frontRow);
                        const backCell = g.coords2algebraic(col, backRow);
                        const front = cloned.board.get(frontCell)![0];
                        const back = cloned.board.get(backCell)![0];
                        if (ArimaaGame.strength(front) < ArimaaGame.strength(back)) {
                            if (front !== "R" && back !== "C") {
                                warnings.push(i18next.t("apgames:validation.arimaa.WARN_HIDE") || "WARN");
                                break;
                            }
                        }
                    }
                    if (warnings.length > 0) {
                        complete = 0;
                        message = [i18next.t("apgames:validation.arimaa.WARNINGS"), ...warnings].join(" ");
                    } else {
                        // complete is never 1 for setup
                        complete = 0;
                        message = i18next.t("apgames:validation._general.VALID_MOVE")
                    }
                    if (autoRabbits) {
                        message = [i18next.t("apgames:validation.arimaa.PARTIAL_RABBITS"), message].join(" ");
                    }
                }
            }

            result.valid = true;
            result.canrender = true;
            result.complete = complete;
            result.message = message;
            return result;
        
    }

    // The pre-notation movement grammar: comma-separated `<piece><from><to>`
    // steps with optional capture parentheticals. Kept verbatim so every
    // historical move string still validates exactly as it did.
    private validateLegacyMovement(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        const g = new SquareOrthGraph(8, 8);
        // This validator once had two lapses: a push completed by a piece of
        // equal strength when a stronger one was also adjacent, and a pull that
        // moved the pulled piece somewhere other than the square the puller
        // vacated. Both are rejected here, so no new move can use them. A few
        // recorded games contain such a move; they replay through `trusted`,
        // which skips validation entirely, so no saved game is disturbed.
        const classifications = ArimaaGame.classify(this.currplayer, m.split(",").filter(Boolean));
        const steps = m.split(",").filter(Boolean).map(mv => ArimaaGame.baseMove(mv));
            // can't make too many moves
            let maxMoves = 4;
            if (this.variants.includes("eee") && this.stack.length === 1) {
                maxMoves = 2;
            }
            if (steps.length > maxMoves) {
                result.valid = false;
                result.message = i18next.t("apgames:validation.arimaa.TOO_MANY", {num: maxMoves});
                return result;
            }
            const cloned = this.clone();
            // pushPending is used to make sure pushes are completed
            let pushPending = false;
            // validate each step
            for (let i = 0; i < steps.length; i++) {
                const [pc, owner, from, to] = steps[i];
                // console.log(JSON.stringify({pc, owner, from, to}));
                // validate from first
                if (from === undefined) {
                    throw new Error("From should never be undefined at this point.");
                }
                // valid cell
                try {
                    ArimaaGame.algebraic2coords(from);
                } catch {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: from});
                    return result;
                }
                // from contents match
                if (!cloned.board.has(from) || cloned.board.get(from)![0] !== pc || cloned.board.get(from)![1] !== owner) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.NONEXISTENT");
                    return result;
                }
                // if it's your piece, it can't be frozen
                if (owner === cloned.currplayer && cloned.isFrozen(from)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.arimaa.FROZEN", {where: from});
                    return result;
                }
                // if a push is pending, then this move *must* be completing the push
                if (pushPending) {
                    const [lastPc, lastPlayer, lastFrom] = steps[i - 1];
                    // lastPlayer must be the enemy
                    // from must be adjacent to lastFrom
                    // to must equal lastFrom
                    // pc must be stronger than lastPc
                    if (lastPlayer === cloned.currplayer || !g.neighbours(lastFrom!).includes(from) || (to !== undefined && to !== lastFrom) || ArimaaGame.strength(pc) <= ArimaaGame.strength(lastPc)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.arimaa.INVALID_PUSH", {where: from});
                        return result;
                    }
                    pushPending = false;
                    // if this is the last step, suggest an autocomplete
                    if (i === steps.length - 1 && to === undefined) {
                        result.autocomplete = m + lastFrom;
                    }
                }
                // if it's an enemy piece, it must be a push or pull
                if (owner !== cloned.currplayer) {
                    // check for pulls first
                    let validPull = false;
                    if (i > 0 && classifications[i - 1] !== "pusher") {
                        const [lastPc, lastPlayer, lastFrom] = steps[i - 1];
                        const ns = g.neighbours(from);
                        if (lastPlayer === cloned.currplayer && ns.includes(lastFrom!) && ArimaaGame.strength(lastPc) > ArimaaGame.strength(pc) && (to === undefined || to === lastFrom)) {
                            validPull = true;
                            // check if push is possible
                            let canPush = false;
                            if (i < maxMoves - 1) {
                                for (const n of g.neighbours(from)) {
                                    if (cloned.board.has(n)) {
                                        const [nPc, nOwner] = cloned.board.get(n)!;
                                        if (nOwner === cloned.currplayer && ArimaaGame.strength(nPc) > ArimaaGame.strength(pc) && !cloned.isFrozen(n)) {
                                            canPush = true;
                                            break;
                                        }
                                    }
                                }
                            }
                            // if this is the last step, suggest an autocomplete
                            if (i === steps.length - 1 && to === undefined) {
                                if (i === maxMoves - 1 || !canPush) {
                                    result.autocomplete = m + lastFrom;
                                }
                            }
                        }
                    }
                    // if there is no valid pull, then it must be a push and be completed
                    // on the next step
                    if (!validPull) {
                        pushPending = true;
                        // for it to be a valid pending push, the current player must have
                        // an unfrozen, stronger piece adjacent
                        let validPush = false;
                        for (const n of g.neighbours(from)) {
                            if (cloned.board.has(n)) {
                                const [nPc, nOwner] = cloned.board.get(n)!;
                                if (nOwner === cloned.currplayer && ArimaaGame.strength(nPc) > ArimaaGame.strength(pc) && !cloned.isFrozen(n)) {
                                    validPush = true;
                                }
                            }
                        }
                        if (!validPush) {
                            result.valid = false;
                            result.message = i18next.t("apgames:validation.arimaa.INVALID_PUSHPULL", {where: from});
                            return result;
                        }
                    }
                }

                // partial move at the end of the chain
                if (from !== undefined && to === undefined && i === steps.length - 1) {
                    result.valid = true;
                    result.complete = -1;
                    result.message = i18next.t("apgames:validation.arimaa.PARTIAL_MOVE");
                    result.canrender = true;
                    return result;
                }
                // otherwise from and to must be defined
                else if (from === undefined || to === undefined) {
                    throw new Error("From and to should never be undefined at this point.");
                }

                // to is a valid cell
                try {
                    ArimaaGame.algebraic2coords(to);
                } catch {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell: to});
                    return result;
                }
                // to is empty
                if (cloned.board.has(to)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: to});
                    return result;
                }
                // to is orthogonally adjacent
                if (!g.neighbours(from).includes(to)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.arimaa.NOT_ADJ");
                    return result;
                }
                // you can't move your own rabbits backwards
                const forbidden = cloned.currplayer === 1 ? "S" : "N";
                if (pc === "R" && owner === cloned.currplayer) {
                    const [fx, fy] = ArimaaGame.algebraic2coords(from);
                    const [tx, ty] = ArimaaGame.algebraic2coords(to);
                    const bearing = RectGrid.bearing(fx, fy, tx, ty)!;
                    if (bearing.startsWith(forbidden)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation.arimaa.BACKWARDS", {where: from});
                        return result;
                    }
                }

                // fake execute the step
                const moved = cloned.board.get(from)!;
                cloned.board.set(to, moved);
                cloned.board.delete(from);
                // check traps
                for (const trap of traps) {
                    if (cloned.board.has(trap) && cloned.isAlone(trap)) {
                        cloned.board.delete(trap);
                    }
                }
            }

            // At this point, everything is valid.
            // Verify completeness and board state repetition and return.
            // Because partial moves that are invalid can become valid with further steps,
            // we can't return `valid: false`; return `complete: -1` instead.
            let complete: -1|0|1;
            let message: string;
            // if the board position hasn't changed, then -1
            if (cloned.signature() === this.signature()) {
                complete = -1;
                message = i18next.t("apgames:validation.arimaa.NOPASS");
            }
            // if third occurrence of position, then -1
            else if (cloned.numRepeats() >= 2) {
                complete = -1;
                message = i18next.t("apgames:validation.arimaa.REPEAT");
            }
            // if a push is pending, then -1
            else if (pushPending) {
                complete = -1;
                message = i18next.t("apgames:validation.arimaa.PARTIAL_PUSH");
            }
            // if the number of moves are < max moves, then 0
            else if (steps.length < maxMoves) {
                const remaining = maxMoves - steps.length;
                complete = 0;
                message = i18next.t("apgames:validation.arimaa.PARTIAL", {count: remaining});
            }
            // otherwise we're good
            else {
                complete = 1;
                message = i18next.t("apgames:validation._general.VALID_MOVE");
            }

            result.valid = true;
            result.canrender = true;
            result.complete = complete;
            result.message = message;
            return result;
    }

    private maxSteps(): number {
        if (this.variants.includes("eee") && this.stack.length === 1) {
            return 2;
        }
        return 4;
    }

    // Steps the player's arrows must take at the very least. A piece ending on
    // a square needs a step for each square between the one it was seen on and
    // that one; pieces ending on distinct squares are distinct, so their steps
    // add up, but arrows onto one square may all describe a single piece that
    // visited every one of their squares (`Ed4g4 Ee4g4` is three steps by one
    // elephant), so a destination costs only its longest arrow. An enemy piece
    // needs two steps per square, but its partner's steps may be an arrowed
    // own piece's own steps (a pusher that follows it), so that price stands
    // alone rather than being added.
    private static arrowBudget(tokens: Token[], player: playerid): number {
        const longest = new Map<string, number>();
        let enemy = 0;
        for (const t of tokens) {
            if (t.prop.kind !== "dest" || t.spec.square === undefined || t.spec.owner === undefined) {
                continue;
            }
            const [fx, fy] = ArimaaGame.algebraic2coords(t.spec.square);
            const [tx, ty] = ArimaaGame.algebraic2coords(t.prop.square);
            const dist = Math.abs(fx - tx) + Math.abs(fy - ty);
            longest.set(t.prop.square, Math.max(longest.get(t.prop.square) ?? 0, dist));
            if (t.spec.owner !== player) {
                enemy = Math.max(enemy, 2 * dist);
            }
        }
        let sum = 0;
        for (const dist of longest.values()) {
            sum += dist;
        }
        return Math.max(sum, enemy);
    }

    private describeTrajectory(tr: Turn["trajectories"][number]): string {
        const pc = pieceChar(tr.type, tr.owner);
        if (tr.captured) {
            return `${pc}${sqName(tr.start)}x`;
        }
        return `${pc}${sqName(tr.start)}${sqName(tr.final)}`;
    }

    // Lightvector notation: resolve the tokens leniently and report: invalid for
    // unreadable or unsatisfiable input, -1 while ambiguous, selecting or
    // repeating, 1 only for a full turn with nothing inferred, otherwise 0.
    private validateNotation(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        let parsed: ParsedMove;
        try {
            parsed = parseMove(m, true);
        } catch (e) {
            result.message = i18next.t("apgames:validation.arimaa.PARSE", {token: e instanceof NotationError ? e.token : m});
            return result;
        }
        const maxMoves = this.maxSteps();
        if (ArimaaGame.arrowBudget(parsed.tokens, this.currplayer) > maxMoves) {
            result.message = i18next.t("apgames:validation.arimaa.TOO_LONG", {num: maxMoves});
            return result;
        }
        // only a selected piece so far
        if (parsed.tokens.length === 0) {
            result.valid = true;
            result.complete = -1;
            result.canrender = true;
            result.message = i18next.t("apgames:validation.arimaa.PARTIAL_MOVE");
            return result;
        }
        const r = resolve(this.board, this.currplayer, maxMoves, parsed.tokens, true);
        if (r.status === "unsatisfiable") {
            result.message = this.explainUnsatisfiable(parsed.tokens, maxMoves);
            return result;
        }
        result.valid = true;
        result.canrender = true;
        if (r.status === "ambiguous") {
            result.complete = -1;
            result.message = i18next.t("apgames:validation.arimaa.AMBIGUOUS", {count: r.positions});
            return result;
        }
        // the move is known; repetition is checked only now
        const cloned = this.clone();
        cloned.applyTurn(r.turn);
        if (cloned.numRepeats() >= 2) {
            result.complete = -1;
            result.message = i18next.t("apgames:validation.arimaa.REPEAT");
            return result;
        }
        const extra = inferred(r.turn, parsed.tokens);
        const used = r.turn.steps.length;
        const messages: string[] = [];
        if (used === maxMoves) {
            // auto-completion only when the player has seen every piece that moves
            result.complete = extra.length === 0 ? 1 : 0;
            messages.push(i18next.t("apgames:validation._general.VALID_MOVE"));
        } else {
            result.complete = 0;
            messages.push(i18next.t("apgames:validation.arimaa.PARTIAL", {count: maxMoves - used}));
        }
        if (extra.length > 0) {
            messages.push(i18next.t("apgames:validation.arimaa.INFERRED", {pieces: extra.map(tr => this.describeTrajectory(tr)).join(", ")}));
        }
        if (parsed.pending !== undefined) {
            // a selected piece never submits on its own; the hint says what a click does
            result.complete = 0;
            messages.push(i18next.t("apgames:validation.arimaa.INCOMPLETE"));
        }
        result.message = messages.join(" ");
        return result;
    }

    // Why nothing matches what was drawn. Two arrows chained through one
    // square are the old step list typed with spaces; otherwise the first
    // token that cannot be met on its own is named with the reason a player
    // can act on, and when each token can be met alone it is the combination
    // that does not fit. Only ever runs on a rejection.
    private explainUnsatisfiable(tokens: Token[], maxMoves: number): string {
        const dest = (t: Token): string|undefined => t.prop.kind === "dest" ? t.prop.square : undefined;
        for (const a of tokens) {
            const to = dest(a);
            if (to === undefined || a.spec.square === undefined || a.spec.piece === undefined) {
                continue;
            }
            const b = tokens.find(t => t !== a && t.spec.square === to && dest(t) !== undefined && (t.spec.piece === undefined || (t.spec.piece === a.spec.piece && t.spec.owner === a.spec.owner)));
            if (b !== undefined) {
                const pc = pieceChar(a.spec.piece, a.spec.owner!);
                return i18next.t("apgames:validation.arimaa.NO_MOVE_CHAIN", {first: tokenText(a), second: tokenText(b), combined: `${pc}${a.spec.square}${dest(b)}`});
            }
        }
        const culprit = tokens.length === 1 ? tokens[0] : tokens.find(t => resolve(this.board, this.currplayer, maxMoves, [t], true).status === "unsatisfiable");
        if (culprit === undefined) {
            return i18next.t("apgames:validation.arimaa.NO_MOVE_TOGETHER", {num: maxMoves});
        }
        const from = culprit.spec.square;
        const occupant = from === undefined ? undefined : this.board.get(from);
        if (from === undefined || occupant === undefined || (culprit.spec.piece !== undefined && (occupant[0] !== culprit.spec.piece || occupant[1] !== culprit.spec.owner))) {
            return i18next.t("apgames:validation.arimaa.NO_MOVE");
        }
        if (occupant[1] !== this.currplayer) {
            return i18next.t("apgames:validation.arimaa.NO_MOVE_ENEMY", {from, num: maxMoves});
        }
        const to = dest(culprit);
        if (to !== undefined && to !== from && occupant[0] === "R" && (this.currplayer === 1 ? to[1] < from[1] : to[1] > from[1])) {
            return i18next.t("apgames:validation.arimaa.BACKWARDS");
        }
        if (this.isFrozen(from)) {
            return i18next.t("apgames:validation.arimaa.NO_MOVE_FROZEN", {from});
        }
        if (to !== undefined && to !== from) {
            return i18next.t("apgames:validation.arimaa.NO_MOVE_REACH", {from, to, num: maxMoves});
        }
        return i18next.t("apgames:validation.arimaa.NO_MOVE");
    }

    public move(m: string, {trusted = false, partial = false} = {}): ArimaaGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        const setup = this.hands !== undefined && this.hands[this.currplayer - 1].length > 0;
        if (setup || isLegacy(m)) {
            m = m.replace(/\s+/g, "");
        } else {
            m = normalize(m);
        }
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
        }
        // top up a standard setup with the rabbits the player didn't place
        // (a no-op on a setup that's already complete, so replays are unaffected)
        if (!partial) {
            m = this.fillRabbits(m);
        }

        const initial = this.clone(); // used to triple check that the board state changes
        const lastmove: string[] = [];
        this.results = [];
        this._selected = undefined;
        this._arrows = undefined;
        this._holds = undefined;
        this._marks = undefined;
        if (m.length > 0) {
            if (setup) {
                lastmove.push(...this.applySetup(m));
            } else if (isLegacy(m)) {
                const {steps, legacy} = this.applyLegacy(m);
                if (!partial) {
                    // a move only the legacy validator allows keeps the legacy notation
                    lastmove.push(serializeTurn(initial.board, this.currplayer, this.maxSteps(), turnFromSteps(initial.board, this.currplayer, steps)) ?? legacy.join(", "));
                }
            } else {
                const turn = this.applyNotation(m, partial);
                if (turn !== undefined && !partial) {
                    lastmove.push(serializeTurn(initial.board, this.currplayer, this.maxSteps(), turn) ?? m);
                }
            }
        }

        if (partial) {
            return this;
        }

        // failsafe checks
        // except for "free" variant, nobody should have pieces in hand at the end of the turn
        if (!this.variants.includes("free")) {
            if (this.hands !== undefined && this.hands[this.currplayer - 1].length > 0) {
                throw new Error("Players should only have empty hands at the end of the turn.");
            }
        }
        // board position must change
        if (initial.signature() === this.signature()) {
            throw new Error("The board state must change by the end of the turn.");
        }
        // three-time repeats should not make it this far
        if (this.numRepeats() >= 2) {
            throw new Error("Three-time repeats should not make it this far.");
        }
        // but we should let players know if this position is a repeat
        if (this.numRepeats() === 1) {
            this.results.push({type: "announce", payload: ["repeat"]});
        }

        // clear hands when both are empty
        if (
            (this.hands !== undefined && this.hands[0].length === 0 && this.hands[1].length === 0) ||
            (this.variants.includes("free") && this.stack.length === 2)
        ) {
            this.hands = undefined;
        }

        // After free setup, activate all traps
        if (this.variants.includes("free") && this.stack.length === 2) {
            for (const trap of traps) {
                if (this.board.has(trap) && this.isAlone(trap)) {
                    const [trapPc, trapOwner] = this.board.get(trap)!;
                    this.board.delete(trap);
                    this.results.push({type: "destroy", what: trapOwner === 1 ? trapPc : trapPc.toLowerCase(), where: trap});
                    lastmove.push(`x${trapOwner === 1 ? trapPc : trapPc.toLowerCase()}${trap}`);
                }
            }
        }

        // update currplayer
        this.lastmove = lastmove.join(", ");
        let newplayer = (this.currplayer as number) + 1;
        if (newplayer > this.numplayers) {
            newplayer = 1;
        }
        this.currplayer = newplayer as playerid;

        this.checkEOG();
        this.saveState();
        return this;

    }


    // One step of the turn: move the piece, then resolve the traps.
    private applyStep(from: string, to: string): void {
        const moved = this.board.get(from)!;
        this.board.set(to, moved);
        this.board.delete(from);
        this.results.push({type: "move", from, to});
        for (const trap of traps) {
            if (this.board.has(trap) && this.isAlone(trap)) {
                const [trapPc, trapOwner] = this.board.get(trap)!;
                this.board.delete(trap);
                this.results.push({type: "destroy", what: trapOwner === 1 ? trapPc : trapPc.toLowerCase(), where: trap});
            }
        }
    }

    // Play out a resolved turn step by step.
    private applyTurn(turn: Turn): void {
        for (const st of turn.steps) {
            this.applyStep(sqName(st.from), sqName(st.to));
        }
    }

    // Placement: returns the notation for each piece placed.
    private applySetup(m: string): string[] {
        const parts: string[] = [];
        const steps = m.split(",").filter(Boolean).filter(mv => !mv.startsWith("x")).map(mv => ArimaaGame.baseMove(mv));
        for (let i = 0; i < steps.length; i++) {
            const [pc, , from] = steps[i];
            if (from !== undefined) {
                this.board.set(from, [pc, this.currplayer]);
                this.results.push({type: "place", what: pc, where: from});
                // update hand
                if (!this.variants.includes("free")) {
                    this.hands![this.currplayer - 1].splice(this.hands![this.currplayer - 1].indexOf(pc), 1);
                }
                parts.push(`${this.currplayer === 1 ? pc : pc.toLowerCase()}${from}`);
            } else if (i !== steps.length - 1) {
                throw new Error("Invalid placement detected in the middle of the move.");
            }
        }
        return parts;
    }

    // Legacy step list: returns the steps taken, for serialization, and each
    // step written as the pre-notation engine did (with its captures).
    private applyLegacy(m: string): {steps: Array<{from: string; to: string}>; legacy: string[]} {
        const taken: Array<{from: string; to: string}> = [];
        const legacy: string[] = [];
        const steps = m.split(",").filter(Boolean).map(mv => ArimaaGame.baseMove(mv));
        for (let i = 0; i < steps.length; i++) {
            const [pc, owner, from, to] = steps[i];
            if (from !== undefined && to !== undefined) {
                const before = this.results.length;
                this.applyStep(from, to);
                taken.push({from, to});
                const captures = this.results.slice(before).filter(r => r.type === "destroy").map(r => `(x${r.what}${r.where})`).join("");
                legacy.push(`${owner === 1 ? pc : pc.toLowerCase()}${from}${to}${captures}`);
            } else if (from !== undefined) {
                this._selected = from;
            } else if (i !== steps.length - 1) {
                throw new Error("Invalid move detected in the middle of the move.");
            }
        }
        return {steps: taken, legacy};
    }

    // Lightvector notation: resolve and play the turn. Returns nothing when a
    // partial move does not (yet) denote one; the arrows are kept for drawing.
    private applyNotation(m: string, partial: boolean): Turn|undefined {
        // a selection never blocks a submission: it is simply dropped
        const parsed = parseMove(m, true);
        this._selected = parsed.pending;
        if (parsed.tokens.length === 0) {
            return undefined;
        }
        const r = resolve(this.board, this.currplayer, this.maxSteps(), parsed.tokens, true);
        if (r.status !== "resolved") {
            if (!partial) {
                throw new UserFacingError("VALIDATION_GENERAL", i18next.t(r.status === "ambiguous" ? "apgames:validation.arimaa.AMBIGUOUS" : "apgames:validation.arimaa.NO_MOVE", {count: r.status === "ambiguous" ? r.positions : 0}));
            }
            // the move does not yet denote a turn, so draw what was entered
            this._arrows = parsed.tokens.filter(isArrow).map(t => [t.spec.square!, (t.prop as {square: string}).square]);
            this._holds = parsed.tokens.filter(isHold).map(t => t.spec.square!);
            this._marks = parsed.tokens.filter(isMark).map(t => t.spec.square!);
            return undefined;
        }
        this.applyTurn(r.turn);
        if (partial) {
            // the turn's own results draw its arrows and captures, but a held
            // piece leaves no trace in them, and the player needs to see that
            // the hold is there (a click on it lifts it)
            this._holds = parsed.tokens.filter(isHold).map(t => t.spec.square!);
        }
        return r.turn;
    }

    protected checkEOG(): ArimaaGame {
        const prevPlayer: playerid = this.currplayer === 1 ? 2 : 1;
        const prevGoal = prevPlayer === 1 ? 8 : 1;
        const currGoal = this.currplayer === 1 ? 8 : 1;

        // no checking as long as setup is in progress
        if (this.hands !== undefined && this.hands.flat().length > 0) {
            return this;
        }

        // Check if a rabbit of prevPlayer reached goal. If so prevPlayer wins.
        const prevRabbits = [...this.board.entries()].filter(e => e[1][1] === prevPlayer && e[1][0] === "R").map(e => e[0]).filter(cell => cell.endsWith(prevGoal.toString()));
        if (prevRabbits.length > 0) {
            this.gameover = true;
            this.winner = [prevPlayer];
        }
        // Check if a rabbit of currplayer reached goal. If so currplayer wins.
        if (!this.gameover) {
            const currRabbits = [...this.board.entries()].filter(e => e[1][1] === this.currplayer && e[1][0] === "R").map(e => e[0]).filter(cell => cell.endsWith(currGoal.toString()));
            if (currRabbits.length > 0) {
                this.gameover = true;
                this.winner = [this.currplayer];
            }
        }
        // Check if currplayer lost all rabbits. If so prevPlayer wins.
        if (!this.gameover) {
            const currRabbits = [...this.board.entries()].filter(e => e[1][1] === this.currplayer && e[1][0] === "R");
            if (currRabbits.length === 0) {
                this.gameover = true;
                this.winner = [prevPlayer];
            }
        }
        // Check if prevPlayer lost all rabbits. If so currplayer wins.
        if (!this.gameover) {
            const prevRabbits = [...this.board.entries()].filter(e => e[1][1] === prevPlayer && e[1][0] === "R");
            if (prevRabbits.length === 0) {
                this.gameover = true;
                this.winner = [this.currplayer];
            }
        }
        // Check if currplayer has no possible move (all pieces are frozen or have no place to move). If so prevPlayer wins.
        if (!this.gameover) {
            if (!hasAnyMove(this.board, this.currplayer)) {
                this.gameover = true;
                this.winner = [prevPlayer];
            }
        }

        // NOTE: Because we can't generate full move lists, we can't automatically detect when
        // the *only* moves that remain are illegal due to repetition. The player will just have
        // to resign. The game won't let them make the illegal move regardless.

        if (this.gameover) {
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }
        return this;
    }

    public state(): IArimaaState {
        return {
            game: ArimaaGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: ArimaaGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            hands: cloneState(this.hands),
        };
    }

    public render(): APRenderRep {
        // Build piece string
        const plst: string[] = [];
        for (let row = 0; row < 8; row++) {
            const pieces: string[] = [];
            for (let col = 0; col < 8; col++) {
                const cell = ArimaaGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const [pc, owner] = this.board.get(cell)!;
                    pieces.push(`${pc}${owner}${this.isFrozen(cell) ? "x" : ""}`);
                } else {
                    pieces.push("-");
                }
            }
            plst.push(pieces.join(","));
        }
        let pstr = plst.join("\n");
        pstr = pstr.replace(/-,-,-,-,-,-,-,-/g, "_");

        // build legend
        const legend: ILegendObj = {
            "T": {
                name: "piece",
                colour: "_context_fill",
                opacity: 0.5,
                scale: 0.75,
            }
        };
        for (const pc of pc2name.keys()) {
            const name = "arimaa-" + pc2name.get(pc)!.toLowerCase();
            for (const colour of [1, 2] as const) {
                legend[`${pc}${colour}`] = {
                    name,
                    colour: this.getPlayerColour(colour),
                    colour2: {
                        func: "custom",
                        default: {
                            func: "bestContrast",
                            bg: this.getPlayerColour(colour),
                            fg: [
                                "#fff",
                                "#000",
                            ]
                        },
                        palette: 4 + colour,
                    },
                    flipx: colour === 2 ? true : false,
                    orientation: "vertical",
                };
                legend[`${pc}${colour}x`] = [
                    {
                        name,
                        colour: {
                            func: "custom",
                            default: {
                                func: "flatten",
                                fg: this.getPlayerColour(colour),
                                bg: "_context_board",
                                opacity: 0.375,
                            },
                            palette: 2 + colour,
                        },
                        colour2: {
                            func: "custom",
                            default: {
                                func: "bestContrast",
                                bg: this.getPlayerColour(colour),
                                fg: [
                                    "#fff",
                                    "#000",
                                ]
                            },
                            palette: 4 + colour,
                        },
                        flipx: colour === 2 ? true : false,
                        orientation: "vertical",
                    },
                ];
            }
        }

        // add an area if the current player has pieces to place
        let areas: AreaPieces[]|undefined;
        if (this.hands !== undefined && this.hands[this.currplayer - 1].length > 0) {
            // add pieces to legend with wider click boxes to the legend
            for (const [key, pc] of [...Object.entries(legend)]) {
                if (key !== "T" && !Array.isArray(pc)) {
                    const newkey = `p${key}`;
                    legend[newkey] = [
                        {
                            name: "piece-square-borderless",
                            colour: "_context_background",
                        },
                        {...pc} as Glyph,
                    ];
                }
            }
            const pcs = this.hands[this.currplayer - 1].sort((a, b) => ArimaaGame.strength(b) - ArimaaGame.strength(a)).map(pc => `${pc}${this.currplayer}`);
            areas = [
                {
                    type: "pieces",
                    pieces: pcs.map(pc => `p${pc}`) as [string, ...string[]],
                    label: this.seatAreaLabel(this.currplayer, "apgames:validation.arimaa.LABEL_STASH"),
                }
            ];
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares",
                width: 8,
                height: 8,
                markers: [
                    {
                        type: "glyph",
                        glyph: "T",
                        points: [
                            {
                                col: 2,
                                row: 2
                            },
                            {
                                col: 5,
                                row: 2
                            },
                            {
                                col: 2,
                                row: 5
                            },
                            {
                                col: 5,
                                row: 5
                            }
                        ]
                    },
                    {
                        type: "edge",
                        colour: this.getPlayerColour(1),
                        edge: "S",
                    },
                    {
                        type: "edge",
                        colour: this.getPlayerColour(2),
                        edge: "N",
                    }
                ]
            },
            legend,
            pieces: pstr,
            areas,
        };

        // Add annotations: one arrow per piece from where it started the turn
        // to where it ended up, the enter glyph for a piece back where it began,
        // and the exit glyph on a trap that claimed a piece
        rep.annotations = [];
        const point = (cell: string): {row: number; col: number} => {
            const [x, y] = ArimaaGame.algebraic2coords(cell);
            return {row: y, col: x};
        };
        const entered = new Set<string>();
        const exited = new Set<string>();
        for (const tr of ArimaaGame.trajectoriesFromResults(this.results)) {
            if (tr.start !== tr.final) {
                rep.annotations.push({type: "move", targets: [point(tr.start), point(tr.final)]});
            }
            if (tr.captured) {
                rep.annotations.push({type: "exit", targets: [point(tr.final)]});
                exited.add(tr.final);
            } else if (tr.start === tr.final) {
                rep.annotations.push({type: "enter", targets: [point(tr.start)]});
                entered.add(tr.start);
            }
        }
        for (const r of this.results) {
            if (r.type === "place") {
                rep.annotations.push({type: "enter", targets: [point(r.where!)]});
            }
        }
        // arrows that do not yet denote a move are still shown
        if (this._arrows !== undefined) {
            for (const [from, to] of this._arrows) {
                rep.annotations.push({type: "move", targets: [point(from), point(to)]});
            }
        }
        // holds are drawn as the piece entering its own square, capture marks as it leaving
        if (this._holds !== undefined) {
            for (const sq of this._holds) {
                if (!entered.has(sq) && !exited.has(sq)) {
                    rep.annotations.push({type: "enter", targets: [point(sq)]});
                    entered.add(sq);
                }
            }
        }
        if (this._marks !== undefined) {
            for (const sq of this._marks) {
                if (!exited.has(sq)) {
                    rep.annotations.push({type: "exit", targets: [point(sq)]});
                    exited.add(sq);
                }
            }
        }
        // show selected piece if present
        if (this._selected !== undefined) {
            const [x, y] = ArimaaGame.algebraic2coords(this._selected);
            (rep.board as BoardBasic).markers!.push({
                type: "flood",
                colour: this.getPlayerColour(this.currplayer),
                opacity: 0.25,
                points: [{row: y, col: x}],
            });
            // rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
        }
        if (rep.annotations.length === 0) {
            delete rep.annotations;
        }

        return rep;
    }

    public harlog(): number {
        let score = 0;

        const Q = 1.447530126;
        const G = 0.6314442034;
        const C = 7.995516184;

        const gold = [...this.board.entries()].filter(e => e[1][1] === 1).map(e => ArimaaGame.strength(e[1][0]));
        const silver = [...this.board.entries()].filter(e => e[1][1] === 2).map(e => ArimaaGame.strength(e[1][0]));

        for (const colour of ["gold", "silver"]) {
            const mine = colour === "gold" ? gold : silver;
            const theirs = colour === "gold" ? silver : gold;
            for (const str of [2,3,4,5,6]) {
                const num = mine.filter(n => n === str).length;
                const stronger = theirs.filter(n => n > str).length;
                if (stronger === 0) {
                    score += ((2 / Q) * num) * (colour === "gold" ? 1 : -1);
                } else {
                    score += ((1 / (Q + stronger)) * num) * (colour === "gold" ? 1 : -1);
                }
            }
            const rabbits = mine.filter(n => n === 1).length;
            score += (G * Math.log(rabbits * mine.length)) * (colour === "gold" ? 1 : -1);
        }

        return score * C;
    }

    public sidebarStatuses(): IStatus[] {
        return [{ key: this.neutralAreaLabel("apgames:status.arimaa.HARLOG"), value: [this.harlog().toFixed(2)] } as IStatus];
    }


    public collectChatLogLine(lines: ChatLogLine[], r: APMoveResult, ctx: ChatLogCollectContext): boolean {
        switch (r.type) {
            case "place":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:PLACE.complete", {what: pc2name.get(r.what! as Piece)!, where: r.where!});
                return true;
            case "move":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:MOVE.nowhat", {from: r.from!, to: r.to!});
                return true;
            case "destroy":
                this.pushNeutralChatLine(lines, "apresults:DESTROY.arimaa", {colour: isLower(r.what!) ? "silver" : "gold", what: pc2name.get(r.what!.toUpperCase() as Piece)!, where: r.where!});
                return true;
            case "announce":
                this.pushNeutralChatLine(lines, "apresults:ANNOUNCE.arimaa");
                return true;
            default:
                return super.collectChatLogLine(lines, r, ctx);
        }
    }


    public clone(): ArimaaGame {
        const cloned = Object.assign(new ArimaaGame(), cloneState(this) as ArimaaGame);
        return cloned;
    }

    // reduce a board position to a unique string representation for comparison
    public signature(board?: Map<string, CellContents>): string {
        if (board === undefined) {
            board = this.board;
        }
        let sig = "";
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const cell = ArimaaGame.coords2algebraic(col, row);
                if (board.has(cell)) {
                    const [pc, owner] = board.get(cell)!;
                    sig += owner === 1 ? pc : pc.toLowerCase();
                } else {
                    sig += "-";
                }
            }
        }
        return sig;
    }

    // tells you how many times the current, UNPUSHED board position has been
    // repeated in the stack
    public numRepeats(): number {
        let num = 0;
        const sigCurr = this.signature();
        const parityCurr = this.stack.length % 2 === 0 ? "even" : "odd";
        for (let i = 0; i < this.stack.length; i++) {
            const parity = i % 2 === 0 ? "even" : "odd";
            const sig = this.signature(this.stack[i].board);
            if (sig === sigCurr && parity === parityCurr) {
                num++;
            }
        }
        return num;
    }

    // Many spellings denote one move, and case carries colour, so compare the
    // positions the two strings reach from the state before move1. Both are
    // moves that were played, so they are replayed trusted: a recorded move
    // the rules no longer allow still has to compare equal to itself.
    public sameMove(move1: string, move2: string): boolean {
        const norm = (m: string): string => m.replace(/\s+/g, "");
        if (norm(move1) === norm(move2)) {
            return true;
        }
        const cloned = this.clone();
        cloned.stack.pop();
        cloned.load(-1);
        cloned.gameover = false;
        cloned.winner = [];
        try {
            cloned.move(move2, {trusted: true});
        } catch {
            return false;
        }
        return cloned.signature() === this.signature() && JSON.stringify(cloned.hands) === JSON.stringify(this.hands);
    }

    // Follow each piece through the per-step results of a turn.
    public static trajectoriesFromResults(results: APMoveResult[]): Array<{start: string; final: string; captured: boolean}> {
        const where = new Map<string, string>();
        const out = new Map<string, {start: string; final: string; captured: boolean}>();
        for (const r of results) {
            if (r.type === "move") {
                const key = where.get(r.from) ?? r.from;
                where.delete(r.from);
                where.set(r.to, key);
                out.set(key, {start: key, final: r.to, captured: false});
            } else if (r.type === "destroy" && r.where !== undefined) {
                const key = where.get(r.where) ?? r.where;
                where.delete(r.where);
                out.set(key, {start: key, final: r.where, captured: true});
            }
        }
        return [...out.values()];
    }

    public getStartingPosition(): string {
        if (this.variants.includes("eee")) {
            const pcs: string[] = [];
            const board = this.stack[0].board;
            for (const [cell, [pc, owner]] of board.entries()) {
                pcs.push(`${owner === 1 ? pc : pc.toLowerCase()}${cell}`);
            }
            return pcs.join(",");
        } else {
            return "";
        }
    }

    public getPlayerColour(p: playerid): Colourfuncs {
        if (p === 1) {
            return {
                func: "custom",
                default: "#bf9212",
                palette: 1
            };
        } else {
            return {
                func: "custom",
                default: "#989898",
                palette: 2
            };
        }
    }

}
