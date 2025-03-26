/* eslint-disable no-unused-expressions */
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

        // simplified, middle of the board
        g = initGame([["d5", 2], ["e5", 1], ["f5", 2], ["e4", 2]], ["simplified"]);
        expect(g.isWeak("e5")).to.be.true;
        g = initGame([["e6", 2], ["f6", 2], ["d5", 2], ["e5", 1], ["d4", 2]], ["simplified"]);
        expect(g.isWeak("e5")).to.be.true;

        // board edge scenarios
        g = initGame([["a9", 2], ["a8", 1], ["a7", 2]]);
        expect(g.isWeak("a8")).to.be.true;
        g = initGame([["a7", 1], ["a6", 2], ["b6", 2]]);
        expect(g.isWeak("a7")).to.be.true;
        // extends too far
        g = initGame([["a7", 2], ["a8", 1], ["b7", 2]]);
        expect(g.isWeak("a8")).to.be.false;
        // but is valid if simplified
        g = initGame([["a7", 2], ["a8", 1], ["b7", 2]], ["simplified"]);
        expect(g.isWeak("a8")).to.be.true;
        // wrong edge
        g = initGame([["f9", 2], ["g9", 1], ["h9", 2]]);
        expect(g.isWeak("g9")).to.be.false;
    });

});

