/**
 * Cross-game move-generation and hot-path timing (not run in CI).
 *
 *   npx tsx scripts/bench-performance-audit.ts
 *   npx tsx scripts/bench-performance-audit.ts --iterations=5
 */
/* eslint-disable no-console */
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import { AccastaGame } from "../src/games/accasta.js";
import { AmazonsGame } from "../src/games/amazons.js";
import { AnacheGame } from "../src/games/anache.js";
import { CatapultGame } from "../src/games/catapult.js";
import { CrosshairsGame } from "../src/games/crosshairs.js";
import { EntrapmentGame } from "../src/games/entrapment.js";
import { HomeworldsGame } from "../src/games/homeworlds.js";
import { OrdoGame } from "../src/games/ordo.js";
import { StilettoGame } from "../src/games/stiletto.js";
import { ThueMorseGoGame } from "../src/games/thuemorsego.js";
import { YoddGame } from "../src/games/yodd.js";
import { CanoeGame } from "../src/games/canoe.js";
import { SquaresGame } from "../src/games/squares.js";
import { ACityGame } from "../src/games/acity.js";
import { BaoGame } from "../src/games/bao.js";

interface Sample {
    game: string;
    label: string;
    msPerOp: number;
    totalMs: number;
    iterations: number;
    extra?: string;
}

function parseIterations(): number {
    const arg = process.argv.find((a) => a.startsWith("--iterations="));
    if (arg === undefined) {
        return 10;
    }
    const n = parseInt(arg.split("=")[1]!, 10);
    if (!Number.isFinite(n) || n < 1) {
        throw new Error(`Invalid --iterations value in ${arg}`);
    }
    return n;
}

function bench(game: string, label: string, iterations: number, fn: () => void, extra?: string): Sample {
    for (let i = 0; i < Math.min(3, iterations); i++) {
        fn();
    }
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
        fn();
    }
    const totalMs = performance.now() - start;
    const msPerOp = totalMs / iterations;
    console.log(
        `${game.padEnd(14)} ${label.padEnd(42)} ${msPerOp.toFixed(2)} ms/op  (n=${iterations}, ${totalMs.toFixed(0)} ms)${extra ? `  ${extra}` : ""}`,
    );
    return { game, label, msPerOp, totalMs, iterations, extra };
}

function benchOnce(game: string, label: string, fn: () => void, extra?: string): Sample {
    const start = performance.now();
    fn();
    const totalMs = performance.now() - start;
    console.log(`${game.padEnd(14)} ${label.padEnd(42)} ${totalMs.toFixed(2)} ms  (once)${extra ? `  ${extra}` : ""}`);
    return { game: game, label, msPerOp: totalMs, totalMs, iterations: 1, extra };
}

function homeworldsMidgame(): HomeworldsGame {
    const g = new HomeworldsGame(2);
    g.move("homeworld g3 b2 y3");
    g.move("homeworld g2 b1 y3");
    g.move("build y north");
    g.move("build y south");
    return g;
}

function homeworldsOpening(): HomeworldsGame {
    return new HomeworldsGame(2);
}

function crosshairsAfterClouds(): CrosshairsGame {
    const g = new CrosshairsGame();
    for (let i = 0; i < 16; i++) {
        g.move(g.moves()[0]!);
    }
    return g;
}

function thuemorsePlay(g: ThueMorseGoGame, moves: string[]): ThueMorseGoGame {
    for (const m of moves) {
        g.move(m);
    }
    return g;
}

function accastaMid(): AccastaGame {
    const g = new AccastaGame();
    return g;
}

function entrapmentMid(): EntrapmentGame {
    const g = new EntrapmentGame();
    while (g.stack.length <= 4 && !g.gameover) {
        const m = g.moves();
        if (m.length === 0) {
            break;
        }
        g.move(m[0]!);
    }
    return g;
}

function canoePlayMid(): CanoeGame {
    const state = {
        game: "canoe",
        numplayers: 2,
        variants: [] as string[],
        gameover: false,
        winner: [] as number[],
        stack: [{
            _version: CanoeGame.gameinfo.version,
            _results: [],
            _timestamp: "2026-07-25T00:00:00.000Z",
            currplayer: 2,
            phase: "play" as const,
            board: {
                dataType: "Map",
                value: [
                    ["e5", { owner: 2, face: 40, set: true }],
                    ["g3", { owner: 1, face: 16, set: false }],
                ],
            },
            roll: [3, 3] as [number, number],
            gridCubes: [16, 8],
            pocket: [0, 0],
            canoeDone: true,
            firstPlayer: 1,
        }],
    };
    return new CanoeGame(JSON.stringify(state));
}

function acityFresh(): ACityGame {
    const g = new ACityGame();
    return g;
}

