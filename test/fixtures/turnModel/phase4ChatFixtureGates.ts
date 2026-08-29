import type { GameBase } from "../../../src/games/_base";
import {
    gameFromTurnModelFixture,
    loadTurnModelFixture,
    loadTurnModelManifest,
    turnModelFixturesAvailable,
} from "./helpers";

export type Phase4FixtureGate = {
    metaGame: string;
    /** At least one manifest entry must match each subtype (or any if empty). */
    subtypes: string[];
    verify: (game: GameBase) => boolean;
    scenario: string;
};

function stackResultsIncludeType(game: GameBase, type: string): boolean {
    return game.stack.some(
        (state) => state._results !== undefined && state._results.some((r) => r.type === type),
    );
}

function stackFrameHasMinResultType(game: GameBase, type: string, min: number): boolean {
    return game.stack.some((state) => {
        if (state._results === undefined) {
            return false;
        }
        return state._results.filter((r) => r.type === type).length >= min;
    });
}

function stackResultsIncludeWhoZero(game: GameBase): boolean {
    return game.stack.some(
        (state) =>
            state._results !== undefined
            && state._results.some((r) => (r as { who?: number }).who === 0),
    );
}

function simultaneousPullFrame(game: GameBase): boolean {
    return game.stack.some(
        (state) =>
            state._results !== undefined
            && state._results.length >= 2
            && state._results[0]?.type === "pull"
            && state._results[1]?.type === "pull",
    );
}

function entropySimultaneousPlace(game: GameBase): boolean {
    return game.stack.some(
        (state) =>
            state._results !== undefined
            && state._results.length >= 2
            && state._results.every((r) => r.type === "place" || r.type === "pass"),
    );
}

/** Phase 4 Tier B + C — chat-log override games and required scenario shapes. */
export const PHASE4_CHAT_FIXTURE_GATES: Phase4FixtureGate[] = [
    {
        metaGame: "strings",
        subtypes: ["stringsBaseline"],
        scenario: "simultaneous pull (two results per frame)",
        verify: (g) => stackResultsIncludeType(g, "pull") && simultaneousPullFrame(g),
    },
    {
        metaGame: "entropy",
        subtypes: ["entropyBaseline"],
        scenario: "simultaneous 2p place/pass frame",
        verify: entropySimultaneousPlace,
    },
    {
        metaGame: "fnap",
        subtypes: ["fnapBaseline"],
        scenario: "select or claim result",
        verify: (g) => stackResultsIncludeType(g, "select") || stackResultsIncludeType(g, "claim"),
    },
    {
        metaGame: "frames",
        subtypes: ["framesBaseline"],
        scenario: "neutral who=0 or per-who deltaScore",
        verify: (g) => stackResultsIncludeWhoZero(g) || stackResultsIncludeType(g, "deltaScore"),
    },
    {
        metaGame: "volcano",
        subtypes: ["volcanoBaseline"],
        scenario: "eject or multi-move aggregation",
        verify: (g) =>
            stackResultsIncludeType(g, "eject")
            || stackFrameHasMinResultType(g, "move", 2),
    },
    {
        metaGame: "mvolcano",
        subtypes: ["mvolcanoBaseline"],
        scenario: "eject or multi-move aggregation",
        verify: (g) =>
            stackResultsIncludeType(g, "eject")
            || stackFrameHasMinResultType(g, "move", 2),
    },
    {
        metaGame: "fanorona",
        subtypes: ["fanoronaBaseline"],
        scenario: "multiple moves in one frame",
        verify: (g) => stackFrameHasMinResultType(g, "move", 2),
    },
    {
        metaGame: "epam",
        subtypes: ["epamBaseline"],
        scenario: "batched capture (2+ captures in one frame)",
        verify: (g) => stackFrameHasMinResultType(g, "capture", 2),
    },
    {
        metaGame: "breakthrough",
        subtypes: ["breakthroughBaseline"],
        scenario: "completed 2p game with chat golden",
        verify: (g) => g.stack.some((s) => (s._results?.length ?? 0) > 0),
    },
    {
        metaGame: "breakthrough",
        subtypes: ["breakthroughDetonate"],
        scenario: "detonate result",
        verify: (g) => stackResultsIncludeType(g, "detonate"),
    },
    {
        metaGame: "fendo",
        subtypes: ["fendoBaseline"],
        scenario: "multi-hop move (2+ moves in one frame)",
        verify: (g) => stackFrameHasMinResultType(g, "move", 2),
    },
    {
        metaGame: "focus",
        subtypes: ["focusBaseline"],
        scenario: "multi-capture or reclaim",
        verify: (g) =>
            stackFrameHasMinResultType(g, "capture", 2)
            || stackResultsIncludeType(g, "reclaim"),
    },
    {
        metaGame: "chase",
        subtypes: ["chaseBaseline"],
        scenario: "multi-segment move (2+ moves in one frame)",
        verify: (g) => stackFrameHasMinResultType(g, "move", 2),
    },
];

export type Phase4FixtureGateFailure = {
    metaGame: string;
    reason: string;
};

export function verifyPhase4ChatFixtureGates(): Phase4FixtureGateFailure[] {
    const failures: Phase4FixtureGateFailure[] = [];
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

    for (const gate of PHASE4_CHAT_FIXTURE_GATES) {
        const entries = manifest.fixtures.filter((f) => f.metaGame === gate.metaGame);
        if (entries.length === 0) {
            failures.push({
                metaGame: gate.metaGame,
                reason: `no manifest entry — fetch chat/pattern fixture for ${gate.scenario}`,
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
