/* eslint-disable no-unused-expressions */
/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { ConspirateursGame } from '../../src/games';

describe("Conspirateurs", () => {
    it("Safe pieces cannot move", () => {
        const g = new ConspirateursGame(2, ["quick"]);
        g.board.set("i17", 1);
        const results = g.validateMove("i17");
        expect(results.valid).to.be.false;
    });
    it("Can normally jump through sanctuaries", () => {
        const g = new ConspirateursGame(2, ["quick"]);
        g.board.set("i15", 1);
        g.board.set("i16", 1);
        g.board.set("h17", 1);
        const results = g.validateMove("i15-i17-g17");
        expect(results.valid).to.be.true;
    });
    it("Cannot jump through sanctuaries in strict mode", () => {
        const g = new ConspirateursGame(2, ["quick", "strict"]);
        g.board.set("i15", 1);
        g.board.set("i16", 1);
        g.board.set("h17", 1);
        const results = g.validateMove("i15-i17-g17");
        expect(results.valid).to.be.false;
    });
    it("Pass validation", () => {
        // never valid in 2 or 3 player games
        let g = new ConspirateursGame(2, ["quick"]);
        let results = g.validateMove("pass");
        expect(results.valid).to.be.false;
        g = new ConspirateursGame(3, ["quick"]);
        results = g.validateMove("pass");
        expect(results.valid).to.be.false;
        // not usually valid in 4-player games
        g = new ConspirateursGame(4, ["quick"]);
        results = g.validateMove("pass");
        expect(results.valid).to.be.false;
        // except in some edge cases
        [...g.board.entries()].forEach(([c,p]) => {
            if (p === 1) {
                g.board.delete(c);
            }
        });
        const sancts = [...g.sanctuaries];
        for (let i = 0; i < 10; i++) {
            g.board.set(sancts[i], 1);
        }
        results = g.validateMove("pass");
        expect(results.valid).to.be.true;
    });
    it("Partnership EOG validation", () => {
        const g = new ConspirateursGame(4, ["quick"]);
        [...g.board.entries()].forEach(([c,p]) => {
            if (p === 1 || p === 2) {
                g.board.delete(c);
            }
        });
        const sanctsTop = [...g.sanctuaries].filter(c => c.endsWith("17"));
        const sanctsBot = [...g.sanctuaries].filter(c => c.endsWith("1"));
        for (let i = 0; i < 10; i++) {
            g.board.set(sanctsTop[i], 2);
        }
        for (let i = 0; i < 9; i++) {
            g.board.set(sanctsBot[i], 1);
        }
        g.board.set("b9", 1);
        const results = g.validateMove("b9-a9");
        expect(results.valid).to.be.true;
        expect(results.complete).eql(1);
        g.move("b9-a9");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1, 2]);
    });
});

