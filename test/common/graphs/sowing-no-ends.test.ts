/* eslint-disable no-unused-expressions */
/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { SowingNoEndsGraph } from '../../../src/common';

const rotN = (lst: string[], n: number): string[] => {
    n = n % lst.length;
    if (n === 0) {
        return [...lst];
    } else {
        const newlst = lst.slice(n);
        newlst.push(...lst.slice(0, n));
        return [...newlst];
    }
}

describe("Sowing: No Ends", () => {
    it("Connections", () => {
        const g = new SowingNoEndsGraph(9);
        // CW
        let cells = ["a2", "b2", "c2", "d2", "e2", "f2", "g2", "h2", "i2", "i1", "h1", "g1", "f1", "e1", "d1", "c1", "b1", "a1"];
        for (let i = 0; i < cells.length; i++) {
            const rotated = rotN(cells, i);
            const start = rotated[0];
            const comparison = rotated.slice(1);
            const sown = g.sow(start, "CW", 17);
            expect(sown).to.eql(comparison);
        }
        // CCW
        cells = ["i2", "h2", "g2", "f2", "e2", "d2", "c2", "b2", "a2", "a1", "b1", "c1", "d1", "e1", "f1", "g1", "h1", "i1"];
        for (let i = 0; i < cells.length; i++) {
            const rotated = rotN(cells, i);
            const start = rotated[0];
            const comparison = rotated.slice(1);
            const sown = g.sow(start, "CCW", 17);
            expect(sown).to.eql(comparison);
        }
    });

    it("getDirection", () => {
        const g = new SowingNoEndsGraph(9);
        const tests: [string, string, "CW"|"CCW"|undefined][] = [
            ["x", "a1", undefined],
            ["a1", "x", undefined],
            ["x", "y", undefined],
            ["a1", "b1", "CCW"],
            ["a1", "a2", "CW"],
            ["a1", "c1", undefined],
            ["a2", "b2", "CW"],
            ["a2", "a1", "CCW"],
            ["i1", "h1", "CW"],
            ["i1", "i2", "CCW"],
        ];
        for (const entry of tests) {
            expect(g.getDir(entry[0], entry[1])).eq(entry[2]);
        }
    });
});
