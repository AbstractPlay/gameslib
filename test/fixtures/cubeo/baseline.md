# Cubeo `moves()` baseline (Track 1)

Regenerate timings with `npm run bench:cubeo` (also writes gitignored `bin/cubeo-audit.md`).

## Before incremental optimizations (2026-11-02)

| scenario | ms/op | \|moves\| | tier |
|----------|------:|--------:|------|
| opening | 1.93 | 5 | core |
| gapJump | 15.65 | 9 | core |
| gapJumpStrict | 17.83 | 9 | core |
| d10Midgame | 57.00 | 9 | extended |
| d12Midgame | 78.44 | 9 | extended |

## After memo + BFS endpoints + per-pass board cache (2026-11-02)

| scenario | ms/op | \|moves\| | notes |
|----------|------:|--------:|-------|
| opening | 1.67 | 5 | ~unchanged |
| gapJump | 9.25 | 9 | ~1.7× faster |
| gapJumpStrict | 18.90 | 9 | strict still clone-heavy |
| d10Midgame | 35.40 | 9 | ~1.6× faster |
| d12Midgame | 45.91 | 9 | ~1.7× faster |

## After articulation pinning + canonical strict shape keys (2026-11-02, Track 1 complete)

| scenario | ms/op | \|moves\| | vs original baseline |
|----------|------:|--------:|---------------------|
| opening | 1.38 | 5 | ~1.4× |
| gapJump | 6.90 | 9 | **~2.3×** |
| gapJumpStrict | 8.54 | 9 | **~2.1×** |
| d10Midgame | 22.23 | 9 | **~2.6×** |
| d12Midgame | 29.95 | 9 | **~2.6×** |

Track 1 incremental work is complete. Draft gapJump target was ~3 ms/op; remaining cost is mostly `moveGraphFor` / formation graph builds (Track 2 rewrite optional).

## After Track 2 Phase B — slide topology wired in `computeMoves` (2026-11-02)

Shared `CubeoGraphPassCache` + cached move graphs per `moves()` pass. Same goldens and parity tests.

| scenario | ms/op | \|moves\| | vs Track 1 complete |
|----------|------:|--------:|---------------------|
| opening | 1.19 | 5 | ~1.16× |
| gapJump | 4.00 | 9 | **~1.7×** |
| gapJumpStrict | 8.23 | 9 | ~1.04× |
| d10Midgame | 11.87 | 9 | **~1.9×** |
| d12Midgame | 14.73 | 9 | **~2.0×** |

**Fixtures:** `npx tsx scripts/gen-cubeo-golden.ts --write` after intentional rule changes.

**d10/d12 states:** `npx tsx scripts/build-cubeo-fixture-states.ts` then regen goldens.
