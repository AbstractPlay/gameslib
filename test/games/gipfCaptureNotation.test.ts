import { expect } from "chai";
import "mocha";
import { formatCaptureNotation } from "../../src/games/gipf/capture-notation.js";
import type { CapturableRow } from "../../src/games/gipf/types.js";

describe("Gipf capture notation", () => {
    it("formats a single removed run", () => {
        const row: CapturableRow = {
            id: "1:b2,e3,e4,e5",
            lineKey: "a1|b1|b2|b3|b4|b5",
            owner: 1,
            cells: ["b2", "b3", "b4", "b5"],
            core: ["b2", "b3", "b4", "b5"],
        };
        const take = new Set(["b2", "b3", "b4", "b5"]);
        expect(formatCaptureNotation(row, take)).to.equal("xb2-b5");
    });

    it("shortens the span when optional GIPF is removed", () => {
        const row: CapturableRow = {
            id: "1:e8,e7,e6,e5",
            lineKey: "e1|e2|e3|e4|e5|e6|e7|e8|e9",
            owner: 1,
            cells: ["e8", "e7", "e6", "e5", "e4"],
            core: ["e8", "e7", "e6", "e5"],
        };
        const takeAll = new Set(["e8", "e7", "e6", "e5", "e4"]);
        expect(formatCaptureNotation(row, takeAll)).to.equal("xe8-e4");
        const takeLeaveGipf = new Set(["e8", "e7", "e6", "e5"]);
        expect(formatCaptureNotation(row, takeLeaveGipf)).to.equal("xe8-e5");
    });
});