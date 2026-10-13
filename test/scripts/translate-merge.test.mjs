import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyCopiesFromTranslationIndex,
  buildReusableTranslationIndex,
  collapseTranslateBatchByEnglish,
  deepMerge,
  normalizeEnglishForDedup,
} from "../../scripts/translate.mjs";

describe("translate deepMerge", () => {
  it("merges a single nested leaf without clobbering sibling keys", () => {
    const targetData = {
      PUSH: {
        titles: {
          challenged: "Herausgefordert",
          declined: "Abgelehnt",
        },
      },
      Other: "bleibt",
    };
    const nestedChunk = {
      PUSH: {
        titles: {
          announcement: "Website-Ankündigung",
        },
      },
    };

    deepMerge(targetData, nestedChunk);

    assert.equal(targetData.PUSH.titles.challenged, "Herausgefordert");
    assert.equal(targetData.PUSH.titles.declined, "Abgelehnt");
    assert.equal(targetData.PUSH.titles.announcement, "Website-Ankündigung");
    assert.equal(targetData.Other, "bleibt");
  });
});

describe("translate duplicate English", () => {
  it("normalizes whitespace for dedup", () => {
    assert.equal(normalizeEnglishForDedup("  foo   bar "), "foo bar");
  });

  it("indexes reusable translations and copies to pending duplicate leaves", () => {
    const sourceData = {
      validation: {
        _general: { INVALID_MOVE: "Bad move." },
        foo: { INVALID_MOVE: "Bad  move." },
      },
    };
    const targetData = {
      validation: {
        _general: { INVALID_MOVE: "Ungültiger Zug." },
      },
    };
    const srcTracking = {
      "validation._general.INVALID_MOVE": { src: "Bad move.", out: "Ungültiger Zug." },
    };
    const pending = { "validation.foo.INVALID_MOVE": "Bad  move." };
    const index = buildReusableTranslationIndex(sourceData, targetData, srcTracking, new Set(Object.keys(pending)));
    const { copies, remaining } = applyCopiesFromTranslationIndex(pending, index);
    assert.equal(copies.length, 1);
    assert.equal(copies[0].out, "Ungültiger Zug.");
    assert.equal(copies[0].fromPath, "validation._general.INVALID_MOVE");
    assert.deepEqual(remaining, {});
  });

  it("collapses API batch to one key per normalized English", () => {
    const pending = {
      "a.one": "Hello.",
      "b.two": "Hello.",
      "c.three": "Other.",
    };
    const { apiLeaves, pathsByNorm } = collapseTranslateBatchByEnglish(pending);
    assert.equal(Object.keys(apiLeaves).length, 2);
    assert.equal(apiLeaves["a.one"], "Hello.");
    assert.equal(apiLeaves["c.three"], "Other.");
    assert.equal(pathsByNorm.get("Hello.").length, 2);
  });
});
