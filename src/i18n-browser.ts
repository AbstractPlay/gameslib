import i18next, { type i18n } from "i18next";
import { supportedLocales } from "./i18n-shared";

const GAMESLIB_NAMESPACES = ["apgames", "apresults"] as const;

let browserInitStarted = false;

const copyHostBundles = (instance: i18n, host: i18n, lang?: string): void => {
    const targetLang = lang ?? host.language;
    for (const ns of GAMESLIB_NAMESPACES) {
        const bundle = host.getResourceBundle(targetLang, ns);
        if (bundle) {
            instance.addResourceBundle(targetLang, ns, bundle, true, true);
        }
    }
};

const ensureBrowserHttpInit = (lang: string): void => {
    if (browserInitStarted || i18next.isInitialized) {
        return;
    }
    browserInitStarted = true;
    void import("i18next-http-backend").then(({ default: HttpApi }) => {
        void i18next
            .use(HttpApi)
            .init({
                lng: lang,
                ns: [...GAMESLIB_NAMESPACES],
                backend: {
                    loadPath: "/locales/{{lng}}/{{ns}}.json",
                },
            });
    });
};

export const addResource = (lang?: string, host?: i18n) => {
    const targetLang = lang ?? host?.language ?? "en";

    if (host) {
        if (!i18next.isInitialized) {
            void i18next.init({
                lng: targetLang,
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
        void i18next.changeLanguage(host.language);
    } else if (lang !== undefined && i18next.isInitialized && i18next.language !== lang) {
        void i18next.changeLanguage(lang);
    }

    return host ?? i18next;
};

export { supportedLocales };
