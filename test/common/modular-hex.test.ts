import "mocha";
import { expect } from "chai";
import { createModularHex } from "../../src/common/modular/hex";
import { Orientation } from "honeycomb-grid";

describe("ModularHex Coordinate Calculation", () => {
    describe("Pointy Orientation", () => {
        it("Offset 1 (Even-R)", () => {
            const Hex = createModularHex(Orientation.POINTY, 1);
            // (0,0) -> col 0, row 0
            let h = Hex.create({q: 0, r: 0});
            expect(h.col).to.equal(0);
            expect(h.row).to.equal(0);

            // (0,1) -> col 1, row 1
            // col = 0 + (1 + 1)/2 = 1
            h = Hex.create({q: 0, r: 1});
            expect(h.col).to.equal(1);
            expect(h.row).to.equal(1);
        });

        it("Offset -1 (Odd-R)", () => {
            const Hex = createModularHex(Orientation.POINTY, -1);
            // (0,0) -> col 0, row 0
            let h = Hex.create({q: 0, r: 0});
            expect(h.col).to.equal(0);
            expect(h.row).to.equal(0);

            // (0,1) -> col 0, row 1
            // col = 0 + (1 - 1)/2 = 0
            h = Hex.create({q: 0, r: 1});
            expect(h.col).to.equal(0);
            expect(h.row).to.equal(1);
        });
    });

    describe("Flat Orientation", () => {
        it("Offset 1 (Even-Q)", () => {
            const Hex = createModularHex(Orientation.FLAT, 1);
            // (0,0) -> col 0, row 0
            let h = Hex.create({q: 0, r: 0});
            expect(h.col).to.equal(0);
            expect(h.row).to.equal(0);

            // (1,0) -> col 1, row 1
            // row = 0 + (1 + 1)/2 = 1
            h = Hex.create({q: 1, r: 0});
            expect(h.col).to.equal(1);
            expect(h.row).to.equal(1);
        });

        it("Offset -1 (Odd-Q)", () => {
            const Hex = createModularHex(Orientation.FLAT, -1);
            // (0,0) -> col 0, row 0
            let h = Hex.create({q: 0, r: 0});
            expect(h.col).to.equal(0);
            expect(h.row).to.equal(0);

            // (1,0) -> col 1, row 0
            // row = 0 + (1 - 1)/2 = 0
            h = Hex.create({q: 1, r: 0});
            expect(h.col).to.equal(1);
            expect(h.row).to.equal(0);
        });
    });
});
