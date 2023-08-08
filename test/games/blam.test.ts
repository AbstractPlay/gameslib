/* eslint-disable no-unused-expressions */
/* eslint-disable @typescript-eslint/no-unused-expressions */
/* tslint:disable:no-unused-expression */

import "mocha";
import { expect } from "chai";
import { BlamGame } from '../../src/games';

describe("Blam!", () => {
    it ("Converting coordinates to algebraic format", () => {
        expect(BlamGame.coords2algebraic(0, 0)).to.equal("a8");
        expect(BlamGame.coords2algebraic(7, 7)).to.equal("h1");
        expect(BlamGame.coords2algebraic(5, 5)).to.equal("f3");
    });
    it ("Converting algebraic format to coordinates", () => {
        expect(BlamGame.algebraic2coords("a8")).to.have.members([0, 0]);
        expect(BlamGame.algebraic2coords("h1")).to.have.members([7, 7]);
        expect(BlamGame.algebraic2coords("f3")).to.have.members([5, 5]);
    });
    it ("Pieces are captured correctly", () => {
        const g = new BlamGame(2);
        g.move("3a8");
        g.move("1b7");
        expect(g.board.has("b7")).to.be.true;
        expect(g.board.has("a8")).to.be.false;
        expect(g.scores[1]).to.equal(3);
        expect(g.caps[1]).to.equal(1);
    });
    it ("Pieces are reclaimed correctly", () => {
        const g = new BlamGame(2);
        g.board.set("a8", [1, 3]);
        g.move("1b7");
        expect(g.board.has("b7")).to.be.true;
        expect(g.board.has("a8")).to.be.false;
        expect(g.scores[0]).to.equal(0);
        expect(g.caps[0]).to.equal(0);
        const stash = g.stashes.get(1);
        if (stash === undefined) {
            throw new Error("This should never happen.");
        }
        expect(stash[0]).to.equal(4);
        expect(stash[1]).to.equal(5);
        expect(stash[2]).to.equal(6);
    });
    it ("EOG: Correctly triggered", () => {
        const g = new BlamGame(2);
        g.stashes.set(1, [1,0,0]);
        g.stashes.set(2, [0,0,0]);
        g.scores = [10, 5];
        g.caps = [5, 10];
        g.move("1a1");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1]);
    });
    it ("EOG: Two players, win by score", () => {
        const g = new BlamGame(2);
        g.stashes.set(1, [0,0,0]);
        g.stashes.set(2, [0,0,0]);
        g.scores = [10, 5];
        g.caps = [5, 10];
        g.move("pass");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1]);
    });
    it ("EOG: Two players, win by tie breaker", () => {
        const g = new BlamGame(2);
        g.stashes.set(1, [0,0,0]);
        g.stashes.set(2, [0,0,0]);
        g.scores = [10, 10];
        g.caps = [5, 10];
        g.move("pass");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([2]);
    });
    it ("EOG: Two players, draw", () => {
        const g = new BlamGame(2);
        g.stashes.set(1, [0,0,0]);
        g.stashes.set(2, [0,0,0]);
        g.scores = [10, 10];
        g.caps = [10, 10];
        g.move("pass");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1, 2]);
    });
    it ("EOG: Four players, win by score", () => {
        const g = new BlamGame(4);
        g.stashes.set(1, [0,0,0]);
        g.stashes.set(2, [0,0,0]);
        g.stashes.set(3, [0,0,0]);
        g.stashes.set(4, [0,0,0]);
        g.scores = [10, 9, 8, 7];
        g.caps = [10, 10, 10, 10];
        g.move("pass");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1]);
    });
    it ("EOG: Four players, win by tie breaker", () => {
        const g = new BlamGame(4);
        g.stashes.set(1, [0,0,0]);
        g.stashes.set(2, [0,0,0]);
        g.stashes.set(3, [0,0,0]);
        g.stashes.set(4, [0,0,0]);
        g.scores = [10, 10, 8, 7];
        g.caps = [10, 11, 13, 12];
        g.move("pass");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([2]);
    });
    it ("EOG: Four players, two-way draw", () => {
        const g = new BlamGame(4);
        g.stashes.set(1, [0,0,0]);
        g.stashes.set(2, [0,0,0]);
        g.stashes.set(3, [0,0,0]);
        g.stashes.set(4, [0,0,0]);
        g.scores = [10, 10, 8, 7];
        g.caps = [10, 10, 12, 14];
        g.move("pass");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1, 2]);
    });
});

