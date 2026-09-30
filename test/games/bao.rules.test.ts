/* eslint-disable @typescript-eslint/no-unused-expressions */
/**
 * Rule-contract tests for Bao la Kiswahili (Zanzibar / Townshend-style rules).
 * @see https://mancala.fandom.com/wiki/Bao_la_Kiswahili#Rules
 * @see test/games/bao.wiki-matrix.md — bullet-to-test map
 *
 * Legacy behavioural tests remain in bao.test.ts (unchanged).
 */
import "mocha";
import { expect } from "chai";
import { BaoGame } from "../../src/games";
import { addResource } from "../../src";
import { baoFromBoard, type BaoBoard } from "../fixtures/bao";

describe("Bao rules (wiki contracts)", () => {
    before(() => {
        addResource("en");
    });

    describe("namu — capturing laps (occupied inner pit vs empty)", () => {
        it("does not chain-capture when a relay lap ends in a previously empty inner pit", () => {
            // Wiki: another capture only if the last seed is dropped into an *occupied* inner hole
            // with a non-empty opposite; otherwise laps end when the last seed falls in an empty hole.
            const board: BaoBoard = [
                [1, 1, 0, 0, 0, 0, 0, 0],
                [1, 0, 0, 7, 0, 0, 0, 0],
                [0, 1, 1, 1, 8, 0, 1, 1],
                [0, 0, 0, 0, 0, 0, 1, 1],
            ];
            const g = baoFromBoard(board, { currplayer: 2, inhand: [19, 19] });
            const c = BaoGame.clone(g);
            const r = c.processMove("d3<");
            expect(r.captured.cells).eql(["d2"]);
            expect(r.captured.stones).eq(1);
            expect(c.board[1][7]).eq(1); // h3 received the relay stone
            expect(c.board[2][7]).eq(1); // h2 still has one; not captured
        });

        it("chains capture when the lap ends in an inner pit that already held seeds", () => {
            const board: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 2, 6, 1, 1, 0, 0],
                [0, 0, 0, 0, 6, 1, 1, 1],
                [0, 0, 0, 0, 0, 0, 0, 0],
            ];
            const g = baoFromBoard(board, { currplayer: 1, inhand: [22, 22] });
            const c = BaoGame.clone(g);
            const r = c.processMove("e2>");
            expect(r.captured.cells).eql(["e3", "f3"]);
            expect(r.captured.stones).eq(2);
        });
    });

    describe("namu — takata (kutakata) never captures", () => {
        it("does not capture on a kutakata move even when opposite inner pits hold stones", () => {
            const board: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 2, 0, 6, 0, 2, 0, 0],
                [0, 0, 0, 0, 6, 0, 0, 0],
                [0, 0, 0, 0, 1, 0, 0, 2],
            ];
            const g = baoFromBoard(board, { currplayer: 1, inhand: [22, 22] });
            const c = BaoGame.clone(g);
            const r = c.processMove("e2<*");
            expect(r.captured.cells).eql([]);
            expect(r.captured.stones).eq(0);
            expect(r.sown).eql(["e2"]);
        });

        it("offers only kutakata when no capture is available", () => {
            const board: BaoBoard = [
                [4, 0, 2, 1, 1, 0, 0, 0],
                [0, 0, 2, 6, 0, 0, 0, 0],
                [0, 0, 0, 0, 6, 1, 1, 0],
                [0, 1, 2, 2, 2, 0, 1, 0],
            ];
            const g = baoFromBoard(board, { currplayer: 1, inhand: [16, 16] });
            expect(g.moves().every((m) => m.endsWith("*"))).to.be.true;
        });
    });

    describe("namu — mandatory capture", () => {
        it("lists only capturing starts when inner rows face occupied pits", () => {
            const board: BaoBoard = [
                [0, 1, 3, 2, 2, 1, 0, 0],
                [1, 1, 0, 6, 0, 0, 0, 0],
                [1, 0, 0, 0, 6, 1, 0, 0],
                [1, 0, 3, 3, 0, 1, 0, 2],
            ];
            const g = baoFromBoard(board, { currplayer: 2, inhand: [14, 15] });
            const moves = g.moves();
            expect(moves.length).to.be.greaterThan(0);
            expect(moves.every((m) => !m.endsWith("*"))).to.be.true;
            expect(moves).to.include.members(["a3>", "a3>+"]);
        });
    });

    describe("namu — nyumba safari", () => {
        it("stops in the nyumba on a capture lap unless + continues (safari)", () => {
            const board: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [5, 0, 2, 6, 0, 0, 0, 0],
                [1, 0, 2, 2, 7, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
            ];
            const g = baoFromBoard(board, { currplayer: 1, inhand: [22, 22] });
            const stop = BaoGame.clone(g);
            const stopResult = stop.processMove("a2>");
            expect(stopResult.complete).to.be.false;
            expect(stopResult.captured.cells).eql(["a3"]);

            const safari = BaoGame.clone(g);
            const safariResult = safari.processMove("a2>+");
            expect(safariResult.complete).to.be.true;
            expect(safariResult.captured.cells).eql(["a3"]);
            expect(safari.board[3].some((n) => n > 0)).to.be.true;
        });
    });

    describe("mtaji — lap endings and capture", () => {
        it("does not start from a singleton in the front row", () => {
            const board: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 1, 2, 0, 1, 0, 0, 0],
                [0, 0, 0, 1, 1, 0, 1, 0],
                [0, 0, 0, 0, 3, 0, 0, 2],
            ];
            const g = baoFromBoard(board, { currplayer: 1, inhand: [0, 0] });
            expect(g.validateMove("e2>").valid).to.be.false;
        });

        it("ends a mtaji capture turn when the last seed falls in an empty hole", () => {
            const board: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 1, 3, 1, 6, 0],
                [0, 3, 2, 1, 1, 0, 1, 0],
                [0, 0, 0, 0, 0, 2, 3, 1],
            ];
            const g = baoFromBoard(board, { currplayer: 1, inhand: [0, 0] });
            const c = BaoGame.clone(g);
            const r = c.processMove("b2>");
            expect(r.captured.cells.length).to.be.greaterThan(0);
            expect(r.complete).to.be.true;
        });

        it("does not treat a 16-seed first lap as a capturing mtaji start", () => {
            const board: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 1, 1, 1, 1, 0],
                [0, 16, 0, 0, 0, 0, 1, 1],
                [0, 0, 0, 0, 0, 0, 0, 0],
            ];
            const g = baoFromBoard(board, { currplayer: 1, inhand: [0, 0] });
            const captureMoves = g.moves().filter((m) => !m.endsWith("*"));
            expect(captureMoves.some((m) => m.startsWith("b2"))).to.be.false;
        });
    });

    describe("general — first lap decides whether captures are possible", () => {
        it("allows no capture in the full move when the first lap is takata", () => {
            const board: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 1, 2, 2, 0, 1, 0, 0],
                [0, 0, 1, 3, 1, 0, 2, 0],
                [0, 0, 0, 0, 3, 0, 0, 2],
            ];
            const g = baoFromBoard(board, { currplayer: 1, inhand: [0, 0] });
            const c = BaoGame.clone(g);
            const r = c.processMove("d2>*");
            expect(r.captured.cells).eql([]);
            expect(r.sown).to.eql(["d2", "g2"]);
        });
    });

    describe("mtaji — kutakata does not capture", () => {
        it("relays without capture when the first lap is not a capture", () => {
            const board: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 1, 2, 2, 0, 1, 0, 0],
                [0, 0, 1, 3, 1, 0, 2, 0],
                [0, 0, 0, 0, 3, 0, 0, 2],
            ];
            const g = baoFromBoard(board, { currplayer: 1, inhand: [0, 0] });
            const c = BaoGame.clone(g);
            const r = c.processMove("d2>*");
            expect(r.captured.cells).eql([]);
            expect(r.sown.length).to.be.greaterThan(0);
        });
    });

    describe("only opponent inner row is capturable", () => {
        it("never captures from the opponent back row", () => {
            const board: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 2, 2, 6, 0, 0, 0, 0],
                [0, 0, 0, 0, 6, 2, 2, 0],
            ];
            const g = baoFromBoard(board, { currplayer: 1, inhand: [22, 22] });
            const c = BaoGame.clone(g);
            const r = c.processMove("f2>*");
            const backRowSum = c.board[3].reduce((a, b) => a + b, 0);
            expect(r.captured.cells).eql([]);
            expect(backRowSum).to.be.greaterThan(0);
        });
    });

    describe("goal — bao hamna / immobilization", () => {
        it("declares a winner when a front row is emptied", () => {
            const board: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 6, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
            ];
            const g = baoFromBoard(board, { currplayer: 1, inhand: [0, 0] });
            g.checkEOG();
            expect(g.gameover).to.be.true;
            expect(g.winner).eql([2]);
        });
    });

    describe("takasia — kutakatia", () => {
        it("forbids starting kutakata from a pit that is takasiaed", () => {
            const board: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 5, 0, 0, 1, 0, 2, 0],
                [0, 1, 0, 0, 0, 0, 1, 0],
                [0, 2, 3, 0, 0, 0, 0, 0],
            ];
            const g = baoFromBoard(board, { currplayer: 1, inhand: [0, 0] });
            g.move("c1<*", { skipEconomy: true });
            expect(g.getBlocked(2)).eq("b3");
            expect(g.blocked[1]).eq("b3");
            const v = g.validateMove("b3<*");
            expect(v.valid).to.be.false;
            expect(v.message).to.match(/blocked|kutakatia/i);
        });

        it("requires a capture that clears takasia when only one pit is threatened", () => {
            const board: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 6, 0, 0, 2, 0, 2, 0],
                [0, 0, 1, 0, 0, 0, 0, 0],
                [2, 3, 0, 0, 0, 0, 4, 0],
            ];
            const g = baoFromBoard(board, { currplayer: 1, inhand: [0, 0] });
            g.move("a1<*", { skipEconomy: true });
            g.move("g3>*", { skipEconomy: true });
            expect(g.moves()).eql(["b1<"]);
        });
    });

    describe("nyumba — destroyed when captured or sown through", () => {
        it("removes the house when the nyumba pit is captured", () => {
            const board: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 7, 0, 0, 0, 0],
                [0, 0, 0, 1, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
            ];
            const g = baoFromBoard(board, { currplayer: 1, inhand: [22, 22] });
            g.move("d2<", { trusted: true, skipEconomy: true });
            expect(g.houses[1]).to.be.undefined;
            const destroyed = g.stack[g.stack.length - 1]._results?.some(
                (r) => r.type === "destroy" && r.where === "d3",
            );
            expect(destroyed).to.be.true;
        });
    });

    describe("setup — Zanzibar initial position", () => {
        it("starts with 22 seeds in reserve and the standard diagram", () => {
            const g = new BaoGame();
            expect(g.inhand).eql([22, 22]);
            expect(g.houses).eql(["e2", "d3"]);
            expect(g.board[1]).eql([0, 2, 2, 6, 0, 0, 0, 0]);
            expect(g.board[2]).eql([0, 0, 0, 0, 6, 2, 2, 0]);
            expect(g.inhand[0] + g.inhand[1]).eq(44);
        });
    });

    describe("general — capture chains", () => {
        it("allows non-capturing laps between captures when the first lap captured", () => {
            const board: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 2, 2, 6, 0, 7, 0, 0],
                [0, 1, 0, 0, 7, 1, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
            ];
            const g = baoFromBoard(board, { currplayer: 1, inhand: [22, 22] });
            const c = BaoGame.clone(g);
            const r = c.processMove("f2>");
            expect(r.captured.cells).eql(["f3", "b3"]);
            expect(r.captured.stones).eq(9);
            expect(r.sown.length).to.be.greaterThan(0);
        });
    });

    describe("namu takata — placement restrictions", () => {
        it("does not offer kutakata from the nyumba while other front pits are occupied", () => {
            const board: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 6, 0, 0, 0, 0],
                [0, 0, 0, 0, 6, 1, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
            ];
            const g = baoFromBoard(board, { currplayer: 1, inhand: [10, 10] });
            const moves = g.moves();
            expect(moves.every((m) => !m.startsWith("e2"))).to.be.true;
            expect(moves.some((m) => m.startsWith("f2"))).to.be.true;
        });

        it("does not offer singleton kutakata when another front pit has 2+ (without functional nyumba)", () => {
            const board: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 6, 0, 0, 0, 0],
                [0, 0, 0, 0, 5, 1, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
            ];
            const g = baoFromBoard(board, { currplayer: 1, inhand: [10, 10] });
            expect(g.hasWorkingHouse(1)).to.be.false;
            expect(g.moves().some((m) => m.startsWith("e2") && m.endsWith("*"))).to.be.true;
            expect(g.moves().every((m) => !m.startsWith("f2"))).to.be.true;
            expect(g.validateMove("f2<*").valid).to.be.false;
        });

        it("allows kutakata from a singleton when every occupied front pit is a singleton", () => {
            const board: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 1, 1, 1, 1, 1, 1, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
            ];
            const g = baoFromBoard(board, {
                currplayer: 1,
                inhand: [10, 10],
                houses: [undefined, undefined],
            });
            expect(g.moves().every((m) => m.endsWith("*"))).to.be.true;
            expect(g.moves().some((m) => m.startsWith("d2"))).to.be.true;
        });
    });

    describe("namu takata — nyumba two-seed sow", () => {
        it("taxes two seeds when kutakata begins from the only occupied front pit (nyumba)", () => {
            const board: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 6, 0, 0, 0, 0],
                [0, 0, 0, 0, 8, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
            ];
            const g = baoFromBoard(board, { currplayer: 1, inhand: [10, 10] });
            const c = BaoGame.clone(g);
            const r = c.processMove("e2>*");
            expect(r.taxed).to.be.true;
            expect(r.captured.cells).eql([]);
            expect(c.board[2][4]).eq(7);
        });
    });

    describe("namu takata — nyumba lap ends turn", () => {
        it("ends immediately when a kutakata lap lands in the nyumba (no relay through house)", () => {
            const board: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 6, 0, 0, 0, 0],
                [0, 0, 0, 0, 6, 2, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
            ];
            const g = baoFromBoard(board, { currplayer: 1, inhand: [10, 10] });
            const c = BaoGame.clone(g);
            const r = c.processMove("f2<*");
            expect(r.captured.cells).eql([]);
            expect(c.board[2][4]).eq(7);
            expect(c.board[2][5]).eq(0);
            expect(r.sown).eql(["f2"]);
        });
    });

    describe("namu capture — kimbi kichwa", () => {
        it("captures from the kimbi with a relay distinct from a central-hole capture", () => {
            const kimbiBoard: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 3, 1, 6, 0, 1, 0, 0],
                [0, 1, 0, 0, 7, 1, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
            ];
            const g = baoFromBoard(kimbiBoard, { currplayer: 1, inhand: [22, 22] });
            const kimbi = BaoGame.clone(g);
            const kimbiResult = kimbi.processMove("b2<");
            expect(kimbiResult.captured.cells).eql(["b3"]);
            expect(kimbiResult.captured.stones).eq(3);
            expect(kimbi.board[2][0]).to.be.greaterThan(0);
        });
    });

    describe("mtaji takata — back row", () => {
        it("allows kutakata from the back row when the front row is all singletons", () => {
            const board: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 1, 2, 0, 1, 0, 0, 0],
                [0, 0, 0, 1, 1, 0, 1, 0],
                [0, 0, 0, 0, 3, 0, 0, 2],
            ];
            const g = baoFromBoard(board, { currplayer: 1, inhand: [0, 0] });
            expect(g.moves().some((m) => m.startsWith("h1"))).to.be.true;
            const c = BaoGame.clone(g);
            const r = c.processMove("h1>*");
            expect(r.captured.cells).eql([]);
            expect(r.sown.length).to.be.greaterThan(1);
        });
    });

    describe("mtaji takata — lone kichwa toward center", () => {
        it("offers kutakata from the only occupied front kichwa with 2+ seeds", () => {
            const board: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 6, 0, 0, 0, 0],
                [3, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
            ];
            const g = baoFromBoard(board, { currplayer: 1, inhand: [0, 0] });
            const moves = g.moves().filter((m) => m.startsWith("a2"));
            expect(moves).eql(["a2>*"]);
            expect(g.validateMove("a2<*").valid).to.be.false;
        });

        it("mirrors toward-center kutakata for player 2 sole front kichwa", () => {
            const board: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 4],
                [0, 0, 0, 0, 0, 0, 0, 8],
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
            ];
            const g = baoFromBoard(board, { currplayer: 2, inhand: [0, 0] });
            const moves = g.moves().filter((m) => m.startsWith("h3"));
            expect(moves).eql(["h3>*"]);
        });
    });

    describe("mtaji takata — front row never empty", () => {
        it("allows kutakata that lifts every inner seed and redeposits on the inner row", () => {
            const board: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 3, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
            ];
            const g = baoFromBoard(board, { currplayer: 1, inhand: [0, 0] });
            const c = BaoGame.clone(g);
            const r = c.processMove("e2>*");
            expect(r.illegalEmptyFront).to.be.false;
            expect(r.complete).to.be.true;
            expect(c.board[2].some((n) => n > 0)).to.be.true;
        });

        it("forbids relay pickup from the back row while the inner row is empty on the board", () => {
            const board: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
                [8, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 4],
            ];
            const g = baoFromBoard(board, { currplayer: 1, inhand: [0, 0] });
            const illegal = BaoGame.clone(g).processMove("a2<*");
            expect(illegal.illegalEmptyFront).to.be.true;
            expect(illegal.complete).to.be.false;
            expect(g.moves()).eql(["a2>*"]);
        });
    });

    describe("mtaji — 16+ seed kutakata lap", () => {
        it("never captures during a kutakata lap that lifts 16 or more seeds", () => {
            const board: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 1, 1, 1, 1, 0],
                [0, 16, 0, 0, 6, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
            ];
            const g = baoFromBoard(board, { currplayer: 1, inhand: [0, 0] });
            const c = BaoGame.clone(g);
            const r = c.processMove("b2>*");
            expect(r.captured.cells).eql([]);
        });
    });

    describe("functional nyumba", () => {
        it("treats a house with fewer than six seeds as non-functional", () => {
            const board: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 6, 0, 0, 0, 0],
                [0, 0, 0, 0, 5, 1, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
            ];
            const g = baoFromBoard(board, { currplayer: 1, inhand: [10, 10] });
            expect(g.hasWorkingHouse(1)).to.be.false;
            expect(g.moves().some((m) => m.startsWith("e2") && m.endsWith("*"))).to.be.true;
            expect(g.moves().every((m) => !m.startsWith("f2"))).to.be.true;
        });
    });

    describe("goal — immobilization (singleton front row)", () => {
        it("wins when the opponent to move has no legal mtaji moves", () => {
            const board: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 1, 1, 1, 1, 1, 1, 1],
                [0, 0, 0, 6, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
            ];
            const g = baoFromBoard(board, { currplayer: 2, inhand: [0, 0] });
            expect(g.moves()).to.eql([]);
            g.checkEOG();
            expect(g.gameover).to.be.true;
            expect(g.winner).eql([1]);
        });
    });

    describe("RULE GAPS — wiki vs implementation (see bao.wiki-matrix.md)", () => {
        it("mandatory mtaji safari when a kutakata lap ends in the functional nyumba", () => {
            const board: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 6, 0, 0, 0, 0],
                [0, 0, 0, 0, 6, 0, 2, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
            ];
            const g = baoFromBoard(board, { currplayer: 1, inhand: [0, 0] });
            const c = BaoGame.clone(g);
            const r = c.processMove("g2<*");
            expect(r.sown).to.include("e2");
        });

        it("relays through a takasiaed pit on the first lap from the nyumba", () => {
            const board: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 6, 0, 0, 0, 0],
                [0, 0, 1, 1, 2, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
            ];
            const g = baoFromBoard(board, {
                currplayer: 1,
                inhand: [0, 0],
                blocked: ["c2", undefined],
            });
            const c = BaoGame.clone(g);
            const r = c.processMove("e2<*");
            expect(r.sown).to.include("c2");
        });

        it("still stops on a takasiaed pit when the lap did not start from the nyumba", () => {
            const board: BaoBoard = [
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 6, 0, 0, 0, 0],
                [0, 0, 1, 2, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
            ];
            const g = baoFromBoard(board, {
                currplayer: 1,
                inhand: [0, 0],
                blocked: ["c2", undefined],
            });
            const c = BaoGame.clone(g);
            const r = c.processMove("d2<*");
            expect(r.sown).eql(["d2"]);
        });
    });

    describe("integration — full move() for reported position", () => {
        it("plays d3< as player 2 with one capture and no h2 take", () => {
            const board: BaoBoard = [
                [1, 1, 0, 0, 0, 0, 0, 0],
                [1, 0, 0, 7, 0, 0, 0, 0],
                [0, 1, 1, 1, 8, 0, 1, 1],
                [0, 0, 0, 0, 0, 0, 1, 1],
            ];
            const g = baoFromBoard(board, { currplayer: 2, inhand: [19, 19] });
            expect(g.moves()).to.include.members(["d3<", "d3>"]);
            g.move("d3<", { trusted: true, skipEconomy: true });
            expect(g.board[2][3]).eq(0);
            expect(g.board[1][7]).eq(1);
            expect(g.board[2][7]).eq(1);
            const cap = g.stack[g.stack.length - 1]._results?.find((r) => r.type === "capture");
            expect(cap).to.deep.include({ type: "capture", where: "d2", count: 1 });
        });
    });
});
