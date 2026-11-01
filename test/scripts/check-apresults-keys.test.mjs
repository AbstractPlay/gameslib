import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Project } from "ts-morph";
import {
    findApresultsDuplicateEnWarnings,
    findApresultsGeneralInternalDuplicateEnWarnings,
} from "../../scripts/lib/apresults-duplicate-en.mjs";
import {
    catalogContainsRef,
    collectAllApresultsRefPaths,
    collectApresultsRefPathsFromSourceFile,
    collectDynamicApresultsCatalogPrefixes,
    collectEogReasonApresultsPaths,
    findMissingApresultsReferences,
    findOrphanApresultsGeneralLeaves,
    findOrphanApresultsLeaves,
    resetApresultsGamesContextCache,
} from "../../scripts/lib/check-apresults-refs.mjs";
import { mergeApresultsEnSources } from "../../scripts/lib/apresults-en-merge.mjs";
import { loadGamesProject } from "../../scripts/lib/apgames-extract-ts.mjs";
import { resetGamesContextCache } from "../../scripts/lib/check-apgames-refs.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("check-apresults-keys", () => {
    it("warns when _general leaves share English within a result-type bucket", () => {
        const merged = {
            _general: {
                MOVE: {
                    nowhat: "{{player}} moved from {{from}} to {{to}}.",
                    amazonsNoFirstShot: "{{player}} moved from {{from}} to {{to}}.",
                },
            },
        };
        const warnings = findApresultsGeneralInternalDuplicateEnWarnings(merged, { scope: "perResultType" });
        assert.equal(warnings.length, 1);
        assert.match(warnings[0], /duplicate-en-general \(MOVE\)/);
        assert.match(warnings[0], /MOVE\.nowhat/);
    });

    it("warns when per-game English matches _general", () => {
        const merged = {
            _general: { PLACE: { nowhat: "{{player}} placed at {{where}}." } },
            deckfish: { PLACE: { nowhat: "{{player}} placed at {{where}}." } },
        };
        const warnings = findApresultsDuplicateEnWarnings(merged, { uidFilter: "deckfish" });
        assert.equal(warnings.length, 1);
        assert.match(warnings[0], /deckfish\.PLACE\.nowhat/);
        assert.match(warnings[0], /_general\.PLACE\.nowhat/);
    });

    it("collector v2: ignores apresults keys in comments", () => {
        const project = new Project({ useInMemoryFileSystem: true });
        const sourceFile = project.createSourceFile(
            "t.ts",
            `
            // apresults:PLACE.fake
            const x = "apresults:PLACE.real";
            `,
        );
        const refs = collectApresultsRefPathsFromSourceFile(sourceFile);
        assert.deepEqual([...refs], ["PLACE.real"]);
    });

    it("collector v2: ignores template literal apresults keys", () => {
        const project = new Project({ useInMemoryFileSystem: true });
        const sourceFile = project.createSourceFile(
            "t.ts",
            `const x = \`apresults:SCRIBE.glyphs.\${key}\`;`,
        );
        const refs = collectApresultsRefPathsFromSourceFile(sourceFile);
        assert.equal(refs.size, 0);
    });

    it("i18next plural stem matches catalog _one/_other", () => {
        const catalog = new Set(["DELTA_SCORE_GAIN_one", "DELTA_SCORE_GAIN_other"]);
        assert.equal(catalogContainsRef(catalog, "DELTA_SCORE_GAIN"), true);
    });

    it("i18next plural stem matches catalog _one/_other under _general", () => {
        const catalog = new Set(["_general.DELTA_SCORE_GAIN_one", "_general.DELTA_SCORE_GAIN_other"]);
        assert.equal(catalogContainsRef(catalog, "_general.DELTA_SCORE_GAIN"), true);
    });

    it("homeworlds: strict missing/orphan clean for uid homeworlds", () => {
        resetGamesContextCache();
        resetApresultsGamesContextCache();
        const opts = { uidFilter: "homeworlds" };
        assert.deepEqual(findMissingApresultsReferences(opts), []);
        assert.deepEqual(findOrphanApresultsLeaves(opts), []);
    });

    it("anache: gameApresultsEn EOG leaves referenced via eog reason pushes", () => {
        resetGamesContextCache();
        resetApresultsGamesContextCache();
        const opts = { uidFilter: "anache" };
        const orphans = findOrphanApresultsLeaves(opts);
        assert.equal(
            orphans.filter((o) => o.includes("anache.EOG.")).length,
            0,
            orphans.filter((o) => o.includes("anache.EOG.")).join("\n"),
        );
    });

    it("collectEogReasonApresultsPaths finds breakthrough/stalemate on anache.ts", () => {
        const project = loadGamesProject();
        const sf = project.getSourceFile(path.join(repoRoot, "src/games/anache.ts"));
        assert.ok(sf);
        const refs = collectEogReasonApresultsPaths(sf, "anache");
        assert.ok(refs.has("anache.EOG.breakthrough"));
        assert.ok(refs.has("anache.EOG.stalemate"));
    });

    it("armadas: PLACE.1–3 referenced via apresults template prefix in chat", () => {
        resetGamesContextCache();
        resetApresultsGamesContextCache();
        const opts = { uidFilter: "armadas" };
        const orphans = findOrphanApresultsLeaves(opts);
        assert.equal(
            orphans.filter((o) => o.includes("armadas.PLACE.")).length,
            0,
            orphans.filter((o) => o.includes("armadas.PLACE.")).join("\n"),
        );
    });

    it("collectDynamicApresultsCatalogPrefixes finds armadas PLACE.* template", () => {
        const project = loadGamesProject();
        const sf = project.getSourceFile(path.join(repoRoot, "src/games/armadas.ts"));
        assert.ok(sf);
        const prefixes = collectDynamicApresultsCatalogPrefixes(sf);
        assert.ok([...prefixes].some((p) => p.startsWith("armadas.PLACE.")));
    });

    it("collectDynamicApresultsCatalogPrefixes finds _general PLACE.PYRAMID_* on pylon", () => {
        const project = loadGamesProject();
        const sf = project.getSourceFile(path.join(repoRoot, "src/games/pylon.ts"));
        assert.ok(sf);
        const prefixes = collectDynamicApresultsCatalogPrefixes(sf);
        assert.ok(prefixes.has("_general.PLACE.PYRAMID_"));
    });

    it("collectAllApresultsRefPaths expands _general template prefixes (PYRAMID_1–3)", () => {
        resetGamesContextCache();
        resetApresultsGamesContextCache();
        const refs = collectAllApresultsRefPaths();
        assert.ok(refs.has("_general.PLACE.PYRAMID_1"));
        assert.ok(refs.has("_general.PLACE.PYRAMID_2"));
        assert.ok(refs.has("_general.PLACE.PYRAMID_3"));
    });

    it("pylon/subdivision: _general PLACE.PYRAMID_* not orphan apresults leaves", () => {
        resetGamesContextCache();
        resetApresultsGamesContextCache();
        const orphans = findOrphanApresultsGeneralLeaves();
        assert.equal(
            orphans.filter((o) => o.includes("_general.PLACE.PYRAMID_")).length,
            0,
            orphans.filter((o) => o.includes("_general.PLACE.PYRAMID_")).join("\n"),
        );
    });

    it("collects apresults literals from homeworlds.ts", () => {
        const project = loadGamesProject();
        const hwPath = path.join(repoRoot, "src/games/homeworlds.ts");
        const sourceFile = project.getSourceFile(hwPath);
        assert.ok(sourceFile);
        const refs = collectApresultsRefPathsFromSourceFile(sourceFile);
        assert.ok(refs.has("homeworlds.MOVE.fly"));
        assert.ok(refs.has("homeworlds.ESTABLISH.land"));
    });

    it("duplicate-en-general reports debt on real merge tree", () => {
        const merged = mergeApresultsEnSources();
        const warnings = findApresultsGeneralInternalDuplicateEnWarnings(merged, {
            allowlist: { perGame: new Set(), generalInternal: new Set() },
        });
        assert.ok(warnings.length > 0, "expected some duplicate-en-general warnings in bootstrap data");
    });
});
