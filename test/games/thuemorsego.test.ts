/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import type { AreaTrack, BoardBasic, Glyph, MarkerDots, MarkerLine } from "@abstractplay/renderer/build/schemas/schema";
import { addResource } from "../../src";
import { SnubSquareGraph } from "../../src/common";
import { ThueMorseGoGame } from "../../src/games/thuemorsego";
import type { IClickResult, IStatus } from "../../src/games/_base";
import { assertChatLogParity } from "../fixtures/chat/helpers";

before(() => { addResource("en"); });

const play = (g: ThueMorseGoGame, moves: string[]): ThueMorseGoGame => {
    for (const m of moves) {
        g.move(m);
    }
    return g;
};

/** Run `fn` with {@link ThueMorseGoGame.randomMove}'s `Math.random` source pinned to `value`. */
const withRandom = <T>(value: number, fn: () => T): T => {
    const original = Math.random;
    Math.random = () => value;
    try {
        return fn();
    } finally {
        Math.random = original;
    }
};

/** A fresh game on the 11x11 board. */
const small = (variants: string[] = []): ThueMorseGoGame => new ThueMorseGoGame(undefined, ["size-11", ...variants]);

/** A fresh game on the default 16x16 board, whose handicap limit is 6. */
const sixteen = (variants: string[] = []): ThueMorseGoGame => new ThueMorseGoGame(undefined, variants);
/** The fill of a Kill-All role: its slot (3 Attacker, 4 Defender) when customized for this game, else the first or second colour. */
const role = (slot: 3 | 4) => ({ func: "custom", default: slot === 3 ? 1 : 2, palette: slot });
/** The paint of a Kill-All role's stones: like `stonePaint`, with the role's fill. */
const rolePaint = (slot: 3 | 4) => ({
    fill: role(slot),
    border: { func: "bestContrast", bg: role(slot), fg: ["#000", "#fff"] },
});
/** The paint of a stone in palette slot `slot`: its border is black or white, whichever contrasts better with the fill. */
const stonePaint = (slot: number) => ({
    fill: slot,
    border: { func: "bestContrast", bg: slot, fg: ["#000", "#fff"] },
});

/** The legend key at each point of the rendered board, by row from the top and column from the left. */
const grid = (g: ThueMorseGoGame): string[][] => {
    const rep = g.render();
    const width = (rep.board as { width: number }).width;
    return (rep.pieces as string).split("\n").map((row) => (row === "_" ? Array<string>(width).fill("-") : row.includes(",") ? row.split(",") : row.split("")));
};

/**
 * The rendered board as a picture: one line per row from the top, each point three characters
 * wide, showing the number on a picker stone (handicap or reverse komi) and "." for anything else.
 */
const picture = (g: ThueMorseGoGame): string[] =>
    grid(g).map((row) => row.map((key) => (/^[nk]\d+$/.test(key) ? key.slice(1) : ".").padStart(3)).join(""));

/** `rows` lines of an empty picture of a board `width` wide. */
const blank = (rows: number, width: number): string[] => Array<string>(rows).fill("  .".repeat(width));

/** The values of the numbered stones the rendered board shows, in order: the handicap's (`n`) or the reverse komi's (`k`). */
const offered = (g: ThueMorseGoGame, prefix: "n" | "k" = "n"): number[] =>
    grid(g).flat().filter((key) => new RegExp(`^${prefix}\\d+$`).test(key)).map((key) => parseInt(key.slice(1), 10)).sort((x, y) => x - y);

/** Put stones on the board, and into the initial and current positions, without playing them. */
const setStones = (g: ThueMorseGoGame, colour1: string[], colour2: string[]): void => {
    const board = new Map<string, 1 | 2>();
    for (const cell of colour1) { board.set(cell, 1); }
    for (const cell of colour2) { board.set(cell, 2); }
    g.stack[0].board = new Map(board);
    g.stack[g.stack.length - 1].board = new Map(board);
    g.board = new Map(board);
};

/** The cells whose stones the rendered board draws translucent, sorted: pass-alive stones in Kill-All games. */
const faded = (g: ThueMorseGoGame, opts?: { altDisplays?: string[] }): string[] => {
    const rep = g.render(opts);
    const keys = new Set(Object.entries(rep.legend ?? {})
        .filter(([, entry]) => [entry].flat().some((glyph) => ((glyph as { opacity?: number }).opacity ?? 1) < 1))
        .map(([key]) => key));
    const cells: string[] = [];
    (rep.pieces as string).split("\n").forEach((row, y) => {
        if (row !== "_") {
            (row.includes(",") ? row.split(",") : row.split("")).forEach((key, x) => {
                if (keys.has(key)) {
                    cells.push(g.coords2algebraic(x, y));
                }
            });
        }
    });
    return cells.sort();
};
const THROUGHOUT = { altDisplays: ["pass-alive-throughout"] };

/** The click on `cell` with `move` in progress. */
const click = (g: ThueMorseGoGame, move: string, cell: string): IClickResult => {
    const [x, y] = g.algebraic2coords(cell);
    return g.handleClick(move, y, x);
};

/** The layers of a tracker legend entry. */
const layers = (g: ThueMorseGoGame, key: string, opts?: { altDisplays?: string[] }): Glyph[] => {
    const legend = g.render(opts).legend as Record<string, Glyph[]>;
    return legend[key];
};

/** A corner string with the two single-point eyes a1 and c1, and the wall that leaves it no other liberty. */
const twoEyedCorner = (): { own: string[]; wall: string[] } => ({
    own: ["a2", "b1", "b2", "c2", "d1", "d2"],
    wall: ["a3", "b3", "c3", "d3", "e1", "e2", "e3"],
});

// The tracker of the mockup: placement 0x123 is next, digits running upward. The mockup's keys
// e/o (small) and E/O (markers) are s1/s2 and m1d*/m2d* here, the markers carrying their digit;
// a blank column separates the digit columns and a blank frame surrounds them.
const TRACK_ROWS_0X123 = [
    "e-o-e", "o-e-o", "o-e-o", "e-o-e", "o-e-o", "e-o-e", "e-o-e", "o-e-o",
    "o-e-o", "e-o-e", "e-o-e", "o-e-o", "e-o-E", "o-E-o", "O-e-o", "e-o-e",
];
const BLANK_TRACK_ROW = Array<string>(7).fill("-").join(",");
const TRACK_0X123 = [
    BLANK_TRACK_ROW,
    ...TRACK_ROWS_0X123.map((row, r) => {
        const digit = (15 - r).toString(16);
        const keys = row.split("").map((c) => ({ e: "s1", o: "s2", E: `m1d${digit}`, O: `m2d${digit}` }[c] ?? c));
        return ["-", ...keys, "-"].join(",");
    }),
    BLANK_TRACK_ROW,
].join("\n");

describe("Thue-Morse Go: the sequence", () => {
    it("names the colour of each placement by the parity of its 1 bits", () => {
        const g = small();
        const digits = [];
        for (let n = 0; n < 16; n++) {
            digits.push(g.digitAt(n));
        }
        expect(digits).to.deep.equal([0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0]);
    });

    it("makes every move one or two placements", () => {
        const g = small();
        const starts = [0, 1, 3, 4, 5, 7, 9, 11, 12, 13, 15, 16, 17];
        expect(starts.map((n) => g.moveLength(n))).to.deep.equal([1, 2, 1, 1, 2, 2, 2, 1, 1, 2, 1, 1, 2]);
        for (let n = 0; n < 4096; n++) {
            expect(g.moveLength(n)).to.be.at.most(2);
        }
    });

    it("repeats ABBA under Balanced Marseillais", () => {
        const g = small(["marseillais"]);
        const digits = [];
        for (let n = 0; n < 8; n++) {
            digits.push(g.digitAt(n));
        }
        expect(digits).to.deep.equal([0, 1, 1, 0, 0, 1, 1, 0]);
        expect([0, 1, 3, 5, 7].map((n) => g.moveLength(n))).to.deep.equal([1, 2, 2, 2, 2]);
    });

    it("alternates the seats move by move", () => {
        const g = play(small(), ["f6", "e5,g7", "f5", "d4", "c3,c4", "h8,h9"]);
        expect(g.stack.map((s) => s.currplayer)).to.deep.equal([1, 2, 1, 2, 1, 2, 1]);
        expect(g.placed).to.equal(9);
        expect(g.stack.map((s) => s.placed)).to.deep.equal([0, 1, 3, 4, 5, 7, 9]);
    });
});

