/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { addResource } from "../../src";
import { GolombGame } from "../../src/games";
import type { Pentomino } from "../../src/games/golomb";
import { assertChatLogParity } from "../fixtures/chat/helpers";

// Squares are named by file letter and rank number, a1 bottom-left. A
// placement is written as space-separated squares; any set of squares that
// only one legal placement covers names that placement, and moves are stored
// with all five squares, sorted. In the Capture variant, `xa1` removes the
// mover's captured piece whose first square is a1.

const ALL: Pentomino[] = ["F", "I", "L", "N", "P", "T", "U", "V", "W", "X", "Y", "Z"];

interface IFixture {
    placed?: [Pentomino, string[], number][];
    blockers?: string[];
    pool?: Pentomino[];
    hands?: Pentomino[][];
    kitty?: Pentomino[];
    currplayer?: 1 | 2 | 3 | 4;
}

const setUp = (g: GolombGame, f: IFixture): GolombGame => {
    if (f.placed !== undefined) {
        g.placed = f.placed.map(([piece, cells, owner]) => ({ piece, cells: [...cells].sort(), owner }));
    }
    if (f.blockers !== undefined) {
        g.blockers = [...f.blockers];
    }
    if (f.pool !== undefined) {
        g.pool = [...f.pool];
    }
    if (f.hands !== undefined) {
        g.hands = f.hands.map(h => [...h]);
    }
    if (f.kitty !== undefined) {
        g.kitty = [...f.kitty];
    }
    if (f.currplayer !== undefined) {
        g.currplayer = f.currplayer;
    }
    // the fixture is also the saved position, so the game reloads exactly as set up
    const top = g.stack.length - 1;
    g.stack[top] = {
        ...g.stack[top],
        currplayer: g.currplayer,
        placed: g.placed.map(pc => ({ ...pc, cells: [...pc.cells] })),
        blockers: [...g.blockers],
        pool: [...g.pool],
        hands: g.hands.map(h => [...h]),
        kitty: [...g.kitty],
    };
    return g;
};

/** A copy of the game showing the move being entered. */
const preview = (g: GolombGame, m: string): GolombGame => {
    const copy = new GolombGame(g.serialize());
    copy.move(m, { partial: true });
    return copy;
};

// mulberry32: random blockers and deals shuffle with Math.random, which every test reseeds
const seeded = (seed: number) => (): number => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const squares = (width: number, height: number): string[] => {
    const out: string[] = [];
    for (let x = 0; x < width; x++) {
        for (let y = 1; y <= height; y++) {
            out.push(`${String.fromCharCode(97 + x)}${y}`);
        }
    }
    return out;
};

// Bounding boxes (width, height) of the 63 fixed pentominoes: I has 2
// orientations; L, N and Y have 8 each (2x4 or 4x2); P has 8 and U 4 (2x3 or
// 3x2); F, T, V, W, X and Z fill 3x3 boxes in 25 orientations between them.
const FIXED_BOXES: [number, number, number][] = [
    [1, 5, 1], [5, 1, 1],
    [2, 4, 12], [4, 2, 12],
    [2, 3, 6], [3, 2, 6],
    [3, 3, 25],
];
const placementCount = (width: number, height: number): number =>
    FIXED_BOXES.reduce((sum, [w, h, n]) => sum + n * Math.max(0, width - w + 1) * Math.max(0, height - h + 1), 0);

const movedCells = (m: string): string[] => m.split(" ").filter(t => !t.startsWith("x"));

// 8x8 board: rank 8 is display row 0
const rc = (cell: string, height = 8): [number, number] => [height - Number(cell.slice(1)), cell.charCodeAt(0) - 97];

