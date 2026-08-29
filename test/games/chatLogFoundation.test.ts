import "mocha";
import { expect } from "chai";
import { addResource } from "../../src";
import { assertChatLogParity } from "../fixtures/chat/helpers";
import {
    ChatCollectFake,
    chatCollectFakeFrames,
    chatCollectFakePlayerNames,
} from "../fixtures/chat/collectFake";

describe("Structured chat foundation (Phase 0)", () => {
    before(() => {
        addResource("en");
    });

    it("collectChatLogLine handles standard pass results", () => {
        const g = new ChatCollectFake([[{ type: "pass" }]]);
        const lines: import("../../src/common/chat-log").ChatLogLine[] = [];
        const ctx = {
            results: [{ type: "pass" } as import("../../src/schemas/moveresults").APMoveResult],
            currplayer: 2,
            defaultSeat: 1,
            players: chatCollectFakePlayerNames,
        };
        expect(g.collectChatLogLine(lines, { type: "pass" }, ctx)).to.equal(true);
        expect(lines).to.have.length(1);
        expect(lines[0]!.textKey).to.equal("apresults:PASS.simple");
    });

    it("chatLogEntries parity with chatLog for default collector frames", () => {
        const g = new ChatCollectFake(chatCollectFakeFrames, { scores: [3, 7] });
        assertChatLogParity(g, chatCollectFakePlayerNames);
    });

    it("chatLogEntries emits seat actors with Player N tokens", () => {
        const g = new ChatCollectFake([[{ type: "move", from: "a1", to: "b2" }]]);
        const lines = g.chatLogEntries(chatCollectFakePlayerNames).flatMap((e) => e.lines);
        expect(lines).to.have.length(1);
        expect(lines[0]!.actor).to.deep.equal({ kind: "seat", seat: 1 });
        expect(lines[0]!.textKey).to.equal("apresults:MOVE.nowhat");
        expect(lines[0]!.textParams?.player).to.equal("Player 1");
    });

    it("resolveChatSeat wraps currplayer like legacy chatLog", () => {
        const g = new ChatCollectFake([]);
        expect(g.resolveChatSeat({ type: "pass" }, 1)).to.equal(2);
        expect(g.resolveChatSeat({ type: "pass" }, 2)).to.equal(1);
    });
});
