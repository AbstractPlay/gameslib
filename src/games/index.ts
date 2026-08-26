import { APGamesInformation } from "../schemas/gameinfo";
import { GameBase, GameBaseSimultaneous, GameBaseSkipTurn, IAPGameState } from "./_base";
import { GameBaseSequenced } from "./_turn-sequenced";
import { games, GameConstructor } from "./_registry.generated";

export {
    APGamesInformation,
    GameBase,
    GameBaseSequenced,
    GameBaseSimultaneous,
    GameBaseSkipTurn,
    IAPGameState,
    games,
    GameConstructor,
};

export type { TurnModel, IGamePly, IGameRound, IGameRoundSlot } from "./_turn-model";
export type {
    SoloOutcomeType,
    ScoreDirection,
    IGradeTier,
    ISoloOutcomeMeta,
} from "./_solo-outcome";
export {
    evaluateGrade,
    computeElapsedMs,
    soloScoreDirection,
} from "./_solo-outcome";

export * from "./_registry.generated";

export const GameFactory = (game: string, ...args: unknown[]): GameBase | GameBaseSimultaneous | GameBaseSkipTurn | GameBaseSequenced | undefined => {
    const ctor = games.get(game);
    if (ctor === undefined) {
        return undefined;
    }
    return ctor.create(...args);
};
