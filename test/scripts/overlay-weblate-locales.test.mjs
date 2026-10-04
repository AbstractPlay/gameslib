import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isHumanWeblateLeaf,
  overlayLocaleLeaves,
} from "../../scripts/overlay-weblate-locales.mjs";

describe("overlay-weblate-locales", () => {
  it("treats Weblate leaves that match English as non-human", () => {
    assert.equal(isHumanWeblateLeaf("Hello", "Hello"), false);
    assert.equal(isHumanWeblateLeaf("Hello", undefined), false);
    assert.equal(isHumanWeblateLeaf("Hello", "Bonjour"), true);
  });

  it("keeps develop MT when Weblate only has English", () => {
    const source = { "a.b": "Hello" };
    const develop = { "a.b": "Bonjour auto" };
    const weblate = { "a.b": "Hello" };
    const { mergedLeaves, weblateWins, developKept } = overlayLocaleLeaves(
      source,
      develop,
      weblate,
      {},
      {},
    );
    assert.equal(mergedLeaves["a.b"], "Bonjour auto");
    assert.equal(weblateWins, 0);
    assert.equal(developKept, 1);
  });

  it("prefers Weblate when translated away from English", () => {
    const source = { "a.b": "Hello" };
    const develop = { "a.b": "Bonjour auto" };
    const weblate = { "a.b": "Bonjour humain" };
    const { mergedLeaves, weblateWins } = overlayLocaleLeaves(
      source,
      develop,
      weblate,
      {},
      { "a.b": { src: "Hello", out: "Bonjour humain" } },
    );
    assert.equal(mergedLeaves["a.b"], "Bonjour humain");
    assert.equal(weblateWins, 1);
  });

  it("keeps develop when Weblate has no leaf", () => {
    const source = { "new.key": "Only on develop" };
    const develop = { "new.key": "Nur auf develop" };
    const { mergedLeaves, developKept } = overlayLocaleLeaves(source, develop, {}, {}, {});
    assert.equal(mergedLeaves["new.key"], "Nur auf develop");
    assert.equal(developKept, 1);
  });
});
