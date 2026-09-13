/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import {
    TumbleweedGame,
    type IMoveState,
    type ITumbleweedState,
    type playerid,
} from "../../src/games/tumbleweed.js";
import {
    expectMovesMatchReference,
    getLosCountReference,
    movesReference,
    sortedMoves,
} from "../fixtures/tumbleweed/movesReference.js";

type BoardCell = [string, [playerid, number]];

export function tumbleweedFrom(opts: {
    board: BoardCell[];
    currplayer?: playerid;
    lastmove?: string;
    stackDepth: number;
    variants?: string[];
    version?: string;
    scores?: [number, number];
    gameover?: boolean;
}): TumbleweedGame {
    const version = opts.version ?? TumbleweedGame.gameinfo.version;
    const stack: IMoveState[] = [];
    for (let i = 0; i < opts.stackDepth; i++) {
        const isLast = i === opts.stackDepth - 1;
        stack.push({
            _version: version,
            _results: [],
            _timestamp: new Date(),
            currplayer: isLast ? (opts.currplayer ?? 1) : (((i + 1) % 2) + 1) as playerid,
            board: new Map(opts.board),
            lastmove: isLast ? opts.lastmove : (i > 0 ? "pass" : undefined),
            scores: opts.scores ?? [0, 0],
        });
    }
    const state: ITumbleweedState = {
        game: "tumbleweed",
        numplayers: 2,
        variants: opts.variants ?? [],
        gameover: opts.gameover ?? false,
        winner: [],
        stack,
    };
    return new TumbleweedGame(state);
}


const regressionFixtures: {
    name: string;
    build: () => TumbleweedGame;
    players?: playerid[];
    skipValidate?: boolean;
}[] = [
    {
        name: "default-opening",
        build: () => new TumbleweedGame(),
        players: [1],
    },
    {
        name: "size-6-opening",
        build: () => new TumbleweedGame(undefined, ["size-6"]),
        players: [1],
    },
    {
        name: "free-neutral-opening",
        build: () => new TumbleweedGame(undefined, ["free-neutral"]),
        skipValidate: true,
    },
    {
        name: "ply2-p2-pass-only",
        build: () => {
            const g0 = new TumbleweedGame();
            return g0.move(g0.moves()[0]!, { trusted: true });
        },
        players: [2],
    },
    {
        name: "ply3-no-pass",
        build: () => {
            const g0 = new TumbleweedGame();
            return g0
                .move(g0.moves()[0]!, { trusted: true })
                .move("pass", { trusted: true });
        },
    },
    {
        name: "midgame-sparse",
        build: () => tumbleweedFrom({
            board: [
                ["h8", [3, 2]],
                ["o1", [1, 1]],
                ["o2", [2, 1]],
            ],
            currplayer: 1,
            lastmove: "o2",
            stackDepth: 4,
        }),
        players: [1, 2],
    },
    {
        name: "reinforce-notation",
        build: () => tumbleweedFrom({
            board: [
                ["h8", [3, 2]],
                ["g7", [1, 1]],
                ["g9", [1, 1]],
                ["i8", [1, 1]],
            ],
            currplayer: 1,
            lastmove: "pass",
            stackDepth: 5,
        }),
        players: [1],
    },
    {
        name: "capture-notation",
        build: () => tumbleweedFrom({
            board: [
                ["h8", [3, 2]],
                ["g7", [1, 1]],
                ["i7", [1, 1]],
                ["h7", [2, 1]],
            ],
            currplayer: 1,
            lastmove: "pass",
            stackDepth: 5,
        }),
        players: [1],
    },
    {
        name: "capture-delay",
        build: () => tumbleweedFrom({
            board: [
                ["h8", [3, 2]],
                ["g7", [1, 2]],
                ["g9", [1, 1]],
                ["i8", [1, 1]],
            ],
            currplayer: 1,
            lastmove: "g7+",
            stackDepth: 5,
            variants: ["capture-delay"],
        }),
        players: [1],
    },
    {
        name: "legacy-no-suffix",
        build: () => tumbleweedFrom({
            board: [
                ["h8", [3, 2]],
                ["g7", [1, 1]],
                ["g9", [1, 1]],
                ["i8", [1, 1]],
            ],
            currplayer: 1,
            lastmove: "pass",
            stackDepth: 5,
            version: "20231229",
        }),
        players: [1],
    },
    {
        name: "neutral-blocks-los",
        build: () => tumbleweedFrom({
            board: [
                ["h8", [3, 2]],
                ["g8", [1, 1]],
                ["i8", [1, 1]],
            ],
            currplayer: 1,
            lastmove: "pass",
            stackDepth: 5,
        }),
        players: [1, 2],
    },
    {
        name: "size-10-midgame",
        build: () => tumbleweedFrom({
            board: [
                ["k10", [3, 2]],
                ["j9", [1, 1]],
                ["l11", [2, 1]],
            ],
            currplayer: 1,
            lastmove: "l11",
            stackDepth: 5,
            variants: ["size-10"],
        }),
        players: [1, 2],
    },
];

