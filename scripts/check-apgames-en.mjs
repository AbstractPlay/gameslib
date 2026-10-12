#!/usr/bin/env node
import { assertEnApgamesMergeCurrent } from "./lib/ensure-merged-en-apgames.mjs";
import { mergeApgamesEnSources } from "./lib/apgames-en-merge.mjs";
import { findMissingVariantGroupDefaultNames } from "./lib/apgames-variant-groups.mjs";

assertEnApgamesMergeCurrent();
const merged = mergeApgamesEnSources();
const missingDefaults = findMissingVariantGroupDefaultNames(merged);
if (missingDefaults.length > 0) {
    for (const line of missingDefaults) {
        console.error(`ERROR: ${line}`);
    }
    process.exit(1);
}
console.log("check-apgames-en: OK");
