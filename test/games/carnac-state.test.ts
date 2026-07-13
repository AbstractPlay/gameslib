import fs from "fs";
import { expect } from "chai";
import { reviver } from "../../src/common";
import { CarnacGame } from "../../src/games/carnac";

describe("Carnac saved state", () => {
    it("allows >s,22-d6 after tipping c7", () => {
        const state = JSON.parse(fs.readFileSync("bin/state.json", "utf8"), reviver);
        const g = new CarnacGame(state);
        expect(g.moves()).to.include(">s,22-d6");
        expect(() => g.move(">s,22-d6")).to.not.throw();
    });
});
