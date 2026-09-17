import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deepMerge } from "../../scripts/translate.mjs";

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
