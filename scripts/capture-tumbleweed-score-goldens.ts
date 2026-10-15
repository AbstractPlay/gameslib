/* eslint-disable no-console */
import { TumbleweedGame, type playerid } from "../src/games/tumbleweed.js";

type BoardCell = [string, [playerid, number]];

function tumbleweedFrom(opts: {
    board: BoardCell[];
    currplayer?: playerid;
    lastmove?: string;
    stackDepth: number;
    variants?: string[];
}): TumbleweedGame {
    const version = TumbleweedGame.gameinfo.version;
    const stack = [];
    for (let i = 0; i < opts.stackDepth; i++) {
        const isLast = i === opts.stackDepth - 1;
        stack.push({
            _version: version,
            _results: [],
            _timestamp: new Date(),
            currplayer: isLast ? (opts.currplayer ?? 1) : (((i + 1) % 2) + 1) as playerid,
            board: new Map(opts.board),
            lastmove: isLast ? opts.lastmove : (i > 0 ? "pass" : undefined),
            scores: [0, 0],
        });
    }
    return new TumbleweedGame({
        game: "tumbleweed",
        numplayers: 2,
        variants: opts.variants ?? [],
        gameover: false,
        winner: [],
        stack,
    });
}

type Priv = {
    updateScores(): void;
    threatenedPiecesOnBoard(board: Map<string, [playerid, number]>): Set<string>;
};

function asPriv(g: TumbleweedGame): Priv {
    return g as unknown as Priv;
}

const cases = [
    {
        name: "midgame-sparse",
        g: tumbleweedFrom({
            board: [["h8", [3, 2]], ["o1", [1, 1]], ["o2", [2, 1]]],
            currplayer: 1,
            lastmove: "o2",
            stackDepth: 4,
        }),
    },
    {
        name: "reinforce-notation",
        g: tumbleweedFrom({
            board: [["h8", [3, 2]], ["g7", [1, 1]], ["g9", [1, 1]], ["i8", [1, 1]]],
            currplayer: 1,
            lastmove: "pass",
            stackDepth: 5,
        }),
    },
    {
        name: "neutral-blocks-los",
        g: tumbleweedFrom({
            board: [["h8", [3, 2]], ["g8", [1, 1]], ["i8", [1, 1]]],
            currplayer: 1,
            lastmove: "pass",
            stackDepth: 5,
        }),
    },
    {
        name: "capture-notation",
        g: tumbleweedFrom({
            board: [["h8", [3, 2]], ["g7", [1, 1]], ["i7", [1, 1]], ["h7", [2, 1]]],
            currplayer: 1,
            lastmove: "pass",
            stackDepth: 5,
        }),
    },
];

for (const { name, g } of cases) {
    asPriv(g).updateScores();
    const threatened = [...asPriv(g).threatenedPiecesOnBoard(g.board)].sort();
    console.log(JSON.stringify({ name, scores: g.scores, threatened }));
}
