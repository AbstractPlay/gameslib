import "mocha";
import { expect } from "chai";
import { JacynthGame } from "../../src/games/jacynth.js";
import { BiscuitGame } from "../../src/games/biscuit.js";

function stackHandsSnapshot(g: { stack: { hands: string[][] }[] }): string {
    const top = g.stack[g.stack.length - 1];
    return JSON.stringify(top?.hands);
}

describe("strip export immutability", () => {
    it("jacynth strip serialize does not mutate live stack hands", () => {
        const g = new JacynthGame(2);
        const before = stackHandsSnapshot(g);
        g.serialize({ strip: true, player: 1 });
        g.serialize({ strip: true, player: 2 });
        expect(stackHandsSnapshot(g)).to.equal(before);
        const s1 = g.serialize({ strip: true, player: 1 });
        const s2 = g.serialize({ strip: true, player: 2 });
        expect(s1).to.not.equal(s2);
    });

    it("biscuit strip serialize does not mutate live stack hands", () => {
        const g = new BiscuitGame(2);
        const before = stackHandsSnapshot(g);
        g.serialize({ strip: true, player: 1 });
        g.serialize({ strip: true, player: 2 });
        expect(stackHandsSnapshot(g)).to.equal(before);
        const s1 = g.serialize({ strip: true, player: 1 });
        const s2 = g.serialize({ strip: true, player: 2 });
        expect(s1).to.not.equal(s2);
    });
});
