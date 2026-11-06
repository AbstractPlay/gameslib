import { expect } from "chai";
import { sanitizeInputModeForGame } from "../../src/common/input-mode-constraints.js";
import type { InputMode } from "../../src/schemas/gameinfo.js";

describe("input-mode-constraints", () => {
    const modes: InputMode[] = [
        { uid: "#main", group: "main" },
        { uid: "a", group: "main" },
        { uid: "b", group: "main" },
    ];

    it("returns undefined when game has no input modes", () => {
        expect(sanitizeInputModeForGame(undefined, "a")).to.equal(undefined);
        expect(sanitizeInputModeForGame([], "a")).to.equal(undefined);
    });

    it("sanitizes to first stored valid uid", () => {
        expect(sanitizeInputModeForGame(modes, "b")).to.equal("b");
    });

    it("falls back to first concrete mode when stored is unknown", () => {
        expect(sanitizeInputModeForGame(modes, "nope")).to.equal("a");
    });

    it("falls back to first concrete mode when stored is empty", () => {
        expect(sanitizeInputModeForGame(modes, "")).to.equal("a");
        expect(sanitizeInputModeForGame(modes, undefined)).to.equal("a");
    });
});
