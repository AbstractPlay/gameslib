/**
 * Backfill golden.chatLogEntries on existing local fixtures (no DynamoDB).
 */
/* eslint-disable no-console */
import fs from "fs";
import path from "path";
import { addResource } from "../src";
import { replacer } from "../src/common";
import {
    gameFromTurnModelFixture,
    loadTurnModelFixture,
    loadTurnModelManifest,
    TURN_MODEL_FIXTURES_DIR,
    turnModelFixturesAvailable,
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
        const playerNames = fixture.publishedRecord.header.players.map((p) => p.name);
        const engine = gameFromTurnModelFixture(fixture);
        const chatLogEntries = engine.chatLogEntries(playerNames);
        const prev = JSON.stringify(fixture.golden.chatLogEntries, replacer);
        const next = JSON.stringify(chatLogEntries, replacer);
        if (prev === next) {
            continue;
        }
        fixture.golden.chatLogEntries = chatLogEntries;
        const outPath = path.join(TURN_MODEL_FIXTURES_DIR, `${fixture.id}.json`);
        fs.writeFileSync(outPath, JSON.stringify(fixture, replacer));
        console.log(`Updated golden.chatLogEntries: ${fixture.id}`);
        updated++;
    }
    console.log(`Done. Updated ${updated} of ${manifest.fixtures.length} fixtures.`);
}

main();
