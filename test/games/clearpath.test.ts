/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { ClearPathGame, cpHasWinningPath, cpLegalPlacements, cpVitalPoints } from "../../src/games/clearpath";

// Board notation: columns a-e left to right, rows 1-5 bottom to top.
// Red (player 1) connects the top and bottom rows.  Blue (player 2) connects
// the left and right columns.

function play(size: number, moves: string[]): ClearPathGame {
    const g = new ClearPathGame(undefined, [`size-${size}`]);
    for (const m of moves) {
        g.move(m);
    }
    return g;
}

function cellsOf(g: ClearPathGame): Uint8Array {
    const n = g.boardsize;
    const cells = new Uint8Array(n * n);
    for (const [cell, who] of g.board) {
        const [x, y] = g.algebraic2coords(cell);
        cells[y * n + x] = who;
    }
    return cells;
}

describe("Clear Path", () => {
    describe("Setup", () => {
        it("defaults to a 8x8 board and honours size variants", () => {
            expect(new ClearPathGame().boardsize).to.equal(8);
            expect(new ClearPathGame(undefined, ["size-10"]).boardsize).to.equal(10);
            const g = new ClearPathGame(undefined, ["size-7"]);
            expect(g.moves().length).to.equal(49);
        });

        it("offers the pie swap only after the first placement", () => {
            const g = new ClearPathGame(undefined, ["size-7"]);
            expect(g.isPieTurn()).to.be.false;
            g.move("d4");
            expect(g.isPieTurn()).to.be.true;
            g.move("c3");
            expect(g.isPieTurn()).to.be.false;
        });

        it("rejects bad input", () => {
            const g = play(7, ["d4"]);
            expect(g.validateMove("").valid).to.be.true;
            expect(g.validateMove("").complete).to.equal(-1);
            expect(g.validateMove("z9").valid).to.be.false;
            expect(g.validateMove("d4").valid).to.be.false;
            expect(g.validateMove("pass").valid).to.be.false;
            expect(() => g.move("pass")).to.throw();
        });
    });

    describe("Vital points", () => {
        // Red stones a5, b4, d2, e1 form a diagonal wall with a gap at c3.
        // Every possible Blue connection passes through c3, so c3 is vital
        // to Blue.  Red has other possible connections (column d, say), so c3
        // is not vital to Red, and a red stone there would not complete a
        // winning path.  So Red may not place there.
        const wall = ["a5", "a1", "b4", "e5", "d2", "a2", "e1", "e4"];

        it("forbids a placement on a point vital only to the opponent", () => {
            const g = play(5, wall);
            expect(g.currplayer).to.equal(1);
            const cells = cellsOf(g);
            const vitalBlue = cpVitalPoints(cells, 5, 5, 2);
            const vitalRed = cpVitalPoints(cells, 5, 5, 1);
            const [cx, cy] = g.algebraic2coords("c3");
            expect(vitalBlue[cy * 5 + cx]).to.equal(1);
            expect(vitalRed[cy * 5 + cx]).to.equal(0);
            expect(g.moves()).to.not.include("c3");
            expect(g.moves()).to.include("c4");
            const result = g.validateMove("c3");
            expect(result.valid).to.be.false;
            expect(() => g.move("c3")).to.throw();
        });

        it("shows the vital point on the board", () => {
            const g = play(5, wall);
            const rep = g.render();
            const board = rep.board as {markers?: Array<{type: string; colour?: number | string; points?: Array<{row: number; col: number}>}>};
            const dots = board.markers!.filter(m => m.type === "dots");
            expect(dots.length).to.equal(1);
            expect(dots[0].colour).to.equal(2);
            expect(dots[0].points).to.deep.equal([{row: 2, col: 2}]);
        });

        it("lets the other player use their own vital point", () => {
            const g = play(5, [...wall, "c4"]);
            expect(g.currplayer).to.equal(2);
            expect(g.moves()).to.include("c3");
        });

        it("allows a placement on the opponent's vital point when it wins", () => {
            // Red column c1, c2, c4, c5: c3 is vital to Blue and not to Red,
            // but a red stone there completes a winning path.
            const g = play(5, ["c1", "a1", "c2", "a2", "c4", "e1", "c5", "e2"]);
            expect(g.currplayer).to.equal(1);
            expect(g.moves()).to.include("c3");
            g.move("c3");
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([1]);
            expect(g.moves()).to.deep.equal([]);
            const results = g.stack[g.stack.length - 1]._results;
            expect(results.some(r => r.type === "eog")).to.be.true;
            expect(results.some(r => r.type === "winners")).to.be.true;
        });

        it("allows either player to take a point vital to both", () => {
            // Red diagonal a5, b4, _, d2, e1 and Blue diagonal a1, b2, _, d4, e5
            // share the gap c3, which is therefore vital to both players.
            const g = play(5, ["a5", "a1", "b4", "b2", "d2", "d4", "e1", "e5"]);
            expect(g.currplayer).to.equal(1);
            expect(g.moves()).to.include("c3");
            const asBlue = g.clone();
            asBlue.currplayer = 2;
            expect(asBlue.moves()).to.include("c3");
            g.move("c3");
            // Blue is now cut off
            expect(g.gameover).to.be.true;
        });
    });
});
