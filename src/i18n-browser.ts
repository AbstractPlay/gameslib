import i18next, { type i18n, type InitOptions } from "i18next";
import HttpApi from "i18next-http-backend";
import { resolveLocale, supportedLocales } from "./i18n-shared";

const GAMESLIB_NAMESPACES = ["apgames", "apresults"] as const;
const DEFAULT_LANG = "en";

let browserInitStarted = false;
let pendingLang = DEFAULT_LANG;

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
export const addResource = (lang?: string, host?: i18n, _options?: import("./i18n-shared").AddResourceOptions) => {
    const targetLang = normalizeBrowserLang(lang ?? host?.language);

    if (host) {
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
        if (host.isInitialized) {
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

    return host ?? i18next;
};

export { supportedLocales };
export { default as i18n } from "i18next";
