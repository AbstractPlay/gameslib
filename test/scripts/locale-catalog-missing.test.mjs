import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeApgamesEnSources } from "../../scripts/lib/apgames-en-merge.mjs";
import {
    findMissingApgamesReferences,
    resetGamesContextCache,
} from "../../scripts/lib/check-apgames-refs.mjs";
import {
    findMissingApresultsReferences,
    resetApresultsGamesContextCache,
} from "../../scripts/lib/check-apresults-refs.mjs";

/**
 * Missing merged-catalog keys for `apgames:` / `apresults:` literals in game source.
 * These are the runtime "missing JSON" / raw-key failures in the product UI.
 */
describe("locale catalog missing (runtime i18n)", () => {
    it("apgames: full registry has no missing catalog keys", () => {
        resetGamesContextCache();
        const merged = mergeApgamesEnSources();
        const missing = findMissingApgamesReferences(merged);
        assert.deepEqual(
            missing,
            [],
            missing.length ? `Missing apgames catalog keys:\n${missing.slice(0, 20).join("\n")}` : undefined,
        );
    });

    it("apresults: full registry has no missing catalog keys", () => {
        resetGamesContextCache();
        resetApresultsGamesContextCache();
        const missing = findMissingApresultsReferences();
        assert.deepEqual(
            missing,
            [],
            missing.length ? `Missing apresults catalog keys:\n${missing.slice(0, 20).join("\n")}` : undefined,
        );
    });
});
