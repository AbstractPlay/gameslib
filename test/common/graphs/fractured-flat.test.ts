import "mocha";
import { expect } from "chai";
import { connectedComponents } from "graphology-components";
import { FracturedFlatGraph } from "../../../src/common";
import {
    buildFracturedFlatAdjacency,
    fracturedFlatBoardCenter,
    fracturedFlatCellLabel,
    minVertexBearing,
    prepareFracturedFlatPolys,
} from "../../../src/common/fracturedFlat";

describe("FracturedFlatGraph", () => {
    it("orders cells into vertex-count tiers with clockwise min-vertex bearing", () => {
        const g = new FracturedFlatGraph();
        const ordered = g.listCells(true) as string[][];
        expect(ordered.map((row) => row.length)).to.deep.equal([24, 15, 5, 1]);
        expect(ordered.flat().length).to.equal(45);

        const flat = g.polys.flat();
        const center = fracturedFlatBoardCenter(flat);

        for (let row = 0; row < g.polys.length; row++) {
            const expectedVerts = row === 0 ? 3 : row === 1 ? 4 : row === 2 ? 5 : 6;
            for (const poly of g.polys[row]) {
                expect(poly.points.length).to.equal(expectedVerts);
            }

            const bearings = g.polys[row].map((poly) => minVertexBearing(poly, center));
            for (let col = 1; col < bearings.length; col++) {
                expect(bearings[col]).to.be.at.least(bearings[col - 1]!);
            }
        }
    });

    it("labels cells by tier letter and 1-based column in sweep order", () => {
        const polys = prepareFracturedFlatPolys();
        expect(fracturedFlatCellLabel(0, 0)).to.equal("A1");
        expect(fracturedFlatCellLabel(0, polys[0].length - 1)).to.equal("A24");
        expect(fracturedFlatCellLabel(3, 0)).to.equal("D1");
    });

    it("uses uppercase tier letters with 1-based indices", () => {
        const g = new FracturedFlatGraph();
        for (const node of g.graph.nodes()) {
            expect(node).to.match(/^[A-D]\d+$/);
            const attrs = g.graph.getNodeAttributes(node) as {
                verts: number;
                tier: number;
                index: number;
            };
            expect(g.tierLetterForRow(attrs.tier)).to.equal(node.charAt(0));
            expect(attrs.verts).to.equal(attrs.tier + 3);
        }
    });

    it("has unique node labels", () => {
        const g = new FracturedFlatGraph();
        const cells = g.listCells(false) as string[];
        expect(new Set(cells).size).to.equal(cells.length);
    });

    it("round-trips coordinate transforms", () => {
        const g = new FracturedFlatGraph();
        const ordered = g.listCells(true) as string[][];
        for (let row = 0; row < ordered.length; row++) {
            for (let col = 0; col < ordered[row].length; col++) {
                const cell = ordered[row][col];
                expect(g.coords2algebraic(col, row)).to.equal(cell);
                const [txCol, txRow] = g.algebraic2coords(cell);
                expect(txCol).to.equal(col);
                expect(txRow).to.equal(row);
                expect(g.coords2algebraic(txCol, txRow)).to.equal(cell);
            }
        }
    });

    it("is undirected and has no self-loops", () => {
        const g = new FracturedFlatGraph();
        for (const node of g.graph.nodes()) {
            expect(g.neighbours(node)).to.not.include(node);
            for (const nbor of g.neighbours(node)) {
                expect(g.neighbours(nbor)).to.include(node);
            }
        }
    });

    it("matches shared-side adjacency from prepared polygons", () => {
        const g = new FracturedFlatGraph();
        const rebuilt = buildFracturedFlatAdjacency(prepareFracturedFlatPolys());

        const edgePairs = (graph: typeof g.graph): Set<string> => {
            const pairs = new Set<string>();
            for (const edge of graph.edges()) {
                const [a, b] = graph.extremities(edge);
                pairs.add(a < b ? `${a}|${b}` : `${b}|${a}`);
            }
            return pairs;
        };

        const fromGraph = edgePairs(g.graph);
        const fromPolys = new Set<string>();
        for (const [label, neighbours] of rebuilt) {
            for (const nbor of neighbours) {
                const pair = label < nbor ? `${label}|${nbor}` : `${nbor}|${label}`;
                fromPolys.add(pair);
            }
        }

        expect(fromGraph).to.deep.equal(fromPolys);
    });

    it("is connected", () => {
        const g = new FracturedFlatGraph();
        const components = connectedComponents(g.graph);
        expect(components).to.have.length(1);
        expect(components[0]).to.have.length(45);
    });
});
