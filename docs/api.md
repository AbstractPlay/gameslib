# Consumer API

The root module (`src/index.ts`) exports the public API used by the front end and node-backend.

## Exports

| Symbol | Role |
|--------|------|
| `gameinfo` | `Map<string, APGamesInformation>` of all games |
| `gameinfoSorted` | Same metadata, sorted by name |
| `GameFactory(uid, ...args)` | Instantiate or resume a game |
| `addResource(lang?)` | Merge i18n bundles into host or internal i18next |
| `supportedLocales` | e.g. `["en", "fr", "es-US"]` |
| `resolveLocale` | Map a browser/user language tag to a supported locale (e.g. `es-MX` → `es-US`) |
| `GameBase`, `GameBaseSequenced`, `GameBaseSimultaneous`, `GameBaseSkipTurn` | Base classes for game authors |
| `filterGameinfoForProduction`, `allowedChallengeVariantUids`, `assertAllowedChallengeVariants` | Production filtering for challenge metadata |
| `TurnModel`, `IGamePly`, `IGameRound`, `IGameRoundSlot` | Turn-model types (`getPlies` / `getRounds`) |

AI helpers (`AIFactory`, etc.) exist for testing only and are not part of the public release API.

## Usage

**Browser:** load `APGames.min.js`, then `APGames.GameFactory("complica")`.

**Node:** `import { GameFactory, gameinfo } from "@abstractplay/gameslib"`.

## `gameinfo`

Self-describing metadata per game, matching [`gameinfo.json`](https://github.com/AbstractPlay/gameslib/blob/develop/src/schemas/gameinfo.json). Each entry includes uid, name, description (i18n key), URLs, people, player counts, variants, and flags.

In production builds, `gameinfo` omits experimental games and experimental variants. Use `gameinfo` / `gameinfoSorted` variants for new challenges and tournaments. On a game instance, use `challengeVariants()` for the same filtered picker UI. Use `allvariants()` for historical games and in-game display of active variant uids.

See [Flags](/gameslib/flags/) for flag semantics.

## `GameFactory`

```ts
const game = GameFactory("complica");           // new game
const resumed = GameFactory("complica", saved); // from serialize() string or state
```

Returns `undefined` for unknown uids.

## `addResource`

```ts
const i18n = APGames.addResource("en");
const { t } = i18n;
// namespaces: apgames, apresults
```

Player-facing errors use `UserFacingError` with localized `client` messages.

## Game object

Games returned by `GameFactory` implement the [game object](/gameslib/game-object/) interface: `move`, `render`, `state`, `serialize`, UI hooks, turn model (`getPlies`, `getRounds`, `turnModel`), and record export (`recordExportExclude`, `genRecord`).

## Example games

- **[Complica](https://play.abstractplay.com/games/complica)** — minimal reference implementation (see also [template](/gameslib/templates/new-game-template.ts))
- **[Hnefatafl](https://play.abstractplay.com/games/tafl)** — `RectGrid` on a square board
