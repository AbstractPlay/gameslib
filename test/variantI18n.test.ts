import "mocha";
import { expect } from "chai";
import i18next from "i18next";
import { addResource } from "../src";
import { AbandeGame } from "../src/games/abande";
import { ArchimedesGame } from "../src/games/archimedes";
import { variantI18nApgamesFixture } from "./fixtures/variantI18nBundles";

describe("variant i18n for records", () => {
    afterEach(() => {
        if (i18next.isInitialized) {
            i18next.removeResourceBundle("en", "apgames");
            i18next.removeResourceBundle("en", "apresults");
        }
    });

    it("resolves named variant labels from inline bundles", () => {
        addResource("en", undefined, { bundles: { apgames: variantI18nApgamesFixture } });
        const g = new ArchimedesGame(undefined, ["8x10"]);
        const labels = g.getVariants();
        expect(labels).to.deep.equal(["8x10 board"]);
        for (const label of labels) {
            expect(label).to.not.match(/^variants\./);
        }
    });

    it("resolves default group labels via variants._default keys", () => {
        addResource("en", undefined, { bundles: { apgames: variantI18nApgamesFixture } });
        const g = new AbandeGame();
        const labels = g.getVariants();
        expect(labels).to.deep.equal(["Default board"]);
        for (const label of labels) {
            expect(label).to.not.match(/^variants\./);
        }
    });
});
