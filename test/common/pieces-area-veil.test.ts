/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import type { AreaPieces } from "@abstractplay/renderer/build/schemas/schema";
import { ACityGame } from "../../src/games/acity";
import { FourGame } from "../../src/games/four";
import { resolveRenderLabels } from "../../src/common/render-label";

function piecesStashAreas(rep: { areas?: unknown[] }): AreaPieces[] {
    return (rep.areas ?? []).filter((a): a is AreaPieces => {
        return typeof a === "object" && a !== null && (a as AreaPieces).type === "pieces";
    });
}

const mockT = (key: string) => key;

describe("pieces area veiled (opponent stash)", () => {
    it("ACity sets veiled from perspective", () => {
        const g = new ACityGame();
        const none = piecesStashAreas(g.render());
        expect(none.every(a => a.veiled !== true)).to.be.true;

        const asP1 = piecesStashAreas(g.render({ perspective: 1 }));
        expect(asP1.length).to.equal(2);
        expect(asP1[0]!.veiled).to.not.equal(true);
        expect(asP1[1]!.veiled).to.equal(true);

        const asP2 = piecesStashAreas(g.render({ perspective: 2 }));
        expect(asP2[0]!.veiled).to.equal(true);
        expect(asP2[1]!.veiled).to.not.equal(true);

        const omni = piecesStashAreas(g.render({ perspective: 1, omniscient: true }));
        expect(omni.every(a => a.veiled !== true)).to.be.true;
    });

    it("Four sets veiled from perspective", () => {
        const g = new FourGame();
        const asP1 = piecesStashAreas(g.render({ perspective: 1 }));
        expect(asP1.length).to.equal(2);
        expect(asP1[0]!.veiled).to.not.equal(true);
        expect(asP1[1]!.veiled).to.equal(true);
    });

    it("resolveRenderLabels preserves veiled on areas", () => {
        const g = new ACityGame();
        const rep = g.render({ perspective: 1 });
        const resolved = resolveRenderLabels(rep, ["Alice", "Bob"], mockT);
        const areas = piecesStashAreas(resolved);
        expect(areas[1]!.veiled).to.equal(true);
    });
});
