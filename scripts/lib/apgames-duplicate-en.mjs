import fs from "node:fs";
import path from "node:path";
import { collectLeaves } from "../locale-prune.mjs";
import { gameUidsFromMonolith } from "./apgames-en-merge.mjs";
import { REPO_ROOT } from "./apgames-en-paths.mjs";

const ALLOWLIST_PATH = path.join(
    REPO_ROOT,
    "locale-src/en/apgames/shared/_duplicate-en-allowlist.json",
);

function normalizeEn(text) {
    if (typeof text !== "string") {
        return "";
    }
    return text.trim().replace(/\s+/g, " ");
}

function loadAllowlist() {
    if (!fs.existsSync(ALLOWLIST_PATH)) {
        return new Set();
    }
    const data = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, "utf8"));
    const list = Array.isArray(data) ? data : data.suppress ?? [];
    return new Set(list);
}

/**
 * Build map of normalized English → canonical shared leaf paths (non–per-game subtrees).
 * @param {Record<string, unknown>} merged
 */
function sharedEnglishIndex(merged) {
    const gameUids = gameUidsFromMonolith(merged);
    const index = new Map();

    const validation = merged.validation ?? {};
    for (const [key, value] of Object.entries(validation)) {
        if (gameUids.has(key)) {
            continue;
        }
        for (const [leaf, en] of Object.entries(collectLeaves(value, `validation.${key}`))) {
            const norm = normalizeEn(en);
            if (!norm) {
                continue;
            }
            if (!index.has(norm)) {
                index.set(norm, []);
            }
            index.get(norm).push(leaf);
        }
    }

    for (const [key, value] of Object.entries(merged.buttons ?? {})) {
        if (gameUids.has(key)) {
            continue;
        }
        for (const [leaf, en] of Object.entries(collectLeaves(value, `buttons.${key}`))) {
            const norm = normalizeEn(en);
            if (!norm) {
                continue;
            }
            if (!index.has(norm)) {
                index.set(norm, []);
            }
            index.get(norm).push(leaf);
        }
    }

    for (const [key, value] of Object.entries(merged.status ?? {})) {
        if (gameUids.has(key)) {
            continue;
        }
        for (const [leaf, en] of Object.entries(collectLeaves(value, `status.${key}`))) {
            const norm = normalizeEn(en);
            if (!norm) {
                continue;
            }
            if (!index.has(norm)) {
                index.set(norm, []);
            }
            index.get(norm).push(leaf);
        }
    }

    return index;
}

/**
 * @param {Record<string, unknown>} merged
 * @param {{ uidFilter?: string, allowlist?: Set<string> }} [options]
 * @returns {string[]}
 */
export function findDuplicateEnWarnings(merged, options = {}) {
    const gameUids = gameUidsFromMonolith(merged);
    const allowlist = options.allowlist ?? loadAllowlist();
    const sharedIndex = sharedEnglishIndex(merged);
    const warnings = [];
    const uidFilter = options.uidFilter;

    const perGameSections = ["validation", "buttons", "status"];

    for (const section of perGameSections) {
        const sectionObj = merged[section];
        if (!sectionObj || typeof sectionObj !== "object") {
            continue;
        }
        for (const uid of Object.keys(sectionObj)) {
            if (!gameUids.has(uid)) {
                continue;
            }
            if (uidFilter && uid !== uidFilter) {
                continue;
            }
            const subtree = sectionObj[uid];
            if (!subtree || typeof subtree !== "object") {
                continue;
            }
            for (const [leafPath, en] of Object.entries(collectLeaves(subtree, `${section}.${uid}`))) {
                if (allowlist.has(leafPath)) {
                    continue;
                }
                const norm = normalizeEn(en);
                if (!norm) {
                    continue;
                }
                const sharedPaths = sharedIndex.get(norm);
                if (!sharedPaths || sharedPaths.length === 0) {
                    continue;
                }
                const canonical = sharedPaths[0];
                warnings.push(
                    `duplicate-en: ${leafPath} repeats English already at ${canonical} — reuse the shared apgames: key in game code`,
                );
            }
        }
    }

    return warnings;
}