describe("Thue-Morse Go: moves", () => {
    it("takes one placement, then two", () => {
        const g = small();
        expect(g.validateMove("f6").complete).to.equal(1);
        g.move("f6");
        expect(g.currplayer).to.equal(2);
        expect(g.placed).to.equal(1);
        expect(g.validateMove("e5").complete).to.equal(0);
        expect(g.validateMove("e5,g7").complete).to.equal(1);
        expect(g.validateMove("e5,g7,h8").valid).to.be.false;
        expect(g.validateMove("e5,e5").valid).to.be.false;
        expect(g.validateMove("e5,f6").valid).to.be.false;
        g.move("e5,g7");
        expect(g.board.get("e5")).to.equal(2);
        expect(g.board.get("g7")).to.equal(2);
        expect(g.placed).to.equal(3);
        expect(g.currplayer).to.equal(1);
        expect(g.lastmove).to.equal("e5,g7");
    });

    it("passes the placements a short move leaves out", () => {
        const g = play(small(), ["f6", "e5"]);
        expect(g.lastmove).to.equal("e5,pass");
        expect(g.results.map((r) => r.type)).to.deep.equal(["place", "pass"]);
        expect(g.placed).to.equal(3);
        expect(g.currplayer).to.equal(1);
        const h = play(small(), ["f6", "pass"]);
        expect(h.lastmove).to.equal("pass,pass");
        expect(h.gameover).to.be.false;
    });

    it("builds a move from clicks", () => {
        const g = play(small(), ["f6"]);
        const [ex, ey] = g.algebraic2coords("e5");
        const [gx, gy] = g.algebraic2coords("g7");
        let click = g.handleClick("", ey, ex);
        expect(click.move).to.equal("e5");
        expect(click.complete).to.equal(0);
        click = g.handleClick("e5", gy, gx);
        expect(click.move).to.equal("e5,g7");
        expect(click.complete).to.equal(1);
        // Clicking the last placement again takes it back; an occupied cell is refused, even
        // after one placement of two, since marking a string dead takes an explicit pass first.
        expect(g.handleClick("e5,g7", gy, gx).move).to.equal("e5");
        const [fx, fy] = g.algebraic2coords("f6");
        const refused = g.handleClick("e5", fy, fx);
        expect(refused.valid).to.be.false;
        expect(refused.move).to.equal("e5");
        expect(refused.message).to.contain("press Pass first");
        expect(g.handleClick("", fy, fx).valid).to.be.false;
    });

    it("takes a placement back on a second click only while its stone is still on the board", () => {
        // Player 2's two placements: a1 has no liberties and captures nothing, so it is removed at once.
        const g = play(small(), ["k11"]);
        setStones(g, ["a2", "b1", "k11"], []);
        expect(click(g, "", "a1").move).to.equal("a1");
        expect(click(g, "a1", "a1").move).to.equal("a1,a1");
        expect(click(g, "a1,a1", "a1").move).to.equal("a1,a1");
        // A stone that stays is taken back, as is one placed on a point its own capture emptied.
        expect(click(g, "k10", "k10").move).to.equal("");
        const h = play(small(), ["k11"]);
        setStones(h, ["a1", "k11"], ["a2"]);
        expect(click(h, "b1", "a1").move).to.equal("b1,a1");
        expect(click(h, "b1,a1", "a1").move).to.equal("b1");
        // With checked weak eyes the stone stays until the move ends, so the second click takes it back.
        const w = play(small(["weak-eyes"]), ["k11"]);
        setStones(w, ["a2", "b1", "k11"], []);
        expect(click(w, "a1", "a1").move).to.equal("");
    });

    it("ignores clicks on the tracker's glyphs", () => {
        const g = play(small(), ["f6"]);
        for (const [piece, move] of [["s1", ""], ["s2", "e5"], ["m2", "e5"], ["m1", ""], ["m2d1", "e5"], ["m1da", "pass,pass"]]) {
            const result = g.handleClick(move, 3, 1, piece);
            expect(result.valid).to.be.true;
            expect(result.move).to.equal(move);
            expect(result.complete).to.equal(g.validateMove(move).complete);
        }
        // A click on the board itself still places a stone there.
        const [x, y] = g.algebraic2coords("b8");
        expect(g.handleClick("", y, x, "").move).to.equal("b8");
    });

    it("treats button clicks as whole-move passes or the button's move", () => {
        const g = play(small(), ["f6"]);
        // Passing replaces a placement already made in the move.
        const pass = g.handleClick("e5", -1, -1, "_btn_pass");
        expect(pass.move).to.equal("pass,pass");
        // A whole-move pass stays open so that strings can be marked dead.
        expect(pass.complete).to.equal(0);
        expect(small().handleClick("", -1, -1, "_btn_pass").move).to.equal("pass");
        const button = g.handleClick("e5", -1, -1, "_btn_button");
        expect(button.move).to.equal("button");
        expect(button.complete).to.equal(0);
        const unknown = g.handleClick("e5", -1, -1, "stash");
        expect(unknown.valid).to.be.false;
        expect(unknown.move).to.equal("e5");
        // Kill-All games cannot pass, so the click is refused and the move kept.
        const k = play(small(["kill-all"]), ["f6", "attacker"]);
        const refused = k.handleClick("e5", -1, -1, "_btn_pass");
        expect(refused.valid).to.be.false;
        expect(refused.move).to.equal("e5");
    });

    it("offers a button that passes the whole move, and one that takes the button while it lasts", () => {
        const g = small();
        expect(g.getButtons().map((b) => b.move)).to.deep.equal(["pass", "button"]);
        g.move("button");
        expect(g.getButtons().map((b) => b.move)).to.deep.equal(["pass,pass"]);
        expect(g.validateMove("pass,pass").complete).to.equal(0);
        // The 16x16 board has an even number of points, so no button.
        expect(sixteen().getButtons().map((b) => b.move)).to.deep.equal(["pass"]);
        // With one placement given away by the handicap, only the other is passed.
        const h = play(new ThueMorseGoGame(undefined, ["size-19", "handicap"]), ["h8", "4", "g7", "f6,f7"]);
        expect(h.getButtons().map((b) => b.move)).to.deep.equal(["pass", "button"]);
    });

    it("evens the count with the button: one point on boards with an odd number of points, none otherwise", () => {
        const hasButton = (variants: string[]): boolean => new ThueMorseGoGame(undefined, variants).getButtons().some((b) => b.move === "button");
        expect(hasButton(["size-11"])).to.be.true;
        expect(hasButton([])).to.be.false;
        expect(hasButton(["size-19"])).to.be.true;
        expect(hasButton(["size-23"])).to.be.true;
        expect(hasButton(["snub"])).to.be.false;
        expect(hasButton(["size-11", "snub"])).to.be.true;
        expect(hasButton(["size-11", "half-button"])).to.be.true;
        expect(hasButton(["half-button"])).to.be.true;
        expect(sixteen(["half-button"]).move("button").getPlayerScore(1)).to.equal(0.5);
        expect(sixteen().validateMove("button").message).to.contain("no button");
        // The half-point button is a lone checkbox: no group, and no separate 1-point variant.
        const uids = small().allvariants()!.map((v) => v.uid);
        expect(uids).to.not.include("#button");
        expect(uids).to.not.include("button");
        const half = small().allvariants()!.find((v) => v.uid === "half-button")!;
        expect(half.group).to.be.undefined;
        expect(half.name).to.equal("0.5 point button");
        expect(half.description).to.contain("prevents tied scores");
        // A Kill-All game never has one, whatever the board.
        expect(play(small(["kill-all"]), ["f6", "attacker"]).getButtons().some((b) => b.move === "button")).to.be.false;
    });

    it("takes the button and then places a stone by clicking", () => {
        const g = play(small(), ["f6"]);
        expect(g.validateMove("button").complete).to.equal(0);
        const [x, y] = g.algebraic2coords("e5");
        const clicked = g.handleClick("button", y, x);
        expect(clicked.move).to.equal("button,e5");
        expect(clicked.complete).to.equal(1);
        g.move(clicked.move);
        expect(g.button).to.equal(2);
        expect(g.board.get("e5")).to.equal(2);
        expect(g.placed).to.equal(3);
        // Taking the button is not a pass: the following whole-move passes end the game on the board as it is.
        play(g, ["pass", "pass"]);
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([2]);
        expect([g.getPlayerScore(1), g.getPlayerScore(2)]).to.deep.equal([1, 2]);
    });

    it("captures stones", () => {
        const g = small();
        setStones(g, ["a2"], ["a1"]);
        g.move("b1");
        expect(g.board.has("a1")).to.be.false;
        expect(g.results.filter((r) => r.type === "capture").map((r) => r.count)).to.deep.equal([1]);
        // Two stones, the point they enclose, and the rest of the empty board; the capture itself does not score.
        expect(g.getPlayerScore(1)).to.equal(121);
        expect(g.getPlayerScore(2)).to.equal(0);
        expect(g.sidebarScores().map((table) => table.scores)).to.deep.equal([[121, 0]]);
    });

    it("allows multi-stone suicide but not the single stone that repeats the position", () => {
        const g = small(["superko"]);
        setStones(g, ["a1"], ["a2", "b2", "c1", "k11"]);
        expect(g.validateMove("b1").valid).to.be.true;
        g.move("b1");
        expect(g.board.has("a1")).to.be.false;
        expect(g.board.has("b1")).to.be.false;
        const suicide = g.results.find((r) => r.type === "capture")!;
        expect(suicide.how).to.equal("suicide");
        expect(suicide.count).to.equal(2);

        const h = small(["superko"]);
        setStones(h, [], ["a2", "b1", "k11"]);
        const result = h.validateMove("a1");
        expect(result.valid).to.be.false;
        expect(result.message).to.contain("suicide");
    });

    it("judges a suicidal first placement at once, or at the end of the move under checked weak eyes", () => {
        // Player 2's two placements: a1 has no liberties and captures nothing.
        const g = play(small(["superko"]), ["k11"]);
        setStones(g, ["a2", "b1", "k11"], []);
        const first = g.validateMove("a1");
        expect(first.valid).to.be.false;
        expect(first.message).to.contain("suicide");
        expect(g.validateMove("a1,k10").valid).to.be.false;
        // With checked weak eyes nothing is cleared until the move ends, so the second stone decides.
        const h = play(small(["superko", "weak-eyes"]), ["k11"]);
        setStones(h, ["a2", "b1", "k11"], []);
        const deferred = h.validateMove("a1");
        expect(deferred.valid).to.be.true;
        expect(deferred.complete).to.equal(-1);
        expect(deferred.message).to.contain("suicide");
        expect(h.validateMove("a1,pass").valid).to.be.false;
        expect(h.validateMove("a1,k10").complete).to.equal(1);
        h.move("a1,k10");
        expect(h.board.has("a1")).to.be.false;
        expect(h.board.get("k10")).to.equal(2);
        // Two stones removed together at the end of the move are reported as the move's suicide.
        const both = play(small(["superko", "weak-eyes"]), ["k11"]);
        setStones(both, ["a2", "b2", "c1", "k11"], []);
        const together = both.validateMove("a1,b1");
        expect(together.valid).to.be.false;
        expect(together.message).to.contain("stones placed this move");
        expect(together.message).to.contain("positional superko");
        const apart = play(small(["superko", "weak-eyes"]), ["k11"]);
        setStones(apart, ["a2", "b1", "a10", "b11", "k11"], []);
        expect(apart.validateMove("a1,a11").message).to.contain("stones placed this move");
        // Under double delayed superko the move is allowed until the position has arisen three times.
        const delayed = small(["double-delayed-psk", "weak-eyes"]);
        setStones(delayed, [], ["a2", "b2", "c1", "j11", "k10"]);
        play(delayed, ["k11", "pass,pass", "k11", "pass"]);
        expect(delayed.gameover).to.be.false;
        const fourth = delayed.validateMove("a1,b1");
        expect(fourth.valid).to.be.false;
        expect(fourth.message).to.contain("stones placed this move");
        expect(fourth.message).to.contain("three times");
    });

    it("judges repetition only by the position a move leaves under checked weak eyes", () => {
        // A ko: retaking it at once recreates the position the capture came from.
        const g = small(["superko", "weak-eyes"]);
        setStones(g, ["a2", "b1", "b3"], ["b2", "c1", "c3", "d2"]);
        g.move("c2");
        expect(g.board.has("b2")).to.be.false;
        // The retake alone would end the move in that position; followed by another stone it is a new one.
        const alone = g.validateMove("b2");
        expect(alone.complete).to.equal(-1);
        expect(alone.message).to.contain("earlier position");
        expect(g.validateMove("b2,pass").valid).to.be.false;
        expect(g.validateMove("b2,k11").complete).to.equal(1);
        g.move("b2,k11");
        expect(g.board.has("c2")).to.be.false;
        expect(g.board.get("k11")).to.equal(2);
        // Only the position the move left was recorded, so the next move sees one new position.
        expect(g.interim).to.deep.equal([]);
        expect(g.novel).to.be.true;
        // The fifth occurrence by default is likewise counted when the move ends.
        const d = small(["weak-eyes"]);
        setStones(d, ["k10", "j11"], ["a2", "b1"]);
        play(d, ["a1", "k11,pass", "a1", "pass"]);
        expect(d.gameover).to.be.false;
        expect(d.validateMove("a1,k9").complete).to.equal(1);
        d.move("a1,pass");
        expect(d.gameover).to.be.true;
        expect(d.results.find((r) => r.type === "eog")!.reason).to.equal("repetition");
    });

    it("can empty a cell and refill it within one move", () => {
        // Player 2's two placements: the first captures a1, the second plays there.
        const g = small();
        setStones(g, ["a1"], ["a2"]);
        g.move("k11");
        expect(g.validateMove("b1,a1").complete).to.equal(1);
        g.move("b1,a1");
        expect(g.board.get("a1")).to.equal(2);
        expect(g.board.has("b1")).to.be.true;
    });

    it("lets a two-placement move fill both eyes under checked weak eyes", () => {
        const { own, wall } = twoEyedCorner();
        const plain = small(["superko"]);
        setStones(plain, wall, own);
        plain.placed = 5; // Player 1's two-placement move
        // Each eye filled is suicide at once and recreates the position.
        expect(plain.validateMove("a1").valid).to.be.false;
        expect(plain.validateMove("a1,c1").valid).to.be.false;

        const checked = small(["superko", "weak-eyes"]);
        setStones(checked, wall, own);
        checked.placed = 5;
        const first = checked.validateMove("a1");
        expect(first.valid).to.be.true;
        expect(first.complete).to.equal(-1);
        expect(checked.validateMove("a1,c1").complete).to.equal(1);
        checked.move("a1,c1");
        expect(checked.results.filter((r) => r.type === "capture").map((r) => r.count)).to.deep.equal([6]);
        for (const cell of own) {
            expect(checked.board.has(cell)).to.be.false;
        }
        expect(checked.board.get("a1")).to.equal(1);
        expect(checked.board.get("c1")).to.equal(1);
    });

    it("hands out the button once", () => {
        const g = small();
        g.move("button");
        expect(g.button).to.equal(1);
        expect(g.placed).to.equal(1);
        expect(g.getPlayerScore(1)).to.equal(1);
        expect(g.validateMove("button").valid).to.be.false;
        expect(g.validateMove("e5,button").valid).to.be.false;
        expect(g.validateMove("e5,pass").complete).to.equal(0);
        expect(small(["half-button"]).move("button").getPlayerScore(1)).to.equal(0.5);
        expect(sixteen().validateMove("button").valid).to.be.false;
    });

    it("ends when both players pass their whole moves in turn", () => {
        const g = play(small(), ["pass", "pass,pass"]);
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1, 2]);
        expect(g.results.find((r) => r.type === "eog")!.reason).to.equal("consecutive-passes");
        // A move that passes one of its placements counts as a pass, so the opponent's whole-move
        // pass then ends the game; the pass that ends it must itself pass the whole move.
        const partial = play(small(), ["f6", "pass,e5"]);
        expect(partial.gameover).to.be.false;
        partial.move("pass");
        expect(partial.gameover).to.be.true;
        const half = play(small(), ["f6", "e5,g7", "d4", "c3", "pass,pass", "b2,pass"]);
        expect(half.gameover).to.be.false;
        half.move("pass,pass");
        expect(half.gameover).to.be.true;
        // A move that passes nothing breaks the run of passes.
        const reset = play(small(), ["f6", "pass,pass", "e5", "pass"]);
        expect(reset.gameover).to.be.false;
        reset.move("pass,pass");
        expect(reset.gameover).to.be.true;

        const h = play(small(), ["button", "pass,pass"]);
        expect(h.gameover).to.be.false;
        h.move("pass");
        expect(h.gameover).to.be.true;
        expect(h.winner).to.deep.equal([1]);
    });

    it("lists complete legal moves and plays random ones", () => {
        const g = small();
        expect(g.moves()).to.have.lengthOf(123);
        expect(sixteen().moves()).to.have.lengthOf(257);
        g.move("f6");
        const moves = g.moves();
        expect(moves).to.include("e5,g7");
        expect(moves).to.include("pass,pass");
        expect(moves).to.include("button,e5");
        expect(moves).to.not.include("f6,e5");
        for (let i = 0; i < 6; i++) {
            g.move(g.randomMove());
        }
        expect(g.gameover).to.be.false;
        expect(g.stack).to.have.lengthOf(8);
    });

    it("applies partial moves without saving them", () => {
        const g = play(small(), ["f6"]);
        g.move("e5", { partial: true });
        expect(g.board.get("e5")).to.equal(2);
        expect(g.placed).to.equal(2);
        expect(g.stack).to.have.lengthOf(2);
        expect(g.render().areas).to.have.lengthOf(1);
    });

    it("survives a round trip through serialization", () => {
        const g = play(small(), ["f6", "e5,g7", "button"]);
        const h = new ThueMorseGoGame(g.serialize());
        expect(h.placed).to.equal(4);
        expect(h.button).to.equal(1);
        expect(h.validateMove("d4").complete).to.equal(1);
    });
});

