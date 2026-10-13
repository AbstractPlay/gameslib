import "mocha";
import { expect } from "chai";
import { addResource } from "../../src";
import type { IGameRound } from "../../src/games/_turn-model";
import {
    buildSoloSequentialFake,
    soloSequentialMoveHistoryGolden,
    soloSequentialPlayerNames,
} from "../fixtures/turnModel/soloSequential";
import {
    compactTrailingNullRounds,
    getMoveListFromGame,
    normalizeChatLogLineForGolden,
    normalizeGameState,
    normalizeSerializedState,
    plyOrderedMovesFromRounds,
    roundMoveStrings,
} from "../fixtures/turnModel/helpers";

describe("Turn model helpers (inline)", () => {
    before(() => {
        addResource("en");
    });

    describe("chatLog golden normalization", () => {
        it("maps legacy optional (s) plurals to count-based forms", () => {
            expect(normalizeChatLogLineForGolden(
                "mcd2 chose to refill the draw pool.  He gets another turn to take his 1 remaining move(s).",
            )).to.equal(
                "mcd2 chose to refill the draw pool. He gets another turn to take his 1 remaining move.",
            );
            expect(normalizeChatLogLineForGolden(
                "mcd3 chose to refill the draw pool. He gets another turn to take his 2 remaining move(s).",
            )).to.equal(
                "mcd3 chose to refill the draw pool. He gets another turn to take his 2 remaining moves.",
            );
            expect(normalizeChatLogLineForGolden(
                "Alice added 3 token(s) to their deeded card c1.",
            )).to.equal(
                "Alice added 3 tokens to their deeded card c1.",
            );
        });

        it("leaves already-pluralized lines unchanged", () => {
            const line = "mcd1 chose to refill the draw pool. He gets another turn to take his 2 remaining moves.";
            expect(normalizeChatLogLineForGolden(line)).to.equal(line);
        });
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

        it("getRounds export shape matches solo fake turn model", () => {
            const g = buildSoloSequentialFake();
            const roundsForExport = compactTrailingNullRounds(g.getRounds());
            expect(roundMoveStrings(getMoveListFromGame(g) as IGameRound[])).to.deep.equal(
                roundMoveStrings(roundsForExport),
            );
        });
    });
});
