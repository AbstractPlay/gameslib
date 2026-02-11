/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { RectTriGraph } from '../../../src/common';

describe("RectTriGraph", () => {
    it ("Nodes", () => {
        let grid = new RectTriGraph({width: 3, height: 3});
        expect(grid.listCells(true)).to.have.deep.members([ [ 'a3', 'c3', 'e3' ], [ 'b2', 'd2' ], [ 'a1', 'c1', 'e1' ] ]);
        grid = new RectTriGraph({width: 3, height: 3, reverseNumbers: true});
        expect(grid.listCells(true)).to.have.deep.members([ [ 'a1', 'c1', 'e1' ], [ 'b2', 'd2' ], [ 'a3', 'c3', 'e3' ] ]);
        grid = new RectTriGraph({width: 3, height: 3, start: "N"});
        expect(grid.listCells(true)).to.have.deep.members([ [ 'b3', 'd3' ], [ 'a2', 'c2', 'e2' ], [ 'b1', 'd1' ] ]);
    });

    it ("Edges", () => {
        const grid = new RectTriGraph({width: 3, height: 4});
        expect(grid.neighbours("a4")).to.have.deep.members(["a2", "b3", "c4"]);
        expect(grid.neighbours("c4")).to.have.deep.members(["a4", "e4", "b3", "d3"]);
        expect(grid.neighbours("b3")).to.have.deep.members(["a4", "c4", "d3", "c2", "a2"]);
        expect(grid.neighbours("c2")).to.have.deep.members(["d3", "e2", "d1", "b1", "a2", "b3"]);
    });

    it ("Ray casting", () => {
        const grid = new RectTriGraph({width: 3, height: 4});
        expect(grid.ray("a4", "SE")).to.have.deep.members(["b3", "c2", "d1"]);
        expect(grid.ray("a2", "E")).to.have.deep.members(["c2", "e2"]);
    });
});
