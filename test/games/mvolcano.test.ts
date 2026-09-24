/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { MvolcanoGame, CellContents } from "../../src/games/mvolcano";
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

describe("Mega-Volcano", () => {
    describe("sidebarScores", () => {
        it("lists every colour as uncaptured and no pyramids captured at the start", () => {
            const scores = new MvolcanoGame().sidebarScores();
            expect(scores).to.have.lengthOf(3);
            expect(findScores(scores, "apgames:status.SCORES").spoiler).to.not.equal(true);

            const uncaptured = findScores(scores, "apgames:status.mvolcano.UNCAPTUREDCOLOURS");
            expect(uncaptured.spoiler).to.be.true;
            expect(colours(uncaptured.scores[0])).to.deep.equal([1, 2, 3, 4, 5, 6, 7]);
            expect(colours(uncaptured.scores[1])).to.deep.equal([1, 2, 3, 4, 5, 6, 7]);

            const captured = findScores(scores, "apgames:status.mvolcano.PYRAMIDSCAPTURED");
            expect(captured.spoiler).to.be.true;
            expect(captured.scores).to.deep.equal([0, 0]);
        });

        it("drops captured colours in palette order and counts white pyramids", () => {
            const g = new MvolcanoGame();
            g.captured = [
                [["RD", 1], ["WH", 2], ["GN", 3], ["RD", 2]] as CellContents[],
                [["BN", 1]] as CellContents[],
            ];
            const scores = g.sidebarScores();

            const uncaptured = findScores(scores, "apgames:status.mvolcano.UNCAPTUREDCOLOURS");
            expect(colours(uncaptured.scores[0])).to.deep.equal([2, 4, 5, 6, 7]);
            expect(colours(uncaptured.scores[1])).to.deep.equal([1, 2, 3, 4, 5, 6]);

            const captured = findScores(scores, "apgames:status.mvolcano.PYRAMIDSCAPTURED");
            expect(captured.scores).to.deep.equal([4, 1]);
        });
    });
});
