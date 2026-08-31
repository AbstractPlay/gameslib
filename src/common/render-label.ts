import type { ChatActorRef, ChatLogTextParamValue, ChatLogTranslate } from "./chat-log.js";
import { applyChatPlayerNames, chatPlayerToken } from "./chat-log.js";

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

function resolveLabelField(
    label: RenderLabel,
    playerNames: string[],
    t: ChatLogTranslate,
): string {
    if (!isStructuredRenderLabel(label)) {
        return label;
    }
    return resolveRenderLabel(label, playerNames, t);
}

function walkMarkers(
    markers: Array<{ type?: string; label?: RenderLabel }> | undefined,
    playerNames: string[],
    t: ChatLogTranslate,
): void {
    if (!Array.isArray(markers)) {
        return;
    }
    for (const marker of markers) {
        if (marker?.type === "label" && marker.label !== undefined) {
            marker.label = resolveLabelField(marker.label, playerNames, t);
        }
    }
}

function walkAreas(
    areas: Array<{ label?: RenderLabel; type?: string; buttons?: Array<{ label?: RenderLabel }> }> | undefined,
    playerNames: string[],
    t: ChatLogTranslate,
): void {
    if (!Array.isArray(areas)) {
        return;
    }
    for (const area of areas) {
        if (area?.label !== undefined) {
            area.label = resolveLabelField(area.label, playerNames, t);
        }
        if (area?.type === "buttonBar" && Array.isArray(area.buttons)) {
            for (const button of area.buttons) {
                if (button?.label !== undefined) {
                    button.label = resolveLabelField(button.label, playerNames, t);
                }
            }
        }
    }
}

function walkBoard(
    board: {
        boardOne?: { label?: RenderLabel };
        boardTwo?: { label?: RenderLabel };
        markers?: Array<{ type?: string; label?: RenderLabel }>;
    } | undefined,
    playerNames: string[],
    t: ChatLogTranslate,
): void {
    if (!board || typeof board !== "object") {
        return;
    }
    if (board.boardOne?.label !== undefined) {
        board.boardOne.label = resolveLabelField(board.boardOne.label, playerNames, t);
    }
    if (board.boardTwo?.label !== undefined) {
        board.boardTwo.label = resolveLabelField(board.boardTwo.label, playerNames, t);
    }
    walkMarkers(board.markers, playerNames, t);
}

/**
 * Resolve structured render labels to display strings before drawing.
 * Walks board markers, dual-board labels, areas, and button-bar buttons.
 */
export function resolveRenderLabels<T>(
    rep: T,
    playerNames: string[],
    t: ChatLogTranslate,
): T {
    if (!rep || typeof rep !== "object") {
        return rep;
    }
    const out = structuredClone(rep) as T & {
        board?: Parameters<typeof walkBoard>[0];
        areas?: Parameters<typeof walkAreas>[0];
    };
    walkBoard(out.board, playerNames, t);
    walkAreas(out.areas, playerNames, t);
    return out;
}
