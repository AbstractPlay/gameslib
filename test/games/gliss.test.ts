/* eslint-disable no-unused-expressions */
/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { GlissGame } from '../../src/games';

describe("Gliss", () => {
    it ("Capturing scenarios", () => {
        // glider capturing docked glider and converting base
        let g = new GlissGame();
        for (const cell of "a12,b12,a11,b11,d8,e8,d7,e7".split(",")) {
            g.board.set(cell, 1);
        }
        for (const cell of "k2,l2,k1,l1,g7,h7,g6,h6".split(",")) {
            g.board.set(cell, 2);
        }
        let result = g.validateMove("d8-g7");
        expect(result.valid).to.be.true;
        expect(result.complete).eq(1);
        g.move("d8-g7");
        expect(g.board.has("d8")).to.be.false;
        expect(g.board.has("e8")).to.be.false;
        expect(g.board.has("d7")).to.be.false;
        expect(g.board.get("e7")).equal(1);
        expect(g.board.get("g7")).equal(1);
        expect(g.board.get("h7")).equal(1);
        expect(g.board.get("g6")).equal(1);
        expect(g.board.get("h6")).equal(1);

        // glider arm overlapping a base
        g = new GlissGame();
        for (const cell of "a12,b12,a11,b11,d8,e8,d7,e7".split(",")) {
            g.board.set(cell, 1);
        }
        for (const cell of "k2,l2,k1,l1,g7,h7,g6,h6".split(",")) {
            g.board.set(cell, 2);
        }
        result = g.validateMove("d8-g8");
        expect(result.valid).to.be.true;
        expect(result.complete).eq(1);
        g.move("d8-g8");
        expect(g.board.has("d8")).to.be.false;
        expect(g.board.has("e8")).to.be.false;
        expect(g.board.has("d7")).to.be.false;
        expect(g.board.get("g8")).equal(1);
        expect(g.board.get("h8")).equal(1);
        expect(g.board.get("g7")).equal(1);
        expect(g.board.has("h7")).to.be.false;
        expect(g.board.has("g6")).to.be.false;
        expect(g.board.get("h6")).equal(2);

        // glider arm overlapping a glider arm
        g = new GlissGame();
        for (const cell of "a12,b12,a11,b11,d8,e8,d7,e7".split(",")) {
            g.board.set(cell, 1);
        }
        for (const cell of "k2,l2,k1,l1,g7,h7,h6".split(",")) {
            g.board.set(cell, 2);
        }
        result = g.validateMove("d8-g8");
        expect(result.valid).to.be.true;
        expect(result.complete).eq(1);
        g.move("d8-g8");
        expect(g.board.has("d8")).to.be.false;
        expect(g.board.has("e8")).to.be.false;
        expect(g.board.has("d7")).to.be.false;
        expect(g.board.get("g8")).equal(1);
        expect(g.board.get("h8")).equal(1);
        expect(g.board.get("g7")).equal(1);
        expect(g.board.has("h7")).to.be.false;
        expect(g.board.has("g6")).to.be.false;
        expect(g.board.has("h6")).to.be.false;

        // two arms of a glider overlapping two different gliders
        g = new GlissGame();
        for (const cell of "a12,b12,a11,b11,d8,e8,d7,e7".split(",")) {
            g.board.set(cell, 1);
        }
        for (const cell of "k2,l2,k1,l1,g6,h6,h5,e5,f5,e4".split(",")) {
            g.board.set(cell, 2);
        }
        result = g.validateMove("d8-f6");
        expect(result.valid).to.be.true;
        expect(result.complete).eq(1);
        g.move("d8-f6");
        expect(g.board.has("d8")).to.be.false;
        expect(g.board.has("e8")).to.be.false;
        expect(g.board.has("d7")).to.be.false;
        expect(g.board.get("f6")).equal(1);
        expect(g.board.get("g6")).equal(1);
        expect(g.board.get("f5")).equal(1);
        expect(g.board.has("e5")).to.be.false;
        expect(g.board.has("e4")).to.be.false;
        expect(g.board.has("h6")).to.be.false;
        expect(g.board.has("h5")).to.be.false;

        // two arms of a glider overlapping a glider and a base
        g = new GlissGame();
        for (const cell of "a12,b12,a11,b11,d8,e8,d7,e7".split(",")) {
            g.board.set(cell, 1);
        }
        for (const cell of "k2,l2,k1,l1,g6,h6,h5,e5,f5,e4,f4".split(",")) {
            g.board.set(cell, 2);
        }
        result = g.validateMove("d8-f6");
        expect(result.valid).to.be.true;
        expect(result.complete).eq(1);
        g.move("d8-f6");
        expect(g.board.has("d8")).to.be.false;
        expect(g.board.has("e8")).to.be.false;
        expect(g.board.has("d7")).to.be.false;
        expect(g.board.get("f6")).equal(1);
        expect(g.board.get("g6")).equal(1);
        expect(g.board.get("f5")).equal(1);
        expect(g.board.get("e4")).equal(2);
        expect(g.board.has("e5")).to.be.false;
        expect(g.board.has("f4")).to.be.false;
        expect(g.board.has("h6")).to.be.false;
        expect(g.board.has("h5")).to.be.false;

    });
});

