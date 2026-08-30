import "mocha";
import { expect } from "chai";
import { createInstance } from "i18next";
import { addResource, getBrowserI18nInitOptions, i18n as gameslibI18n, normalizeBrowserLang } from "../src/i18n-browser";
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

    it("maps Spanish variants to es-US", () => {
        expect(normalizeBrowserLang("es")).to.equal("es-US");
        expect(normalizeBrowserLang("es-MX")).to.equal("es-US");
        expect(normalizeBrowserLang("es-419")).to.equal("es-US");
    });

    it("does not use i18next default dev fallback locale for HTTP loading", () => {
        const options = getBrowserI18nInitOptions("en");
        expect(options.lng).to.equal("en");
        expect(options.fallbackLng).to.equal("en");
        expect(options.fallbackLng).to.not.deep.equal(["dev"]);
        expect(options.supportedLngs).to.deep.equal(supportedLocales);
    });

    it("loads locale bundles relative to the page URL", () => {
        const options = getBrowserI18nInitOptions("en");
        expect(options.backend).to.deep.equal({
            loadPath: "./locales/{{lng}}/{{ns}}.json",
        });
    });

    it("syncs game bundles to a dedicated instance without reconfiguring the host", async () => {
        const host = createInstance();
        await host.init({
            lng: "en",
            defaultNS: "apfront",
            ns: ["apfront", "apgames"],
            resources: {
                en: {
                    apfront: { Close: "Close" },
                    apgames: { SOME_GAME_KEY: "game string" },
                },
            },
        });
        addResource("en", host);
        expect(host.options.defaultNS).to.equal("apfront");
        expect(host.t("Close")).to.equal("Close");
        expect(gameslibI18n).to.not.equal(host);
        expect(gameslibI18n.t("apgames:SOME_GAME_KEY")).to.equal("game string");
    });
});
