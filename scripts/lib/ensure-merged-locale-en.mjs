import assert from "node:assert/strict";
import fs from "node:fs";
import { mergeApgamesEnSources } from "./apgames-en-merge.mjs";
import { mergeApresultsEnSources } from "./apresults-en-merge.mjs";
import {
    getNamespaceConfig,
    mergedApresultsUsesNestedShape,
    NAMESPACE_ORDER,
} from "./locale-en-namespace-config.mjs";
import { expectedNestedFromFlatMonolith } from "./apresults-path-map.mjs";

/**
 * @param {'apgames' | 'apresults'} namespace
 * @param {string} [prefix]
 */
export function assertEnLocaleMergeCurrent(namespace, prefix = "") {
    const cfg = getNamespaceConfig(namespace);
    if (!fs.existsSync(cfg.mergedEnPath)) {
        throw new Error(`${prefix}Missing ${cfg.mergedEnPath}`);
    }
    if (namespace === "apgames") {
        const merged = mergeApgamesEnSources();
        const onDisk = JSON.parse(fs.readFileSync(cfg.mergedEnPath, "utf8"));
        assert.deepEqual(
            merged,
            onDisk,
            `${prefix}locales/en/apgames.json does not match merge sources — do not edit that file by hand. ` +
                "Edit locale-src/en/apgames/shared/, gameinfo, and gameApgamesEn in src/games/, then run: npm run locale-en -- merge --write",
        );
        return;
    }
    const merged = mergeApresultsEnSources();
    const onDisk = JSON.parse(fs.readFileSync(cfg.mergedEnPath, "utf8"));
    const expected = mergedApresultsUsesNestedShape(onDisk)
        ? onDisk
        : expectedNestedFromFlatMonolith();
    assert.deepEqual(
        merged,
        expected,
        `${prefix}apresults English sources do not match locales/en/apresults.json. ` +
            "Edit locale-src/en/apresults/shared/, legacy/monolith-slice.json, and gameApresultsEn, " +
            "then run: npm run locale-en -- merge --write",
    );
}

/** @param {string} [prefix] */
export function assertEnLocaleMergeCurrentAll(prefix = "") {
    for (const ns of NAMESPACE_ORDER) {
        assertEnLocaleMergeCurrent(ns, prefix);
    }
}

/** @deprecated Use assertEnLocaleMergeCurrent('apgames') */
export function assertEnApgamesMergeCurrent(prefix = "") {
    return assertEnLocaleMergeCurrent("apgames", prefix);
}

/** @deprecated Use assertEnLocaleMergeCurrent('apresults') */
export function assertEnApresultsMergeCurrent(prefix = "") {
    return assertEnLocaleMergeCurrent("apresults", prefix);
}
