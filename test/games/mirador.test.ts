import "mocha";
import { expect } from "chai";
import { MiradorGame } from "../../src/games/mirador";

describe("Mirador", () => {
    it("names both board sizes in the variant metadata", () => {
        expect(MiradorGame.gameinfo.variants).to.deep.equal([
            { uid: "#board" },
            { uid: "size-40", group: "board" },
        ]);
    });

    it("keeps the standard 28x28 board as the default", () => {
        const game = new MiradorGame();
        const rep = game.render();

        expect(game.board).to.have.length(27);
        expect(Object.keys(game.board[0])).to.have.length(27);
        expect(rep.board).to.include({ width: 28, height: 28 });
        expect(game.moves()).to.have.length(26 * 26 + 1);
        expect(game.moves()).to.include.members(["a26", "z1", "declare"]);
    });

    it("supports legal placements and multi-letter notation on the 40x40 board", () => {
        const game = new MiradorGame(undefined, ["size-40"]);
        const rep = game.render();
        const board = rep.board as { columnLabels: string[]; height: number; rowLabels: string[]; width: number };

        expect(game.board).to.have.length(39);
        expect(Object.keys(game.board[0])).to.have.length(39);
        expect(board).to.include({ width: 40, height: 40 });
        expect(board.columnLabels).to.have.length(40);
        expect(board.columnLabels.slice(-3)).to.deep.equal(["ak", "al", ""]);
        expect(board.rowLabels).to.have.length(40);
        expect(board.rowLabels.slice(-3)).to.deep.equal(["37", "38", ""]);

        const moves = game.moves();
        expect(moves).to.have.length(38 * 38 + 1);
        expect(moves).to.include.members(["a38", "z38", "aa38", "al1", "declare"]);
        expect(game.validateMove("aa38").valid).to.equal(true);
        expect(game.validateMove("al1").valid).to.equal(true);
        expect(game.validateMove("am1").valid).to.equal(false);
        expect(game.validateMove("al0").valid).to.equal(false);

        const click = game.handleClick("", 1, 27);
        expect(click.valid).to.equal(true);
        expect(click.move).to.equal("aa38");
        expect(game.handleClick("", 1, 39).valid).to.equal(false);

        game.move("al1");
        expect(game.board[37][37]).to.equal(1);
        expect(game.board[37][38]).to.equal(1);
        expect(game.board[38][37]).to.equal(1);
        expect(game.board[38][38]).to.equal(1);

        const restored = new MiradorGame(game.serialize());
        expect(restored.variants).to.deep.equal(["size-40"]);
        expect(restored.render().board).to.include({ width: 40, height: 40 });
    });

    it("accepts multi-letter placements during a challenge", () => {
        const game = new MiradorGame(undefined, ["size-40"]);
        game.move("declare");

        const validation = game.validateMove("aa38-al1");
        expect(validation.valid).to.equal(true);
        expect(validation.complete).to.equal(0);
    });

    it("rejects adjacent placements within the same challenge response", () => {
        const game = new MiradorGame(undefined, ["size-40"]);
        game.move("declare");

        expect(game.validateMove("a38-c37").valid).to.equal(false);
    });

    it("checks connections against the enlarged board edge", () => {
        const game = new MiradorGame(undefined, ["size-40"]);
        game.board[0][0] = 1;
        game.board[0][25] = 1;
        game.board[0][30] = 2;

        expect(game["isConnected"](true, 1)).to.equal(false);
    });
});
