import "mocha";
import { expect } from "chai";
import { addResource } from "../../src";
import type { IGameRound } from "../../src/games/_turn-model";
import {
    gameFromTurnModelFixture,
    compactTrailingNullRounds,
    genRecordGoldenSupported,
    getMoveListFromGame,
    getRoundsRecordExportSupported,
    loadTurnModelFixture,
    loadTurnModelManifest,
    normalizeGameState,
    normalizeRecordHeaderForGolden,
    normalizeSerializedState,
    plyOrderedMovesFromRounds,
    recordDetailsFromFixture,
    reviveFixtureState,
    roundMoveStrings,
    turnModelFixturesAvailable,
} from "../fixtures/turnModel/helpers";
import {
    buildSoloSequentialFake,
    soloSequentialMoveHistoryGolden,
    soloSequentialPlayerNames,
} from "../fixtures/turnModel/soloSequential";

describe("Turn model golden (Phase 0)", () => {
    before(() => {
        addResource("en");
    });

    describe("solo sequential (inline)", () => {
        it("getPlies and export move strings align at numplayers === 1", () => {
            const g = buildSoloSequentialFake();
            expect(g.getPlies().map((p) => p.move)).to.deep.equal(
                soloSequentialMoveHistoryGolden.map((row) => row[0]),
            );
            expect(plyOrderedMovesFromRounds(g.getRounds())).to.deep.equal(
                g.getPlies().map((p) => p.move),
            );
            expect(roundMoveStrings(compactTrailingNullRounds(g.getRounds()))).to.deep.equal(
                soloSequentialMoveHistoryGolden,
            );
        });

        it("moveHistory groups one ply per round at numplayers === 1", () => {
            const g = buildSoloSequentialFake();
            expect(g.moveHistory()).to.deep.equal(soloSequentialMoveHistoryGolden);
        });

        it("serialize round-trip preserves normalized state", () => {
            const g = buildSoloSequentialFake();
            const before = normalizeGameState(g.state());
            const again = normalizeSerializedState(g.serialize());
            expect(again).to.deep.equal(before);
        });

        it("chatLog is stable for fixture player names", () => {
            const g = buildSoloSequentialFake();
            const log = g.chatLog(soloSequentialPlayerNames);
            expect(log).to.deep.equal(g.chatLog(soloSequentialPlayerNames));
        });
    });

    if (!turnModelFixturesAvailable()) {
        it("local DB fixtures skipped — run npm run fetch-turnModel-fixtures", () => {
            // CI and fresh clones pass without gitignored fixture blobs.
        });
        return;
    }

    const manifest = loadTurnModelManifest();
    if (manifest === undefined || manifest.fixtures.length === 0) {
        it("manifest empty — run npm run fetch-turnModel-fixtures", () => {});
        return;
    }

    for (const entry of manifest.fixtures) {
        describe(`${entry.category} ${entry.displayName} (${entry.metaGame}) ${entry.subtype}`, () => {
            const fixture = loadTurnModelFixture(entry.id);
            if (fixture === undefined) {
                it(`missing fixture file ${entry.id}`, () => {
                    throw new Error(`Expected ${entry.id}.json beside manifest.json`);
                });
                return;
            }

            const playerNames = fixture.publishedRecord.header.players.map((p) => p.name);

            it("moveHistory matches golden baseline", () => {
                const g = gameFromTurnModelFixture(fixture);
                expect(g.moveHistory()).to.deep.equal(fixture.golden.moveHistory);
            });

            if (genRecordGoldenSupported(entry.metaGame)) {
                it("genRecord matches published record (header exact; move strings only)", () => {
                    const revived = reviveFixtureState(fixture.state);
                    const g = gameFromTurnModelFixture({ ...fixture, state: revived });
                    const rec = g.genRecord(recordDetailsFromFixture(fixture));
                    expect(rec).to.not.equal(undefined);
                    expect(normalizeRecordHeaderForGolden(rec!.header)).to.deep.equal(
                        normalizeRecordHeaderForGolden(fixture.publishedRecord.header),
                    );
                    if (getRoundsRecordExportSupported(entry.metaGame, entry.numplayers)) {
                        expect(roundMoveStrings(rec!.moves as IGameRound[])).to.deep.equal(
                            roundMoveStrings(fixture.golden.genRecordMoves as IGameRound[]),
                        );
                        const roundsForExport = g.turnModel() === "sequential"
                            ? compactTrailingNullRounds(g.getRounds())
                            : g.getRounds();
                        expect(roundMoveStrings(getMoveListFromGame(g) as IGameRound[])).to.deep.equal(
                            roundMoveStrings(roundsForExport),
                        );
                        expect(plyOrderedMovesFromRounds(g.getRounds())).to.deep.equal(
                            g.getPlies().map((p) => p.move),
                        );
                    }
                });
            }

            it("chatLog matches golden baseline", () => {
                const g = gameFromTurnModelFixture(fixture);
                expect(g.chatLog(playerNames)).to.deep.equal(fixture.golden.chatLog);
            });

            it("state() matches golden normalized snapshot", () => {
                const g = gameFromTurnModelFixture(fixture);
                expect(normalizeGameState(g.state())).to.deep.equal(fixture.golden.stateNormalized);
            });

            it("serialize round-trip matches normalized state", () => {
                const g = gameFromTurnModelFixture(fixture);
                const fromState = normalizeGameState(g.state());
                const roundTrip = normalizeSerializedState(g.serialize());
                expect(roundTrip).to.deep.equal(fromState);
            });
        });
    }
});
