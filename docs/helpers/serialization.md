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
| `shuffle` | In-place Fisher–Yates | [volcano](https://play.abstractplay.com/games/volcano), [witch](https://play.abstractplay.com/games/witch) |
| `StackSet` | Path-tracking set | [sunspot](https://play.abstractplay.com/games/sunspot), [stibro](https://play.abstractplay.com/games/stibro) |
| `wng` | Procedural names | [homeworlds](https://play.abstractplay.com/games/homeworlds) |
| `x2uid` | Deterministic hash id | [storisende](https://play.abstractplay.com/games/storisende) |

## Example games

- **[Complica](https://play.abstractplay.com/games/complica)** — standard `reviver` pattern in constructor
