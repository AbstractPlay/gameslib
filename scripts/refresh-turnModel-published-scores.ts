/**
 * Sync publishedRecord.header.players[].score from genRecord for local fixtures.
 * Use after enabling the `scores` flag on games whose vendored published snapshots predate scores.
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
    recordDetailsFromFixture,
    reviveFixtureState,
    TURN_MODEL_FIXTURES_DIR,
    turnModelFixturesAvailable,
} from "../test/fixtures/turnModel/helpers";

function main(): void {
    if (!turnModelFixturesAvailable()) {
        console.error(`No fixtures at ${TURN_MODEL_FIXTURES_DIR}.`);
        process.exit(1);
    }
    addResource("en");
    const manifest = loadTurnModelManifest();
    if (manifest === undefined) {
        process.exit(1);
    }
    let updated = 0;
    for (const entry of manifest.fixtures) {
        const fixture = loadTurnModelFixture(entry.id);
        if (fixture === undefined) {
            continue;
        }
        const revived = reviveFixtureState(fixture.state);
        const engine = gameFromTurnModelFixture({ ...fixture, state: revived });
        const genRec = engine.genRecord(recordDetailsFromFixture(fixture));
        if (genRec === undefined) {
            throw new Error(`genRecord failed for ${entry.id}`);
        }
        let changed = false;
        for (let i = 0; i < genRec.header.players.length; i++) {
            const genScore = (genRec.header.players[i] as { score?: number }).score;
            const pubPlayer = fixture.publishedRecord.header.players[i] as { score?: number };
            if (pubPlayer.score !== genScore) {
                pubPlayer.score = genScore;
                changed = true;
            }
        }
        if (!changed) {
            continue;
        }
        const outPath = path.join(TURN_MODEL_FIXTURES_DIR, `${fixture.id}.json`);
        fs.writeFileSync(outPath, JSON.stringify(fixture, replacer));
        console.log(`Updated publishedRecord player scores: ${entry.id}`);
        updated++;
    }
    console.log(`Done. Updated ${updated} fixtures.`);
}

main();
