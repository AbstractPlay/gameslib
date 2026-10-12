import assert from "node:assert/strict";
import fs from "node:fs";
import { mergeApgamesEnSources } from "./apgames-en-merge.mjs";
import { MERGED_EN } from "./apgames-en-paths.mjs";

/**
 * Fail fast when committed English apgames.json does not match merge sources.
 * @param {string} [prefix]
 */
export function assertEnApgamesMergeCurrent(prefix = "") {
    if (!fs.existsSync(MERGED_EN)) {
        throw new Error(`${prefix}Missing ${MERGED_EN}`);
    }
    const merged = mergeApgamesEnSources();
    const onDisk = JSON.parse(fs.readFileSync(MERGED_EN, "utf8"));
    assert.deepEqual(
        merged,
        onDisk,
        `${prefix}locales/en/apgames.json does not match merge sources — do not edit that file by hand. ` +
            "Edit locale-src/en/apgames/shared/, gameinfo, and gameApgamesEn in src/games/, then run: npm run merge-apgames-en",
    );
}
