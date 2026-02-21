import "mocha";
import { expect } from "chai";
import { ModularBoard } from "../../src/common/modular/board";
import { Orientation, Direction } from "honeycomb-grid";

const ctrs = [
  { q: 0, r: 0 },
  { q: 2, r: -3 },
  { q: 4, r: -6 },
  { q: 5, r: -9 },
  { q: 6, r: -5 },
  { q: 7, r: -8 },
  { q: 9, r: -7 }
];

describe("Modular Boards", () => {
    it("Flat, Even (Offset 1)", () => {
        const board = new ModularBoard({
            centres: ctrs,
            orientation: Orientation.FLAT,
            offset: 1,
        });
        expect(board.width).to.equal(13);
        expect(board.height).to.equal(9);
        expect(board.blockedCells).to.deep.equal([
            'i1',  'h1',  'g1',  'f1',  'e1',  'd1',  'c1',
            'b1',  'a1',  'i2',  'h2',  'g2',  'f2',  'e2',
            'd2',  'c2',  'i3',  'h3',  'g3',  'f3',  'e3',
            'd3',  'i4',  'h4',  'g4',  'f4',  'e4',  'i5',
            'h5',  'g5',  'f5',  'b5',  'a5',  'i6',  'h6',
            'g6',  'b6',  'a6',  'd7',  'c7',  'b7',  'a7',
            'b8',  'a8',  'b9',  'a9',  'i10', 'h10', 'b10',
            'a10', 'i11', 'h11', 'c11', 'b11', 'a11', 'i12',
            'h12', 'g12', 'f12', 'b12', 'a12', 'i13', 'h13',
            'g13', 'f13', 'c13', 'b13', 'a13'
        ]);
        expect(board.castRay("c6", Direction.N)).to.deep.equal(["d6", "e6", "f6"]);
        expect(board.castRay("c6", Direction.NE)).to.deep.equal([]);
        expect(board.castRay("c6", Direction.NE, {ignoreVoids: true})).to.deep.equal(["d8", "e9", "e10", "f11"]);
        expect(board.castRay("c6", Direction.S)).to.deep.equal([]);
        expect(board.castRay("c6", Direction.SE)).to.deep.equal([]);
        expect(board.castRay("c6", Direction.SW)).to.deep.equal(["c5", "b4", "b3", "a2"]);
    });

    it("Flat, Odd (Offset -1)", () => {
        const board = new ModularBoard({
            centres: ctrs,
            orientation: Orientation.FLAT,
            offset: -1,
        });
        expect(board.width).to.equal(13);
        expect(board.height).to.equal(10);
        expect(board.blockedCells).to.deep.equal([
            'j1',  'i1',  'h1',  'g1',  'f1',  'e1',  'd1',  'c1',
            'b1',  'a1',  'j2',  'i2',  'h2',  'g2',  'f2',  'e2',
            'd2',  'a2',  'j3',  'i3',  'h3',  'g3',  'f3',  'e3',
            'd3',  'j4',  'i4',  'h4',  'g4',  'f4',  'a4',  'j5',
            'i5',  'h5',  'g5',  'f5',  'b5',  'a5',  'j6',  'i6',
            'h6',  'c6',  'b6',  'a6',  'j7',  'd7',  'c7',  'b7',
            'a7',  'c8',  'b8',  'a8',  'j9',  'b9',  'a9',  'j10',
            'i10', 'c10', 'b10', 'a10', 'j11', 'i11', 'h11', 'c11',
            'b11', 'a11', 'j12', 'i12', 'h12', 'g12', 'c12', 'b12',
            'a12', 'j13', 'i13', 'h13', 'g13', 'f13', 'c13', 'b13',
            'a13'
        ]);
        expect(board.castRay("d6", Direction.N)).to.deep.equal(["e6", "f6", "g6"]);
        expect(board.castRay("d6", Direction.NE)).to.deep.equal([]);
        expect(board.castRay("d6", Direction.NE, {ignoreVoids: true})).to.deep.equal(["e8", "e9", "f10", "f11"]);
        expect(board.castRay("d6", Direction.S)).to.deep.equal([]);
        expect(board.castRay("d6", Direction.SE)).to.deep.equal([]);
        expect(board.castRay("d6", Direction.SW)).to.deep.equal(["c5", "c4", "b3", "b2"]);
    });

    it("Pointy, Even (Offset 1)", () => {
        const board = new ModularBoard({
            centres: ctrs,
            orientation: Orientation.POINTY,
            offset: 1,
        });
        expect(board.width).to.equal(9);
        expect(board.height).to.equal(12);
        expect(board.blockedCells).to.deep.equal([
            'l1', 'k1', 'j1', 'i1', 'h1', 'g1', 'f1',
            'e1', 'd1', 'c1', 'a1', 'i2', 'g2', 'l4',
            'f4', 'd4', 'c4', 'b4', 'a4', 'l5', 'e5',
            'd5', 'c5', 'b5', 'a5', 'l6', 'e6', 'd6',
            'c6', 'b6', 'a6', 'l7', 'k7', 'f7', 'e7',
            'd7', 'c7', 'b7', 'a7', 'l8', 'k8', 'g8',
            'f8', 'e8', 'd8', 'c8', 'b8', 'a8', 'l9',
            'k9', 'j9', 'h9', 'g9', 'f9', 'e9', 'd9',
            'c9', 'b9', 'a9'
        ]);
        expect(board.castRay("e4", Direction.NE)).to.deep.equal([]);
        expect(board.castRay("e4", Direction.NE, {ignoreVoids: true})).to.deep.equal(["g5", "h5", "i6", "j6"]);
        expect(board.castRay("e4", Direction.E)).to.deep.equal([]);
        expect(board.castRay("e4", Direction.SE)).to.deep.equal([]);
        expect(board.castRay("e4", Direction.SW)).to.deep.equal(["d3", "c3", "b2", "a2"]);
        expect(board.castRay("e4", Direction.NW)).to.deep.equal(["f3", "g3", "h2"]);
    });

    it("Pointy, Odd (Offset -1)", () => {
        const board = new ModularBoard({
            centres: ctrs,
            orientation: Orientation.POINTY,
            offset: -1,
        });
        expect(board.width).to.equal(8);
        expect(board.height).to.equal(12);
        expect(board.blockedCells).to.deep.equal([
            'l1', 'j1', 'i1', 'h1', 'g1', 'f1',
            'd1', 'c3', 'a3', 'l4', 'f4', 'e4',
            'd4', 'c4', 'b4', 'a4', 'l5', 'e5',
            'd5', 'c5', 'b5', 'a5', 'l6', 'k6',
            'e6', 'd6', 'c6', 'b6', 'a6', 'l7',
            'k7', 'g7', 'f7', 'e7', 'd7', 'c7',
            'b7', 'a7', 'l8', 'k8', 'g8', 'f8',
            'e8', 'd8', 'c8', 'b8', 'a8'
        ]);
        expect(board.castRay("e3", Direction.NE)).to.deep.equal([]);
        expect(board.castRay("e3", Direction.NE, {ignoreVoids: true})).to.deep.equal(["g4", "h5", "i5", "j6"]);
        expect(board.castRay("e3", Direction.E)).to.deep.equal([]);
        expect(board.castRay("e3", Direction.SE)).to.deep.equal([]);
        expect(board.castRay("e3", Direction.SW)).to.deep.equal(["d3", "c2", "b2", "a1"]);
        expect(board.castRay("e3", Direction.NW)).to.deep.equal(["f3", "g2", "h2"]);
    });
});
