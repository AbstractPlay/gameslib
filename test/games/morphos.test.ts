/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { MorphosGame } from '../../src/games';
import type { playerid } from "../../src/games/morphos";

const initGame = (board: [string,playerid][], variants: string[] = []): MorphosGame => {
    const g = new MorphosGame(undefined, ["size-9", ...variants]);
    g.board = new Map<string, playerid>(board);
    return g;
}

describe("Morphos", () => {
    it ("Weak stone detection", () => {
        // full, middle of the board
        let g = initGame([["d5", 2], ["e5", 1], ["f5", 2], ["d4", 2], ["e4", 2]]);
        expect(g.isWeak("e5")).to.be.true;
        g = initGame([["d5", 2], ["e5", 1], ["f5", 2], ["e4", 2]]);
        expect(g.isWeak("e5")).to.be.false;
        g = initGame([["e6", 2], ["f6", 2], ["d5", 2], ["e5", 1], ["d4", 2], ["d3", 2]]);
        expect(g.isWeak("e5")).to.be.true;
        g = initGame([["e6", 2], ["f6", 2], ["d5", 2], ["e5", 1], ["d4", 2]]);
        expect(g.isWeak("e5")).to.be.false;
        g = initGame([["c4", 1], ["b4", 2], ["b5", 2], ["c6", 2], ["d6", 2], ["e5", 2], ["e4", 2], ["d3", 2], ["c3", 2]]);
        expect(g.isWeak("c4")).to.be.true;
        g = initGame([["c5", 1], ["b4", 2], ["b5", 2], ["c6", 2], ["d6", 2], ["e5", 2], ["e4", 2], ["d3", 2], ["c3", 2]]);
        expect(g.isWeak("c5")).to.be.true;
        g = initGame([["d5", 1], ["b4", 2], ["b5", 2], ["c6", 2], ["d6", 2], ["e5", 2], ["e4", 2], ["d3", 2], ["c3", 2]]);
        expect(g.isWeak("d5")).to.be.true;
        g = initGame([["d4", 1], ["b4", 2], ["b5", 2], ["c6", 2], ["d6", 2], ["e5", 2], ["e4", 2], ["d3", 2], ["c3", 2]]);
        expect(g.isWeak("d4")).to.be.true;

        // simplified, middle of the board
        g = initGame([["d5", 2], ["e5", 1], ["f5", 2], ["e4", 2]], ["simplified"]);
        expect(g.isWeak("e5")).to.be.true;
        g = initGame([["e6", 2], ["f6", 2], ["d5", 2], ["e5", 1], ["d4", 2]], ["simplified"]);
        expect(g.isWeak("e5")).to.be.true;

        // no edge stones in the new rules
        // // board edge scenarios
        // g = initGame([["a9", 2], ["a8", 1], ["a7", 2]]);
        // expect(g.isWeak("a8")).to.be.true;
        // g = initGame([["a7", 1], ["a6", 2], ["b6", 2]]);
        // expect(g.isWeak("a7")).to.be.true;
        // // extends too far
        // g = initGame([["a7", 2], ["a8", 1], ["b7", 2]]);
        // expect(g.isWeak("a8")).to.be.false;
        // /* no peripheral stones in simplified formations */
        // // // but is valid if simplified
        // // g = initGame([["a7", 2], ["a8", 1], ["b7", 2]], ["simplified"]);
        // // expect(g.isWeak("a8")).to.be.true;
        // // wrong edge
        // g = initGame([["f9", 2], ["g9", 1], ["h9", 2]]);
        // expect(g.isWeak("g9")).to.be.false;
    });

});