function main(): void {
    const iterations = parseIterations();
    console.log(`Performance audit (move gen / hot paths), iterations=${iterations}\n`);

    const rows: Sample[] = [];

    // --- Tier 1 ---
    rows.push(
        bench("homeworlds", "moves() midgame (after 2× HW + build×2)", iterations, () => {
            homeworldsMidgame().moves();
        }),
    );
    rows.push(
        bench("homeworlds", "moves() opening (homeworld enum only)", iterations, () => {
            homeworldsOpening().moves();
        }),
    );

    rows.push(
        bench("thuemorsego", "moves() size-11 fresh play phase", iterations, () => {
            new ThueMorseGoGame(undefined, ["size-11"]).moves();
        }),
    );
    rows.push(
        bench("thuemorsego", "moves() default 16×16 fresh", iterations, () => {
            new ThueMorseGoGame(undefined, []).moves();
        }),
    );
    const tmMid = thuemorsePlay(new ThueMorseGoGame(undefined, ["size-11"]), ["e5", "pass", "f4"]);
    rows.push(
        bench("thuemorsego", "moves() size-11 after 3 plies", iterations, () => {
            thuemorsePlay(new ThueMorseGoGame(undefined, ["size-11"]), ["e5", "pass", "f4"]).moves();
        }, `|moves|≈${tmMid.moves().length}`),
    );

    const chEntry = crosshairsAfterClouds();
    rows.push(
        bench("crosshairs", "moves() after cloud phase (entry)", iterations, () => {
            crosshairsAfterClouds().moves();
        }, `|moves|=${chEntry.moves().length}`),
    );

    // One-shot: crosshairs mid if we can enter one plane without exploding
    try {
        const ch = crosshairsAfterClouds();
        const entry = ch.moves()[0];
        if (entry !== undefined) {
            ch.move(entry);
            rows.push(
                benchOnce("crosshairs", "moves() one ply after first entry", () => {
                    crosshairsAfterClouds();
                    const g = crosshairsAfterClouds();
                    g.move(g.moves()[0]!);
                    g.moves();
                }, `|moves|=${ch.moves().length}`),
            );
        }
    } catch (e) {
        console.log(`crosshairs  skipped deep entry bench: ${e}`);
    }

    // --- Tier 3 shipped movelists ---
    rows.push(
        bench("accasta", "moves() start position", iterations, () => {
            accastaMid().moves();
        }, `|moves|=${new AccastaGame().moves().length}`),
    );
    rows.push(
        bench("ordo", "moves() start position", iterations, () => {
            new OrdoGame().moves();
        }, `|moves|=${new OrdoGame().moves().length}`),
    );
    rows.push(
        bench("amazons", "moves() start position", iterations, () => {
            new AmazonsGame().moves();
        }, `|moves|=${new AmazonsGame().moves().length}`),
    );
    const ent = entrapmentMid();
    rows.push(
        bench("entrapment", "moves() after setup plies", iterations, () => {
            entrapmentMid().moves();
        }, `stack=${ent.stack.length} |moves|=${ent.moves().length}`),
    );

    rows.push(
        bench("canoe", "moves() early play (rolled)", Math.min(iterations, 5), () => {
            canoePlayMid().moves();
        }),
    );
    rows.push(
        bench("squares", "moves() fresh", iterations, () => {
            new SquaresGame().moves();
        }, `|moves|=${new SquaresGame().moves().length}`),
    );

    rows.push(
        bench("bao", "moves() namua opening", iterations, () => {
            new BaoGame().moves();
        }, `|moves|=${new BaoGame().moves().length}`),
    );

    rows.push(
        bench("acity", "moves() fresh board", iterations, () => {
            acityFresh().moves();
        }, `|moves|=${acityFresh().moves().length}`),
    );

    // --- Tier 4 flag audit ---
    rows.push(
        bench("catapult", "moves() start (no-moves flag)", iterations, () => {
            new CatapultGame().moves();
        }, `|moves|=${new CatapultGame().moves().length}`),
    );
    rows.push(
        bench("anache", "moves() start (no-moves flag)", iterations, () => {
            new AnacheGame().moves();
        }, `|moves|=${new AnacheGame().moves().length}`),
    );
    rows.push(
        bench("yodd", "moves() start (no-moves flag)", iterations, () => {
            new YoddGame().moves();
        }, `|moves|=${new YoddGame().moves().length}`),
    );
    rows.push(
        bench("stiletto", "moves() start (partial list)", iterations, () => {
            new StilettoGame().moves();
        }, `|moves|=${new StilettoGame().moves().length}`),
    );

    // Thue-Morse Go: busy board from thuemorsego.test.ts (weak-eyes + superko)
    const thueBusy = (): ThueMorseGoGame => {
        const busy = new ThueMorseGoGame(undefined, ["size-11", "weak-eyes", "superko"]);
        busy.move("f3");
        const board = new Map<string, 1 | 2>();
        for (const c of ["b2", "c2", "d2", "b3", "d3", "c4", "f6", "g6", "f7", "h7", "g8"]) {
            board.set(c, 1);
        }
        for (const c of ["a2", "a3", "b4", "d4", "c5", "e6", "e7", "f8", "h8", "g9", "h6"]) {
            board.set(c, 2);
        }
        busy.stack[0]!.board = new Map(board);
        busy.stack[busy.stack.length - 1]!.board = new Map(board);
        busy.board = new Map(board);
        return busy;
    };
    rows.push(
        bench("thuemorsego", "moves() busy 11×11 midgame", Math.min(iterations, 5), () => {
            thueBusy().moves();
        }, `|moves|≈${thueBusy().moves().length}`),
    );

    const hw = homeworldsMidgame();
    rows.push(
        benchOnce("homeworlds", "moves() midgame list size", () => {
            hw.moves();
        }, `|moves|=${hw.moves().length}`),
    );

    rows.sort((a, b) => b.msPerOp - a.msPerOp);

    const lines: string[] = [
        "# Performance audit (generated)",
        "",
        `Date: ${new Date().toISOString().slice(0, 10)}`,
        `Iterations per sample: ${iterations} (unless noted once)`,
        "",
        "## Move-generation samples (slowest first)",
        "",
        "| ms/op | game | scenario | notes |",
        "|------:|------|----------|-------|",
    ];
    for (const r of rows) {
        lines.push(`| ${r.msPerOp.toFixed(2)} | ${r.game} | ${r.label} | ${r.extra ?? ""} |`);
    }
    lines.push("");
    writeFileSync("bin/performance-audit-movegen.md", lines.join("\n"), "utf8");
    console.log("\nWrote bin/performance-audit-movegen.md");
}

main();
