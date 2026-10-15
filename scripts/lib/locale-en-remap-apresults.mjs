import fs from "node:fs";
import path from "node:path";
import { collectLeaves } from "../locale-prune.mjs";
import { writeLocaleJson } from "../locale-json-format.mjs";
import { mergedApresultsUsesNestedShape, REPO_ROOT } from "./locale-en-namespace-config.mjs";
import { loadCommittedPathMapEntries, setResultLeaf } from "./apresults-path-map.mjs";
import { flattenNestedI18nextPlurals } from "./locale-en-merge-core.mjs";
import { MANAGED_LANGS } from "../locale-prune.mjs";

/**
 * @param {Record<string, unknown>} flatOrNested
 * @returns {Record<string, unknown>}
 */
export function remapApresultsLocaleToNested(flatOrNested) {
    let nested = flatOrNested;
    if (!mergedApresultsUsesNestedShape(flatOrNested)) {
        const flatLeaves = collectLeaves(flatOrNested);
        nested = {};
        const entries = loadCommittedPathMapEntries();
        const catalogOldPaths = new Set(entries.map((e) => e.oldPath));
        for (const entry of entries) {
            const value = flatLeaves[entry.oldPath];
            if (value === undefined) {
                continue;
            }
            if (!nested[entry.uid]) {
                nested[entry.uid] = {};
            }
            setResultLeaf(
                nested[entry.uid],
                entry.uid,
                entry.resultType,
                entry.newLeaf,
                value,
                entry.oldPath,
                catalogOldPaths,
            );
        }
    }
    return flattenNestedI18nextPlurals(nested);
}

/** @param {{ write?: boolean }} opts */
export function runRemapApresultsLocaleLeaves(opts = {}) {
    const write = opts.write === true;
    let count = 0;
    for (const name of fs.readdirSync(path.join(REPO_ROOT, "locales"))) {
        const localePath = path.join(REPO_ROOT, "locales", name, "apresults.json");
        if (!fs.existsSync(localePath)) {
            continue;
        }
        const data = JSON.parse(fs.readFileSync(localePath, "utf8"));
        const remapped = remapApresultsLocaleToNested(data);
        const before = JSON.stringify(data);
        const after = JSON.stringify(remapped);
        if (before === after) {
            continue;
        }
        if (write) {
            writeLocaleJson(localePath, remapped);
        }
        count++;
        console.log(write ? "Wrote" : "Would write", path.relative(REPO_ROOT, localePath));
    }
    for (const lang of MANAGED_LANGS) {
        const localePath = path.join(REPO_ROOT, "locale-src", lang, "apresults.json");
        if (!fs.existsSync(localePath)) {
            continue;
        }
        const data = JSON.parse(fs.readFileSync(localePath, "utf8"));
        const remapped = remapApresultsLocaleToNested(data);
        if (write) {
            writeLocaleJson(localePath, remapped);
        }
        console.log(write ? "Wrote" : "Would write", path.relative(REPO_ROOT, localePath));
        count++;
    }
    console.log(`${write ? "Remapped" : "Would remap"} ${count} apresults locale file(s)`);
}
