import fs from "node:fs";
import path from "node:path";
import { collectLeaves } from "../locale-prune.mjs";
import {
    applyMergeChunk,
    collectJsonFilesRecursive,
    flattenNestedI18nextPlurals,
} from "./locale-en-merge-core.mjs";
import { getNamespaceConfig } from "./locale-en-namespace-config.mjs";
import { discoverGameApresultsEnOverlay } from "./apresults-extract-ts.mjs";

const { legacySlicePath: LEGACY_SLICE, resolveSharedShardDir } = getNamespaceConfig("apresults");

/** @type {{ leafPath: string, prior: string, next: string }[]} */
let lastMergeCollisions = [];

/**
 * @returns {{ leafPath: string, prior: string, next: string }[]}
 */
export function getApresultsMergeCollisions() {
    return lastMergeCollisions;
}

/**
 * @returns {Record<string, unknown>}
 */
export function mergeApresultsEnSources() {
    lastMergeCollisions = [];
    const provenance = new Map();
    const merged = {};
    const sharedDir = resolveSharedShardDir();
    for (const filePath of collectJsonFilesRecursive(sharedDir, sharedDir)) {
        const rel = path.relative(sharedDir, filePath).replace(/\\/g, "/");
        const chunk = JSON.parse(fs.readFileSync(filePath, "utf8"));
        applyMergeChunk(merged, chunk, `shared/${rel}`, provenance, lastMergeCollisions);
    }
    if (fs.existsSync(LEGACY_SLICE)) {
        const legacy = JSON.parse(fs.readFileSync(LEGACY_SLICE, "utf8"));
        applyMergeChunk(merged, legacy, "legacy/monolith-slice.json", provenance, lastMergeCollisions);
    }
    applyMergeChunk(
        merged,
        discoverGameApresultsEnOverlay(),
        "gameApresultsEn",
        provenance,
        lastMergeCollisions,
    );
    return flattenNestedI18nextPlurals(merged);
}

/**
 * Flatten nested merge tree to dot leaf paths (for tests).
 * @param {Record<string, unknown>} merged
 */
export function collectApresultsMergeLeaves(merged) {
    return collectLeaves(merged);
}
