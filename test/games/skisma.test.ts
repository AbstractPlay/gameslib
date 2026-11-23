/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { addResource } from "../../src";
import { SkismaGame } from "../../src/games";
import { assertChatLogParity } from "../fixtures/chat/helpers";
import i18next from "i18next";

// The rules do not depend on the board size, and the engine accepts any
// size-N (hexhex) or square-N board. Most fixtures use small boards, like the
// rules' own examples, to stay readable; some run on the published boards.
//
// Hexhex cell names: the letter is the row counted from the bottom (size 5:
// "i" is the top row, "e" the middle row), the number the position in the row
// from the left. Square names: column letter, row number from the bottom (a1
// bottom-left).

const place = (g: SkismaGame, player: 1 | 2, cells: string[]) => {
    for (const c of cells) {
        g.board.set(c, player);
    }
};

describe("Skisma", () => {
    before(() => {
        addResource("en");
    });

    it("starts empty with every cell playable", () => {
        expect(new SkismaGame().moves()).to.have.length(91);
        expect(new SkismaGame(undefined, ["size-5"]).moves()).to.have.length(61);
        expect(new SkismaGame(undefined, ["square-9"]).moves()).to.have.length(81);
        expect(new SkismaGame(undefined, ["square-7"]).moves()).to.have.length(49);
        expect(new SkismaGame(undefined, ["size-9"]).moves()).to.have.length(217);
        expect(new SkismaGame(undefined, ["square-13"]).moves()).to.have.length(169);
        expect(new SkismaGame(undefined, ["square-15"]).moves()).to.have.length(225);
    });

    it("a wall against the edge surrounds the small side: the mover wins", () => {
        // Red's group i3 h3 g1 g2 + g3 holds 2 of the 24 edge cells; the corner
        // side (i1 i2 h1 h2) holds 3 of the 22 others: Blue's h2 is surrounded.
        const g = new SkismaGame(undefined, ["size-5"]);
        place(g, 1, ["i3", "h3", "g1", "g2"]);
        place(g, 2, ["h2"]);
        g.move("g3");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1]);
    });

    it("the larger side of a wall is never surrounded", () => {
        const g = new SkismaGame(undefined, ["size-5"]);
        place(g, 1, ["i3", "h3", "g1", "g2"]);
        place(g, 2, ["e5"]);
        g.move("g3");
        expect(g.gameover).to.be.false;
    });

    it("a stone may not be placed where it would be surrounded", () => {
        const g = new SkismaGame(undefined, ["size-5"]);
        place(g, 1, ["i3", "h3", "g1", "g2"]);
        place(g, 2, ["e5"]);
        g.move("g3"); // Blue to move; the corner is Red's
        for (const c of ["i1", "i2", "h1", "h2"]) {
            expect(g.moves()).to.not.include(c);
            expect(g.validateMove(c).valid).to.be.false;
        }
        expect(() => g.move("h2")).to.throw();
        g.move("a1");
        expect(g.moves()).to.include.members(["i1", "i2", "h1", "h2"]); // Red may
    });

    it("an enclosure away from the edge surrounds", () => {
        const g = new SkismaGame(undefined, ["size-5"]);
        place(g, 1, ["f4", "f5", "e4", "d4", "d5"]);
        place(g, 2, ["e5"]);
        g.move("e6");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1]);
    });

    it("a ring with a gap surrounds nothing", () => {
        const g = new SkismaGame(undefined, ["size-5"]);
        place(g, 1, ["f4", "f5", "e4", "d4", "c4"]);
        place(g, 2, ["e5"]);
        g.move("e6"); // d5 is empty: the ring is open
        expect(g.gameover).to.be.false;
    });

    it("a wall that halves the edge surrounds both halves", () => {
        // 16 of the 24 edge cells are off the wall, 8 on each side: fewer
        // than half of all 24
        const g = new SkismaGame(undefined, ["size-5"]);
        place(g, 1, ["e1", "e2", "e3", "e4", "e6", "e7", "e8", "e9"]);
        place(g, 2, ["i1", "a1"]);
        g.move("e5");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1]);
    });

    it("a group's own edge cells count: an arc on more than half of the edge surrounds", () => {
        // size 4, 18 edge cells; the arc holds 10, the blue stone reaches 8
        const g = new SkismaGame(undefined, ["size-4"]);
        place(g, 1, ["g1", "g2", "g3", "g4", "f1", "e1", "c1", "b1", "a1"]);
        place(g, 2, ["d4"]);
        g.move("d1");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1]);
    });

    it("an arc on exactly half of the edge surrounds nothing", () => {
        const g = new SkismaGame(undefined, ["size-4"]);
        place(g, 1, ["g1", "g2", "g3", "g4", "f1", "e1", "c1", "b1"]);
        place(g, 2, ["d4"]);
        g.move("d1");
        expect(g.gameover).to.be.false;
    });

    it("a full board is not a draw: the player to move loses", () => {
        // 2x2: Blue answers in the opposite corner, nobody can surround
        const g = new SkismaGame(undefined, ["square-2"]);
        for (const m of ["a2", "b1", "b2", "a1"]) {
            g.move(m);
        }
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([2]);
    });

    it("square: an orthogonal wall against the edge surrounds the corner", () => {
        const g = new SkismaGame(undefined, ["square-7"]);
        place(g, 1, ["b7", "b6", "a5"]);
        place(g, 2, ["a7"]);
        g.move("b5");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1]);
    });

    it("square: stones connect diagonally, so a diagonal wall surrounds", () => {
        const g = new SkismaGame(undefined, ["square-7"]);
        place(g, 2, ["a7"]);
        place(g, 1, ["b7"]);
        g.move("a6");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1]);
    });

    it("square: paths do not go diagonally between two stones of a group", () => {
        // Red ring b2 c3 b4 a3 closes around a Blue stone at b3: the diagonal
        // links leave no orthogonal way out.
        const g = new SkismaGame(undefined, ["square-7"]);
        place(g, 1, ["c3", "b4", "a3"]);
        place(g, 2, ["b3"]);
        g.move("b2");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1]);
    });

    it("enclosed zones are shaded in the encloser's colour, also at the end", () => {
        // Red encloses the empty corner i1 i2 h1 h2, then surrounds e5 elsewhere
        const g = new SkismaGame(undefined, ["size-5"]);
        place(g, 1, ["i3", "h3", "g1", "g2", "g3", "f4", "f5", "e4", "d4", "d5"]);
        place(g, 2, ["e5"]);
        g.move("e6");
        expect(g.gameover).to.be.true;
        type Flood = { colour: number; points: unknown[] };
        const floods = (alt?: string) => (g.render(alt === undefined ? undefined : { altDisplays: [alt] }).board as { markers?: Flood[] }).markers ?? [];
        const shown = floods();
        expect(shown.map(m => m.colour)).to.deep.equal([1]);
        expect(shown[0].points).to.have.length(5); // the corner and the surrounded e5
        expect(floods("hide-enclosed")).to.have.length(0);
    });

    it("published board: a wall that halves the hexhex 6 edge surrounds both halves", () => {
        const g = new SkismaGame();
        place(g, 1, ["f1", "f2", "f3", "f4", "f5", "f7", "f8", "f9", "f10", "f11"]);
        place(g, 2, ["a1", "k1"]);
        g.move("f6");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1]);
    });

    it("published board: a placement inside an enemy zone is legal when it wins", () => {
        // Rules example 8 in the top-left corner of 9x9. Red's diagonal c9 b8
        // a7 encloses a9 b9 a8. Blue's a8 joins b7 and a6 (diagonally) and
        // cuts Red's a7 off.
        const g = new SkismaGame(undefined, ["square-9"]);
        place(g, 1, ["c9", "b8", "a7"]);
        place(g, 2, ["b7", "a6"]);
        g.move("i1"); // Red; Blue to move
        expect(g.moves()).to.include("a8");
        expect(g.moves()).to.not.include.members(["a9", "b9"]);
        g.move("a8");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([2]);
    });

    it("walls do not add up: only one enemy group counts", () => {
        // Rules example 5 (size 4): each red wall alone leaves d4 more than
        // half of the edge.
        const g = new SkismaGame(undefined, ["size-4"]);
        place(g, 1, ["g2", "f2", "e2", "d3", "c2", "b2"]);
        place(g, 1, ["g4", "f4", "e5", "d5", "c5", "b4", "a4"]);
        place(g, 2, ["d4"]);
        g.move("a2");
        expect(g.gameover).to.be.false;
    });

    it("a player with no legal move loses, even with empty cells left", () => {
        // 4x4: Red's last empty cells (column a) are all in Blue's zone
        const g = new SkismaGame(undefined, ["square-4"]);
        for (const m of ["d3", "b1", "c1", "b2", "d2", "b4", "c4", "c3", "d4", "c2", "d1", "b3"]) {
            g.move(m);
        }
        expect(g.board.size).to.equal(12);
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([2]);
        expect(g.results.some(r => r.type === "eog" && r.reason === "stalemate")).to.be.true;
    });

    it("validates moves and clicks", () => {
        const g = new SkismaGame(undefined, ["square-9"]);
        place(g, 1, ["b9", "b8", "a7"]); // encloses a9 a8
        place(g, 2, ["e5"]);
        g.move("i1"); // Red; Blue to move
        const empty = g.validateMove("");
        expect(empty.valid).to.be.true;
        expect(empty.complete).to.equal(-1);
        expect(g.validateMove("z9").valid).to.be.false;
        expect(g.validateMove("e5").message).to.equal(i18next.t("apgames:validation._general.OCCUPIED", { where: "e5" }));
        expect(g.validateMove("a9").message).to.equal(i18next.t("apgames:validation.skisma.SUICIDE", { where: "a9" }));
        const ok = g.validateMove("d4");
        expect(ok.valid).to.be.true;
        expect(ok.complete).to.equal(1);
        expect(g.handleClick("", 4, 3).move).to.equal("d5"); // row 4 from the top, column d
        expect(g.handleClick("", 0, 0).valid).to.be.false; // a9, in Red's zone
    });

    it("serializes and restores", () => {
        const g = new SkismaGame(undefined, ["square-9"]);
        g.move("e5");
        g.move("d4");
        const r = new SkismaGame(g.serialize());
        expect(r.variants).to.deep.equal(["square-9"]);
        expect(r.moves()).to.deep.equal(g.moves());
        expect(r.board.get("e5")).to.equal(1);
    });

    it("chat log parity on a finished game", () => {
        const g = new SkismaGame(undefined, ["size-5"]);
        g.move("i3");
        g.move("h2");
        g.move("h3");
        g.move("a1");
        g.move("g1");
        g.move("a2");
        g.move("g2");
        g.move("a3");
        g.move("g3");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1]);
        assertChatLogParity(g, ["Red", "Blue"]);
    });
});
