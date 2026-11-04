/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { addResource } from "../../src";
import { assertChatLogParity } from "../fixtures/chat/helpers";
import { chatCollectFakePlayerNames } from "../fixtures/chat/collectFake";
import { OutboundGame, type Stone } from "../../src/games/outbound";

/**
 * A 9x9 game past the auction. Seat 1 plays White and seat 2 plays Black; `black` and `white`
 * list cells, and the first Black cell carries the crown unless `crown` says otherwise.
 */
const setup = (black: string[], white: string[], { crown, turn = 1 }: { crown?: string; turn?: 1 | 2 } = {}): OutboundGame => {
    const g = new OutboundGame(undefined, ["size-9"]);
    g.board = new Map<string, Stone>([
        ...black.map((c) => [c, "B"] as [string, Stone]),
        ...white.map((c) => [c, "W"] as [string, Stone]),
    ]);
    g.crown = crown ?? black[0];
    g.whiteSeat = 1;
    g.currplayer = turn;
    return g;
};

/** `handleClick` takes row and column from the top left of the board. */
const click = (g: OutboundGame, move: string, cell: string) => {
    const [x, y] = OutboundGame.algebraic2coords(cell, 9);
    return g.handleClick(move, y, x);
};

describe("Outbound", () => {
    before(() => {
        addResource("en");
    });

    describe("auction", () => {
        it("starts with a lone crowned Black stone in the centre and no White seat", () => {
            const g = new OutboundGame(undefined, ["size-9"]);
            expect([...g.board]).to.deep.equal([["e5", "B"]]);
            expect(g.crown).to.equal("e5");
            expect(g.whiteSeat).to.be.undefined;
        });

        it("accepts perimeter placements only", () => {
            const g = new OutboundGame(undefined, ["size-9"]);
            expect(g.validateMove("a1").valid).to.be.true;
            expect(g.validateMove("e9").valid).to.be.true;
            expect(g.validateMove("b2").valid).to.be.false;
            expect(g.validateMove("e5").valid).to.be.false;
        });

        it("makes the player who moves a White stone White, and Black the other seat", () => {
            const g = new OutboundGame(undefined, ["size-9"]);
            g.move("a1");
            g.move("i9");
            expect(g.currplayer).to.equal(1);
            g.move("a1-a3");
            expect(g.whiteSeat).to.equal(1);
            expect(g.currplayer).to.equal(2);
            expect(g.board.get("a3")).to.equal("W");
            expect(g.board.has("a1")).to.be.false;
        });

        it("cannot declare before any White stone is on the board", () => {
            const g = new OutboundGame(undefined, ["size-9"]);
            expect(g.validateMove("a1-a3").valid).to.be.false;
        });
    });

    describe("White", () => {
        it("slides in straight lines over friendly stones but not Black ones", () => {
            const g = setup(["e5", "c1"], ["a1", "b1", "a5", "c5"]);
            expect(g.validateMove("a1-d1").valid).to.be.false; // c1 is Black
            expect(g.validateMove("a1-a4").valid).to.be.true;
            expect(g.validateMove("a5-b5").valid).to.be.true;
            expect(g.validateMove("a5-e5").valid).to.be.false;
            expect(g.validateMove("a5-b7").valid).to.be.false; // not a line
            expect(g.validateMove("a1-b1").valid).to.be.false; // occupied
        });

        it("slides over White stones onto an empty space", () => {
            const g = setup(["e5"], ["a1", "b1"]);
            expect(g.validateMove("a1-d1").valid).to.be.true;
        });

        it("flips every lone Black stone flanked by the moved stone", () => {
            const g = setup(["e5", "c3", "b4"], ["d3", "b5", "b1"]);
            g.move("b1-b3");
            expect(g.board.get("c3")).to.equal("W");
            expect(g.board.get("b4")).to.equal("W");
            expect(g.board.get("e5")).to.equal("B");
        });

        it("does not flip a run of two Black stones", () => {
            const g = setup(["e5", "c3", "c4"], ["a3", "e3", "b1"]);
            g.move("b1-b3");
            expect(g.board.get("c3")).to.equal("B");
        });

        it("never flips the stone carrying the crown", () => {
            const g = setup(["c3", "e5"], ["d3", "b1"], { crown: "c3" });
            g.move("b1-b3");
            expect(g.board.get("c3")).to.equal("B");
        });

        it("flips other stones of the king group and leaves the crown with its part", () => {
            const g = setup(["c3", "c4", "i9"], ["d4", "b1"], { crown: "c3" });
            g.move("b1-b4");
            expect(g.board.get("c4")).to.equal("W");
            expect(g.board.get("c3")).to.equal("B");
        });

        it("must pass when no stone can move", () => {
            const g = setup(["e5", "a2", "b1", "b2"], ["a1"]);
            expect(g.moves()).to.deep.equal(["pass"]);
            expect(g.validateMove("pass").valid).to.be.true;
            expect(g.getButtons().map((b) => b.move)).to.deep.equal(["pass"]);
            g.move("pass");
            expect(g.currplayer).to.equal(2);
        });

        it("may not pass while a move exists", () => {
            const g = setup(["e5"], ["a1"]);
            expect(g.validateMove("pass").valid).to.be.false;
        });
    });

    describe("Black", () => {
        it("must grow every group that has liberties", () => {
            const g = setup(["e5", "g5"], ["a1"], { turn: 2 });
            expect(g.validateMove("e6").complete).to.equal(-1);
            expect(g.validateMove("e6,g6").complete).to.equal(1);
            expect(() => g.move("e6")).to.throw();
        });

        it("cannot grow a group twice", () => {
            const g = setup(["e5"], ["a1"], { turn: 2 });
            expect(g.validateMove("e6,e7").valid).to.be.false;
        });

        it("moves the crown to the last stone placed in the king", () => {
            const g = setup(["e5", "g5"], ["a1"], { turn: 2 });
            g.move("g6,e6");
            expect(g.crown).to.equal("e6");
            expect(g.board.get("g6")).to.equal("B");
        });

        it("lets a placement merge two ungrown groups, using up both", () => {
            const g = setup(["e5", "g5"], ["a1"], { turn: 2 });
            expect(g.validateMove("f5").complete).to.equal(1);
            g.move("f5");
            expect(g.crown).to.equal("f5");
        });

        it("reorders a merging placement to the end when a click needs it", () => {
            const g = setup(["e5", "g5"], ["a1"], { turn: 2 });
            expect(g.validateMove("f5,e6").valid).to.be.false;
            const result = click(g, "f5", "e6");
            expect(result.valid).to.be.true;
            expect(result.move).to.equal("e6,f5");
            expect(result.complete).to.equal(1);
            g.move(result.move);
            expect(g.crown).to.equal("f5");
        });

        it("keeps the move unchanged when no reordering makes the click legal", () => {
            const g = setup(["e5", "g5"], ["a1"], { turn: 2 });
            const result = click(g, "f5", "a9");
            expect(result.valid).to.be.false;
            expect(result.move).to.equal("f5");
        });

        it("undoes the last placement when it is clicked again", () => {
            const g = setup(["e5", "g5"], ["a1"], { turn: 2 });
            expect(click(g, "e6", "e6").move).to.equal("");
        });
    });

    describe("end of game", () => {
        it("gives Black the win when the king reaches the edge", () => {
            const g = setup(["e8"], ["a1"], { turn: 2 });
            g.move("e9");
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([2]);
        });

        it("counts any king stone on the edge", () => {
            const g = setup(["e8", "e9"], ["a1"], { turn: 2 });
            // e9 was already on the edge; a king stone there ends the game after Black's turn
            g.move("d8");
            expect(g.winner).to.deep.equal([2]);
        });

        it("gives White the win when the king has no liberties", () => {
            const g = setup(["e5"], ["e4", "e6", "d5", "f1"]);
            g.move("f1-f5");
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([1]);
        });

        it("keeps playing while the king has a liberty", () => {
            const g = setup(["e5"], ["e4", "e6", "f1"]);
            g.move("f1-f5");
            expect(g.gameover).to.be.false;
        });
    });

    describe("move log", () => {
        it("matches the structured chat log through a full opening", () => {
            const g = new OutboundGame(undefined, ["size-9"]);
            g.move("a1");
            g.move("i9");
            g.move("a1-a3");
            g.move("e6");
            expect(g.board.get("e6")).to.equal("B");
            assertChatLogParity(g, chatCollectFakePlayerNames);
        });

        it("reports flips", () => {
            const g = setup(["e5", "c3"], ["d3", "b1"]);
            g.move("b1-b3");
            const lines = g.chatLogEntries(chatCollectFakePlayerNames).flatMap((e) => e.lines).map((l) => l.textKey);
            expect(lines).to.include("apresults:outbound.CAPTURE.flip");
        });
    });
});
