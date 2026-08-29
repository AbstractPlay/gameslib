import type { ChatActorRef, ChatLogTextParamValue, ChatLogTranslate } from "./chat-log";
import { applyChatPlayerNames, chatPlayerToken } from "./chat-log";

export type StructuredRenderLabel = {
    textKey: string;
    textParams?: Record<string, ChatLogTextParamValue>;
    actor?: ChatActorRef;
};

/** Plain string (legacy) or structured label resolved at display time in front. */
export type RenderLabel = string | StructuredRenderLabel;

export function isStructuredRenderLabel(v: unknown): v is StructuredRenderLabel {
    return typeof v === "object" && v !== null && "textKey" in v;
}

/**
 * Resolve one render label to a display string.
 * Mirrors {@link formatChatLogEntries} line formatting for a single label.
 */
export function resolveRenderLabel(
    label: RenderLabel,
    playerNames: string[],
    t: ChatLogTranslate,
): string {
    if (typeof label === "string") {
        return label;
    }
    const { textKey, textParams, actor } = label;
    const params: Record<string, unknown> = textParams !== undefined ? { ...textParams } : {};
    if (actor?.kind === "label" && params.player !== undefined) {
        params.player = t(actor.key, actor.params);
    }
    if (actor?.kind === "seat") {
        if (params.player === undefined) {
            params.player = chatPlayerToken(actor.seat);
        }
    }
    let body = t(textKey, params);
    if (actor?.kind === "seat") {
        body = applyChatPlayerNames(body, actor.seat, playerNames);
    }
    return body;
}
