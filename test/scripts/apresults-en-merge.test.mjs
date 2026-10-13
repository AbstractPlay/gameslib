import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { collectLeaves } from "../../scripts/locale-prune.mjs";
import { mergeApresultsEnSources } from "../../scripts/lib/apresults-en-merge.mjs";
import { MERGED_EN_ARESULTS } from "../../scripts/lib/apresults-en-paths.mjs";
import {
    buildNestedFromPathMapEntries,
    loadCommittedPathMapEntries,
    pathMapEntriesAlignedWithNested,
} from "../../scripts/lib/apresults-path-map.mjs";

describe("apresults-en merge", () => {
    it("merge sources match committed locales/en/apresults.json", () => {
        const merged = mergeApresultsEnSources();
        const onDisk = JSON.parse(fs.readFileSync(MERGED_EN_ARESULTS, "utf8"));
        assert.deepEqual(merged, onDisk);
    });

    it("leaf count matches committed path map", () => {
        const mergedLeaves = Object.keys(collectLeaves(mergeApresultsEnSources())).length;
        const mapSize = loadCommittedPathMapEntries().length;
        assert.equal(mergedLeaves, mapSize);
    });

    it("path map entries round-trip English into nested tree", () => {
        const merged = mergeApresultsEnSources();
        const entries = pathMapEntriesAlignedWithNested(merged);
        const nested = buildNestedFromPathMapEntries(entries);
        assert.deepEqual(nested, merged);
    });
});
