import type { HexDir } from "../../common/graphs/hextri.js";
import type { LyngkGraph } from "./graph.js";
import type { ActiveColour, Board, ClaimState, playerid } from "./types.js";
import {
    canClaimColour,
    canPlayerUseStack,
    isJoker,
    lyngkColourForStack,
    topColour,
    colourOwner,
} from "./colours.js";
import { canLandStacks } from "./stack.js";
import { formatMove } from "./notation.js";
import { cloneClaims } from "./setup.js";

/** Claims state as after an optional same-turn reserve claim (for move generation / validation). */
export function effectiveClaims(
    claims: ClaimState,
    player: playerid,
    pendingClaim?: ActiveColour,
): ClaimState {
    if (pendingClaim === undefined) {
        return claims;
    }
    const next = cloneClaims(claims);
    next.owner[pendingClaim - 1] = player;
    next.inReserve.delete(pendingClaim);
    return next;
}

const DIRS: HexDir[] = ["NE", "E", "SE", "SW", "W", "NW"];

/**
 * Occupied cells reachable in a straight line from `from` without jumping over a stack.
 * Each direction yields at most one landing: the first occupied intersection, with only
 * empty intersections in between.
 */
export function slideLandings(graph: LyngkGraph, board: Board, from: string): string[] {
    const [x, y] = graph.algebraic2coords(from);
    const out: string[] = [];
    for (const dir of DIRS) {
        const raw = graph.ray(x, y, dir, true);
        for (let k = 1; k < raw.length; k++) {
            const cell = graph.coords2algebraic(...raw[k]!);
            if (!graph.isPlayable(cell)) {
                continue;
            }
            if (board.has(cell)) {
                out.push(cell);
                break;
            }
        }
    }
    return [...new Set(out)].sort((a, b) => a.localeCompare(b));
}

export function canSlideBetween(graph: LyngkGraph, board: Board, from: string, to: string): boolean {
    if (!board.has(to)) {
        return false;
    }
    return slideLandings(graph, board, from).includes(to);
}

function isLyngkPoint(
    claims: ClaimState,
    board: Board,
    cell: string,
    lyngk: ActiveColour,
    player: playerid,
): boolean {
    const stack = board.get(cell);
    if (stack === undefined) {
        return false;
    }
    const top = topColour(stack);
    if (top === undefined || isJoker(top) || top !== lyngk) {
        return false;
    }
    return colourOwner(claims, top as ActiveColour) === player;
}

/** All legal cell paths `[from, …, to]` (length ≥ 2). */
export function legalCellPaths(
    graph: LyngkGraph,
    board: Board,
    claims: ClaimState,
    player: playerid,
    pendingClaim?: ActiveColour,
): string[][] {
    const eff = effectiveClaims(claims, player, pendingClaim);
    const out: string[][] = [];
    const seen = new Set<string>();

    for (const [from, mover] of board) {
        if (!canPlayerUseStack(eff, mover, player)) {
            continue;
        }
        const lyngk = lyngkColourForStack(eff, mover, player);

        const visit = (current: string, path: string[], usedLyngk: Set<string>): void => {
            for (const land of slideLandings(graph, board, current)) {
                if (path.includes(land)) {
                    continue;
                }

                const target = board.get(land)!;
                const asLyngk =
                    lyngk !== undefined
                    && path.length >= 1
                    && isLyngkPoint(eff, board, land, lyngk, player);

                if (asLyngk) {
                    if (usedLyngk.has(land)) {
                        continue;
                    }
                    const nextUsed = new Set(usedLyngk);
                    nextUsed.add(land);
                    visit(land, [...path, land], nextUsed);
                    continue;
                }

                if (canLandStacks(eff, mover, target, player)) {
                    const full = [...path, land];
                    const key = full.join("-");
                    if (!seen.has(key)) {
                        seen.add(key);
                        out.push(full);
                    }
                }
            }
        };

        visit(from, [from], new Set());
    }

    return out.sort((a, b) => a.join("-").localeCompare(b.join("-")));
}

export function anyBoardPath(
    graph: LyngkGraph,
    board: Board,
    claims: ClaimState,
    player: playerid,
): boolean {
    return legalCellPaths(graph, board, claims, player).length > 0;
}

