/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { FendoGame, IFendoState, IMoveState, playerid } from "../../src/games/fendo";

type BoardCell = [string, playerid];

function fendoFrom(opts: {
    board: BoardCell[];
    fences?: [string, string][];
    pieces?: [number, number];
    currplayer?: playerid;
    variants?: string[];
}): FendoGame {
    const board = new Map(opts.board);
    const state: IFendoState = {
        game: "fendo",
        numplayers: 2,
        variants: opts.variants ?? [],
        gameover: false,
        winner: [],
        stack: [{
            _version: FendoGame.gameinfo.version,
            _results: [],
            _timestamp: new Date(),
            currplayer: opts.currplayer ?? 1,
            board,
            pieces: opts.pieces ?? [6, 6],
            fences: opts.fences ?? [],
        } as IMoveState],
    };
    return new FendoGame(state);
}

type GenTargetsFn = (player: playerid, open: Set<string>) => Map<string, string[]>;

function genTargets(g: FendoGame, player: playerid, open: Set<string>): Map<string, string[]> {
    return (g as unknown as { genTargets: GenTargetsFn }).genTargets(player, open);
}

function naiveReachable(g: FendoGame, player: playerid, open: Set<string>): Map<string, Set<string>> {
    const mypieces = [...g.board.entries()]
        .filter(e => e[1] === player && open.has(e[0]))
        .map(e => e[0]);
    const empties = [...open].filter(cell => ! g.board.has(cell));
    const result = new Map<string, Set<string>>();
    for (const piece of mypieces) {
        const reachable = new Set<string>([piece]);
        for (const empty of empties) {
            if (g.naivePath(piece, empty) !== null) {
                reachable.add(empty);
            }
        }
        result.set(piece, reachable);
    }
    return result;
}

function fenceValidBrute(
    g: FendoGame,
    board: Map<string, playerid>,
    open: Set<string>,
    target: string,
    n: string,
): boolean {
    const clone = fendoFrom({
        board: [...board.entries()],
        fences: [...g.fences, [target, n]],
        pieces: [...g.pieces],
        currplayer: g.currplayer,
        variants: [...g.variants],
    });
    const areas = clone.getAreas();
    return areas.empty.length === 0 && areas.open.length <= 1;
}

function isFenceValid(
    g: FendoGame,
    board: Map<string, playerid>,
    open: Set<string>,
    target: string,
    n: string,
): boolean {
    return (g as unknown as {
        isFenceValidAfterMove(
            board: Map<string, playerid>,
            open: Set<string>,
            target: string,
            n: string,
        ): boolean;
    }).isFenceValidAfterMove(board, open, target, n);
}

/** Pre-refactor genTargets: O(pieces × empties) naivePath checks. */
function genTargetsBrute(g: FendoGame, player: playerid, open: Set<string>): Map<string, string[]> {
    const mypieces = [...g.board.entries()]
        .filter(e => e[1] === player && open.has(e[0]))
        .map(e => e[0]);
    const empties = [...open].filter(cell => ! g.board.has(cell));
    const validTargets = new Map<string, string[]>();
    for (const piece of mypieces) {
        const targets: string[] = [];
        for (const target of empties) {
            if (g.naivePath(piece, target) !== null) {
                targets.push(target);
            }
        }
        targets.push(piece);
        validTargets.set(piece, targets);
    }
    return validTargets;
}

/**
 * Pre-refactor moves(): naivePath target discovery plus clone/getAreas fence checks.
 * Used as the regression oracle for the optimized implementation.
 */
