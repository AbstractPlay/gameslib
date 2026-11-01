/**
 * Alien City perf snapshot. Run: npx tsx scripts/bench-acity.ts
 */
/* eslint-disable no-console -- CLI benchmark output */
import { performance } from "node:perf_hooks";
import { addResource } from "../src/index.js";
import { ACITY_GOLDEN_FIXTURES, gameFromGoldenFixture } from "../test/fixtures/acity-golden.js";

function ms(fn: () => void, iterations: number): number {
    const t0 = performance.now();
    for (let i = 0; i < iterations; i++) {
        fn();
    }
    return (performance.now() - t0) / iterations;
}

addResource("en");

const freshSpec = ACITY_GOLDEN_FIXTURES.find((f) => f.id === "fresh-open")!;
const scoringSpec = ACITY_GOLDEN_FIXTURES.find((f) => f.id === "scoring-customers")!;
const pinchSpec = ACITY_GOLDEN_FIXTURES.find((f) => f.id === "road-pinch-open")!;

console.log(JSON.stringify({
    movesFreshOpenMs: ms(() => {
        gameFromGoldenFixture(freshSpec).moves();
    }, 5),
    validatePassFreshOpenMs: ms(() => {
        gameFromGoldenFixture(freshSpec).validateMove("pass");
    }, 20),
    scoresScoringFixtureMs: ms(() => {
        const g = gameFromGoldenFixture(scoringSpec);
        g.getPlayerScore(1);
        g.getPlayerScore(2);
    }, 50),
    isConnectedPinchMs: ms(() => {
        gameFromGoldenFixture(pinchSpec).isConnected();
    }, 100),
    placementGridSampleMs: ms(() => {
        const g = gameFromGoldenFixture(freshSpec);
        g.goldenPlacementResult("ND", "b9");
        g.goldenPlacementResult("RT", "c5");
        g.goldenPlacementResult("BD", "d7");
    }, 200),
}, null, 2));
