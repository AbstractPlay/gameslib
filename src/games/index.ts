import { APGamesInformation } from "../schemas/gameinfo";
import { GameBase, GameBaseSimultaneous, IAPGameState } from "./_base";
import { games, GameConstructor } from "./_registry.generated";

export {
    APGamesInformation,
    GameBase,
    GameBaseSimultaneous,
    IAPGameState,
    games,
    GameConstructor,
};

export * from "./_registry.generated";

export const GameFactory = (game: string, ...args: unknown[]): GameBase | GameBaseSimultaneous | undefined => {
    const ctor = games.get(game);
    if (ctor === undefined) {
        return undefined;
    }
    return ctor.create(...args);
};
