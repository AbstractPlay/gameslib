/**
 * Recompute golden.genRecordMoves for local turn-model fixtures after export changes.
 */
/* eslint-disable no-console */
import fs from "fs";
import path from "path";
import { addResource } from "../src";
import { replacer } from "../src/common";
import type { IRecordDetails } from "../src/games/_base";
import type { APGameRecord } from "@abstractplay/recranks";
import {
    gameFromTurnModelFixture,
    getMoveListFromGame,
    loadTurnModelFixture,
    loadTurnModelManifest,
    TURN_MODEL_FIXTURES_DIR,
    turnModelFixturesAvailable,
} from "../test/fixtures/turnModel/helpers";

function recordDetailsFromPublished(rec: APGameRecord): IRecordDetails {
    return {
        uid: rec.header.site.gameid as string,
        players: rec.header.players.map((p) => ({
            uid: p.userid as string,
            name: p.name,
            isai: p.is_ai === true ? true : undefined,
        })),
        dateStart: new Date(rec.header["date-start"]),
        dateEnd: new Date(rec.header["date-end"]),
        event: rec.header.event,
        round: rec.header.round,
        unrated: rec.header.unrated === true ? true : undefined,
        pied: rec.header["pie-invoked"] === true || rec.header.pied === true ? true : undefined,
    };
}

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
        const engine = gameFromTurnModelFixture(fixture);
        const genRec = engine.genRecord(recordDetailsFromPublished(fixture.publishedRecord));
        if (genRec === undefined) {
            throw new Error(`genRecord failed for ${entry.id}`);
        }
        const nextMoves = getMoveListFromGame(engine);
        const prev = JSON.stringify(fixture.golden.genRecordMoves, replacer);
        const next = JSON.stringify(nextMoves, replacer);
        if (prev === next) {
            continue;
        }
        fixture.golden.genRecordMoves = nextMoves as APGameRecord["moves"];
        const outPath = path.join(TURN_MODEL_FIXTURES_DIR, `${fixture.id}.json`);
        fs.writeFileSync(outPath, JSON.stringify(fixture, replacer));
        console.log(`Updated golden.genRecordMoves: ${entry.id}`);
        updated++;
    }
    console.log(`Done. Updated ${updated} fixtures.`);
}

main();
