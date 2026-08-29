import "mocha";
import { addResource } from "../../src";
import { GameBase, GameFactory, games } from "../../src/games";
import { assertChatLogParity } from "../fixtures/chat/helpers";
import {
    gameFromTurnModelFixture,
    loadTurnModelFixture,
    loadTurnModelManifest,
    turnModelFixturesAvailable,
} from "../fixtures/turnModel/helpers";
import {
    buildCanoeEndOfTurnRollGame,
    canoeRollPlayerNames,
} from "../fixtures/chat/canoeRollAttribution";

/** Instantiate a fresh game for registry smoke tests (constructors vary by title). */
function freshGameInstance(uid: string): GameBase | undefined {
    const ctor = games.get(uid);
    if (ctor === undefined) {
        return undefined;
    }
    const attempts: unknown[][] = [[]];
    const firstCount = ctor.gameinfo.playercounts[0];
    if (firstCount !== undefined) {
        attempts.push([firstCount]);
    }
    if (firstCount !== 2) {
        attempts.push([2]);
    }
    for (const args of attempts) {
        try {
            const g = GameFactory(uid, ...args);
            if (g !== undefined) {
                return g;
            }
        } catch {
            // try next constructor shape
        }
    }
    return undefined;
}

function defaultPlayerNames(numplayers: number): string[] {
    const pool = ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank"];
    return pool.slice(0, Math.max(1, numplayers));
}

/** All registry uids with a constructible fresh instance. */
function freshMetagames(): string[] {
    const metas: string[] = [];
    for (const uid of games.keys()) {
        if (freshGameInstance(uid) !== undefined) {
            metas.push(uid);
        }
    }
    return metas.sort();
}

describe("chatLog parity (Phase 1)", () => {
    before(() => {
        addResource("en");
    });

    for (const metaGame of freshMetagames()) {
        it(`${metaGame} fresh-state chatLogEntries parity`, () => {
            const g = freshGameInstance(metaGame);
            if (g === undefined) {
                throw new Error(`Could not construct fresh ${metaGame} for parity check`);
            }
            assertChatLogParity(g, defaultPlayerNames(g.numplayers));
        });
    }

    if (turnModelFixturesAvailable()) {
        const manifest = loadTurnModelManifest();
        for (const entry of manifest?.fixtures ?? []) {
            if (entry.category !== "tier1" && entry.category !== "pattern") {
                continue;
            }
            it(`${entry.id}: chatLogEntries parity with chatLog`, () => {
                const fixture = loadTurnModelFixture(entry.id);
                if (fixture === undefined) {
                    throw new Error(`Missing fixture file for ${entry.id}`);
                }
                const playerNames = fixture.publishedRecord.header.players.map((p) => p.name);
                const g = gameFromTurnModelFixture(fixture);
                assertChatLogParity(g, playerNames);
            });
        }
    }

    it("Canoe roll attribution parity", () => {
        const g = buildCanoeEndOfTurnRollGame();
        assertChatLogParity(g, [...canoeRollPlayerNames]);
    });
});
