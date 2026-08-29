import type { APMoveResult } from "../schemas/moveresults";

export type ChatLogTextParamValue = string | number;

/** Params at collection time; undefined entries are stripped before storage. */
export type ChatLogTextParamsInput = Record<string, ChatLogTextParamValue | undefined>;

export type ChatActorRef =
    | { kind: "seat"; seat: number }
    | { kind: "label"; key: string; params?: Record<string, ChatLogTextParamValue> }
    | { kind: "none" };

export interface ChatLogLine {
    actor: ChatActorRef;
    textKey: string;
    textParams?: Record<string, ChatLogTextParamValue>;
}

export interface ChatLogEntry {
    timestamp: string;
    lines: ChatLogLine[];
}

export type ChatLogTranslate = (key: string, params?: Record<string, unknown>) => string;

/** Context passed to {@link GameBase.collectChatLogLine} while walking stack frames. */
export interface ChatLogCollectContext {
    results: APMoveResult[];
    currplayer: number;
    /** Seat used for player-attributed lines in this frame (legacy `chatLog` `otherPlayer`). */
    defaultSeat: number;
    players: string[];
}

/** Stable seat token embedded in textParams.player for seat-actor lines. */
export function chatPlayerToken(seat: number): string {
    return `Player ${seat}`;
}

/**
 * Walk nested results inside a `_group` frame result.
 * Returns true when `r` was a group and `visit` was called for each nested result.
 */
export function forEachGroupResult(
    r: APMoveResult,
    defaultWho: number,
    visit: (nested: APMoveResult, who: number) => void,
): boolean {
    if (r.type !== "_group") {
        return false;
    }
    const who = (r as { who?: number }).who ?? defaultWho;
    for (const nested of (r as { results: APMoveResult[] }).results) {
        visit(nested, who);
    }
    return true;
}

/** Replace Player N tokens in resolved text with display names from playerNames. */
export function applyChatPlayerNames(text: string, seat: number, playerNames: string[]): string {
    const name = playerNames[seat - 1];
    if (name === undefined || name.length === 0) {
        return text;
    }
    return text.split(chatPlayerToken(seat)).join(name);
}

/**
 * Flatten structured chat entries into display strings (one per line).
 * Resolves i18n keys at format time; substitutes seat display names only for seat actors.
 */
export function formatChatLogEntries(
    entries: ChatLogEntry[],
    playerNames: string[],
    t: ChatLogTranslate,
): string[] {
    const out: string[] = [];
    for (const entry of entries) {
        for (const line of entry.lines) {
            const params = line.textParams !== undefined ? { ...line.textParams } : undefined;
            if (line.actor.kind === "label" && params?.player !== undefined) {
                params.player = t(line.actor.key, line.actor.params);
            }
            let body = t(line.textKey, params);
            if (line.actor.kind === "seat") {
                body = applyChatPlayerNames(body, line.actor.seat, playerNames);
            }
            out.push(body);
        }
    }
    return out;
}

/**
 * Format entries grouped by timestamp (each group = [timestamp, ...lines]).
 * Matches legacy chatLog() node shape for drop-in replacement.
 */
export function formatChatLogEntryNodes(
    entries: ChatLogEntry[],
    playerNames: string[],
    t: ChatLogTranslate,
): string[][] {
    return entries.map((entry) => {
        const node: string[] = [entry.timestamp];
        for (const line of entry.lines) {
            const params = line.textParams !== undefined ? { ...line.textParams } : undefined;
            if (line.actor.kind === "label" && params?.player !== undefined) {
                params.player = t(line.actor.key, line.actor.params);
            }
            let body = t(line.textKey, params);
            if (line.actor.kind === "seat") {
                body = applyChatPlayerNames(body, line.actor.seat, playerNames);
            }
            node.push(body);
        }
        return node;
    });
}
