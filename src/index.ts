import { APGamesInformation } from './schemas/gameinfo';
import { games, GameFactory } from "./games";
import { AIFactory, supportedGames as aiSupported, fastGames as aiFast, slowGames as aiSlow } from './ais';

export {GameFactory, AIFactory, aiSupported, aiFast, aiSlow};

const gameinfo: Map<string, APGamesInformation> = new Map();
games.forEach((v, k) => {
    gameinfo.set(k, v.gameinfo);
});
export {gameinfo};
