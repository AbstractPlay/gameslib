/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { KnightLineGame } from '../../src/games';

describe("KnightLine", () => {
    const g = new KnightLineGame(2);
    it ("Converts to algebraic coordinates", () => {
        expect(g.absCoords2algebraic(-350,0)).to.equal("na0");
        expect(g.absCoords2algebraic(-65,0)).to.equal("xz0");
        expect(g.absCoords2algebraic(-64,0)).to.equal("ya0");
        /* expect(g.absCoords2algebraic(-52,0)).to.equal("ym0");
        expect(g.absCoords2algebraic(-40,0)).to.equal("yy0");
        expect(g.absCoords2algebraic(-39,0)).to.equal("yz0");
        expect(g.absCoords2algebraic(-38,0)).to.equal("za0");
        expect(g.absCoords2algebraic(-37,0)).to.equal("zb0");
        expect(g.absCoords2algebraic(-26,0)).to.equal("zm0");
        expect(g.absCoords2algebraic(-15,0)).to.equal("zx0");
        expect(g.absCoords2algebraic(-14,0)).to.equal("zy0");*/
        expect(g.absCoords2algebraic(-13,0)).to.equal("zz0");
        expect(g.absCoords2algebraic(-12,0)).to.equal("a0");
        expect(g.absCoords2algebraic(-7,0)).to.equal("f0");
        expect(g.absCoords2algebraic(0,0)).to.equal("m0");
        expect(g.absCoords2algebraic(5,0)).to.equal("r0");
        /*expect(g.absCoords2algebraic(13,0)).to.equal("z0");
        expect(g.absCoords2algebraic(14,0)).to.equal("aa0");
        expect(g.absCoords2algebraic(26,0)).to.equal("am0");
        expect(g.absCoords2algebraic(39,0)).to.equal("az0");
        expect(g.absCoords2algebraic(40,0)).to.equal("ba0");
        expect(g.absCoords2algebraic(52,0)).to.equal("bm0");
        expect(g.absCoords2algebraic(65,0)).to.equal("bz0");*/
        expect(g.absCoords2algebraic(66,0)).to.equal("ca0");
        expect(g.absCoords2algebraic(351,0)).to.equal("mz0");
        //These are not allowed in the other direction due to ambiguity.
        expect(g.absCoords2algebraic(352,0)).to.equal("na0");
        expect(g.absCoords2algebraic(-351,0)).to.equal("mz0");

        expect(g.absCoords2algebraic(0,5)).to.equal("m-5");
        expect(g.absCoords2algebraic(0,-5)).to.equal("m5");
    });
    
    it ("Converts from algebraic coordinates", () => {

        expect(g.algebraic2absCoords("m0")).to.deep.equal([0,0]);
        expect(g.algebraic2absCoords("m5")).to.deep.equal([0,-5]);
        expect(g.algebraic2absCoords("m-5")).to.deep.equal([0,5]);

        expect(() => g.algebraic2absCoords("")).to.throw();
        expect(() => g.algebraic2absCoords("0")).to.throw();
        expect(() => g.algebraic2absCoords("aaa")).to.throw();

        expect(g.algebraic2absCoords("na0")).to.deep.equal([-350,0]);
        expect(g.algebraic2absCoords("xz0")).to.deep.equal([-65,0]);
        /*expect(g.algebraic2absCoords("ya0")).to.deep.equal([-64,0]);
        expect(g.algebraic2absCoords("za0")).to.deep.equal([-38,0]);
        expect(g.algebraic2absCoords("zz0")).to.deep.equal([-13,0]);*/
        expect(g.algebraic2absCoords("a0")).to.deep.equal([-12,0]);
        expect(g.algebraic2absCoords("m0")).to.deep.equal([0,0]);
        expect(g.algebraic2absCoords("y0")).to.deep.equal([12,0]);
        expect(g.algebraic2absCoords("z0")).to.deep.equal([13,0]);
        /*expect(g.algebraic2absCoords("aa0")).to.deep.equal([14,0]);
        expect(g.algebraic2absCoords("ac0")).to.deep.equal([16,0]);
        expect(g.algebraic2absCoords("az0")).to.deep.equal([39,0]);*/
        expect(g.algebraic2absCoords("mz0")).to.deep.equal([351,0]);

        expect(g.algebraic2absCoords("m4")).to.deep.equal([0,-4]);
        expect(g.algebraic2absCoords("m-3")).to.deep.equal([0,3]);
    });

    it ("Converts to/from relative coordinates", () => {
        //These are the relative coordinates of the initial board.
        expect(g.abs2relCoords(0,0)).to.deep.equal([1,1]);
        expect(g.rel2absCoords(1,1)).to.deep.equal([0,0]);
        
        expect(g.algebraic2relCoords("m0")).to.deep.equal([1,1]);
        expect(g.relCoords2algebraic(1,1)).to.equal("m0");
        
        expect(g.abs2relCoords(1,0)).to.deep.equal([2,1]);
        expect(g.rel2absCoords(2,1)).to.deep.equal([1,0]);
  
        expect(g.algebraic2relCoords("n0")).to.deep.equal([2,1]);
        expect(g.relCoords2algebraic(2,1)).to.equal("n0");
    });
    
    it ("Renders the starting board", () => {
        g.render();
    });

    it ("Validates partial moves", () => {
        //There are two equivalent first moves.
        let result = g.validateMove("m0");
        expect(result.valid).to.be.true;

        result = g.validateMove("m0,");
        expect(result.valid).to.be.true;

        result = g.validateMove("m0,n1");
        expect(result.valid).to.be.false;

        result = g.validateMove("m0,o1");
        expect(result.valid).to.be.true;

        result = g.validateMove("m0,o1,");
        expect(result.valid).to.be.true;
    });

    it ("Validates full moves", () => {

        let result = g.validateMove("m0,n2,1");
        expect(result.valid).to.be.false;

        result = g.validateMove("m0,n1,1");
        expect(result.valid).to.be.false;

        result = g.validateMove("m0,o1,5");
        expect(result.valid).to.be.false;

        result = g.validateMove("m0,o1,1");
        expect(result.valid).to.be.true;

        const ge = new KnightLineGame(2,["blocker"]);
        result = ge.validateMove("m0");
        expect(result.valid).to.be.false;
    });

    it ("Makes moves", () => {
        g.move("m0,o1,1");
        g.move("n0,o2,10");
        g.move("m0,n2,13");
        g.move("o2,m1,5");
        g.randomMove();
        g.randomMove();
        g.randomMove();
        g.randomMove();
    });

    it ("Ends prematurely when appropriate", () => {
        //Shortest game puzzle from the BGG forum.
        const gp = new KnightLineGame(2);
        gp.move("m0,o-1,1");
        gp.move("n0,o-2,1");

        gp.move("m0,n-2,18");
        gp.move("n0,l1,18");

        gp.move("n-2,p-3,17");
        gp.move("l1,m-1,1");

        gp.move("pass");
        gp.move("pass");
        expect(gp.gameover).to.be.true;
    });

    it ("Ends maturely when appropriate", () => {
        //A short game, with randomish moves for player 2.
        const gp = new KnightLineGame(2);
        gp.move("m0,o1,1");
        gp.move("n0,p1,10");

        gp.move("m0,n2,10,");
        gp.move("p1,o3,5");
        
        gp.move("n2,l1,5");
        gp.move("n0,l-1,3");
        
        gp.move("l1,m3,3");
        gp.move("o3,q2,4");
        
        gp.move("m3,k2,2");
        gp.move("q2,p4,3");
        
        gp.move("k2,l4,1");
        expect(gp.gameover).to.be.true;
    });

});
