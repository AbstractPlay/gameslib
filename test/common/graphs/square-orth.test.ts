/* eslint-disable no-unused-expressions */
/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { SquareOrthGraph } from '../../../src/common';

describe("SquareOrth", () => {
    it("Connectedness", () => {
        const g = new SquareOrthGraph(3, 1);
        expect(g.isConnected()).to.be.true;
        g.graph.dropEdge("a1","b1");
        expect(g.isConnected()).to.be.false;
    });
});
