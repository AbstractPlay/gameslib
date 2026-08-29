# Turn-model golden fixtures

Committed tests in `test/games/turnModelGolden.test.ts` load completed game states from **`test/fixtures-local/turnModel/`** (gitignored). CI passes when that folder is absent; run the fetch script locally before working on turn-model or chat-log migration.

## Fetch fixtures

Requires AWS credentials with read access to the production Abstract Play DynamoDB table.

```bash
# optional — defaults to abstract-play-prod
export ABSTRACT_PLAY_TABLE=abstract-play-prod

# Full turn-model + chat override fixtures
npm run fetch-turnModel-fixtures

# Chat override games only (merges into existing manifest; preserves tier1/pattern entries)
npm run fetch-chat-golden-fixtures

# Gap-fill chat scenarios (detonate, buku repetition, lielow promote swap, magnate economy)
npm run fetch-extra-chat-fixtures
```

The script:

1. Downloads `https://records.abstractplay.com/meta/{uid}.json` for Tier 1, pattern, and chat games.
2. Resolves display names to uids via gameslib `gameinfo` (e.g. Adere → `agere`, King's Valley → `valley`).
3. Selects representative records (normal / timeout / resign for Tier 1; elimination patterns for Armadas, Homeworlds, Pigs, etc.; Frogger refills/`skipto` for Phase 6 prep; **chat** category for `chatLog()` override games).
4. Loads each game's serialized state from DynamoDB (`pk=GAME`, `sk={metaGame}#1#{id}`).
5. Writes `manifest.json` plus per-fixture JSON under `test/fixtures-local/turnModel/` (Maps/Sets via `replacer`/`reviver`, same as live `serialize()`).

Fixture ids use category prefix: `tier1-`, `pattern-`, or `chat-` (e.g. `chat-volcano-volcanoBaseline-a1b2c3d4`).

**Chat category** covers the 17 `chatLog()` override games not already in pattern fixtures (Byte, Breakthrough, Buku, Chase, Epaminondas, Fendo, Fanorona, FNAP, Focus, Frames, Magnate, Mega-Volcano, Pulling Strings, Tumbleweed, Upper Hand, Veletas, Volcano). Homeworlds, Pigs, Pigs2, Entropy, and Lielow remain covered by existing pattern/tier1 entries. Run `fetch-extra-chat-fixtures` for depth scenarios: Breakthrough detonate (`bombardment`), Buku repetition EOG, Lielow cross-player promote, second Magnate economy baseline.

**Phase 3 pre-migration gate** (Tier A attribution overrides): `test/games/phase3ChatFixtures.test.ts` + `npm run verify-phase3-chat-fixtures` — byte partial/deltaScore, lielow promote swap, upperhand chain, tumbleweed self-capture, veletas/buku cross-player claim, buku repetition, magnate economy.

**Phase 4 pre-migration gate** (Tier B + C override games): when `fixtures-local` is present, `test/games/phase4ChatFixtures.test.ts` asserts each game has a chat/pattern golden with the scenario shapes required for migration (simultaneous pulls, aggregation, etc.). CLI: `npm run verify-phase4-chat-fixtures`.

**Inline chat scenarios** (committed, CI always): `test/fixtures/chat/` + `test/games/chatLogScenario.test.ts` — Canoe roll attribution, El Oso solo/bear attribution. Probe prod records: `npx ts-node scripts/probe-chat-fixture-candidates.ts`.

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

After intentional chat-log copy or collector changes:

```bash
npm run refresh-chat-golden
```

To backfill only `golden.chatLogEntries` on fixtures fetched before structured baselines were stored:

```bash
npm run refresh-chat-golden-entries
```

Golden tests assert `moveHistory()` against `golden.moveHistory`. `genRecord()` is compared to `golden.genRecordMoves`: **header** exact against `publishedRecord` after stripping volatile fields; **moves** compared on move-string seating grids only (`roundMoveStrings`). Ply/`getRounds` checks run for all pattern fixtures. Skip-turn and simultaneous games use full-width rows with `null` for inactive/eliminated seats.

`chatLog` is compared against `golden.chatLog` for every fixture. `golden.chatLogEntries` is compared when present. `assertChatLogParity` runs for every fixture with a loaded engine.

Published record `site.gameid` uses `{id}#{meta}:{variants.join("|")}`; legacy `{meta}#{id}` is still accepted. See `test/fixtures/turnModel/siteGameId.ts`.
