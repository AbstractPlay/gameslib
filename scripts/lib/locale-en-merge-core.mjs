import { deepMerge } from "../translate.mjs";
import { collectLeaves } from "../locale-prune.mjs";
import fs from "node:fs";
import path from "node:path";

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
