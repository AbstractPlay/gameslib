import { BaoGame } from "../../src/games";

export type BaoBoard = [
    number[],
    number[],
    number[],
    number[],
];

export type BaoFixtureOpts = {
    currplayer?: 1 | 2;
    inhand?: [number, number];
    houses?: [string | undefined, string | undefined];
    blocked?: [string | undefined, string | undefined];
    lastmove?: string;
};

/** Build a cloneable game from a 4×8 board matrix (same layout as BaoGame.board). */
export function baoFromBoard(board: BaoBoard, opts: BaoFixtureOpts = {}): BaoGame {
    const g = new BaoGame();
    g.board = board.map((row) => [...row]);
    g.currplayer = opts.currplayer ?? 1;
    g.inhand = opts.inhand ?? [22, 22];
    g.houses = opts.houses ?? ["e2", "d3"];
    g.blocked = opts.blocked ?? [undefined, undefined];
    if (opts.lastmove !== undefined) {
        g.lastmove = opts.lastmove;
    }
    return g;
}
