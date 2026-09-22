/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { LielowGame } from "../../src/games/lielow";
import { isStructuredRenderLabel } from "../../src/common/render-label";

function textKey(label: unknown): string | undefined {
    return isStructuredRenderLabel(label) ? label.textKey : undefined;
}

describe("Lielow", () => {
    describe("sidebarScores", () => {
        it("marks moves until suicide as a spoiler but leaves pieces remaining visible", () => {
            const g = new LielowGame();
            const scores = g.sidebarScores();
            expect(scores).to.have.lengthOf(2);

            const pieces = scores.find((s) => textKey(s.name) === "apgames:status.PIECESREMAINING");
            expect(pieces).to.not.be.undefined;
            expect(pieces!.spoiler).to.not.equal(true);

            const suicide = scores.find((s) => textKey(s.name) === "apgames:status.lielow.MOVESUNTILSUICIDE");
            expect(suicide).to.not.be.undefined;
            expect(suicide!.spoiler).to.be.true;
        });
    });
});
