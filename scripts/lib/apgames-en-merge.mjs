import fs from "node:fs";
import path from "node:path";
import {
    discoverGameApgamesEnOverlay,
    discoverGameinfoOverlay,
} from "./apgames-extract-ts.mjs";
import { getNamespaceConfig } from "./locale-en-namespace-config.mjs";
import { applyMergeChunk, collectJsonFilesRecursive } from "./locale-en-merge-core.mjs";

const { legacySlicePath: LEGACY_SLICE, resolveSharedShardDir } = getNamespaceConfig("apgames");

let cachedPointerViolations = null;

/** @type {{ leafPath: string, prior: string, next: string }[]} */
let lastMergeCollisions = [];

/**
 * @returns {{ leafPath: string, prior: string, next: string }[]}
 */
export function getMergeCollisions() {
    return lastMergeCollisions;
}

export { applyMergeChunk } from "./locale-en-merge-core.mjs";

/**
 * @param {Record<string, unknown>} monolith
 */
export function gameUidsFromMonolith(monolith) {
    const names = monolith.names;
    if (!names || typeof names !== "object") {
        return new Set();
    }
    return new Set(Object.keys(names));
}

/**
 * Split committed monolith into shared shard payloads and a legacy slice (per-game + unmigrated).
 * @param {Record<string, unknown>} monolith
 */
export function splitMonolithForShards(monolith) {
    const gameUids = gameUidsFromMonolith(monolith);

    const sharedButtons = {};
    for (const [key, value] of Object.entries(monolith.buttons ?? {})) {
        if (!gameUids.has(key)) {
            sharedButtons[key] = value;
        }
    }

    const sharedStatus = {};
    for (const [key, value] of Object.entries(monolith.status ?? {})) {
        if (!gameUids.has(key)) {
            sharedStatus[key] = value;
        }
    }

    const shardFiles = {
        "categories.json": { categories: monolith.categories },
        "validation/_general.json": {
            validation: { _general: monolith.validation?._general ?? {} },
        },
        "buttons-common.json": { buttons: sharedButtons },
        "status-shared.json": { status: sharedStatus },
    };
    if (monolith.validation?._inarow !== undefined) {
        shardFiles["validation/_inarow.json"] = {
            validation: { _inarow: monolith.validation._inarow },
        };
    }

    const legacy = structuredClone(monolith);
    delete legacy.categories;
    if (legacy.validation && typeof legacy.validation === "object") {
        delete legacy.validation._general;
        if (monolith.validation?._inarow !== undefined) {
            delete legacy.validation._inarow;
        }
    }
    for (const key of Object.keys(sharedButtons)) {
        delete legacy.buttons[key];
    }
    for (const key of Object.keys(sharedStatus)) {
        delete legacy.status[key];
    }

    return { shardFiles, legacy };
}

function loadLegacySlice() {
    return fs.existsSync(LEGACY_SLICE)
        ? JSON.parse(fs.readFileSync(LEGACY_SLICE, "utf8"))
        : {};
}

/** @returns {{ uid: string, filePath: string, field: string }[]} */
export function getGameinfoPointerViolations() {
    if (cachedPointerViolations === null) {
        extractGameinfoOverlay();
    }
    return cachedPointerViolations ?? [];
}

export function extractGameinfoOverlay() {
    const { overlay, pointerViolations } = discoverGameinfoOverlay(loadLegacySlice());
    cachedPointerViolations = pointerViolations;
    return overlay;
}

export function extractGameApgamesEnOverlay() {
    return discoverGameApgamesEnOverlay();
}

/**
 * @returns {Record<string, unknown>}
 */
export function mergeApgamesEnSources() {
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
    applyMergeChunk(merged, extractGameinfoOverlay(), "gameinfo", provenance, lastMergeCollisions);
    applyMergeChunk(merged, extractGameApgamesEnOverlay(), "gameApgamesEn", provenance, lastMergeCollisions);
    return merged;
}