function movesReference(g: FendoGame, player?: playerid): string[] {
    if (g.gameover) {
        return [];
    }
    const mover = player ?? g.currplayer;
    const moves: string[] = [];
    const areas = g.getAreas();
    if (areas.open.length > 1) {
        throw new Error("There should never be more than one open area.");
    }
    const open = areas.open[0];
    if (open === undefined) {
        return ["pass"];
    }

    const validTargets = genTargetsBrute(g, mover, open);
    const uniqueTargets = new Set<string>();
    for (const targets of validTargets.values()) {
        for (const target of targets) {
            uniqueTargets.add(target);
        }
    }

    if (g.pieces[mover - 1] > 0) {
        for (const cell of uniqueTargets) {
            if (! g.board.has(cell)) {
                moves.push(cell);
            }
        }
    }

    for (const [from, targets] of validTargets.entries()) {
        for (const target of targets) {
            const boardAfterMove = new Map(g.board);
            if (from !== target) {
                boardAfterMove.delete(from);
                boardAfterMove.set(target, mover);
            }
            for (const n of g.graph.neighbours(target)) {
                if (g.fences.some(pair => pair.includes(target) && pair.includes(n))) {
                    continue;
                }
                if (fenceValidBrute(g, boardAfterMove, open, target, n)) {
                    const bearing = g.graph.bearing(target, n)!;
                    if (from !== target) {
                        moves.push(`${from}-${target}${bearing}`);
                    } else {
                        moves.push(`${from}${bearing}`);
                    }
                }
            }
        }
    }

    if (moves.length === 0) {
        moves.push("pass");
    }
    return moves;
}

function sortedMoves(moves: string[]): string[] {
    return [...moves].sort();
}

function expectMovesMatchReference(g: FendoGame, player?: playerid): void {
    const actual = sortedMoves(g.moves(player));
    const expected = sortedMoves(movesReference(g, player));
    expect(actual).to.deep.equal(expected);
}

function expectAllFencesMatchBrute(g: FendoGame): void {
    const open = g.getAreas().open[0];
    if (open === undefined) {
        return;
    }
    const board = new Map(g.board);
    for (const target of open) {
        for (const n of g.graph.neighbours(target)) {
            if (g.fences.some(pair => pair.includes(target) && pair.includes(n))) {
                continue;
            }
            expect(isFenceValid(g, board, open, target, n)).to.equal(
                fenceValidBrute(g, board, open, target, n),
                `fence ${target}-${n}`,
            );
        }
    }
}

type FixtureOpts = Parameters<typeof fendoFrom>[0];

const regressionFixtures: { name: string; opts: FixtureOpts; players?: playerid[] }[] = [
    {
        name: "7x7 opening",
        opts: { board: [["a4", 1], ["g4", 2]] },
        players: [1, 2],
    },
    {
        name: "7x7 L-shaped reachability",
        opts: {
            board: [["d4", 1], ["g4", 2]],
            fences: [["d4", "e4"], ["d4", "d3"]],
        },
        players: [1, 2],
    },
    {
        name: "7x7 corridor with four pieces",
        opts: {
            board: [["b4", 1], ["b6", 1], ["f4", 2], ["f6", 2]],
            fences: [
                ["c4", "c5"],
                ["c5", "c6"],
                ["c6", "d6"],
                ["d6", "e6"],
                ["e6", "e5"],
                ["e5", "e4"],
                ["e4", "f4"],
                ["d4", "d3"],
                ["d5", "d6"],
            ],
            pieces: [2, 2],
        },
        players: [1, 2],
    },
    {
        name: "7x7 empty pocket",
        opts: {
            board: [["a4", 1], ["g4", 2]],
            fences: [["g7", "f7"]],
            pieces: [3, 3],
        },
    },
    {
        name: "9x9 opening",
        opts: {
            board: [["a5", 1], ["i5", 2]],
            variants: ["size-9"],
        },
        players: [1, 2],
    },
    {
        name: "9x9 fenced midgame",
        opts: {
            board: [["a5", 1], ["i5", 2], ["e5", 1]],
            fences: [["e5", "f5"], ["e5", "e6"], ["d5", "e5"]],
            pieces: [4, 5],
            variants: ["size-9"],
        },
        players: [1, 2],
    },
    {
        name: "11x11 opening",
        opts: {
            board: [["a6", 1], ["k6", 2]],
            variants: ["size-11"],
        },
        players: [1, 2],
    },
    {
        name: "11x11 fenced midgame",
        opts: {
            board: [["a6", 1], ["k6", 2], ["f6", 1]],
            fences: [["f6", "g6"], ["f6", "f5"]],
            pieces: [4, 5],
            variants: ["size-11"],
        },
        players: [1, 2],
    },
    {
        name: "11x11 with pieces in hand exhausted",
        opts: {
            board: [["a6", 1], ["k6", 2], ["f4", 1], ["h8", 2]],
            fences: [["f4", "g4"], ["h8", "h7"]],
            pieces: [0, 0],
            variants: ["size-11"],
        },
        players: [1, 2],
    },
];

