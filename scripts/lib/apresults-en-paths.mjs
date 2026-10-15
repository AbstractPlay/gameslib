import {
    getNamespaceConfig,
    mergedApresultsUsesNestedShape,
    PATH_MAP_JSON,
    PATH_MAP_OVERRIDES_JSON,
    REPO_ROOT,
} from "./locale-en-namespace-config.mjs";

export { REPO_ROOT, PATH_MAP_JSON, PATH_MAP_OVERRIDES_JSON, mergedApresultsUsesNestedShape };

const apresults = getNamespaceConfig("apresults");

/** Merged English runtime catalog (`locale-en merge apresults` output). */
export const MERGED_EN_ARESULTS = apresults.mergedEnPath;
export const LEGACY_SLICE = apresults.legacySlicePath;

/** @returns {string} */
export function resolveSharedShardDir() {
    return apresults.resolveSharedShardDir();
}
