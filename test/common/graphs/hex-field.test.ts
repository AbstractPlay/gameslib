import "mocha";
import { expect } from "chai";
import { HexFieldGraph } from "../../../src/common/graphs";
import { Orientation } from "honeycomb-grid";

describe("HexFieldGraph", () => {
    describe("Pointy Orientation", () => {
        it("Offset 1 (Even-R)", () => {
            const g = new HexFieldGraph(3, 3, Orientation.POINTY, 1);
            // (0,0) neighbors
            const neighbours00 = g.neighbours("0,0");
            expect(neighbours00).to.include("1,0");
            expect(neighbours00).to.include("0,1");
            expect(neighbours00).to.include("1,1");
            expect(neighbours00.length).to.equal(3);

            // (0,1) neighbors
            const neighbours01 = g.neighbours("0,1");
            expect(neighbours01).to.include("0,0");
            expect(neighbours01).to.include("1,1");
            expect(neighbours01).to.include("0,2");
            expect(neighbours01.length).to.equal(3);

            // (1,1) neighbours; all 6
            const neighbours11 = g.neighbours("1,1");
            expect(neighbours11).to.include("0,0");
            expect(neighbours11).to.include("1,0");
            expect(neighbours11).to.include("2,1");
            expect(neighbours11).to.include("1,2");
            expect(neighbours11).to.include("0,2");
            expect(neighbours11).to.include("0,1");
            expect(neighbours11.length).to.equal(6);
        });

        it("Offset -1 (Odd-R)", () => {
            const g = new HexFieldGraph(3, 3, Orientation.POINTY, -1);
            // (0,0) neighbors
            const neighbours00 = g.neighbours("0,0");
            expect(neighbours00).to.include("1,0");
            expect(neighbours00).to.include("0,1");
            expect(neighbours00.length).to.equal(2);

            // (0,1) neighbors
            const neighbours01 = g.neighbours("0,1");
            expect(neighbours01).to.include("0,0");
            expect(neighbours01).to.include("1,0");
            expect(neighbours01).to.include("1,1");
            expect(neighbours01).to.include("1,2");
            expect(neighbours01).to.include("0,2");
            expect(neighbours01.length).to.equal(5);

            // (1,1) neighbours; all 6
            const neighbours11 = g.neighbours("1,1");
            expect(neighbours11).to.include("1,0");
            expect(neighbours11).to.include("2,0");
            expect(neighbours11).to.include("2,1");
            expect(neighbours11).to.include("2,2");
            expect(neighbours11).to.include("1,2");
            expect(neighbours11).to.include("0,1");
            expect(neighbours11.length).to.equal(6);
        });
    });

    describe("Flat Orientation", () => {
        it("Offset 1 (Even-Q)", () => {
            const g = new HexFieldGraph(3, 3, Orientation.FLAT, 1);
            // (0,0) neighbors
            const neighbours00 = g.neighbours("0,0");
            expect(neighbours00).to.include("1,0");
            expect(neighbours00).to.include("1,1");
            expect(neighbours00).to.include("0,1");
            expect(neighbours00.length).to.equal(3);

            // (0,1) neighbors
            const neighbours01 = g.neighbours("0,1");
            expect(neighbours01).to.include("0,0");
            expect(neighbours01).to.include("1,1");
            expect(neighbours01).to.include("1,2");
            expect(neighbours01).to.include("0,2");
            expect(neighbours01.length).to.equal(4);

            // (1,1) neighbours; all 6
            const neighbours11 = g.neighbours("1,1");
            expect(neighbours11).to.include("1,0");
            expect(neighbours11).to.include("2,0");
            expect(neighbours11).to.include("2,1");
            expect(neighbours11).to.include("1,2");
            expect(neighbours11).to.include("0,1");
            expect(neighbours11).to.include("0,0");
            expect(neighbours11.length).to.equal(6);
        });

        it("Offset -1 (Odd-Q)", () => {
            const g = new HexFieldGraph(3, 3, Orientation.FLAT, -1);
            // (0,0) neighbors
            const neighbours00 = g.neighbours("0,0");
            expect(neighbours00).to.include("1,0");
            expect(neighbours00).to.include("0,1");
            expect(neighbours00.length).to.equal(2);

            // (0,1) neighbors
            const neighbours01 = g.neighbours("0,1");
            expect(neighbours01).to.include("0,0");
            expect(neighbours01).to.include("1,0");
            expect(neighbours01).to.include("1,1");
            expect(neighbours01).to.include("0,2");
            expect(neighbours01.length).to.equal(4);

            // (1,1) neighbours; all 6
            const neighbours11 = g.neighbours("1,1");
            expect(neighbours11).to.include("1,0");
            expect(neighbours11).to.include("2,1");
            expect(neighbours11).to.include("2,2");
            expect(neighbours11).to.include("1,2");
            expect(neighbours11).to.include("0,2");
            expect(neighbours11).to.include("0,1");
            expect(neighbours11.length).to.equal(6);
        });
    });
});
