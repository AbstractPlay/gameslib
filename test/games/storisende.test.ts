/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import {
    StorisendeGame,
    type IStorisendeState,
    type playerid,
} from "../../src/games/storisende.js";
import { StorisendeBoard } from "../../src/games/storisende/board.js";
import { StorisendeHex } from "../../src/games/storisende/hex.js";
import { StorisendeGraph } from "../../src/games/storisende/graph.js";
import { parseStorisendeRegularMove } from "../../src/games/storisende/moveParse.js";
import { hexNeighbours } from "../../src/common/hexes.js";
import { Orientation } from "honeycomb-grid";
import { x2uid } from "../../src/common/index.js";
import {
    expectMovesMatchReference,
    movesReference,
    sortedMoves,
} from "../fixtures/storisende/movesReference.js";
import { storisendeFrom, storisendeFromState } from "../fixtures/storisende/builders.js";
import midgameHex6State from "../fixtures/storisende/midgameHex6State.json" with { type: "json" };
import legacyShortOpening from "../fixtures/storisende/storage/legacy-short-opening.json" with { type: "json" };
import { expectLoadIdxMatchesLegacyOracle } from "../fixtures/storisende/storage/helpers.js";

function enumerateFromCell(g: StorisendeGame, mover: playerid, from: string): string[] {
    return (g as unknown as StorisendeGame & {
        enumerateFromCell(m: playerid, f: string): string[];
    }).enumerateFromCell(mover, from);
}

function sortedMovesFromCell(g: StorisendeGame, mover: playerid, from: string): string[] {
    return sortedMoves(enumerateFromCell(g, mover, from));
}

function movesFromCellInFullList(g: StorisendeGame, from: string): string[] {
    return sortedMoves(
        g.moves().filter(m => m !== "pass" && (m.startsWith(`${from}-`) || m.startsWith(`${from}:`))),
    );
}

function legacyVirginLeaveKind(g: StorisendeGame, cell: string): "wall" | "territory" {
    const terr = g.board.territories;
    const terrNeighbours = new Set<string>();
    for (const n of g.board.graph.neighbours(cell)) {
        const found = terr.find(t => t.includes(n));
        if (found !== undefined) {
            terrNeighbours.add(x2uid(found));
        }
    }
    return terrNeighbours.size > 1 ? "wall" : "territory";
}

function modernVirginLeaveKind(g: StorisendeGame, cell: string): "wall" | "territory" {
    return g.board.countDistinctTerritoryComponentsAdjacent(cell) > 1 ? "wall" : "territory";
}

function regularMoveLegal(
    g: StorisendeGame,
    mover: playerid,
    from: string,
    to: string,
    height: number,
): boolean {
    const check = (g as unknown as StorisendeGame & {
        regularMoveCheck(m: playerid, f: string, t: string, h: number): string | undefined;
    }).regularMoveCheck;
    return check.call(g, mover, from, to, height) === undefined;
}

function findStraightMove(
    seed: StorisendeGame,
    minDist: number,
): { from: string; to: string; dist: number } | undefined {
    const graph = seed.board.graph;
    for (const fromHex of seed.board.hexes) {
        if (fromHex.tile === "wall") {
            continue;
        }
        const from = seed.board.hex2algebraic(fromHex);
        for (const dir of graph.allDirs) {
            const ray = graph.ray(from, dir);
            for (let i = minDist - 1; i < ray.length; i++) {
                const to = ray[i];
                const thex = seed.board.getHexAtAlgebraic(to);
                if (thex === undefined || thex.tile === "wall") {
                    break;
                }
                const dist = i + 1;
                if (dist >= minDist) {
                    return { from, to, dist };
                }
            }
        }
    }
    return undefined;
}

function parseRegularMoveNotation(m: string, g: StorisendeGame): { from: string; to: string; height: number } {
    if (m === "pass") {
        throw new Error("pass");
    }
    const [left, to] = m.split("-");
    const [from, heightStr] = left.split(":");
    const fhex = g.board.getHexAtAlgebraic(left.includes(":") ? from : left);
    if (fhex === undefined) {
        throw new Error(`no from in ${m}`);
    }
    const height = left.includes(":") ? parseInt(heightStr, 10) : fhex.stack.length;
    return { from: left.includes(":") ? from : left, to, height };
}

