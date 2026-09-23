/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { addResource } from "../../src";
import i18next from "i18next";
import { applyPlacement, BLUE, KillAllGoGame, makeGeometry, passAliveStrings, RED, roomForTwoEyes, signature, stringAt, type Board } from "../../src/games/killallgo";

const play = (g: KillAllGoGame, moves: string[]): KillAllGoGame => {
    for (const m of moves) {
        g.move(m);
    }
    return g;
};

/** Player 1 takes the Attacker stones at once: Player 2 is the Defender and moves first on an empty board. */
const attackerIsPlayerOne = (variants: string[] = ["size-9"]): KillAllGoGame => {
    const g = new KillAllGoGame(undefined, variants);
    g.move("attacker");
    return g;
};

// `X` = Blue (the colour under test), `O` = Red, `.` = empty; the first row is the top of the board.
const boardFrom = (rows: string[]): Board => {
    const size = rows.length;
    const geo = makeGeometry(size);
    const board: Board = new Map();
    rows.forEach((row, y) => {
        if (row.length !== size) {
            throw new Error("Fixtures must be square.");
        }
        row.split("").forEach((ch, x) => {
            if (ch === "X") {
                board.set(geo.coords2algebraic(x, y), BLUE);
            } else if (ch === "O") {
                board.set(geo.coords2algebraic(x, y), RED);
            }
        });
    });
    return board;
};

interface Fixture {
    name: string;
    rows: string[];
    classic: boolean;
    strict: boolean;
}

const fixtures: Fixture[] = [
    {
        name: "two one-point eyes on the edge",
        rows: [
            "X.X.X..",
            "XXXXX..",
            ".......",
            ".......",
            ".......",
            ".......",
            ".......",
        ],
        classic: true, strict: true,
    },
    {
        name: "a single eye",
        rows: [
            "X.XX...",
            "XXXX...",
            ".......",
            ".......",
            ".......",
            ".......",
            ".......",
        ],
        classic: false, strict: false,
    },
    {
        name: "a two-point eye plus a one-point eye",
        rows: [
            "X..XX.X",
            "XXXXXXX",
            ".......",
            ".......",
            ".......",
            ".......",
            ".......",
        ],
        classic: true, strict: true,
    },
    {
        name: "two groups with one eye each",
        rows: [
            "X.X.O.O",
            "XXXXOOO",
            ".......",
            ".......",
            ".......",
            ".......",
            ".......",
        ],
        classic: false, strict: false,
    },
    {
        name: "a 3x3 empty eye plus a one-point eye",
        rows: [
            "XXXXXXX",
            "X...X.X",
            "X...XXX",
            "X...X..",
            "XXXXX..",
            ".......",
            ".......",
        ],
        classic: false, strict: false,
    },
    {
        name: "a 3x3 eye with an opponent stone in the centre plus a one-point eye",
        rows: [
            "XXXXXXX",
            "X...X.X",
            "X.O.XXX",
            "X...X..",
            "XXXXX..",
            ".......",
            ".......",
        ],
        classic: true, strict: false,
    },
    {
        name: "two shared liberties and no eyes",
        rows: [
            "XX.O...",
            "XXXO...",
            "OOOO...",
            ".......",
            ".......",
            ".......",
            ".......",
        ],
        classic: false, strict: false,
    },
    {
        name: "two chains sharing two eyes",
        rows: [
            "XX.XX..",
            "X.X.X..",
            "XX.XX..",
            ".......",
            ".......",
            ".......",
            ".......",
        ],
        classic: true, strict: true,
    },
    {
        name: "a false eye at a cutting point",
        rows: [
            "X.XO...",
            "XX.O...",
            "OOOO...",
            ".......",
            ".......",
            ".......",
            ".......",
        ],
        classic: false, strict: false,
    },
    {
        name: "an eye containing an opponent stone on a liberty point",
        rows: [
            "XXXX...",
            "XO.X...",
            "XXXX...",
            "X..X...",
            "XXXX...",
            ".......",
            ".......",
        ],
        classic: true, strict: true,
    },
];

describe("Kill-All Go: Benson pass-alive detection", () => {
    for (const f of fixtures) {
        it(f.name, () => {
            const board = boardFrom(f.rows);
            const geo = makeGeometry(f.rows.length);
            const classic = passAliveStrings(board, geo, BLUE, { suicideAllowed: false });
            const strict = passAliveStrings(board, geo, BLUE, { suicideAllowed: true });
            expect(classic.length > 0, "classic").to.equal(f.classic);
            expect(strict.length > 0, "strict").to.equal(f.strict);
        });
    }

    it("returns every stone of the alive chains and nothing else", () => {
        // Three chains: the two eye-shaped ones and the single stone between the eyes.
        const board = boardFrom(fixtures[7].rows);
        const geo = makeGeometry(7);
        const alive = passAliveStrings(board, geo, BLUE);
        expect(alive).to.have.length(3);
        const stones = alive.flat().sort();
        const expected = [...board.entries()].filter(([, c]) => c === BLUE).map(([cell]) => cell).sort();
        expect(stones).to.deep.equal(expected);
    });

    it("never reports the opponent's chains", () => {
        const board = boardFrom(fixtures[0].rows);
        const geo = makeGeometry(7);
        expect(passAliveStrings(board, geo, RED)).to.deep.equal([]);
    });
});

