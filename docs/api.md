# Consumer API

The root module (`src/index.ts`) exports the public API used by the front end and node-backend.

## Exports

| Symbol | Role |
|--------|------|
| `gameinfo` | `Map<string, APGamesInformation>` of all games |
| `gameinfoSorted` | Same metadata, sorted by name |
| `GameFactory(uid, ...args)` | Instantiate or resume a game |
| `addResource(lang?)` | Merge i18n bundles into host or internal i18next |
| `supportedLocales` | e.g. `["en", "fr"]` |
| `GameBase`, `GameBaseSimultaneous` | Base classes for game authors |
| Types | `IAPGameState`, `APMoveResult`, `APGamesInformation`, etc. |

AI helpers (`AIFactory`, etc.) exist for testing only and are not part of the public release API.

## Usage

**Browser:** load `APGames.min.js`, then `APGames.GameFactory("complica")`.

**Node:** `import { GameFactory, gameinfo } from "@abstractplay/gameslib"`.

## `gameinfo`

Self-describing metadata per game, matching [`gameinfo.json`](https://github.com/AbstractPlay/gameslib/blob/develop/src/schemas/gameinfo.json). Each entry includes uid, name, description (i18n key), URLs, people, player counts, variants, and flags.

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

Games returned by `GameFactory` implement the [game object](/gameslib/game-object/) interface: `move`, `render`, `state`, `serialize`, UI hooks, and history helpers.

## Example games

- **[Complica](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/complica.ts)** — minimal reference implementation (see also [template](/gameslib/templates/new-game-template.ts))
- **[Tafl](https://github.com/AbstractPlay/gameslib/blob/develop/src/games/tafl.ts)** — `RectGrid` on a square board
