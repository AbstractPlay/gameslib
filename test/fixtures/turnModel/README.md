# Turn-model golden fixtures

Committed tests in `test/games/turnModelGolden.test.ts` load completed game states from **`test/fixtures-local/turnModel/`** (gitignored). CI passes when that folder is absent; run the fetch script locally before working on turn-model phases.

## Fetch fixtures

Requires AWS credentials with read access to the production Abstract Play DynamoDB table.

```bash
# optional — defaults to abstract-play-prod
export ABSTRACT_PLAY_TABLE=abstract-play-prod

npm run fetch-turnModel-fixtures
```

The script:

1. Downloads `https://records.abstractplay.com/meta/{uid}.json` for Tier 1 and pattern games.
2. Resolves display names to uids via gameslib `gameinfo` (e.g. Adere → `agere`, King's Valley → `valley`).
3. Selects representative records (normal / timeout / resign for Tier 1; elimination patterns for Armadas, Homeworlds, Pigs, etc.; Frogger refills/`skipto` for Phase 6 prep).
4. Loads each game's serialized state from DynamoDB (`pk=GAME`, `sk={metaGame}#1#{id}`).
5. Writes `manifest.json` plus per-fixture JSON under `test/fixtures-local/turnModel/` (Maps/Sets via `replacer`/`reviver`, same as live `serialize()`).

**Frogger dev fixtures** (refills/`skipto`, 2p/4p, no-refills control) — pull from `abstract-play-dev` by game id:

```bash
export ABSTRACT_PLAY_TABLE=abstract-play-dev
npm run fetch-frogger-dev-fixtures
```

Games are listed in `scripts/fetch-frogger-dev-fixtures.ts` (dev Lab/Playground URLs under `play.dev.abstractplay.com/move/frogger/1/{id}`).

Solo sequential coverage uses the inline `SoloSequentialFake` in `soloSequential.ts` (no DB fetch).

If you fetched fixtures before Map-aware normalization, run:

```bash
npm run refresh-turnModel-golden
```

That recomputes `golden.stateNormalized` from the saved states (no DynamoDB). After simultaneous export changes (Phase 2), refresh move baselines:

```bash
npm run refresh-turnModel-golden-moves
```

Golden tests assert `moveHistory()` against `golden.moveHistory`. `genRecord()` is compared to `golden.genRecordMoves`: **header** exact against `publishedRecord` after stripping volatile fields; **moves** compared on move-string seating grids only (`roundMoveStrings`). Ply/`getRounds` checks run for all pattern fixtures. Skip-turn and simultaneous games use full-width rows with `null` for inactive/eliminated seats.
