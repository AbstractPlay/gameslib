import { APGamesInformation } from './schemas/gameinfo';
import { APMoveResult } from './schemas/moveresults';
import { games, GameFactory, IAPGameState, GameBase } from "./games";
import { AIFactory, supportedGames as aiSupported, fastGames as aiFast, slowGames as aiSlow } from './ais';

export {GameFactory, IAPGameState, APMoveResult, APGamesInformation, AIFactory, aiSupported, aiFast, aiSlow, GameBase};

const gameinfo: Map<string, APGamesInformation> = new Map();
games.forEach((v, k) => {
    gameinfo.set(k, v.gameinfo);
});
export {gameinfo};
