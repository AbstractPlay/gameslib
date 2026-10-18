/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { addResource } from "../../src";
import type { IRenderOpts } from "../../src/games/_base";
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

/** The legend keys on the rendered (square) board, row by row from the top, "-" on an empty point. */
const grid = (g: KillAllGoGame, opts?: IRenderOpts): string[][] => {
    const rows = (g.render(opts).pieces as string).split("\n");
    return rows.map((row) => {
        if (row === "_") {
            return Array<string>(rows.length).fill("-");
        }
        return row.includes(",") ? row.split(",") : row.split("");
    });
};

/** Which legend key the rendered board puts on a cell. */
const keyAt = (g: KillAllGoGame, cell: string): string => {
    const [x, y] = g.algebraic2coords(cell);
    return grid(g)[y][x];
};

/**
 * The rendered board as a picture: one line per row from the top, each point three characters
 * wide, showing the number on a picker stone and "." for anything else.
 */
const picture = (g: KillAllGoGame): string[] =>
    grid(g).map((row) => row.map((key) => (/^g?[nd]\d+$/.test(key) ? key.replace(/\D/g, "") : ".").padStart(3)).join(""));

/** `rows` lines of an empty picture of a board `width` wide. */
const blank = (rows: number, width: number): string[] => Array<string>(rows).fill("  .".repeat(width));

/** The values of the picker stones whose legend keys start with `prefix` (`n`, or `gn` for the grey ones), in order. */
const offered = (g: KillAllGoGame, prefix: string): number[] =>
    grid(g).flat().filter((k) => new RegExp(`^${prefix}\\d+$`).test(k)).map((k) => parseInt(k.slice(prefix.length), 10)).sort((x, y) => x - y);

/** The cells the rendered board marks with an `enter` annotation. */
const entered = (g: KillAllGoGame): string[] =>
    (g.render().annotations ?? [])
        .filter((a) => a.type === "enter")
        .flatMap((a) => (a as { targets: Array<{ row: number; col: number }> }).targets)
        .map(({ row, col }) => g.coords2algebraic(col, row));

/** The cells whose stones the rendered board draws translucent (pass-alive), sorted. */
const faded = (g: KillAllGoGame, opts?: IRenderOpts): string[] => {
    const translucent = new Set(Object.entries(g.render(opts).legend ?? {})
        .filter(([, entry]) => [entry].flat().some((glyph) => ((glyph as { opacity?: number }).opacity ?? 1) < 1))
        .map(([key]) => key));
    return grid(g, opts).flatMap((row, y) => row.flatMap((key, x) => (translucent.has(key) ? [g.coords2algebraic(x, y)] : []))).sort();
};

const THROUGHOUT: IRenderOpts = { altDisplays: ["pass-alive-throughout"] };

