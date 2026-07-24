import { IMoveState } from "../../src/games/evenatodds";

/**
 * P2 holds 1-2 (tile id 8). Empty -3,1 is adjacent to pip 1 at -2,1 (E) and pip 2 at -3,0 (S),
 * so either pip can anchor there — pip-ambiguous placement.
 */
export const ambiguousAnchorPipState: Partial<IMoveState> = {
    currplayer: 2,
    tiles: [
        { id: 7, a: [-2, 1], b: [-1, 1], pipA: 1, pipB: 1, level: 0 },
        { id: 27, a: [0, 1], b: [1, 1], pipA: 6, pipB: 6, level: 0 },
        { id: 13, a: [-2, 0], b: [-1, 0], pipA: 2, pipB: 2, level: 0 },
        { id: 25, a: [0, 0], b: [1, 0], pipA: 5, pipB: 5, level: 0 },
        { id: 18, a: [-2, -1], b: [-1, -1], pipA: 3, pipB: 3, level: 0 },
        { id: 22, a: [0, -1], b: [1, -1], pipA: 4, pipB: 4, level: 0 },
        { id: 14, a: [-3, 0], b: [-4, 0], pipA: 2, pipB: 3, level: 0 },
        { id: 11, a: [-2, 2], b: [-2, 3], pipA: 1, pipB: 5, level: 0 },
        { id: 23, a: [0, -1], b: [-1, -1], pipA: 4, pipB: 5, level: 1 },
        { id: 26, a: [2, 0], b: [2, 1], pipA: 5, pipB: 6, level: 0 },
        { id: 9, a: [-1, 2], b: [0, 2], pipA: 1, pipB: 3, level: 0 },
    ],
    hands: [[5, 0, 20, 12, 21, 24, 3], [2, 8, 1, 4, 6, 10, 19]],
    boneyard: [15],
    removed: [17, 16],
};

/** Board click for half-cell -3,1 in ambiguousAnchorPipState. */
export const ambiguousAnchorCell = { row: 4, col: 3 } as const;

/** Second-end click completing 1*-2@-3,1N / 1-2*@-3,1N in ambiguousAnchorPipState. */
export const ambiguousSecondEndCell = { row: 3, col: 3 } as const;
