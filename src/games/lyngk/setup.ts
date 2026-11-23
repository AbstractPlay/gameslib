import { shuffle } from "../../common/shuffle.js";
import type { GameRng } from "../../common/rng.js";
import type { LyngkGraph } from "./graph.js";
import type { ActiveColour, Board, ClaimState, PieceColour } from "./types.js";
import { LYNGK_INTERSECTIONS } from "./graph.js";
import { COLOURS_PER_ACTIVE, JOKER_COUNT } from "./types.js";

export function initialClaims(): ClaimState {
    return {
        owner: [undefined, undefined, undefined, undefined, undefined],
        inReserve: new Set<ActiveColour>([1, 2, 3, 4, 5]),
    };
}

export function initialClaimed(): [ActiveColour[], ActiveColour[]] {
    return [[], []];
}

export function buildDealPool(): PieceColour[] {
    const pool: PieceColour[] = [];
    for (const c of [1, 2, 3, 4, 5] as ActiveColour[]) {
        for (let i = 0; i < COLOURS_PER_ACTIVE; i++) {
            pool.push(c);
        }
    }
    for (let i = 0; i < JOKER_COUNT; i++) {
        pool.push(6);
    }
    return pool;
}

export function buildRandomBoard(graph: LyngkGraph, rng?: GameRng): Board {
    const cells = graph.playableCells();
    if (cells.length !== LYNGK_INTERSECTIONS) {
        throw new Error(`Expected ${LYNGK_INTERSECTIONS} cells, got ${cells.length}`);
    }
    const pool = shuffle(buildDealPool(), rng);
    if (pool.length !== cells.length) {
        throw new Error(`Deal pool size ${pool.length} does not match board ${cells.length}`);
    }
    const board: Board = new Map();
    for (let i = 0; i < cells.length; i++) {
        board.set(cells[i]!, [pool[i]!]);
    }
    return board;
}

export function cloneBoard(board: Board): Board {
    return new Map([...board.entries()].map(([k, v]) => [k, [...v]]));
}

/** JSON leaves `owner` slots as `null` when unclaimed; treat as neutral (either player may use that colour). */
export function normalizeClaims(claims: ClaimState): ClaimState {
    const owner = claims.owner.map((o) => (o == null ? undefined : o)) as ClaimState["owner"];
    const inReserve =
        claims.inReserve instanceof Set
            ? new Set(claims.inReserve)
            : new Set(claims.inReserve as Iterable<ActiveColour>);
    return { owner, inReserve };
}

export function cloneClaims(claims: ClaimState): ClaimState {
    return normalizeClaims(claims);
}

export function serializeStartingBoard(graph: LyngkGraph, board: Board): string {
    return graph
        .playableCells()
        .map((cell) => {
            const stack = board.get(cell);
            return stack === undefined ? "-" : String(stack[0]);
        })
        .join("");
}