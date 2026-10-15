/**
 * Tumbleweed performance baseline (Phase 0). Not run in CI.
 *
 *   npm run bench:tumbleweed
 *   npm run bench:tumbleweed -- --iterations=50
 */
/* eslint-disable no-console */
import { performance } from "node:perf_hooks";
import { TumbleweedGame } from "../src/games/tumbleweed.js";
import {
    midgameBenchGame,
    openingBenchGame,
    serializedGameAtPly12,
} from "../test/fixtures/tumbleweed/bench.js";

function parseIterations(): number {
    const arg = process.argv.find((a) => a.startsWith("--iterations="));
    if (arg === undefined) {
        return 30;
    }
    const n = parseInt(arg.split("=")[1]!, 10);
    if (!Number.isFinite(n) || n < 1) {
        throw new Error(`Invalid --iterations value in ${arg}`);
    }
    return n;
}

function bench(label: string, iterations: number, fn: () => void): void {
    for (let i = 0; i < Math.min(5, iterations); i++) {
        fn();
    }
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
        fn();
    }
    const elapsed = performance.now() - start;
    const perOp = elapsed / iterations;
    console.log(`${label.padEnd(44)} ${perOp.toFixed(3)} ms/op  (${iterations} iter, ${elapsed.toFixed(1)} ms total)`);
}

function main(): void {
    const iterations = parseIterations();
    console.log(`Tumbleweed gameslib benchmark (iterations=${iterations})\n`);

    const opening = openingBenchGame();
    const mid = midgameBenchGame();
    const ply12Wire = serializedGameAtPly12();
    const ply12 = new TumbleweedGame(ply12Wire);
    const midMove = mid.moves().find((m) => m !== "pass");
    if (midMove === undefined) {
        throw new Error("midgame bench: no non-pass move");
    }

    bench("moves() opening (size 8)", iterations, () => {
        openingBenchGame().moves();
    });

    bench("moves() midgame reinforce fixture", iterations, () => {
        midgameBenchGame().moves();
    });

    bench("moves() stack depth 12", iterations, () => {
        new TumbleweedGame(ply12Wire).moves();
    });

    bench("render() midgame (influence on)", iterations, () => {
        midgameBenchGame().render();
    });

    bench("render() stack depth 12", iterations, () => {
        new TumbleweedGame(ply12Wire).render();
    });

    bench("move() legal via validateMove (midgame)", iterations, () => {
        midgameBenchGame().move(midMove, { trusted: false });
    });

    bench("load(0) from tip (stack depth 12)", iterations, () => {
        const g = new TumbleweedGame(ply12Wire);
        g.load(0);
    });

    bench("serialize() stack depth 12", iterations, () => {
        new TumbleweedGame(ply12Wire).serialize();
    });

    console.log("\nContext:");
    console.log(`  opening moves().length = ${opening.moves().length}`);
    console.log(`  midgame moves().length = ${mid.moves().length}`);
    console.log(`  ply-12 moves().length = ${ply12.moves().length}`);
    console.log(`  ply-12 serialize length = ${ply12Wire.length} chars`);
}

main();