describe("Thue-Morse Go: handicap", () => {
    it("offers the button after a one-stone handicap only when there is one to take", () => {
        // 16x16 has no button.
        const even = play(sixteen(["handicap"]), ["h8"]);
        const plain = even.validateMove("1s");
        expect(plain.complete).to.equal(0);
        expect(plain.message).to.contain("Handicap of one stone");
        expect(plain.message).to.not.contain("button");
        // 11x11 has one while nobody holds it.
        expect(play(small(["handicap"]), ["f6"]).validateMove("1s").message).to.contain("take the button");
        expect(play(small(["handicap"]), ["button"]).validateMove("1s").message).to.not.contain("button");
        // The same holds when the declaration follows a reverse komi, which then decides the button:
        // 256 points and a komi of 14 add up to an even number, with a komi of 7 to an odd one.
        expect(play(sixteen(["handicap", "reverse-komi"]), ["h8"]).validateMove("14p,1s").message).to.not.contain("button");
        expect(play(sixteen(["handicap", "reverse-komi"]), ["h8"]).validateMove("7p,1s").message).to.contain("take the button");
    });

    it("serves the declared passes, the declaration first", () => {
        const g = small(["handicap"]);
        g.move("f6");
        expect(g.validateMove("e5").valid).to.be.false;
        expect(g.getButtons()).to.deep.equal([]);
        expect(g.validateMove("3").complete).to.equal(0);
        expect(g.validateMove("3,e5").valid).to.be.false;
        g.move("3");
        expect(g.handicap).to.equal(3);
        expect(g.passesOwed).to.equal(1);
        expect(g.placed).to.equal(3);
        expect(g.currplayer).to.equal(1);
        expect(g.lastmove).to.equal("3s");
        expect(g.results.map((r) => r.type)).to.deep.equal(["declare", "pass"]);
        // Player 2's next move is a single placement, so it is served automatically.
        g.move("e5");
        expect(g.stack).to.have.lengthOf(5);
        expect(g.currplayer).to.equal(1);
        expect(g.placed).to.equal(5);
        expect(g.passesOwed).to.equal(0);
        const served = g.stack[4];
        expect(served.lastmove).to.equal("pass");
        expect(served.currplayer).to.equal(1);
        expect(served._results).to.deep.equal([{ type: "pass", why: "handicap" }]);
    });

    it("lets a handicap of one place the second stone of the move", () => {
        const g = play(small(["handicap"]), ["f6"]);
        expect(g.validateMove("1").complete).to.equal(0);
        expect(g.validateMove("1,e5").complete).to.equal(1);
        g.move("1,e5");
        expect(g.board.get("e5")).to.equal(2);
        expect(g.passesOwed).to.equal(0);
        expect(g.placed).to.equal(3);
        expect(play(small(["handicap"]), ["f6", "1"]).lastmove).to.equal("1s,pass");
        expect(play(small(["handicap"]), ["f6", "1s,e5"]).board.get("e5")).to.equal(2);
    });

    it("can run out partway through a two-placement move", () => {
        const g = play(sixteen(["handicap"]), ["f6", "4", "e5"]);
        expect(g.passesOwed).to.equal(1);
        expect(g.currplayer).to.equal(1);
        g.move("d4,d5");
        expect(g.placed).to.equal(7);
        expect(g.currplayer).to.equal(2);
        expect(g.validateMove("c3,d3").valid).to.be.false;
        expect(g.validateMove("c3").complete).to.equal(1);
        g.move("c3");
        expect(g.lastmove).to.equal("c3");
        expect(g.placed).to.equal(9);
        expect(g.passesOwed).to.equal(0);
        expect(g.results.map((r) => r.type)).to.deep.equal(["pass", "place"]);
    });

    it("keeps marking the last placement across an automatically served move", () => {
        const g = play(small(["handicap"]), ["f6", "3", "e5"]);
        expect(g.results).to.deep.equal([{ type: "pass", why: "handicap" }]);
        const [x, y] = g.algebraic2coords("e5");
        expect(g.render().annotations).to.deep.include({ type: "enter", targets: [{ row: y, col: x }] });
    });

    it("does not count served passes towards the end of the game", () => {
        const g = play(small(["handicap"]), ["f6", "3", "pass", "pass,pass"]);
        expect(g.gameover).to.be.false;
        expect(g.currplayer).to.equal(2);
        g.move("pass");
        expect(g.gameover).to.be.true;
    });

    it("offers a twenty-fifth of the board's points, rounded, in the upper block, covered cells still answering to clicks", () => {
        // 11x11 offers round(121 / 25) = 5, half of what Kill-All offers, in a block that starts with
        // its first stone on the diagonal from the top left corner, as the pickers of Kill-All Go do.
        // Player 1's stone at d9 covers the stone for 2, which shows as the stone but still means 2.
        const g = play(small(["handicap"]), ["d9"]);
        expect(picture(g)).to.deep.equal([
            ...blank(2, 11),
            "  .  .  1  .  3  4  5  .  .  .  .",
            ...blank(8, 11),
        ]);
        // The handicap's stones take the first colour.
        expect((layers(g, "n1")[0] as { paint: unknown }).paint).to.deep.equal(stonePaint(1));
        expect(click(g, "", "c9").move).to.equal("1s");
        expect(click(g, "", "d9").move).to.equal("2s");
        expect(click(g, "", "g9").move).to.equal("5s");
        expect(click(g, "3", "c9").move).to.equal("1s");
        expect(click(g, "1", "e5").move).to.equal("1s,e5");
        // Any value from 1 to the largest stone may be typed, and nothing beyond.
        expect(g.validateMove("1").complete).to.equal(0);
        expect(g.validateMove("5").complete).to.equal(0);
        expect(g.validateMove("0").valid).to.be.false;
        expect(g.validateMove("6").valid).to.be.false;
        // Off the numbered stones the click explains itself; with no placement left it does too.
        const early = click(g, "", "e5");
        expect(early.valid).to.be.false;
        expect(early.message).to.contain("Choose the handicap first");
        expect(click(g, "3", "e5").message).to.contain("no placement left");
        // Larger boards offer 10, 14 and 21, in blocks that snake down and turn at their ends.
        for (const [variants, max] of [[[], 10], [["size-19"], 14], [["size-23"], 21]] as Array<[string[], number]>) {
            const big = play(new ThueMorseGoGame(undefined, [...variants, "handicap"]), ["a1"]);
            expect(offered(big), `${max}`).to.deep.equal(Array.from({ length: max }, (_, i) => i + 1));
            expect(big.validateMove(`${max}`).valid, `${max}`).to.be.true;
            expect(big.validateMove(`${max + 1}`).valid, `${max + 1}`).to.be.false;
        }
        expect(picture(play(new ThueMorseGoGame(undefined, ["size-23", "handicap"]), ["a1"]))).to.deep.equal([
            ...blank(5, 23),
            "  .  .  .  .  .  1  2  3  4  5  6  7  8  9 10 11 12 13  .  .  .  .  .",
            "  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 14  .  .  .  .  .",
            "  .  .  .  .  .  .  .  .  .  .  . 21 20 19 18 17 16 15  .  .  .  .  .",
            ...blank(15, 23),
        ]);
    });

    it("offers Kill-All handicaps up to the points divided by 12.5, rounded to the nearest even number, as Kill-All Go does", () => {
        // Twice the standard limit, in one block, half the board wide rounded up to an odd number,
        // whose first stone lies on the diagonal from the top left corner, running across and then
        // snaking down: 10 on 11x11, in the Attacker's colour, as they stand for extra Attacker stones:
        // palette slot 3 when a palette for this game sets it, the first colour otherwise.
        const k = small(["kill-all", "handicap"]);
        expect((layers(k, "n1")[0] as { paint: unknown }).paint).to.deep.equal(rolePaint(3));
        expect(picture(k)).to.deep.equal([
            ...blank(2, 11),
            "  .  .  1  2  3  4  5  6  7  .  .",
            "  .  .  .  .  .  .  .  .  8  .  .",
            "  .  .  .  .  .  .  . 10  9  .  .",
            ...blank(6, 11),
        ]);
        expect(k.algebraic2coords("c9")).to.deep.equal([2, 2]);
        const [ox, oy] = k.algebraic2coords("c9");
        expect(k.handleClick("", oy, ox).move).to.equal("1");
        const [ex, ey] = k.algebraic2coords("h7");
        expect(k.handleClick("", ey, ex).move).to.equal("10");
        expect(k.validateMove("1").valid).to.be.true;
        expect(k.validateMove("10").valid).to.be.true;
        expect(k.validateMove("0").valid).to.be.false;
        expect(k.validateMove("11").valid).to.be.false;
        // Larger boards offer 20, 28 and 42, the same as Kill-All Go.
        expect(picture(sixteen(["kill-all", "handicap"]))).to.deep.equal([
            ...blank(4, 16),
            "  .  .  .  .  1  2  3  4  5  6  7  8  9  .  .  .",
            "  .  .  .  .  .  .  .  .  .  .  .  . 10  .  .  .",
            "  .  .  .  . 19 18 17 16 15 14 13 12 11  .  .  .",
            "  .  .  .  . 20  .  .  .  .  .  .  .  .  .  .  .",
            ...blank(8, 16),
        ]);
        expect(picture(new ThueMorseGoGame(undefined, ["size-19", "kill-all", "handicap"]))).to.deep.equal([
            ...blank(4, 19),
            "  .  .  .  .  1  2  3  4  5  6  7  8  9 10 11  .  .  .  .",
            "  .  .  .  .  .  .  .  .  .  .  .  .  .  . 12  .  .  .  .",
            "  .  .  .  . 23 22 21 20 19 18 17 16 15 14 13  .  .  .  .",
            "  .  .  .  . 24  .  .  .  .  .  .  .  .  .  .  .  .  .  .",
            "  .  .  .  . 25 26 27 28  .  .  .  .  .  .  .  .  .  .  .",
            ...blank(10, 19),
        ]);
        expect(picture(new ThueMorseGoGame(undefined, ["size-23", "kill-all", "handicap"]))).to.deep.equal([
            ...blank(5, 23),
            "  .  .  .  .  .  1  2  3  4  5  6  7  8  9 10 11 12 13  .  .  .  .  .",
            "  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 14  .  .  .  .  .",
            "  .  .  .  .  . 27 26 25 24 23 22 21 20 19 18 17 16 15  .  .  .  .  .",
            "  .  .  .  .  . 28  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .",
            "  .  .  .  .  . 29 30 31 32 33 34 35 36 37 38 39 40 41  .  .  .  .  .",
            "  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . 42  .  .  .  .  .",
            ...blank(12, 23),
        ]);
        expect(new ThueMorseGoGame(undefined, ["size-23", "kill-all", "handicap"]).validateMove("42").valid).to.be.true;
        expect(new ThueMorseGoGame(undefined, ["size-23", "kill-all", "handicap"]).validateMove("43").valid).to.be.false;
    });
});

