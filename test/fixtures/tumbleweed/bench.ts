import {
    TumbleweedGame,
    type IMoveState,
    type ITumbleweedState,
    type playerid,
} from "../../../src/games/tumbleweed.js";

type BoardCell = [string, [playerid, number]];

/** Deterministic midgame (reinforce-notation shape) for render / moves benches. */
export function midgameBenchGame(): TumbleweedGame {
    const version = TumbleweedGame.gameinfo.version;
    const board: BoardCell[] = [
        ["h8", [3, 2]],
        ["g7", [1, 1]],
        ["g9", [1, 1]],
        ["i8", [1, 1]],
    ];
    const stack: IMoveState[] = [];
    for (let i = 0; i < 5; i++) {
        const isLast = i === 4;
        stack.push({
            _version: version,
            _results: [],
            _timestamp: new Date(),
            currplayer: isLast ? 1 : (((i + 1) % 2) + 1) as playerid,
            board: new Map(board),
            lastmove: isLast ? "pass" : (i > 0 ? "pass" : undefined),
            scores: [0, 0],
        });
    }
    const state: ITumbleweedState = {
        game: "tumbleweed",
        numplayers: 2,
        variants: [],
        gameover: false,
        winner: [],
        stack,
    };
    return new TumbleweedGame(state);
}

export function openingBenchGame(): TumbleweedGame {
    return new TumbleweedGame();
}

/**
 * Play trusted plies until `stack.length === targetDepth` or game ends.
 * Uses first non-pass legal move each ply (deterministic given fixed opening).
 */
export function playToStackDepth(targetDepth: number): TumbleweedGame {
    let g = new TumbleweedGame();
    while (g.stack.length < targetDepth && !g.gameover) {
        const legal = g.moves();
        const m = legal.find((x) => x !== "pass") ?? "pass";
        g = g.move(m, { trusted: true });
    }
    return g;
}

/** Serialized full game at ~12 plies for load / hydrate benches. */
export function serializedGameAtPly12(): string {
    return playToStackDepth(12).serialize();
}
