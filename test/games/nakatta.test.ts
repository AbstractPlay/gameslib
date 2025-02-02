/* eslint-disable no-unused-expressions */
/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { NakattaGame } from '../../src/games';

describe("Nakatta", () => {
    it ("Placement restrictions", () => {
        const g = new NakattaGame();
        g.board.set("a1", 1);
        // naked attachments
        expect(g.canPlace("a2", 2)).to.be.false;
        expect(g.canPlace("b1", 2)).to.be.false;
        expect(g.canPlace("b2", 2)).to.be.true;

        // hard corners: corner check
        g.board.clear();
        g.board.set("c4", 1);
        g.board.set("d5", 1);
        expect(g.canPlace("c5", 2)).to.be.false;
        expect(g.canPlace("d4", 2)).to.be.false;
        expect(g.canPlace("a1", 2)).to.be.true;

        // hard corners: edge check
        g.board.clear();
        g.board.set("c4", 1);
        g.board.set("d4", 2);
        expect(g.canPlace("c3", 2)).to.be.false;
        expect(g.canPlace("c5", 2)).to.be.false;
        expect(g.canPlace("a1", 2)).to.be.true;
    });
});

