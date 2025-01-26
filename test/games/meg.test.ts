/* eslint-disable no-unused-expressions */
/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { MegGame } from "../../src/games";

describe("Meg", () => {
    it ("EOG scenarios", () => {
        // no nutmeg
        let g = new MegGame();
        g.board.set("i9", "CUP");
        g.board.set("c8", "CUP");
        g.board.set("g6", "CUP");
        g.board.set("i6", "CAP");
        g.board.set("h5", "BALL");
        g.board.set("i5", "CUP");
        g.board.set("g4", "CAP");
        g.board.set("h4", "CAP");
        g.board.set("d3", "CUP");
        g.board.set("f2", "CUP");
        g.offense = 1;
        g.countdown = 10;
        g.move("h5-g6");
        expect(g.gameover).to.be.false;

        // nutmeg but too close
        g = new MegGame();
        g.board.set("i9", "CUP");
        g.board.set("c8", "CUP");
        g.board.set("g6", "CUP");
        g.board.set("i6", "CAP");
        g.board.set("h5", "BALL");
        g.board.set("i5", "CUP");
        g.board.set("g4", "CAP");
        g.board.set("h4", "CAP");
        g.board.set("e4", "CUP");
        g.board.set("f2", "CUP");
        g.offense = 1;
        g.countdown = 10;
        g.move("h5-g6-e4");
        expect(g.gameover).to.be.false;

        // just right
        g = new MegGame();
        g.board.set("i9", "CUP");
        g.board.set("c8", "CUP");
        g.board.set("g6", "CUP");
        g.board.set("i6", "CAP");
        g.board.set("h5", "BALL");
        g.board.set("i5", "CUP");
        g.board.set("g4", "CAP");
        g.board.set("h4", "CAP");
        g.board.set("d3", "CUP");
        g.board.set("f2", "CUP");
        g.offense = 1;
        g.countdown = 10;
        g.move("h5-g6-d3");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1]);

        // clock counts down
        g = new MegGame();
        g.move("a1");
        g.move("b1");
        g.move("c1");
        g.move("*c1");
        g.move("d1");
        g.move("e1");
        g.move("f1");
        g.move("g1");
        g.move("h1");
        g.move("i1");
        g.move("j1");
        g.move("a2");
        g.move("b2");
        g.move("c2");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1]);
    });
});

