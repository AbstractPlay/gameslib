/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { BentTriGraph } from "../../../src/common";

describe("BentTriGraph", () => {
    it("should produce expected vertex and edge counts at frequency 8", () => {
        const graph = new BentTriGraph(9);

        expect(graph.topo.vertices.length).to.equal(93);
        expect(graph.topo.edges.length).to.equal(252);
        expect(graph.graph.order).to.equal(93);
        expect(graph.graph.size).to.equal(252);
    });

    it("should use ring-letter algebraic labels without x/y node attributes", () => {
        const graph = new BentTriGraph(9);

        const ids = new Set(graph.graph.nodes());
        expect(ids.size).to.equal(93);
        for (const node of graph.graph.nodes()) {
            expect(node).to.match(/^[a-z]+\d+$/);
            const attrs = graph.graph.getNodeAttributes(node);
            expect(attrs).to.have.property("id");
            expect(attrs).to.have.property("ring");
            expect(attrs).to.have.property("pos");
            expect(attrs).to.have.property("isOuter");
            expect(attrs).to.not.have.property("x");
            expect(attrs).to.not.have.property("y");
            expect(graph.coords2algebraic(attrs.pos, attrs.ring)).to.equal(node);
        }
    });

    it("should mark exactly three outer corner vertices at frequency 8", () => {
        const graph = new BentTriGraph(9);
        const outerCorners = graph.graph.nodes().filter(node =>
            graph.graph.getNodeAttributes(node).isOuter,
        );
        expect(outerCorners).to.have.length(3);
        expect(outerCorners).to.have.deep.members(["a1", "a9", "a17"]);
    });

    it("should include every vertex in the playable grid", () => {
        for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 10, 18]) {
            const graph = new BentTriGraph(n+1);
            const inGrid = new Set(graph.topo.gridLayers.flatMap(layer => layer.map(v => v.id)));
            const missing = graph.topo.vertices.filter(v => !inGrid.has(v.id)).map(v => v.id);
            expect(missing, `n=${n}`).to.deep.equal([]);
        }
    });

    it("should order frequency-4 grid layers outside-in from the apex", () => {
        const graph = new BentTriGraph(5);
        expect(graph.listCells(true)).to.deep.equal([
            ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "a10", "a11", "a12"],
            ["b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8", "b9"],
            ["c1", "c2", "c3", "c4", "c5", "c6"],
        ]);
    });

    it("should round-trip algebraic notation", () => {
        const graph = new BentTriGraph(9);
        for (const cell of graph.graph.nodes()) {
            expect(graph.coords2algebraic(...graph.algebraic2coords(cell))).to.equal(cell);
        }
    });

    it("should produce expected vertex counts across frequencies", () => {
        const expected: Record<number, number> = {
            3: 9,
            4: 15,
            5: 27,
            6: 37,
            7: 55,
            8: 69,
            9: 93,
            10: 111,
            11: 141,
            12: 163,
            13: 199,
        };
        for (const [n, count] of Object.entries(expected)) {
            expect(new BentTriGraph(Number(n)).graph.order).to.equal(count);
        }
    });

    it("should find paths between connected vertices", () => {
        const graph = new BentTriGraph(9);
        const path = graph.path("a1", "f1");
        expect(path).to.not.be.null;
        expect(path![0]).to.equal("a1");
        expect(path![path!.length - 1]).to.equal("f1");
    });
});
