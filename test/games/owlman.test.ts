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

    function scareStepPosition(): OwlmanGame {
        const g = new OwlmanGame();
        g.board.clear();
        g.board.set("h1", "D");
        g.board.set("a8", "H");
        g.board.set("a6", "O");
        g.board.set("c4", "H");
        g.currplayer = 2;
        return g;
    }

    it("incidental scare notation on step", () => {
        const g = scareStepPosition();
        expect(g.moves()).to.include("a6-b5");
        expect(g.moves()).to.not.include("a6-b5(xc4)");

        const v = g.validateMove("a6-b5");
        expect(v.valid).to.be.true;
        expect(v.complete).to.equal(1);

        const [a6x, a6y] = OwlmanGame.algebraic2coords("a6");
        const [b5x, b5y] = OwlmanGame.algebraic2coords("b5");
        const clickFrom = g.handleClick("", a6y, a6x);
        expect(clickFrom.valid).to.be.true;
        const clickTo = g.handleClick(clickFrom.move!, b5y, b5x);
        expect(clickTo.valid).to.be.true;
        expect(clickTo.complete).to.equal(1);
        expect(clickTo.move).to.equal("a6-b5(xc4)");

        const bare = scareStepPosition();
        bare.move("a6-b5");
        expect(bare.lastmove).to.equal("a6-b5(xc4)");
        expect(bare.board.has("c4")).to.be.false;

        const annotated = scareStepPosition();
        annotated.move("a6-b5(xc4)");
        expect(annotated.lastmove).to.equal("a6-b5(xc4)");
        expect(annotated.board.has("c4")).to.be.false;
        expect([...annotated.board.entries()]).to.deep.equal([...bare.board.entries()]);
        expect(annotated.currplayer).to.equal(bare.currplayer);
    });

    it("rejects wrong incidental capture suffix", () => {
        const g = scareStepPosition();
        const v = g.validateMove("a6-b5(xd4)");
        expect(v.valid).to.be.false;
    });

    it("round-trips stack with annotated lastmove", () => {
        const g = scareStepPosition();
        g.move("a6-b5(xc4)");
        const reloaded = new OwlmanGame(g.serialize());
        expect(reloaded.stack[reloaded.stack.length - 1].lastmove).to.equal("a6-b5(xc4)");
        expect(reloaded.board.has("c4")).to.be.false;
    });
});

