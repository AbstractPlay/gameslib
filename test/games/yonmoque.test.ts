/* eslint-disable no-unused-expressions */
/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { YonmoqueGame } from '../../src/games';

describe("Yonmoque", () => {
    it ("Placing doesn't flip", () => {
        const g = new YonmoqueGame();
        g.board.set("a1", 1);
        g.board.set("a2", 2);
        g.move("a3");
        expect(g.board.get("a2")).to.equal(2);
    });
    it ("Moving does", () => {
        const g = new YonmoqueGame();
        g.board.set("a1", 1);
        g.board.set("a2", 2);
        g.board.set("a4", 1)
        g.move("a4-a3");
        expect(g.board.get("a2")).to.equal(1);
    });
    it ("Placing a fifth loses", () => {
        const g = new YonmoqueGame();
        g.board.set("a1", 1);
        g.board.set("a2", 1);
        g.board.set("a3", 1);
        g.board.set("a4", 1);
        g.move("a5");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([2]);
    });
    it ("Moving a fifth loses", () => {
        const g = new YonmoqueGame();
        g.board.set("a1", 1);
        g.board.set("a2", 1);
        g.board.set("a3", 1);
        g.board.set("a4", 1);
        g.board.set("b5", 1);
        g.move("b5-a5");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([2]);
    });
    it ("Placing a fourth does nothing", () => {
        const g = new YonmoqueGame();
        g.board.set("a1", 1);
        g.board.set("a2", 1);
        g.board.set("a3", 1);
        g.move("a4");
        expect(g.gameover).to.be.false;
    });
    it ("Moving a fourth wins", () => {
        const g = new YonmoqueGame();
        g.board.set("a1", 1);
        g.board.set("a2", 1);
        g.board.set("a3", 1);
        g.board.set("b4", 1);
        g.move("b4-a4");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1]);
    });
    it ("Flipping a fourth wins", () => {
        const g = new YonmoqueGame();
        g.board.set("b4", 1);
        g.board.set("c4", 2);
        g.board.set("a3", 1);
        g.board.set("a2", 1);
        g.board.set("b2", 2);
        g.board.set("c2", 1);
        g.board.set("d2", 1);
        g.board.set("a1", 1);
        g.move("b4-c3");
        const contents = g.board.get("b2");
        expect(contents).eq(1);
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1]);
    });
});

