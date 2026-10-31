# EOG reason catalog (progress)

Games that push `{ type: "eog", reason: "…" }` need a matching **`apresults`** leaf (`<uid>.EOG.<leaf>` or `_general.EOG.<leaf>`). Regenerate English with `npm run locale-en -- merge apresults --write` after editing `gameApresultsEn` or [`locale-src/en/apresults/shared/_general/EOG.json`](locale-src/en/apresults/shared/_general/EOG.json).

Run `node scripts/audit-eog-reasons.mjs` for a per-game report (missing catalog leaves exit non-zero). Shared `_general.EOG.*` strings are enough for generic endings — do not duplicate them in every game file. Use `--require-game-eog` only when auditing game-specific copy coverage.

Implementation notes:

- Shared resolver on `GameBase`: `collectEogChatLogLine`, optional `eogChatLineOverride`, optional `eogReasonAliases`.
- UI / notifications: `engine.formatEogSummary(playerNames, t)` (same line as move log).
- Do not rename serialized `reason` values in saved games.

When adding a new ending, set `reason`, add English under `EOG`, wire aliases if needed, and extend chat parity or focused tests.
