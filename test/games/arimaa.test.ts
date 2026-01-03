/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { ArimaaGame } from '../../src/games';

describe("Arimaa", () => {
    it ("EOG scenarios", () => {
        // all rabbits on same turn
        let g = new ArimaaGame(undefined, ["free"]);
        g.move("Rc3,Ed3");
        g.move("re3,ee5");
        g.move("re3f3,Ed3e3");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1]);

        // no possible moves (all frozen or blocked in)
        g = new ArimaaGame(undefined, ["free"]);
        g.move("Rd4, Eh1");
        g.move("hd5, eh2, eg1, rg6");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([2]);

        // pushing a rabbit onto the goal then pulling it off doesn't end the game
        g = new ArimaaGame(undefined, ["free"]);
        g.move("Ed2, Rb7");
        g.move("eg7, re2");
        g.move("re2e1, Ed2e2, Ee2e3, re1e2");
        expect(g.gameover).to.be.false;

        // both at same time, person who just moved wins
        g = new ArimaaGame(undefined, ["free"]);
        g.move("Rd7, Ee2");
        g.move("rd2");
        g.move("Rd7d8, rd2d1, Ee2d2");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1]);
    });

    it ("Free placement", () => {
        const g = new ArimaaGame(undefined, ["free"]);
        // can place anywhere
        let result = g.validateMove("Ec3");
        expect(result.valid).to.be.true;
        expect(result.complete).to.equal(-1);
        // must place a rabbit
        result = g.validateMove("Ec3,Rd4");
        expect(result.valid).to.be.true;
        expect(result.complete).to.equal(0);
        // can't place a rabbit on the goal row
        result = g.validateMove("Ec3,Rd4,Rd8");
        expect(result.valid).to.be.true;
        expect(result.complete).to.equal(-1);
        g.move("Ec3,Rd4");
        g.move("ed5,rd6");
        // traps trigger after setup
        expect(g.board.get("c3")).to.be.undefined;
        // setup phase ends correctly
        result = g.validateMove("Ec3");
        expect(result.valid).to.be.false;
    });

    it ("General setup issues", () => {
        // can't place opposing pieces manually
        let g = new ArimaaGame();
        g.move("ee2,Md2,Hb2,Hg2,Ra2,Ra1,Rb1,Rc1,Rf1,Rg1,Rh1,Rh2,Cf2,Cc2,Dd1,De1");
        const [pc, owner] = g.board.get("e2")!;
        expect(pc).to.equal("E");
        expect(owner).to.equal(1);

        // warnings
        g = new ArimaaGame();
        g.move("Ee2,Md2,Hb2,Hg2,Ra2,Ra1,Rb1,Rc1,Rf1,Rg1,Rh1,Rh2,Cf2,Cc2,Dd1,De1");
        // no warnings
        let result = g.validateMove("me7,ed7,hb7,hg7,ra7,ra8,rb8,rc8,rf8,rg8,rh8,rh7,cf7,de8,cd8,dc7");
        expect(result.message).to.be.undefined;
        // same file
        result = g.validateMove("ee7,md7,hb7,hg7,ra7,ra8,rb8,rc8,rf8,rg8,rh8,rh7,cf7,de8,cd8,dc7");
        expect(result.message).to.equal(" WARN");
        // unbalanced
        result = g.validateMove("ea7,mb7,hc7,hd7,ce7,df7,dg7,ch7,ra8,rb8,rc8,rd8,re8,rf8,rg8,rh8");
        expect(result.message).to.equal(" WARN");
        // hiding
        result = g.validateMove("ed7,me7,hb7,hg7,ra7,ra8,rb8,rc8,rg8,rh8,rh7,cf8,rf7,cd8,de8,dc7");
        expect(result.message).to.be.undefined;
        result = g.validateMove("ed7,hb7,hg7,ra7,ra8,rb8,rc8,rf8,rg8,rh8,rh7,cf7,ce7,dc7,dd8,me8");
        expect(result.message).to.equal(" WARN");
    });
});

