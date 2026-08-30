import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectLeaves,
  pruneManagedLocale,
  pruneSrcTracking,
  pruneToSourceShape,
} from "../../scripts/locale-prune.mjs";

describe("locale-prune", () => {
  it("removes top-level orphan keys from target", () => {
    const source = { keep: "English", shared: { a: "one" } };
    const target = { keep: "Behalten", shared: { a: "eins" }, orphan: "extra" };

    const pruned = pruneToSourceShape(source, target);

    assert.deepEqual(pruned, { keep: "Behalten", shared: { a: "eins" } });
    assert.equal("orphan" in pruned, false);
  });

  it("removes nested orphan keys from target", () => {
    const source = { game: { title: "Title", hint: "Hint" } };
    const target = { game: { title: "Titel", hint: "Hinweis", removed: "weg" } };

    const pruned = pruneToSourceShape(source, target);

    assert.deepEqual(pruned, { game: { title: "Titel", hint: "Hinweis" } });
    assert.equal(collectLeaves(pruned).removed, undefined);
  });

  it("preserves existing translations for keys still in English", () => {
    const source = { alpha: "Alpha", beta: "Beta" };
    const target = { alpha: "Alfa", beta: "Beta DE" };

    const result = pruneManagedLocale({
      sourceData: source,
      targetData: target,
      srcTracking: {
        alpha: { src: "Alpha", out: "Alfa" },
        beta: { src: "Beta", out: "Beta DE" },
      },
    });

    assert.equal(result.changed, false);
    assert.equal(result.removedLeaves, 0);
    assert.deepEqual(result.targetData, target);
  });

  it("prunes locale-src tracking entries for removed English keys", () => {
    const source = { only: "Only" };
    const target = { only: "Nur" };
    const srcTracking = {
      only: { src: "Only", out: "Nur" },
      "gone.leaf": { src: "Gone", out: "Weg" },
    };

    const result = pruneManagedLocale({ sourceData: source, targetData: target, srcTracking });

    assert.equal(result.changed, true);
    assert.equal(result.removedTracking, 1);
    assert.deepEqual(result.srcTracking, {
      only: { src: "Only", out: "Nur" },
    });
  });

  it("reports removed translation leaves and tracking together", () => {
    const source = { stay: "Stay" };
    const target = { stay: "Bleiben", gone: "Fort" };
    const srcTracking = {
      stay: { src: "Stay", out: "Bleiben" },
      gone: { src: "Gone", out: "Fort" },
      "orphan.track": { src: "Orphan", out: "Verwaist" },
    };

    const result = pruneManagedLocale({ sourceData: source, targetData: target, srcTracking });

    assert.equal(result.changed, true);
    assert.equal(result.removedLeaves, 1);
    assert.equal(result.removedTracking, 2);
    assert.deepEqual(result.targetData, { stay: "Bleiben" });
    assert.deepEqual(Object.keys(result.srcTracking), ["stay"]);
  });

  it("pruneSrcTracking keeps only source leaf paths", () => {
    const sourceLeaves = { "a.b": "x", "c": "y" };
    const tracking = {
      "a.b": { src: "x", out: "X" },
      "c": { src: "y", out: "Y" },
      "z": { src: "old", out: "OLD" },
    };

    const pruned = pruneSrcTracking(tracking, sourceLeaves);

    assert.deepEqual(Object.keys(pruned).sort(), ["a.b", "c"]);
  });
});
