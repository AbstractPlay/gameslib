import "mocha";
import { expect } from "chai";
import { verifyPhase4ChatFixtureGates } from "../fixtures/turnModel/phase4ChatFixtureGates";
import { turnModelFixturesAvailable } from "../fixtures/turnModel/helpers";

describe("Phase 4 chat fixture gates", () => {
    if (!turnModelFixturesAvailable()) {
        it("skipped — run npm run fetch-turnModel-fixtures for Phase 4 golden coverage", () => {
            // CI without gitignored fixtures-local passes; local pre-migration gate requires fixtures.
        });
        return;
    }

    it("Tier B + C override games have chat goldens with required scenario shapes", () => {
        const failures = verifyPhase4ChatFixtureGates();
        if (failures.length > 0) {
            const detail = failures.map((f) => `${f.metaGame}: ${f.reason}`).join("\n");
            expect.fail(`Phase 4 fixture gate failed:\n${detail}`);
        }
    });
});
