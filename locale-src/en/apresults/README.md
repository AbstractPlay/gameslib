# English `apresults` sources

Runtime keys: `apresults:_general.<ResultType>.<leaf>` and `apresults:<uid>.<ResultType>.<leaf>`.

## Merge inputs

| Source | Role |
|--------|------|
| `shared/_general/*.json` | Shared result buckets under `_general` (global outcomes, reusable stems) |
| `legacy/monolith-slice.json` | Empty scaffold — per-game English lives in `gameApresultsEn` |
| `gameApresultsEn` in `src/games/<uid>.ts` | Per-game move-log English |

```bash
npm run locale-en -- merge apresults --write   # write locales/en/apresults.json
npm run locale-en                              # CI: sources match merged file (both namespaces)
npm run locale-en -- keys apresults --warn --strict --summary
npm run locale-en -- prune apresults           # dry-run unused gameApresultsEn leaves
```

Do **not** hand-edit [`locales/en/apresults.json`](../../../locales/en/apresults.json).

## Path map (locale remap)

[`apresults-path-map.json`](apresults-path-map.json) links **legacy flat** catalog paths to nested `newPath` values. Regenerate when English leaf paths change:

```bash
node scripts/audit-apresults-catalog.mjs --write-map
```

Optional fixes: [`apresults-path-map-overrides.json`](apresults-path-map-overrides.json) keyed by `oldPath`.

When English moves to a new nested path but the English string is unchanged, run **`npm run locale-en -- remap apresults --write`** before `npm run translate` so managed locales keep existing translations.

## Audits (optional)

| Command | Purpose |
|---------|---------|
| `npm run locale-en -- audit apresults` | Full-registry missing/orphan summary |
| `npm run audit-apresults-catalog` | Inventory + path-map stats |
| `npm run audit-apresults-general-duplicate-en` | Duplicate English within `_general` |
| `npm run audit-apresults-general-game-specific-keys` | `_general` keys that look game-specific |

Details: [docs/i18n.md](../../../docs/i18n.md), [docs/structured-chat-log.md](../../../docs/structured-chat-log.md).
