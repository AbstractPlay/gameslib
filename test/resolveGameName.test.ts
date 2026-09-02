import "mocha";
import { expect } from "chai";
import i18next from "i18next";
import { addResource, resolveGameName } from "../src";

const namesFixture = {
    names: {
        hex: "Hex",
        loa: "Lines of Action",
    },
    descriptions: {},
    variants: {},
};

const namesFixtureDe = {
    names: {
        hex: "Hex (DE)",
        loa: "Linien der Action (DE)",
    },
    descriptions: {},
    variants: {},
};

describe("resolveGameName", () => {
    afterEach(() => {
        if (i18next.isInitialized) {
            i18next.removeResourceBundle("en", "apgames");
            i18next.removeResourceBundle("en", "apresults");
            i18next.removeResourceBundle("de", "apgames");
            i18next.removeResourceBundle("de", "apresults");
            // Restore full bundles so later tests (e.g. arimaa validation) are not left
            // with an initialized i18next missing apgames keys.
            addResource("en");
        }
    });

    it("resolves apgames:names.{uid} from the loaded bundle", () => {
        addResource("en", undefined, { bundles: { apgames: namesFixture } });
        expect(resolveGameName("hex", "Fallback")).to.equal("Hex");
        expect(resolveGameName("loa", "Fallback")).to.equal("Lines of Action");
    });

    it("falls back to englishFallback when the locale key is missing", () => {
        addResource("en", undefined, { bundles: { apgames: namesFixture } });
        expect(resolveGameName("unknown-game", "Unknown Title")).to.equal("Unknown Title");
    });

    it("falls back to uid when no key and no englishFallback", () => {
        addResource("en", undefined, { bundles: { apgames: namesFixture } });
        expect(resolveGameName("unknown-game")).to.equal("unknown-game");
    });

    it("returns localized title after changeLanguage", async () => {
        addResource("en", undefined, { bundles: { apgames: namesFixture } });
        addResource("de", undefined, { bundles: { apgames: namesFixtureDe } });
        await i18next.changeLanguage("de");
        expect(resolveGameName("hex", "Hex")).to.equal("Hex (DE)");
    });
});