describe("Thue-Morse Go: the order of a move's placements", () => {
    it("records the stones as entered by default, when the position after the first counts, and the passes last", () => {
        expect(play(small(), ["f6", "g7,e5"]).lastmove).to.equal("g7,e5");
        expect(play(small(), ["f6", "pass,e5"]).lastmove).to.equal("e5,pass");
        expect(play(small(), ["f6", "pass,e5"]).results.map((r) => r.type)).to.deep.equal(["place", "pass"]);
        expect(play(small(), ["f6", "pass,button"]).lastmove).to.equal("button,pass");
        expect(play(small(), ["f6", "button,e5"]).lastmove).to.equal("button,e5");
        const g = play(small(), ["f6"]);
        expect(click(g, "g7", "e5").move).to.equal("g7,e5");
        expect(click(g, "pass", "e5").move).to.equal("e5,pass");
        // With both placements made, a click on a third point replaces the stone placed first.
        expect(click(g, "g7,e5", "c3").move).to.equal("e5,c3");
        expect(click(g, "e5,c3", "g7").move).to.equal("c3,g7");
        // The two orders leave different positions behind, so they are different moves.
        const played = play(small(["superko"]), ["f6", "g7,e5"]);
        expect(played.sameMove("g7,e5", "e5,g7")).to.be.false;
        expect(played.sameMove("g7,e5", "g7, E5")).to.be.true;
        // With the ko rule, a capture by the first stone can be a repetition the other order is not.
        const ko = small(["superko"]);
        setStones(ko, ["a2", "b1", "b3"], ["b2", "c1", "c3", "d2"]);
        ko.move("c2");
        expect(ko.validateMove("b2,k11").valid).to.be.false;
        expect(ko.validateMove("k11,b2").valid).to.be.true;
    });

    it("sorts the stones by column and then row under checked weak eyes, the button and the passes after them", () => {
        const weak = (): ThueMorseGoGame => play(small(["weak-eyes"]), ["f6"]);
        expect(weak().move("g7,e5").lastmove).to.equal("e5,g7");
        expect(weak().move("g7,e5").results.map((r) => `${r.type}:${r.where}`)).to.deep.equal(["place:e5", "place:g7"]);
        expect(weak().move("k10,a11").lastmove).to.equal("a11,k10");
        expect(weak().move("a10,a2").lastmove).to.equal("a2,a10");
        expect(weak().move("button,e5").lastmove).to.equal("e5,button");
        expect(weak().move("pass,e5").lastmove).to.equal("e5,pass");
        // Clicks keep their own order until the move is made, so a click on a third point replaces
        // the stone placed first, as it does without weak eyes; the move is recorded sorted.
        const g = weak();
        expect(click(g, "g7", "e5").move).to.equal("g7,e5");
        expect(click(g, "g7,e5", "c3").move).to.equal("e5,c3");
        expect(click(g, "g7,e5", "g7").move).to.equal("e5");
        expect(click(g, "button", "e5").move).to.equal("button,e5");
        expect(g.clone().move("g7,e5").lastmove).to.equal("e5,g7");
        expect(g.clone().move("button,e5").lastmove).to.equal("e5,button");
        // Either order is the same move, so an explored or premoved line matches the move played.
        expect(g.sameMove("g7,e5", "e5,g7")).to.be.true;
        expect(g.sameMove("button,e5", "e5,button")).to.be.true;
        expect(g.sameMove("pass,e5", "e5,pass")).to.be.true;
        expect(weak().move("g7,e5").sameMove("g7,e5", "g7,e6")).to.be.false;
        // The move list names each move once.
        const moves = g.moves();
        expect(moves).to.include("e5,g7");
        expect(moves).to.not.include("g7,e5");
        expect(new Set(moves).size).to.equal(moves.length);
        expect(withRandom(0, () => g.randomMove())).to.equal("a11,button");
        expect(withRandom(0.5, () => g.randomMove())).to.equal("pass,pass");
        // Nothing happens between the placements, so the order changes nothing: every pair of
        // points tried in both orders is as legal, and leaves the same board, either way.
        const busy = small(["weak-eyes", "superko"]);
        busy.move("f3");
        setStones(busy, ["b2", "c2", "d2", "b3", "d3", "c4", "f6", "g6", "f7", "h7", "g8"], ["a2", "a3", "b4", "d4", "c5", "e6", "e7", "f8", "h8", "g9", "h6"]);
        const points = ["a1", "b1", "c1", "c3", "e2", "e3", "d5", "e5", "f5", "g7", "f9", "k11"];
        for (const a of points) {
            for (const b of points) {
                if (a === b) { continue; }
                const forward = busy.validateMove(`${a},${b}`);
                const backward = busy.validateMove(`${b},${a}`);
                expect(backward.valid, `${a},${b}`).to.equal(forward.valid);
                if (forward.valid) {
                    const left = busy.clone().move(`${a},${b}`);
                    const right = busy.clone().move(`${b},${a}`);
                    expect([...right.board.entries()].sort(), `${a},${b}`).to.deep.equal([...left.board.entries()].sort());
                    expect(right.lastmove, `${a},${b}`).to.equal(left.lastmove);
                }
            }
        }
    });

    it("records the marked strings in board order, however they were named", () => {
        // Player 2's string k10-k11 is named by its first stone in board order, k11, and listed before a1.
        const g = play(small(), ["a1", "k10,k11", "j1"]);
        expect(g.validateMove("pass,-a1,-k10").valid).to.be.true;
        expect(g.clone().move("pass,-a1,-k10").lastmove).to.equal("pass,-k11,-a1");
        expect(g.clone().move("pass,-k10,-a1").lastmove).to.equal("pass,-k11,-a1");
        expect(g.sameMove("pass,-a1,-k10", "pass,-k10,-a1")).to.be.true;
        // A string named by another of its stones is the same marking too, by the position it leaves.
        const h = g.clone().move("pass,-k11,-a1");
        expect(h.sameMove("pass,-k11,-a1", "pass,-k10,-a1")).to.be.true;
        expect(h.sameMove("pass,-k11,-a1", "pass,-a1")).to.be.false;
    });
});

describe("Thue-Morse Go: ko", () => {
    it("forbids retaking a ko at once but allows it after a threat", () => {
        const g = small(["superko"]);
        setStones(g, ["a2", "b1", "b3"], ["b2", "c1", "c3", "d2"]);
        g.move("c2");
        expect(g.board.has("b2")).to.be.false;
        // Every placement is judged as it is made, so the retake has to follow the threat.
        const retake = g.validateMove("b2");
        expect(retake.valid).to.be.false;
        expect(retake.message).to.contain("earlier position");
        expect(retake.message).to.not.contain("suicide");
        expect(g.validateMove("b2,k11").valid).to.be.false;
        expect(g.validateMove("k11,b2").complete).to.equal(1);
        g.move("k11,b2");
        expect(g.board.has("c2")).to.be.false;
    });

    it("forbids only the fourth occurrence of a position under double delayed superko", () => {
        const g = small(["double-delayed-psk"]);
        expect(g.allvariants()!.find((v) => v.uid === "double-delayed-psk")!.group).to.equal("repetition");
        setStones(g, ["a2", "b1", "b3"], ["b2", "c1", "c3", "d2"]);
        // The ko can be retaken at once, twice over; the retake that would recreate the position a fourth time cannot.
        play(g, ["c2", "b2", "c2", "b2", "c2,pass"]);
        expect(g.board.has("c2")).to.be.true;
        expect(g.board.has("b2")).to.be.false;
        const fourth = g.validateMove("b2");
        expect(fourth.valid).to.be.false;
        expect(fourth.message).to.contain("fourth time");
        expect(fourth.message).to.not.contain("suicide");
        // A threat first makes a new position, as under superko.
        expect(g.validateMove("k11,b2").complete).to.equal(1);
        // The same holds for a single stone removed as suicide, which never draws the game under this rule.
        const h = small(["double-delayed-psk"]);
        setStones(h, [], ["a2", "b1", "k11"]);
        play(h, ["a1", "pass,pass", "a1", "pass"]);
        expect(h.gameover).to.be.false;
        const again = h.validateMove("a1");
        expect(again.valid).to.be.false;
        expect(again.message).to.contain("three times");
        expect(again.message).to.contain("suicide");
    });

    it("draws the game on the fifth repetition by default", () => {
        const g = small();
        // The repetition draw is the group's sentinel, so a game with no variant named has it; superko is the variant.
        expect(g.allvariants()!.find((v) => v.uid === "superko")!.group).to.equal("repetition");
        expect(g.allvariants()!.find((v) => v.uid === "#repetition")!.default).to.be.undefined;
        setStones(g, [], ["a2", "b1", "k11"]);
        expect(g.validateMove("a1").valid).to.be.true;
        // Every placement counts, so the second stone of one move can be the fifth occurrence.
        play(g, ["a1", "pass,pass", "a1", "pass"]);
        expect(g.gameover).to.be.false;
        g.move("a1,a1");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1, 2]);
        expect(g.results.find((r) => r.type === "eog")!.reason).to.equal("repetition");
    });
});

describe("Thue-Morse Go: Kill-All", () => {
    it("requires no button and swaps the flags", () => {
        const g = new ThueMorseGoGame(undefined, ["size-11", "kill-all"]);
        expect(g.variants).to.deep.equal(["size-11", "kill-all"]);
        play(g, ["f6", "attacker"]);
        expect(g.validateMove("button").valid).to.be.false;
        // Kill-All and the half-point button exclude each other; the later choice wins.
        const h = new ThueMorseGoGame(undefined, ["size-11", "kill-all", "half-button"]);
        expect(h.variants).to.deep.equal(["size-11", "half-button"]);
        const k = new ThueMorseGoGame(undefined, ["size-11", "half-button", "kill-all"]);
        expect(k.variants).to.deep.equal(["size-11", "kill-all"]);
        expect(play(k, ["f6", "attacker"]).getButtons().some((b) => b.move === "button")).to.be.false;
        expect(g.getFlags()).to.include("custom-colours");
        expect(g.getFlags()).to.not.include("scores");
        expect(small().getFlags()).to.include("scores");
    });

    it("decides the sides by pieboxing", () => {
        const g = small(["kill-all"]);
        expect(g.phase).to.equal("alt-place");
        g.move("f6");
        expect(g.board.get("f6")).to.equal(2);
        expect(g.currplayer).to.equal(2);
        g.move("attacker");
        expect(g.defenderSeat).to.equal(1);
        expect(g.phase).to.equal("play");
        expect(g.currplayer).to.equal(1);
        expect(g.placed).to.equal(0);
        // The Defender draws from slot 4 and the Attacker from slot 3, falling back to the second and first colours.
        expect(g.getPlayerColour(1)).to.deep.equal(role(4));
        expect(g.getPlayerColour(2)).to.deep.equal(role(3));
        g.move("e5");
        expect(g.board.get("e5")).to.equal(1);
        expect(g.validateMove("pass").valid).to.be.false;
        expect(g.validateMove("button").valid).to.be.false;
        expect(g.validateMove("e4").complete).to.equal(-1);
        g.move("e4,e6");
        expect(g.board.get("e4")).to.equal(2);
        expect(g.sidebarScores()).to.deep.equal([]);
    });

    it("ends when the Defender is unconditionally alive", () => {
        const { own, wall } = twoEyedCorner();
        const g = play(small(["kill-all"]), ["f6", "attacker"]);
        setStones(g, own, [...wall, "f6"]);
        // Before the end, pass-alive stones are faded only under the display option.
        expect(faded(g)).to.deep.equal([]);
        expect(faded(g, THROUGHOUT)).to.deep.equal([...own].sort());
        g.move("k11");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1]);
        expect(g.results.find((r) => r.type === "eog")!.reason).to.equal("pass-alive");
        expect(g.alive!.sort()).to.deep.equal([...own].sort());
        // The position that ended the game fades them, instead of boxing them; the last stone is still boxed.
        expect(faded(g)).to.deep.equal([...own].sort());
        const rep = g.render();
        const enters = rep.annotations!.filter((a) => a.type === "enter") as Array<{ targets: RowCol[] }>;
        expect(enters.map((a) => a.targets.length)).to.deep.equal([1]);
        expect(layers(g, "L1")[0]).to.deep.include({ opacity: 0.75 });
        expect((layers(g, "L1")[0] as { paint: { fill: unknown } }).paint.fill).to.deep.equal(role(4));
        // Earlier positions of the finished game are marked only on request.
        g.load(g.stack.length - 2);
        expect(faded(g)).to.deep.equal([]);
        expect(faded(g, THROUGHOUT)).to.deep.equal([...own].sort());
        // Outside Kill-All the display does nothing, and dead stones keep their own fade.
        const plain = small();
        setStones(plain, ["f6"], []);
        plain.move("pass,-f6");
        expect(faded(plain, THROUGHOUT)).to.deep.equal(["f6"]);
        expect(plain.render(THROUGHOUT).legend).to.not.have.property("L1");
    });

    it("needs three eyes under checked weak eyes", () => {
        const { own, wall } = twoEyedCorner();
        const g = play(small(["kill-all", "weak-eyes"]), ["f6", "attacker"]);
        setStones(g, own, [...wall, "f6"]);
        g.move("k11");
        expect(g.gameover).to.be.false;
        // Two eyes are not pass-alive here, so nothing fades even on request.
        expect(faded(g, THROUGHOUT)).to.deep.equal([]);

        const h = play(small(["kill-all", "weak-eyes"]), ["f6", "attacker"]);
        const three = [...own, "e2", "f1", "f2"];
        setStones(h, three, ["a3", "b3", "c3", "d3", "e3", "f3", "g1", "g2", "g3", "f6"]);
        expect(faded(h, THROUGHOUT)).to.deep.equal([...three].sort());
        h.move("k11");
        expect(h.gameover).to.be.true;
        expect(h.winner).to.deep.equal([1]);
        expect(faded(h)).to.deep.equal([...three].sort());
    });

    it("fades the Attacker's pass-alive stones too, and at any end of the game", () => {
        // The Attacker's own two-eyed corner is pass-alive as well.
        const { own, wall } = twoEyedCorner();
        const g = play(small(["kill-all"]), ["f6", "attacker"]);
        setStones(g, [], [...own, "f6"]);
        expect(faded(g, THROUGHOUT)).to.deep.equal([...own].sort());
        expect(g.render(THROUGHOUT).legend).to.have.property("L2");
        expect(g.render(THROUGHOUT).legend).to.not.have.property("L1");
        void wall;
        // A state pasted with indentation around it still loads.
        const again = new ThueMorseGoGame(`  \n  ${g.serialize()}\n`);
        expect(again.render(THROUGHOUT).pieces).to.deep.equal(g.render(THROUGHOUT).pieces);
    });

    it("places the handicap stones when Player 2 takes the Attacker side", () => {
        const g = small(["kill-all", "handicap"]);
        expect(g.phase).to.equal("hand-n");
        expect(g.validateMove("3").complete).to.equal(0);
        g.move("3");
        expect(g.phase).to.equal("alt-place");
        expect(g.currplayer).to.equal(2);
        expect(g.validateMove("attacker").complete).to.equal(-1);
        expect(() => g.move("attacker")).to.throw();
        g.move("attacker:a1,b1,c1");
        expect(g.defenderSeat).to.equal(1);
        expect(g.board.get("c1")).to.equal(2);
        expect(g.phase).to.equal("play");
        expect(g.currplayer).to.equal(1);
    });

    it("draws the Attacker in the first colour and the Defender in the second unless slots 3 and 4 are set, chips included", () => {
        const g = play(small(["kill-all"]), ["f6"]);
        // Undecided roles: neutral chips, Attacker stones already in the Attacker's fill.
        expect(g.getPlayerColour(1)).to.equal("#999999");
        expect((layers(g, "B")[0] as { paint: { fill: unknown } }).paint.fill).to.deep.equal(role(3));
        g.move("attacker");
        // Player 2 is the Attacker and Player 1 the Defender, on the board, tracker and chips alike.
        expect(g.getPlayerColour(2)).to.deep.equal(role(3));
        expect(g.getPlayerColour(1)).to.deep.equal(role(4));
        expect((layers(g, "A")[0] as { paint: { fill: unknown } }).paint.fill).to.deep.equal(role(4));
        expect((layers(g, "B")[0] as { paint: { fill: unknown } }).paint.fill).to.deep.equal(role(3));
        expect((layers(g, "s1")[1] as { paint: { fill: unknown } }).paint.fill).to.deep.equal(role(4));
        // The tracker's tint and border follow the next placement's role too.
        const track = g.render().areas![0] as AreaTrack;
        expect((track.board.markers as MarkerLine[])[0].colour).to.deep.equal(role(4));
        const slots = ThueMorseGoGame.gameinfo.customizations!.map((c) => ("num" in c ? [c.num, c.default] : []));
        expect(slots).to.deep.equal([[1, 1], [2, 2], [3, 1], [4, 2]]);
        // Every stone's border is black or white, whichever contrasts better with its fill.
        expect((layers(g, "A")[0] as { paint: unknown }).paint).to.deep.equal(rolePaint(4));
        expect((layers(g, "B")[0] as { paint: unknown }).paint).to.deep.equal(rolePaint(3));
        // Standard games keep the seats' own slots, and there is no swap display any more.
        const h = play(small(), ["f6"]);
        expect(h.getPlayerColour(1)).to.equal(1);
        expect((layers(h, "B")[0] as { paint: { fill: number } }).paint.fill).to.equal(2);
        expect(ThueMorseGoGame.gameinfo.displays!.map((d) => d.uid)).to.deep.equal(["tms-tracker", "digits-down", "hide-territory", "pass-alive-throughout"]);
    });
});

