import { APGamesInformation } from './schemas/gameinfo';
import { APMoveResult } from './schemas/moveresults';
import { games, GameFactory, IAPGameState, GameBase, GameBaseSimultaneous } from "./games";
import { AIFactory, supportedGames as aiSupported, fastGames as aiFast, slowGames as aiSlow } from './ais';
import i18next, { type i18n } from "i18next";
import enGames from "../locales/en/apgames.json"
import frGames from "../locales/fr/apgames.json";
import deGames from "../locales/de/apgames.json";
import itGames from "../locales/it/apgames.json";
import enResults from "../locales/en/apresults.json"
import frResults from "../locales/fr/apresults.json";
import deResults from "../locales/de/apresults.json";
import itResults from "../locales/it/apresults.json";

export {GameFactory, IAPGameState, APMoveResult, APGamesInformation, AIFactory, aiSupported, aiFast, aiSlow, GameBase, GameBaseSimultaneous};

const gameinfo: Map<string, APGamesInformation> = new Map();
games.forEach((v, k) => {
    gameinfo.set(k, v.gameinfo);
});
const gameinfoSorted: APGamesInformation[] = [...games.values()].sort((a, b) => {return a.gameinfo.name.localeCompare(b.gameinfo.name);}).map(a => a.gameinfo);
export {gameinfo, gameinfoSorted};

export const supportedLocales: string[] = ["en", "fr", "de", "it"];

const localeBundles = {
    en: { apgames: enGames, apresults: enResults },
    fr: { apgames: frGames, apresults: frResults },
    de: { apgames: deGames, apresults: deResults },
    it: { apgames: itGames, apresults: itResults },
} as const;

const registerResourceBundles = (instance: i18n) => {
    for (const [lang, bundles] of Object.entries(localeBundles)) {
        for (const [ns, data] of Object.entries(bundles)) {
            // Deep-merge so newer gameslib releases can add keys without stale bundles blocking updates.
            instance.addResourceBundle(lang, ns, data, true, true);
        }
    }
};

export const addResource = (lang?: string, host?: i18n) => {
    // Register on every i18next instance the host may use. In some webpack builds the
    // front app's i18n import and gameslib's i18next import are different objects.
    const instances: i18n[] = [i18next];
    if (host && !instances.includes(host)) {
        instances.push(host);
    }

    for (const instance of instances) {
        if (instance.isInitialized || instance === host) {
            registerResourceBundles(instance);
        }
    }

    if (host && host !== i18next && host.isInitialized && i18next.isInitialized && host.language !== i18next.language) {
        void i18next.changeLanguage(host.language);
    }

    if (!i18next.isInitialized) {
        // Always init gameslib's i18next when needed. chatLog() calls i18next.t()
        // directly; an uninitialized instance returns undefined and yields empty logs.
        void i18next.init({
            lng: lang ?? host?.language,
            ns: ["apgames", "apresults"],
            initImmediate: false,
            resources: localeBundles,
        });
    } else if (lang !== undefined && i18next.language !== lang) {
        void i18next.changeLanguage(lang);
    }
    return host ?? i18next;
}
