/* tslint:disable:no-unused-expression */

import "mocha";
import { expect } from "chai";
import { VolcanoGame } from '../../src/games';

describe("Volcano", () => {
    it ("Captured pieces stack properly", () => {
        const g = new VolcanoGame();
        g.captured[0] = [["RD", 1]];
        let org = g.organizeCaps(1);
        expect(org.miscellaneous).to.have.deep.members([["RD", 1]]);
        g.captured[0] = [["RD", 1], ["OG", 1]];
        org = g.organizeCaps(1);
        expect(org.miscellaneous).to.have.deep.members([["RD", 1], ["OG", 1]]);
        g.captured[0] = [["RD", 1], ["OG", 2]];
        org = g.organizeCaps(1);
        expect(org.partialsMixed).to.have.deep.members([[["OG", 2], ["RD", 1]]]);
        g.captured[0] = [["RD", 1], ["RD", 2]];
        org = g.organizeCaps(1);
        expect(org.partialsMono).to.have.deep.members([[["RD", 2], ["RD", 1]]]);
        g.captured[0] = [["RD", 1], ["RD", 2], ["RD", 3]];
        org = g.organizeCaps(1);
        expect(org.triosMono).to.have.deep.members([[["RD", 3], ["RD", 2], ["RD", 1]]]);
        g.captured[0] = [["RD", 1], ["OG", 2], ["RD", 3]];
        org = g.organizeCaps(1);
        expect(org.triosMixed).to.have.deep.members([[["RD", 3], ["OG", 2], ["RD", 1]]]);
        g.captured[0] = [["RD", 1], ["OG", 2], ["RD", 3], ["PK", 1], ["PK", 2], ["PK", 3]];
        org = g.organizeCaps(1);
        expect(org.triosMixed).to.have.deep.members([[["RD", 3], ["OG", 2], ["RD", 1]]]);
        expect(org.triosMono).to.have.deep.members([[["PK", 3], ["PK", 2], ["PK", 1]]]);
        // g.captured[0] = [["RD", 1], ["OG", 2], ["RD", 3], ["PK", 1], ["PK", 2], ["PK", 3], ["YE", 3], ["YE", 1]];
        // org = g.organizeCaps(1);
        // expect(org.triosMixed).to.have.deep.members([[["RD", 3], ["OG", 2], ["RD", 1]]]);
        // expect(org.triosMono).to.have.deep.members([[["PK", 3], ["PK", 2], ["PK", 1]]]);
        // expect(org.miscellaneous).to.have.deep.members([["YE", 1], ["YE", 3]]);
    });
});