describe("Thue-Morse Go: tracker and sidebar", () => {
    it("draws the tracker of the mockup for placement 0x123 under the digit display", () => {
        const g = small();
        g.placed = 0x123;
        const digits = { altDisplays: ["tms-tracker"] };
        const track = g.render(digits).areas![0] as AreaTrack;
        expect(track.type).to.equal("track");
        expect(track.position).to.equal("left");
        expect(track.board.width).to.equal(7);
        expect(track.board.height).to.equal(18);
        expect(track.board.blocked).to.have.lengthOf(7 * 18 - 48);
        expect(track.pieces).to.equal(TRACK_0X123);
        const [tint, marker, digit] = layers(g, "m1d2", digits);
        expect(tint).to.deep.equal({ name: "piece-square", paint: { fill: 1 }, opacity: 0.2 });
        expect(marker).to.deep.equal({ name: "piece", paint: stonePaint(1) });
        expect(digit).to.deep.equal({ text: "2", scale: 0.75, rotate: null });
        expect(layers(g, "m2d1", digits)[2]).to.deep.equal({ text: "1", scale: 0.75, rotate: null });
        const [, smallGlyph] = layers(g, "s2", digits);
        expect(smallGlyph).to.deep.equal({ name: "piece", paint: stonePaint(2), scale: 0.57735 });
        expect(layers(g, "s2", digits)).to.have.lengthOf(2);
        // A thick border in the colour of the next placement runs around the columns, inside the frame.
        const border = track.board.markers as MarkerLine[];
        expect(border).to.have.lengthOf(4);
        expect(border[0]).to.deep.equal({ type: "line", points: [{ row: 1, col: 1 }, { row: 1, col: 6 }], colour: 1, width: 8 });
        expect(border[2]).to.deep.equal({ type: "line", points: [{ row: 17, col: 6 }, { row: 17, col: 1 }], colour: 1, width: 8 });
        g.placed = 0x124;
        const next = (g.render(digits).areas![0] as AreaTrack).board.markers as MarkerLine[];
        expect(next.every((line) => line.colour === 2)).to.be.true;
    });

    it("tints the tracker with the colour of the next placement", () => {
        const g = play(small(), ["f6"]);
        expect(layers(g, "s1")[0]).to.deep.equal({ name: "piece-square", paint: { fill: 2 }, opacity: 0.2 });
    });

    it("can run the digits downward, and goes grey past placement fff", () => {
        const g = small();
        g.placed = 0x123;
        const track = g.render({ altDisplays: ["tms-tracker", "digits-down"] }).areas![0] as AreaTrack;
        expect(track.pieces).to.equal(TRACK_0X123.split("\n").reverse().join("\n"));
        // The last index the three columns can show still has markers and a border.
        g.placed = 0xfff;
        const last = g.render({ altDisplays: ["tms-tracker"] }).areas![0] as AreaTrack;
        expect(last.board.width).to.equal(7);
        expect(last.board.markers).to.have.lengthOf(4);
        expect(last.pieces).to.contain("m1df");
        // Past it the tracker keeps its shape but shows only grey stones: no markers, tint or border.
        g.placed = 0x1000;
        const grey = g.render({ altDisplays: ["tms-tracker"] }).areas![0] as AreaTrack;
        expect(grey.board.width).to.equal(7);
        expect(grey.board.markers).to.be.undefined;
        expect(grey.pieces!.split("\n").slice(1, -1)).to.deep.equal(Array<string>(16).fill("-,s0,-,s0,-,s0,-"));
        expect(layers(g, "s0", { altDisplays: ["tms-tracker"] })).to.deep.equal([
            { name: "piece-square", paint: { fill: "#999999" }, opacity: 0.2 },
            { name: "piece", paint: { fill: "#999999" }, scale: 0.57735 },
        ]);
        // The rolling tracker has no such limit.
        expect((g.render().areas![0] as AreaTrack).board.markers).to.have.lengthOf(4);
        expect((g.render().areas![0] as AreaTrack).pieces).to.contain("-,m2,-");
    });

    it("rolls a single column of the next 16 placements by default", () => {
        const g = small();
        const expected = (from: number, length: number, downward: boolean): string => {
            const rows: string[] = ["-,-,-"];
            for (let row = 0; row < 16; row++) {
                const i = downward ? row : 15 - row;
                const colour = g.colourAt(from + i);
                rows.push(`-,${i < length ? `m${colour}` : `s${colour}`},-`);
            }
            rows.push("-,-,-");
            return rows.join("\n");
        };
        let track = g.render().areas![0] as AreaTrack;
        expect(track.board.width).to.equal(3);
        expect(track.board.height).to.equal(18);
        expect(track.board.blocked).to.have.lengthOf(3 * 18 - 16);
        expect(track.pieces).to.equal(expected(0, 1, false));
        g.move("f6");
        // Player 2's move is two placements, both full-size stones with no digit on them.
        track = g.render().areas![0] as AreaTrack;
        expect(track.pieces).to.equal(expected(1, 2, false));
        expect(track.pieces.split("\n")[16]).to.equal("-,m2,-");
        expect(track.pieces.split("\n")[15]).to.equal("-,m2,-");
        const legend = g.render().legend as Record<string, Glyph[]>;
        expect(legend.m2).to.deep.equal([
            { name: "piece-square", paint: { fill: 2 }, opacity: 0.2 },
            { name: "piece", paint: stonePaint(2) },
        ]);
        expect(Object.keys(legend).filter((key) => /^m[12]d/.test(key))).to.deep.equal([]);
        track = g.render({ altDisplays: ["digits-down"] }).areas![0] as AreaTrack;
        expect(track.pieces).to.equal(expected(1, 2, true));
    });

    it("shows no tracker under Balanced Marseillais", () => {
        expect(small(["marseillais"]).render().areas).to.be.undefined;
        expect(small().render().areas).to.have.lengthOf(1);
    });

    it("reports the placements of the next move in hexadecimal without a prefix", () => {
        // The 16x16 board has no button, so the status panel has just this row.
        const g = sixteen();
        expect(g.sidebarStatuses()[0].value).to.deep.equal(["0"]);
        expect(JSON.stringify(g.sidebarStatuses()[0].key)).to.contain("NEXT_PLACEMENT");
        // A two-placement move lists both of its placements.
        play(g, ["f6"]);
        expect(g.sidebarStatuses()[0].value).to.deep.equal(["1, 2"]);
        play(g, ["e5,g7"]);
        expect(g.sidebarStatuses()[0].value).to.deep.equal(["3"]);
        g.placed = 0x1a;
        expect(g.sidebarStatuses()[0].value).to.deep.equal(["1a"]);
        g.placed = 0x1d;
        expect(g.sidebarStatuses()[0].value).to.deep.equal(["1d, 1e"]);
        // The coming placements are no longer listed; the tracker shows them.
        expect(g.sidebarStatuses()).to.have.lengthOf(1);
    });

    it("uses the snub square board and its connections", () => {
        const g = small(["snub"]);
        expect(g.render().board).to.deep.include({ style: "snubsquare" });
        const neighbours = new SnubSquareGraph(11, 11).neighbours("f6");
        expect(neighbours).to.have.lengthOf(5);
        setStones(g, neighbours.slice(0, -1), ["f6"]);
        g.move(neighbours[neighbours.length - 1]);
        expect(g.board.has("f6")).to.be.false;
        expect(g.results.some((r) => r.type === "capture" && r.count === 1)).to.be.true;
    });
});

describe("Thue-Morse Go: chat log", () => {
    it("matches the legacy chat log", () => {
        const g = small(["handicap"]);
        setStones(g, ["a2"], ["a1"]);
        play(g, ["b1", "2", "button", "pass", "pass,pass"]);
        expect(g.gameover).to.be.true;
        assertChatLogParity(g, ["Alice", "Bob"]);
        const log = g.chatLog(["Alice", "Bob"]).flat().join("\n");
        expect(log).to.contain("Alice placed a piece at b1.");
        expect(log).to.contain("Bob set the handicap to 2 stones.");
        expect(log).to.contain("Bob gave a handicap stone by passing.");
        expect(log).to.contain("Alice took the button.");
    });
});

