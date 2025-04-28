/* eslint-disable no-unused-expressions */
/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { StibroGame } from '../../src/games';

// function state(p1s: string[], p2s: string[]): StibroGame {
//     let g = new StibroGame();
//     for(const m of p1s){
//         g.board.set(m, 1);
//     }
//     for(const m of p2s){
//         g.board.set(m, 2);
//     }
//     return g;
// }

/* Various end conditions.
Test with both p1 and p2 as the current player:
 - current player wins with normal stone
 - Placement restrictions; both with and without a backup free group:
   - Nearly-connecting single free group to single free group
   - Connecting two free groups
   - Connecting free to non-free group
   - Connecting free group to edge

*/

describe("Stibro", () => {
    it("give all p1 opening moves", () => {
        // All locations except the edge
        let g = new StibroGame();
        expect(g.moves().length).to.equal(91);
    });

    it("give all p2 opening moves", () => {
        let g = (new StibroGame()).move("f5");
        // All locations except those within 2 steps of p1's first placement
        // and those on the edge
        let moves = g.moves();
        expect(moves.length).to.equal(91 - 19);
    });

    it("third and fourth placements may be on the edge", () => {
        let g = ["f5", "i6"].reduce((g, m) => g.move(m), new StibroGame());
        let moves = g.moves();
        expect(moves).to.include.members(["m1"]);
        let moves2 = g.move("m1").moves();
        expect(moves2).to.include("g13");
    });

    it("placements next to free group if player has another free group", () => {
        let g = ["f5", "i6"].reduce((g, m) => g.move(m), new StibroGame());
        let moves = g.moves();
        expect(moves).to.include("h7");
    });

    it("approaching last free group", () => {
        let g = ["f5", "i6", "e4", "j5"]
            .reduce((g, m) => g.move(m), new StibroGame());
        let moves = g.moves();
        expect(moves).to.not.include("g6");
        let moves2 = g.move("g7").moves();
        expect(moves2).to.not.include("h6");
    });

    it("joining the last free group and a non-free group", () => {
        let g = ["h6", "f10",
            "i6", "f9",
            "i4", "j5",
            "i5", "j6",
            "f2", "m7",
            "g3", "f11",
            "h3", "f12"]
            .reduce((g, m) => g.move(m), new StibroGame());
        let moves = g.moves();
        expect(moves).to.not.include("i3");
        expect(moves).to.not.include("h4");
    });

    it("joining the last two free groups with the new stone too close", () => {
        let g = [
            "e3", "b2",
            "f3", "c4",
            "f4"
        ].reduce((g, m) => g.move(m), new StibroGame());
        let moves = g.moves();
        expect(moves).to.not.include("c3");
    });

    it("joining the last free group to the edge", () => {
        let g = [
            "e3", "b2",
            "f3", "c4",
            "f4", "b3",
            "f5"
        ].reduce((g, m) => g.move(m), new StibroGame());
        let moves = g.moves();
        expect(moves).to.not.include.members(["b1","a1","a2","a3"]);
    });

    it("joining one free group to the edge while leaving another", () => {
        let g = [
            "e3", "b2",
            "f3", "c4",
            "f4", "b3",
            "f5", "i6",
            "j1"
        ].reduce((g, m) => g.move(m), new StibroGame());
        let moves = g.moves();
        expect(moves).to.include.members(["b1","a1","a2","a3"]);
    });

    it("p1 win by encircling an opponent group", () => {
        let g = [
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
        let g = [
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
        let g = ["k2",
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
        let g = ["k2",
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
        let g = [
            "f2", "g6",
            "g2", "g7",
            "h2", "g8",
            "h3", "g9",
            "f3", "g10",
        ].reduce((g, m) => g.move(m), new StibroGame());
        let moves = g.moves();
        expect(moves).to.not.include("g4");
    });

    it.only("semi-random playout(s)", () => {
        let g = new StibroGame();
        for(let n=0; n<100; n++){
            g = new StibroGame();
            while(true){
                let moves = g.moves();
                let move = moves[n % moves.length];
                g = g.move(move);
                if(g.gameover){
                    console.log(g.winner[0], "wins!")
                    break;
                }
            }
        }
        expect(g.gameover).to.be.true;
    });
});

