import "mocha";
import { expect } from "chai";
import { ArchimedesGame } from "../../src/games/archimedes.js";
import { PodsGame } from "../../src/games/pods.js";
import { DruidGame } from "../../src/games/druid.js";
import { BideGame } from "../../src/games/bide.js";

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
