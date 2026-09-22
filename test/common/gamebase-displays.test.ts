/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { GameFactory } from "../../src/games/index.js";

describe("GameBase display helpers", () => {
    it("resolveActiveDisplays expands legacy altDisplay hide-both", () => {
        const g = GameFactory("tumbleweed")!;
        expect(g.resolveActiveDisplays({ altDisplay: "hide-both" })).to.deep.equal([
            "hide-threatened",
            "hide-influence",
        ]);
    });

    it("coalesce altDisplays over altDisplay", () => {
        const g = GameFactory("tumbleweed")!;
        expect(
            g.resolveActiveDisplays({
                altDisplay: "hide-both",
                altDisplays: ["hide-threatened"],
            }),
        ).to.deep.equal(["hide-threatened"]);
    });

    it("alternativeDisplays includes constraint metadata keys", () => {
        const g = GameFactory("stigmergy")!;
        const displays = g.alternativeDisplays();
        expect(displays).to.be.an("array").that.is.not.empty;
        const hideThreatened = displays!.find((d) => d.uid === "hide-threatened");
        expect(hideThreatened).to.include.keys("uid", "name", "description");
    });
});
