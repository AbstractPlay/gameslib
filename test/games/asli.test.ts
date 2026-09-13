import "mocha";
import { expect } from "chai";
import { AsliGame } from "../../src/games/asli";

describe("Asli", () => {
    it("includes the 23x23 board size in the variant metadata", () => {
        expect(AsliGame.gameinfo.variants).to.deep.include({ uid: "board-23", group: "board" });
    });

    it("uses a 23x23 board when the board-23 variant is selected", () => {
        const game = new AsliGame(undefined, ["board-23"]);
        const rep = game.render();

        expect(game.boardsize).to.equal(23);
        expect(rep.board).to.include({ width: 23, height: 23 });
        expect(game.getGraph().graph.order).to.equal(23 * 23);
        expect(game.coords2algebraic(22, 0)).to.equal("w23");

        const restored = new AsliGame(game.serialize());
        expect(restored.variants).to.deep.equal(["board-23"]);
        expect(restored.boardsize).to.equal(23);
    });
});