export function legalClaimColours(
    claims: ClaimState,
    claimed: [ActiveColour[], ActiveColour[]],
    player: playerid,
): ActiveColour[] {
    const out: ActiveColour[] = [];
    for (const c of [1, 2, 3, 4, 5] as ActiveColour[]) {
        if (canClaimColour(claims, claimed, player, c)) {
            out.push(c);
        }
    }
    return out;
}

export function pathIsLegal(
    graph: LyngkGraph,
    board: Board,
    claims: ClaimState,
    player: playerid,
    cells: string[],
    pendingClaim?: ActiveColour,
): boolean {
    if (cells.length < 2) {
        return false;
    }
    const eff = effectiveClaims(claims, player, pendingClaim);
    const origin = cells[0]!;
    const mover = board.get(origin);
    if (mover === undefined || !canPlayerUseStack(eff, mover, player)) {
        return false;
    }
    const lyngk = lyngkColourForStack(eff, mover, player);
    const usedLyngk = new Set<string>();

    for (let i = 0; i < cells.length - 1; i++) {
        const from = cells[i]!;
        const to = cells[i + 1]!;
        if (!canSlideBetween(graph, board, from, to)) {
            return false;
        }
        const terminal = i === cells.length - 2;
        if (terminal) {
            return canLandStacks(eff, mover, board.get(to)!, player);
        }
        if (lyngk === undefined || !isLyngkPoint(eff, board, to, lyngk, player)) {
            return false;
        }
        if (usedLyngk.has(to)) {
            return false;
        }
        usedLyngk.add(to);
    }
    return false;
}

export function anyLegalMove(
    graph: LyngkGraph,
    board: Board,
    claims: ClaimState,
    claimed: [ActiveColour[], ActiveColour[]],
    player: playerid,
): boolean {
    if (legalCellPaths(graph, board, claims, player).length > 0) {
        return true;
    }
    for (const c of legalClaimColours(claims, claimed, player)) {
        if (legalCellPaths(graph, board, claims, player, c).length > 0) {
            return true;
        }
    }
    return false;
}

export function allLegalMoveStrings(
    graph: LyngkGraph,
    board: Board,
    claims: ClaimState,
    claimed: [ActiveColour[], ActiveColour[]],
    player: playerid,
): string[] {
    if (!anyLegalMove(graph, board, claims, claimed, player)) {
        return ["pass"];
    }
    const moves: string[] = [];
    for (const path of legalCellPaths(graph, board, claims, player)) {
        moves.push(formatMove(undefined, path));
    }
    for (const claim of legalClaimColours(claims, claimed, player)) {
        for (const path of legalCellPaths(graph, board, claims, player, claim)) {
            moves.push(formatMove(claim, path));
        }
    }
    return [...new Set(moves)].sort((a, b) => a.localeCompare(b));
}

export function bothImmobilized(
    graph: LyngkGraph,
    board: Board,
    claims: ClaimState,
    claimed: [ActiveColour[], ActiveColour[]],
): boolean {
    return !anyLegalMove(graph, board, claims, claimed, 1) && !anyLegalMove(graph, board, claims, claimed, 2);
}

/** Next cells that legally extend a partial path prefix (for click / enter highlights). */
export function legalNextCellsForPath(
    graph: LyngkGraph,
    board: Board,
    claims: ClaimState,
    player: playerid,
    prefix: string[],
    pendingClaim?: ActiveColour,
): string[] {
    if (prefix.length === 0) {
        return [];
    }
    const eff = effectiveClaims(claims, player, pendingClaim);
    const from = prefix[0]!;
    const mover = board.get(from);
    if (mover === undefined || !canPlayerUseStack(eff, mover, player)) {
        return [];
    }
    const paths = legalCellPaths(graph, board, claims, player, pendingClaim);
    const next = new Set<string>();
    for (const path of paths) {
        if (path.length <= prefix.length) {
            continue;
        }
        let matches = true;
        for (let i = 0; i < prefix.length; i++) {
            if (path[i] !== prefix[i]) {
                matches = false;
                break;
            }
        }
        if (matches) {
            next.add(path[prefix.length]!);
        }
    }
    return [...next].sort((a, b) => a.localeCompare(b));
}