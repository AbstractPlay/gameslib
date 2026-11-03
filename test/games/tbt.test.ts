/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { GameFactory } from "../../src";

describe("Take-Back-Toe emulation", () => {
    it("keeps this turn's die through a preview and rolls the next die on submission", () => {
        const original = Math.random;
        let randomCalls = 0;
        Math.random = () => {
            randomCalls++;
            // init roll -> 1; post-submit reroll -> 6 (must differ from turn die)
            if (randomCalls === 1) {
                return 0.0;
            }
            if (randomCalls === 2) {
                return 0.99;
            }
            return 0.5;
        };
        try {
            const g = GameFactory("tbt") as ReturnType<typeof GameFactory>;
            const turnRoll = g.roll;
            expect(turnRoll).to.equal(1);

            const beforePreview = randomCalls;
            const preview = GameFactory("tbt", g.cheapSerialize());
            preview.move("a2-a1", {trusted: true, emulation: true});
            expect(randomCalls).to.equal(beforePreview);
            expect(preview.roll).to.equal(turnRoll);
            expect(preview.results.some((r) => r.type === "roll")).to.be.false;
            const rep = preview.render();
            expect(rep.legend?.D1).to.deep.equal({name: `d6-${turnRoll}`});

            const submitted = GameFactory("tbt", g.cheapSerialize());
            submitted.move("a2-a1", {trusted: true});
            expect(randomCalls).to.equal(2);
            expect(submitted.roll).to.equal(6);
            expect(submitted.roll).to.not.equal(turnRoll);
            expect(submitted.results.some((r) => r.type === "roll")).to.be.true;
        } finally {
            Math.random = original;
        }
    });
});
