import "mocha";
import { expect } from "chai";
import { getBrowserI18nInitOptions, normalizeBrowserLang } from "../src/i18n-browser";
import { supportedLocales } from "../src/i18n-shared";

describe("i18n-browser", () => {
    it("normalizes unknown languages to en", () => {
        expect(normalizeBrowserLang("dev")).to.equal("en");
        expect(normalizeBrowserLang("zz")).to.equal("en");
        expect(normalizeBrowserLang(undefined)).to.equal("en");
    });

    it("keeps supported languages", () => {
        for (const lang of supportedLocales) {
            expect(normalizeBrowserLang(lang)).to.equal(lang);
        }
    });

    it("does not use i18next default dev fallback locale for HTTP loading", () => {
        const options = getBrowserI18nInitOptions("en");
        expect(options.lng).to.equal("en");
        expect(options.fallbackLng).to.equal("en");
        expect(options.fallbackLng).to.not.deep.equal(["dev"]);
        expect(options.supportedLngs).to.deep.equal(supportedLocales);
    });
});
