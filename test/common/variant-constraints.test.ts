/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import type { Variant } from "../../src/schemas/gameinfo";
import { UserFacingError } from "../../src/common/errors";
import {
    assertValidVariantSelection,
    evaluateAvailability,
    isVariantSelectable,
    resolveIncomingVariants,
    resolveSelection,
    sanitizeVariantSelection,
    validateVariantSelection,
} from "../../src/common/variant-constraints";

const loaVariants: Variant[] = [
    { uid: "classic", group: "board", default: true },
    { uid: "#board" },
    { uid: "hex5", group: "board" },
    { uid: "hex6", group: "board" },
    {
        uid: "scrambled",
        group: "setup",
        enabledWhen: { board: ["#board", "classic"] },
    },
];

const druidVariants: Variant[] = [
    { uid: "size-8", group: "board" },
    { uid: "#board" },
    { uid: "size-12", group: "board" },
    { uid: "y-7", group: "board" },
    { uid: "hex-5", group: "board" },
    {
        uid: "walk",
        group: "ruleset",
        enabledWhen: { board: ["#board", "size-8", "size-12"] },
    },
];

const requiresVariants: Variant[] = [
    { uid: "courts" },
    { uid: "courtpawns", requires: ["courts"] },
];

const conflictVariants: Variant[] = [
    { uid: "advanced" },
    { uid: "beginner", conflictsWith: ["advanced"] },
];

const impliesVariants: Variant[] = [
    { uid: "mega", implies: ["stacked"] },
    { uid: "stacked", requires: ["mega"] },
];

const impliesLockVariants: Variant[] = [
    { uid: "mega", implies: ["stacked"], impliesLock: true },
    { uid: "stacked", requires: ["mega"] },
];