describe("Thue-Morse Go: territory and dead strings", () => {
    /** A wall giving Player 1 the corner a1-b1, a far stone of theirs, and two Player 2 stones giving them k11. */
    const scene = (variants: string[] = []): ThueMorseGoGame => {
        const g = small(variants);
        setStones(g, ["a2", "b2", "c2", "c1", "f6"], ["j11", "k10"]);
        return g;
    };
    const rc = (g: ThueMorseGoGame, cell: string): { row: number; col: number } => {
        const [col, row] = g.algebraic2coords(cell);
        return { row, col };
    };
    /** The territory dots: the coloured dot markers, as opposed to the star points. */
    const dots = (g: ThueMorseGoGame, opts?: { altDisplays?: string[] }): MarkerDots[] =>
        (((g.render(opts).board as BoardBasic).markers ?? []) as MarkerDots[]).filter((m) => m.colour !== undefined);
    it("dots the empty points that count as territory", () => {
        const g = scene();
        const markers = dots(g);
        expect(markers).to.have.lengthOf(2);
        expect(markers[0]).to.deep.equal({ type: "dots", colour: 1, size: 0.2, points: [rc(g, "a1"), rc(g, "b1")] });
        expect(markers[1]).to.deep.equal({ type: "dots", colour: 2, size: 0.2, points: [rc(g, "k11")] });
        expect(g.getPlayerScore(1)).to.equal(7);
        expect(g.getPlayerScore(2)).to.equal(3);
        // The display option hides them, and Kill-All games never show them.
        expect(dots(g, { altDisplays: ["hide-territory"] })).to.have.lengthOf(0);
        const k = play(small(["kill-all"]), ["f6", "attacker"]);
        setStones(k, ["a2", "b2", "c2", "c1"], ["j11", "k10"]);
        expect(dots(k)).to.have.lengthOf(0);
        // A lone first stone reaches every empty point, so the whole board is dotted, as in Go.
        const first = dots(play(small(), ["f6"]));
        expect(first).to.have.lengthOf(1);
        expect(first[0].colour).to.equal(1);
        expect(first[0].points).to.have.lengthOf(120);
        expect(dots(small())).to.have.lengthOf(0);
    });

    it("keeps a whole-move pass open for marking strings dead", () => {
        const single = scene().validateMove("pass");
        expect(single.complete).to.equal(0);
        expect(single.canrender).to.be.true;
        expect(single.message).to.contain("mark them dead");
        const g = play(scene(), ["f7"]);
        expect(g.validateMove("pass,pass").complete).to.equal(0);
        // A single pass typed in a two-placement move passes the whole move.
        expect(g.validateMove("pass").complete).to.equal(0);
        expect(g.validateMove("pass").message).to.contain("mark them dead");
        // A move that places one stone and passes the other placement stays open too, whether or
        // not the pass is spelled out; strings can be clicked only once the pass is spelled out.
        const half = g.validateMove("e5,pass");
        expect(half.complete).to.equal(0);
        expect(half.message).to.contain("pass the rest of this move");
        expect(half.message).to.contain("does not end the game");
        expect(half.message).to.contain("Click strings to mark them dead");
        const implied = g.validateMove("e5");
        expect(implied.complete).to.equal(0);
        expect(implied.message).to.contain("pass the rest of this move");
        expect(implied.message).to.contain("press Pass first");
        expect(implied.message).to.not.contain("Click strings");
        expect(g.validateMove("e5,g7").complete).to.equal(1);
    });

    it("marks and unmarks strings by clicking them after passing", () => {
        const g = scene();
        expect(click(g, "pass", "b2").move).to.equal("pass,-a2");
        expect(click(g, "pass,-a2", "c1").move).to.equal("pass");
        // Marks are listed in board order, one token per string.
        expect(click(g, "pass,-a2", "k10").move).to.equal("pass,-k10,-a2");
        expect(g.validateMove("pass,-c1,-b2").valid).to.be.true;
        // An empty point placed afterwards drops the marking; a stone clicked without passing is just occupied.
        expect(click(g, "pass,-a2", "e5").move).to.equal("e5");
        const occupied = click(g, "", "a2");
        expect(occupied.valid).to.be.false;
        expect(occupied.message).to.contain("press Pass");
        expect(click(g, "e5", "a2").valid).to.be.false;
        // A two-placement move: the Pass button then a click, or a typed single pass then a click.
        const h = play(scene(), ["f7"]);
        expect(click(h, h.handleClick("", -1, -1, "_btn_pass").move, "j11").move).to.equal("pass,pass,-j11");
        expect(click(h, "pass", "j11").move).to.equal("pass,pass,-j11");
        // A stone placed after passing the move comes first, the pass after it, and the marking stays.
        expect(click(h, "pass,pass", "e5").move).to.equal("e5,pass");
        expect(click(h, "pass,pass,-j11", "e5").move).to.equal("e5,pass,-j11");
        expect(click(h, "e5,pass", "e5").move).to.equal("pass,pass");
        expect(click(h, "e5,pass,-j11", "e5").move).to.equal("pass,pass,-j11");
        expect(click(h, "e5,pass", "g7").move).to.equal("e5,g7");
        expect(click(h, "e5,pass", "g7").complete).to.equal(1);
        // Once the move passes, a click on a string marks it dead, or unmarks it again; without a
        // pass spelled out a stone clicked is just occupied, so a misclick never passes a placement.
        expect(click(h, "e5,pass", "j11").move).to.equal("e5,pass,-j11");
        const misclick = click(h, "e5", "j11");
        expect(misclick.valid).to.be.false;
        expect(misclick.move).to.equal("e5");
        expect(click(h, "e5,pass,-j11", "j11").move).to.equal("e5,pass");
        // Marks alone pass the move too, so strings can be clicked after them.
        expect(click(g, "-a2", "k10").move).to.equal("pass,-k10,-a2");
        expect(click(h, "e5,pass,-j11", "k10").move).to.equal("e5,pass,-j11,-k10");
        expect(click(h, "e5,pass,-j11", "g7").move).to.equal("e5,g7");
        const occupiedAfter = click(h, "e5,g7", "j11");
        expect(occupiedAfter.valid).to.be.false;
        expect(occupiedAfter.message).to.contain("press Pass");
        // Without a pass in the move, clicks behave as before.
        expect(click(h, "", "e5").move).to.equal("e5");
        expect(click(h, "e5", "g7").move).to.equal("e5,g7");
        expect(click(h, "e5,g7", "e5").move).to.equal("g7");
        expect(click(h, "e5,g7", "d4").move).to.equal("g7,d4");
    });

    it("drops a mark on a stone the move's own placement captures", () => {
        // Player 1's a1 has its last liberty at a2; Player 2 captures it while passing the other placement.
        const g = small();
        setStones(g, ["a1", "f6"], ["b1", "k10"]);
        g.move("k11");
        expect(click(g, "pass,pass,-a1,-k10", "a2").move).to.equal("a2,pass,-k10");
        const kept = g.validateMove("a2,pass,-a1,-k10");
        expect(kept.valid).to.be.true;
        expect(kept.message).to.contain("one stone marked dead");
        expect(g.validateMove("a2,pass,-a3").message).to.contain("no stone");
        g.move("a2,pass,-a1,-k10");
        expect(g.board.has("a1")).to.be.false;
        expect(g.lastmove).to.equal("a2,pass,-k10");
        expect(g.marks).to.deep.equal(["k10"]);
        expect(g.results).to.deep.include({ type: "select", what: "dead", how: "marked", where: "k10" });
        // The opponent's whole-move pass keeping the marking ends the game.
        expect(g.getButtons()[0].move).to.equal("pass,-k10");
        g.move("pass,-k10");
        expect(g.gameover).to.be.true;
        expect(g.board.has("k10")).to.be.false;
        // A capture that leaves nothing marked after a marking is a pass that marks nothing dead.
        const h = small();
        setStones(h, ["a1", "f6"], ["b1", "k10"]);
        h.move("pass,-a1");
        expect(click(h, "pass,pass,-a1", "a2").move).to.equal("a2,pass");
        expect(h.validateMove("a2,pass,-a1").message).to.contain("ends dead-stone marking");
        h.move("a2,pass,-a1");
        expect(h.locked).to.be.true;
        expect(h.marks).to.deep.equal([]);
    });

    it("refuses marks in a move that passes nothing", () => {
        const g = scene();
        expect(g.validateMove("f7,-a2").valid).to.be.false;
        // Marks alone pass the move, the pass being implied.
        expect(g.validateMove("-a2").complete).to.equal(0);
        expect(play(scene(), ["-a2"]).lastmove).to.equal("pass,-a2");
        expect(g.validateMove("pass,-a1").message).to.contain("no stone");
        expect(g.validateMove("pass,-zz9").valid).to.be.false;
        const k = play(small(["kill-all"]), ["f6", "attacker"]);
        expect(k.validateMove("pass,-f6").valid).to.be.false;
        // In a two-placement move, one placement suffices, its pass spelled out or not.
        const h = play(scene(), ["f7"]);
        expect(h.validateMove("e5,pass,-a2").valid).to.be.true;
        expect(h.validateMove("e5,-a2").valid).to.be.true;
        expect(h.validateMove("e5,-a2").complete).to.equal(0);
        expect(h.validateMove("e5,g7,-a2").valid).to.be.false;
        expect(h.validateMove("pass,e5,-a2").valid).to.be.true;
        expect(play(scene(), ["f7", "e5,-a2"]).lastmove).to.equal("e5,pass,-a2");
    });

    it("shows marked strings faded, with the territory they would leave", () => {
        const g = scene();
        g.move("pass,-k10,-j11", { partial: true });
        expect(g.marks).to.deep.equal(["j11", "k10"]);
        const rep = g.render();
        const legend = rep.legend as Record<string, Glyph[]>;
        expect(legend.D2T1).to.deep.equal([
            { name: "piece", paint: stonePaint(2), opacity: 0.4 },
            { name: "piece-borderless", paint: { fill: 1 }, scale: 0.2 },
        ]);
        expect((rep.pieces as string).split("\n")[0]).to.contain("D2T1");
        // With Player 2 gone, every empty point is Player 1's, the corner under the dead stones included.
        const markers = dots(g);
        expect(markers).to.have.lengthOf(1);
        expect(markers[0].colour).to.equal(1);
        expect(markers[0].points).to.have.lengthOf(121 - 7);
        expect(g.getPlayerScore(1)).to.equal(121);
        expect(g.getPlayerScore(2)).to.equal(0);
        // A dead wall opens the corner to both colours, so the stones are faded without a dot.
        const h = scene();
        h.move("pass,-a2", { partial: true });
        expect((h.render().legend as Record<string, Glyph[]>).D1).to.deep.equal([{ name: "piece", paint: stonePaint(1), opacity: 0.4 }]);
        expect(dots(h).map((m) => m.colour)).to.deep.equal([2]);
        expect(h.getPlayerScore(1)).to.equal(1);
        // Hiding the territory keeps the marked stones faded, without dots.
        expect(dots(g, { altDisplays: ["hide-territory"] })).to.have.lengthOf(0);
        expect((g.render({ altDisplays: ["hide-territory"] }).legend as Record<string, Glyph[]>).D2).to.have.lengthOf(1);
        // A typo in a mark names nothing when clicking, and is reported when validating.
        expect(click(scene(), "pass,-zz9", "j11").move).to.equal("pass,-j11");
    });

    it("borders every stone black or white, whichever contrasts better with its fill", () => {
        const g = play(scene(), ["pass,-k10"]);
        const paintOf = (legend: Record<string, Glyph[]>, key: string, layer = 0): unknown => (legend[key][layer] as { paint: unknown }).paint;
        // Every stone, faded or in the tracker, is painted that way, and no slot above 2 is named,
        // so a two-colour palette suffices.
        const legend = g.render().legend as Record<string, Glyph[]>;
        expect(paintOf(legend, "A")).to.deep.equal(stonePaint(1));
        expect(paintOf(legend, "B")).to.deep.equal(stonePaint(2));
        const deadKeys = Object.keys(legend).filter((key) => key.startsWith("D2"));
        expect(deadKeys).to.have.lengthOf(1);
        expect(paintOf(legend, deadKeys[0])).to.deep.equal(stonePaint(2));
        expect(paintOf(legend, "s1", 1)).to.deep.equal(stonePaint(1));
        expect(paintOf(legend, "s2", 1)).to.deep.equal(stonePaint(2));
        expect(JSON.stringify(legend)).to.not.match(/"border":[3-9]/);
        expect(ThueMorseGoGame.gameinfo.displays!.map((d) => d.uid)).to.not.include("palette-borders");
    });

    it("ends the game when the opponent passes keeping the marking, removing the marked strings", () => {
        const g = play(scene(), ["pass,-j11,-k10"]);
        expect(g.gameover).to.be.false;
        expect(g.lastmove).to.equal("pass,-j11,-k10");
        expect(g.marks).to.deep.equal(["j11", "k10"]);
        expect(g.sidebarStatuses().some((s) => JSON.stringify(s.key).includes("MARKING"))).to.be.true;
        // The opponent's pass starts from that marking.
        expect(g.getButtons()[0].move).to.equal("pass,pass,-j11,-k10");
        expect(g.moves()).to.include("pass,pass,-j11,-k10");
        expect(g.moves()).to.not.include("pass,pass");
        const accept = g.validateMove("pass,pass,-j11,-k10");
        expect(accept.complete).to.equal(0);
        expect(accept.message).to.contain("end the game");
        g.move("pass,pass,-j11,-k10");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1]);
        expect(g.board.has("k10")).to.be.false;
        expect(g.board.has("j11")).to.be.false;
        expect(g.results).to.deep.include({ type: "remove", where: "j11,k10", num: 2, how: "dead" });
        expect(g.getPlayerScore(1)).to.equal(121);
        expect(dots(g)[0].points).to.have.lengthOf(121 - 5);
        // Reloading keeps the marking.
        const again = new ThueMorseGoGame(play(scene(), ["pass,-j11,-k10"]).serialize());
        expect(again.marks).to.deep.equal(["j11", "k10"]);
        expect(again.render()).to.deep.equal(play(scene(), ["pass,-j11,-k10"]).render());
    });

    it("lets players change the marking back and forth until a placement or a plain pass ends marking", () => {
        // Player 1 marks Player 2's stones; the players then change the marking in turn as often as they like.
        const g = play(scene(), ["pass,-j11,-k10"]);
        const change = g.validateMove("pass,pass,-k10");
        expect(change.complete).to.equal(0);
        expect(change.message).to.contain("game goes on");
        expect(change.message).to.contain("change it again");
        play(g, ["pass,pass,-k10", "pass,-j11,-k10", "pass,-k10", "pass,pass,-j11,-k10"]);
        expect(g.locked).to.be.false;
        expect(g.gameover).to.be.false;
        expect(g.marks).to.deep.equal(["j11", "k10"]);
        // Keeping the marking ends the game with the marked strings removed.
        const kept = g.clone().move("pass,pass,-j11,-k10");
        expect(kept.gameover).to.be.true;
        expect(kept.board.has("j11")).to.be.false;
        expect(kept.board.has("k10")).to.be.false;
        // A plain pass instead ends marking: the game goes on, and the opponent's next pass ends it with every stone alive.
        expect(g.validateMove("").message).to.contain("2 stones are marked dead");
        const clears = g.validateMove("pass,pass");
        expect(clears.complete).to.equal(0);
        expect(clears.message).to.contain("ends dead-stone marking");
        const p = g.clone().move("pass,pass");
        expect(p.gameover).to.be.false;
        expect(p.locked).to.be.true;
        expect(p.marks).to.deep.equal([]);
        expect(p.results).to.deep.include({ type: "select", what: "dead", how: "cleared" });
        expect(p.results).to.deep.include({ type: "select", what: "dead", how: "locked" });
        expect(p.sidebarStatuses().some((s) => JSON.stringify(s.value).includes("MARKING_LOCKED"))).to.be.true;
        expect(p.validateMove("pass,-k10").valid).to.be.false;
        const lockedClick = click(p, "pass", "j11");
        expect(lockedClick.valid).to.be.false;
        expect(lockedClick.message).to.contain("Capture any dead stones");
        expect(p.getButtons()[0].move).to.equal("pass,pass");
        // A whole-move pass of two placements stays open, so that a stone can be placed for one of them.
        const ends = p.validateMove("pass,pass");
        expect(ends.complete).to.equal(0);
        expect(ends.message).to.contain("end the game");
        expect(p.clone().move("e5").gameover).to.be.false;
        p.move("pass,pass");
        expect(p.gameover).to.be.true;
        expect(p.board.has("j11")).to.be.true;
        expect(p.results.some((r) => r.type === "remove")).to.be.false;
        // A move that passes nothing ends marking, as does one that passes but marks nothing dead.
        const placing = g.validateMove("e5,g7");
        expect(placing.valid).to.be.true;
        expect(placing.message).to.contain("ends dead-stone marking");
        const placed = g.clone().move("e5,g7");
        expect(placed.locked).to.be.true;
        expect(placed.passes).to.deep.equal([]);
        expect(placed.results).to.deep.include({ type: "select", what: "dead", how: "locked" });
        expect(g.validateMove("e5").message).to.contain("ends dead-stone marking");
        expect(g.validateMove("e5,pass").message).to.contain("ends dead-stone marking");
        const q = g.clone().move("e5,pass");
        expect(q.locked).to.be.true;
        expect(q.marks).to.deep.equal([]);
        expect(q.passes[q.passes.length - 1]).to.equal(2);
        expect(q.results).to.deep.include({ type: "select", what: "dead", how: "cleared" });
        expect(q.results).to.deep.include({ type: "select", what: "dead", how: "locked" });
        // It still counts as a pass: the opponent's whole-move pass ends the game with every stone alive.
        expect(q.validateMove("pass,pass").complete).to.equal(0);
        expect(q.validateMove("pass,pass").message).to.contain("end the game with every stone alive");
        expect(q.validateMove("e5,pass").valid).to.be.false;
        expect(q.validateMove("d4,pass").message).to.contain("pass the rest of this move");
        expect(q.clone().move("d4,pass").gameover).to.be.false;
        q.move("pass,pass");
        expect(q.gameover).to.be.true;
        expect(q.board.has("e5")).to.be.true;
        expect(q.board.has("j11")).to.be.true;
        // A move that places a stone and passes keeping the marking goes on marking.
        const keeps = g.clone().move("e5,pass,-j11,-k10");
        expect(keeps.locked).to.be.false;
        expect(keeps.marks).to.deep.equal(["j11", "k10"]);
        expect(keeps.lastmove).to.equal("e5,pass,-j11,-k10");
        expect(keeps.results.some((r) => r.type === "select")).to.be.false;
        expect(keeps.gameover).to.be.false;
        expect(keeps.validateMove("pass,pass,-j11,-k10").message).to.contain("end the game");
        expect(keeps.clone().move("pass,pass,-j11,-k10").gameover).to.be.true;
        expect(keeps.clone().move("d4,pass,-j11,-k10").gameover).to.be.false;
        // Taking the button for a placement is the same.
        expect(g.clone().move("button,pass").locked).to.be.true;
        expect(g.clone().move("button,pass,-j11,-k10").locked).to.be.false;
        // A handicap declaration that gives away every placement of the move answers the marking too.
        const declared = small(["handicap"]);
        setStones(declared, ["f6"], []);
        play(declared, ["pass,-f6", "2"]);
        expect(declared.locked).to.be.true;
        expect(declared.marks).to.deep.equal([]);
        expect(declared.results).to.deep.include({ type: "select", what: "dead", how: "locked" });
        // Once ended, even after play resumes, passes carry no marking.
        const h = play(scene(), ["pass,-j11,-k10", "pass,e5", "f7"]);
        expect(h.locked).to.be.true;
        expect(h.validateMove("pass,-j11").valid).to.be.false;
        expect(click(h, "pass", "j11").valid).to.be.false;
    });

    it("keeps marking available while no marking has been answered by a placement or a plain pass", () => {
        // A plain pass before any marking does not end marking: the opponent may still mark.
        const g = play(scene(), ["pass", "pass,pass,-k10"]);
        expect(g.locked).to.be.false;
        expect(g.marks).to.deep.equal(["k10"]);
        expect(g.results).to.deep.include({ type: "select", what: "dead", how: "marked", where: "k10" });
        expect(g.validateMove("pass,-k10").message).to.contain("end the game");
        // Neither does a placement before any marking.
        const h = play(scene(), ["pass", "e5,pass", "pass,-k10"]);
        expect(h.locked).to.be.false;
        expect(h.marks).to.deep.equal(["k10"]);
        expect(h.validateMove("").message).to.contain("One stone is marked dead");
        // Two plain passes in a row end the game as they always did.
        expect(play(scene(), ["pass", "pass,pass"]).gameover).to.be.true;
    });

    it("ends the reported game only when a pass keeps the marking", () => {
        // Each player changed the other's marking in turn; the fourth pass is answered on its merits.
        const g = play(sixteen(), ["j13", "h8,g6", "e11", "d12", "pass,pass,-j13,-e11", "pass,pass,-j13", "pass,pass,-j13,-e11"]);
        expect(g.locked).to.be.false;
        expect(g.marks).to.deep.equal(["j13", "e11"]);
        expect(g.getButtons()[0].move).to.equal("pass,-j13,-e11");
        // Keeping it ends the game with both stones removed.
        const kept = g.clone().move("pass,-j13,-e11");
        expect(kept.gameover).to.be.true;
        expect([...kept.board.keys()].sort()).to.deep.equal(["d12", "g6", "h8"]);
        // Changing it goes on; clearing it ends marking, and the next pass ends the game with every stone alive.
        expect(g.clone().move("pass,-j13").gameover).to.be.false;
        const cleared = g.clone().move("pass");
        expect(cleared.gameover).to.be.false;
        expect(cleared.locked).to.be.true;
        cleared.move("pass");
        expect(cleared.gameover).to.be.true;
        expect([...cleared.board.keys()].sort()).to.deep.equal(["d12", "e11", "g6", "h8", "j13"]);
    });

    it("carries the marking across served handicap passes, which never answer it", () => {
        const g = play(small(["handicap"]), ["f6", "3", "pass,-f6"]);
        expect(g.currplayer).to.equal(1);
        expect(g.marks).to.deep.equal(["f6"]);
        expect(g.getButtons()[0].move).to.equal("pass,pass,-f6");
        g.move("pass,pass,-f6");
        expect(g.gameover).to.be.false;
        expect(g.locked).to.be.false;
        g.move("pass,-f6");
        expect(g.gameover).to.be.true;
        expect(g.board.size).to.equal(0);
        expect(g.winner).to.deep.equal([1, 2]);
    });

    it("reports markings in the chat log", () => {
        const g = scene();
        play(g, ["pass,-j11,-k10", "pass,pass,-k10", "pass,-j11,-k10", "pass,-k10", "pass,pass", "pass,pass"]);
        expect(g.gameover).to.be.true;
        assertChatLogParity(g, ["Alice", "Bob"]);
        const log = g.chatLog(["Alice", "Bob"]).flat().join("\n");
        expect(log).to.contain("Alice marked 2 stones as dead.");
        expect(log).to.contain("Bob changed the marking: one stone is marked dead.");
        expect(log).to.contain("Alice changed the marking: 2 stones are marked dead.");
        expect(log).to.contain("Alice cleared the marking: no stones are marked dead.");
        expect(log).to.contain("Dead-stone marking has ended");
        expect(log).to.not.contain("removed from the board");
        expect(log).to.contain("both players passed consecutively");
        // A game that ends by accepting a marking removes the marked stones.
        const h = play(scene(), ["pass,-j11,-k10", "pass,pass", "pass"]);
        expect(h.gameover).to.be.true;
        expect(h.chatLog(["Alice", "Bob"]).flat().join("\n")).to.not.contain("removed from the board");
        const k = play(scene(), ["pass,-k10", "pass,pass,-k10"]);
        expect(k.chatLog(["Alice", "Bob"]).flat().join("\n")).to.contain("The stone marked dead was removed from the board.");
    });
});

