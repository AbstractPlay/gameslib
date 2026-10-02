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
    fogMemory?: [Map<string, [playerid, number] | null>, Map<string, [playerid, number] | null>];
}): TumbleweedGame {
    const version = opts.version ?? TumbleweedGame.gameinfo.version;
    const stack: IMoveState[] = [];
    for (let i = 0; i < opts.stackDepth; i++) {
        const isLast = i === opts.stackDepth - 1;
        const entry: IMoveState = {
            _version: version,
            _results: [],
            _timestamp: new Date(),
            currplayer: isLast ? (opts.currplayer ?? 1) : (((i + 1) % 2) + 1) as playerid,
            board: new Map(opts.board),
            lastmove: isLast ? opts.lastmove : (i > 0 ? "pass" : undefined),
            scores: opts.scores ?? [0, 0],
        };
        if (opts.fogMemory !== undefined && isLast) {
            entry.fogMemory = [new Map(opts.fogMemory[0]), new Map(opts.fogMemory[1])];
        }
        stack.push(entry);
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

    describe("fog variant", () => {
        it("resolveFlags adds no-explore when fog is selected", () => {
            expect(TumbleweedGame.resolveFlags({ variants: ["fog"] })).to.include("no-explore");
            expect(TumbleweedGame.resolveFlags({ variants: [] })).to.not.include("no-explore");
        });

        it("sidebarScores is empty when fog is on", () => {
            const g = tumbleweedFrom({
                board: [["h8", [3, 2]]],
                stackDepth: 3,
                variants: ["fog"],
            });
            expect(g.sidebarScores()).to.deep.equal([]);
        });

        it("records fogMemory on stack entries after the opening", () => {
            const g0 = new TumbleweedGame(undefined, ["fog", "size-6"]);
            const g = g0.move(g0.moves()[0]!, { trusted: true });
            const mem = g.stack[g.stack.length - 1].fogMemory;
            expect(mem).to.not.be.undefined;
            expect(mem![0].size).to.be.greaterThan(0);
            expect(mem![1].size).to.be.greaterThan(0);
        });

        it("shows the opening centre neutral live before placement", () => {
            const g = new TumbleweedGame(undefined, ["fog"]);
            const rep = g.render({ perspective: 1 });
            expect(rep.pieces).to.include("E2");
            expect(rep.pieces).to.not.include("xE2");
        });

        it("dims the centre when opening placement leaves it out of line of sight", () => {
            const g = new TumbleweedGame(undefined, ["fog", "size-6"]).move("k1,j2", { trusted: true });
            const rep = g.render({ perspective: 1 });
            expect(rep.pieces).to.include("xE2");
        });

        it("strip for a seat projects stale memory and omits fogMemory", () => {
            const p1Memory = new Map<string, [playerid, number] | null>([["o1", [2, 2]]]);
            const p2Memory = new Map<string, [playerid, number] | null>([["p1", [1, 1]]]);
            const g = tumbleweedFrom({
                board: [
                    ["h8", [3, 2]],
                    ["o1", [2, 3]],
                ],
                currplayer: 1,
                stackDepth: 4,
                variants: ["fog"],
                fogMemory: [p1Memory, p2Memory],
            });
            const stripped = g.state({ strip: true, player: 1 });
            const top = stripped.stack[stripped.stack.length - 1];
            expect(top.fogMemory).to.be.undefined;
            expect(top.board.has("o1")).to.be.true;
            expect(top.board.get("o1")).to.deep.equal([2, 2]);
            expect(top.board.has("p1")).to.be.false;
        });

        it("observer strip omits fogMemory and cells only one player remembers", () => {
            const p2Memory = new Map<string, [playerid, number] | null>([["p1", [1, 1]]]);
            const g = tumbleweedFrom({
                board: [
                    ["h8", [3, 2]],
                    ["g7", [1, 1]],
                ],
                currplayer: 1,
                stackDepth: 4,
                variants: ["fog"],
                fogMemory: [new Map(), p2Memory],
            });
            const stripped = g.state({ strip: true });
            const top = stripped.stack[stripped.stack.length - 1];
            expect(top.fogMemory).to.be.undefined;
            expect(top.board.has("p1")).to.be.false;
        });

        it("shows both opening stones while placing; stale opponent stone after commit when off line of sight", () => {
            const g0 = new TumbleweedGame(undefined, ["fog", "size-6"]);
            const gPartial = new TumbleweedGame(g0.serialize());
            gPartial.move("k1,j3", { partial: true });
            const partialRep = gPartial.render({ perspective: 1 });
            expect(partialRep.pieces).to.include("A1");
            expect(partialRep.pieces).to.include("B1");
            expect(partialRep.pieces).to.not.include("xB1");

            const g = g0.move("k1,j3", { trusted: true });
            const rep = g.render({ perspective: 1 });
            const tokens = rep.pieces.split(/[\n,]+/);
            expect(tokens).to.include("A1");
            expect(tokens).to.include("xB1");
            expect(tokens).to.not.include("B1");

            const stripped = g.state({ strip: true, player: 1 });
            const top = stripped.stack[stripped.stack.length - 1]!;
            expect(top.board.has("k1")).to.be.true;
            expect(top.board.has("j3")).to.be.true;
            expect(top.board.get("j3")).to.deep.equal([2, 1]);
        });

        it("stripped reload shows opponent stones on projected board as stale", () => {
            const g0 = new TumbleweedGame(undefined, ["fog", "size-6"]);
            const g = g0.move("k1,j3", { trusted: true });
            const stripped = g.state({ strip: true, player: 1 });
            const loaded = new TumbleweedGame(stripped);
            const rep = loaded.render({ perspective: 1 });
            const tokens = rep.pieces.split(/[\n,]+/);
            expect(tokens).to.include("A1");
            expect(tokens).to.include("xB1");
            expect(tokens).to.not.include("B1");
        });

        it("partial pass keeps committed fog until the pass is saved", () => {
            const g0 = new TumbleweedGame(undefined, ["fog", "size-6"]);
            const opening = g0.moves()[0]!;
            const g = g0.move(opening, { trusted: true });
            const before = g.render({ perspective: 2 });
            const gPartial = new TumbleweedGame(g.serialize());
            gPartial.move("pass", { partial: true });
            const during = gPartial.render({ perspective: 2 });
            expect(before.pieces).to.include("A1");
            expect(before.pieces).to.not.include("xA1");
            expect(during.pieces).to.equal(before.pieces);
        });

        it("opening ply move string is the full wire for move history", () => {
            const g0 = new TumbleweedGame(undefined, ["fog", "size-6"]);
            const opening = g0.moves()[0]!;
            const g = g0.move(opening, { trusted: true });
            const ply = g.getPlies().find(p => p.stackIndex === 1)!;
            expect(ply.move).to.equal(opening);
            expect(g.stack[1]!.lastmove).to.equal(opening);
            expect(ply.move).to.match(/,.+/);
        });

        it("moveHistory shows full opening wire from place results when lastmove is incomplete", () => {
            const g0 = new TumbleweedGame(undefined, ["fog", "size-6"]);
            const opening = g0.moves()[0]!;
            const g = g0.move(opening, { trusted: true });
            g.stack[1]!.lastmove = opening.split(",")[0]!;
            const round = g.moveHistory()[0]!;
            expect(round[0]).to.equal(opening);
        });

        it("reconstructs opening wire from board delta when lastmove and results are incomplete", () => {
            const g0 = new TumbleweedGame(undefined, ["fog", "size-6"]);
            const opening = g0.moves()[0]!;
            const g = g0.move(opening, { trusted: true });
            const p1 = opening.split(",")[0]!;
            g.stack[1]!.lastmove = p1;
            g.stack[1]!._results = [{ type: "place", who: 1, where: p1, count: 1 }];
            expect(g.moveHistory()[0]![0]).to.equal(opening);
            expect(g.getPlies().find(p => p.stackIndex === 1)!.move).to.equal(opening);
            const stripped = g.state({ strip: true, player: 1 });
            expect(stripped.stack[1]!.lastmove).to.equal(opening);
        });

        it("load repairs legacy opening lastmove on stack[1] from place results", () => {
            const g0 = new TumbleweedGame(undefined, ["fog", "size-6"]);
            const opening = g0.moves()[0]!;
            const g = g0.move(opening, { trusted: true });
            g.stack[1]!.lastmove = opening.split(",")[0]!;
            const reloaded = new TumbleweedGame(g.serialize());
            expect(reloaded.stack[1]!.lastmove).to.equal(opening);
        });

        it("free-neutral opening with fog seeds player-placed neutral into fog memory", () => {
            const g0 = new TumbleweedGame(undefined, ["fog", "free-neutral", "size-6"]);
            const opening = "k1,j2,k3";
            const neutralCell = "k1";
            const g = g0.move(opening, { trusted: true });
            expect(g.stack[1]!.lastmove).to.equal(opening);
            const mem = g.stack[g.stack.length - 1].fogMemory!;
            expect(mem[0].has(neutralCell)).to.be.true;
            expect(mem[1].has(neutralCell)).to.be.true;
            expect(mem[0].get(neutralCell)).to.deep.equal([3, 2]);
        });

        it("strip leaves opening stack entry board and lastmove untouched", () => {
            const g0 = new TumbleweedGame(undefined, ["fog", "size-6"]);
            const g = g0.move("k1,j3", { trusted: true });
            const fullBoard = new Map(g.stack[1]!.board);
            const stripped = g.state({ strip: true, player: 1 });
            expect(stripped.stack[1]!.lastmove).to.equal("k1,j3");
            expect(stripped.stack[1]!.board).to.deep.equal(fullBoard);
            expect(stripped.stack[1]!.fogMemory).to.be.undefined;
        });

        it("redacts opponent lastmoves in stripped state but keeps the opening ply public", () => {
            const g0 = new TumbleweedGame(undefined, ["fog", "size-6"]);
            const opening = g0.moves()[0]!;
            let g = g0.move(opening, { trusted: true });
            g = g.move("pass", { trusted: true });
            const placement = g.moves().find(m => m !== "pass")!;
            g = g.move(placement, { trusted: true });

            const openingLast = g.stack[1]!.lastmove!;
            const hiddenLast = g.stack[3]!.lastmove!;
            expect(openingLast).to.not.equal(TumbleweedGame.REDACTED_FOG_LASTMOVE);
            expect(hiddenLast).to.not.equal("pass");

            const p1 = g.state({ strip: true, player: 1 });
            expect(p1.stack[1]!.lastmove).to.equal(openingLast);
            expect(p1.stack[3]!.lastmove).to.equal(hiddenLast);

            const p2 = g.state({ strip: true, player: 2 });
            expect(p2.stack[1]!.lastmove).to.equal(openingLast);
            expect(p2.stack[3]!.lastmove).to.equal(TumbleweedGame.REDACTED_FOG_LASTMOVE);

            const observer = g.state({ strip: true });
            expect(observer.stack[1]!.lastmove).to.equal(openingLast);
            expect(observer.stack[3]!.lastmove).to.equal(TumbleweedGame.REDACTED_FOG_LASTMOVE);
        });

        it("render uses x-prefixed legend keys for stale cells", () => {
            const p1Memory = new Map<string, [playerid, number] | null>([["o1", [2, 2]]]);
            const g = tumbleweedFrom({
                board: [
                    ["h8", [3, 2]],
                    ["g7", [1, 1]],
                ],
                currplayer: 1,
                stackDepth: 4,
                variants: ["fog"],
                fogMemory: [p1Memory, new Map()],
            });
            const rep = g.render({ perspective: 1 });
            expect(rep.pieces).to.match(/xB2/);
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
