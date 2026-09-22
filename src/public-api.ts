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
import {
    filterGameinfoForProduction,
    allowedChallengeVariantUids,
    assertAllowedChallengeVariants,
    assertChallengeVariantSelection,
    assertChallengeVariants,
} from "./games/_gameinfo-filter.js";
import {
    archiveMetadataFor,
    archiveVariantDefsForMetaUid,
    getRetraction,
    isCatalogVisible,
    isRetractedMetaGame,
    resolveRetractedMetaUidByName,
    retractedMetaUids,
    shouldOmitFromRecords,
    shouldPublishStats,
} from "./retractedGames.js";
import type {
    RetractionArchiveMetadata,
    RetractionAvailability,
    RetractionEntry,
    RecordsGeneration,
} from "./retractedGames.js";

export {
    GameFactory,
    resolveGameFlags,
    GameBase,
    GameBaseSequenced,
    GameBaseSimultaneous,
    GameBaseSkipTurn,
    filterGameinfoForProduction,
    allowedChallengeVariantUids,
    assertAllowedChallengeVariants,
    assertChallengeVariantSelection,
    assertChallengeVariants,
    archiveMetadataFor,
    archiveVariantDefsForMetaUid,
    getRetraction,
    isCatalogVisible,
    isRetractedMetaGame,
    resolveRetractedMetaUidByName,
    retractedMetaUids,
    shouldOmitFromRecords,
    shouldPublishStats,
};
export type {
    RetractionArchiveMetadata,
    RetractionAvailability,
    RetractionEntry,
    RecordsGeneration,
};
export type { IAPGameState, FlagContext, GameFlag } from "./games/index.js";
export type { APMoveResult, APGamesInformation };
export type { Variant, AlternativeDisplay } from "./schemas/gameinfo.js";
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
export {
    expandVariantLabels,
    variantUidsForBatchRating,
    filledVariantUidsForExpand,
} from "./common/expandVariants.js";
export type {
    ResolveIncomingVariantsMode,
    VariantConstraintReason,
    VariantConstraintError,
    VariantAvailability,
    VariantSelectionState,
    ValidateVariantSelectionResult,
} from "./common/variant-constraints.js";
export type { SelectableUidDef } from "./common/selectable-uid-constraints.js";
export {
    resolveDisplayGroups,
    resolveDisplaySelection,
    isDisplaySelectable,
    evaluateDisplayAvailability,
    validateDisplaySelection,
    sanitizeDisplaySelection,
    assertValidDisplaySelection,
    resolveIncomingDisplays,
    expandLegacyDisplayIncoming,
    LEGACY_DISPLAY_EXPAND,
} from "./common/display-constraints.js";
export type {
    ResolveIncomingDisplaysMode,
    DisplayConstraintReason,
    DisplayConstraintError,
    DisplayAvailability,
    DisplaySelectionState,
    ValidateDisplaySelectionResult,
} from "./common/display-constraints.js";
export {
    isSimpleDisplayCycleGame,
    displayCycleSteps,
    nextDisplayCycleStep,
} from "./common/display-cycle.js";
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
