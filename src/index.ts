import { APGamesInformation } from './schemas/gameinfo';
import { APMoveResult } from './schemas/moveresults';
import { games, GameFactory, IAPGameState, GameBase, GameBaseSimultaneous } from "./games";
import { AIFactory, supportedGames as aiSupported, fastGames as aiFast, slowGames as aiSlow } from './ais';
import { APGAMES_PRODUCTION } from "./games/_build-flags.generated";

export {GameFactory, IAPGameState, APMoveResult, APGamesInformation, AIFactory, aiSupported, aiFast, aiSlow, GameBase, GameBaseSimultaneous};

function filterGameinfoForExport(info: APGamesInformation): APGamesInformation {
    if (!APGAMES_PRODUCTION) {
        return info;
    }
    const filtered: APGamesInformation = { ...info };
    if (filtered.variants !== undefined) {
        filtered.variants = filtered.variants.filter((v) => !v.experimental);
    }
    if (filtered.flags !== undefined) {
        filtered.flags = filtered.flags.filter((f) => f !== "experimental");
    }
    return filtered;
}

const gameinfo: Map<string, APGamesInformation> = new Map();
games.forEach((v, k) => {
    gameinfo.set(k, filterGameinfoForExport(v.gameinfo));
});
const gameinfoSorted: APGamesInformation[] = [...games.values()]
    .sort((a, b) => a.gameinfo.name.localeCompare(b.gameinfo.name))
    .map((a) => filterGameinfoForExport(a.gameinfo));
export {gameinfo, gameinfoSorted};

export { resolveLocale, supportedLocales, type AddResourceOptions } from "./i18n-shared";

const isNode = typeof window === "undefined";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const i18nModule = isNode ? require("./i18n-node") : require("./i18n-browser");

export const addResource = i18nModule.addResource as (
    lang?: string,
    host?: import("i18next").i18n,
    options?: import("./i18n-shared").AddResourceOptions,
) => import("i18next").i18n;

// Browser-only: shared i18next singleton used by games and the playground.
export const i18n: import("i18next").i18n | undefined = isNode
    ? undefined
    : (i18nModule as { i18n: import("i18next").i18n }).i18n;
