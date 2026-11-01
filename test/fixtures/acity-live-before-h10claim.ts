import type { ACityColor, ACityMarkerPos, ACityPiece, IACityState } from "../../src/games/acity";

/** Stack tip before ply RT-h10(g6) in live game 6c4d9521-06a9-4a6f-8efc-873bad2ebbd4 */
export const liveBeforeH10Claim: IACityState = {
    game: "acity",
    numplayers: 2,
    variants: [],
    gameover: false,
    winner: [],
    startpos: [
        ["B", 0], ["R", 1], ["N", 3], ["R", 1], ["B", 0], ["N", 1], ["B", 3], ["N", 3],
        ["G", 1], ["R", 3], ["R", 3], ["G", 1], ["G", 0], ["B", 0], ["G", 3], ["B", 2],
        ["N", 3], ["G", 1], ["R", 3], ["N", 1],
    ] as [ACityColor, ACityMarkerPos][],
    stack: [
        {
            _version: "20230531",
            _results: [{ type: "place", where: "a2", what: "red tower" }, { type: "claim", where: "a2" }],
            _timestamp: new Date("2026-10-27T12:09:45.837Z"),
            currplayer: 2,
            lastmove: "RT-a2(a2)",
            board: new Map<string, ACityPiece>([
                ["b5", "GD"], ["e6", "RD"], ["d6", "RD"], ["g4", "BD"], ["g7", "ND"], ["c2", "GD"],
                ["d4", "BD"], ["e10", "ND"], ["e2", "RD"], ["h1", "ND"], ["c7", "ND"], ["g5", "GD"],
                ["e4", "GD"], ["b9", "BD"], ["e8", "BD"], ["c9", "RD"], ["f4", "GD"], ["h9", "RD"],
                ["f2", "RD"], ["a3", "GD"], ["g2", "ND"], ["g1", "BT"], ["f8", "BD"], ["c8", "ND"],
                ["g6", "GT"], ["a7", "BD"], ["f10", "RT"], ["c10", "RT"], ["d10", "BT"], ["g8", "BT"],
                ["h8", "RT"], ["c1", "GT"], ["c4", "BT"], ["a1", "BT"], ["a2", "RT"],
            ]),
            stashes: [["GT"], ["RT", "GT"]],
            claimed: [["d10", "a2"], ["g1", "h8"]],
        },
    ],
};
