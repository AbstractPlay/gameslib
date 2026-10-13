import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPlainObjectAsTs } from "../../scripts/lib/plain-object-to-ts-literal.mjs";

describe("plain-object-to-ts-literal", () => {
    it("quotes non-identifier keys and leaves strings JSON-escaped", () => {
        const text = formatPlainObjectAsTs({
            CAPTURE: {
                1: "one",
                "power-dive": "dive",
            },
        });
        assert.match(text, /"1": "one"/);
        assert.match(text, /"power-dive": "dive"/);
    });
});
