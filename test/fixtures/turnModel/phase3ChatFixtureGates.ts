import type { GameBase } from "../../../src/games/_base";
import {
    gameFromTurnModelFixture,
    lielowHasCrossPlayerPromote,
    loadTurnModelFixture,
    loadTurnModelManifest,
    turnModelFixturesAvailable,
} from "./helpers";

export type Phase3FixtureGate = {
    metaGame: string;
    subtypes: string[];
    verify: (game: GameBase) => boolean;
    scenario: string;
};

export type Phase3FixtureGateFailure = {
    metaGame: string;
    reason: string;
};

function stackResultsIncludeType(game: GameBase, type: string): boolean {
    return game.stack.some(
        (state) => state._results !== undefined && state._results.some((r) => r.type === type),
    );
}

function defaultSeatForFrame(currplayer: number, numplayers: number): number {
    let seat = currplayer - 1;
    if (seat < 1) {
        seat = numplayers;
    }
    return seat;
}

/** Byte partial move (`count` on move) or per-{@link who} `deltaScore`. */
export function byteHasPartialMoveOrDeltaScore(game: GameBase): boolean {
    if (stackResultsIncludeType(game, "deltaScore")) {
        return true;
    }
    return game.stack.some(
        (state) =>
            state._results !== undefined
            && state._results.some(
                (r) => r.type === "move" && (r as { count?: number }).count !== undefined,
            ),
    );
}

/** Upper Hand chain placement (`what: chain` with per-result `who`). */
export function upperhandHasChainPlace(game: GameBase): boolean {
    return game.stack.some(
        (state) =>
            state._results !== undefined
            && state._results.some(
                (r) =>
                    r.type === "place"
                    && (r as { what?: string }).what === "chain"
                    && (r as { who?: number }).who !== undefined,
            ),
    );
}

/** Tumbleweed self-capture: `whose` matches legacy default seat (currplayer - 1, wrapped). */
export function tumbleweedHasSelfCapture(game: GameBase): boolean {
    return game.stack.some((state) => {
        if (state._results === undefined) {
            return false;
        }
        const defaultSeat = defaultSeatForFrame(state.currplayer as number, game.numplayers);
        return state._results.some(
            (r) =>
                r.type === "capture"
                && (r as { whose?: number }).whose === defaultSeat,
        );
    });
}

/** Veletas claim credited to non-{@link currplayer} (`who` on claim). */
export function veletasHasCrossPlayerClaim(game: GameBase): boolean {
    return game.stack.some(
        (state) =>
            state._results !== undefined
            && state._results.some(
                (r) =>
                    r.type === "claim"
                    && (r as { who?: number }).who !== undefined
                    && (r as { who?: number }).who !== state.currplayer,
            ),
    );
}

/** Buku claim where `who` differs from frame {@link currplayer}. */
export function bukuHasCrossPlayerClaim(game: GameBase): boolean {
    return game.stack.some(
        (state) =>
            state._results !== undefined
            && state._results.some(
                (r) =>
                    r.type === "claim"
                    && (r as { who?: number }).who !== undefined
                    && (r as { who?: number }).who !== state.currplayer,
            ),
    );
}

export function bukuHasRepetitionClaim(game: GameBase): boolean {
    return game.stack.some(
        (state) =>
            state._results !== undefined
            && state._results.some(
                (r) =>
                    r.type === "claim"
                    && (r as { how?: string }).how === "repetition",
            ),
    );
}

export function magnateHasRollAndClaim(game: GameBase): boolean {
    return stackResultsIncludeType(game, "roll") && stackResultsIncludeType(game, "claim");
}

export function magnateHasEconomyVocabulary(game: GameBase): boolean {
    const types = new Set<string>();
    for (const state of game.stack) {
        for (const r of state._results ?? []) {
            types.add(r.type);
        }
    }
    return types.has("roll") && types.has("claim") && types.has("capture");
}

/** Phase 3 Tier A — attribution overrides migrated Aug 28. */
export const PHASE3_CHAT_FIXTURE_GATES: Phase3FixtureGate[] = [
    {
        metaGame: "byte",
        subtypes: ["byteBaseline"],
        scenario: "partial move or per-who deltaScore",
        verify: byteHasPartialMoveOrDeltaScore,
    },
    {
        metaGame: "lielow",
        subtypes: ["normal"],
        scenario: "tier-1 completed game (general chat golden)",
        verify: (g) => g.stack.some((s) => (s._results?.length ?? 0) > 0),
    },
    {
        metaGame: "lielow",
        subtypes: ["lielowPromoteSwap"],
        scenario: "promote credited when r.player !== currplayer",
        verify: lielowHasCrossPlayerPromote,
    },
    {
        metaGame: "upperhand",
        subtypes: ["upperhandBaseline"],
        scenario: "chain placement (what=chain, r.who attribution)",
        verify: upperhandHasChainPlace,
    },
    {
        metaGame: "tumbleweed",
        subtypes: ["tumbleweedBaseline"],
        scenario: "self-capture (whose === default seat)",
        verify: tumbleweedHasSelfCapture,
    },
    {
        metaGame: "veletas",
        subtypes: ["veletasBaseline"],
        scenario: "claim by non-active player (who !== currplayer)",
        verify: veletasHasCrossPlayerClaim,
    },
    {
        metaGame: "buku",
        subtypes: ["bukuBaseline"],
        scenario: "claim with who !== currplayer",
        verify: bukuHasCrossPlayerClaim,
    },
    {
        metaGame: "buku",
        subtypes: ["bukuRepetition"],
        scenario: "EOG repetition claim (how=repetition)",
        verify: bukuHasRepetitionClaim,
    },
    {
        metaGame: "magnate",
        subtypes: ["magnateBaseline"],
        scenario: "roll and claim in chat log",
        verify: magnateHasRollAndClaim,
    },
    {
        metaGame: "magnate",
        subtypes: ["magnateEconomy"],
        scenario: "roll, claim, and capture (economy depth)",
        verify: magnateHasEconomyVocabulary,
    },
];

export function verifyPhase3ChatFixtureGates(): Phase3FixtureGateFailure[] {
    const failures: Phase3FixtureGateFailure[] = [];
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

    for (const gate of PHASE3_CHAT_FIXTURE_GATES) {
        for (const subtype of gate.subtypes) {
            const entry = manifest.fixtures.find(
                (f) => f.metaGame === gate.metaGame && f.subtype === subtype,
            );
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
