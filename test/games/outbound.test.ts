/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { addResource } from "../../src";
import { assertChatLogParity } from "../fixtures/chat/helpers";
import { chatCollectFakePlayerNames } from "../fixtures/chat/collectFake";
import { OutboundGame, type Stone } from "../../src/games/outbound";

/**
 * A game past the auction. Seat 1 plays White and seat 2 plays Black; `black` and `white`
 * list cells, and the first Black cell carries the crown unless `crown` says otherwise.
 */
const setup = (black: string[], white: string[], { crown, turn = 1 }: { crown?: string; turn?: 1 | 2 } = {}): OutboundGame => {
    const g = new OutboundGame();
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
    const [x, y] = OutboundGame.algebraic2coords(cell, 19);
    return g.handleClick(move, y, x);
};

/** The cells the rendered board marks with a `dots` annotation, sorted. */
const dots = (g: OutboundGame): string[] =>
    (g.render().annotations ?? [])
        .filter((a) => a.type === "dots")
        .flatMap((a) => (a as { targets: Array<{ row: number; col: number }> }).targets)
        .map(({ row, col }) => OutboundGame.coords2algebraic(col, row, 19))
        .sort();

describe("Outbound", () => {
    before(() => {
        addResource("en");
    });

    describe("auction", () => {
        it("starts with a lone crowned Black stone in the centre and no White seat", () => {
            const g = new OutboundGame();
            expect([...g.board]).to.deep.equal([["j10", "B"]]);
            expect(g.crown).to.equal("j10");
            expect(g.whiteSeat).to.be.undefined;
        });

        it("accepts perimeter placements only", () => {
            const g = new OutboundGame();
            expect(g.validateMove("a1").valid).to.be.true;
            expect(g.validateMove("j19").valid).to.be.true;
            expect(g.validateMove("b2").valid).to.be.false;
            expect(g.validateMove("j10").valid).to.be.false;
        });

        it("makes the player who moves a White stone White, and Black the other seat", () => {
            const g = new OutboundGame();
            g.move("a1");
            g.move("s19");
            expect(g.currplayer).to.equal(1);
            g.move("a1-a3");
            expect(g.whiteSeat).to.equal(1);
            expect(g.currplayer).to.equal(2);
            expect(g.board.get("a3")).to.equal("W");
            expect(g.board.has("a1")).to.be.false;
        });

        it("cannot declare before any White stone is on the board", () => {
            const g = new OutboundGame();
            expect(g.validateMove("a1-a3").valid).to.be.false;
        });
    });

    describe("White", () => {
        it("slides in straight lines over friendly stones but not Black ones", () => {
            const g = setup(["e5", "c1", "d5"], ["a1", "b1", "a5", "c5"]);
            expect(g.validateMove("a1-d1").valid).to.be.false; // c1 is Black
            expect(g.validateMove("a1-a4").valid).to.be.true;
            expect(g.validateMove("a5-b5").valid).to.be.true;
            expect(g.validateMove("a5-e5").valid).to.be.false; // d5 is Black
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
            const result = click(g, "f5", "n15");
            expect(result.valid).to.be.false;
            expect(result.move).to.equal("f5");
        });

        it("undoes the last placement when it is clicked again", () => {
            const g = setup(["e5", "g5"], ["a1"], { turn: 2 });
            expect(click(g, "e6", "e6").move).to.equal("");
        });
    });

    describe("Hunter destination first", () => {
        it("turns a click on an empty space into a destination", () => {
            const g = setup(["j10"], ["a1", "b1", "a5"]);
            const result = click(g, "", "d1");
            expect(result.valid).to.be.true;
            expect(result.move).to.equal("-d1");
            expect(result.complete).to.equal(-1);
        });

        it("completes the move when a Hunter stone that can reach it is clicked", () => {
            const g = setup(["j10"], ["a1", "b1", "a5"]);
            const result = click(g, "-d1", "a1");
            expect(result.move).to.equal("a1-d1");
            expect(result.complete).to.equal(1);
            g.move(result.move);
            expect(g.board.get("d1")).to.equal("W");
        });

        it("keeps the destination when a stone that cannot reach it is clicked", () => {
            const g = setup(["j10"], ["a1", "b1", "a5"]);
            const result = click(g, "-d1", "a5");
            expect(result.valid).to.be.false;
            expect(result.move).to.equal("-d1");
        });

        it("rejects a destination no Hunter stone can reach", () => {
            const g = setup(["j10"], ["a1", "b1", "a5"]);
            const result = click(g, "", "j15");
            expect(result.valid).to.be.false;
            expect(result.move).to.equal("");
        });

        it("lets another empty space replace the destination, and the same one clear it", () => {
            const g = setup(["j10"], ["a1", "b1", "a5"]);
            expect(click(g, "-d1", "c1").move).to.equal("-c1");
            expect(click(g, "-d1", "d1").move).to.equal("");
        });

        it("still selects a stone first", () => {
            const g = setup(["j10"], ["a1", "b1", "a5"]);
            expect(click(g, "", "a1").move).to.equal("a1");
            expect(click(g, "a1", "d1").move).to.equal("a1-d1");
        });

        it("highlights the stones that can move to the destination, over friendly stones but not Black ones", () => {
            const g = setup(["j10", "c1"], ["a1", "b1", "a5", "e1"]);
            g.move("-d1", { partial: true });
            expect(dots(g)).to.deep.equal(["e1"]);
            const open = setup(["j10"], ["a1", "b1", "a5"]);
            open.move("-d1", { partial: true });
            expect(dots(open)).to.deep.equal(["a1", "b1"]);
        });

        it("keeps placement on a click during the auction", () => {
            const g = new OutboundGame();
            expect(click(g, "", "a1").move).to.equal("a1");
        });
    });

    describe("Defender highlights", () => {
        it("marks the empty spaces around every group that has not grown", () => {
            const g = setup(["e5", "g5"], ["a1"], { turn: 2 });
            expect(dots(g)).to.deep.equal(["d5", "e4", "e6", "f5", "g4", "g6", "h5"]);
        });

        it("leaves out groups that have already grown", () => {
            const g = setup(["e5", "g5"], ["a1"], { turn: 2 });
            g.move("e6", { partial: true });
            expect(dots(g)).to.deep.equal(["f5", "g4", "g6", "h5"]);
        });

        it("still marks a group grown by a merge where moving the merge later would allow it", () => {
            const g = setup(["e5", "g5"], ["a1"], { turn: 2 });
            g.move("f5", { partial: true });
            // f4 and f6 touch only the merging stone, so they are not legal without it
            expect(dots(g)).to.deep.equal(["d5", "e4", "e6", "g4", "g6", "h5"]);
        });

        it("marks nothing on the Hunter's turn or once the game is over", () => {
            expect(dots(setup(["e5", "g5"], ["a1"]))).to.deep.equal([]);
            const over = setup(["b10"], ["c1"], { turn: 2 });
            over.move("a10");
            expect(dots(over)).to.deep.equal([]);
        });
    });

    describe("displays", () => {
        it("draws a plain vertex board by default and crossed points on request", () => {
            const g = new OutboundGame();
            expect((g.render().board as { style: string }).style).to.equal("vertex");
            expect((g.render({ altDisplays: ["cross"] }).board as { style: string }).style).to.equal("vertex-cross");
        });
    });

    describe("end of game", () => {
        it("gives Black the win when the king reaches the edge", () => {
            const g = setup(["b10"], ["c1"], { turn: 2 });
            g.move("a10");
            expect(g.gameover).to.be.true;
            expect(g.winner).to.deep.equal([2]);
        });

        it("counts any king stone on the edge", () => {
            const g = setup(["b10", "a10"], ["c1"], { turn: 2 });
            // a10 was already on the edge; a king stone there ends the game after Black's turn
            g.move("c10");
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
            const g = new OutboundGame();
            g.move("a1");
            g.move("s19");
            g.move("a1-a3");
            g.move("j11");
            expect(g.board.get("j11")).to.equal("B");
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
