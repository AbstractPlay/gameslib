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
            "1d8",
            "2h3",
            "1e8",
            "pass",
            "pass",
        ];
        moves.forEach(m => {
            g.move(m);
        });
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1]);
    });
    it ("Balance check", () => {
        // 2 player standard
        let g = new WunchunkGame(2);
        g.move("1a4");
        g.move("2k4");
        expect(g.checkForBalance).to.be.true;
        let result = g.validateMove("1b4");
        expect(result.valid).to.be.false;
        // 2 player open - pass
        g = new WunchunkGame(2, ["open"]);
        g.move("1e4,1f4,2f5,2f6");
        g.move("pass");
        g.move("1f7")
        g.move("2g4")
        expect(g.checkForBalance).to.be.true;
        result = g.validateMove("1f8");
        expect(result.valid).to.be.false;
        // 2 player open - swap
        g = new WunchunkGame(2, ["open"]);
        g.move("1e4,1f4,2f5,2f6");
        g.move("swap");
        g.move("1f7")
        g.move("2g4")
        expect(g.checkForBalance).to.be.true;
        result = g.validateMove("1f8");
        expect(result.valid).to.be.false;
        // 3 player
        g = new WunchunkGame(3);
        g.move("1l3");
        g.move("2k8");
        g.move("3f10");
        expect(g.checkForBalance).to.be.true;
        result = g.validateMove("1m2");
        expect(result.valid).to.be.false;
        // 4 player
        g = new WunchunkGame(4);
        g.move("1l3");
        g.move("2k8");
        g.move("3f10");
        g.move("4d3");
        expect(g.checkForBalance).to.be.true;
        result = g.validateMove("1m2");
        expect(result.valid).to.be.false;
    });
});
