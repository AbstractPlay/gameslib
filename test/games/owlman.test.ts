/* eslint-disable no-unused-expressions */
/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { OwlmanGame } from '../../src/games';

describe("Owlman", () => {
    it ("In position", () => {
        const g = new OwlmanGame();
        g.board.clear();
        g.board.set("a8", "D");
        g.board.set("c6", "H");
        g.board.set("h1", "O");
        g.move("c6-b7");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1]);
    });
    it ("Owlman trapped", () => {
        const g = new OwlmanGame();
        g.board.clear();
        g.board.set("a4", "H");
        g.board.set("c4", "H");
        g.board.set("c2", "H");
        g.board.set("e2", "H");
        g.board.set("b3", "H");
        g.move("b3-a2");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1]);
    });
    it ("Doc killed", () => {
        const g = new OwlmanGame();
        g.board.clear();
        g.board.set("h1", "D");
        g.board.set("h5", "H");
        g.board.set("g2", "O");
        g.move("h5-g6");
        g.move("g2xh1");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([2]);
    });
    it ("No helpers", () => {
        const g = new OwlmanGame();
        g.board.clear();
        g.board.set("h1", "D");
        g.board.set("h5", "H");
        g.board.set("e8", "O");
        g.move("h5-g6");
        g.move("e8-f7");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([2]);
    });
    it ("Super swoop", () => {
        const g = new OwlmanGame();
        g.board.clear();
        g.board.set("b1", "D");
        g.board.set("b3", "H");
        g.board.set("b5", "H");
        g.board.set("h1", "O");
        g.move("b5-c6");
        const allMoves = g.moves();
        const allcaps = allMoves.reduce((prev, curr) => prev && curr.includes("x"), true);
        expect(allcaps).to.be.true;
        expect(allMoves).to.have.members(["h1xb3", "h1xc6"]);
    });
});

