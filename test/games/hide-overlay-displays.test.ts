import "mocha";
import { expect } from "chai";
import { ArchimedesGame } from "../../src/games/archimedes.js";
import { PodsGame } from "../../src/games/pods.js";
import { DruidGame } from "../../src/games/druid.js";
import { BideGame } from "../../src/games/bide.js";
import { VolcanoGame } from "../../src/games/volcano.js";
import { AmazonsGame } from "../../src/games/amazons.js";
import { ElOsoGame } from "../../src/games/elOso.js";
import { FroggerGame } from "../../src/games/frogger.js";
import { LoxGame } from "../../src/games/lox.js";

describe("hide overlay display migration (5a)", () => {
    it("Archimedes hide-threatened via altDisplays matches legacy altDisplay", () => {
        const g = new ArchimedesGame();
        const legacy = g.render({ altDisplay: "hide-threatened" });
        const modern = g.render({ altDisplays: ["hide-threatened"] });
        expect(legacy.pieces).to.equal(modern.pieces);
    });

    it("Pods hide-influence via altDisplays matches legacy altDisplay", () => {
        const g = new PodsGame();
        const legacy = g.render({ altDisplay: "hide-influence" });
        const modern = g.render({ altDisplays: ["hide-influence"] });
        expect(legacy.pieces).to.equal(modern.pieces);
    });
});

describe("projection display migration (5b)", () => {
    it("Druid flat via altDisplays matches legacy altDisplay", () => {
        const g = new DruidGame();
        const legacy = g.render({ altDisplay: "flat" });
        const modern = g.render({ altDisplays: ["flat"] });
        expect(legacy.pieces).to.equal(modern.pieces);
        expect(legacy.renderer).to.equal(modern.renderer);
    });

    it("Bide isometric via altDisplays matches legacy altDisplay", () => {
        const g = new BideGame(2);
        const legacy = g.render({ altDisplay: "isometric" });
        const modern = g.render({ altDisplays: ["isometric"] });
        expect(legacy.renderer).to.equal(modern.renderer);
        expect(legacy.renderer).to.equal("isometric");
    });
});

describe("heavy render display migration (5c)", () => {
    it("Volcano expanding via altDisplays matches legacy altDisplay", () => {
        const g = new VolcanoGame();
        const legacy = g.render({ altDisplay: "expanding" });
        const modern = g.render({ altDisplays: ["expanding"] });
        expect(legacy.renderer).to.equal(modern.renderer);
        expect(legacy.renderer).to.equal("stacking-expanding");
    });

    it("Amazons bricks via altDisplays matches legacy altDisplay", () => {
        const g = new AmazonsGame();
        const legacy = g.render({ altDisplay: "bricks" });
        const modern = g.render({ altDisplays: ["bricks"] });
        expect(legacy.legend).to.deep.equal(modern.legend);
    });

    it("El Oso nums via altDisplays matches legacy altDisplay", () => {
        const g = new ElOsoGame();
        const legacy = g.render({ altDisplay: "nums" });
        const modern = g.render({ altDisplays: ["nums"] });
        expect(Array.isArray(legacy)).to.equal(true);
        expect(legacy[0]!.legend).to.deep.equal(modern[0]!.legend);
    });

    it("Frogger frog-pieces via altDisplays matches legacy altDisplay", () => {
        const g = new FroggerGame(2);
        const legacy = g.render({ altDisplay: "frog-pieces" });
        const modern = g.render({ altDisplays: ["frog-pieces"] });
        expect(Array.isArray(legacy)).to.equal(true);
        expect(legacy[0]!.legend).to.deep.equal(modern[0]!.legend);
    });
});

describe("long-tail display migration (5d)", () => {
    it("Lox hide-controlled via altDisplays matches legacy altDisplay", () => {
        const g = new LoxGame();
        const legacy = g.render({ altDisplay: "hide-controlled" });
        const modern = g.render({ altDisplays: ["hide-controlled"] });
        expect(legacy.pieces).to.deep.equal(modern.pieces);
    });
});
