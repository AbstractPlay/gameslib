import type { ActiveColour, ClaimState, PieceColour, playerid } from "./types.js";

export function topColour(pieces: PieceColour[]): PieceColour | undefined {
    return pieces.length === 0 ? undefined : pieces[pieces.length - 1];
}

export function isJoker(c: PieceColour): boolean {
    return c === 6;
}

/** Claimed-by-seat for an active colour, or `undefined` when that colour is still unclaimed (neutral on the board). */
export function colourOwner(claims: ClaimState, colour: ActiveColour): playerid | undefined {
    const owner = claims.owner[colour - 1];
    return owner == null ? undefined : owner;
}

/** Colour not yet claimed by either seat — stacks showing it are neutral (either player may move them). */
export function isNeutralColour(claims: ClaimState, colour: ActiveColour): boolean {
    return colourOwner(claims, colour) === undefined;
}

/** Who controls a stack for movement (undefined = joker-top / immobile; neutral = unclaimed top colour). */
export function stackController(
    claims: ClaimState,
    pieces: PieceColour[],
): playerid | "neutral" | undefined {
    const top = topColour(pieces);
    if (top === undefined || isJoker(top)) {
        return undefined;
    }
    const owner = colourOwner(claims, top as ActiveColour);
    return owner === undefined ? "neutral" : owner;
}

export function canPlayerUseStack(
    claims: ClaimState,
    pieces: PieceColour[],
    player: playerid,
): boolean {
    const ctrl = stackController(claims, pieces);
    if (ctrl === undefined) {
        return false;
    }
    // Unclaimed top colour: neutral stack, either seat may move it.
    if (ctrl === "neutral") {
        return true;
    }
    return ctrl === player;
}

export function canClaimColour(
    claims: ClaimState,
    claimed: [ActiveColour[], ActiveColour[]],
    player: playerid,
    colour: ActiveColour,
): boolean {
    if (!claims.inReserve.has(colour)) {
        return false;
    }
    if (colourOwner(claims, colour) !== undefined) {
        return false;
    }
    return claimed[player - 1].length < 2;
}

export function applyClaim(
    claims: ClaimState,
    claimed: [ActiveColour[], ActiveColour[]],
    player: playerid,
    colour: ActiveColour,
): void {
    claims.inReserve.delete(colour);
    claims.owner[colour - 1] = player;
    claimed[player - 1].push(colour);
}

export function lyngkColourForStack(
    claims: ClaimState,
    pieces: PieceColour[],
    player: playerid,
): ActiveColour | undefined {
    const top = topColour(pieces);
    if (top === undefined || isJoker(top)) {
        return undefined;
    }
    const owner = colourOwner(claims, top as ActiveColour);
    if (owner !== player) {
        return undefined;
    }
    return top as ActiveColour;
}