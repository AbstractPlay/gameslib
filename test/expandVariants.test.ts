import "mocha";
import { expect } from "chai";
import { addResource } from "../src/index.js";
import { expandVariantLabels, variantUidsForBatchRating } from "../src/common/expandVariants.js";

describe("expandVariantLabels", () => {
    before(() => {
        addResource("en");
    });

    it("returns sentinel default labels when uids are empty (akimbo)", () => {
        const labels = expandVariantLabels("akimbo", 2, []);
        expect(labels).to.contain("13x13 board");
        expect(labels).to.contain("Akimbo");
    });

    it("orders akimbo labels by variant group then uid (empty vs explicit board size)", () => {
        const emptyLabels = expandVariantLabels("akimbo", 2, []);
        const nineLabels = expandVariantLabels("akimbo", 2, ["size-9"]);
        expect(emptyLabels).to.deep.equal(["13x13 board", "Akimbo"]);
        expect(nineLabels).to.deep.equal(["9x9 board", "Akimbo"]);
    });

    it("fills missing groups for partial uids (go)", () => {
        const labels = expandVariantLabels("go", 2, ["9x9"]);
        expect(
            labels.some((l) => l.includes("9") || l.toLowerCase().includes("9x9")),
        ).to.equal(true);
    });
});

describe("variantUidsForBatchRating", () => {
    before(() => {
        addResource("en");
    });

    it("returns sorted raw uids for chess (no variant groups)", () => {
        expect(variantUidsForBatchRating("chess", 2, [])).to.deep.equal([]);
    });

    it("treats akimbo empty and size-13 as the same pool key", () => {
        const emptyKey = variantUidsForBatchRating("akimbo", 2, []);
        const explicitKey = variantUidsForBatchRating("akimbo", 2, ["size-13"]);
        expect(emptyKey).to.deep.equal(explicitKey);
        expect(emptyKey.length).to.be.greaterThan(0);
        expect(emptyKey.every((u) => u.startsWith("#"))).to.equal(true);
    });

    it("keeps distinct board sizes separate (akimbo 9x9)", () => {
        const nine = variantUidsForBatchRating("akimbo", 2, ["size-9"]);
        const emptyKey = variantUidsForBatchRating("akimbo", 2, []);
        expect(nine).to.not.deep.equal(emptyKey);
        expect(nine).to.contain("size-9");
    });

    it("preserves go board size selection", () => {
        const uids = variantUidsForBatchRating("go", 2, ["size-9"]);
        expect(uids).to.contain("size-9");
        expect(uids).to.not.deep.equal(variantUidsForBatchRating("go", 2, []));
    });
});
