/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { BrickaGame } from '../../src/games';

function state(p1s: string[], p2s: string[], neutrals: string[]): BrickaGame {
    const g = new BrickaGame();
    for(const m of p1s){
        g.board.set(m, 1);
    }
    for(const m of p2s){
        g.board.set(m, 2);
    }
    for(const m of neutrals){
        g.board.set(m, 'neutral');
    }
    return g;
}

/* Various end conditions.
Test with both p1 and p2 as the current player:
current player wins with normal stone
neutral stone, current player wins with only loop
neutral stone, other player wins with only loop
neutral stone, current player wins with shortest loop
neutral stone, other player wins with shortest loop
neutral stone, current player wins with equally long loop but fewer neutrals
neutral stone, other player wins with equally long loop but fewer neutrals
neutral stone, two loops of equal size and #neutrals, p2 wins
*/

describe.only("Bricka", () => {
    it("p1 win with partisan stone placement", () => {
        const g = state(
            ['c4', 'd5', 'e6', 'f6', 'g7', 'h8', 'i8', 'k10'],
            [],
            []);
        g.move('j9');
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1]);
    });
    it("p2 win with partisan stone placement", () => {
        const g = state(
            [],
            ['e11', 'e10', 'f10', 'f9', 'h9', 'h8', 'i8', 'i7', 'k7', 'l6'],
            []);
        g.move('f1');
        g.move('k6');
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([2]);
    });
    it("p1 win with neutral stone placed by p1", () => {
        const g = state(
            ['a7', 'b8', 'c8', 'c7', 'e7', 'e6', 'f6', 'h8', 'i8', 'i7', 'k7', 'k8', 'l8', 'm7'],
            [],
            []);
        g.move('g7');
        expect(g.board.get('g7')).to.equal("neutral");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1]);
    });
    it("p1 win with neutral stone placed by p2", () => {
        const g = state(
            ['c4', 'd5', 'e6', 'f6', 'h8', 'i8', 'j9', 'k10'],
            ['f5', 'h5'],
            []);
        g.move('f1');
        g.move('g7');
        expect(g.board.get('g7')).to.equal("neutral");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1]);
    });
    it("p2 win with neutral stone placed by p1", () => {
        const g = state(
            ['f5', 'h5'],
            ['c4', 'd5', 'e6', 'f6', 'h8', 'i8', 'j9', 'k10'],
            []);
        g.move('g7');
        expect(g.board.get('g7')).to.equal("neutral");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([2]);
    });

    it("p1 win on full board", () => {
        const moves = ['h12','k4','i8','i2','f2','g7','c6','e10','b6','k8','i10','l10','e12','c7','e4','k6','d9','i6','i12','c11','h1','k11','e11','b8','j5','b4','c3','l4','e6','h5','k3','k10','f1','f4','b10','l6','i4','f13','f8','h6','d5','l8','f12','e8','e2','j9','a7','e3','k7','c4','g3','f6','g11','e7','f10','i3','c10','h13','h4','f9','h2','h9','f5','h10','m7','i11','h8','c8','i7']
        const g = new BrickaGame()
        for(const m of moves) {
            g.move(m);
        }
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1]);
    });
    it("p2 win on full board", () => {
        const moves = ['h12','k4','i8','f2','g7','c6','e10','b6','k8','i10','l10','e12','c7','e4','k6','d9','i6','i12','c11','h1','k11','e11','b8','j5','b4','c3','l4','e6','h5','k3','k10','f1','f4','b10','l6','i4','f13','f8','h6','d5','l8','f12','e8','e2','j9','a7','e3','k7','c4','g3','f6','g11','e7','f10','i3','c10','h13','h4','f9','h2','h9','f5','h10','m7','i11','h8','c8','i2','i7']
        const g = new BrickaGame()
        for(const m of moves) {
            g.move(m);
        }
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([2]);
    });
    it("draw (on full board)", () => {
        const moves = ['h12','k4','i8','f2','g7','c6','e10','b6','k8','i10','l10','e12','c7','e4','k6','d9','i6','i12','c11','h1','k11','e11','b8','j5','b4','c3','l4','e6','h5','k3','k10','f1','f4','b10','l6','i4','f13','f8','h6','d5','l8','f12','e8','e2','j9','a7','e3','k7','c4','g3','f6','g11','e7','f10','i3','c10','h13','h4','f9','h2','h9','f5','h10','m7','i11','h8','c8','i2']
        const g = new BrickaGame()
        for(const m of moves) {
            g.move(m);
        }
        g.board.set('k4', "neutral");
        g.move('i7');
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1, 2]);
    });
    it("blocked placement unavailable p2", () => {
       const g = new BrickaGame();
       g.move('f6');
       expect(g.validateMove('h5').valid).to.equal(false);
       expect((() => g.move('h5'))).to.throw("VALIDATION_GENERAL"); 
    });
    it("blocked placement unavailable p2", () => {
       const g = new BrickaGame();
       g.move('f4');
       g.move('h9');
       expect(g.validateMove('g7').valid).to.equal(false);
       expect((() => g.move('g7'))).to.throw("VALIDATION_GENERAL"); 
    });
    it("neutral stone placement", () => {
        const g = state(
            ['c7', 'e7'],
            [],
            []);
        g.move('e8');
        expect(g.board.get('e8')).to.equal("neutral");
    });
    it("neutral stone placement in region with existing neutral stones", () => {
        const g = state(
            ['g7'],
            [],
            ['f5', 'f6', 'h5']);
        g.move('h6');
        expect(g.board.get('h6')).to.equal("neutral");
    });
});

