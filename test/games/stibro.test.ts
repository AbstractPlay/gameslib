/* eslint-disable no-unused-expressions */
/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { StibroGame } from '../../src/games';

function state(p1s: string[], p2s: string[]): StibroGame {
    let g = new StibroGame();
    for(const m of p1s){
        g.board.set(m, 1);
    }
    for(const m of p2s){
        g.board.set(m, 2);
    }
    return g;
}

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
    it("p1 win with partisan stone placement", () => {
        /* Beware; whether coords form a circle is dependent on the board size
        (if they cross the center line) */
        let g = state(
            ['h5', 'h6', 'g5', 'g7', 'f5'],
            []);
        g.move('f6');
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1]);
    });
    it("p2 win with partisan stone placement", () => {
        let g = state(
            [],
            ['h5', 'h6', 'g5', 'g7', 'f5']);
        g.move('f7');
        g.move('f6');
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([2]);
    });
});

