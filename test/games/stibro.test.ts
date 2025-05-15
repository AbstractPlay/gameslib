/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { StibroGame } from '../../src/games';

describe("Stibro", () => {
    it("give all p1 opening moves", () => {
        // All locations except the edge
        const g = new StibroGame();
        expect(g.moves().length).to.equal(91);
    });

    it("give all p2 opening moves", () => {
        const g = (new StibroGame()).move("f5");
        // All locations except those within 2 steps of p1's first placement
        // and those on the edge
        const moves = g.moves();
        expect(moves.length).to.equal(91 - 19);
    });

    it("third and fourth placements may be on the edge", () => {
        const g = ["f5", "i6"].reduce((g, m) => g.move(m), new StibroGame());
        const moves = g.moves();
        expect(moves).to.include.members(["m1"]);
        const moves2 = g.move("m1").moves();
        expect(moves2).to.include("g13");
    });

    it("placements next to free group if player has another free group", () => {
        const g = ["f5", "i6"].reduce((g, m) => g.move(m), new StibroGame());
        const moves = g.moves();
        expect(moves).to.include("h7");
    });

    it("approaching last free group", () => {
        const g = ["f5", "i6", "e4", "j5"]
            .reduce((g, m) => g.move(m), new StibroGame());
        const moves = g.moves();
        expect(moves).to.not.include("g6");
        const moves2 = g.move("g7").moves();
        expect(moves2).to.not.include("h6");
    });

    it("joining the last free group and a non-free group", () => {
        const g = ["h6", "f10",
            "i6", "f9",
            "i4", "j5",
            "i5", "j6",
            "f2", "m7",
            "g3", "f11",
            "h3", "f12"]
            .reduce((g, m) => g.move(m), new StibroGame());
        const moves = g.moves();
        expect(moves).to.not.include("i3");
        expect(moves).to.not.include("h4");
    });

    it("joining the last two free groups with the new stone too close", () => {
        const g = [
            "e3", "b2",
            "f3", "c4",
            "f4"
        ].reduce((g, m) => g.move(m), new StibroGame());
        const moves = g.moves();
        expect(moves).to.not.include("c3");
    });

    it("joining the last free group to the edge", () => {
        const g = [
            "e3", "b2",
            "f3", "c4",
            "f4", "b3",
            "f5"
        ].reduce((g, m) => g.move(m), new StibroGame());
        const moves = g.moves();
        expect(moves).to.not.include.members(["b1","a1","a2","a3"]);
    });

    it("joining one free group to the edge while leaving another", () => {
        const g = [
            "e3", "b2",
            "f3", "c4",
            "f4", "b3",
            "f5", "i6",
            "j1"
        ].reduce((g, m) => g.move(m), new StibroGame());
        const moves = g.moves();
        expect(moves).to.include.members(["b1","a1","a2","a3"]);
    });

    it("p1 win by encircling an opponent group", () => {
        const g = [
            "b2", "h6",
            "h5", "h7",
            "g6", "c1",
            "g7", "c2",
            "g8", "c3",
            "h8", "c4",
            "i5", "b5",
            "i6", "a5",
            "i7"
        ].reduce((g, m) => g.move(m), new StibroGame());

        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1]);
    });

    it("p1 by encircling empty cells", () => {
        const g = [
            "b2", "k6",
            "h5", "k7",
            "g6", "c1",
            "g7", "c2",
            "g8", "c3",
            "h8", "c4",
            "i5", "b5",
            "i6", "a5",
            "i7"
        ].reduce((g, m) => g.move(m), new StibroGame());

        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1]);
    });

    it("p2 win by encircling an opponent group", () => {
        const g = ["k2",
            "b2", "h6",
            "h5", "h7",
            "g6", "c1",
            "g7", "c2",
            "g8", "c3",
            "h8", "c4",
            "i5", "b5",
            "i6", "a5",
            "i7"
        ].reduce((g, m) => g.move(m), new StibroGame());

        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([2]);
    });

    it("p2 by encircling empty cells", () => {
        const g = ["k2",
            "b2", "k6",
            "h5", "k7",
            "g6", "c1",
            "g7", "c2",
            "g8", "c3",
            "h8", "c4",
            "i5", "b5",
            "i6", "a5",
            "i7"
        ].reduce((g, m) => g.move(m), new StibroGame());

        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([2]);
    });

    it("not allowed to form a loop if it would destroy the last free group", () => {
        const g = [
            "f2", "g6",
            "g2", "g7",
            "h2", "g8",
            "h3", "g9",
            "f3", "g10",
        ].reduce((g, m) => g.move(m), new StibroGame());
        const moves = g.moves();
        expect(moves).to.not.include("g4");
    });

    it("semi-random playout", () => {
        const g = new StibroGame();
        let random1 = 752;
        while(!g.gameover) {
            random1 += 139
            const moves = g.moves();
            const m = moves[random1 % moves.length];
            g.move(m);
        }
        expect(g.gameover).to.be.true;
    });

    it("result is the same when round-tripping through state save/load", () => {
        const g = new StibroGame();
        let random1 = 752;
        while(!g.gameover) {
            random1 += 139
            const moves = g.moves();
            const m = moves[random1 % moves.length];
            g.move(m);
        }
        expect(g.gameover).to.be.true;

        let g2 = new StibroGame();
        random1 = 752;
        while(!g2.gameover) {
            random1 += 139
            const moves = g2.moves();
            const m = moves[random1 % moves.length];
            g2.move(m);
            const state = g2.state()
            g2 = new StibroGame(state);
        }
        expect(g.gameover).to.be.true;
        expect(g2.gameover).to.be.true;
        expect(g.board.entries).to.equal(g2.board.entries);
    });
});

