/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { OrbGame } from "../../src/games/orb";

describe("Generatorb (orb)", () => {
    it("persists noglobes in serialized state", () => {
        const g = new OrbGame(undefined, ["noglobes"]);
        expect(g.board.has("d4")).to.be.false;
        expect(g.board.has("e5")).to.be.false;
        expect(g.state().variants).to.deep.equal(["noglobes"]);

        const restored = new OrbGame(g.serialize());
        expect(restored.variants).to.deep.equal(["noglobes"]);
        expect(restored.board.has("d4")).to.be.false;
    });

    it("infers noglobes from the opening board when reloading legacy state", () => {
        const g = new OrbGame(undefined, ["noglobes"]);
        const legacy = g.state();
        legacy.variants = [];

        const restored = new OrbGame(legacy);
        expect(restored.variants).to.deep.equal(["noglobes"]);
    });

    it("keeps game-level variants when rewinding to the opening stack frame", () => {
        const g = new OrbGame(undefined, ["noglobes"]);
        expect(g.stack[0]?.board.has("d4")).to.be.false;

        const restored = new OrbGame(g.serialize());
        restored.load(0);
        expect(restored.variants).to.deep.equal(["noglobes"]);
    });
});
