/* eslint-disable @typescript-eslint/no-unused-expressions */
/**
 * Rule contracts for Bao Malawi (Bawo) — `malawi-full` variant.
 * @see test/games/bao.malawi-matrix.md
 */
import "mocha";
import { expect } from "chai";
import { BaoGame } from "../../src/games";
import { addResource } from "../../src";
import { baoFromBoard, type BaoBoard } from "../fixtures/bao";

const MALAWI_FULL = { variants: ["malawi-full"] as string[] };

describe("Bao Malawi (malawi-full)", () => {
    before(() => {
        addResource("en");
    });

    describe("setup — Figure 2", () => {
        it("starts with 8 seeds in each kuu and 20 nemo", () => {
            const g = new BaoGame(undefined, ["malawi-full"]);
            g.load();
            expect(g.inhand).eql([20, 20]);
            expect(g.board[2][4]).eq(8);
            expect(g.board[1][3]).eq(8);
        });

        it("rejects selecting more than one rules variant", () => {
            expect(() => new BaoGame(undefined, ["malawi", "malawi-full"])).to.throw(/Only one Bao rules variant/);
            expect(() => new BaoGame(undefined, ["kujifunza", "malawi-full"])).to.throw(/Only one Bao rules variant/);
        });
    });

    describe("setup — functional kuu threshold", () => {
        it("treats kuu with 8 seeds as functional for malawi setup", () => {
            const board: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 7, 0, 0, 0, 0],
                [0, 0, 0, 0, 8, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
            ];
            const g = baoFromBoard(board, { ...MALAWI_FULL, currplayer: 1, inhand: [10, 10] });
            expect(g.hasWorkingHouse(1)).to.be.true;
        });

        it("uses Zanzibar 6-seed threshold without malawi variants", () => {
            const board: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 6, 0, 0, 0, 0],
                [0, 0, 0, 0, 5, 1, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
            ];
            const g = baoFromBoard(board, { currplayer: 1, inhand: [10, 10] });
            expect(g.hasWorkingHouse(1)).to.be.false;
        });
    });

    describe("namu — no kutakata from kuu", () => {
        it("does not offer kutakata from the kuu while other front pits hold seeds", () => {
            const board: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 6, 0, 0, 0, 0],
                [0, 0, 0, 0, 8, 2, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
            ];
            const g = baoFromBoard(board, { ...MALAWI_FULL, currplayer: 1, inhand: [5, 5] });
            const kutakata = g.moves().filter((m) => m.endsWith("*"));
            expect(kutakata.every((m) => !m.startsWith("e2"))).to.be.true;
            expect(kutakata.some((m) => m.startsWith("f2"))).to.be.true;
        });
    });

    describe("namu — singleton takata", () => {
        it("allows singleton kutakata only when every non-kuu front pit has at most one seed", () => {
            const board: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 6, 0, 0, 0, 0],
                [1, 0, 0, 0, 8, 1, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
            ];
            const g = baoFromBoard(board, { ...MALAWI_FULL, currplayer: 1, inhand: [5, 5] });
            expect(g.moves().some((m) => m === "a2<*")).to.be.true;
            const withTwo: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 6, 0, 0, 0, 0],
                [1, 0, 0, 0, 8, 2, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
            ];
            const g2 = baoFromBoard(withTwo, { ...MALAWI_FULL, currplayer: 1, inhand: [5, 5] });
            expect(g2.moves().some((m) => m.startsWith("a2"))).to.be.false;
        });
    });

    describe("namu — kuu capture guard", () => {
        it("does not offer capture of the opponent kuu when own kuu is threatened", () => {
            const board: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 3, 1, 0, 0, 0],
                [0, 0, 0, 2, 8, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
            ];
            const g = baoFromBoard(board, { ...MALAWI_FULL, currplayer: 1, inhand: [5, 5] });
            expect(g.moves().every((m) => !m.startsWith("d2"))).to.be.true;
            expect(g.moves().length).to.be.greaterThan(0);
        });
    });

    describe("namu — nine-seed kuu", () => {
        it("lifts all nine seeds when kuu is the only occupied front pit and no capture is possible", () => {
            const board: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 8, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
            ];
            const g = baoFromBoard(board, { ...MALAWI_FULL, currplayer: 1, inhand: [5, 5] });
            expect(g.moves().some((m) => m.startsWith("e2") && m.endsWith("*"))).to.be.true;
            const c = BaoGame.clone(g);
            const r = c.processMove("e2>*");
            expect(r.taxed).to.be.false;
            expect(r.captured.cells).eql([]);
            expect(c.board[2][4]).eq(0);
        });
    });

    describe("mtaji — fifteen seed boundary", () => {
        it("treats a pit with 15 seeds as kutakata-only (no mtaji capture start)", () => {
            const board: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 1, 1, 0, 0, 0],
                [0, 15, 0, 0, 8, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
            ];
            const g = baoFromBoard(board, { ...MALAWI_FULL, currplayer: 1, inhand: [0, 0] });
            expect(g.moves().some((m) => m.startsWith("b2") && !m.endsWith("*"))).to.be.false;
            const c = BaoGame.clone(g);
            const r = c.processMove("b2>*");
            expect(r.captured.cells).eql([]);
        });
    });

    describe("mtaji — first takata from kuu", () => {
        it("requires the first stage-2 kutakata from an unmoved functional kuu", () => {
            const board: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 6, 0, 0, 0, 0],
                [0, 0, 0, 0, 8, 3, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
            ];
            const g = baoFromBoard(board, {
                ...MALAWI_FULL,
                currplayer: 1,
                inhand: [0, 0],
                kuuMoved: [false, false],
            });
            const kutakata = g.moves().filter((m) => m.endsWith("*"));
            expect(kutakata.every((m) => m.startsWith("e2"))).to.be.true;
        });
    });

    describe("mtaji — lone end-hole loss", () => {
        it("forfeits when sole end-kichwa takata crosses the outer row and sleeps", () => {
            const board: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
                [8, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 4],
            ];
            const g = baoFromBoard(board, { ...MALAWI_FULL, currplayer: 1, inhand: [0, 0] });
            expect(g.moves()).eql(["a2>*"]);
            g.move("a2<*", { trusted: true, skipEconomy: true });
            expect(g.gameover).to.be.true;
            expect(g.winner).eql([2]);
        });
    });
});