describe("Kill-All Go: room for two eyes", () => {
    const geo = makeGeometry(5);
    // Everything outside `pocket` is a permanent Attacker stone.
    const walledOff = (pocket: string[]): Set<string> => new Set(geo.cells.filter((c) => !pocket.includes(c)));

    it("always finds room while the Attacker has no permanent stones", () => {
        expect(roomForTwoEyes(geo, new Set())).to.be.true;
    });

    it("finds no room when every free point touches a permanent stone", () => {
        expect(roomForTwoEyes(geo, walledOff(["a5", "b5", "c5", "d5", "e5"]))).to.be.false;
    });

    it("finds no room when the only two eye points are next to each other", () => {
        // In a 3x2 corner pocket only a5 and b5 touch no permanent stone, and they are adjacent.
        expect(roomForTwoEyes(geo, walledOff(["a5", "b5", "c5", "a4", "b4", "c4"]))).to.be.false;
    });

    it("finds room when two eye points are apart, even if they are the only two", () => {
        // a5 and e5 are the only eye points, joined through the rest of the top row.
        expect(roomForTwoEyes(geo, walledOff(["a5", "b5", "c5", "d5", "e5", "a4", "e4"]))).to.be.true;
    });

    it("needs both eye points in one area", () => {
        // Two 2x2 corner pockets each offer a single eye point, but they are not connected.
        expect(roomForTwoEyes(geo, walledOff(["a5", "b5", "a4", "b4", "d1", "e1", "d2", "e2"]))).to.be.false;
    });

    it("never gives up on a Defender who is already pass-alive", () => {
        for (const f of fixtures.filter((x) => x.strict)) {
            const board = boardFrom(f.rows);
            const size = f.rows.length;
            const g = makeGeometry(size);
            expect(passAliveStrings(board, g, BLUE).length, f.name).to.be.greaterThan(0);
            const permanent = new Set(passAliveStrings(board, g, RED).flat());
            expect(roomForTwoEyes(g, permanent), f.name).to.be.true;
        }
    });
});

describe("Kill-All Go: board mechanics", () => {
    it("captures an opponent string that loses its last liberty", () => {
        const geo = makeGeometry(5);
        const board: Board = new Map([["c3", BLUE], ["b3", RED], ["d3", RED], ["c2", RED]]);
        const outcome = applyPlacement(board, geo, "c4", RED);
        expect(outcome.captured).to.deep.equal([["c3"]]);
        expect(outcome.suicided).to.deep.equal([]);
        expect(board.has("c3")).to.be.false;
        expect(board.get("c4")).to.equal(RED);
    });

    it("removes the mover's own string on a multi-stone suicide (Tromp-Taylor clearing)", () => {
        const geo = makeGeometry(5);
        const board: Board = new Map([["a1", BLUE], ["a2", RED], ["b2", RED], ["c1", RED]]);
        const outcome = applyPlacement(board, geo, "b1", BLUE);
        expect(outcome.captured).to.deep.equal([]);
        expect(outcome.suicided.sort()).to.deep.equal(["a1", "b1"]);
        expect(board.has("a1")).to.be.false;
        expect(board.has("b1")).to.be.false;
    });

    it("captures before checking the mover's liberties", () => {
        const geo = makeGeometry(5);
        // Blue at a1 is in atari on b1; Red at a2 and b2 protect it from the other side.
        const board: Board = new Map([["a1", BLUE], ["a2", RED], ["b2", RED], ["c1", BLUE]]);
        // Red plays b1: it captures a1 first and therefore keeps a liberty.
        const outcome = applyPlacement(board, geo, "b1", RED);
        expect(outcome.captured).to.deep.equal([["a1"]]);
        expect(outcome.suicided).to.deep.equal([]);
        expect(board.get("b1")).to.equal(RED);
    });

    it("finds strings and liberties", () => {
        const geo = makeGeometry(5);
        const board: Board = new Map([["a1", BLUE], ["b1", BLUE], ["b2", RED]]);
        const info = stringAt(board, geo, "a1");
        expect(info.stones.sort()).to.deep.equal(["a1", "b1"]);
        expect([...info.liberties].sort()).to.deep.equal(["a2", "c1"]);
    });

    it("signatures differ between positions", () => {
        const geo = makeGeometry(5);
        const a: Board = new Map([["a1", BLUE]]);
        const b: Board = new Map([["a1", RED]]);
        expect(signature(a, geo)).to.not.equal(signature(b, geo));
        expect(signature(a, geo)).to.equal(signature(new Map(a), geo));
    });
});

