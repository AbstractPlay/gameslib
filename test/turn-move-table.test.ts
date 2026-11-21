import { expect } from "chai";
import { wireMoveTokenForSeat } from "../src/games/_turn-move-table.js";

describe("wireMoveTokenForSeat", () => {
    it("splits comma N-seat simultaneous wires", () => {
        expect(wireMoveTokenForSeat("7ML,NL", 0, 2)).to.equal("7ML");
        expect(wireMoveTokenForSeat("7ML,NL", 1, 2)).to.equal("NL");
    });

    it("does not split GIPF multi-span capture notation", () => {
        expect(wireMoveTokenForSeat("xd3-c3,xf2-f2", 0, 2)).to.equal(null);
        expect(wireMoveTokenForSeat("xd3-c3,xf2-f2", 1, 2)).to.equal(null);
    });
});