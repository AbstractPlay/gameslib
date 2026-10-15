# Turn-model local fixtures (optional, not used in CI)

**Local DynamoDB goldens are retired.** `npm test` does not compare against `test/fixtures-local/turnModel/` even if that folder exists. Turn-model and chat-log behaviour is covered by inline fixtures (`test/fixtures/chat/`, `test/games/chatLogScenario.test.ts`, `test/games/chatLogParity.test.ts`, per-game tests) and production records.

The fetch/refresh scripts below remain for occasional manual debugging only.

## Fetch fixtures (optional)

Requires AWS credentials with read access to the production Abstract Play DynamoDB table.

```bash
export ABSTRACT_PLAY_TABLE=abstract-play-prod
npm run fetch-turnModel-fixtures
```

Writes `manifest.json` and per-fixture JSON under **`test/fixtures-local/turnModel/`** (gitignored).

Refresh helpers (only when fixtures exist on disk):

```bash
npm run refresh-turnModel-golden
npm run refresh-turnModel-golden-moves
npm run refresh-turnModel-published-scores
npm run refresh-chat-golden
npm run refresh-chat-golden-entries
```

Solo sequential coverage in tests uses the inline `SoloSequentialFake` in `soloSequential.ts` (no DB fetch).

Published record `site.gameid` uses `{id}#{meta}:{variants.join("|")}`; legacy `{meta}#{id}` is still accepted. See `test/fixtures/turnModel/siteGameId.ts`.
