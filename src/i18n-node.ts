import i18next, { type i18n } from "i18next";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { supportedLocales } from "./i18n-shared";

const GAMESLIB_NAMESPACES = ["apgames", "apresults"] as const;

const loadLocaleBundles = (lang: string): Record<string, object> => {
    const localesPath = path.join(__dirname, "../locales");
    const bundles: Record<string, object> = {};
    for (const ns of GAMESLIB_NAMESPACES) {
        const filePath = path.join(localesPath, lang, `${ns}.json`);
        if (existsSync(filePath)) {
            bundles[ns] = JSON.parse(readFileSync(filePath, "utf8"));
        }
    }
    return bundles;
};

const buildNodeResources = (lang?: string): Record<string, Record<string, object>> => {
    const resources: Record<string, Record<string, object>> = {};
    const langs = lang ? [lang] : supportedLocales;
    for (const l of langs) {
        resources[l] = loadLocaleBundles(l);
    }
    return resources;
};

export const addResource = (lang?: string, host?: i18n) => {
    const targetLang = lang ?? host?.language ?? "en";

    if (!i18next.isInitialized) {
        void i18next.init({
            lng: targetLang,
            ns: [...GAMESLIB_NAMESPACES],
            initImmediate: false,
            resources: buildNodeResources(lang),
        });
    } else if (lang && !i18next.hasResourceBundle(lang, "apgames")) {
        const bundles = loadLocaleBundles(lang);
        for (const [ns, data] of Object.entries(bundles)) {
            i18next.addResourceBundle(lang, ns, data, true, true);
        }
        if (i18next.language !== lang) {
            void i18next.changeLanguage(lang);
        }
    } else if (lang !== undefined && i18next.language !== lang) {
        void i18next.changeLanguage(lang);
    }

    return host ?? i18next;
};

export { supportedLocales };
