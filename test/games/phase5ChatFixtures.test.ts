import "mocha";
import { expect } from "chai";
import { verifyPhase5ChatFixtureGates } from "../fixtures/turnModel/phase5ChatFixtureGates";
import { turnModelFixturesAvailable } from "../fixtures/turnModel/helpers";

describe("Phase 5 chat fixture gates", () => {
    if (!turnModelFixturesAvailable()) {
        it("skipped — local turn-model fixture gates retired", () => {
            // CI without gitignored fixtures-local passes; local pre-migration gate requires fixtures.
        });
        return;
    }

    it("homeworlds + pigs/pigs2 have chat goldens with required scenario shapes", () => {
        const failures = verifyPhase5ChatFixtureGates();
        if (failures.length > 0) {
            const detail = failures.map((f) => `${f.metaGame}: ${f.reason}`).join("\n");
            expect.fail(`Phase 5 fixture gate failed:\n${detail}`);
        }
    });
});
