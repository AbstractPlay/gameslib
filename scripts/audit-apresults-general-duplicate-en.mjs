#!/usr/bin/env node
/**
 * Report duplicate English within apresults `_general` (cross-bucket and per result-type).
 *
 *   node scripts/audit-apresults-general-duplicate-en.mjs
 *   node scripts/audit-apresults-general-duplicate-en.mjs --scope global
 *   node scripts/audit-apresults-general-duplicate-en.mjs --scope perResultType
 */
import { mergeApresultsEnSources } from "./lib/apresults-en-merge.mjs";
import { findApresultsGeneralInternalDuplicateEnWarnings } from "./lib/apresults-duplicate-en.mjs";

const scopeArg = process.argv.find((a, i) => process.argv[i - 1] === "--scope");
const scope =
    scopeArg === "global" || scopeArg === "perResultType" || scopeArg === "both" ? scopeArg : "both";

const merged = mergeApresultsEnSources();
const warnings = findApresultsGeneralInternalDuplicateEnWarnings(merged, { scope });

console.log("apresults _general internal duplicate English", warnings.length, `(scope=${scope})`);
for (const line of warnings) {
    console.log(line);
}

