/**
 * Wall-clock time for individual Mocha test files (no pretest).
 *
 *   node scripts/bench-mocha-files.mjs
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const files = [
    "test/games/thuemorsego.test.ts",
    "test/games/crosshairs.test.ts",
    "test/games/canoe.test.ts",
    "test/games/arimaa.test.ts",
    "test/games/icepalace.test.ts",
    "test/games/killallgo.test.ts",
    "test/games/squares.test.ts",
    "test/games/agofmars.test.ts",
    "test/games/homeworlds.test.ts",
    "test/games/acity.test.ts",
    "test/games/acity-golden.test.ts",
    "test/games/storisende.test.ts",
    "test/games/storisende.storage.test.ts",
    "test/games/evenatodds.test.ts",
    "test/games/_base.test.ts",
];

const mochaArgs = ["mocha", "--no-config", "--require", "tsx/cjs", "--extension", "ts"];

const results = [];

for (const file of files) {
    const start = Date.now();
    const r = spawnSync("npx", [...mochaArgs, file], {
        cwd: process.cwd(),
        shell: false,
        encoding: "utf8",
        env: { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS ?? "" },
    });
    const ms = Date.now() - start;
    const ok = r.status === 0;
    console.log(`${ok ? "OK" : "FAIL"} ${(ms / 1000).toFixed(1)}s  ${file}`);
    if (!ok) {
        console.log(r.stderr?.slice(-500) ?? r.stdout?.slice(-500));
    }
    results.push({ file, ms, ok, status: r.status ?? 1 });
}

results.sort((a, b) => b.ms - a.ms);

const lines = [
    "# Mocha file timing audit (generated)",
    "",
    `Date: ${new Date().toISOString().slice(0, 10)}`,
    "",
    "| seconds | status | file |",
    "|--------:|--------|------|",
];
for (const r of results) {
    lines.push(`| ${(r.ms / 1000).toFixed(1)} | ${r.ok ? "pass" : "fail"} | ${r.file} |`);
}
writeFileSync(join("bin", "performance-audit-mocha.md"), lines.join("\n"), "utf8");
console.log("\nWrote bin/performance-audit-mocha.md");
