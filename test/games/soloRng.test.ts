import "mocha";
import { expect } from "chai";
import { playSoloRngRolls, soloRngFactory, SoloRngFake } from "../fixtures/solo/rngFixture";
import { assertReplayMatches, replayToStackIndex } from "../../src/common/replay";
import { Deck, cardsBasic, cardsExtended } from "../../src/common/decktet";
import { GameRng } from "../../src/common/rng";

const SEED = "catch-up-seed-20260825";

describe("solo RNG replay and catch-up", () => {
    it("same seed produces identical stack[0] opening", () => {
        const a = new SoloRngFake(undefined, SEED);
        const b = new SoloRngFake(undefined, SEED);
        expect(a.stack[0].roll).to.equal(b.stack[0].roll);
        expect(a.stack[0].rngCounter).to.equal(b.stack[0].rngCounter);
    });

    it("seed + moves reproduces golden stack", () => {
        const moves = Array.from({ length: 6 }, () => "roll");
        const golden = playSoloRngRolls(SEED, 6);
        assertReplayMatches(soloRngFactory, SEED, moves, golden.stack);
    });

    it("replayToStackIndex matches full play", () => {
        const full = playSoloRngRolls(SEED, 8);
        const replayed = replayToStackIndex(full, 5);
        expect(replayed.stack.length).to.equal(5);
        for (let i = 0; i < 5; i++) {
            expect((replayed.stack[i] as { roll?: number }).roll)
                .to.equal((full.stack[i] as { roll?: number }).roll);
        }
    });

    it("mid-game load continues identical next roll", () => {
        const full = playSoloRngRolls(SEED, 9);
        const fork = full.load(8);
        fork.move("roll", { trusted: true });
        const fullRoll = (full.stack[9] as { roll?: number }).roll;
        const forkRoll = (fork.stack[9] as { roll?: number }).roll;
        expect(forkRoll).to.equal(fullRoll);
    });
});

describe("solo deck draw-order persistence", () => {
    it("reload with serialized pile matches next draw", () => {
        const rng = new GameRng("deck-order-seed");
        const deck = new Deck([...cardsBasic, ...cardsExtended]);
        deck.shuffle(rng);
        deck.draw(5).map((c) => c.uid);
        const pile = deck.serializeDrawOrder();
        const sixth = deck.draw(1)[0]?.uid;

        const restored = new Deck([...cardsBasic, ...cardsExtended]);
        restored.loadDrawOrder(pile);
        expect(restored.draw(1)[0]?.uid).to.equal(sixth);
        expect(restored.serializeDrawOrder()).to.deep.equal(pile.slice(1));
    });
});
