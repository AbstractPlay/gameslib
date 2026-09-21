/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { applyPlacement, BLUE, makeGeometry, RED, signature, stringAt, type Board } from "../../src/games/killallgo/board";
import { passAliveStrings } from "../../src/games/killallgo/benson";

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