describe("Golomb's Game", () => {
    const realRandom = Math.random;
    before(() => {
        addResource("en");
    });
    beforeEach(() => {
        Math.random = seeded(20261125);
    });
    afterEach(() => {
        Math.random = realRandom;
    });

    describe("setup", () => {
        it("starts with an empty 8x8 board, all 12 pentominoes in a shared pool, and player 1 to move", () => {
            const g = new GolombGame();
            expect(g.numplayers).to.equal(2);
            expect(g.currplayer).to.equal(1);
            expect(g.placed).to.be.empty;
            expect(g.blockers).to.be.empty;
            expect([...g.pool].sort()).to.deep.equal(ALL);
            const moves = g.moves();
            expect(moves).to.include("a1 a2 a3 a4 a5");
            expect(moves).to.include("h4 h5 h6 h7 h8");
            expect(moves.some(m => /\b(i\d|[a-h]9)\b/.test(m))).to.be.false;
        });

        it("offers every placement of every pentomino on each rectangular board", () => {
            expect(new GolombGame().moves()).to.have.length(placementCount(8, 8));
            expect(new GolombGame(2, ["size-7x7"]).moves()).to.have.length(placementCount(7, 7));
            expect(new GolombGame(2, ["size-8x7"]).moves()).to.have.length(placementCount(8, 7));
            expect(new GolombGame(2, ["size-10x6"]).moves()).to.have.length(placementCount(10, 6));
        });

        it("8x7 and 10x6 boards are wider than they are tall", () => {
            expect(new GolombGame(2, ["size-8x7"]).validateMove("h3 h7").complete).to.equal(0);
            expect(new GolombGame(2, ["size-8x7"]).validateMove("a8").valid).to.be.false;
            expect(new GolombGame(2, ["size-10x6"]).validateMove("f1 j1").complete).to.equal(0);
            expect(new GolombGame(2, ["size-10x6"]).validateMove("a7").valid).to.be.false;
        });

        it("the center-blocked board is missing its four center squares", () => {
            const g = new GolombGame(2, ["center-blocked"]);
            for (const cell of ["d4", "d5", "e4", "e5"]) {
                expect(g.validateMove(cell).valid).to.be.false;
                expect(g.moves().some(m => movedCells(m).includes(cell))).to.be.false;
            }
            expect(g.validateMove("d3").valid).to.be.true;
        });

        it("random blockers fill one square for each square beyond 60, and at least one", () => {
            const expected: [string[], number][] = [
                [[], 4],
                [["size-7x7"], 1],
                [["size-8x7"], 1],
                [["size-10x6"], 1],
                [["center-blocked"], 1],
            ];
            for (const [board, count] of expected) {
                const g = new GolombGame(2, [...board, "random-blockers"]);
                expect(g.blockers, board.join()).to.have.length(count);
                expect(new Set(g.blockers).size).to.equal(count);
                for (const b of g.blockers) {
                    expect(["d4", "d5", "e4", "e5"].includes(b) && board.includes("center-blocked")).to.be.false;
                    expect(g.validateMove(b).valid).to.be.false;
                    expect(g.moves().some(m => movedCells(m).includes(b))).to.be.false;
                }
            }
        });

        it("drops variant combinations the rules don't allow", () => {
            // requested variants, and variants that must not all survive together
            const cases: [string[], string[]][] = [
                [["concealed"], ["concealed"]],
                [["choose-up", "concealed"], ["concealed"]],
                [["random-hands", "capture"], ["capture"]],
                [["choose-up", "capture"], ["capture"]],
                [["capture", "misere"], ["capture", "misere"]],
                [["simple-pie"], ["simple-pie"]],
                [["random-hands", "concealed", "simple-pie"], ["concealed", "simple-pie"]],
            ];
            for (const [requested, forbidden] of cases) {
                const kept = new GolombGame(2, requested).variants;
                expect(forbidden.every(v => kept.includes(v)), requested.join("+")).to.be.false;
            }
        });

    });

    describe("placing pentominoes", () => {
        it("any squares that identify one placement name it, and the move is stored with all five squares sorted", () => {
            const g = new GolombGame();
            g.move("a5 a1");
            expect(g.lastmove).to.equal("a1 a2 a3 a4 a5");
            expect(g.placed).to.deep.equal([{ piece: "I", cells: ["a1", "a2", "a3", "a4", "a5"], owner: 0 }]);
            expect(g.pool).to.not.include("I");
            expect(g.currplayer).to.equal(2);
        });

        it("squares that several placements cover are not yet a move", () => {
            const g = new GolombGame();
            const result = g.validateMove("a1 a2");
            expect(result.valid).to.be.true;
            expect(result.complete).to.equal(-1);
            expect(() => g.move("a1 a2")).to.throw();
        });

        it("rejects squares that no single pentomino can cover", () => {
            const g = new GolombGame();
            expect(g.validateMove("a1 e5").valid).to.be.false;
            expect(g.validateMove("a1 a2 a3 a4 a5 a6").valid).to.be.false;
            expect(g.validateMove("a1 a2 b4 c4 d4").valid).to.be.false;
        });

        it("pentominoes may not overlap", () => {
            const g = new GolombGame();
            g.move("a1 a5");
            expect(g.validateMove("a5 b5 c5 d5 e5").valid).to.be.false;
            expect(g.moves().some(m => movedCells(m).includes("a3"))).to.be.false;
        });

        it("each pentomino can only be placed once", () => {
            const g = new GolombGame();
            g.move("a1 a5");
            expect(g.validateMove("c1 c5").valid).to.be.false;
            expect(g.moves()).to.not.include("c1 c2 c3 c4 c5");
            expect(g.moves()).to.not.include("b8 c8 d8 e8 f8");
        });

        it("removing pieces is only possible in the Capture variant", () => {
            const g = setUp(new GolombGame(), { placed: [["I", ["a1", "a2", "a3", "a4", "a5"], 1]] });
            expect(g.validateMove("xa1 a1 a2 a3 b1 c1").valid).to.be.false;
        });
    });

    describe("end of game", () => {
        // a 7x7 board blocked everywhere except two 1x5 strips: a1-a5 and g1-g5
        const strips = (): string[] => squares(7, 7).filter(c => !/^[ag][1-5]$/.test(c));

        it("the last player able to move wins", () => {
            const g = setUp(new GolombGame(2, ["size-7x7"]), { blockers: strips(), pool: ["I", "L"] });
            g.move("a1 a5");
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([1]);
            expect(g.moves()).to.be.empty;
        });

        it("in Misère, the first player with no legal move wins", () => {
            const g = setUp(new GolombGame(2, ["size-7x7", "misere"]), { blockers: strips(), pool: ["I", "L"] });
            g.move("a1 a5");
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([2]);
        });

        it("with three players, the game ends when the player to move cannot place, and the last mover wins", () => {
            const g = setUp(new GolombGame(3, ["size-7x7"]), { blockers: strips(), pool: ["I", "L"] });
            g.move("a1 a5");
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([1]);
        });
    });

    describe("piece distribution", () => {
        it("random distribution deals the 12 pentominoes evenly", () => {
            for (const n of [2, 3, 4]) {
                const g = new GolombGame(n, ["random-hands"]);
                expect(g.pool).to.be.empty;
                expect(g.kitty).to.be.empty;
                expect(g.hands).to.have.length(n);
                for (const h of g.hands) {
                    expect(h).to.have.length(12 / n);
                }
                expect(g.hands.flat().sort()).to.deep.equal(ALL);
            }
        });

        it("players may only place pentominoes from their own hand", () => {
            const g = setUp(new GolombGame(2, ["random-hands"]), {
                hands: [["F", "I", "L", "N", "P", "T"], ["U", "V", "W", "X", "Y", "Z"]],
            });
            // a1-a5 can only be the I
            expect(g.validateMove("a1 a5").complete).to.equal(0);
            // the V is in player 2's hand
            expect(g.validateMove("a1 a3 c1").valid).to.be.false;
            g.move("a1 a5");
            expect(g.hands[0]).to.deep.equal(["F", "L", "N", "P", "T"]);
            expect(g.validateMove("c1 c3 e1").complete).to.equal(0);
            expect(g.validateMove("c1 c2 c3 c4 d4").valid).to.be.false;
        });

        it("concealed hands set two pentominoes aside in 2-player games only", () => {
            const two = new GolombGame(2, ["random-hands", "concealed"]);
            expect(two.hands.map(h => h.length)).to.deep.equal([5, 5]);
            expect(two.kitty).to.have.length(2);
            expect([...two.hands.flat(), ...two.kitty].sort()).to.deep.equal(ALL);
            const three = new GolombGame(3, ["random-hands", "concealed"]);
            expect(three.hands.map(h => h.length)).to.deep.equal([4, 4, 4]);
            expect(three.kitty).to.be.empty;
        });

        it("choose up: players take turns choosing pentominoes, then player 1 places first", () => {
            const g = new GolombGame(2, ["choose-up"]);
            expect(g.moves()).to.deep.equal(ALL);
            expect(g.validateMove("a1 a5").valid).to.be.false;
            g.move("f");
            expect(g.hands[0]).to.deep.equal(["F"]);
            expect(g.validateMove("F").valid).to.be.false;
            for (const pc of ALL.slice(1)) {
                expect(g.moves()).to.not.include("pass");
                g.move(pc);
            }
            expect(g.pool).to.be.empty;
            expect(g.hands).to.deep.equal([["F", "L", "P", "U", "W", "Y"], ["I", "N", "T", "V", "X", "Z"]]);
            expect(g.currplayer).to.equal(1);
            expect(g.validateMove("X").valid).to.be.false;
            expect(g.moves()).to.not.include("a1 a2 a3 a4 a5");
            expect(g.moves()).to.include("a1 a2 a3 a4 b1");
        });
    });

    describe("concealed hands", () => {
        const dealt = (): GolombGame => setUp(new GolombGame(2, ["random-hands", "concealed"]), {
            hands: [["F", "I", "L", "N", "P"], ["T", "U", "V", "W", "X"]],
            kitty: ["Y", "Z"],
        });

        it("a stripped state only contains the viewing player's hand", () => {
            const g = dealt();
            g.move("a1 a5");
            const full = g.state();
            const mine = g.state({ strip: true, player: 1 });
            for (const entry of mine.stack) {
                expect(entry.hands[1]).to.be.empty;
                expect(entry.kitty).to.be.empty;
            }
            expect(mine.stack[mine.stack.length - 1].hands[0]).to.deep.equal(["F", "L", "N", "P"]);
            expect(full.stack[full.stack.length - 1].hands[1]).to.deep.equal(["T", "U", "V", "W", "X"]);
            expect(full.stack[full.stack.length - 1].kitty).to.deep.equal(["Y", "Z"]);
            // hands that are not concealed are never stripped
            const open = setUp(new GolombGame(2, ["random-hands"]), { hands: [["F"], ["I"]] });
            expect(open.state({ strip: true, player: 1 }).stack[0].hands[1]).to.deep.equal(["I"]);
        });

        it("the display lists the unseen pentominoes without saying where they are", () => {
            const g = dealt();
            g.move("a1 a5");
            const shown = (rep: ReturnType<GolombGame["render"]>) =>
                (rep.areas ?? []).map(a => ("pieces" in a ? (a.pieces as string[]) : []));
            for (const viewer of [g, new GolombGame(g.serialize({ strip: true, player: 1 }))]) {
                const areas = shown(viewer.render({ perspective: 1 }));
                expect(areas).to.deep.include(["F", "L", "N", "P"]);
                expect(areas).to.deep.include(["T", "U", "V", "W", "X", "Y", "Z"]);
                expect(areas).to.not.deep.include(["T", "U", "V", "W", "X"]);
                expect(areas.flat()).to.not.include("I");
            }
        });

        it("exploration is disabled only when hands are concealed", () => {
            expect(new GolombGame(2, ["random-hands", "concealed"]).getFlags()).to.include("no-explore");
            expect(new GolombGame(2, ["random-hands"]).getFlags()).to.not.include("no-explore");
            expect(new GolombGame().getFlags()).to.not.include("no-explore");
        });

    });

    describe("capture", () => {
        const I_A = ["a1", "a2", "a3", "a4", "a5"];

        it("a placement sharing 3 or more edges with a piece captures it", () => {
            const g = setUp(new GolombGame(2, ["capture"]), { placed: [["I", I_A, 0]], pool: ALL.filter(p => p !== "I") });
            g.move("b1 b2 b3 b4 c1");
            expect(g.placed.find(p => p.piece === "I")!.owner).to.equal(1);
            // the new piece itself is not owned
            expect(g.placed.find(p => p.piece === "L")!.owner).to.equal(0);
        });

        it("two shared edges do not capture", () => {
            const g = setUp(new GolombGame(2, ["capture"]), { placed: [["I", I_A, 0]], pool: ALL.filter(p => p !== "I") });
            g.move("b1 b2 c1 d1 e1");
            expect(g.placed.find(p => p.piece === "I")!.owner).to.equal(0);
        });

        it("captured pieces can be recaptured", () => {
            const g = setUp(new GolombGame(2, ["capture"]), { placed: [["I", I_A, 1]], pool: ALL.filter(p => p !== "I") });
            g.move("g1 h1 h2 h3 h4");
            g.move("b1 b2 b3 c1 c2");
            expect(g.placed.find(p => p.piece === "I")!.owner).to.equal(2);
        });

        it("a player may first remove pieces they captured; those return to the pool after the move", () => {
            const g = setUp(new GolombGame(2, ["capture"]), { placed: [["I", I_A, 1]], pool: ALL.filter(p => p !== "I") });
            g.move("a1 a2 a3 b1 c1 xa3");
            expect(g.lastmove).to.equal("xa1 a1 a2 a3 b1 c1");
            expect(g.placed.map(p => p.piece)).to.deep.equal(["V"]);
            expect(g.pool).to.include("I");
            expect(g.pool).to.not.include("V");
        });

        it("a removed piece cannot be placed again in the same turn", () => {
            const g = setUp(new GolombGame(2, ["capture"]), { placed: [["I", I_A, 1]], pool: ALL.filter(p => p !== "I") });
            expect(g.validateMove("xa1 a1 a2 a3 a4 a5").valid).to.be.false;
            expect(g.validateMove("xa1 c1 c5").valid).to.be.false;
        });

        it("only your own captured pieces can be removed", () => {
            const theirs = setUp(new GolombGame(2, ["capture"]), { placed: [["I", I_A, 2]], pool: ALL.filter(p => p !== "I") });
            expect(theirs.validateMove("xa1 a1 a2 a3 b1 c1").valid).to.be.false;
            const neutral = setUp(new GolombGame(2, ["capture"]), { placed: [["I", I_A, 0]], pool: ALL.filter(p => p !== "I") });
            expect(neutral.validateMove("xa1").valid).to.be.false;
        });

        it("the move list includes placements with and without optional removals", () => {
            const g = setUp(new GolombGame(2, ["capture"]), { placed: [["I", I_A, 1]], pool: ALL.filter(p => p !== "I") });
            const moves = g.moves();
            expect(moves).to.include("c1 c2 c3 c4 d1");
            expect(moves).to.include("xa1 c1 c2 c3 c4 d1");
            expect(moves).to.include("xa1 a1 a2 a3 b1 c1");
            expect(moves).to.not.include("a1 a2 a3 b1 c1");
            for (const m of moves.filter((_, i) => i % 50 === 0)) {
                expect(g.validateMove(m).complete, m).to.equal(0);
                expect(g.normaliseMove(m)).to.equal(m);
            }
        });

        it("a player whose only room is under their own captured piece can still move", () => {
            // free squares: the a1-c3 block (filled by player 1's captured X but
            // for its corners) and the g1-g5 strip
            const g = setUp(new GolombGame(2, ["capture", "size-7x7"]), {
                placed: [["X", ["a2", "b1", "b2", "b3", "c2"], 1]],
                blockers: squares(7, 7).filter(c => !/^([a-c][1-3]|g[1-5])$/.test(c)),
                pool: ["I", "T", "V"],
                currplayer: 2,
            });
            g.move("g1 g5");
            expect(g.gameover).to.be.false;
            const moves = g.moves();
            expect(moves).to.include("xa2 a1 a2 a3 b1 c1");
            expect(moves.every(m => m.startsWith("xa2 "))).to.be.true;
        });

        it("a position occurring for the fifth time with the same player to move is a draw", () => {
            // Each player runs a "pump" of two adjacent holes: they remove the piece they
            // captured in one hole and place a piece there that captures the piece next door.
            // Player 1 cycles T, U and V through a1-c3 and d1-f3; player 2 cycles L, N and Y
            // through a5-b8 and c5-d8. After these 12 plies the board is back where it began.
            const open = /^([a-f][1-3]|[a-d][5-8])$/;
            const g = setUp(new GolombGame(2, ["capture"]), {
                blockers: squares(8, 8).filter(c => !open.test(c)),
                placed: [
                    ["T", ["a2", "b2", "c1", "c2", "c3"], 1],
                    ["V", ["d1", "d2", "d3", "e1", "f1"], 0],
                    ["L", ["a8", "b5", "b6", "b7", "b8"], 2],
                    ["Y", ["c5", "c6", "c7", "c8", "d6"], 0],
                ],
                pool: ["F", "I", "N", "P", "U", "W", "X", "Z"],
            });
            const cycle = [
                "xa2 b1 b3 c1 c2 c3", "xa8 a7 a8 b5 b6 b7",
                "xd1 d1 d2 d3 e2 f2", "xc5 c5 c6 c7 c8 d5",
                "xb1 a1 b1 c1 c2 c3", "xa7 a6 b5 b6 b7 b8",
                "xd1 d1 d2 d3 e1 e3", "xc5 c5 c6 c7 d7 d8",
                "xa1 a2 b2 c1 c2 c3", "xa6 a8 b5 b6 b7 b8",
                "xd1 d1 d2 d3 e1 f1", "xc5 c5 c6 c7 c8 d6",
            ];
            const start = JSON.stringify(g.placed.map(p => [p.piece, p.owner]).sort());
            // the starting position recurs every 12 plies, so it occurs for the fifth time after 48
            let plies = 0;
            while (!g.gameover && plies < 100) {
                g.move(cycle[plies % cycle.length]);
                plies++;
            }
            expect(plies).to.equal(48);
            expect(JSON.stringify(g.placed.map(p => [p.piece, p.owner]).sort())).to.equal(start);
            expect(g.winner).to.deep.equal([1, 2]);
            expect(g.results.some(r => r.type === "eog" && r.reason === "repetition")).to.be.true;
            assertChatLogParity(g, ["Alice", "Bob"]);
        });

    });

    describe("simple pie", () => {
        const hands = (): Pentomino[][] => [["F", "I", "L", "N", "P", "T"], ["U", "V", "W", "X", "Y", "Z"]];

        it("after the first placement, the second player may pass to swap hands", () => {
            const g = setUp(new GolombGame(2, ["random-hands", "simple-pie"]), { hands: hands() });
            expect(g.moves()).to.not.include("pass");
            expect(g.getButtons()).to.be.empty;
            g.move("a1 a5");
            expect(g.moves()).to.include("pass");
            expect(g.getButtons().map(b => b.move)).to.deep.equal(["pass"]);
            g.move("pass");
            expect(g.hands).to.deep.equal([["U", "V", "W", "X", "Y", "Z"], ["F", "L", "N", "P", "T"]]);
            expect(g.currplayer).to.equal(1);
            expect(g.validateMove("pass").valid).to.be.false;
            expect(g.getButtons()).to.be.empty;
        });

        it("the swap button passes", () => {
            const g = setUp(new GolombGame(2, ["random-hands", "simple-pie"]), { hands: hands() });
            g.move("a1 a5");
            // the client sends a custom "pass" button as a click on "_btn_pass"
            const r = g.handleClick("", -1, -1, "_btn_pass");
            expect(r.move).to.equal("pass");
            expect(r.complete).to.equal(1);
            const later = setUp(new GolombGame(2, ["random-hands", "simple-pie"]), { hands: hands() });
            expect(later.handleClick("", -1, -1, "_btn_pass").move).to.equal("");
        });

        it("placing a piece instead keeps the hands", () => {
            const g = setUp(new GolombGame(2, ["random-hands", "simple-pie"]), { hands: hands() });
            g.move("a1 a5");
            g.move("c1 c3 e1");
            expect(g.hands).to.deep.equal([["F", "L", "N", "P", "T"], ["U", "W", "X", "Y", "Z"]]);
            expect(g.moves()).to.not.include("pass");
        });

        it("with choose up, passing after the first choice swaps the hands", () => {
            const g = new GolombGame(2, ["choose-up", "simple-pie"]);
            g.move("F");
            expect(g.moves()).to.include("pass");
            g.move("pass");
            expect(g.hands).to.deep.equal([[], ["F"]]);
            expect(g.currplayer).to.equal(1);
            expect(g.moves()).to.not.include("pass");
        });

        it("is silently dropped from games with more than two players", () => {
            const g = new GolombGame(3, ["random-hands", "simple-pie"]);
            expect(g.variants).to.deep.equal(["random-hands"]);
            g.move(g.moves()[0]);
            expect(g.moves()).to.not.include("pass");
            expect(g.validateMove("pass").valid).to.be.false;
        });

    });

    describe("clicking", () => {
        it("clicking squares builds a placement, which another empty square confirms", () => {
            const g = new GolombGame();
            let r = g.handleClick("", ...rc("a1"));
            expect(r.move).to.equal("a1");
            expect(r.complete).to.equal(-1);
            r = g.handleClick(r.move, ...rc("a5"));
            expect(r.move).to.equal("a1 a5");
            expect(r.complete).to.equal(0);
            r = g.handleClick(r.move, ...rc("h8"));
            expect(r.move).to.equal("a1 a2 a3 a4 a5");
            expect(r.complete).to.equal(1);
        });

        it("clicking the previewed piece changes nothing, while clicking a placed piece cancels the move", () => {
            const g = new GolombGame();
            const same = g.handleClick("a1 a5", ...rc("a3"));
            expect(same.move).to.equal("a1 a5");
            expect(same.complete).to.equal(0);
            g.move("c1 c5");
            expect(g.handleClick("a1 a5", ...rc("c2")).move).to.equal("");
            expect(g.handleClick("a1", ...rc("c2")).move).to.equal("");
        });

        it("clicking an already selected square changes nothing", () => {
            const g = new GolombGame();
            const r = g.handleClick("a1 a2", ...rc("a2"));
            expect(r.valid).to.be.true;
            expect(r.move).to.equal("a1 a2");
            expect(r.complete).to.equal(-1);
        });

        it("a square no placement can add cancels the partial placement", () => {
            const g = new GolombGame();
            const r = g.handleClick("a1", ...rc("h8"));
            expect(r.valid).to.be.true;
            expect(r.move).to.equal("");
        });

        it("in Capture, clicking your captured piece removes it and drops any partial placement", () => {
            const g = setUp(new GolombGame(2, ["capture"]), {
                placed: [["I", ["a1", "a2", "a3", "a4", "a5"], 1], ["L", ["c1", "c2", "c3", "c4", "d1"], 2]],
                pool: ALL.filter(p => p !== "I" && p !== "L"),
            });
            let r = g.handleClick("f1 f2", ...rc("a3"));
            expect(r.move).to.equal("xa1");
            expect(r.valid).to.be.true;
            r = g.handleClick(r.move, ...rc("a1"));
            expect(r.move).to.equal("xa1 a1");
            // the opponent's captured piece cancels instead
            expect(g.handleClick("xa1 a1", ...rc("c2")).move).to.equal("");
        });

        it("pieces removed by the move being entered are crossed out in the pool, in the remover's colour", () => {
            type Layer = { name?: string; paint?: { fill?: unknown } };
            // the colour of each crossed-out piece shown in an area
            const crosses = (game: GolombGame) => {
                const rep = game.render();
                const pieces = (rep.areas ?? []).flatMap(a => "pieces" in a ? (a.pieces as string[]) : []);
                return pieces.flatMap(key => {
                    const entry = rep.legend![key];
                    const cross = (Array.isArray(entry) ? entry as Layer[] : []).find(l => l.name === "cross-diag");
                    return cross === undefined ? [] : [cross.paint?.fill];
                });
            };
            for (const player of [1, 2] as const) {
                const g = setUp(new GolombGame(2, ["capture"]), {
                    placed: [["I", ["a1", "a2", "a3", "a4", "a5"], player]],
                    pool: ALL.filter(p => p !== "I"),
                    currplayer: player,
                });
                const shown = preview(g, "xa1 c1");
                expect(crosses(shown)).to.deep.equal([player]);
                expect(shown.pool).to.include("I");
                // once the move is made, the piece is back in the pool and placeable
                g.move("xa1 a1 a2 a3 b1 c1");
                expect(crosses(g)).to.be.empty;
            }
        });

        it("during choose up, clicking a pentomino in the pool chooses it", () => {
            const g = new GolombGame(2, ["choose-up"]);
            const r = g.handleClick("", -1, -1, "X");
            expect(r.move).to.equal("X");
            expect(r.complete).to.equal(1);
            expect(g.handleClick("", ...rc("a1")).move).to.equal("");
        });

        it("once only one placement fits, the piece is shown placed, with its captures", () => {
            const g = setUp(new GolombGame(2, ["capture"]), {
                placed: [["I", ["a1", "a2", "a3", "a4", "a5"], 0]],
                pool: ALL.filter(p => p !== "I"),
            });
            const shown = preview(g, "b1 b2 b3 b4 c1");
            expect(shown.placed.find(p => p.piece === "I")!.owner).to.equal(1);
            expect(shown.pool).to.not.include("L");
            const rep = shown.render();
            // no preview squares: the piece is drawn like any placed piece
            expect(rep.pieces).to.be.null;
            const floods = (rep.board as { markers: { type: string; colour: unknown; points: { row: number; col: number }[] }[] }).markers
                .filter(m => m.type === "flood");
            const colourAt = (cell: string) => {
                const [row, col] = rc(cell);
                return floods.find(f => f.points.some(p => p.row === row && p.col === col))?.colour;
            };
            expect(colourAt("a3")).to.equal(1);
            expect(colourAt("b2")).to.not.be.undefined;
            expect(colourAt("b2")).to.not.equal(1);
            // the real game is untouched until the move is submitted
            expect(g.placed.find(p => p.piece === "I")!.owner).to.equal(0);
        });

        // squares marked with dots, and squares marked as clicked, in a render
        const marks = (rep: ReturnType<GolombGame["render"]>) => {
            const dots = new Set<string>();
            for (const a of (rep.annotations ?? []) as { type: string; targets: { row: number; col: number }[] }[]) {
                if (a.type === "dots") {
                    a.targets.forEach(t => dots.add(`${t.row},${t.col}`));
                }
            }
            const clicked = new Set<string>();
            if (typeof rep.pieces === "string") {
                rep.pieces.split("\n").forEach((row, y) => row.split(",").forEach((v, x) => { if (v !== "-") { clicked.add(`${y},${x}`); } }));
            }
            return { dots, clicked };
        };
        const key = (cell: string) => rc(cell).join(",");

        it("before any input, every empty square some placement could cover has a dot", () => {
            const fresh = marks(new GolombGame().render());
            expect(fresh.dots.size).to.equal(64);
            expect(fresh.clicked.size).to.equal(0);
            // with the I placed along a1-a5, only the X left, a corner square nothing can reach loses its dot
            const g = setUp(new GolombGame(), { placed: [["I", ["a1", "a2", "a3", "a4", "a5"], 0]], pool: ["X"] });
            const { dots } = marks(g.render());
            expect(dots.has(key("a3"))).to.be.false;
            expect(dots.has(key("h8"))).to.be.false;
            expect(dots.has(key("g7"))).to.be.true;
            expect(dots.has(key("b1"))).to.be.false;
            expect(dots.has(key("c1"))).to.be.true;
        });

        it("while a placement is partly entered, clicked squares are marked and other coverable squares have dots", () => {
            const g = new GolombGame();
            const covering = g.moves().filter(m => m.split(" ").includes("a1") && m.split(" ").includes("a2")).flatMap(m => m.split(" "));
            const { dots, clicked } = marks(preview(g, "a1 a2").render());
            expect(clicked).to.deep.equal(new Set([key("a1"), key("a2")]));
            expect(dots).to.deep.equal(new Set(covering.filter(c => c !== "a1" && c !== "a2").map(key)));
        });

        it("removing a captured piece frees its squares for the dots", () => {
            const g = setUp(new GolombGame(2, ["capture"]), {
                placed: [["I", ["a1", "a2", "a3", "a4", "a5"], 1]],
                pool: ALL.filter(p => p !== "I"),
            });
            expect(marks(g.render()).dots.has(key("a3"))).to.be.false;
            expect(marks(preview(g, "xa1").render()).dots.has(key("a3"))).to.be.true;
        });
    });

    describe("records", () => {
        it("serializes and restores mid-game", () => {
            const g = new GolombGame(2, ["capture"]);
            for (const m of ["a1 a5", "b1 b2 b3 b4 c1", "g1 g2 h1 h2 h3"]) {
                g.move(m);
            }
            const restored = new GolombGame(g.serialize());
            expect(restored.currplayer).to.equal(g.currplayer);
            expect(restored.placed).to.deep.equal(g.placed);
            expect(restored.pool).to.deep.equal(g.pool);
            expect(restored.moves()).to.deep.equal(g.moves());
        });

        it("move log matches the structured chat log", () => {
            const pie = new GolombGame(2, ["choose-up", "simple-pie"]);
            pie.move("F");
            pie.move("pass");
            for (const pc of ALL.slice(1)) {
                pie.move(pc);
            }
            pie.move(pie.moves()[0]);
            assertChatLogParity(pie, ["Alice", "Bob"]);

            const cap = setUp(new GolombGame(2, ["capture", "size-7x7"]), {
                placed: [["I", ["a1", "a2", "a3", "a4", "a5"], 1]],
                pool: ALL.filter(p => p !== "I"),
            });
            cap.move("xa1 a1 a2 a3 b1 c1");
            cap.move("b2 b3 b4 b5 c2");
            while (!cap.gameover) {
                cap.move(cap.moves()[0]);
            }
            assertChatLogParity(cap, ["Alice", "Bob"]);
        });
    });
});
