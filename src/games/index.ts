import { APGamesInformation } from "../schemas/gameinfo";
import { GameBase, GameBaseSimultaneous, GameBaseSkipTurn, IAPGameState } from "./_base";
import { games, GameConstructor } from "./_registry.generated";

export {
    APGamesInformation,
    GameBase,
    GameBaseSimultaneous,
    GameBaseSkipTurn,
    IAPGameState,
    games,
    GameConstructor,
};

export type { TurnModel, IGamePly, IGameRound, IGameRoundSlot } from "./_turn-model";

export * from "./_registry.generated";

export const GameFactory = (game: string, ...args: unknown[]): GameBase | GameBaseSimultaneous | GameBaseSkipTurn | undefined => {
    const ctor = games.get(game);
    if (ctor === undefined) {
        return undefined;
    }
    return ctor.create(...args);
};
