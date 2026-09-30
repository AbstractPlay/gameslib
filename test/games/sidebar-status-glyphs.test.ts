import "mocha";
import { expect } from "chai";
import { cardsBasic } from "../../src/common/decktet/index.js";
import { Card } from "../../src/common/decktet/Card.js";
import { BiscuitGame } from "../../src/games";
import type { IStashEntry, LegendEntry } from "../../src/games/_base.js";

/** Exposes protected GameBase sidebar glyph helpers for contract tests. */
class SidebarGlyphProbe extends BiscuitGame {
    public probeSheet(name: string, colour: number) {
        return this.statusSheetGlyph(name, colour);
    }

    public probeLegend(entry: LegendEntry) {
        return this.statusLegendGlyph(entry);
    }

    public probeStashSheet(name: string, colour: number) {
        return this.stashSheetGlyph(name, colour);
    }

    public probeStashLegend(entry: LegendEntry) {
        return this.stashLegendGlyph(entry);
    }

    public sampleStashEntry(entry: LegendEntry): IStashEntry {
        return {
            count: 1,
            glyph: this.stashLegendGlyph(entry),
            movePart: "",
        };
    }
}

describe("GameBase sidebar glyph helpers", () => {
    it("statusSheetGlyph returns tagged sheet values", () => {
        const g = new SidebarGlyphProbe(2);
        expect(g.probeSheet("piece", 3)).to.deep.equal({
            kind: "sheet",
            name: "piece",
            colour: 3,
        });
    });

    it("statusLegendGlyph wraps decktet Card.toGlyph() composites", () => {
        const g = new SidebarGlyphProbe(2);
        const card = Card.deserialize(cardsBasic[0].uid)!;
        const entry = card.toGlyph();
        expect(g.probeLegend(entry)).to.deep.equal({
            kind: "legend",
            entry,
        });
    });

    it("stash helpers match status helpers", () => {
        const g = new SidebarGlyphProbe(2);
        expect(g.probeStashSheet("piece", 2)).to.deep.equal(g.probeSheet("piece", 2));
        const card = Card.deserialize(cardsBasic[0].uid)!;
        const entry = card.toGlyph();
        expect(g.probeStashLegend(entry)).to.deep.equal(g.probeLegend(entry));
    });

    it("IStashEntry accepts tagged legend glyph", () => {
        const g = new SidebarGlyphProbe(2);
        const card = Card.deserialize(cardsBasic[0].uid)!;
        const stash = g.sampleStashEntry(card.toGlyph());
        expect(stash.glyph).to.deep.equal({
            kind: "legend",
            entry: card.toGlyph(),
        });
    });
});
