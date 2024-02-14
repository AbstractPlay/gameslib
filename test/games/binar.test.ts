/* eslint-disable no-unused-expressions */
/* eslint-disable @typescript-eslint/no-unused-expressions */
/* tslint:disable:no-unused-expression */

import "mocha";
import { expect } from "chai";
import { BinarGame } from '../../src/games';

describe("Binar", () => {
    it("In a row", () => {
        let g = new BinarGame();
        let result = g.isRow();
        expect(result).to.be.false;

        // row
        g.board[2] = [true, true, true, true];
        result = g.isRow();
        expect(result).to.be.true;

        // column
        g = new BinarGame();
        g.board[0][1] = true;
        g.board[1][1] = true;
        g.board[2][1] = true;
        g.board[3][1] = true;
        result = g.isRow();
        expect(result).to.be.true;

        // negative diagonal
        g = new BinarGame();
        g.board[0][0] = true;
        g.board[1][1] = true;
        g.board[2][2] = true;
        g.board[3][3] = true;
        result = g.isRow();
        expect(result).to.be.true;

        // positive diagonal
        g = new BinarGame();
        g.board[3][0] = true;
        g.board[2][1] = true;
        g.board[1][2] = true;
        g.board[0][3] = true;
        result = g.isRow();
        expect(result).to.be.true;
    });
});

