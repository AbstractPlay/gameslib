import "mocha";
import { expect } from "chai";
import { AsliGame } from "../../src/games/asli";
import { AgereGame } from "../../src/games/agere";
import { KnightLineGame } from "../../src/games/knightline";
import { ArchimedesGame } from "../../src/games/archimedes";
import { filterGameinfoForProduction } from "../../src/games/_gameinfo-filter";

function variantFans(game: { create: () => { allvariants: () => { uid: string; fans?: boolean }[] | undefined } }, uid: string): boolean | undefined {
    return game.create().allvariants()?.find((v) => v.uid === uid)?.fans;
}

describe("fans variant metadata", () => {
    it("marks approved community variants in allvariants()", () => {
        expect(variantFans(AsliGame, "area")).to.equal(true);
        expect(variantFans(ArchimedesGame, "8x10")).to.equal(true);
        expect(variantFans(AgereGame, "cobweb")).to.equal(true);
        const knightlineVariants = new KnightLineGame(2).allvariants();
        expect(knightlineVariants?.find((v) => v.uid === "blocker")?.fans).to.equal(true);
        expect(knightlineVariants?.find((v) => v.uid === "wildcard")?.fans).to.equal(true);
    });

    it("does not mark designer-default or sibling variants", () => {
        expect(variantFans(AgereGame, "cobweb-small")).to.not.equal(true);
        expect(variantFans(AsliGame, "woven")).to.not.equal(true);
    });

    it("preserves fans on gameinfo through filterGameinfoForProduction", () => {
        const filtered = filterGameinfoForProduction(AsliGame.gameinfo);
        const area = filtered.variants?.find((v) => v.uid === "area");
        expect(area?.fans).to.equal(true);
    });
});
