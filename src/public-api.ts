import type { APGamesInformation } from "./schemas/gameinfo.js";
import type { APMoveResult } from "./schemas/moveresults.js";
import {
    games,
    GameFactory,
    GameBase,
    GameBaseSequenced,
    GameBaseSimultaneous,
    GameBaseSkipTurn,
} from "./games/index.js";
import type { IAPGameState } from "./games/index.js";
import { AIFactory, supportedGames as aiSupported, fastGames as aiFast, slowGames as aiSlow } from "./ais/index.js";
import {
    filterGameinfoForProduction,
    allowedChallengeVariantUids,
    assertAllowedChallengeVariants,
} from "./games/_gameinfo-filter.js";

export {
    GameFactory,
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
};
export type { IAPGameState, APMoveResult, APGamesInformation };
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
