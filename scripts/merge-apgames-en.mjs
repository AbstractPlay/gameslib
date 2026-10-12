#!/usr/bin/env node
/**
 * Merge English apgames sources → locales/en/apgames.json
 *
 *   node scripts/merge-apgames-en.mjs --write
 *   node scripts/merge-apgames-en.mjs --check
 */
import fs from "node:fs";
import assert from "node:assert/strict";
import { mergeApgamesEnSources } from "./lib/apgames-en-merge.mjs";
import { MERGED_EN } from "./lib/apgames-en-paths.mjs";
import { writeLocaleJson } from "./locale-json-format.mjs";

function usage() {
    console.error("Usage: node scripts/merge-apgames-en.mjs --write | --check");
    process.exit(2);
}

function main() {
    const write = process.argv.includes("--write");
    const check = process.argv.includes("--check");
    if (write === check) {
        usage();
    }

    const merged = mergeApgamesEnSources();

    if (write) {
        writeLocaleJson(MERGED_EN, merged);
        console.log("Wrote", MERGED_EN);
        return;
    }

    if (!fs.existsSync(MERGED_EN)) {
        console.error("Missing merged file:", MERGED_EN);
        process.exit(1);
    }
    const onDisk = JSON.parse(fs.readFileSync(MERGED_EN, "utf8"));
    assert.deepEqual(merged, onDisk, "merge output differs from locales/en/apgames.json");
    console.log("check-apgames-en: OK");
}

main();
