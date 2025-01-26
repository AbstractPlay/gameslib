/* eslint-disable no-unused-expressions */
/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { MegGame } from "../../src/games";

describe("Meg", () => {
    it ("EOG scenarios", () => {
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
    });
});

