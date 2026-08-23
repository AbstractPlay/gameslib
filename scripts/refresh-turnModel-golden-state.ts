/**
 * Recompute golden.stateNormalized in existing local fixtures using replacer/reviver.
 * Use after normalization fixes without re-downloading states from DynamoDB.
 */
/* eslint-disable no-console */
import fs from "fs";
import path from "path";
import { addResource } from "../src";
import { replacer } from "../src/common";
import {
    loadTurnModelFixture,
    loadTurnModelManifest,
    normalizeGameState,
    TURN_MODEL_FIXTURES_DIR,
    turnModelFixturesAvailable,
    gameFromTurnModelFixture,
} from "../test/fixtures/turnModel/helpers";

function main(): void {
    if (!turnModelFixturesAvailable()) {
        console.error(`No fixtures at ${TURN_MODEL_FIXTURES_DIR}. Run fetch-turnModel-fixtures first.`);
        process.exit(1);
    }
    addResource("en");
    const manifest = loadTurnModelManifest();
    if (manifest === undefined) {
        console.error("manifest.json missing or empty");
        process.exit(1);
    }
    let updated = 0;
    for (const entry of manifest.fixtures) {
        const fixture = loadTurnModelFixture(entry.id);
        if (fixture === undefined) {
            console.warn(`Skipping missing fixture ${entry.id}`);
            continue;
        }
        const engine = gameFromTurnModelFixture(fixture);
        const stateNormalized = normalizeGameState(engine.state());
        const prev = JSON.stringify(fixture.golden.stateNormalized, replacer);
        const next = JSON.stringify(stateNormalized, replacer);
        if (prev === next) {
            continue;
        }
        fixture.golden.stateNormalized = stateNormalized;
        const outPath = path.join(TURN_MODEL_FIXTURES_DIR, `${fixture.id}.json`);
        fs.writeFileSync(outPath, JSON.stringify(fixture, replacer));
        console.log(`Updated golden.stateNormalized: ${fixture.id}`);
        updated++;
    }
    console.log(`Done. Updated ${updated} of ${manifest.fixtures.length} fixtures.`);
}

main();
