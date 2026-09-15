import "mocha";
import { expect } from "chai";
import {
    parseStorisendeRegularMove,
    storisendeRegularMoveDestination,
    storisendeRegularMoveSourceCell,
} from "../../src/games/storisende/moveParse.js";

describe("Storisende moveParse", () => {
    it("parses multi-letter from, substack height, and destination", () => {
        expect(parseStorisendeRegularMove("aa1:2-ad5")).to.deep.equal({
            from: "aa1",
            height: 2,
            to: "ad5",
        });
        expect(parseStorisendeRegularMove("z9-ab1")).to.deep.equal({
            from: "z9",
            to: "ab1",
        });
        expect(parseStorisendeRegularMove("aa1:2")).to.deep.equal({
            from: "aa1",
            height: 2,
        });
        expect(storisendeRegularMoveSourceCell("aa1:2-ad5")).to.equal("aa1");
        expect(storisendeRegularMoveDestination("aa1:2-ad5")).to.equal("ad5");
    });
});