function firstStraightTarget(g: StorisendeGame, from: string, maxDist: number): { to: string; dist: number } | undefined {
    const graph = g.board.graph;
    for (const dir of graph.allDirs) {
        const ray = graph.ray(from, dir);
        for (let i = 0; i < Math.min(ray.length, maxDist); i++) {
            const to = ray[i];
            const thex = g.board.getHexAtAlgebraic(to);
            if (thex !== undefined && thex.tile !== "wall") {
                return { to, dist: i + 1 };
            }
        }
    }
    return undefined;
}

function buildFullStackSlide(): StorisendeGame {
    const seed = new StorisendeGame();
    const fromHex = seed.board.hexes.find(h => h.stack.length === 0 && h.tile === "virgin");
    expect(fromHex).to.not.equal(undefined);
    const from = seed.board.hex2algebraic(fromHex!);
    const hit = firstStraightTarget(seed, from, 1);
    expect(hit).to.not.equal(undefined);
    return storisendeFrom({
        cells: {
            [from]: { stack: [1] },
        },
        currplayer: 1,
        lastmove: "pass",
    });
}

function buildSubstackFixture(): StorisendeGame {
    const seed = new StorisendeGame();
    const hit = findStraightMove(seed, 2);
    expect(hit).to.not.equal(undefined);
    return storisendeFrom({
        cells: {
            [hit!.from]: { stack: [1, 1, 1] },
        },
        currplayer: 1,
    });
}

function buildWallClimbBlocked(): StorisendeGame {
    const seed = new StorisendeGame();
    const graph = seed.board.graph;
    const fromHex = seed.board.hexes.find(h => h.stack.length === 0 && h.tile === "virgin");
    const from = seed.board.hex2algebraic(fromHex!);
    for (const dir of graph.allDirs) {
        const ray = graph.ray(from, dir);
        if (ray.length >= 1) {
            const to = ray[0];
            return storisendeFrom({
                cells: {
                    [from]: { stack: [1], tile: "virgin" },
                    [to]: { tile: "wall", stack: [] },
                },
                currplayer: 1,
            });
        }
    }
    throw new Error("could not build wall-climb fixture");
}

function buildWallJumpBlocked(): { g: StorisendeGame; blockedMove: string } {
    const seed = new StorisendeGame();
    const graph = seed.board.graph;
    const fromHex = seed.board.hexes.find(h => h.stack.length === 0 && h.tile === "virgin");
    const from = seed.board.hex2algebraic(fromHex!);
    for (const dir of graph.allDirs) {
        const ray = graph.ray(from, dir);
        if (ray.length >= 2) {
            const mid = ray[0];
            const to = ray[1];
            const blockedMove = `${from}-${to}`;
            const g = storisendeFrom({
                cells: {
                    [from]: { stack: [1, 1], tile: "virgin" },
                    [mid]: { tile: "wall", stack: [] },
                },
                currplayer: 1,
            });
            return { g, blockedMove };
        }
    }
    throw new Error("could not build wall-jump blocked fixture");
}

function buildWallJumpAllowed(): StorisendeGame {
    const seed = new StorisendeGame();
    const graph = seed.board.graph;
    const fromHex = seed.board.hexes.find(h => h.stack.length === 0 && h.tile === "virgin");
    const from = seed.board.hex2algebraic(fromHex!);
    for (const dir of graph.allDirs) {
        const ray = graph.ray(from, dir);
        if (ray.length >= 2) {
            const mid = ray[0];
            return storisendeFrom({
                cells: {
                    [from]: { stack: [1, 1], tile: "virgin" },
                    [mid]: { tile: "wall", stack: [1] },
                },
                currplayer: 1,
            });
        }
    }
    throw new Error("could not build wall-jump allowed fixture");
}

function buildFromWall(): StorisendeGame {
    const seed = new StorisendeGame();
    const graph = seed.board.graph;
    const fromHex = seed.board.hexes.find(h => h.stack.length === 0 && h.tile === "virgin");
    const from = seed.board.hex2algebraic(fromHex!);
    for (const dir of graph.allDirs) {
        const ray = graph.ray(from, dir);
        if (ray.length >= 1) {
            const wallCell = ray[0];
            return storisendeFrom({
                cells: {
                    [from]: { stack: [1], tile: "wall" },
                    [wallCell]: { tile: "wall", stack: [] },
                },
                currplayer: 1,
            });
        }
    }
    throw new Error("could not build from-wall fixture");
}

