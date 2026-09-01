import type { APGamesInformation } from "./schemas/gameinfo.js";
import type { APMoveResult } from "./schemas/moveresults.js";
import {
    games,
    GameFactory,
    GameBase,
    GameBaseSequenced,
    GameBaseSimultaneous,
    GameBaseSkipTurn,
    resolveGameFlags,
} from "./games/index.js";
import { AIFactory, supportedGames as aiSupported, fastGames as aiFast, slowGames as aiSlow } from "./ais/index.js";
import {
    filterGameinfoForProduction,
    allowedChallengeVariantUids,
    assertAllowedChallengeVariants,
    assertChallengeVariantSelection,
    assertChallengeVariants,
} from "./games/_gameinfo-filter.js";

export {
    GameFactory,
    resolveGameFlags,
    AIFactory,
    aiSupported,
    aiFast,
    aiSlow,
    GameBase,
    GameBaseSequenced,
    GameBaseSimultaneous,
    GameBaseSkipTurn,
    filterGameinfoForProduction,
    allowedChallengeVariantUids,
    assertAllowedChallengeVariants,
    assertChallengeVariantSelection,
    assertChallengeVariants,
};
export type { IAPGameState, FlagContext, GameFlag } from "./games/index.js";
export type { APMoveResult, APGamesInformation };
export type { Variant } from "./schemas/gameinfo.js";
export type { TurnModel, IGamePly, IGameRound, IGameRoundSlot } from "./games/_turn-model.js";
export type {
    SoloOutcomeType,
    ScoreDirection,
    IGradeTier,
    ISoloOutcomeMeta,
} from "./games/_solo-outcome.js";
export {
    evaluateGrade,
    computeElapsedMs,
    soloScoreDirection,
} from "./games/_solo-outcome.js";
export {
    resolveVariantGroups,
    resolveSelection,
    isVariantSelectable,
    evaluateAvailability,
    validateVariantSelection,
    sanitizeVariantSelection,
    assertValidVariantSelection,
    resolveIncomingVariants,
} from "./common/variant-constraints.js";
export type {
    ResolveIncomingVariantsMode,
    VariantConstraintReason,
    VariantConstraintError,
    VariantAvailability,
    VariantSelectionState,
    ValidateVariantSelectionResult,
} from "./common/variant-constraints.js";
export {
    GameRng,
    generateChallengeSeed,
    resolveChallengeSeed,
    replayToStackIndex,
    assertReplayMatches,
    formatChatLogEntries,
    formatChatLogEntryNodes,
    applyChatPlayerNames,
    chatPlayerToken,
    resolveRenderLabel,
    resolveRenderLabels,
    isStructuredRenderLabel,
    replacer,
} from "./common/index.js";
export type {
    SoloReplayFactory,
    ChatActorRef,
    ChatLogLine,
    ChatLogEntry,
    ChatLogTranslate,
    ChatLogCollectContext,
    RenderLabel,
    StructuredRenderLabel,
} from "./common/index.js";

const gameinfo: Map<string, APGamesInformation> = new Map();
games.forEach((v, k) => {
    gameinfo.set(k, filterGameinfoForProduction(v.gameinfo));
});
const gameinfoSorted: APGamesInformation[] = [...games.values()]
    .sort((a, b) => a.gameinfo.name.localeCompare(b.gameinfo.name))
    .map((a) => filterGameinfoForProduction(a.gameinfo));
export { gameinfo, gameinfoSorted };

export { resolveLocale, supportedLocales, type AddResourceOptions } from "./i18n-shared.js";
