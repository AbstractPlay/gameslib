/**
 * Pre-migration gate: Phase 3 Tier A chat goldens must exist locally with required shapes.
 */
/* eslint-disable no-console */
import { verifyPhase3ChatFixtureGates } from "../test/fixtures/turnModel/phase3ChatFixtureGates";

function main(): void {
    const failures = verifyPhase3ChatFixtureGates();
    if (failures.length === 0) {
        console.log("Phase 3 chat fixture gates: OK (7 games, 10 fixture entries)");
        process.exit(0);
    }
    console.error("Phase 3 chat fixture gates FAILED:\n");
    for (const f of failures) {
        console.error(`  ${f.metaGame}: ${f.reason}`);
    }
    console.error("\nRun: npm run fetch-turnModel-fixtures && npm run fetch-extra-chat-fixtures");
    console.error("Then: npm run refresh-chat-golden-entries && npm run refresh-chat-golden");
    process.exit(1);
}

main();
