/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { WunchunkGame } from '../../src/games';

describe("Wunchunk", () => {
    it ("Consecutive passes end the game", () => {
        let g = new WunchunkGame(2);
        g.move("pass");
        expect(g.gameover).to.be.false;
        g.move("pass");
        expect(g.gameover).to.be.true;
        g = new WunchunkGame(3);
        g.move("pass");
        expect(g.gameover).to.be.false;
        g.move("pass");
        expect(g.gameover).to.be.false;
        g.move("pass");
        expect(g.gameover).to.be.true;
        g = new WunchunkGame(4);
        g.move("pass");
        expect(g.gameover).to.be.false;
        g.move("pass");
        expect(g.gameover).to.be.false;
        g.move("pass");
        expect(g.gameover).to.be.false;
        g.move("pass");
        expect(g.gameover).to.be.true;
    });
});

