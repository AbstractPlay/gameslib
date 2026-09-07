import { type i18n, type InitOptions } from "i18next";
import * as i18nextModule from "i18next";
import HttpApi from "i18next-http-backend";
import { i18next } from "./i18n-instance.js";
import { resolveLocale, supportedLocales } from "./i18n-shared.js";
import { resolveGameNameOn } from "./i18n-resolve.js";

/** Game engines import the npm i18next default singleton; mirror bundles from the browser instance. */
const i18nextDefault: i18n = (i18nextModule as unknown as { default: i18n }).default;

const GAMESLIB_NAMESPACES = ["apgames", "apresults"] as const;
const DEFAULT_LANG = "en";

let browserInitStarted = false;
let pendingLang = DEFAULT_LANG;
let gameSingletonSyncStarted = false;

/** Game engines import the npm i18next default singleton; mirror bundles from the browser instance. */
const syncBundlesToGameSingleton = (lang?: string): void => {
    const targetLang = normalizeBrowserLang(lang ?? i18next.language);
    const resources: Record<string, Record<string, object>> = {};
    let hasBundle = false;
    for (const ns of GAMESLIB_NAMESPACES) {
        const bundle = i18next.getResourceBundle(targetLang, ns);
        if (bundle) {
            hasBundle = true;
            if (resources[targetLang] === undefined) {
                resources[targetLang] = {};
            }
            resources[targetLang][ns] = bundle;
        }
    }
    if (!hasBundle) {
        return;
    }

    if (!i18nextDefault.isInitialized) {
        void i18nextDefault.init({
            lng: targetLang,
            fallbackLng: targetLang,
            ns: [...GAMESLIB_NAMESPACES],
            initImmediate: false,
            resources,
        });
        return;
    }

    for (const ns of GAMESLIB_NAMESPACES) {
        const bundle = i18next.getResourceBundle(targetLang, ns);
        if (bundle) {
            i18nextDefault.addResourceBundle(targetLang, ns, bundle, true, true);
        }
    }
    if (i18nextDefault.language !== targetLang) {
        void i18nextDefault.changeLanguage(targetLang);
    }
};

const ensureGameSingletonSync = (): void => {
    if (gameSingletonSyncStarted) {
        return;
    }
    gameSingletonSyncStarted = true;
    const sync = () => {
        syncBundlesToGameSingleton(i18next.language);
    };
    i18next.on("initialized", sync);
    i18next.on("loaded", sync);
    i18next.on("languageChanged", sync);
    if (i18next.isInitialized) {
        sync();
    }
};

export function normalizeBrowserLang(lang?: string): string {
    return resolveLocale(lang);
}

export function getBrowserI18nInitOptions(lang: string): InitOptions {
    const lng = normalizeBrowserLang(lang);
    return {
        lng,
        fallbackLng: lng,
        supportedLngs: [...supportedLocales],
        nonExplicitSupportedLngs: false,
        ns: [...GAMESLIB_NAMESPACES],
        backend: {
            loadPath: "./locales/{{lng}}/{{ns}}.json",
        },
    };
}

const copyHostBundles = (instance: i18n, host: i18n, lang?: string): void => {
    const targetLang = normalizeBrowserLang(lang ?? host.language);
    for (const ns of GAMESLIB_NAMESPACES) {
        const bundle = host.getResourceBundle(targetLang, ns);
        if (bundle) {
            instance.addResourceBundle(targetLang, ns, bundle, true, true);
        }
    }
    syncBundlesToGameSingleton(targetLang);
};

const ensureBrowserHttpInit = (lang: string): void => {
    pendingLang = normalizeBrowserLang(lang);
    if (i18next.isInitialized) {
        if (i18next.language !== pendingLang) {
            void i18next.changeLanguage(pendingLang);
        }
        return;
    }
    if (browserInitStarted) {
        return;
    }
    browserInitStarted = true;
    void i18next
        .use(HttpApi)
        .init(getBrowserI18nInitOptions(pendingLang))
        .catch((err: unknown) => {
            // eslint-disable-next-line no-console
            console.error("gameslib i18n init failed:", err);
        });
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const addResource = (lang?: string, host?: i18n, _options?: import("./i18n-shared.js").AddResourceOptions) => {
    const targetLang = normalizeBrowserLang(lang ?? host?.language);
    ensureGameSingletonSync();

    if (host) {
        if (host.isInitialized) {
            if (!i18next.isInitialized) {
                void i18next.init({
                    lng: targetLang,
                    fallbackLng: targetLang,
                    supportedLngs: [...supportedLocales],
                    nonExplicitSupportedLngs: false,
                    ns: [...GAMESLIB_NAMESPACES],
                    initImmediate: false,
                    resources: {},
                });
            }
            copyHostBundles(i18next, host, targetLang);
        }
    } else {
        ensureBrowserHttpInit(targetLang);
    }

    if (host && host !== i18next && host.isInitialized && i18next.isInitialized && host.language !== i18next.language) {
        void i18next.changeLanguage(normalizeBrowserLang(host.language));
    } else if (lang !== undefined && i18next.isInitialized && i18next.language !== targetLang) {
        void i18next.changeLanguage(targetLang);
    }

    if (i18next.isInitialized) {
        syncBundlesToGameSingleton(targetLang);
    }

    return host ?? i18next;
};

export function resolveGameName(uid: string, englishFallback?: string): string {
    return resolveGameNameOn(i18next, uid, englishFallback);
}

export { supportedLocales };
export { i18next as i18n } from "./i18n-instance.js";
