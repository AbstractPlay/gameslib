import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const libDir = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(libDir, "../..");

/** @typedef {'apgames' | 'apresults'} LocaleEnNamespaceId */

/** @type {LocaleEnNamespaceId[]} */
export const NAMESPACE_ORDER = ["apgames", "apresults"];

const APGAMES_SHARED_PRIMARY = path.join(REPO_ROOT, "locale-src/en/apgames/shared");
const APGAMES_SHARED_FALLBACK = path.join(REPO_ROOT, "locales/en/apgames-src/shared");

/** @type {Record<LocaleEnNamespaceId, {
 *   id: LocaleEnNamespaceId,
 *   mergedEnPath: string,
 *   legacySlicePath: string,
 *   keyPrefix: string,
 *   exportSymbol: string,
 *   remapMode: 'srcMatch' | 'pathMap',
 *   resolveSharedShardDir: () => string,
 * }>} */
export const LOCALE_EN_NAMESPACES = {
    apgames: {
        id: "apgames",
        mergedEnPath: path.join(REPO_ROOT, "locales/en/apgames.json"),
        legacySlicePath: path.join(REPO_ROOT, "locale-src/en/apgames/legacy/monolith-slice.json"),
        keyPrefix: "apgames:",
        exportSymbol: "gameApgamesEn",
        remapMode: "srcMatch",
        resolveSharedShardDir() {
            if (fs.existsSync(APGAMES_SHARED_PRIMARY)) {
                return APGAMES_SHARED_PRIMARY;
            }
            if (fs.existsSync(APGAMES_SHARED_FALLBACK)) {
                return APGAMES_SHARED_FALLBACK;
            }
            return APGAMES_SHARED_PRIMARY;
        },
    },
    apresults: {
        id: "apresults",
        mergedEnPath: path.join(REPO_ROOT, "locales/en/apresults.json"),
        legacySlicePath: path.join(REPO_ROOT, "locale-src/en/apresults/legacy/monolith-slice.json"),
        keyPrefix: "apresults:",
        exportSymbol: "gameApresultsEn",
        remapMode: "pathMap",
        resolveSharedShardDir() {
            return path.join(REPO_ROOT, "locale-src/en/apresults/shared");
        },
    },
};

export const PATH_MAP_JSON = path.join(REPO_ROOT, "locale-src/en/apresults/apresults-path-map.json");
export const PATH_MAP_OVERRIDES_JSON = path.join(
    REPO_ROOT,
    "locale-src/en/apresults/apresults-path-map-overrides.json",
);

/** @param {LocaleEnNamespaceId | 'both' | undefined} token */
export function resolveNamespaceList(token) {
    if (token === undefined || token === "both") {
        return [...NAMESPACE_ORDER];
    }
    if (token === "apgames" || token === "apresults") {
        return [token];
    }
    throw new Error(`Unknown namespace "${token}" (expected apgames, apresults, or both)`);
}

export function getNamespaceConfig(id) {
    const cfg = LOCALE_EN_NAMESPACES[id];
    if (!cfg) {
        throw new Error(`Unknown namespace "${id}"`);
    }
    return cfg;
}

/** True when committed apresults.json is nested (`_general` at root). */
export function mergedApresultsUsesNestedShape(onDisk) {
    return onDisk !== null && typeof onDisk === "object" && Object.prototype.hasOwnProperty.call(onDisk, "_general");
}
