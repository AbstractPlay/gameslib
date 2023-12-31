/* eslint-disable no-unused-expressions */
/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { ChaseGame } from '../../src/games';
import { UserFacingError } from "../../src/common";
import { Direction } from "honeycomb-grid";

describe("Chase", () => {
    it ("Converting coordinates to algebraic format", () => {
        expect(ChaseGame.coords2algebraic(0, 0)).to.equal("i1");
        expect(ChaseGame.coords2algebraic(8, 8)).to.equal("a9");
        expect(ChaseGame.coords2algebraic(5, 5)).to.equal("d6");
    });
    it ("Converting algebraic format to coordinates", () => {
        expect(ChaseGame.algebraic2coords("i1")).to.have.members([0, 0]);
        expect(ChaseGame.algebraic2coords("a9")).to.have.members([8, 8]);
        expect(ChaseGame.algebraic2coords("d6")).to.have.members([5, 5]);
    });

    it ("Neighbours are calculated correctly", () => {
        const g = new ChaseGame();
        let n = g.neighbours(0, 0);
        expect(n).to.have.deep.members([[1,0],[1,1],[0,1],[8,0]]);
        n = g.neighbours(8, 0);
        expect(n).to.have.deep.members([[7,0],[8,1],[0,1],[0,0]]);
        n = g.neighbours(1, 0);
        expect(n).to.have.deep.members([[0,0],[1,1],[2,1],[2,0]]);
        n = g.neighbours(1, 1);
        expect(n).to.have.deep.members([[0,0],[1,0],[2,1],[1,2],[0,2],[0,1]]);
    });

    it ("Movement vectors are calculated correctly", () => {
        // Regular movement in all directions
        // "NE", "E", "SE", "SW", "W", "NW"
        let v = ChaseGame.vector(4, 5, Direction.NE, 3).vector;
        expect(v).to.have.deep.members([[4,4],[5,3],[5,2]]);
        v = ChaseGame.vector(4, 5, Direction.E, 3).vector;
        expect(v).to.have.deep.members([[5,5],[6,5],[7,5]]);
        v = ChaseGame.vector(4, 5, Direction.SE, 3).vector;
        expect(v).to.have.deep.members([[4,6],[5,7],[5,8]]);
        v = ChaseGame.vector(4, 5, Direction.SW, 3).vector;
        expect(v).to.have.deep.members([[3,6],[3,7],[2,8]]);
        v = ChaseGame.vector(4, 5, Direction.W, 3).vector;
        expect(v).to.have.deep.members([[3,5],[2,5],[1,5]]);
        v = ChaseGame.vector(4, 5, Direction.NW, 3).vector;
        expect(v).to.have.deep.members([[3,4],[3,3],[2,2]]);

        // All six wraparounds
        // left + NW
        v = ChaseGame.vector(0, 6, Direction.NW, 3).vector;
        expect(v).to.have.deep.members([[0,5],[8,4],[8,3]]);
        // left + W
        v = ChaseGame.vector(0, 6, Direction.W, 3).vector;
        expect(v).to.have.deep.members([[8,6],[7,6],[6,6]]);
        v = ChaseGame.vector(0, 8, Direction.W, 1).vector;
        expect(v).to.have.deep.members([[8,8]]);
        v = ChaseGame.vector(0, 0, Direction.W, 1).vector;
        expect(v).to.have.deep.members([[8,0]]);
        // left + SW
        v = ChaseGame.vector(0, 4, Direction.SW, 3).vector;
        expect(v).to.have.deep.members([[0,5],[8,6],[8,7]]);
        // right + NE
        v = ChaseGame.vector(8, 5, Direction.NE, 3).vector;
        expect(v).to.have.deep.members([[8,4],[0,3],[0,2]]);
        // right + E
        v = ChaseGame.vector(8, 5, Direction.E, 3).vector;
        expect(v).to.have.deep.members([[0,5],[1,5],[2,5]]);
        v = ChaseGame.vector(8, 0, Direction.E, 1).vector;
        expect(v).to.have.deep.members([[0,0]]);
        v = ChaseGame.vector(8, 8, Direction.E, 1).vector;
        expect(v).to.have.deep.members([[0,8]]);
        // right + SE
        v = ChaseGame.vector(8, 5, Direction.SE, 3).vector;
        expect(v).to.have.deep.members([[8,6],[0,7],[0,8]]);

        // All four richochets
        v = ChaseGame.vector(5, 7, Direction.SE, 3).vector;
        expect(v).to.have.deep.members([[5,8],[6,7],[6,6]]);
        v = ChaseGame.vector(5, 7, Direction.SW, 3).vector;
        expect(v).to.have.deep.members([[4,8],[4,7],[3,6]]);
        v = ChaseGame.vector(4, 1, Direction.NE, 3).vector;
        expect(v).to.have.deep.members([[4,0],[5,1],[5,2]]);
        v = ChaseGame.vector(4, 1, Direction.NW, 3).vector;
        expect(v).to.have.deep.members([[3,0],[3,1],[2,2]]);

        // Combo richochet and wraparound, just to be sure
        v = ChaseGame.vector(8, 1, Direction.NE, 3).vector;
        expect(v).to.have.deep.members([[8,0],[0,1],[0,2]]);
        v = ChaseGame.vector(8, 7, Direction.SE, 3).vector;
        expect(v).to.have.deep.members([[8,8],[0,7],[0,6]]);
    });

    it("Side move works as expected", () => {
        const g = new ChaseGame();
        expect(() => g.move("a1-a2")).to.not.throw(UserFacingError);
        const a1 = g.board.get("a1");
        const a2 = g.board.get("a2");
        const a9 = g.board.get("a9");
        expect(a1).to.not.be.undefined;
        expect(a2).to.not.be.undefined;
        expect(a9).to.not.be.undefined;
        expect(a1![1]).eq(1);
        expect(a2![1]).eq(1);
        expect(a9![1]).eq(2);
    });

    return it ("Chamber moves are handled correctly", function() {
        this.timeout(0);
        // 10 pieces, eject to left
        // NE
        let g = new ChaseGame();
        g.board.set("c4", [1, 2]);
        g.board.set("a3", [1, 1]);
        expect(() => g.move("c4-e5")).to.not.throw();
        let left = g.board.get("e4");
        expect(left).to.not.be.undefined;
        expect(left![0]).to.equal(1);
        expect(left![1]).to.equal(2);
        expect(g.board.has("d6")).to.be.false;
        // E
        g = new ChaseGame();
        g.board.set("e3", [1, 2]);
        g.board.set("a3", [1, 1]);
        expect(() => g.move("e3-e5")).to.not.throw();
        left = g.board.get("f5");
        expect(left).to.not.be.undefined;
        expect(left![0]).to.equal(1);
        expect(left![1]).to.equal(2);
        expect(g.board.has("d5")).to.be.false;
        // SE
        g = new ChaseGame();
        g.board.set("g4", [1, 2]);
        g.board.set("a3", [1, 1]);
        expect(() => g.move("g4-e5")).to.not.throw();
        left = g.board.get("f6");
        expect(left).to.not.be.undefined;
        expect(left![0]).to.equal(1);
        expect(left![1]).to.equal(2);
        expect(g.board.has("e4")).to.be.false;
        // SW
        g = new ChaseGame();
        g.board.set("g6", [1, 2]);
        g.board.set("a3", [1, 1]);
        expect(() => g.move("g6-e5")).to.not.throw();
        left = g.board.get("e6");
        expect(left).to.not.be.undefined;
        expect(left![0]).to.equal(1);
        expect(left![1]).to.equal(2);
        expect(g.board.has("f5")).to.be.false;
        // W
        g = new ChaseGame();
        g.board.set("e7", [1, 2]);
        g.board.set("a3", [1, 1]);
        expect(() => g.move("e7-e5")).to.not.throw();
        left = g.board.get("d6");
        expect(left).to.not.be.undefined;
        expect(left![0]).to.equal(1);
        expect(left![1]).to.equal(2);
        expect(g.board.has("f6")).to.be.false;
        // NW
        g = new ChaseGame();
        g.board.set("c6", [1, 2]);
        g.board.set("a3", [1, 1]);
        expect(() => g.move("c6-e5")).to.not.throw();
        left = g.board.get("d5");
        expect(left).to.not.be.undefined;
        expect(left![0]).to.equal(1);
        expect(left![1]).to.equal(2);
        expect(g.board.has("e6")).to.be.false;

        // It's a 1, so eject to left
        // We've already proven that leftdirs works properly, so we only have to test one direction
        // NE
        g = new ChaseGame();
        g.board.delete("a1");
        g.board.set("d5", [1, 1]);
        expect(() => g.move("d5-e5")).to.not.throw();
        left = g.board.get("e4");
        expect(left).to.not.be.undefined;
        expect(left![0]).to.equal(1);
        expect(left![1]).to.equal(1);
        expect(g.board.has("d6")).to.be.false;

        // It's a 5, so split properly
        // We've proven leftdirs, but not rightdirs
        // NE
        g = new ChaseGame();
        g.board.delete("a5");
        g.board.delete("a3");
        g.board.set("b1", [1, 3]);
        g.board.set("b3", [1, 5]);
        expect(() => g.move("b3-e5")).to.not.throw();
        left = g.board.get("e4");
        let right = g.board.get("d6");
        expect(left).to.not.be.undefined;
        expect(left![0]).to.equal(1);
        expect(left![1]).to.equal(3);
        expect(right).to.not.be.undefined;
        expect(right![0]).to.equal(1);
        expect(right![1]).to.equal(2);
        // E
        g = new ChaseGame();
        g.board.delete("a5");
        g.board.set("e9", [1, 5]);
        expect(() => g.move("e9-e5")).to.not.throw();
        left = g.board.get("f5");
        right = g.board.get("d5");
        expect(left).to.not.be.undefined;
        expect(left![0]).to.equal(1);
        expect(left![1]).to.equal(3);
        expect(right).to.not.be.undefined;
        expect(right![0]).to.equal(1);
        expect(right![1]).to.equal(2);
        // SE
        g = new ChaseGame();
        g.board.delete("a5");
        g.board.delete("i3");
        g.board.set("h3", [1, 5]);
        expect(() => g.move("h3-e5")).to.not.throw();
        left = g.board.get("f6");
        right = g.board.get("e4");
        expect(left).to.not.be.undefined;
        expect(left![0]).to.equal(1);
        expect(left![1]).to.equal(3);
        expect(right).to.not.be.undefined;
        expect(right![0]).to.equal(1);
        expect(right![1]).to.equal(2);
        // SW
        g = new ChaseGame();
        g.board.delete("a5");
        g.board.delete("i7");
        g.board.set("h8", [1, 5]);
        expect(() => g.move("h8-e5")).to.not.throw();
        left = g.board.get("e6");
        right = g.board.get("f5");
        expect(left).to.not.be.undefined;
        expect(left![0]).to.equal(1);
        expect(left![1]).to.equal(3);
        expect(right).to.not.be.undefined;
        expect(right![0]).to.equal(1);
        expect(right![1]).to.equal(2);
        // W
        g = new ChaseGame();
        g.board.delete("a5");
        g.board.set("e1", [1, 5]);
        expect(() => g.move("e1-e5")).to.not.throw();
        left = g.board.get("d6");
        right = g.board.get("f6");
        expect(left).to.not.be.undefined;
        expect(left![0]).to.equal(1);
        expect(left![1]).to.equal(3);
        expect(right).to.not.be.undefined;
        expect(right![0]).to.equal(1);
        expect(right![1]).to.equal(2);
        // NW
        g = new ChaseGame();
        g.board.delete("a5");
        g.board.delete("a7");
        g.board.set("b1", [1, 3]);
        g.board.set("b8", [1, 5]);
        expect(() => g.move("b8-e5")).to.not.throw();
        left = g.board.get("d5");
        right = g.board.get("e6");
        expect(left).to.not.be.undefined;
        expect(left![0]).to.equal(1);
        expect(left![1]).to.equal(3);
        expect(right).to.not.be.undefined;
        expect(right![0]).to.equal(1);
        expect(right![1]).to.equal(2);
    });
});

