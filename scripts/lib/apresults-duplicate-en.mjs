import fs from "node:fs";
import path from "node:path";
import { collectLeaves } from "../locale-prune.mjs";
import { normalizeEnglish } from "./apresults-path-map.mjs";
import { resolveSharedShardDir } from "./apresults-en-paths.mjs";
import { buildUidToGameSourcePaths } from "./check-apgames-refs.mjs";

const ALLOWLIST_PATH = path.join(
    resolveSharedShardDir(),
    "_duplicate-en-allowlist.json",
);

/**
 * @returns {{ perGame: Set<string>, generalInternal: Set<string> }}
 */
function loadAllowlist() {
    if (!fs.existsSync(ALLOWLIST_PATH)) {
        return { perGame: new Set(), generalInternal: new Set() };
    }
    const data = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, "utf8"));
    if (Array.isArray(data)) {
        return { perGame: new Set(data), generalInternal: new Set() };
    }
    return {
        perGame: new Set(data.suppress ?? data.perGame ?? []),
        generalInternal: new Set(data.generalInternal ?? data.suppressGeneralInternal ?? []),
    };
}

/**
 * @param {Map<string, string[]>} groups normalized English → catalog paths
 * @param {Set<string>} allowlist full paths e.g. _general.MOVE.nowhat
 * @param {string} scopeLabel e.g. "MOVE" or "_general"
 */
function formatInternalDuplicateGroups(groups, allowlist, scopeLabel) {
    const warnings = [];
    for (const paths of groups) {
        if (paths.length < 2) {
            continue;
        }
        const filtered = paths.filter((p) => !allowlist.has(p));
        if (filtered.length < 2) {
            continue;
        }
        const sorted = [...filtered].sort();
        const canonical = sorted[0];
        const rest = sorted.slice(1);
        warnings.push(
            `duplicate-en-general (${scopeLabel}): ${rest.join(", ")} repeat English already at ${canonical} — consolidate apresults:${canonical} in game code`,
        );
    }
    return warnings;
}

/**
 * @param {Record<string, string>} leaves path → English
 * @returns {Map<string, string[]>} normalized English → paths
 */
function groupLeavesByNormalizedEnglish(leaves) {
    /** @type {Map<string, string[]>} */
    const byEn = new Map();
    for (const [leafPath, en] of Object.entries(leaves)) {
        const norm = normalizeEnglish(en);
        if (!norm) {
            continue;
        }
        if (!byEn.has(norm)) {
            byEn.set(norm, []);
        }
        byEn.get(norm).push(leafPath);
    }
    return byEn;
}

/**
 * Duplicate English within `_general` (global and/or per result-type bucket).
 *
 * @param {Record<string, unknown>} merged
 * @param {{ scope?: "global" | "perResultType" | "both", allowlist?: { perGame: Set<string>, generalInternal: Set<string> } }} [options]
 * @returns {string[]}
 */
export function findApresultsGeneralInternalDuplicateEnWarnings(merged, options = {}) {
    const { scope = "both", allowlist: allowlistIn } = options;
    const allowlist = allowlistIn ?? loadAllowlist();
    const general = merged._general;
    if (!general || typeof general !== "object") {
        return [];
    }

    const warnings = [];
    const allLeaves = collectLeaves(general, "_general");

    if (scope === "global" || scope === "both") {
        const byEn = groupLeavesByNormalizedEnglish(allLeaves);
        /** @type {string[][]} */
        const globalGroups = [];
        for (const paths of byEn.values()) {
            if (paths.length < 2) {
                continue;
            }
            const resultTypes = new Set(
                paths.map((p) => p.replace(/^_general\./, "").split(".")[0]),
            );
            if (scope === "both" && resultTypes.size === 1) {
                continue;
            }
            globalGroups.push(paths);
        }
        warnings.push(...formatInternalDuplicateGroups(globalGroups, allowlist.generalInternal, "_general"));
    }

    if (scope === "perResultType" || scope === "both") {
        for (const [resultType, block] of Object.entries(general)) {
            if (!block || typeof block !== "object" || Array.isArray(block)) {
                continue;
            }
            const leaves = collectLeaves(block, `_general.${resultType}`);
            const groups = [...groupLeavesByNormalizedEnglish(leaves).values()];
            warnings.push(...formatInternalDuplicateGroups(groups, allowlist.generalInternal, resultType));
        }
    }

    return [...new Set(warnings)].sort();
}

/**
 * @param {Record<string, unknown>} merged nested apresults merge tree
 */
function sharedGeneralEnglishIndex(merged) {
    const general = merged._general;
    /** @type {Map<string, string[]>} */
    const index = new Map();
    if (!general || typeof general !== "object") {
        return index;
    }
    for (const [leafPath, en] of Object.entries(collectLeaves(general, "_general"))) {
        const norm = normalizeEnglish(en);
        if (!norm) {
            continue;
        }
        if (!index.has(norm)) {
            index.set(norm, []);
        }
        index.get(norm).push(leafPath);
    }
    return index;
}

/**
 * @param {Record<string, unknown>} merged
 * @param {{ uidFilter?: string, allowlist?: Set<string> }} [options]
 * @returns {string[]}
 */
export function findApresultsDuplicateEnWarnings(merged, options = {}) {
    const { perGame } = options.allowlist ?? loadAllowlist();
    const sharedIndex = sharedGeneralEnglishIndex(merged);
    const registryUids = new Set(buildUidToGameSourcePaths().keys());
    const uidFilter = options.uidFilter;
    const warnings = [];

    for (const [uid, block] of Object.entries(merged)) {
        if (uid === "_general" || !block || typeof block !== "object") {
            continue;
        }
        if (uidFilter && uid !== uidFilter) {
            continue;
        }
        if (!registryUids.has(uid) && uid !== "homeworlds") {
            continue;
        }
        for (const [leafPath, en] of Object.entries(collectLeaves(block, uid))) {
            if (perGame.has(leafPath)) {
                continue;
            }
            const norm = normalizeEnglish(en);
            if (!norm) {
                continue;
            }
            const sharedPaths = sharedIndex.get(norm);
            if (!sharedPaths?.length) {
                continue;
            }
            const canonical = sharedPaths[0];
            warnings.push(
                `duplicate-en: ${leafPath} repeats English already at ${canonical} — reuse apresults:_general key in game code`,
            );
        }
    }

    return warnings;
}
