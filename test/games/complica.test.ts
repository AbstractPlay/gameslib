import { expect } from "chai";
import { addResource } from "../../src/i18n-node.js";
import { ComplicaGame, gameApgamesEn } from "../../src/games/complica.js";

describe("Complica", () => {
    before(() => {
        addResource("en");
    });

    it("validateMove with empty input resolves initial instructions from apgames bundle", () => {
        const g = new ComplicaGame();
        const result = g.validateMove("");
        expect(result.valid).to.equal(true);
        expect(result.message).to.equal(gameApgamesEn.validation.INITIAL_INSTRUCTIONS);
    });

    it("description() resolves from gameinfo English", () => {
        const g = new ComplicaGame();
        expect(g.description()).to.equal(ComplicaGame.gameinfo.description);
    });
});
