/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { RincalaGame, type Colour } from '../../src/games/rincala';
// // eslint-disable-next-line @typescript-eslint/no-require-imports
// const deepclone = require("rfdc/default");

// BYR,YGR,GBR,GYB,BRG,RYR,YGY,BGB
// const board = "BYR,YGR,GBR,GYB,BRG,RYR,YGY,BGB".split(",").map(stack => stack.split("")) as Colour[][];

const toBoard = (pcs: string): Colour[][] => {
    return pcs.split(",").map(stack => (stack.length > 0 ? stack.split("") : []) as Colour[]);
}

describe("Rincala", () => {
    it ("getDirection", () => {
        const g = new RincalaGame();
        expect(g.getDirection(0, 1)).to.equal("CW");
        expect(g.getDirection(0, 7)).to.equal("CCW");
        expect(g.getDirection(7, 0)).to.equal("CW");
        expect(g.getDirection(7, 6)).to.equal("CCW");
        expect(g.getDirection(6, 0)).to.be.undefined;
    });

    it ("nextPit", () => {
        const g = new RincalaGame();
        expect(g.nextPit(0, "CW")).to.equal(1);
        expect(g.nextPit(0, "CCW")).to.equal(7);
        expect(g.nextPit(1, "CW")).to.equal(2);
        expect(g.nextPit(1, "CCW")).to.equal(0);
        expect(g.nextPit(2, "CW")).to.equal(3);
        expect(g.nextPit(2, "CCW")).to.equal(1);
        expect(g.nextPit(3, "CW")).to.equal(4);
        expect(g.nextPit(3, "CCW")).to.equal(2);
        expect(g.nextPit(4, "CW")).to.equal(5);
        expect(g.nextPit(4, "CCW")).to.equal(3);
        expect(g.nextPit(5, "CW")).to.equal(6);
        expect(g.nextPit(5, "CCW")).to.equal(4);
        expect(g.nextPit(6, "CW")).to.equal(7);
        expect(g.nextPit(6, "CCW")).to.equal(5);
        expect(g.nextPit(7, "CW")).to.equal(0);
        expect(g.nextPit(7, "CCW")).to.equal(6);
    });

    it ("mv2Pits", () => {
        const g = new RincalaGame();
        expect(g.mv2pits(0, "CW")).to.deep.equal([1, 2, 3]);
        expect(g.mv2pits(0, "CCW")).to.deep.equal([7, 6, 5]);
        // throw in an 8-stack
        g.board[0] = ["R", "R", "R", "R", "R", "R", "R", "R"];
        expect(g.mv2pits(7, "CW")).to.deep.equal([1, 2, 3]);
        expect(g.mv2pits(1, "CCW")).to.deep.equal([7, 6, 5]);
        expect(g.mv2pits(0, "CW")).to.deep.equal([1, 2, 3, 4, 5, 6, 7, 0]);
        expect(g.mv2pits(0, "CCW")).to.deep.equal([7, 6, 5, 4, 3, 2, 1, 0]);
    });

    it ("findCaptures", () => {
        const g = new RincalaGame();
        g.board = [["B","R","R"], ["G", "Y"], [], [], [], [], ["Y", "Y"], []];
        expect(g.findCaptures()).to.deep.equal([0, 6]);
    });

    it ("gatherMoves", () => {
        const g = new RincalaGame();
        g.board = toBoard("B,YGY,R,R,,,,");
        const moves = g.gatherMoves();
        expect(moves).to.deep.equal([
            { move: "A>", terminal: false},
            { move: "B>", terminal: true},
            { move: "B<", terminal: true },
            { move: "C>", terminal: true },
            { move: "C<", terminal: false},
            { move: "D<", terminal: true},
        ]);
    });

    it ("recurseMoves", () => {
        const g = new RincalaGame();
        g.board = toBoard("B,YGY,R,R,,,,");
        const moves = g.moves();
        expect(moves).to.deep.equal([
            "B<",
            "B>",
            "C>",
            "D<",
            "A>,B>",
            "A>,C>",
            "A>,D<",
            "C<,B<",
            "C<,B>",
            "A>,C<,B>",
            "C<,A>,B>",
        ]);
    });

    it ("handleClick", () => {
        const g = new RincalaGame();
        g.board = toBoard("GRG,RBR,YGB,GBR,YRY,BGY,YBG,YBR");
        const result = g.handleClick("A>", 0, 1, "3");
        expect(result.valid).to.be.true;
        expect(result.complete).to.equal(-1);
        expect(result.move).to.equal("A>,B");
    });
});