describe("Thue-Morse Go: boards and star points", () => {
    const stars = (g: ThueMorseGoGame): MarkerDots | undefined =>
        (((g.render().board as BoardBasic).markers ?? []) as MarkerDots[]).find((m) => m.type === "dots" && m.colour === undefined);
    const corners = (lo: number, hi: number) => [{ row: lo, col: lo }, { row: lo, col: hi }, { row: hi, col: hi }, { row: hi, col: lo }];

    it("offers a 19x19 board", () => {
        const g = new ThueMorseGoGame(undefined, ["size-19"]);
        expect(g.render().board).to.deep.include({ width: 19, height: 19 });
        expect(g.validateMove("s19").valid).to.be.true;
        expect(g.validateMove("t19").valid).to.be.false;
        expect(g.allvariants()!.find((v) => v.uid === "size-19")!.group).to.equal("board");
    });

    it("puts the 11x11 star points on the 4-4 points without a centre", () => {
        const g = small();
        expect(g.render().options).to.deep.equal(["hide-star-points"]);
        expect(stars(g)).to.deep.equal({ type: "dots", size: 0.15, points: corners(3, 7) });
        // Other square boards keep the renderer's own star points.
        for (const size of ["size-19", "size-23", undefined]) {
            const h = new ThueMorseGoGame(undefined, size === undefined ? [] : [size]);
            expect(h.render().options).to.be.undefined;
            expect(stars(h)).to.be.undefined;
        }
    });

    it("draws star points on snub square boards where the square boards have them", () => {
        expect(stars(small(["snub"]))!.points).to.deep.equal(corners(3, 7));
        expect(stars(new ThueMorseGoGame(undefined, ["snub"]))!.points).to.deep.equal(corners(3, 12));
        const nineteen = stars(new ThueMorseGoGame(undefined, ["snub", "size-19"]))!.points;
        expect(nineteen).to.have.lengthOf(9);
        expect(nineteen).to.deep.include({ row: 9, col: 9 });
        expect(nineteen).to.deep.include({ row: 3, col: 9 });
        expect(stars(new ThueMorseGoGame(undefined, ["snub", "size-23"]))!.points).to.have.lengthOf(9);
        expect(small(["snub"]).render().options).to.be.undefined;
    });
});

