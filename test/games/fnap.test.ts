/* eslint-disable no-unused-expressions */
/* eslint-disable @typescript-eslint/no-unused-expressions */
/* tslint:disable:no-unused-expression */

import "mocha";
import { expect } from "chai";
import { FnapGame } from '../../src/games';

describe("FNAP", () => {
    it("Triplets", () => {
        const g = new FnapGame();
        g.board = new Map([
            ["a1", [1, "O", 1]],
            ["a2", [2, "O", 1]],
            ["a3", [3, "O", 1]],
        ]);
        expect(g.scoreTriplets("a3")).eq(1);
        g.board = new Map([
            ["a1", [1, "O", 1]],
            ["a2", [2, "A", 1]],
            ["a3", [3, "O", 1]],
        ]);
        expect(g.scoreTriplets("a3")).eq(1);
        g.board = new Map([
            ["a1", [1, "O", 1]],
            ["a2", [2, "D", 1]],
            ["a3", [3, "O", 1]],
        ]);
        expect(g.scoreTriplets("a3")).eq(0);
        g.board = new Map([
            ["c1", [1, "O", 1]],
            ["b2", [2, "D", 1]],
            ["a3", [3, "O", 1]],
        ]);
        expect(g.scoreTriplets("a3")).eq(0);
        g.board = new Map([
            ["c1", [1, "D", 1]],
            ["b2", [2, "D", 1]],
            ["a3", [3, "A", 1]],
        ]);
        expect(g.scoreTriplets("a3")).eq(1);
        g.board = new Map([
            ["c1", [1, "D", 1]],
            ["b2", [2, "D", 1]],
            ["a3", [3, "D", 1]],
        ]);
        expect(g.scoreTriplets("a3")).eq(1);
        g.board = new Map([
            ["a1", [1, "O", 1]],
            ["b1", [2, "O", 1]],
            ["c1", [3, "O", 1]],
            ["d1", [1, "A", 1]],
            ["e1", [2, "A", 1]],
        ]);
        expect(g.scoreTriplets("c1")).eq(3);
        g.board = new Map([
            ["a2", [1, "O", 1]],
            ["b2", [2, "O", 1]],
            ["c2", [3, "O", 1]],
            ["b1", [1, "A", 1]],
            ["b3", [2, "A", 1]],
        ]);
        expect(g.scoreTriplets("b2")).eq(2);
    });

    it("Rows/Cols", () => {
        const g = new FnapGame();
        g.board = new Map([
            ["a1", [1, "O", 1]],
            ["a2", [2, "O", 1]],
            ["a3", [3, "O", 1]],
            ["a4", [1, "O", 2]],
            ["a5", [2, "O", 2]],
            ["a6", [3, "O", 2]],
        ]);
        expect(g.scoreRowCol("col", 0)).to.be.undefined;
        g.board = new Map([
            ["a1", [1, "O", 1]],
            ["a2", [2, "O", 1]],
            ["a3", [4, "O", 1]],
            ["a4", [1, "O", 2]],
            ["a5", [2, "O", 2]],
            ["a6", [3, "O", 2]],
        ]);
        expect(g.scoreRowCol("col", 0)).eq(1);
        g.board = new Map([
            ["a1", [1, "O", 1]],
            ["a2", [2, "O", 1]],
            ["a3", [3, "O", 1]],
            ["a4", [1, "O", 2]],
            ["a5", [2, "O", 2]],
            ["a6", [4, "O", 2]],
        ]);
        expect(g.scoreRowCol("col", 0)).eq(2);
        g.board = new Map([
            ["a1", [1, "O", 1]],
            ["b1", [2, "C", 1]],
            ["c1", [3, "D", 1]],
            ["d1", [1, "A", 2]],
            ["e1", [2, "O", 2]],
            ["f1", [3, "C", 2]],
        ]);
        expect(g.scoreRowCol("row", 5)).to.be.undefined;
        g.board = new Map([
            ["a1", [1, "O", 1]],
            ["b1", [2, "C", 1]],
            ["c1", [4, "D", 1]],
            ["d1", [1, "A", 2]],
            ["e1", [2, "O", 2]],
            ["f1", [3, "C", 2]],
        ]);
        expect(g.scoreRowCol("row", 5)).eq(1);
        g.board = new Map([
            ["a1", [1, "O", 1]],
            ["b1", [2, "C", 1]],
            ["c1", [3, "D", 1]],
            ["d1", [1, "A", 2]],
            ["e1", [2, "O", 2]],
            ["f1", [4, "C", 2]],
        ]);
        expect(g.scoreRowCol("row", 5)).eq(2);
    });

    it("Circles", () => {
        const g = new FnapGame();
        g.board = new Map([
            ["b5", [1, "O", 1]],
            ["c5", [2, "O", 1]],
            ["d5", [3, "O", 1]],
            ["b4", [1, "O", 2]],
            ["c4", [2, "C", 2]],
            ["d4", [3, "O", 2]],
            ["b3", [1, "O", 1]],
            ["c3", [2, "O", 1]],
            ["d3", [3, "O", 1]],
        ]);
        expect(g.scores).eql([0,0]);
        g.scoreCircles();
        expect(g.scores).eql([0,0]);

        g.scores = [0,0];
        g.board = new Map([
            ["b5", [1, "O", 1]],
            ["c5", [2, "O", 1]],
            ["d5", [3, "O", 1]],
            ["b4", [1, "D", 2]],
            ["c4", [2, "C", 2]],
            ["d4", [3, "D", 2]],
            ["b3", [1, "O", 1]],
            ["c3", [2, "O", 1]],
            ["d3", [3, "O", 1]],
        ]);
        expect(g.scores).eql([0,0]);
        g.scoreCircles();
        expect(g.scores).eql([0,2]);
    });
});

