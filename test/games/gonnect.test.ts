/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { GonnectGame } from '../../src/games';

describe("Gonnect", () => {
    it("Passing is illegal by default", () => {
        const g = new GonnectGame(undefined, ["size-9"]);
        expect(g.moves().includes("pass")).to.be.false;
        expect(() => g.move("pass")).to.throw();
    });

    it("Passing is legal under the cascading variant", () => {
        const g = new GonnectGame(undefined, ["size-9", "cascading"]);
        expect(g.moves().includes("pass")).to.be.true;
        g.move("pass");
        expect(g.lastmove).to.equal("pass");
        expect(g.gameover).to.be.false;
    });

    it("Two consecutive passes end the game", () => {
        const g = new GonnectGame(undefined, ["size-9", "cascading"]);
        g.move("pass");
        expect(g.gameover).to.be.false;
        g.move("pass");
        expect(g.gameover).to.be.true;
    });

    it("A full connection still wins immediately under the cascading variant", () => {
        const g = new GonnectGame(undefined, ["size-9", "cascading"]);
        // Give player 1 a full north-south connection down column "a" without triggering EOG early.
        for (let row = 1; row <= 9; row++) {
            g.board.set(`a${row}`, 1);
        }
        g.board.delete("a9");
        g.move("a9");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.eql([1]);
    });

    it("An empty board ends in a draw after two passes (cascading)", () => {
        const g = new GonnectGame(undefined, ["size-9", "cascading"]);
        g.move("pass");
        g.move("pass");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.eql([1, 2]);
    });

    it("Black playing tengen alone, then two passes, wins on the final 1x1 subboard", () => {
        // Default 13x13 board; tengen is "g7". Play it out with real moves rather than
        // manipulating the board directly, to exercise the actual move/pass pipeline.
        const g = new GonnectGame(undefined, ["cascading"]);
        g.move("g7");   // Black (player 1) takes tengen
        g.move("pass"); // White passes
        g.move("pass"); // Black passes: two consecutive passes end the game
        expect(g.gameover).to.be.true;
        expect(g.winner).to.eql([1]);
    });

    it("Cascading tiebreak: sole occupant of the centre point wins when nobody spans the full board", () => {
        const g = new GonnectGame(undefined, ["size-9", "cascading"]);
        // Tengen of a 9x9 board (0-indexed 4,4) is "e5".
        g.board.set("e5", 2);
        g.move("pass");
        g.move("pass");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.eql([2]);
    });

    it("Cascading tiebreak: a connection across a smaller centred subboard beats no connection at all", () => {
        const g = new GonnectGame(undefined, ["size-9", "cascading"]);
        // 9x9 board: the centred 3x3 subboard occupies columns/rows d-f (indices 3-5).
        // Give player 1 a north-south run down column "e" across that subboard (e4,e5,e6).
        for (const cell of ["e4", "e5", "e6"]) {
            g.board.set(cell, 1);
        }
        g.move("pass");
        g.move("pass");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.eql([1]);
    });
});