describe("variant-constraints", () => {
    describe("resolveSelection", () => {
        it("uses #group sentinel when no group member is active", () => {
            const sel = resolveSelection(loaVariants, ["hex5"]);
            expect(sel.active).to.deep.equal(["hex5"]);
            expect(sel.groupChoice.board).to.equal("hex5");
            expect(sel.groupChoice.setup).to.equal("#setup");
        });
    });

    describe("enabledWhen", () => {
        it("LOA: scrambled incompatible with hex5", () => {
            expect(isVariantSelectable("scrambled", loaVariants, ["hex5", "scrambled"])).to.be.false;
            expect(sanitizeVariantSelection(loaVariants, ["hex5", "scrambled"])).to.deep.equal(["hex5"]);
        });

        it("LOA: scrambled allowed with classic", () => {
            expect(isVariantSelectable("scrambled", loaVariants, ["classic", "scrambled"])).to.be.true;
            expect(sanitizeVariantSelection(loaVariants, ["classic", "scrambled"])).to.deep.equal([
                "classic",
                "scrambled",
            ]);
        });

        it("LOA: back-pressure disables hex boards while scrambled is active", () => {
            expect(isVariantSelectable("hex5", loaVariants, ["classic", "scrambled"])).to.be.false;
            expect(isVariantSelectable("hex6", loaVariants, ["classic", "scrambled"])).to.be.false;
            expect(isVariantSelectable("classic", loaVariants, ["classic", "scrambled"])).to.be.true;
            const map = evaluateAvailability(loaVariants, ["classic", "scrambled"]);
            expect(map.get("hex5")?.selectable).to.be.false;
            expect(map.get("hex5")?.reasons).to.include("enabledWhen");
        });

        it("Druid: walk stripped on hex board", () => {
            expect(sanitizeVariantSelection(druidVariants, ["hex-5", "walk"])).to.deep.equal(["hex-5"]);
        });

        it("Druid: walk kept on rect board", () => {
            expect(sanitizeVariantSelection(druidVariants, ["size-8", "walk"])).to.deep.equal([
                "size-8",
                "walk",
            ]);
        });
    });

    describe("requires", () => {
        it("courtpawns not selectable without courts", () => {
            expect(isVariantSelectable("courtpawns", requiresVariants, ["courtpawns"])).to.be.false;
            expect(sanitizeVariantSelection(requiresVariants, ["courtpawns"])).to.deep.equal([]);
        });

        it("courtpawns allowed with courts", () => {
            expect(sanitizeVariantSelection(requiresVariants, ["courts", "courtpawns"])).to.deep.equal([
                "courts",
                "courtpawns",
            ]);
        });
    });

    describe("conflictsWith", () => {
        it("is symmetric", () => {
            expect(isVariantSelectable("advanced", conflictVariants, ["beginner"])).to.be.false;
            expect(isVariantSelectable("beginner", conflictVariants, ["advanced"])).to.be.false;
        });

        it("sanitize drops conflicting checkbox", () => {
            expect(sanitizeVariantSelection(conflictVariants, ["advanced", "beginner"])).to.deep.equal([
                "beginner",
            ]);
        });
    });

    describe("implies", () => {
        it("sanitize adds implied uids when trigger is active", () => {
            expect(sanitizeVariantSelection(impliesVariants, ["mega"])).to.deep.equal([
                "mega",
                "stacked",
            ]);
        });

        it("does not add implied uids in assert validation", () => {
            expect(validateVariantSelection(impliesVariants, ["mega"]).ok).to.be.true;
        });

        it("soft implies re-adds on sanitize but does not lock the checkbox", () => {
            expect(sanitizeVariantSelection(impliesVariants, ["mega"])).to.deep.equal([
                "mega",
                "stacked",
            ]);
            const map = evaluateAvailability(impliesVariants, ["mega", "stacked"]);
            expect(map.get("stacked")?.selectable).to.be.true;
        });
    });

    describe("impliesLock", () => {
        it("sanitize re-adds locked implied uids", () => {
            expect(sanitizeVariantSelection(impliesLockVariants, ["mega"])).to.deep.equal([
                "mega",
                "stacked",
            ]);
        });

        it("marks locked implied checkbox not selectable while trigger active", () => {
            const map = evaluateAvailability(impliesLockVariants, ["mega", "stacked"]);
            expect(map.get("stacked")?.selectable).to.be.false;
            expect(map.get("stacked")?.reasons).to.include("impliesLock");
        });
    });

    describe("duplicate group rule", () => {
        it("sanitize keeps last uid per group", () => {
            expect(sanitizeVariantSelection(loaVariants, ["classic", "hex5"])).to.deep.equal(["hex5"]);
        });

        it("assert fails on duplicate group members", () => {
            const result = validateVariantSelection(loaVariants, ["classic", "hex5"]);
            expect(result.ok).to.be.false;
            if (!result.ok) {
                expect(result.errors.some((e) => e.reason === "duplicateGroup")).to.be.true;
            }
        });
    });

    describe("evaluateAvailability", () => {
        it("marks scrambled unavailable when hex5 is selected", () => {
            const map = evaluateAvailability(loaVariants, ["hex5"]);
            expect(map.get("scrambled")?.selectable).to.be.false;
            expect(map.get("scrambled")?.reasons).to.include("enabledWhen");
        });
    });

    describe("validateVariantSelection", () => {
        it("accepts valid LOA combo", () => {
            expect(validateVariantSelection(loaVariants, ["classic", "scrambled"]).ok).to.be.true;
        });

        it("rejects invalid LOA combo", () => {
            const result = validateVariantSelection(loaVariants, ["hex5", "scrambled"]);
            expect(result.ok).to.be.false;
        });
    });

    describe("assertValidVariantSelection", () => {
        it("throws UserFacingError with stable code", () => {
            expect(() => assertValidVariantSelection(loaVariants, ["hex5", "scrambled"])).to.throw(
                UserFacingError,
                "INVALID_VARIANT_COMBINATION",
            );
        });
    });

    describe("resolveIncomingVariants", () => {
        it("sanitize mode matches LOA pilot fixture", () => {
            expect(resolveIncomingVariants(loaVariants, ["hex5", "scrambled"])).to.deep.equal(["hex5"]);
        });

        it("assert mode throws on invalid combo", () => {
            expect(() =>
                resolveIncomingVariants(loaVariants, ["hex5", "scrambled"], { mode: "assert" }),
            ).to.throw(UserFacingError);
        });

        it("assert mode returns copy when valid", () => {
            const input = ["classic", "scrambled"];
            const out = resolveIncomingVariants(loaVariants, input, { mode: "assert" });
            expect(out).to.deep.equal(input);
            expect(out).to.not.equal(input);
        });
    });
});