/** The paint of a stone filled with `fill`, a player colour or a literal one: its border is black or white, whichever contrasts better with the fill. */
const stonePaint = (fill: number | string) => ({ fill, border: { func: "bestContrast", bg: fill, fg: ["#000", "#fff"] } });

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

        it("marks no variant, Pieboxing included, as a community variant", () => {
            for (const v of KillAllGoGame.gameinfo.variants ?? []) {
                expect(v.fans, v.uid).to.not.equal(true);
            }
            const pieboxing = new KillAllGoGame(undefined, []).allvariants()?.find((v) => v.uid === "#opening");
            expect(pieboxing).to.not.be.undefined;
            expect(pieboxing!.fans).to.not.equal(true);
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
            expect(g.chatLog(["Alice", "Bob"]).flat().join("\n")).to.include("Alice set the handicap to 3 stones.");
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
            it("lays 1 to 10 out in one snake five wide, from c7 on the top-left diagonal across and back down", () => {
                const g = new KillAllGoGame(undefined, ["size-9", "handicap"]);
                // 9x9 offers 81 / 8 rounded to the nearest even number, 10, in a block round_up_odd(9 / 2) = 5 wide.
                expect(picture(g)).to.deep.equal([
                    ...blank(2, 9),
                    "  .  .  1  2  3  4  5  .  .",
                    "  .  .  .  .  .  .  6  .  .",
                    "  .  .  . 10  9  8  7  .  .",
                    ...blank(4, 9),
                ]);
                // The first stone lies on the diagonal from the top left corner: its column and row from there are the same.
                expect(keyAt(g, "c7")).to.equal("n1");
                expect(g.algebraic2coords("c7")).to.deep.equal([2, 2]);
                // The stones take the Attacker's colour, and there is no label stone.
                expect(Object.keys(g.render().legend!).filter((k) => !/^(A|B|n\d+)$/.test(k))).to.deep.equal([]);
                expect(entered(g)).to.deep.equal([]);
            });

            it("offers p/8 handicaps, rounded to the nearest even number, and still accepts larger typed ones", () => {
                // [variants, handicaps offered, floor(p/2)]
                for (const [variants, count, max] of [[["size-9"], 10, 40], [["size-13"], 22, 84], [[], 46, 180]] as Array<[string[], number, number]>) {
                    const g = new KillAllGoGame(undefined, [...variants, "handicap"]);
                    expect(offered(g, "n"), `${count}`).to.deep.equal(Array.from({ length: count }, (_, i) => i + 1));
                    expect(g.validateMove(`${max}`).valid, `accepts ${max}`).to.be.true;
                }
            });

            it("starts every board's snake on the top-left diagonal, round_up_odd(w/2) wide, turning at the block's ends", () => {
                // 13x13: seven wide from d10, the fourth point along the diagonal.
                const mid = new KillAllGoGame(undefined, ["size-13", "handicap"]);
                expect(keyAt(mid, "d10")).to.equal("n1");
                expect(mid.algebraic2coords("d10")).to.deep.equal([3, 3]);
                expect(picture(mid)).to.deep.equal([
                    ...blank(3, 13),
                    "  .  .  .  1  2  3  4  5  6  7  .  .  .",
                    "  .  .  .  .  .  .  .  .  .  8  .  .  .",
                    "  .  .  . 15 14 13 12 11 10  9  .  .  .",
                    "  .  .  . 16  .  .  .  .  .  .  .  .  .",
                    "  .  .  . 17 18 19 20 21 22  .  .  .  .",
                    ...blank(5, 13),
                ]);
                // 19x19: eleven wide from e15, the fifth point along the diagonal, ending just below the centre row.
                const big = new KillAllGoGame(undefined, ["handicap"]);
                expect(keyAt(big, "e15")).to.equal("n1");
                expect(big.algebraic2coords("e15")).to.deep.equal([4, 4]);
                expect(picture(big)).to.deep.equal([
                    ...blank(4, 19),
                    "  .  .  .  .  1  2  3  4  5  6  7  8  9 10 11  .  .  .  .",
                    "  .  .  .  .  .  .  .  .  .  .  .  .  .  . 12  .  .  .  .",
                    "  .  .  .  . 23 22 21 20 19 18 17 16 15 14 13  .  .  .  .",
                    "  .  .  .  . 24  .  .  .  .  .  .  .  .  .  .  .  .  .  .",
                    "  .  .  .  . 25 26 27 28 29 30 31 32 33 34 35  .  .  .  .",
                    "  .  .  .  .  .  .  .  .  .  .  .  .  .  . 36  .  .  .  .",
                    "  .  .  .  .  . 46 45 44 43 42 41 40 39 38 37  .  .  .  .",
                    ...blank(8, 19),
                ]);
            });

            it("sets the handicap by clicking and marks the choice", () => {
                const g = new KillAllGoGame(undefined, ["size-9", "handicap"]);
                const click = g.handleClick("", 2, 4);   // e7 = 3
                expect(click.valid).to.be.true;
                expect(click.move).to.equal("3");
                expect(click.complete).to.equal(0);
                expect(click.canrender).to.be.true;
                // Another click replaces the choice.
                expect(g.handleClick("3", 4, 4).move).to.equal("9");   // e5 = 9
                g.move("3", { partial: true });
                expect(entered(g)).to.deep.equal(["e7"]);
            });

            it("ignores clicks away from the numbered stones and goes away once the handicap is set", () => {
                const g = new KillAllGoGame(undefined, ["size-9", "handicap"]);
                const stray = g.handleClick("", 3, 4);   // e6, an empty point between the snake's rows
                expect(stray.valid).to.be.false;
                expect(stray.move).to.equal("");
                expect(stray.message).to.equal(i18next.t("apgames:validation.killallgo.NOT_A_NUMBERED_STONE", { where: "e6" }));
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

            it("starts the first batch on the top-left diagonal and the second on the bottom-left one, five wide, each snaking towards the other", () => {
                const g = slicing(["size-9", "hoctaph"]);
                // 9x9 offers 1 to 2 * floor(81 / 16) = 10 for the first batch, from c7 across and back down, and 1 to 5 for the second along row 3.
                expect(picture(g)).to.deep.equal([
                    ...blank(2, 9),
                    "  .  .  1  2  3  4  5  .  .",
                    "  .  .  .  .  .  .  6  .  .",
                    "  .  .  . 10  9  8  7  .  .",
                    "  .  .  .  .  .  .  .  .  .",
                    "  .  .  1  2  3  4  5  .  .",
                    ...blank(2, 9),
                ]);
                // c7 is as far from the top edge as from the left one, and c3 as far from the bottom edge.
                expect(g.algebraic2coords("c7")).to.deep.equal([2, 2]);
                expect(g.algebraic2coords("c3")).to.deep.equal([2, 8 - 2]);
                // The first batch's stones are keyed apart from the second batch's: filled grey, #737373, where the second's take the Attacker's colour; both have contrasting borders.
                expect(keyAt(g, "c7")).to.equal("gn1");
                expect(keyAt(g, "c3")).to.equal("n1");
                const legend = g.render().legend!;
                expect(Object.keys(legend).filter((k) => !/^(A|B|g?[nd]\d+)$/.test(k))).to.deep.equal([]);
                expect(legend.gn5).to.deep.equal([{ name: "piece", paint: stonePaint("#737373") }, { text: "5", scale: 0.75, rotate: null }]);
                expect(legend.n5).to.deep.equal([{ name: "piece", paint: stonePaint(1) }, { text: "5", scale: 0.75, rotate: null }]);
            });

            it("marks each chosen size", () => {
                expect(entered(slicing(["size-9", "hoctaph"]))).to.deep.equal([]);
                expect(entered(slicing(["size-9", "hoctaph"], "2"))).to.deep.equal(["d7"]);
                expect(entered(slicing(["size-9", "hoctaph"], "2,3"))).to.deep.equal(["d7", "e3"]);
                // A size entered beyond the picker has no stone to mark.
                expect(entered(slicing(["size-9", "hoctaph"], "11,"))).to.deep.equal([]);
            });

            it("shows 2*floor(p/16) sizes for the first batch and floor(p/16) for the second, but still accepts larger typed sizes", () => {
                for (const [variants, half] of [[["size-9"], 5], [["size-13"], 10], [[], 22]] as Array<[string[], number]>) {
                    const g = slicing([...variants, "hoctaph"]);
                    // The first batch's stones have the grey `gn` keys, the second's the Attacker-coloured `n` keys.
                    expect(offered(g, "gn"), `first ${half}`).to.deep.equal(Array.from({ length: 2 * half }, (_, i) => i + 1));
                    expect(offered(g, "n"), `second ${half}`).to.deep.equal(Array.from({ length: half }, (_, i) => i + 1));
                }
                expect(slicing(["hoctaph"]).validateMove("46,30").valid).to.be.true;
            });

            it("leaves at least one empty row between the blocks, moving both a row further out only where they would otherwise leave none", () => {
                // 13x13: seven wide, d to j. Starting on the diagonals, at d10 and d4, both batches would reach row 6, so the first starts at d11 instead and the second at d3.
                const mid = slicing(["size-13", "hoctaph"]);
                expect(mid.algebraic2coords("d10")).to.deep.equal([3, 3]);
                expect(mid.algebraic2coords("d4")).to.deep.equal([3, 12 - 3]);
                expect(picture(mid)).to.deep.equal([
                    ...blank(2, 13),
                    "  .  .  .  1  2  3  4  5  6  7  .  .  .",
                    "  .  .  .  .  .  .  .  .  .  8  .  .  .",
                    "  .  .  . 15 14 13 12 11 10  9  .  .  .",
                    "  .  .  . 16  .  .  .  .  .  .  .  .  .",
                    "  .  .  . 17 18 19 20  .  .  .  .  .  .",
                    "  .  .  .  .  .  .  .  .  .  .  .  .  .",
                    "  .  .  .  .  .  .  .  . 10  9  .  .  .",
                    "  .  .  .  .  .  .  .  .  .  8  .  .  .",
                    "  .  .  .  1  2  3  4  5  6  7  .  .  .",
                    ...blank(2, 13),
                ]);
                expect(keyAt(mid, "d11")).to.equal("gn1");
                expect(keyAt(mid, "d3")).to.equal("n1");
                // 19x19: eleven wide, e to o. From the diagonals, at e15 and e5, the first batch reaches down to row 9 and the second up to row 7, so they stay there.
                const big = slicing(["hoctaph"]);
                expect(big.algebraic2coords("e15")).to.deep.equal([4, 4]);
                expect(big.algebraic2coords("e5")).to.deep.equal([4, 18 - 4]);
                expect(picture(big)).to.deep.equal([
                    ...blank(4, 19),
                    "  .  .  .  .  1  2  3  4  5  6  7  8  9 10 11  .  .  .  .",
                    "  .  .  .  .  .  .  .  .  .  .  .  .  .  . 12  .  .  .  .",
                    "  .  .  .  . 23 22 21 20 19 18 17 16 15 14 13  .  .  .  .",
                    "  .  .  .  . 24  .  .  .  .  .  .  .  .  .  .  .  .  .  .",
                    "  .  .  .  . 25 26 27 28 29 30 31 32 33 34 35  .  .  .  .",
                    "  .  .  .  .  .  .  .  .  .  .  .  .  .  . 36  .  .  .  .",
                    "  .  .  .  .  .  .  . 44 43 42 41 40 39 38 37  .  .  .  .",
                    "  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .",
                    "  .  .  .  .  . 22 21 20 19 18 17 16 15 14 13  .  .  .  .",
                    "  .  .  .  .  .  .  .  .  .  .  .  .  .  . 12  .  .  .  .",
                    "  .  .  .  .  1  2  3  4  5  6  7  8  9 10 11  .  .  .  .",
                    ...blank(4, 19),
                ]);
                expect(keyAt(big, "e15")).to.equal("gn1");
                expect(keyAt(big, "e5")).to.equal("n1");
            });

            it("picks the first batch from the upper block and the second from the lower one", () => {
                const g = slicing(["size-9", "hoctaph"]);
                const first = g.handleClick("", 2, 2);          // c7 = first batch, 1
                expect(first.valid).to.be.true;
                expect(first.move).to.equal("1");
                expect(first.complete).to.equal(-1);
                const second = g.handleClick(first.move, 6, 3); // d3 = second batch, 2
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
                expect(keyAt(g, "c3")).to.equal("n1");
                expect(keyAt(g, "d3")).to.equal("n2");
                expect(keyAt(g, "e3")).to.equal("d3");
                expect(keyAt(g, "g7")).to.equal("gn5");
                const legend = g.render().legend!;
                expect(legend.d3).to.deep.equal([
                    { name: "piece", paint: stonePaint(1), opacity: 0.5 },
                    { text: "3", scale: 0.75, rotate: null, opacity: 0.5 },
                ]);
            });

            it("lets a shaded value be picked, dropping the choice that forbade it", () => {
                const g = slicing(["size-9", "hoctaph"], "1");
                const click = g.handleClick("1", 6, 4);   // e3 = second batch, 3, shaded while the first is 1
                expect(click.valid).to.be.true;
                expect(click.move).to.equal(",3");
                const after = slicing(["size-9", "hoctaph"], ",3");
                expect(after.setup).to.deep.equal({ a: undefined, b: 3 });
                // A second batch of 3 now forbids a first batch of 1.
                expect(keyAt(after, "c7")).to.equal("gd1");
                expect(keyAt(after, "d7")).to.equal("gn2");
                // A shaded grey stone keeps its fill, at half opacity like the others.
                expect(after.render().legend!.gd1).to.deep.equal([
                    { name: "piece", paint: stonePaint("#737373"), opacity: 0.5 },
                    { text: "1", scale: 0.75, rotate: null, opacity: 0.5 },
                ]);
                expect(after.handleClick(",3", 2, 3).move).to.equal("2,3");
            });

            it("ignores clicks away from the blocks and shows the picker only while slicing", () => {
                const g = slicing(["size-9", "hoctaph"]);
                const stray = g.handleClick("", 5, 4);   // e4, on the empty row between the two blocks
                expect(stray.valid).to.be.false;
                expect(stray.move).to.equal("");
                // Like other games' invalid clicks, the warning just names the point, without repeating the prompt.
                expect(stray.message).to.equal(i18next.t("apgames:validation.killallgo.NOT_A_NUMBERED_STONE", { where: "e4" }));
                const beyond = g.handleClick("2", 0, 4);   // e9, an empty point above the first batch
                expect(beyond.valid).to.be.false;
                expect(beyond.move).to.equal("2");
                expect(beyond.message).to.equal(i18next.t("apgames:validation.killallgo.NOT_A_NUMBERED_STONE", { where: "e9" }));
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
            expect(faded(g)).to.deep.equal([...g.alive!].sort());
            expect(faded(g, THROUGHOUT)).to.deep.equal([...g.alive!].sort());
            const keys = g.chatLogEntries(["Alice", "Bob"]).flatMap((e) => e.lines.map((l) => l.textKey));
            expect(keys).to.include("apresults:killallgo.EOG.no_room");
            // Earlier positions of the finished game are marked only on request.
            g.load(g.stack.length - 2);
            expect(faded(g)).to.deep.equal([]);
            expect(faded(g, THROUGHOUT)).to.deep.equal([...g.stack[g.stack.length - 1].alive!].sort());
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
            expect(faded(g)).to.deep.equal([]);
            expect(faded(g, THROUGHOUT)).to.deep.equal(livingCorner.split(",").sort());
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
            expect(faded(g)).to.deep.equal(["a2", "b1", "b2", "c2", "d1", "d2"]);
            expect(faded(g, THROUGHOUT)).to.deep.equal(["a2", "b1", "b2", "c2", "d1", "d2"]);
            expect(entered(g)).to.deep.equal(["b1"]);
        });

        it("borders every stone in black or white, whichever contrasts better with its fill", () => {
            // Plain stones of both colours, with the Attacker's living corner faded on request.
            const living = play(new KillAllGoGame(undefined, ["size-9", "pie"]), [livingCorner, "attacker", "e5", "g5"]);
            // The Defender's string that has just come to life, faded in the final position.
            const won = play(attackerIsPlayerOne(), ["a2", "i9", "b2", "h9", "c2", "g9", "d2", "f9", "d1", "e9", "b1"]);
            const legends = [living.render(THROUGHOUT).legend!, won.render().legend!];
            for (const [key, fill] of [["A", 1], ["B", 2], ["C", 1], ["D", 2]] as const) {
                const legend = legends.find((l) => key in l);
                expect(legend, key).to.not.be.undefined;
                expect([legend![key]].flat()[0], key).to.deep.include({ name: "piece", paint: stonePaint(fill) });
            }
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

        it("makes a player with no legal placement lose", () => {
            // No sequence of moves is known to leave a player without a legal placement before the
            // life-and-death check ends the game, so the superko history is written directly: every
            // position the Defender could create after the Attacker's b9 has already occurred.
            const g = play(attackerIsPlayerOne(), ["e5", "a9", "e6"]);
            const geo = makeGeometry(9);
            const state = g.state();
            const last = state.stack[state.stack.length - 1];
            const after = new Map(last.board);
            after.set("b9", RED);
            const visited = geo.cells
                .filter((cell) => !after.has(cell))
                .map((cell) => ({ ...last, board: new Map(after).set(cell, BLUE), _results: [] }));
            state.stack.splice(state.stack.length - 1, 0, ...visited);
            const restored = new KillAllGoGame(state);
            expect(restored.currplayer).to.equal(1);
            expect(restored.moves()).to.include("b9");
            restored.move("b9");
            expect(restored.gameover).to.be.true;
            expect(restored.winner).to.deep.equal([1]);
            expect(restored.stack[restored.stack.length - 1]._results).to.deep.include({ type: "eog", reason: "no-moves" });
            expect(restored.moves()).to.deep.equal([]);
            const keys = restored.chatLogEntries(["Alice", "Bob"]).flatMap((e) => e.lines.map((l) => l.textKey));
            expect(keys).to.include("apresults:killallgo.EOG.no_moves");
            expect(restored.chatLog(["Alice", "Bob"]).flat().join("\n")).to.include("no legal placement");
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
            expect(keys).to.include("apresults:killallgo.ANNOUNCE.slice");
            expect(keys).to.include("apresults:killallgo.SELECT.iplace");
            expect(keys).to.include("apresults:killallgo.CLAIM.attacker");
            expect(keys).to.include("apresults:killallgo.PLACE.setup");
            const text = g.chatLog(["Alice", "Bob"]).flat().join("\n");
            expect(text).to.include("Alice chose to play as the Attacker.");
            expect(text).to.include("Alice placed an Attacker stone at c1.");
        });

        it("reports a multi-stone suicide with the mover and the count", () => {
            // The Defender's a1 leaves a1 and b1 without liberties; both are removed.
            const g = play(new KillAllGoGame(undefined, ["size-9", "pie"]), ["a2,b2,c1", "attacker", "b1", "i9", "a1"]);
            expect(g.board.has("a1")).to.be.false;
            expect(g.board.has("b1")).to.be.false;
            const keys = g.chatLogEntries(["Alice", "Bob"]).flatMap((e) => e.lines.map((l) => l.textKey));
            expect(keys).to.include("apresults:killallgo.CAPTURE.suicide");
            expect(g.chatLog(["Alice", "Bob"]).flat().join("\n")).to.include("Alice removed 2 of their own stones by suicide.");
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
            expect(keys).to.include("apresults:killallgo.EOG.double_pass");
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
