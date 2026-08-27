import "mocha";
import { expect } from "chai";
import seedrandom from "seedrandom";
import { GameRng } from "../../src/common/rng";
import { generateChallengeSeed, resolveChallengeSeed } from "../../src/common/challenge-seed";
import { shuffle } from "../../src/common/shuffle";
import { randomInt } from "../../src/common";

describe("GameRng", () => {
    const SEED = "solo-rng-golden-20260825";

    it("reproduces alea draws for a known seed and sequence", () => {
        const alea = seedrandom.alea(SEED);
        const rng = new GameRng(SEED);
        const expected = [alea(), alea(), alea(), alea()];
        const actual = [rng.random(), rng.random(), rng.random(), rng.random()];
        expect(actual).to.deep.equal(expected);
        expect(rng.getCounter()).to.equal(4);
    });

    it("restore(seed, counter) continues the same stream", () => {
        const baseline = new GameRng(SEED);
        for (let i = 0; i < 7; i++) {
            baseline.randomInt(6);
        }
        const counter = baseline.getCounter();
        const nextFromBaseline = baseline.randomInt(6);

        const restored = new GameRng(SEED, counter);
        expect(restored.randomInt(6)).to.equal(nextFromBaseline);
    });

    it("restore matches uninterrupted play", () => {
        const full = new GameRng(SEED);
        for (let i = 0; i < 8; i++) {
            full.randomInt(6);
        }
        const nextFromFull = full.randomInt(6);
        const counter = full.getCounter() - 1;

        const fork = new GameRng(SEED, counter);
        expect(fork.randomInt(6)).to.equal(nextFromFull);
    });

    it("shuffle is stable for a seed", () => {
        const items = ["a", "b", "c", "d", "e", "f", "g"];
        const a = new GameRng(SEED).shuffle(items);
        const b = new GameRng(SEED).shuffle(items);
        expect(a).to.deep.equal(b);
        expect(a).to.not.deep.equal(items);
    });

    it("counter increases monotonically through mixed ops", () => {
        const rng = new GameRng(SEED);
        expect(rng.getCounter()).to.equal(0);
        rng.random();
        expect(rng.getCounter()).to.equal(1);
        rng.randomInt(10);
        expect(rng.getCounter()).to.equal(2);
        rng.shuffle([1, 2, 3]);
        expect(rng.getCounter()).to.be.greaterThan(2);
    });
});

describe("challenge seed helpers", () => {
    it("resolveChallengeSeed returns provided non-empty string", () => {
        expect(resolveChallengeSeed("daily-20260819")).to.equal("daily-20260819");
    });

    it("resolveChallengeSeed generates when omitted or empty", () => {
        const seed = resolveChallengeSeed();
        expect(seed.length).to.be.greaterThan(0);
        const fromEmpty = resolveChallengeSeed("");
        expect(fromEmpty.length).to.be.greaterThan(0);
    });

    it("generateChallengeSeed returns unique ids", () => {
        const a = generateChallengeSeed();
        const b = generateChallengeSeed();
        expect(a).to.not.equal(b);
    });
});

describe("randomInt/shuffle optional GameRng", () => {
    it("randomInt uses GameRng when provided", () => {
        const rng = new GameRng("int-test");
        const v1 = randomInt(6, 1, rng);
        const v2 = randomInt(6, 1, rng);
        expect(v1).to.be.at.least(1).and.at.most(6);
        expect(v2).to.be.at.least(1).and.at.most(6);
        expect(rng.getCounter()).to.equal(2);
    });

    it("shuffle uses GameRng when provided", () => {
        const rng = new GameRng("shuffle-test");
        const before = rng.getCounter();
        shuffle([1, 2, 3, 4], rng);
        expect(rng.getCounter()).to.be.greaterThan(before);
    });
});
