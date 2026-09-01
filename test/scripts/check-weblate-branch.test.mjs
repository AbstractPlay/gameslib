import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  WEBLATE_BRANCH_CONFIG,
  analyzeLocaleDiff,
  isLocalePath,
} from "../../scripts/check-weblate-branch.mjs";

describe("check-weblate-branch", () => {
  it("detects formatting-only JSON changes", () => {
    const base = JSON.stringify({ a: { b: "hello" } }, null, 2);
    const head = JSON.stringify({ a: { b: "hello" } }, null, 4);
    const result = analyzeLocaleDiff(base, head);
    assert.equal(result.formattingOnly, true);
    assert.equal(result.valueChanges.length, 0);
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
