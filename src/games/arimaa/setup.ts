/**
 * Setting up: the standard 16-piece setup, Free placement, and the random
 * start of Endless endgame. A setup is entered as comma-separated placements
 * (`Ee2,Md2`), and a trailing piece letter on its own is the piece selected
 * from the hand.
 */
import i18next from "i18next";
import { GameBase, type IValidationResult } from "../_base.js";
import { randomInt, shuffle, SquareOrthGraph } from "../../common/index.js";
import type { ArimaaGame } from "../arimaa.js";
import type { InputClick } from "./input.js";
import { baseMove } from "./legacy.js";
import { pc2name, type Piece, type playerid } from "./notation.js";
import { STRENGTH, type CellContents } from "./turns.js";

const coords2algebraic = (x: number, y: number): string => GameBase.coords2algebraic(x, y, 8);
const algebraic2coords = (cell: string): [number, number] => GameBase.algebraic2coords(cell, 8);

/** Whether `player` still has pieces in hand to place. */
export function placing(hands: [Piece[], Piece[]] | undefined, player: playerid): hands is [Piece[], Piece[]] {
    return hands !== undefined && hands[player - 1].length > 0;
}

// the standard 16-piece setup, which the setup variants replace
export function standardSetup(variants: string[]): boolean {
    return !variants.includes("eee") && !variants.includes("free");
}

// the two ranks a player sets up on, in the order they get auto-filled
export function homeCells(player: playerid): string[] {
    const cells: string[] = [];
    for (const row of (player === 1 ? [6,7] : [0,1])) {
        for (let col = 0; col < 8; col++) {
            cells.push(coords2algebraic(col, row));
        }
    }
    return cells;
}

