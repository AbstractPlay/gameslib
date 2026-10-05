import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatLocaleJson, normalizeLocaleJsonText } from "../../scripts/locale-json-format.mjs";

describe("locale-json-format", () => {
  it("uses 2-space indent and trailing newline", () => {
    const text = formatLocaleJson({ a: { b: "x" } });
    assert.equal(text, '{\n  "a": {\n    "b": "x"\n  }\n}\n');
  });

  it("normalizes 4-space legacy files", () => {
    const legacy = '{\n    "greet": "hi"\n}\n';
    assert.equal(normalizeLocaleJsonText(legacy), '{\n  "greet": "hi"\n}\n');
  });
});
