/**
 * Pre-migration gate: Phase 4 Tier B/C chat goldens must exist locally with required shapes.
 */
/* eslint-disable no-console */
import { verifyPhase4ChatFixtureGates } from "../test/fixtures/turnModel/phase4ChatFixtureGates";

function main(): void {
    const failures = verifyPhase4ChatFixtureGates();
    if (failures.length === 0) {
        console.log("Phase 4 chat fixture gates: OK (13 games, breakthrough baseline + detonate)");
        process.exit(0);
    }
    console.error("Phase 4 chat fixture gates FAILED:\n");
    for (const f of failures) {
        console.error(`  ${f.metaGame}: ${f.reason}`);
    }
    console.error("\nRun: npm run fetch-turnModel-fixtures && npm run fetch-extra-chat-fixtures");
    console.error("Then: npm run refresh-chat-golden-entries && npm run refresh-chat-golden");
    process.exit(1);
}

main();
