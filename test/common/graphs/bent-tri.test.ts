/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { BentTriGraph } from "../../../src/common";
import { buildGridLayers, bentTriBoard } from "../../../src/common/bentTri";

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
            const graph = new BentTriGraph(n + 1);
            const inGrid = new Set(graph.topo.gridLayers.flatMap(layer => layer.map(v => v.id)));
            const missing = graph.topo.vertices.filter(v => !inGrid.has(v.id)).map(v => v.id);
            expect(missing, `n=${n}`).to.deep.equal([]);
        }
    });

    it("should partition every vertex into exactly one grid ring", () => {
        for (const n of Array.from({ length: 17 }, (_, i) => i + 2)) {
            const topo = bentTriBoard(n);
            const seen = new Set<number>();
            const duplicates: number[] = [];

            for (const layer of buildGridLayers(topo)) {
                for (const vertex of layer) {
                    if (seen.has(vertex.id)) {
                        duplicates.push(vertex.id);
                    }
                    seen.add(vertex.id);
                }
            }

            expect(duplicates, `n=${n}`).to.deep.equal([]);
            expect(seen.size, `n=${n}`).to.equal(topo.vertices.length);
        }
    });

    it("should order frequency-4 grid layers outside-in from the apex", () => {
        const graph = new BentTriGraph(5);
        const rowIds = (graph.listCells(true) as string[][]).map(layer =>
            layer.map(cell => graph.graph.getNodeAttributes(cell).id),
        );
        expect(rowIds[0]).to.deep.equal([15, 16, 18, 20, 10, 11, 12, 13, 14, 26, 24, 22]);
        expect(rowIds[1]).to.deep.equal([17, 19, 21, 6, 7, 8, 9, 25, 23]);
        expect(rowIds[2]).to.deep.equal([0, 1, 3, 4, 5, 2]);
    });

    it("should order frequency-8 outer ring clockwise from the apex", () => {
        const graph = new BentTriGraph(9);
        const outerIds = graph.topo.gridLayers[0]!.map(v => v.id);
        expect(outerIds[0]).to.equal(45);
        expect(outerIds).to.deep.equal([
            45, 46, 48, 51, 55, 59, 63, 67,
            36, 37, 38, 39, 40, 41, 42, 43, 44,
            92, 88, 84, 80, 76, 73, 71,
        ]);
        expect(graph.topo.gridLayers[5]!.map(v => v.id)).to.deep.equal([4, 7, 8]);
    });

    it("should order frequency-9 grid with the hub shell on ring e", () => {
        const graph = new BentTriGraph(10);
        const rowIds = graph.topo.gridLayers.map(layer => layer.map(v => v.id));
        expect(rowIds[4]).to.deep.equal([
            0, 1, 3, 6, 10, 15, 16, 17, 18, 19, 20, 14, 9, 5, 2,
        ]);
        expect(rowIds[5]).to.deep.equal([4, 7, 11, 12, 13, 8]);
        expect(graph.listCells(true)![4]).to.deep.equal([
            "e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8", "e9", "e10",
            "e11", "e12", "e13", "e14", "e15",
        ]);
        expect(graph.listCells(true)![5]).to.deep.equal(["f1", "f2", "f3", "f4", "f5", "f6"]);
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
