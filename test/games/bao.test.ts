/* eslint-disable no-unused-expressions */
/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { BaoGame } from '../../src/games';
// import { BaoGraph } from "../../src/common";

describe("Bao", () => {
    it ("Cloning", () => {
        const g = new BaoGame();
        const cloned = BaoGame.clone(g);
        cloned.board[0] = [1,1,1,1,1,1,1,1];
        expect(g.board[0]).not.eql(cloned.board[0]);
    });

    it ("Move processing", () => {
        const g = new BaoGame();
        // basic starting moves
        let cloned = BaoGame.clone(g);
        let results = cloned.processMove("f2>*");
        expect(cloned.board[2][0]).eq(0);
        expect(cloned.board[2][1]).eq(0);
        expect(cloned.board[2][2]).eq(0);
        expect(cloned.board[2][3]).eq(0);
        expect(cloned.board[2][4]).eq(6);
        expect(cloned.board[2][5]).eq(0);
        expect(cloned.board[2][6]).eq(3);
        expect(cloned.board[2][7]).eq(1);
        expect(cloned.board[3][7]).eq(1);
        expect(results.captured.cells.length).eq(0);
        expect(results.captured.stones).eq(0);
        expect(results.complete).to.be.true;
        expect(results.infinite).to.be.false;
        expect(results.sown).eql(["f2"]);

        cloned = BaoGame.clone(g);
        results = cloned.processMove("b3<*");
        expect(cloned.board[1][0]).eq(0);
        expect(cloned.board[1][1]).eq(0);
        expect(cloned.board[1][2]).eq(3);
        expect(cloned.board[1][3]).eq(7);
        expect(cloned.board[1][4]).eq(1);
        expect(cloned.board[1][5]).eq(0);
        expect(cloned.board[1][6]).eq(0);
        expect(cloned.board[1][7]).eq(0);
        expect(cloned.board[0][0]).eq(0);
        expect(results.captured.cells.length).eq(0);
        expect(results.captured.stones).eq(0);
        expect(results.complete).to.be.true;
        expect(results.infinite).to.be.false;
        expect(results.sown).eql(["b3"]);

        cloned = BaoGame.clone(g);
        cloned.board = [
            [0,0,0,0,0,0,0,0],
            [0,1,2,6,1,0,0,0],
            [0,0,0,0,6,1,2,0],
            [0,0,0,0,0,0,0,0],
        ];
        results = cloned.processMove("e2>");
        expect(cloned.board[1]).eql([0,1,2,6,0,0,0,0]);
        expect(cloned.board[2]).eql([0,0,0,0,7,1,2,1]);
        expect(results.captured.cells).eql(["e3"]);
        expect(results.captured.stones).eq(1);

        cloned = BaoGame.clone(g);
        cloned.board = [
            [0,0,0,0,0,0,0,0],
            [0,1,2,6,1,0,0,0],
            [0,0,0,0,6,1,2,0],
            [0,0,0,0,0,0,0,0],
        ];
        results = cloned.processMove("e2<");
        expect(cloned.board[1]).eql([0,1,2,6,0,0,0,0]);
        expect(cloned.board[2]).eql([1,0,0,0,7,1,2,0]);
        expect(results.captured.cells).eql(["e3"]);
        expect(results.captured.stones).eq(1);

        cloned = BaoGame.clone(g);
        cloned.board = [
            [0,0,0,0,0,0,0,0],
            [0,3,1,6,0,1,0,0],
            [0,1,0,0,7,1,0,0],
            [0,0,0,0,0,0,0,0],
        ];
        results = cloned.processMove("b2<");
        expect(cloned.board[1]).eql([0,0,1,6,0,1,0,0]);
        expect(cloned.board[2]).eql([1,3,1,0,7,1,0,0]);
        expect(results.captured.cells).eql(["b3"]);
        expect(results.captured.stones).eq(3);

        cloned = BaoGame.clone(g);
        cloned.board = [
            [0,0,0,0,0,0,0,0],
            [0,0,2,6,1,1,0,0],
            [0,0,0,0,6,1,1,1],
            [0,0,0,0,0,0,0,0],
        ];
        results = cloned.processMove("e2>");
        expect(cloned.board[1]).eql([0,0,2,6,0,0,0,0]);
        expect(cloned.board[2]).eql([0,0,0,0,7,2,2,1]);
        expect(results.captured.cells).eql(["e3", "f3"]);
        expect(results.captured.stones).eq(2);

        cloned = BaoGame.clone(g);
        cloned.board = [
            [0,0,0,0,0,0,0,0],
            [0,2,2,6,0,7,0,0],
            [0,1,0,0,7,1,0,0],
            [0,0,0,0,0,0,0,0],
        ];
        results = cloned.processMove("f2>");
        expect(cloned.board[1]).eql([0,0,2,6,0,0,0,0]);
        expect(cloned.board[2]).eql([1,0,2,2,9,3,1,1]);
        expect(results.captured.cells).eql(["f3", "b3"]);
        expect(results.captured.stones).eq(9);

        cloned = BaoGame.clone(g);
        cloned.board = [
            [0,0,0,0,0,0,0,0],
            [5,0,2,6,0,0,0,0],
            [1,0,2,2,7,0,0,0],
            [0,0,0,0,0,0,0,0],
        ];
        results = cloned.processMove("a2>");
        expect(cloned.board[1]).eql([0,0,2,6,0,0,0,0]);
        expect(cloned.board[2]).eql([3,1,3,3,8,0,0,0]);
        expect(results.captured.cells).eql(["a3"]);
        expect(results.captured.stones).eq(5);
        expect(results.complete).to.be.false;

        cloned = BaoGame.clone(g);
        cloned.board = [
            [0,0,0,0,0,0,0,0],
            [5,0,2,6,0,0,0,0],
            [1,0,2,2,7,0,0,0],
            [0,0,0,0,0,0,0,0],
        ];
        results = cloned.processMove("a2>+");
        expect(cloned.board[1]).eql([0,0,2,6,0,0,0,0]);
        expect(cloned.board[2]).eql([3,1,3,3,0,1,1,1]);
        expect(cloned.board[3]).eql([0,0,0,1,1,1,1,1]);
        expect(results.captured.cells).eql(["a3"]);
        expect(results.captured.stones).eq(5);
        expect(results.complete).to.be.true;

        cloned = BaoGame.clone(g);
        cloned.board = [
            [0,0,0,0,0,0,0,0],
            [0,2,0,6,0,2,0,0],
            [0,0,0,0,6,0,0,0],
            [0,0,0,0,1,0,0,2],
        ];
        results = cloned.processMove("e2<*");
        expect(cloned.board[1]).eql([0,2,0,6,0,2,0,0]);
        expect(cloned.board[2]).eql([0,0,1,1,5,0,0,0]);
        expect(results.captured.cells).eql([]);
        expect(results.captured.stones).eq(0);
        expect(results.complete).to.be.true;
        expect(results.sown).eql(["e2"]);

        cloned = BaoGame.clone(g);
        cloned.inhand = [0,0];
        cloned.board = [
            [0,0,0,0,0,0,0,0],
            [0,1,2,2,0,1,0,0],
            [0,0,1,3,1,0,2,0],
            [0,0,0,0,3,0,0,2],
        ];
        results = cloned.processMove("d2>*");
        expect(cloned.board[2]).eql([0,0,1,0,2,1,0,1]);
        expect(cloned.board[3]).eql([0,0,0,0,3,0,1,3]);
        expect(results.captured.cells).eql([]);
        expect(results.captured.stones).eq(0);
        expect(results.complete).to.be.true;
        expect(results.sown).eql(["d2", "g2"]);

        cloned = BaoGame.clone(g);
        cloned.inhand = [0,0];
        cloned.board = [
            [0,0,0,0,0,0,0,0],
            [0,1,2,0,1,0,0,0],
            [0,0,0,1,1,0,1,0],
            [0,0,0,0,3,0,0,2],
        ];
        results = cloned.processMove("h1>*");
        expect(cloned.board[1]).eql([0,1,2,0,1,0,0,0]);
        expect(cloned.board[2]).eql([0,0,1,2,0,1,0,1]);
        expect(cloned.board[3]).eql([0,0,0,0,3,0,0,0]);
        expect(results.captured.cells).eql([]);
        expect(results.captured.stones).eq(0);
        expect(results.complete).to.be.true;
        expect(results.sown).eql(["h1", "g2", "e2"]);

        cloned = BaoGame.clone(g);
        cloned.inhand = [0,0];
        cloned.board = [
            [0,0,0,0,0,0,0,0],
            [0,0,0,1,3,1,6,0],
            [0,3,2,1,1,0,1,0],
            [0,0,0,0,0,2,3,1],
        ];
        results = cloned.processMove("b2>");
        expect(cloned.board[1]).eql([0,0,0,1,0,1,0,0]);
        expect(cloned.board[2]).eql([1,1,1,4,4,2,3,1]);
        expect(cloned.board[3]).eql([0,0,0,0,0,2,3,1]);
        expect(results.captured.cells).eql(["e3", "g3"]);
        expect(results.captured.stones).eq(9);
        expect(results.complete).to.be.true;
        expect(results.sown).eql(["b2", "c2"]);
    });

    it("Kutakatia", () => {
        let g = new BaoGame();
        g.inhand = [0,0];
        g.board = [
            [0,0,0,0,0,0,0,0],
            [0,5,0,0,1,0,2,0],
            [0,1,0,0,0,0,1,0],
            [0,2,3,0,0,0,0,0],
        ];
        g.move("c1<*");
        let blocked = g.getBlocked(2);
        expect(blocked).eq("b3");
        expect(g.lastmove).eq("c1<**");

        g = new BaoGame();
        g.inhand = [0,0];
        g.board = [
            [0,0,0,0,0,0,0,0],
            [0,6,0,0,2,0,2,0],
            [0,0,1,0,0,1,0,0],
            [2,3,0,0,0,0,4,0],
        ];
        g.move("a1<*");
        blocked = g.getBlocked(2);
        expect(blocked).eq("b3");
        expect(g.lastmove).eq("a1<**");
        // player 2 makes a kutakata move, setting up a second capture for south
        g.move("g3>*");
        expect(g.board[1]).eql([0,7,1,1,0,1,0,0]);
        expect(g.blocked).eql([undefined, "b3"]);
        // but south is required to capture the blocked pit
        expect(g.moves()).eql(["b1<"]);
    });

    it("Infinite loops", () => {
        const g = new BaoGame();
        g.board = [
            [2,1,2,3,2,4,0,3],
            [0,2,0,0,3,0,0,0],
            [1,0,2,1,0,1,2,1],
            [2,0,1,2,0,1,2,0],
        ];
        let results = g.processMove("g2>*");
        expect(results.infinite).to.be.true;

        g.board = [
            [2,2,2,3,4,4,5,3],
            [0,0,0,5,0,6,0,0],
            [3,2,1,0,1,0,5,4],
            [1,0,1,2,0,1,2,3],
        ];
        results = g.processMove("a2>*");
        expect(results.infinite).to.be.true;
    });
});

