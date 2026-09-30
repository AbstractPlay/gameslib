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

/** Which legend key the rendered board puts on a cell. */
const keyAt = (g: KillAllGoGame, cell: string): string => {
    const rows = (g.render().pieces as string).split("\n");
    const [x, y] = g.algebraic2coords(cell);
    return rows[y] === "_" ? "-" : rows[y].split(",")[x];
};

/** The cells the rendered board marks with an `enter` annotation. */
const entered = (g: KillAllGoGame): string[] =>
    (g.render().annotations ?? [])
        .filter((a) => a.type === "enter")
        .flatMap((a) => (a as { targets: Array<{ row: number; col: number }> }).targets)
        .map(({ row, col }) => g.coords2algebraic(col, row));

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
        it("links to Pieboxing and Kill-All Game on Sensei's Library, and credits MXHero for both openings that use Pieboxing", () => {
            const info = KillAllGoGame.gameinfo;
            expect(info.urls ?? []).to.include("https://senseis.xmp.net/?Pieboxing");
            expect(info.urls ?? []).to.include("https://senseis.xmp.net/?KillAllGame");
            const variants = info.variants ?? [];
            const opening = variants.find((v) => v.uid === "#opening");
            const handicap = variants.find((v) => v.uid === "handicap");
            expect(opening?.people?.some((p) => p.name === "MXHero")).to.be.true;
            expect(handicap?.people?.some((p) => p.name === "MXHero")).to.be.true;
        });

        it("preselects the 13x13 board", () => {
            const boards = (KillAllGoGame.gameinfo.variants ?? []).filter((v) => v.group === "board");
            expect(boards.filter((v) => v.default === true).map((v) => v.uid)).to.deep.equal(["size-13"]);
            // Games created without a board variant are still 19x19.
            expect(new KillAllGoGame(undefined, []).render().board).to.deep.include({ width: 19, height: 19 });
        });

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

    describe("the setup stone cap", () => {
        // 9x9 has 81 points; floor(81/2) = 40, matching the handicap range tested above.
        const allCells = (): string[] => {
            const cells: string[] = [];
            for (const col of "abcdefghi") { for (let row = 1; row <= 9; row++) { cells.push(`${col}${row}`); } }
            return cells;
        };

        it("stops a simple-pie slice from naming more than floor(p/2) stones", () => {
            const g = new KillAllGoGame(undefined, ["size-9", "pie"]);
            const atCap = allCells().slice(0, 40).join(",");
            const overCap = allCells().slice(0, 41).join(",");
            expect(g.validateMove(atCap).valid).to.be.true;
            expect(g.validateMove(atCap).complete).to.equal(0);
            expect(g.validateMove(overCap).valid).to.be.false;
            g.move(atCap);
            expect(g.board.size).to.equal(40);
        });

        it("rejects a simple-pie slice that names every point on the board", () => {
            // Before the cap existed, this suicided the whole board back to the empty starting
            // position, an illegal repeat that PSK is supposed to forbid.
            const g = new KillAllGoGame(undefined, ["size-9", "pie"]);
            const everyCell = allCells().join(",");
            expect(g.validateMove(everyCell).valid).to.be.false;
            expect(() => g.move(everyCell)).to.throw();
        });

        it("stops alt-place's ordinary single-stone placements once the running total hits floor(p/2)", () => {
            const g = play(new KillAllGoGame(undefined, ["size-9"]), allCells().slice(0, 40));
            expect(g.board.size).to.equal(40);
            expect(g.moves().some((m) => /^[a-z]+\d+$/.test(m))).to.be.false;
            expect(g.moves()).to.deep.equal(["attacker"]);
            expect(g.validateMove(allCells()[40]).valid).to.be.false;
            expect(() => g.move(allCells()[40])).to.throw();
            // The cap only blocks placing another stone; claiming the Attacker side still works.
            g.move("attacker");
            expect(g.redSeat).to.equal(1);
            expect(g.phase).to.equal("play");
        });

        it("lets the handicap opening's claiming batch reach its own independent cap even after ordinary turns", () => {
            // 20 ordinary turns (well under the 40-stone cap) followed by Player 2 claiming with
            // the full 40-stone handicap: 20 + 40 = 60 stones, comfortably under all 81 points.
            const g = play(new KillAllGoGame(undefined, ["size-9", "handicap"]), ["40", ...allCells().slice(0, 20)]);
            expect(g.board.size).to.equal(20);
            const batch = allCells().slice(20, 60).join(",");
            expect(g.validateMove(`attacker:${batch}`).valid).to.be.true;
            g.move(`attacker:${batch}`);
            expect(g.board.size).to.equal(60);
            expect(g.redSeat).to.equal(2);
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
            expect(moves).to.not.include("pass");
            expect(moves).to.have.length(361 - 17);
        });

        it("is only available on the 19x19 board", () => {
            const g = new KillAllGoGame(undefined, ["size-9", "classic"]);
            expect(g.variants).to.deep.equal(["size-9"]);
            expect(g.phase).to.equal("alt-place");
            expect(g.board.size).to.equal(0);
        });
    });

    describe("Pieboxing (default opening)", () => {
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
            expect(g.getButtons()).to.deep.equal([
                { label: "apgames:buttons.killallgo.attacker", move: "attacker" },
            ]);
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

        describe("the on-board handicap picker", () => {
            it("lays 1 to 18 out in two centred rows, odd values above the centre point and even ones below", () => {
                const g = new KillAllGoGame(undefined, ["size-9", "handicap"]);
                // Nine columns span the whole 9x9 board; each column holds a consecutive pair.
                "abcdefghi".split("").forEach((col, i) => {
                    expect(keyAt(g, `${col}6`), `${col}6`).to.equal(`n${2 * i + 1}`);
                    expect(keyAt(g, `${col}4`), `${col}4`).to.equal(`n${2 * i + 2}`);
                });
                // The centre row between them stays empty, and there is no label stone.
                for (const cell of ["a5", "e5", "i5", "e7", "e3"]) {
                    expect(keyAt(g, cell), cell).to.equal("-");
                }
                expect(Object.keys(g.render().legend!).filter((k) => k.startsWith("l"))).to.deep.equal([]);
                expect(entered(g)).to.deep.equal([]);
            });

            it("centres the same 1 to 18 on every board and still accepts larger typed handicaps", () => {
                // [variants, cells of 1 and 2, cells of 17 and 18, floor(p/2)]
                const cases: Array<[string[], string[], string[], number]> = [
                    [["size-9"], ["a6", "a4"], ["i6", "i4"], 40],
                    [["size-13"], ["c8", "c6"], ["k8", "k6"], 84],
                    [[], ["f11", "f9"], ["n11", "n9"], 180],
                ];
                for (const [variants, first, last, max] of cases) {
                    const g = new KillAllGoGame(undefined, [...variants, "handicap"]);
                    expect([...first, ...last].map((cell) => keyAt(g, cell)), `${max}`).to.deep.equal(["n1", "n2", "n17", "n18"]);
                    const numbered = (g.render().pieces as string).split(/[,\n]/).filter((k) => /^n\d+$/.test(k));
                    expect(numbered, `${max}`).to.have.length(18);
                    expect(g.validateMove(`${max}`).valid, `accepts ${max}`).to.be.true;
                }
            });

            it("sets the handicap by clicking and marks the choice", () => {
                const g = new KillAllGoGame(undefined, ["size-9", "handicap"]);
                const click = g.handleClick("", 3, 3);   // d6 = 7
                expect(click.valid).to.be.true;
                expect(click.move).to.equal("7");
                expect(click.complete).to.equal(0);
                expect(click.canrender).to.be.true;
                // Another click replaces the choice.
                expect(g.handleClick("7", 5, 2).move).to.equal("6");   // c4 = 6
                g.move("7", { partial: true });
                expect(entered(g)).to.deep.equal(["d6"]);
            });

            it("ignores clicks away from the numbered stones and goes away once the handicap is set", () => {
                const g = new KillAllGoGame(undefined, ["size-9", "handicap"]);
                const stray = g.handleClick("", 4, 4);   // e5, the centre point between the two rows
                expect(stray.valid).to.be.false;
                expect(stray.move).to.equal("");
                expect(stray.message).to.equal(i18next.t("apgames:validation.killallgo.NOT_A_NUMBERED_STONE", { where: "e5" }));
                g.move("7");
                expect(g.phase).to.equal("alt-place");
                expect(Object.keys(g.render().legend!)).to.deep.equal(["A", "B"]);
            });
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
            const g = new KillAllGoGame(undefined, ["size-9", "pie"]);
            expect(g.validateMove("pass").valid).to.be.true;
            expect(g.moves()).to.include("pass");
            expect(g.getButtons()).to.deep.equal([{ label: "apgames:buttons.pass", move: "pass" }]);
            g.move("pass");
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
            expect(g.validateMove("pass").valid).to.be.false;
            expect(g.moves()).to.not.include("pass");
            expect(g.getButtons()).to.deep.equal([]);
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
            // Each limit is explained only by its own error; the prompt itself leaves them out.
            expect(g.validateMove("pass").message).to.equal(i18next.t("apgames:validation.killallgo.SLICE_FORMAT"));
            expect(g.validateMove("0,1").message).to.equal(i18next.t("apgames:validation.killallgo.SLICE_MIN"));
            expect(g.validateMove("40,40").message).to.equal(i18next.t("apgames:validation.killallgo.SLICE_SUM", { max: 79 }));
            expect(g.validateMove("1,3").message).to.equal(i18next.t("apgames:validation.killallgo.SLICE_RATIO"));
            expect(g.validateMove("").message).to.equal(i18next.t("apgames:validation.killallgo.INSTRUCTIONS_HOC_SLICE"));
            expect(g.validateMove("").message).to.not.match(/\d/);
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
            const slicing = (variants: string[], partial?: string): KillAllGoGame => {
                const g = new KillAllGoGame(undefined, variants);
                if (partial !== undefined) { g.move(partial, { partial: true }); }
                return g;
            };

            it("lays each batch out in a centred row of seven, the first above the centre point and the second below it", () => {
                const g = slicing(["size-9", "hoctaph"]);
                // 9x9 offers 1 to ceil(2 * 81 / 25) = 7 for each batch, leaving the edge columns empty.
                "bcdefgh".split("").forEach((col, i) => {
                    expect(keyAt(g, `${col}7`), `${col}7`).to.equal(`n${i + 1}`);
                    expect(keyAt(g, `${col}3`), `${col}3`).to.equal(`n${i + 1}`);
                });
                // Nothing else is drawn: no label stones, three empty rows between the blocks, and empty edges.
                for (const cell of ["e9", "e8", "a7", "i7", "e6", "e5", "e4", "a3", "i3", "e2", "e1"]) {
                    expect(keyAt(g, cell), cell).to.equal("-");
                }
                const legend = g.render().legend!;
                expect(Object.keys(legend).filter((k) => !/^(A|B|[nd]\d+)$/.test(k))).to.deep.equal([]);
                expect(legend.n7).to.deep.equal([{ name: "piece", colour: 1 }, { text: "7", scale: 0.75, rotate: null }]);
            });

            it("marks each chosen size", () => {
                expect(entered(slicing(["size-9", "hoctaph"]))).to.deep.equal([]);
                expect(entered(slicing(["size-9", "hoctaph"], "2"))).to.deep.equal(["c7"]);
                expect(entered(slicing(["size-9", "hoctaph"], "2,3"))).to.deep.equal(["c7", "d3"]);
                // A size entered beyond the picker has no stone to mark.
                expect(entered(slicing(["size-9", "hoctaph"], "10,"))).to.deep.equal([]);
            });

            it("shows ceil(2p/25) values per batch but still accepts larger typed sizes", () => {
                for (const [variants, max] of [[["size-9"], 7], [["size-13"], 14], [[], 29]] as Array<[string[], number]>) {
                    const keys = (slicing([...variants, "hoctaph"]).render().pieces as string).split(/[,\n]/);
                    expect(keys.filter((k) => k === `n${max}`), `max ${max}`).to.have.length(2);
                    expect(keys.includes(`n${max + 1}`), `beyond ${max}`).to.be.false;
                }
                expect(slicing(["hoctaph"]).validateMove("40,35").valid).to.be.true;
            });

            it("snakes the values after a first row of nine back and forth away from the centre", () => {
                // 13x13: 1 to 9 run c9 to k9; 10 and 11 go out along the right-hand column, then 12 to 14 run back leftward.
                const mid = slicing(["size-13", "hoctaph"]);
                const lap = ["n1", "n9", "n10", "n11", "n12", "n14", "-"];
                expect(["c9", "k9", "k10", "k11", "j11", "h11", "g11"].map((cell) => keyAt(mid, cell))).to.deep.equal(lap);
                expect(["c5", "k5", "k4", "k3", "j3", "h3", "g3"].map((cell) => keyAt(mid, cell))).to.deep.equal(lap);
                // Three empty rows between the blocks, around the centre point, and empty edge rows.
                expect(["c8", "g8", "k8", "c7", "g7", "k7", "c6", "g6", "k6", "k12", "k13", "k2", "k1"].every((cell) => keyAt(mid, cell) === "-")).to.be.true;
                // 19x19: each snake turns on the right for 10 and 11, then on the left for 20 and 21, ending at 29.
                const big = slicing(["hoctaph"]);
                const laps = ["n1", "n9", "n10", "n11", "n19", "n20", "n21", "n29", "-", "-"];
                expect(["f12", "n12", "n13", "n14", "f14", "f15", "f16", "n16", "e16", "o16"].map((cell) => keyAt(big, cell))).to.deep.equal(laps);
                expect(["f8", "n8", "n7", "n6", "f6", "f5", "f4", "n4", "e4", "o4"].map((cell) => keyAt(big, cell))).to.deep.equal(laps);
                // Three empty rows between the blocks, around the centre point, and nothing beyond them.
                expect(["f11", "j11", "n11", "f10", "j10", "n10", "f9", "j9", "n9"].every((cell) => keyAt(big, cell) === "-")).to.be.true;
                expect(["j17", "j18", "j19", "j3", "j2", "j1"].every((cell) => keyAt(big, cell) === "-")).to.be.true;
            });

            it("picks the first batch above the centre point and the second below it", () => {
                const g = slicing(["size-9", "hoctaph"]);
                const first = g.handleClick("", 2, 1);          // b7 = first batch, 1
                expect(first.valid).to.be.true;
                expect(first.move).to.equal("1");
                expect(first.complete).to.equal(-1);
                const second = g.handleClick(first.move, 6, 2); // c3 = second batch, 2
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
                expect(keyAt(g, "b3")).to.equal("n1");
                expect(keyAt(g, "c3")).to.equal("n2");
                expect(keyAt(g, "d3")).to.equal("d3");
                expect(keyAt(g, "h7")).to.equal("n7");
                const legend = g.render().legend!;
                expect(legend.d3).to.deep.equal([
                    { name: "piece", colour: 1, opacity: 0.5 },
                    { text: "3", scale: 0.75, rotate: null, opacity: 0.5 },
                ]);
            });

            it("lets a shaded value be picked, dropping the choice that forbade it", () => {
                const g = slicing(["size-9", "hoctaph"], "1");
                const click = g.handleClick("1", 6, 3);   // d3 = second batch, 3, shaded while the first is 1
                expect(click.valid).to.be.true;
                expect(click.move).to.equal(",3");
                const after = slicing(["size-9", "hoctaph"], ",3");
                expect(after.setup).to.deep.equal({ a: undefined, b: 3 });
                // A second batch of 3 now forbids a first batch of 1.
                expect(keyAt(after, "b7")).to.equal("d1");
                expect(keyAt(after, "c7")).to.equal("n2");
                expect(after.handleClick(",3", 2, 2).move).to.equal("2,3");
            });

            it("ignores clicks away from the blocks and shows the picker only while slicing", () => {
                const g = slicing(["size-9", "hoctaph"]);
                const stray = g.handleClick("", 4, 4);   // e5, the centre point between the two blocks
                expect(stray.valid).to.be.false;
                expect(stray.move).to.equal("");
                // Like other games' invalid clicks, the warning just names the point, without repeating the prompt.
                expect(stray.message).to.equal(i18next.t("apgames:validation.killallgo.NOT_A_NUMBERED_STONE", { where: "e5" }));
                const beyond = g.handleClick("2", 1, 4);   // e8, an empty point beyond the first batch
                expect(beyond.valid).to.be.false;
                expect(beyond.move).to.equal("2");
                expect(beyond.message).to.equal(i18next.t("apgames:validation.killallgo.NOT_A_NUMBERED_STONE", { where: "e8" }));
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
                [["size-9"], [], [{ label: "apgames:buttons.killallgo.attacker", move: "attacker" }]],
                [["size-9", "handicap"], [], []],
                [
                    ["size-9", "handicap"],
                    ["2"],
                    [{ label: "apgames:buttons.killallgo.attacker", move: "attacker" }],
                ],
                [["size-9", "pie"], [], [{ label: "apgames:buttons.pass", move: "pass" }]],
                [
                    ["size-9", "pie"],
                    ["c3"],
                    [{ label: "apgames:buttons.killallgo.attacker", move: "attacker" }],
                ],
                [["size-9", "hoctaph"], ["2,3"], [{ label: "apgames:buttons.killallgo.youplace", move: "youplace" }]],
                [["size-9", "hoctaph"], ["2,3", "youplace"], []],
                [
                    ["size-9", "hoctaph"],
                    ["2,3", "youplace", "a1,b1"],
                    [{ label: "apgames:buttons.killallgo.defender", move: "defender" }],
                ],
                [["classic"], [], []],
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
            play(g, ["a2", "i9", "b2", "h9", "c2", "g9", "d2", "f9", "d1", "e9"]);
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
            expect(g.moves().every((m) => /^[a-z]+\d+$/.test(m))).to.be.true;
        });

        it("rejects normal-play passes for both sides without changing the game", () => {
            const g = attackerIsPlayerOne();
            for (const placement of ["e5", "a9"]) {
                const before = g.serialize();
                expect(g.validateMove("pass").valid).to.be.false;
                expect(g.validateMove("pass").message).to.equal(i18next.t("apgames:validation.killallgo.INVALID_PASS"));
                expect(g.moves()).to.not.include("pass");
                expect(g.getButtons()).to.deep.equal([]);
                expect(() => g.move("pass")).to.throw();
                expect(() => g.move("pass", { partial: true })).to.throw();
                expect(g.serialize()).to.equal(before);
                g.move(placement);
                expect(g.gameover).to.be.false;
            }
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

        it("offers no buttons once the game ends", () => {
            const g = play(new KillAllGoGame(undefined, ["size-9", "pie"]), [rowsOf([8, 6, 4, 2]), "attacker"]);
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
            const g = play(new KillAllGoGame(undefined, ["size-9", "hoctaph"]), ["2,3", "iplace:a1,b1", "attacker:c1,d1,e1", "e5", "a9"]);
            const entries = g.chatLogEntries(["Alice", "Bob"]);
            const keys = entries.flatMap((e) => e.lines.map((l) => l.textKey));
            expect(keys).to.include("apresults:ANNOUNCE.killallgo_slice");
            expect(keys).to.include("apresults:SELECT.killallgo_iplace");
            expect(keys).to.include("apresults:CLAIM.killallgo_attacker");
            expect(keys).to.include("apresults:PLACE.killallgo_setup");
            const text = g.chatLog(["Alice", "Bob"]).flat().join("\n");
            expect(text).to.include("Alice chose to play as the Attacker.");
            expect(text).to.include("Alice placed an Attacker stone at c1.");
        });

        it("still displays the result of an older game ended by consecutive passes", () => {
            const g = play(attackerIsPlayerOne(), ["e5", "a9"]);
            const state = g.state();
            state.gameover = true;
            state.winner = [1];
            const last = g.moveState();
            state.stack.push({ ...last, _version: "20260921", lastmove: "pass", currplayer: 1, _results: [{ type: "pass" }] });
            state.stack.push({
                ...last,
                _version: "20260921",
                lastmove: "pass",
                _results: [{ type: "pass" }, { type: "eog", reason: "double-pass" }, { type: "winners", players: [1] }],
            });
            const restored = new KillAllGoGame(state);
            expect(restored.gameover).to.be.true;
            expect(restored.winner).to.deep.equal([1]);
            const keys = restored.chatLogEntries(["Alice", "Bob"]).flatMap((e) => e.lines.map((l) => l.textKey));
            expect(keys).to.include("apresults:EOG.killallgo_double_pass");
            expect(restored.chatLog(["Alice", "Bob"]).flat().join("\n")).to.include("both players passed consecutively");
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
