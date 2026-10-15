import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Project } from "ts-morph";
import { findDuplicateEnWarnings } from "../../scripts/lib/apgames-duplicate-en.mjs";
import {
    catalogContainsRef,
    catalogLeafSatisfiedByGameinfo,
    collectApgamesRefLeavesFromSourceFile,
    findMissingApgamesReferences,
    findOrphanApgamesLeaves,
    resetGamesContextCache,
} from "../../scripts/lib/check-apgames-refs.mjs";
import { mergeApgamesEnSources } from "../../scripts/lib/apgames-en-merge.mjs";
import { loadGamesProject } from "../../scripts/lib/apgames-extract-ts.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("check-apgames-keys duplicate-en", () => {
    it("warns when per-game English matches a shared validation leaf", () => {
        const merged = {
            names: { foo: "Foo" },
            validation: {
                _general: { INVALID_MOVE: "Bad move." },
                foo: { INVALID_MOVE: "Bad move." },
            },
        };
        const warnings = findDuplicateEnWarnings(merged);
        assert.equal(warnings.length, 1);
        assert.match(warnings[0], /validation\.foo\.INVALID_MOVE/);
        assert.match(warnings[0], /validation\._general\.INVALID_MOVE/);
    });

    it("does not warn when basename matches but English differs", () => {
        const merged = {
            names: { foo: "Foo" },
            validation: {
                _general: { INVALID_MOVE: "Generic invalid." },
                foo: { INVALID_MOVE: "Game-specific invalid." },
            },
        };
        const warnings = findDuplicateEnWarnings(merged);
        assert.equal(warnings.length, 0);
    });

    it("complica pilot: strict missing/orphan clean for uid complica", () => {
        const merged = mergeApgamesEnSources();
        const opts = { uidFilter: "complica" };
        assert.deepEqual(findMissingApgamesReferences(merged, opts), []);
        assert.deepEqual(findOrphanApgamesLeaves(merged, opts), []);
    });

    it("squares: strict missing/orphan clean (no dynamic apgames template keys)", () => {
        const merged = mergeApgamesEnSources();
        const opts = { uidFilter: "squares" };
        assert.deepEqual(findMissingApgamesReferences(merged, opts), []);
        assert.deepEqual(findOrphanApgamesLeaves(merged, opts), []);
    });

    it("icepalace: strict missing/orphan clean (display keys anchored for GameBase)", () => {
        const merged = mergeApgamesEnSources();
        const opts = { uidFilter: "icepalace" };
        assert.deepEqual(findMissingApgamesReferences(merged, opts), []);
        assert.deepEqual(findOrphanApgamesLeaves(merged, opts), []);
    });

    it("killallgo: strict missing/orphan clean (no dynamic apgames template keys)", () => {
        const merged = mergeApgamesEnSources();
        const opts = { uidFilter: "killallgo" };
        assert.deepEqual(findMissingApgamesReferences(merged, opts), []);
        assert.deepEqual(findOrphanApgamesLeaves(merged, opts), []);
    });

    it("collects i18next.t apgames literals from complica.ts", () => {
        const project = loadGamesProject();
        const complicaPath = path.join(repoRoot, "src/games/complica.ts");
        const sourceFile = project.getSourceFile(complicaPath);
        assert.ok(sourceFile);
        const refs = collectApgamesRefLeavesFromSourceFile(sourceFile, "complica");
        assert.ok(refs.has("validation.complica.INITIAL_INSTRUCTIONS"));
    });

    it("collector v2: ignores apgames keys in comments", () => {
        const project = new Project({ useInMemoryFileSystem: true });
        const sourceFile = project.createSourceFile(
            "fixture.ts",
            `
            // i18next.t("apgames:validation.fixture.SHOULD_NOT_COUNT")
            export class FixtureGame {
                static readonly gameinfo = { uid: "fixture" };
            }
            `,
        );
        const refs = collectApgamesRefLeavesFromSourceFile(sourceFile, "fixture");
        assert.equal(refs.has("validation.fixture.SHOULD_NOT_COUNT"), false);
    });

    it("collector v2: ignores template literal apgames keys", () => {
        const project = new Project({ useInMemoryFileSystem: true });
        const sourceFile = project.createSourceFile(
            "fixture.ts",
            `
            export class FixtureGame {
                static readonly gameinfo = { uid: "fixture" };
                foo(x: string) {
                    return this.neutralAreaLabel(\`apgames:status.fixture.\${x}\`);
                }
            }
            `,
        );
        const refs = collectApgamesRefLeavesFromSourceFile(sourceFile, "fixture");
        assert.equal(refs.has("status.fixture."), false);
        assert.equal([...refs].some((r) => r.startsWith("status.fixture.")), false);
    });

    it("collector v2: gameinfo satisfies variant catalog leaves without literals", () => {
        const meta = {
            variantUids: new Set(["size-9"]),
            groups: new Set(["board"]),
            displayUids: new Set(),
            displayGroups: new Set(),
        };
        assert.equal(catalogLeafSatisfiedByGameinfo("variants.pilot.size-9.name", "pilot", meta), true);
        assert.equal(catalogLeafSatisfiedByGameinfo("variants.pilot.#board.name", "pilot", meta), true);
        assert.equal(catalogLeafSatisfiedByGameinfo("variants.pilot.missing.name", "pilot", meta), false);
    });

    it("collector v2: i18next plural stem matches catalog _one/_other", () => {
        const catalog = new Set(["validation.buku.TOO_MANY_SOWS_one", "validation.buku.TOO_MANY_SOWS_other"]);
        assert.equal(catalogContainsRef(catalog, "validation.buku.TOO_MANY_SOWS"), true);
    });

    it("full registry strict: zero missing and zero orphans", () => {
        resetGamesContextCache();
        const merged = mergeApgamesEnSources();
        assert.deepEqual(findMissingApgamesReferences(merged), []);
        assert.deepEqual(findOrphanApgamesLeaves(merged), []);
    });

    it("archimedes: variant export leaves not orphans (gameinfo-backed)", () => {
        resetGamesContextCache();
        const merged = mergeApgamesEnSources();
        const opts = { uidFilter: "archimedes" };
        const orphans = findOrphanApgamesLeaves(merged, opts);
        assert.equal(
            orphans.filter((o) => o.includes("variants.archimedes.")).length,
            0,
            orphans.filter((o) => o.includes("variants.archimedes.")).join("\n"),
        );
    });
});
