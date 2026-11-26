import { expect } from "chai";
import "mocha";
import { GipfGraph } from "../../src/games/gipf/graph.js";

describe("GipfGraph", () => {
    const g = new GipfGraph();

    it("uses reverse-numbers to match render labels", () => {
        expect(g.reverseNumbers).to.equal(true);
        const cells = g.listCells(true) as string[][];
        const dRow = cells.find((row) => row.some((c) => c.startsWith("d")));
        expect(dRow).to.not.equal(undefined);
        expect(dRow![0]).to.equal(`d${dRow!.length}`);
        expect(dRow![dRow!.length - 1]).to.equal("d1");
        const [x, y] = g.algebraic2coords("d8");
        expect(g.coords2algebraic(x, y)).to.equal("d8");
    });

    it("has 24 dots and 37 spots", () => {
        let dots = 0;
        let spots = 0;
        for (const n of g.graph.nodes()) {
            if (g.isDot(n)) {
                dots++;
            } else {
                spots++;
            }
        }
        expect(dots).to.equal(24);
        expect(spots).to.equal(37);
    });

    it("omits edges between two perimeter dots", () => {
        let chord = false;
        g.graph.forEachEdge((_, __, a, b) => {
            if (g.isDot(a) && g.isDot(b)) {
                chord = true;
            }
        });
        expect(chord).to.equal(false);
    });

    it("keeps dot-to-spot links", () => {
        const dots = g.graph.nodes().filter((n) => g.isDot(n));
        expect(dots.length).to.be.greaterThan(0);
        const dot = dots[0]!;
        const inward = g.neighbours(dot).filter((n) => !g.isDot(n) || g.distFromEdge(n) > 0);
        expect(inward.length).to.be.greaterThan(0);
    });

    it("enumerates GIPF lines", () => {
        const lines = g.allLines();
        expect(lines.length).to.be.greaterThan(0);
        for (const line of lines) {
            expect(g.isDot(line[0]!)).to.equal(true);
            expect(g.isDot(line[line.length - 1]!)).to.equal(true);
        }
    });
});