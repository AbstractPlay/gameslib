/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { TintasGame } from "../../src/games/tintas";
import type { IScores } from "../../src/games/_base";
import { isStructuredRenderLabel } from "../../src/common/render-label";

function findScores(scores: IScores[], key: string): IScores {
    const found = scores.find((s) => isStructuredRenderLabel(s.name) && s.name.textKey === key);
    expect(found, key).to.not.be.undefined;
    return found!;
}

function colours(entry: unknown): number[] {
    expect(entry).to.be.an("array");
    return (entry as { glyph: string, colour: number }[]).map((v) => {
        expect(v.glyph).to.equal("piece");
        return v.colour;
    });
}

describe("Tintas", () => {
    describe("sidebarScores", () => {
        it("lists every colour as monochrome potential and no majorities at the start", () => {
            const scores = new TintasGame().sidebarScores();
            expect(scores).to.have.lengthOf(2);

            const monochrome = findScores(scores, "apgames:status.tintas.MONOCHROME");
            expect(monochrome.spoiler).to.be.true;
            expect(colours(monochrome.scores[0])).to.deep.equal([1, 2, 3, 4, 5, 6, 7]);
            expect(colours(monochrome.scores[1])).to.deep.equal([1, 2, 3, 4, 5, 6, 7]);

            const majorities = findScores(scores, "apgames:status.tintas.MAJORITIES");
            expect(majorities.spoiler).to.be.true;
            expect(colours(majorities.scores[0])).to.deep.equal([]);
            expect(colours(majorities.scores[1])).to.deep.equal([]);
        });

        it("keeps a colour as monochrome potential only while the opponent has none of it", () => {
            const g = new TintasGame();
            g.captured = [[1, 1, 1, 1, 2, 3], [5, 2, 5, 5, 5]];
            const scores = g.sidebarScores();

            const monochrome = findScores(scores, "apgames:status.tintas.MONOCHROME");
            expect(colours(monochrome.scores[0])).to.deep.equal([1, 3, 4, 6, 7]);
            expect(colours(monochrome.scores[1])).to.deep.equal([4, 5, 6, 7]);

            const majorities = findScores(scores, "apgames:status.tintas.MAJORITIES");
            expect(colours(majorities.scores[0])).to.deep.equal([1]);
            expect(colours(majorities.scores[1])).to.deep.equal([5]);
        });
    });
});
