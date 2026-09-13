# Serialization and utilities

Common non-topology helpers from `src/common/`.

## Serialization (`serialization.ts`)

- `replacer` / `sortingReplacer` — JSON.stringify hooks for `Map` and `Set`
- `reviver` — JSON.parse hook to restore `Map`/`Set`

Use in constructors when deserializing saved state.

## Errors (`errors.ts`)

`UserFacingError` — `message` is an internal code; `client` is the localized player string.

## Other utilities

| Export | Purpose | Example games |
|--------|---------|---------------|
| `shuffle` | In-place Fisher–Yates | [Volcano](https://play.abstractplay.com/games/volcano), [Witch Stones](https://play.abstractplay.com/games/witch) |
| `StackSet` | Path-tracking set | [Sunspot](https://play.abstractplay.com/games/sunspot), [Stibro](https://play.abstractplay.com/games/stibro) |
| `wng` | Procedural names | [Homeworlds](https://play.abstractplay.com/games/homeworlds) |
| `x2uid` | Deterministic hash id | [Storisende](https://play.abstractplay.com/games/storisende) |

## Storisende board wire (`src/games/storisende/boardCodec.ts`)

Games use **Option A** cutover: `stack[0]._version` (same string as `gameinfo.version` for new games) selects wire format for the whole archive.

| `stack[0]._version` | Each `stack[i].board` |
|---------------------|------------------------|
| Before compact cutover (`YYYYMMDD`) | Legacy full `StorisendeHex[]` |
| Cutover and later | `sparse-v1` snapshots and/or `delta-v1` changes (never legacy arrays) |

- **sparse-v1** — `{ fmt: "sparse-v1", cells: [{ q, r, tile?, stack? }] }` (only non-default cells). Modular topology comes from game state **`startingPosition`** (`modular-centres-v1/...`), not from the wire frame.
- **delta-v1** — `{ fmt: "delta-v1", changes: [...] }` applied on top of the previous ply; **keyframes** every 20 plies use sparse-v1 again.

Legacy archives are never rewritten; continued play on old games keeps full hex arrays.

**Modular `startingPosition`:** Persisted on `IStorisendeState.startingPosition` and returned by `getStartingPosition()` as `modular-centres-v1/{13|18}/{q,r;...}` (from `stack[0]` on legacy loads). Compact sparse/delta decode uses this instead of re-running `generateField`.

## Example games

- **[Complica](https://play.abstractplay.com/games/complica)** — standard `reviver` pattern in constructor
