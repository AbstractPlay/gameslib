import { getNamespaceConfig, REPO_ROOT } from "./locale-en-namespace-config.mjs";

export { REPO_ROOT };

const apgames = getNamespaceConfig("apgames");

export const MERGED_EN = apgames.mergedEnPath;
export const LEGACY_SLICE = apgames.legacySlicePath;

/** @returns {string} Absolute directory containing shared shard JSON files. */
export function resolveSharedShardDir() {
    return apgames.resolveSharedShardDir();
}
