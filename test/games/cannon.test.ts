/* tslint:disable:no-unused-expression */
/* eslint-disable no-unused-expressions */
/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { CannonGame } from '../../src/games';
// import { RectGrid } from "../../src/common";

describe("Cannon", () => {
    it ("Converting coordinates to algebraic format", () => {
        expect(CannonGame.coords2algebraic(0, 0)).to.equal("a10");
        expect(CannonGame.coords2algebraic(9, 9)).to.equal("j1");
        expect(CannonGame.coords2algebraic(5, 5)).to.equal("f5");
    });
    it ("Converting algebraic format to coordinates", () => {
        expect(CannonGame.algebraic2coords("a10")).to.have.members([0, 0]);
        expect(CannonGame.algebraic2coords("j1")).to.have.members([9, 9]);
        expect(CannonGame.algebraic2coords("f5")).to.have.members([5, 5]);
    });
    it ("Forward motion is calculated correctly", () => {
        const g = new CannonGame();
        g.placed = true;
        g.board.clear();
        g.board.set("b5", [1, "s"]);
        g.board.set("e5", [2, "s"]);
        let m = g.moves(1);
        expect(m).to.have.members(["b5-b6", "b5-a6", "b5-c6"]);
        m = g.moves(2);
        expect(m).to.have.members(["e5-e4", "e5-f4", "e5-d4"]);
        g.board.set("b6", [1, "t"]);
        g.board.set("e4", [2, "t"]);
        m = g.moves(1);
        expect(m).to.have.members(["b5-a6", "b5-c6"]);
        m = g.moves(2);
        expect(m).to.have.members(["e5-f4", "e5-d4"]);
    });
    it ("Captures are calculated correctly", () => {
        const g = new CannonGame();
        g.placed = true;
        g.board.clear();
        g.board.set("d5", [1, "s"]);
        g.board.set("d6", [1, "t"]);
        g.board.set("c6", [2, "s"]);
        g.board.set("e6", [2, "s"]);
        g.board.set("c5", [2, "s"]);
        g.board.set("e5", [2, "s"]);
        g.board.set("c4", [2, "s"]);
        g.board.set("d4", [2, "s"]);
        g.board.set("e4", [2, "s"]);
        let m = g.moves(1);
        expect(m).to.have.members(["d5xc6", "d5xe6", "d5xc5", "d5xe5"]);
        g.board.clear();
        g.board.set("d5", [1, "s"]);
        g.board.set("d6", [2, "t"]);
        g.board.set("c6", [2, "s"]);
        g.board.set("e6", [2, "s"]);
        g.board.set("c5", [2, "s"]);
        g.board.set("e5", [2, "s"]);
        g.board.set("c4", [2, "s"]);
        g.board.set("d4", [2, "s"]);
        g.board.set("e4", [2, "s"]);
        m = g.moves(1);
        expect(m).to.have.members(["d5xc6", "d5xe6", "d5xc5", "d5xe5", "d5xd6"]);
        g.board.clear();
        g.board.set("d5", [2, "s"]);
        g.board.set("d4", [2, "t"]);
        g.board.set("c4", [1, "s"]);
        g.board.set("e4", [1, "s"]);
        g.board.set("c5", [1, "s"]);
        g.board.set("e5", [1, "s"]);
        g.board.set("c6", [1, "s"]);
        g.board.set("d6", [1, "s"]);
        g.board.set("e6", [1, "s"]);
        m = g.moves(2);
        expect(m).to.have.members(["d5xc4", "d5xe4", "d5xc5", "d5xe5"]);
        g.board.clear();
        g.board.set("b1", [1, "t"]);
        g.board.set("b2", [2, "s"]);
        m = g.moves(2);
        expect(m).to.include.members(["b2xb1"]);
    });
    it ("Retreats are calculated correctly", () => {
        const g = new CannonGame();
        g.placed = true;
        g.board.clear();
        g.board.set("d5", [1, "s"]);
        g.board.set("d6", [2, "s"]);
        let m = g.moves(1);
        expect(m).to.have.members(["d5xd6", "d5-c6", "d5-e6", "d5-d3", "d5-b3", "d5-f3"]);
        m = g.moves(2);
        expect(m).to.have.members(["d6xd5", "d6-c5", "d6-e5", "d6-d8", "d6-b8", "d6-f8"]);
        g.board.clear();
        g.board.set("d5", [1, "s"]);
        g.board.set("d4", [2, "s"]);
        m = g.moves(1);
        expect(m).to.have.members(["d5-c6", "d5-d6", "d5-e6", "d5-b3", "d5-f3"]);
        m = g.moves(2);
        expect(m).to.have.members(["d4-c3", "d4-d3", "d4-e3", "d4-b6", "d4-f6"]);
    });
    it ("Cannons work properly", () => {
        const g = new CannonGame();
        g.placed = true;
        g.board.clear();
        g.board.set("e4", [1, "s"]);
        g.board.set("e5", [1, "s"]);
        g.board.set("e6", [1, "s"]);
        g.board.set("e8", [2, "s"]);
        g.board.set("e9", [2, "s"]);
        g.board.set("e2", [2, "s"]);
        g.board.set("e1", [2, "s"]);
        let m = g.moves(1);
        expect(m).to.include.members(["e4-e7", "e6-e3", "xe8", "xe9", "xe2", "xe1"]);
        g.board.set("e3", [1, "s"]);
        g.board.set("e7", [1, "s"]);
        m = g.moves(1);
        expect(m).to.not.include.members(["e4-e7", "e6-e3", "xe8", "xe9", "xe2", "xe1"]);

        // Now actually execute the far capture
        g.board.delete("e3");
        g.board.delete("e7");
        g.move("xe9");
        expect(g.board.has("e9")).to.be.false;
    });
    // it ("Game ends properly", () => {
    //     let g = new CannonGame();
    //     // g.board.set("b1", [1, "t"]);
    //     // g.checkEOG();
    //     g.placed = true;
    //     g.move("b1")
    //     expect(g.gameover).to.be.true;
    //     expect(g.winner).to.have.members([1]);
    //     g = new CannonGame();
    //     g.placed = true;
    //     g.board.clear();
    //     g.board.set("a2", [1, "t"]);
    //     g.board.set("a10", [2, "t"]);
    //     g.currplayer = 2;
    //     g.move("d5");
    //     // g.board.set("d5", [2, "s"]);
    //     // g.checkEOG();
    //     expect(g.gameover).to.be.true;
    //     expect(g.winner).to.have.members([2]);
    // });
});

