/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { SunspotGame } from '../../src/games';

describe.only("Sunspot", () => {
    it("p1 win by encircling an opponent group", () => {
        const g = [
            "b2", "h6",
            "h5", "h7",
            "g6", "c1",
            "g7", "c2",
            "g8", "c3",
            "h8", "c4",
            "i5", "b5",
            "i6", "a5",
            "i7"
        ].reduce((g, m) => g.move(m), new SunspotGame());

        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1]);
    });

    it("p1 win by encircling empty cells", () => {
        const g = [
            "b2", "k6",
            "h5", "k7",
            "g6", "c1",
            "g7", "c2",
            "g8", "c3",
            "h8", "c4",
            "i5", "b5",
            "i6", "a5",
            "i7"
        ].reduce((g, m) => g.move(m), new SunspotGame());

        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1]);
    });

    it("p2 win by encircling an opponent group", () => {
        const g = ["k2",
            "b2", "h6",
            "h5", "h7",
            "g6", "c1",
            "g7", "c2",
            "g8", "c3",
            "h8", "c4",
            "i5", "b5",
            "i6", "a5",
            "i7"
        ].reduce((g, m) => g.move(m), new SunspotGame());

        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([2]);
    });

    it("p2 by encircling empty cells", () => {
        const g = ["k2",
            "b2", "k6",
            "h5", "k7",
            "g6", "c1",
            "g7", "c2",
            "g8", "c3",
            "h8", "c4",
            "i5", "b5",
            "i6", "a5",
            "i7"
        ].reduce((g, m) => g.move(m), new SunspotGame());

        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([2]);
    });
    
    it("p1 don't win with a blob", () => {
        const g = [
            "h6", "k6",
            "h7", "m7",
            "h5", "k7",
            "g6", "c1",
            "g7", "c2",
            "g8", "c3",
            "h8", "c4",
            "i5", "b5",
            "i6", "a5",
            "i7"
        ].reduce((g, m) => g.move(m), new SunspotGame());
        
        expect(g.gameover).to.be.false;
    });
    
    it("p1 win on p2s turn by unblobbification", () => {
        const g = [
            "h6", "k6",
            "h7", "m7",
            "h5", "k7",
            "g6", "c1",
            "g7", "c2",
            "g8", "c3",
            "h8", "c4",
            "i5", "b5",
            "i6", "a5",
            "i7", "j2;Xh6"
        ].reduce((g, m) => g.move(m), new SunspotGame());
        
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1]);
    });
    
    it("p2 don't win with a blob", () => {
        const g = ["l3",
            "h6", "k6",
            "h7", "m7",
            "h5", "k7",
            "g6", "c1",
            "g7", "c2",
            "g8", "c3",
            "h8", "c4",
            "i5", "b5",
            "i6", "a5",
            "i7"
        ].reduce((g, m) => g.move(m), new SunspotGame());
        
        expect(g.gameover).to.be.false;
    });
    
    it("p2 win on p1s turn by unblobbification", () => {
        const g = ["l3",
            "h6", "k6",
            "h7", "m7",
            "h5", "k7",
            "g6", "c1",
            "g7", "c2",
            "g8", "c3",
            "h8", "c4",
            "i5", "b5",
            "i6", "a5",
            "i7", "j2;Xh6"
        ].reduce((g, m) => g.move(m), new SunspotGame());
        
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([2]);
    });

    it("p1 win by flip", () => {
        const g = [
            "h3", "i3",
            "j2", "i1",
            "i4", "l3",
            "h5", "k3",
            "g5", "l4",
            "g4", "i2",
            "h8;Xi3;Xj2"
        ].reduce((g, m) => g.move(m), new SunspotGame());

        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1]);
    });
    
    
    it("p2 win by flip", () => {
        const g = ["c6",
            "h3", "i3",
            "j2", "i1",
            "i4", "l3",
            "h5", "k3",
            "g5", "l4",
            "g4", "i2",
            "h8;Xi3;Xj2"
        ].reduce((g, m) => g.move(m), new SunspotGame());

        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([2]);
    });
    
    it("p1 win on p2s turn by counter-flip", () => {
        const g = [
            "i3", "i2",
            "h4", "j2",
            "g4", "j1",
            "g3", "k1",
            "h2", "k2",
            "j3", "j4",
            "i4", "k3",
            "i5", "j5;Xj3;Xi2"
        ].reduce((g, m) => g.move(m), new SunspotGame());

        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1]);
    });
    
    it("p2 win on p2s turn by counter-flip", () => {
        const g = ["d7",
            "i3", "i2",
            "h4", "j2",
            "g4", "j1",
            "g3", "k1",
            "h2", "k2",
            "j3", "j4",
            "i4", "k3",
            "i5", "j5;Xj3;Xi2"
        ].reduce((g, m) => g.move(m), new SunspotGame());

        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([2]);
    });    
});

