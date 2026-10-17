import { expect } from "chai";
import "mocha";
import type { APRenderRep } from "@abstractplay/renderer/build/schemas/schema";
import { isAPRenderComposite } from "../../src/common/renderOutput.js";

const miniRep = (): APRenderRep => ({
    board: { style: "squares", width: 2, height: 2 },
    legend: { A: { name: "piece", paint: { fill: 1 } } },
    pieces: "AA\nAA",
});

const compositeFixture = {
    kind: "composite" as const,
    layout: { arrangement: "row" as const, gap: 1 },
    panels: [
        { id: "west", render: miniRep() },
        { id: "east", render: miniRep() },
    ],
};

describe("isAPRenderComposite", () => {
    it("is true for composite documents", () => {
        expect(isAPRenderComposite(compositeFixture)).to.equal(true);
    });

    it("is false for plain reps and frame arrays", () => {
        expect(isAPRenderComposite(miniRep())).to.equal(false);
        expect(isAPRenderComposite([miniRep(), miniRep()])).to.equal(false);
    });

    it("is false for non-objects", () => {
        expect(isAPRenderComposite(null)).to.equal(false);
        expect(isAPRenderComposite(undefined)).to.equal(false);
    });
});