function buildPlayerOverride(): StorisendeGame {
    const seed = new StorisendeGame();
    const fromHex = seed.board.hexes.find(h => h.stack.length === 0 && h.tile === "virgin");
    const from = seed.board.hex2algebraic(fromHex!);
    const hit = firstStraightTarget(seed, from, 1);
    expect(hit).to.not.equal(undefined);
    return storisendeFrom({
        cells: {
            [from]: { stack: [2] },
        },
        currplayer: 1,
        lastmove: "pass",
    });
}

const regressionFixtures: {
    name: string;
    build: () => StorisendeGame;
    players?: playerid[];
    skipValidate?: boolean;
    timeoutMs?: number;
}[] = [
    {
        name: "post-opening-pass",
        build: () => buildFullStackSlide(),
    },
    {
        name: "full-stack-slide",
        build: () => buildFullStackSlide(),
    },
    {
        name: "substack",
        build: () => buildSubstackFixture(),
    },
    {
        name: "wall-climb-blocked",
        build: () => buildWallClimbBlocked(),
    },
    {
        name: "wall-jump-blocked",
        build: () => buildWallJumpBlocked().g,
    },
    {
        name: "wall-jump-allowed",
        build: () => buildWallJumpAllowed(),
    },
    {
        name: "from-wall",
        build: () => buildFromWall(),
    },
    {
        name: "board-hex6-smoke",
        build: () => storisendeFrom({
            variants: ["board-hex6"],
            cells: { b3: { stack: [1, 1] } },
            currplayer: 1,
            lastmove: "pass",
        }),
    },
    {
        name: "midgame-hex6-vendored",
        build: () => storisendeFromState(midgameHex6State as IStorisendeState),
        timeoutMs: 120_000,
    },
];

