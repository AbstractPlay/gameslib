# English locale files in this folder

## `apgames.json` — merge output (do not edit by hand)

`apgames.json` is **generated**. CI fails if it does not match the merge of:

1. `locale-src/en/apgames/shared/**`
2. `locale-src/en/apgames/legacy/monolith-slice.json` (empty scaffold)
3. `gameinfo` (`name`, `description`, `notes`) in each `src/games/<uid>.ts`
4. `gameApgamesEn` in each game module

**Workflow:** edit those sources → `npm run merge-apgames-en` → commit the updated `apgames.json`.

See [docs/i18n.md](../../docs/i18n.md).

## `apresults.json` — authored here

Edit `apresults.json` directly for move-log / result strings (not part of the apgames merge pipeline).
