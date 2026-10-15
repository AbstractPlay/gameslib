import fs from "node:fs";
import assert from "node:assert/strict";
import { mergeApgamesEnSources } from "./apgames-en-merge.mjs";
import { mergeApresultsEnSources } from "./apresults-en-merge.mjs";
import { getNamespaceConfig, mergedApresultsUsesNestedShape } from "./locale-en-namespace-config.mjs";
import { expectedNestedFromFlatMonolith } from "./apresults-path-map.mjs";
import { writeLocaleJson } from "../locale-json-format.mjs";

/**
 * @param {'apgames' | 'apresults'} namespace
 * @param {{ write?: boolean }} opts
 */
export function runLocaleEnMerge(namespace, opts = {}) {
    const cfg = getNamespaceConfig(namespace);
    const merged = namespace === "apgames" ? mergeApgamesEnSources() : mergeApresultsEnSources();
    if (opts.write) {
        writeLocaleJson(cfg.mergedEnPath, merged);
        console.log("Wrote", cfg.mergedEnPath);
        return;
    }
    if (!fs.existsSync(cfg.mergedEnPath)) {
        throw new Error(`Missing merged file: ${cfg.mergedEnPath}`);
    }
    const onDisk = JSON.parse(fs.readFileSync(cfg.mergedEnPath, "utf8"));
    if (namespace === "apgames") {
        assert.deepEqual(merged, onDisk, "merge output differs from locales/en/apgames.json");
    } else if (mergedApresultsUsesNestedShape(onDisk)) {
        assert.deepEqual(merged, onDisk, "merge output differs from locales/en/apresults.json");
    } else {
        assert.deepEqual(
            merged,
            expectedNestedFromFlatMonolith(),
            "merge sources differ from path-map baseline of flat locales/en/apresults.json",
        );
    }
}
