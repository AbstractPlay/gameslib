/* eslint-disable no-unused-expressions */
/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { GorogoGame } from '../../src/games';

describe("GoRoGo", () => {
    it ("Placements & Captures", () => {
        const g = new GorogoGame();
        g.move("&a5");
        for (const cell of ["b3", "c2", "c4", "d3"]) {
            g.board.set(cell, 1);
        }
        expect(g.canPlace("c3")).to.be.false;
        g.board.set("b3", "X");
        expect(g.canPlace("c3")).to.be.true;
    });
});

