import "mocha";
import { expect } from "chai";
import { StarGraph, starFrequencyFromWidth } from "../../../src/common";

describe("StarGraph", () => {
    it("maps space-style width 11 to frequency 10", () => {
        expect(starFrequencyFromWidth(11)).to.equal(10);
    });

    it("should produce the standard board counts at frequency 10", () => {
        const graph = new StarGraph(10);

        expect(graph.topo.vertices.length).to.equal(276);
        expect(graph.topo.edges.length).to.equal(775);
        expect(graph.topo.pericellIds.size).to.equal(50);
        expect(graph.topo.quarkIds.size).to.equal(5);
        expect(graph.topo.bridgeIds.size).to.equal(6);
        expect(graph.graph.order).to.equal(276);
        expect(graph.graph.size).to.equal(775);
        expect(graph.topo.gridLayers.length).to.equal(11);
        expect(graph.topo.gridLayers[0]!.length).to.equal(50);
        expect(graph.topo.gridLayers[10]!.length).to.equal(1);
    });

    it("should use ring-letter algebraic labels without x/y node attributes", () => {
        const graph = new StarGraph(10);

        const ids = new Set(graph.graph.nodes());
        expect(ids.size).to.equal(276);
        for (const node of graph.graph.nodes()) {
            expect(node).to.match(/^[a-z]+\d+$/);
            const attrs = graph.graph.getNodeAttributes(node);
            expect(attrs).to.have.property("id");
            expect(attrs).to.have.property("ring");
            expect(attrs).to.have.property("pos");
            expect(attrs).to.have.property("isOuter");
            expect(attrs).to.have.property("isBridge");
            expect(attrs).to.have.property("isQuark");
            expect(attrs).to.have.property("isPericell");
            expect(attrs).to.not.have.property("x");
            expect(attrs).to.not.have.property("y");
            expect(graph.coords2algebraic(attrs.ring, attrs.pos)).to.equal(node);
        }
    });

    it("should order the outer ring from the top quark clockwise", () => {
        const graph = new StarGraph(10);
        const topQuarkId = graph.topo.layers[10]![0]![0]!.id;

        expect(graph.topo.gridLayers[0]![0]!.id).to.equal(topQuarkId);
        expect(graph.listCells(true)![0]![0]).to.equal("a1");
        expect(graph.topo.gridLayers[1]!.length).to.equal(45);
    });

    it("should mark bridge, quark, and pericell vertices", () => {
        const graph = new StarGraph(10);

        let bridgeCount = 0;
        let quarkCount = 0;
        let pericellCount = 0;
        let cornerDegree3 = 0;

        for (const node of graph.graph.nodes()) {
            const attrs = graph.graph.getNodeAttributes(node);
            if (attrs.isBridge) {
                bridgeCount++;
            }
            if (attrs.isQuark) {
                quarkCount++;
                if (graph.graph.degree(node) === 3) {
                    cornerDegree3++;
                }
            }
            if (attrs.isPericell) {
                pericellCount++;
            }
            if (attrs.isQuark) {
                expect(attrs.isPericell).to.equal(true);
            }
            if (attrs.isBridge) {
                expect(attrs.isOuter).to.equal(false);
            }
        }

        expect(bridgeCount).to.equal(6);
        expect(quarkCount).to.equal(5);
        expect(pericellCount).to.equal(50);
        expect(cornerDegree3).to.equal(5);
    });

    it("should place the five quarks on the outer ring at frequency 10", () => {
        const graph = new StarGraph(10);
        const quarks = graph.graph.nodes().filter(node =>
            graph.graph.getNodeAttributes(node).isQuark,
        );
        expect(quarks).to.have.deep.members(["a1", "a11", "a21", "a31", "a41"]);
        for (const node of quarks) {
            expect(graph.graph.getNodeAttributes(node).ring).to.equal(0);
        }
    });

    it("should have six bridge vertices at frequency 3", () => {
        const graph = new StarGraph(3);
        expect(graph.topo.bridgeIds.has(0)).to.equal(true);
        expect([...graph.topo.bridgeIds].sort((a, b) => a - b)).to.deep.equal([0, 1, 2, 3, 4, 5]);
        const bridges = graph.graph.nodes().filter(node =>
            graph.graph.getNodeAttributes(node).isBridge,
        );
        expect(bridges).to.have.length(6);
    });

    it("should round-trip algebraic notation", () => {
        const graph = new StarGraph(10);
        for (const cell of graph.graph.nodes()) {
            expect(graph.coords2algebraic(...graph.algebraic2coords(cell))).to.equal(cell);
        }
    });

    it("should find paths between connected vertices", () => {
        const graph = new StarGraph(10);
        const path = graph.path("a1", "k1");
        expect(path).to.not.be.null;
        expect(path![0]).to.equal("a1");
        expect(path![path!.length - 1]).to.equal("k1");
    });
});
