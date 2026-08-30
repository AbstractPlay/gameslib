import type { i18n } from "i18next";
import * as i18nextModule from "i18next";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { supportedLocales, type AddResourceOptions } from "./i18n-shared.js";

/** Node uses the global i18next singleton so game validation shares the same instance. */
const i18next: i18n = (i18nextModule as unknown as { default: i18n }).default;

const GAMESLIB_NAMESPACES = ["apgames", "apresults"] as const;

export type { AddResourceOptions };

const loadLocaleBundles = (lang: string): Record<string, object> => {
    const packagedLocales = path.join(__dirname, "locales");
    const sourceLocales = path.join(__dirname, "../locales");
    const localesPath = existsSync(packagedLocales) ? packagedLocales : sourceLocales;
    const bundles: Record<string, object> = {};
    for (const ns of GAMESLIB_NAMESPACES) {
        const filePath = path.join(localesPath, lang, `${ns}.json`);
        if (existsSync(filePath)) {
            bundles[ns] = JSON.parse(readFileSync(filePath, "utf8"));
        }
    }
    return bundles;
};

const resolveBundles = (lang: string, options?: AddResourceOptions): Record<string, object> => {
    if (options?.bundles !== undefined) {
        return { ...options.bundles };
    }
    return loadLocaleBundles(lang);
};

const buildNodeResources = (lang?: string, options?: AddResourceOptions): Record<string, Record<string, object>> => {
    const resources: Record<string, Record<string, object>> = {};
    const langs = lang ? [lang] : supportedLocales;
    for (const l of langs) {
        resources[l] = resolveBundles(l, lang === l ? options : undefined);
    }
    return resources;
};

const warnIfVariantI18nMissing = (): void => {
    const probe = i18next.t("apgames:variants.archimedes.8x10.name");
    if (probe.startsWith("variants.")) {
        // Intentional: surfaces missing locale bundles in Lambda logs.
        // eslint-disable-next-line no-console
        console.warn(`gameslib addResource: apgames variant translations missing (probe resolved to "${probe}")`);
    }
};

export const addResource = (lang?: string, host?: i18n, options?: AddResourceOptions) => {
    const targetLang = lang ?? host?.language ?? "en";

    if (!i18next.isInitialized) {
        void i18next.init({
            lng: targetLang,
            ns: [...GAMESLIB_NAMESPACES],
            initImmediate: false,
            resources: buildNodeResources(lang, options),
        });
        warnIfVariantI18nMissing();
    } else if (lang) {
        const shouldLoad = options?.bundles !== undefined || !i18next.hasResourceBundle(lang, "apgames");
        if (shouldLoad) {
            const bundles = resolveBundles(lang, options);
            for (const [ns, data] of Object.entries(bundles)) {
                i18next.addResourceBundle(lang, ns, data, true, true);
            }
            if (options?.bundles !== undefined) {
                warnIfVariantI18nMissing();
            }
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