// Endless endgame's random start: a random army for Gold on its two ranks,
// and its mirror image for Silver
export function endlessEndgame(): {gold: [Piece, string][], silver: [Piece, string][]} {
    const getRanks = (ranks: number[]): string[] => {
        const cells: string[] = [];
        for (const row of ranks) {
            for (let col = 0; col < 8; col++) {
                cells.push(coords2algebraic(col, row));
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
        const [col, row] = algebraic2coords(cell);
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
        combinedSilver.push([pc, coords2algebraic(newCol, newRow)]);
    });
    return {gold: combinedGold, silver: combinedSilver};
}

// In standard setup, a player only needs to place their eight non-rabbits.
// Once they have, the rest of their setup area gets filled with rabbits.
// Returns the move untouched in every other circumstance.
export function fillRabbits(board: Map<string, CellContents>, hands: [Piece[], Piece[]] | undefined, player: playerid, variants: string[], m: string): string {
    if (!standardSetup(variants) || !placing(hands, player)) {
        return m;
    }
    const mvs = m.split(",").filter(Boolean);
    const steps = mvs.map(mv => baseMove(mv));
    const myhand = [...hands[player - 1]];
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
    const empty = homeCells(player).filter(cell => !board.has(cell) && !placedCells.has(cell));
    if (empty.length !== myhand.length) {
        return m;
    }
    return [...mvs, ...empty.map(cell => `${player === 1 ? "R" : "r"}${cell}`)].join(",");
}

// A placement list, for `player` placing from `hand` onto `board`.
export function validateSetup(board: Map<string, CellContents>, hand: Piece[], player: playerid, variants: string[], m: string): IValidationResult {
    const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
    const g = new SquareOrthGraph(8, 8);
    // capture tokens written at the end of free setup carry no instruction
    const steps = m.split(",").filter(Boolean).filter(mv => !mv.startsWith("x")).map(mv => baseMove(mv));
    const placed = new Map(board);
    const myhand = [...hand];
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
                algebraic2coords(cell);
            } catch {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.INVALIDCELL", {cell});
                return result;
            }
            // cell must be empty, including of anything placed earlier in this move
            if (placed.has(cell)) {
                result.valid = false;
                result.message = i18next.t("apgames:validation._general.OCCUPIED", {where: cell});
                return result;
            }
            // in normal play, must be on home ranks
            if (!variants.includes("free")) {
                const homeRows = player === 1 ? [6,7] : [0,1];
                const [,y] = algebraic2coords(cell);
                if (!homeRows.includes(y)) {
                    result.valid = false;
                    result.message = i18next.t("apgames:validation.arimaa.HOME_ROW");
                    return result;
                }
            }
            // fake place the piece
            placed.set(cell, [pc, player]);
            // remove the piece from the hand unless in free mode
            if (!variants.includes("free")) {
                myhand.splice(myhand.indexOf(pc), 1);
            }
        }
        // if it's just a piece number, we need a cell
        else {
            result.valid = true;
            result.complete = -1;
            result.message = i18next.t("apgames:validation.arimaa.PARTIAL_PLACE");
            result.canrender = true;
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
    if (variants.includes("free")) {
        const rabbits = [...placed.entries()].filter(e => e[1][1] === player && e[1][0] === "R").map(e => e[0]);
        const goal = player === 1 ? "8" : "1";
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
        const emptyHome = homeCells(player).filter(c => !placed.has(c));
        const autoRabbits = myhand.length > 0 && myhand.every(pc => pc === "R") && emptyHome.length === myhand.length;
        if (myhand.length > 0 && !autoRabbits) {
            complete = -1;
            message = i18next.t("apgames:validation.arimaa.PARTIAL_PLAY")
        } else {
            // fake place the rabbits so the advice below sees the real setup
            if (autoRabbits) {
                for (const cell of emptyHome) {
                    placed.set(cell, ["R", player]);
                }
            }
            // warnings go here
            const warnings: string[] = [];
            // same file (only silver)
            if (player === 2) {
                const [e1, e2] = [...placed.entries()].filter(e => e[1][0] === "E").map(e => e[0][0]);
                if (e1 === e2) {
                    warnings.push(i18next.t("apgames:validation.arimaa.WARN_FILE") || "WARN");
                }
            }
            // unbalanced (gold and silver)
            const majors = [...placed.entries()].filter(e => e[1][1] === player && ["E", "M", "H"].includes(e[1][0])).map(e => algebraic2coords(e[0])[0]);
            const oneSide = majors.filter(n => n < 5).length;
            if (oneSide === 0 || oneSide === 4) {
                warnings.push(i18next.t("apgames:validation.arimaa.WARN_BALANCE") || "WARN");
            }
            // hiding (gold and silver): a piece other than a cat on the back
            // rank behind a weaker piece, a rabbit included
            const frontRow = player === 1 ? 6 : 1;
            const backRow = player === 1 ? 7 : 0;
            for (let col = 0; col < 8; col++) {
                const frontCell = g.coords2algebraic(col, frontRow);
                const backCell = g.coords2algebraic(col, backRow);
                const front = placed.get(frontCell)![0];
                const back = placed.get(backCell)![0];
                if (back !== "C" && STRENGTH[front] < STRENGTH[back]) {
                    warnings.push(i18next.t("apgames:validation.arimaa.WARN_HIDE") || "WARN");
                    break;
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

// Setup clicks work on the comma-separated placement list. As in
// movement, a click that means nothing is a control: an empty square
// nothing can be placed on finishes the setup if it can be submitted, or
// else drops the piece selected from the hand, and an opponent's piece
// drops that selection, or else takes back the last piece placed.
export function setupClick(game: ArimaaGame, move: string, row: number, col: number, piece?: string): InputClick {
    let newmove = "";
    const steps = move.split(",").filter(Boolean).map(mv => baseMove(mv));
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
        if (placing(game.hands, game.currplayer) && lastFrom === undefined) {
            lastmove = game.currplayer === 1 ? lastPc! : lastPc!.toLowerCase();
            stub = move.substring(0, move.lastIndexOf(","));
        }
        // movement
        else if (!placing(game.hands, game.currplayer) && (lastFrom !== undefined && lastTo === undefined) ) {
            lastmove = `${lastPlayer === 1 ? lastPc : lastPc!.toLowerCase()}${lastFrom}`;
            stub = move.substring(0, move.lastIndexOf(","));
        }
    }
    // console.log(JSON.stringify({move, lastPc, lastFrom, lastTo, lastmove, stub}));
    // make the moves in the stub
    const cloned = game.clone();
    cloned.move(stub, {partial: true});

    // clicking off the board resets
    if (row === -1 || col === -1) {
        const [,pc, pstr] = piece!.split("");
        const p = parseInt(pstr, 10);
        newmove = `${stub}${stub.length > 0 ? "," : ""}${p === 1 ? pc : pc.toLowerCase()}`;
    } else {
        const cell = coords2algebraic(col, row);
        // clicking a placed cell unplaces it
        if (cloned.board.has(cell)) {
            // clicking an occupied cell after selecting a piece to place
            if (lastmove.length === 0) {
                // the click may land on the piece glyph or on the empty part of
                // the square (then `piece` is empty), so go by what's on the board
                const [occupant, owner] = cloned.board.get(cell)!;
                const idx = steps.findIndex(([pc,,f,]) => pc === occupant && f === cell);
                if (owner !== game.currplayer) {
                    newmove = move.split(",").filter(Boolean).slice(0, -1).join(",");
                } else if (idx >= 0) {
                    steps.splice(idx, 1);
                    newmove = steps.map(([pc, p, f,]) => `${p === 1 ? pc : pc.toLowerCase()}${f}`).join(",");
                } else {
                    newmove = stub;
                }
            } else {
                newmove = stub;
            }
        } else if (!game.variants.includes("free") && !homeCells(game.currplayer).includes(cell)) {
            if (lastmove.length > 0) {
                return {move: stub};
            }
            const v = game.validateMove(move);
            return v.valid && (v.complete ?? -1) >= 0 ? {move, complete: true} : {move};
        } else {
            // if just clicking directly on the board, choose a piece for them:
            // in free setup the hand never empties, so default to a rabbit;
            // otherwise take the strongest piece still in hand
            if (lastmove === undefined || lastmove === "") {
                let dflt: Piece;
                if (game.variants.includes("free")) {
                    dflt = "R";
                } else {
                    dflt = [...cloned.hands![cloned.currplayer - 1]].sort((a,b) => STRENGTH[b] - STRENGTH[a])[0];
                }
                lastmove = cloned.currplayer === 1 ? dflt : dflt.toLowerCase();
            }
            newmove = `${stub}${stub.length > 0 ? "," : ""}${lastmove}${cell}`;
        }
    }

    return {move: newmove};
}
