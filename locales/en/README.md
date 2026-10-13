# English locale files in this folder

## `apgames.json` — merge output (do not edit by hand)

`apgames.json` is **generated**. CI fails if it does not match the merge of:

1. `locale-src/en/apgames/shared/**`
2. `locale-src/en/apgames/legacy/monolith-slice.json` (empty scaffold)
3. `gameinfo` (`name`, `description`, `notes`) in each `src/games/<uid>.ts`
4. `gameApgamesEn` in each game module

**Workflow:** edit those sources → `npm run locale-en -- merge apgames --write` → commit the updated `apgames.json`.

See [docs/i18n.md](../../docs/i18n.md).

## `apresults.json` — merged from `locale-src`

English move-log strings use nested paths (`apresults:<uid>.<Type>.<leaf>` and `apresults:_general.*` for shared stems). Author `locale-src/en/apresults/shared/_general/`, `legacy/monolith-slice.json`, and per-game **`gameApresultsEn`** in `src/games/<uid>.ts`, then run `npm run locale-en -- merge apresults --write` — **do not hand-edit** this file. `npm run locale-en` keeps merge output aligned with sources; `npm run locale-en -- keys --warn --strict` (in lint) enforces strict catalog ↔ TypeScript coverage. See `locale-src/en/apresults/README.md` and [docs/i18n.md](../../docs/i18n.md).
