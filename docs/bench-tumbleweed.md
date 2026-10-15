# Tumbleweed performance benchmarks (Phase 0)

Manual baselines for the Tumbleweed perf work. **Not run in CI.**

## gameslib

```bash
npm run bench:tumbleweed
npm run bench:tumbleweed -- --iterations=50
```

Fixtures: [`test/fixtures/tumbleweed/bench.ts`](../test/fixtures/tumbleweed/bench.ts).

### Baseline (2026-03-26, Windows, Node 24, 30 iterations)

| Operation | Before | After Phase 1 |
|-----------|-------:|--------------:|
| `moves()` opening (size 8, ~28k moves) | 1.6 | 1.5 |
| `moves()` midgame reinforce fixture | 0.4 | 0.3 |
| `moves()` stack depth 12 | 0.5 | 0.5 |
| `render()` midgame (influence on) | 2.3 | **0.5** |
| `render()` stack depth 12 | 2.5 | **0.8** |
| `move()` legal via validateMove (midgame) | 3.5 | **0.3** |
| `load(0)` from tip (stack depth 12) | 0.5 | 0.5 |
| `serialize()` stack depth 12 | 0.6 | 0.7 |

Context: opening `moves().length` = 28056; ply-12 serialize ≈ 3607 chars.

## front

From the `front` repo (uses installed `@abstractplay/gameslib`; `npm link` for local gameslib):

```bash
npm run bench:tumbleweed
```

Script: [`front/bin/bench-tumbleweed-nav.mjs`](../../front/bin/bench-tumbleweed-nav.mjs).

### Baseline (2026-03-26, gameslib 1.0.0-ci-38289371504.0, 30 iterations)

| Operation | ms/op |
|-----------|------:|
| `GameFactory(full ply-12 state)` | 0.5 |
| hydrate exploration node 0 (slice+load) | 0.5 |
| hydrate exploration node 11 (slice+load) | 0.6 |
| `resolveMoveTableExportEngine` (focus stack 1, full export) | 1.3 |
| `resolveMoveTableExportEngine` (focus stack 12) | 0.4 |
| `engine.render()` at ply 0 | 2.7 |
| `engine.render()` at ply 12 | 2.1 |
| `moves()` at opening stack | 1.5 |

Re-run after Phase 1/2 changes and append a dated row or replace the table.
