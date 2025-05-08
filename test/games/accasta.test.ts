/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { AccastaGame } from '../../src/games';

describe("Accasta", () => {
    it ("EOG Timing", () => {
        const g = new AccastaGame();
        g.board.clear();
        g.board.set("e3", [["S", 1]]);
        g.board.set("e4", [["S", 1]]);
        g.board.set("f1", [["S", 1]]);
        g.board.set("a1", [["S", 2]]);
        g.board.set("a2", [["S", 2]]);
        g.board.set("b5", [["S", 2]]);
        g.stack.push(g.moveState());
        g.move("f1:-g1");
        expect(g.gameover).to.be.false;
        g.move("b5:-a4")
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1]);
    });
});

