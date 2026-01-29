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
    it ("Correct winner after swapping", () => {
        const g = new WunchunkGame(2, ["hex5", "open"]);
        const moves = [
            "1e4,1f4,2f5,2f6",
            "swap",
            // "pass",
            "1f7",
            "2g4",
            "1f8",
            "2h3",
            "1d3,1e7",
            "pass",
            "pass",
        ];
        moves.forEach(m => {
            g.move(m);
        });
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1]);
    });
});
