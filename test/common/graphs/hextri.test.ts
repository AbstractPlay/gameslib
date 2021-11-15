/* tslint:disable:no-unused-expression */

import "mocha";
import { expect } from "chai";
import { HexTriGraph } from '../../../src/common';

describe("HexTriGraph", () => {
    it ("Movement", () => {
        const grid = new HexTriGraph(5, 9);
        // NE
        // Above
        expect(grid.move(3, 2, "NE")).to.have.deep.members([3, 1]);
        // On
        expect(grid.move(4, 4, "NE")).to.have.deep.members([4, 3]);
        // Below
        expect(grid.move(3, 5, "NE")).to.have.deep.members([4, 4]);
        // Invalid
        expect(grid.move(4, 0, "NE")).to.be.undefined;

        // E
        // Above
        expect(grid.move(3, 2, "E")).to.have.deep.members([4, 2]);
        // On
        expect(grid.move(4, 4, "E")).to.have.deep.members([5, 4]);
        // Below
        expect(grid.move(3, 5, "E")).to.have.deep.members([4, 5]);
        // Invalid
        expect(grid.move(8, 4, "E")).to.be.undefined;

        // SE
        // Above
        expect(grid.move(3, 2, "SE")).to.have.deep.members([4, 3]);
        // On
        expect(grid.move(4, 4, "SE")).to.have.deep.members([4, 5]);
        // Below
        expect(grid.move(3, 5, "SE")).to.have.deep.members([3, 6]);
        // Invalid
        expect(grid.move(6, 6, "SE")).to.be.undefined;

        // SW
        // Above
        expect(grid.move(3, 2, "SW")).to.have.deep.members([3, 3]);
        // On
        expect(grid.move(4, 4, "SW")).to.have.deep.members([3, 5]);
        // Below
        expect(grid.move(3, 5, "SW")).to.have.deep.members([2, 6]);
        // Invalid
        expect(grid.move(0, 5, "SW")).to.be.undefined;

        // W
        // Above
        expect(grid.move(3, 2, "W")).to.have.deep.members([2, 2]);
        // On
        expect(grid.move(4, 4, "W")).to.have.deep.members([4, 3]);
        // Below
        expect(grid.move(3, 5, "W")).to.have.deep.members([2, 5]);
        // Invalid
        expect(grid.move(0, 5, "W")).to.be.undefined;

        // NW
        // Above
        expect(grid.move(3, 2, "NW")).to.have.deep.members([2, 1]);
        // On
        expect(grid.move(4, 4, "NW")).to.have.deep.members([3, 3]);
        // Below
        expect(grid.move(3, 5, "NW")).to.have.deep.members([3, 4]);
        // Invalid
        expect(grid.move(0, 2, "NW")).to.be.undefined;
    });

    it ("Ray casting", () => {
        const grid = new HexTriGraph(4, 7);
        // NE
        expect (grid.ray(0, 6, "NE")).to.have.deep.members([[1,5],[2,4],[3,3],[3,2],[3,1],[3,0]]);
        // E
        expect (grid.ray(0, 3, "E")).to.have.deep.members([[1,3],[2,3],[3,3],[4,3],[5,3],[6,3]]);
        // SE
        expect (grid.ray(0, 0, "SE")).to.have.deep.members([[1,1],[2,2],[3,3],[3,4],[3,5],[3,6]]);
        // SW
        expect (grid.ray(3, 0, "SW")).to.have.deep.members([[3,1],[3,2],[3,3],[2,4],[1,5],[0,6]]);
        // W
        expect (grid.ray(6, 3, "W")).to.have.deep.members([[5,3],[4,3],[3,3],[2,3],[1,3],[0,3]]);
        // NW
        expect (grid.ray(3, 6, "NW")).to.have.deep.members([[3,5],[3,4],[3,3],[2,2],[1,1],[0,0]]);
    });
});
