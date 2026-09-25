import "mocha";
import { expect } from "chai";
import { ThricewiseGame } from "../../src/games/thricewise";
import { SIMULTANEOUS_ELIM_TOKEN } from "../../src/games/_turn-simultaneous";
import { scorePlacement, threesomeValue } from "../../src/games/thricewise/scoring";
import { QuincunxBoard } from "../../src/games/quincunx/board";
import { QuincunxCard } from "../../src/games/quincunx/card";
import { cardsBasic } from "../../src/common/decktet";

function cardsOfRank(seq: number): string[] {
    return cardsBasic.filter(c => c.rank.seq === seq).map(c => c.uid);
}

describe("Thricewise", () => {
    it("turnModel is sequenced", () => {
        const g = new ThricewiseGame(2);
        expect(g.turnModel()).to.equal("sequenced");
    });

    it("handleClick selects a card from the correct hand", () => {
        const g = new ThricewiseGame(2);
        const uid = g.hands[1][0]!;
        const result = g.handleClick("", -1, -1, `c${uid}`);
        expect(result.valid).to.equal(true);
        expect(result.move).to.equal(uid);
    });

    it("renders after a JSON state round-trip (trickCard undefined → null)", () => {
        const g = new ThricewiseGame(2);
        const g2 = new ThricewiseGame(JSON.stringify(g.state()));
        const rep = g2.render();
        const legendKeys = new Set(Object.keys(rep.legend));
        for (const area of rep.areas ?? []) {
            for (const piece of area.pieces ?? []) {
                expect(legendKeys.has(piece), piece).to.equal(true);
            }
        }
    });

    it("opens 2x2 for two players and 2x3 for three", () => {
        const g2 = new ThricewiseGame(2);
        expect(g2.board.cards.length).to.equal(4);
        const g3 = new ThricewiseGame(3);
        expect(g3.board.cards.length).to.equal(6);
    });

    it("defers duplicate ranks and orders distinct ranks", () => {
        const g = new ThricewiseGame(3);
        const twos = cardsOfRank(2);
        const fives = cardsOfRank(5);
        g.hands = [[twos[0], fives[0]], [twos[1], fives[1]], [fives[2], fives[3]]];
        g.move(`${twos[0]},${twos[1]},${fives[2]}`);
        expect(g.phase).to.equal("place");
        expect(g.deferred[0][0]).to.equal(twos[0]);
        expect(g.deferred[1][0]).to.equal(twos[1]);
        expect(g.playQueue).to.deep.equal([3]);
        expect(g.currplayer).to.equal(3);
    });

    it("advances play queue once per compound placement ply", () => {
        const g = new ThricewiseGame(2);
        const threes = cardsOfRank(3);
        const fives = cardsOfRank(5);
        g.hands = [[threes[0], threes[1]], [fives[0], fives[1]]];
        g.move(`${threes[0]},${fives[0]}`);
        expect(g.playQueue).to.deep.equal([1, 2]);
        const empty = g.legalEmpties()[0]!;
        g.move(`${threes[0]}@${empty[0]}.${empty[1]},${SIMULTANEOUS_ELIM_TOKEN}`);
        expect(g.board.cards.some(c => c.card.uid === threes[0])).to.equal(true);
        expect(g.playQueue).to.deep.equal([2]);
        expect(g.currplayer).to.equal(2);
    });

    it("applies partial compound placement on the board", () => {
        const g = new ThricewiseGame(2);
        const twos = cardsOfRank(2);
        const threes = cardsOfRank(3);
        g.phase = "place";
        g.currplayer = 1;
        g.playQueue = [1];
        g.deferred[0] = [twos[0]];
        g.trickCard[0] = threes[0];
        g.hands[0] = [];
        const e1 = g.legalEmpties()[0]!;
        const token = `${twos[0]}@${e1[0]}.${e1[1]}`;
        const before = g.board.cards.length;
        g.move(`${token},${SIMULTANEOUS_ELIM_TOKEN}`, { partial: true });
        expect(g.board.cards.length).to.equal(before + 1);
    });

    it("legal empties respect the 6x6 cap", () => {
        const g = new ThricewiseGame(2);
        for (const [x, y] of g.legalEmpties()) {
            const w = Math.max(g.board.maxX, x) - Math.min(g.board.minX, x) + 1;
            const h = Math.max(g.board.maxY, y) - Math.min(g.board.minY, y) + 1;
            expect(w).to.be.at.most(6);
            expect(h).to.be.at.most(6);
        }
    });

    it("randomMove always submits a complete placement ply", () => {
        const g = new ThricewiseGame(3);
        const fours = cardsOfRank(4);
        const fives = cardsOfRank(5);
        const nines = cardsOfRank(9);
        g.hands = [
            [fives[0], fours[0], nines[0]],
            [fours[1], fives[1], nines[1]],
            [nines[2], fives[2], fours[2]],
        ];
        g.move(`${fives[0]},${fours[1]},${nines[2]}`);
        expect(g.phase).to.equal("place");
        let guard = 0;
        while (g.phase === "place" && guard++ < 20) {
            const active = g.currplayer;
            const m = g.randomMove();
            const part = m.split(",")[active - 1]!;
            const v = g.validateMove(part, active as 1 | 2 | 3);
            expect(v.valid, part).to.equal(true);
            expect(v.complete, part).to.equal(1);
            g.move(m);
        }
    });

    it("rejects a compound placement that would exceed a 6×6 bounding box", () => {
        const g = new ThricewiseGame(2);
        const twos = cardsOfRank(2);
        const threes = cardsOfRank(3);
        g.phase = "place";
        g.currplayer = 1;
        g.playQueue = [1];
        g.deferred[0] = [twos[0], threes[0]];
        g.hands[0] = [];
        let i = 0;
        while (g.board.cards.length < 30) {
            const empty = g.legalEmpties()[0];
            if (empty === undefined) {
                break;
            }
            g.board.add(new QuincunxCard({ x: empty[0], y: empty[1], card: cardsBasic[i++]! }));
        }
        const top = g.board.maxY + 1;
        const token = `${twos[0].toUpperCase()}@${g.board.minX}.${top};${threes[0].toUpperCase()}@${g.board.minX}.${top + 1}`;
        const v = g.validateMove(token, 1);
        expect(v.valid).to.equal(false);
    });

    it("random playout reaches game over without throwing", () => {
        for (let trial = 0; trial < 5; trial++) {
            const g = new ThricewiseGame(5);
            let plies = 0;
            while (!g.gameover && plies < 500) {
                g.move(g.randomMove());
                plies++;
            }
            expect(g.gameover).to.equal(true);
        }
    });

    it("deck area excludes cards visible to the observer", () => {
        const g = new ThricewiseGame(2);
        const rep = g.render({ perspective: 1 });
        const deckArea = rep.areas?.find(
            a => typeof a.label === "object" && a.label.textKey === "apgames:validation.thricewise.LABEL_DECK",
        );
        expect(deckArea).to.not.equal(undefined);
        const onboard = g.board.cards.length;
        const ownHand = g.hands[0].filter(uid => uid !== "").length;
        expect(deckArea!.pieces!.length).to.equal(36 - onboard - ownHand);
        const omniscient = g.render();
        const deckAll = omniscient.areas!.find(
            a => typeof a.label === "object" && a.label.textKey === "apgames:validation.thricewise.LABEL_DECK",
        )!;
        const bothHands = g.hands.flat().filter(uid => uid !== "").length;
        expect(deckAll.pieces!.length).to.equal(36 - onboard - bothHands);
    });

    it("viewport 6 allows neighbors outside a solid 5×5 block (Jacynth stays at 5)", () => {
        expect(new ThricewiseGame(2).board.viewportSize).to.equal(6);
        const jacynth = new QuincunxBoard();
        const thricewise = new QuincunxBoard(6);
        let i = 0;
        for (let y = 0; y < 5; y++) {
            for (let x = 0; x < 5; x++) {
                const card = cardsBasic[i++]!;
                jacynth.add(new QuincunxCard({ x, y, card }));
                thricewise.add(new QuincunxCard({ x, y, card }));
            }
        }
        expect(jacynth.empties.length).to.equal(0);
        expect(thricewise.empties.length).to.be.greaterThan(0);
    });
});

describe("Thricewise scoring", () => {
    it("values a straight by the lowest number rank", () => {
        const eights = cardsOfRank(8);
        const nines = cardsOfRank(9);
        const crowns = cardsOfRank(10);
        expect(threesomeValue([eights[0], nines[0], crowns[0]])).to.equal(8);
    });

    it("scores a placed line of three", () => {
        const eights = cardsOfRank(8);
        const nines = cardsOfRank(9);
        const crowns = cardsOfRank(10);
        const board = new QuincunxBoard();
        board.add(new QuincunxCard({ x: 0, y: 0, card: cardsBasic.find(c => c.uid === eights[0])! }));
        board.add(new QuincunxCard({ x: 1, y: 0, card: cardsBasic.find(c => c.uid === nines[0])! }));
        const placed = new QuincunxCard({
            x: 2,
            y: 0,
            card: cardsBasic.find(c => c.uid === crowns[0])!,
        });
        board.add(placed);
        expect(scorePlacement(board, placed)).to.be.greaterThan(0);
    });
});
