/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { addResource } from "../../src";
import i18next from "i18next";
import { ACityGame } from "../../src/games/acity";
import { liveBeforeH10Claim } from "../fixtures/acity-live-before-h10claim";
import type { ChatLogLine } from "../../src/games/_base";

function msg(key: string): string {
    return i18next.t(`apgames:validation.acity.${key}`);
}

describe("Alien City live game 6c4d9521 (RT-h10 g6 claim)", () => {
    before(() => {
        addResource("en");
    });

    it("phase-6 validation rejects RT-h10(g6) — no legal placements remain after that move", () => {
        const g = new ACityGame(liveBeforeH10Claim);
        expect(g.currplayer).to.equal(2);
        expect(g.validateMove("RT-h10").valid).to.be.true;
        const r = g.validateMove("RT-h10(g6)");
        expect(r.valid).to.be.false;
        expect(r.message).to.equal(msg("CLAIM_ENDS_GAME"));
    });

    it("emits a chat line for nullifyClaim on end of game", () => {
        const g = new ACityGame(liveBeforeH10Claim);
        const lines: ChatLogLine[] = [];
        const sampleResults = [
            { type: "pass" as const },
            { type: "nullifyClaim" as const, where: "g6" },
        ];
        for (const r of sampleResults) {
            g.collectChatLogLine(lines, r, {
                results: sampleResults,
                currplayer: 1,
                defaultSeat: 1,
                players: ["P1", "P2"],
            });
        }
        expect(lines.some((l) => l.textKey === "apresults:_general.NULLIFY_CLAIM.default")).to.be.true;
        expect(
            i18next.t("apresults:_general.NULLIFY_CLAIM.default", { where: "g6" })
        ).to.include("nullified");
    });
});
