import type { IChameleonState } from "../../../src/games/chameleon.js";

/** Production game e52866f2 — terminal ply labelled annihilation while seat 1 still had pieces. */
export const wrongAnnihilationEogState: IChameleonState = {
    game: "chameleon",
    numplayers: 2,
    variants: [],
    gameover: true,
    winner: [2],
    stack: [
        {
            _version: "20250130",
            _results: [],
            _timestamp: new Date("2026-11-06T19:39:23.939Z"),
            currplayer: 1,
            board: new Map([
                ["a5", "BW"], ["b5", "BB"], ["c5", "BW"], ["d5", "BB"], ["e5", "BW"],
                ["a1", "AW"], ["b1", "AB"], ["c1", "AW"], ["d1", "AB"], ["e1", "AW"],
            ]),
        },
        {
            _version: "20250130",
            _results: [{ type: "move", from: "c1", to: "d2" }],
            _timestamp: new Date("2026-11-06T22:27:49.143Z"),
            currplayer: 2,
            lastmove: "c1-d2",
            board: new Map([
                ["a5", "BW"], ["b5", "BB"], ["c5", "BW"], ["d5", "BB"], ["e5", "BW"],
                ["a1", "AW"], ["b1", "AB"], ["d1", "AB"], ["e1", "AW"], ["d2", "AW"],
            ]),
        },
        {
            _version: "20250130",
            _results: [{ type: "move", from: "a5", to: "a4" }],
            _timestamp: new Date("2026-11-08T14:03:56.575Z"),
            currplayer: 1,
            lastmove: "a5-a4",
            board: new Map([
                ["b5", "BB"], ["c5", "BW"], ["d5", "BB"], ["e5", "BW"],
                ["a1", "AW"], ["b1", "AB"], ["d1", "AB"], ["e1", "AW"], ["d2", "AW"], ["a4", "BW"],
            ]),
        },
        {
            _version: "20250130",
            _results: [{ type: "move", from: "a1", to: "a2" }],
            _timestamp: new Date("2026-11-08T17:30:02.465Z"),
            currplayer: 2,
            lastmove: "a1-a2",
            board: new Map([
                ["b5", "BB"], ["c5", "BW"], ["d5", "BB"], ["e5", "BW"],
                ["b1", "AB"], ["d1", "AB"], ["e1", "AW"], ["d2", "AW"], ["a4", "BW"], ["a2", "AW"],
            ]),
        },
        {
            _version: "20250130",
            _results: [{ type: "move", from: "d5", to: "d4" }],
            _timestamp: new Date("2026-11-09T15:25:03.241Z"),
            currplayer: 1,
            lastmove: "d5-d4",
            board: new Map([
                ["b5", "BB"], ["c5", "BW"], ["e5", "BW"],
                ["b1", "AB"], ["d1", "AB"], ["e1", "AW"], ["d2", "AW"], ["a4", "BW"], ["a2", "AW"], ["d4", "BB"],
            ]),
        },
        {
            _version: "20250130",
            _results: [{ type: "move", from: "d1", to: "c2" }],
            _timestamp: new Date("2026-11-09T17:35:21.098Z"),
            currplayer: 2,
            lastmove: "d1-c2",
            board: new Map([
                ["b5", "BB"], ["c5", "BW"], ["e5", "BW"],
                ["b1", "AB"], ["e1", "AW"], ["d2", "AW"], ["a4", "BW"], ["a2", "AW"], ["d4", "BB"], ["c2", "AB"],
            ]),
        },
        {
            _version: "20250130",
            _results: [{ type: "move", from: "a4", to: "c2" }, { type: "capture", where: "c2" }],
            _timestamp: new Date("2026-11-09T19:40:07.603Z"),
            currplayer: 1,
            lastmove: "a4xc2",
            board: new Map([
                ["b5", "BB"], ["c5", "BW"], ["e5", "BW"],
                ["b1", "AB"], ["e1", "AW"], ["d2", "AW"], ["a2", "AW"], ["d4", "BB"], ["c2", "BW"],
            ]),
        },
        {
            _version: "20250130",
            _results: [{ type: "move", from: "d2", to: "c2" }, { type: "capture", where: "c2" }],
            _timestamp: new Date("2026-11-10T04:16:32.531Z"),
            currplayer: 2,
            lastmove: "d2xc2",
            board: new Map([
                ["b5", "BB"], ["c5", "BW"], ["e5", "BW"],
                ["b1", "AB"], ["e1", "AW"], ["a2", "AW"], ["d4", "BB"], ["c2", "AW"],
            ]),
        },
        {
            _version: "20250130",
            _results: [{ type: "move", from: "b5", to: "b4" }],
            _timestamp: new Date("2026-11-10T14:22:39.941Z"),
            currplayer: 1,
            lastmove: "b5-b4",
            board: new Map([
                ["c5", "BW"], ["e5", "BW"],
                ["b1", "AB"], ["e1", "AW"], ["a2", "AW"], ["d4", "BB"], ["c2", "AW"], ["b4", "BB"],
            ]),
        },
        {
            _version: "20250130",
            _results: [{ type: "move", from: "e1", to: "d2" }],
            _timestamp: new Date("2026-11-10T19:42:25.103Z"),
            currplayer: 2,
            lastmove: "e1-d2",
            board: new Map([
                ["c5", "BW"], ["e5", "BW"],
                ["b1", "AB"], ["a2", "AW"], ["d4", "BB"], ["c2", "AW"], ["b4", "BB"], ["d2", "AW"],
            ]),
        },
        {
            _version: "20250130",
            _results: [{ type: "move", from: "d4", to: "e4" }],
            _timestamp: new Date("2026-11-10T20:00:15.391Z"),
            currplayer: 1,
            lastmove: "d4-e4",
            board: new Map([
                ["c5", "BW"], ["e5", "BW"],
                ["b1", "AB"], ["a2", "AW"], ["c2", "AW"], ["b4", "BB"], ["d2", "AW"], ["e4", "BB"],
            ]),
        },
        {
            _version: "20250130",
            _results: [{ type: "move", from: "d2", to: "e1" }],
            _timestamp: new Date("2026-11-11T05:55:20.904Z"),
            currplayer: 2,
            lastmove: "d2-e1",
            board: new Map([
                ["c5", "BW"], ["e5", "BW"],
                ["b1", "AB"], ["a2", "AW"], ["c2", "AW"], ["b4", "BB"], ["e4", "BB"], ["e1", "AW"],
            ]),
        },
        {
            _version: "20250130",
            _results: [
                { type: "move", from: "b4", to: "e1" },
                { type: "capture", where: "e1" },
                { type: "eog", reason: "annihilation" },
                { type: "winners", players: [2] },
            ],
            _timestamp: new Date("2026-11-11T14:11:00.114Z"),
            currplayer: 1,
            lastmove: "b4xe1",
            board: new Map([
                ["c5", "BW"], ["e5", "BW"],
                ["b1", "AB"], ["a2", "AW"], ["c2", "AW"], ["e4", "BB"], ["e1", "BB"],
            ]),
        },
    ],
};