describe("Thue-Morse Go: reverse komi", () => {
    it("begins Player 2's first move with a reverse komi given to Player 1, costing no placement", () => {
        const g = small(["reverse-komi"]);
        expect(g.allvariants()!.find((v) => v.uid === "reverse-komi")).to.deep.include({ unrated: true });
        expect(g.allvariants()!.some((v) => v.fans === true)).to.be.false;
        expect(g.currplayer).to.equal(1);
        expect(g.turnModel()).to.equal("sequential");
        g.move("f3");
        expect(g.getButtons()).to.deep.equal([]);
        const empty = g.validateMove("");
        expect(empty.complete).to.equal(-1);
        expect(empty.message).to.contain("reverse komi");
        expect(g.validateMove("e5").valid).to.be.false;
        expect(g.validateMove("0").valid).to.be.false;
        expect(g.validateMove("-14").valid).to.be.false;
        expect(g.validateMove("71").valid).to.be.false;
        // Any whole number up to the largest stone, 14 times the handicap limit of 5, may be typed.
        expect(g.validateMove("1").complete).to.equal(0);
        expect(g.validateMove("70").complete).to.equal(0);
        expect(g.validateMove("7,e5").complete).to.equal(0);
        // Placing one stone of the move passes the other, so the opponent's pass then ends the game.
        expect(play(small(["reverse-komi"]), ["f6", "7,e5", "pass"]).getPlayerScore(1)).to.equal(1 + 7);
        const alone = g.validateMove("14");
        expect(alone.complete).to.equal(0);
        expect(alone.message).to.contain("14 points");
        expect(g.validateMove("42,e5").complete).to.equal(0);
        expect(g.validateMove("28,e5,g7").complete).to.equal(1);
        expect(g.validateMove("14,e5,g7,d4").valid).to.be.false;
        expect(g.moves()).to.include("7p,e5,g7");
        expect(withRandom(0, () => g.randomMove())).to.equal("7p,a11,b11");
        expect(withRandom(0.5, () => g.randomMove())).to.equal("42p,pass,pass");
        // The numbered stones offer the multiples of 7 up to 70, always in the lower block, which
        // starts on the diagonal from the bottom left corner and snakes up, as the second batch of
        // Kill-All Go's Generalized Hoctaph's Pie does; f3 is covered but still means 28.
        expect(picture(g)).to.deep.equal([
            ...blank(6, 11),
            "  .  .  .  .  .  .  . 70 63  .  .",
            "  .  .  .  .  .  .  .  . 56  .  .",
            "  .  .  7 14 21  . 35 42 49  .  .",
            ...blank(2, 11),
        ]);
        // They are grey, as Kill-All Go's first batch is, with legend keys of their own.
        expect((layers(g, "k7")[0] as { paint: unknown }).paint).to.deep.equal({ fill: "#737373", border: { func: "bestContrast", bg: "#737373", fg: ["#000", "#fff"] } });
        expect(click(g, "", "c3").move).to.equal("7p");
        expect(click(g, "", "f3").move).to.equal("28p");
        expect(click(g, "", "h5").move).to.equal("70p");
        const early = click(g, "", "e5");
        expect(early.valid).to.be.false;
        expect(early.message).to.contain("reverse komi");
        // Once the komi is set the stones give way to the board, and clicks place, even on their cells.
        expect(offered(g.clone().move("14", { partial: true }), "k")).to.deep.equal([]);
        expect(click(g, "14", "e5").move).to.equal("14p,e5");
        expect(click(g, "14p", "d3").move).to.equal("14p,d3");
        expect(click(g, "14p,e5", "e5").move).to.equal("14p");
        expect(g.handleClick("14,e5", -1, -1, "_btn_pass").move).to.equal("14p,pass,pass");
        // Larger boards offer up to 14 times the handicap limit, 140, 196 and 294, in steps of 7.
        for (const [variants, max] of [[[], 140], [["size-19"], 196], [["size-23"], 294]] as Array<[string[], number]>) {
            const big = play(new ThueMorseGoGame(undefined, [...variants, "reverse-komi"]), ["a1"]);
            expect(offered(big, "k"), `${max}`).to.deep.equal(Array.from({ length: max / 7 }, (_, i) => 7 * (i + 1)));
            expect(big.validateMove(`${max}`).valid, `${max}`).to.be.true;
            expect(big.validateMove(`${max + 1}`).valid, `${max + 1}`).to.be.false;
        }
        // Submitting the komi alone passes the move.
        const passed = g.clone().move("14");
        expect(passed.lastmove).to.equal("14p,pass,pass");
        expect(passed.passes).to.deep.equal([2]);
        expect(passed.komi).to.equal(14);
        g.move("28p,e5,g7");
        expect(g.komi).to.equal(28);
        expect(g.placed).to.equal(3);
        expect(g.currplayer).to.equal(1);
        expect(g.lastmove).to.equal("28p,e5,g7");
        expect(g.results.slice(0, 2)).to.deep.equal([{ type: "komi", value: 28 }, { type: "place", where: "e5" }]);
        expect(g.getPlayerScore(1)).to.equal(1 + 28);
        expect(g.getPlayerScore(2)).to.equal(2);
        expect(g.getButtons().map((b) => b.move)).to.deep.equal(["pass", "button"]);
        // The move table stays sequential, and reloading keeps the komi.
        expect(g.getRounds()).to.deep.equal([[{ move: "f3", result: [{ type: "place", where: "f3" }] }, { move: "28p,e5,g7", result: g.results }]]);
        const again = new ThueMorseGoGame(g.serialize());
        expect(again.komi).to.equal(28);
        expect(again.sidebarStatuses().some((s) => JSON.stringify(s).includes("\"28\""))).to.be.true;
        expect(again.validateMove("f7").valid).to.be.true;
    });

    it("counts the komi for Player 1 at the end of the game and in the chat log", () => {
        const g = play(small(["reverse-komi"]), ["f6", "14", "pass"]);
        expect(g.gameover).to.be.true;
        expect(g.getPlayerScore(1)).to.equal(121 + 14);
        expect(g.getPlayerScore(2)).to.equal(0);
        expect(g.winner).to.deep.equal([1]);
        assertChatLogParity(g, ["Alice", "Bob"]);
        const log = g.chatLog(["Alice", "Bob"]).flat().join("\n");
        expect(log).to.contain("Bob gave their opponent a reverse komi of 14 points.");
        expect(log).to.contain("Bob passed.");
        // One stone each is level, so the komi decides.
        expect(play(small(["reverse-komi"]), ["f6", "14,e5", "pass"]).winner).to.deep.equal([1]);
        expect(play(small(), ["f6", "e5", "pass"]).winner).to.deep.equal([1, 2]);
    });

    it("waits for the reverse komi before the 1-point button, which then evens the komi too", () => {
        const buttonRow = (game: ThueMorseGoGame): IStatus | undefined => game.sidebarStatuses().find((st) => JSON.stringify(st.key).includes("thuemorsego.BUTTON"));
        // Until Player 2 chooses the komi nobody can take the button, whose existence waits for it.
        const g = small(["reverse-komi"]);
        const early = g.validateMove("button");
        expect(early.valid).to.be.false;
        expect(early.message).to.contain("until the reverse komi has been chosen");
        expect(g.validateMove("").message).to.not.contain("button");
        expect(g.getButtons().map((b) => b.move)).to.deep.equal(["pass"]);
        expect(JSON.stringify(buttonRow(g)!.value)).to.contain("UNDECIDED");
        g.move("f6");
        const choose = g.validateMove("").message!;
        expect(choose).to.contain("also decides the button");
        expect(choose).to.contain("121 points");
        // 121 points and an odd komi add up to an even number, which needs no button.
        expect(g.validateMove("7").message).to.not.contain("button");
        const none = g.validateMove("7p,button");
        expect(none.valid).to.be.false;
        expect(none.message).to.contain("no button");
        expect(g.handleClick("7", -1, -1, "_btn_button").move).to.equal("7");
        const level = g.clone().move("7");
        expect(level.getButtons().map((b) => b.move)).to.deep.equal(["pass"]);
        expect(level.validateMove("button").message).to.contain("no button");
        expect(buttonRow(level)).to.equal(undefined);
        // An even komi leaves the points at stake odd, so there is a button to even them again.
        expect(g.validateMove("14").message).to.contain("take the button (worth 1)");
        expect(g.validateMove("14p,button").complete).to.equal(0);
        expect(g.handleClick("14", -1, -1, "_btn_button").move).to.equal("14p,button");
        // A stone clicked after taking the button is placed, and clicked again taken back.
        expect(click(g, "14p,button", "e5").move).to.equal("14p,button,e5");
        expect(click(g, "14p,button,e5", "e5").move).to.equal("14p,button");
        const taken = g.clone().move("14p,button,e5");
        expect(taken.button).to.equal(2);
        expect(taken.getPlayerScore(2)).to.equal(1 + 1);
        expect(JSON.stringify(buttonRow(taken)!.value)).to.not.contain("UNDECIDED");
        // Listed moves follow the first komi, 7, which leaves no button on 11x11.
        expect(g.moves().some((move) => move.includes("button"))).to.be.false;
        // The 256 points of 16x16 make it the other way round, and random moves follow the komi they choose.
        const s = play(sixteen(["reverse-komi"]), ["h8"]);
        expect(s.validateMove("7p,button").complete).to.equal(0);
        expect(s.validateMove("14p,button").valid).to.be.false;
        expect(withRandom(0, () => s.randomMove())).to.equal("7p,button,a16");
        expect(withRandom(0.5, () => play(sixteen(["reverse-komi"]), ["h8"]).randomMove())).to.equal("77p,pass,pass");
        // The 0.5 point button does not wait for the komi.
        expect(small(["reverse-komi", "half-button"]).validateMove("button").valid).to.be.true;
    });

    it("takes the komi and the handicap in either order, both open to clicks until a placement remains", () => {
        const g = play(small(["reverse-komi", "handicap"]), ["f6"]);
        expect(g.validateMove("").message).to.contain("in either order");
        const komiOnly = g.validateMove("14");
        expect(komiOnly.complete).to.equal(-1);
        expect(komiOnly.message).to.contain("upper block");
        const handicapOnly = g.validateMove("3s");
        expect(handicapOnly.complete).to.equal(-1);
        expect(handicapOnly.message).to.contain("lower block");
        // Tagged tokens come in either order; bare numbers fill the komi and then the handicap.
        expect(g.validateMove("3s,14p").complete).to.equal(0);
        expect(g.validateMove("3s,14").complete).to.equal(0);
        expect(g.validateMove("14p,3s").complete).to.equal(0);
        expect(g.validateMove("14,3").complete).to.equal(0);
        expect(g.validateMove("14p,14p").valid).to.be.false;
        expect(g.validateMove("3s,e5").valid).to.be.false;
        expect(g.validateMove("14p,e5").valid).to.be.false;
        expect(g.validateMove("e5").valid).to.be.false;
        expect(play(small(["reverse-komi", "handicap"]), ["f6", "3s,14"]).lastmove).to.equal("14p,3s");
        // The handicap's block above, from the top-left diagonal snaking down, and the komi's below,
        // from the bottom-left diagonal snaking up, as Kill-All Go lays out the sizes of its two batches.
        expect(picture(g)).to.deep.equal([
            ...blank(2, 11),
            "  .  .  1  2  3  4  5  .  .  .  .",
            ...blank(3, 11),
            "  .  .  .  .  .  .  . 70 63  .  .",
            "  .  .  .  .  .  .  .  . 56  .  .",
            "  .  .  7 14 21 28 35 42 49  .  .",
            ...blank(2, 11),
        ]);
        expect(click(g, "", "d3").move).to.equal("14p");
        expect(click(g, "", "c9").move).to.equal("1s");
        expect(click(g, "1s", "d3").move).to.equal("14p,1s");
        expect(click(g, "14", "c9").move).to.equal("14p,1s");
        expect(click(g, "14", "e9").move).to.equal("14p,3s");
        expect(click(g, "", "e5").message).to.contain("from each block");
        expect(click(g, "3s", "e5").message).to.contain("Choose the reverse komi first");
        expect(click(g, "14p", "e5").message).to.contain("Choose the handicap first");
        // Either choice can be changed while the stones show; a new handicap drops any placement.
        expect(click(g, "14,3", "f3").move).to.equal("28p,3s");
        expect(click(g, "14,3", "d9").move).to.equal("14p,2s");
        // With a handicap of one the stones are gone, so d9 is a point: it replaces the placement.
        expect(click(g, "14,1,e5", "d9").move).to.equal("14p,1s,d9");
        expect(click(g, "14,3", "e5").message).to.contain("no placement left");
        // A handicap of one leaves a placement, so the board takes over, the stones' cells included.
        expect(click(g, "14,1", "e5").move).to.equal("14p,1s,e5");
        expect(click(g, "14,1", "d3").move).to.equal("14p,1s,d3");
        let partial = g.clone().move("14,3", { partial: true }).render();
        expect(partial.pieces as string).to.contain("k14,").and.to.contain("n1,");
        const [kx, ky] = g.algebraic2coords("d3");
        const [hx, hy] = g.algebraic2coords("e9");
        expect(partial.annotations).to.deep.include({ type: "enter", targets: [{ row: ky, col: kx }] });
        expect(partial.annotations).to.deep.include({ type: "enter", targets: [{ row: hy, col: hx }] });
        partial = g.clone().move("14,1", { partial: true }).render();
        expect(partial.pieces as string).to.not.contain("k14");
        expect(g.validateMove("14,3").complete).to.equal(0);
        expect(g.validateMove("14,5").complete).to.equal(0);
        expect(g.validateMove("14,6").valid).to.be.false;
        g.move("14,3");
        expect(g.komi).to.equal(14);
        expect(g.handicap).to.equal(3);
        expect(g.passesOwed).to.equal(1);
        expect(g.placed).to.equal(3);
        expect(g.currplayer).to.equal(1);
        // The declaration serves placement 1 and a forced pass placement 2, as in a plain handicap move.
        expect(g.lastmove).to.equal("14p,3s");
        g.move("e5");
        // Player 2's single placement 4 is served by the handicap.
        expect(g.placed).to.equal(5);
        expect(g.currplayer).to.equal(1);
        expect(g.passesOwed).to.equal(0);
        expect(g.getPlayerScore(1)).to.equal(121 + 14);
        expect(g.getPlayerScore(2)).to.equal(0);
        const one = play(small(["reverse-komi", "handicap"]), ["f6", "28,1,e5"]);
        expect(one.komi).to.equal(28);
        expect(one.board.get("e5")).to.equal(2);
        expect(new ThueMorseGoGame(undefined, ["kill-all", "reverse-komi"]).variants).to.deep.equal(["reverse-komi"]);
        expect(new ThueMorseGoGame(undefined, ["reverse-komi", "kill-all"]).variants).to.deep.equal(["kill-all"]);
        expect(withRandom(0.05, () => g.randomMove())).to.equal("g10,h10");
    });
});
