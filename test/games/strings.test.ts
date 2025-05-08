/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { StringsGame } from '../../src/games';

describe("Pulling Strings", () => {
    it("Centre: By itself", () => {
        const g = new StringsGame();
        g.move("1,3");
        const orig = g.board.get("d4");
        const after = g.board.get("d5");
        expect(orig).to.be.undefined;
        expect(after).eq(5);
    });

    it("Centre: Opposite", () => {
        const g = new StringsGame();
        g.move("3,13");
        const orig = g.board.get("d4");
        const above = g.board.get("d5");
        const below = g.board.get("d3");
        expect(orig).to.be.undefined;
        expect(above).eq(3);
        expect(below).eq(3);
    });

    it("Centre: Perpendicular", () => {
        const g = new StringsGame();
        g.move("18,13");
        const orig = g.board.get("d4");
        const left = g.board.get("c4");
        const below = g.board.get("d3");
        expect(orig).to.be.undefined;
        expect(left).eq(3);
        expect(below).eq(3);
    });

    // Edge: by itself, opposite, perp
    it("Edge: By itself", () => {
        const g = new StringsGame();
        g.board.set("b2", 5);
        g.move("16,17");
        const orig = g.board.get("b2");
        expect(orig).eq(5);
    });

    it("Edge: Opposite", () => {
        const g = new StringsGame();
        g.board.set("b2", 5);
        g.move("16,10");
        const orig = g.board.get("b2");
        const right = g.board.get("c2");
        expect(orig).eq(3);
        expect(right).eq(3);
    });

    it("Edge: Perpendicular", () => {
        const g = new StringsGame();
        g.board.set("b2", 5);
        g.move("16,10");
        const orig = g.board.get("b2");
        const right = g.board.get("c2");
        expect(orig).eq(3);
        expect(right).eq(3);
    });

    // Corner: cancelled
    it("Corner: Cancelled out", () => {
        const g = new StringsGame();
        g.board.set("b6", 5);
        g.move("1,20");
        const orig = g.board.get("b6");
        const right = g.board.get("c6");
        const below = g.board.get("b5");
        expect(orig).eq(5);
        expect(right).to.be.undefined;
        expect(below).to.be.undefined;
    });

    it("Joins: Opposite", () => {
        const g = new StringsGame();
        g.board.clear();
        g.board.set("d3", 3);
        g.board.set("d5", 3);
        g.move("3,13");
        const d6 = g.board.get("d6");
        const d5 = g.board.get("d5");
        const d4 = g.board.get("d4");
        const d3 = g.board.get("d3");
        const d2 = g.board.get("d2");
        expect(d6).eq(2);
        expect(d5).to.be.undefined;
        expect(d4).eq(4);
        expect(d3).to.be.undefined;
        expect(d2).eq(2);
    });

    it("Joins: Perpendicular", () => {
        const g = new StringsGame();
        g.board.clear();
        g.board.set("d4", 3);
        g.board.set("c4", 3);
        g.move("8,13");
        const d4 = g.board.get("d4");
        const d3 = g.board.get("d3");
        const c4 = g.board.get("c4");
        const e4 = g.board.get("e4");
        expect(d4).eq(3);
        expect(d3).eq(2);
        expect(c4).to.be.undefined;
        expect(e4).eq(2);
    });
});

