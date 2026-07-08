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
| `shuffle` | In-place Fisher–Yates | [volcano](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/volcano.ts), [witch](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/witch.ts) |
| `StackSet` | Path-tracking set | [sunspot](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/sunspot.ts), [stibro](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/stibro.ts) |
| `wng` | Procedural names | [homeworlds](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/homeworlds.ts) |
| `x2uid` | Deterministic hash id | [storisende](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/storisende.ts) |

## Example games

- **[Complica](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/complica.ts)** — standard `reviver` pattern in constructor
