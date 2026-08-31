import type { APGamesInformation } from "../schemas/gameinfo.js";
import { GameBase, GameBaseSimultaneous, GameBaseSkipTurn } from "./_base.js";
import type { IAPGameState } from "./_base.js";
import { GameBaseSequenced } from "./_turn-sequenced.js";
import { games, GameConstructor } from "./_registry.generated.js";
import type { FlagContext, GameFlag } from "../common/flags.js";

export type { APGamesInformation, IAPGameState, GameConstructor, FlagContext, GameFlag };
export {
    GameBase,
    GameBaseSequenced,
    GameBaseSimultaneous,
    GameBaseSkipTurn,
    games,
};

export type { TurnModel, IGamePly, IGameRound, IGameRoundSlot } from "./_turn-model.js";
export type {
    SoloOutcomeType,
    ScoreDirection,
    IGradeTier,
    ISoloOutcomeMeta,
} from "./_solo-outcome.js";
export {
    evaluateGrade,
    computeElapsedMs,
    soloScoreDirection,
} from "./_solo-outcome.js";

export * from "./_registry.generated.js";

export const GameFactory = (game: string, ...args: unknown[]): GameBase | GameBaseSimultaneous | GameBaseSkipTurn | GameBaseSequenced | undefined => {
    const ctor = games.get(game);
    if (ctor === undefined) {
        return undefined;
    }
    return ctor.create(...args);
};

/**
 * Effective flags for a game uid and challenge context (no engine instance required).
 */
export function resolveGameFlags(uid: string, context: FlagContext = {}): readonly GameFlag[] {
    const ctor = games.get(uid);
    if (ctor === undefined) {
        return [];
    }
    return ctor.resolveFlags(context);
}
