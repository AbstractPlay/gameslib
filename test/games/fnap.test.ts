/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { FnapGame } from '../../src/games';

describe("FNAP", () => {
    it("Triplets", () => {
        const g = new FnapGame();
        g.board = new Map([
            ["a1", [1, "+", 1]],
            ["a2", [2, "+", 1]],
            ["a3", [3, "+", 1]],
        ]);
        expect(g.scoreTriplets("a3")).eq(1);
        g.board = new Map([
            ["a1", [1, "+", 1]],
            ["a2", [2, "*", 1]],
            ["a3", [3, "+", 1]],
        ]);
        expect(g.scoreTriplets("a3")).eq(1);
        g.board = new Map([
            ["a1", [1, "+", 1]],
            ["a2", [2, "x", 1]],
            ["a3", [3, "+", 1]],
        ]);
        expect(g.scoreTriplets("a3")).eq(0);
        g.board = new Map([
            ["c1", [1, "+", 1]],
            ["b2", [2, "x", 1]],
            ["a3", [3, "+", 1]],
        ]);
        expect(g.scoreTriplets("a3")).eq(0);
        g.board = new Map([
            ["c1", [1, "x", 1]],
            ["b2", [2, "x", 1]],
            ["a3", [3, "*", 1]],
        ]);
        expect(g.scoreTriplets("a3")).eq(1);
        g.board = new Map([
            ["c1", [1, "x", 1]],
            ["b2", [2, "x", 1]],
            ["a3", [3, "x", 1]],
        ]);
        expect(g.scoreTriplets("a3")).eq(1);
        g.board = new Map([
            ["a1", [1, "+", 1]],
            ["b1", [2, "+", 1]],
            ["c1", [3, "+", 1]],
            ["d1", [1, "*", 1]],
            ["e1", [2, "*", 1]],
        ]);
        expect(g.scoreTriplets("c1")).eq(3);
        g.board = new Map([
            ["a2", [1, "+", 1]],
            ["b2", [2, "+", 1]],
            ["c2", [3, "+", 1]],
            ["b1", [1, "*", 1]],
            ["b3", [2, "*", 1]],
        ]);
        expect(g.scoreTriplets("b2")).eq(2);
    });

    it("Rows/Cols", () => {
        const g = new FnapGame();
        g.board = new Map([
            ["a1", [1, "+", 1]],
            ["a2", [2, "+", 1]],
            ["a3", [3, "+", 1]],
            ["a4", [1, "+", 2]],
            ["a5", [2, "+", 2]],
            ["a6", [3, "+", 2]],
        ]);
        expect(g.scoreRowCol("col", 0)).to.be.undefined;
        g.board = new Map([
            ["a1", [1, "+", 1]],
            ["a2", [2, "+", 1]],
            ["a3", [4, "+", 1]],
            ["a4", [1, "+", 2]],
            ["a5", [2, "+", 2]],
            ["a6", [3, "+", 2]],
        ]);
        expect(g.scoreRowCol("col", 0)).eq(1);
        g.board = new Map([
            ["a1", [1, "+", 1]],
            ["a2", [2, "+", 1]],
            ["a3", [3, "+", 1]],
            ["a4", [1, "+", 2]],
            ["a5", [2, "+", 2]],
            ["a6", [4, "+", 2]],
        ]);
        expect(g.scoreRowCol("col", 0)).eq(2);
        g.board = new Map([
            ["a1", [1, "+", 1]],
            ["b1", [2, "o", 1]],
            ["c1", [3, "x", 1]],
            ["d1", [1, "*", 2]],
            ["e1", [2, "+", 2]],
            ["f1", [3, "o", 2]],
        ]);
        expect(g.scoreRowCol("row", 5)).to.be.undefined;
        g.board = new Map([
            ["a1", [1, "+", 1]],
            ["b1", [2, "o", 1]],
            ["c1", [4, "x", 1]],
            ["d1", [1, "*", 2]],
            ["e1", [2, "+", 2]],
            ["f1", [3, "o", 2]],
        ]);
        expect(g.scoreRowCol("row", 5)).eq(1);
        g.board = new Map([
            ["a1", [1, "+", 1]],
            ["b1", [2, "o", 1]],
            ["c1", [3, "x", 1]],
            ["d1", [1, "*", 2]],
            ["e1", [2, "+", 2]],
            ["f1", [4, "o", 2]],
        ]);
        expect(g.scoreRowCol("row", 5)).eq(2);
    });

    it("Circles", () => {
        const g = new FnapGame();
        g.board = new Map([
            ["b5", [1, "+", 1]],
            ["c5", [2, "+", 1]],
            ["d5", [3, "+", 1]],
            ["b4", [1, "+", 2]],
            ["c4", [2, "o", 2]],
            ["d4", [3, "+", 2]],
            ["b3", [1, "+", 1]],
            ["c3", [2, "+", 1]],
            ["d3", [3, "+", 1]],
        ]);
        expect(g.scores).eql([0,0]);
        g.scoreCircles();
        expect(g.scores).eql([0,0]);

        g.scores = [0,0];
        g.board = new Map([
            ["b5", [1, "+", 1]],
            ["c5", [2, "+", 1]],
            ["d5", [3, "+", 1]],
            ["b4", [1, "x", 2]],
            ["c4", [2, "o", 2]],
            ["d4", [3, "x", 2]],
            ["b3", [1, "+", 1]],
            ["c3", [2, "+", 1]],
            ["d3", [3, "+", 1]],
        ]);
        expect(g.scores).eql([0,0]);
        g.scoreCircles();
        expect(g.scores).eql([0,2]);
    });
});

