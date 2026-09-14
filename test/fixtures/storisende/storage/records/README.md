# Storisende storage record fixtures

Vendored **legacy** game states (full `board` hex arrays) from production, one per board variant.

## Fetch

Requires AWS read access to the production Abstract Play DynamoDB table.

```bash
export ABSTRACT_PLAY_TABLE=abstract-play-prod
npm run fetch-storisende-storage-fixtures
```

The script reads [records meta](https://records.abstractplay.com/meta/storisende.json), picks a long completed game per variant, loads `pk=GAME` / `sk=storisende#1#{id}`, trims to opening frames + tail (for repo size), and writes `record-*.json` plus `manifest.json`.

## Tests

`test/games/storisende.storage.test.ts` loads each manifest entry and asserts **hex-for-hex** board equality at every `load(idx)` between:

1. Legacy wire (fixture as stored in DB today)
2. Production compact wire (`reencodeStateAsCompact` — sparse-v1, delta-v1, keyframes)
