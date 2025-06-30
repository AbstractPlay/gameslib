/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { QuincunxGame } from '../../src/games';
import { QuincunxBoard } from "../../src/games/quincunx/board";
import { QuincunxCard } from "../../src/games/quincunx/card";
import { Card } from "../../src/common/decktet";

type Scores = {
    basics: [string,number][];
    draws: number;
    pairs: number;
    straights: number;
    sets: number;
    flushes: number;
    powerplay: boolean;
    powerplayScore: number;
};

describe("Quincunx", () => {
    it ("Basic scoring (w/ draws)", () => {
        const g = new QuincunxGame(2, ["excuse"]);
        let board: QuincunxBoard;
        let card: QuincunxCard;
        let scores: Scores;

        // 2-9, matching ace (add; placing number card)
        board = new QuincunxBoard();
        card = new QuincunxCard({x: 0, y: 0, card: Card.deserialize("1M")!});
        board.add(card);
        card = new QuincunxCard({x: 1, y: 0, card: Card.deserialize("3MV")!});
        board.add(card);
        g.board = board;
        scores = g.scorePlacement(card);
        expect(scores.basics.length).equal(1);
        expect(scores.basics[0][1]).equal(4);
        expect(scores.draws).equal(0);

        // 2-9, matching ace (add; placing the ace)
        board = new QuincunxBoard();
        card = new QuincunxCard({x: 1, y: 0, card: Card.deserialize("6SY")!});
        board.add(card);
        card = new QuincunxCard({x: 0, y: 0, card: Card.deserialize("1Y")!});
        board.add(card);
        g.board = board;
        scores = g.scorePlacement(card);
        expect(scores.basics.length).equal(1);
        expect(scores.basics[0][1]).equal(7);
        expect(scores.draws).equal(0);

        // 2-9, no matching ace (subtract)
        board = new QuincunxBoard();
        card = new QuincunxCard({x: 0, y: 0, card: Card.deserialize("2SY")!});
        board.add(card);
        card = new QuincunxCard({x: 1, y: 0, card: Card.deserialize("3MV")!});
        board.add(card);
        g.board = board;
        scores = g.scorePlacement(card);
        expect(scores.basics.length).equal(1);
        expect(scores.basics[0][1]).equal(-5);
        expect(scores.draws).equal(0);

        // 10 (zero)
        board = new QuincunxBoard();
        card = new QuincunxCard({x: 0, y: 0, card: Card.deserialize("5SV")!});
        board.add(card);
        card = new QuincunxCard({x: 1, y: 0, card: Card.deserialize("5YK")!});
        board.add(card);
        g.board = board;
        scores = g.scorePlacement(card);
        expect(scores.basics.length).equal(1);
        expect(scores.basics[0][1]).equal(0);
        expect(scores.draws).equal(0);

        // 11 (draw)
        board = new QuincunxBoard();
        card = new QuincunxCard({x: 0, y: 0, card: Card.deserialize("5SV")!});
        board.add(card);
        card = new QuincunxCard({x: 1, y: 0, card: Card.deserialize("6SY")!});
        board.add(card);
        g.board = board;
        scores = g.scorePlacement(card);
        expect(scores.basics.length).equal(1);
        expect(scores.basics[0][1]).equal(0);
        expect(scores.draws).equal(1);

        // 12-19 (add)
        board = new QuincunxBoard();
        card = new QuincunxCard({x: 0, y: 0, card: Card.deserialize("7SK")!});
        board.add(card);
        card = new QuincunxCard({x: 1, y: 0, card: Card.deserialize("8VL")!});
        board.add(card);
        g.board = board;
        scores = g.scorePlacement(card);
        expect(scores.basics.length).equal(1);
        expect(scores.basics[0][1]).equal(5);
        expect(scores.draws).equal(0);

        // 20 (draw)
        board = new QuincunxBoard();
        card = new QuincunxCard({x: 0, y: 0, card: Card.deserialize("NK")!});
        board.add(card);
        card = new QuincunxCard({x: 1, y: 0, card: Card.deserialize("NY")!});
        board.add(card);
        g.board = board;
        scores = g.scorePlacement(card);
        expect(scores.basics.length).equal(1);
        expect(scores.basics[0][1]).equal(0);
        expect(scores.draws).equal(1);

        // no basic scoring against excuse
        board = new QuincunxBoard();
        card = new QuincunxCard({x: 0, y: 0, card: Card.deserialize("0")!});
        board.add(card);
        card = new QuincunxCard({x: 1, y: 0, card: Card.deserialize("NY")!});
        board.add(card);
        g.board = board;
        scores = g.scorePlacement(card);
        expect(scores.basics.length).equal(0);
        // expect(scores.basics[0][1]).equal(0);
        expect(scores.draws).equal(0);

        board = new QuincunxBoard();
        card = new QuincunxCard({x: 0, y: 0, card: Card.deserialize("NK")!});
        board.add(card);
        card = new QuincunxCard({x: 1, y: 0, card: Card.deserialize("0")!});
        board.add(card);
        g.board = board;
        scores = g.scorePlacement(card);
        expect(scores.basics.length).equal(0);
        // expect(scores.basics[0][1]).equal(0);
        expect(scores.draws).equal(0);
    });

    it("Pairs & Sets", () => {
        const g = new QuincunxGame(2);
        let board: QuincunxBoard;
        let card: QuincunxCard;
        let scores: Scores;

        // one pair
        board = new QuincunxBoard();
        card = new QuincunxCard({x: 0, y: 0, card: Card.deserialize("2MK")!});
        board.add(card);
        card = new QuincunxCard({x: 1, y: 0, card: Card.deserialize("2VL")!});
        board.add(card);
        g.board = board;
        scores = g.scorePlacement(card);
        expect(scores.pairs).equal(1);

        // pairs are orthogonal only
        board = new QuincunxBoard();
        card = new QuincunxCard({x: 0, y: 0, card: Card.deserialize("2MK")!});
        board.add(card);
        card = new QuincunxCard({x: 1, y: 1, card: Card.deserialize("2VL")!});
        board.add(card);
        g.board = board;
        scores = g.scorePlacement(card);
        expect(scores.pairs).equal(0);

        // two pairs
        board = new QuincunxBoard();
        card = new QuincunxCard({x: 0, y: 0, card: Card.deserialize("2MK")!});
        board.add(card);
        card = new QuincunxCard({x: 1, y: 1, card: Card.deserialize("2SY")!});
        board.add(card);
        card = new QuincunxCard({x: 1, y: 0, card: Card.deserialize("2VL")!});
        board.add(card);
        g.board = board;
        scores = g.scorePlacement(card);
        expect(scores.pairs).equal(2);

        // one triple
        board = new QuincunxBoard();
        card = new QuincunxCard({x: 0, y: 0, card: Card.deserialize("2MK")!});
        board.add(card);
        card = new QuincunxCard({x: 1, y: 0, card: Card.deserialize("2SY")!});
        board.add(card);
        card = new QuincunxCard({x: 2, y: 0, card: Card.deserialize("2VL")!});
        board.add(card);
        g.board = board;
        scores = g.scorePlacement(card);
        expect(scores.pairs).equal(0);
        expect(scores.sets).equal(1);

        // one four-in-a-row
        board = new QuincunxBoard();
        card = new QuincunxCard({x: 0, y: 0, card: Card.deserialize("NV")!});
        board.add(card);
        card = new QuincunxCard({x: 0, y: 1, card: Card.deserialize("NL")!});
        board.add(card);
        card = new QuincunxCard({x: 0, y: 2, card: Card.deserialize("NY")!});
        board.add(card);
        card = new QuincunxCard({x: 0, y: 3, card: Card.deserialize("NK")!});
        board.add(card);
        g.board = board;
        scores = g.scorePlacement(card);
        expect(scores.pairs).equal(0);
        expect(scores.sets).equal(1);

        // two triples
        board = new QuincunxBoard();
        card = new QuincunxCard({x: 0, y: 0, card: Card.deserialize("NV")!});
        board.add(card);
        card = new QuincunxCard({x: 0, y: 1, card: Card.deserialize("NL")!});
        board.add(card);
        card = new QuincunxCard({x: 1, y: -1, card: Card.deserialize("NY")!});
        board.add(card);
        card = new QuincunxCard({x: 2, y: -1, card: Card.deserialize("NK")!});
        board.add(card);
        card = new QuincunxCard({x: 0, y: -1, card: Card.deserialize("NS")!});
        board.add(card);
        g.board = board;
        scores = g.scorePlacement(card);
        expect(scores.pairs).equal(0);
        expect(scores.sets).equal(2);

        // two triples + one pair (maximum possible)
        board = new QuincunxBoard();
        card = new QuincunxCard({x: 0, y: 0, card: Card.deserialize("NV")!});
        board.add(card);
        card = new QuincunxCard({x: 0, y: 1, card: Card.deserialize("NL")!});
        board.add(card);
        card = new QuincunxCard({x: 1, y: 0, card: Card.deserialize("NY")!});
        board.add(card);
        card = new QuincunxCard({x: 2, y: 1, card: Card.deserialize("NK")!});
        board.add(card);
        card = new QuincunxCard({x: 1, y: -1, card: Card.deserialize("NM")!});
        board.add(card);
        card = new QuincunxCard({x: 0, y: -1, card: Card.deserialize("NS")!});
        board.add(card);
        g.board = board;
        scores = g.scorePlacement(card);
        expect(scores.pairs).equal(1);
        expect(scores.sets).equal(2);
    });

    it("Straights", () => {
        const g = new QuincunxGame(2, ["excuse"]);
        let board: QuincunxBoard;
        let card: QuincunxCard;
        let scores: Scores;

        // out of order
        board = new QuincunxBoard();
        card = new QuincunxCard({x: 0, y: 0, card: Card.deserialize("2MK")!});
        board.add(card);
        card = new QuincunxCard({x: 1, y: 0, card: Card.deserialize("4VL")!});
        board.add(card);
        card = new QuincunxCard({x: 2, y: 0, card: Card.deserialize("3MV")!});
        board.add(card);
        g.board = board;
        scores = g.scorePlacement(card);
        expect(scores.straights).equal(0);

        // wraps
        board = new QuincunxBoard();
        card = new QuincunxCard({x: 0, y: 0, card: Card.deserialize("9MS")!});
        board.add(card);
        card = new QuincunxCard({x: 2, y: 0, card: Card.deserialize("NK")!});
        board.add(card);
        card = new QuincunxCard({x: 1, y: 0, card: Card.deserialize("1M")!});
        board.add(card);
        g.board = board;
        scores = g.scorePlacement(card);
        expect(scores.straights).equal(0);

        // includes Excuse
        board = new QuincunxBoard();
        card = new QuincunxCard({x: 0, y: 0, card: Card.deserialize("0")!});
        board.add(card);
        card = new QuincunxCard({x: 1, y: 0, card: Card.deserialize("1M")!});
        board.add(card);
        card = new QuincunxCard({x: 2, y: 0, card: Card.deserialize("2MK")!});
        board.add(card);
        g.board = board;
        scores = g.scorePlacement(card);
        expect(scores.straights).equal(0);

        // start with placed
        board = new QuincunxBoard();
        card = new QuincunxCard({x: 0, y: 0, card: Card.deserialize("2MK")!});
        board.add(card);
        card = new QuincunxCard({x: 1, y: 0, card: Card.deserialize("3MV")!});
        board.add(card);
        card = new QuincunxCard({x: 2, y: 0, card: Card.deserialize("4VL")!});
        board.add(card);
        g.board = board;
        scores = g.scorePlacement(card);
        expect(scores.straights).equal(1);

        // spans placed
        board = new QuincunxBoard();
        card = new QuincunxCard({x: -2, y: -2, card: Card.deserialize("2MK")!});
        board.add(card);
        card = new QuincunxCard({x: -1, y: -1, card: Card.deserialize("3MV")!});
        board.add(card);
        card = new QuincunxCard({x: 1, y: 1, card: Card.deserialize("5YK")!});
        board.add(card);
        card = new QuincunxCard({x: 2, y: 2, card: Card.deserialize("6MV")!});
        board.add(card);
        card = new QuincunxCard({x: 0, y: 0, card: Card.deserialize("4VL")!});
        board.add(card);
        g.board = board;
        scores = g.scorePlacement(card);
        expect(scores.straights).equal(1);

        // two straights
        board = new QuincunxBoard();
        card = new QuincunxCard({x: -2, y: -2, card: Card.deserialize("2MK")!});
        board.add(card);
        card = new QuincunxCard({x: -1, y: -1, card: Card.deserialize("3MV")!});
        board.add(card);
        card = new QuincunxCard({x: 1, y: 0, card: Card.deserialize("5YK")!});
        board.add(card);
        card = new QuincunxCard({x: 2, y: 0, card: Card.deserialize("6MV")!});
        board.add(card);
        card = new QuincunxCard({x: 0, y: 0, card: Card.deserialize("4VL")!});
        board.add(card);
        g.board = board;
        scores = g.scorePlacement(card);
        expect(scores.straights).equal(2);
    });

    it("Flushes", () => {
        const g = new QuincunxGame(2, ["flush"]);
        let board: QuincunxBoard;
        let card: QuincunxCard;
        let scores: Scores;

        // three not enough
        board = new QuincunxBoard();
        card = new QuincunxCard({x: 0, y: 0, card: Card.deserialize("2MK")!});
        board.add(card);
        card = new QuincunxCard({x: 1, y: 0, card: Card.deserialize("3MV")!});
        board.add(card);
        card = new QuincunxCard({x: 2, y: 0, card: Card.deserialize("4MS")!});
        board.add(card);
        g.board = board;
        scores = g.scorePlacement(card);
        expect(scores.flushes).equal(0);

        // four in a row
        board = new QuincunxBoard();
        card = new QuincunxCard({x: 0, y: 0, card: Card.deserialize("2MK")!});
        board.add(card);
        card = new QuincunxCard({x: 1, y: 0, card: Card.deserialize("3MV")!});
        board.add(card);
        card = new QuincunxCard({x: 2, y: 0, card: Card.deserialize("4MS")!});
        board.add(card);
        card = new QuincunxCard({x: 3, y: 0, card: Card.deserialize("8MS")!});
        board.add(card);
        g.board = board;
        scores = g.scorePlacement(card);
        expect(scores.flushes).equal(1);

        // four in a row (BUG CHECK!!)
        board = new QuincunxBoard();
        card = new QuincunxCard({x: -1, y: -1, card: Card.deserialize("7ML")!});
        board.add(card);
        card = new QuincunxCard({x: 0, y: -1, card: Card.deserialize("6SY")!});
        board.add(card);
        card = new QuincunxCard({x: -3, y: -1, card: Card.deserialize("NS")!});
        board.add(card);
        card = new QuincunxCard({x: -2, y: -1, card: Card.deserialize("9MS")!});
        board.add(card);
        g.board = board;
        scores = g.scorePlacement(card);
        expect(scores.flushes).equal(0);

        // another bug check
        board = new QuincunxBoard();
        card = new QuincunxCard({x: -3, y: 1, card: Card.deserialize("6SY")!});
        board.add(card);
        card = new QuincunxCard({x: -2, y: 0, card: Card.deserialize("7SK")!});
        board.add(card);
        card = new QuincunxCard({x: -1, y: -1, card: Card.deserialize("8VL")!});
        board.add(card);
        card = new QuincunxCard({x: 0, y: -2, card: Card.deserialize("9MS")!});
        board.add(card);
        card = new QuincunxCard({x: 1, y: -3, card: Card.deserialize("NS")!});
        board.add(card);
        g.board = board;
        scores = g.scorePlacement(card);
        expect(scores.flushes).equal(0);

        // another bug check
        board = new QuincunxBoard();
        card = new QuincunxCard({x: 1, y: 0, card: Card.deserialize("NK")!});
        board.add(card);
        card = new QuincunxCard({x: 0, y: 0, card: Card.deserialize("9LK")!});
        board.add(card);
        card = new QuincunxCard({x: -1, y: 0, card: Card.deserialize("8MS")!});
        board.add(card);
        card = new QuincunxCard({x: -2, y: 0, card: Card.deserialize("7SK")!});
        board.add(card);
        g.board = board;
        scores = g.scorePlacement(card);
        expect(scores.flushes).equal(0);

        // five in a row
        board = new QuincunxBoard();
        card = new QuincunxCard({x: 0, y: 0, card: Card.deserialize("2MK")!});
        board.add(card);
        card = new QuincunxCard({x: 1, y: 0, card: Card.deserialize("3MV")!});
        board.add(card);
        card = new QuincunxCard({x: 2, y: 0, card: Card.deserialize("4MS")!});
        board.add(card);
        card = new QuincunxCard({x: 3, y: 0, card: Card.deserialize("8MS")!});
        board.add(card);
        card = new QuincunxCard({x: 4, y: 0, card: Card.deserialize("NM")!});
        board.add(card);
        g.board = board;
        scores = g.scorePlacement(card);
        expect(scores.flushes).equal(1);

        // four in a square
        board = new QuincunxBoard();
        card = new QuincunxCard({x: 0, y: 0, card: Card.deserialize("2MK")!});
        board.add(card);
        card = new QuincunxCard({x: 1, y: 0, card: Card.deserialize("3MV")!});
        board.add(card);
        card = new QuincunxCard({x: 0, y: -1, card: Card.deserialize("4MS")!});
        board.add(card);
        card = new QuincunxCard({x: 1, y: -1, card: Card.deserialize("8MS")!});
        board.add(card);
        g.board = board;
        scores = g.scorePlacement(card);
        expect(scores.flushes).equal(1);

        board = new QuincunxBoard();
        card = new QuincunxCard({x: 1, y: 0, card: Card.deserialize("3MV")!});
        board.add(card);
        card = new QuincunxCard({x: 0, y: -1, card: Card.deserialize("4MS")!});
        board.add(card);
        card = new QuincunxCard({x: 1, y: -1, card: Card.deserialize("8MS")!});
        board.add(card);
        card = new QuincunxCard({x: 0, y: 0, card: Card.deserialize("2MK")!});
        board.add(card);
        g.board = board;
        scores = g.scorePlacement(card);
        expect(scores.flushes).equal(1);

        board = new QuincunxBoard();
        card = new QuincunxCard({x: 0, y: -1, card: Card.deserialize("4MS")!});
        board.add(card);
        card = new QuincunxCard({x: 1, y: -1, card: Card.deserialize("8MS")!});
        board.add(card);
        card = new QuincunxCard({x: 0, y: 0, card: Card.deserialize("2MK")!});
        board.add(card);
        card = new QuincunxCard({x: 1, y: 0, card: Card.deserialize("3MV")!});
        board.add(card);
        g.board = board;
        scores = g.scorePlacement(card);
        expect(scores.flushes).equal(1);

        board = new QuincunxBoard();
        card = new QuincunxCard({x: 1, y: -1, card: Card.deserialize("8MS")!});
        board.add(card);
        card = new QuincunxCard({x: 0, y: 0, card: Card.deserialize("2MK")!});
        board.add(card);
        card = new QuincunxCard({x: 1, y: 0, card: Card.deserialize("3MV")!});
        board.add(card);
        card = new QuincunxCard({x: 0, y: -1, card: Card.deserialize("4MS")!});
        board.add(card);
        g.board = board;
        scores = g.scorePlacement(card);
        expect(scores.flushes).equal(1);

        // two lines
        board = new QuincunxBoard();
        card = new QuincunxCard({x: 1, y: 0, card: Card.deserialize("3MV")!});
        board.add(card);
        card = new QuincunxCard({x: 2, y: 0, card: Card.deserialize("4MS")!});
        board.add(card);
        card = new QuincunxCard({x: 3, y: 0, card: Card.deserialize("8MS")!});
        board.add(card);
        card = new QuincunxCard({x: 0, y: 1, card: Card.deserialize("NM")!});
        board.add(card);
        card = new QuincunxCard({x: 0, y: 2, card: Card.deserialize("1M")!});
        board.add(card);
        card = new QuincunxCard({x: 0, y: 3, card: Card.deserialize("5ML")!});
        board.add(card);
        card = new QuincunxCard({x: 0, y: 0, card: Card.deserialize("2MK")!});
        board.add(card);
        g.board = board;
        scores = g.scorePlacement(card);
        expect(scores.flushes).equal(2);

        // two squares
        board = new QuincunxBoard();
        card = new QuincunxCard({x: 1, y: 0, card: Card.deserialize("3MV")!});
        board.add(card);
        card = new QuincunxCard({x: 0, y: -1, card: Card.deserialize("4MS")!});
        board.add(card);
        card = new QuincunxCard({x: 1, y: -1, card: Card.deserialize("8MS")!});
        board.add(card);
        card = new QuincunxCard({x: -1, y: 0, card: Card.deserialize("NM")!});
        board.add(card);
        card = new QuincunxCard({x: -1, y: 1, card: Card.deserialize("1M")!});
        board.add(card);
        card = new QuincunxCard({x: 0, y: 1, card: Card.deserialize("5ML")!});
        board.add(card);
        card = new QuincunxCard({x: 0, y: 0, card: Card.deserialize("2MK")!});
        board.add(card);
        g.board = board;
        scores = g.scorePlacement(card);
        expect(scores.flushes).equal(2);

        // square + line
        board = new QuincunxBoard();
        card = new QuincunxCard({x: 1, y: 0, card: Card.deserialize("3MV")!});
        board.add(card);
        card = new QuincunxCard({x: 0, y: -1, card: Card.deserialize("4MS")!});
        board.add(card);
        card = new QuincunxCard({x: 1, y: -1, card: Card.deserialize("8MS")!});
        board.add(card);
        card = new QuincunxCard({x: -1, y: 0, card: Card.deserialize("NM")!});
        board.add(card);
        card = new QuincunxCard({x: -2, y: 0, card: Card.deserialize("1M")!});
        board.add(card);
        card = new QuincunxCard({x: 0, y: 0, card: Card.deserialize("2MK")!});
        board.add(card);
        g.board = board;
        scores = g.scorePlacement(card);
        expect(scores.flushes).equal(2);
    });

    it("Power Plays", () => {
        const g = new QuincunxGame(2);
        let board: QuincunxBoard;
        let card: QuincunxCard;
        let scores: Scores;

        // just two cards
        board = new QuincunxBoard();
        card = new QuincunxCard({x: 0, y: 0, card: Card.deserialize("1M")!});
        board.add(card);
        card = new QuincunxCard({x: 1, y: 0, card: Card.deserialize("3MV")!});
        board.add(card);
        g.board = board;
        scores = g.scorePlacement(card);
        expect(scores.powerplay).to.be.false;

        // powerplay with no other cards
        board = new QuincunxBoard();
        card = new QuincunxCard({x: 0, y: 0, card: Card.deserialize("1M")!});
        board.add(card);
        card = new QuincunxCard({x: 1, y: 0, card: Card.deserialize("NM")!});
        board.add(card);
        g.board = board;
        scores = g.scorePlacement(card);
        expect(scores.powerplay).to.be.true;
        expect(scores.powerplayScore).equal(0);

        // powerplay with other cards
        board = new QuincunxBoard();
        card = new QuincunxCard({x: 0, y: 0, card: Card.deserialize("1M")!});
        board.add(card);
        card = new QuincunxCard({x: 2, y: 0, card: Card.deserialize("2MK")!});
        board.add(card);
        card = new QuincunxCard({x: 1, y: 0, card: Card.deserialize("NM")!});
        board.add(card);
        g.board = board;
        scores = g.scorePlacement(card);
        expect(scores.powerplay).to.be.true;
        expect(scores.powerplayScore).equal(2);

        // powerplays are orthogonal only
        // powerplay with no other cards
        board = new QuincunxBoard();
        card = new QuincunxCard({x: 0, y: 0, card: Card.deserialize("1M")!});
        board.add(card);
        card = new QuincunxCard({x: 1, y: 1, card: Card.deserialize("NM")!});
        board.add(card);
        g.board = board;
        scores = g.scorePlacement(card);
        expect(scores.powerplay).to.be.false;
        expect(scores.powerplayScore).equal(0);
    });
});

