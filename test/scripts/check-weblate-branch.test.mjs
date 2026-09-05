import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  WEBLATE_BRANCH_CONFIG,
  analyzeLocaleDiff,
  isLocalePath,
  parseMergeTreeConflicts,
} from "../../scripts/check-weblate-branch.mjs";

describe("check-weblate-branch", () => {
  it("detects formatting-only JSON changes", () => {
    const base = JSON.stringify({ a: { b: "hello" } }, null, 2);
    const head = JSON.stringify({ a: { b: "hello" } }, null, 4);
    const result = analyzeLocaleDiff(base, head);
    assert.equal(result.formattingOnly, true);
    assert.equal(result.valueChanges.length, 0);
  });

  it("parses legacy merge conflict lines", () => {
    const output = [
      "Auto-merging locales/de/apgames.json",
      "CONFLICT (content): Merge conflict in locales/de/apgames.json",
    ].join("\n");
    assert.deepEqual(parseMergeTreeConflicts(output), [
      "locales/de/apgames.json",
    ]);
  });

  it("parses git merge-tree v2 changed-in-both conflicts", () => {
    const output = [
      "changed in both",
      "  base   100644 abc123 locales/de/apgames.json",
      "  our    100644 def456 locales/de/apgames.json",
      "  their  100644 fedcba locales/de/apgames.json",
      "@@ -1,4 +1,5 @@",
      " {",
      "+<<<<<<< .our",
      '   "key": "ours",',
      "=======",
      '   "key": "theirs",',
      ">>>>>>> .their",
      "changed in both",
      "  base   100644 abc123 locales/fr/apgames.json",
      "  our    100644 def456 locales/fr/apgames.json",
      "  their  100644 fedcba locales/fr/apgames.json",
      "@@ -1,2 +1,2 @@",
      " merged cleanly without markers",
    ].join("\n");
    assert.deepEqual(parseMergeTreeConflicts(output), [
      "locales/de/apgames.json",
    ]);
  });

  it("detects translation value changes", () => {
    const base = JSON.stringify({ greet: "Hello" });
    const head = JSON.stringify({ greet: "Hallo" });
    const result = analyzeLocaleDiff(base, head);
    assert.equal(result.formattingOnly, false);
    assert.equal(result.valueChanges.length, 1);
    assert.equal(result.valueChanges[0].key, "greet");
  });

  it("detects structural key churn", () => {
    const base = JSON.stringify({ keep: "x", drop: "y" });
    const head = JSON.stringify({ keep: "x", add: "z" });
    const result = analyzeLocaleDiff(base, head);
    assert.deepEqual(result.keysRemoved, ["drop"]);
    assert.deepEqual(result.keysAdded, ["add"]);
    assert.equal(result.formattingOnly, false);
  });

  it("matches locale paths for gameslib", () => {
    assert.equal(
      isLocalePath("locales/de/apgames.json", WEBLATE_BRANCH_CONFIG.localePathRe),
      true,
    );
    assert.equal(
      isLocalePath("package.json", WEBLATE_BRANCH_CONFIG.localePathRe),
      false,
    );
  });
});
