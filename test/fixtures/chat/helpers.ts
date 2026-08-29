import { expect } from "chai";
import i18next from "i18next";
import { GameBase } from "../../../src/games/_base";
import {
    formatChatLogEntryNodes,
    type ChatLogTranslate,
} from "../../../src/common/chat-log";
import { normalizeChatLogForGolden } from "../turnModel/helpers";

/**
 * Assert formatted {@link GameBase.chatLogEntries} matches legacy {@link GameBase.chatLog}.
 * Use after migrating a game to structured chat (or for base-default games in Phase 0).
 */
export function assertChatLogParity(
    game: GameBase,
    playerNames: string[],
    t: ChatLogTranslate = (key, params) => i18next.t(key, params),
): void {
    const legacy = normalizeChatLogForGolden(game.chatLog(playerNames));
    const structured = normalizeChatLogForGolden(
        formatChatLogEntryNodes(game.chatLogEntries(playerNames), playerNames, t),
    );
    expect(structured).to.deep.equal(legacy);
}