function majorityThreshold(g: FendoGame): number {
    return Math.floor((g.boardSize ** 2) / 2);
}

function triggerCheckEOG(g: FendoGame): void {
    (g as unknown as { checkEOG(): FendoGame }).checkEOG();
}

describe("Fendo", () => {
    describe("checkEOG", () => {
        it("does not end early while claimed space is below half the board", () => {
            const g = fendoFrom({
                board: [["c3", 1], ["a4", 2], ["g4", 2]],
                fences: [
                    ["c3", "c4"],
                    ["d3", "d4"],
                    ["e3", "e4"],
                    ["c3", "c2"],
                    ["d3", "d2"],
                    ["e3", "e2"],
                    ["c3", "b3"],
                    ["e3", "f3"],
                ],
                pieces: [0, 0],
            });
            expect(g.getPlayerScore(1)).to.equal(3);
            expect(g.getPlayerScore(1)).to.be.below(majorityThreshold(g));
            triggerCheckEOG(g);
            expect(g.gameover).to.be.false;
        });

        it("does not end early when claimed space equals the majority threshold", () => {
            const g = fendoFrom({ board: [["a4", 1], ["g4", 2]] });
            const threshold = majorityThreshold(g);
            g.getPlayerScore = (player: number) => player === 1 ? threshold : 0;
            triggerCheckEOG(g);
            expect(g.gameover).to.be.false;
        });

        it("ends when a player permanently claims more than half the board on 7x7", () => {
            const g = fendoFrom({ board: [["a4", 1], ["g4", 2]] });
            const threshold = majorityThreshold(g);
            expect(threshold).to.equal(24);
            g.getPlayerScore = (player: number) => player === 1 ? threshold + 1 : 0;
            triggerCheckEOG(g);
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([1]);
        });

        it("ends via majority claim on 11x11 using the squared threshold", () => {
            const g = fendoFrom({
                board: [["a6", 1], ["k6", 2]],
                variants: ["size-11"],
            });
            const threshold = majorityThreshold(g);
            expect(threshold).to.equal(60);
            g.getPlayerScore = (player: number) => player === 1 ? threshold + 1 : 0;
            triggerCheckEOG(g);
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([1]);
        });
    });

    describe("board size variants", () => {
        it("accepts the board-11 alias used by older saved states", () => {
            const state: IFendoState = {
                game: "fendo",
                numplayers: 2,
                variants: ["board-11"],
                gameover: false,
                winner: [],
                stack: [{
                    _version: FendoGame.gameinfo.version,
                    _results: [],
                    _timestamp: new Date(),
                    currplayer: 1,
                    board: new Map([["a6", 1], ["k6", 2], ["c8", 2]]),
                    pieces: [5, 6],
                    fences: [["c8", "b8"]],
                }],
            };
            const g = new FendoGame(state);
            expect(g.boardSize).to.equal(11);
            expect(g.variants).to.deep.equal(["size-11"]);
        });

        it("infers board size from coordinates when variants omit a size", () => {
            const g = fendoFrom({
                board: [["a11", 1], ["k11", 2]],
                variants: [],
            });
            expect(g.boardSize).to.equal(11);
        });
    });

    describe("genTargets reachability", () => {
        it("matches naivePath on the opening position (7x7)", () => {
            const g = fendoFrom({ board: [["a4", 1], ["g4", 2]] });
            const open = g.getAreas().open[0];
            const ray = genTargets(g, 1, open);
            const naive = naiveReachable(g, 1, open);
            for (const [piece, targets] of ray.entries()) {
                const expected = naive.get(piece)!;
                expect(new Set(targets)).to.deep.equal(expected);
            }
        });

        it("matches naivePath when only an L-shaped route exists", () => {
            const g = fendoFrom({
                board: [["d4", 1], ["g4", 2]],
                fences: [
                    ["d4", "e4"],
                    ["d4", "d3"],
                ],
            });
            const open = g.getAreas().open[0];
            const ray = genTargets(g, 1, open);
            const naive = naiveReachable(g, 1, open);
            for (const [piece, targets] of ray.entries()) {
                expect(new Set(targets)).to.deep.equal(naive.get(piece)!);
            }
            expect(g.naivePath("d4", "f5")).to.not.be.null;
            expect(g.naivePath("d4", "e3")).to.be.null;
        });

        it("matches naivePath on a fenced midgame 9x9 position", () => {
            const g = fendoFrom({
                board: [["a5", 1], ["i5", 2], ["e5", 1]],
                fences: [
                    ["e5", "f5"],
                    ["e5", "e6"],
                    ["d5", "e5"],
                ],
                variants: ["size-9"],
            });
            const open = g.getAreas().open[0];
            const ray = genTargets(g, 1, open);
            const naive = naiveReachable(g, 1, open);
            for (const [piece, targets] of ray.entries()) {
                expect(new Set(targets)).to.deep.equal(naive.get(piece)!);
            }
        });

        it("matches naivePath on a large open 11x11 position", () => {
            const g = fendoFrom({
                board: [["a6", 1], ["k6", 2], ["f4", 1]],
                variants: ["size-11"],
            });
            const open = g.getAreas().open[0];
            const ray = genTargets(g, 1, open);
            const naive = naiveReachable(g, 1, open);
            for (const [piece, targets] of ray.entries()) {
                expect(new Set(targets)).to.deep.equal(naive.get(piece)!);
            }
        });
    });

    describe("fence validation", () => {
        it("agrees with brute-force area checks on candidate fences", () => {
            const g = fendoFrom({
                board: [["d4", 1], ["f4", 2], ["e5", 1]],
                fences: [["d4", "d5"]],
            });
            const open = g.getAreas().open[0];
            const board = new Map(g.board);
            for (const target of open) {
                for (const n of g.graph.neighbours(target)) {
                    if (g.fences.some(pair => pair.includes(target) && pair.includes(n))) {
                        continue;
                    }
                    expect(isFenceValid(g, board, open, target, n)).to.equal(
                        fenceValidBrute(g, board, open, target, n),
                    );
                }
            }
        });

        it("rejects fences that isolate an empty region", () => {
            const g = fendoFrom({
                board: [["a4", 1], ["g4", 2]],
                fences: [["g7", "f7"]],
            });
            const open = g.getAreas().open[0];
            const board = new Map(g.board);
            expect(isFenceValid(g, board, open, "g6", "g7")).to.be.false;
            expect(fenceValidBrute(g, board, open, "g6", "g7")).to.be.false;
        });

        it("rejects fences that split the open area into two multi-piece regions", () => {
            const g = fendoFrom({
                board: [["b4", 1], ["b6", 1], ["f4", 2], ["f6", 2]],
                fences: [
                    ["c4", "c5"],
                    ["c5", "c6"],
                    ["c6", "d6"],
                    ["d6", "e6"],
                    ["e6", "e5"],
                    ["e5", "e4"],
                    ["e4", "f4"],
                    ["d4", "d3"],
                    ["d5", "d6"],
                ],
            });
            const open = g.getAreas().open[0];
            const board = new Map(g.board);
            expect(isFenceValid(g, board, open, "d6", "d7")).to.be.false;
            expect(fenceValidBrute(g, board, open, "d6", "d7")).to.be.false;
        });

        it("allows fences that leave a single open region", () => {
            const g = fendoFrom({
                board: [["b4", 1], ["b6", 1], ["f4", 2], ["f6", 2]],
                fences: [
                    ["c4", "c5"],
                    ["c5", "c6"],
                    ["c6", "d6"],
                    ["d6", "e6"],
                    ["e6", "e5"],
                    ["e5", "e4"],
                    ["e4", "f4"],
                    ["d4", "d3"],
                    ["d5", "d6"],
                ],
            });
            const open = g.getAreas().open[0];
            const board = new Map(g.board);
            expect(isFenceValid(g, board, open, "d4", "e4")).to.be.true;
            expect(fenceValidBrute(g, board, open, "d4", "e4")).to.be.true;
        });
    });

    describe("moves() regression", () => {
        for (const { name, opts, players } of regressionFixtures) {
            for (const player of players ?? [opts.currplayer ?? 1]) {
                it(`matches pre-refactor reference for ${name} (player ${player})`, () => {
                    const g = fendoFrom({ ...opts, currplayer: player });
                    expectMovesMatchReference(g, player);
                });
            }
        }

        it("every generated move passes validateMove on the 11x11 midgame fixture", () => {
            const g = fendoFrom({
                board: [["a6", 1], ["k6", 2], ["f6", 1]],
                fences: [["f6", "g6"], ["f6", "f5"]],
                pieces: [4, 5],
                variants: ["size-11"],
            });
            for (const move of g.moves()) {
                if (move === "pass") {
                    expect(g.validateMove(move).valid).to.be.true;
                } else {
                    expect(g.validateMove(move).valid, move).to.be.true;
                }
            }
        });
    });

    describe("fence validation regression", () => {
        for (const { name, opts } of regressionFixtures) {
            it(`agrees with brute-force area checks for ${name}`, () => {
                const g = fendoFrom(opts);
                expectAllFencesMatchBrute(g);
            });
        }

        it("agrees with brute-force checks after hypothetical moves", () => {
            const g = fendoFrom({
                board: [["d4", 1], ["f4", 2], ["e5", 1]],
                fences: [["d4", "d5"]],
            });
            const open = g.getAreas().open[0];
            const validTargets = genTargets(g, 1, open);
            for (const [from, targets] of validTargets.entries()) {
                for (const target of targets) {
                    const boardAfterMove = new Map(g.board);
                    if (from !== target) {
                        boardAfterMove.delete(from);
                        boardAfterMove.set(target, 1);
                    }
                    for (const n of g.graph.neighbours(target)) {
                        if (g.fences.some(pair => pair.includes(target) && pair.includes(n))) {
                            continue;
                        }
                        expect(
                            isFenceValid(g, boardAfterMove, open, target, n),
                            `after ${from}->${target}, fence ${target}-${n}`,
                        ).to.equal(fenceValidBrute(g, boardAfterMove, open, target, n));
                    }
                }
            }
        });
    });

    describe("moves()", () => {
        it("includes placement moves adjacent to friendly pieces on 7x7", () => {
            const g = fendoFrom({ board: [["a4", 1], ["g4", 2]] });
            const moves = g.moves();
            expect(moves).to.include("b4");
            expect(moves).to.include("a3");
            expect(moves).to.include("d4");
            expect(moves).to.not.include("g4");
        });

        it("includes move-and-fence combinations on 9x9", () => {
            const g = fendoFrom({
                board: [["a5", 1], ["i5", 2]],
                variants: ["size-9"],
            });
            const moves = g.moves();
            expect(moves.length).to.be.greaterThan(0);
            expect(moves.some(m => /[NESW]$/.test(m))).to.be.true;
        });

        it("accepts pass when it is a legal move", () => {
            const g = fendoFrom({ board: [["a4", 1], ["g4", 2]] });
            const moves = g.moves();
            if (moves.includes("pass")) {
                expect(g.validateMove("pass").valid).to.be.true;
            } else {
                expect(moves.length).to.be.greaterThan(0);
            }
        });

        it("produces a stable sorted move list on an 11x11 midgame fixture", () => {
            const g = fendoFrom({
                board: [["a6", 1], ["k6", 2], ["f6", 1]],
                fences: [
                    ["f6", "g6"],
                    ["f6", "f5"],
                ],
                pieces: [4, 5],
                variants: ["size-11"],
            });
            const moves = [...g.moves()].sort();
            expect(moves.length).to.be.greaterThan(0);
            expect(moves).to.include("e6");
            for (const move of moves) {
                if (move !== "pass") {
                    expect(g.validateMove(move).valid).to.be.true;
                }
            }
        });

        it("validates and applies double-digit stationary fences on 11x11", () => {
            const g = fendoFrom({
                board: [["e10", 1], ["k6", 2]],
                variants: ["size-11"],
            });
            const move = "e10N";
            expect(g.moves()).to.include(move);
            expect(g.validateMove(move).valid).to.be.true;
            g.move(move);
            expect(g.fences.some(pair => pair.includes("e10") && pair.includes("e11"))).to.be.true;
        });

        it("validates and applies double-digit move-and-fence notation on 11x11", () => {
            const g = fendoFrom({
                board: [["a11", 1], ["k6", 2]],
                variants: ["size-11"],
            });
            const move = "a11-a10E";
            expect(g.moves()).to.include(move);
            expect(g.validateMove(move).valid).to.be.true;
            g.move(move);
            expect(g.board.has("a10")).to.be.true;
            expect(g.board.has("a11")).to.be.false;
            expect(g.fences.some(pair => pair.includes("a10") && pair.includes("b10"))).to.be.true;
        });
    });
});
