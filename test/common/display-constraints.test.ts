/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import type { AlternativeDisplay } from "../../src/schemas/gameinfo";
import { UserFacingError } from "../../src/common/errors";
import {
    assertValidDisplaySelection,
    expandLegacyDisplayIncoming,
    resolveIncomingDisplays,
    sanitizeDisplaySelection,
    validateDisplaySelection,
} from "../../src/common/display-constraints";
import {
    displayCycleSteps,
    isSimpleDisplayCycleGame,
    nextDisplayCycleStep,
} from "../../src/common/display-cycle";

const overlayDisplays: AlternativeDisplay[] = [
    { uid: "hide-threatened" },
    { uid: "hide-influence" },
    {
        uid: "hide-both",
        implies: ["hide-threatened", "hide-influence"],
        impliesLock: true,
    },
];

const projectionDisplays: AlternativeDisplay[] = [
    { uid: "flat", group: "projection" },
];

describe("display-constraints", () => {
    describe("expandLegacyDisplayIncoming", () => {
        it("expands hide-both into two overlay uids", () => {
            expect(expandLegacyDisplayIncoming(["hide-both"])).to.deep.equal([
                "hide-threatened",
                "hide-influence",
            ]);
        });
    });

    describe("sanitizeDisplaySelection", () => {
        it("resolves hide-both legacy uid to both overlays", () => {
            expect(sanitizeDisplaySelection(overlayDisplays, ["hide-both"])).to.deep.equal([
                "hide-threatened",
                "hide-influence",
            ]);
        });

        it("allows independent overlay toggles", () => {
            expect(
                sanitizeDisplaySelection(overlayDisplays, ["hide-threatened", "hide-influence"]),
            ).to.deep.equal(["hide-threatened", "hide-influence"]);
        });

        it("applies implies from hide-both definition", () => {
            expect(sanitizeDisplaySelection(overlayDisplays, ["hide-both"])).to.deep.equal([
                "hide-threatened",
                "hide-influence",
            ]);
        });
    });

    describe("validateDisplaySelection", () => {
        it("rejects unknown uids", () => {
            const result = validateDisplaySelection(overlayDisplays, ["not-a-display"]);
            expect(result.ok).to.be.false;
            if (!result.ok) {
                expect(result.errors[0]?.reason).to.equal("unknown");
            }
        });
    });

    describe("assertValidDisplaySelection", () => {
        it("throws INVALID_DISPLAY_COMBINATION", () => {
            expect(() => assertValidDisplaySelection(overlayDisplays, ["bogus"])).to.throw(
                UserFacingError,
                /INVALID_DISPLAY_COMBINATION/,
            );
        });
    });

    describe("resolveIncomingDisplays", () => {
        it("sanitize mode expands legacy composite uids", () => {
            expect(resolveIncomingDisplays(overlayDisplays, ["hide-both"])).to.deep.equal([
                "hide-threatened",
                "hide-influence",
            ]);
        });
    });
});

describe("display-cycle", () => {
    it("is false when multiple ungrouped checkbox displays exist", () => {
        expect(isSimpleDisplayCycleGame(overlayDisplays)).to.be.false;
    });

    it("is true for a single ungrouped toggle", () => {
        expect(isSimpleDisplayCycleGame([{ uid: "swap-prison" }])).to.be.true;
    });

    it("is true for a single projection radio group", () => {
        expect(isSimpleDisplayCycleGame(projectionDisplays)).to.be.true;
    });

    it("cycles default and flat", () => {
        const steps = displayCycleSteps(projectionDisplays);
        expect(steps).to.deep.equal([[], ["flat"]]);
        expect(nextDisplayCycleStep(projectionDisplays, [])).to.deep.equal(["flat"]);
        expect(nextDisplayCycleStep(projectionDisplays, ["flat"])).to.deep.equal([]);
    });

    it("cycles default and a single checkbox uid", () => {
        const defs = [{ uid: "swap-prison" }];
        expect(displayCycleSteps(defs)).to.deep.equal([[], ["swap-prison"]]);
        expect(nextDisplayCycleStep(defs, [])).to.deep.equal(["swap-prison"]);
        expect(nextDisplayCycleStep(defs, ["swap-prison"])).to.deep.equal([]);
    });
});
