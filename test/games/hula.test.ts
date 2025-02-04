/* eslint-disable no-unused-expressions */
/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { HulaGame } from '../../src/games';

function state(p1s: string[], p2s: string[], neutrals: string[]): HulaGame {
    let g = new HulaGame();
    for(const m of p1s){
        g.board.set(m, 1);
    }
    for(const m of p2s){
        g.board.set(m, 2);
    }
    for(const m of neutrals){
        g.board.set(m, 'neutral');
    }
    return g;
}

/* Various end conditions.
Test with both p1 and p2 as the current player:
current player wins with normal stone
neutral stone, current player wins with only loop
neutral stone, other player wins with only loop
neutral stone, current player wins with shortest loop
neutral stone, other player wins with shortest loop
neutral stone, current player wins with equally long loop but fewer neutrals
neutral stone, other player wins with equally long loop but fewer neutrals
neutral stone, two loops of equal size and #neutrals, p2 wins
*/

describe("Hula", () => {
    it("p1 win with partisan stone placement", () => {
        let g = state(
            ['g5', 'g6', 'f5', 'f7', 'e5'],
            [],
            []);
        g.move('e6');
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1]);
    });
    it("p2 win with partisan stone placement", () => {
        let g = state(
            [],
            ['g5', 'g6', 'f5', 'f7', 'e5'],
            []);
        g.move('e7');
        g.move('e6');
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([2]);
    });
    it("p1 win with neutral stone placed by p1", () => {
        let g = state(
            ['g5', 'g6', 'f5', 'e5', 'e6',
            'f8', 'f9', 'f10', 'f11'],
            [],
            []);
        g.move('f7');
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1]);
    });
    it("p1 win with neutral stone placed by p2", () => {
        let g = state(
            ['g5', 'g6', 'f5', 'e5', 'e6'],
            ['f8', 'f9', 'f10', 'f11'],
            []);
        g.move('a1');
        g.move('f7');
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1]);
    });
    it("p1 win with shortest loop, neutral stone placed by p1", () => {
        let g = state(
            ['g5', 'f5', 'e5', 'h6', 'g7', 'f8', 'e7', 'd6',
            'i4', 'j4', 'k4'],
            ['h4', 'g4', 'g3', 'f3', 'e3', 'e4', 'd4', 'g6', 'f7', 'e6'],
            ['d5']);
        g.move('h5');
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1]);
    });
    it("p1 win with shortest loop, neutral stone placed by p2", () => {
        let g = state(
            ['g5', 'f5', 'e5', 'h6', 'g7', 'f8', 'e7', 'd6'],
            ['h4', 'g4', 'g3', 'f3', 'e3', 'e4', 'd4', 'g6', 'f7', 'e6',
            'i4', 'j4', 'k4'],
            ['d5']);
        g.move('a1');
        g.move('h5');
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1]);
    });
    it("p2 win with shortest loop, neutral stone placed by p2", () => {
        let g = state(
            ['h4', 'g4', 'g3', 'f3', 'e3', 'e4', 'd4', 'g6', 'f7', 'e6'],
            ['g5', 'f5', 'e5', 'h6', 'g7', 'f8', 'e7', 'd6',
            'i4', 'j4', 'k4'],
            ['d5']);
        g.move('a1');
        g.move('h5');
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([2]);
    });
    it("p2 win with shortest loop, neutral stone placed by p1", () => {
        let g = state(
            ['h4', 'g4', 'g3', 'f3', 'e3', 'e4', 'd4', 'g6', 'f7', 'e6',
            'i4', 'j4', 'k4'],
            ['g5', 'f5', 'e5', 'h6', 'g7', 'f8', 'e7', 'd6'],
            ['d5']);
        g.move('h5');
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([2]);
    });
    it("p1 win with equally long loops but fewer neutrals, neutral stone placed by p1", () => {
        let g = state(
            ['g5', 'f5', 'e5', 'h6', 'g7', 'f8', 'e7', 'd6',
            'i4', 'j4', 'k4'],
            ['h4', 'g4', 'e4', 'd4', 'g6', 'f7', 'e6'],
            ['d5', 'f4']);
        g.move('h5');
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1]);
    });
    it("p1 win with equally long loops but fewer neutrals, neutral stone placed by p2", () => {
        let g = state(
            ['g5', 'f5', 'e5', 'h6', 'g7', 'f8', 'e7', 'd6'],
            ['h4', 'g4', 'e4', 'd4', 'g6', 'f7', 'e6',
            'i4', 'j4', 'k4'],
            ['d5', 'f4']);
        g.move('a1');
        g.move('h5');
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1]);
    });
    it("p2 win with equally long loops but fewer neutrals, neutral stone placed by p1", () => {
        let g = state(
            ['g5', 'f5', 'h6', 'g7', 'f8', 'e7', 'd6',
            'i4', 'j4', 'k4'],
            ['h4', 'g4', 'f4', 'e4', 'd4', 'g6', 'f7', 'e6'],
            ['d5', 'e5']);
        g.move('h5');
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([2]);
    });
    it("p2 win with equally long loops but fewer neutrals, neutral stone placed by p2", () => {
        let g = state(
            ['g5', 'f5', 'h6', 'g7', 'f8', 'e7', 'd6'],
            ['h4', 'g4', 'f4', 'e4', 'd4', 'g6', 'f7', 'e6',
            'i4', 'j4', 'k4'],
            ['d5', 'e5']);
        g.move('a1');
        g.move('h5');
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([2]);
    });
    it("p2 win with equally long loops and equal number of neutrals, neutral stone placed by p1", () => {
        let g = state(
            ['g5', 'f5', 'e5', 'h6', 'g7', 'f8', 'e7', 'd6',
            'i4', 'j4', 'k4'],
            ['h4', 'g4', 'f4', 'e4', 'd4', 'g6', 'f7', 'e6'],
            ['d5']);
        g.move('h5');
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([2]);
    });
    it("p2 win with equally long loops and equal number of neutrals, neutral stone placed by p2", () => {
        let g = state(
            ['g5', 'f5', 'e5', 'h6', 'g7', 'f8', 'e7', 'd6'],
            ['h4', 'g4', 'f4', 'e4', 'd4', 'g6', 'f7', 'e6',
            'i4', 'j4', 'k4'],
            ['d5']);
        g.move('a1');
        g.move('h5');
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([2]);
    });
});

