import "mocha";
import { expect } from "chai";
import { MixtourGame } from "../../src/games/mixtour";

describe("Mixtour", () => {
    it("persists score variants in serialized state", () => {
        const g = new MixtourGame(undefined, ["five"]);
        expect(g.target).to.equal(3);
        expect(g.state().variants).to.deep.equal(["five"]);

        const restored = new MixtourGame(g.serialize());
        expect(restored.variants).to.deep.equal(["five"]);
        expect(restored.target).to.equal(3);
    });

    it("infers score variants from target when reloading legacy state", () => {
        const g = new MixtourGame(undefined, ["three"]);
        const legacy = g.state();
        legacy.variants = [];

        const restored = new MixtourGame(legacy);
        expect(restored.variants).to.deep.equal(["three"]);
        expect(restored.target).to.equal(2);
    });
});
