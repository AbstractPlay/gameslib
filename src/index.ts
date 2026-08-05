import { APGamesInformation } from './schemas/gameinfo';
import { APMoveResult } from './schemas/moveresults';
import { games, GameFactory, IAPGameState, GameBase, GameBaseSimultaneous } from "./games";
import { AIFactory, supportedGames as aiSupported, fastGames as aiFast, slowGames as aiSlow } from './ais';

export {GameFactory, IAPGameState, APMoveResult, APGamesInformation, AIFactory, aiSupported, aiFast, aiSlow, GameBase, GameBaseSimultaneous};

const gameinfo: Map<string, APGamesInformation> = new Map();
games.forEach((v, k) => {
    gameinfo.set(k, v.gameinfo);
});
const gameinfoSorted: APGamesInformation[] = [...games.values()].sort((a, b) => {return a.gameinfo.name.localeCompare(b.gameinfo.name);}).map(a => a.gameinfo);
export {gameinfo, gameinfoSorted};

export { supportedLocales, type AddResourceOptions } from "./i18n-shared";

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
