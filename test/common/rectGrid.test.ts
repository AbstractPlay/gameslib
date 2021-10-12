/* tslint:disable:no-unused-expression */

import "mocha";
import { expect } from "chai";
import { RectGrid } from '../../src/common';

describe("RectGrid", () => {
    it ("simple movement", () => {
        let [xNext, yNext] = RectGrid.move(0, 0, "N");
        expect(xNext).to.equal(0);
        expect(yNext).to.equal(-1);
        [xNext, yNext] = RectGrid.move(0, 0, "N", 10);
        expect(xNext).to.equal(0);
        expect(yNext).to.equal(-10);

        [xNext, yNext] = RectGrid.move(0, 0, "NE");
        expect(xNext).to.equal(1);
        expect(yNext).to.equal(-1);
        [xNext, yNext] = RectGrid.move(0, 0, "NE", 10);
        expect(xNext).to.equal(10);
        expect(yNext).to.equal(-10);

        [xNext, yNext] = RectGrid.move(0, 0, "E");
        expect(xNext).to.equal(1);
        expect(yNext).to.equal(0);
        [xNext, yNext] = RectGrid.move(0, 0, "E", 10);
        expect(xNext).to.equal(10);
        expect(yNext).to.equal(0);

        [xNext, yNext] = RectGrid.move(0, 0, "SE");
        expect(xNext).to.equal(1);
        expect(yNext).to.equal(1);
        [xNext, yNext] = RectGrid.move(0, 0, "SE", 10);
        expect(xNext).to.equal(10);
        expect(yNext).to.equal(10);

        [xNext, yNext] = RectGrid.move(0, 0, "S");
        expect(xNext).to.equal(0);
        expect(yNext).to.equal(1);
        [xNext, yNext] = RectGrid.move(0, 0, "S", 10);
        expect(xNext).to.equal(0);
        expect(yNext).to.equal(10);

        [xNext, yNext] = RectGrid.move(0, 0, "SW");
        expect(xNext).to.equal(-1);
        expect(yNext).to.equal(1);
        [xNext, yNext] = RectGrid.move(0, 0, "SW", 10);
        expect(xNext).to.equal(-10);
        expect(yNext).to.equal(10);

        [xNext, yNext] = RectGrid.move(0, 0, "W");
        expect(xNext).to.equal(-1);
        expect(yNext).to.equal(0);
        [xNext, yNext] = RectGrid.move(0, 0, "W", 10);
        expect(xNext).to.equal(-10);
        expect(yNext).to.equal(0);

        [xNext, yNext] = RectGrid.move(0, 0, "NW");
        expect(xNext).to.equal(-1);
        expect(yNext).to.equal(-1);
        [xNext, yNext] = RectGrid.move(0, 0, "NW", 10);
        expect(xNext).to.equal(-10);
        expect(yNext).to.equal(-10);
    });

    it ("Adjacencies: corners", () => {
        const g = new RectGrid(8, 8);
        let adj = g.adjacencies(0, 0);
        expect(adj).to.have.deep.members([[1,0], [0,1], [1,1]]);
        adj = g.adjacencies(0, 0, false);
        expect(adj).to.have.deep.members([[1,0], [0,1]]);

        adj = g.adjacencies(7, 7);
        expect(adj).to.have.deep.members([[6,7], [6,6], [7,6]]);
        adj = g.adjacencies(7, 7, false);
        expect(adj).to.have.deep.members([[6,7], [7,6]]);

        adj = g.adjacencies(0, 7);
        expect(adj).to.have.deep.members([[0,6], [1,6], [1,7]]);
        adj = g.adjacencies(0, 7, false);
        expect(adj).to.have.deep.members([[0,6], [1,7]]);

        adj = g.adjacencies(7, 0);
        expect(adj).to.have.deep.members([[6,0], [6,1], [7,1]]);
        adj = g.adjacencies(7, 0, false);
        expect(adj).to.have.deep.members([[6,0], [7,1]]);
    });

    it ("Adjacencies: edges", () => {
        const g = new RectGrid(8, 8);
        let adj = g.adjacencies(3, 0);
        expect(adj).to.have.deep.members([[2,0], [3,1], [4,0], [2,1], [4,1]]);
        adj = g.adjacencies(3, 0, false);
        expect(adj).to.have.deep.members([[2,0], [3,1], [4,0]]);
    });

    it ("Adjacencies: center", () => {
        const g = new RectGrid(8, 8);
        let adj = g.adjacencies(4, 4);
        expect(adj).to.have.deep.members([[4,3], [5,4], [4,5], [3,4], [5,3], [5,5], [3,5], [3,3]]);
        adj = g.adjacencies(4, 4, false);
        expect(adj).to.have.deep.members([[4,3], [5,4], [4,5], [3,4]]);
    });

    it ("Knights: corner", () => {
        const g = new RectGrid(8, 8);
        const adj = g.knights(0,0);
        expect(adj).to.have.deep.members([[2,1], [1,2]]);
    });

    it ("Knights: edge", () => {
        const g = new RectGrid(8, 8);
        const adj = g.knights(5,0);
        expect(adj).to.have.deep.members([[7,1], [3,1], [4,2], [6,2]]);
    });

    it ("Knights: centre", () => {
        const g = new RectGrid(8, 8);
        const adj = g.knights(4,4);
        expect(adj).to.have.deep.members([[3,2], [5,2], [6,3], [6,5], [3,6], [5,6], [2,3], [2,5]]);
    });

    it ("Ray casting: edges outwards", () => {
        const g = new RectGrid(8, 8);
        let ray = g.ray(0, 0, "N");
        expect(ray).to.be.empty;
        ray = g.ray(0, 0, "NW");
        expect(ray).to.be.empty;
        ray = g.ray(0, 0, "W");
        expect(ray).to.be.empty;
        ray = g.ray(7, 7, "E");
        expect(ray).to.be.empty;
        ray = g.ray(7, 7, "SE");
        expect(ray).to.be.empty;
        ray = g.ray(7, 7, "S");
        expect(ray).to.be.empty;
    });

    it ("Ray casting: columns", () => {
        const g = new RectGrid(8, 8);
        let ray = g.ray(0, 0, "S");
        expect(ray).to.have.deep.members([[0,1], [0,2], [0,3], [0,4], [0,5], [0,6], [0,7]]);
        ray = g.ray(4, 4, "N");
        expect(ray).to.have.deep.members([[4,3], [4,2], [4,1], [4,0]]);
    });

    it ("Ray casting: rows", () => {
        const g = new RectGrid(8, 8);
        let ray = g.ray(0, 0, "E");
        expect(ray).to.have.deep.members([[1,0], [2,0], [3,0], [4,0], [5,0], [6,0], [7,0]]);
        ray = g.ray(4, 4, "W");
        expect(ray).to.have.deep.members([[3,4], [2,4], [1,4], [0,4]]);
    });

    it ("Ray casting: diagonals", () => {
        const g = new RectGrid(8, 8);
        let ray = g.ray(4, 4, "NE");
        expect(ray).to.have.deep.members([[5,3], [6,2], [7,1]]);
        ray = g.ray(4, 4, "SE");
        expect(ray).to.have.deep.members([[5,5], [6,6], [7,7]]);
        ray = g.ray(4, 4, "SW");
        expect(ray).to.have.deep.members([[3,5], [2,6], [1,7]]);
        ray = g.ray(4, 4, "NW");
        expect(ray).to.have.deep.members([[3,3], [2,2], [1,1], [0,0]]);
    });

    it ("Visibility: orthogonal", () => {
        const g = new RectGrid(8, 8);
        expect(g.isOrth(0, 0, 0, 1)).to.be.true;
        expect(g.isOrth(0, 0, 1, 0)).to.be.true;
        expect(g.isOrth(0, 0, 1, 1)).to.be.false;
        expect(g.isOrth(0, 0, 0, 10)).to.be.false;
        expect(g.isOrth(0, 0, 10, 0)).to.be.false;
    });

    it ("Visiblity: diagonal", () => {
        const g = new RectGrid(8, 8);
        expect(g.isDiag(0, 0, 0, 1)).to.be.false;
        expect(g.isDiag(0, 0, 1, 0)).to.be.false;
        expect(g.isDiag(0, 0, 1, 1)).to.be.true;
        expect(g.isDiag(0, 0, 10, 10)).to.be.false;
    });
});
