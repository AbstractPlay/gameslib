/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { GonnectGame } from '../../src/games';
import { addResource } from '../../src';

describe("Gonnect", () => {
    before(() => {
        addResource("en");
    });


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

    it("Player 1 playing tengen alone, then two passes, wins on the final 1x1 subboard", () => {
        // Default 13x13 board; tengen is "g7". Play it out with real moves rather than
        // manipulating the board directly, to exercise the actual move/pass pipeline.
        const g = new GonnectGame(undefined, ["cascading"]);
        g.move("g7");   // Player 1 takes tengen
        g.move("pass"); // Player 2 passes
        g.move("pass"); // Player 1 passes: two consecutive passes end the game
        expect(g.gameover).to.be.true;
        expect(g.winner).to.eql([1]);
        // A single-stone win gives a one-cell connPath. Rendering it must not throw,
        // and it must not emit a "move" annotation (the renderer can't draw a line
        // between a single point), matching the pattern used elsewhere in the codebase
        // (e.g., havannah.ts, renju.ts) for single-point connections. Instead it should
        // highlight the winning stone with an "enter"-style annotation.
        expect(g.connPath).to.eql(["g7"]);
        const rep = g.render();
        const annotations = rep.annotations ?? [];
        expect(annotations.filter(a => a.type === "move")).to.eql([]);
        const [gx, gy] = g.algebraic2coords("g7");
        expect(annotations.some(a => a.type === "enter" && a.targets.some(t => t.row === gy && t.col === gx))).to.be.true;
        // The chat log should name the deciding subboard, not just say passes ended the game.
        const log = g.chatLog(["Alice", "Bob"]).flat();
        expect(log.some(l => l.includes("Alice won on the 1x1 subboard"))).to.be.true;
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
        expect(g.cascadeWinSize).to.equal(3);
        const log = g.chatLog(["Alice", "Bob"]).flat();
        expect(log.some(l => l.includes("Alice won on the 3x3 subboard"))).to.be.true;
    });

    it("A draw's chat log still uses the generic consecutive-passes message", () => {
        const g = new GonnectGame(undefined, ["size-9", "cascading"]);
        g.move("pass");
        g.move("pass");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.eql([1, 2]);
        expect(g.cascadeWinSize).to.be.undefined;
        const log = g.chatLog(["Alice", "Bob"]).flat();
        expect(log.some(l => l.includes("both players passed consecutively"))).to.be.true;
    });

    it("Cascading tiebreak: both players connecting on the same subboard is a tie, and cascades to the next smaller one", () => {
        const g = new GonnectGame(undefined, ["size-9", "cascading"]);
        // 9x9 board: the centred 5x5 subboard occupies columns/rows c-g (indices 2-6).
        // Player 1 connects north-south across it down column "c" (c3..c7) — entirely outside
        // the smaller 3x3 subboard (columns/rows d-f, indices 3-5).
        for (const cell of ["c3", "c4", "c5", "c6", "c7"]) {
            g.board.set(cell, 1);
        }
        // Player 2 also connects north-south across the same 5x5 subboard, down column "e"
        // (e3..e7), whose middle e4-e5-e6 run also spans the smaller 3x3 subboard.
        for (const cell of ["e3", "e4", "e5", "e6", "e7"]) {
            g.board.set(cell, 2);
        }
        // At size 5 both players connect: a tie, so the cascade must continue rather than stop
        // here (stopping here on the first non-null path found would wrongly hand this to
        // player 1). At the smaller 3x3 subboard, only player 2's column is in range, so
        // player 2 alone connects there and should win.
        g.move("pass");
        g.move("pass");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.eql([2]);
    });

    it("A pass not immediately followed by another pass does not end the game", () => {
        const g = new GonnectGame(undefined, ["size-9", "cascading"]);
        g.move("pass");
        g.move("e5");
        g.move("pass");
        expect(g.gameover).to.be.false;
        g.move("pass");
        expect(g.gameover).to.be.true;
    });

    it("A cascading win survives a serialize/deserialize round trip", () => {
        // The server persists games as serialized state between moves; make sure a
        // pass-decided cascading win (including its single-cell connPath) comes back
        // intact rather than only working while the object stays in memory.
        const g = new GonnectGame(undefined, ["cascading"]);
        g.move("g7");
        g.move("pass");
        g.move("pass");
        const reloaded = new GonnectGame(g.serialize());
        expect(reloaded.gameover).to.be.true;
        expect(reloaded.winner).to.eql([1]);
        expect(reloaded.connPath).to.eql(["g7"]);
        expect(reloaded.cascadeWinSize).to.equal(1);
        const rep = reloaded.render();
        const annotations = rep.annotations ?? [];
        expect(annotations.filter(a => a.type === "move")).to.eql([]);
        const [gx, gy] = reloaded.algebraic2coords("g7");
        expect(annotations.some(a => a.type === "enter" && a.targets.some(t => t.row === gy && t.col === gx))).to.be.true;
        const log = reloaded.chatLog(["Alice", "Bob"]).flat();
        expect(log.some(l => l.includes("Alice won on the 1x1 subboard"))).to.be.true;
    });
});
