import "mocha";
import { expect } from "chai";
import i18next from "i18next";
import { addResource } from "../../src";
import { BukuGame } from "../../src/games/buku";
import { formatChatLogLine } from "../../src/common/chat-log";
import { chatCollectFakePlayerNames } from "../fixtures/chat/collectFake";

describe("Buku", () => {
    before(() => {
        addResource("en");
    });

    const t = (key: string, params?: Record<string, unknown>) => i18next.t(key, params);

    it("collectChatLogLine uses plural stems that resolve in i18n", () => {
        const g = new BukuGame();
        const lines: import("../../src/common/chat-log").ChatLogLine[] = [];
        const ctx = {
            results: [],
            currplayer: 1 as const,
            defaultSeat: 1,
            players: chatCollectFakePlayerNames,
        };
        expect(
            g.collectChatLogLine(lines, { type: "take", from: "3", count: 2, how: "row" }, ctx),
        ).to.equal(true);
        expect(lines[0]!.textKey).to.equal("apresults:buku.TAKE.row");
        const body = formatChatLogLine(lines[0]!, chatCollectFakePlayerNames, t);
        expect(body).to.include("collected");
        expect(body).to.not.equal("apresults:buku.TAKE.row");
        expect(body).to.not.include("buku.TAKE");

        lines.length = 0;
        expect(
            g.collectChatLogLine(lines, { type: "take", from: "b", count: 1, how: "col" }, ctx),
        ).to.equal(true);
        expect(lines[0]!.textKey).to.equal("apresults:buku.TAKE.col");

        lines.length = 0;
        expect(
            g.collectChatLogLine(
                lines,
                { type: "claim", count: 3, how: "singletons" } as import("../../src/schemas/moveresults").APMoveResult,
                ctx,
            ),
        ).to.equal(true);
        expect(lines[0]!.textKey).to.equal("apresults:buku.CLAIM.singletons");
        expect(formatChatLogLine(lines[0]!, chatCollectFakePlayerNames, t)).to.include("claimed");

        lines.length = 0;
        expect(
            g.collectChatLogLine(
                lines,
                { type: "claim", count: 5, how: "repetition" } as import("../../src/schemas/moveresults").APMoveResult,
                ctx,
            ),
        ).to.equal(true);
        expect(lines[0]!.textKey).to.equal("apresults:buku.CLAIM.repetition");
    });
});