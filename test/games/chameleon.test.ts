/* eslint-disable no-unused-expressions */
/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { ChameleonGame } from '../../src/games';

describe("Chameleon", () => {
    it ("EOG: No pieces", () => {
        const g = new ChameleonGame();
        g.board.clear();
        g.board.set("a1", "AB");
        g.board.set("a2", "BB");
        g.move("a1xa2");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1]);
    });
    it ("EOG: Full infiltration", () => {
        const g = new ChameleonGame();
        g.board.clear();
        g.board.set("a1", "BB");
        g.board.set("a2", "AB");
        g.board.set("a5", "BW");
        g.move("a2-a3");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([2]);
    });
    it ("EOG: Last-minute infiltration", () => {
        const g = new ChameleonGame();
        g.board.clear();
        g.board.set("a4", "AB");
        g.board.set("a2", "BB");
        g.move("a4-a5");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1]);
    });
    it ("EOG: Full infiltration trumps last-minute infiltration", () => {
        const g = new ChameleonGame();
        g.board.clear();
        g.board.set("a1", "BB");
        g.board.set("a2", "BB");
        g.board.set("a4", "AW");
        g.move("a4-a5");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([2]);
    });
});

