import type { APMoveResult } from "../schemas/moveresults.js";

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

/** Machine `eog.reason` token → nested `apresults` catalog leaf (snake_case). */
export function normalizeEogReasonLeaf(reason: string): string {
    return reason
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .toLowerCase()
        .replace(/[\s\-.]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "");
}

const EOG_DEFAULT_KEY = "apresults:_general.EOG.default";

function apresultsEogPathExists(keyExists: (fullKey: string) => boolean, catalogPath: string): boolean {
    const base = `apresults:${catalogPath}`;
    if (keyExists(base)) {
        return true;
    }
    if (keyExists(`${base}_one`)) {
        return true;
    }
    if (keyExists(`${base}_other`)) {
        return true;
    }
    return false;
}

/** Resolve move-log / UI key for an end-of-game reason (game-specific before `_general`). */
export function resolveEogCatalogKey(
    gameUid: string,
    reason: string | undefined,
    aliases: Record<string, string>,
    keyExists: (fullKey: string) => boolean,
): { textKey: string; textParams?: Record<string, ChatLogTextParamValue> } {
    if (reason === undefined || reason.length === 0) {
        return { textKey: EOG_DEFAULT_KEY };
    }
    const aliasLeaf = aliases[reason];
    const leaf = aliasLeaf !== undefined ? aliasLeaf : normalizeEogReasonLeaf(reason);
    const gamePath = `${gameUid}.EOG.${leaf}`;
    if (apresultsEogPathExists(keyExists, gamePath)) {
        return eogKeyWithPluralParams(`apresults:${gamePath}`, leaf, keyExists);
    }
    const generalPath = `_general.EOG.${leaf}`;
    if (apresultsEogPathExists(keyExists, generalPath)) {
        return eogKeyWithPluralParams(`apresults:${generalPath}`, leaf, keyExists);
    }
    return { textKey: EOG_DEFAULT_KEY };
}

function eogKeyWithPluralParams(
    textKey: string,
    leaf: string,
    keyExists: (fullKey: string) => boolean,
): { textKey: string; textParams?: Record<string, ChatLogTextParamValue> } {
    if (leaf === "repetition" || leaf === "repetition_positional") {
        if (keyExists(`${textKey}_one`) || keyExists(`${textKey}_other`)) {
            return { textKey, textParams: { count: 1 } };
        }
        return { textKey };
    }
    return { textKey };
}

/** Last `{ type: "eog" }` on the move stack (terminal ending). */
export function findEogResult(stack: Array<{ _results?: APMoveResult[] }>): Extract<APMoveResult, { type: "eog" }> | undefined {
    for (let i = stack.length - 1; i >= 0; i--) {
        const results = stack[i]._results;
        if (results === undefined) {
            continue;
        }
        for (let j = results.length - 1; j >= 0; j--) {
            const r = results[j];
            if (r.type === "eog") {
                return r as Extract<APMoveResult, { type: "eog" }>;
            }
        }
    }
    return undefined;
}

/** Format one structured chat line (i18n + seat display names). */
export function formatChatLogLine(
    line: ChatLogLine,
    playerNames: string[],
    t: ChatLogTranslate,
): string {
    const params = line.textParams !== undefined ? { ...line.textParams } : undefined;
    if (line.actor.kind === "label" && params?.player !== undefined) {
        params.player = t(line.actor.key, line.actor.params);
    }
    let body = t(line.textKey, params);
    if (line.actor.kind === "seat") {
        body = applyChatPlayerNames(body, line.actor.seat, playerNames);
    }
    return body;
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
            out.push(formatChatLogLine(line, playerNames, t));
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
            node.push(formatChatLogLine(line, playerNames, t));
        }
        return node;
    });
}
