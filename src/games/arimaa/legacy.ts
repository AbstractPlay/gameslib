/**
 * The pre-notation step lists: comma-separated `<piece><from><to>` steps with
 * optional capture parentheticals, which recorded games hold and which can
 * still be typed. Placements during setup use the same tokens without the
 * destination.
 */
import i18next from "i18next";
import { GameBase, type IValidationResult } from "../_base.js";
import { RectGrid, SquareOrthGraph } from "../../common/index.js";
import type { ArimaaGame } from "../arimaa.js";
import { isLower, type Piece, type playerid } from "./notation.js";
import { STRENGTH, TRAP_SQUARES, isAlone, isFrozen } from "./turns.js";

export type StepKind = "placement" | "pusher" | "puller" | "pushee" | "pullee" | "mover" | undefined;

// strip any parentheticals and just return the base move
export function baseMove(mv: string): [Piece, playerid, string?, string?] {
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

// A very niche helper function to fix the "can't push pull at same time" issue
// Looks at each move in a chain and determines the nature of each.
// Naive. Just looks at the notation and sequence, not board context.
export function classify(player: playerid, moves: string[]): StepKind[] {
    const classifications: StepKind[] = [];

    for (let i = 0; i < moves.length; i++) {
        const [, owner, from, to] = baseMove(moves[i]);
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
                    const [, nextOwner, , nextTo] = baseMove(moves[i + 1]);
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
                    const [, nextOwner, , nextTo] = baseMove(moves[i + 1]);
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

// The pre-notation movement grammar, validated as it always was, so that every
// historical move string still validates exactly as it did. `maxMoves` is the
// steps the mover may take this turn.
export function validateLegacyMovement(game: ArimaaGame, m: string, maxMoves: number): IValidationResult {
    const result: IValidationResult = {valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER")};
    const g = new SquareOrthGraph(8, 8);
    // This validator once had two lapses: a push completed by a piece of
    // equal strength when a stronger one was also adjacent, and a pull that
    // moved the pulled piece somewhere other than the square the puller
    // vacated. Both are rejected here, so no new move can use them. A few
    // recorded games contain such a move; they replay through `trusted`,
    // which skips validation entirely, so no saved game is disturbed.
    const classifications = classify(game.currplayer, m.split(",").filter(Boolean));
    const steps = m.split(",").filter(Boolean).map(mv => baseMove(mv));
    // can't make too many moves
    if (steps.length > maxMoves) {
        result.valid = false;
        result.message = i18next.t("apgames:validation.arimaa.TOO_MANY", {num: maxMoves});
        return result;
    }
    const cloned = game.clone();
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
            GameBase.algebraic2coords(from, 8);
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
        if (owner === cloned.currplayer && isFrozen(cloned.board, from)) {
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
            if (lastPlayer === cloned.currplayer || !g.neighbours(lastFrom!).includes(from) || (to !== undefined && to !== lastFrom) || STRENGTH[pc] <= STRENGTH[lastPc]) {
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
                if (lastPlayer === cloned.currplayer && ns.includes(lastFrom!) && STRENGTH[lastPc] > STRENGTH[pc] && (to === undefined || to === lastFrom)) {
                    validPull = true;
                    // check if push is possible
                    let canPush = false;
                    if (i < maxMoves - 1) {
                        for (const n of g.neighbours(from)) {
                            if (cloned.board.has(n)) {
                                const [nPc, nOwner] = cloned.board.get(n)!;
                                if (nOwner === cloned.currplayer && STRENGTH[nPc] > STRENGTH[pc] && !isFrozen(cloned.board, n)) {
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
                        if (nOwner === cloned.currplayer && STRENGTH[nPc] > STRENGTH[pc] && !isFrozen(cloned.board, n)) {
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
            GameBase.algebraic2coords(to, 8);
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
            const [fx, fy] = GameBase.algebraic2coords(from, 8);
            const [tx, ty] = GameBase.algebraic2coords(to, 8);
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
        for (const trap of TRAP_SQUARES) {
            if (cloned.board.has(trap) && isAlone(cloned.board, trap)) {
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
    if (cloned.signature() === game.signature()) {
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
    // otherwise we're good, but only the player completes a move
    else {
        complete = 0;
        message = i18next.t("apgames:validation._general.VALID_MOVE");
    }

    result.valid = true;
    result.canrender = true;
    result.complete = complete;
    result.message = message;
    return result;
}