function computeLosForPlayerViaCast(g: TumbleweedGame, player: playerid): Map<string, number> {
    return (g as unknown as { computeLosForPlayer(p: playerid): Map<string, number> }).computeLosForPlayer(player);
}

describe("Tumbleweed", () => {
    describe("moves() regression", () => {
        for (const { name, build, players, skipValidate } of regressionFixtures) {
            for (const player of players ?? [undefined as unknown as playerid]) {
                const label = player === undefined ? name : `${name} (player ${player})`;
                it(`matches reference oracle for ${label}`, () => {
                    const g = build();
                    expectMovesMatchReference(g, player);
                });
            }
            if (!skipValidate) {
                it(`every move validates for ${name}`, () => {
                    const g = build();
                    for (const move of g.moves()) {
                        expect(g.validateMove(move).valid, move).to.be.true;
                    }
                });
            }
        }

        it("round-trip smoke: one ply still matches reference", () => {
            const g = tumbleweedFrom({
                board: [
                    ["h8", [3, 2]],
                    ["o1", [1, 1]],
                    ["o2", [2, 1]],
                ],
                currplayer: 1,
                lastmove: "o2",
                stackDepth: 4,
            });
            const move = g.moves().find(m => m !== "pass");
            expect(move).to.not.equal(undefined);
            const g2 = g.move(move!, { trusted: true });
            expectMovesMatchReference(g2);
        });
    });

    describe("moves() contracts", () => {
        it("standard opening move count excludes centre and pass", () => {
            const g = new TumbleweedGame();
            const cells = (g.graph!.listCells() as string[]).length;
            expect(g.moves().length).to.equal((cells - 1) * (cells - 2));
            expect(g.moves()).to.not.include("pass");
        });

        it("ply 3 omits pass", () => {
            const g0 = new TumbleweedGame();
            const g = g0
                .move(g0.moves()[0]!, { trusted: true })
                .move("pass", { trusted: true });
            expect(g.moves()).to.not.include("pass");
        });

        it("reinforce fixture includes a + move", () => {
            const g = regressionFixtures.find(f => f.name === "reinforce-notation")!.build();
            expect(g.moves().some(m => m.endsWith("+"))).to.be.true;
        });

        it("capture fixture includes an x move", () => {
            const g = regressionFixtures.find(f => f.name === "capture-notation")!.build();
            expect(g.moves().some(m => m.endsWith("x"))).to.be.true;
        });

        it("capture-delay excludes the last-move cell", () => {
            const g = regressionFixtures.find(f => f.name === "capture-delay")!.build();
            expect(g.moves()).to.not.include("g7+");
            expect(movesReference(g).some(m => m === "g7+")).to.be.false;
        });

        it("legacy version uses bare cell names on occupied intersections", () => {
            const g = regressionFixtures.find(f => f.name === "legacy-no-suffix")!.build();
            const occupiedMoves = g.moves().filter(m => m !== "pass" && g.board.has(m));
            expect(occupiedMoves.length).to.be.greaterThan(0);
            expect(occupiedMoves.every(m => !m.endsWith("+") && !m.endsWith("x"))).to.be.true;
        });
    });

    describe("computeLosForPlayer parity", () => {
        for (const { name, build, players } of regressionFixtures) {
            if (name === "default-opening" || name === "size-6-opening" || name === "free-neutral-opening") {
                continue;
            }
            for (const player of players ?? [1, 2]) {
                it(`agrees with cell-centric reference for ${name} (player ${player})`, () => {
                    const g = build();
                    if (g.stack.length <= 2 && player === 2 && g.stack.length === 2) {
                        return;
                    }
                    const graph = g.graph!;
                    const losMap = computeLosForPlayerViaCast(g, player);
                    for (const cell of graph.listCells() as string[]) {
                        const expected = getLosCountReference(g.board, graph, cell, player);
                        expect(losMap.get(cell) ?? 0, `${cell} for P${player}`).to.equal(expected);
                    }
                });
            }
        }
    });
});

export { sortedMoves };
