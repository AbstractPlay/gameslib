import "mocha";
import { expect } from "chai";
import { BashniGame } from "../../src/games";
import { CellContents } from "../../src/games/bashni";

describe("Bashni", () => {
    it("Free choice of multiple captures", () => {
        const g = new BashniGame();
        g.board = new Map<string, CellContents[]>([
            ["c1", [[1, 1], [2, 2]]],
            ["b2", [[1, 1], [1, 1]]],
            ["b4", [[2, 2], [1, 1]]],
            ["b6", [[1, 1]]],
            ["d6", [[1, 1]]],
            ["d4", [[1, 1]]],
            ["f2", [[1, 1]]],
        ]);
        g.currplayer = 2;
        const moves = g.moves(2);
        expect(moves.length).equal(5);
        expect(moves).to.deep.equal([
            "c1xa3xc5xa7xe3xg1",
            "c1xa3xc5xe3xa7xg1",
            "c1xa3xc5xe3xg1xa7",
            "c1xa3xc5xe7",
            "c1xa3xc5xf8",
        ]);
    });

    it("continues capturing after crowning on the king row", () => {
        const g = new BashniGame();
        g.board = new Map<string, CellContents[]>([
            ["a3", [[1, 1]]],
            ["b4", [[2, 1]]],
            ["b6", [[2, 1]]],
        ]);
        g.currplayer = 1;
        const moves = g.moves(1);
        expect(moves).to.include("a3xc5xa7");
        expect(moves).to.not.include("a3xc5");
    });

    it("flying king slides along open diagonals", () => {
        const g = new BashniGame();
        g.board = new Map<string, CellContents[]>([
            ["d8", [[2, 2]]],
        ]);
        g.currplayer = 2;
        const moves = g.moves(2);
        expect(moves).to.include("d8-h4");
        expect(moves).to.include("d8-a5");
        expect(moves).to.include("d8-e7");
    });

    it("flying king must continue capturing after crowning on the king row", () => {
        const g = new BashniGame();
        g.board = new Map<string, CellContents[]>([
            ["b6", [[2, 1]]],
            ["c7", [[1, 1]]],
            ["e7", [[1, 1]]],
        ]);
        g.currplayer = 2;
        const moves = g.moves(2);
        expect(moves).to.include("b6xd8xf6");
        expect(moves).to.not.include("b6xd8");
    });

    it("flying king capture after crowning may land on g5 or h4 (d4xb6xd8 sequence)", () => {
        const g = new BashniGame();
        g.board = new Map<string, CellContents[]>([
            ["f8", [[2, 1]]],
            ["h8", [[2, 1]]],
            ["a7", [[2, 1]]],
            ["g7", [[2, 1]]],
            ["h6", [[2, 1]]],
            ["b2", [[1, 1]]],
            ["h2", [[1, 1]]],
            ["a1", [[1, 1]]],
            ["c1", [[1, 1]]],
            ["e1", [[1, 1]]],
            ["f6", [[2, 1], [2, 1]]],
            ["e3", [[1, 1], [1, 1]]],
            ["d2", [[2, 1], [1, 1]]],
            ["f2", [[1, 1]]],
            ["d4", [[1, 1]]],
            ["c5", [[1, 1], [2, 1]]],
            ["c7", [[2, 1], [2, 1]]],
            ["b8", [[1, 1], [2, 1]]],
        ]);
        g.currplayer = 1;
        const moves = g.moves(1).filter((mv) => mv.startsWith("d4"));
        expect(moves).to.deep.equal(["d4xb6xd8xg5", "d4xb6xd8xh4"]);
    });

    it("crowns only the top man in a column on the king row", () => {
        const g = new BashniGame();
        g.board = new Map<string, CellContents[]>([
            ["a6", [[1, 1], [1, 1]]],
            ["b7", [[2, 1]]],
        ]);
        g.currplayer = 1;
        g.move("a6xc8", { trusted: true });
        const stack = g.board.get("c8")!;
        expect(stack[stack.length - 1]).to.deep.equal([1, 2]);
        expect(stack.filter((p) => p[1] === 2).length).equal(1);
        expect(stack[stack.length - 2]).to.deep.equal([1, 1]);
    });

    it("increments stagnant on quiet moves with unchanged composition", () => {
        const g = new BashniGame();
        g.board = new Map<string, CellContents[]>([
            ["a1", [[1, 1]]],
            ["c3", [[2, 1]]],
        ]);
        g.stagnant = 0;
        g.currplayer = 1;
        g.move("a1-b2", { trusted: true });
        expect(g.stagnant).equal(1);
        g.currplayer = 2;
        g.move("c3-b4", { trusted: true });
        expect(g.stagnant).equal(2);
    });

    it("resets stagnant after a capture changes composition", () => {
        const g = new BashniGame();
        g.board = new Map<string, CellContents[]>([
            ["c3", [[1, 1]]],
            ["b4", [[2, 1]]],
        ]);
        g.stagnant = 5;
        g.currplayer = 1;
        g.move("c3xa5", { trusted: true });
        expect(g.stagnant).equal(0);
    });

    it("allows men to capture backward", () => {
        const g = new BashniGame();
        g.board = new Map<string, CellContents[]>([
            ["c6", [[2, 1]]],
            ["b5", [[1, 1]]],
            ["b3", [[1, 1]]],
            ["d3", [[1, 1]]],
        ]);
        g.currplayer = 2;
        expect(g.moves(2)).to.include("c6xa4xc2xe4");
    });

    it("is experimental", () => {
        expect(BashniGame.gameinfo.flags ?? []).to.include("experimental");
    });
});
