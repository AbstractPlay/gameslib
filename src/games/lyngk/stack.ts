import type { ActiveColour, ClaimState, PieceColour, playerid } from "./types.js";
import { canPlayerUseStack, colourOwner, isJoker, stackController, topColour } from "./colours.js";

const ACTIVE: ActiveColour[] = [1, 2, 3, 4, 5];

export function stackHeight(pieces: PieceColour[] | undefined): number {
    return pieces === undefined ? 0 : pieces.length;
}

/** Two stacks may merge with distinct active colours and jokers filling gaps; height ≤ 5; top ≠ joker. */
export function canMergeStacks(lower: PieceColour[], upper: PieceColour[]): boolean {
    const combined = [...lower, ...upper];
    if (combined.length > 5) {
        return false;
    }
    if (isJoker(topColour(combined)!)) {
        return false;
    }
    const explicit = new Set<ActiveColour>();
    let jokers = 0;
    for (const p of combined) {
        if (isJoker(p)) {
            jokers++;
        } else if (explicit.has(p as ActiveColour)) {
            return false;
        } else {
            explicit.add(p as ActiveColour);
        }
    }
    if (combined.length < 5) {
        return true;
    }
    const missing = ACTIVE.filter((c) => !explicit.has(c)).length;
    return jokers >= missing;
}

function moverIsNeutral(claims: ClaimState, mover: PieceColour[]): boolean {
    return stackController(claims, mover) === "neutral";
}

/** Whether `upper` may land on `lower` per height / neutral rules (before merge validity). */
export function canLandStacks(
    claims: ClaimState,
    mover: PieceColour[],
    target: PieceColour[],
    player: playerid,
): boolean {
    if (!canPlayerUseStack(claims, mover, player)) {
        return false;
    }
    if (!canMergeStacks(target, mover)) {
        return false;
    }
    const mh = mover.length;
    const th = target.length;
    const neutralMover = moverIsNeutral(claims, mover);
    if (neutralMover) {
        if (mh === 1) {
            return th === 1;
        }
        return th <= mh;
    }
    return true;
}

export function applyLanding(board: Map<string, PieceColour[]>, from: string, to: string): PieceColour[] {
    const mover = board.get(from)!;
    const target = board.get(to)!;
    board.delete(from);
    const merged = [...target, ...mover];
    board.set(to, merged);
    return merged;
}

export function isCompletedFive(pieces: PieceColour[]): boolean {
    return pieces.length === 5;
}

/** After a 5-stack is formed, capture if mover's player owns top active colour. */
export function shouldCaptureStack(
    claims: ClaimState,
    pieces: PieceColour[],
    player: playerid,
): boolean {
    if (!isCompletedFive(pieces)) {
        return false;
    }
    const top = topColour(pieces);
    if (top === undefined || isJoker(top)) {
        return false;
    }
    return colourOwner(claims, top as ActiveColour) === player;
}

export function removeCaptured(board: Map<string, PieceColour[]>, cell: string): void {
    board.delete(cell);
}