/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { addResource } from "../../src";
import { assertChatLogParity } from "../fixtures/chat/helpers";
import {
    buildCanoeEndOfTurnRollGame,
    buildCanoeStymieRollGame,
    canoeRollPlayerNames,
} from "../fixtures/chat/canoeRollAttribution";
import {
    buildElOsoAfterBearMoveGame,
    buildElOsoSetupGame,
    elOsoSoloPlayerNames,
} from "../fixtures/chat/elOsoSoloAttribution";
import { lielowHasCrossPlayerPromote } from "../fixtures/chat/lielowPromoteAttribution";
import {
    buildHomeworldsPassResignGame,
    homeworldsHasPassResult,
    homeworldsHasResignResult,
    homeworldsPassResignPlayerNames,
} from "../fixtures/chat/homeworldsPassResign";
import {
    gameFromTurnModelFixture,
    loadTurnModelFixture,
    loadTurnModelManifest,
    turnModelFixturesAvailable,
} from "../fixtures/turnModel/helpers";

describe("chat log scenario fixtures (inline)", () => {
    before(() => {
        addResource("en");
    });

    describe("Canoe roll attribution", () => {
        it("attributes end-of-turn roll to upcoming player", () => {
            const g = buildCanoeEndOfTurnRollGame();
            const log = g.chatLog([...canoeRollPlayerNames]);
            const rollLine = log[log.length - 1]!.find((line) => line.includes("rolled"));
            expect(rollLine).to.include("Bob");
            expect(rollLine).to.not.include("Alice");
        });

        it("attributes stymie roll to active player", () => {
            const g = buildCanoeStymieRollGame();
            const log = g.chatLog([...canoeRollPlayerNames]);
            const rollLine = log[log.length - 1]!.find((line) => line.includes("rolled"));
            expect(rollLine).to.include("Alice");
        });
    });

    describe("El Oso solo attribution", () => {
        it("setup chat log includes grouped rolls", () => {
            const g = buildElOsoSetupGame();
            const lines = g.chatLog([...elOsoSoloPlayerNames]).flat();
            expect(lines.filter((l) => /rolled/i.test(l)).length).to.equal(2);
        });

        it("chatLogEntries parity with chatLog", () => {
            const g = buildElOsoAfterBearMoveGame();
            assertChatLogParity(g, [...elOsoSoloPlayerNames]);
        });

        it("bear moves use label actor, not seat 2", () => {
            const g = buildElOsoAfterBearMoveGame();
            const lines = g.chatLogEntries([...elOsoSoloPlayerNames]).flatMap((e) => e.lines);
            const bearLines = lines.filter((l) => l.actor.kind === "label");
            const seat2Lines = lines.filter((l) => l.actor.kind === "seat" && l.actor.seat === 2);
            expect(bearLines.length).to.be.greaterThan(0);
            expect(seat2Lines.length).to.equal(0);
        });
    });

    describe("Homeworlds pass + resign", () => {
        it("synthetic fixture has pass and resigned results with chat parity", () => {
            const g = buildHomeworldsPassResignGame();
            const playerNames = [...homeworldsPassResignPlayerNames];
            expect(homeworldsHasPassResult(g)).to.be.true;
            expect(homeworldsHasResignResult(g)).to.be.true;
            assertChatLogParity(g, playerNames);
            const log = g.chatLog(playerNames).flat();
            expect(log.some((line) => /passed an action/i.test(line))).to.be.true;
            expect(log.some((line) => /resign/i.test(line))).to.be.true;
            expect(log.some((line) => /\(N\)/.test(line))).to.be.true;
        });
    });

    if (turnModelFixturesAvailable()) {
        describe("Lielow cross-player promote (DB fixture when present)", () => {
            it("lielowPromoteSwap fixture has cross-player promote in stack", () => {
                const manifest = loadTurnModelManifest();
                const entry = manifest?.fixtures.find((f) => f.subtype === "lielowPromoteSwap");
                if (entry === undefined) {
                    return;
                }
                const fixture = loadTurnModelFixture(entry.id);
                if (fixture === undefined) {
                    throw new Error(`Missing fixture file for ${entry.id}`);
                }
                const g = gameFromTurnModelFixture(fixture);
                expect(lielowHasCrossPlayerPromote(g)).to.be.true;
                const playerNames = fixture.publishedRecord.header.players.map((p) => p.name);
                assertChatLogParity(g, playerNames);
                const log = g.chatLog(playerNames).flat();
                expect(log.some((line) => /promot|king/i.test(line))).to.be.true;
            });
        });
    }
});
