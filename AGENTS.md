# Agent guide — gameslib

TypeScript game rules engine for Abstract Play. Published as `@abstractplay/gameslib`; consumed by the front-end, node-backend, and designer. Human docs: [docs.abstractplay.com/gameslib/](https://docs.abstractplay.com/gameslib/).

Cursor users: [`.cursor/rules/`](.cursor/rules/) mirrors the **Tests** section below for `test/**/*.ts`.

## Abstract Play (wide)

Org-wide policy for AP repos. Other repos link here instead of duplicating this block.

### Scope and style

- Ship the **smallest correct diff**. Match naming, types, and patterns in the files you touch.
- Comments only for non-obvious rules or invariants. No drive-by refactors or unrelated edits.

### Handoff quality

Before you call work done, run in this repo (exit 0):

```bash
npm run typecheck
npm run lint
```

Run tests appropriate to the change (see **Tests** below). CI runs the full `npm test` suite.

### Dependencies

- Use registry versions and `ci-deps.*.json` pins in consuming repos; here, keep `@abstractplay/*` dev deps on published CI builds unless you are explicitly doing a local integration test.
- **Do not leave `file:` path or tarball dependencies** in delivered `package.json` / lockfiles.
- After `npm link` or local tarball tests, restore registry installs (`npm unlink`, reinstall) before handoff.

### Changelog

Log **substantive** user- or integrator-visible changes in root [`CHANGELOG.md`](CHANGELOG.md) ([Keep a Changelog](https://keepachangelog.com/)). Batch bullets into **one dated `[1.0.0-ci]` section per calendar month** (update that section’s date when you append). Use `[Unreleased]` for work not yet on `main`, per the changelog header.

### Internationalization

- Edit **English only**: [`locales/en/apgames.json`](locales/en/apgames.json), [`locales/en/apresults.json`](locales/en/apresults.json).
- Do not hand-edit other `locales/*` languages or `locale-src/` tracking files.
- No optional-parenthesis plurals (`piece(s)`). Use i18next pairs: `KEY_one`, `KEY_other`.
- Details: [docs/i18n.md](docs/i18n.md).

### Documentation in this repo

- New page under `docs/**/*.md` → add its slug to [`docs/nav.json`](docs/nav.json).
- Prefer absolute doc URLs (`/gameslib/...`) for cross-page links; run `npm run docs:check` when editing docs (needs sibling `docs` checkout or `AP_DOCS_ROOT`).

### Secrets

Never commit `.env`, API keys, tokens, or credentials. `bin/state.json` is scratch debug output only.

### AI assistants

Do **not** `git commit`, `git push`, or amend commits unless the human explicitly asks. Read-only `git status`, `diff`, and `log` are fine.

---

## Layout and workflow

| Area | Purpose |
|------|---------|
| `src/games/<uid>.ts` | Game implementation (`static gameinfo` drives registry) |
| `src/common/` | Shared graphs, flags, decktet, serialization, etc. |
| `test/games/` | Per-game Mocha tests |
| `test/fixtures/` | Shared deterministic fixtures |
| `locales/en/` | English i18n source |
| `docs/` | Contributor documentation (vendor-synced to docs site) |

1. Fork and branch from **`develop`**.
2. After adding/changing `gameinfo`, run `npm run generate-registry` (or any test/build).
3. New games: flag `experimental` in `gameinfo` until production-ready.
4. Guide: [docs/creating-games.md](docs/creating-games.md).

## Commands

| Command | When |
|---------|------|
| `npm run test0` | Fast local loop — edit script in `package.json` to point at one file or `--grep` |
| `npm test` | Full Mocha suite (CI); `pretest` runs typecheck + registry |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | Weblate keys, game names locale, JSON format, ESLint |
| `npm run build` | Release compile, registry check, lint |
| `npm run docs:check` | Doc links/nav after `docs/` edits |
| `npm run json2ts` | Regenerate `.d.ts` from JSON schemas |

Shared code (`src/common/**`, `src/games/_turn-model.ts`, registry/locale scripts): run **full** `npm test` before merge.

## Tests

Tests must be **self-contained** and **deterministic**.

- Inputs live **inline** in the test file or in **`test/fixtures/`** only.
- **Never** read `bin/`, `docs/`, `src/`, or other repo paths at test runtime (`readFileSync("bin/state.json")`, `import` of JSON outside `test/`, etc.). CI cwd must not matter.
- Reproduce bugs from `bin/state.json` by **copying** state into a fixture, not pointing tests at `bin/`.
- After `new SomeGame(...)`, set `hands`, `board`, `deferred`, and every seat that affects assertions — do not rely on random deals.
- Assert **behaviour and contracts** (ordering, presence, public APIs), not tunable visuals or private legend key strings when a pattern-based check is enough.

**Local scope:** one game or narrow surface → `npm run test0` on that file. Touching shared helpers → full `npm test`. See [docs/testing.md](docs/testing.md).

## Schemas

After editing `src/schemas/*.json`, run `npm run json2ts`. Generated headers should use `eslint-disable @typescript-eslint/naming-convention` (not `tslint:disable`) — see [README.md](README.md).

## Contact

[#dev-curious on Discord](https://discord.abstractplay.com)
