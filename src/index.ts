import { APGamesInformation } from './schemas/gameinfo';
import { APMoveResult } from './schemas/moveresults';
import { games, GameFactory, IAPGameState, GameBase, GameBaseSimultaneous } from "./games";
import { AIFactory, supportedGames as aiSupported, fastGames as aiFast, slowGames as aiSlow } from './ais';
import i18next from "i18next";
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

const registerResourceBundles = () => {
    for (const [lang, bundles] of Object.entries(localeBundles)) {
        for (const [ns, data] of Object.entries(bundles)) {
            if (!i18next.hasResourceBundle(lang, ns)) {
                i18next.addResourceBundle(lang, ns, data);
            }
        }
    }
};

export const addResource = (lang?: string) => {
    if (i18next.isInitialized) {
        registerResourceBundles();
    } else {
        // i18next isn't in the host, so use it ourselves
        void i18next.init({
            lng: lang,
            ns: ["apgames", "apresults"],
            initImmediate: false,
            resources: localeBundles,
        });
    }
    return i18next;
}
