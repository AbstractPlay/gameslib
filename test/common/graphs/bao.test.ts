import "mocha";
import { expect } from "chai";
import { BaoGraph } from '../../../src/common';
import { type PitType } from "../../../src/common/graphs/bao";

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

describe("Bao", () => {
    it("Connections", () => {
        const g = new BaoGraph();
        // p1 CW
        let cells = ["a2", "b2", "c2", "d2", "e2", "f2", "g2", "h2", "h1", "g1", "f1", "e1", "d1", "c1", "b1", "a1"];
        for (let i = 0; i < cells.length; i++) {
            const rotated = rotN(cells, i);
            const start = rotated[0];
            const comparison = rotated.slice(1);
            const sown = g.sow(start, "CW", 15);
            expect(sown).to.eql(comparison);
        }
        // p1 CCW
        cells = ["h2", "g2", "f2", "e2", "d2", "c2", "b2", "a2", "a1", "b1", "c1", "d1", "e1", "f1", "g1", "h1"];
        for (let i = 0; i < cells.length; i++) {
            const rotated = rotN(cells, i);
            const start = rotated[0];
            const comparison = rotated.slice(1);
            const sown = g.sow(start, "CCW", 15);
            expect(sown).to.eql(comparison);
        }
        // p2 CW
        cells = ["h3", "g3", "f3", "e3", "d3", "c3", "b3", "a3", "a4", "b4", "c4", "d4", "e4", "f4", "g4", "h4"];
        for (let i = 0; i < cells.length; i++) {
            const rotated = rotN(cells, i);
            const start = rotated[0];
            const comparison = rotated.slice(1);
            const sown = g.sow(start, "CW", 15);
            expect(sown).to.eql(comparison);
        }
        // p2 CCW
        cells = ["a3", "b3", "c3", "d3", "e3", "f3", "g3", "h3", "h4", "g4", "f4", "e4", "d4", "c4", "b4", "a4"];
        for (let i = 0; i < cells.length; i++) {
            const rotated = rotN(cells, i);
            const start = rotated[0];
            const comparison = rotated.slice(1);
            const sown = g.sow(start, "CCW", 15);
            expect(sown).to.eql(comparison);
        }
    });

    it("getDirection", () => {
        const g = new BaoGraph();
        const tests: [string, string, "CW"|"CCW"|undefined][] = [
            ["x", "a1", undefined],
            ["a1", "x", undefined],
            ["x", "y", undefined],
            ["a1", "b1", "CCW"],
            ["a1", "a2", "CW"],
            ["a1", "c1", undefined],
            ["a2", "b2", "CW"],
            ["a2", "a1", "CCW"],
            ["h1", "g1", "CW"],
            ["h1", "h2", "CCW"],
            ["a4", "a3", "CCW"],
            ["a4", "b4", "CW"],
            ["h4", "h3", "CW"],
            ["h4", "g4", "CCW"],
        ];
        for (const entry of tests) {
            expect(g.getDir(entry[0], entry[1])).eq(entry[2]);
        }
    });

    it("getType", () => {
        const g = new BaoGraph();
        const tests: [string, PitType][] = [
            ["a3", "kichwa2R"],
            ["b3", "kimbi2R"],
            ["c3", "pit"],
            ["d3", "nyumba"],
            ["e3", "pit"],
            ["f3", "pit"],
            ["g3", "kimbi2L"],
            ["h3", "kichwa2L"],
            ["h2", "kichwa1R"],
            ["g2", "kimbi1R"],
            ["f2", "pit"],
            ["e2", "nyumba"],
            ["d2", "pit"],
            ["c2", "pit"],
            ["b2", "kimbi1L"],
            ["a2", "kichwa1L"],
        ];
        for (const entry of tests) {
            expect(g.getType(entry[0])).eq(entry[1]);
        }
    });
});
