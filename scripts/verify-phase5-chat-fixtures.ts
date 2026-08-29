/**
 * Pre/post-migration gate: Phase 5 homeworlds + pigs/pigs2 chat goldens.
 */
/* eslint-disable no-console */
import { verifyPhase5ChatFixtureGates } from "../test/fixtures/turnModel/phase5ChatFixtureGates";

function main(): void {
    const failures = verifyPhase5ChatFixtureGates();
    if (failures.length === 0) {
        console.log("Phase 5 chat fixture gates: OK (homeworlds 3p elimination, pigs 4p, pigs2 elimination)");
        process.exit(0);
    }
    console.error("Phase 5 chat fixture gates FAILED:\n");
    for (const f of failures) {
        console.error(`  ${f.metaGame}: ${f.reason}`);
    }
    console.error("\nRun: npm run fetch-turnModel-fixtures");
    console.error("Then: npm run refresh-chat-golden-entries && npm run refresh-chat-golden");
    process.exit(1);
}

main();
