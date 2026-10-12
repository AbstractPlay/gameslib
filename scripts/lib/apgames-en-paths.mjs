import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(scriptsDir, "../..");

export const MERGED_EN = path.join(REPO_ROOT, "locales/en/apgames.json");

const SHARED_PRIMARY = path.join(REPO_ROOT, "locale-src/en/apgames/shared");
const SHARED_FALLBACK = path.join(REPO_ROOT, "locales/en/apgames-src/shared");

export const LEGACY_SLICE = path.join(REPO_ROOT, "locale-src/en/apgames/legacy/monolith-slice.json");

/** @returns {string} Absolute directory containing shared shard JSON files. */
export function resolveSharedShardDir() {
    if (fs.existsSync(SHARED_PRIMARY)) {
        return SHARED_PRIMARY;
    }
    if (fs.existsSync(SHARED_FALLBACK)) {
        return SHARED_FALLBACK;
    }
    return SHARED_PRIMARY;
}
