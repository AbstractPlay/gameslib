import { GameBase, IAPGameState, IClickResult, ICustomButton, IIndividualState, IStatus, IValidationResult } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep, AreaPieces, Glyph } from "@abstractplay/renderer/src/schemas/schema";
import { APMoveResult } from "../schemas/moveresults";
import { randomInt, RectGrid, reviver, shuffle, SquareOrthGraph, UserFacingError } from "../common";
import i18next from "i18next";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const deepclone = require("rfdc/default");

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
        dateAdded: "2023-05-01",
        // i18next.t("apgames:descriptions.arimaa")
        description: "apgames:descriptions.arimaa",
        // i18next.t("apgames:notes.arimaa")
        notes: "apgames:notes.arimaa",
        urls: [
            "https://arimaa.com/arimaa/",
            "https://boardgamegeek.com/boardgame/4616/arimaa",
        ],
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
            { uid: "eee", name: "Endless Endgame", group: "setup" },
            { uid: "free", name: "Arbitrary Setup", group: "setup", unrated: true },
        ],
        categories: ["goal>breakthrough", "mechanic>capture", "mechanic>move", "mechanic>coopt", "board>shape>rect", "board>connect>rect", "components>special"],
        flags: ["experimental", "perspective", "no-moves", "custom-buttons", "random-start"]
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

    private static bareMove(mv: string): string {
        const idx = mv.indexOf("(");
        let bare = mv;
        if (idx >= 0) {
            bare = mv.slice(0, idx);
        }
        return bare;
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
        this.board = deepclone(state.board);
        this.lastmove = state.lastmove;
        this.hands = deepclone(state.hands);
        this.results = [...state._results];
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

    // this only calculates possible next moves from the current position,
    // regardless of how many moves have been made so far (no range checks)
    // needs to support returning multi moves because pushes are atomic
    public partialMoves(sofar: string[] = []): (string|string[])[] {
        if (this.gameover) { return []; }

        // make any partial moves
        const cloned = this.clone();
        cloned.move(sofar.join(","), {partial: true});

        const moves: (string|string[])[] = [];
        const g = new SquareOrthGraph(8, 8);

        // opening moves
        if (cloned.hands !== undefined && cloned.hands[cloned.currplayer - 1].length > 0) {
            const uniques = new Set<Piece>(cloned.hands[cloned.currplayer - 1]);
            let cells: string[];
            if (this.variants.includes("free")) {
                cells = (g.listCells(true) as string[][]).flat().filter(cell => !cloned.board.has(cell));
            } else {
                cells = [];
                for (const row of (this.currplayer === 1 ? [6,7] : [0,1])) {
                    for (let col = 0; col < 8; col++) {
                        const cell = g.coords2algebraic(col, row);
                        if (! cloned.board.has(cell)) {
                            cells.push(cell);
                        }
                    }
                }
            }
            for (const pc of uniques) {
                for (const cell of cells) {
                    moves.push(`${cloned.currplayer === 1 ? pc : pc.toLowerCase()}${cell}`);
                }
            }
        }
        // regular moves
        else {
            const mine = [...cloned.board.entries()].filter(e => e[1][1] === cloned.currplayer).map(e => [e[0], e[1][0]] as [string, Piece]);
            for (const [from, pc] of mine) {
                // skip if frozen
                if (cloned.isFrozen(from)) {
                    continue;
                }
                // can you complete a pull
                if (sofar.length > 0) {
                    const [lastPc, lastPlayer, lastFrom] = ArimaaGame.baseMove(sofar[sofar.length - 1]);
                    // pulls are only possible if the last piece you moved was yours
                    if (lastPlayer === cloned.currplayer) {
                        const enemies: [Piece, string][] = [];
                        for (const n of g.neighbours(lastFrom!)) {
                            if (cloned.board.has(n)) {
                                const [nPc, nOwner] = cloned.board.get(n)!;
                                if (nOwner !== cloned.currplayer) {
                                    enemies.push([nPc, n]);
                                }
                            }
                        }
                        for (const [enemyPc, cell] of enemies) {
                            if (ArimaaGame.strength(lastPc) > ArimaaGame.strength(enemyPc)) {
                                moves.push(`${cloned.currplayer === 1 ? enemyPc.toLowerCase() : enemyPc}${cell}${lastFrom}`);
                            }
                        }
                    }
                }
                // pushes and moves to empty spaces
                for (const n of g.neighbours(from)) {
                    // can you push
                    if (cloned.board.has(n)) {
                        const [nPc, nOwner] = cloned.board.get(n)!;
                        if ( (nOwner === cloned.currplayer) && (ArimaaGame.strength(nPc) < ArimaaGame.strength(pc)) ) {
                            for (const nn of g.neighbours(n)) {
                                if (! cloned.board.has(nn)) {
                                    moves.push([`${nOwner === 1 ? nPc : nPc.toLowerCase()}${n}${nn}`, `${cloned.currplayer === 1 ? pc : pc.toLowerCase()}${from}${n}`]);
                                }
                            }
                        }
                    }
                    // can you move to an empty space
                    else {
                        // rabbits can't move backwards
                        if (pc === "R") {
                            const [fx, fy] = g.algebraic2coords(from);
                            const [tx, ty] = g.algebraic2coords(n);
                            const bearing = RectGrid.bearing(fx, fy, tx, ty)!;
                            const backward = cloned.currplayer === 1 ? "S" : "N";
                            if (!bearing.startsWith(backward)) {
                                moves.push(`${cloned.currplayer === 1 ? pc : pc.toLowerCase()}${from}${n}`);
                            }
                        } else {
                            moves.push(`${cloned.currplayer === 1 ? pc : pc.toLowerCase()}${from}${n}`);
                        }
                    }
                }
            }
        }

        return moves;
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

            // placing pieces
            // - either still pieces in hand
            // - or we're in standard setup and ply 1 or 2, no matter the hands
            if (
                (cloned.hands !== undefined && cloned.hands[cloned.currplayer - 1].length > 0) ||
                (this.variants.length === 0 && this.stack.length <= 2)
            ) {
                // clicking off the board resets
                if (row === -1 || col === -1) {
                    const [pc, pstr] = piece!.split("");
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
                        // if just clicking directly on the board, select the strongest piece in hand
                        if (lastmove === undefined || lastmove === "") {
                            const sorted = [...cloned.hands![cloned.currplayer - 1]].sort((a,b) => ArimaaGame.strength(b) - ArimaaGame.strength(a));
                            lastmove = cloned.currplayer === 1 ? sorted[0] : sorted[0].toLowerCase();
                        }
                        newmove = `${stub}${stub.length > 0 ? "," : ""}${lastmove}${cell}`;
                    }
                }
            }
            // moving pieces
            else {
                const cell = ArimaaGame.coords2algebraic(col, row);
                // clicking an occupied cell always resets the move
                if (cloned.board.has(cell)) {
                    const [pc, owner] = cloned.board.get(cell)!;
                    newmove = `${stub}${stub.length > 0 ? "," : ""}${owner === 1 ? pc : pc.toLowerCase()}${cell}`;
                }
                // otherwise, if
                else {
                    if (lastmove.length === 3) {
                        newmove = `${stub}${stub.length > 0 ? "," : ""}${lastmove}${cell}`;
                    }
                }
            }

            console.log(`About to validate '${newmove}'`);
            let result = this.validateMove(newmove) as IClickResult;
            if (! result.valid) {
                result.move = move;
            } else {
                if (result.autocomplete !== undefined) {
                    const automove = result.autocomplete;
                    result = this.validateMove(result.autocomplete) as IClickResult;
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

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
        m = m.replace(/\s+/g, "");
        const g = new SquareOrthGraph(8, 8);

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

        const steps = m.split(",").filter(Boolean).map(mv => ArimaaGame.baseMove(mv));
        // console.log(JSON.stringify({steps}));
        // placements are validated separately
        if (this.hands !== undefined && this.hands[this.currplayer - 1].length > 0) {
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
                    // cell must be empty
                    if (this.board.has(cell)) {
                        result.valid = false;
                        result.message = i18next.t("apgames:validation._general.OCCUPIED");
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
            // otherwise, you have to place all your pieces
            else {
                if (myhand.length > 0) {
                    complete = -1;
                    message = i18next.t("apgames:validation.arimaa.PARTIAL_PLAY")
                } else {
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
                }
            }

            result.valid = true;
            result.canrender = true;
            result.complete = complete;
            result.message = message;
            return result;
        }
        // regular moves
        else {
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
                    result.message = i18next.t("apgames:validation._general.INVALIDCELL", {from});
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
                    if (lastPlayer === cloned.currplayer || !g.neighbours(lastFrom!).includes(from) || (to !== undefined && to !== lastFrom) || ArimaaGame.strength(pc) < ArimaaGame.strength(lastPc)) {
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
                    if (i > 0) {
                        const [lastPc, lastPlayer, lastFrom] = steps[i - 1];
                        const ns = g.neighbours(from);
                        if (lastPlayer === cloned.currplayer && ns.includes(lastFrom!) && ArimaaGame.strength(lastPc) > ArimaaGame.strength(pc)) {
                            validPull = true;
                            // if this is the last step, suggest an autocomplete
                            if (i === steps.length - 1 && to === undefined) {
                                result.autocomplete = m + lastFrom;
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
                    result.message = i18next.t("apgames:validation._general.OCCUPIED");
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
                complete = 0;
                message = i18next.t("apgames:validation.arimaa.PARTIAL");
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
    }

    public move(m: string, {trusted = false, partial = false} = {}): ArimaaGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }

        m = m.replace(/\s+/g, "");
        if (! trusted) {
            const result = this.validateMove(m);
            if (! result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message)
            }
        }

        // because we don't have a move list to fall back on,
        // we do some basic validation as we go and throw on errors
        // but we don't go so far as to validate pushes and pulls here
        this.results = [];
        const initial = this.clone(); // used to triple check that the board state changes
        const lastmove: string[] = [];
        const steps = m.split(",").filter(Boolean).map(mv => ArimaaGame.baseMove(mv));
        for (let i = 0; i < steps.length; i++) {
            const [pc, owner, from, to] = steps[i];
            // placement
            if (this.hands !== undefined && this.hands[this.currplayer - 1].length > 0) {
                if (from !== undefined) {
                    this.board.set(from, [pc, this.currplayer]);
                    this.results.push({type: "place", what: pc, where: from});
                    // update hand
                    if (!this.variants.includes("free")) {
                        this.hands![this.currplayer - 1].splice(this.hands![this.currplayer - 1].indexOf(pc), 1);
                    }
                    lastmove.push(`${this.currplayer === 1 ? pc : pc.toLowerCase()}${from}`);
                } else if (i !== steps.length - 1) {
                    throw new Error("Invalid placement detected in the middle of the move.");
                }
            }
            // movement
            else {
                if (from !== undefined && to !== undefined) {
                    const moved = this.board.get(from)!;
                    this.board.set(to, moved);
                    this.board.delete(from);
                    this.results.push({type: "move", from, to});
                    // check traps
                    let parenthetical = "";
                    for (const trap of traps) {
                        if (this.board.has(trap) && this.isAlone(trap)) {
                            const [trapPc, trapOwner] = this.board.get(trap)!;
                            this.board.delete(trap);
                            this.results.push({type: "destroy", what: trapOwner === 1 ? trapPc : trapPc.toLowerCase(), where: trap});
                            parenthetical = `(x${trapOwner === 1 ? trapPc : trapPc.toLowerCase()}${trap})`;
                        }
                    }
                    lastmove.push(`${owner === 1 ? pc : pc.toLowerCase()}${from}${to}${parenthetical}`);
                } else if (i !== steps.length - 1) {
                    throw new Error("Invalid move detected in the middle of the move.");
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
            if (this.partialMoves().length === 0) {
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
            hands: deepclone(this.hands),
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
                    colour,
                    colour2: {
                        func: "bestContrast",
                        bg: colour,
                        fg: [
                            "_context_strokes",
                            "_context_fill"
                        ]
                    },
                    // flipy: colour === 2 ? true : false,
                    orientation: "vertical",
                };
                legend[`${pc}${colour}x`] = {
                    name,
                    colour,
                    colour2: {
                        func: "bestContrast",
                        bg: colour,
                        fg: [
                            "_context_strokes",
                            "_context_fill"
                        ]
                    },
                    // flipy: colour === 2 ? true : false,
                    opacity: 0.5,
                    orientation: "vertical",
                };
            }
        }

        // add an area if the current player has pieces to place
        let areas: AreaPieces[]|undefined;
        if (this.hands !== undefined && this.hands[this.currplayer - 1].length > 0) {
            const pcs = this.hands[this.currplayer - 1].sort((a, b) => ArimaaGame.strength(b) - ArimaaGame.strength(a)).map(pc => `${pc}${this.currplayer}`);
            areas = [
                {
                    type: "pieces",
                    pieces: pcs as [string, ...string[]],
                    label: i18next.t("apgames:validation.arimaa.LABEL_STASH", {playerNum: this.currplayer}) || `P${this.currplayer} Hand`,
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
                    }
                ]
            },
            legend,
            pieces: pstr,
            areas,
        };

        // Add annotations
        if (this.results.length > 0) {
            rep.annotations = [];
            for (const move of this.results) {
                if (move.type === "move") {
                    const [fromX, fromY] = ArimaaGame.algebraic2coords(move.from);
                    const [toX, toY] = ArimaaGame.algebraic2coords(move.to);
                    rep.annotations.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "place") {
                    const [x, y] = ArimaaGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "enter", targets: [{row: y, col: x}]});
                } else if (move.type === "destroy") {
                    const [x, y] = ArimaaGame.algebraic2coords(move.where!);
                    rep.annotations.push({type: "exit", targets: [{row: y, col: x}]});
                }
            }
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

    public statuses(): IStatus[] {
        return [{ key: i18next.t("apgames:status.arimaa.HARLOG"), value: [this.harlog().toFixed(2)] } as IStatus];
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Harlog**: " + this.harlog().toFixed(2) + "\n\n";

        return status;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.complete", {player, what: pc2name.get(r.what as Piece), where: r.where}));
                resolved = true;
                break;
            case "move":
                node.push(i18next.t("apresults:MOVE.nowhat", {player, from: r.from, to: r.to}));
                resolved = true;
                break;
            case "destroy":
                node.push(i18next.t("apresults:DESTROY.arimaa", {colour: isLower(r.what!) ? "silver" : "gold", what: pc2name.get(r.what!.toUpperCase() as Piece), where: r.where}));
                resolved = true;
                break;
            case "announce":
                node.push(i18next.t("apresults:ANNOUNCE.arimaa"));
                resolved = true;
                break;
        }
        return resolved;
    }

    public clone(): ArimaaGame {
        const cloned = Object.assign(new ArimaaGame(), deepclone(this) as ArimaaGame);
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

    public sameMove(move1: string, move2: string): boolean {
        const left = move1.replace(/\s+/g, "").split(",").map(m => ArimaaGame.bareMove(m)).join(",");
        const right = move2.replace(/\s+/g, "").split(",").map(m => ArimaaGame.bareMove(m)).join(",");
        return left === right;
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

}
