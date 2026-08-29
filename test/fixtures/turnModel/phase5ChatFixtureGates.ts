import type { GameBase } from "../../../src/games/_base";
import {
    gameFromTurnModelFixture,
    loadTurnModelFixture,
    loadTurnModelManifest,
    turnModelFixturesAvailable,
} from "./helpers";

export type Phase5FixtureGate = {
    metaGame: string;
    subtypes: string[];
    verify: (game: GameBase) => boolean;
    scenario: string;
    /** Result types not required in fixture (handled by collector + super; no prod golden). */
    uncoveredNote?: string;
};

function stackResultsIncludeType(game: GameBase, type: string): boolean {
    return game.stack.some(
        (state) => state._results !== undefined && state._results.some((r) => r.type === type),
    );
}

function stackHasGroupWithNested(game: GameBase, nestedType: string): boolean {
    return game.stack.some(
        (state) =>
            state._results !== undefined
            && state._results.some(
                (r) =>
                    r.type === "_group"
                    && (r as { results: { type: string }[] }).results.some((n) => n.type === nestedType),
            ),
    );
}

/** Phase 5 — pigs/pigs2 `_group` + homeworlds seat-suffix vocabulary. */
export const PHASE5_CHAT_FIXTURE_GATES: Phase5FixtureGate[] = [
    {
        metaGame: "homeworlds",
        subtypes: ["homeworlds3pElimination"],
        scenario: "3p elimination with homeworld/discover/move/place/convert/capture/sacrifice/catastrophe",
        verify: (g) =>
            g.numplayers >= 3
            && stackResultsIncludeType(g, "homeworld")
            && stackResultsIncludeType(g, "move")
            && stackResultsIncludeType(g, "catastrophe"),
        uncoveredNote: "pass/resigned covered by test/fixtures/chat/homeworldsPassResignState.json (inline CI fixture)",
    },
    {
        metaGame: "pigs",
        subtypes: ["pigs4pElimination"],
        scenario: "4p `_group` elimination (move, fire, damage, eliminated)",
        verify: (g) =>
            g.numplayers >= 4
            && stackHasGroupWithNested(g, "move")
            && stackHasGroupWithNested(g, "eliminated"),
    },
    {
        metaGame: "pigs2",
        subtypes: ["pigs2Elimination"],
        scenario: "elimination `_group` (move, fire, damage, eliminated)",
        verify: (g) =>
            stackHasGroupWithNested(g, "move")
            && stackHasGroupWithNested(g, "eliminated"),
        uncoveredNote: "nested resign/timeout/abandoned not in prod fixture; implemented from legacy chatLog",
    },
];

export type Phase5FixtureGateFailure = {
    metaGame: string;
    reason: string;
};

export function verifyPhase5ChatFixtureGates(): Phase5FixtureGateFailure[] {
    const failures: Phase5FixtureGateFailure[] = [];
    if (!turnModelFixturesAvailable()) {
        failures.push({
            metaGame: "*",
            reason: "fixtures-local missing — run npm run fetch-turnModel-fixtures",
        });
        return failures;
    }
    const manifest = loadTurnModelManifest();
    if (manifest === undefined || manifest.fixtures.length === 0) {
        failures.push({ metaGame: "*", reason: "manifest.json empty" });
        return failures;
    }

    for (const gate of PHASE5_CHAT_FIXTURE_GATES) {
        const entries = manifest.fixtures.filter((f) => f.metaGame === gate.metaGame);
        if (entries.length === 0) {
            failures.push({
                metaGame: gate.metaGame,
                reason: `no manifest entry — fetch pattern fixture for ${gate.scenario}`,
            });
            continue;
        }

        for (const subtype of gate.subtypes) {
            const entry = entries.find((e) => e.subtype === subtype);
            if (entry === undefined) {
                failures.push({
                    metaGame: gate.metaGame,
                    reason: `missing subtype ${subtype} — need fixture for ${gate.scenario}`,
                });
                continue;
            }
            const fixture = loadTurnModelFixture(entry.id);
            if (fixture === undefined) {
                failures.push({
                    metaGame: gate.metaGame,
                    reason: `missing file ${entry.id}.json`,
                });
                continue;
            }
            if (fixture.golden.chatLog.length === 0) {
                failures.push({
                    metaGame: gate.metaGame,
                    reason: `${entry.id}: golden.chatLog empty — run npm run refresh-chat-golden`,
                });
            }
            if (fixture.golden.chatLogEntries.length === 0) {
                failures.push({
                    metaGame: gate.metaGame,
                    reason: `${entry.id}: golden.chatLogEntries empty — run npm run refresh-chat-golden-entries`,
                });
            }
            const game = gameFromTurnModelFixture(fixture);
            if (!gate.verify(game)) {
                failures.push({
                    metaGame: gate.metaGame,
                    reason: `${entry.id} (${subtype}) does not satisfy scenario: ${gate.scenario}`,
                });
            }
        }
    }

    return failures;
}
