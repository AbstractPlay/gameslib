/* eslint-disable @typescript-eslint/no-unused-expressions */
/**
 * Golden outcomes for processMove / move() — lock behaviour before rule-alignment edits.
 * Mirrors the fixtures in bao.test.ts "Move processing" and other stable paths.
 */
import "mocha";
import { expect } from "chai";
import { BaoGame } from "../../src/games";
import { addResource } from "../../src";
import { baoFromBoard, type BaoBoard } from "../fixtures/bao";

describe("Bao regression (pre-change contracts)", () => {
    before(() => {
        addResource("en");
    });

    it("opening kutakata f2>* and b3<*", () => {
        const g = new BaoGame();
        let c = BaoGame.clone(g);
        c.processMove("f2>*");
        expect(c.board[2].slice(0, 8)).eql([0, 0, 0, 0, 6, 0, 3, 1]);
        expect(c.board[3][7]).eq(1);

        c = BaoGame.clone(g);
        c.processMove("b3<*");
        expect(c.board[1]).eql([0, 0, 3, 7, 1, 0, 0, 0]);
    });

    it("namu captures e2> / e2< and chains f2>", () => {
        const base: BaoBoard = [
            [0, 0, 0, 0, 0, 0, 0, 0],
            [0, 1, 2, 6, 1, 0, 0, 0],
            [0, 0, 0, 0, 6, 1, 2, 0],
            [0, 0, 0, 0, 0, 0, 0, 0],
        ];
        const g = baoFromBoard(base, { inhand: [22, 22] });
        let c = BaoGame.clone(g);
        c.processMove("e2>");
        expect(c.board[1]).eql([0, 1, 2, 6, 0, 0, 0, 0]);
        expect(c.board[2]).eql([0, 0, 0, 0, 7, 1, 2, 1]);

        c = BaoGame.clone(g);
        c.processMove("e2<");
        expect(c.board[2]).eql([1, 0, 0, 0, 7, 1, 2, 0]);

        const chainBoard: BaoBoard = [
            [0, 0, 0, 0, 0, 0, 0, 0],
            [0, 2, 2, 6, 0, 7, 0, 0],
            [0, 1, 0, 0, 7, 1, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0],
        ];
        c = BaoGame.clone(baoFromBoard(chainBoard, { inhand: [22, 22] }));
        const r = c.processMove("f2>");
        expect(r.captured.cells).eql(["f3", "b3"]);
        expect(r.captured.stones).eq(9);
    });

    it("namu kutakata e2<* does not capture opposite pits", () => {
        const board: BaoBoard = [
            [0, 0, 0, 0, 0, 0, 0, 0],
            [0, 2, 0, 6, 0, 2, 0, 0],
            [0, 0, 0, 0, 6, 0, 0, 0],
            [0, 0, 0, 0, 1, 0, 0, 2],
        ];
        const c = BaoGame.clone(baoFromBoard(board, { inhand: [22, 22] }));
        const r = c.processMove("e2<*");
        expect(r.captured.cells).eql([]);
        expect(r.sown).eql(["e2"]);
    });

    it("mtaji kutakata d2>* multi-lap", () => {
        const board: BaoBoard = [
            [0, 0, 0, 0, 0, 0, 0, 0],
            [0, 1, 2, 2, 0, 1, 0, 0],
            [0, 0, 1, 3, 1, 0, 2, 0],
            [0, 0, 0, 0, 3, 0, 0, 2],
        ];
        const c = BaoGame.clone(baoFromBoard(board, { inhand: [0, 0] }));
        const r = c.processMove("d2>*");
        expect(r.captured.cells).eql([]);
        expect(r.sown).eql(["d2", "g2"]);
    });

    it("mtaji capture list matches processMove when static marker heuristic applies", () => {
        const board: BaoBoard = [
            [0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 2, 6, 0, 0, 0, 0],
            [0, 2, 2, 6, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0],
        ];
        const g = baoFromBoard(board, { currplayer: 1, inhand: [0, 0] });
        const caps = g.moves().filter((m) => !m.endsWith("*"));
        expect(caps.length).to.be.greaterThan(0);
        for (const mv of caps) {
            const base = mv.endsWith("+") ? mv.slice(0, -1) : mv;
            const r = BaoGame.clone(g).processMove(base);
            expect(r.captured.cells.length).to.be.greaterThan(0);
        }
    });

    it("a2> capture with optional nyumba stop vs a2>+ safari", () => {
        const board: BaoBoard = [
            [0, 0, 0, 0, 0, 0, 0, 0],
            [5, 0, 2, 6, 0, 0, 0, 0],
            [1, 0, 2, 2, 7, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0],
        ];
        const g = baoFromBoard(board, { inhand: [22, 22] });
        let c = BaoGame.clone(g);
        let r = c.processMove("a2>");
        expect(r.complete).to.be.false;
        expect(r.captured.cells).eql(["a3"]);

        c = BaoGame.clone(g);
        r = c.processMove("a2>+");
        expect(r.complete).to.be.true;
        expect(c.board[3].some((n) => n > 0)).to.be.true;
    });
});
