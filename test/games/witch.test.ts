import "mocha";
import { expect } from "chai";
import { WitchGame } from "../../src/games/witch.js";

describe("Witch Stones", () => {
    describe("getPlayerColour", () => {
        it("is grey for both seats before affiliation", () => {
            const g = new WitchGame();
            expect(g.getPlayerColour(1)).to.equal("#999999");
            expect(g.getPlayerColour(2)).to.equal("#999999");
        });

        it("maps sun and moon affiliations to palettes 1 and 2", () => {
            const g = new WitchGame();
            g.affiliations = ["M", "S"];
            expect(g.getPlayerColour(1)).to.equal(2);
            expect(g.getPlayerColour(2)).to.equal(1);
        });
    });

    describe("gameinfo", () => {
        it("uses custom-colours without stash or shared-pieces flags", () => {
            const flags = WitchGame.gameinfo.flags ?? [];
            expect(flags).to.include("custom-colours");
            expect(flags).to.not.include("player-stashes");
            expect(flags).to.not.include("shared-pieces");
        });

        it("documents four customization palette slots", () => {
            const custom = WitchGame.gameinfo.customizations ?? [];
            expect(custom).to.have.length(4);
            expect(custom.find(c => c.num === 1)?.player).to.equal(1);
            expect(custom.find(c => c.num === 2)?.player).to.equal(2);
        });
    });

    describe("render", () => {
        it("binds earthstones to customization palette 3", () => {
            const g = new WitchGame();
            const e = g.render().legend!["E"] as { name: string; colour: { func: string; palette: number } };
            expect(e.colour.func).to.equal("custom");
            expect(e.colour.palette).to.equal(3);
        });
    });
});