describe("Kill-All Go", () => {
    before(() => { addResource("en"); });
    after(() => {
        i18next.removeResourceBundle("en", "apgames");
        i18next.removeResourceBundle("en", "apresults");
    });

    describe("metadata", () => {
        it("is experimental and cannot be rated with a handicap", () => {
            const flags = KillAllGoGame.gameinfo.flags ?? [];
            expect(flags).to.include("experimental");
            const variants = KillAllGoGame.gameinfo.variants ?? [];
            const handicap = variants.find((v) => v.uid === "handicap");
            expect(handicap).to.not.be.undefined;
            expect(handicap!.unrated).to.be.true;
            for (const v of variants.filter((x) => x.uid !== "handicap")) {
                expect(v.unrated, v.uid).to.not.equal(true);
            }
        });
    });

    describe("classic opening", () => {
        it("sets up the 17 traditional stones with the Defender (Player 1) to move", () => {
            const g = new KillAllGoGame(undefined, ["classic"]);
            const expected = ["j18", "c17", "q17", "d16", "j16", "p16", "b10", "d10", "j10", "p10", "r10", "d4", "j4", "p4", "c3", "q3", "j2"];
            expect(g.board.size).to.equal(17);
            for (const cell of expected) {
                expect(g.board.get(cell)).to.equal(RED);
            }
            expect(g.phase).to.equal("play");
            expect(g.currplayer).to.equal(1);
            expect(g.redSeat).to.equal(2);
            expect(g.getPlayerColour(1)).to.equal(2);
            expect(g.getPlayerColour(2)).to.equal(1);
            const moves = g.moves();
            expect(moves).to.include("pass");
            expect(moves.filter((m) => m !== "pass")).to.have.length(361 - 17);
        });

        it("is only available on the 19x19 board", () => {
            const g = new KillAllGoGame(undefined, ["size-9", "classic"]);
            expect(g.variants).to.deep.equal(["size-9"]);
            expect(g.phase).to.equal("alt-place");
            expect(g.board.size).to.equal(0);
        });
    });

    describe("alternating placement (default opening)", () => {
        it("keeps the colours undecided until someone takes the Attacker side", () => {
            const g = new KillAllGoGame(undefined, ["size-9"]);
            expect(g.phase).to.equal("alt-place");
            expect(g.getPlayerColour(1)).to.equal("#999999");
            expect(g.getPlayerColour(2)).to.equal("#999999");
            g.move("d4");
            expect(g.board.get("d4")).to.equal(RED);
            expect(g.currplayer).to.equal(2);
            expect(g.stack[g.stack.length - 1]._results[0]).to.deep.include({ type: "place", where: "d4", what: "setup" });
            g.move("f6");
            expect(g.currplayer).to.equal(1);
            expect(g.moves()).to.include("attacker");
            expect(g.moves()).to.not.include("d4");
        });

        it("hands the first move to the other player as the Defender", () => {
            const g = play(new KillAllGoGame(undefined, ["size-9"]), ["d4", "attacker"]);
            expect(g.redSeat).to.equal(2);
            expect(g.phase).to.equal("play");
            expect(g.currplayer).to.equal(1);
            expect(g.getPlayerColour(1)).to.equal(2);
            expect(g.getPlayerColour(2)).to.equal(1);
            g.move("e5");
            expect(g.board.get("e5")).to.equal(BLUE);
            expect(g.currplayer).to.equal(2);
            g.move("e4");
            expect(g.board.get("e4")).to.equal(RED);
            expect(g.getPlies().map((p) => p.actor)).to.deep.equal([1, 2, 1, 2]);
        });

        it("lets Player 1 take the Attacker side at once", () => {
            const g = attackerIsPlayerOne();
            expect(g.redSeat).to.equal(1);
            expect(g.currplayer).to.equal(2);
            expect(g.phase).to.equal("play");
        });

        it("does not allow passing or stones alongside taking the Attacker side", () => {
            const g = new KillAllGoGame(undefined, ["size-9"]);
            expect(g.validateMove("pass").valid).to.be.false;
            expect(g.validateMove("attacker:a1").valid).to.be.false;
            expect(() => g.move("pass")).to.throw();
        });

        it("offers the Attacker side as a button and places stones by clicking", () => {
            const g = new KillAllGoGame(undefined, ["size-9"]);
            expect(g.render().areas).to.be.undefined;
            expect(g.getButtons()).to.deep.equal([{ label: "killallgo.attacker", move: "attacker" }]);
            const cell = g.handleClick("", 8, 0);
            expect(cell.valid).to.be.true;
            expect(cell.move).to.equal("a1");
        });
    });

    describe("handicap opening", () => {
        it("makes Player 1 set the handicap within [1, floor(p/2)]", () => {
            const g = new KillAllGoGame(undefined, ["size-9", "handicap"]);
            expect(g.phase).to.equal("hand-n");
            expect(g.validateMove("0").valid).to.be.false;
            expect(g.validateMove("41").valid).to.be.false;
            expect(g.validateMove("abc").valid).to.be.false;
            expect(g.validateMove("40").valid).to.be.true;
            expect(g.validateMove("1").valid).to.be.true;
            expect(g.moves()).to.have.length(40);
            expect(g.handleClick("", 0, 0).valid).to.be.false;
            g.move("3");
            expect(g.setup?.handicap).to.equal(3);
            expect(g.phase).to.equal("alt-place");
            expect(g.currplayer).to.equal(2);
        });

        it("makes Player 2 place the handicap stones when they take the Attacker side", () => {
            const g = play(new KillAllGoGame(undefined, ["size-9", "handicap"]), ["3"]);
            expect(g.moves()).to.not.include("attacker");
            expect(g.validateMove("attacker").complete).to.equal(-1);
            expect(g.validateMove("attacker:a1,b1").complete).to.equal(-1);
            expect(g.validateMove("attacker:a1,b1,c1,d1").valid).to.be.false;
            expect(g.validateMove("attacker:a1,a1,c1").valid).to.be.false;
            expect(() => g.move("attacker:a1,b1")).to.throw();
            g.move("attacker:a1,b1,c1");
            expect(g.redSeat).to.equal(2);
            expect(g.phase).to.equal("play");
            expect(g.currplayer).to.equal(1);
            expect(g.board.size).to.equal(3);
        });

        it("lets Player 1 take the Attacker side without extra stones", () => {
            const g = play(new KillAllGoGame(undefined, ["size-9", "handicap"]), ["3", "e5", "attacker"]);
            expect(g.redSeat).to.equal(1);
            expect(g.phase).to.equal("play");
            expect(g.currplayer).to.equal(2);
            expect(g.board.size).to.equal(1);
            expect(g.setup).to.deep.equal({ handicap: 3 });
            expect(g.getPlies().map((p) => p.actor)).to.deep.equal([1, 2, 1]);
        });
    });

    describe("simple pie", () => {
        it("lets Player 1 place any number of stones, then Player 2 take the Attacker side", () => {
            const g = new KillAllGoGame(undefined, ["size-9", "pie"]);
            expect(g.phase).to.equal("pie-slice");
            expect(g.validateMove("c3,g7").complete).to.equal(0);
            g.move("c3,g7");
            expect(g.board.size).to.equal(2);
            expect(g.phase).to.equal("pie-choose");
            expect(g.currplayer).to.equal(2);
            expect(g.moves()).to.include("attacker");
            expect(g.moves()).to.include("defender:e5");
            g.move("attacker");
            expect(g.redSeat).to.equal(2);
            expect(g.phase).to.equal("play");
            expect(g.currplayer).to.equal(1);
        });

        it("lets Player 2 choose the Defender side by placing the first stone", () => {
            const g = play(new KillAllGoGame(undefined, ["size-9", "pie"]), ["pass"]);
            expect(g.board.size).to.equal(0);
            expect(g.phase).to.equal("pie-choose");
            expect(g.validateMove("defender").complete).to.equal(-1);
            const click = g.handleClick("defender", 4, 4);
            expect(click.move).to.equal("defender:e5");
            g.move("defender:e5");
            expect(g.redSeat).to.equal(1);
            expect(g.board.get("e5")).to.equal(BLUE);
            expect(g.phase).to.equal("play");
            expect(g.currplayer).to.equal(1);
            expect(g.getPlies().map((p) => p.actor)).to.deep.equal([1, 2]);
        });
    });

    describe("generalized Hoctaph's pie", () => {
        it("validates the batch sizes", () => {
            const g = new KillAllGoGame(undefined, ["size-9", "hoctaph"]);
            expect(g.phase).to.equal("hoc-slice");
            expect(g.validateMove("0,1").valid).to.be.false;
            expect(g.validateMove("1,3").valid).to.be.false;
            expect(g.validateMove("40,40").valid).to.be.false;
            expect(g.validateMove("39,40").valid).to.be.true;
            expect(g.validateMove("2,3").valid).to.be.true;
            expect(g.validateMove("2,").valid).to.be.true;
            expect(g.validateMove("2,").complete).to.equal(-1);
            g.move("2,3");
            expect(g.setup).to.deep.equal({ a: 2, b: 3 });
            expect(g.phase).to.equal("hoc-option");
            expect(g.currplayer).to.equal(2);
        });

        it("option 2: the Slicer places the first batch and the Chooser picks the Defender side", () => {
            const g = play(new KillAllGoGame(undefined, ["size-9", "hoctaph"]), ["2,3", "youplace"]);
            expect(g.phase).to.equal("hoc-batch-a");
            expect(g.currplayer).to.equal(1);
            expect(g.validateMove("a1").complete).to.equal(-1);
            expect(g.validateMove("a1,b1,c1").valid).to.be.false;
            g.move("a1,b1");
            expect(g.phase).to.equal("hoc-choose");
            expect(g.currplayer).to.equal(2);
            g.move("defender");
            expect(g.redSeat).to.equal(1);
            expect(g.phase).to.equal("hoc-batch-b");
            expect(g.currplayer).to.equal(1);
            g.move("c1,d1,e1");
            expect(g.phase).to.equal("play");
            expect(g.currplayer).to.equal(2);
            expect(g.board.size).to.equal(5);
            expect(g.getPlies().map((p) => p.actor)).to.deep.equal([1, 2, 1, 2, 1]);
        });

        it("option 1: the Chooser places the first batch and the Slicer takes the Attacker side", () => {
            const g = play(new KillAllGoGame(undefined, ["size-9", "hoctaph"]), ["2,3", "iplace:a1,b1"]);
            expect(g.phase).to.equal("hoc-choose");
            expect(g.currplayer).to.equal(1);
            expect(g.validateMove("attacker").complete).to.equal(-1);
            g.move("attacker:c1,d1,e1");
            expect(g.redSeat).to.equal(1);
            expect(g.phase).to.equal("play");
            expect(g.currplayer).to.equal(2);
            expect(g.getPlies().map((p) => p.actor)).to.deep.equal([1, 2, 1]);
        });

        it("option 1: the Slicer picks the Defender side and the Chooser places the second batch", () => {
            const g = play(new KillAllGoGame(undefined, ["size-9", "hoctaph"]), ["2,3", "iplace:a1,b1", "defender"]);
            expect(g.redSeat).to.equal(2);
            expect(g.phase).to.equal("hoc-batch-b");
            expect(g.currplayer).to.equal(2);
            g.move("c1,d1,e1");
            expect(g.phase).to.equal("play");
            expect(g.currplayer).to.equal(1);
            expect(g.getPlies().map((p) => p.actor)).to.deep.equal([1, 2, 1, 2]);
        });

        it("accepts one-stone batches and keeps the batch sizes on the sidebar", () => {
            const g = play(new KillAllGoGame(undefined, ["size-9", "hoctaph"]), ["1,2", "youplace"]);
            expect(g.moves()).to.include("a1");
            g.move("a1");
            expect(g.phase).to.equal("hoc-choose");
            g.move("attacker:b1,c1");
            expect(g.phase).to.equal("play");
            expect(g.setup).to.deep.equal({ a: 1, b: 2 });
            const statuses = g.sidebarStatuses();
            expect(statuses.some((st) => (st.key as { textKey: string }).textKey === "apgames:status.killallgo.BATCHES")).to.be.true;
        });

        describe("the on-board batch-size picker", () => {
            // Which legend key the rendered board puts on a cell.
            const keyAt = (g: KillAllGoGame, cell: string): string => {
                const rows = (g.render().pieces as string).split("\n");
                const [x, y] = g.algebraic2coords(cell);
                return rows[y] === "_" ? "-" : rows[y].split(",")[x];
            };
            const slicing = (variants: string[], partial?: string): KillAllGoGame => {
                const g = new KillAllGoGame(undefined, variants);
                if (partial !== undefined) { g.move(partial, { partial: true }); }
                return g;
            };

            it("lays the values out in two three-wide blocks with labels above them", () => {
                const g = slicing(["size-9", "hoctaph"]);
                // 9x9 offers 1 to floor(81/12) = 6, reading order, one line in from each corner.
                const first = ["b8", "c8", "d8", "b7", "c7", "d7"];
                const second = ["f8", "g8", "h8", "f7", "g7", "h7"];
                first.forEach((cell, i) => expect(keyAt(g, cell), cell).to.equal(`n${i + 1}`));
                second.forEach((cell, i) => expect(keyAt(g, cell), cell).to.equal(`n${i + 1}`));
                expect(keyAt(g, "c9")).to.equal("la");
                expect(keyAt(g, "g9")).to.equal("lb");
                // A gap of empty points around each block, and nothing below them.
                for (const cell of ["a8", "e8", "i8", "b9", "b6", "e5"]) {
                    expect(keyAt(g, cell), cell).to.equal("-");
                }
                const legend = g.render().legend!;
                expect(legend.n6).to.deep.equal([{ name: "piece", colour: 1 }, { text: "6", scale: 0.75, rotate: null }]);
                expect(legend.la).to.deep.equal([{ name: "piece", colour: 1 }, { text: "a", scale: 0.75, rotate: null }]);
            });

            it("stops at floor(p/12) on every board size but still accepts larger typed sizes", () => {
                for (const [variants, max] of [[["size-9"], 6], [["size-13"], 14], [[], 30]] as Array<[string[], number]>) {
                    const g = slicing([...variants, "hoctaph"]);
                    const rendered = (g.render().pieces as string);
                    expect(rendered.includes(`n${max}`), `max ${max}`).to.be.true;
                    expect(rendered.includes(`n${max + 1}`), `beyond ${max}`).to.be.false;
                }
                const big = slicing(["hoctaph"]);
                expect(big.validateMove("40,35").valid).to.be.true;
            });

            it("picks the first batch on the left and the second on the right", () => {
                const g = slicing(["size-9", "hoctaph"]);
                const first = g.handleClick("", 1, 1);          // b8 = first batch, 1
                expect(first.valid).to.be.true;
                expect(first.move).to.equal("1");
                expect(first.complete).to.equal(-1);
                const second = g.handleClick(first.move, 1, 6); // g8 = second batch, 2
                expect(second.move).to.equal("1,2");
                expect(second.complete).to.equal(0);
                g.move("1,2");
                expect(g.setup).to.deep.equal({ a: 1, b: 2 });
                expect(g.phase).to.equal("hoc-option");
            });

            it("shades the values the other batch size forbids", () => {
                const g = slicing(["size-9", "hoctaph"], "1");
                expect(g.setup).to.deep.equal({ a: 1, b: undefined });
                // With a first batch of 1, a second batch may only be 1 or 2.
                expect(keyAt(g, "f8")).to.equal("n1");
                expect(keyAt(g, "g8")).to.equal("n2");
                expect(keyAt(g, "h8")).to.equal("d3");
                expect(keyAt(g, "d7")).to.equal("n6");
                const legend = g.render().legend!;
                expect(legend.d3).to.deep.equal([
                    { name: "piece", colour: 1, opacity: 0.5 },
                    { text: "3", scale: 0.75, rotate: null, opacity: 0.5 },
                ]);
            });

            it("lets a shaded value be picked, dropping the choice that forbade it", () => {
                const g = slicing(["size-9", "hoctaph"], "1");
                const click = g.handleClick("1", 1, 7);   // h8 = second batch, 3, shaded while the first is 1
                expect(click.valid).to.be.true;
                expect(click.move).to.equal(",3");
                const after = slicing(["size-9", "hoctaph"], ",3");
                expect(after.setup).to.deep.equal({ a: undefined, b: 3 });
                // A second batch of 3 now forbids a first batch of 1.
                expect(keyAt(after, "b8")).to.equal("d1");
                expect(keyAt(after, "c8")).to.equal("n2");
                expect(after.handleClick(",3", 1, 2).move).to.equal("2,3");
            });

            it("ignores clicks away from the blocks and shows the picker only while slicing", () => {
                const g = slicing(["size-9", "hoctaph"]);
                const stray = g.handleClick("", 4, 4);
                expect(stray.valid).to.be.false;
                expect(stray.move).to.equal("");
                const later = play(new KillAllGoGame(undefined, ["size-9", "hoctaph"]), ["2,3"]);
                expect(later.phase).to.equal("hoc-option");
                expect((later.render().pieces as string).includes("n1")).to.be.false;
                expect(Object.keys(later.render().legend!)).to.deep.equal(["A", "B"]);
            });
        });

        it("builds batches by clicking", () => {
            const g = play(new KillAllGoGame(undefined, ["size-9", "hoctaph"]), ["2,3"]);
            const first = g.handleClick("", 8, 0);
            expect(first.move).to.equal("iplace:a1");
            const second = g.handleClick(first.move, 8, 1);
            expect(second.move).to.equal("iplace:a1,b1");
            expect(second.complete).to.equal(1);
            const undo = g.handleClick(second.move, 8, 1);
            expect(undo.move).to.equal("iplace:a1");
        });
    });

    describe("opening buttons", () => {
        it("offers one fixed choice per opening phase and none once play starts", () => {
            const cases: Array<[string[], string[], Array<{ label: string; move: string }>]> = [
                [["size-9"], [], [{ label: "killallgo.attacker", move: "attacker" }]],
                [["size-9", "handicap"], [], []],
                [["size-9", "handicap"], ["2"], [{ label: "killallgo.attacker", move: "attacker" }]],
                [["size-9", "pie"], [], [{ label: "pass", move: "pass" }]],
                [["size-9", "pie"], ["c3"], [{ label: "killallgo.attacker", move: "attacker" }]],
                [["size-9", "hoctaph"], ["2,3"], [{ label: "killallgo.youplace", move: "youplace" }]],
                [["size-9", "hoctaph"], ["2,3", "youplace"], []],
                [["size-9", "hoctaph"], ["2,3", "youplace", "a1,b1"], [{ label: "killallgo.defender", move: "defender" }]],
                [["classic"], [], [{ label: "pass", move: "pass" }]],
            ];
            for (const [variants, moves, buttons] of cases) {
                const g = play(new KillAllGoGame(undefined, variants), moves);
                expect(g.getButtons(), `${variants.join("+")} after ${moves.join(" ")}`).to.deep.equal(buttons);
                expect(g.render().areas, `${variants.join("+")} areas`).to.be.undefined;
            }
        });

        it("finishes an incomplete Attacker button press with board clicks", () => {
            const g = play(new KillAllGoGame(undefined, ["size-9", "handicap"]), ["3"]);
            const staged = g.validateMove("attacker");
            expect(staged.valid).to.be.true;
            expect(staged.complete).to.equal(-1);
            let move = "attacker";
            for (const [row, col] of [[8, 0], [8, 1], [8, 2]] as Array<[number, number]>) {
                const click = g.handleClick(move, row, col);
                expect(click.valid).to.be.true;
                move = click.move;
            }
            expect(move).to.equal("attacker:a1,b1,c1");
            expect(g.validateMove(move).complete).to.equal(1);
            g.move(move);
            expect(g.redSeat).to.equal(2);
            expect(g.phase).to.equal("play");
        });

        it("takes the Attacker side in Hoctaph by clicking the second batch", () => {
            const g = play(new KillAllGoGame(undefined, ["size-9", "hoctaph"]), ["2,3", "iplace:a1,b1"]);
            let move = "";
            for (const [row, col] of [[8, 2], [8, 3], [8, 4]] as Array<[number, number]>) {
                move = g.handleClick(move, row, col).move;
            }
            expect(move).to.equal("attacker:c1,d1,e1");
            g.move(move);
            expect(g.redSeat).to.equal(1);
            expect(g.phase).to.equal("play");
        });
    });

    describe("play", () => {
        // Attacker stones on whole rows of the 9x9 board, optionally leaving some points out.
        const rowsOf = (rows: number[], except: string[] = []): string =>
            rows.flatMap((r) => "abcdefghi".split("").map((c) => `${c}${r}`)).filter((c) => !except.includes(c)).join(",");

        it("ends for the Attacker once their living stones leave the Defender no room", () => {
            // Full rows 8, 6, 4 and 2 live unconditionally, and every other point touches them.
            const g = play(new KillAllGoGame(undefined, ["size-9", "pie"]), [rowsOf([8, 6, 4, 2]), "attacker"]);
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([2]);
            expect(g.stack[g.stack.length - 1]._results).to.deep.include({ type: "eog", reason: "no-room" });
            expect(g.alive!.length).to.equal(36);
            const enters = g.render().annotations!.filter((a) => a.type === "enter");
            expect(enters.some((a) => (a as { targets: unknown[] }).targets.length === 36)).to.be.true;
            const keys = g.chatLogEntries(["Alice", "Bob"]).flatMap((e) => e.lines.map((l) => l.textKey));
            expect(keys).to.include("apresults:EOG.killallgo_no_room");
        });

        it("notices the Attacker's win on the move that completes it", () => {
            // With e2 missing, row 2 is two chains and nothing lives yet.
            const g = play(new KillAllGoGame(undefined, ["size-9", "pie"]), [rowsOf([8, 6, 4, 2], ["e2"]), "attacker"]);
            expect(g.gameover).to.be.false;
            expect(g.currplayer).to.equal(1);
            g.move("a1");
            expect(g.gameover).to.be.false;
            g.move("e2");
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([2]);
            expect(g.stack[g.stack.length - 1]._results).to.deep.include({ type: "eog", reason: "no-room" });
        });

        // A corner string with two one-point eyes, a9 and c9: unconditionally alive.
        const livingCorner = "b9,d9,a8,b8,c8,d8";

        it("keeps playing while the Attacker's living stones still leave room", () => {
            const g = play(new KillAllGoGame(undefined, ["size-9", "pie"]), [livingCorner, "attacker"]);
            expect(passAliveStrings(g.board, makeGeometry(9), RED).flat().sort()).to.deep.equal(livingCorner.split(",").sort());
            expect(g.gameover).to.be.false;
            expect(g.phase).to.equal("play");
        });

        it("treats only unconditionally alive Attacker stones as obstacles", () => {
            // A solid 5x5 Attacker block clear of the corner has no eyes, so it could still be
            // captured, and the free points it covers still count as room for the Defender.
            const block = "cdefg".split("").flatMap((c) => [1, 2, 3, 4, 5].map((r) => `${c}${r}`)).join(",");
            const g = play(new KillAllGoGame(undefined, ["size-9", "pie"]), [`${livingCorner},${block}`, "attacker"]);
            const permanent = passAliveStrings(g.board, makeGeometry(9), RED).flat();
            expect(permanent.sort()).to.deep.equal(livingCorner.split(",").sort());
            expect(g.gameover).to.be.false;
        });

        it("ends at once when a Defender string becomes pass-alive", () => {
            const g = attackerIsPlayerOne();
            play(g, ["a2", "pass", "b2", "pass", "c2", "pass", "d2", "pass", "d1", "pass"]);
            expect(g.gameover).to.be.false;
            g.move("b1");
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([2]);
            expect(g.alive!.sort()).to.deep.equal(["a2", "b1", "b2", "c2", "d1", "d2"]);
            const results = g.stack[g.stack.length - 1]._results;
            expect(results).to.deep.include({ type: "eog", reason: "pass-alive" });
            const rep = g.render();
            const enters = rep.annotations!.filter((a) => a.type === "enter");
            expect(enters.some((a) => (a as { targets: unknown[] }).targets.length === 6)).to.be.true;
        });

        it("gives the Defender no way to win but a pass-alive string", () => {
            const g = attackerIsPlayerOne();
            play(g, ["e5", "a9", "e6", "b9"]);
            // Seki and ko are not recognised, so there is nothing to claim and no claim notation.
            expect(g.validateMove("claim:e5").valid).to.be.false;
            expect(g.validateMove("claim").valid).to.be.false;
            expect(g.handleClick("", 4, 4).move).to.equal("");
            expect(g.moves().filter((m) => m !== "pass").every((m) => /^[a-z]+\d+$/.test(m))).to.be.true;
        });

        it("ends with an Attacker win after two consecutive passes", () => {
            const g = attackerIsPlayerOne();
            play(g, ["e5", "a9", "pass"]);
            expect(g.gameover).to.be.false;
            expect(g.validateMove("pass").message).to.not.equal("");
            g.move("pass");
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([1]);
            expect(g.stack[g.stack.length - 1]._results).to.deep.include({ type: "eog", reason: "double-pass" });
        });

        it("does not treat a pass followed by a stone as consecutive passes", () => {
            const g = attackerIsPlayerOne();
            play(g, ["e5", "pass", "e6", "pass"]);
            expect(g.gameover).to.be.false;
            expect(g.currplayer).to.equal(2);
        });

        it("forbids recreating an earlier position (positional superko)", () => {
            const g = attackerIsPlayerOne();
            // Blue: c5, b4, c3 around c4; Red: d5, e4, d3 around d4; Red throws in at c4, Blue captures with d4.
            play(g, ["c5", "d5", "b4", "e4", "c3", "d3", "a1", "c4", "d4"]);
            expect(g.board.has("c4")).to.be.false;
            expect(g.board.get("d4")).to.equal(BLUE);
            expect(g.currplayer).to.equal(1);
            expect(g.validateMove("c4").valid).to.be.false;
            expect(g.moves()).to.not.include("c4");
            play(g, ["a9", "b9"]);
            expect(g.validateMove("c4").valid).to.be.true;
            g.move("c4");
            expect(g.board.has("d4")).to.be.false;
        });

        it("applies a multi-stone suicide (Tromp-Taylor clearing)", () => {
            const g = attackerIsPlayerOne();
            // Red walls off a1 and b1 with a2, b2, c1. Blue plays a1 (one liberty at b1), then b1: both stones are removed.
            play(g, ["e5", "a2", "e6", "b2", "e7", "c1", "a1", "f5"]);
            expect(g.validateMove("b1").valid).to.be.true;
            g.move("b1");
            expect(g.board.has("a1")).to.be.false;
            expect(g.board.has("b1")).to.be.false;
            const results = g.stack[g.stack.length - 1]._results;
            expect(results).to.deep.include({ type: "capture", where: "b1,a1", count: 2, how: "suicide" });
            expect(g.currplayer).to.equal(1);
        });

        it("rejects a single-stone suicide because the position would repeat", () => {
            const g = attackerIsPlayerOne();
            play(g, ["e5", "a2", "e6", "b1"]);
            expect(g.validateMove("a1").valid).to.be.false;
            expect(g.moves()).to.not.include("a1");
            expect(g.moves()).to.include("c1");
        });

        it("offers the pass button only while the board is in play", () => {
            const g = attackerIsPlayerOne();
            expect(g.getButtons()).to.deep.equal([{ label: "pass", move: "pass" }]);
            play(g, ["e5", "a9", "pass", "pass"]);
            expect(g.gameover).to.be.true;
            expect(g.getButtons()).to.deep.equal([]);
        });

        it("reports its statuses with structured labels", () => {
            const g = new KillAllGoGame(undefined, ["size-9"]);
            const statuses = g.sidebarStatuses();
            expect(statuses[0].key).to.deep.include({ textKey: "apgames:status.killallgo.ATTACKER" });
            expect(statuses[0].value[0]).to.deep.include({ textKey: "apgames:status.killallgo.UNDECIDED" });
            g.move("attacker");
            const after = g.sidebarStatuses();
            expect(after[0].value[0]).to.deep.include({ textKey: "apgames:status._player", actor: { kind: "seat", seat: 1 } });
            expect(after[1].value[0]).to.deep.include({ actor: { kind: "seat", seat: 2 } });
        });
    });

    describe("records and chat", () => {
        it("writes structured chat lines for the protocol actions", () => {
            const g = play(new KillAllGoGame(undefined, ["size-9", "hoctaph"]), ["2,3", "iplace:a1,b1", "attacker:c1,d1,e1", "e5", "a9", "pass", "pass"]);
            const entries = g.chatLogEntries(["Alice", "Bob"]);
            const keys = entries.flatMap((e) => e.lines.map((l) => l.textKey));
            expect(keys).to.include("apresults:ANNOUNCE.killallgo_slice");
            expect(keys).to.include("apresults:SELECT.killallgo_iplace");
            expect(keys).to.include("apresults:CLAIM.killallgo_attacker");
            expect(keys).to.include("apresults:PLACE.killallgo_setup");
            expect(keys).to.include("apresults:EOG.killallgo_double_pass");
            const text = g.chatLog(["Alice", "Bob"]).flat().join("\n");
            expect(text).to.include("Alice chose to play as the Attacker.");
            expect(text).to.include("Alice placed an Attacker stone at c1.");
        });

        it("round-trips through serialization in every phase", () => {
            const games = [
                new KillAllGoGame(undefined, ["size-9"]),
                play(new KillAllGoGame(undefined, ["size-9", "handicap"]), ["2"]),
                play(new KillAllGoGame(undefined, ["size-9", "pie"]), ["c3"]),
                play(new KillAllGoGame(undefined, ["size-9", "hoctaph"]), ["2,3", "youplace"]),
                play(attackerIsPlayerOne(), ["e5", "a9"]),
            ];
            for (const g of games) {
                const copy = new KillAllGoGame(g.serialize());
                expect(copy.phase).to.equal(g.phase);
                expect(copy.currplayer).to.equal(g.currplayer);
                expect(copy.redSeat).to.equal(g.redSeat);
                expect(copy.setup).to.deep.equal(g.setup);
                expect([...copy.board.entries()]).to.deep.equal([...g.board.entries()]);
                expect(copy.moves()).to.deep.equal(g.moves());
            }
        });
    });
});