describe("Storisende", () => {
    describe("storage read path (legacy goldens)", () => {
        const legacyFixtures: IStorisendeState[] = [
            midgameHex6State as IStorisendeState,
            legacyShortOpening as IStorisendeState,
        ];

        for (const [i, fixture] of legacyFixtures.entries()) {
            const label = i === 0 ? "midgameHex6" : "legacy-short-opening";
            it(`${label}: moves() matches reference after codec load`, () => {
                const g = storisendeFromState(fixture);
                expectMovesMatchReference(g);
            });
            it(`${label}: load(0) and load(last) match fixture boards`, () => {
                const g = storisendeFromState(fixture);
                expectLoadIdxMatchesLegacyOracle(g, 0);
                expectLoadIdxMatchesLegacyOracle(g, g.stack.length - 1);
            });
        }
    });

    describe("moves() regression", () => {
        for (const { name, build, players, skipValidate, timeoutMs } of regressionFixtures) {
            for (const player of players ?? [undefined as unknown as playerid]) {
                const label = player === undefined ? name : `${name} (player ${player})`;
                it(`matches reference oracle for ${label}`, function() {
                    if (timeoutMs !== undefined) {
                        this.timeout(timeoutMs);
                    }
                    const g = build();
                    if (player !== undefined && player !== g.currplayer) {
                        return;
                    }
                    expectMovesMatchReference(g, player);
                });
            }
            if (!skipValidate) {
                it(`every move validates for ${name}`, function() {
                    if (timeoutMs !== undefined) {
                        this.timeout(timeoutMs);
                    }
                    const g = build();
                    for (const move of g.moves()) {
                        expect(g.validateMove(move).valid, move).to.be.true;
                    }
                });
            }
        }

        it("round-trip smoke: one ply still matches reference", () => {
            const g = buildFullStackSlide();
            const move = g.moves().find(m => m !== "pass");
            expect(move).to.not.equal(undefined);
            const g2 = g.move(move!, { trusted: true });
            expectMovesMatchReference(g2);
        });
    });

    describe("moves() contracts", () => {
        it("opening stack length under 3 returns no moves", () => {
            const g = new StorisendeGame();
            expect(g.moves()).to.deep.equal([]);
        });

        it("post-opening includes pass", () => {
            const g = regressionFixtures.find(f => f.name === "post-opening-pass")!.build();
            expect(g.moves()).to.include("pass");
        });

        it("substack fixture includes colon notation", () => {
            const g = regressionFixtures.find(f => f.name === "substack")!.build();
            expect(g.moves().some(m => m.includes(":"))).to.be.true;
        });

        it("wall-climb fixture excludes landing on wall", () => {
            const g = buildWallClimbBlocked();
            const onWall = g.moves().filter(m => {
                if (m === "pass") {
                    return false;
                }
                const { to } = parseRegularMoveNotation(m, g);
                return g.board.getHexAtAlgebraic(to)?.tile === "wall";
            });
            expect(onWall).to.deep.equal([]);
        });

        it("wall-jump-blocked omits full move over foreign wall", () => {
            const { g, blockedMove } = buildWallJumpBlocked();
            expect(g.moves()).to.not.include(blockedMove);
            expect(movesReference(g)).to.not.include(blockedMove);
        });
    });

    describe("moves(player) override", () => {
        it("lists moves for the requested owner when currplayer differs", () => {
            const g = buildPlayerOverride();
            expect(g.currplayer).to.equal(1);
            const forTwo = g.moves(2).filter(m => m !== "pass");
            expect(forTwo.length).to.be.greaterThan(0);
            const forOne = g.moves(1).filter(m => m !== "pass");
            expect(forOne).to.deep.equal([]);
            for (const m of forTwo) {
                const { from, to, height } = parseRegularMoveNotation(m, g);
                expect(regularMoveLegal(g, 2, from, to, height), m).to.be.true;
            }
        });
    });

    describe("enumerateFromCell", () => {
        for (const { name, build } of regressionFixtures) {
            it(`agrees with full moves() for each source on ${name}`, () => {
                const g = build();
                const sources = new Set<string>();
                for (const m of g.moves()) {
                    if (m === "pass") {
                        continue;
                    }
                    const { from } = parseRegularMoveNotation(m, g);
                    sources.add(from);
                }
                for (const from of sources) {
                    expect(sortedMovesFromCell(g, g.currplayer, from)).to.deep.equal(
                        movesFromCellInFullList(g, from),
                        `from ${from}`,
                    );
                }
            });
        }
    });

    describe("partial dots", () => {
        it("match dotDestinationsFrom enumerateFromCell", () => {
            const g = buildFullStackSlide();
            const from = g.moves().find(m => m !== "pass")!.split("-")[0].split(":")[0];
            const partial = g.move(from, { partial: true, trusted: true });
            const expected = new Set(
                enumerateFromCell(partial, partial.currplayer, from).map(mv => mv.split("-")[1]!),
            );
            const dots = (partial as unknown as { dots: string[] }).dots;
            expect(new Set(dots)).to.deep.equal(expected);
        });
    });

    describe("virgin leave conversion", () => {
        it("matches legacy territory-component count on midgame cells", () => {
            const g = storisendeFromState(midgameHex6State as IStorisendeState);
            const cells = g.board.hexes.map(h => g.board.hex2algebraic(h));
            for (const cell of cells) {
                expect(modernVirginLeaveKind(g, cell)).to.equal(
                    legacyVirginLeaveKind(g, cell),
                    cell,
                );
            }
        });
    });

    describe("moves() performance (midgame hex6)", () => {
        it("matches reference and logs timings", function() {
            this.timeout(120_000);
            const g = storisendeFromState(midgameHex6State as IStorisendeState);
            g.moves();

            const t0 = performance.now();
            const expected = sortedMoves(movesReference(g));
            const oracleMs = performance.now() - t0;

            const t1 = performance.now();
            const actual = sortedMoves(g.moves());
            const fastMs = performance.now() - t1;

            expect(actual).to.deep.equal(expected);
            const ratio = oracleMs / Math.max(fastMs, 0.001);
            // eslint-disable-next-line no-console -- intentional bench output for local STORISENDE_BENCH runs
            console.info(
                `[storisende midgame] oracle=${oracleMs.toFixed(1)}ms fast=${fastMs.toFixed(1)}ms ratio=${ratio.toFixed(1)}x`,
            );

            if (process.env.STORISENDE_BENCH === "1") {
                expect(fastMs).to.be.lessThan(oracleMs * 0.25);
            }
        });

        it("logs enumerateFromCell vs full moves on a busy source", function() {
            this.timeout(120_000);
            const g = storisendeFromState(midgameHex6State as IStorisendeState);
            let bestFrom = "";
            let bestCount = 0;
            for (const hex of g.board.hexes) {
                if (hex.stack.length === 0) {
                    continue;
                }
                const from = g.board.hex2algebraic(hex);
                const n = enumerateFromCell(g, g.currplayer, from).length;
                if (n > bestCount) {
                    bestCount = n;
                    bestFrom = from;
                }
            }
            expect(bestFrom).to.not.equal("");

            g.moves();
            const t0 = performance.now();
            sortedMoves(g.moves());
            const fullMs = performance.now() - t0;

            const t1 = performance.now();
            sortedMoves(enumerateFromCell(g, g.currplayer, bestFrom));
            const fromMs = performance.now() - t1;

            const ratio = fullMs / Math.max(fromMs, 0.001);
            // eslint-disable-next-line no-console -- intentional bench output for local STORISENDE_BENCH runs
            console.info(
                `[storisende midgame] from=${bestFrom} full=${fullMs.toFixed(1)}ms fromOnly=${fromMs.toFixed(1)}ms ratio=${ratio.toFixed(1)}x`,
            );

            if (process.env.STORISENDE_BENCH === "1") {
                expect(fromMs).to.be.lessThan(fullMs);
            }
        });
    });

    describe("algebraic coordinates", () => {
        it("uses multi-letter row labels when height exceeds 26", () => {
            const graph = new StorisendeGraph(10, 30, Orientation.POINTY, 1);
            expect(graph.coords2algebraic(0, 26)).to.equal("aa1");
            expect(graph.algebraic2coords("aa1")).to.deep.equal([0, 26]);
            expect(graph.coords2algebraic(4, 29)).to.equal("ad5");
            expect(graph.algebraic2coords("ad5")).to.deep.equal([4, 29]);

            const hexes: StorisendeHex[] = [];
            for (let r = 0; r < 30; r++) {
                hexes.push(StorisendeHex.create({q: 0, r, tile: "virgin", stack: []}));
            }
            const board = StorisendeBoard.deserialize(hexes);
            const top = board.getHexAtAxial(0, 29)!;
            const label = board.hex2algebraic(top);
            expect(label).to.match(/^ad\d+$/);
            const roundTrip = board.getHexAtAlgebraic(label);
            expect(roundTrip?.q).to.equal(0);
            expect(roundTrip?.r).to.equal(29);
        });

        it("validates and plays regular moves between z and aa rows", () => {
            const hexes: StorisendeHex[] = [];
            for (let r = 0; r < 30; r++) {
                hexes.push(StorisendeHex.create({q: 0, r, tile: "virgin", stack: []}));
            }
            const board = StorisendeBoard.deserialize(hexes);
            const fromHex = board.getHexAtAxial(0, 25)!;
            const neighbour = hexNeighbours(fromHex)
                .map(({q, r}) => board.getHexAtAxial(q, r))
                .find(h => h !== undefined)!;
            const from = board.hex2algebraic(fromHex);
            const to = board.hex2algebraic(neighbour);
            expect(from.startsWith("z")).to.equal(true);
            expect(to.startsWith("aa")).to.equal(true);

            const wire = board.serialize().map(h => ({...h, stack: [...h.stack]}));
            const pieceOnFrom = wire.find(h => h.q === fromHex.q && h.r === fromHex.r)!;
            // Move distance must equal stack height; one piece → adjacent `aa` cell is legal.
            pieceOnFrom.stack = [1];
            const frame = {
                _version: "20250109",
                _results: [] as [],
                currplayer: 1 as playerid,
                board: wire,
            };
            const state: IStorisendeState = {
                game: "storisende",
                numplayers: 2,
                variants: [],
                gameover: false,
                winner: [],
                stack: [
                    {...frame, currplayer: 1},
                    {...frame, currplayer: 2, lastmove: "pass"},
                    {...frame, currplayer: 1, lastmove: "pass"},
                ],
            };
            const g = new StorisendeGame(state);
            const moveStr = `${from}-${to}`;
            expect(parseStorisendeRegularMove(moveStr).to).to.equal(to);
            expect(g.validateMove(moveStr).valid).to.equal(true);
            g.move(moveStr, {trusted: true});
            expect(g.board.getHexAtAlgebraic(from)?.stack.length ?? -1).to.equal(0);
            expect(g.board.getHexAtAlgebraic(to)?.stack.length ?? 0).to.equal(1);
        });
    });
});
