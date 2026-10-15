import { deepMerge } from "../translate.mjs";
import { collectLeaves } from "../locale-prune.mjs";
import fs from "node:fs";
import path from "node:path";

/** i18next plural leaf names (nested `{ one, other }` objects are invalid at runtime). */
export const I18NEXT_PLURAL_LEAVES = new Set(["one", "other", "zero", "two", "few", "many"]);

/**
 * Flatten shard/merge trees that used `{ one, other }` objects into `key_one` / `key_other` siblings.
 * @param {Record<string, unknown>} obj
 * @returns {Record<string, unknown>}
 */
export function flattenNestedI18nextPlurals(obj) {
    if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
        return obj;
    }
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [key, value] of Object.entries(obj)) {
        if (value !== null && typeof value === "object" && !Array.isArray(value)) {
            const childKeys = Object.keys(value);
            const allPluralStrings =
                childKeys.length > 0 &&
                childKeys.every((k) => I18NEXT_PLURAL_LEAVES.has(k)) &&
                childKeys.every((k) => typeof value[k] === "string");
            if (allPluralStrings) {
                for (const pk of childKeys) {
                    out[`${key}_${pk}`] = value[pk];
                }
                continue;
            }
            out[key] = flattenNestedI18nextPlurals(value);
        } else {
            out[key] = value;
        }
    }
    return out;
}

/**
 * @param {Record<string, unknown>} merged
 * @param {Record<string, unknown>} chunk
 * @param {string} sourceLabel
 * @param {Map<string, string>} provenance
 * @param {{ leafPath: string, prior: string, next: string }[]} collisions
 */
export function applyMergeChunk(merged, chunk, sourceLabel, provenance, collisions) {
    const before = collectLeaves(merged);
    const chunkLeaves = collectLeaves(chunk);
    for (const [leafPath, nextValue] of Object.entries(chunkLeaves)) {
        if (Object.prototype.hasOwnProperty.call(before, leafPath) && before[leafPath] !== nextValue) {
            collisions.push({
                leafPath,
                prior: provenance.get(leafPath) ?? "(unknown)",
                next: sourceLabel,
            });
        }
    }
    deepMerge(merged, chunk);
    for (const leafPath of Object.keys(chunkLeaves)) {
        provenance.set(leafPath, sourceLabel);
    }
}

/**
 * @param {string} dir
 * @param {string} [sharedRoot]
 * @param {string[]} [skipRelPaths]
 */
export function collectJsonFilesRecursive(dir, sharedRoot = dir, skipRelPaths = ["_duplicate-en-allowlist.json"]) {
    const out = [];
    if (!fs.existsSync(dir)) {
        return out;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...collectJsonFilesRecursive(full, sharedRoot, skipRelPaths));
        } else if (entry.isFile() && entry.name.endsWith(".json")) {
            const rel = path.relative(sharedRoot, full).replace(/\\/g, "/");
            if (skipRelPaths.includes(rel)) {
                continue;
            }
            out.push(full);
        }
    }
    return out.sort();
}
