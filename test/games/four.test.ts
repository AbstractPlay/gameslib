/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
// import { FourGame } from '../../src/games';
import { Piece } from "../../src/games/four/piece";

describe("Four", () => {
    it("Pieces: Includes", () => {
        const piece = new Piece({row: 5, col: -2, matrix: [[1,1],[0,1]]});
        const blank = piece.includes(-2, 4);
        const real = piece.includes(-1, 4);
        expect(blank).to.be.false;
        expect(real).to.be.true;
    });
});

