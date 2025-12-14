import "mocha";
import { expect } from "chai";
import { LascaGame } from '../../src/games';
import { CellContents } from "../../src/games/lasca";

describe("Lasca", () => {
    it ("Full captures required", () => {
        const g = new LascaGame();
        g.board = new Map<string, CellContents[]>([
            ["c1", [[1,1],[2,2]]],
            ["b2", [[1,1],[1,1]]],
            ["b4", [[2,2],[1,1]]],
        ]);
        const moves = g.moves(2);
        expect(moves.length).equal(1);
        expect(moves).to.deep.equal(["c1xa3xc5"]);
    });
    it ("No 180 degree turns", () => {
        const g = new LascaGame();
        g.board = new Map<string, CellContents[]>([
            ["c1", [[1,1],[2,2]]],
            ["b2", [[1,1],[1,1]]],
        ]);
        const moves = g.moves(2);
        expect(moves.length).equal(1);
        expect(moves).to.deep.equal(["c1xa3"]);
    });
    it ("Free choice of multiple captures", () => {
        const g = new LascaGame();
        g.board = new Map<string, CellContents[]>([
            ["c1", [[1,1],[2,2]]],
            ["b2", [[1,1],[1,1]]],
            ["b4", [[2,2],[1,1]]],
            ["b6", [[1,1]]],
            ["d6", [[1,1]]],
            ["d4", [[1,1]]],
            ["f2", [[1,1]]],
        ]);
        const moves = g.moves(2);
        expect(moves.length).equal(3);
        expect(moves).to.deep.equal(["c1xa3xc5xa7", "c1xa3xc5xe3xg1", "c1xa3xc5xe7"]);
    });
});

