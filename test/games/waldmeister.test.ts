/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { GameFactory } from "../../src";

describe("WaldMeister exploration emulation", () => {
    it("emulated complete move pushes stack and reloads board position", () => {
        const engine = GameFactory("waldmeister") as ReturnType<typeof GameFactory>;
        engine.move("G3@h6");
        const stackBefore = engine.stack.length;
        engine.move("G3@h6-h8,Y1", { emulation: true, trusted: true });
        expect(engine.stack.length).to.equal(stackBefore + 1);
        const continued = GameFactory("waldmeister", engine.cheapSerialize());
        expect(continued.board.get("h8")).to.deep.equal(["G", 3]);
        expect(continued.board.get("h6")).to.deep.equal(["Y", 1]);
    });

    it("emulated complete move does not run end-of-year deltaScore", () => {
        const engine = GameFactory("waldmeister") as ReturnType<typeof GameFactory>;
        engine.move("G3@h6");
        const scoresBefore = [...engine.scores];
        engine.move("G3@h6-h8,Y1", { emulation: true, trusted: true });
        expect(engine.scores).to.deep.equal(scoresBefore);
        expect(engine.results.some((r) => r.type === "deltaScore")).to.be.false;
    });

    it("partial move does not push stack", () => {
        const engine = GameFactory("waldmeister") as ReturnType<typeof GameFactory>;
        engine.move("G3@h6");
        const stackBefore = engine.stack.length;
        engine.move("G3@h6-m1", { partial: true, trusted: true });
        expect(engine.stack.length).to.equal(stackBefore);
    });
});
