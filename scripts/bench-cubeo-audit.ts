/* eslint-disable no-console */
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { CUBEO_SCENARIOS } from "../test/fixtures/cubeo/scenarios.js";
import { gameFromScenario } from "../test/fixtures/cubeo/gameFromScenario.js";

function bench(label: string, fn: () => void, n = 10): number {
    for (let i = 0; i < 3; i++) {
        fn();
    }
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
        fn();
    }
    const ms = (performance.now() - t0) / n;
    console.log(`${label}: ${ms.toFixed(2)} ms/op`);
    return ms;
}

const rows: Array<{ id: string; msPerOp: number; moveCount: number }> = [];

for (const scenario of CUBEO_SCENARIOS) {
    const g = gameFromScenario(scenario);
    const moveCount = g.moves().length;
    const n = scenario.id === "opening" ? 50 : 10;
    const msPerOp = bench(`moves() ${scenario.id}`, () => {
        gameFromScenario(scenario).moves();
    }, n);
    rows.push({ id: scenario.id, msPerOp, moveCount });
}

const lines = [
    "# Cubeo move-generation baseline",
    "",
    `Date: ${new Date().toISOString().slice(0, 10)}`,
    "",
    "Regenerate: `npm run bench:cubeo`",
    "",
    "| scenario | ms/op | |moves| |",
    "|----------|------:|--------:|",
    ...rows.map((r) => `| ${r.id} | ${r.msPerOp.toFixed(2)} | ${r.moveCount} |`),
    "",
];
writeFileSync("bin/cubeo-audit.md", lines.join("\n"), "utf8");
console.log("\nWrote bin/cubeo-audit.md");
