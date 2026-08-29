import "mocha";
import { expect } from "chai";
import { verifyPhase3ChatFixtureGates } from "../fixtures/turnModel/phase3ChatFixtureGates";
import { turnModelFixturesAvailable } from "../fixtures/turnModel/helpers";

describe("Phase 3 chat fixture gates (Tier A)", () => {
    if (!turnModelFixturesAvailable()) {
        it("skipped — run npm run fetch-turnModel-fixtures for Tier A golden coverage", () => {
            // CI without gitignored fixtures-local passes; local pre-migration gate requires fixtures.
        });
        return;
    }

    it("attribution override games have chat goldens with required scenario shapes", () => {
        const failures = verifyPhase3ChatFixtureGates();
        if (failures.length > 0) {
            const detail = failures.map((f) => `${f.metaGame}: ${f.reason}`).join("\n");
            expect.fail(`Phase 3 fixture gate failed:\n${detail}`);
        }
    });
});
