/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { ChameleonGame } from '../../src/games';
import { wrongAnnihilationEogState } from "../fixtures/chameleon/wrongAnnihilationEog.js";

function eogReason(g: ChameleonGame): string | undefined {
    const tip = g.stack[g.stack.length - 1]!;
    return tip._results?.find((r) => r.type === "eog" && "reason" in r)?.reason as string | undefined;
}

describe("Chameleon", () => {
    it ("EOG: No pieces", () => {
        const g = new ChameleonGame();
        g.board.clear();
        g.board.set("a1", "AB");
        g.board.set("a2", "BB");
        g.move("a1xa2");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1]);
        expect(eogReason(g)).to.eql("annihilation");
    });
    // This test is also no longer needed. If you can't immediately cap, game over.
    // it ("EOG: Full infiltration", () => {
    //     const g = new ChameleonGame();
    //     g.board.clear();
    //     g.board.set("a1", "BB");
    //     g.board.set("a2", "AB");
    //     g.board.set("a5", "BW");
    //     g.move("a2-a3");
    //     expect(g.gameover).to.be.true;
    //     expect(g.winner).to.have.members([2]);
    // });
    it ("EOG: Last-minute infiltration", () => {
        const g = new ChameleonGame();
        g.board.clear();
        g.board.set("a4", "AB");
        g.board.set("a2", "BB");
        g.move("a4-a5");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1]);
        expect(eogReason(g)).to.eql("last-minute infiltration");
    });
    // This test is no longer needed after adding checkmate checking.
    // If your last piece can't capture the invading piece, the game is just over.
    // it ("EOG: Full infiltration trumps last-minute infiltration", () => {
    //     const g = new ChameleonGame();
    //     g.board.clear();
    //     g.board.set("a1", "BB");
    //     g.board.set("a2", "BB");
    //     g.board.set("a4", "AW");
    //     g.move("a4-a5");
    //     expect(g.gameover).to.be.true;
    //     expect(g.winner).to.have.members([2]);
    // });
    it ("Checkmate: Move forced", () => {
        const g = new ChameleonGame();
        g.board.clear();
        g.board.set("a1", "BB");
        g.board.set("a2", "AB");
        const moves = g.moves();
        expect(moves.length).to.eql(1);
        expect(moves[0]).to.eql("a2xa1");
    });
    it ("EOG: legacy annihilation label is stalemate when pieces remain", () => {
        const g = new ChameleonGame(wrongAnnihilationEogState);
        g.load(-1);
        const outcome = g.expectedEogOutcome();
        expect(outcome?.reason).to.eql("stalemate");
        expect(outcome?.winner).to.have.members([2]);
        const stored = eogReason(g);
        expect(stored).to.eql("annihilation");
    });
    it ("Checkmate: Game ends if you can't cap", () => {
        const g = new ChameleonGame();
        g.board.clear();
        g.board.set("a4", "AB");
        g.board.set("a2", "BB");
        g.board.set("b2", "BW");
        g.move("a4-a5");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1]);
        expect(eogReason(g)).to.eql("last-minute infiltration");
    });
});

