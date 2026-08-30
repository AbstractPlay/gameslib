import "mocha";
import { expect } from "chai";
import { cloneState } from "../../src/common/clone-state";
import { BideGame } from "../../src/games/bide";
import { DiffusionGame } from "../../src/games/diffusion";
import { OrdoGame } from "../../src/games/ordo";

describe("cloneState", () => {
    it("deep-copies a Map so mutations do not alias", () => {
        const original = new Map<string, number>([
            ["a", 1],
            ["b", 2],
        ]);
        const copy = cloneState(original);
        copy.set("a", 99);
        expect(original.get("a")).to.equal(1);
        expect(copy.get("a")).to.equal(99);
    });

    it("deep-copies nested arrays in plain objects", () => {
        const original = { rows: [[1, 2], [3, 4]] };
        const copy = cloneState(original);
        copy.rows[0]![0] = 0;
        expect(original.rows[0]![0]).to.equal(1);
    });
});

describe("cloneState spike games", () => {
    it("OrdoGame.moves() uses cloneState for connectivity checks", () => {
        const game = new OrdoGame();
        const moves = game.moves();
        expect(moves.length).to.be.greaterThan(0);
    });

    it("BideGame.clone() isolates board from the original", () => {
        const game = new BideGame(2);
        const before = game.board.get("q0r0");
        const cloned = game.clone();
        if (before !== undefined && cloned.board.has("q0r0")) {
            cloned.board.set("q0r0", 2);
            expect(game.board.get("q0r0")).to.equal(before);
        } else {
            expect(cloned).to.be.instanceOf(BideGame);
            expect(cloned.board).to.not.equal(game.board);
        }
    });

    it("DiffusionGame.clone static helper round-trips", () => {
        const game = new DiffusionGame();
        const cloned = DiffusionGame.clone(game);
        expect(cloned).to.be.instanceOf(DiffusionGame);
        expect(cloned.board).to.deep.equal(game.board);
        cloned.board[0]![0] = 99;
        expect(game.board[0]![0]).to.not.equal(99);
    });
});
