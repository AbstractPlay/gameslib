import { APGamesInformation } from './schemas/gameinfo';
import { APMoveResult } from './schemas/moveresults';
import { games, GameFactory, IAPGameState, GameBase } from "./games";
import { AIFactory, supportedGames as aiSupported, fastGames as aiFast, slowGames as aiSlow } from './ais';
import i18next from "i18next";
import enResources from "../locales/en/apgames.json"
import frResources from "../locales/fr/apgames.json";

export {GameFactory, IAPGameState, APMoveResult, APGamesInformation, AIFactory, aiSupported, aiFast, aiSlow, GameBase};

const gameinfo: Map<string, APGamesInformation> = new Map();
games.forEach((v, k) => {
    gameinfo.set(k, v.gameinfo);
});
const gameinfoSorted: APGamesInformation[] = [...games.values()].sort((a, b) => {return a.gameinfo.name.localeCompare(b.gameinfo.name);}).map(a => a.gameinfo);
export {gameinfo, gameinfoSorted};

export const supportedLocales: string[] = ["en", "fr"];
export function addResource(lang?: string) {
    if (i18next.isInitialized) {
        // i18next already exists
        if (!i18next.hasResourceBundle("en", "apgames")) {
            i18next.addResourceBundle("en", "apgames", enResources);
        }
        if (!i18next.hasResourceBundle("fr", "apgames")) {
            i18next.addResourceBundle("fr", "apgames", frResources);
        }
        if (lang) {
            i18next.changeLanguage(lang);
        }
    } else {
        // i18next isn't in the host, so use it ourselves
        i18next.init({
            lng: lang,
            ns: ["apgames"],
            initImmediate: false,
            resources: {
            en: {
                apgames: enResources,
            },
            fr: {
                apgames: frResources,
            },
        },
        });
    }
    return i18next;
}
