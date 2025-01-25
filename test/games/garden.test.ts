/* eslint-disable no-unused-expressions */
/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { GardenGame } from '../../src/games';

describe("EOG", () => {
    it ("Timing", () => {
        const g = new GardenGame();
        g.move("d3w");
        g.move("a2w");
        g.move("b4w");
        g.move("c1b");
        expect(g.gameover).to.be.false;
    });
});

