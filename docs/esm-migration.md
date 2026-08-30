# ESM migration conventions

Gameslib is migrating from CommonJS (`tsc` → `build/index.js`, `require()` in game files) to native ESM. This document records target conventions for contributors and phased work.

## Package boundary (target)

- `"type": "module"` in `package.json`
- `"exports"` map with `"import"` conditions (no CJS `main` after migration)
- Published entry: `build/index.js` (ESM)

## TypeScript

- `"module": "NodeNext"`
- `"moduleResolution": "NodeNext"`
- Relative imports use **`.js` extensions** in source (NodeNext emit), e.g. `import { foo } from "./foo.js"`

## Deep clone

- Use `cloneState()` from `src/common/clone-state.ts` (or `import { cloneState } from "../common"` in games)
- Do **not** add new `rfdc` usage; Phase 1 removes existing `require("rfdc/default")` call sites
- `cloneState` clones **data** (Maps, arrays, plain objects). Games with custom board classes still call `board.clone()` after copying instance fields (see `go.ts`, `storisende.ts`)

## Game-level compression (legacy)

Eleven games historically gzip+base64 in `serialize()`. **node-backend** now compresses at storage (`lib/gameState.ts`). Phase 1 removes in-game `pako`/`Buffer` compression; constructors accept JSON only.

## i18n (target)

- Node: `@abstractplay/gameslib/i18n-node`
- Browser / Vite: `@abstractplay/gameslib/i18n-browser`
- Remove runtime `require("./i18n-node")` from `src/index.ts`

## Playground (target)

- Webpack UMD `APGames` global → Vite + ESM imports
- Dev alias: `src/index.ts`; production deploy may use `build/index.js`
- Skeleton: `playground/vite.config.ts` (Phase 0); full migration in Phase 1

## Testing

- Mocha + `tsx` loader (existing `.mocharc.cjs`)
- `smoke-esm-entry.mjs` replaces `smoke-cjs-entry.mjs` after Phase 1
- Contract tests for `cloneState` in `test/common/clone-state.test.ts`

## Phases

See the implementation plan in the repo wiki / Cursor plan **Full ESM Migration**. Phase 0 adds `cloneState`, docs, Vite skeleton, and spikes `cloneState` in a few games without flipping the whole package to ESM yet.
