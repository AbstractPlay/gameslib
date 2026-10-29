/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { GameFactory } from "../../src";

describe("Take-Back-Toe emulation", () => {
    it("keeps this turn's die through a preview and rolls the next die on submission", () => {
        const g = GameFactory("tbt") as ReturnType<typeof GameFactory>;
        const turnRoll = g.roll;
        let calls = 0;
        const original = Math.random;
        Math.random = () => {
            calls++;
            return 0.5;
        };
        let preview: ReturnType<typeof GameFactory>;
        try {
            preview = GameFactory("tbt", g.cheapSerialize());
            preview.move("a2-a1", {trusted: true, emulation: true});
        } finally {
            Math.random = original;
        }
        expect(calls).to.equal(0);
        expect(preview!.roll).to.equal(turnRoll);
        expect(preview!.results.some((r) => r.type === "roll")).to.be.false;
        const rep = preview!.render();
        expect(rep.legend?.D1).to.deep.equal({name: `d6-${turnRoll}`});

        const submitted = GameFactory("tbt", g.cheapSerialize());
        submitted.move("a2-a1", {trusted: true});
        expect(submitted.roll).to.not.equal(turnRoll);
        expect(submitted.results.some((r) => r.type === "roll")).to.be.true;
    });
});
