/**
 * Recompute golden.chatLog from saved fixture states and warn when structured parity breaks.
 */
/* eslint-disable no-console */
import fs from "fs";
import path from "path";
import { addResource } from "../src";
import { replacer } from "../src/common";
import {
    chatLogEntriesParitySupported,
    gameFromTurnModelFixture,
    loadTurnModelFixture,
    loadTurnModelManifest,
    normalizeChatLogForGolden,
    TURN_MODEL_FIXTURES_DIR,
    turnModelFixturesAvailable,
} from "../test/fixtures/turnModel/helpers";
import { assertChatLogParity } from "../test/fixtures/chat/helpers";

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
    let parityFailures = 0;
    for (const entry of manifest.fixtures) {
        const fixture = loadTurnModelFixture(entry.id);
        if (fixture === undefined) {
            console.warn(`Skipping missing fixture ${entry.id}`);
            continue;
        }
        const playerNames = fixture.publishedRecord.header.players.map((p) => p.name);
        const engine = gameFromTurnModelFixture(fixture);
        const chatLog = engine.chatLog(playerNames);
        const chatLogEntries = engine.chatLogEntries(playerNames);
        let dirty = false;
        const prevLog = JSON.stringify(normalizeChatLogForGolden(fixture.golden.chatLog), replacer);
        const nextLog = JSON.stringify(normalizeChatLogForGolden(chatLog), replacer);
        if (prevLog !== nextLog) {
            fixture.golden.chatLog = chatLog;
            dirty = true;
        }
        const prevEntries = JSON.stringify(fixture.golden.chatLogEntries, replacer);
        const nextEntries = JSON.stringify(chatLogEntries, replacer);
        if (prevEntries !== nextEntries) {
            fixture.golden.chatLogEntries = chatLogEntries;
            dirty = true;
        }
        if (dirty) {
            const outPath = path.join(TURN_MODEL_FIXTURES_DIR, `${fixture.id}.json`);
            fs.writeFileSync(outPath, JSON.stringify(fixture, replacer));
            console.log(`Updated golden chat baselines: ${fixture.id}`);
            updated++;
        }
        if (chatLogEntriesParitySupported(entry.metaGame, engine)) {
            try {
                assertChatLogParity(engine, playerNames);
            } catch (err) {
                console.warn(`chatLogEntries parity failed for ${fixture.id}: ${err}`);
                parityFailures++;
            }
        }
    }
    console.log(`Done. Updated ${updated} of ${manifest.fixtures.length} fixtures.`);
    if (parityFailures > 0) {
        console.error(`${parityFailures} fixture(s) failed chatLogEntries parity.`);
        process.exit(1);
    }
}

main();
